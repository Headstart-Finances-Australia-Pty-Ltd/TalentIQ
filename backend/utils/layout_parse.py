"""
TalentIQ - Layout-Aware PDF Extraction
=========================================
Closes part of the "legacy parsers scramble multi-column resumes" gap —
with an honest scope note up front: this is pdfplumber word-position
clustering + explicit table extraction, NOT a vision-LLM document
understanding pipeline (Docling/Unstructured-style). That's a deliberate,
pragmatic choice for this environment (no GPU, no external document-AI
service to call) — but it directly addresses the SPECIFIC, common failure
mode: pdfplumber's/PyMuPDF's default `extract_text()` reads words in
roughly top-to-bottom, left-to-right order across the WHOLE page width,
which interleaves left-column and right-column content line-by-line on a
genuinely two-column resume, scrambling job titles, dates, and bullet
points into nonsense.

Approach, per page:
  1. Extract every word with its bounding box.
  2. Cluster words into columns by x0 position (a simple gap-based split,
     not a general-purpose layout model — sufficient for the common
     "sidebar + main content" or "two even columns" resume layouts, not
     guaranteed for exotic ones).
  3. If a clear multi-column split is found, emit each column's text in
     its own top-to-bottom reading order, left column first — this is
     what actually fixes the scrambling.
  4. Extract tables explicitly via pdfplumber's table detection and emit
     them as pipe-separated rows, since table cells are exactly the other
     place naive text flow garbles structured content (e.g. a skills
     matrix or a dates/company/title table).
  5. Falls back to plain single-column reading order if no clear column
     split is detected — this does NOT force two-column reading onto a
     genuinely single-column resume.
"""
from typing import List
import io


def _cluster_columns(words: list, page_width: float, gap_threshold_frac: float = 0.04) -> List[tuple]:
    """Returns a list of (x_min, x_max) column bounds, or a single column
    spanning the whole page if no clear gutter is found.

    Uses a whitespace PROJECTION, not just the single largest gap between
    two words' x0 positions: a genuine column gutter is a vertical strip
    that's empty of text across the WHOLE page height. A single line's
    inter-word spacing can also produce a locally-wide gap, but that same
    x-range is covered by words on OTHER lines — projecting every word's
    full [x0, x1] span onto one shared axis and looking for a strip with
    zero coverage anywhere is what tells the two apart. An earlier version
    of this function compared raw per-line gaps directly and mis-detected
    columns in single-column documents whenever one line happened to have
    an unusually wide word gap (e.g. around a long em-dash or spacing
    artifact) — this projection-based version doesn't have that failure
    mode, since it requires the gap to be empty everywhere, not just once.
    """
    if not words:
        return [(0, page_width)]

    bin_size = 2.0  # points
    n_bins = int(page_width / bin_size) + 1
    occupied = [False] * n_bins
    for w in words:
        start_bin = max(0, int(w["x0"] / bin_size))
        end_bin = min(n_bins - 1, int(w["x1"] / bin_size))
        for b in range(start_bin, end_bin + 1):
            occupied[b] = True

    mid_lo_bin, mid_hi_bin = int(page_width * 0.15 / bin_size), int(page_width * 0.85 / bin_size)
    gap_threshold_bins = int((page_width * gap_threshold_frac) / bin_size)

    # Find the widest contiguous run of unoccupied bins fully within the
    # middle band — a real gutter running the full height of the page.
    best_run_start, best_run_len = None, 0
    run_start = None
    for b in range(mid_lo_bin, mid_hi_bin + 1):
        if not occupied[b]:
            if run_start is None:
                run_start = b
        else:
            if run_start is not None:
                run_len = b - run_start
                if run_len > best_run_len:
                    best_run_len, best_run_start = run_len, run_start
            run_start = None
    if run_start is not None:
        run_len = (mid_hi_bin + 1) - run_start
        if run_len > best_run_len:
            best_run_len, best_run_start = run_len, run_start

    if best_run_start is not None and best_run_len >= gap_threshold_bins:
        split = (best_run_start + best_run_len / 2) * bin_size
        return [(0, split), (split, page_width)]
    return [(0, page_width)]


def _words_in_column(words: list, x_min: float, x_max: float) -> str:
    """Reassembles words assigned to one column into reading-order text —
    grouped into lines by vertical (top) position, then left-to-right
    within each line."""
    col_words = [w for w in words if x_min <= w["x0"] < x_max]
    if not col_words:
        return ""
    col_words.sort(key=lambda w: (round(w["top"], 0), w["x0"]))

    lines: List[List[dict]] = []
    current_line: List[dict] = []
    last_top = None
    line_tolerance = 3.0  # points — words within this vertical band are the same line
    for w in col_words:
        if last_top is not None and abs(w["top"] - last_top) > line_tolerance:
            lines.append(current_line)
            current_line = []
        current_line.append(w)
        last_top = w["top"]
    if current_line:
        lines.append(current_line)

    return "\n".join(" ".join(w["text"] for w in sorted(line, key=lambda w: w["x0"])) for line in lines)


def extract_pdf_layout_aware(content: bytes) -> str:
    import pdfplumber

    all_pages_text = []
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            words = page.extract_words() or []
            page_width = float(page.width)

            columns = _cluster_columns(words, page_width)
            if len(columns) > 1:
                # Multi-column: emit left-to-right, each column top-to-bottom.
                page_text = "\n\n".join(
                    _words_in_column(words, x_min, x_max) for x_min, x_max in columns
                )
            else:
                page_text = _words_in_column(words, 0, page_width)

            # Tables: extract explicitly and append (not interleaved inline
            # with the position they appeared at — pdfplumber doesn't
            # expose that cheaply, and appending after the column text
            # still keeps the table's own row/column structure intact,
            # which is the actual failure mode being fixed — a table
            # flattened into naive reading order loses which value
            # belongs to which column entirely).
            try:
                tables = page.extract_tables() or []
            except Exception:
                tables = []
            for table in tables:
                rows_text = "\n".join(
                    " | ".join((cell or "").strip() for cell in row)
                    for row in table if any((cell or "").strip() for cell in row)
                )
                if rows_text.strip():
                    page_text += "\n\n[TABLE]\n" + rows_text

            all_pages_text.append(page_text)

    return "\n\n".join(all_pages_text).strip()
