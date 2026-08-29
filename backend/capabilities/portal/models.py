"""
TalentIQ — Capability: Client & Vendor Collaboration (Phase 6)

Clients and vendors participate directly — no more email back-and-forth.
Two token-based portals (same pattern as every other public flow in this
app: Candidate.portal_token, Requisition.hm_view_token, Interview's
self-schedule token — a long random string IS the auth, no separate
client/vendor login system needed):

  - Client portal: a hiring-company contact can see the pipeline for
    THEIR requisitions only, leave feedback on a candidate, request an
    interview, and download a resume — but never sees salary/fee/offer
    data, and never sees a candidate's direct email/phone (an agency
    convention: contact details stay with the agency until placement is
    settled, so a client can't route around the agency and go straight
    to the candidate).
  - Vendor portal: a subcontractor recruiter can see only the
    requisitions they've been explicitly assigned to (see
    VendorRequisitionAssignment — deliberately a NEW explicit grant, not
    inferred from the older, auto-maintained JDVendorLink table in
    models.models, which was built for a different workflow and isn't a
    safe basis for portal *access control*), and submit candidates
    against those. A vendor submission lands in a review queue
    (VendorSubmission, status Pending Review) rather than going straight
    into the live pipeline — the recruiter vets it first.

── Design notes ─────────────────────────────────────────────────────────
  - Every table here is brand new, linked to Client/Vendor/Requisition/
    Candidate/PipelineEntry by FK — nothing existing is modified, so
    there's no ALTER-migration risk (see capabilities/interview/models.py
    and capabilities/pipeline/models.py docstrings for why that
    distinction matters; the same logic applies here).
  - ClientPortalAccess/VendorPortalAccess are separate one-row-per-client/
    vendor tables (not a token column added directly to Client/Vendor)
    for the same zero-ALTER-risk reason — Client and Vendor already exist
    in production schemas from earlier phases.
"""
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime, ForeignKey, UniqueConstraint, LargeBinary,
)

from db.database import Base

VENDOR_SUBMISSION_STATUSES = ["Pending Review", "Accepted", "Rejected"]
CLIENT_FEEDBACK_DECISIONS = ["Approved", "Rejected", "Interview Requested", "Feedback Only"]


class ClientPortalAccess(Base):
    __tablename__ = "tiq_client_portal_access"

    id              = Column(Integer, primary_key=True, index=True)
    organisation_id = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    client_id       = Column(Integer, ForeignKey("tiq_clients.id"), index=True, nullable=False, unique=True)
    token           = Column(String(64), unique=True, index=True, nullable=False)
    created_at      = Column(DateTime, default=datetime.utcnow)
    revoked_at      = Column(DateTime, nullable=True)   # rotating/revoking a link sets this instead of deleting the row, so old links fail with a clear "revoked" message rather than a bare 404


class VendorPortalAccess(Base):
    __tablename__ = "tiq_vendor_portal_access"

    id              = Column(Integer, primary_key=True, index=True)
    organisation_id = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    vendor_id       = Column(Integer, ForeignKey("tiq_vendors.id"), index=True, nullable=False, unique=True)
    token           = Column(String(64), unique=True, index=True, nullable=False)
    created_at      = Column(DateTime, default=datetime.utcnow)
    revoked_at      = Column(DateTime, nullable=True)


class VendorRequisitionAssignment(Base):
    """Explicit "this vendor may submit candidates for this requisition"
    grant — deliberately separate from the older JDVendorLink (see module
    docstring): that table is auto-maintained as a side-effect of a
    different, legacy workflow, which makes it the wrong foundation for
    something access-control-sensitive like "what can this vendor's
    portal link see and do.\""""
    __tablename__ = "tiq_vendor_requisition_assignments"
    __table_args__ = (UniqueConstraint("vendor_id", "requisition_id", name="uq_vendor_requisition"),)

    id              = Column(Integer, primary_key=True, index=True)
    organisation_id = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    vendor_id       = Column(Integer, ForeignKey("tiq_vendors.id"), index=True, nullable=False)
    requisition_id  = Column(Integer, ForeignKey("tiq_requisitions.id"), index=True, nullable=False)
    assigned_at     = Column(DateTime, default=datetime.utcnow)


class VendorSubmission(Base):
    """A candidate a vendor submitted through their portal — starts in a
    review queue rather than landing directly in the Candidate Master or
    live pipeline, so the recruiter can vet it first.

    Deliberately stores the raw submitted fields on ITSELF (full_name,
    email, etc.) rather than creating a Candidate row immediately at
    submission time: candidate_id/pipeline_entry_id stay NULL until
    Accepted. Creating a full Candidate Master record for every raw,
    unvetted vendor submission would recreate exactly the "hundreds of
    unreviewed/junk candidate rows cluttering the main list" problem this
    app has already been bitten by once (see the bulk-folder-import
    duplicate-detection fix elsewhere in this codebase) — triage happens
    here first, and only an Accepted submission promotes into a real
    Candidate + PipelineEntry."""
    __tablename__ = "tiq_vendor_submissions"

    id                 = Column(Integer, primary_key=True, index=True)
    organisation_id    = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    vendor_id          = Column(Integer, ForeignKey("tiq_vendors.id"), index=True, nullable=False)
    requisition_id     = Column(Integer, ForeignKey("tiq_requisitions.id"), index=True, nullable=False)

    full_name          = Column(String(200), nullable=False)
    email              = Column(String(200))
    phone              = Column(String(50))
    current_title      = Column(String(200))
    current_employer   = Column(String(200))
    total_experience_years = Column(String(20))
    vendor_notes       = Column(Text)     # whatever the vendor wrote when submitting (e.g. "strong culture fit, available immediately")

    resume_blob        = Column(LargeBinary)
    resume_filename    = Column(String(300))
    resume_mimetype    = Column(String(100))

    # Set only once Accepted — the promotion into the real system.
    candidate_id       = Column(Integer, ForeignKey("tiq_candidates.id"), index=True, nullable=True)
    pipeline_entry_id  = Column(Integer, ForeignKey("tiq_pipeline_entries.id"), index=True, nullable=True)

    status             = Column(String(20), default="Pending Review")   # see VENDOR_SUBMISSION_STATUSES
    rejection_reason   = Column(Text)

    reviewed_by_user_id = Column(Integer, ForeignKey("tiq_users.id"), index=True, nullable=True)
    reviewed_at         = Column(DateTime, nullable=True)

    submitted_at       = Column(DateTime, default=datetime.utcnow)


class ClientFeedback(Base):
    """One piece of feedback a client contact left on a pipeline entry via
    their portal — approve/reject/request-interview/comment-only. Kept
    as an append-only log (a client can leave several over time as a
    candidate progresses) rather than a single mutable "client_decision"
    field on PipelineEntry, so the history of what a client actually said
    and when isn't lost each time they weigh in again."""
    __tablename__ = "tiq_client_feedback"

    id                = Column(Integer, primary_key=True, index=True)
    organisation_id   = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    pipeline_entry_id = Column(Integer, ForeignKey("tiq_pipeline_entries.id"), index=True, nullable=False)
    client_id         = Column(Integer, ForeignKey("tiq_clients.id"), index=True, nullable=False)

    contact_name      = Column(String(200))   # free text — the client portal has no login/user-account concept, just the token
    decision          = Column(String(30), nullable=False)   # see CLIENT_FEEDBACK_DECISIONS
    comments          = Column(Text)

    acknowledged      = Column(Boolean, default=False)   # recruiter has seen/actioned this feedback
    acknowledged_at   = Column(DateTime, nullable=True)

    submitted_at      = Column(DateTime, default=datetime.utcnow)
