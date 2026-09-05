"""
TalentIQ — Capability: Communication & Automation (Phase 7)

Every meaningful action logged automatically, in one place. Three linked
pieces:

  - EmailTemplate: reusable subject/body with {{placeholder}} substitution
    (candidate_name, requisition_title, client_name, etc.).
  - CommunicationLog: the "unified timeline" — every email sent (whether
    manually composed or auto-fired), plus manual notes/calls a recruiter
    logs by hand, all in one append-only log that can attach to a
    candidate, client, vendor, or requisition (whichever are relevant —
    most rows only set one or two of those FKs, all nullable).
  - AutomationRule + AutomationRunLog: "when X happens, send template Y" —
    wired into the ACTUAL trigger points in Interview Management and
    Pipeline & Placements (see those routers' calls into
    service.fire_automation), not a separate parallel system that only
    fires from inside this capability's own endpoints.

── Design notes ─────────────────────────────────────────────────────────
  - Real email sending, not a stub: reuses the SMTP credential/sending
    pattern already proven in routers/joblens.py (_get_smtp_config /
    _send_email — private per-user credentials, same "smtp" service key
    used there). If SMTP isn't configured, the send attempt is logged as
    Failed with a clear reason rather than silently no-op'ing or blocking
    the underlying action it was triggered from (see service.py).
  - Every table here is brand new, linked by FK — nothing existing is
    modified, so there's no ALTER-migration risk (same reasoning as
    Interview Management, Pipeline & Placements, and Client & Vendor
    Collaboration's model files).
"""
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime, ForeignKey,
)

from db.database import Base

TEMPLATE_CATEGORIES = ["Interview Invite", "Offer", "Rejection", "Follow-up", "General"]
COMMUNICATION_CHANNELS = ["Email", "Note", "Call", "SMS"]
COMMUNICATION_DIRECTIONS = ["Outbound", "Inbound", "Internal"]
COMMUNICATION_STATUSES = ["Sent", "Failed", "Logged"]   # Logged = a manual note, not an actual send attempt

# Trigger events an AutomationRule can fire on — matched against the
# string the calling router passes into service.fire_automation. Kept as
# plain strings (not a DB enum) so a new trigger point can be wired up by
# any capability without a migration.
TRIGGER_EVENTS = [
    "interview_scheduled", "interview_completed",
    "offer_sent", "offer_accepted", "offer_rejected",
    "pipeline_stage_changed", "placement_created",
]


class EmailTemplate(Base):
    __tablename__ = "tiq_email_templates"

    id              = Column(Integer, primary_key=True, index=True)
    organisation_id = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    name            = Column(String(200), nullable=False)
    category        = Column(String(30), default="General")   # see TEMPLATE_CATEGORIES
    subject         = Column(String(300), nullable=False)
    body            = Column(Text, nullable=False)   # supports {{candidate_name}}, {{requisition_title}}, {{client_name}}, etc. — see service.render_template
    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class CommunicationLog(Base):
    """One entry in the unified timeline. Most rows set only one or two of
    the FKs below — e.g. a candidate email sets candidate_id (+ maybe
    requisition_id for context), a client call note sets client_id.
    Deliberately one flexible table rather than a separate log per entity
    type, so "everything that happened with this candidate" is one query,
    not a UNION across several tables."""
    __tablename__ = "tiq_communication_log"

    id                = Column(Integer, primary_key=True, index=True)
    organisation_id   = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)

    candidate_id      = Column(Integer, ForeignKey("tiq_candidates.id"), index=True, nullable=True)
    # CandidateLens/JobLens candidates (tiq_joblens_candidates) are a
    # SEPARATE table from the Talent Pool's tiq_candidates that
    # candidate_id above points at — same bridge Interview already needed
    # (see capabilities/interview/models.py's joblens_candidate_id
    # docstring). candidate_id / joblens_candidate_id: set one, never
    # both, enforced in code (log_manual_send/fire_automation), not a DB
    # constraint, to avoid a migration-breaking CHECK on existing rows.
    joblens_candidate_id = Column(Integer, ForeignKey("tiq_joblens_candidates.id"), index=True, nullable=True)
    client_id         = Column(Integer, ForeignKey("tiq_clients.id"), index=True, nullable=True)
    vendor_id         = Column(Integer, ForeignKey("tiq_vendors.id"), index=True, nullable=True)
    requisition_id    = Column(Integer, ForeignKey("tiq_requisitions.id"), index=True, nullable=True)
    pipeline_entry_id = Column(Integer, ForeignKey("tiq_pipeline_entries.id"), index=True, nullable=True)

    channel           = Column(String(20), default="Email")   # see COMMUNICATION_CHANNELS
    direction         = Column(String(20), default="Outbound")   # see COMMUNICATION_DIRECTIONS
    subject           = Column(String(300))
    body              = Column(Text)
    template_id       = Column(Integer, ForeignKey("tiq_email_templates.id"), index=True, nullable=True)

    # Which module/action produced this row (e.g. "Video Interview —
    # Invite", "Phone Interview — Calendly Link", "Screening Decision —
    # Rejection Email") — see service.SOURCE_MODULES. Null for rows
    # created directly inside Comms itself (manual /log, /send-email).
    source_module     = Column(String(60), nullable=True)

    status            = Column(String(20), default="Logged")   # see COMMUNICATION_STATUSES
    failure_reason    = Column(Text)

    # Distinguishes a human-composed send/note from one an AutomationRule
    # fired — both land in the same timeline, this just says which.
    automated         = Column(Boolean, default=False)
    automation_rule_id = Column(Integer, ForeignKey("tiq_automation_rules.id"), index=True, nullable=True)

    sent_by_user_id   = Column(Integer, ForeignKey("tiq_users.id"), index=True, nullable=True)
    sent_at           = Column(DateTime, default=datetime.utcnow)


class AutomationRule(Base):
    __tablename__ = "tiq_automation_rules"

    id              = Column(Integer, primary_key=True, index=True)
    organisation_id = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    name            = Column(String(200), nullable=False)
    trigger_event   = Column(String(40), nullable=False)   # see TRIGGER_EVENTS
    # Only meaningful when trigger_event="pipeline_stage_changed" — the
    # rule fires when a PipelineEntry's stage NAME matches this (e.g.
    # "Rejected", "Placed"). Free text, not a stage_id FK, because a
    # requisition's custom stages and the org's default stages are
    # different rows with different IDs even when they share a name —
    # matching by name is what actually generalizes across both.
    trigger_stage_name = Column(String(200), nullable=True)
    template_id     = Column(Integer, ForeignKey("tiq_email_templates.id"), index=True, nullable=False)
    is_active       = Column(Boolean, default=True)
    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AutomationRunLog(Base):
    """Audit trail of every time an AutomationRule actually fired —
    separate from CommunicationLog (which records the resulting email
    itself) so "did my automation even run, and how often" is answerable
    without filtering the whole timeline down by automation_rule_id."""
    __tablename__ = "tiq_automation_run_log"

    id                  = Column(Integer, primary_key=True, index=True)
    organisation_id     = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    automation_rule_id  = Column(Integer, ForeignKey("tiq_automation_rules.id"), index=True, nullable=False)
    communication_log_id = Column(Integer, ForeignKey("tiq_communication_log.id"), index=True, nullable=True)
    target_description  = Column(String(300))   # e.g. "Nora Kumar — Backend Engineer"
    status              = Column(String(20))     # Sent / Failed / Skipped
    detail              = Column(Text)           # error message, or why it was skipped (e.g. "candidate has no email on file")
    triggered_at        = Column(DateTime, default=datetime.utcnow)
