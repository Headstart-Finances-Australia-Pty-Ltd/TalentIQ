"""
TalentIQ — Capability: Governance (Phase 9)

Leadership sees the business; permissions match real roles. Two halves:

  - Reporting: time-to-fill, funnel conversion, source-of-hire, and
    recruiter/vendor performance — computed from data that already exists
    across every other capability (Requisition, PipelineEntry,
    PipelineStageHistory, Placement, Candidate.source, VendorSubmission),
    not duplicated into new tables here.
  - Access Control: OrganisationMembership — the concrete team/role
    feature the rest of this app was explicitly designed to support
    without a schema rewrite (see capabilities/acquisition/models.py's
    Organisation docstring: "a future 'invite teammates into my org'
    feature is additive"). Today, an Organisation has exactly one user
    (owner_user_id) — this table is what makes "Owner, Manager, Recruiter"
    a real, multi-person distinction instead of a UI label with nothing
    behind it.

── Design notes ─────────────────────────────────────────────────────────
  - OrganisationMembership does NOT include a row for the org's original
    owner — Organisation.owner_user_id remains the single source of truth
    for who that is (see service.get_effective_role). This table only
    holds ADDITIONAL members invited in later, so there's no backfill
    migration needed for organisations that already exist.
  - Scope, stated plainly: only the Governance module's OWN endpoints
    (the reporting metrics below) actually check and enforce role-based
    scoping. Every other capability built in this app (Requisitions,
    Candidates, Interviews, Pipeline, Portals, Comms, Commercials)
    remains organisation-wide for any member — retrofitting per-role
    enforcement across eight already-shipped capabilities is a
    substantially larger undertaking than this phase, and doing it
    partially/incorrectly would be worse than being explicit that it
    isn't done. What ships here is real (an actual team with actual
    roles, and the new reporting views actually respect them) rather
    than a checkbox that looks complete but doesn't do anything.
  - This table is brand new, linked to Organisation/User by FK — nothing
    existing is modified, so there's no ALTER-migration risk (same
    reasoning as every other capability added this session).
"""
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, DateTime, ForeignKey, UniqueConstraint,
)

from db.database import Base

MEMBER_ROLES = ["Manager", "Recruiter"]   # "Owner" is never stored here — see module docstring


class OrganisationMembership(Base):
    __tablename__ = "tiq_organisation_memberships"
    __table_args__ = (UniqueConstraint("organisation_id", "user_id", name="uq_org_membership"),)

    id                  = Column(Integer, primary_key=True, index=True)
    organisation_id     = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    user_id             = Column(Integer, ForeignKey("tiq_users.id"), index=True, nullable=False)
    role                = Column(String(20), default="Recruiter")   # see MEMBER_ROLES
    invited_by_user_id  = Column(Integer, ForeignKey("tiq_users.id"), index=True, nullable=True)
    joined_at           = Column(DateTime, default=datetime.utcnow)
