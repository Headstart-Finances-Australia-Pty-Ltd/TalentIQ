"""Pydantic schemas for Pipeline & Placements (Phase 5)."""
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field


class StageCreate(BaseModel):
    name: str
    sort_order: int = 1
    stage_type: str = "active"   # active / placed / rejected
    color: str = ""
    requisition_id: Optional[int] = None   # None = organisation-wide default stage


class StageUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None
    stage_type: Optional[str] = None
    color: Optional[str] = None


class SubmitToPipeline(BaseModel):
    """Submits (or re-links) a candidate into a requisition's pipeline —
    creates the underlying Application if one doesn't already exist for
    this candidate+requisition pair (e.g. one wasn't already created via
    the public "Apply Now" career page), then a PipelineEntry at the
    requisition's first stage."""
    candidate_id: int
    requisition_id: int
    owner_user_id: Optional[int] = None
    notes: str = ""


class MoveStage(BaseModel):
    stage_id: int
    notes: str = ""


class EntryUpdate(BaseModel):
    owner_user_id: Optional[int] = None
    rejection_reason: Optional[str] = None
    notes: Optional[str] = None


class OfferCreate(BaseModel):
    """pipeline_entry_id is NOT here — it comes from the URL path
    (/entries/{entry_id}/offers) in router.create_offer, so requiring it
    in the body too was dead weight that only a caller who read the
    schema literally (not the actual endpoint) would ever satisfy —
    caught by testing the real request the frontend sends, not just
    reading the code."""
    salary_offered: Optional[float] = None
    salary_currency: str = "AUD"
    start_date: Optional[datetime] = None
    expiry_date: Optional[datetime] = None
    notes: str = ""


class OfferUpdate(BaseModel):
    salary_offered: Optional[float] = None
    salary_currency: Optional[str] = None
    start_date: Optional[datetime] = None
    expiry_date: Optional[datetime] = None
    notes: Optional[str] = None


class OfferStatusChange(BaseModel):
    status: str


class PlacementCreate(BaseModel):
    """Only used for manually recording a placement that didn't go through
    the Offer -> Accepted flow (e.g. backfilling historical data) — the
    normal path is automatic, see service.create_placement_from_offer."""
    offer_id: int
    start_date: datetime
    fee_amount: Optional[float] = None
    fee_currency: str = "AUD"
    guarantee_period_days: int = 90
    notes: str = ""


class PlacementUpdate(BaseModel):
    start_date: Optional[datetime] = None
    fee_amount: Optional[float] = None
    fee_currency: Optional[str] = None
    guarantee_period_days: Optional[int] = None
    notes: Optional[str] = None


class PlacementStatusChange(BaseModel):
    status: str
    fell_through_reason: str = ""


class BulkIds(BaseModel):
    ids: List[int]
