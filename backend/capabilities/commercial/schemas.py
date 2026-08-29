"""Pydantic schemas for Commercials (Phase 8)."""
from datetime import date
from typing import List, Optional
from pydantic import BaseModel


class InvoiceCreate(BaseModel):
    placement_id: int
    description: str = ""
    amount: Optional[float] = None   # defaults to the placement's own fee_amount if omitted
    currency: Optional[str] = None   # defaults to the placement's own fee_currency if omitted
    issue_date: Optional[date] = None
    due_date: Optional[date] = None
    notes: str = ""


class InvoiceUpdate(BaseModel):
    description: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    issue_date: Optional[date] = None
    due_date: Optional[date] = None
    notes: Optional[str] = None


class InvoiceStatusChange(BaseModel):
    status: str


class TimesheetCreate(BaseModel):
    placement_id: int
    week_ending: date
    hours: float
    rate: float
    currency: str = "AUD"
    notes: str = ""


class TimesheetUpdate(BaseModel):
    week_ending: Optional[date] = None
    hours: Optional[float] = None
    rate: Optional[float] = None
    notes: Optional[str] = None


class TimesheetsToInvoice(BaseModel):
    timesheet_ids: List[int]
    description: str = ""
