"""
TalentIQ — Shared Twilio telephony (click-to-call + SMS).

Same spirit as utils/email_send.py: one small, dependency-light module
both the Interview Scheduling capability and the Phone Interview
(JobLens) page call into, instead of two drifting copies of the same
Twilio REST plumbing.

Design notes
────────────
- Plain REST calls via httpx (Basic Auth with Account SID / Auth Token)
  rather than the `twilio` pip package — this app already leans on
  httpx for exactly this kind of "small number of REST calls" job (see
  capabilities/interview/service.py's Calendly client), so it doesn't
  need a whole SDK dependency for two endpoints.

- Click-to-call needs no webhook or publicly-reachable URL (matching
  this app's "no external callback plumbing" pattern — see Interview's
  Calendly integration docstring): Twilio's Calls API accepts inline
  TwiML via the `Twiml` parameter, so the call is placed as
      1. Twilio rings the recruiter's own phone (`caller_number`,
         configured in Settings -> API Keys -> Telephony) first.
      2. The instant the recruiter picks up, Twilio executes the
         inline `<Dial>` and bridges them straight to the candidate's
         number.
  No inbound webhook, signing secret, or TwiML Bin needed on Twilio's
  side — same reason Calendly's flow needed none either.

- SMS is a single Messages.create() call — nothing to bridge.

- Credentials are strictly private (never shared/admin-fallback — see
  utils/credentials.SHAREABLE_SERVICES, "telephony" is deliberately not
  in that set, same policy as "smtp" and "calendly"): one recruiter's
  Twilio account is never usable by another user, including admins.
"""
from typing import Optional
from urllib.parse import quote

import httpx
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from utils.credentials import get_all_credentials

TWILIO_API_BASE = "https://api.twilio.com/2010-04-01"


async def get_telephony_config(db: AsyncSession, user_id: int) -> dict:
    """{"account_sid": ..., "auth_token": ..., "caller_number": ...} —
    any of these may be empty if not yet configured. Strictly private,
    per-user (see module docstring)."""
    creds = await get_all_credentials(db, user_id, "telephony")
    return {
        "account_sid": creds.get("account_sid", ""),
        "auth_token": creds.get("auth_token", ""),
        "caller_number": creds.get("caller_number", ""),
    }


def is_configured(config: dict) -> bool:
    return bool(config.get("account_sid") and config.get("auth_token") and config.get("caller_number"))


def _require_configured(config: dict) -> None:
    if not is_configured(config):
        raise HTTPException(
            400,
            "Telephony is not configured. Add your Twilio Account SID, Auth Token, "
            "and Caller Number in Settings > API Keys > Telephony.",
        )


def _auth(config: dict) -> tuple:
    return (config["account_sid"], config["auth_token"])


async def place_click_to_call(config: dict, candidate_number: str, record: bool = False) -> dict:
    """Bridges the recruiter's own caller_number to candidate_number —
    see module docstring for the two-leg flow. Returns Twilio's Call
    resource (sid, status, ...); raises HTTPException on any failure
    (missing config, bad number, Twilio rejecting the request, etc.).

    record=True adds record="record-from-answer-dual" to the <Dial> —
    Twilio starts recording the instant both legs are connected (not the
    recruiter's own hold-music/ringing beforehand), capturing both sides
    of the conversation in one file. No recordingStatusCallback is set
    here deliberately — matching this module's existing "no external
    callback plumbing" design (see module docstring): the recording is
    fetched later, on demand, via fetch_call_recordings() below, rather
    than requiring a publicly reachable webhook URL just to know a call
    finished recording."""
    _require_configured(config)
    if not candidate_number or not candidate_number.strip():
        raise HTTPException(400, "This candidate has no phone number on file — nowhere to call.")

    caller = config["caller_number"].strip()
    candidate = candidate_number.strip()
    record_attr = ' record="record-from-answer-dual"' if record else ""
    twiml = f"<Response><Dial callerId=\"{caller}\"{record_attr}>{candidate}</Dial></Response>"

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            f"{TWILIO_API_BASE}/Accounts/{config['account_sid']}/Calls.json",
            auth=_auth(config),
            data={"To": caller, "From": caller, "Twiml": twiml},
        )
        if resp.status_code == 401:
            raise HTTPException(401, "Twilio rejected these credentials — check the Account SID and Auth Token in Settings.")
        if resp.status_code >= 400:
            detail = resp.json().get("message", resp.text) if resp.headers.get("content-type", "").startswith("application/json") else resp.text
            raise HTTPException(400, f"Twilio couldn't place the call: {detail[:200]}")
        body = resp.json()
        return {"sid": body.get("sid"), "status": body.get("status"), "to": candidate, "from": caller}


async def fetch_call_recordings(config: dict, call_sid: str) -> list:
    """Lists recordings Twilio has for this specific call — usually
    available within a few seconds to a minute of the call ending.
    Returns [] if nothing's ready yet (not an error — the caller decides
    whether to say "try again shortly")."""
    _require_configured(config)
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(
            f"{TWILIO_API_BASE}/Accounts/{config['account_sid']}/Calls/{call_sid}/Recordings.json",
            auth=_auth(config),
        )
        if resp.status_code == 401:
            raise HTTPException(401, "Twilio rejected these credentials — check the Account SID and Auth Token in Settings.")
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        return resp.json().get("recordings", [])


async def download_recording_audio(config: dict, recording_sid: str) -> bytes:
    """Downloads the actual audio bytes (MP3) for a recording — same
    Basic Auth as every other Twilio REST call, since recording media
    URLs require the same account credentials to fetch."""
    _require_configured(config)
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(
            f"{TWILIO_API_BASE}/Accounts/{config['account_sid']}/Recordings/{recording_sid}.mp3",
            auth=_auth(config),
        )
        if resp.status_code == 401:
            raise HTTPException(401, "Twilio rejected these credentials — check the Account SID and Auth Token in Settings.")
        resp.raise_for_status()
        return resp.content


async def send_sms(config: dict, to_number: str, body: str) -> dict:
    """Sends an SMS from the recruiter's caller_number to to_number.
    Returns Twilio's Message resource; raises HTTPException on failure."""
    _require_configured(config)
    if not to_number or not to_number.strip():
        raise HTTPException(400, "This candidate has no phone number on file — nowhere to text.")

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            f"{TWILIO_API_BASE}/Accounts/{config['account_sid']}/Messages.json",
            auth=_auth(config),
            data={"To": to_number.strip(), "From": config["caller_number"].strip(), "Body": body},
        )
        if resp.status_code == 401:
            raise HTTPException(401, "Twilio rejected these credentials — check the Account SID and Auth Token in Settings.")
        if resp.status_code >= 400:
            detail = resp.json().get("message", resp.text) if resp.headers.get("content-type", "").startswith("application/json") else resp.text
            raise HTTPException(400, f"Twilio couldn't send the SMS: {detail[:200]}")
        result = resp.json()
        return {"sid": result.get("sid"), "status": result.get("status"), "to": result.get("to")}
