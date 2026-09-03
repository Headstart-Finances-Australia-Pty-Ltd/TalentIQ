"""
TalentIQ — Capability: Interview Management (Phase 4, authenticated)

Registered in main.py as: /api/interviews/*
Public (candidate self-scheduling) endpoints live in public_router.py,
registered as: /api/public/interviews/*
"""
from datetime import datetime, timezone
from typing import List, Optional
import os

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
import io
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete as sa_delete

from db.database import get_db
from models.models import User, UserAPIKey
from utils.auth_utils import get_current_user
from utils.email_send import get_smtp_config, send_email
from utils.credentials import get_all_credentials
from capabilities.acquisition import service as acquisition_service
from capabilities.acquisition.models import Candidate, Application
from capabilities.requisition.models import Requisition
from capabilities.communication import service as service_communication

from .models import (
    Interview, InterviewScorecard, InterviewFeedbackLink, PanelInterviewer, InterviewPanel,
    INTERVIEW_STATUSES, INTERVIEW_TYPES, SELF_SCHEDULABLE_TYPES,
    DECISION_STATUSES, InterviewDecisionApprover,
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


def _fmt_decision_approver(a: "InterviewDecisionApprover") -> dict:
    return {
        "id": a.id,
        "approver_name": a.approver_name,
        "approver_email": a.approver_email,
        "status": a.status,
        "comments": a.comments or "",
        "decided_at": a.decided_at.isoformat() if a.decided_at else None,
        "invited_at": a.invited_at.isoformat() if a.invited_at else None,
    }


def _fmt_interview(
    i: Interview, candidate_name: str = "", requisition_title: str = "",
    scorecards: Optional[List[dict]] = None, feedback_links: Optional[List[InterviewFeedbackLink]] = None,
    decision_approvers: Optional[List[dict]] = None,
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
        "calendly_link_sent_at": i.calendly_link_sent_at.isoformat() if i.calendly_link_sent_at else None,
        "video_invite_sent_at": i.video_invite_sent_at.isoformat() if i.video_invite_sent_at else None,
        "invite_sent_at": i.invite_sent_at.isoformat() if i.invite_sent_at else None,
        "rejection_email_sent_at": i.rejection_email_sent_at.isoformat() if i.rejection_email_sent_at else None,
        # Hiring-decision approval — see models.py's decision_approval_*
        # docstring for how this differs from approval_status above.
        "decision_approval_status": i.decision_approval_status or "Pending",
        "decision_approved_by": i.decision_approved_by or "",
        "decision_approved_at": i.decision_approved_at.isoformat() if i.decision_approved_at else None,
        "decision_approval_notes": i.decision_approval_notes or "",
        "decision_approval_attachment_filename": i.decision_approval_attachment_filename or "",
        "has_decision_approval_attachment": bool(i.decision_approval_attachment_blob),
        # Online approvers (see InterviewDecisionApprover) — the "send an
        # email to the approver" alternative to filling in the manual
        # popup fields above. Multiple people can be asked to weigh in
        # on the same round independently.
        "decision_approvers": decision_approvers or [],
        # Telephony (click-to-call + SMS scheduling — see utils/telephony.py)
        "phone_call_status": i.phone_call_status or "",
        "phone_called_at": i.phone_called_at.isoformat() if i.phone_called_at else None,
        "call_sms_sent_at": i.call_sms_sent_at.isoformat() if i.call_sms_sent_at else None,
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
        # When this round was actually COMPLETED — see the column's
        # docstring in models.py. Was added to the DB a few rounds ago
        # but never actually surfaced here, so nothing calling this
        # endpoint could ever see it despite the column being populated.
        "completed_at": i.completed_at.isoformat() if i.completed_at else None,
        "panel_id": i.panel_id,
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
    if not payload.candidate_id and not payload.joblens_candidate_id:
        raise HTTPException(400, "Either candidate_id or joblens_candidate_id is required.")
    candidate_name = ""
    if payload.candidate_id:
        candidate = (await db.execute(select(Candidate).where(Candidate.id == payload.candidate_id, Candidate.organisation_id == org.id))).scalar_one_or_none()
        if not candidate:
            raise HTTPException(404, "Candidate not found in your organisation.")
        candidate_name = candidate.full_name
    else:
        from models.models import JobLensCandidate as _JLC
        jlc = (await db.execute(select(_JLC.id, _JLC.name).where(_JLC.id == payload.joblens_candidate_id))).first()
        if not jlc:
            raise HTTPException(404, "Candidate not found.")
        candidate_name = jlc.name
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
    # If a Panel Setup was picked, populate the interviewers snapshot
    # from its members automatically — the recruiter shouldn't have to
    # both pick a panel AND separately re-type the same people into the
    # interviewers list by hand.
    if payload.panel_id and not interviewers:
        panel = (await db.execute(select(InterviewPanel).where(InterviewPanel.id == payload.panel_id, InterviewPanel.organisation_id == org.id))).scalar_one_or_none()
        if panel and panel.interviewer_ids:
            people = (await db.execute(select(PanelInterviewer).where(PanelInterviewer.id.in_(panel.interviewer_ids)))).scalars().all()
            interviewers = [{"name": p.name, "email": p.email or ""} for p in people]
    interview = Interview(
        organisation_id=org.id, owner_user_id=current_user.id,
        sequence_number=await service.get_next_sequence(db, org.id),
        candidate_id=payload.candidate_id, joblens_candidate_id=payload.joblens_candidate_id,
        requisition_id=payload.requisition_id,
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
        panel_id=payload.panel_id,
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
        candidate_email = None
        if payload.candidate_id:
            candidate_email = candidate.email or None
        else:
            from models.models import JobLensCandidate as _JLC2
            jlc_row = (await db.execute(select(_JLC2.email).where(_JLC2.id == payload.joblens_candidate_id))).first()
            candidate_email = jlc_row[0] if jlc_row else None
        await service_communication.fire_automation(
            db, org.id, "interview_scheduled",
            context={"candidate_name": candidate_name, "requisition_title": req_title, "round_name": interview.round_name,
                     "interview_time": interview.scheduled_at.strftime("%A, %B %d at %I:%M %p") if interview.scheduled_at else "",
                     "location_or_link": interview.location_or_link or ""},
            triggering_user_id=current_user.id, to_email=candidate_email,
            candidate_id=payload.candidate_id, requisition_id=interview.requisition_id,
        )
        await db.commit()

    return _fmt_interview(interview, candidate_name, await _requisition_title(db, interview.requisition_id))


@router.get("/interviews")
async def list_interviews(
    candidate_id: Optional[int] = None,
    requisition_id: Optional[int] = None,
    status: Optional[str] = None,
    upcoming_only: bool = False,
    passed_screening_only: bool = False,
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

    requisition_meta = {}
    if requisition_ids:
        from models.models import Client
        res = await db.execute(
            select(Requisition.id, Requisition.title, Requisition.sequence_number, Client.name)
            .outerjoin(Client, Requisition.client_id == Client.id)
            .where(Requisition.id.in_(requisition_ids))
        )
        for rid, title, seq, client_name in res.all():
            requisition_meta[rid] = {"title": title, "number": seq, "company": client_name or ""}

    # JobLens-originated rows never get a real requisition_id (JobLens
    # doesn't necessarily go through the Requisition/Application system
    # at all — a CandidateLens session can exist as a standalone JD
    # paste) — so requisition_title always showed as blank/"—" for every
    # one of them, even though the session it came from always has a
    # role name. Surfacing that instead so "Isabela — Accountant" reads
    # the same way a Talent-Pool candidate's requisition title would.
    # Same idea as requisition_meta above, but keyed by joblens_candidate_id
    # and using the session's own JD role/company since there's no real
    # Requisition row to join against for a standalone CandidateLens
    # session (see comment above).
    joblens_meta = {}
    if joblens_candidate_ids:
        from models.models import JobLensCandidate, JobLensSession
        res = await db.execute(
            select(JobLensCandidate.id, JobLensSession.jd_role, JobLensSession.jd_company)
            .join(JobLensSession, JobLensCandidate.session_id == JobLensSession.id)
            .where(JobLensCandidate.id.in_(joblens_candidate_ids))
        )
        for cid, role, company in res.all():
            joblens_meta[cid] = {"role": role or "Untitled role", "company": company or ""}

    # Interview Decision only wants candidates who actually PASSED
    # Screening Decision — a candidate marked "Not Qualified" there
    # shouldn't also clutter the interview-round view (see
    # JobLensPage.tsx's Screening Decision "status"/"shortlisted"
    # fields, the same two checks that page itself uses to decide who
    # counts as passed). Rows with no joblens_candidate_id at all (an
    # ATS Candidate hired outside JobLens screening entirely) are always
    # considered passed — there's no screening record to fail.
    #
    # screening_summary is the same underlying data condensed into the
    # single hyphen-separated string the Interview Scheduling table
    # shows per the recruiter's request — e.g. "Completed - Qualified -
    # 82% - 2026-08-20" — so the table doesn't need four separate
    # columns (and four separate lookups on the frontend) for one
    # already-available fact set. Session status ("completed"/
    # "processing") stands in for "has resume screening finished for
    # this batch" since JobLensCandidate rows don't carry their own
    # separate completion flag — see JobLensSession.status.
    screening_passed = {}
    screening_summary = {}
    if joblens_candidate_ids:
        from models.models import JobLensCandidate as _JLC, JobLensSession as _JLS
        res = await db.execute(
            select(_JLC.id, _JLC.status, _JLC.shortlisted, _JLC.ats_score, _JLS.status, _JLS.created_at)
            .join(_JLS, _JLC.session_id == _JLS.id)
            .where(_JLC.id.in_(joblens_candidate_ids))
        )
        for cid, status_, shortlisted_, ats_score_, session_status_, session_created_at_ in res.all():
            screening_passed[cid] = bool(shortlisted_) or status_ == "Qualified"
            screening_complete = "Completed" if (session_status_ or "").lower() == "completed" else "Pending"
            score_display = f"{round(ats_score_ or 0)}%"
            date_display = session_created_at_.strftime("%Y-%m-%d") if session_created_at_ else "—"
            screening_summary[cid] = " - ".join([screening_complete, status_ or "Not Qualified", score_display, date_display])

    if passed_screening_only:
        rows = [i for i in rows if not i.joblens_candidate_id or screening_passed.get(i.joblens_candidate_id, True)]
        interview_ids = [i.id for i in rows]
        panel_ids = {i.panel_id for i in rows if i.panel_id}

    scorecard_counts = {}
    if interview_ids:
        res = await db.execute(
            select(InterviewScorecard.interview_id, func.count())
            .where(InterviewScorecard.interview_id.in_(interview_ids))
            .group_by(InterviewScorecard.interview_id)
        )
        scorecard_counts = dict(res.all())

    # Feedback links (panel-member tokenized links, see
    # InterviewFeedbackLink's docstring) — grouped by interview_id so
    # Interview Scheduling's Panel Interview column can show a real,
    # clickable link (or several) instead of nothing, without the
    # frontend having to make a separate per-row request for something
    # already cheap to fetch in one batch here.
    feedback_links_by_interview: dict = {}
    if interview_ids:
        res = await db.execute(
            select(InterviewFeedbackLink).where(InterviewFeedbackLink.interview_id.in_(interview_ids))
        )
        for link in res.scalars().all():
            feedback_links_by_interview.setdefault(link.interview_id, []).append(
                {"interviewer_name": link.interviewer_name, "url_path": f"/interview-feedback/{link.token}"}
            )

    panel_ids = {i.panel_id for i in rows if i.panel_id}
    panel_numbers = {}
    if panel_ids:
        pres = await db.execute(select(InterviewPanel.id, InterviewPanel.sequence_number).where(InterviewPanel.id.in_(panel_ids)))
        panel_numbers = dict(pres.all())

    # Online decision-approvers (see InterviewDecisionApprover) — batch
    # fetched the same way scorecards/feedback links are above.
    decision_approvers_by_interview: dict = {}
    if interview_ids:
        res = await db.execute(
            select(InterviewDecisionApprover).where(InterviewDecisionApprover.interview_id.in_(interview_ids))
        )
        for a in res.scalars().all():
            decision_approvers_by_interview.setdefault(a.interview_id, []).append(_fmt_decision_approver(a))

    out = []
    for i in rows:
        name = candidate_names.get(i.candidate_id, "") if i.candidate_id else joblens_candidate_names.get(i.joblens_candidate_id, "")
        if i.requisition_id:
            meta = requisition_meta.get(i.requisition_id, {})
            req_number, req_role, req_company = meta.get("number"), meta.get("title", ""), meta.get("company", "")
        else:
            meta = joblens_meta.get(i.joblens_candidate_id, {})
            req_number, req_role, req_company = None, meta.get("role", ""), meta.get("company", "")
        d = _fmt_interview(i, name, req_role, decision_approvers=decision_approvers_by_interview.get(i.id, []))
        d["requisition_number"] = req_number
        d["requisition_role"] = req_role
        d["company"] = req_company
        d["panel_number"] = panel_numbers.get(i.panel_id) if i.panel_id else None
        d["scorecard_count"] = scorecard_counts.get(i.id, 0)
        d["feedback_links_summary"] = feedback_links_by_interview.get(i.id, [])
        d["screening_passed"] = screening_passed.get(i.joblens_candidate_id, True) if i.joblens_candidate_id else True
        d["screening_summary"] = screening_summary.get(i.joblens_candidate_id, "—") if i.joblens_candidate_id else "—"
        d.pop("scorecards", None)
        out.append(d)
    return out


class PanelInterviewerCreate(BaseModel):
    name: str
    expertise_area: str = ""
    company: str = ""
    interviewer_type: str = "Internal"  # "Internal" or "External"
    phone: str = ""
    email: str = ""
    notes: str = ""


def _fmt_panel_interviewer(p: PanelInterviewer, assignments: Optional[List[dict]] = None) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "expertise_area": p.expertise_area or "",
        "company": p.company or "",
        "interviewer_type": p.interviewer_type or "Internal",
        "phone": p.phone or "",
        "email": p.email or "",
        "notes": p.notes or "",
        "assignments": assignments if assignments is not None else [],
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


class InterviewPanelCreate(BaseModel):
    role_for: str = ""
    company: str = ""
    interviewer_ids: List[int] = []
    setup_date: Optional[str] = None  # ISO date/datetime, optional


def _parse_setup_date(iso_str: Optional[str]) -> Optional[datetime]:
    """Parses an ISO date/datetime string into a naive UTC datetime,
    matching this table's plain TIMESTAMP (no timezone) column and the
    rest of the app's convention (datetime.utcnow() everywhere else is
    naive too). Parsing with "+00:00" instead of stripping "Z" produces
    a timezone-AWARE datetime — asyncpg then refuses to write it into a
    timezone-naive column ("can't subtract offset-naive and offset-
    aware datetimes"), which is exactly the DataError this caused
    before stripping tzinfo here. Raises HTTPException(400) with a
    readable message on anything that doesn't parse, rather than
    letting a ValueError become an opaque 500."""
    if not iso_str:
        return None
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, f"Panel Setup Date isn't a valid date: {iso_str!r}")
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


async def _fmt_interview_panel(db: AsyncSession, p: InterviewPanel, people_by_id: Optional[dict] = None) -> dict:
    if people_by_id is None:
        rows = (await db.execute(select(PanelInterviewer).where(PanelInterviewer.id.in_(p.interviewer_ids or [])))).scalars().all()
        people_by_id = {x.id: x for x in rows}
    members = [
        {"id": pid, "name": people_by_id[pid].name, "expertise_area": people_by_id[pid].expertise_area or "",
         "company": people_by_id[pid].company or "", "interviewer_type": people_by_id[pid].interviewer_type or "Internal",
         "phone": people_by_id[pid].phone or "", "email": people_by_id[pid].email or ""}
        for pid in (p.interviewer_ids or []) if pid in people_by_id
    ]
    return {
        "id": p.id,
        "panel_number": p.sequence_number,
        "role_for": p.role_for or "",
        "company": p.company or "",
        "interviewer_ids": p.interviewer_ids or [],
        "members": members,
        "setup_date": p.setup_date.isoformat() if p.setup_date else None,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


@router.get("/panels")
async def list_interview_panels(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    panels = (await db.execute(
        select(InterviewPanel).where(InterviewPanel.organisation_id == org.id).order_by(InterviewPanel.sequence_number.desc())
    )).scalars().all()
    if not panels:
        return []
    all_ids = {pid for p in panels for pid in (p.interviewer_ids or [])}
    people = (await db.execute(select(PanelInterviewer).where(PanelInterviewer.id.in_(all_ids)))).scalars().all() if all_ids else []
    people_by_id = {x.id: x for x in people}
    return [await _fmt_interview_panel(db, p, people_by_id) for p in panels]


@router.get("/panels/{panel_id}")
async def get_interview_panel(panel_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Used by Interview Scheduling's Panel column — clicking a panel
    number fetches this to show the full member list in a popup."""
    org = await _org(db, current_user)
    p = (await db.execute(select(InterviewPanel).where(InterviewPanel.id == panel_id, InterviewPanel.organisation_id == org.id))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Panel not found")
    return await _fmt_interview_panel(db, p)


@router.post("/panels")
async def create_interview_panel(payload: InterviewPanelCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    setup_date = _parse_setup_date(payload.setup_date)
    try:
        seq = (await db.execute(select(func.max(InterviewPanel.sequence_number)).where(InterviewPanel.organisation_id == org.id))).scalar() or 0
        p = InterviewPanel(
            organisation_id=org.id, sequence_number=seq + 1, role_for=payload.role_for,
            company=payload.company, interviewer_ids=payload.interviewer_ids, setup_date=setup_date,
        )
        db.add(p)
        await db.flush()
        await db.commit()
    except HTTPException:
        raise
    except Exception as e:
        # Surface the real cause instead of letting it bubble up as an
        # opaque 500 that the frontend can only show as "Failed to save."
        # — that generic fallback text is exactly what shows up when
        # response.data has no "detail" key, which is what an unhandled
        # exception (rather than a clean HTTPException) produces.
        await db.rollback()
        raise HTTPException(500, f"Couldn't save this panel: {str(e)[:200]}")
    return await _fmt_interview_panel(db, p)


@router.put("/panels/{panel_id}")
async def update_interview_panel(panel_id: int, payload: InterviewPanelCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    p = (await db.execute(select(InterviewPanel).where(InterviewPanel.id == panel_id, InterviewPanel.organisation_id == org.id))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Panel not found")
    setup_date = _parse_setup_date(payload.setup_date)
    try:
        p.role_for = payload.role_for
        p.company = payload.company
        p.interviewer_ids = payload.interviewer_ids
        p.setup_date = setup_date
        p.updated_at = datetime.utcnow()
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(500, f"Couldn't save this panel: {str(e)[:200]}")
    return await _fmt_interview_panel(db, p)


@router.delete("/panels/{panel_id}")
async def delete_interview_panel(panel_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    p = (await db.execute(select(InterviewPanel).where(InterviewPanel.id == panel_id, InterviewPanel.organisation_id == org.id))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Panel not found")
    # Detach any interviews still pointing at it rather than blocking the
    # delete — a removed panel setup shouldn't make past interview rows
    # un-deletable/un-editable.
    await db.execute(Interview.__table__.update().where(Interview.panel_id == panel_id).values(panel_id=None))
    await db.delete(p)
    await db.commit()
    return {"deleted": True}


@router.get("/panel-interviewers")
async def list_panel_interviewers(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Directory of panel experts + their DERIVED "Assignment" column —
    every Interview Panel setup (see InterviewPanel) whose interviewer_ids
    includes this person, i.e. which numbered panels + roles they've
    actually been put on. Derived rather than stored so it can never
    drift out of sync with the real panel data — a person's roster entry
    (name, expertise, contact info) is the only thing actually owned here."""
    org = await _org(db, current_user)
    people = (await db.execute(
        select(PanelInterviewer).where(PanelInterviewer.organisation_id == org.id).order_by(PanelInterviewer.name)
    )).scalars().all()
    if not people:
        return []

    panels = (await db.execute(select(InterviewPanel).where(InterviewPanel.organisation_id == org.id))).scalars().all()
    assignments_by_person: dict = {}
    for panel in panels:
        for pid in (panel.interviewer_ids or []):
            assignments_by_person.setdefault(pid, []).append({
                "panel_id": panel.id, "panel_number": panel.sequence_number, "role_for": panel.role_for or "",
            })

    return [
        _fmt_panel_interviewer(p, assignments_by_person.get(p.id, []))
        for p in people
    ]


@router.post("/panel-interviewers")
async def create_panel_interviewer(payload: PanelInterviewerCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    p = PanelInterviewer(organisation_id=org.id, **payload.dict())
    db.add(p)
    await db.flush()
    await db.commit()
    return _fmt_panel_interviewer(p)


@router.put("/panel-interviewers/{interviewer_id}")
async def update_panel_interviewer(interviewer_id: int, payload: PanelInterviewerCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    p = (await db.execute(select(PanelInterviewer).where(PanelInterviewer.id == interviewer_id, PanelInterviewer.organisation_id == org.id))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Panel interviewer not found")
    for k, v in payload.dict().items():
        setattr(p, k, v)
    p.updated_at = datetime.utcnow()
    await db.commit()
    return _fmt_panel_interviewer(p)


@router.delete("/panel-interviewers/{interviewer_id}")
async def delete_panel_interviewer(interviewer_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    p = (await db.execute(select(PanelInterviewer).where(PanelInterviewer.id == interviewer_id, PanelInterviewer.organisation_id == org.id))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Panel interviewer not found")
    await db.delete(p)
    await db.commit()
    return {"deleted": True}


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
    # Same auto-populate as create_interview: picking a panel without
    # separately retyping the same people into the interviewers list.
    # Checks "empty" rather than "omitted" (unlike create_interview's
    # payload, which can genuinely omit the field, the frontend always
    # sends `interviewers: []` here when the user didn't type any in
    # manually — an omitted-only check would never fire on update).
    if data.get("panel_id") and not new_interviewers:
        panel = (await db.execute(select(InterviewPanel).where(InterviewPanel.id == data["panel_id"], InterviewPanel.organisation_id == org.id))).scalar_one_or_none()
        if panel and panel.interviewer_ids:
            people = (await db.execute(select(PanelInterviewer).where(PanelInterviewer.id.in_(panel.interviewer_ids)))).scalars().all()
            new_interviewers = [{"name": p.name, "email": p.email or ""} for p in people]
            data["interviewers"] = new_interviewers
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
        "configured": bool(creds["booking_url"]) or bool(creds["api_key"] and creds["event_type_uri"]),
        "has_booking_url": bool(creds["booking_url"]),
        "has_token": bool(creds["api_key"]),
        "has_event_type": bool(creds["event_type_uri"]),
    }


@router.get("/meeting-link")
async def get_meeting_link(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """The saved default video-call link (Settings > API Keys > Meeting
    Link) — used by the Schedule Interview form to pre-fill Location/
    Meeting Link when left blank, so a recruiter isn't stuck manually
    retyping (or forgetting to set) the same Zoom/Teams/Meet link every
    time. Not a secret, so safe to return as-is rather than a
    configured/not-configured boolean like calendly_status above."""
    creds = await get_all_credentials(db, current_user.id, "meeting_platform")
    return {"platform": creds.get("platform") or "", "link": creds.get("link") or ""}


@router.get("/calendly/event-types")
async def calendly_event_types(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Used by the Settings page: fetches the recruiter's own Calendly
    event types by name, so they can pick one instead of hand-copying a
    raw API URI out of Calendly's developer tools."""
    creds = await service.get_calendly_credentials(db, current_user.id)
    if not creds["api_key"]:
        raise HTTPException(400, "Save your Calendly Personal Access Token first.")
    return await service.fetch_calendly_event_types(creds["api_key"])


# ── Calendly webhook — automatic booking sync ────────────────────────────
# The docstring on Interview.calendly_scheduling_url used to say this
# wasn't wired up ("requires a publicly reachable URL + signing secret
# configured in the recruiter's own Calendly account, which this app
# can't set up on their behalf"). It can, in fact, be set up on their
# behalf — Calendly's API creates the subscription directly given their
# own Personal Access Token, no manual dashboard step needed. Requires
# this deployment's PUBLIC_BASE_URL env var to be set (same requirement
# NavTalk's webhook has) since Calendly needs a real, internet-reachable
# URL to POST to — this only works once the app is actually deployed
# somewhere reachable, not on a bare localhost dev server.
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "")


async def _upsert_calendly_key(db: AsyncSession, user_id: int, key_name: str, value: str) -> None:
    existing = (await db.execute(
        select(UserAPIKey).where(UserAPIKey.user_id == user_id, UserAPIKey.service == "calendly", UserAPIKey.key_name == key_name)
    )).scalar_one_or_none()
    if existing:
        existing.key_value = value
    else:
        db.add(UserAPIKey(user_id=user_id, service="calendly", key_name=key_name, key_value=value, is_global=False))


@router.get("/calendly/webhook-status")
async def calendly_webhook_status(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    creds = await service.get_all_credentials(db, current_user.id, "calendly")
    return {
        "connected": bool(creds.get("webhook_subscription_uri")),
        "public_base_url_configured": bool(PUBLIC_BASE_URL),
    }


@router.post("/calendly/connect-webhook")
async def connect_calendly_webhook(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Registers a Calendly webhook subscription pointed at THIS
    deployment, so that from now on, any slot a candidate books through
    one of this recruiter's Calendly links automatically flips the
    matching Interview Scheduling row to Scheduled with the real booked
    time — see public_router.calendly_webhook for the receiving side."""
    if not PUBLIC_BASE_URL:
        raise HTTPException(400, "This server has no PUBLIC_BASE_URL configured, so Calendly has no reachable webhook URL to call back to. Set the PUBLIC_BASE_URL environment variable to your deployed backend's public origin first.")
    creds = await service.get_calendly_credentials(db, current_user.id)
    if not creds["api_key"]:
        raise HTTPException(400, "Save your Calendly Personal Access Token under Settings -> API Keys -> Calendly first — the webhook subscription is created using it.")

    # Tear down any existing subscription for this user first, so
    # reconnecting (e.g. after rotating the PAT) doesn't leave an orphaned
    # duplicate still POSTing to the same URL from the old Calendly account.
    existing_uri = (await service.get_all_credentials(db, current_user.id, "calendly")).get("webhook_subscription_uri")
    if existing_uri:
        try:
            await service.delete_calendly_webhook_subscription(creds["api_key"], existing_uri)
        except Exception:
            pass  # best-effort — proceed to create the new one regardless

    webhook_url = f"{PUBLIC_BASE_URL}/api/public/interviews/calendly-webhook?uid={current_user.id}"
    result = await service.create_calendly_webhook_subscription(creds["api_key"], webhook_url)

    await _upsert_calendly_key(db, current_user.id, "webhook_subscription_uri", result["subscription_uri"])
    await _upsert_calendly_key(db, current_user.id, "webhook_signing_key", result["signing_key"])
    await db.commit()
    return {"connected": True, "webhook_url": webhook_url}


@router.post("/calendly/disconnect-webhook")
async def disconnect_calendly_webhook(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    creds = await service.get_calendly_credentials(db, current_user.id)
    existing_uri = (await service.get_all_credentials(db, current_user.id, "calendly")).get("webhook_subscription_uri")
    if existing_uri and creds["api_key"]:
        try:
            await service.delete_calendly_webhook_subscription(creds["api_key"], existing_uri)
        except Exception:
            pass
    await db.execute(
        UserAPIKey.__table__.delete().where(
            UserAPIKey.user_id == current_user.id, UserAPIKey.service == "calendly",
            UserAPIKey.key_name.in_(["webhook_subscription_uri", "webhook_signing_key"]),
        )
    )
    await db.commit()
    return {"connected": False}


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
    if creds["booking_url"]:
        # Simple mode: the same public Calendly page for every candidate,
        # no token needed — set once under Settings -> API Keys -> Calendly.
        booking_url = creds["booking_url"]
    elif creds["api_key"] and creds["event_type_uri"]:
        booking_url = await service.create_calendly_single_use_link(creds["api_key"], creds["event_type_uri"])
    else:
        raise HTTPException(400, "Set up Calendly under Settings -> API Keys first — either paste your Calendly booking link, or a Personal Access Token + Event Type.")
    i.calendly_scheduling_url = booking_url
    i.status = "Requested"
    i.scheduled_at = None
    i.updated_at = datetime.utcnow()
    await db.commit()
    return {"calendly_scheduling_url": booking_url}


class SendCalendlyEmailRequest(BaseModel):
    to_email: str = ""   # defaults to the interview's own candidate's email if blank
    subject: str = "Schedule your phone screening interview"
    body_html: str = ""  # defaults to a standard message wrapping the link if blank


async def _candidate_email(db: AsyncSession, i: Interview) -> str:
    if i.candidate_id:
        c = (await db.execute(select(Candidate).where(Candidate.id == i.candidate_id))).scalar_one_or_none()
        return (c.email or "") if c else ""
    if i.joblens_candidate_id:
        from models.models import JobLensCandidate
        jc = (await db.execute(select(JobLensCandidate).where(JobLensCandidate.id == i.joblens_candidate_id))).scalar_one_or_none()
        return (jc.email or "") if jc else ""
    return ""


@router.post("/interviews/{interview_id}/calendly-link/email")
async def email_calendly_link(
    interview_id: int, payload: SendCalendlyEmailRequest,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    """Interview Scheduling's counterpart to Phone Interview's 'Send
    Calendly Link' — generates (or reuses) the Calendly booking link for
    this interview the same way create_calendly_link does, then emails
    it to the candidate directly instead of just handing the recruiter a
    link to copy/paste themselves. Works whether the interview came from
    the Talent Pool (candidate_id) or from CandidateLens/JobLens
    (joblens_candidate_id) — same bridge as the rest of this file."""
    org = await _org(db, current_user)
    i = (await db.execute(select(Interview).where(Interview.id == interview_id, Interview.organisation_id == org.id))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Interview not found")
    if i.interview_type not in SELF_SCHEDULABLE_TYPES:
        raise HTTPException(400, f"Self-scheduling is only available for Phone Interview rounds — {i.interview_type} interviews must be scheduled directly by a recruiter, not left to a candidate-facing link.")

    to_email = (payload.to_email or await _candidate_email(db, i)).strip()
    if not to_email:
        raise HTTPException(400, "This candidate has no email on file — nowhere to send the link.")

    booking_url = i.calendly_scheduling_url
    if not booking_url:
        creds = await service.get_calendly_credentials(db, current_user.id)
        if creds["booking_url"]:
            booking_url = creds["booking_url"]
        elif creds["api_key"] and creds["event_type_uri"]:
            booking_url = await service.create_calendly_single_use_link(creds["api_key"], creds["event_type_uri"])
        else:
            raise HTTPException(400, "Set up Calendly under Settings -> API Keys first — either paste your Calendly booking link, or a Personal Access Token + Event Type.")

    candidate_name = await _candidate_name(db, i.candidate_id, i.joblens_candidate_id)
    body_html = payload.body_html.strip() or (
        f"<p>Hi {candidate_name or 'there'},</p>"
        f"<p>Thanks for your interest — we'd like to set up a quick initial phone screening interview with you.</p>"
        f"<p>Please use the link below to pick a time that works for you:</p>"
        f"<p><a href=\"{booking_url}\">{booking_url}</a></p>"
        f"<p>Looking forward to speaking with you.</p>"
    )
    smtp_cfg = await get_smtp_config(current_user.id, db)
    send_email(smtp_cfg, to_email, payload.subject.strip() or "Schedule your phone screening interview", body_html)

    i.calendly_scheduling_url = booking_url
    if i.status not in ("Scheduled", "Completed"):
        i.status = "Requested"
    i.updated_at = datetime.utcnow()
    await db.commit()
    return {"sent": True, "calendly_scheduling_url": booking_url}


class SendFixedInviteRequest(BaseModel):
    to_email: str = ""
    subject: str = ""
    body_html: str = ""


@router.post("/interviews/{interview_id}/send-invite")
async def send_fixed_invite(
    interview_id: int, payload: SendFixedInviteRequest,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    """Interview Scheduling's invite action for FIXED-time rounds — Panel
    Interview to start with — as opposed to the Calendly self-schedule
    flow above, which is deliberately restricted to Phone Interview only
    (see SELF_SCHEDULABLE_TYPES). This never generates a booking link;
    it emails the candidate the date/time the recruiter already set
    (i.scheduled_at) plus the meeting location/link already on the round
    (i.location_or_link — see Settings > API Keys > Meeting Link for
    where that gets its default value from when left blank at scheduling
    time)."""
    org = await _org(db, current_user)
    i = (await db.execute(select(Interview).where(Interview.id == interview_id, Interview.organisation_id == org.id))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Interview not found")
    if not i.scheduled_at:
        raise HTTPException(400, "Set a date/time for this round before sending an invite.")

    to_email = (payload.to_email or await _candidate_email(db, i)).strip()
    if not to_email:
        raise HTTPException(400, "This candidate has no email on file — nowhere to send the invite.")

    candidate_name = await _candidate_name(db, i.candidate_id, i.joblens_candidate_id)
    when = i.scheduled_at.strftime("%A, %d %B %Y at %I:%M %p")
    location_html = f"<p><strong>Meeting link/location:</strong> {i.location_or_link}</p>" if i.location_or_link else ""
    body_html = payload.body_html.strip() or (
        f"<p>Hi {candidate_name or 'there'},</p>"
        f"<p>You're invited to a {i.interview_type.lower()} — <strong>{i.round_name}</strong>.</p>"
        f"<p><strong>When:</strong> {when}</p>"
        f"{location_html}"
        f"<p>Please reach out if this time no longer works for you.</p>"
        f"<p>Looking forward to speaking with you.</p>"
    )
    subject = payload.subject.strip() or f"Interview invite: {i.round_name}"

    smtp_cfg = await get_smtp_config(current_user.id, db)
    send_email(smtp_cfg, to_email, subject, body_html)

    i.invite_sent_at = datetime.utcnow()
    if i.status not in ("Scheduled", "Completed"):
        i.status = "Scheduled"
    i.updated_at = datetime.utcnow()
    await db.commit()
    return {"sent": True, "invite_sent_at": i.invite_sent_at.isoformat()}


class InterviewRejectionEmailRequest(BaseModel):
    interview_ids: List[int]
    subject: str
    # {name} is the only placeholder — replaced with each candidate's
    # own first name right before that candidate's individual email is
    # sent. Pre-converted to HTML by the frontend (see JobLensPage.tsx's
    # textToHtml) before this ever reaches the backend.
    body_html_template: str


@router.post("/interviews/reject-email")
async def send_interview_rejection_emails(
    payload: InterviewRejectionEmailRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Interview Decision's bulk 'Send Rejection Email' — the same
    action as Screening Decision's (routers/joblens.py's
    send_rejection_emails), just scoped to interview ROUNDS instead of
    candidates: a candidate can be rejected at any individual round
    without necessarily being rejected from the requisition overall.
    Sends ONE separate, individually-addressed email per round's
    candidate — never a shared To/CC list — so no candidate can see any
    other candidate's name or email address."""
    if not payload.interview_ids:
        raise HTTPException(400, "No rows selected.")

    org = await _org(db, current_user)
    rows = (await db.execute(
        select(Interview).where(Interview.id.in_(payload.interview_ids), Interview.organisation_id == org.id)
    )).scalars().all()
    by_id = {i.id: i for i in rows}

    smtp_cfg = await get_smtp_config(current_user.id, db)

    sent, failed = [], []
    for iid in payload.interview_ids:
        i = by_id.get(iid)
        if not i:
            failed.append({"interview_id": iid, "name": None, "error": "Round not found."})
            continue
        name = await _candidate_name(db, i.candidate_id, i.joblens_candidate_id)
        email = await _candidate_email(db, i)
        if not email:
            failed.append({"interview_id": iid, "name": name, "error": "No email on file."})
            continue
        first_name = (name or "").strip().split(" ")[0] or "there"
        body_html = payload.body_html_template.replace("{name}", first_name)
        try:
            send_email(smtp_cfg, email, payload.subject, body_html)
            i.rejection_email_sent_at = datetime.utcnow()
            sent.append({"interview_id": iid, "name": name, "email": email})
        except HTTPException as e:
            failed.append({"interview_id": iid, "name": name, "error": e.detail})
            if "not configured" in str(e.detail).lower() or "rejected these smtp credentials" in str(e.detail).lower():
                break
        except Exception as e:
            failed.append({"interview_id": iid, "name": name, "error": str(e)[:200]})

    await db.commit()
    return {"sent": sent, "failed": failed}


@router.post("/interviews/{interview_id}/decision-approval")
async def set_decision_approval(
    interview_id: int,
    status: str = Form(...),          # Pending | Approved | Not Approved
    approved_by: str = Form(""),
    approval_date: str = Form(""),    # ISO date string from the popup's date picker; defaults to now if blank
    notes: str = Form(""),
    attachment: Optional[UploadFile] = File(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Interview Decision's Approval popup — records who signed off on
    the hiring DECISION (not the interview's scheduling — see
    decision_approval_status's docstring in models.py), when, any notes,
    and an optional supporting document kept for future reference. A new
    attachment replaces any previous one for this round; there's no
    versioning, same as every other single-attachment field in this
    codebase (resume_file_blob, etc.)."""
    if status not in ("Pending", "Approved", "Not Approved"):
        raise HTTPException(400, "status must be one of: Pending, Approved, Not Approved")

    org = await _org(db, current_user)
    i = (await db.execute(select(Interview).where(Interview.id == interview_id, Interview.organisation_id == org.id))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Interview not found")

    i.decision_approval_status = status
    i.decision_approved_by = approved_by.strip()
    i.decision_approval_notes = notes.strip()
    if approval_date.strip():
        try:
            i.decision_approved_at = datetime.fromisoformat(approval_date.strip())
        except ValueError:
            raise HTTPException(400, "approval_date must be an ISO date (YYYY-MM-DD).")
    else:
        i.decision_approved_at = datetime.utcnow()

    if attachment is not None and attachment.filename:
        content = await attachment.read()
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(400, "Attachment must be under 10MB.")
        i.decision_approval_attachment_blob = content
        i.decision_approval_attachment_filename = attachment.filename

    i.updated_at = datetime.utcnow()
    await db.commit()
    return {
        "decision_approval_status": i.decision_approval_status,
        "decision_approved_by": i.decision_approved_by,
        "decision_approved_at": i.decision_approved_at.isoformat() if i.decision_approved_at else None,
        "decision_approval_attachment_filename": i.decision_approval_attachment_filename or "",
    }


@router.get("/interviews/{interview_id}/decision-approval/attachment")
async def get_decision_approval_attachment(
    interview_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    org = await _org(db, current_user)
    i = (await db.execute(select(Interview).where(Interview.id == interview_id, Interview.organisation_id == org.id))).scalar_one_or_none()
    if not i or not i.decision_approval_attachment_blob:
        raise HTTPException(404, "No attachment on file for this round.")
    filename = i.decision_approval_attachment_filename or "attachment"
    return StreamingResponse(
        io.BytesIO(i.decision_approval_attachment_blob),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class AddDecisionApproverRequest(BaseModel):
    approver_name: str
    approver_email: str
    # The frontend's own origin (window.location.origin) — the backend
    # doesn't reliably know the frontend's public URL (it may be a
    # different domain from this API's own PUBLIC_BASE_URL in a typical
    # SPA+API split deployment), so the browser, which DOES know it,
    # supplies it here rather than the backend guessing.
    approval_url_base: str


@router.post("/interviews/{interview_id}/decision-approvers")
async def add_decision_approver(
    interview_id: int, payload: AddDecisionApproverRequest,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    """The 'online approval' option alongside the manual popup fields —
    emails a named approver a tokenized link (no login) where THEY
    record Approve/Reject plus their own comments, independently of any
    other approver asked about the same round. Multiple approvers can
    be added for the same round; each gets their own row and their own
    link."""
    org = await _org(db, current_user)
    i = (await db.execute(select(Interview).where(Interview.id == interview_id, Interview.organisation_id == org.id))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Interview not found")
    if not payload.approver_name.strip() or not payload.approver_email.strip():
        raise HTTPException(400, "Approver name and email are both required.")

    approver = InterviewDecisionApprover(
        interview_id=i.id,
        approver_name=payload.approver_name.strip(),
        approver_email=payload.approver_email.strip(),
        token=service.generate_token(),
        invited_at=datetime.utcnow(),
    )
    db.add(approver)
    await db.commit()
    await db.refresh(approver)

    candidate_name = await _candidate_name(db, i.candidate_id, i.joblens_candidate_id)
    requisition_title = await _requisition_title(db, i.requisition_id)
    link = f"{payload.approval_url_base.rstrip('/')}/decision-approval/{approver.token}"
    body_html = (
        f"<p>Hi {approver.approver_name.split(' ')[0]},</p>"
        f"<p>Your input is requested on a hiring decision for <strong>{candidate_name}</strong>"
        f"{f' — {requisition_title}' if requisition_title else ''} ({i.round_name}).</p>"
        f"<p><a href=\"{link}\">Click here to review and record your decision</a></p>"
        f"<p>No account or login is required.</p>"
    )
    smtp_cfg = await get_smtp_config(current_user.id, db)
    send_email(smtp_cfg, approver.approver_email, f"Approval requested: {candidate_name}", body_html)

    return _fmt_decision_approver(approver)


@router.delete("/interviews/decision-approvers/{approver_id}")
async def remove_decision_approver(
    approver_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    """Removing an approver who hasn't responded yet — e.g. added by
    mistake, or the wrong person. Once someone HAS responded, their
    decision stays on record (not deletable here) since it's now part
    of the decision's audit trail."""
    org = await _org(db, current_user)
    approver = (await db.execute(
        select(InterviewDecisionApprover)
        .join(Interview, InterviewDecisionApprover.interview_id == Interview.id)
        .where(InterviewDecisionApprover.id == approver_id, Interview.organisation_id == org.id)
    )).scalar_one_or_none()
    if not approver:
        raise HTTPException(404, "Approver not found")
    if approver.status != "Pending":
        raise HTTPException(400, "This approver has already responded — their decision is part of the record and can't be removed.")
    await db.delete(approver)
    await db.commit()
    return {"deleted": True}


# ── TELEPHONY (click-to-call + SMS scheduling — see utils/telephony.py) ──
# Same "only Phone Interview is self-schedulable" rule as Calendly/self-
# schedule-link above is deliberately NOT enforced here: a recruiter may
# reasonably want to click-to-call or text a heads-up for a Video/Panel
# round too, and neither action hands scheduling control to the
# candidate the way a public self-schedule link would.

async def _candidate_phone(db: AsyncSession, i: Interview) -> str:
    if i.candidate_id:
        c = (await db.execute(select(Candidate).where(Candidate.id == i.candidate_id))).scalar_one_or_none()
        return (c.phone or "") if c else ""
    if i.joblens_candidate_id:
        from models.models import JobLensCandidate
        jc = (await db.execute(select(JobLensCandidate).where(JobLensCandidate.id == i.joblens_candidate_id))).scalar_one_or_none()
        return (jc.phone or "") if jc else ""
    return ""


@router.get("/telephony/status")
async def telephony_status(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Lets the frontend decide whether to show the Call/Text-Schedule
    actions at all, without exposing the credentials themselves."""
    from utils.telephony import get_telephony_config, is_configured
    config = await get_telephony_config(db, current_user.id)
    return {"configured": is_configured(config), "caller_number": config["caller_number"]}


@router.post("/interviews/{interview_id}/call")
async def call_candidate(
    interview_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    """Click-to-call: bridges the recruiter's own configured caller
    number to this interview's candidate — see
    utils.telephony.place_click_to_call for the two-leg flow. Returns
    enough for the frontend's popup to show what's happening (who's
    being called, from what number) while Twilio connects the call."""
    from utils.telephony import get_telephony_config, place_click_to_call

    org = await _org(db, current_user)
    i = (await db.execute(select(Interview).where(Interview.id == interview_id, Interview.organisation_id == org.id))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Interview not found")

    candidate_phone = await _candidate_phone(db, i)
    config = await get_telephony_config(db, current_user.id)
    result = await place_click_to_call(config, candidate_phone)

    i.phone_call_sid = result["sid"]
    i.phone_call_status = result["status"]
    i.phone_called_at = datetime.utcnow()
    i.updated_at = datetime.utcnow()
    await db.commit()
    return {
        "call_sid": result["sid"], "status": result["status"],
        "caller_number": result["from"], "candidate_number": result["to"],
    }


class SendScheduleSmsRequest(BaseModel):
    scheduled_at: str    # ISO datetime — when the candidate will be called
    message: str = ""    # defaults to a standard "you'll be called at <time>" text if blank


@router.post("/interviews/{interview_id}/sms-schedule")
async def sms_schedule_call(
    interview_id: int, payload: SendScheduleSmsRequest,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    """Texts the candidate the time they'll be called, and — this is
    what actually puts it "on the calendar and in the table" per the
    recruiter's own request — sets this Interview's scheduled_at/status
    to match, the same fields Interview Scheduling's calendar/table
    already read from for every other round. An interviewer can also
    reach the same end state via Calendly (candidate self-schedules,
    see create_calendly_link above) or a direct self-schedule link
    (create_self_schedule_link) — this is the third path: the
    interviewer picks the time themselves and just notifies the
    candidate by text."""
    from utils.telephony import get_telephony_config, send_sms

    org = await _org(db, current_user)
    i = (await db.execute(select(Interview).where(Interview.id == interview_id, Interview.organisation_id == org.id))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Interview not found")

    try:
        scheduled_dt = datetime.fromisoformat(payload.scheduled_at.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, "scheduled_at must be a valid ISO datetime string.")

    candidate_phone = await _candidate_phone(db, i)
    candidate_name = await _candidate_name(db, i.candidate_id, i.joblens_candidate_id)
    when_display = scheduled_dt.strftime("%A, %B %d at %I:%M %p").replace(" 0", " ")
    body = payload.message.strip() or (
        f"Hi {candidate_name or 'there'}, this is a heads-up that we'll be calling you for your "
        f"phone interview on {when_display}. Talk soon!"
    )

    config = await get_telephony_config(db, current_user.id)
    await send_sms(config, candidate_phone, body)

    i.scheduled_at = scheduled_dt
    i.status = "Scheduled"
    i.call_sms_sent_at = datetime.utcnow()
    i.updated_at = datetime.utcnow()
    await db.commit()
    return {"sent": True, "scheduled_at": i.scheduled_at.isoformat(), "status": i.status}


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
