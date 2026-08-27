"""Pydantic schemas for AI Avatar Interviews."""
from typing import Optional
from pydantic import BaseModel


class AvatarSessionCreate(BaseModel):
    """Created FROM an existing Interview (interview_type must be "Video
    Interview") — see router.create_avatar_session."""
    interview_id: int
    joblens_candidate_id: Optional[int] = None   # link to a CandidateLens screening, if this should feed its final-screening view
    question_count: int = 5


class NavTalkWebhookPayload(BaseModel):
    """Best-effort guess at NavTalk's webhook shape — see models.py's
    module docstring. Adjust field names here first if NavTalk's real
    payload differs; this is the single place that assumption lives."""
    navtalk_session_id: str
    event: str   # e.g. "answer_received" | "session_completed" | "session_failed"
    question_index: Optional[int] = None
    transcript: Optional[str] = None
    failure_reason: Optional[str] = None
