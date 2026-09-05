"""
TalentIQ — Capability: Commercials (Phase 8)

The money side of a placement, tracked inside the platform — the
essentials an agency needs without a full accounting system: placement
fee invoicing (deliberately single-line, not a general ledger), guarantee/
rebate deadline visibility, optional contractor timesheets, and a revenue
report.

── This capability owns ────────────────────────────────────────────────
  Invoice          — one single-line invoice against a Placement (Phase 5).
                     Multiple invoices per placement ARE allowed (not
                     unique) — a voided/reissued invoice, or a split
                     payment, shouldn't require deleting history, same
                     reasoning as Offer allowing several per
                     PipelineEntry.
  TimesheetEntry   — optional, for contract (not permanent) placements:
                     one row per week worked, feeding into an invoice
                     amount rather than the flat placement fee.

── Design notes ─────────────────────────────────────────────────────────
  - Guarantee/rebate deadline "alerts" reuse Placement.guarantee_end_date
    (already computed and stored since Phase 5 — see
    capabilities/pipeline/models.py) rather than duplicating that date
    onto a new table. This capability only adds the QUERY that surfaces
    placements approaching that date — see router.get_guarantee_alerts.
  - Every table here is brand new, linked to Placement/Requisition/Client
    by FK — nothing existing is modified, so there's no ALTER-migration
    risk (same reasoning as every other capability added this session).
"""
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, Numeric, Date,
)

from db.database import Base

INVOICE_STATUSES = ["Draft", "Sent", "Paid", "Overdue", "Cancelled"]
TIMESHEET_STATUSES = ["Submitted", "Approved", "Invoiced", "Rejected"]
INTERVIEWER_PAYMENT_STATUSES = ["Pending", "Approved", "Paid"]


class Invoice(Base):
    __tablename__ = "tiq_invoices"

    id              = Column(Integer, primary_key=True, index=True)
    organisation_id = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    sequence_number = Column(Integer)   # per-organisation display number, same pattern as elsewhere

    placement_id    = Column(Integer, ForeignKey("tiq_placements.id"), index=True, nullable=False)
    # Denormalized alongside placement_id purely so list/filter queries
    # ("every invoice for this client") don't need a join through
    # Placement -> Requisition for the common case — same reasoning as
    # PipelineEntry.candidate_id/requisition_id in Phase 5.
    client_id       = Column(Integer, ForeignKey("tiq_clients.id"), index=True, nullable=True)
    requisition_id  = Column(Integer, ForeignKey("tiq_requisitions.id"), index=True, nullable=True)

    invoice_number  = Column(String(50))   # human-facing reference, e.g. "INV-2026-0001" — free text, not enforced-unique at the DB level (a recruiter may run their own numbering scheme)
    description     = Column(String(300))   # single line — deliberately not a line-item table, see module docstring
    amount          = Column(Numeric(12, 2), nullable=False)
    currency        = Column(String(10), default="AUD")
    status          = Column(String(20), default="Draft")   # see INVOICE_STATUSES

    issue_date      = Column(Date, nullable=True)
    due_date        = Column(Date, nullable=True)
    paid_date       = Column(Date, nullable=True)

    notes           = Column(Text)
    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TimesheetEntry(Base):
    """Optional — only relevant for contract (not permanent) placements
    billed by hours worked rather than a flat placement fee. One row per
    week; an Invoice can be generated FROM a set of approved timesheet
    entries (see router.create_invoice_from_timesheets), but the two
    aren't rigidly linked at the schema level — a recruiter can also just
    invoice a flat amount directly without ever touching timesheets."""
    __tablename__ = "tiq_timesheet_entries"

    id              = Column(Integer, primary_key=True, index=True)
    organisation_id = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    placement_id    = Column(Integer, ForeignKey("tiq_placements.id"), index=True, nullable=False)

    week_ending     = Column(Date, nullable=False)
    hours           = Column(Numeric(6, 2), nullable=False)
    rate            = Column(Numeric(10, 2), nullable=False)
    currency        = Column(String(10), default="AUD")

    status          = Column(String(20), default="Submitted")   # see TIMESHEET_STATUSES
    invoice_id      = Column(Integer, ForeignKey("tiq_invoices.id"), index=True, nullable=True)   # set once rolled into an invoice

    notes           = Column(Text)
    submitted_at    = Column(DateTime, default=datetime.utcnow)
    approved_by_user_id = Column(Integer, ForeignKey("tiq_users.id"), index=True, nullable=True)
    approved_at     = Column(DateTime, nullable=True)

    @property
    def amount(self):
        return float(self.hours) * float(self.rate)


class InterviewerPayment(Base):
    """The money side of a Panel Interview round — auto-generated the
    moment a round involving an EXTERNAL PanelInterviewer (see
    capabilities/interview/models.py's PanelInterviewer.interviewer_type)
    is marked Completed (see capabilities/interview/router.py's
    change_interview_status). One row per (interview round, external
    interviewer) pair.

    hourly_rate and hours are both SNAPSHOTTED at creation time — rate
    from PanelInterviewer.hourly_rate as it stood at that moment, hours
    from Interview.duration_minutes / 60 — so a later edit to either the
    interviewer's rate or the round's duration never retroactively
    changes what's already owed for a past interview. candidate_name /
    round_name / requisition_title are denormalized display snapshots
    for the same reason Invoice denormalizes client_id/requisition_id
    alongside placement_id (see module docstring) — this table needs to
    keep meaning something even if the source Interview/PanelInterviewer
    row is later edited or deleted.
    """
    __tablename__ = "tiq_interviewer_payments"

    id                   = Column(Integer, primary_key=True, index=True)
    organisation_id      = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)

    interview_id         = Column(Integer, ForeignKey("tiq_interviews.id"), index=True, nullable=False)
    panel_interviewer_id = Column(Integer, ForeignKey("tiq_panel_interviewers.id"), index=True, nullable=False)

    interviewer_name     = Column(String(200))
    interviewer_email    = Column(String(200))
    candidate_name        = Column(String(200))
    round_name            = Column(String(200))
    requisition_title     = Column(String(300))

    hours                = Column(Numeric(6, 2), nullable=False)
    hourly_rate          = Column(Numeric(10, 2), nullable=False)
    currency             = Column(String(10), default="AUD")

    status               = Column(String(20), default="Pending")   # see INTERVIEWER_PAYMENT_STATUSES
    paid_date            = Column(Date, nullable=True)
    notes                = Column(Text)

    created_at           = Column(DateTime, default=datetime.utcnow)
    updated_at           = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    @property
    def amount(self):
        return float(self.hours) * float(self.hourly_rate)
