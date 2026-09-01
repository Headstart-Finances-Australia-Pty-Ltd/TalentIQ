"""
TalentIQ - Centralized credential lookup.

Security policy (enforced HERE ONLY — every router must go through these
functions rather than querying UserAPIKey directly, so the policy can never
drift or be accidentally bypassed in one module but not another):

  * groq, ollama, apify — a user's OWN saved key always wins. If they
    haven't set one, fall back to a GLOBAL key (is_global=True), which can
    only be configured by an admin (enforced in routers/auth.py). These
    three are explicitly approved to be shared platform-wide since they're
    infrastructure/API credentials, not personal accounts.

  * every other service (linkedin, smtp, morphcast, and anything added
    later) — STRICTLY private. Only that exact user's own row is ever
    returned. No fallback, no admin override, no cross-user access of any
    kind, regardless of role. A LinkedIn credential saved by one user is
    never visible to, or usable by, any other user — including admins.
"""
from typing import Optional
import os
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from models.models import UserAPIKey


def ollama_enabled() -> bool:
    """Explicit per-environment kill-switch for Ollama, independent of
    whether an Ollama credential happens to exist in the database.

    Set OLLAMA_ENABLED=false in this environment's variables (e.g. the
    Northflank production deployment) to GUARANTEE Ollama is never
    attempted here, no matter what — rather than relying on remembering
    not to configure a base_url/model row, which a future admin action or
    an accidentally-copied database could silently reintroduce.

    Defaults to enabled (true) when unset, so local development
    environments keep racing against a local Ollama instance exactly as
    before — this only needs to be set explicitly in the environments
    where Ollama should be hard-disabled."""
    return os.getenv("OLLAMA_ENABLED", "true").strip().lower() not in ("false", "0", "no", "off")

# Only these services may ever have a shared/global fallback. Adding a
# service here is a deliberate security decision — do not add personal
# platform credentials (LinkedIn login, personal email, etc.) to this set.
# "interview" holds platform-wide CandidateLens video-interview settings
# (answer time per question, TTS voice) — admin-configured, not a personal
# credential, so it belongs in the same shareable bucket as groq/apify.
# "database" and "s3" hold platform infrastructure credentials (the
# Xata Postgres connection string on record, and the object-storage
# bucket used for video/audio) — see Admin Console > API Keys. These
# are inherently
# platform-wide (there's one database and one bucket for the whole
# deployment, not one per user), so they're admin-managed only, same as
# groq/apify, with no notion of a private per-user override.
# "apify" holds the Apify API token (and optional actor_id override) used
# to run the Seek job-search scraper Actor — see agents/jobhunt_agent.py.
# "stripe" holds the platform's own Stripe secret key / webhook signing
# secret for billing checkout — there's one Stripe account for the whole
# deployment, same reasoning as database/s3 — see routers/billing.py.
# "linkedin_jobs" and "seek_jobs" hold a LinkedIn Talent/Jobs API access
# token and a Seek Partner API key used to PUSH a job ad live on those
# boards (see routers/job_ads.py) — an organizational partner-API
# credential, not a personal login (that's the separate, strictly-private
# "linkedin" service LinkLens uses for candidate search). One Partner API
# agreement covers every recruiter on the deployment, admin-configured
# only via Admin Console > API Keys, same as groq/apify/stripe.
SHAREABLE_SERVICES = {"groq", "ollama", "apify", "interview", "database", "s3", "stripe", "linkedin_jobs", "seek_jobs"}

# Fallback ONLY — used when a user (and no admin-shared global) has set a
# Groq model. Groq periodically deprecates models (llama3-70b-8192, then
# even its own recommended replacement llama-3.3-70b-versatile, both
# retired within about a year of each other) — every call site should go
# through get_groq_model() below instead of hardcoding a model string, so
# updating this one constant (or just setting a model in Settings) is
# enough to recover from a future deprecation without touching code.
DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"


async def get_groq_model(db: AsyncSession, user_id: int) -> str:
    """Returns the Groq model to use for this user: their own saved model,
    else the admin-configured global one, else DEFAULT_GROQ_MODEL."""
    model = await get_credential(db, user_id, "groq", "model")
    return model or DEFAULT_GROQ_MODEL


async def get_credential(
    db: AsyncSession, user_id: int, service: str, key_name: str,
) -> Optional[str]:
    """Look up a single credential value, applying the sharing policy above."""
    r = await db.execute(
        select(UserAPIKey.key_value).where(
            UserAPIKey.user_id == user_id,
            UserAPIKey.service == service,
            UserAPIKey.key_name == key_name,
        )
    )
    val = r.scalar_one_or_none()
    if val:
        return val

    if service not in SHAREABLE_SERVICES:
        return None  # strictly private services never fall back — full stop

    r = await db.execute(
        select(UserAPIKey.key_value).where(
            UserAPIKey.is_global.is_(True),
            UserAPIKey.service == service,
            UserAPIKey.key_name == key_name,
        )
    )
    return r.scalar_one_or_none()


async def get_global_credentials(db: AsyncSession, service: str) -> dict:
    """Pure platform-wide lookup — {key_name: key_value} for every
    global row under a service, with no per-user overlay. For
    infra-only services (database, s3) there's no such thing as a
    user's own override, and callers here are often background code
    with no request-bound user_id to pass (e.g. a storage helper used
    from a script or a queued job) — this avoids needing to fake one.
    Restricted to SHAREABLE_SERVICES, same as everywhere else."""
    if service not in SHAREABLE_SERVICES:
        return {}
    r = await db.execute(
        select(UserAPIKey.key_name, UserAPIKey.key_value).where(
            UserAPIKey.is_global.is_(True),
            UserAPIKey.service == service,
        )
    )
    return {k: v for k, v in r.all()}


async def get_all_credentials(db: AsyncSession, user_id: int, service: str) -> dict:
    """Returns {key_name: key_value} for every key under a service, merging
    the global fallback (if the service allows it) with the user's own
    values on top — e.g. a user can override just one field (say, Ollama
    'model') while still inheriting the global 'base_url'."""
    result: dict = {}

    if service in SHAREABLE_SERVICES:
        r = await db.execute(
            select(UserAPIKey.key_name, UserAPIKey.key_value).where(
                UserAPIKey.is_global.is_(True),
                UserAPIKey.service == service,
            )
        )
        for k, v in r.all():
            result[k] = v

    r = await db.execute(
        select(UserAPIKey.key_name, UserAPIKey.key_value).where(
            UserAPIKey.user_id == user_id,
            UserAPIKey.service == service,
        )
    )
    for k, v in r.all():
        result[k] = v  # the user's own value always overrides the global one

    return result
