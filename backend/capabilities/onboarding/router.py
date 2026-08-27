from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel

from db.database import get_db
from models.models import User
from utils.auth_utils import get_current_user
from capabilities.acquisition import service as acquisition_service
from capabilities.acquisition.models import Candidate
from capabilities.requisition.models import Requisition
from capabilities.pipeline.models import Placement
from .models import (
    OnboardingTask, ONBOARDING_CATEGORIES,
    ReferenceCheck, REFERENCE_CHECK_MODES, REFERENCE_CHECK_STATUSES, REFERENCE_CHECK_RECOMMENDATIONS,
)

router = APIRouter()


async def _org(db: AsyncSession, user: User):
    return await acquisition_service.get_or_create_default_organisation(db, user)


def _fmt_task(t: OnboardingTask) -> dict:
    return {
        "id": t.id, "placement_id": t.placement_id, "title": t.title, "category": t.category,
        "due_date": t.due_date.isoformat() if t.due_date else None,
        "completed": t.completed, "completed_at": t.completed_at.isoformat() if t.completed_at else None,
        "assigned_to": t.assigned_to or "", "notes": t.notes or "", "sort_order": t.sort_order,
    }


@router.get("/placements")
async def list_onboarding_placements(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Every Placement for this org, with candidate/requisition names and
    checklist progress — the Onboarding tab's own list view, same
    "batch-fetch, don't N+1" shape as every other list endpoint in this
    codebase."""
    org = await _org(db, current_user)
    placements = (await db.execute(
        select(Placement).where(Placement.organisation_id == org.id).order_by(Placement.start_date.desc())
    )).scalars().all()
    placement_ids = [p.id for p in placements]

    candidate_ids = {p.candidate_id for p in placements}
    candidate_names = dict((await db.execute(
        select(Candidate.id, Candidate.full_name).where(Candidate.id.in_(candidate_ids))
    )).all()) if candidate_ids else {}

    requisition_ids = {p.requisition_id for p in placements}
    requisition_titles = dict((await db.execute(
        select(Requisition.id, Requisition.title).where(Requisition.id.in_(requisition_ids))
    )).all()) if requisition_ids else {}

    progress_by_placement = {}
    if placement_ids:
        rows = (await db.execute(
            select(OnboardingTask.placement_id, OnboardingTask.completed, func.count())
            .where(OnboardingTask.placement_id.in_(placement_ids))
            .group_by(OnboardingTask.placement_id, OnboardingTask.completed)
        )).all()
        for pid, completed, count in rows:
            bucket = progress_by_placement.setdefault(pid, {"total": 0, "completed": 0})
            bucket["total"] += count
            if completed:
                bucket["completed"] += count

    # Reference-check progress, same "batch-fetch, don't N+1" shape as
    # task progress above — surfaced on the New Hires list so it's clear
    # at a glance whether references still need chasing before someone
    # starts.
    refcheck_by_placement = {}
    if placement_ids:
        rows = (await db.execute(
            select(ReferenceCheck.placement_id, ReferenceCheck.status, func.count())
            .where(ReferenceCheck.placement_id.in_(placement_ids))
            .group_by(ReferenceCheck.placement_id, ReferenceCheck.status)
        )).all()
        for pid, status, count in rows:
            bucket = refcheck_by_placement.setdefault(pid, {"total": 0, "completed": 0})
            bucket["total"] += count
            if status == "Completed":
                bucket["completed"] += count

    out = []
    for p in placements:
        progress = progress_by_placement.get(p.id, {"total": 0, "completed": 0})
        refprogress = refcheck_by_placement.get(p.id, {"total": 0, "completed": 0})
        out.append({
            "id": p.id, "candidate_id": p.candidate_id, "candidate_name": candidate_names.get(p.candidate_id, ""),
            "requisition_id": p.requisition_id, "requisition_title": requisition_titles.get(p.requisition_id, ""),
            "start_date": p.start_date.isoformat() if p.start_date else None,
            "status": p.status,
            "task_total": progress["total"], "task_completed": progress["completed"],
            "refcheck_total": refprogress["total"], "refcheck_completed": refprogress["completed"],
        })
    return out


@router.get("/tasks")
async def list_onboarding_tasks(
    placement_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org = await _org(db, current_user)
    placement = (await db.execute(
        select(Placement).where(Placement.id == placement_id, Placement.organisation_id == org.id)
    )).scalar_one_or_none()
    if not placement:
        raise HTTPException(404, "Placement not found in your organisation.")
    tasks = (await db.execute(
        select(OnboardingTask).where(OnboardingTask.placement_id == placement_id).order_by(OnboardingTask.sort_order, OnboardingTask.id)
    )).scalars().all()
    return [_fmt_task(t) for t in tasks]


class TaskCreate(BaseModel):
    placement_id: int
    title: str
    category: str = "General"
    due_date: Optional[datetime] = None
    assigned_to: str = ""
    notes: str = ""


@router.post("/tasks")
async def create_onboarding_task(payload: TaskCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    placement = (await db.execute(
        select(Placement).where(Placement.id == payload.placement_id, Placement.organisation_id == org.id)
    )).scalar_one_or_none()
    if not placement:
        raise HTTPException(404, "Placement not found in your organisation.")
    if not payload.title.strip():
        raise HTTPException(400, "Title is required.")
    max_sort = (await db.execute(
        select(func.max(OnboardingTask.sort_order)).where(OnboardingTask.placement_id == payload.placement_id)
    )).scalar_one_or_none() or 0
    task = OnboardingTask(
        organisation_id=org.id, placement_id=payload.placement_id,
        title=payload.title.strip(), category=payload.category if payload.category in ONBOARDING_CATEGORIES else "General",
        due_date=payload.due_date, assigned_to=payload.assigned_to.strip(), notes=payload.notes.strip(),
        sort_order=max_sort + 1,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return _fmt_task(task)


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    due_date: Optional[datetime] = None
    completed: Optional[bool] = None
    assigned_to: Optional[str] = None
    notes: Optional[str] = None


@router.put("/tasks/{task_id}")
async def update_onboarding_task(task_id: int, payload: TaskUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    task = (await db.execute(
        select(OnboardingTask).where(OnboardingTask.id == task_id, OnboardingTask.organisation_id == org.id)
    )).scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found.")
    data = payload.dict(exclude_unset=True)
    if "completed" in data:
        task.completed = data["completed"]
        task.completed_at = datetime.utcnow() if data["completed"] else None
    for field in ("title", "category", "due_date", "assigned_to", "notes"):
        if field in data:
            setattr(task, field, data[field].strip() if isinstance(data[field], str) else data[field])
    task.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(task)
    return _fmt_task(task)


@router.delete("/tasks/{task_id}")
async def delete_onboarding_task(task_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    task = (await db.execute(
        select(OnboardingTask).where(OnboardingTask.id == task_id, OnboardingTask.organisation_id == org.id)
    )).scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found.")
    await db.delete(task)
    await db.commit()
    return {"message": "Deleted"}


# ── Reference Checks ──────────────────────────────────────────────────
# Kept separate from the generic OnboardingTask checklist above: a
# placement can have several referees, each with their own contact
# details and outcome, and the evidence behind a check can arrive either
# as an ONLINE check (typed up directly / referee self-submitted) or an
# OFFLINE check (a scanned/emailed paper form) — so each row carries a
# structured outcome plus, for the offline case, the original file.

def _fmt_refcheck(r: ReferenceCheck) -> dict:
    return {
        "id": r.id, "placement_id": r.placement_id,
        "referee_name": r.referee_name, "referee_title": r.referee_title or "",
        "referee_company": r.referee_company or "", "relationship": r.relationship or "",
        "referee_email": r.referee_email or "", "referee_phone": r.referee_phone or "",
        "mode": r.mode, "status": r.status,
        "conducted_by": r.conducted_by or "",
        "conducted_at": r.conducted_at.isoformat() if r.conducted_at else None,
        "recommendation": r.recommendation, "would_rehire": r.would_rehire, "rating": r.rating,
        "summary": r.summary or "",
        "has_form": bool(r.form_blob), "form_filename": r.form_filename or "",
        "sort_order": r.sort_order,
    }


async def _get_placement_in_org(db: AsyncSession, org, placement_id: int) -> Placement:
    placement = (await db.execute(
        select(Placement).where(Placement.id == placement_id, Placement.organisation_id == org.id)
    )).scalar_one_or_none()
    if not placement:
        raise HTTPException(404, "Placement not found in your organisation.")
    return placement


@router.get("/reference-checks")
async def list_reference_checks(
    placement_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org = await _org(db, current_user)
    await _get_placement_in_org(db, org, placement_id)
    rows = (await db.execute(
        select(ReferenceCheck).where(ReferenceCheck.placement_id == placement_id)
        .order_by(ReferenceCheck.sort_order, ReferenceCheck.id)
    )).scalars().all()
    return [_fmt_refcheck(r) for r in rows]


@router.get("/reference-check-options")
async def reference_check_options(current_user: User = Depends(get_current_user)):
    """Static option lists for the Reference Checks form — kept server-side
    (not hardcoded twice in the frontend) so mode/status/recommendation
    values only ever need to change in one place."""
    return {
        "modes": REFERENCE_CHECK_MODES,
        "statuses": REFERENCE_CHECK_STATUSES,
        "recommendations": REFERENCE_CHECK_RECOMMENDATIONS,
    }


class ReferenceCheckCreate(BaseModel):
    placement_id: int
    referee_name: str
    referee_title: str = ""
    referee_company: str = ""
    relationship: str = ""
    referee_email: str = ""
    referee_phone: str = ""
    mode: str = "Online"
    status: str = "Pending"
    conducted_by: str = ""
    conducted_at: Optional[datetime] = None
    recommendation: str = "Not yet assessed"
    would_rehire: Optional[bool] = None
    rating: Optional[int] = None
    summary: str = ""


@router.post("/reference-checks")
async def create_reference_check(payload: ReferenceCheckCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    await _get_placement_in_org(db, org, payload.placement_id)
    if not payload.referee_name.strip():
        raise HTTPException(400, "Referee name is required.")
    if payload.rating is not None and not (1 <= payload.rating <= 5):
        raise HTTPException(400, "Rating must be between 1 and 5.")
    max_sort = (await db.execute(
        select(func.max(ReferenceCheck.sort_order)).where(ReferenceCheck.placement_id == payload.placement_id)
    )).scalar_one_or_none() or 0
    r = ReferenceCheck(
        organisation_id=org.id, placement_id=payload.placement_id,
        referee_name=payload.referee_name.strip(), referee_title=payload.referee_title.strip(),
        referee_company=payload.referee_company.strip(), relationship=payload.relationship.strip(),
        referee_email=payload.referee_email.strip(), referee_phone=payload.referee_phone.strip(),
        mode=payload.mode if payload.mode in REFERENCE_CHECK_MODES else "Online",
        status=payload.status if payload.status in REFERENCE_CHECK_STATUSES else "Pending",
        conducted_by=payload.conducted_by.strip(), conducted_at=payload.conducted_at,
        recommendation=payload.recommendation if payload.recommendation in REFERENCE_CHECK_RECOMMENDATIONS else "Not yet assessed",
        would_rehire=payload.would_rehire, rating=payload.rating, summary=payload.summary.strip(),
        sort_order=max_sort + 1,
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return _fmt_refcheck(r)


class ReferenceCheckUpdate(BaseModel):
    referee_name: Optional[str] = None
    referee_title: Optional[str] = None
    referee_company: Optional[str] = None
    relationship: Optional[str] = None
    referee_email: Optional[str] = None
    referee_phone: Optional[str] = None
    mode: Optional[str] = None
    status: Optional[str] = None
    conducted_by: Optional[str] = None
    conducted_at: Optional[datetime] = None
    recommendation: Optional[str] = None
    would_rehire: Optional[bool] = None
    rating: Optional[int] = None
    summary: Optional[str] = None


async def _get_refcheck_in_org(db: AsyncSession, org, refcheck_id: int) -> ReferenceCheck:
    r = (await db.execute(
        select(ReferenceCheck).where(ReferenceCheck.id == refcheck_id, ReferenceCheck.organisation_id == org.id)
    )).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Reference check not found.")
    return r


@router.put("/reference-checks/{refcheck_id}")
async def update_reference_check(refcheck_id: int, payload: ReferenceCheckUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    r = await _get_refcheck_in_org(db, org, refcheck_id)
    data = payload.dict(exclude_unset=True)
    if "mode" in data and data["mode"] not in REFERENCE_CHECK_MODES:
        raise HTTPException(400, f"mode must be one of {REFERENCE_CHECK_MODES}")
    if "status" in data and data["status"] not in REFERENCE_CHECK_STATUSES:
        raise HTTPException(400, f"status must be one of {REFERENCE_CHECK_STATUSES}")
    if "recommendation" in data and data["recommendation"] not in REFERENCE_CHECK_RECOMMENDATIONS:
        raise HTTPException(400, f"recommendation must be one of {REFERENCE_CHECK_RECOMMENDATIONS}")
    if "rating" in data and data["rating"] is not None and not (1 <= data["rating"] <= 5):
        raise HTTPException(400, "Rating must be between 1 and 5.")
    for field in ("referee_name", "referee_title", "referee_company", "relationship", "referee_email",
                  "referee_phone", "mode", "status", "conducted_by", "conducted_at", "recommendation",
                  "would_rehire", "rating", "summary"):
        if field in data:
            value = data[field]
            setattr(r, field, value.strip() if isinstance(value, str) else value)
    r.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(r)
    return _fmt_refcheck(r)


@router.delete("/reference-checks/{refcheck_id}")
async def delete_reference_check(refcheck_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    r = await _get_refcheck_in_org(db, org, refcheck_id)
    await db.delete(r)
    await db.commit()
    return {"message": "Deleted"}


@router.post("/reference-checks/{refcheck_id}/form")
async def upload_reference_check_form(
    refcheck_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stores the original offline reference-check form (scanned PDF,
    photographed paper form, emailed Word doc, etc.) against this
    referee's record — the evidence behind an Offline-mode check."""
    org = await _org(db, current_user)
    r = await _get_refcheck_in_org(db, org, refcheck_id)
    content = await file.read()
    r.form_blob = content
    r.form_filename = file.filename
    r.form_mimetype = file.content_type or "application/octet-stream"
    r.updated_at = datetime.utcnow()
    await db.commit()
    return {"status": "saved", "filename": file.filename}


@router.get("/reference-checks/{refcheck_id}/form")
async def download_reference_check_form(
    refcheck_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org = await _org(db, current_user)
    r = await _get_refcheck_in_org(db, org, refcheck_id)
    if not r.form_blob:
        raise HTTPException(404, "No form stored for this reference check.")
    return Response(
        content=r.form_blob,
        media_type=r.form_mimetype or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{r.form_filename or "reference-check-form"}"'},
    )


@router.delete("/reference-checks/{refcheck_id}/form")
async def delete_reference_check_form(
    refcheck_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org = await _org(db, current_user)
    r = await _get_refcheck_in_org(db, org, refcheck_id)
    r.form_blob = None
    r.form_filename = None
    r.form_mimetype = None
    r.updated_at = datetime.utcnow()
    await db.commit()
    return {"message": "Form removed"}
