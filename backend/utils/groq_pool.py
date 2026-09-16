"""
TalentIQ - Shared Groq key pool with adaptive, self-healing routing.

Replaces a fixed per-user quota with something that actually scales with
demand: instead of rationing a single shared key by blocking users once
they hit a ceiling, this spreads load across a POOL of shared keys and
automatically routes around whichever ones are currently rate-limited.
Capacity grows by an admin adding another key to the pool — a one-row
insert via the existing generic admin table editor, not a code change —
rather than by adjusting a limit that only ever rations scarcity.

Health tracking is DB-backed rather than in-process memory, specifically
so this stays correct if the app ever runs as multiple replicas behind a
load balancer — each replica reads/writes the same cooldown state, rather
than every replica independently re-discovering that a key is rate-limited.

Backward compatible with a single legacy global Groq key: if the pool
table is empty, resolution falls back to the existing is_global=True
UserAPIKey row exactly as before this feature existed. An admin only
needs to populate the pool if/when they want the adaptive multi-key
behavior; nothing breaks if they never do.
"""
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from models.models import UserAPIKey, GroqKeyPool

# Cooldown grows with consecutive failures (30s, 60s, 120s, 240s... capped
# at 10 minutes) — a key that's genuinely being rate-limited gets a real
# break instead of being retried every single request, but nothing is ever
# a PERMANENT ban; it's automatically tried again once the cooldown lapses,
# and a single success immediately clears it back to full health.
BASE_COOLDOWN_SECONDS = 30
MAX_COOLDOWN_SECONDS = 600


def _mask(key_value: str) -> str:
    """Same masking convention used in the admin pool UI (routers/admin.py)
    — last 4 characters only, safe to log or display, never the real key."""
    if not key_value:
        return ""
    tail = key_value[-4:] if len(key_value) >= 4 else key_value
    return f"...{tail}"


async def resolve_groq_key(db: AsyncSession, user_id: int, exclude_personal: bool = False) -> dict:
    """Resolves the Groq key (and optional per-key model override) to use
    for this request.

    Returns:
    {"groq_key": str | None, "model": str | None,
     "source": "personal" | "pool" | "legacy_global" | "none",
     "pool_id": int | None, "key_preview": str}

    key_preview is a masked identifier (last 4 chars, e.g. "...ab12") —
    safe to log or show in the UI so a specific request can be traced back
    to which key actually served it, without ever exposing the real value.
    This matters directly once there's more than one key in play: "why did
    this analysis fall back" is a very different question to answer when
    you can see it was specifically key "...ab12" that failed, versus
    just knowing "a key failed, somewhere."

    - "personal": the user's own saved key. Always exempt from pool/health
      logic entirely — it's their account, their budget.
    - "pool": the least-recently-used currently-healthy key from
      GroqKeyPool. Call record_key_outcome() after the attempt so future
      requests route around it if it turns out to be struggling.
    - "legacy_global": the pool is empty (or every pool entry is currently
      cooling down) — falls back to the original single shared
      is_global=True key, so existing single-key setups keep working with
      zero migration required.
    - "none": nothing configured at all, personal or shared — callers
      fall through to Ollama/keyword matching exactly as before this
      feature existed.

    exclude_personal: skip the personal-key lookup and go straight to the
    pool. Every retry-on-failure call site in this app (utils.llm_
    extraction's three retry loops, call_groq_with_pool_retry below) passes
    True here — a personal key was found on account for a real production
    bug: a broken/exhausted personal key made this function return that
    SAME key on every single retry attempt (it has absolute, unconditional
    priority below), which made every retry loop's "is this genuinely a
    different key?" check correctly refuse to retry — but SILENTLY, with
    no failure or log line explaining why an admin's 6-key pool sat
    completely unused. The personal key still always wins on a FRESH
    request (this only ever gets passed True from inside a retry that has
    already tried it once and failed), so a working personal key's
    behavior is completely unchanged; only a BROKEN one now correctly
    falls through to the shared pool instead of silently blocking it.
    """
    personal_key = None
    if not exclude_personal:
        r = await db.execute(
            select(UserAPIKey.key_value).where(
                UserAPIKey.user_id == user_id,
                UserAPIKey.service == "groq",
                UserAPIKey.key_name == "api_key",
                UserAPIKey.is_global.isnot(True),
            )
        )
        personal_key = r.scalar_one_or_none()
    if personal_key:
        return {"groq_key": personal_key, "model": None, "source": "personal", "pool_id": None, "key_preview": _mask(personal_key)}

    now = datetime.utcnow()
    r = await db.execute(
        select(GroqKeyPool)
        .where(
            GroqKeyPool.is_active.is_(True),
            or_(GroqKeyPool.cooldown_until.is_(None), GroqKeyPool.cooldown_until < now),
        )
        .order_by(GroqKeyPool.last_used_at.asc().nulls_first())
        .limit(1)
    )
    entry = r.scalar_one_or_none()
    if entry:
        entry.last_used_at = now
        await db.commit()
        return {"groq_key": entry.key_value, "model": entry.model or None, "source": "pool", "pool_id": entry.id, "key_preview": _mask(entry.key_value)}

    # Pool is empty, or every entry is currently cooling down — fall back
    # to the legacy single global key so existing deployments with just
    # one shared key are completely unaffected by this feature existing.
    r = await db.execute(
        select(UserAPIKey.key_value).where(
            UserAPIKey.is_global.is_(True),
            UserAPIKey.service == "groq",
            UserAPIKey.key_name == "api_key",
        )
    )
    legacy_key = r.scalar_one_or_none()
    if legacy_key:
        return {"groq_key": legacy_key, "model": None, "source": "legacy_global", "pool_id": None, "key_preview": _mask(legacy_key)}

    return {"groq_key": None, "model": None, "source": "none", "pool_id": None, "key_preview": ""}


async def record_key_outcome(db: AsyncSession, pool_id: Optional[int], success: bool) -> None:
    """Updates a pool key's health after an attempt that used it.

    On success: immediately clears any cooldown and resets the error
    streak — a key that's working again is trusted again right away, no
    gradual "probation" period.

    On failure: applies an exponentially increasing cooldown so a key
    that's genuinely struggling (rate-limited, or a deeper problem) gets
    skipped for a while rather than being retried on every single request
    — but always automatically, never a permanent removal. An admin can
    still hard-disable a key via is_active if it turns out to be
    genuinely bad (e.g. revoked), but that's a deliberate action, not
    something this function does on its own.
    """
    if pool_id is None:
        return
    entry = await db.get(GroqKeyPool, pool_id)
    if not entry:
        return
    if success:
        entry.consecutive_errors = 0
        entry.cooldown_until = None
    else:
        entry.consecutive_errors += 1
        cooldown = min(BASE_COOLDOWN_SECONDS * (2 ** (entry.consecutive_errors - 1)), MAX_COOLDOWN_SECONDS)
        entry.cooldown_until = datetime.utcnow() + timedelta(seconds=cooldown)
    await db.commit()


# How many DISTINCT pool keys a single Groq call will try (via
# call_groq_with_pool_retry below) before the caller gives up on Groq
# entirely. Shared with utils/llm_extraction.py's own MAX_GROQ_KEY_ATTEMPTS
# (kept as a separate constant there since that module predates this one
# and has its own bespoke retry loops — this one is for every OTHER
# call site in the app).
MAX_POOL_RETRY_ATTEMPTS = 4


async def call_groq_with_pool_retry(
    db: Optional[AsyncSession],
    user_id: Optional[int],
    make_call,
    groq_key: Optional[str] = None,
    groq_model: Optional[str] = None,
    max_attempts: int = MAX_POOL_RETRY_ATTEMPTS,
):
    """Runs ONE logical Groq call with automatic multi-key-pool retry —
    this is the single place that pattern lives, rather than every LLM
    call site in the app either reimplementing it (utils/llm_extraction.py
    had three separate, slightly-diverging copies before this — see its
    MAX_GROQ_KEY_ATTEMPTS docstring for the bug that caused directly:
    "essential requirements" ending up as meaningless 2-3 letter
    fragments because the fallback keyword heuristic fired on the FIRST
    failure of the FIRST key, with 5 other pool keys never even tried),
    or — as every OTHER call site in the app did before this — not
    retrying at all: one exception from whichever single key got handed
    to it, and the caller's except block ran, full stop, regardless of
    how many other healthy keys were sitting in the pool.

    Retries on ANY exception, not just a detected rate limit — a
    malformed/unparseable response, a timeout, or a transient 5xx is just
    as much "this attempt didn't work" as a 429 is, and a multi-key pool
    exists precisely so one bad attempt doesn't have to mean "give up."

    Args:
      db, user_id: needed to resolve/rotate pool keys and report each
        attempt's outcome back to pool health tracking. Pass None for
        either to disable retry entirely (single attempt with whatever
        `groq_key` was passed in) — matches the old behavior exactly for
        any call site not ready to opt into pool-aware retry.
      make_call: an async callable `make_call(key, model) -> result`,
        performing exactly ONE Groq attempt and raising on failure. If
        the underlying call is a blocking langchain `.invoke()` (it is,
        everywhere in this app), wrap it in `asyncio.to_thread(...)` (or
        the app's dedicated LLM thread pool, see utils.llm_extraction.
        _run_in_llm_pool) inside this callable — this function itself
        does no threading of its own.
      groq_key, groq_model: the FIRST key/model to try. If db/user_id are
        also given and this is falsy, a pool key is resolved as the
        first attempt too, rather than requiring the caller to resolve
        one just to hand it straight back in.
      max_attempts: how many distinct keys to try in total before giving
        up and re-raising the last error.

    Returns the first successful result. Raises the LAST exception hit
    if every attempt fails (across up to `max_attempts` distinct keys, or
    just the one attempt if db/user_id weren't provided) — callers keep
    their existing `except Exception:` fallback behavior unchanged, it
    now just triggers only after the pool's redundancy has genuinely been
    used up, not after the first unlucky key.
    """
    key, model, pool_id = groq_key, groq_model, None
    if db is not None and user_id is not None and not key:
        kr = await resolve_groq_key(db, user_id)
        key, model, pool_id = kr["groq_key"], kr["model"] or model, kr["pool_id"]

    last_error: Optional[Exception] = None
    for attempt in range(max(1, max_attempts)):
        if not key:
            break
        try:
            result = await make_call(key, model)
            if pool_id is not None:
                await record_key_outcome(db, pool_id, success=True)
            return result
        except Exception as e:
            last_error = e
            if pool_id is not None:
                await record_key_outcome(db, pool_id, success=False)
            if db is None or user_id is None or attempt >= max_attempts - 1:
                break
            # exclude_personal=True — a personal key otherwise gets
            # returned again unconditionally (it has absolute priority in
            # resolve_groq_key) on every retry, which made the "is this a
            # different key?" check below correctly refuse to retry but
            # SILENTLY, hiding a broken personal key blocking the entire
            # pool with no failure or log line explaining why. See
            # resolve_groq_key's exclude_personal docstring for the full
            # story — this was a real bug, not a hypothetical.
            kr = await resolve_groq_key(db, user_id, exclude_personal=True)
            if kr["groq_key"] and kr["key_preview"] != _mask(key):
                print(f"  WARNING: call_groq_with_pool_retry — key {_mask(key)} failed ({type(e).__name__}: {str(e)[:150]}), retrying with a different pool key {kr['key_preview']} (attempt {attempt + 2}/{max_attempts})")
                key, model, pool_id = kr["groq_key"], kr["model"] or model, kr["pool_id"]
                continue
            print(f"  WARNING: call_groq_with_pool_retry — key {_mask(key)} failed ({type(e).__name__}: {str(e)[:150]}), NOT retrying: {'no other pool key is currently healthy/configured' if not kr['groq_key'] else 'resolve_groq_key returned the same key again'}")
            break

    if last_error is not None:
        raise last_error
    return None
