"""
TalentIQ — Capability: Candidate Acquisition & Talent Pool (PUBLIC, no auth)

Two unauthenticated surfaces:
  1. Career page + "Apply Now"  — /api/public/careers/{slug}[/apply]
     The first real inbound candidate channel TalentIQ has — everything
     else (LinkLens, JobHunt scraping, manual entry) is recruiter-initiated.
  2. Candidate self-service portal — /api/public/my-profile/{token}
     Token-based, no separate candidate login system, mirroring the
     already-proven JobLensCandidate.interview_token pattern used for the
     public interview flow.

Registered in main.py as: /api/public/acquisition/*
Deliberately a SEPARATE router from router.py (which requires auth) so the
authenticated/public boundary is enforced by which router a route lives
in, not by scattered per-endpoint checks.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from db.database import get_db
from models.models import JDRecord, JD_STATUSES

from .models import Organisation, Candidate, Application
from . import service

router = APIRouter()


@router.get("/careers/{slug}")
async def career_page_info(slug: str, db: AsyncSession = Depends(get_db)):
    """Powers the public careers page: org display name + any currently
    open roles (read-only reuse of the existing JD Management system —
    nothing there is modified)."""
    org = (await db.execute(select(Organisation).where(Organisation.public_apply_slug == slug))).scalar_one_or_none()
    if not org:
        raise HTTPException(404, "This careers page does not exist.")

    open_jds = (await db.execute(
        select(JDRecord.id, JDRecord.title)
        .where(JDRecord.user_id == org.owner_user_id, JDRecord.status == "Open")
        .order_by(JDRecord.created_at.desc())
    )).all()

    return {
        "organisation_name": org.name,
        "open_roles": [{"id": r.id, "title": r.title} for r in open_jds],
    }


@router.post("/careers/{slug}/apply")
async def submit_application(
    slug: str,
    full_name: str = Form(...),
    email: str = Form(...),
    phone: str = Form(""),
    location: str = Form(""),
    role_of_interest: str = Form(""),
    jd_record_id: Optional[int] = Form(None),
    consent_given: bool = Form(True),
    resume: Optional[UploadFile] = File(None),
    cover_letter_file: Optional[UploadFile] = File(None),
    cover_letter_text: str = Form(""),
    db: AsyncSession = Depends(get_db),
):
    """Creates (or reuses, if this person already exists in the
    organisation) a Candidate Master row, and — if a specific open role was
    selected — an Application linking them to that JD. A returning
    candidate applying to a second role is exactly the case the
    Candidate ⇄ Application model exists for: no duplicate person record."""
    org = (await db.execute(select(Organisation).where(Organisation.public_apply_slug == slug))).scalar_one_or_none()
    if not org:
        raise HTTPException(404, "This careers page does not exist.")
    if not full_name.strip() or not email.strip():
        raise HTTPException(400, "Name and email are required.")

    if jd_record_id:
        jd = (await db.execute(select(JDRecord).where(
            JDRecord.id == jd_record_id, JDRecord.user_id == org.owner_user_id, JDRecord.status == "Open"
        ))).scalar_one_or_none()
        if not jd:
            raise HTTPException(404, "That role is no longer open.")

    candidate = await service.find_candidate_duplicate(db, org.id, email, phone)
    is_new = candidate is None
    if not candidate:
        r = await db.execute(select(func.max(Candidate.sequence_number)).where(Candidate.organisation_id == org.id))
        candidate = Candidate(
            organisation_id=org.id, owner_user_id=org.owner_user_id,
            sequence_number=(r.scalar() or 0) + 1,
            full_name=full_name.strip(), email=email.strip(), phone=phone.strip(), location=location.strip(),
            source="career_page", status="Active",
        )
        db.add(candidate)
        await db.flush()

    candidate.consent_given = consent_given or candidate.consent_given
    if consent_given and not candidate.consent_at:
        candidate.consent_at = datetime.utcnow()
    candidate.last_activity_at = datetime.utcnow()
    if role_of_interest:
        note = f"[{datetime.utcnow().date()}] Applied via careers page — interested in: {role_of_interest}"
        candidate.notes = (candidate.notes + "\n" + note) if candidate.notes else note

    if resume and resume.filename:
        parsed = await service.extract_and_parse_resume(resume)
        await resume.seek(0)
        candidate.resume_blob = await resume.read()
        candidate.resume_filename = resume.filename
        candidate.resume_mimetype = resume.content_type or "application/octet-stream"
        service.apply_parsed_resume_to_candidate(candidate, parsed["parsed"], parsed["raw_text"])

    if cover_letter_file and cover_letter_file.filename:
        service.validate_cover_letter_filetype(cover_letter_file.filename)
        extracted = await service.extract_cover_letter_text(cover_letter_file)
        await cover_letter_file.seek(0)
        candidate.cover_letter_blob = await cover_letter_file.read()
        candidate.cover_letter_filename = cover_letter_file.filename
        candidate.cover_letter_mimetype = cover_letter_file.content_type or "application/octet-stream"
        candidate.cover_letter_text = extracted
    elif cover_letter_text.strip():
        candidate.cover_letter_text = cover_letter_text.strip()

    if not candidate.portal_token:
        candidate.portal_token = service.generate_portal_token()

    application_created = False
    if jd_record_id:
        existing_app = (await db.execute(select(Application).where(
            Application.candidate_id == candidate.id, Application.jd_record_id == jd_record_id
        ))).scalar_one_or_none()
        if not existing_app:
            db.add(Application(
                organisation_id=org.id, candidate_id=candidate.id, jd_record_id=jd_record_id,
                source="career_page", stage="New",
            ))
            application_created = True

    await db.commit()
    return {
        "status": "submitted",
        "is_new_candidate": is_new,
        "application_created": application_created,
        "portal_url_path": f"/my-profile/{candidate.portal_token}",
        "message": "Thanks — we've received your application." if is_new else
                    "Thanks — we've updated your profile with this new application.",
    }


# ══════════════════════════════════════════════════════════════════════════
# CANDIDATE SELF-SERVICE PORTAL (token-based)
# ══════════════════════════════════════════════════════════════════════════

def _fmt_self(c: Candidate) -> dict:
    return {
        "full_name": c.full_name, "email": c.email or "", "phone": c.phone or "",
        "location": c.location or "", "linkedin_url": c.linkedin_url or "",
        "portfolio_url": c.portfolio_url or "", "current_title": c.current_title or "",
        "current_employer": c.current_employer or "", "skills": c.skills or [],
        "availability": c.availability or "", "notice_period_days": c.notice_period_days,
        "preferred_locations": c.preferred_locations or [],
        "preferred_employment_type": c.preferred_employment_type or "",
        "has_resume": bool(c.resume_blob), "resume_filename": c.resume_filename or "",
        "has_cover_letter": bool(c.cover_letter_blob or c.cover_letter_text),
        "cover_letter_filename": c.cover_letter_filename or "",
        "cover_letter_text": c.cover_letter_text or "",
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


async def _get_by_token(db: AsyncSession, token: str) -> Candidate:
    c = (await db.execute(select(Candidate).where(Candidate.portal_token == token, Candidate.is_merged.is_(False)))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Invalid or expired profile link.")
    return c


@router.get("/my-profile/{token}")
async def view_my_profile(token: str, db: AsyncSession = Depends(get_db)):
    c = await _get_by_token(db, token)
    return _fmt_self(c)


@router.put("/my-profile/{token}")
async def update_my_profile(
    token: str,
    phone: Optional[str] = Form(None),
    location: Optional[str] = Form(None),
    linkedin_url: Optional[str] = Form(None),
    portfolio_url: Optional[str] = Form(None),
    availability: Optional[str] = Form(None),
    notice_period_days: Optional[int] = Form(None),
    preferred_employment_type: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """Candidates can keep their own contact/availability details current —
    deliberately scoped to logistics fields only, not identity fields
    (name/email) or anything a recruiter uses for scoring, to avoid a
    candidate silently altering data recruiters are relying on."""
    c = await _get_by_token(db, token)
    for field, value in [
        ("phone", phone), ("location", location), ("linkedin_url", linkedin_url),
        ("portfolio_url", portfolio_url), ("availability", availability),
        ("notice_period_days", notice_period_days), ("preferred_employment_type", preferred_employment_type),
    ]:
        if value is not None:
            setattr(c, field, value)
    c.updated_at = datetime.utcnow()
    c.last_activity_at = datetime.utcnow()
    await db.commit()
    return _fmt_self(c)


@router.post("/my-profile/{token}/resume")
async def update_my_resume(token: str, file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    c = await _get_by_token(db, token)
    parsed = await service.extract_and_parse_resume(file)
    await file.seek(0)
    c.resume_blob = await file.read()
    c.resume_filename = file.filename
    c.resume_mimetype = file.content_type or "application/octet-stream"
    service.apply_parsed_resume_to_candidate(c, parsed["parsed"], parsed["raw_text"])
    await db.commit()
    return _fmt_self(c)


@router.post("/my-profile/{token}/cover-letter")
async def update_my_cover_letter_file(token: str, file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    c = await _get_by_token(db, token)
    service.validate_cover_letter_filetype(file.filename)
    extracted = await service.extract_cover_letter_text(file)
    await file.seek(0)
    c.cover_letter_blob = await file.read()
    c.cover_letter_filename = file.filename
    c.cover_letter_mimetype = file.content_type or "application/octet-stream"
    c.cover_letter_text = extracted
    c.updated_at = datetime.utcnow()
    await db.commit()
    return _fmt_self(c)


@router.put("/my-profile/{token}/cover-letter/text")
async def update_my_cover_letter_text(token: str, text: str = Form(""), db: AsyncSession = Depends(get_db)):
    c = await _get_by_token(db, token)
    c.cover_letter_text = text.strip() or None
    c.updated_at = datetime.utcnow()
    await db.commit()
    return _fmt_self(c)
