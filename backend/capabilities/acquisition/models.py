"""
TalentIQ — Capability: Candidate Acquisition & Talent Pool (Phase 1)
                        + Foundation Spine (Phase 0)

This module is intentionally self-contained. It does NOT modify
`models/models.py` or any existing router — it only ADDS new tables that
attach to the existing schema via foreign keys (tiq_users, tiq_clients).
`Base.metadata.create_all()` (already run on every startup in main.py)
picks these up automatically, the same way every earlier feature was
added — no destructive migration required.

── Phase 0 (foundation spine — shared by every future capability) ─────────
  Organisation   — tenant boundary. Lazily created per-user for now (see
                   service.get_or_create_default_organisation); the schema
                   is ready for real multi-user orgs later without another
                   migration.
  Requisition    — MOVED to capabilities/requisition/models.py in Phase 2.
                   Still the same table (tiq_requisitions); Application's
                   FK below is unaffected by which file owns the class.
  Application    — Candidate ⇄ Requisition link. A candidate can apply to
                   many requisitions without duplicating the candidate
                   record. Phase 1 only creates these from the public
                   "Apply Now" flow; scoring/pipeline (Phase 3/5) will
                   read and extend this same row rather than replace it.

── Phase 1 (this capability, fully functional on its own) ─────────────────
  Candidate            — the canonical Candidate Master profile.
  TalentPool            — named pools ("Hot", "Alumni", "Finance Bench"...).
  CandidatePoolMember    — many-to-many candidate↔pool membership.
  CandidateMergeLog      — audit trail for merging duplicate candidates.

Nothing in this file requires Requisition/Application data to exist to be
useful — Candidate Acquisition works standalone (per the modular
architecture: a capability must function even if later capabilities are
never built).
"""
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime,
    ForeignKey, JSON, LargeBinary, UniqueConstraint,
)
from sqlalchemy.orm import relationship

from db.database import Base


# ══════════════════════════════════════════════════════════════════════════
# PHASE 0 — FOUNDATION SPINE
# ══════════════════════════════════════════════════════════════════════════

class Organisation(Base):
    """Tenant boundary. One row per account today (owner_user_id), but every
    spine/capability table is already organisation_id-scoped so a future
    "invite teammates into my org" feature is additive, not a schema
    rewrite. See service.get_or_create_default_organisation for creation.
    """
    __tablename__ = "tiq_organisations"

    id               = Column(Integer, primary_key=True, index=True)
    name             = Column(String(300), nullable=False)
    # unique=True is essential, not decorative: get_or_create_default_organisation
    # relies on a real DB-level constraint here for its ON CONFLICT (owner_user_id)
    # race-safe upsert. Without this, a fresh install's ON CONFLICT clause
    # would fail outright (no constraint to conflict against), and multiple
    # concurrent first-requests for the same brand-new user could each
    # create their own Organisation row. See migrate_fix.py for the
    # equivalent CREATE UNIQUE INDEX for databases that already existed
    # before this was added, plus the one-time cleanup of any duplicates
    # that pattern already produced.
    owner_user_id    = Column(Integer, ForeignKey("tiq_users.id"), unique=True, index=True, nullable=False)
    # Public, URL-safe slug used for the unauthenticated "Apply Now" career
    # page — e.g. /careers/{slug}. Generated automatically, regenerable.
    public_apply_slug = Column(String(64), unique=True, index=True, nullable=False)
    created_at       = Column(DateTime, default=datetime.utcnow)


class Application(Base):
    """Candidate ⇄ Requisition. This is the object every later capability
    (Screening, Interview, Pipeline, Offer) will attach its own data to —
    NOT the Candidate row directly — so one person can have several
    applications without fragmenting their identity."""
    __tablename__ = "tiq_applications"
    __table_args__ = (UniqueConstraint("candidate_id", "requisition_id", name="uq_candidate_requisition"),)

    id              = Column(Integer, primary_key=True, index=True)
    organisation_id = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    candidate_id    = Column(Integer, ForeignKey("tiq_candidates.id"), index=True, nullable=False)
    requisition_id  = Column(Integer, ForeignKey("tiq_requisitions.id"), index=True, nullable=True)
    # Optional bridge into the ALREADY-EXISTING JD Management system, so an
    # application can be tied to a real JDRecord today without waiting for
    # the Phase 2 Requisition UI to be built.
    jd_record_id    = Column(Integer, ForeignKey("tiq_jd_records.id"), index=True, nullable=True)

    source          = Column(String(100))          # career_page / manual / referral / sourced
    stage           = Column(String(50), default="New")  # placeholder only — Phase 5 owns the real pipeline
    applied_at      = Column(DateTime, default=datetime.utcnow)
    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    candidate   = relationship("Candidate", back_populates="applications")
    requisition = relationship("Requisition", back_populates="applications")


# ══════════════════════════════════════════════════════════════════════════
# PHASE 1 — CANDIDATE ACQUISITION & TALENT POOL
# ══════════════════════════════════════════════════════════════════════════

CANDIDATE_SOURCES = [
    "career_page", "manual", "referral", "linklens_linkedin",
    "jobhunt_import", "csv_import", "vendor", "bulk_folder_import",
]

CANDIDATE_MASTER_STATUSES = ["Active", "Do Not Contact", "Placed", "Archived"]


class Candidate(Base):
    """The Candidate Master — one canonical record per real person,
    reusable across every requisition they ever apply to. Replaces the
    pattern where candidate data lived only inside a single JD/session
    context; existing modules (JobLens, CandidateTrack, LinkLens) are left
    untouched and keep working exactly as before — this is a new, parallel
    identity layer that future phases will progressively connect to them.
    """
    __tablename__ = "tiq_candidates"

    id               = Column(Integer, primary_key=True, index=True)
    organisation_id  = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    owner_user_id    = Column(Integer, ForeignKey("tiq_users.id"), index=True, nullable=True)  # recruiter who owns this record
    sequence_number  = Column(Integer)  # per-organisation display number, same pattern as elsewhere

    # ── Identity ──────────────────────────────────────────────────────────
    full_name        = Column(String(200), nullable=False)
    email            = Column(String(200), index=True)
    phone            = Column(String(50), index=True)
    location         = Column(String(300))
    linkedin_url     = Column(Text)
    portfolio_url    = Column(Text)

    # ── Professional profile ────────────────────────────────────────────
    current_employer   = Column(String(300))
    current_title      = Column(String(300))
    total_experience_years = Column(String(20))
    skills              = Column(JSON, default=list)
    education           = Column(Text)
    certifications       = Column(JSON, default=list)

    # ── Preferences / logistics ─────────────────────────────────────────
    work_rights            = Column(String(100))   # e.g. Citizen / PR / Work Visa
    salary_expectation      = Column(String(100))
    notice_period_days      = Column(Integer)
    preferred_locations      = Column(JSON, default=list)
    preferred_employment_type = Column(String(100))  # Full-time / Contract / Part-time
    availability             = Column(String(100))

    # ── Acquisition metadata ────────────────────────────────────────────
    source            = Column(String(100), default="manual")   # see CANDIDATE_SOURCES
    referral_source    = Column(String(300))   # free text: who/what referred them, if source=referral
    consent_given      = Column(Boolean, default=False)
    consent_at         = Column(DateTime, nullable=True)
    status             = Column(String(30), default="Active")   # see CANDIDATE_MASTER_STATUSES
    tags               = Column(JSON, default=list)             # free-form tags, in addition to formal pools

    # ── Resume ───────────────────────────────────────────────────────────
    resume_blob      = Column(LargeBinary)
    resume_filename  = Column(String(300))
    resume_mimetype  = Column(String(100))
    resume_text      = Column(Text)

    # ── Cover letter — EITHER an uploaded file (PDF or Word) OR typed text,
    # not mutually exclusive in storage: a recruiter can upload a file
    # (text gets auto-extracted into cover_letter_text for search/preview)
    # and later overwrite it by typing directly, or vice versa. has_cover_letter
    # (see _fmt_candidate) is true if either is present.
    cover_letter_blob      = Column(LargeBinary)
    cover_letter_filename  = Column(String(300))
    cover_letter_mimetype  = Column(String(100))
    cover_letter_text      = Column(Text)

    notes            = Column(Text)
    last_activity_at = Column(DateTime, default=datetime.utcnow)

    # ── Candidate self-service portal (mirrors JobLensCandidate's proven
    # interview_token pattern — a long random token IS the auth, no
    # separate candidate login system needed for Phase 1) ─────────────────
    portal_token     = Column(String(64), unique=True, index=True, nullable=True)

    # ── Merge (duplicate resolution, not just detection) ────────────────
    is_merged        = Column(Boolean, default=False)     # True = this row was merged away, kept for history
    merged_into_id   = Column(Integer, ForeignKey("tiq_candidates.id"), index=True, nullable=True)

    created_at       = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    applications  = relationship("Application", back_populates="candidate", cascade="all, delete-orphan")
    pool_memberships = relationship("CandidatePoolMember", back_populates="candidate", cascade="all, delete-orphan")


class TalentPool(Base):
    """A named, reusable grouping of candidates — Hot, Alumni, Finance
    Bench, Future Opportunities, etc. Independent of any single
    requisition, so a candidate can sit in a pool long before (or after)
    they have an active application."""
    __tablename__ = "tiq_talent_pools"

    id               = Column(Integer, primary_key=True, index=True)
    organisation_id  = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("tiq_users.id"), index=True, nullable=False)
    name             = Column(String(200), nullable=False)
    description      = Column(Text)
    created_at       = Column(DateTime, default=datetime.utcnow)

    members = relationship("CandidatePoolMember", back_populates="pool", cascade="all, delete-orphan")


class CandidatePoolMember(Base):
    __tablename__ = "tiq_candidate_pool_members"
    __table_args__ = (UniqueConstraint("pool_id", "candidate_id", name="uq_pool_candidate"),)

    id           = Column(Integer, primary_key=True, index=True)
    pool_id      = Column(Integer, ForeignKey("tiq_talent_pools.id"), index=True, nullable=False)
    candidate_id = Column(Integer, ForeignKey("tiq_candidates.id"), index=True, nullable=False)
    added_at     = Column(DateTime, default=datetime.utcnow)

    pool      = relationship("TalentPool", back_populates="members")
    candidate = relationship("Candidate", back_populates="pool_memberships")


class CandidateMergeLog(Base):
    """Audit trail for candidate merges. Duplicate DETECTION alone isn't
    enough — a recruiter needs a way to actually resolve it, and a record
    of what happened so a bad merge is at least traceable. `field_snapshot`
    preserves the merged-away candidate's data verbatim in case anything
    needs to be recovered later."""
    __tablename__ = "tiq_candidate_merge_log"

    id                    = Column(Integer, primary_key=True, index=True)
    organisation_id       = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    primary_candidate_id  = Column(Integer, ForeignKey("tiq_candidates.id"), index=True, nullable=False)  # survivor
    merged_candidate_id   = Column(Integer, ForeignKey("tiq_candidates.id"), index=True, nullable=False)  # merged away
    merged_by_user_id     = Column(Integer, ForeignKey("tiq_users.id"), index=True, nullable=False)
    field_snapshot        = Column(JSON)   # full dict of the merged-away candidate's fields, pre-merge
    merged_at             = Column(DateTime, default=datetime.utcnow)
