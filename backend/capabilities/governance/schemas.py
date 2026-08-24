"""Pydantic schemas for Governance (Phase 9)."""
from pydantic import BaseModel


class InviteMember(BaseModel):
    email: str
    role: str = "Recruiter"


class MembershipRoleChange(BaseModel):
    role: str
