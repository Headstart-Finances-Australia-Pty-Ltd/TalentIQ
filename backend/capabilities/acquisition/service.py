"""
Service helpers for Candidate Acquisition & Talent Pool.

Deliberately reuses existing, proven TalentIQ logic instead of
reimplementing it:
  - resume text extraction (PDF/DOCX/DOC/TXT)   -> routers.jobhunt._extract_text_from_file
  - heuristic resume parsing (name/email/skills) -> agents.jobhunt_agent.parse_resume_text
  - portal-token pattern (long random string as the auth) -> mirrors
    models.models.JobLensCandidate.interview_token, proven in production
    for the public interview flow.

Nothing here touches those modules' files — only imports what they already
expose.
"""
import re
import secrets
import string
import os
from datetime import datetime
from typing import Optional

from fastapi import UploadFile
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from models.models import User
from .models import Organisation, Candidate

# Reused, not reimplemented — see module docstring above.
from routers.jobhunt import _extract_text_from_file  # noqa: F401 — intentional reuse
from agents.jobhunt_agent import parse_resume_text


def _slugify(base: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-")
    return slug or "org"


async def get_or_create_default_organisation(db: AsyncSession, user: User) -> Organisation:
    """Every user gets exactly one personal Organisation, created lazily on
    first use. This is the Phase 0 tenant boundary — kept lazy/non-invasive
    on purpose so nothing in auth.py or the registration flow had to be
    touched to ship this capability. Real multi-user orgs (inviting
    teammates into the same organisation_id) can build on this later
    without another schema change.

    Race-safe: the Talent Pool page fires several requests concurrently on
    load (candidates, pools, organisation info), and on a BRAND NEW
    account every one of them lands here at once, all seeing "no
    organisation exists yet" before any of them has committed. The
    original check-then-insert pattern crashed with an unhandled
    IntegrityError on the losing request(s) — reported as a persistent
    500 on every acquisition endpoint. An earlier fix attempt caught that
    exception and called db.rollback() to recover in the same session,
    but that triggered a separate SQLAlchemy async driver issue
    (MissingGreenlet) when the flush had already failed — rollback-after-
    failed-flush is not reliably safe to chain within one request here.

    Fixed properly with a database-level atomic upsert instead: `INSERT
    ... ON CONFLICT (owner_user_id) DO NOTHING` (needs the unique index
    added in migrate_fix.py) either wins the race or silently no-ops —
    never raises for the case this was actually built to handle — and the
    row is then always fetched fresh by a plain SELECT afterward,
    regardless of which concurrent request's insert actually won.

    Also uses .scalars().first() rather than .scalar_one_or_none() on the
    initial check — the latter raises if more than one row somehow
    already exists (e.g. a pre-existing account affected by the race
    before this fix shipped), which would turn one bad historical row
    into a permanent 500 on every request forever. See migrate_fix.py for
    the one-time cleanup of any such existing duplicates."""
    existing = await db.execute(
        select(Organisation).where(Organisation.owner_user_id == user.id).order_by(Organisation.id.asc())
    )
    org = existing.scalars().first()
    if org:
        return org

    base_slug = _slugify(user.company or user.name or f"org-{user.id}")
    slug = base_slug
    suffix = 1
    while (await db.execute(select(Organisation).where(Organisation.public_apply_slug == slug))).scalars().first():
        suffix += 1
        slug = f"{base_slug}-{suffix}"

    await db.execute(
        text(
            "INSERT INTO tiq_organisations (name, owner_user_id, public_apply_slug, created_at) "
            "VALUES (:name, :owner_user_id, :slug, :created_at) "
            "ON CONFLICT (owner_user_id) DO NOTHING"
        ),
        {
            "name": user.company or user.name or "My Organisation",
            "owner_user_id": user.id,
            "slug": slug,
            "created_at": datetime.utcnow(),
        },
    )

    # Re-fetch regardless of whether OUR insert won or a concurrent
    # request's did — this always returns the single canonical row.
    result = await db.execute(
        select(Organisation).where(Organisation.owner_user_id == user.id).order_by(Organisation.id.asc())
    )
    org = result.scalars().first()
    if not org:
        raise RuntimeError(f"Failed to get or create an organisation for user {user.id}")
    return org


def generate_portal_token() -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(48))


def normalize_email(email: Optional[str]) -> str:
    return (email or "").strip().lower()


def normalize_phone(phone: Optional[str]) -> str:
    return re.sub(r"\D", "", phone or "")


async def find_candidate_duplicate(db: AsyncSession, organisation_id: int, email: str, phone: str,
                                     exclude_id: Optional[int] = None) -> Optional[Candidate]:
    """Organisation-wide duplicate check (deliberately broader scope than
    CandidateTrack's per-JD `_detect_duplicate` — the Candidate Master is
    meant to be the ONE record for a person across every requisition they
    ever apply to, so matching has to look across the whole organisation,
    not just one JD).

    Fine for single-candidate operations (create one candidate, apply via
    the career page). NOT used by bulk CSV/folder import — see
    load_candidate_dedup_index below for why."""
    norm_email = normalize_email(email)
    norm_phone = normalize_phone(phone)
    if not norm_email and not norm_phone:
        return None

    q = select(Candidate).where(
        Candidate.organisation_id == organisation_id,
        Candidate.is_merged.is_(False),
    )
    if exclude_id is not None:
        q = q.where(Candidate.id != exclude_id)

    candidates = (await db.execute(q)).scalars().all()
    for c in candidates:
        if norm_email and normalize_email(c.email) == norm_email:
            return c
        if norm_phone and normalize_phone(c.phone) == norm_phone:
            return c
    return None


# ── Bulk-import-safe duplicate detection ────────────────────────────────
# find_candidate_duplicate() above re-queries EVERY candidate in the
# organisation on every single call. That's fine for one row (create a
# candidate, apply via the career page) but ruinous for a 100-row CSV or
# folder import: 100 rows x (1 dedup query + 1 next-sequence query) = ~200
# extra round trips to the database. Against local SQLite that's invisible
# (sub-second); against a real remote Postgres (Neon) over the network,
# each round trip adds real latency, and 200 of them can comfortably blow
# past a 60-second client-side timeout — this was reported as "bulk import
# failed" / "csv import failed" with no server-side error at all, because
# the browser gave up waiting before the (still-succeeding) request
# finished. Fix: load everything ONCE, do all matching in memory.

async def load_candidate_dedup_index(db: AsyncSession, organisation_id: int) -> dict:
    """One query for the whole bulk operation. Returns a dict keyed by
    "email:<normalized>" / "phone:<normalized>" / "name:<normalized>" ->
    Candidate, for O(1) in-memory lookups instead of one database round
    trip per row.

    The name tier exists because a resume with no extractable email or
    phone (a real, common case — placeholder/dummy resumes, unusual
    formats, or just a badly-laid-out contact block the heuristic parser
    misses) used to skip duplicate detection ENTIRELY: bulk_folder_import
    only ever attempted a lookup "if email" was truthy at all, with no
    phone or name fallback. Every subsequent import of the same person's
    resume created a brand-new, mostly-empty candidate row instead of
    enriching the existing one — reported as "my candidate's current
    role/experience/skills/tags disappeared", when what actually happened
    is a second, hollow row for the same name got created and sorted
    above the original by recency. Name matching is naturally lower
    confidence than email/phone (two different people can share a name),
    so it's only consulted when neither of those match — see
    find_duplicate_in_index."""
    q = select(Candidate).where(Candidate.organisation_id == organisation_id, Candidate.is_merged.is_(False))
    candidates = (await db.execute(q)).scalars().all()
    index: dict = {}
    for c in candidates:
        e, p = normalize_email(c.email), normalize_phone(c.phone)
        if e:
            index[f"email:{e}"] = c
        if p:
            index[f"phone:{p}"] = c
        n = _normalize_name(c.full_name)
        if n:
            index.setdefault(f"name:{n}", c)  # first match wins if multiple candidates share a name
    return index


def _normalize_name(name: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (name or "").strip().lower())


def find_duplicate_in_index(index: dict, email: str, phone: str, full_name: str = "") -> Optional[Candidate]:
    e, p = normalize_email(email), normalize_phone(phone)
    if e and f"email:{e}" in index:
        return index[f"email:{e}"]
    if p and f"phone:{p}" in index:
        return index[f"phone:{p}"]
    n = _normalize_name(full_name)
    if n and f"name:{n}" in index:
        return index[f"name:{n}"]
    return None


def register_in_index(index: dict, candidate: Candidate) -> None:
    """Call after creating a candidate mid-batch, so two rows in the SAME
    import that match each other are still caught (not just matches
    against candidates that existed before the import started)."""
    e, p = normalize_email(candidate.email), normalize_phone(candidate.phone)
    if e:
        index[f"email:{e}"] = candidate
    if p:
        index[f"phone:{p}"] = candidate
    n = _normalize_name(candidate.full_name)
    if n:
        index.setdefault(f"name:{n}", candidate)


async def get_next_sequence_start(db: AsyncSession, organisation_id: int) -> int:
    """Same idea as the dedup index — call ONCE before a bulk loop, then
    increment a local counter per row instead of re-querying MAX() every
    single time."""
    r = await db.execute(select(func.max(Candidate.sequence_number)).where(Candidate.organisation_id == organisation_id))
    return (r.scalar() or 0) + 1


# ── Extended candidate-field extraction ─────────────────────────────────
# parse_resume_text() (reused from JobHunt, above) only ever extracts
# applicant_name/email/skills/experience_years — it has no concept of
# phone/location/current_title/current_employer/education/certifications
# at all, so apply_parsed_resume_to_candidate() had no data to put in
# those fields regardless of what overwrite was set to. This was reported
# as "uploaded resume isn't associated with the fields" — the resume WAS
# attached and its text WAS stored (resume_text), but nothing downstream
# ever attempted to read those specific fields out of it. These are
# heuristic (regex/keyword), same philosophy as the rest of this file and
# jobhunt_agent.parse_resume_text — best-effort, not a substitute for a
# recruiter reviewing the record afterward.

_PHONE_RE = re.compile(r"(\+?\d{1,4}[\s\-]?\(?\d{1,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{3,4})")

# Australian state/territory names + abbreviations — this deployment's
# primary market (see jobintel_simulator.py). A location line is matched
# case-insensitively against these; extend this list first if resumes
# from other regions need location extraction too.
_AU_LOCATION_RE = re.compile(
    r"([A-Za-z][A-Za-z\s]{2,30}\b(?:NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b(?:\s*\d{4})?"
    r"|(?:New South Wales|Victoria|Queensland|Western Australia|South Australia|Tasmania)\b)",
    re.IGNORECASE,
)

_EDUCATION_HEADERS = ("education", "academic background", "qualifications")
_CERTIFICATION_HEADERS = ("certifications", "certificates", "licenses", "licences")
_SECTION_HEADERS = (
    "education", "experience", "work experience", "employment history", "skills",
    "certifications", "certificates", "licenses", "licences", "projects", "summary",
    "profile", "references", "qualifications", "academic background", "achievements",
)


def _extract_phone(text: str) -> str:
    m = _PHONE_RE.search(text)
    if not m:
        return ""
    raw = m.group()
    # Same false-positive guard as joblens.extract_candidate_info: reject
    # bare digit runs (cert/reference numbers) that happen to be long
    # enough to match but have no phone-like separators.
    if not re.search(r"[\s\-+()]", raw):
        return ""
    return raw.replace(" ", "").strip()


def _extract_location(text: str) -> str:
    # Checked line-by-line (not the joined header block) — [A-Za-z\s]
    # in _AU_LOCATION_RE matches newlines too, so searching a multi-line
    # blob let the match wander across unrelated lines (e.g. picking up
    # "...Solutions\nSydney NSW" as one "location"). Only the first ~15
    # lines are checked — a location match deep in a work history entry
    # (e.g. "relocated the Sydney NSW office") is far less reliable than
    # one in the header/contact block.
    for line in text.splitlines()[:15]:
        m = _AU_LOCATION_RE.search(line)
        if m:
            return m.group().strip()
    return ""


def _extract_section(text: str, headers: tuple) -> str:
    """Grabs the text between a section heading (e.g. "Education") and the
    next recognised section heading (or end of document). Returns "" if no
    matching heading is found."""
    lines = text.splitlines()
    start = None
    for i, line in enumerate(lines):
        stripped = line.strip().lower().rstrip(":")
        if stripped in headers:
            start = i + 1
            break
    if start is None:
        return ""
    end = len(lines)
    for i in range(start, len(lines)):
        stripped = lines[i].strip().lower().rstrip(":")
        if stripped in _SECTION_HEADERS:
            end = i
            break
    section = "\n".join(l.strip() for l in lines[start:end] if l.strip())
    return section[:1000]  # generous cap — this lands in a Text column, but no reason to store megabytes


_TITLE_AT_EMPLOYER_RE = re.compile(r"^([A-Z][A-Za-z/&\s]{2,60}?)\s+(?:at|@)\s+([A-Z][A-Za-z0-9&.,\s]{2,60})$")


def _extract_current_title_and_employer(text: str) -> tuple[str, str]:
    """Best-effort: looks for the first LINE matching "<Title> at <Company>"
    (checked per-line, not across a joined multi-line block — see
    _extract_location for why that matters) in the top portion of the
    resume (the header/summary area, before any Experience section) — the
    most common place a candidate states their current role. Returns
    ("", "") if no confident match is found rather than guessing from
    noisy free text."""
    for line in text.splitlines()[:20]:
        m = _TITLE_AT_EMPLOYER_RE.match(line.strip())
        if m:
            return m.group(1).strip(), m.group(2).strip()
    return "", ""


def extract_extended_candidate_fields(text: str) -> dict:
    """Returns best-effort phone/location/current_title/current_employer/
    education/certifications extracted from resume text. Every value is ""
    when not confidently found — callers should treat empty string the
    same as "not extracted", not "confirmed blank"."""
    current_title, current_employer = _extract_current_title_and_employer(text)
    return {
        "phone": _extract_phone(text),
        "location": _extract_location(text),
        "current_title": current_title,
        "current_employer": current_employer,
        "education": _extract_section(text, _EDUCATION_HEADERS),
        "certifications": [
            line.lstrip("-•* \t") for line in _extract_section(text, _CERTIFICATION_HEADERS).splitlines() if line.strip()
        ],
    }


async def extract_and_parse_resume(file: UploadFile) -> dict:
    """Returns {"raw_text": str, "parsed": {...}} using the existing
    extraction + heuristic-parsing pipeline already proven in JobHunt,
    merged with the extended field extraction above (phone/location/
    current_title/current_employer/education/certifications) that
    JobHunt's parser doesn't attempt."""
    raw_text = await _extract_text_from_file(file)
    parsed = parse_resume_text(raw_text)
    parsed.update(extract_extended_candidate_fields(raw_text))
    return {"raw_text": raw_text, "parsed": parsed}


COVER_LETTER_ALLOWED_EXTENSIONS = (".pdf", ".docx", ".doc")


def validate_cover_letter_filetype(filename: Optional[str]) -> None:
    """Cover letters are accepted as PDF or Word only (not .txt) — a
    deliberately narrower list than resumes, since a cover letter is
    meant to be a formatted, presentable document."""
    name = (filename or "").lower()
    if not name.endswith(COVER_LETTER_ALLOWED_EXTENSIONS):
        from fastapi import HTTPException
        raise HTTPException(415, "Cover letter must be a PDF or Word document (.pdf, .docx, .doc).")


async def extract_cover_letter_text(file: UploadFile) -> str:
    """Reuses the same extraction pipeline as resumes (PyMuPDF/docx2txt) —
    just for the raw text, no heuristic parsing needed for a cover letter."""
    return await _extract_text_from_file(file)


def classify_document_and_basekey(filename: str) -> tuple[str, str]:
    """Used by the bulk folder import: classifies a file as a resume or a
    cover letter from its filename, and returns a normalized "base key" so
    a resume and its matching cover letter pair up even with different
    separators/casing — e.g. "John_Smith_Resume.pdf" and
    "John Smith - Cover Letter.docx" both normalize to "johnsmith".

    Best-effort by design: it's a filename heuristic, not content analysis.
    The bulk import result always reports what was actually paired so a
    recruiter can fix any mismatch by hand afterward.

    Critical: this strips to os.path.basename() FIRST. A folder ("Bulk
    Import Resumes/Cover Letters") upload via webkitdirectory sends the
    FULL relative path as filename — e.g.
    "Sample Resumes Coverletters/Nora Kumar Resume.pdf" — not just the
    file's own name. Classifying on the full path let the PARENT FOLDER
    NAME leak into the match: "Sample Resumes Coverletters" itself
    contains "coverletter" as a substring, so every single file inside
    that folder — resumes included — got misclassified as a cover letter,
    and the leftover path text produced a different "basekey" for each
    file, so a resume and its matching cover letter never paired into one
    candidate. Reported as: candidates named things like "Sample Resumes
    Coverletters/Nora Kumar Resume", split into two rows per person
    instead of one, with resumes never actually landing in the resume
    field (so contact/name/skills extraction — which only ever runs on
    the resume branch — silently never ran either)."""
    name = os.path.basename(filename).rsplit(".", 1)[0].lower()
    cover_markers = [
        "cover_letter", "cover-letter", "cover letter", "coverletter",
        "covering_letter", "covering-letter", "covering letter",
    ]
    resume_markers = ["resume", "_cv", "-cv", " cv", "curriculum_vitae", "curriculum-vitae"]

    kind = "resume"  # bare filenames with no marker default to resume — the more common case
    basekey = name
    for m in cover_markers:
        if m in name:
            kind = "cover_letter"
            basekey = name.replace(m, "")
            break
    else:
        for m in resume_markers:
            if m in name:
                basekey = name.replace(m, "")
                break

    basekey_norm = re.sub(r"[^a-z0-9]+", "", basekey)
    return kind, basekey_norm or name


def apply_parsed_resume_to_candidate(candidate: Candidate, parsed: dict, raw_text: str, overwrite: bool = False) -> None:
    """Fills empty Candidate Master fields from a parsed resume — never
    clobbers data a recruiter already entered unless overwrite=True.

    parsed is expected to be the merged dict extract_and_parse_resume()
    returns (JobHunt's basic parse + extract_extended_candidate_fields).
    Previously this only ever read applicant_name/email/skills/
    experience_years — phone/location/current_title/current_employer/
    education/certifications were extracted nowhere upstream, so a resume
    could be fully attached (resume_blob + resume_text both saved) while
    every one of those fields stayed blank. That's what "uploaded resume
    isn't associated with the fields" meant in practice."""
    if (overwrite or not candidate.full_name) and parsed.get("applicant_name"):
        candidate.full_name = parsed["applicant_name"]
    if (overwrite or not candidate.email) and parsed.get("email"):
        candidate.email = parsed["email"]
    if (overwrite or not candidate.skills) and parsed.get("skills"):
        merged = list(dict.fromkeys((candidate.skills or []) + parsed["skills"]))
        candidate.skills = merged
    if (overwrite or not candidate.total_experience_years) and parsed.get("experience_years"):
        candidate.total_experience_years = str(parsed["experience_years"])
    if (overwrite or not candidate.phone) and parsed.get("phone"):
        candidate.phone = parsed["phone"]
    if (overwrite or not candidate.location) and parsed.get("location"):
        candidate.location = parsed["location"]
    if (overwrite or not candidate.current_title) and parsed.get("current_title"):
        candidate.current_title = parsed["current_title"]
    if (overwrite or not candidate.current_employer) and parsed.get("current_employer"):
        candidate.current_employer = parsed["current_employer"]
    if (overwrite or not candidate.education) and parsed.get("education"):
        candidate.education = parsed["education"]
    if (overwrite or not candidate.certifications) and parsed.get("certifications"):
        merged_certs = list(dict.fromkeys((candidate.certifications or []) + parsed["certifications"]))
        candidate.certifications = merged_certs
    candidate.resume_text = raw_text
    candidate.last_activity_at = datetime.utcnow()


def merge_snapshot(candidate: Candidate) -> dict:
    """Full field snapshot of a candidate, used as the CandidateMergeLog
    audit record before it's merged away."""
    return {
        "full_name": candidate.full_name, "email": candidate.email, "phone": candidate.phone,
        "location": candidate.location, "linkedin_url": candidate.linkedin_url,
        "current_employer": candidate.current_employer, "current_title": candidate.current_title,
        "skills": candidate.skills, "tags": candidate.tags, "source": candidate.source,
        "notes": candidate.notes, "status": candidate.status,
        "created_at": candidate.created_at.isoformat() if candidate.created_at else None,
    }
