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
from .models import Interview

CALENDLY_API_BASE = "https://api.calendly.com"


def generate_self_schedule_token() -> str:
    """Same pattern as Candidate.portal_token / Requisition.hm_view_token /
    JobLensCandidate.interview_token — a long random string IS the auth,
    no separate candidate login system needed."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(48))


async def get_next_sequence(db: AsyncSession, organisation_id: int) -> int:
    r = await db.execute(select(func.max(Interview.sequence_number)).where(Interview.organisation_id == organisation_id))
    return (r.scalar() or 0) + 1


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
# Uses the recruiter's own Calendly Personal Access Token (saved under
# Settings -> API Keys -> Calendly) — a strictly private, per-user
# credential (see utils/credentials.SHAREABLE_SERVICES; "calendly" is
# deliberately NOT in that set, same policy as "linkedin": one recruiter's
# Calendly account is never usable by another user, including admins).

async def get_calendly_credentials(db: AsyncSession, user_id: int) -> dict:
    """Returns {"api_key": ..., "event_type_uri": ...} — either may be
    empty if not yet configured."""
    creds = await get_all_credentials(db, user_id, "calendly")
    return {"api_key": creds.get("api_key", ""), "event_type_uri": creds.get("event_type_uri", "")}


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
