"""
NavTalk.ai API client — ISOLATED on purpose.

Every NavTalk-specific assumption (endpoint paths, auth header, request/
response field names, webhook shape) lives in this one file so that
correcting it against NavTalk's real documentation is a contained,
one-file change — nothing outside this file needs to know or care how
NavTalk's actual API works, only that create_avatar_session() returns a
(navtalk_session_id, join_url) pair and that a webhook eventually reports
per-question transcripts back.

I do not have verified, confident knowledge of NavTalk's actual API
contract — see capabilities/avatarinterview/models.py's module docstring
for why (no training-data certainty, no general web access in this
environment to check). What's below follows the most common pattern for
avatar/conversational-AI interview APIs (create a session with a script
of questions + a webhook callback URL, get back a candidate-facing join
link, receive async per-question transcript events) — but the exact
endpoint paths, header name, and JSON field names are BEST-EFFORT
PLACEHOLDERS. Before this goes live, replace the constants and field
names below with what NavTalk's real docs specify — nothing else in this
codebase needs to change to do that.
"""
from typing import Optional

import httpx
from fastapi import HTTPException

# PLACEHOLDER — confirm against NavTalk's real docs.
NAVTALK_API_BASE = "https://api.navtalk.ai/v1"


def _headers(api_key: str) -> dict:
    # PLACEHOLDER — confirm the real auth scheme (Bearer token is the
    # most common convention and what's assumed here; NavTalk may use a
    # different header name or an API-key query param instead).
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


async def create_avatar_session(
    api_key: str,
    avatar_persona_id: str,
    candidate_name: str,
    questions: list[str],
    webhook_url: str,
) -> dict:
    """Creates a NavTalk avatar interview session with a fixed script of
    questions for the avatar to ask, in order. Returns
    {"navtalk_session_id": str, "join_url": str} on success.

    PLACEHOLDER request/response shape — see module docstring. Wrapped so
    a NavTalk-side failure (wrong endpoint, auth rejected, service down)
    surfaces as a clear HTTPException rather than an opaque crash, and
    NEVER blocks the underlying Interview Management record that
    triggered this (see router.py — the avatar session status is tracked
    separately from the Interview's own status)."""
    async with httpx.AsyncClient(timeout=20) as client:
        try:
            resp = await client.post(
                f"{NAVTALK_API_BASE}/sessions",
                headers=_headers(api_key),
                json={
                    "persona_id": avatar_persona_id,
                    "candidate_name": candidate_name,
                    "script": [{"order": i + 1, "question": q} for i, q in enumerate(questions)],
                    "webhook_url": webhook_url,
                },
            )
        except httpx.RequestError as e:
            raise HTTPException(502, f"Could not reach NavTalk — {str(e)[:200]}")

        if resp.status_code == 401:
            raise HTTPException(401, "NavTalk rejected this API key — check it's correct under Settings -> API Keys -> NavTalk.")
        if resp.status_code >= 400:
            raise HTTPException(502, f"NavTalk returned an error ({resp.status_code}): {resp.text[:300]}")

        data = resp.json()
        # PLACEHOLDER field names — adjust to NavTalk's real response shape.
        return {
            "navtalk_session_id": data.get("session_id") or data.get("id"),
            "join_url": data.get("join_url") or data.get("interview_url"),
        }


async def get_session_status(api_key: str, navtalk_session_id: str) -> Optional[str]:
    """Polling fallback if the webhook is delayed or missed — not the
    primary path (the webhook is), but useful for a manual "Refresh
    Status" action in the UI. PLACEHOLDER endpoint/response shape."""
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            resp = await client.get(f"{NAVTALK_API_BASE}/sessions/{navtalk_session_id}", headers=_headers(api_key))
        except httpx.RequestError:
            return None
        if resp.status_code != 200:
            return None
        return resp.json().get("status")
