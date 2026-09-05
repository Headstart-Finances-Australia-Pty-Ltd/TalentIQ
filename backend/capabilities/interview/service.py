"""Service helpers for Interview Management (Phase 4)."""
import secrets
import string
from datetime import datetime
from typing import Optional

import httpx
from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from utils.credentials import get_all_credentials
from .models import Interview, InterviewScorecard, InterviewFeedbackLink, PanelInterviewer

CALENDLY_API_BASE = "https://api.calendly.com"


def generate_self_schedule_token() -> str:
    """Same pattern as Candidate.portal_token / Requisition.hm_view_token /
    JobLensCandidate.interview_token — a long random string IS the auth,
    no separate candidate login system needed. Reused as-is for
    Interview.approval_token and InterviewFeedbackLink.token below — same
    randomness requirement, no reason for a second implementation."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(48))


# Alias — read more naturally at approval/feedback-link call sites than
# "self_schedule_token" would.
generate_token = generate_self_schedule_token


async def sync_feedback_links(db: AsyncSession, interview: Interview, interviewers: list) -> None:
    """Regenerates InterviewFeedbackLink rows to match the interview's
    current interviewer list. Called on both create and update — any
    time the interviewer list is set. Deliberately drop-and-recreate
    rather than diff/patch: interviewers are matched by name (there's no
    stable ID for a free-text interviewer entry), so a rename is
    indistinguishable from a remove+add either way, and this keeps the
    logic simple. Existing scorecards are untouched (they key off
    interview_id + interviewer_name, not the link row), so a link
    regenerating doesn't lose anyone's already-submitted feedback — it
    just means a previously-issued link stops working and a fresh one
    needs to be re-shared, which is the correct behaviour any time the
    panel roster changes anyway."""
    from models.models import User

    await db.execute(
        InterviewFeedbackLink.__table__.delete().where(InterviewFeedbackLink.interview_id == interview.id)
    )
    for iv in interviewers:
        name = (iv.get("name") or "").strip()
        if not name:
            continue
        email = (iv.get("email") or "").strip()
        user_id = None
        if email:
            u = (await db.execute(select(User.id).where(func.lower(User.email) == email.lower()))).scalar_one_or_none()
            user_id = u
        db.add(InterviewFeedbackLink(
            interview_id=interview.id, interviewer_name=name, interviewer_email=email,
            user_id=user_id, token=generate_token(),
        ))


def _recommendation_bucket(recommendation: Optional[str]) -> Optional[str]:
    if recommendation in ("Strong Yes", "Yes"):
        return "approve"
    if recommendation in ("No", "Strong No"):
        return "reject"
    return None   # "Neutral", blank, or unrecognised — counts as neither side


async def finalize_interview_decision(db: AsyncSession, interview: Interview) -> Optional[str]:
    """Recomputes and, if resolved, applies Interview.decision from the
    panel's submitted scorecards — the "approval of a candidate is based
    on majority of approval by panel" rule, for every round that has 2+
    assigned interviewers. Call after every scorecard create/update.

    Majority is measured against the TOTAL assigned panel (not just
    votes cast so far) — the moment enough votes land on one side to be
    mathematically unbeatable, the decision finalizes immediately rather
    than waiting for stragglers. Returns the newly-applied decision
    string, or None if nothing changed (already finalized, or not enough
    votes yet to resolve one way or the other).

    Rounds with 0-1 assigned interviewers never resolve here — see
    router.set_decision for the manual-override path those use instead,
    since "majority" isn't a meaningful concept for a single voter."""
    if interview.decision not in (None, "Pending"):
        return None
    total = len(interview.interviewers or [])
    if total < 2:
        return None

    scorecards = (await db.execute(
        select(InterviewScorecard).where(InterviewScorecard.interview_id == interview.id)
    )).scalars().all()
    approve = sum(1 for s in scorecards if _recommendation_bucket(s.recommendation) == "approve")
    reject = sum(1 for s in scorecards if _recommendation_bucket(s.recommendation) == "reject")
    threshold = total // 2 + 1

    decision = None
    if approve >= threshold:
        decision = "Selected"
    elif reject >= threshold:
        decision = "Rejected"
    elif len(scorecards) >= total:
        # Everyone who was assigned has voted, and neither side reached a
        # majority (a tie, or too many Neutral votes) — park it as Hold
        # rather than leaving it silently stuck on Pending forever.
        decision = "Hold"

    if decision:
        interview.decision = decision
        interview.decision_finalized_at = datetime.utcnow()
        if interview.status not in ("Cancelled",):
            interview.status = "Completed"
        interview.updated_at = datetime.utcnow()
    return decision


async def get_next_sequence(db: AsyncSession, organisation_id: int) -> int:
    r = await db.execute(select(func.max(Interview.sequence_number)).where(Interview.organisation_id == organisation_id))
    return (r.scalar() or 0) + 1


async def generate_interviewer_payments(
    db: AsyncSession, organisation_id: int, interview: Interview,
    candidate_name: str, requisition_title: str,
) -> None:
    """Best-effort — mirrors advance_application_stage/fire_automation's
    'never block the status change it's a side effect of' reasoning.
    Called right after a Panel Interview round is marked Completed (see
    router.change_interview_status): for every assigned interviewer
    (Interview.interviewers — a JSON snapshot of {"name","email"}, see
    that column's docstring) whose email matches an EXTERNAL
    PanelInterviewer roster entry with an hourly_rate set, creates one
    InterviewerPayment row so Commercials can actually pay them for
    their time — hours from interview.duration_minutes / 60, rate
    snapshotted from PanelInterviewer.hourly_rate as it stands right now
    (see that model's docstring for why both are snapshotted rather than
    computed live at read time).

    Idempotent: the DB has a UNIQUE index on (interview_id,
    panel_interviewer_id) — see db/migrate_fix.py — so re-marking the
    same round Completed twice (e.g. Completed -> Scheduled -> Completed
    again) never double-charges. Checked in Python first (not just
    relying on the DB constraint) so this degrades to a normal no-op
    instead of a raised IntegrityError the caller would need to catch.
    """
    if interview.interview_type != "Panel Interview" or not interview.interviewers:
        return
    try:
        from capabilities.commercial.models import InterviewerPayment

        emails = [str((p or {}).get("email") or "").strip().lower() for p in interview.interviewers]
        emails = [e for e in emails if e]
        if not emails:
            return

        externals = (await db.execute(
            select(PanelInterviewer).where(
                PanelInterviewer.organisation_id == organisation_id,
                PanelInterviewer.interviewer_type == "External",
                func.lower(PanelInterviewer.email).in_(emails),
                PanelInterviewer.hourly_rate.isnot(None),
            )
        )).scalars().all()
        if not externals:
            return

        existing = (await db.execute(
            select(InterviewerPayment.panel_interviewer_id).where(
                InterviewerPayment.interview_id == interview.id,
                InterviewerPayment.panel_interviewer_id.in_([p.id for p in externals]),
            )
        )).scalars().all()
        already_paid_ids = set(existing)

        hours = round((interview.duration_minutes or 0) / 60, 2)
        for p in externals:
            if p.id in already_paid_ids or not p.hourly_rate or hours <= 0:
                continue
            db.add(InterviewerPayment(
                organisation_id=organisation_id,
                interview_id=interview.id, panel_interviewer_id=p.id,
                interviewer_name=p.name, interviewer_email=p.email or "",
                candidate_name=candidate_name, round_name=interview.round_name, requisition_title=requisition_title,
                hours=hours, hourly_rate=p.hourly_rate,
            ))
        await db.commit()
    except Exception as e:
        await db.rollback()
        import logging
        logging.getLogger(__name__).warning(f"generate_interviewer_payments failed for interview_id={interview.id}: {e}")


async def advance_application_stage(db: AsyncSession, application_id: Optional[int], new_stage: str) -> None:
    """Best-effort auto-advance of the linked Application's stage when an
    interview's status changes — gives "auto-updates candidate stage" (the
    Phase 4 capability-plan line) real effect using the Application.stage
    placeholder column that's existed since the Phase 0 spine, without
    needing the full Phase 5 pipeline built yet. Silently does nothing if
    there's no linked application (interviews don't require one) — this
    is a convenience, not a hard dependency."""
    if not application_id:
        return
    from capabilities.acquisition.models import Application
    app_row = (await db.execute(select(Application).where(Application.id == application_id))).scalar_one_or_none()
    if app_row:
        app_row.stage = new_stage
        app_row.updated_at = datetime.utcnow()


# ══════════════════════════════════════════════════════════════════════════
# CALENDLY (optional alternative to the token-based self-schedule flow)
# ══════════════════════════════════════════════════════════════════════════
# Two independent ways a recruiter can wire up Calendly, same as each
# other — Settings just shows whichever fields they've filled in:
#
#   1. booking_url — a plain public Calendly page (e.g.
#      https://calendly.com/pksingh210/30min), pasted in as-is. No token,
#      no API call — this is the SAME url is shared with every candidate,
#      exactly like a normal "book time with me" link on a website. Takes
#      priority when set, since it's the simpler/default path.
#   2. api_key + event_type_uri — the recruiter's Personal Access Token,
#      used to mint a fresh single-use link per candidate via the Calendly
#      API (see create_calendly_single_use_link below). Used only when
#      booking_url is blank.
#
# All three fields are saved under Settings -> API Keys -> Calendly, a
# strictly private, per-user credential (see utils/credentials.
# SHAREABLE_SERVICES; "calendly" is deliberately NOT in that set, same
# policy as "linkedin": one recruiter's Calendly is never usable by
# another user, including admins).

async def get_calendly_credentials(db: AsyncSession, user_id: int) -> dict:
    """Returns {"booking_url": ..., "api_key": ..., "event_type_uri": ...}
    — any of these may be empty if not yet configured."""
    creds = await get_all_credentials(db, user_id, "calendly")
    return {
        "booking_url": creds.get("booking_url", ""),
        "api_key": creds.get("api_key", ""),
        "event_type_uri": creds.get("event_type_uri", ""),
    }


def _calendly_headers(api_key: str) -> dict:
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


async def fetch_calendly_event_types(api_key: str) -> list:
    """Fetches the recruiter's own Calendly event types (e.g. "30 Minute
    Interview", "Technical Screen") so they can pick one by name in
    Settings instead of having to hand-copy a raw API URI out of
    Calendly's own developer tools. Two calls: /users/me to get the
    account's own URI, then /event_types filtered to that user."""
    async with httpx.AsyncClient(timeout=15) as client:
        me_resp = await client.get(f"{CALENDLY_API_BASE}/users/me", headers=_calendly_headers(api_key))
        if me_resp.status_code == 401:
            raise HTTPException(401, "Calendly rejected this Personal Access Token — check it's correct and hasn't been revoked.")
        me_resp.raise_for_status()
        user_uri = me_resp.json()["resource"]["uri"]

        et_resp = await client.get(
            f"{CALENDLY_API_BASE}/event_types",
            headers=_calendly_headers(api_key),
            params={"user": user_uri, "active": "true", "count": 100},
        )
        et_resp.raise_for_status()
        return [
            {"uri": e["uri"], "name": e["name"], "duration": e.get("duration"), "scheduling_url": e.get("scheduling_url")}
            for e in et_resp.json().get("collection", [])
        ]


async def create_calendly_single_use_link(api_key: str, event_type_uri: str) -> str:
    """Creates a single-use Calendly scheduling link tied to a specific
    event type — this is what actually gets shared with the candidate.
    Single-use (max_event_count=1) so the same link can't be reused for a
    different candidate by mistake."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{CALENDLY_API_BASE}/scheduling_links",
            headers=_calendly_headers(api_key),
            json={"max_event_count": 1, "owner": event_type_uri, "owner_type": "EventType"},
        )
        if resp.status_code == 401:
            raise HTTPException(401, "Calendly rejected this Personal Access Token — check it's correct and hasn't been revoked.")
        if resp.status_code == 404:
            raise HTTPException(400, "That Calendly event type couldn't be found — it may have been deleted or deactivated. Re-select it in Settings.")
        resp.raise_for_status()
        return resp.json()["resource"]["booking_url"]


# ── Calendly webhook subscription — the missing piece the older comment
# on Interview.calendly_scheduling_url used to say wasn't wired up. A
# recruiter's own webhook URL is public (Calendly must be able to POST
# to it with no TalentIQ login), so it's identified by a "uid" query
# param carrying the recruiter's user id, and its authenticity is
# verified using the signing_key Calendly hands back when the
# subscription is created (see public_router.calendly_webhook).
async def get_calendly_user_and_org_uri(api_key: str) -> tuple[str, str]:
    """Returns (user_uri, organization_uri) for this Personal Access
    Token's account — both required to create a webhook subscription."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(f"{CALENDLY_API_BASE}/users/me", headers=_calendly_headers(api_key))
        if resp.status_code == 401:
            raise HTTPException(401, "Calendly rejected this Personal Access Token — check it's correct and hasn't been revoked.")
        resp.raise_for_status()
        resource = resp.json()["resource"]
        return resource["uri"], resource["current_organization"]


async def create_calendly_webhook_subscription(api_key: str, webhook_url: str) -> dict:
    """Subscribes webhook_url to invitee.created/invitee.canceled events
    for this Calendly account (organization-scoped — covers every event
    type owned by this user within it). Calendly only returns the
    signing_key ONCE, at creation time — the caller must store it
    immediately, since there's no way to retrieve it again later short of
    deleting and recreating the subscription."""
    user_uri, org_uri = await get_calendly_user_and_org_uri(api_key)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{CALENDLY_API_BASE}/webhook_subscriptions",
            headers=_calendly_headers(api_key),
            json={
                "url": webhook_url,
                "events": ["invitee.created", "invitee.canceled"],
                "organization": org_uri,
                "user": user_uri,
                "scope": "user",
            },
        )
        if resp.status_code == 401:
            raise HTTPException(401, "Calendly rejected this Personal Access Token — check it's correct and hasn't been revoked.")
        if resp.status_code == 403:
            raise HTTPException(403, "This Calendly plan doesn't support webhooks (Standard plan or higher is required).")
        resp.raise_for_status()
        resource = resp.json()["resource"]
        return {"subscription_uri": resource["uri"], "signing_key": resource["signing_key"]}


async def delete_calendly_webhook_subscription(api_key: str, subscription_uri: str) -> None:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.delete(subscription_uri, headers=_calendly_headers(api_key))
        if resp.status_code not in (200, 204, 404):
            resp.raise_for_status()


def verify_calendly_webhook_signature(signing_key: str, raw_body: bytes, signature_header: str) -> bool:
    """Calendly's Calendly-Webhook-Signature header is
    "t=<timestamp>,v1=<hmac>" — the HMAC-SHA256 of "<timestamp>.<raw body>"
    keyed by signing_key, hex-encoded. Verified with hmac.compare_digest
    (constant-time) to avoid a timing side-channel on the comparison
    itself."""
    import hashlib
    import hmac as hmac_lib

    if not signing_key or not signature_header:
        return False
    parts = dict(p.split("=", 1) for p in signature_header.split(",") if "=" in p)
    timestamp, signature = parts.get("t"), parts.get("v1")
    if not timestamp or not signature:
        return False
    signed_payload = f"{timestamp}.{raw_body.decode('utf-8', errors='replace')}"
    expected = hmac_lib.new(signing_key.encode(), signed_payload.encode(), hashlib.sha256).hexdigest()
    return hmac_lib.compare_digest(expected, signature)
