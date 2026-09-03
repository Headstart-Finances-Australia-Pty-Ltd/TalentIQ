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
    Column, Integer, String, Text, Boolean, DateTime, ForeignKey, JSON, LargeBinary,
)
from sqlalchemy.orm import relationship

from db.database import Base

INTERVIEW_STATUSES = ["Requested", "Scheduled", "Completed", "Cancelled", "No-Show", "Rescheduled"]
# Requested: created with proposed_slots, waiting on the candidate to self-schedule (or recruiter to set a time)
# Scheduled: has a confirmed scheduled_at
# Completed/Cancelled/No-Show/Rescheduled: terminal-ish states set by the recruiter after the fact

# Exactly three round classes — Phone Interview, Video Interview, Panel
# Interview. Resume Screening now lives entirely in its own capability
# (Screening -> Resume Screening / Phone Interview / Video Interview,
# the CandidateLens split — see frontend/src/lib/capabilities.ts), so it
# is deliberately NOT one of these classes: by the time a candidate
# reaches Interview Scheduling, screening has already happened.
#
# "Video Interview" here covers every video-delivery mode: a live human
# video call, a webcam+emotion-analysis session (CandidateLens's Video
# Interview module), or an AI Avatar session (capabilities/avatarinterview,
# which keys off this exact string — see AVATAR_INTERVIEW_TYPE there) —
# one class, multiple ways to actually run it, chosen per round rather
# than forking the round-type enum for each delivery mechanism.
#
# Only "Phone Interview" is self-schedulable (see
# router.create_self_schedule_link/create_calendly_link, which enforce
# this server-side): a video or panel round involves other people's
# calendars an HR person needs to actually coordinate, so those must be
# scheduled directly rather than left to a public, unauthenticated link.
INTERVIEW_TYPES = ["Phone Interview", "Video Interview", "Panel Interview", "Final Interview", "HR Interview", "Resume Screening"]
SELF_SCHEDULABLE_TYPES = {"Phone Interview"}

RECOMMENDATION_OPTIONS = ["Strong Yes", "Yes", "Neutral", "No", "Strong No"]

# ── Round decision (the outcome of THIS round) ───────────────────────────
# Pending: no decision yet (waiting on scorecards, or nobody's set it
# manually). Selected/Rejected: reached either by majority of submitted
# panel scorecards (see service.finalize_interview_decision) or a
# recruiter's manual override for rounds with 0-1 interviewers (e.g.
# Resume Screening, or a single phone-screener) where a "majority" isn't
# meaningful. Hold: every assigned interviewer voted and no recommendation
# reached a strict majority.
DECISION_STATUSES = ["Pending", "Selected", "Rejected", "Hold"]

# ── Scheduling approval (a designated authority signing off on THIS
# round's time/place before/instead of the recruiter unilaterally
# proceeding — separate from the panel's Selected/Rejected decision
# above) ──────────────────────────────────────────────────────────────
APPROVAL_STATUSES = ["Pending", "Approved", "Cancelled"]


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

    candidate_id     = Column(Integer, ForeignKey("tiq_candidates.id"), index=True, nullable=True)
    # Alternative to candidate_id, for an interview logged against a
    # candidate from the older, separate CandidateLens/JobLens system
    # (tiq_joblens_candidates) rather than the Talent Pool Candidate
    # table -- Video Interview's "Send Interview Invite" and Phone
    # Interview's "Candidate reached by phone" both create a row here
    # via that path (see routers/joblens.py's mark_contacted /
    # mark_phone_contacted) so those actions show up in Interview
    # Scheduling too, without requiring a JobLens candidate to already
    # have a matching Talent Pool Candidate record. Exactly one of
    # candidate_id / joblens_candidate_id is set, never both, never
    # neither -- enforced in application code (create_interview requires
    # candidate_id; the JobLens-originated creation path sets only
    # joblens_candidate_id), not a DB constraint, to avoid a migration
    # headache over rows that predate this column.
    joblens_candidate_id = Column(Integer, ForeignKey("tiq_joblens_candidates.id"), index=True, nullable=True)
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
    interview_type   = Column(String(30), default="Phone Interview")   # see INTERVIEW_TYPES

    interviewers     = Column(JSON, default=list)   # list of {"name": str, "email": str} — no real user-account linking required
    duration_minutes = Column(Integer, default=60)
    location_or_link = Column(Text)   # physical address, or a video-call URL — free text, deliberately not two separate columns

    scheduled_at     = Column(DateTime, nullable=True)   # null while status="Requested" and awaiting self-schedule
    status           = Column(String(30), default="Requested")   # see INTERVIEW_STATUSES

    # ── Round decision — auto-computed from panel majority, or set
    # directly by a recruiter for rounds with 0-1 interviewers (see
    # service.finalize_interview_decision and router.set_decision)  ─────
    decision              = Column(String(20), default="Pending")   # see DECISION_STATUSES
    decision_finalized_at = Column(DateTime, nullable=True)

    # ── Scheduling approval — a designated "authority" (internal
    # TalentIQ user OR an external person reached via approval_token,
    # matching the mix described in this capability's approval flow)
    # signs off on this round's time/place, or cancels it outright. ─────
    approver_name    = Column(String(200))
    approver_email   = Column(String(200))
    approver_user_id = Column(Integer, ForeignKey("tiq_users.id"), index=True, nullable=True)  # set when the approver is an internal TalentIQ user
    approval_status  = Column(String(20), default="Pending")   # see APPROVAL_STATUSES
    approval_token   = Column(String(64), unique=True, index=True, nullable=True)   # public /interview-approval/{token} link for an external approver
    approved_at      = Column(DateTime, nullable=True)
    approved_by      = Column(String(200))   # display name of whoever actually clicked Approve (internal user's name, or approver_name for an external click)
    cancelled_at     = Column(DateTime, nullable=True)
    cancelled_by     = Column(String(200))

    # Free-form links to interview artifacts — a recording, transcript,
    # take-home submission, whiteboard photo, etc. Deliberately link-based
    # (not a blob upload) — same self-contained, no-external-storage-needed
    # spirit as location_or_link and the self-schedule token above.
    artifacts        = Column(JSON, default=list)   # [{"label": "Recording", "url": "https://..."}]

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

    # ── Telephony (click-to-call + SMS scheduling — see utils/telephony.py) ──
    # Caller number itself is NOT stored here — it's a per-recruiter
    # Settings credential (Settings -> API Keys -> Telephony), same
    # reasoning as SMTP/Calendly not storing sender identity per-row.
    # These three columns are just a log of the last action taken, so
    # Interview Scheduling's table and the Phone Interview page can both
    # show "a call happened" / "a call is coming" without a separate
    # activity-log table.
    phone_call_sid    = Column(String(64), nullable=True)   # last Twilio Call sid placed for this interview
    phone_call_status = Column(String(30), nullable=True)   # last known Twilio call status (queued/ringing/completed/failed/...)
    phone_called_at   = Column(DateTime, nullable=True)     # when the click-to-call button was last pressed
    call_sms_sent_at  = Column(DateTime, nullable=True)      # when a "you'll be called at <time>" SMS was last sent

    # Call recording + transcript — the click-to-call bridge (see
    # utils/telephony.place_click_to_call's record param) records the
    # conversation once both legs connect; phone_recording_sid identifies
    # WHICH Twilio recording belongs to this round once fetched (a call
    # can technically have more than one recording — e.g. a re-answer —
    # so this pins down exactly which one phone_transcript came from).
    # phone_transcript_status mirrors JobLensCandidate.video_analysis_status's
    # states (Pending/Processing/Completed/Failed), fetched on demand via
    # a button rather than automatically — see routers/joblens.py's
    # fetch_phone_transcript.
    phone_recording_sid    = Column(String(64), nullable=True)
    phone_transcript       = Column(Text, nullable=True)
    phone_transcript_status = Column(String(30), nullable=True)

    notes            = Column(Text)
    cancellation_reason = Column(Text)

    # When this round was actually COMPLETED — distinct from
    # scheduled_at (when it was/is due to happen), so a genuinely booked
    # slot (e.g. via Calendly) isn't overwritten just because the round
    # later gets marked Completed. Set by the JobLens auto-logging bridge
    # (_log_joblens_interview) for Resume Screening / Phone Interview /
    # Video Interview completions.
    completed_at     = Column(DateTime, nullable=True)

    # Precise send timestamps — see db/migrate_fix.py's migration
    # docstring for why these exist separately from updated_at.
    calendly_link_sent_at = Column(DateTime, nullable=True)  # Phone Interview's Send Calendly Link
    video_invite_sent_at  = Column(DateTime, nullable=True)  # Video Interview's Send Interview Invite / Candidate Contact
    # A fixed-time invite email (date/time + location_or_link, no
    # candidate-facing scheduling involved) — Interview Scheduling's
    # "Send Invite" action for rounds that can't use Calendly
    # self-scheduling (see SELF_SCHEDULABLE_TYPES), starting with Panel
    # Interview, since panel coordination needs a recruiter-fixed time,
    # not a candidate-picked one.
    invite_sent_at        = Column(DateTime, nullable=True)
    # Interview Decision's bulk "Send Rejection Email" action (mirrors
    # JobLensCandidate.rejection_email_sent_at in models/models.py) —
    # tracked per ROUND here rather than per candidate, since a
    # candidate can be rejected at any individual round (Phone, Video,
    # Panel…) without necessarily being rejected from the requisition
    # as a whole.
    rejection_email_sent_at = Column(DateTime, nullable=True)

    # ── Hiring-decision approval (Interview Decision's Approval column) ──
    # Deliberately separate from approver_name/approval_status/approved_at
    # above, which are for a completely different thing: sign-off on the
    # interview being SCHEDULED (an approval-gated interview type, before
    # it happens). This is sign-off on the DECISION after it happens —
    # e.g. a hiring manager or client confirming "yes, we're extending an
    # offer" — with a real audit trail (who, when, and an optional
    # supporting document) kept for future reference.
    decision_approval_status = Column(String(20), default="Pending")   # Pending | Approved | Not Approved
    decision_approved_by = Column(String(255), nullable=True)
    decision_approved_at = Column(DateTime, nullable=True)
    decision_approval_notes = Column(Text, nullable=True)
    decision_approval_attachment_filename = Column(String(255), nullable=True)
    decision_approval_attachment_blob = Column(LargeBinary, nullable=True)

    # Links a Panel Interview round to a reusable Panel Setup (see
    # InterviewPanel below) — Interview Scheduling's Panel column shows
    # just this panel's number; clicking it looks up the full member
    # list. Only meaningful when interview_type == "Panel Interview";
    # left null for rounds that still use the old ad-hoc interviewers
    # list directly instead of a saved panel.
    panel_id = Column(Integer, ForeignKey("tiq_interview_panels.id"), index=True, nullable=True)

    created_at       = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    scorecards     = relationship("InterviewScorecard", back_populates="interview", cascade="all, delete-orphan")
    feedback_links = relationship("InterviewFeedbackLink", back_populates="interview", cascade="all, delete-orphan")


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


class InterviewFeedbackLink(Base):
    """One durable, tokenized feedback link per assigned interviewer per
    Interview — the panel-member equivalent of Interview.approval_token.
    Kept as its OWN table (rather than a token embedded in the
    interviewers JSON list) purely so it's directly and indexed-ly
    queryable by token from the public router without scanning every
    interview's JSON blob — the same reasoning that keeps
    InterviewScorecard a real child table instead of JSON.

    Re-generated (old rows for that interview deleted, fresh ones
    inserted) every time an interview's interviewer list is set on
    create/update — see router._sync_feedback_links. A row here doesn't
    require the interviewer to be a TalentIQ platform user: user_id is
    only set when one of the interviewer entries matches an internal
    user by email, purely so an internal panelist COULD also submit via
    the authenticated /scorecards endpoint under their own name; the
    public token link works identically either way, matching the "mix of
    internal and external panel members" this capability supports."""
    __tablename__ = "tiq_interview_feedback_links"

    id               = Column(Integer, primary_key=True, index=True)
    interview_id     = Column(Integer, ForeignKey("tiq_interviews.id"), index=True, nullable=False)
    interviewer_name = Column(String(200), nullable=False)
    interviewer_email = Column(String(200))
    user_id          = Column(Integer, ForeignKey("tiq_users.id"), index=True, nullable=True)
    token            = Column(String(64), unique=True, index=True, nullable=False)
    created_at       = Column(DateTime, default=datetime.utcnow)

    interview = relationship("Interview", back_populates="feedback_links")


class InterviewDecisionApprover(Base):
    """One row per person asked to weigh in on a hiring DECISION (not
    the interview's scheduling — see Interview.decision_approval_status'
    docstring for that distinction) — Interview Decision's "send an
    online approval request" option, alongside the manual popup where a
    recruiter just records the outcome themselves. Deliberately a real
    child table, not JSON on Interview, for the same reason
    InterviewFeedbackLink is: MULTIPLE approvers can weigh in
    independently on the same round (e.g. hiring manager + department
    head), each with their own status/comments/date, and each needs
    their own indexed, directly-queryable token for the public link —
    a JSON list would work for storage but not for token lookup.

    status starts "Pending" the moment the invite email goes out
    (invited_at set then) and becomes "Approved"/"Rejected" once that
    person submits their own decision via the tokenized public link
    (see public_router.py's decision-approval endpoints) — there is no
    login involved; the token itself is the approver's identity, same
    pattern as every other public link in this capability."""
    __tablename__ = "tiq_interview_decision_approvers"

    id              = Column(Integer, primary_key=True, index=True)
    interview_id    = Column(Integer, ForeignKey("tiq_interviews.id"), index=True, nullable=False)
    approver_name   = Column(String(200), nullable=False)
    approver_email  = Column(String(200), nullable=False)
    status          = Column(String(20), default="Pending")   # Pending | Approved | Rejected
    comments        = Column(Text, nullable=True)
    decided_at      = Column(DateTime, nullable=True)
    invited_at      = Column(DateTime, nullable=True)
    token           = Column(String(64), unique=True, index=True, nullable=False)
    created_at      = Column(DateTime, default=datetime.utcnow)


class PanelInterviewer(Base):
    """A directory/roster of external and internal subject-matter experts
    who sit on Panel Interview rounds — separate from Interview.interviewers
    (a per-round JSON snapshot of whoever was assigned to THAT round) so
    the same person's contact details/expertise are entered once and
    reused across every panel they sit on, instead of being re-typed
    fresh each time a round is scheduled. Their actual assignment
    history (which roles, when, feedback/decision links) is DERIVED at
    read time by matching InterviewFeedbackLink.interviewer_email against
    this row's email — see capabilities/interview/router.py's
    list_panel_interviewers — rather than duplicated here, so it can
    never drift out of sync with the real Interview/feedback-link data."""
    __tablename__ = "tiq_panel_interviewers"

    id                = Column(Integer, primary_key=True, index=True)
    organisation_id   = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    name              = Column(String(200), nullable=False)
    expertise_area    = Column(String(300))
    company           = Column(String(300))
    # "Internal" (part of the hiring org) or "External" (a client/partner
    # SME) — a panel can freely mix both (see InterviewPanel.interviewer_ids,
    # which just lists PanelInterviewer rows regardless of this value).
    # Free string rather than an enum: kept consistent purely by the
    # frontend dropdown always sending one of the two, same convention
    # Interview.status/decision etc. already use elsewhere in this file.
    interviewer_type  = Column(String(20), default="Internal")
    phone             = Column(String(50))
    email             = Column(String(200), index=True)
    notes             = Column(Text)
    created_at        = Column(DateTime, default=datetime.utcnow)
    updated_at        = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class InterviewPanel(Base):
    """A named/numbered PANEL SETUP — a group of one or more
    PanelInterviewer people convened together for a given role at a
    given company, created once and then referenced (via Interview.panel_id
    below) by every Panel Interview round that uses that same group of
    people, instead of re-picking the same interviewers one at a time on
    every round. Interview Scheduling's Panel column shows just this
    panel's NUMBER; clicking it looks up the full member list from here.

    interviewer_ids is a JSON array of PanelInterviewer.id values — same
    "JSON list of light references" pattern Interview.interviewers
    already uses for its own ad-hoc per-round snapshot, chosen here for
    consistency rather than a separate join table for what's still a
    small, rarely-changing list per panel."""
    __tablename__ = "tiq_interview_panels"

    id                = Column(Integer, primary_key=True, index=True)
    organisation_id   = Column(Integer, ForeignKey("tiq_organisations.id"), index=True, nullable=False)
    sequence_number   = Column(Integer, nullable=False)  # the "Panel Number" shown everywhere
    role_for          = Column(String(300))
    company           = Column(String(300))
    interviewer_ids   = Column(JSON, default=list)
    setup_date        = Column(DateTime, nullable=True)
    created_at        = Column(DateTime, default=datetime.utcnow)
    updated_at        = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
