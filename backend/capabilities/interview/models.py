"""
TalentIQ — Capability: Interview Management (Phase 4)

From "let's interview them" to a recorded decision. Complements the AI
video interviews already built into CandidateLens (JobLensCandidate) —
this is the HUMAN side: scheduling a real conversation (in person, phone,
or video call) between a candidate and one or more interviewers, tracking
it through multiple rounds, and capturing a structured scorecard per
interviewer instead of a scattered "let me email you my thoughts."

── This capability owns ────────────────────────────────────────────────
  Interview          — one scheduled round for one candidate. Links to
                        the Candidate Master (capabilities/acquisition)
                        and optionally a Requisition (capabilities/
                        requisition) — optional because a recruiter may
                        want to interview someone before a requisition is
                        formally open, or for a general talent-pool
                        conversation.
  InterviewScorecard  — one structured scorecard per interviewer per
                        interview (a panel interview has several). Kept
                        as its own table (not columns on Interview)
                        because an interview can have MULTIPLE
                        interviewers each submitting independently.

── Design notes ─────────────────────────────────────────────────────────
  - No real calendar integration (Google/Outlook OAuth) — matches this
    app's existing pattern of self-contained, token-based flows instead
    of third-party integrations that need credentials this environment
    doesn't have (see Candidate.portal_token, Requisition.hm_view_token,
    JobLensCandidate.interview_token). Self-scheduling here works the
    same way: the recruiter proposes a short list of time slots, the
    candidate picks one via a public token link — no external calendar
    account required on either side.
  - Every FK is indexed at declaration (index=True) — this is a BRAND
    NEW table set, created fresh via Base.metadata.create_all() on first
    deploy, so index=True actually takes effect immediately (unlike the
    acquisition/requisition tables' ALTER-added columns, which needed a
    separate migrate_fix.py CREATE INDEX pass — see that file's docstring
    for why that distinction matters).
"""
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime, ForeignKey, JSON,
)
from sqlalchemy.orm import relationship

from db.database import Base

INTERVIEW_STATUSES = ["Requested", "Scheduled", "Completed", "Cancelled", "No-Show", "Rescheduled"]
# Requested: created with proposed_slots, waiting on the candidate to self-schedule (or recruiter to set a time)
# Scheduled: has a confirmed scheduled_at
# Completed/Cancelled/No-Show/Rescheduled: terminal-ish states set by the recruiter after the fact

# "HR Screening" is the only type a candidate is ever allowed to
# self-schedule (see router.create_self_schedule_link/create_calendly_link,
# which enforce this server-side). The other three all involve someone
# else's calendar — a specialist, the hiring manager, or a full panel —
# so those require an HR/recruiter person to actually coordinate a time,
# not a candidate picking freely off an open link.
INTERVIEW_TYPES = ["HR Screening", "Telephonic Screening", "Video Interview (AI Avatar)", "Specialist", "Hiring Manager", "Panel"]
# Telephonic Screening is a simple, early-stage screening call — same
# self-schedulable spirit as HR Screening. Video Interview (AI Avatar) is
# NOT self-schedulable through this token/Calendly mechanism: it's an
# asynchronous avatar-driven interview instead (see
# capabilities/avatarinterview) — the candidate's access point there is
# AvatarInterviewSession.candidate_join_url, a NavTalk link, not a
# proposed-time-slot link. Mixing the two scheduling concepts would be
# confusing UX for a flow that doesn't need a "pick a time" step at all.
SELF_SCHEDULABLE_TYPES = {"HR Screening", "Telephonic Screening"}

RECOMMENDATION_OPTIONS = ["Strong Yes", "Yes", "Neutral", "No", "Strong No"]


class Interview(Base):
    """One scheduled interview round for one candidate. A candidate being
    interviewed through 3 rounds (phone screen, technical, onsite) is 3
    separate Interview rows, linked by candidate_id and ordered by
    round_number — not 3 columns on one row — so each round can be
    independently scheduled, rescheduled, and scored without the others
    needing to exist yet."""
    __tablename__ = "tiq_interviews"

    id               = Column(Integer, primary_key=True, index=True)
    organisation_id  = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    owner_user_id    = Column(Integer, ForeignKey("tiq_users.id"), index=True, nullable=True)  # recruiter who scheduled it
    sequence_number  = Column(Integer)  # per-organisation display number, same pattern as elsewhere

    candidate_id     = Column(Integer, ForeignKey("tiq_candidates.id"), index=True, nullable=False)
    # Optional — a candidate can be interviewed before a requisition is
    # formally open, or for a general talent-pool conversation not tied
    # to one specific role yet.
    requisition_id   = Column(Integer, ForeignKey("tiq_requisitions.id"), index=True, nullable=True)
    # Optional bridge to the Phase 0 Application row (candidate <-> requisition
    # link) — when both exist, completing this interview can auto-advance
    # Application.stage (see service.advance_application_stage), giving
    # "auto-updates candidate stage" real teeth without needing the full
    # Phase 5 pipeline built yet.
    application_id   = Column(Integer, ForeignKey("tiq_applications.id"), index=True, nullable=True)

    round_name       = Column(String(200), nullable=False)   # free text: "Phone Screen", "Technical", "Onsite", "Final" — not an enum, stays flexible per client/role
    round_number     = Column(Integer, default=1)             # ordering when a candidate has multiple rounds

    # Who conducts this round, and — critically — whether the CANDIDATE is
    # allowed to pick their own time for it. Only an initial HR/recruiter
    # screening is self-schedulable (see router.create_self_schedule_link
    # / create_calendly_link, which enforce this server-side, not just in
    # the UI): a specialist, hiring-manager, or panel round involves other
    # people's calendars an HR person needs to actually coordinate, so
    # those must be scheduled directly rather than left to a public,
    # unauthenticated link.
    interview_type   = Column(String(30), default="HR Screening")   # see INTERVIEW_TYPES

    interviewers     = Column(JSON, default=list)   # list of {"name": str, "email": str} — no real user-account linking required
    duration_minutes = Column(Integer, default=60)
    location_or_link = Column(Text)   # physical address, or a video-call URL — free text, deliberately not two separate columns

    scheduled_at     = Column(DateTime, nullable=True)   # null while status="Requested" and awaiting self-schedule
    status           = Column(String(30), default="Requested")   # see INTERVIEW_STATUSES

    # ── Self-scheduling (token-based, no calendar OAuth — see module
    # docstring) ────────────────────────────────────────────────────────
    self_schedule_token = Column(String(64), unique=True, index=True, nullable=True)
    proposed_slots      = Column(JSON, default=list)   # list of ISO datetime strings the recruiter offered
    candidate_selected_at = Column(DateTime, nullable=True)  # when the candidate actually confirmed a slot

    # ── Calendly (optional, alternative to the token-based flow above) ──
    # A single-use Calendly scheduling link generated via the recruiter's
    # own Calendly Personal Access Token (see Settings -> API Keys ->
    # Calendly). Calendly owns the actual time-slot picking UI and any
    # calendar-conflict checking; TalentIQ just requests the link and
    # displays it. No webhook/OAuth callback is wired up (that requires a
    # publicly reachable URL + signing secret configured in the
    # recruiter's own Calendly account, which this app can't set up on
    # their behalf) — after the candidate books, the recruiter still
    # marks the interview Scheduled/Completed here manually, same as any
    # other interview.
    calendly_scheduling_url = Column(Text, nullable=True)

    notes            = Column(Text)
    cancellation_reason = Column(Text)

    created_at       = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    scorecards = relationship("InterviewScorecard", back_populates="interview", cascade="all, delete-orphan")


class InterviewScorecard(Base):
    """One interviewer's structured scorecard for one Interview. A panel
    interview has several of these (one per interviewer) — deliberately
    NOT columns on Interview, since the number of interviewers per
    interview varies and each submits independently."""
    __tablename__ = "tiq_interview_scorecards"

    id             = Column(Integer, primary_key=True, index=True)
    interview_id   = Column(Integer, ForeignKey("tiq_interviews.id"), index=True, nullable=False)
    submitted_by_user_id = Column(Integer, ForeignKey("tiq_users.id"), index=True, nullable=True)

    interviewer_name = Column(String(200), nullable=False)  # free text — doesn't require the interviewer to be a TalentIQ platform user
    recommendation    = Column(String(20))     # see RECOMMENDATION_OPTIONS
    # Structured per-criterion ratings — kept as one JSON list rather than
    # a separate criterion-per-row child table: a scorecard wholly owns
    # its own criteria as a unit (never queried/joined independently), so
    # a child table would add CRUD overhead without a normalization
    # benefit — same reasoning already used for JDRecord's skill lists.
    criteria_scores   = Column(JSON, default=list)   # [{"criterion": "Communication", "score": 4, "notes": "..."}]
    strengths         = Column(Text)
    concerns          = Column(Text)
    overall_notes     = Column(Text)

    submitted_at   = Column(DateTime, default=datetime.utcnow)
    created_at     = Column(DateTime, default=datetime.utcnow)
    updated_at     = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    interview = relationship("Interview", back_populates="scorecards")
