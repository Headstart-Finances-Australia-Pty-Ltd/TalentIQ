"""
TalentIQ — Capability: Pipeline & Placements (Phase 5)

Candidate moves to hired without leaving the system. A Kanban pipeline
(stages configurable per requisition, falling back to an organisation-wide
default set), offer tracking with an approval step, and placement records
with guarantee-period tracking — the full close-out of a hire.

── This capability owns ────────────────────────────────────────────────
  PipelineStage         — a named column on the Kanban board. Either a
                           per-requisition custom stage (requisition_id
                           set) or an organisation-wide default template
                           stage (requisition_id NULL) — a requisition
                           with no custom stages of its own falls back to
                           the org's default set (see service.
                           get_effective_stages), rather than every new
                           requisition needing its board configured from
                           scratch.
  PipelineEntry          — one candidate's position in one requisition's
                           pipeline. Wraps an Application row (Phase 0
                           spine) rather than duplicating it — Application
                           stays the canonical candidate<->requisition
                           link; PipelineEntry adds the STRUCTURED state
                           (which stage, who owns it, when they entered
                           it) that Application's own free-text `stage`
                           column was always meant to be a placeholder
                           for (see that column's docstring).
  PipelineStageHistory   — audit trail of every stage transition, so
                           "how long did this candidate sit in Client
                           Review" is answerable later without having
                           tracked it specially at the time.
  Offer                  — salary/start-date/status, with an approval
                           step (someone signs off before it's sent) and
                           an expiry date. A pipeline entry can have
                           several over time (one withdrawn, a revised
                           one issued) — not a 1:1, so history isn't lost.
  Placement              — created automatically when an Offer is marked
                           Accepted. Tracks the guarantee period (a
                           recruitment-agency-specific concept: if the
                           placement falls through within N days, it's
                           the agency's problem to replace, not billable
                           again) as a computed end date, not something
                           that has to be manually calculated per hire.

── Design notes ─────────────────────────────────────────────────────────
  - Deliberately does NOT modify the existing Application table (no ALTER
    needed, no migration-gap risk) — everything here is a brand-new table
    linked to Application by FK, created fresh via create_all() same as
    Interview Management (Phase 4). Every FK is indexed at declaration
    for the same reason that matters immediately for a new table (see
    Phase 4's models.py docstring for the ALTER-vs-fresh-create
    distinction, and db/migrate_fix.py for the retrofit cost when that
    distinction is missed).
  - Application.stage (free text) is still updated as a courtesy
    whenever a PipelineEntry's stage changes, purely so anything else
    already reading that older field (e.g. Interview Management's
    auto-advance-on-completion) keeps showing something sensible — the
    STRUCTURED source of truth is PipelineEntry.current_stage_id here.
"""
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime, ForeignKey, Numeric,
)
from sqlalchemy.orm import relationship

from db.database import Base

# Seeded automatically per organisation on first use (see service.
# ensure_default_stages) — a recruiter can rename/reorder/add to these,
# or define an entirely different set for one specific requisition.
DEFAULT_STAGE_TEMPLATE = [
    {"name": "Submitted", "sort_order": 1, "stage_type": "active"},
    {"name": "Client Review", "sort_order": 2, "stage_type": "active"},
    {"name": "Interviewing", "sort_order": 3, "stage_type": "active"},
    {"name": "Offer", "sort_order": 4, "stage_type": "active"},
    {"name": "Placed", "sort_order": 5, "stage_type": "placed"},
    {"name": "Rejected", "sort_order": 6, "stage_type": "rejected"},
]
STAGE_TYPES = ["active", "placed", "rejected"]  # placed/rejected are terminal — see PipelineStage.is_terminal

OFFER_STATUSES = ["Draft", "Pending Approval", "Approved", "Sent", "Accepted", "Rejected", "Withdrawn", "Expired"]
PLACEMENT_STATUSES = ["Active", "Guarantee Period", "Completed", "Fell Through", "Replaced"]


class PipelineStage(Base):
    __tablename__ = "tiq_pipeline_stages"

    id               = Column(Integer, primary_key=True, index=True)
    organisation_id  = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    # NULL = an organisation-wide default-template stage; set = a custom
    # stage that only applies to that one requisition's board.
    requisition_id   = Column(Integer, ForeignKey("tiq_requisitions.id"), index=True, nullable=True)

    name        = Column(String(200), nullable=False)
    sort_order  = Column(Integer, default=1)
    stage_type  = Column(String(20), default="active")   # see STAGE_TYPES
    color       = Column(String(20))   # optional hex, for the Kanban column header

    created_at  = Column(DateTime, default=datetime.utcnow)

    @property
    def is_terminal(self) -> bool:
        return self.stage_type in ("placed", "rejected")


class PipelineEntry(Base):
    """One candidate's position in one requisition's pipeline — wraps an
    Application row (see module docstring for why this isn't columns
    added to Application directly)."""
    __tablename__ = "tiq_pipeline_entries"

    id               = Column(Integer, primary_key=True, index=True)
    organisation_id  = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    sequence_number  = Column(Integer)

    application_id   = Column(Integer, ForeignKey("tiq_applications.id"), index=True, nullable=False, unique=True)
    # Denormalized alongside application_id purely so list/filter queries
    # (e.g. "every pipeline entry for this candidate across all
    # requisitions") don't need a join through Application for the
    # common case — Application remains the source of truth if these
    # ever need reconciling.
    candidate_id     = Column(Integer, ForeignKey("tiq_candidates.id"), index=True, nullable=False)
    requisition_id   = Column(Integer, ForeignKey("tiq_requisitions.id"), index=True, nullable=False)

    owner_user_id    = Column(Integer, ForeignKey("tiq_users.id"), index=True, nullable=True)  # recruiter who owns this candidate's progression
    current_stage_id = Column(Integer, ForeignKey("tiq_pipeline_stages.id"), index=True, nullable=True)
    stage_entered_at = Column(DateTime, default=datetime.utcnow)

    rejection_reason = Column(Text)
    notes            = Column(Text)

    created_at       = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    stage_history = relationship("PipelineStageHistory", back_populates="pipeline_entry", cascade="all, delete-orphan")
    offers        = relationship("Offer", back_populates="pipeline_entry", cascade="all, delete-orphan")


class PipelineStageHistory(Base):
    __tablename__ = "tiq_pipeline_stage_history"

    id                = Column(Integer, primary_key=True, index=True)
    pipeline_entry_id = Column(Integer, ForeignKey("tiq_pipeline_entries.id"), index=True, nullable=False)
    from_stage_id     = Column(Integer, ForeignKey("tiq_pipeline_stages.id"), index=True, nullable=True)
    to_stage_id       = Column(Integer, ForeignKey("tiq_pipeline_stages.id"), index=True, nullable=False)
    changed_by_user_id = Column(Integer, ForeignKey("tiq_users.id"), index=True, nullable=True)
    notes             = Column(Text)
    changed_at        = Column(DateTime, default=datetime.utcnow)

    pipeline_entry = relationship("PipelineEntry", back_populates="stage_history")


class Offer(Base):
    __tablename__ = "tiq_offers"

    id                = Column(Integer, primary_key=True, index=True)
    organisation_id   = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    pipeline_entry_id = Column(Integer, ForeignKey("tiq_pipeline_entries.id"), index=True, nullable=False)
    # Denormalized for direct filtering without a join — same reasoning
    # as PipelineEntry.candidate_id/requisition_id above.
    candidate_id      = Column(Integer, ForeignKey("tiq_candidates.id"), index=True, nullable=False)
    requisition_id    = Column(Integer, ForeignKey("tiq_requisitions.id"), index=True, nullable=False)

    salary_offered    = Column(Numeric(12, 2))
    salary_currency   = Column(String(10), default="AUD")
    start_date        = Column(DateTime, nullable=True)
    status            = Column(String(30), default="Draft")   # see OFFER_STATUSES
    expiry_date       = Column(DateTime, nullable=True)

    approved_by_user_id = Column(Integer, ForeignKey("tiq_users.id"), index=True, nullable=True)
    approved_at         = Column(DateTime, nullable=True)

    notes             = Column(Text)
    created_at        = Column(DateTime, default=datetime.utcnow)
    updated_at        = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    pipeline_entry = relationship("PipelineEntry", back_populates="offers")
    placement      = relationship("Placement", back_populates="offer", uselist=False, cascade="all, delete-orphan")


class Placement(Base):
    """Created automatically when an Offer is marked Accepted (see
    service.create_placement_from_offer). One placement per offer —
    if a placement later falls through and a replacement is hired, that
    replacement is its OWN new Offer -> Placement pair, linked back via
    replaces_placement_id, not a mutation of this row (keeps the
    guarantee-period history for the original hire intact)."""
    __tablename__ = "tiq_placements"

    id                = Column(Integer, primary_key=True, index=True)
    organisation_id   = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    offer_id          = Column(Integer, ForeignKey("tiq_offers.id"), index=True, nullable=False, unique=True)
    candidate_id      = Column(Integer, ForeignKey("tiq_candidates.id"), index=True, nullable=False)
    requisition_id    = Column(Integer, ForeignKey("tiq_requisitions.id"), index=True, nullable=False)

    start_date          = Column(DateTime, nullable=False)
    fee_amount          = Column(Numeric(12, 2))
    fee_currency        = Column(String(10), default="AUD")
    guarantee_period_days = Column(Integer, default=90)
    guarantee_end_date  = Column(DateTime, nullable=True)   # computed at creation = start_date + guarantee_period_days

    status              = Column(String(30), default="Active")   # see PLACEMENT_STATUSES
    fell_through_reason = Column(Text)
    replaces_placement_id = Column(Integer, ForeignKey("tiq_placements.id"), index=True, nullable=True)

    notes             = Column(Text)
    created_at        = Column(DateTime, default=datetime.utcnow)
    updated_at        = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    offer = relationship("Offer", back_populates="placement")
