import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

/**
 * A column header that's both a click-to-filter dropdown AND a
 * resizable column (drag the light bar on the right edge). Shared by
 * every table in the app that isn't built on the generic DataTable
 * component, so they all behave identically instead of drifting into
 * subtly different implementations.
 *
 * The filter is Excel-style multi-select: a checkbox per value (options
 * are whatever's actually present in the current data — see each page's
 * colOptions()), plus "Select All" / "Clear" buttons and a built-in
 * search box for long lists. `value` is the set of currently-selected
 * values — `undefined` means "everything selected / no filter applied",
 * which is also what selecting every checkbox (or clicking "Select
 * All") collapses back to, so an active filter badge only ever shows
 * when the column is genuinely narrowed. `onChange` receives the next
 * Set (or `undefined` to clear the filter entirely).
 *
 * Optionally also a click-to-sort header — pass `sortDir` (the current
 * direction for this column, or null/undefined when it's not the active
 * sort column) and `onSortClick`. When provided, a small sort indicator
 * renders next to the filter dropdown and clicking either the label or
 * the indicator toggles the sort for this column (asc -> desc -> off).
 *
 * Requires the enclosing <table> to have `table-layout: fixed` — plain
 * `<th>` width hints are otherwise just a suggestion the browser can
 * override based on cell content, which makes a drag handle feel broken
 * (the column snaps back). Fixed layout makes the header's width the
 * actual, authoritative column width.
 */
export function ResizableFilterHeader({
  label, value, options, onChange, width, onWidthChange, align = "left", minWidth = 70, filterable = true,
  sortDir, onSortClick,
}: {
  label: string; value?: Set<string>; options?: string[]; onChange?: (next: Set<string> | undefined) => void;
  width: number; onWidthChange: (w: number) => void; align?: "left" | "center"; minWidth?: number; filterable?: boolean;
  sortDir?: "asc" | "desc" | null; onSortClick?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const resizing = useRef<{ startX: number; startWidth: number } | null>(null);
  const [, forceRender] = useState(0); // re-render while dragging so the live width shows immediately
  const allOptions = options || [];
  const filteredOptions = query.trim()
    ? allOptions.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()))
    : allOptions;
  const sortable = !!onSortClick;

  // undefined selection == everything selected == no filter applied.
  const isChecked = (o: string) => (value ? value.has(o) : true);
  const filterActive = value !== undefined && value.size !== allOptions.length;
  const selectedCount = value ? value.size : allOptions.length;

  const toggleOption = (o: string) => {
    const base = new Set(value ?? allOptions);
    if (base.has(o)) base.delete(o); else base.add(o);
    onChange?.(base.size === allOptions.length ? undefined : base);
  };
  const selectAll = () => onChange?.(undefined);
  const clearAll = () => onChange?.(new Set());

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const delta = e.clientX - resizing.current.startX;
      onWidthChange(Math.max(minWidth, resizing.current.startWidth + delta));
      forceRender((n) => n + 1);
    };
    const onUp = () => { resizing.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onWidthChange, minWidth]);

  return (
    <th style={{ position: "relative", textAlign: align, width, minWidth: width, maxWidth: width, boxSizing: "border-box" }}>
      {/* Truncation wrapper — overflow:hidden lives HERE, not on the <th>
          itself, so it clips only the label text. Putting it on the <th>
          also clipped the dropdown panel below (positioned relative to
          this same cell), which silently broke every filter click —
          the menu was opening, just invisible. */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: align === "center" ? "center" : "flex-start" }}>
        <span
          onClick={sortable ? onSortClick : undefined}
          style={{
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
            cursor: sortable ? "pointer" : undefined, flexShrink: 1,
          }}
          title={sortable ? "Click to sort" : undefined}
        >
          {label}
        </span>
        {sortable && (
          <span
            onClick={onSortClick}
            style={{ cursor: "pointer", display: "flex", flexShrink: 0, opacity: sortDir ? 1 : .4 }}
            title="Click to sort"
          >
            {sortDir === "asc" ? <ChevronUp size={12} /> : sortDir === "desc" ? <ChevronDown size={12} /> : <ChevronsUpDown size={11} />}
          </span>
        )}
        {filterable && onChange && (
          <button
            onClick={() => setOpen((v) => !v)}
            title="Filter this column"
            style={{
              display: "flex", alignItems: "center", gap: 2, background: "none", border: "none", cursor: "pointer",
              font: "inherit", fontWeight: "inherit", color: filterActive ? "var(--violet-500)" : "inherit",
              opacity: filterActive ? 1 : .55, padding: 0, flexShrink: 0,
            }}
          >
            {filterActive && <span style={{ fontSize: 10, flexShrink: 0 }}>({selectedCount})</span>}
            <ChevronDown size={12} />
          </button>
        )}
      </div>
      {open && filterable && onChange && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => { setOpen(false); setQuery(""); }} />
          <div style={{
            position: "absolute", top: "100%", left: 0, marginTop: 4, background: "#fff", color: "#111827",
            border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,.12)",
            zIndex: 11, minWidth: 200, maxHeight: 340, display: "flex", flexDirection: "column", padding: 4,
          }}>
            {/* Search-within-filter — options can genuinely run long
                (client names, requisition titles, etc.), and scrolling a
                plain list to find one by eye is exactly the friction
                this removes. Always shown, even for short lists, so
                every filter dropdown behaves the same way. */}
            <input
              autoFocus type="text" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…" onClick={(e) => e.stopPropagation()}
              style={{
                fontSize: 12, padding: "6px 8px", marginBottom: 4, border: "1px solid var(--border)",
                borderRadius: 6, outline: "none", fontWeight: 400,
              }}
            />
            {/* Select All / Clear — same two-button pattern as the
                Excel-style filter everywhere else in the app (see
                DataTable.tsx), so every filterable column, regardless of
                which table component renders it, behaves identically. */}
            <div style={{ display: "flex", gap: 10, padding: "4px 6px 8px" }}>
              <button onClick={(e) => { e.stopPropagation(); selectAll(); }}
                style={{ fontSize: 11, background: "none", border: "none", color: "var(--teal-500)", cursor: "pointer", padding: 0, fontWeight: 600 }}>
                Select All
              </button>
              <button onClick={(e) => { e.stopPropagation(); clearAll(); }}
                style={{ fontSize: 11, background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: 0, fontWeight: 600 }}>
                Clear
              </button>
            </div>
            <div style={{ overflowY: "auto" }}>
              {filteredOptions.length === 0 ? (
                <div style={{ padding: "6px 10px", fontSize: 12, color: "var(--text-muted)" }}>No matches.</div>
              ) : (
                filteredOptions.map((o) => (
                  <label key={o} onClick={(e) => e.stopPropagation()}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12, borderRadius: 6, whiteSpace: "nowrap" }}>
                    <input type="checkbox" checked={isChecked(o)} onChange={() => toggleOption(o)} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{o}</span>
                  </label>
                ))
              )}
            </div>
            <div style={{ padding: "8px 6px 2px", textAlign: "right", borderTop: "1px solid var(--border)", marginTop: 4 }}>
              <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={() => { setOpen(false); setQuery(""); }}>Done</button>
            </div>
          </div>
        </>
      )}
      {/* Resize handle — a thin, light bar on the right edge of the
          header; brightens on hover so it reads as grabbable. */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          resizing.current = { startX: e.clientX, startWidth: width };
        }}
        onDoubleClick={() => onWidthChange(Math.max(minWidth, 140))}
        title="Drag to resize, double-click to reset"
        style={{
          position: "absolute", top: 0, right: 0, bottom: 0, width: 2, cursor: "col-resize",
          background: "var(--slate-300, #cbd5e1)", opacity: 0.5,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = "1"; (e.currentTarget as HTMLDivElement).style.background = "var(--violet-400, #a78bfa)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = "0.5"; (e.currentTarget as HTMLDivElement).style.background = "var(--slate-300, #cbd5e1)"; }}
      />
    </th>
  );
}
