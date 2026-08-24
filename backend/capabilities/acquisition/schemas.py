"""Pydantic schemas for Candidate Acquisition & Talent Pool (Phase 1)."""
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field


class CandidateCreate(BaseModel):
    full_name: str
    email: str = ""
    phone: str = ""
    location: str = ""
    linkedin_url: str = ""
    portfolio_url: str = ""
    current_employer: str = ""
    current_title: str = ""
    total_experience_years: str = ""
    skills: List[str] = Field(default_factory=list)
    education: str = ""
    certifications: List[str] = Field(default_factory=list)
    work_rights: str = ""
    salary_expectation: str = ""
    notice_period_days: Optional[int] = None
    preferred_locations: List[str] = Field(default_factory=list)
    preferred_employment_type: str = ""
    availability: str = ""
    source: str = "manual"
    referral_source: str = ""
    tags: List[str] = Field(default_factory=list)
    notes: str = ""
    consent_given: bool = False
    cover_letter_text: str = ""


class CandidateUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    current_employer: Optional[str] = None
    current_title: Optional[str] = None
    total_experience_years: Optional[str] = None
    skills: Optional[List[str]] = None
    education: Optional[str] = None
    certifications: Optional[List[str]] = None
    work_rights: Optional[str] = None
    salary_expectation: Optional[str] = None
    notice_period_days: Optional[int] = None
    preferred_locations: Optional[List[str]] = None
    preferred_employment_type: Optional[str] = None
    availability: Optional[str] = None
    status: Optional[str] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = None
    consent_given: Optional[bool] = None
    cover_letter_text: Optional[str] = None


class TalentPoolCreate(BaseModel):
    name: str
    description: str = ""


class PoolMembershipRequest(BaseModel):
    candidate_ids: List[int]


class MergeRequest(BaseModel):
    primary_candidate_id: int
    merged_candidate_id: int


class BulkIds(BaseModel):
    ids: List[int]


class PublicApplyRequest(BaseModel):
    """Fields sent alongside the resume file on the public multipart form —
    kept separate from CandidateCreate since the public form is deliberately
    shorter (no internal-only fields like tags/notes/owner)."""
    full_name: str
    email: str
    phone: str = ""
    location: str = ""
    role_of_interest: str = ""
    cover_letter_text: str = ""
