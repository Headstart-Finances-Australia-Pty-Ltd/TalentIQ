"""
TalentIQ — Interview self-scheduling, approval, and panel feedback
(public, unauthenticated)

Registered in main.py as: /api/public/interviews/*
Mirrors the proven token-as-auth pattern already used for the candidate
portal, hiring-manager view link, and CandidateLens public interview
flow — the long random token IS the authentication, no candidate login
system required. Three independent token flows share this router:
  - /{token}(/confirm)                self-scheduling (candidate)
  - /approval/{token}(/approve|/cancel)  scheduling approval (the
                                       designated authority — internal or
                                       external)
  - /feedback/{token}(/submit)        one panel member's scorecard
                                       (internal or external)
"""
from datetime import datetime

from fastapi import APIRouter, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from db.database import AsyncSessionLocal
from capabilities.acquisition.models import Candidate
from capabilities.requisition.models import Requisition

from .models import Interview, InterviewScorecard, InterviewFeedbackLink
from .schemas import PublicSlotConfirm, PublicApprovalDecision, PublicFeedbackSubmit
from . import service

router = APIRouter()


async def _get_db():
    async with AsyncSessionLocal() as db:
        yield db


async def _candidate_summary(db: AsyncSession, i: Interview) -> dict:
    candidate = (await db.execute(select(Candidate).where(Candidate.id == i.candidate_id))).scalar_one_or_none()
    requisition_title = ""
    if i.requisition_id:
        req = (await db.execute(select(Requisition).where(Requisition.id == i.requisition_id))).scalar_one_or_none()
        requisition_title = req.title if req else ""
    return {
        "candidate_name": candidate.full_name if candidate else "",
        "requisition_title": requisition_title,
        "round_name": i.round_name,
        "round_number": i.round_number,
        "interview_type": i.interview_type,
        "scheduled_at": i.scheduled_at.isoformat() if i.scheduled_at else None,
        "duration_minutes": i.duration_minutes,
        "location_or_link": i.location_or_link or "",
        "notes": i.notes or "",
        "interviewers": [x.get("name") for x in (i.interviewers or [])],
    }


@router.get("/{token}")
async def public_get_schedule_request(token: str):
    async with AsyncSessionLocal() as db:
        i = (await db.execute(select(Interview).where(Interview.self_schedule_token == token))).scalar_one_or_none()
        if not i:
            raise HTTPException(404, "This scheduling link is invalid or has expired.")
        candidate = (await db.execute(select(Candidate).where(Candidate.id == i.candidate_id))).scalar_one_or_none()
        requisition_title = ""
        if i.requisition_id:
            req = (await db.execute(select(Requisition).where(Requisition.id == i.requisition_id))).scalar_one_or_none()
            requisition_title = req.title if req else ""
        return {
            "round_name": i.round_name,
            "candidate_name": candidate.full_name if candidate else "",
            "requisition_title": requisition_title,
            "duration_minutes": i.duration_minutes,
            "location_or_link": i.location_or_link or "",
            "interviewers": i.interviewers or [],
            "proposed_slots": i.proposed_slots or [],
            "already_confirmed": i.status == "Scheduled",
            "confirmed_slot": i.scheduled_at.isoformat() if i.scheduled_at else None,
        }


@router.post("/{token}/confirm")
async def public_confirm_slot(token: str, payload: PublicSlotConfirm):
    async with AsyncSessionLocal() as db:
        i = (await db.execute(select(Interview).where(Interview.self_schedule_token == token))).scalar_one_or_none()
        if not i:
            raise HTTPException(404, "This scheduling link is invalid or has expired.")
        if i.status == "Scheduled":
            raise HTTPException(400, "A time has already been confirmed for this interview.")
        # Compare parsed datetime VALUES, not raw ISO strings — pydantic
        # re-serializing a parsed datetime doesn't always reproduce the
        # exact original string (trailing zeros, timezone notation), so a
        # naive string-equality check could reject a legitimately-selected
        # slot.
        proposed_dt = [datetime.fromisoformat(s) for s in (i.proposed_slots or [])]
        if payload.selected_slot not in proposed_dt:
            raise HTTPException(400, "That time isn't one of the proposed options — please pick one from the list.")
        i.scheduled_at = payload.selected_slot
        i.status = "Scheduled"
        i.candidate_selected_at = datetime.utcnow()
        i.updated_at = datetime.utcnow()
        await db.commit()
        return {"confirmed": True, "scheduled_at": i.scheduled_at.isoformat()}


# ══════════════════════════════════════════════════════════════════════════
# SCHEDULING APPROVAL — the designated authority reviews, approves, or
# cancels this round via their tokenized link. No login required; the
# token itself identifies who's asking.
# ══════════════════════════════════════════════════════════════════════════

@router.get("/approval/{token}")
async def public_get_approval_request(token: str):
    async with AsyncSessionLocal() as db:
        i = (await db.execute(select(Interview).where(Interview.approval_token == token))).scalar_one_or_none()
        if not i:
            raise HTTPException(404, "This approval link is invalid or has expired.")
        return {
            **await _candidate_summary(db, i),
            "approver_name": i.approver_name or "",
            "approval_status": i.approval_status,
            "status": i.status,
            "approved_at": i.approved_at.isoformat() if i.approved_at else None,
            "approved_by": i.approved_by or "",
            "cancelled_at": i.cancelled_at.isoformat() if i.cancelled_at else None,
        }


@router.post("/approval/{token}/approve")
async def public_approve(token: str):
    async with AsyncSessionLocal() as db:
        i = (await db.execute(select(Interview).where(Interview.approval_token == token))).scalar_one_or_none()
        if not i:
            raise HTTPException(404, "This approval link is invalid or has expired.")
        if i.status == "Cancelled":
            raise HTTPException(400, "This interview has already been cancelled and can no longer be approved.")
        if i.approval_status == "Approved":
            raise HTTPException(400, "This interview has already been approved.")
        i.approval_status = "Approved"
        i.approved_at = datetime.utcnow()
        i.approved_by = i.approver_name or i.approver_email or "External approver"
        i.updated_at = datetime.utcnow()
        await db.commit()
        return {"approved": True, "approved_at": i.approved_at.isoformat()}


@router.post("/approval/{token}/cancel")
async def public_cancel(token: str, payload: PublicApprovalDecision):
    async with AsyncSessionLocal() as db:
        i = (await db.execute(select(Interview).where(Interview.approval_token == token))).scalar_one_or_none()
        if not i:
            raise HTTPException(404, "This approval link is invalid or has expired.")
        if i.status == "Cancelled":
            raise HTTPException(400, "This interview has already been cancelled.")
        i.status = "Cancelled"
        i.approval_status = "Cancelled"
        i.cancellation_reason = payload.reason.strip()
        i.cancelled_at = datetime.utcnow()
        i.cancelled_by = i.approver_name or i.approver_email or "External approver"
        i.updated_at = datetime.utcnow()
        await db.commit()
        return {"cancelled": True, "cancelled_at": i.cancelled_at.isoformat()}


# ══════════════════════════════════════════════════════════════════════════
# PANEL FEEDBACK — one interviewer's scorecard, submitted online via
# their personal tokenized link. Works identically whether that
# interviewer is an internal TalentIQ user or an external panelist —
# the token IS the identity here, not a login session.
# ══════════════════════════════════════════════════════════════════════════

@router.get("/feedback/{token}")
async def public_get_feedback_form(token: str):
    async with AsyncSessionLocal() as db:
        link = (await db.execute(select(InterviewFeedbackLink).where(InterviewFeedbackLink.token == token))).scalar_one_or_none()
        if not link:
            raise HTTPException(404, "This feedback link is invalid or has expired.")
        i = (await db.execute(select(Interview).where(Interview.id == link.interview_id))).scalar_one_or_none()
        if not i:
            raise HTTPException(404, "This feedback link is invalid or has expired.")
        existing = (await db.execute(
            select(InterviewScorecard).where(
                InterviewScorecard.interview_id == i.id,
                InterviewScorecard.interviewer_name == link.interviewer_name,
            )
        )).scalar_one_or_none()
        return {
            **await _candidate_summary(db, i),
            "interviewer_name": link.interviewer_name,
            "already_submitted": existing is not None,
            "existing_feedback": _fmt_public_scorecard(existing) if existing else None,
            "interview_status": i.status,
        }


def _fmt_public_scorecard(s: InterviewScorecard) -> dict:
    return {
        "recommendation": s.recommendation or "",
        "criteria_scores": s.criteria_scores or [],
        "strengths": s.strengths or "",
        "concerns": s.concerns or "",
        "overall_notes": s.overall_notes or "",
        "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
    }


@router.post("/feedback/{token}")
async def public_submit_feedback(token: str, payload: PublicFeedbackSubmit):
    async with AsyncSessionLocal() as db:
        link = (await db.execute(select(InterviewFeedbackLink).where(InterviewFeedbackLink.token == token))).scalar_one_or_none()
        if not link:
            raise HTTPException(404, "This feedback link is invalid or has expired.")
        i = (await db.execute(select(Interview).where(Interview.id == link.interview_id))).scalar_one_or_none()
        if not i:
            raise HTTPException(404, "This feedback link is invalid or has expired.")
        if i.status == "Cancelled":
            raise HTTPException(400, "This interview was cancelled — feedback can no longer be submitted.")

        existing = (await db.execute(
            select(InterviewScorecard).where(
                InterviewScorecard.interview_id == i.id,
                InterviewScorecard.interviewer_name == link.interviewer_name,
            )
        )).scalar_one_or_none()
        if existing:
            raise HTTPException(400, "You've already submitted feedback for this interview.")

        scorecard = InterviewScorecard(
            interview_id=i.id, submitted_by_user_id=link.user_id,
            interviewer_name=link.interviewer_name,
            recommendation=payload.recommendation,
            criteria_scores=[c.dict() for c in payload.criteria_scores],
            strengths=payload.strengths.strip(), concerns=payload.concerns.strip(),
            overall_notes=payload.overall_notes.strip(),
        )
        db.add(scorecard)
        await db.commit()
        await db.refresh(scorecard)

        # Recompute the panel's majority decision — same engine the
        # authenticated /scorecards endpoint uses — and, if it resolves,
        # apply the same side effects (advance the Application's stage,
        # fire the "interview_decision_recorded" automation). The
        # triggering user is the recruiter who owns this interview, since
        # an external panelist isn't a TalentIQ account.
        decision = await service.finalize_interview_decision(db, i)
        if decision:
            await db.commit()
            await db.refresh(i)
            from .router import _apply_decision_side_effects
            await _apply_decision_side_effects(db, i.organisation_id, i, decision, i.owner_user_id)

        return {"submitted": True}
