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

from .models import (
    Interview, InterviewScorecard, InterviewFeedbackLink,
    INTERVIEW_STATUSES, INTERVIEW_TYPES, SELF_SCHEDULABLE_TYPES,
    DECISION_STATUSES,
)
from .schemas import (
    InterviewCreate, InterviewUpdate, InterviewStatusChange, SelfScheduleRequest,
    ScorecardCreate, ScorecardUpdate, BulkIds, DecisionSet,
)
from . import service

router = APIRouter()


async def _org(db: AsyncSession, user: User):
    return await acquisition_service.get_or_create_default_organisation(db, user)


async def _candidate_name(db: AsyncSession, candidate_id: Optional[int], joblens_candidate_id: Optional[int] = None) -> str:
    if candidate_id:
        c = (await db.execute(select(Candidate).where(Candidate.id == candidate_id))).scalar_one_or_none()
        return c.full_name if c else ""
    if joblens_candidate_id:
        # JobLens-originated interview (Video Interview's "Send Interview
        # Invite" / Phone Interview's "Candidate reached by phone") — see
        # Interview.joblens_candidate_id's docstring.
        from models.models import JobLensCandidate
        jc = (await db.execute(select(JobLensCandidate).where(JobLensCandidate.id == joblens_candidate_id))).scalar_one_or_none()
        return jc.name if jc else ""
    return ""


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


def _fmt_feedback_link(link: InterviewFeedbackLink, submitted_names: set) -> dict:
    return {
        "id": link.id,
        "interviewer_name": link.interviewer_name,
        "interviewer_email": link.interviewer_email or "",
        "is_internal": link.user_id is not None,
        "token": link.token,
        "feedback_url_path": f"/interview-feedback/{link.token}",
        "submitted": link.interviewer_name in submitted_names,
    }


def _fmt_interview(
    i: Interview, candidate_name: str = "", requisition_title: str = "",
    scorecards: Optional[List[dict]] = None, feedback_links: Optional[List[InterviewFeedbackLink]] = None,
) -> dict:
    submitted_names = {s["interviewer_name"] for s in scorecards} if scorecards is not None else set()
    return {
        "id": i.id,
        "sequence_number": i.sequence_number,
        "candidate_id": i.candidate_id,
        "joblens_candidate_id": i.joblens_candidate_id,
        "candidate_name": candidate_name,
        "requisition_id": i.requisition_id,
        "requisition_title": requisition_title,
        "application_id": i.application_id,
        "round_name": i.round_name,
        "interview_type": i.interview_type or "Phone Interview",
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
        "artifacts": i.artifacts or [],
        "cancellation_reason": i.cancellation_reason or "",
        # Round decision (panel majority, or manual override)
        "decision": i.decision or "Pending",
        "decision_finalized_at": i.decision_finalized_at.isoformat() if i.decision_finalized_at else None,
        # Scheduling approval (a designated authority signing off / cancelling)
        "approver_name": i.approver_name or "",
        "approver_email": i.approver_email or "",
        "approver_user_id": i.approver_user_id,
        "approval_status": i.approval_status or "Pending",
        "approval_token": i.approval_token,
        "approval_url_path": f"/interview-approval/{i.approval_token}" if i.approval_token else None,
        "approved_at": i.approved_at.isoformat() if i.approved_at else None,
        "approved_by": i.approved_by or "",
        "cancelled_at": i.cancelled_at.isoformat() if i.cancelled_at else None,
        "cancelled_by": i.cancelled_by or "",
        "scorecard_count": len(scorecards) if scorecards is not None else None,
        "scorecards": scorecards,
        "feedback_links": (
            [_fmt_feedback_link(l, submitted_names) for l in feedback_links] if feedback_links is not None else None
        ),
        "created_at": i.created_at.isoformat() if i.created_at else None,
        "updated_at": i.updated_at.isoformat() if i.updated_at else None,
    }


async def _apply_decision_side_effects(
    db: AsyncSession, org_id: int, interview: Interview, decision: str, triggering_user_id: Optional[int],
) -> None:
    """Shared by both the auto (panel-majority) and manual decision
    paths: advances the linked Application's stage and fires the
    matching communication automation. Best-effort — mirrors the
    Completed-status side effects already in change_interview_status."""
    if decision == "Rejected":
        await service.advance_application_stage(db, interview.application_id, "Rejected")
    elif decision == "Selected":
        await service.advance_application_stage(
            db, interview.application_id,
            "Selected" if interview.interview_type == "Panel Interview" else f"{interview.round_name} Passed",
        )
    elif decision == "Hold":
        await service.advance_application_stage(db, interview.application_id, "On Hold")
    await db.commit()

    candidate = (await db.execute(select(Candidate).where(Candidate.id == interview.candidate_id))).scalar_one_or_none()
    req_title = await _requisition_title(db, interview.requisition_id)
    await service_communication.fire_automation(
        db, org_id, "interview_decision_recorded",
        context={
            "candidate_name": candidate.full_name if candidate else "", "requisition_title": req_title,
            "round_name": interview.round_name, "decision": decision,
        },
        triggering_user_id=triggering_user_id, to_email=(candidate.email if candidate else None) or None,
        candidate_id=interview.candidate_id, requisition_id=interview.requisition_id,
    )
    await db.commit()


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
        raise HTTPException(400, f"Self-scheduling is only available for Phone Interview rounds — {payload.interview_type} interviews must be scheduled directly by a recruiter.")

    status = "Scheduled" if payload.scheduled_at else ("Requested" if payload.proposed_slots else "Requested")
    interviewers = [i.dict() for i in payload.interviewers]
    interview = Interview(
        organisation_id=org.id, owner_user_id=current_user.id,
        sequence_number=await service.get_next_sequence(db, org.id),
        candidate_id=payload.candidate_id, requisition_id=payload.requisition_id,
        application_id=payload.application_id,
        round_name=payload.round_name.strip(), round_number=payload.round_number,
        interview_type=payload.interview_type,
        interviewers=interviewers,
        duration_minutes=payload.duration_minutes, location_or_link=payload.location_or_link.strip(),
        scheduled_at=payload.scheduled_at,
        proposed_slots=[s.isoformat() for s in payload.proposed_slots],
        status=status,
        notes=payload.notes.strip(),
        artifacts=[a.dict() for a in payload.artifacts],
        approver_name=payload.approver_name.strip(), approver_email=payload.approver_email.strip(),
        approver_user_id=payload.approver_user_id,
    )
    if interview.approver_name or interview.approver_email or interview.approver_user_id:
        interview.approval_token = service.generate_token()
    db.add(interview)
    await db.commit()
    await db.refresh(interview)

    await service.sync_feedback_links(db, interview, interviewers)
    await db.commit()

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
    candidate_ids = {i.candidate_id for i in rows if i.candidate_id}
    joblens_candidate_ids = {i.joblens_candidate_id for i in rows if i.joblens_candidate_id}
    requisition_ids = {i.requisition_id for i in rows if i.requisition_id}
    interview_ids = [i.id for i in rows]

    candidate_names = {}
    if candidate_ids:
        res = await db.execute(select(Candidate.id, Candidate.full_name).where(Candidate.id.in_(candidate_ids)))
        candidate_names = dict(res.all())

    # JobLens-originated rows (see Interview.joblens_candidate_id) need
    # their own batch lookup against a different table entirely — a
    # candidate_id-only lookup silently left these blank, since None was
    # never a key in candidate_names.
    if joblens_candidate_ids:
        from models.models import JobLensCandidate
        res = await db.execute(select(JobLensCandidate.id, JobLensCandidate.name).where(JobLensCandidate.id.in_(joblens_candidate_ids)))
        joblens_candidate_names = dict(res.all())
    else:
        joblens_candidate_names = {}

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
        name = candidate_names.get(i.candidate_id, "") if i.candidate_id else joblens_candidate_names.get(i.joblens_candidate_id, "")
        d = _fmt_interview(i, name, requisition_titles.get(i.requisition_id, "") if i.requisition_id else "")
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
    links = (await db.execute(select(InterviewFeedbackLink).where(InterviewFeedbackLink.interview_id == i.id))).scalars().all()
    return _fmt_interview(
        i, await _candidate_name(db, i.candidate_id, i.joblens_candidate_id), await _requisition_title(db, i.requisition_id),
        [_fmt_scorecard(s) for s in scorecards], links,
    )


# ══════════════════════════════════════════════════════════════════════════
# SCHEDULING APPROVAL — a designated authority approves or cancels this
# round, online, via a tokenized link (public_router.py) or in-app if
# they're an internal TalentIQ user.
# ══════════════════════════════════════════════════════════════════════════

@router.post("/interviews/{interview_id}/approval/regenerate-link")
async def regenerate_approval_link(interview_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    i = (await db.execute(select(Interview).where(Interview.id == interview_id, Interview.organisation_id == org.id))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Interview not found")
    if not (i.approver_name or i.approver_email or i.approver_user_id):
        raise HTTPException(400, "Set an approver (name/email or an internal user) before generating an approval link.")
    i.approval_token = service.generate_token()
    i.updated_at = datetime.utcnow()
    await db.commit()
    return {"approval_token": i.approval_token, "approval_url_path": f"/interview-approval/{i.approval_token}"}


@router.post("/interviews/{interview_id}/approval/approve")
async def approve_interview_inapp(interview_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """In-app approval — for when the designated authority IS an internal
    TalentIQ user and would rather click Approve here than use the public
    link. Only the designated approver (or the recruiter who owns the
    interview) may approve."""
    org = await _org(db, current_user)
    i = (await db.execute(select(Interview).where(Interview.id == interview_id, Interview.organisation_id == org.id))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Interview not found")
    if i.approver_user_id and i.approver_user_id != current_user.id and i.owner_user_id != current_user.id:
        raise HTTPException(403, "Only the designated approver can approve this interview.")
    if i.approval_status == "Approved":
        raise HTTPException(400, "This interview has already been approved.")
    i.approval_status = "Approved"
    i.approved_at = datetime.utcnow()
    i.approved_by = current_user.name or current_user.email
    i.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(i)
    return _fmt_interview(i, await _candidate_name(db, i.candidate_id, i.joblens_candidate_id), await _requisition_title(db, i.requisition_id))


# ══════════════════════════════════════════════════════════════════════════
# ROUND DECISION — manual override for rounds with 0-1 interviewers,
# where a panel majority (service.finalize_interview_decision) isn't a
# meaningful concept. e.g. a single phone-screener with no co-interviewer.
# ══════════════════════════════════════════════════════════════════════════

@router.post("/interviews/{interview_id}/decision")
async def set_decision(
    interview_id: int, payload: DecisionSet,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    if payload.decision not in DECISION_STATUSES or payload.decision == "Pending":
        raise HTTPException(400, f"decision must be one of: Selected, Rejected, Hold")
    org = await _org(db, current_user)
    i = (await db.execute(select(Interview).where(Interview.id == interview_id, Interview.organisation_id == org.id))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Interview not found")
    if len(i.interviewers or []) >= 2:
        raise HTTPException(
            400,
            "This round has 2+ interviewers — its decision is determined by panel majority, "
            "not a manual override. Submit or wait for scorecards instead.",
        )
    i.decision = payload.decision
    i.decision_finalized_at = datetime.utcnow()
    if i.status not in ("Cancelled",):
        i.status = "Completed"
    i.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(i)
    await _apply_decision_side_effects(db, org.id, i, payload.decision, current_user.id)
    await db.refresh(i)
    return _fmt_interview(i, await _candidate_name(db, i.candidate_id, i.joblens_candidate_id), await _requisition_title(db, i.requisition_id))


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
    if "artifacts" in data and data["artifacts"] is not None:
        data["artifacts"] = [x if isinstance(x, dict) else x.dict() for x in data["artifacts"]]
    new_interviewers = data.get("interviewers")
    for field, value in data.items():
        setattr(i, field, value)
    if payload.scheduled_at and i.status == "Requested":
        i.status = "Scheduled"
    # (Re)generate the approval link the moment an authority is named, if
    # one isn't already set — matches create_interview's behaviour.
    if (i.approver_name or i.approver_email or i.approver_user_id) and not i.approval_token:
        i.approval_token = service.generate_token()
    i.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(i)
    if new_interviewers is not None:
        await service.sync_feedback_links(db, i, new_interviewers)
        await db.commit()
    return _fmt_interview(i, await _candidate_name(db, i.candidate_id, i.joblens_candidate_id), await _requisition_title(db, i.requisition_id))


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
        i.cancelled_at = datetime.utcnow()
        i.cancelled_by = current_user.name or current_user.email
        i.approval_status = "Cancelled"
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

    return _fmt_interview(i, await _candidate_name(db, i.candidate_id, i.joblens_candidate_id), await _requisition_title(db, i.requisition_id))


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
        raise HTTPException(400, f"Self-scheduling is only available for Phone Interview rounds — {i.interview_type} interviews must be scheduled directly by a recruiter, not left to a candidate-facing link.")
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
        raise HTTPException(400, f"Self-scheduling is only available for Phone Interview rounds — {i.interview_type} interviews must be scheduled directly by a recruiter, not left to a candidate-facing link.")
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

    decision = await service.finalize_interview_decision(db, i)
    if decision:
        await db.commit()
        await db.refresh(i)
        await _apply_decision_side_effects(db, org.id, i, decision, current_user.id)

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

    if "recommendation" in data:
        i = (await db.execute(select(Interview).where(Interview.id == s.interview_id))).scalar_one_or_none()
        if i:
            decision = await service.finalize_interview_decision(db, i)
            if decision:
                await db.commit()
                await db.refresh(i)
                await _apply_decision_side_effects(db, org.id, i, decision, current_user.id)

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
