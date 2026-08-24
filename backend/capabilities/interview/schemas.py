"""Pydantic schemas for Interview Management (Phase 4)."""
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field


class InterviewerIn(BaseModel):
    name: str
    email: str = ""


class InterviewCreate(BaseModel):
    candidate_id: int
    requisition_id: Optional[int] = None
    application_id: Optional[int] = None
    round_name: str
    round_number: int = 1
    interview_type: str = "HR Screening"   # see models.INTERVIEW_TYPES — governs whether this round can be self-scheduled
    interviewers: List[InterviewerIn] = Field(default_factory=list)
    duration_minutes: int = 60
    location_or_link: str = ""
    # Either provide scheduled_at directly (recruiter picks the time), or
    # proposed_slots (candidate self-schedules from a short list) — not
    # both required, but at least a sensible default (Requested) applies
    # if neither is given.
    scheduled_at: Optional[datetime] = None
    proposed_slots: List[datetime] = Field(default_factory=list)
    notes: str = ""


class InterviewUpdate(BaseModel):
    round_name: Optional[str] = None
    round_number: Optional[int] = None
    interview_type: Optional[str] = None
    interviewers: Optional[List[InterviewerIn]] = None
    duration_minutes: Optional[int] = None
    location_or_link: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    requisition_id: Optional[int] = None
    application_id: Optional[int] = None
    notes: Optional[str] = None


class InterviewStatusChange(BaseModel):
    status: str
    cancellation_reason: str = ""


class SelfScheduleRequest(BaseModel):
    """Generates/replaces the self-schedule link for an interview."""
    proposed_slots: List[datetime]


class PublicSlotConfirm(BaseModel):
    selected_slot: datetime


class ScorecardCriterionIn(BaseModel):
    criterion: str
    score: int  # 1-5
    notes: str = ""


class ScorecardCreate(BaseModel):
    interviewer_name: str
    recommendation: str = ""
    criteria_scores: List[ScorecardCriterionIn] = Field(default_factory=list)
    strengths: str = ""
    concerns: str = ""
    overall_notes: str = ""


class ScorecardUpdate(BaseModel):
    interviewer_name: Optional[str] = None
    recommendation: Optional[str] = None
    criteria_scores: Optional[List[ScorecardCriterionIn]] = None
    strengths: Optional[str] = None
    concerns: Optional[str] = None
    overall_notes: Optional[str] = None


class BulkIds(BaseModel):
    ids: List[int]
