"""
TalentIQ — Capability: Onboarding (Phase 5, alongside Pipeline & Offers)

The step most popular hiring platforms treat as core and this one was
missing entirely: what happens between "offer accepted, Placement
created" and the new hire actually being productive. A Placement row
already exists the moment an Offer is marked Accepted (see
pipeline/service.py's create_placement_from_offer) — this capability
attaches an onboarding checklist to that same Placement, seeded with a
sensible default set of tasks automatically so a recruiter/HR user isn't
starting from a blank page for every single hire.

── This capability owns ────────────────────────────────────────────────
  OnboardingTask  — one checklist item for one Placement: compliance
                    checks, required training, and system/instrument
                    access, alongside paperwork and orientation.
                    Modelled as rows, not fixed columns on Placement,
                    so the checklist is editable per hire rather than a
                    single hardcoded list every placement is forced
                    through identically.
  ReferenceCheck  — one referee record for one Placement. Reference
                    checks are tracked separately from the generic
                    checklist (rather than as a single "run reference
                    checks" tick-box) because there's usually more than
                    one referee, each with their own contact details,
                    outcome, and evidence — and that evidence can arrive
                    either as an ONLINE check (referee filled in a form
                    themselves / recruiter typed up notes from a call)
                    or an OFFLINE check (a scanned/emailed paper form),
                    so the record stores both a structured outcome and,
                    for the offline case, the original form as a file.

Registered in main.py as: /api/onboarding/*
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, LargeBinary
from db.database import Base

# Default checklist seeded onto every new Placement — see
# capabilities/pipeline/service.py's create_placement_from_offer, which
# calls seed_default_tasks (service.py in this same package) right after
# creating the Placement. Deliberately a plain list here (not its own DB
# table) — these are just the STARTING titles/categories, editable per
# hire after they're created as real OnboardingTask rows; there's no
# ongoing "template" concept to manage separately.
#
# "Run background/reference checks" deliberately stays as a checklist
# item too (not only the dedicated Reference Checks tab below) — it's
# the at-a-glance "has this been started at all" tick-box, while the
# Reference Checks tab is where the actual referee-by-referee detail
# and evidence lives.
DEFAULT_ONBOARDING_TASKS = [
    {"title": "Send employment contract for signature", "category": "Paperwork"},
    {"title": "Collect signed contract, bank & super/tax details", "category": "Paperwork"},
    {"title": "Run background/reference checks (see Reference Checks tab)", "category": "Compliance"},
    {"title": "Verify right-to-work / visa status", "category": "Compliance"},
    {"title": "Order laptop and equipment", "category": "IT & Equipment"},
    {"title": "Set up company email and system access", "category": "IT & Equipment"},
    {"title": "Provision role-specific instrument/tool access", "category": "IT & Equipment"},
    {"title": "Add to payroll", "category": "Compliance"},
    {"title": "Complete mandatory compliance/induction training", "category": "Training"},
    {"title": "Complete role-specific product/systems training", "category": "Training"},
    {"title": "Assign onboarding buddy / manager introduction", "category": "Orientation"},
    {"title": "Schedule first-day orientation", "category": "Orientation"},
]

ONBOARDING_CATEGORIES = ["Paperwork", "Compliance", "Training", "IT & Equipment", "Orientation", "General"]

REFERENCE_CHECK_MODES = ["Online", "Offline"]
REFERENCE_CHECK_STATUSES = ["Pending", "Requested", "Completed", "Unable to Reach"]
REFERENCE_CHECK_RECOMMENDATIONS = ["Positive", "Mixed", "Negative", "Not yet assessed"]


class OnboardingTask(Base):
    __tablename__ = "tiq_onboarding_tasks"

    id               = Column(Integer, primary_key=True, index=True)
    organisation_id  = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    placement_id     = Column(Integer, ForeignKey("tiq_placements.id"), index=True, nullable=False)

    title            = Column(String(300), nullable=False)
    category         = Column(String(50), default="General")   # see ONBOARDING_CATEGORIES
    due_date         = Column(DateTime, nullable=True)
    completed        = Column(Boolean, default=False)
    completed_at     = Column(DateTime, nullable=True)
    assigned_to      = Column(String(200))   # free text — no user-account linking required, same spirit as Interview.interviewers
    notes            = Column(Text)
    sort_order       = Column(Integer, default=0)

    created_at       = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ReferenceCheck(Base):
    __tablename__ = "tiq_reference_checks"

    id               = Column(Integer, primary_key=True, index=True)
    organisation_id  = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    placement_id     = Column(Integer, ForeignKey("tiq_placements.id"), index=True, nullable=False)

    # ── Referee ──────────────────────────────────────────────────────
    referee_name     = Column(String(200), nullable=False)
    referee_title    = Column(String(200))            # their job title
    referee_company  = Column(String(200))
    relationship     = Column(String(100))             # e.g. "Direct Manager", "HR", "Peer"
    referee_email    = Column(String(200))
    referee_phone    = Column(String(50))

    # ── How it was collected ────────────────────────────────────────
    # "Online"  — referee filled in a form themselves, or the check was
    #              logged directly in TalentIQ (e.g. notes from a call).
    # "Offline" — a paper/scanned/emailed form, stored as a file below.
    mode             = Column(String(20), default="Online")   # see REFERENCE_CHECK_MODES
    status           = Column(String(30), default="Pending")  # see REFERENCE_CHECK_STATUSES
    conducted_by     = Column(String(200))            # recruiter/HR user who ran the check, free text
    conducted_at     = Column(DateTime, nullable=True)

    # ── Outcome ──────────────────────────────────────────────────────
    recommendation   = Column(String(30), default="Not yet assessed")  # see REFERENCE_CHECK_RECOMMENDATIONS
    would_rehire     = Column(Boolean, nullable=True)
    rating           = Column(Integer, nullable=True)  # 1–5 overall, optional
    summary          = Column(Text)                    # notes / write-up of the conversation or form answers

    # ── Stored offline form (scanned/uploaded document) ─────────────
    form_blob        = Column(LargeBinary, nullable=True)
    form_filename    = Column(String(300))
    form_mimetype    = Column(String(100))

    sort_order       = Column(Integer, default=0)
    created_at       = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
