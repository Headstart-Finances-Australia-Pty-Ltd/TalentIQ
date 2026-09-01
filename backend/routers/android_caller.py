"""
Windows/Android Caller — server-side relay.

Why this exists: TalentIQ's backend runs on a server with no path onto a
recruiter's home/office Wi-Fi, but placing a call requires talking to
their Android phone over ADB, which only works on that local network.
The old approach had the recruiter's BROWSER call a Local API running on
their own laptop directly (127.0.0.1) — that only works while the
browser tab and the paired phone are on the exact same machine, and runs
into mixed-content/CORS friction once TalentIQ is served over https from
a real domain.

This relay flips it around: the small Node agent on the recruiter's
laptop makes an OUTBOUND WebSocket connection to THIS backend (so no
inbound firewall/NAT hole needed on their end), authenticated with a
per-user, opaque "agent token" generated below. TalentIQ's normal HTTP
API (called from any device, any browser) then forwards call/hangup/
pair/connect commands down that socket and relays the agent's response
back as a normal HTTP response.

Caveat: connections are held in-process (_CONNECTIONS below). If this
backend ever runs as multiple workers/replicas behind a load balancer,
an agent connected to worker A is invisible to worker B — that would
need a shared store (e.g. Redis pub/sub) instead of a plain dict.
"""

import asyncio
import json
import secrets
import uuid
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import AsyncSessionLocal, get_db
from models.models import User, UserAPIKey
from utils.auth_utils import get_current_user

router = APIRouter()

CMD_TIMEOUT_SECONDS = 15

# user_id -> connected agent's WebSocket (one agent per user; a second
# connection replaces the first, same as re-pairing a device).
_CONNECTIONS: Dict[int, WebSocket] = {}
# request id -> Future the waiting HTTP handler is blocked on.
_PENDING: Dict[str, "asyncio.Future"] = {}
# user_id -> most recent {"deviceConnected": bool, "needsAuthorization": bool}
# the agent has pushed, so GET /status doesn't have to round-trip to it.
_LAST_HEALTH: Dict[int, dict] = {}


@router.websocket("/ws")
async def android_caller_ws(websocket: WebSocket, token: str | None = None):
    """The Node agent (windows-android-caller/server/agent.js) connects
    here with its per-user token as a query param, e.g.
    wss://your-talentiq-domain/api/android-caller/ws?token=... — a plain
    Node WebSocket client, not a browser, so no CORS applies."""
    await websocket.accept()
    if not token:
        await websocket.close(code=4401)
        return

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(UserAPIKey).where(
                UserAPIKey.service == "android_caller",
                UserAPIKey.key_name == "agent_token",
                UserAPIKey.key_value == token,
            )
        )
        key = result.scalar_one_or_none()
    if not key:
        await websocket.close(code=4403)
        return

    user_id = key.user_id
    _CONNECTIONS[user_id] = websocket
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if msg.get("type") == "health":
                _LAST_HEALTH[user_id] = msg
            elif msg.get("type") == "result":
                fut = _PENDING.pop(msg.get("id"), None)
                if fut and not fut.done():
                    fut.set_result(msg)
    except WebSocketDisconnect:
        pass
    finally:
        if _CONNECTIONS.get(user_id) is websocket:
            _CONNECTIONS.pop(user_id, None)
            _LAST_HEALTH.pop(user_id, None)


async def _send_command(user_id: int, cmd: dict) -> dict:
    ws = _CONNECTIONS.get(user_id)
    if not ws:
        raise HTTPException(
            status_code=503,
            detail="No Windows/Android Caller agent connected. Make sure it's running on your laptop (see Settings → Phone Connection).",
        )
    req_id = str(uuid.uuid4())
    fut: asyncio.Future = asyncio.get_event_loop().create_future()
    _PENDING[req_id] = fut
    try:
        await ws.send_text(json.dumps({**cmd, "id": req_id}))
        return await asyncio.wait_for(fut, timeout=CMD_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Agent didn't respond in time.")
    finally:
        _PENDING.pop(req_id, None)


@router.get("/status")
async def status(current_user: User = Depends(get_current_user)):
    health = _LAST_HEALTH.get(current_user.id, {})
    return {
        "agentConnected": current_user.id in _CONNECTIONS,
        "deviceConnected": bool(health.get("deviceConnected")),
        "needsAuthorization": bool(health.get("needsAuthorization")),
    }


@router.post("/call")
async def call(payload: dict, current_user: User = Depends(get_current_user)):
    to_number = (payload or {}).get("to_number") or (payload or {}).get("toNumber")
    if not to_number:
        raise HTTPException(status_code=400, detail="to_number is required")
    result = await _send_command(current_user.id, {"cmd": "call", "toNumber": to_number})
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "Failed to start call on the phone")
    return result.get("data") or {"status": "dialing", "toNumber": to_number}


@router.post("/hangup")
async def hangup(current_user: User = Depends(get_current_user)):
    result = await _send_command(current_user.id, {"cmd": "hangup"})
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "Failed to end call")
    return {"status": "ended"}


@router.post("/pair")
async def pair(payload: dict, current_user: User = Depends(get_current_user)):
    result = await _send_command(current_user.id, {
        "cmd": "pair", "ip": (payload or {}).get("ip"), "port": (payload or {}).get("port"), "code": (payload or {}).get("code"),
    })
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "Pairing failed")
    return result.get("data") or {"status": "paired"}


@router.post("/connect")
async def connect(payload: dict, current_user: User = Depends(get_current_user)):
    result = await _send_command(current_user.id, {
        "cmd": "connect", "ip": (payload or {}).get("ip"), "port": (payload or {}).get("port"),
    })
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "Connect failed")
    return result.get("data") or {"status": "connected"}


@router.post("/generate-token")
async def generate_token(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Issues a fresh opaque token for this user and overwrites any
    previous one (so an old, possibly-leaked token stops working the
    moment a new one is generated) — same upsert-by-service+key_name
    pattern the rest of Settings' API Keys already use."""
    token = secrets.token_urlsafe(32)
    result = await db.execute(
        select(UserAPIKey).where(
            UserAPIKey.user_id == current_user.id,
            UserAPIKey.service == "android_caller",
            UserAPIKey.key_name == "agent_token",
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.key_value = token
    else:
        db.add(UserAPIKey(user_id=current_user.id, service="android_caller", key_name="agent_token", key_value=token, is_global=False))
    await db.flush()
    return {"agent_token": token}
