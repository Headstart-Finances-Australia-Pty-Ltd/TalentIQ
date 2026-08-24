"""Pydantic schemas for Communication & Automation (Phase 7)."""
from typing import Optional
from pydantic import BaseModel


class TemplateCreate(BaseModel):
    name: str
    category: str = "General"
    subject: str
    body: str


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    subject: Optional[str] = None
    body: Optional[str] = None


class LogEntryCreate(BaseModel):
    """Manual timeline entry — a note, call, or freeform email a
    recruiter is recording after the fact (not sent through this system).
    At least one of candidate_id/client_id/vendor_id/requisition_id
    should be set so it's attached to something, but none are required —
    a totally unattached note is unusual but not forbidden."""
    candidate_id: Optional[int] = None
    client_id: Optional[int] = None
    vendor_id: Optional[int] = None
    requisition_id: Optional[int] = None
    pipeline_entry_id: Optional[int] = None
    channel: str = "Note"
    direction: str = "Internal"
    subject: str = ""
    body: str = ""


class SendEmailRequest(BaseModel):
    """Composes and actually sends an email via the current user's SMTP
    credentials, then logs it — either from a template (template_id +
    placeholder context) or fully freeform (subject/body given directly)."""
    candidate_id: Optional[int] = None
    client_id: Optional[int] = None
    vendor_id: Optional[int] = None
    requisition_id: Optional[int] = None
    pipeline_entry_id: Optional[int] = None
    to_email: str
    template_id: Optional[int] = None
    subject: Optional[str] = None
    body: Optional[str] = None


class AutomationRuleCreate(BaseModel):
    name: str
    trigger_event: str
    trigger_stage_name: str = ""
    template_id: int
    is_active: bool = True


class AutomationRuleUpdate(BaseModel):
    name: Optional[str] = None
    trigger_event: Optional[str] = None
    trigger_stage_name: Optional[str] = None
    template_id: Optional[int] = None
    is_active: Optional[bool] = None
