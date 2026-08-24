"""
Service layer for AI Avatar Interviews.

Reuses the exact same LLM stack already proven for CandidateLens's
existing video-interview pipeline (routers/joblens.py — ChatGroq via
langchain-groq, the same JSON-response parsing helper) rather than
introducing a second way of talking to an LLM in this codebase.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from utils.credentials import get_credential, get_groq_model

from .models import AvatarInterviewSession, AvatarInterviewQuestion

DEFAULT_QUESTION_COUNT = 5


async def get_navtalk_credentials(db: AsyncSession, user_id: int) -> dict:
    api_key = await get_credential(db, user_id, "navtalk", "api_key")
    avatar_persona_id = await get_credential(db, user_id, "navtalk", "avatar_persona_id")
    return {"api_key": api_key or "", "avatar_persona_id": avatar_persona_id or ""}


async def generate_questions_with_model_answers(
    jd_text: str, candidate_name: str, candidate_profile: dict, matched_skills: list,
    groq_key: str, groq_model: str, question_count: int = DEFAULT_QUESTION_COUNT,
) -> list[dict]:
    """Generates {question, model_answer} pairs — a superset of
    routers/joblens.py's existing generate_questions(), which only ever
    produced the question text with no model answer to evaluate against
    later. candidate_profile is JobLensCandidate.resume_summary (already
    a categorized, LLM-produced summary from Phase 3 — reused here rather
    than re-parsing the raw resume) when available; falls back to just
    matched_skills if there's no CandidateLens screening behind this
    interview at all.

    Falls back to a heuristic question set (no LLM) with a generic model
    answer placeholder if no Groq key is available — mirrors
    _default_questions()'s role in the existing pipeline, so an avatar
    interview can still be set up (with a manual-review-only note)
    without a Groq key configured."""
    if not groq_key:
        return [
            {"question": q, "model_answer": "(No Groq key configured — model answer not generated; evaluate this answer manually.)"}
            for q in _default_questions(candidate_name, matched_skills)
        ]

    from langchain_groq import ChatGroq
    from langchain.schema import HumanMessage
    from utils.llm_extraction import _truncate_for_llm, _parse_json_response

    profile_block = _summarize_profile(candidate_profile) if candidate_profile else ""
    skills_str = ", ".join(matched_skills[:8]) if matched_skills else "relevant skills"

    llm = ChatGroq(api_key=groq_key, model=groq_model, temperature=0.4, max_tokens=4000, reasoning_format="hidden", reasoning_effort="low", max_retries=0)
    prompt = f"""You are a recruitment AI assistant preparing an AI-avatar interview
for {candidate_name}. Generate exactly {question_count} interview questions
PERSONALIZED to this specific candidate's background and this specific role —
not generic questions any candidate could answer identically.

For EACH question, also write a strong MODEL ANSWER — what a well-qualified
candidate should say, grounded in the job description's actual requirements.
This model answer is used later to evaluate the candidate's real spoken
answer, so it must be concrete and specific (name real concepts, approaches,
or considerations relevant to the question), not generic filler.

CANDIDATE PROFILE:
{profile_block or f"Key matched skills: {skills_str}"}

JOB DESCRIPTION:
\"\"\"{_truncate_for_llm(jd_text, "JD text", 8000)}\"\"\"

Return ONLY valid JSON, no markdown:
{{
  "items": [
    {{"question": "...", "model_answer": "..."}},
    ...
  ]
}}"""

    resp = llm.invoke([HumanMessage(content=prompt)])
    data = _parse_json_response(resp.content)
    if data is None or not data.get("items"):
        return [
            {"question": q, "model_answer": "(LLM generation failed — evaluate this answer manually.)"}
            for q in _default_questions(candidate_name, matched_skills)
        ]
    return data["items"][:question_count]


def _summarize_profile(resume_summary: dict) -> str:
    """resume_summary is JobLensCandidate's existing categorized-bullets
    field (Phase 3) — {experience: [...], skills: [...], education: [...],
    achievements: [...], availability_work_rights: [...]}. Flattened into
    plain text for the prompt above."""
    lines = []
    for category, bullets in (resume_summary or {}).items():
        if not bullets:
            continue
        lines.append(f"{category.replace('_', ' ').title()}:")
        for b in bullets[:5]:
            lines.append(f"  - {b}")
    return "\n".join(lines)


def _default_questions(name: str, skills: list) -> list[str]:
    qs = []
    if skills:
        qs.append(f"Tell me about a project where you used {skills[0]}.")
        if len(skills) > 1:
            qs.append(f"Rate your proficiency in {skills[1]} and give a real example.")
        if len(skills) > 2:
            qs.append(f"What challenges have you faced with {skills[2]}?")
    qs.append(f"Why are you the right candidate for this role, {name}?")
    qs.append("Where do you see yourself in 3 years?")
    return qs[:5]


async def evaluate_answer(
    question: str, model_answer: str, candidate_answer: str, groq_key: str, groq_model: str,
) -> dict:
    """Scores the candidate's actual transcribed answer against the model
    answer generated alongside its question — three axes per the request:
    context (did they address what was actually asked), semantic (does
    the underlying MEANING align with the model answer, not exact
    wording), and key points (were the model answer's specific concrete
    points actually covered). This is deliberately separate from and
    additional to CandidateLens's existing holistic _analyze_transcript()
    (communication/relevance/confidence across the whole transcript) —
    that stays as-is; this is a new, more granular per-question layer
    that gets shown ALONGSIDE it, not instead of it (see router.py's
    write-back to JobLensCandidate)."""
    if not candidate_answer or not candidate_answer.strip():
        return {"context_score": 0, "semantic_score": 0, "keypoints_score": 0, "overall_score": 0, "notes": "No answer was recorded for this question."}

    from langchain_groq import ChatGroq
    from langchain.schema import HumanMessage
    from utils.llm_extraction import _parse_json_response

    llm = ChatGroq(api_key=groq_key, model=groq_model, temperature=0.1, max_tokens=1500, reasoning_format="hidden", reasoning_effort="low", max_retries=0)
    prompt = f"""You are an experienced technical interviewer scoring one candidate's
spoken answer against a model answer, for a single interview question.
Be fair and evidence-based — score what the transcript actually contains,
not what you'd hope a strong candidate said.

QUESTION:
{question}

MODEL ANSWER (what a strong response should cover):
{model_answer}

CANDIDATE'S ACTUAL ANSWER (auto-transcribed, may contain minor recognition errors):
\"\"\"{candidate_answer[:3000]}\"\"\"

Score three axes, each 0-100:
- context_score: did the candidate actually address what THIS question asked (not a tangent or a memorized unrelated answer)?
- semantic_score: does the MEANING of their answer align with the model answer's substance — same underlying understanding, even in different words?
- keypoints_score: what fraction of the model answer's specific concrete points did the candidate actually cover?

Return ONLY valid JSON, no markdown:
{{
  "context_score": <0-100>,
  "semantic_score": <0-100>,
  "keypoints_score": <0-100>,
  "overall_score": <0-100, your holistic judgement, not necessarily the average>,
  "notes": "<2-3 sentences, specific and evidence-based>"
}}"""
    resp = llm.invoke([HumanMessage(content=prompt)])
    data = _parse_json_response(resp.content)
    if data is None:
        return {"context_score": None, "semantic_score": None, "keypoints_score": None, "overall_score": None, "notes": "Evaluation failed — LLM returned an unparseable response."}
    return data


async def write_back_to_candidatelens(db: AsyncSession, session: AvatarInterviewSession) -> None:
    """Once every question in this session is evaluated, surfaces the
    aggregate Q&A score on the linked CandidateLens candidate — ALONGSIDE
    the existing video_analysis (emotion + holistic transcript scoring),
    not replacing it, per the request ("along with the existing video
    evaluation these question answers evaluation should also be
    provided"). Writes to qa_evaluation/qa_evaluation_score, two columns
    added to JobLensCandidate specifically for this — see
    db/migrate_fix.py for the retrofit entry (that table has been live
    since Phase 3, so this can't rely on create_all() alone)."""
    if not session.joblens_candidate_id:
        return
    from models.models import JobLensCandidate
    jc = (await db.execute(select(JobLensCandidate).where(JobLensCandidate.id == session.joblens_candidate_id))).scalar_one_or_none()
    if not jc:
        return

    questions = (await db.execute(select(AvatarInterviewQuestion).where(AvatarInterviewQuestion.session_id == session.id))).scalars().all()
    jc.qa_evaluation_score = session.overall_qa_score
    jc.qa_evaluation = {
        "overall_score": session.overall_qa_score,
        "context_score": session.overall_context_score,
        "semantic_score": session.overall_semantic_score,
        "keypoints_score": session.overall_keypoints_score,
        "questions": [
            {
                "question": q.question_text, "model_answer": q.model_answer_text,
                "candidate_answer": q.candidate_answer_transcript, "overall_score": q.overall_score,
                "context_score": q.context_score, "semantic_score": q.semantic_score,
                "keypoints_score": q.keypoints_score, "notes": q.evaluation_notes,
            }
            for q in questions
        ],
        "evaluated_at": datetime.utcnow().isoformat(),
    }
