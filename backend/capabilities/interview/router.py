"""
TalentIQ — Capability: Interview Management (Phase 4, authenticated)

Registered in main.py as: /api/interviews/*
Public (candidate self-scheduling) endpoints live in public_router.py,
registered as: /api/public/interviews/*
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete as sa_delete

from db.database import get_db
from models.models import User
from utils.auth_utils import get_current_user
from capabilities.acquisition import service as acquisition_service
from capabilities.acquisition.models import Candidate, Application
from capabilities.requisition.models import Requisition
from capabilities.communication import service as service_communication

from .models import Interview, InterviewScorecard, INTERVIEW_STATUSES, INTERVIEW_TYPES, SELF_SCHEDULABLE_TYPES
from .schemas import (
    InterviewCreate, InterviewUpdate, InterviewStatusChange, SelfScheduleRequest,
    ScorecardCreate, ScorecardUpdate, BulkIds,
)
from . import service

router = APIRouter()


async def _org(db: AsyncSession, user: User):
    return await acquisition_service.get_or_create_default_organisation(db, user)


async def _candidate_name(db: AsyncSession, candidate_id: int) -> str:
    c = (await db.execute(select(Candidate).where(Candidate.id == candidate_id))).scalar_one_or_none()
    return c.full_name if c else ""


async def _requisition_title(db: AsyncSession, requisition_id: Optional[int]) -> str:
    if not requisition_id:
        return ""
    r = (await db.execute(select(Requisition).where(Requisition.id == requisition_id))).scalar_one_or_none()
    return r.title if r else ""


def _fmt_scorecard(s: InterviewScorecard) -> dict:
    return {
        "id": s.id,
        "interview_id": s.interview_id,
        "interviewer_name": s.interviewer_name,
        "recommendation": s.recommendation or "",
        "criteria_scores": s.criteria_scores or [],
        "strengths": s.strengths or "",
        "concerns": s.concerns or "",
        "overall_notes": s.overall_notes or "",
        "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
    }


def _fmt_interview(i: Interview, candidate_name: str = "", requisition_title: str = "", scorecards: Optional[List[dict]] = None) -> dict:
    return {
        "id": i.id,
        "sequence_number": i.sequence_number,
        "candidate_id": i.candidate_id,
        "candidate_name": candidate_name,
        "requisition_id": i.requisition_id,
        "requisition_title": requisition_title,
        "application_id": i.application_id,
        "round_name": i.round_name,
        "interview_type": i.interview_type or "HR Screening",
        "round_number": i.round_number,
        "interviewers": i.interviewers or [],
        "duration_minutes": i.duration_minutes,
        "location_or_link": i.location_or_link or "",
        "scheduled_at": i.scheduled_at.isoformat() if i.scheduled_at else None,
        "status": i.status,
        "self_schedule_token": i.self_schedule_token,
        "proposed_slots": i.proposed_slots or [],
        "candidate_selected_at": i.candidate_selected_at.isoformat() if i.candidate_selected_at else None,
        "calendly_scheduling_url": i.calendly_scheduling_url or "",
        "notes": i.notes or "",
        "cancellation_reason": i.cancellation_reason or "",
        "scorecard_count": len(scorecards) if scorecards is not None else None,
        "scorecards": scorecards,
        "created_at": i.created_at.isoformat() if i.created_at else None,
        "updated_at": i.updated_at.isoformat() if i.updated_at else None,
    }


# ══════════════════════════════════════════════════════════════════════════
# INTERVIEWS — CRUD
# ══════════════════════════════════════════════════════════════════════════

@router.post("/interviews")
async def create_interview(
    payload: InterviewCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org = await _org(db, current_user)
    candidate = (await db.execute(select(Candidate).where(Candidate.id == payload.candidate_id, Candidate.organisation_id == org.id))).scalar_one_or_none()
    if not candidate:
        raise HTTPException(404, "Candidate not found in your organisation.")
    if payload.requisition_id:
        req = (await db.execute(select(Requisition).where(Requisition.id == payload.requisition_id, Requisition.organisation_id == org.id))).scalar_one_or_none()
        if not req:
            raise HTTPException(404, "Requisition not found in your organisation.")
    if payload.interview_type not in INTERVIEW_TYPES:
        raise HTTPException(400, f"interview_type must be one of: {', '.join(INTERVIEW_TYPES)}")
    if payload.proposed_slots and payload.interview_type not in SELF_SCHEDULABLE_TYPES:
        # Same rule enforced again in create_self_schedule_link/
        # create_calendly_link for a round set up WITHOUT proposed_slots
        # at creation time and self-scheduled later — checked here too so
        # it can't be bypassed simply by setting proposed_slots up front
        # instead of using that separate endpoint.
        raise HTTPException(400, f"Self-scheduling is only available for HR Screening rounds — {payload.interview_type} interviews must be scheduled directly by a recruiter.")

    status = "Scheduled" if payload.scheduled_at else ("Requested" if payload.proposed_slots else "Requested")
    interview = Interview(
        organisation_id=org.id, owner_user_id=current_user.id,
        sequence_number=await service.get_next_sequence(db, org.id),
        candidate_id=payload.candidate_id, requisition_id=payload.requisition_id,
        application_id=payload.application_id,
        round_name=payload.round_name.strip(), round_number=payload.round_number,
        interview_type=payload.interview_type,
        interviewers=[i.dict() for i in payload.interviewers],
        duration_minutes=payload.duration_minutes, location_or_link=payload.location_or_link.strip(),
        scheduled_at=payload.scheduled_at,
        proposed_slots=[s.isoformat() for s in payload.proposed_slots],
        status=status,
        notes=payload.notes.strip(),
    )
    db.add(interview)
    await db.commit()
    await db.refresh(interview)

    if interview.status == "Scheduled":
        # Best-effort — fire_automation never raises, so this can't break
        # interview creation even if SMTP isn't configured or no rule
        # matches (see capabilities/communication/service.py's docstring).
        req_title = await _requisition_title(db, interview.requisition_id)
        await service_communication.fire_automation(
            db, org.id, "interview_scheduled",
            context={"candidate_name": candidate.full_name, "requisition_title": req_title, "round_name": interview.round_name,
                     "interview_time": interview.scheduled_at.strftime("%A, %B %d at %I:%M %p") if interview.scheduled_at else "",
                     "location_or_link": interview.location_or_link or ""},
            triggering_user_id=current_user.id, to_email=candidate.email or None,
            candidate_id=candidate.id, requisition_id=interview.requisition_id,
        )
        await db.commit()

    return _fmt_interview(interview, candidate.full_name, await _requisition_title(db, interview.requisition_id))


@router.get("/interviews")
async def list_interviews(
    candidate_id: Optional[int] = None,
    requisition_id: Optional[int] = None,
    status: Optional[str] = None,
    upcoming_only: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org = await _org(db, current_user)
    q = select(Interview).where(Interview.organisation_id == org.id)
    if candidate_id:
        q = q.where(Interview.candidate_id == candidate_id)
    if requisition_id:
        q = q.where(Interview.requisition_id == requisition_id)
    if status:
        q = q.where(Interview.status == status)
    if upcoming_only:
        q = q.where(Interview.scheduled_at.isnot(None), Interview.scheduled_at >= datetime.utcnow(), Interview.status == "Scheduled")
    q = q.order_by(Interview.scheduled_at.asc().nulls_last(), Interview.created_at.desc())
    rows = (await db.execute(q)).scalars().all()

    # Batch-fetch candidate names, requisition titles, and scorecard counts
    # instead of one query per row (see acquisition/requisition routers'
    # docstrings for why this matters at scale — same N+1 pattern, fixed
    # the same way from the start here).
    candidate_ids = {i.candidate_id for i in rows}
    requisition_ids = {i.requisition_id for i in rows if i.requisition_id}
    interview_ids = [i.id for i in rows]

    candidate_names = {}
    if candidate_ids:
        res = await db.execute(select(Candidate.id, Candidate.full_name).where(Candidate.id.in_(candidate_ids)))
        candidate_names = dict(res.all())

    requisition_titles = {}
    if requisition_ids:
        res = await db.execute(select(Requisition.id, Requisition.title).where(Requisition.id.in_(requisition_ids)))
        requisition_titles = dict(res.all())

    scorecard_counts = {}
    if interview_ids:
        res = await db.execute(
            select(InterviewScorecard.interview_id, func.count())
            .where(InterviewScorecard.interview_id.in_(interview_ids))
            .group_by(InterviewScorecard.interview_id)
        )
        scorecard_counts = dict(res.all())

    out = []
    for i in rows:
        d = _fmt_interview(i, candidate_names.get(i.candidate_id, ""), requisition_titles.get(i.requisition_id, "") if i.requisition_id else "")
        d["scorecard_count"] = scorecard_counts.get(i.id, 0)
        d.pop("scorecards", None)
        out.append(d)
    return out


@router.get("/interviews/{interview_id}")
async def get_interview(interview_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    i = (await db.execute(select(Interview).where(Interview.id == interview_id, Interview.organisation_id == org.id))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Interview not found")
    scorecards = (await db.execute(select(InterviewScorecard).where(InterviewScorecard.interview_id == i.id))).scalars().all()
    return _fmt_interview(
        i, await _candidate_name(db, i.candidate_id), await _requisition_title(db, i.requisition_id),
        [_fmt_scorecard(s) for s in scorecards],
    )


@router.put("/interviews/{interview_id}")
async def update_interview(
    interview_id: int, payload: InterviewUpdate,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    org = await _org(db, current_user)
    i = (await db.execute(select(Interview).where(Interview.id == interview_id, Interview.organisation_id == org.id))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Interview not found")
    data = payload.dict(exclude_unset=True)
    if "interviewers" in data and data["interviewers"] is not None:
        data["interviewers"] = [x if isinstance(x, dict) else x.dict() for x in data["interviewers"]]
    for field, value in data.items():
        setattr(i, field, value)
    if payload.scheduled_at and i.status == "Requested":
        i.status = "Scheduled"
    i.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(i)
    return _fmt_interview(i, await _candidate_name(db, i.candidate_id), await _requisition_title(db, i.requisition_id))


@router.post("/interviews/{interview_id}/status")
async def change_interview_status(
    interview_id: int, payload: InterviewStatusChange,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    if payload.status not in INTERVIEW_STATUSES:
        raise HTTPException(400, f"Status must be one of: {', '.join(INTERVIEW_STATUSES)}")
    org = await _org(db, current_user)
    i = (await db.execute(select(Interview).where(Interview.id == interview_id, Interview.organisation_id == org.id))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Interview not found")
    i.status = payload.status
    if payload.status == "Cancelled":
        i.cancellation_reason = payload.cancellation_reason.strip()
    i.updated_at = datetime.utcnow()

    # "Auto-updates candidate stage" — best-effort, only when this
    # interview is linked to an Application (see service.advance_application_stage).
    if payload.status == "Completed":
        await service.advance_application_stage(db, i.application_id, "Interviewed")
    elif payload.status == "No-Show":
        await service.advance_application_stage(db, i.application_id, "Interview No-Show")

    await db.commit()
    await db.refresh(i)

    if payload.status == "Completed":
        candidate = (await db.execute(select(Candidate).where(Candidate.id == i.candidate_id))).scalar_one_or_none()
        req_title = await _requisition_title(db, i.requisition_id)
        await service_communication.fire_automation(
            db, org.id, "interview_completed",
            context={"candidate_name": candidate.full_name if candidate else "", "requisition_title": req_title, "round_name": i.round_name},
            triggering_user_id=current_user.id, to_email=(candidate.email if candidate else None) or None,
            candidate_id=i.candidate_id, requisition_id=i.requisition_id,
        )
        await db.commit()

    return _fmt_interview(i, await _candidate_name(db, i.candidate_id), await _requisition_title(db, i.requisition_id))


@router.delete("/interviews/{interview_id}")
async def delete_interview(interview_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    i = (await db.execute(select(Interview).where(Interview.id == interview_id, Interview.organisation_id == org.id))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Interview not found")
    await db.delete(i)  # cascades to scorecards via relationship cascade="all, delete-orphan"
    await db.commit()
    return {"deleted": True}


@router.post("/interviews/bulk-delete")
async def bulk_delete_interviews(payload: BulkIds, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    rows = (await db.execute(select(Interview).where(Interview.id.in_(payload.ids), Interview.organisation_id == org.id))).scalars().all()
    for i in rows:
        await db.delete(i)
    await db.commit()
    return {"deleted": len(rows)}


# ══════════════════════════════════════════════════════════════════════════
# SELF-SCHEDULING LINK (recruiter side — generates the link; candidate
# confirms it via public_router.py)
# ══════════════════════════════════════════════════════════════════════════

@router.post("/interviews/{interview_id}/self-schedule-link")
async def create_self_schedule_link(
    interview_id: int, payload: SelfScheduleRequest,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    org = await _org(db, current_user)
    i = (await db.execute(select(Interview).where(Interview.id == interview_id, Interview.organisation_id == org.id))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Interview not found")
    if i.interview_type not in SELF_SCHEDULABLE_TYPES:
        raise HTTPException(400, f"Self-scheduling is only available for HR Screening rounds — {i.interview_type} interviews must be scheduled directly by a recruiter, not left to a candidate-facing link.")
    if not payload.proposed_slots:
        raise HTTPException(400, "Provide at least one proposed time slot.")
    i.self_schedule_token = service.generate_self_schedule_token()
    i.proposed_slots = [s.isoformat() for s in payload.proposed_slots]
    i.status = "Requested"
    i.scheduled_at = None
    i.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(i)
    return {
        "self_schedule_token": i.self_schedule_token,
        "schedule_url_path": f"/schedule-interview/{i.self_schedule_token}",
    }


# ══════════════════════════════════════════════════════════════════════════
# CALENDLY (optional alternative to the token-based self-schedule link
# above — see service.py's module docstring for what is and isn't wired)
# ══════════════════════════════════════════════════════════════════════════

@router.get("/calendly/status")
async def calendly_status(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Lets the frontend decide whether to show the "Use Calendly" option
    at all, without exposing the token itself."""
    creds = await service.get_calendly_credentials(db, current_user.id)
    return {
        "configured": bool(creds["api_key"] and creds["event_type_uri"]),
        "has_token": bool(creds["api_key"]),
        "has_event_type": bool(creds["event_type_uri"]),
    }


@router.get("/calendly/event-types")
async def calendly_event_types(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Used by the Settings page: fetches the recruiter's own Calendly
    event types by name, so they can pick one instead of hand-copying a
    raw API URI out of Calendly's developer tools."""
    creds = await service.get_calendly_credentials(db, current_user.id)
    if not creds["api_key"]:
        raise HTTPException(400, "Save your Calendly Personal Access Token first.")
    return await service.fetch_calendly_event_types(creds["api_key"])


@router.post("/interviews/{interview_id}/calendly-link")
async def create_calendly_link(
    interview_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    org = await _org(db, current_user)
    i = (await db.execute(select(Interview).where(Interview.id == interview_id, Interview.organisation_id == org.id))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Interview not found")
    if i.interview_type not in SELF_SCHEDULABLE_TYPES:
        raise HTTPException(400, f"Self-scheduling is only available for HR Screening rounds — {i.interview_type} interviews must be scheduled directly by a recruiter, not left to a candidate-facing link.")
    creds = await service.get_calendly_credentials(db, current_user.id)
    if not creds["api_key"] or not creds["event_type_uri"]:
        raise HTTPException(400, "Set up Calendly under Settings -> API Keys first (Personal Access Token + Event Type).")
    booking_url = await service.create_calendly_single_use_link(creds["api_key"], creds["event_type_uri"])
    i.calendly_scheduling_url = booking_url
    i.status = "Requested"
    i.scheduled_at = None
    i.updated_at = datetime.utcnow()
    await db.commit()
    return {"calendly_scheduling_url": booking_url}


# ══════════════════════════════════════════════════════════════════════════
# SCORECARDS
# ══════════════════════════════════════════════════════════════════════════

@router.post("/interviews/{interview_id}/scorecards")
async def create_scorecard(
    interview_id: int, payload: ScorecardCreate,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    org = await _org(db, current_user)
    i = (await db.execute(select(Interview).where(Interview.id == interview_id, Interview.organisation_id == org.id))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Interview not found")
    scorecard = InterviewScorecard(
        interview_id=interview_id, submitted_by_user_id=current_user.id,
        interviewer_name=payload.interviewer_name.strip(),
        recommendation=payload.recommendation,
        criteria_scores=[c.dict() for c in payload.criteria_scores],
        strengths=payload.strengths.strip(), concerns=payload.concerns.strip(),
        overall_notes=payload.overall_notes.strip(),
    )
    db.add(scorecard)
    await db.commit()
    await db.refresh(scorecard)
    return _fmt_scorecard(scorecard)


@router.get("/interviews/{interview_id}/scorecards")
async def list_scorecards(interview_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    i = (await db.execute(select(Interview).where(Interview.id == interview_id, Interview.organisation_id == org.id))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Interview not found")
    rows = (await db.execute(select(InterviewScorecard).where(InterviewScorecard.interview_id == interview_id))).scalars().all()
    return [_fmt_scorecard(s) for s in rows]


@router.put("/scorecards/{scorecard_id}")
async def update_scorecard(
    scorecard_id: int, payload: ScorecardUpdate,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    org = await _org(db, current_user)
    s = (await db.execute(
        select(InterviewScorecard).join(Interview, Interview.id == InterviewScorecard.interview_id)
        .where(InterviewScorecard.id == scorecard_id, Interview.organisation_id == org.id)
    )).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Scorecard not found")
    data = payload.dict(exclude_unset=True)
    if "criteria_scores" in data and data["criteria_scores"] is not None:
        data["criteria_scores"] = [c if isinstance(c, dict) else c.dict() for c in data["criteria_scores"]]
    for field, value in data.items():
        setattr(s, field, value)
    s.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(s)
    return _fmt_scorecard(s)


@router.delete("/scorecards/{scorecard_id}")
async def delete_scorecard(scorecard_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    s = (await db.execute(
        select(InterviewScorecard).join(Interview, Interview.id == InterviewScorecard.interview_id)
        .where(InterviewScorecard.id == scorecard_id, Interview.organisation_id == org.id)
    )).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Scorecard not found")
    await db.delete(s)
    await db.commit()
    return {"deleted": True}
