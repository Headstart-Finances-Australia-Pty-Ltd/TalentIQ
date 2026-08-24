"""
TalentIQ — Capability: Job Requisitions (Phase 2)

Builds on: Phase 0 (Requisition table, Application FK), reuses the existing
JD Creator and Client CRUD as-is (see main.py docstring below for what's
kept unchanged).

── This capability owns ────────────────────────────────────────────────
  Requisition     — was a Phase 0 stub (title/status/client/owner only) in
                    capabilities/acquisition/models.py. MOVED here and
                    extended with the real intake workflow: approval
                    status, vacancy count, priority, hiring manager,
                    target date, and an intake checklist. Same table
                    (tiq_requisitions) — moving the Python class to this
                    file does not touch the database; Application's FK to
                    tiq_requisitions.id keeps working exactly as before.
  ClientContact   — a Client account has multiple people (HR manager,
                    hiring manager, finance contact...), not one. New
                    table, additive only.

── Explicitly NOT built here (see capability plan) ────────────────────
  - Full hiring-manager login/RBAC — that's Phase 9's job. Instead, a
    hiring manager gets a token-based read-only status link (same proven
    pattern as the candidate portal / career page), which satisfies
    "hiring manager can see their requisition" without a premature
    multi-user auth system.
  - Sales/BD CRM (leads, opportunities) — explicitly out of scope.
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from db.database import Base

REQUISITION_STATUSES = ["Draft", "Approved", "Open", "On Hold", "Filled", "Cancelled"]
# The only forward transitions allowed without going back through approval —
# keeps the workflow honest (e.g. can't go straight from Draft to Filled).
REQUISITION_STATUS_TRANSITIONS = {
    "Draft": ["Approved", "Cancelled"],
    "Approved": ["Open", "Cancelled"],
    "Open": ["On Hold", "Filled", "Cancelled"],
    "On Hold": ["Open", "Cancelled"],
    "Filled": [],
    "Cancelled": [],
}
REQUISITION_PRIORITIES = ["Critical", "High", "Normal", "Low"]
REQUISITION_REASONS = ["New Position", "Replacement", "Backfill", "Growth"]
EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Temporary"]


class Requisition(Base):
    __tablename__ = "tiq_requisitions"

    id                 = Column(Integer, primary_key=True, index=True)
    organisation_id    = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    sequence_number    = Column(Integer)
    owner_user_id      = Column(Integer, ForeignKey("tiq_users.id"), index=True, nullable=False)  # recruiter
    client_id          = Column(Integer, ForeignKey("tiq_clients.id"), index=True, nullable=True)
    jd_record_id       = Column(Integer, ForeignKey("tiq_jd_records.id"), index=True, nullable=True)  # bridge into existing JD Creator/Management

    title              = Column(String(300), nullable=False)
    status             = Column(String(30), default="Draft")  # see REQUISITION_STATUSES
    priority           = Column(String(20), default="Normal")  # see REQUISITION_PRIORITIES
    vacancy_count      = Column(Integer, default=1)
    reason_for_hire    = Column(String(30))  # see REQUISITION_REASONS
    employment_type    = Column(String(50))  # see EMPLOYMENT_TYPES
    location           = Column(String(300))
    salary_min         = Column(Integer)
    salary_max         = Column(Integer)
    target_hire_date   = Column(DateTime, nullable=True)

    # Hiring manager — deliberately NOT a hard FK to tiq_users, since the
    # hiring manager is very often someone at the CLIENT, not a TalentIQ
    # platform user. A ClientContact can be linked when one exists; the
    # plain name/email fields are the fallback for ad-hoc / in-house cases.
    hiring_manager_contact_id = Column(Integer, ForeignKey("tiq_client_contacts.id"), index=True, nullable=True)
    hiring_manager_name       = Column(String(200))
    hiring_manager_email      = Column(String(200))

    # Intake checklist — the plan's "confirmed before opening" gate.
    salary_approved      = Column(Boolean, default=False)
    headcount_approved    = Column(Boolean, default=False)
    jd_approved           = Column(Boolean, default=False)
    location_confirmed    = Column(Boolean, default=False)

    approved_at         = Column(DateTime, nullable=True)
    approved_by_user_id  = Column(Integer, ForeignKey("tiq_users.id"), index=True, nullable=True)

    # Token-based read-only hiring-manager view link — same pattern as the
    # candidate portal token and the public interview link, proven already.
    hm_view_token       = Column(String(64), unique=True, index=True, nullable=True)

    notes              = Column(Text)
    created_at         = Column(DateTime, default=datetime.utcnow)
    updated_at         = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    applications = relationship("Application", back_populates="requisition")
    hiring_manager_contact = relationship("ClientContact", foreign_keys=[hiring_manager_contact_id])

    @property
    def checklist_complete(self) -> bool:
        return all([self.salary_approved, self.headcount_approved, self.jd_approved, self.location_confirmed])


class ClientContact(Base):
    """A person at a client company — a Client account can have several
    (HR manager, hiring manager, finance/AP contact...). Independent of
    Requisition; a Requisition's hiring_manager_contact_id just points at
    one of these when the hiring manager is a formal client contact."""
    __tablename__ = "tiq_client_contacts"

    id              = Column(Integer, primary_key=True, index=True)
    organisation_id = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    client_id       = Column(Integer, ForeignKey("tiq_clients.id"), index=True, nullable=False)

    name       = Column(String(200), nullable=False)
    title      = Column(String(200))
    email      = Column(String(200))
    phone      = Column(String(50))
    department = Column(String(100))
    is_primary = Column(Boolean, default=False)
    notes      = Column(Text)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
