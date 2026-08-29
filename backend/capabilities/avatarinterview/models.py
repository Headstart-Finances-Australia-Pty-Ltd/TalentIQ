"""
TalentIQ — AI Avatar Interviews (extends Interview Management, Phase 4,
and Screening & Matching / CandidateLens, Phase 3)

Setup happens FROM Interview Management (an Interview row with
interview_type="Video Interview" gets one of these created against it,
as one of several delivery modes for that class — see
router.AVATAR_INTERVIEW_TYPE's docstring), but the actual interview
mechanics — asking questions, transcribing answers — run through
CandidateLens's existing video pipeline, not a duplicate one. See
service.py's module docstring for exactly what's reused vs. new.

── This capability owns ────────────────────────────────────────────────
  AvatarInterviewSession — one avatar-delivered interview: which
                            Interview (Phase 4) it was set up from, which
                            candidate, optionally which CandidateLens
                            screening it's tied to, and the NavTalk
                            session identifiers.
  AvatarInterviewQuestion — one question in that session, WITH a model
                            answer generated at the same time (so
                            evaluation has something concrete to compare
                            against — see service.evaluate_answer), and
                            the candidate's actual transcribed answer +
                            per-question evaluation once NavTalk reports
                            it back.

── Design notes — read before wiring real NavTalk credentials ──────────
  I do not have verified, confident knowledge of NavTalk.ai's actual REST
  API contract (endpoint paths, auth header format, request/response JSON
  shape, or webhook payload structure) — it's not a service I have solid
  training data on, and this environment has no general web access to
  look it up (only a fixed package-registry allowlist). navtalk_client.py
  is written against the most common pattern for avatar-interview/
  conversational-AI APIs (create a session with a script of questions +
  a webhook URL, receive per-question transcript callbacks), but every
  field name and endpoint path there is a best-effort placeholder that
  MUST be checked against NavTalk's real documentation before this goes
  live. That file is intentionally isolated (all NavTalk-specific code in
  one place) specifically so fixing it later is a contained change, not a
  hunt through this whole capability.

  Every table here is brand new, linked to Interview/Candidate by FK —
  nothing existing is modified there. Two columns ARE added to the
  existing JobLensCandidate table (models/models.py) — qa_evaluation and
  qa_evaluation_score — guarded by the same defensive ALTER pattern as
  every other retrofit in db/migrate_fix.py, since that table has been
  live since Phase 3.
"""
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, Float, JSON,
)

from db.database import Base

AVATAR_SESSION_STATUSES = [
    "Draft",                    # created, questions not generated yet
    "Questions Generated",      # questions + model answers ready
    "Avatar Session Created",   # NavTalk session created, waiting for candidate
    "In Progress",              # candidate has started answering
    "Completed",                # all answers received + evaluated
    "Failed",
]


class AvatarInterviewSession(Base):
    __tablename__ = "tiq_avatar_interview_sessions"

    id                  = Column(Integer, primary_key=True, index=True)
    organisation_id     = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    interview_id        = Column(Integer, ForeignKey("tiq_interviews.id"), index=True, nullable=False, unique=True)
    candidate_id        = Column(Integer, ForeignKey("tiq_candidates.id"), index=True, nullable=False)
    requisition_id      = Column(Integer, ForeignKey("tiq_requisitions.id"), index=True, nullable=True)
    # Optional — set when this avatar interview should also feed a
    # CandidateLens screening's "final screening" view (see
    # service.write_back_to_candidatelens). Not required: an avatar
    # interview can exist purely inside Interview Management with no
    # CandidateLens session behind it at all.
    joblens_candidate_id = Column(Integer, ForeignKey("tiq_joblens_candidates.id"), index=True, nullable=True)

    status              = Column(String(30), default="Draft")   # see AVATAR_SESSION_STATUSES
    avatar_persona_id   = Column(String(100))    # NavTalk avatar/persona identifier
    navtalk_session_id  = Column(String(150), unique=True, index=True, nullable=True)
    candidate_join_url  = Column(Text)           # the link the candidate opens to start the avatar interview
    failure_reason      = Column(Text)

    overall_qa_score        = Column(Float, nullable=True)   # average of each question's overall_score, once all are evaluated
    overall_context_score   = Column(Float, nullable=True)
    overall_semantic_score  = Column(Float, nullable=True)
    overall_keypoints_score = Column(Float, nullable=True)

    created_at          = Column(DateTime, default=datetime.utcnow)
    completed_at         = Column(DateTime, nullable=True)


class AvatarInterviewQuestion(Base):
    __tablename__ = "tiq_avatar_interview_questions"

    id                  = Column(Integer, primary_key=True, index=True)
    session_id          = Column(Integer, ForeignKey("tiq_avatar_interview_sessions.id"), index=True, nullable=False)
    order_index          = Column(Integer, default=1)

    question_text       = Column(Text, nullable=False)
    # Generated by the SAME LLM call that produced the question, from the
    # candidate's profile + the JD — this is what the candidate's actual
    # answer gets evaluated against (see service.evaluate_answer). Without
    # this, "evaluate the answer" would have nothing concrete to compare
    # to beyond the question text alone.
    model_answer_text   = Column(Text, nullable=False)

    candidate_answer_transcript = Column(Text, nullable=True)   # filled in once NavTalk reports it back
    answered_at          = Column(DateTime, nullable=True)

    # Per the request: evaluated on three axes, not one blended number —
    # context (did they address what was actually asked), semantic
    # (does the MEANING align with the model answer, not exact wording),
    # and key points (were the specific concrete points in the model
    # answer actually covered).
    context_score        = Column(Float, nullable=True)
    semantic_score        = Column(Float, nullable=True)
    keypoints_score       = Column(Float, nullable=True)
    overall_score         = Column(Float, nullable=True)
    evaluation_notes      = Column(Text, nullable=True)
