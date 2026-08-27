"""
TalentIQ — Capability: Candidate Acquisition & Talent Pool (authenticated)

Every endpoint here is organisation-scoped (Phase 0 tenant boundary) and
works completely on its own — it does not require Requisition, Screening,
Interview, or Pipeline to exist. See models.py module docstring for the
architecture rationale.

Registered in main.py as: /api/acquisition/*
"""
import csv
import io
import os
import re
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete as sa_delete, update as sa_update
from sqlalchemy.orm import defer

from db.database import get_db
from models.models import User
from utils.auth_utils import get_current_user
from capabilities.interview.models import Interview
from capabilities.pipeline.models import PipelineEntry, Offer, Placement
from capabilities.requisition.models import Requisition

from .models import (
    Organisation, Candidate, TalentPool, CandidatePoolMember, CandidateMergeLog, Application,
    CANDIDATE_MASTER_STATUSES,
)
from .schemas import (
    CandidateCreate, CandidateUpdate, TalentPoolCreate, PoolMembershipRequest,
    MergeRequest, BulkIds,
)
from . import service

router = APIRouter()


async def _org(db: AsyncSession, user: User) -> Organisation:
    return await service.get_or_create_default_organisation(db, user)


def _fmt_candidate(
    c: Candidate,
    pool_names: Optional[List[str]] = None,
    has_resume: Optional[bool] = None,
    has_cover_letter: Optional[bool] = None,
    applications: Optional[List[dict]] = None,
) -> dict:
    """has_resume/has_cover_letter can be passed in pre-computed (see
    list_candidates) so this never has to touch the deferred resume_blob/
    cover_letter_blob columns — accessing a deferred column on an async
    session outside its original query would trigger an implicit lazy
    load, which async SQLAlchemy doesn't support without an explicit
    await (raises MissingGreenlet). When not provided (single-candidate
    endpoints, where the blob was loaded normally), falls back to
    checking the object directly."""
    return {
        "id": c.id,
        "sequence_number": c.sequence_number,
        "full_name": c.full_name,
        "email": c.email or "",
        "phone": c.phone or "",
        "location": c.location or "",
        "linkedin_url": c.linkedin_url or "",
        "portfolio_url": c.portfolio_url or "",
        "current_employer": c.current_employer or "",
        "current_title": c.current_title or "",
        "total_experience_years": c.total_experience_years or "",
        "skills": c.skills or [],
        "education": c.education or "",
        "certifications": c.certifications or [],
        "work_rights": c.work_rights or "",
        "salary_expectation": c.salary_expectation or "",
        "notice_period_days": c.notice_period_days,
        "preferred_locations": c.preferred_locations or [],
        "preferred_employment_type": c.preferred_employment_type or "",
        "availability": c.availability or "",
        "source": c.source or "manual",
        "referral_source": c.referral_source or "",
        "status": c.status or "Active",
        "tags": c.tags or [],
        "consent_given": bool(c.consent_given),
        "consent_at": c.consent_at.isoformat() if c.consent_at else None,
        "has_resume": bool(c.resume_blob) if has_resume is None else has_resume,
        "resume_filename": c.resume_filename or "",
        "has_cover_letter": (bool(c.cover_letter_blob or c.cover_letter_text) if has_cover_letter is None
                              else (has_cover_letter or bool(c.cover_letter_text))),
        "cover_letter_filename": c.cover_letter_filename or "",
        "cover_letter_text": c.cover_letter_text or "",
        "notes": c.notes or "",
        "pools": pool_names or [],
        # Which open (or any-status) requisitions this candidate has been
        # formally submitted to — see _applications_for_many. Empty list
        # means "not an applicant to anything yet", same distinction the
        # Requisitions table's Applications count relies on: existing in
        # Talent Pool is not the same as having applied.
        "applications": applications or [],
        "portal_token": c.portal_token,
        "is_merged": c.is_merged,
        "merged_into_id": c.merged_into_id,
        "last_activity_at": c.last_activity_at.isoformat() if c.last_activity_at else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


async def _next_sequence(db: AsyncSession, organisation_id: int) -> int:
    r = await db.execute(select(func.max(Candidate.sequence_number)).where(Candidate.organisation_id == organisation_id))
    return (r.scalar() or 0) + 1


async def _blocking_hiring_activity_refs(db: AsyncSession, candidate_id: int) -> str:
    """Returns a human-readable reason a candidate can't be deleted, or ""
    if it's clear. Interviews, pipeline entries, offers, and placements
    are real hiring-activity records (including, for placements,
    financial/fee history) — deleting the Candidate Master row out from
    under them would either silently orphan that history or crash
    outright with a raw Postgres FK violation, same class of bug as
    capabilities.requisition.router._blocking_requisition_refs (see that
    docstring — confirmed live before this fix existed)."""
    interview_count = (await db.execute(select(func.count()).select_from(Interview).where(Interview.candidate_id == candidate_id))).scalar() or 0
    pipeline_count = (await db.execute(select(func.count()).select_from(PipelineEntry).where(PipelineEntry.candidate_id == candidate_id))).scalar() or 0
    offer_count = (await db.execute(select(func.count()).select_from(Offer).where(Offer.candidate_id == candidate_id))).scalar() or 0
    placement_count = (await db.execute(select(func.count()).select_from(Placement).where(Placement.candidate_id == candidate_id))).scalar() or 0
    if interview_count or pipeline_count or offer_count or placement_count:
        parts = []
        if pipeline_count:
            parts.append(f"{pipeline_count} pipeline entr{'y' if pipeline_count == 1 else 'ies'}")
        if interview_count:
            parts.append(f"{interview_count} interview(s)")
        if offer_count:
            parts.append(f"{offer_count} offer(s)")
        if placement_count:
            parts.append(f"{placement_count} placement(s)")
        return f"Cannot delete this candidate — they still have {' and '.join(parts)} on record. Remove those first."
    return ""


async def _clear_merge_references(db: AsyncSession, candidate_id: int) -> None:
    """Clears every foreign-key reference to this candidate that would
    otherwise make deleting it fail with a Postgres FK violation.

    Neither CandidateMergeLog.primary_candidate_id/merged_candidate_id nor
    Candidate.merged_into_id have cascade-delete behavior (by design — a
    merge log is meant to survive as history). That's fine right up until
    someone tries to delete a candidate that was ever on either side of a
    merge: the DELETE gets rejected outright with an IntegrityError. This
    was reported as "delete does nothing, tried it many times" — the
    request WAS failing, just as an uncaught 500 the UI gave no feedback
    for (see the frontend fix in AcquisitionPage.tsx's handleDelete/
    handleBulkDelete for the other half of this).

    Called right before every candidate delete (single or bulk): drops any
    CandidateMergeLog rows mentioning this candidate on EITHER side (the
    audit trail can't reference a row that no longer exists either way),
    and un-points any other candidate's merged_into_id if it pointed here.

    The merged_into_id UPDATE is guarded behind a cheap existence check
    first (was_merge_primary, below) rather than run unconditionally: it
    filters on Candidate.merged_into_id, and IF that column's index hasn't
    actually been created yet on this database (see migrate_fix.py — an
    ALTER-added column's ORM index=True only takes effect once the
    matching CREATE INDEX statement has actually run, which requires an
    app restart), that UPDATE becomes a full sequential scan of the ENTIRE
    candidates table on every single delete. Reported as "taking too long
    to delete" — the delete wasn't rejected, it was just very slow before
    eventually timing out client-side. The vast majority of candidates
    were never a merge survivor, so this check (indexed regardless — see
    below) skips the expensive UPDATE entirely for the common case,
    bounding the damage even before that index fix has been deployed.
    """
    # CandidateMergeLog.primary_candidate_id has been indexed since this
    # table's creation (via create_all(), not an ALTER-added column like
    # Candidate.merged_into_id below), so this check is cheap regardless
    # of migration/restart state.
    was_merge_primary = (await db.execute(
        select(func.count()).select_from(CandidateMergeLog).where(CandidateMergeLog.primary_candidate_id == candidate_id)
    )).scalar()

    await db.execute(
        sa_delete(CandidateMergeLog).where(
            (CandidateMergeLog.primary_candidate_id == candidate_id)
            | (CandidateMergeLog.merged_candidate_id == candidate_id)
        )
    )
    if was_merge_primary:
        await db.execute(
            sa_update(Candidate).where(Candidate.merged_into_id == candidate_id).values(merged_into_id=None)
        )


async def _pool_names_for(db: AsyncSession, candidate_id: int) -> List[str]:
    r = await db.execute(
        select(TalentPool.name)
        .join(CandidatePoolMember, CandidatePoolMember.pool_id == TalentPool.id)
        .where(CandidatePoolMember.candidate_id == candidate_id)
    )
    return [row[0] for row in r.all()]


async def _pool_names_for_many(db: AsyncSession, candidate_ids: List[int]) -> dict:
    """Batched version of _pool_names_for — one query for the whole page
    of candidates instead of one query PER candidate. The list endpoint
    used to call _pool_names_for in a loop (N sequential DB round-trips
    for N candidates), which is fine for a handful of rows but makes the
    Talent Pool page take minutes — or feel permanently stuck loading —
    once an org has a few hundred candidates."""
    if not candidate_ids:
        return {}
    r = await db.execute(
        select(CandidatePoolMember.candidate_id, TalentPool.name)
        .join(TalentPool, CandidatePoolMember.pool_id == TalentPool.id)
        .where(CandidatePoolMember.candidate_id.in_(candidate_ids))
    )
    out: dict = {cid: [] for cid in candidate_ids}
    for cid, name in r.all():
        out[cid].append(name)
    return out


async def _applications_for_many(db: AsyncSession, candidate_ids: List[int]) -> dict:
    """Batched, same reasoning as _pool_names_for_many: one query for the
    whole page of candidates rather than one per candidate. Existing in
    Talent Pool is NOT the same as having applied — this only returns
    requisitions the candidate has an actual Application row for (created
    by pipeline.submit_to_pipeline), which is also what the Requisitions
    table's Applications count reads from, so the two can never disagree
    with each other."""
    if not candidate_ids:
        return {}
    r = await db.execute(
        select(Application.candidate_id, Requisition.id, Requisition.sequence_number, Requisition.title)
        .join(Requisition, Application.requisition_id == Requisition.id)
        .where(Application.candidate_id.in_(candidate_ids))
        .order_by(Requisition.sequence_number)
    )
    out: dict = {cid: [] for cid in candidate_ids}
    for cid, req_id, seq, title in r.all():
        out[cid].append({"requisition_id": req_id, "sequence_number": seq, "title": title})
    return out


# ══════════════════════════════════════════════════════════════════════════
# ORGANISATION / CAREER PAGE LINK
# ══════════════════════════════════════════════════════════════════════════

@router.get("/organisation")
async def get_my_organisation(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    await db.commit()
    return {"id": org.id, "name": org.name, "public_apply_slug": org.public_apply_slug,
            "apply_url_path": f"/careers/{org.public_apply_slug}"}


# ══════════════════════════════════════════════════════════════════════════
# CANDIDATE MASTER — CRUD
# ══════════════════════════════════════════════════════════════════════════

@router.post("/candidates")
async def create_candidate(
    payload: CandidateCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not payload.full_name.strip():
        raise HTTPException(400, "Full name is required.")
    org = await _org(db, current_user)

    dup = await service.find_candidate_duplicate(db, org.id, payload.email, payload.phone)
    if dup:
        raise HTTPException(
            409,
            f"A candidate with this email/phone already exists (#{dup.sequence_number} — {dup.full_name}). "
            f"Use the merge endpoint if this is the same person, or edit the existing record instead.",
        )

    candidate = Candidate(
        organisation_id=org.id,
        owner_user_id=current_user.id,
        sequence_number=await _next_sequence(db, org.id),
        full_name=payload.full_name.strip(),
        email=payload.email.strip(),
        phone=payload.phone.strip(),
        location=payload.location.strip(),
        linkedin_url=payload.linkedin_url.strip(),
        portfolio_url=payload.portfolio_url.strip(),
        current_employer=payload.current_employer.strip(),
        current_title=payload.current_title.strip(),
        total_experience_years=payload.total_experience_years.strip(),
        skills=payload.skills,
        education=payload.education.strip(),
        certifications=payload.certifications,
        work_rights=payload.work_rights.strip(),
        salary_expectation=payload.salary_expectation.strip(),
        notice_period_days=payload.notice_period_days,
        preferred_locations=payload.preferred_locations,
        preferred_employment_type=payload.preferred_employment_type.strip(),
        availability=payload.availability.strip(),
        source=payload.source or "manual",
        referral_source=payload.referral_source.strip(),
        tags=payload.tags,
        notes=payload.notes.strip(),
        consent_given=payload.consent_given,
        consent_at=datetime.utcnow() if payload.consent_given else None,
        cover_letter_text=payload.cover_letter_text.strip() or None,
        status="Active",
        last_activity_at=datetime.utcnow(),
    )
    db.add(candidate)
    await db.commit()
    await db.refresh(candidate)
    return _fmt_candidate(candidate)


@router.get("/candidates")
async def list_candidates(
    search: Optional[str] = None,
    status: Optional[str] = None,
    source: Optional[str] = None,
    pool_id: Optional[int] = None,
    tag: Optional[str] = None,
    has_files: Optional[bool] = None,
    unlinked_only: Optional[bool] = None,
    include_merged: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org = await _org(db, current_user)
    # defer(resume_blob)/defer(cover_letter_blob): the list view never needs
    # the raw file bytes (only a has_resume/has_cover_letter boolean — see
    # _fmt_candidate), but a plain select(Candidate) fetches every column
    # including these, transferring every uploaded resume/cover-letter's
    # full binary content on every single list load. Fine with a handful of
    # test rows; makes the whole page feel stuck once real resumes pile up.
    # The two flags are computed server-side instead (IS NOT NULL, below) —
    # zero bytes of file content ever leave Postgres for this endpoint.
    q = (
        select(Candidate)
        .options(defer(Candidate.resume_blob), defer(Candidate.cover_letter_blob))
        .where(Candidate.organisation_id == org.id)
    )
    if not include_merged:
        q = q.where(Candidate.is_merged.is_(False))
    if status:
        q = q.where(Candidate.status == status)
    if source:
        q = q.where(Candidate.source == source)
    if pool_id:
        q = q.join(CandidatePoolMember, CandidatePoolMember.candidate_id == Candidate.id).where(
            CandidatePoolMember.pool_id == pool_id
        )
    if has_files is True:
        # IS NOT NULL check only — never touches the actual bytes (the blob
        # columns stay deferred above), same reasoning as the has_resume/
        # has_cover_letter flags. Lets a recruiter isolate exactly the
        # candidates with a resume/cover letter attached — e.g. to review
        # and bulk-delete leftover fragments from an earlier bad import —
        # without scrolling through every candidate in the organisation.
        q = q.where(Candidate.resume_blob.isnot(None) | Candidate.cover_letter_blob.isnot(None))
    elif has_files is False:
        q = q.where(Candidate.resume_blob.is_(None), Candidate.cover_letter_blob.is_(None))
    if unlinked_only:
        # Genuinely orphaned files, not just "has a resume" — a candidate
        # whose ONLY reason for existing is bulk_folder_import auto-creating
        # a row for a file it couldn't match to anyone already on file (see
        # bulk_folder_import's docstring). A CSV-imported or manually-added
        # candidate who happens to also have a resume attached is a real
        # profile, not a leftover fragment, and correctly stays out of this.
        q = q.where(
            Candidate.source == "bulk_folder_import",
            Candidate.resume_blob.isnot(None) | Candidate.cover_letter_blob.isnot(None),
        )
    q = q.order_by(Candidate.created_at.desc())
    rows = (await db.execute(q)).scalars().all()

    # Apply the in-memory search/tag filters first so we only batch-fetch
    # pool names/file-flags for the rows we're actually going to return.
    filtered = []
    for c in rows:
        if search and search.lower() not in (c.full_name or "").lower() and search.lower() not in (c.email or "").lower():
            continue
        if tag and tag not in (c.tags or []):
            continue
        filtered.append(c)

    candidate_ids = [c.id for c in filtered]
    pool_names_by_candidate = await _pool_names_for_many(db, candidate_ids)
    applications_by_candidate = await _applications_for_many(db, candidate_ids)
    file_flags_by_id: dict = {}
    if candidate_ids:
        flags_result = await db.execute(
            select(
                Candidate.id,
                Candidate.resume_blob.isnot(None),
                Candidate.cover_letter_blob.isnot(None),
            ).where(Candidate.id.in_(candidate_ids))
        )
        file_flags_by_id = {cid: (has_resume, has_cl) for cid, has_resume, has_cl in flags_result.all()}

    out = []
    for c in filtered:
        has_resume, has_cl = file_flags_by_id.get(c.id, (False, False))
        out.append(_fmt_candidate(c, pool_names_by_candidate.get(c.id, []), has_resume, has_cl, applications_by_candidate.get(c.id, [])))
    await db.commit()
    return out


@router.get("/candidates/{candidate_id}")
async def get_candidate(candidate_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    c = (await db.execute(select(Candidate).where(Candidate.id == candidate_id, Candidate.organisation_id == org.id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Candidate not found")
    return _fmt_candidate(c, await _pool_names_for(db, c.id), applications=(await _applications_for_many(db, [c.id])).get(c.id, []))


@router.put("/candidates/{candidate_id}")
async def update_candidate(
    candidate_id: int,
    payload: CandidateUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org = await _org(db, current_user)
    c = (await db.execute(select(Candidate).where(Candidate.id == candidate_id, Candidate.organisation_id == org.id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Candidate not found")
    if payload.status and payload.status not in CANDIDATE_MASTER_STATUSES:
        raise HTTPException(400, f"Status must be one of: {', '.join(CANDIDATE_MASTER_STATUSES)}")

    data = payload.dict(exclude_unset=True)
    for field, value in data.items():
        if field == "consent_given" and value and not c.consent_given:
            c.consent_at = datetime.utcnow()
        setattr(c, field, value)
    c.updated_at = datetime.utcnow()
    c.last_activity_at = datetime.utcnow()
    await db.commit()
    await db.refresh(c)
    return _fmt_candidate(c, await _pool_names_for(db, c.id))


@router.delete("/candidates/{candidate_id}")
async def delete_candidate(candidate_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    c = (await db.execute(select(Candidate).where(Candidate.id == candidate_id, Candidate.organisation_id == org.id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Candidate not found")
    reason = await _blocking_hiring_activity_refs(db, candidate_id)
    if reason:
        raise HTTPException(400, reason)
    await _clear_merge_references(db, candidate_id)
    await db.delete(c)
    await db.commit()
    return {"deleted": True}


@router.post("/candidates/{candidate_id}/resume")
async def upload_candidate_resume(
    candidate_id: int,
    file: UploadFile = File(...),
    overwrite_fields: bool = Form(False),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Attaches/replaces a resume on an existing Candidate Master row and
    auto-fills empty profile fields from it — reuses the same extraction +
    heuristic-parsing pipeline as JobHunt."""
    org = await _org(db, current_user)
    c = (await db.execute(select(Candidate).where(Candidate.id == candidate_id, Candidate.organisation_id == org.id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Candidate not found")

    content_result = await service.extract_and_parse_resume(file)
    await file.seek(0)
    c.resume_blob = await file.read()
    c.resume_filename = file.filename
    c.resume_mimetype = file.content_type or "application/octet-stream"
    service.apply_parsed_resume_to_candidate(c, content_result["parsed"], content_result["raw_text"], overwrite=overwrite_fields)

    await db.commit()
    await db.refresh(c)
    return _fmt_candidate(c, await _pool_names_for(db, c.id))


@router.get("/candidates/{candidate_id}/resume")
async def download_candidate_resume(candidate_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from fastapi.responses import Response
    org = await _org(db, current_user)
    c = (await db.execute(select(Candidate).where(Candidate.id == candidate_id, Candidate.organisation_id == org.id))).scalar_one_or_none()
    if not c or not c.resume_blob:
        raise HTTPException(404, "No resume on file for this candidate")
    return Response(
        content=c.resume_blob, media_type=c.resume_mimetype or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{c.resume_filename or "resume"}"'},
    )


@router.post("/candidates/{candidate_id}/cover-letter")
async def upload_candidate_cover_letter(
    candidate_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """PDF or Word only (see service.COVER_LETTER_ALLOWED_EXTENSIONS). Text
    is auto-extracted into cover_letter_text alongside the stored file, so
    it's searchable/previewable the same way a typed cover letter is."""
    org = await _org(db, current_user)
    c = (await db.execute(select(Candidate).where(Candidate.id == candidate_id, Candidate.organisation_id == org.id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Candidate not found")
    service.validate_cover_letter_filetype(file.filename)

    extracted_text = await service.extract_cover_letter_text(file)
    await file.seek(0)
    c.cover_letter_blob = await file.read()
    c.cover_letter_filename = file.filename
    c.cover_letter_mimetype = file.content_type or "application/octet-stream"
    c.cover_letter_text = extracted_text
    c.updated_at = datetime.utcnow()
    c.last_activity_at = datetime.utcnow()

    await db.commit()
    await db.refresh(c)
    return _fmt_candidate(c, await _pool_names_for(db, c.id))


@router.put("/candidates/{candidate_id}/cover-letter/text")
async def set_candidate_cover_letter_text(
    candidate_id: int,
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Sets/replaces a typed cover letter. Body: {"text": "..."}. Typing
    text does not clear a previously uploaded file — download still returns
    the file if one exists; this only updates the text shown/searched."""
    org = await _org(db, current_user)
    c = (await db.execute(select(Candidate).where(Candidate.id == candidate_id, Candidate.organisation_id == org.id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Candidate not found")
    text = (payload.get("text") or "").strip()
    c.cover_letter_text = text or None
    c.updated_at = datetime.utcnow()
    c.last_activity_at = datetime.utcnow()
    await db.commit()
    await db.refresh(c)
    return _fmt_candidate(c, await _pool_names_for(db, c.id))


@router.get("/candidates/{candidate_id}/cover-letter")
async def download_candidate_cover_letter(candidate_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from fastapi.responses import Response
    org = await _org(db, current_user)
    c = (await db.execute(select(Candidate).where(Candidate.id == candidate_id, Candidate.organisation_id == org.id))).scalar_one_or_none()
    if not c or not c.cover_letter_blob:
        raise HTTPException(404, "No cover letter file on record for this candidate — it may only have typed text.")
    return Response(
        content=c.cover_letter_blob, media_type=c.cover_letter_mimetype or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{c.cover_letter_filename or "cover_letter"}"'},
    )


@router.post("/candidates/csv-import")
async def csv_import_candidates(
    file: UploadFile = File(...),
    source: str = Form("csv_import"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Expects a CSV with headers among: full_name, email, phone, location,
    current_title, current_employer, total_experience_years, skills
    (comma or ; separated), education, certifications (; separated),
    work_rights, salary_expectation, notice_period_days,
    preferred_locations (; separated), preferred_employment_type,
    availability, source (overrides the form field below if present),
    referral_source, tags (; separated), notes, consent_given (true/false/yes/no),
    cover_letter_text. Only full_name is required — everything else is
    optional and simply left blank if the column is absent. Rows matching
    an existing candidate by email/phone are skipped and reported as
    duplicates, not silently overwritten."""
    org = await _org(db, current_user)
    raw = await file.read()
    text = raw.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))

    # Loaded ONCE for the whole file, not once per row — see
    # service.load_candidate_dedup_index for why this matters at scale.
    dedup_index = await service.load_candidate_dedup_index(db, org.id)
    next_seq = await service.get_next_sequence_start(db, org.id)

    created, skipped_duplicates, skipped_invalid = [], [], []
    for row in reader:
        clean = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items() if k}
        full_name = clean.get("full_name") or clean.get("name") or ""
        email = clean.get("email", "")
        phone = clean.get("phone", "")
        if not full_name:
            skipped_invalid.append(clean)
            continue
        dup = service.find_duplicate_in_index(dedup_index, email, phone)
        if dup:
            skipped_duplicates.append({"row": clean, "existing_candidate_id": dup.id})
            continue

        skills = [s.strip() for s in _split_multi(clean.get("skills", "")) if s.strip()]
        certifications = [s.strip() for s in _split_multi(clean.get("certifications", "")) if s.strip()]
        preferred_locations = [s.strip() for s in _split_multi(clean.get("preferred_locations", "")) if s.strip()]
        tags = [s.strip() for s in _split_multi(clean.get("tags", "")) if s.strip()]

        try:
            notice_period_days = int(clean["notice_period_days"]) if clean.get("notice_period_days") else None
        except ValueError:
            notice_period_days = None
        consent_raw = clean.get("consent_given", "").strip().lower()
        consent_given = consent_raw in ("true", "yes", "y", "1")

        c = Candidate(
            organisation_id=org.id, owner_user_id=current_user.id,
            sequence_number=next_seq,
            full_name=full_name, email=email, phone=phone,
            location=clean.get("location", ""), current_title=clean.get("current_title", ""),
            current_employer=clean.get("current_employer", ""),
            total_experience_years=clean.get("total_experience_years", ""),
            skills=skills, education=clean.get("education", ""), certifications=certifications,
            work_rights=clean.get("work_rights", ""), salary_expectation=clean.get("salary_expectation", ""),
            notice_period_days=notice_period_days, preferred_locations=preferred_locations,
            preferred_employment_type=clean.get("preferred_employment_type", ""),
            availability=clean.get("availability", ""),
            source=clean.get("source") or source, referral_source=clean.get("referral_source", ""),
            tags=tags, notes=clean.get("notes", ""),
            consent_given=consent_given, consent_at=datetime.utcnow() if consent_given else None,
            cover_letter_text=clean.get("cover_letter_text") or None,
            status="Active", last_activity_at=datetime.utcnow(),
        )
        next_seq += 1
        db.add(c)
        service.register_in_index(dedup_index, c)
        created.append(c)

    await db.flush()  # one round trip to assign IDs to everything just added
    await db.commit()
    return {
        "created": len(created), "created_ids": [c.id for c in created],
        "skipped_duplicates": len(skipped_duplicates), "duplicate_details": skipped_duplicates,
        "skipped_invalid": len(skipped_invalid),
    }


def _split_multi(raw: str) -> List[str]:
    return re.split(r"[;,]", raw) if raw else []


@router.post("/candidates/bulk-folder-import")
async def bulk_folder_import(
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Select an entire folder (or a multi-file selection) of resumes and
    cover letters at once. Files are paired by filename — see
    service.classify_document_and_basekey — so "Jane_Doe_Resume.pdf" and
    "Jane_Doe_Cover_Letter.docx" become ONE candidate with both attached,
    not two separate records. A resume with no matching cover letter (or
    vice versa) still creates a candidate with just what it has.
    Duplicate-safe: an extracted email that already exists in the
    organisation is skipped and reported, not silently overwritten —
    same policy as CSV import."""
    org = await _org(db, current_user)

    groups: dict = {}
    for f in files:
        if not f.filename:
            continue
        kind, basekey = service.classify_document_and_basekey(f.filename)
        groups.setdefault(basekey, {})[kind] = f

    # Loaded ONCE for the whole batch — see service.load_candidate_dedup_index
    # docstring for why per-row queries here caused real bulk imports to
    # silently blow past the client's 60s timeout against a remote database.
    dedup_index = await service.load_candidate_dedup_index(db, org.id)
    next_seq = await service.get_next_sequence_start(db, org.id)

    created, skipped_duplicates, cover_letter_only = [], [], []
    for group in groups.values():
        resume_file = group.get("resume")
        cl_file = group.get("cover_letter")
        if not resume_file and not cl_file:
            continue

        name, email, phone, resume_text, parsed = None, "", "", None, None
        if resume_file:
            content_result = await service.extract_and_parse_resume(resume_file)
            resume_text = content_result["raw_text"]
            parsed = content_result["parsed"]
            name = parsed.get("applicant_name")
            email = parsed.get("email") or ""
            phone = parsed.get("phone") or ""
            await resume_file.seek(0)
        else:
            # Cover-letter-only file: can't reliably pull a person's name
            # out of cover-letter prose, so fall back to the filename —
            # same convention as the existing resume-only bulk upload.
            # os.path.basename: cl_file.filename is the full relative path
            # for a webkitdirectory folder upload (see
            # service.classify_document_and_basekey's docstring) — without
            # stripping it, a cover-letter-only candidate's name became the
            # literal folder path, e.g. "Sample Resumes Coverletters/Dylan
            # Brown Cover Letter" instead of "Dylan Brown".
            base = os.path.basename(cl_file.filename).rsplit(".", 1)[0]
            name = base.replace("_", " ").replace("-", " ").strip().title()
            cover_letter_only.append(cl_file.filename)

        name = (name or "").strip() or "Unnamed Candidate"

        # Checks email, then phone, then exact name (see
        # find_duplicate_in_index) — previously this only ever ran "if
        # email" was truthy at all, with no phone or name fallback, so a
        # resume with no extractable email always created a fresh
        # candidate even for someone already fully on file.
        dup = service.find_duplicate_in_index(dedup_index, email, phone, full_name=name)
        if dup:
            # Attach the file(s) to the EXISTING candidate instead of
            # either dropping them or spawning a hollow duplicate row —
            # apply_parsed_resume_to_candidate's overwrite=False means
            # this only fills fields the existing record doesn't already
            # have, so current_title/experience/skills/tags/pools already
            # on file are never touched, just enriched with whatever the
            # newly uploaded resume adds.
            if resume_file:
                dup.resume_blob = await resume_file.read()
                dup.resume_filename = os.path.basename(resume_file.filename)
                dup.resume_mimetype = resume_file.content_type or "application/octet-stream"
                if parsed:
                    service.apply_parsed_resume_to_candidate(dup, parsed, resume_text, overwrite=False)
                else:
                    dup.resume_text = resume_text
            if cl_file:
                try:
                    service.validate_cover_letter_filetype(cl_file.filename)
                    cl_text = await service.extract_cover_letter_text(cl_file)
                    await cl_file.seek(0)
                    dup.cover_letter_blob = await cl_file.read()
                    dup.cover_letter_filename = os.path.basename(cl_file.filename)
                    dup.cover_letter_mimetype = cl_file.content_type or "application/octet-stream"
                    dup.cover_letter_text = cl_text
                except HTTPException:
                    pass  # unsupported cover-letter filetype — existing candidate keeps whatever it already had
            dup.updated_at = datetime.utcnow()
            dup.last_activity_at = datetime.utcnow()
            skipped_duplicates.append({
                "name": name, "email": email, "existing_candidate_id": dup.id,
                "attached_to_existing": bool(resume_file or cl_file),
            })
            continue

        candidate = Candidate(
            organisation_id=org.id, owner_user_id=current_user.id,
            sequence_number=next_seq,
            full_name=name, email=email, source="bulk_folder_import", status="Active",
            last_activity_at=datetime.utcnow(),
        )
        next_seq += 1
        if resume_file:
            candidate.resume_blob = await resume_file.read()
            # basename: strip any folder path a webkitdirectory upload sent
            # (see classify_document_and_basekey's docstring) — otherwise
            # the displayed/download filename is the whole folder path.
            candidate.resume_filename = os.path.basename(resume_file.filename)
            candidate.resume_mimetype = resume_file.content_type or "application/octet-stream"
            if parsed:
                # Reuses the same field-mapping as the single-candidate resume
                # upload endpoint (service.apply_parsed_resume_to_candidate)
                # instead of re-implementing a partial version here — this
                # used to only copy skills/experience_years, silently
                # dropping phone/location/current_title/current_employer/
                # education/certifications even though the resume had
                # already been parsed for them. overwrite=True is safe here
                # (unlike the existing-candidate upload endpoint): this is a
                # brand-new row with nothing in it yet to clobber.
                service.apply_parsed_resume_to_candidate(candidate, parsed, resume_text, overwrite=True)
            else:
                candidate.resume_text = resume_text
        if cl_file:
            try:
                service.validate_cover_letter_filetype(cl_file.filename)
                cl_text = await service.extract_cover_letter_text(cl_file)
                await cl_file.seek(0)
                candidate.cover_letter_blob = await cl_file.read()
                candidate.cover_letter_filename = os.path.basename(cl_file.filename)
                candidate.cover_letter_mimetype = cl_file.content_type or "application/octet-stream"
                candidate.cover_letter_text = cl_text
            except HTTPException:
                pass  # unsupported cover-letter filetype — candidate is still created, just without it

        db.add(candidate)
        service.register_in_index(dedup_index, candidate)
        created.append({
            "candidate": candidate, "name": candidate.full_name,
            "has_resume": bool(resume_file), "has_cover_letter": bool(cl_file),
        })

    await db.flush()  # one round trip to assign IDs to everything just added
    await db.commit()
    return {
        "created": len(created),
        "candidates": [{"id": c["candidate"].id, "name": c["name"], "has_resume": c["has_resume"], "has_cover_letter": c["has_cover_letter"]} for c in created],
        "skipped_duplicates": len(skipped_duplicates), "duplicate_details": skipped_duplicates,
        "cover_letter_only": len(cover_letter_only), "cover_letter_only_files": cover_letter_only,
    }


@router.post("/candidates/bulk-delete")
async def bulk_delete_candidates(payload: BulkIds, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Per-candidate, not a single blanket DELETE — same reasoning as
    capabilities.requisition.router.bulk_delete_requisitions: a bulk
    selection is very likely to mix deletable candidates with ones who
    have hiring activity attached."""
    org = await _org(db, current_user)
    rows = (await db.execute(select(Candidate).where(Candidate.id.in_(payload.ids), Candidate.organisation_id == org.id))).scalars().all()
    deleted, skipped = [], []
    for c in rows:
        reason = await _blocking_hiring_activity_refs(db, c.id)
        if reason:
            skipped.append({"id": c.id, "name": c.full_name, "reason": reason})
            continue
        await _clear_merge_references(db, c.id)
        await db.delete(c)
        deleted.append(c.id)
    await db.commit()
    return {"deleted": len(deleted), "deleted_ids": deleted, "skipped": skipped}


# ══════════════════════════════════════════════════════════════════════════
# CANDIDATE MERGE
# ══════════════════════════════════════════════════════════════════════════

@router.get("/candidates/{candidate_id}/duplicates")
async def find_duplicates_for(candidate_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    c = (await db.execute(select(Candidate).where(Candidate.id == candidate_id, Candidate.organisation_id == org.id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Candidate not found")
    dup = await service.find_candidate_duplicate(db, org.id, c.email, c.phone, exclude_id=c.id)
    return {"duplicate": _fmt_candidate(dup) if dup else None}


@router.post("/candidates/merge")
async def merge_candidates(payload: MergeRequest, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Merges `merged_candidate_id` INTO `primary_candidate_id`. The
    primary survives and absorbs: applications, pool memberships, and any
    profile field the primary is missing. The merged-away row is kept
    (is_merged=True) rather than deleted, so history/attribution is never
    lost — same audit-friendly philosophy as CandidateTrack's existing
    duplicate handling, just with an actual resolution step."""
    if payload.primary_candidate_id == payload.merged_candidate_id:
        raise HTTPException(400, "Cannot merge a candidate into itself.")
    org = await _org(db, current_user)

    primary = (await db.execute(select(Candidate).where(Candidate.id == payload.primary_candidate_id, Candidate.organisation_id == org.id))).scalar_one_or_none()
    merged = (await db.execute(select(Candidate).where(Candidate.id == payload.merged_candidate_id, Candidate.organisation_id == org.id))).scalar_one_or_none()
    if not primary or not merged:
        raise HTTPException(404, "Both candidates must exist in your organisation.")
    if merged.is_merged:
        raise HTTPException(400, "That candidate has already been merged.")

    snapshot = service.merge_snapshot(merged)

    # Fill any gaps on the primary from the merged-away record.
    for field in ["email", "phone", "location", "linkedin_url", "portfolio_url", "current_employer",
                  "current_title", "total_experience_years", "education", "work_rights",
                  "salary_expectation", "availability", "referral_source"]:
        if not getattr(primary, field) and getattr(merged, field):
            setattr(primary, field, getattr(merged, field))
    primary.skills = list(dict.fromkeys((primary.skills or []) + (merged.skills or [])))
    primary.certifications = list(dict.fromkeys((primary.certifications or []) + (merged.certifications or [])))
    primary.tags = list(dict.fromkeys((primary.tags or []) + (merged.tags or [])))
    if merged.resume_blob and not primary.resume_blob:
        primary.resume_blob, primary.resume_filename, primary.resume_mimetype, primary.resume_text = (
            merged.resume_blob, merged.resume_filename, merged.resume_mimetype, merged.resume_text,
        )

    # Re-point applications and pool memberships to the primary.
    apps = (await db.execute(select(Application).where(Application.candidate_id == merged.id))).scalars().all()
    for a in apps:
        a.candidate_id = primary.id

    memberships = (await db.execute(select(CandidatePoolMember).where(CandidatePoolMember.candidate_id == merged.id))).scalars().all()
    existing_pool_ids = {m.pool_id for m in (await db.execute(select(CandidatePoolMember).where(CandidatePoolMember.candidate_id == primary.id))).scalars().all()}
    for m in memberships:
        if m.pool_id in existing_pool_ids:
            await db.delete(m)
        else:
            m.candidate_id = primary.id

    merged.is_merged = True
    merged.merged_into_id = primary.id
    primary.updated_at = datetime.utcnow()
    primary.last_activity_at = datetime.utcnow()

    db.add(CandidateMergeLog(
        organisation_id=org.id, primary_candidate_id=primary.id, merged_candidate_id=merged.id,
        merged_by_user_id=current_user.id, field_snapshot=snapshot,
    ))
    await db.commit()
    await db.refresh(primary)
    return _fmt_candidate(primary, await _pool_names_for(db, primary.id))


# ══════════════════════════════════════════════════════════════════════════
# TALENT POOLS
# ══════════════════════════════════════════════════════════════════════════

@router.post("/pools")
async def create_pool(payload: TalentPoolCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    pool = TalentPool(organisation_id=org.id, created_by_user_id=current_user.id, name=payload.name.strip(), description=payload.description.strip())
    db.add(pool)
    await db.commit()
    await db.refresh(pool)
    return {"id": pool.id, "name": pool.name, "description": pool.description or "", "member_count": 0}


@router.get("/pools")
async def list_pools(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    pools = (await db.execute(select(TalentPool).where(TalentPool.organisation_id == org.id).order_by(TalentPool.created_at.desc()))).scalars().all()
    out = []
    for p in pools:
        count = (await db.execute(select(func.count()).select_from(CandidatePoolMember).where(CandidatePoolMember.pool_id == p.id))).scalar() or 0
        out.append({"id": p.id, "name": p.name, "description": p.description or "", "member_count": count,
                     "created_at": p.created_at.isoformat() if p.created_at else None})
    return out


@router.delete("/pools/{pool_id}")
async def delete_pool(pool_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    p = (await db.execute(select(TalentPool).where(TalentPool.id == pool_id, TalentPool.organisation_id == org.id))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Pool not found")
    await db.delete(p)
    await db.commit()
    return {"deleted": True}


@router.post("/pools/{pool_id}/members")
async def add_pool_members(pool_id: int, payload: PoolMembershipRequest, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    p = (await db.execute(select(TalentPool).where(TalentPool.id == pool_id, TalentPool.organisation_id == org.id))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Pool not found")
    existing = {m.candidate_id for m in (await db.execute(select(CandidatePoolMember).where(CandidatePoolMember.pool_id == pool_id))).scalars().all()}
    added = 0
    for cid in payload.candidate_ids:
        if cid in existing:
            continue
        cand = (await db.execute(select(Candidate).where(Candidate.id == cid, Candidate.organisation_id == org.id))).scalar_one_or_none()
        if not cand:
            continue
        db.add(CandidatePoolMember(pool_id=pool_id, candidate_id=cid))
        added += 1
    await db.commit()
    return {"added": added}


@router.delete("/pools/{pool_id}/members/{candidate_id}")
async def remove_pool_member(pool_id: int, candidate_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    m = (await db.execute(select(CandidatePoolMember).join(TalentPool).where(
        CandidatePoolMember.pool_id == pool_id, CandidatePoolMember.candidate_id == candidate_id, TalentPool.organisation_id == org.id
    ))).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Membership not found")
    await db.delete(m)
    await db.commit()
    return {"removed": True}


# ══════════════════════════════════════════════════════════════════════════
# CANDIDATE PORTAL — generate a self-service link for a candidate
# ══════════════════════════════════════════════════════════════════════════

@router.post("/candidates/{candidate_id}/portal-link")
async def generate_portal_link(candidate_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    c = (await db.execute(select(Candidate).where(Candidate.id == candidate_id, Candidate.organisation_id == org.id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Candidate not found")
    if not c.portal_token:
        c.portal_token = service.generate_portal_token()
        await db.commit()
    return {"portal_token": c.portal_token, "portal_url_path": f"/my-profile/{c.portal_token}"}
