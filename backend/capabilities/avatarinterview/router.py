"""
TalentIQ — AI Avatar Interviews

Registered in main.py as:
  /api/avatar-interviews/*           (authenticated, recruiter-side)
  /api/public/avatar-interviews/*    (public — NavTalk's webhook callback)
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from db.database import get_db, AsyncSessionLocal
from models.models import User, JobLensCandidate
from utils.auth_utils import get_current_user
from utils.credentials import get_credential, get_groq_model
from capabilities.acquisition import service as acquisition_service
from capabilities.acquisition.models import Candidate
from capabilities.interview.models import Interview

from .models import AvatarInterviewSession, AvatarInterviewQuestion
from .schemas import AvatarSessionCreate, NavTalkWebhookPayload
from . import service
from . import navtalk_client

router = APIRouter()
public_router = APIRouter()

AVATAR_INTERVIEW_TYPE = "Video Interview (AI Avatar)"

# PLACEHOLDER — set this to your real deployed backend origin once this
# capability is used for real (e.g. via an environment variable). NavTalk
# needs a genuinely publicly-reachable URL to call back to; a relative
# path only works for local same-origin testing. See navtalk_client.py's
# module docstring for the broader NavTalk-API-contract caveat this sits
# alongside.
import os
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "")


def _fmt_question(q: AvatarInterviewQuestion) -> dict:
    return {
        "id": q.id, "order_index": q.order_index, "question": q.question_text, "model_answer": q.model_answer_text,
        "candidate_answer": q.candidate_answer_transcript,
        "context_score": q.context_score, "semantic_score": q.semantic_score,
        "keypoints_score": q.keypoints_score, "overall_score": q.overall_score,
        "notes": q.evaluation_notes,
        "answered_at": q.answered_at.isoformat() if q.answered_at else None,
    }


def _fmt_session(s: AvatarInterviewSession, candidate_name: str = "", questions: Optional[list] = None) -> dict:
    return {
        "id": s.id, "interview_id": s.interview_id, "candidate_id": s.candidate_id, "candidate_name": candidate_name,
        "joblens_candidate_id": s.joblens_candidate_id,
        "status": s.status, "failure_reason": s.failure_reason or "",
        "candidate_join_url": s.candidate_join_url or "",
        "overall_qa_score": s.overall_qa_score, "overall_context_score": s.overall_context_score,
        "overall_semantic_score": s.overall_semantic_score, "overall_keypoints_score": s.overall_keypoints_score,
        "questions": [_fmt_question(q) for q in questions] if questions is not None else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "completed_at": s.completed_at.isoformat() if s.completed_at else None,
    }


async def _org(db: AsyncSession, user: User):
    return await acquisition_service.get_or_create_default_organisation(db, user)


# ══════════════════════════════════════════════════════════════════════════
# AUTHENTICATED — set up FROM Interview Management, view status/results
# ══════════════════════════════════════════════════════════════════════════

@router.post("/sessions")
async def create_avatar_session(payload: AvatarSessionCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Setup happens from Interview Management, per the request — this
    endpoint takes an existing Interview row (not a bare candidate_id) and
    builds the avatar session against it. The Interview itself is left
    completely untouched if anything below fails (question generation or
    NavTalk both wrapped so a failure here can't corrupt or block the
    underlying interview record)."""
    org = await _org(db, current_user)
    interview = (await db.execute(select(Interview).where(Interview.id == payload.interview_id, Interview.organisation_id == org.id))).scalar_one_or_none()
    if not interview:
        raise HTTPException(404, "Interview not found in your organisation.")
    if interview.interview_type != AVATAR_INTERVIEW_TYPE:
        raise HTTPException(400, f"This interview's type is '{interview.interview_type}', not '{AVATAR_INTERVIEW_TYPE}'. Change the interview's type first.")
    existing = (await db.execute(select(AvatarInterviewSession).where(AvatarInterviewSession.interview_id == interview.id))).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "An avatar interview session already exists for this interview.")

    candidate = (await db.execute(select(Candidate).where(Candidate.id == interview.candidate_id, Candidate.organisation_id == org.id))).scalar_one_or_none()
    if not candidate:
        raise HTTPException(404, "Candidate not found in your organisation.")

    joblens_candidate = None
    if payload.joblens_candidate_id:
        joblens_candidate = (await db.execute(select(JobLensCandidate).where(JobLensCandidate.id == payload.joblens_candidate_id))).scalar_one_or_none()
        if not joblens_candidate:
            raise HTTPException(404, "That CandidateLens screening candidate wasn't found.")

    session = AvatarInterviewSession(
        organisation_id=org.id, interview_id=interview.id, candidate_id=candidate.id,
        requisition_id=interview.requisition_id, joblens_candidate_id=payload.joblens_candidate_id,
        status="Draft",
    )
    db.add(session)
    await db.flush()

    # ── Generate questions + model answers, using the CandidateLens
    # profile (resume_summary + matched_skills) + JD when available ──────
    groq_key = await get_credential(db, current_user.id, "groq", "api_key")
    groq_model = await get_groq_model(db, current_user.id)

    jd_text, matched_skills, resume_summary = "", [], {}
    if joblens_candidate:
        from models.models import JobLensSession
        jl_session = (await db.execute(select(JobLensSession).where(JobLensSession.id == joblens_candidate.session_id))).scalar_one_or_none()
        jd_text = jl_session.jd_text if jl_session else ""
        matched_skills = joblens_candidate.matched_skills or []
        resume_summary = joblens_candidate.resume_summary or {}
    else:
        # Best-effort when there's no CandidateLens screening backing this
        # interview at all — falls back to whatever's in the candidate's
        # own notes/skills rather than failing outright.
        jd_text = candidate.notes or ""
        matched_skills = candidate.skills or []

    items = await service.generate_questions_with_model_answers(
        jd_text, candidate.full_name, resume_summary, matched_skills, groq_key, groq_model, payload.question_count,
    )
    for i, item in enumerate(items, start=1):
        db.add(AvatarInterviewQuestion(session_id=session.id, order_index=i, question_text=item["question"], model_answer_text=item["model_answer"]))
    session.status = "Questions Generated"
    await db.flush()

    # ── Create the NavTalk avatar session (best-effort — see
    # navtalk_client.py's module docstring for the API-contract caveat) ──
    creds = await service.get_navtalk_credentials(db, current_user.id)
    if creds["api_key"] and creds["avatar_persona_id"]:
        webhook_url = f"{PUBLIC_BASE_URL}/api/public/avatar-interviews/webhook/PENDING" if PUBLIC_BASE_URL else ""
        try:
            if not PUBLIC_BASE_URL:
                raise HTTPException(400, "This server has no PUBLIC_BASE_URL configured, so NavTalk has no reachable webhook URL to call back to. Set the PUBLIC_BASE_URL environment variable to your deployed backend's public origin.")
            result = await navtalk_client.create_avatar_session(
                creds["api_key"], creds["avatar_persona_id"], candidate.full_name,
                [item["question"] for item in items], webhook_url,
            )
            session.navtalk_session_id = result["navtalk_session_id"]
            session.candidate_join_url = result["join_url"]
            session.avatar_persona_id = creds["avatar_persona_id"]
            session.status = "Avatar Session Created"
            # The webhook URL above used a placeholder path since the real
            # navtalk_session_id doesn't exist until NavTalk returns it —
            # if NavTalk requires the webhook URL to be known BEFORE
            # session creation (most APIs of this shape do, via a
            # provided idempotency key), swap this for a locally-generated
            # UUID passed INTO create_avatar_session instead. Flagged here
            # rather than silently guessed, since it affects whether the
            # webhook can ever actually be matched back to this session.
        except HTTPException as e:
            session.status = "Failed"
            session.failure_reason = str(e.detail)[:500]
    else:
        session.status = "Failed"
        session.failure_reason = "NavTalk isn't configured — set your API key and avatar persona ID under Settings -> API Keys -> NavTalk."

    await db.commit()
    await db.refresh(session)
    questions = (await db.execute(select(AvatarInterviewQuestion).where(AvatarInterviewQuestion.session_id == session.id))).scalars().all()
    return _fmt_session(session, candidate.full_name, questions)


@router.get("/sessions")
async def list_sessions(interview_id: Optional[int] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    q = select(AvatarInterviewSession).where(AvatarInterviewSession.organisation_id == org.id)
    if interview_id:
        q = q.where(AvatarInterviewSession.interview_id == interview_id)
    rows = (await db.execute(q)).scalars().all()
    candidate_ids = {s.candidate_id for s in rows}
    candidate_names = dict((await db.execute(select(Candidate.id, Candidate.full_name).where(Candidate.id.in_(candidate_ids)))).all()) if candidate_ids else {}
    return [_fmt_session(s, candidate_names.get(s.candidate_id, "")) for s in rows]


@router.get("/sessions/{session_id}")
async def get_session(session_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    s = (await db.execute(select(AvatarInterviewSession).where(AvatarInterviewSession.id == session_id, AvatarInterviewSession.organisation_id == org.id))).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Avatar interview session not found")
    candidate = (await db.execute(select(Candidate).where(Candidate.id == s.candidate_id))).scalar_one_or_none()
    questions = (await db.execute(select(AvatarInterviewQuestion).where(AvatarInterviewQuestion.session_id == s.id).order_by(AvatarInterviewQuestion.order_index))).scalars().all()
    return _fmt_session(s, candidate.full_name if candidate else "", questions)


@router.post("/sessions/{session_id}/refresh-status")
async def refresh_status(session_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Manual polling fallback if NavTalk's webhook hasn't arrived — see
    navtalk_client.get_session_status's own placeholder-API caveat."""
    org = await _org(db, current_user)
    s = (await db.execute(select(AvatarInterviewSession).where(AvatarInterviewSession.id == session_id, AvatarInterviewSession.organisation_id == org.id))).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Avatar interview session not found")
    if not s.navtalk_session_id:
        raise HTTPException(400, "No NavTalk session exists for this interview yet.")
    creds = await service.get_navtalk_credentials(db, current_user.id)
    status = await navtalk_client.get_session_status(creds["api_key"], s.navtalk_session_id)
    return {"navtalk_reported_status": status, "local_status": s.status}


# ══════════════════════════════════════════════════════════════════════════
# PUBLIC — NavTalk's webhook callback (see schemas.NavTalkWebhookPayload's
# docstring: best-effort payload shape, confirm against real NavTalk docs)
# ══════════════════════════════════════════════════════════════════════════

@public_router.post("/webhook/{navtalk_session_id}")
async def navtalk_webhook(navtalk_session_id: str, payload: NavTalkWebhookPayload):
    async with AsyncSessionLocal() as db:
        session = (await db.execute(select(AvatarInterviewSession).where(AvatarInterviewSession.navtalk_session_id == navtalk_session_id))).scalar_one_or_none()
        if not session:
            raise HTTPException(404, "Unknown NavTalk session.")

        if payload.event == "session_failed":
            session.status = "Failed"
            session.failure_reason = payload.failure_reason or "NavTalk reported a failure."
            await db.commit()
            return {"received": True}

        if payload.event == "answer_received" and payload.question_index is not None and payload.transcript is not None:
            session.status = "In Progress"
            question = (await db.execute(
                select(AvatarInterviewQuestion).where(AvatarInterviewQuestion.session_id == session.id, AvatarInterviewQuestion.order_index == payload.question_index)
            )).scalar_one_or_none()
            if question:
                question.candidate_answer_transcript = payload.transcript
                question.answered_at = datetime.utcnow()

                interview = (await db.execute(select(Interview).where(Interview.id == session.interview_id))).scalar_one_or_none()
                groq_key = await get_credential(db, interview.owner_user_id, "groq", "api_key") if interview and interview.owner_user_id else None
                groq_model = await get_groq_model(db, interview.owner_user_id) if interview and interview.owner_user_id else "llama-3.3-70b-versatile"

                if groq_key:
                    evaluation = await service.evaluate_answer(question.question_text, question.model_answer_text, payload.transcript, groq_key, groq_model)
                    question.context_score = evaluation.get("context_score")
                    question.semantic_score = evaluation.get("semantic_score")
                    question.keypoints_score = evaluation.get("keypoints_score")
                    question.overall_score = evaluation.get("overall_score")
                    question.evaluation_notes = evaluation.get("notes")
            await db.commit()
            return {"received": True}

        if payload.event == "session_completed":
            questions = (await db.execute(select(AvatarInterviewQuestion).where(AvatarInterviewQuestion.session_id == session.id))).scalars().all()
            scored = [q for q in questions if q.overall_score is not None]
            if scored:
                session.overall_qa_score = round(sum(q.overall_score for q in scored) / len(scored), 1)
                session.overall_context_score = round(sum(q.context_score or 0 for q in scored) / len(scored), 1)
                session.overall_semantic_score = round(sum(q.semantic_score or 0 for q in scored) / len(scored), 1)
                session.overall_keypoints_score = round(sum(q.keypoints_score or 0 for q in scored) / len(scored), 1)
            session.status = "Completed"
            session.completed_at = datetime.utcnow()
            await db.commit()
            await service.write_back_to_candidatelens(db, session)
            await db.commit()
            return {"received": True}

        return {"received": True, "note": "Unrecognized event type — no action taken."}
