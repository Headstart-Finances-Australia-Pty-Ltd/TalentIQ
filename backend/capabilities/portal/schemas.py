"""Pydantic schemas for Client & Vendor Collaboration (Phase 6)."""
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field


class AssignVendor(BaseModel):
    vendor_id: int
    requisition_id: int


class ClientFeedbackSubmit(BaseModel):
    pipeline_entry_id: int
    contact_name: str
    decision: str   # Approved / Rejected / Interview Requested / Feedback Only
    comments: str = ""


class VendorSubmissionCreate(BaseModel):
    """Submitted through the vendor's public portal — no auth beyond the
    token, so every field is exactly what the vendor typed, nothing
    inferred from a logged-in identity."""
    requisition_id: int
    full_name: str
    email: str = ""
    phone: str = ""
    current_title: str = ""
    current_employer: str = ""
    total_experience_years: str = ""
    vendor_notes: str = ""


class VendorSubmissionReview(BaseModel):
    action: str   # "accept" or "reject"
    rejection_reason: str = ""
