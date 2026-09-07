"""
TalentIQ - Skills Assessment Router
===================================
Screening module: online tests of skills, aptitude, and behavior.

Two audiences, two very different trust levels:

  RECRUITER/ADMIN (authenticated via get_current_user — every logged-in
  platform user IS a recruiter/admin here, there's no separate
  "candidate" login) manages the question bank, generates AI questions,
  assigns a timed test to a candidate, and views full results including
  the AI's scores and reasoning.

  CANDIDATE (no login at all — a bare token in the URL, same pattern as
  JobLensCandidate.interview_token / routers/joblens.py's /public/interview
  routes) can only load their own assigned questions and submit answers.
  Every public endpoint below is deliberately built to make it structurally
  impossible to leak a score, a correct answer, or a grading guideline to
  that audience — see _question_for_candidate()'s comment.
"""
import secrets
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from db.database import get_db
from models.models import (
    User, TestQuestion, TestAssignment, TestAnswer, TestProctoringSnapshot,
    JobLensCandidate, JobLensSession, JDRecord,
    TEST_CATEGORIES, TEST_QUESTION_TYPES, TEST_DIFFICULTIES, TEST_APTITUDE_SUBTYPES,
)
from utils.auth_utils import get_current_user, hash_password, verify_password
from utils.credentials import get_groq_model
from utils.email_send import get_smtp_config as _get_smtp_config, send_email as _send_email
from utils.groq_pool import resolve_groq_key, record_key_outcome
from utils.sequencing import next_sequence_number
from agents.skillstest_agent import (
    generate_ai_questions, grade_short_answer, generate_overall_evaluation,
    build_question_set, DEFAULT_ESTIMATED_SECONDS,
)

router = APIRouter()

# Excludes visually-ambiguous characters (0/O, 1/I/l) since this is a
# password a candidate has to read out of an email and retype by hand.
_PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"


def _generate_access_password(length: int = 10) -> str:
    return "".join(secrets.choice(_PASSWORD_ALPHABET) for _ in range(length))


# ═══════════════════════════════════════════════════════════════════════
# QUESTION BANK (recruiter/admin only)
# ═══════════════════════════════════════════════════════════════════════

class QuestionIn(BaseModel):
    category: str = "skills_proficiency"
    question_type: str = "mcq"
    question_text: str
    options: Optional[list] = None
    correct_option_index: Optional[int] = None
    grading_guideline: Optional[str] = None
    skill_tag: str = ""
    difficulty: str = "medium"
    estimated_seconds: Optional[int] = None
    jd_record_id: Optional[int] = None
    aptitude_subtype: Optional[str] = None


def _fmt_question(q: TestQuestion, include_answer: bool = True) -> dict:
    out = {
        "id": q.id,
        "category": q.category,
        "questionType": q.question_type,
        "questionText": q.question_text,
        "skillTag": q.skill_tag,
        "difficulty": q.difficulty,
        "aptitudeSubtype": q.aptitude_subtype,
        "estimatedSeconds": q.estimated_seconds,
        "source": q.source,
        "isActive": q.is_active,
        "jdRecordId": q.jd_record_id,
        "jdTitle": q.jd_title or "",
        "createdAt": q.created_at.isoformat() if q.created_at else None,
    }
    if q.question_type == "mcq":
        out["options"] = q.options or []
    if include_answer:
        # Recruiter/admin view only — see _question_for_candidate below
        # for the candidate-safe equivalent that omits all of this.
        if q.question_type == "mcq":
            out["correctOptionIndex"] = q.correct_option_index
        else:
            out["gradingGuideline"] = q.grading_guideline
    return out


def _validate_category_and_subtype(category: str, aptitude_subtype: Optional[str]) -> Optional[str]:
    if category not in TEST_CATEGORIES:
        raise HTTPException(400, f"category must be one of {TEST_CATEGORIES}")
    if category == "cognitive_aptitude":
        if not aptitude_subtype or aptitude_subtype not in TEST_APTITUDE_SUBTYPES:
            raise HTTPException(400, f"aptitude_subtype is required for cognitive_aptitude, one of {TEST_APTITUDE_SUBTYPES}")
        return aptitude_subtype
    return None  # subtype is meaningless outside cognitive_aptitude — never stored for other categories


async def _get_owned_jd(db: AsyncSession, jd_record_id: Optional[int], user_id: int) -> Optional[JDRecord]:
    if not jd_record_id:
        return None
    r = await db.execute(select(JDRecord).where(JDRecord.id == jd_record_id, JDRecord.user_id == user_id))
    jd = r.scalar_one_or_none()
    if not jd:
        raise HTTPException(404, "Job description not found.")
    return jd


@router.post("/questions")
async def create_question(
    payload: QuestionIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Expert-authored question entry. JD tagging is optional here —
    unlike AI generation below, an expert already knows what they're
    writing and can judge its relevance themselves — but tagging one in
    still lets it be prioritized by build_question_set for that role."""
    if payload.category not in TEST_CATEGORIES:
        raise HTTPException(400, f"category must be one of {TEST_CATEGORIES}")
    if payload.question_type not in TEST_QUESTION_TYPES:
        raise HTTPException(400, f"question_type must be one of {TEST_QUESTION_TYPES}")
    if payload.difficulty not in TEST_DIFFICULTIES:
        raise HTTPException(400, f"difficulty must be one of {TEST_DIFFICULTIES}")
    if payload.question_type == "mcq":
        if not payload.options or len(payload.options) != 4:
            raise HTTPException(400, "MCQ questions need exactly 4 options.")
        if payload.correct_option_index is None or not (0 <= payload.correct_option_index < 4):
            raise HTTPException(400, "correct_option_index must be 0-3.")

    subtype = _validate_category_and_subtype(payload.category, payload.aptitude_subtype)
    jd = await _get_owned_jd(db, payload.jd_record_id, current_user.id)

    q = TestQuestion(
        user_id=current_user.id,
        category=payload.category,
        aptitude_subtype=subtype,
        question_type=payload.question_type,
        question_text=payload.question_text.strip(),
        options=payload.options if payload.question_type == "mcq" else [],
        correct_option_index=payload.correct_option_index if payload.question_type == "mcq" else None,
        grading_guideline=(payload.grading_guideline or "").strip() if payload.question_type == "short_answer" else None,
        skill_tag=payload.skill_tag.strip(),
        difficulty=payload.difficulty,
        estimated_seconds=payload.estimated_seconds or DEFAULT_ESTIMATED_SECONDS[payload.question_type],
        source="expert",
        is_active=True,
        jd_record_id=jd.id if jd else None,
        jd_title=jd.title if jd else None,
        created_at=datetime.utcnow(),
    )
    db.add(q)
    await db.commit()
    await db.refresh(q)
    return _fmt_question(q)


@router.get("/questions")
async def list_questions(
    category: Optional[str] = None,
    question_type: Optional[str] = None,
    source: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(TestQuestion).where(TestQuestion.user_id == current_user.id)
    if category:
        stmt = stmt.where(TestQuestion.category == category)
    if question_type:
        stmt = stmt.where(TestQuestion.question_type == question_type)
    if source:
        stmt = stmt.where(TestQuestion.source == source)
    stmt = stmt.order_by(TestQuestion.created_at.desc())
    r = await db.execute(stmt)
    return [_fmt_question(q) for q in r.scalars().all()]


@router.put("/questions/{question_id}")
async def update_question(
    question_id: int,
    payload: QuestionIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    r = await db.execute(
        select(TestQuestion).where(TestQuestion.id == question_id, TestQuestion.user_id == current_user.id)
    )
    q = r.scalar_one_or_none()
    if not q:
        raise HTTPException(404, "Question not found")

    q.category = payload.category
    q.aptitude_subtype = _validate_category_and_subtype(payload.category, payload.aptitude_subtype)
    q.question_type = payload.question_type
    q.question_text = payload.question_text.strip()
    q.skill_tag = payload.skill_tag.strip()
    q.difficulty = payload.difficulty
    if payload.estimated_seconds:
        q.estimated_seconds = payload.estimated_seconds
    if payload.question_type == "mcq":
        q.options = payload.options or []
        q.correct_option_index = payload.correct_option_index
        q.grading_guideline = None
    else:
        q.options = []
        q.correct_option_index = None
        q.grading_guideline = (payload.grading_guideline or "").strip()

    await db.commit()
    await db.refresh(q)
    return _fmt_question(q)


@router.delete("/questions/{question_id}")
async def delete_question(
    question_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    r = await db.execute(
        select(TestQuestion).where(TestQuestion.id == question_id, TestQuestion.user_id == current_user.id)
    )
    q = r.scalar_one_or_none()
    if not q:
        raise HTTPException(404, "Question not found")
    await db.delete(q)
    await db.commit()
    return {"message": "Deleted"}


class GenerateQuestionsIn(BaseModel):
    category: str = "skills_proficiency"
    question_type: str = "mcq"
    skill_tag: str
    difficulty: str = "medium"
    count: int = 5
    jd_record_id: int
    aptitude_subtype: Optional[str] = None


@router.post("/questions/generate-ai")
async def generate_questions_ai(
    payload: GenerateQuestionsIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """AI-generated questions, saved straight into the same bank expert
    questions live in — source="ai_generated" is the only thing that
    distinguishes them afterwards. ALWAYS grounded in a real JD (required,
    not optional) — see agents/skillstest_agent.generate_ai_questions,
    which refuses to run without real jd_text — so a generated question
    is genuinely about the role being screened for, not a generic guess.
    Run this multiple times per skill to build up enough variety that
    build_question_set() can serve a genuinely different subset to each
    candidate."""
    if payload.category not in TEST_CATEGORIES:
        raise HTTPException(400, f"category must be one of {TEST_CATEGORIES}")
    if payload.question_type not in TEST_QUESTION_TYPES:
        raise HTTPException(400, f"question_type must be one of {TEST_QUESTION_TYPES}")
    if not payload.skill_tag.strip():
        raise HTTPException(400, "skill_tag is required (e.g. 'Python', 'Leadership').")
    subtype = _validate_category_and_subtype(payload.category, payload.aptitude_subtype)

    jd = await _get_owned_jd(db, payload.jd_record_id, current_user.id)
    if not jd:
        raise HTTPException(400, "A job description is required — pick one from JD Management.")
    if not (jd.description or "").strip():
        raise HTTPException(400, f"'{jd.title}' has no description text yet — add one in JD Management first.")

    default_model = await get_groq_model(db, current_user.id)
    key_resolution = await resolve_groq_key(db, current_user.id)

    try:
        generated = await generate_ai_questions(
            payload.category, payload.skill_tag.strip(), payload.difficulty, payload.question_type,
            payload.count, key_resolution["groq_key"], key_resolution["model"] or default_model,
            jd_title=jd.title or "", jd_text=jd.description or "",
            jd_skills=(jd.essential_skills or []) + (jd.good_to_have_skills or []),
            aptitude_subtype=subtype,
        )
    except RuntimeError as e:
        await record_key_outcome(db, key_resolution["pool_id"], success=False)
        raise HTTPException(502, str(e))

    await record_key_outcome(db, key_resolution["pool_id"], success=True)

    saved = []
    for item in generated:
        q = TestQuestion(
            user_id=current_user.id,
            category=item["category"],
            aptitude_subtype=item.get("aptitude_subtype"),
            question_type=item["question_type"],
            question_text=item["question_text"],
            options=item.get("options", []),
            correct_option_index=item.get("correct_option_index"),
            grading_guideline=item.get("grading_guideline"),
            skill_tag=item["skill_tag"],
            difficulty=item["difficulty"],
            estimated_seconds=item["estimated_seconds"],
            source="ai_generated",
            is_active=True,
            jd_record_id=jd.id,
            jd_title=jd.title,
            created_at=datetime.utcnow(),
        )
        db.add(q)
        saved.append(q)

    await db.commit()
    for q in saved:
        await db.refresh(q)
    return [_fmt_question(q) for q in saved]


# ═══════════════════════════════════════════════════════════════════════
# ASSIGNMENTS (recruiter/admin only — creation + viewing results)
# ═══════════════════════════════════════════════════════════════════════

class AssignTestIn(BaseModel):
    joblens_candidate_id: int
    duration_minutes: int = 60
    invite_expiry_days: int = 7


def _fmt_assignment(a: TestAssignment, include_evaluation: bool = True) -> dict:
    events = a.proctoring_events or []
    event_counts: dict = {}
    for ev in events:
        t = ev.get("type", "unknown")
        event_counts[t] = event_counts.get(t, 0) + 1
    out = {
        "id": a.id,
        "sequenceNumber": a.sequence_number or a.id,
        "candidateId": a.joblens_candidate_id,
        "candidateName": a.candidate_name or "",
        "candidateEmail": a.candidate_email or "",
        "roleTitle": a.role_title or "",
        "token": a.token,
        "durationMinutes": a.duration_minutes,
        "questionCount": len(a.question_ids or []),
        "status": a.status,
        "startedAt": a.started_at.isoformat() if a.started_at else None,
        "completedAt": a.completed_at.isoformat() if a.completed_at else None,
        "expiresAt": a.expires_at.isoformat() if a.expires_at else None,
        "createdAt": a.created_at.isoformat() if a.created_at else None,
        "inviteSentAt": a.invite_sent_at.isoformat() if a.invite_sent_at else None,
        # Deliberately just counts here — the full timeline is available
        # via /assignments/{id}/proctoring-events if a recruiter wants to
        # dig into exactly when things happened, not just how often.
        "proctoringSummary": {
            "tabSwitchCount": event_counts.get("tab_hidden", 0),
            "windowBlurCount": event_counts.get("window_blur", 0),
            "pasteBlockedCount": event_counts.get("paste_blocked", 0),
            "copyBlockedCount": event_counts.get("copy_blocked", 0),
            "cameraDenied": event_counts.get("camera_denied", 0) > 0,
        },
    }
    if include_evaluation:
        # Recruiter/admin view ONLY — never included on any public/token
        # response. See _fmt_assignment_public below.
        out["overallScore"] = a.overall_score
        out["categoryScores"] = a.category_scores or {}
        out["aiSummary"] = a.ai_summary or ""
        out["aiReasoning"] = a.ai_reasoning or ""
    return out


@router.post("/assign")
async def assign_test(
    payload: AssignTestIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    r = await db.execute(
        select(JobLensCandidate, JobLensSession)
        .join(JobLensSession, JobLensCandidate.session_id == JobLensSession.id)
        .where(JobLensCandidate.id == payload.joblens_candidate_id, JobLensSession.user_id == current_user.id)
    )
    row = r.first()
    if not row:
        raise HTTPException(404, "Candidate not found")
    candidate, session = row

    r2 = await db.execute(
        select(TestQuestion).where(TestQuestion.user_id == current_user.id, TestQuestion.is_active == True)  # noqa: E712
    )
    available = r2.scalars().all()
    if not available:
        raise HTTPException(
            400,
            "No active questions in your bank yet — add expert questions or generate AI "
            "questions first, then assign a test.",
        )

    selected = build_question_set(available, payload.duration_minutes, preferred_jd_record_id=session.jd_record_id)
    if not selected:
        raise HTTPException(400, "Couldn't assemble a test from the current question bank — add more questions.")

    seq_num = await next_sequence_number(db, TestAssignment, current_user.id)
    plaintext_password = _generate_access_password()
    assignment = TestAssignment(
        user_id=current_user.id,
        sequence_number=seq_num,
        joblens_candidate_id=candidate.id,
        candidate_name=candidate.name or "",
        candidate_email=candidate.email or "",
        role_title=session.jd_role or "",
        token=secrets.token_urlsafe(24),
        duration_minutes=payload.duration_minutes,
        question_ids=[q.id for q in selected],
        access_password_hash=hash_password(plaintext_password),
        status="not_started",
        expires_at=datetime.utcnow() + timedelta(days=max(1, payload.invite_expiry_days)),
        created_at=datetime.utcnow(),
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    # accessPassword is plaintext and ONLY ever appears here and in
    # /reset-credentials — never stored, never returned by any other
    # endpoint (list/get assignment expose only the hash-backed status).
    out = _fmt_assignment(assignment)
    out["accessPassword"] = plaintext_password
    return out


@router.post("/assignments/{assignment_id}/reset-credentials")
async def reset_assignment_credentials(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mints a fresh login password for a sitting whose original invite
    email was lost, never sent, or needs to be resent — e.g. the
    recruiter closed the invite modal before sending it. Deliberately
    allowed regardless of status (not_started/in_progress/expired) so a
    candidate who's mid-test but locked themselves out by mistyping the
    password too many times, or whose invite expired before they used
    it, can still be re-issued access — completed sittings are the only
    ones where a new password would be meaningless."""
    r = await db.execute(
        select(TestAssignment).where(TestAssignment.id == assignment_id, TestAssignment.user_id == current_user.id)
    )
    a = r.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Assignment not found")
    if a.status == "completed":
        raise HTTPException(400, "This assessment is already completed — new credentials wouldn't do anything.")

    plaintext_password = _generate_access_password()
    a.access_password_hash = hash_password(plaintext_password)
    await db.commit()
    return {"token": a.token, "accessPassword": plaintext_password}


class SendAssignmentInviteIn(BaseModel):
    to_email: str
    subject: str
    body_html: str


@router.post("/assignments/{assignment_id}/send-invite")
async def send_assignment_invite(
    assignment_id: int,
    payload: SendAssignmentInviteIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Sends the (recruiter-edited) invite email over the recruiter's own
    saved SMTP credentials — same plumbing as Video Interview's Send
    Invite / Phone Interview's Send Calendly Link (see
    utils/email_send.py). The frontend is responsible for putting the
    test link AND the plaintext password (only available right after
    /assign or /reset-credentials) into body_html before calling this;
    this endpoint just sends exactly what it's given and stamps
    invite_sent_at."""
    r = await db.execute(
        select(TestAssignment).where(TestAssignment.id == assignment_id, TestAssignment.user_id == current_user.id)
    )
    a = r.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Assignment not found")

    smtp_cfg = await _get_smtp_config(current_user.id, db)
    _send_email(smtp_cfg, payload.to_email, payload.subject, payload.body_html)

    a.invite_sent_at = datetime.utcnow()
    await db.commit()

    try:
        from capabilities.acquisition.service import get_or_create_default_organisation
        from capabilities.communication import service as comm_service
        org = await get_or_create_default_organisation(db, current_user)
        await comm_service.log_manual_send(
            db, org.id, "skills_assessment_invite", payload.subject, payload.body_html,
            sent_by_user_id=current_user.id, joblens_candidate_id=a.joblens_candidate_id,
        )
        await db.commit()
    except Exception:
        pass  # comms logging is best-effort — never block the actual send on it

    return {"sent": True}


@router.get("/assignments")
async def list_assignments(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    r = await db.execute(
        select(TestAssignment)
        .where(TestAssignment.user_id == current_user.id)
        .order_by(TestAssignment.created_at.desc())
    )
    return [_fmt_assignment(a) for a in r.scalars().all()]


@router.get("/assignments/{assignment_id}")
async def get_assignment(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    r = await db.execute(
        select(TestAssignment).where(TestAssignment.id == assignment_id, TestAssignment.user_id == current_user.id)
    )
    a = r.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Assignment not found")

    r2 = await db.execute(select(TestAnswer).where(TestAnswer.assignment_id == a.id))
    answers = r2.scalars().all()

    out = _fmt_assignment(a)
    out["answers"] = [
        {
            "id": ans.id,
            "questionText": ans.question_text,
            "questionType": ans.question_type,
            "category": ans.category,
            "aptitudeSubtype": ans.aptitude_subtype,
            "options": ans.options or [],
            "correctOptionIndex": ans.correct_option_index,
            "candidateAnswer": ans.candidate_answer,
            "isCorrect": ans.is_correct,
            "aiScore": ans.ai_score,
            "aiReasoning": ans.ai_reasoning,
        }
        for ans in answers
    ]
    return out


@router.get("/assignments/{assignment_id}/proctoring-snapshots")
async def get_proctoring_snapshots(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Thumbnails only, embedded directly as base64 for the recruiter's
    review gallery — deliberately no separate binary-streaming endpoint
    since these are already small JPEGs (see TestProctoringSnapshot's
    docstring in models.py)."""
    r = await db.execute(
        select(TestAssignment).where(TestAssignment.id == assignment_id, TestAssignment.user_id == current_user.id)
    )
    a = r.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Assignment not found")

    r2 = await db.execute(
        select(TestProctoringSnapshot)
        .where(TestProctoringSnapshot.assignment_id == a.id)
        .order_by(TestProctoringSnapshot.captured_at)
    )
    snapshots = r2.scalars().all()
    return {
        "snapshots": [
            {"id": s.id, "capturedAt": s.captured_at.isoformat(), "imageData": s.image_data}
            for s in snapshots
        ]
    }


@router.get("/assignments/{assignment_id}/proctoring-events")
async def get_proctoring_events(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The full timeline behind _fmt_assignment's proctoringSummary
    counts, for a recruiter who wants to see exactly when a candidate
    left the tab rather than just how many times."""
    r = await db.execute(
        select(TestAssignment).where(TestAssignment.id == assignment_id, TestAssignment.user_id == current_user.id)
    )
    a = r.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Assignment not found")
    return {"events": a.proctoring_events or []}


@router.delete("/assignments/{assignment_id}")
async def delete_assignment(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    r = await db.execute(
        select(TestAssignment).where(TestAssignment.id == assignment_id, TestAssignment.user_id == current_user.id)
    )
    a = r.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Assignment not found")
    await db.delete(a)
    await db.commit()
    return {"message": "Deleted"}


@router.post("/assignments/{assignment_id}/regenerate")
async def regenerate_assignment(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Draws a fresh random question set for an assignment that hasn't
    been opened yet — same token/link, same duration, same JD priority,
    just a different set/order from build_question_set(). Only allowed
    while status is "not_started": once a candidate has opened the link
    (in_progress) or finished (completed), the questions they were shown
    are locked in for evaluation integrity — regenerating mid-sitting
    would silently change what a partially-answered test is being graded
    against.
    """
    r = await db.execute(
        select(TestAssignment).where(TestAssignment.id == assignment_id, TestAssignment.user_id == current_user.id)
    )
    a = r.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Assignment not found")
    if a.status != "not_started":
        raise HTTPException(
            400,
            f"Can't regenerate — this test is already {a.status.replace('_', ' ')}. "
            "Delete it and create a new assignment instead if you need a different set.",
        )

    r2 = await db.execute(
        select(JobLensSession)
        .join(JobLensCandidate, JobLensCandidate.session_id == JobLensSession.id)
        .where(JobLensCandidate.id == a.joblens_candidate_id)
    )
    session = r2.scalar_one_or_none()

    r3 = await db.execute(
        select(TestQuestion).where(TestQuestion.user_id == current_user.id, TestQuestion.is_active == True)  # noqa: E712
    )
    available = r3.scalars().all()
    if not available:
        raise HTTPException(400, "No active questions in your bank to draw from.")

    selected = build_question_set(
        available, a.duration_minutes,
        preferred_jd_record_id=session.jd_record_id if session else None,
    )
    if not selected:
        raise HTTPException(400, "Couldn't assemble a test from the current question bank.")

    a.question_ids = [q.id for q in selected]
    await db.commit()
    await db.refresh(a)
    return _fmt_assignment(a)


# ═══════════════════════════════════════════════════════════════════════
# PUBLIC (candidate-facing, token + one-time-issued password, NO
# platform account, NO evaluation ever visible to the candidate)
#
# Two-step access, deliberately mirroring a real login: the token in the
# URL identifies WHICH sitting, but never starts the clock or hands back
# a single question on its own — only /login (candidate_email + the
# password from their invite email) does that, so "time monitoring
# starts after login" is literally true rather than starting the moment
# the link is opened/previewed. Once logged in there's still no session/
# cookie (kept as simple as the original token-only design); the
# candidate stays authenticated for that browser tab via the password
# they already typed (see PublicAssessmentPage.tsx caching it in
# sessionStorage), and can always re-enter it if they reload.
# ═══════════════════════════════════════════════════════════════════════

def _question_for_candidate(q: TestQuestion) -> dict:
    """The candidate-safe view of a question — deliberately a SEPARATE,
    smaller function from _fmt_question rather than a flag on it, so
    there's no risk of a future edit accidentally adding a field here
    that leaks correct_option_index or grading_guideline to the public
    endpoint below."""
    out = {
        "id": q.id,
        "questionType": q.question_type,
        "questionText": q.question_text,
    }
    if q.question_type == "mcq":
        out["options"] = q.options or []
    return out


def _expire_if_overdue(a: TestAssignment) -> None:
    if a.expires_at and datetime.utcnow() > a.expires_at and a.status == "not_started":
        a.status = "expired"


async def _finalize_assignment(db: AsyncSession, a: TestAssignment, answers_by_qid: dict) -> None:
    """Grades every question in the sitting against answers_by_qid
    (question_id -> candidate's answer string) and locks the assignment
    in as completed. Shared by the candidate's own explicit Finish Test
    submit AND by the server-side auto-close path below (see
    _auto_close_if_time_up) so a sitting nobody ever clicked "submit" on
    still gets graded on exactly whatever was captured in draft_answers,
    the same way a real submit would grade it — no separate, drifting
    copy of this scoring logic."""
    r2 = await db.execute(select(TestQuestion).where(TestQuestion.id.in_(a.question_ids or [])))
    questions_by_id = {q.id: q for q in r2.scalars().all()}

    default_model = await get_groq_model(db, a.user_id)
    key_resolution = await resolve_groq_key(db, a.user_id)
    any_ai_grading_attempted = False
    any_ai_grading_succeeded = False

    category_totals: dict = {}   # category -> [sum, count]
    per_question_summary = []

    for qid in (a.question_ids or []):
        q = questions_by_id.get(qid)
        if not q:
            continue
        candidate_answer = answers_by_qid.get(qid, "")

        test_answer = TestAnswer(
            assignment_id=a.id,
            question_id=q.id,
            question_text=q.question_text,
            question_type=q.question_type,
            category=q.category,
            aptitude_subtype=q.aptitude_subtype,
            options=q.options or [],
            correct_option_index=q.correct_option_index,
            candidate_answer=candidate_answer,
            answered_at=datetime.utcnow(),
        )

        if q.question_type == "mcq":
            try:
                chosen = int(candidate_answer) if candidate_answer != "" else None
            except (TypeError, ValueError):
                chosen = None
            is_correct = chosen is not None and q.correct_option_index is not None and chosen == q.correct_option_index
            test_answer.is_correct = is_correct
            score_for_avg = 100.0 if is_correct else 0.0
            per_question_summary.append({
                "category": q.category, "type": "mcq",
                "result": "correct" if is_correct else "incorrect",
                "question_text": q.question_text,
            })
        else:
            any_ai_grading_attempted = True
            grading = await grade_short_answer(
                q.question_text, q.grading_guideline or "", candidate_answer,
                key_resolution["groq_key"], key_resolution["model"] or default_model,
            )
            test_answer.ai_score = grading["score"]
            test_answer.ai_reasoning = grading["reasoning"]
            if grading["score"] is not None:
                any_ai_grading_succeeded = True
            score_for_avg = grading["score"] if grading["score"] is not None else 0.0
            per_question_summary.append({
                "category": q.category, "type": "short_answer",
                "ai_score": grading["score"], "question_text": q.question_text,
            })

        db.add(test_answer)
        totals = category_totals.setdefault(q.category, [0.0, 0])
        totals[0] += score_for_avg
        totals[1] += 1

    if any_ai_grading_attempted:
        await record_key_outcome(db, key_resolution["pool_id"], success=any_ai_grading_succeeded)

    category_scores = {cat: round(total / count, 1) for cat, (total, count) in category_totals.items() if count}

    evaluation = await generate_overall_evaluation(
        a.candidate_name, a.role_title, category_scores, per_question_summary,
        key_resolution["groq_key"], key_resolution["model"] or default_model,
    )

    a.overall_score = evaluation["overall_score"]
    a.category_scores = category_scores
    a.ai_summary = evaluation["summary"]
    a.ai_reasoning = evaluation["reasoning"]
    a.status = "completed"
    a.completed_at = datetime.utcnow()


async def _auto_close_if_time_up(db: AsyncSession, a: TestAssignment) -> bool:
    """Server-side backstop for "closes automatically after time ends"
    that doesn't depend on the candidate's browser tab still being open
    to fire the client-side auto-submit timer. Any public request that
    touches this assignment after its clock has actually run out — a
    status check, a login/resume attempt, a stray autosave — finalizes
    it right there using whatever's in draft_answers, so a sitting can
    never sit open past its duration just because nobody clicked
    Finish. Returns True if it just closed the assignment."""
    if a.status != "in_progress" or not a.started_at:
        return False
    elapsed = (datetime.utcnow() - a.started_at).total_seconds()
    if elapsed < a.duration_minutes * 60:
        return False
    draft = {int(k): v for k, v in (a.draft_answers or {}).items()}
    await _finalize_assignment(db, a, draft)
    await db.commit()
    return True


@router.get("/public/{token}")
async def get_public_assignment(token: str, db: AsyncSession = Depends(get_db)):
    """Status peek only — never starts the clock, never returns a
    question. The frontend uses this purely to decide what to render:
    a login form (not_started/in_progress-but-not-yet-authenticated-in-
    this-tab) or a terminal message (completed/expired)."""
    r = await db.execute(select(TestAssignment).where(TestAssignment.token == token))
    a = r.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "This test link isn't valid.")

    _expire_if_overdue(a)
    await _auto_close_if_time_up(db, a)
    await db.commit()

    if a.status == "expired":
        return {"status": "expired", "message": "This test invitation has expired. Contact the recruiter for a new link."}
    if a.status == "completed":
        return {"status": "completed", "message": "You've already submitted this assessment. Thank you!"}

    remaining_seconds = None
    if a.status == "in_progress" and a.started_at:
        elapsed = (datetime.utcnow() - a.started_at).total_seconds()
        remaining_seconds = max(0, a.duration_minutes * 60 - int(elapsed))

    return {
        "status": a.status,   # "not_started" | "in_progress"
        "requiresLogin": True,
        "candidateName": a.candidate_name or "",
        "candidateEmail": a.candidate_email or "",
        "roleTitle": a.role_title or "",
        "durationMinutes": a.duration_minutes,
        "remainingSeconds": remaining_seconds,
    }


class LoginPublicIn(BaseModel):
    password: str


@router.post("/public/{token}/login")
async def login_public_assignment(token: str, payload: LoginPublicIn, db: AsyncSession = Depends(get_db)):
    """The actual start-the-clock step. First successful login on a
    not_started sitting stamps started_at = now — that's the "time
    monitoring begins after login" behavior — and every login after that
    (e.g. the candidate refreshing the page) just resumes with the
    correctly-recomputed remaining time, same token, same question set."""
    r = await db.execute(select(TestAssignment).where(TestAssignment.token == token))
    a = r.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "This test link isn't valid.")

    _expire_if_overdue(a)
    await _auto_close_if_time_up(db, a)
    await db.commit()

    if a.status == "expired":
        raise HTTPException(410, "This test invitation has expired. Contact the recruiter for a new link.")
    if a.status == "completed":
        return {"status": "completed", "message": "You've already submitted this assessment. Thank you!"}

    if not a.access_password_hash or not verify_password(payload.password, a.access_password_hash):
        raise HTTPException(401, "Incorrect password. Check the credentials in your invitation email.")

    if a.status == "not_started":
        a.status = "in_progress"
        a.started_at = datetime.utcnow()
        await db.commit()
        await db.refresh(a)

    r2 = await db.execute(select(TestQuestion).where(TestQuestion.id.in_(a.question_ids or [])))
    questions_by_id = {q.id: q for q in r2.scalars().all()}
    # Preserve the originally-assigned order (question_ids), not DB
    # insertion order, and silently skip any question deleted from the
    # bank since assignment (rather than 500ing on a stale reference).
    ordered = [questions_by_id[qid] for qid in (a.question_ids or []) if qid in questions_by_id]

    elapsed_seconds = (datetime.utcnow() - a.started_at).total_seconds() if a.started_at else 0
    remaining_seconds = max(0, a.duration_minutes * 60 - int(elapsed_seconds))

    draft = a.draft_answers or {}

    return {
        "status": "in_progress",
        "candidateName": a.candidate_name or "",
        "roleTitle": a.role_title or "",
        "durationMinutes": a.duration_minutes,
        "remainingSeconds": remaining_seconds,
        "questions": [_question_for_candidate(q) for q in ordered],
        # So a refreshed/resumed tab restores whatever was already typed,
        # instead of the candidate losing progress on top of losing time.
        "draftAnswers": draft,
    }


class SubmitAnswerIn(BaseModel):
    questionId: int
    answer: str = ""


class SubmitTestIn(BaseModel):
    answers: List[SubmitAnswerIn]


@router.post("/public/{token}/autosave")
async def autosave_public_assignment(token: str, payload: SubmitTestIn, db: AsyncSession = Depends(get_db)):
    """Periodic, low-stakes progress save while the candidate is still
    working — called on an interval and on page-unload by the frontend.
    Deliberately silent/tolerant (no 401 on a stale/finished sitting):
    a delayed autosave arriving just after the real submit or after
    expiry should never surface an error to someone who's already done."""
    r = await db.execute(select(TestAssignment).where(TestAssignment.token == token))
    a = r.scalar_one_or_none()
    if not a or a.status != "in_progress":
        return {"saved": False}

    if await _auto_close_if_time_up(db, a):
        return {"saved": False}

    draft = dict(a.draft_answers or {})
    for ans in payload.answers:
        draft[str(ans.questionId)] = ans.answer
    a.draft_answers = draft
    a.last_activity_at = datetime.utcnow()
    await db.commit()
    return {"saved": True}


# Bounded so a long/idle sitting or a misbehaving tab can't grow either
# table without limit — old events roll off, old snapshots get deleted.
_MAX_PROCTORING_EVENTS = 500
_MAX_PROCTORING_SNAPSHOTS = 60
_MAX_SNAPSHOT_BASE64_CHARS = 400_000  # ~300KB decoded — plenty for a small JPEG still, guards against an oversized upload


class ProctoringEventIn(BaseModel):
    type: str


@router.post("/public/{token}/proctoring-event")
async def log_proctoring_event(token: str, payload: ProctoringEventIn, db: AsyncSession = Depends(get_db)):
    """Tab-switch/window-blur/paste-blocked/etc — logged for the
    recruiter to review, not acted on automatically (no auto-fail, no
    auto-flag-and-lock). Deliberately silent/tolerant like autosave: a
    stray event from a finished or expired sitting is just discarded."""
    r = await db.execute(select(TestAssignment).where(TestAssignment.token == token))
    a = r.scalar_one_or_none()
    if not a or a.status != "in_progress":
        return {"logged": False}

    events = list(a.proctoring_events or [])
    events.append({"type": payload.type[:64], "at": datetime.utcnow().isoformat()})
    a.proctoring_events = events[-_MAX_PROCTORING_EVENTS:]
    await db.commit()
    return {"logged": True}


class ProctoringSnapshotIn(BaseModel):
    image: str  # base64 JPEG, optionally with a "data:image/jpeg;base64," prefix


@router.post("/public/{token}/proctoring-snapshot")
async def upload_proctoring_snapshot(token: str, payload: ProctoringSnapshotIn, db: AsyncSession = Depends(get_db)):
    """A periodic webcam still from the candidate's own browser (see
    PublicAssessmentPage.tsx's capture loop) — only ever taken with the
    on-screen recording notice visible, and only while a sitting is
    actually in progress."""
    r = await db.execute(select(TestAssignment).where(TestAssignment.token == token))
    a = r.scalar_one_or_none()
    if not a or a.status != "in_progress":
        return {"saved": False}

    raw = payload.image.split(",", 1)[-1] if "," in payload.image else payload.image
    if not raw or len(raw) > _MAX_SNAPSHOT_BASE64_CHARS:
        return {"saved": False}

    db.add(TestProctoringSnapshot(assignment_id=a.id, image_data=raw, captured_at=datetime.utcnow()))
    await db.flush()

    # Prune down to the cap, oldest first, so this can't grow unbounded
    # over a very long or repeatedly-resumed sitting.
    r2 = await db.execute(
        select(TestProctoringSnapshot)
        .where(TestProctoringSnapshot.assignment_id == a.id)
        .order_by(TestProctoringSnapshot.captured_at)
    )
    all_snaps = r2.scalars().all()
    if len(all_snaps) > _MAX_PROCTORING_SNAPSHOTS:
        for s in all_snaps[: len(all_snaps) - _MAX_PROCTORING_SNAPSHOTS]:
            await db.delete(s)

    await db.commit()
    return {"saved": True}


@router.post("/public/{token}/submit")
async def submit_public_assignment(
    token: str,
    payload: SubmitTestIn,
    db: AsyncSession = Depends(get_db),
):
    """The candidate's explicit "Finish Test" action (or the frontend's
    own auto-submit when its client-side countdown hits zero) — always
    wins over the draft/autosave snapshot for any question it includes,
    since it's the freshest, most deliberate copy of the candidate's
    answers."""
    r = await db.execute(select(TestAssignment).where(TestAssignment.token == token))
    a = r.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "This test link isn't valid.")
    if a.status == "completed":
        return {"message": "You've already submitted this assessment. Thank you!"}
    if a.status == "expired":
        raise HTTPException(410, "This test invitation has expired.")

    # Merge onto the autosaved draft (rather than replacing it outright)
    # so a submit that only carries the questions still in view/changed
    # this instant doesn't blank out answers to ones scrolled past
    # earlier in the sitting.
    answers_by_qid = {int(qid): ans for qid, ans in (a.draft_answers or {}).items()}
    answers_by_qid.update({ans.questionId: ans.answer for ans in payload.answers})

    await _finalize_assignment(db, a, answers_by_qid)
    await db.commit()

    # Deliberately minimal — no score, no per-question feedback, ever.
    return {"message": "Thank you \u2014 your responses have been submitted successfully."}
