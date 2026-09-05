"""
TalentIQ - Admin Router
Full database browser, user management, record editing for all tiq_* tables.
"""
import os
import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text, update, delete, inspect, func, bindparam
from sqlalchemy.engine import Row
from pydantic import BaseModel

from db.database import get_db, engine, get_connection_display_info, test_connection_url
from models.models import User
from models.billing_models import Subscription, PricingPlan
from utils.auth_utils import get_current_user, require_admin
from utils.storage import test_s3_config, REQUIRED_S3_FIELDS, get_s3_client, get_s3_config, get_presigned_url, delete_file

router = APIRouter()

# The plan's allocated database storage, in GB — this is the fallback
# default (env-configured, since it depends on whichever Xata plan/tier
# is active, not anything the app itself controls). Defaults to 5GB per
# the current plan. An admin can override this at runtime via Admin
# Console > API Keys (see SETTING_KEY_ALLOCATED_GB below) without a
# redeploy — that DB-stored override, when present, always wins over
# this constant; see _get_allocated_bytes().
DB_ALLOCATED_BYTES = float(os.getenv("DB_ALLOCATED_GB", "5")) * 1024 ** 3

SETTING_KEY_ALLOCATED_GB = "db_allocated_gb"
MIN_ALLOCATED_GB = 0.1
MAX_ALLOCATED_GB = 100_000  # 100TB sanity ceiling — not a real plan limit, just enough to catch a stray extra zero


async def _get_allocated_gb_override(db: AsyncSession):
    """Returns the DB-stored override row for the allocated-storage
    setting, or None if an admin has never set one (in which case
    callers should fall back to DB_ALLOCATED_BYTES)."""
    from models.models import SystemSetting
    return (await db.execute(
        select(SystemSetting).where(SystemSetting.setting_key == SETTING_KEY_ALLOCATED_GB)
    )).scalar_one_or_none()


async def _get_allocated_bytes(db: AsyncSession) -> float:
    row = await _get_allocated_gb_override(db)
    return float(row.value) * 1024 ** 3 if row else DB_ALLOCATED_BYTES

# ── TABLE LIST ───────────────────────────────────────────────────────

@router.get("/tables")
async def list_tables(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """List all tiq_* tables with row counts and on-disk size (data +
    indexes, via pg_total_relation_size — sizes for every table are
    fetched in a single batched query rather than one call per table)."""
    size_result = await db.execute(text(
        "SELECT tablename, pg_total_relation_size(quote_ident(tablename)) AS size_bytes "
        "FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tiq_%' ORDER BY tablename"
    ))
    sizes = {row[0]: row[1] for row in size_result.fetchall()}

    tables = []
    for tname, size_bytes in sizes.items():
        cnt = (await db.execute(text(f'SELECT COUNT(*) FROM "{tname}"'))).scalar()
        tables.append({"table": tname, "rows": cnt, "size_bytes": size_bytes})
    return tables


# ── DATABASE STORAGE USAGE ───────────────────────────────────────────

@router.get("/storage")
async def storage_usage(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Total database size vs. the allocated plan quota, plus each
    tiq_* table's own on-disk size, largest first — so it's obvious at
    a glance where space is actually going (video_blob on the
    candidates table is almost always the biggest single consumer).

    Note: pg_database_size() reports this Postgres endpoint's live
    data+index size. Providers with a branching model (Xata included —
    each branch is its own copy-on-write Postgres) can bill storage
    slightly differently from this figure since it doesn't account for
    other branches/history, but this is the most accurate figure
    obtainable via SQL and matches what the connected database itself
    reports.
    """
    total_bytes = (await db.execute(text(
        "SELECT pg_database_size(current_database())"
    ))).scalar() or 0

    size_result = await db.execute(text(
        "SELECT tablename, pg_total_relation_size(quote_ident(tablename)) AS size_bytes "
        "FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tiq_%'"
    ))
    tables = [{"table": row[0], "size_bytes": row[1]} for row in size_result.fetchall()]
    tables.sort(key=lambda t: t["size_bytes"], reverse=True)

    allocated_bytes = await _get_allocated_bytes(db)
    return {
        "total_bytes": total_bytes,
        "allocated_bytes": allocated_bytes,
        "used_pct": round(100 * total_bytes / allocated_bytes, 1) if allocated_bytes else None,
        "tables": tables,
    }


# ── CLOUD STORAGE (S3-compatible — Cloudflare R2 in production) ────────
# Separate from the Postgres table/row browser above: this lists actual
# OBJECTS in the bucket configured under the "s3" global credential (see
# utils/storage.py — Admin Console > API Keys), not database rows.
# Every object key is "{account-folder}/{kind}/{sub_id}/{uuid}.{ext}"
# (see utils/storage._object_key), so Delimiter="/" folder-by-folder
# browsing mirrors that structure naturally: one folder per TalentIQ
# account, then resumes/jds/videos/cover-letters underneath.

@router.get("/storage/r2/browse")
async def browse_r2(
    prefix: str = "",
    continuation_token: Optional[str] = None,
    max_keys: int = 200,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    cfg = await get_s3_config(db)
    if not cfg:
        return {
            "configured": False, "bucket": None, "prefix": prefix,
            "folders": [], "files": [], "isTruncated": False, "nextContinuationToken": None,
        }

    client, bucket = await get_s3_client(db)
    kwargs: Dict[str, Any] = {"Bucket": bucket, "Delimiter": "/", "MaxKeys": max_keys}
    if prefix:
        kwargs["Prefix"] = prefix
    if continuation_token:
        kwargs["ContinuationToken"] = continuation_token

    try:
        resp = await asyncio.to_thread(client.list_objects_v2, **kwargs)
    except Exception as e:
        raise HTTPException(502, f"Could not list bucket contents: {type(e).__name__}: {e}")

    folders = [cp["Prefix"] for cp in resp.get("CommonPrefixes", [])]
    files = [
        {
            "key": o["Key"],
            "sizeBytes": o["Size"],
            "lastModified": o["LastModified"].isoformat() if o.get("LastModified") else None,
        }
        for o in resp.get("Contents", [])
        # A "folder" itself sometimes shows up as a zero-byte object with
        # the same key as its own prefix (created by some S3 clients) —
        # skip it here since it's already represented in `folders` above.
        if o["Key"] != prefix
    ]
    return {
        "configured": True,
        "bucket": bucket,
        "prefix": prefix,
        "folders": folders,
        "files": files,
        "isTruncated": resp.get("IsTruncated", False),
        "nextContinuationToken": resp.get("NextContinuationToken"),
    }


@router.get("/storage/r2/download")
async def download_r2_object(
    key: str,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Returns a short-lived presigned GET URL rather than proxying the
    file through this server — same approach as the video-interview
    streaming endpoints (see utils/storage.get_video_presigned_url)."""
    url = await get_presigned_url(db, key, expires_in=300)
    if not url:
        raise HTTPException(404, "Object not found, or cloud storage isn't configured (Admin Console > API Keys).")
    return {"url": url}


@router.delete("/storage/r2/object")
async def delete_r2_object(
    key: str,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Permanently deletes ONE object from the bucket. This does not
    touch any *_key column pointing at it in Postgres — an admin using
    this to clean up storage should confirm the owning row (resume, JD,
    video, etc.) is already gone or being replaced, since the app has no
    way to detect a dangling reference after this call."""
    ok = await delete_file(db, key)
    if not ok:
        raise HTTPException(400, "Delete failed, or cloud storage isn't configured.")
    return {"message": "Deleted", "key": key}


# ── TABLE SCHEMA ─────────────────────────────────────────────────────

@router.get("/tables/{table}/schema")
async def table_schema(table: str, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Get column names and types for a table."""
    if not table.startswith("tiq_"):
        raise HTTPException(403, "Only tiq_* tables are accessible")
    result = await db.execute(text(
        "SELECT column_name, data_type, is_nullable, column_default "
        "FROM information_schema.columns "
        "WHERE table_name = :t AND table_schema = 'public' "
        "ORDER BY ordinal_position",
    ), {"t": table})
    return [dict(r._mapping) for r in result.fetchall()]


# ── TABLE ROWS ───────────────────────────────────────────────────────

@router.get("/tables/{table}/rows")
async def table_rows(
    table: str,
    page: int = 1,
    page_size: int = 50,
    search: Optional[str] = None,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if not table.startswith("tiq_"):
        raise HTTPException(403, "Only tiq_* tables are accessible")
    offset = (page - 1) * page_size
    total = (await db.execute(text(f'SELECT COUNT(*) FROM "{table}"'))).scalar()
    rows = await db.execute(text(f'SELECT * FROM "{table}" ORDER BY id DESC LIMIT :lim OFFSET :off'), {"lim": page_size, "off": offset})
    cols = list(rows.keys())
    data = [dict(zip(cols, r)) for r in rows.fetchall()]
    # Convert non-serialisable types
    for row in data:
        for k, v in row.items():
            if hasattr(v, 'isoformat'):
                row[k] = v.isoformat()
            elif v is None:
                row[k] = None
            else:
                row[k] = str(v) if not isinstance(v, (int, float, bool, str, dict, list)) else v
    return {"total": total, "page": page, "page_size": page_size, "columns": cols, "rows": data}


# ── UPDATE ROW ───────────────────────────────────────────────────────

class RowUpdate(BaseModel):
    data: Dict[str, Any]

@router.put("/tables/{table}/rows/{row_id}")
async def update_row(
    table: str,
    row_id: int,
    payload: RowUpdate,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if not table.startswith("tiq_"):
        raise HTTPException(403, "Only tiq_* tables are accessible")
    # Build SET clause
    safe = {k: v for k, v in payload.data.items() if k != "id"}
    if not safe:
        raise HTTPException(400, "No fields to update")
    sets = ", ".join(f'"{k}" = :{k}' for k in safe)
    safe["_id"] = row_id
    await db.execute(text(f'UPDATE "{table}" SET {sets} WHERE id = :_id'), safe)
    await db.commit()
    return {"message": "Row updated"}


# ── DELETE ROW ───────────────────────────────────────────────────────

@router.delete("/tables/{table}/rows/{row_id}")
async def delete_row(
    table: str,
    row_id: int,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if not table.startswith("tiq_"):
        raise HTTPException(403, "Only tiq_* tables are accessible")
    # tiq_users is the one table where a raw row delete can silently
    # remove a protected/bootstrap admin account — same guard as the
    # dedicated /users/{id} endpoint, so this generic browser can't be
    # used as a bypass around it.
    if table == "tiq_users":
        protected = (await db.execute(
            text("SELECT is_protected FROM tiq_users WHERE id = :id"), {"id": row_id}
        )).scalar_one_or_none()
        if protected:
            raise HTTPException(403, "This account is protected and cannot be deleted.")
    await db.execute(text(f'DELETE FROM "{table}" WHERE id = :id'), {"id": row_id})
    await db.commit()
    return {"message": "Row deleted"}


@router.delete("/tables/{table}/rows")
async def bulk_delete_rows(
    table: str,
    payload: dict,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if not table.startswith("tiq_"):
        raise HTTPException(403, "Only tiq_* tables are accessible")
    ids = payload.get("ids", [])
    if not ids:
        raise HTTPException(400, "No row ids provided")

    # Same protected-account guard as the single-row delete above — strip
    # protected ids out of the batch rather than rejecting the whole
    # request outright, so deleting 10 test users still works even if one
    # of the selected rows happens to be the protected admin account.
    if table == "tiq_users":
        stmt = text("SELECT id FROM tiq_users WHERE id IN :ids AND is_protected = TRUE").bindparams(
            bindparam("ids", expanding=True)
        )
        protected_ids = set((await db.execute(stmt, {"ids": ids})).scalars().all())
        if protected_ids:
            ids = [i for i in ids if i not in protected_ids]
        if not ids:
            raise HTTPException(403, "All selected accounts are protected and cannot be deleted.")

    # A raw Python list bound to :ids with ANY(:ids) doesn't reliably expand
    # through SQLAlchemy's text() + asyncpg — bindparam(expanding=True) with
    # an IN clause is the correct, driver-safe way to bind a variable-length
    # list of values in a raw SQL statement.
    stmt = text(f'DELETE FROM "{table}" WHERE id IN :ids').bindparams(
        bindparam("ids", expanding=True)
    )
    result = await db.execute(stmt, {"ids": ids})
    await db.commit()
    return {"message": f"Deleted {result.rowcount} row(s)"}


# ── INSERT ROW ───────────────────────────────────────────────────────

@router.post("/tables/{table}/rows")
async def insert_row(
    table: str,
    payload: RowUpdate,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if not table.startswith("tiq_"):
        raise HTTPException(403, "Only tiq_* tables are accessible")
    safe = {k: v for k, v in payload.data.items() if k != "id" and v is not None and v != ""}
    if not safe:
        raise HTTPException(400, "No data provided")
    cols = ", ".join(f'"{k}"' for k in safe)
    vals = ", ".join(f":{k}" for k in safe)
    result = await db.execute(text(f'INSERT INTO "{table}" ({cols}) VALUES ({vals}) RETURNING id'), safe)
    await db.commit()
    return {"message": "Row inserted", "id": result.scalar()}


# ── USER MANAGEMENT (Registration table) ─────────────────────────────

@router.get("/users")
async def list_users(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(User).order_by(User.created_at.desc())
    )
    users = result.scalars().all()

    # One extra query for every subscription + its plan name, rather than
    # a per-user N+1 — small tables (one row per user, one per plan), so
    # loading both in full and joining in Python is simpler than a SQL
    # JOIN here and just as fast in practice.
    subs = {s.user_id: s for s in (await db.execute(select(Subscription))).scalars().all()}
    plan_names = {p.slug: p.name for p in (await db.execute(select(PricingPlan))).scalars().all()}

    def _iso(dt):
        return dt.isoformat() if dt else None

    out = []
    for u in users:
        sub = subs.get(u.id)
        out.append({
            "id": u.id, "name": u.name, "email": u.email,
            "company": u.company, "phone": u.phone, "role": u.role,
            "is_active": u.is_active,
            "created_at": _iso(u.created_at),
            "last_login": _iso(u.last_login),
            # Plan/billing columns — from tiq_subscriptions (+ its plan's
            # display name), one row per user, "none" until they've ever
            # subscribed to or started a demo of anything. start_date is
            # also the payment date for the CURRENT term: activation and
            # payment happen in the same instant, in the Stripe webhook
            # handler (see routers/billing.py's stripe_webhook) — there's
            # no separate "paid but not yet active" state in this model.
            "plan_name": plan_names.get(sub.plan_slug, sub.plan_slug) if sub and sub.plan_slug else "—",
            "plan_status": sub.status if sub else "none",
            "plan_start_date": _iso(sub.start_date) if sub else None,
            "plan_end_date": _iso(sub.end_date) if sub else None,
            "payment_date": _iso(sub.start_date) if (sub and sub.amount_paid_cents) else None,
            "amount_paid_cents": sub.amount_paid_cents if sub else 0,
            "transaction_number": (sub.stripe_checkout_session_id or "—") if sub else "—",
        })
    return out


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    company: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


@router.put("/users/{user_id}")
async def update_user(
    user_id: int,
    payload: UserUpdate,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    if payload.name is not None: user.name = payload.name
    if payload.email is not None: user.email = payload.email
    if payload.company is not None: user.company = payload.company
    if payload.phone is not None: user.phone = payload.phone
    if payload.role is not None: user.role = payload.role
    if payload.is_active is not None: user.is_active = payload.is_active
    if payload.password:
        import bcrypt
        user.password_hash = bcrypt.hashpw(payload.password.encode(), bcrypt.gensalt()).decode()
    await db.commit()
    return {"message": "User updated"}


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    current: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if user_id == current.id:
        raise HTTPException(400, "Cannot delete your own account")
    protected = (await db.execute(
        text("SELECT is_protected FROM tiq_users WHERE id = :id"), {"id": user_id}
    )).scalar_one_or_none()
    if protected is None:
        raise HTTPException(404, "User not found")
    if protected:
        raise HTTPException(403, "This account is protected and cannot be deleted.")
    await db.execute(text("DELETE FROM tiq_users WHERE id = :id"), {"id": user_id})
    await db.commit()
    return {"message": "User deleted"}


# ── RAW SQL QUERY ────────────────────────────────────────────────────

class SQLQuery(BaseModel):
    sql: str

@router.post("/query")
async def run_query(
    payload: SQLQuery,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Execute a raw SELECT query (read-only)."""
    sql = payload.sql.strip()
    if not sql.lower().startswith("select"):
        raise HTTPException(400, "Only SELECT queries are allowed here. Use table endpoints for writes.")
    try:
        result = await db.execute(text(sql))
        cols = list(result.keys())
        rows = []
        for r in result.fetchall():
            row = {}
            for k, v in zip(cols, r):
                if hasattr(v, 'isoformat'): row[k] = v.isoformat()
                elif isinstance(v, (int, float, bool, str, dict, list, type(None))): row[k] = v
                else: row[k] = str(v)
            rows.append(row)
        return {"columns": cols, "rows": rows, "count": len(rows)}
    except Exception as e:
        raise HTTPException(400, str(e))


# ── GROQ KEY POOL ────────────────────────────────────────────────────
# A dedicated, friendlier interface for managing the shared Groq key pool
# (see utils/groq_pool.py) — the same table (tiq_groq_key_pool) is also
# reachable through the generic File Manager, but a purpose-built list/
# add/remove UI beats hand-editing raw rows for something admins will do
# repeatedly. Admin-only: this is a platform-wide shared resource, same
# security tier as the existing global Groq/Ollama/Apify keys.

class GroqPoolKeyIn(BaseModel):
    key_value: str
    model: Optional[str] = None

class GroqPoolKeyOut(BaseModel):
    id: int
    key_preview: str   # never the real key — last 4 chars only, enough to tell entries apart
    model: Optional[str] = None
    is_active: bool
    consecutive_errors: int
    cooldown_until: Optional[str] = None
    last_used_at: Optional[str] = None
    added_at: Optional[str] = None


def _mask_key(key_value: str) -> str:
    if not key_value:
        return ""
    tail = key_value[-4:] if len(key_value) >= 4 else key_value
    return f"...{tail}"


class GroqModelsQuery(BaseModel):
    key_value: str


@router.post("/groq-pool/models")
async def list_groq_models_for_key(
    payload: GroqModelsQuery,
    _: User = Depends(require_admin),
):
    """Fetches the REAL, current list of models available to a Groq key,
    directly from Groq's own API (OpenAI-compatible /models endpoint) —
    rather than a hardcoded list in our own code, which is exactly the
    kind of thing that goes stale the moment Groq adds or retires a
    model (we hit this directly, twice, earlier this session). Also
    doubles as a quick validity check for a key before it's added to the
    pool — an invalid/revoked key will fail here with a clear reason
    instead of silently sitting in the pool until it's actually used."""
    import requests as _requests
    key_value = payload.key_value.strip()
    if not key_value:
        raise HTTPException(400, "API key value is required.")
    try:
        resp = _requests.get(
            "https://api.groq.com/openai/v1/models",
            headers={"Authorization": f"Bearer {key_value}"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        models = sorted(
            [m["id"] for m in data.get("data", []) if m.get("id")],
        )
        return {"models": models}
    except _requests.exceptions.HTTPError as e:
        status = e.response.status_code if e.response is not None else 0
        if status == 401:
            raise HTTPException(400, "This key was rejected by Groq — check it's correct and active.")
        raise HTTPException(400, f"Groq returned an error (status {status}) when listing models for this key.")
    except Exception as e:
        raise HTTPException(400, f"Could not reach Groq to list models: {type(e).__name__}")


@router.post("/groq-pool/{pool_id}/models")
async def list_groq_models_for_existing_key(
    pool_id: int,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Same as /groq-pool/models, but for an ALREADY-SAVED pool entry —
    uses the stored key value server-side to call Groq, and never sends
    that value back to the frontend at any point. This is what makes
    "just change the model, don't touch the key" actually convenient: the
    admin can fetch a live model dropdown for the existing key without
    ever having to re-enter or paste it, while the security property (the
    key value never reaches the browser) is fully preserved."""
    from models.models import GroqKeyPool
    import requests as _requests
    entry = await db.get(GroqKeyPool, pool_id)
    if not entry:
        raise HTTPException(404, "Pool key not found.")
    try:
        resp = _requests.get(
            "https://api.groq.com/openai/v1/models",
            headers={"Authorization": f"Bearer {entry.key_value}"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        models = sorted(
            [m["id"] for m in data.get("data", []) if m.get("id")],
        )
        return {"models": models}
    except _requests.exceptions.HTTPError as e:
        status = e.response.status_code if e.response is not None else 0
        if status == 401:
            raise HTTPException(400, "This stored key was rejected by Groq — it may have been revoked. Try replacing it.")
        raise HTTPException(400, f"Groq returned an error (status {status}) when listing models for this key.")
    except Exception as e:
        raise HTTPException(400, f"Could not reach Groq to list models: {type(e).__name__}")


@router.get("/groq-pool", response_model=List[GroqPoolKeyOut])
async def list_groq_pool(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    from models.models import GroqKeyPool
    result = await db.execute(select(GroqKeyPool).order_by(GroqKeyPool.added_at.desc()))
    entries = result.scalars().all()
    return [
        GroqPoolKeyOut(
            id=e.id, key_preview=_mask_key(e.key_value), model=e.model,
            is_active=e.is_active, consecutive_errors=e.consecutive_errors,
            cooldown_until=e.cooldown_until.isoformat() if e.cooldown_until else None,
            last_used_at=e.last_used_at.isoformat() if e.last_used_at else None,
            added_at=e.added_at.isoformat() if e.added_at else None,
        )
        for e in entries
    ]


@router.post("/groq-pool", response_model=GroqPoolKeyOut, status_code=201)
async def add_groq_pool_key(
    payload: GroqPoolKeyIn,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    from models.models import GroqKeyPool
    key_value = payload.key_value.strip()
    if not key_value:
        raise HTTPException(400, "API key value is required.")

    existing = (await db.execute(select(GroqKeyPool).where(GroqKeyPool.key_value == key_value))).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "This exact key is already in the pool.")

    entry = GroqKeyPool(key_value=key_value, model=(payload.model or "").strip() or None, is_active=True)
    db.add(entry)
    await db.flush()
    return GroqPoolKeyOut(
        id=entry.id, key_preview=_mask_key(entry.key_value), model=entry.model,
        is_active=entry.is_active, consecutive_errors=entry.consecutive_errors,
        cooldown_until=None, last_used_at=None,
        added_at=entry.added_at.isoformat() if entry.added_at else None,
    )


class GroqPoolKeyPatch(BaseModel):
    is_active: Optional[bool] = None
    model: Optional[str] = None
    key_value: Optional[str] = None  # replace the actual key — see update_groq_pool_key


@router.patch("/groq-pool/{pool_id}", response_model=GroqPoolKeyOut)
async def update_groq_pool_key(
    pool_id: int,
    payload: GroqPoolKeyPatch,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    from models.models import GroqKeyPool
    entry = await db.get(GroqKeyPool, pool_id)
    if not entry:
        raise HTTPException(404, "Pool key not found.")
    if payload.is_active is not None:
        entry.is_active = payload.is_active
    if payload.model is not None:
        entry.model = payload.model.strip() or None
    if payload.key_value is not None:
        new_value = payload.key_value.strip()
        if not new_value:
            raise HTTPException(400, "API key value cannot be blank.")
        # Same duplicate check as adding a new key — just excluding this
        # entry itself, since re-saving the SAME value it already has
        # isn't a duplicate.
        dup = (await db.execute(
            select(GroqKeyPool).where(GroqKeyPool.key_value == new_value, GroqKeyPool.id != pool_id)
        )).scalar_one_or_none()
        if dup:
            raise HTTPException(409, "This exact key is already in the pool under a different entry.")
        entry.key_value = new_value
        # A replaced key is unproven again — clear any error/cooldown
        # state from the OLD key's history so it gets a clean start,
        # same as the existing reactivation behavior below.
        entry.consecutive_errors = 0
        entry.cooldown_until = None
    # Reactivating a key clears any lingering cooldown/error streak — an
    # admin flipping it back on is a deliberate "trust this again" signal.
    if payload.is_active is True:
        entry.consecutive_errors = 0
        entry.cooldown_until = None
    await db.flush()
    return GroqPoolKeyOut(
        id=entry.id, key_preview=_mask_key(entry.key_value), model=entry.model,
        is_active=entry.is_active, consecutive_errors=entry.consecutive_errors,
        cooldown_until=entry.cooldown_until.isoformat() if entry.cooldown_until else None,
        last_used_at=entry.last_used_at.isoformat() if entry.last_used_at else None,
        added_at=entry.added_at.isoformat() if entry.added_at else None,
    )


@router.delete("/groq-pool/{pool_id}")
async def delete_groq_pool_key(
    pool_id: int,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    from models.models import GroqKeyPool
    entry = await db.get(GroqKeyPool, pool_id)
    if not entry:
        raise HTTPException(404, "Pool key not found.")
    await db.delete(entry)
    return {"message": "Deleted"}


# ══════════════════════════════════════════════════════════════════════════
# MODULES MANAGEMENT — Admin Console > Modules Management
#
# Which sidebar modules are switched on for this deployment. A missing
# row means enabled (see get_module_toggles) so a module newly added to
# capabilities.ts just works without needing a matching row inserted
# here first — only modules an admin has actually turned OFF need a row
# at all.
# ══════════════════════════════════════════════════════════════════════════

class ModuleToggleIn(BaseModel):
    module_route: str
    enabled: bool


@router.get("/module-toggles")
async def get_module_toggles(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    from models.models import ModuleToggle
    result = await db.execute(select(ModuleToggle))
    # Only disabled-or-explicitly-set rows need to exist at all — the
    # frontend treats any route absent from this map as enabled, so an
    # empty map here correctly means "everything's on".
    return {row.module_route: row.enabled for row in result.scalars().all()}


@router.put("/module-toggles")
async def set_module_toggles(
    payload: List[ModuleToggleIn],
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Bulk upsert — Modules Management saves the whole table's checkbox
    state in one request rather than one call per row toggled."""
    from models.models import ModuleToggle
    for item in payload:
        existing = (await db.execute(
            select(ModuleToggle).where(ModuleToggle.module_route == item.module_route)
        )).scalar_one_or_none()
        if existing:
            existing.enabled = item.enabled
        else:
            # Only bother storing a row for modules actually turned off —
            # saves writing a row for every enabled (i.e. default-state)
            # module on every save.
            if not item.enabled:
                db.add(ModuleToggle(module_route=item.module_route, enabled=False))
    await db.commit()
    result = await db.execute(select(ModuleToggle))
    return {row.module_route: row.enabled for row in result.scalars().all()}


# ══════════════════════════════════════════════════════════════════════════
# SYSTEM CREDENTIALS — Admin Console > API Keys
#
# Actually saving/listing/deleting the database + S3 credentials reuses
# the existing generic POST/GET/DELETE /api/auth/api-keys + /global-keys
# endpoints (service="database" / service="s3", is_global=true — both
# now permitted, see utils/credentials.SHAREABLE_SERVICES) rather than
# duplicating that logic here. What's admin-only and specific to this
# tab is the "Test Connection" step for each — validating a candidate
# credential BEFORE it's saved, without ever persisting or hot-swapping
# anything on a failed or exploratory test.
# ══════════════════════════════════════════════════════════════════════════

class DatabaseTestIn(BaseModel):
    connection_url: str


@router.get("/system/database/current")
async def current_database_info(_: User = Depends(require_admin)):
    """What this running process is actually connected to right now —
    read live from the active engine's URL, never from a stored key —
    so the panel can't show a stale or aspirational value."""
    return get_connection_display_info()


@router.post("/system/database/test")
async def test_database(payload: DatabaseTestIn, _: User = Depends(require_admin)):
    """Validates a candidate connection string only — see
    db.database.test_connection_url's docstring for why this
    deliberately does not hot-swap the live connection even on
    success."""
    if not payload.connection_url.strip():
        raise HTTPException(400, "Connection string is required.")
    return await test_connection_url(payload.connection_url)


# ── Provider-to-provider migration (e.g. Neon → Xata) ──────────────────
#
# Runs as a background asyncio task rather than inline in the request:
# copying real data can take anywhere from seconds to minutes depending
# on row counts, comfortably past any reasonable HTTP timeout. The POST
# below returns a job_id immediately; the GET polls status. Jobs live in
# a plain in-memory dict — this is an admin-triggered one-off operation,
# not something that needs to survive a process restart, and a restart
# mid-migration is already safe to recover from by just re-running it
# (see db/provider_migration.py's docstring: ON CONFLICT DO NOTHING
# throughout, so a re-run only fills in whatever didn't finish).
_MIGRATION_JOBS: Dict[str, dict] = {}
_MIGRATION_LOG_CAP = 200  # keep the in-memory job bounded on a very large migration


class MigrateDatabaseIn(BaseModel):
    source_url: str
    target_url: str


@router.post("/system/database/migrate")
async def start_database_migration(payload: MigrateDatabaseIn, _: User = Depends(require_admin)):
    """Kicks off a background copy of every tiq_* table (schema + data,
    FK-safe order) from source_url into target_url. Returns a job_id;
    poll GET .../migrate/{job_id} for live progress. COPY-ONLY — see
    db/provider_migration.py's docstring for why this never touches the
    source database, and why it's safe to re-run after a partial
    failure."""
    source_raw, target_raw = payload.source_url.strip(), payload.target_url.strip()
    if not source_raw or not target_raw:
        raise HTTPException(400, "Both a source and target connection string are required.")

    if any(j["status"] == "running" for j in _MIGRATION_JOBS.values()):
        raise HTTPException(409, "A migration is already running. Wait for it to finish (or check its status) before starting another.")

    from db.database import normalize_url
    source_url = normalize_url(source_raw)
    target_url = normalize_url(target_raw)
    if source_url == target_url:
        raise HTTPException(400, "Source and target are the same connection string.")

    job_id = uuid.uuid4().hex[:12]
    job = {
        "id": job_id,
        "status": "running",  # running | completed | failed
        "started_at": datetime.now(timezone.utc).isoformat(),
        "finished_at": None,
        # host/db/user only, via the same helper the "current connection"
        # display uses — the password/API key is never put in the job dict.
        "source": get_connection_display_info(source_url),
        "target": get_connection_display_info(target_url),
        "phase": "starting",
        "tables_total": None,
        "tables_done": 0,
        "current_table": None,
        "rows_copied": 0,
        "log": [],
        "error": None,
    }
    _MIGRATION_JOBS[job_id] = job

    def on_progress(update: dict):
        job.update({k: v for k, v in update.items() if k != "message"})
        if "message" in update:
            job["log"].append(update["message"])
            if len(job["log"]) > _MIGRATION_LOG_CAP:
                job["log"] = job["log"][-_MIGRATION_LOG_CAP:]

    async def _run():
        from db.provider_migration import run_provider_migration
        try:
            summary = await run_provider_migration(source_url, target_url, on_progress)
            job["status"] = "completed"
            job["log"].append(
                f"Done. {summary['rows_copied']} row(s) copied across {summary['tables_copied']} table(s). "
                f"Nothing was changed in the source database."
            )
        except Exception as e:
            job["status"] = "failed"
            job["error"] = f"{type(e).__name__}: {e}"
            job["log"].append(f"FAILED: {job['error']}")
        finally:
            job["finished_at"] = datetime.now(timezone.utc).isoformat()

    asyncio.create_task(_run())
    return {"job_id": job_id}


@router.get("/system/database/migrate/{job_id}")
async def get_migration_status(job_id: str, _: User = Depends(require_admin)):
    job = _MIGRATION_JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown migration job (in-memory only — lost on a process restart).")
    return job


class StorageQuotaIn(BaseModel):
    allocated_gb: float


@router.get("/system/database/storage-quota")
async def get_storage_quota(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Current allocated-storage quota (GB) that /storage's used_pct is
    calculated against, and whether it's an explicit DB-stored override
    or still falling back to the DB_ALLOCATED_GB env default — so the
    panel can say which one is actually in effect."""
    row = await _get_allocated_gb_override(db)
    if row:
        return {"allocated_gb": float(row.value), "source": "override"}
    return {"allocated_gb": DB_ALLOCATED_BYTES / 1024 ** 3, "source": "env_default"}


@router.put("/system/database/storage-quota")
async def set_storage_quota(
    payload: StorageQuotaIn,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Dedicated, validated setter for the allocated-storage quota —
    deliberately its own endpoint rather than routed through the
    generic /api/auth/api-keys upsert the database/S3 credentials use
    (that endpoint happily accepts any string as key_value). This
    value feeds directly into /storage's used_pct math, so it needs
    real numeric validation plus sane bounds — a stray extra zero or a
    pasted non-numeric value here would otherwise silently wreck the
    storage panel rather than being rejected up front."""
    from models.models import SystemSetting
    if payload.allocated_gb < MIN_ALLOCATED_GB or payload.allocated_gb > MAX_ALLOCATED_GB:
        raise HTTPException(
            400,
            f"Allocated storage must be between {MIN_ALLOCATED_GB} and {MAX_ALLOCATED_GB} GB.",
        )
    row = await _get_allocated_gb_override(db)
    if row:
        row.value = str(payload.allocated_gb)
    else:
        db.add(SystemSetting(setting_key=SETTING_KEY_ALLOCATED_GB, value=str(payload.allocated_gb)))
    await db.commit()
    return {"allocated_gb": payload.allocated_gb, "source": "override"}


class S3TestIn(BaseModel):
    access_key_id: str
    secret_access_key: str
    bucket_name: str
    region: Optional[str] = None
    endpoint_url: Optional[str] = None


@router.post("/system/s3/test")
async def test_s3(payload: S3TestIn, _: User = Depends(require_admin)):
    """Validates candidate bucket credentials without persisting them —
    runs a HEAD on the bucket so a typo'd key, wrong bucket name, or
    missing permission is caught before Save rather than after."""
    cfg = {
        "access_key_id": payload.access_key_id.strip(),
        "secret_access_key": payload.secret_access_key.strip(),
        "bucket_name": payload.bucket_name.strip(),
        "region": (payload.region or "auto").strip(),
        "endpoint_url": (payload.endpoint_url or "").strip(),
    }
    missing = [f for f in REQUIRED_S3_FIELDS if not cfg.get(f)]
    if missing:
        raise HTTPException(400, f"Missing required field(s): {', '.join(missing)}")
    return test_s3_config(cfg)


class StripeTestIn(BaseModel):
    secret_key: str


@router.post("/system/stripe/test")
async def test_stripe(payload: StripeTestIn, _: User = Depends(require_admin)):
    """Validates a candidate Stripe secret key without persisting it —
    Balance.retrieve() is a free, read-only call Stripe explicitly
    documents as safe for "is this key valid" checks, so a typo'd or
    revoked key is caught before Save rather than at the next real
    checkout attempt."""
    secret = payload.secret_key.strip()
    if not secret:
        raise HTTPException(400, "Secret key is required.")
    import stripe
    stripe.api_key = secret
    try:
        balance = stripe.Balance.retrieve()
        mode = "test" if secret.startswith("sk_test_") else "live" if secret.startswith("sk_live_") else "unknown"
        return {"ok": True, "message": f"Connected ({mode} mode) — key is valid."}
    except Exception as e:
        return {"ok": False, "message": f"Stripe rejected this key: {str(e)[:300]}"}


@router.get("/storage/blob-audit")
async def blob_audit(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Counts every row across every file-type column that still has
    actual bytes sitting in Postgres (the legacy *_blob columns) rather
    than being pushed to S3/R2. A non-zero count here means either: (a)
    S3 wasn't configured yet when that row was uploaded, or (b) it was
    uploaded while S3 was misconfigured and silently fell back. Use
    db/push_remaining_blobs_to_s3.py to migrate everything this reports
    to S3, once bucket credentials are confirmed working."""
    checks = [
        ("tiq_joblens_candidates", "video_blob", "video"),
        ("tiq_joblens_candidates", "resume_file_blob", "resume"),
        ("tiq_jd_records", "jd_file_blob", "jd"),
        ("tiq_requisitions", "jd_file_blob", "jd"),
        ("tiq_tracked_candidates", "resume_blob", "resume"),
        ("tiq_tracked_candidates", "cover_letter_blob", "cover_letter"),
    ]
    results = []
    total = 0
    for table, column, kind in checks:
        count = (await db.execute(text(f'SELECT COUNT(*) FROM "{table}" WHERE "{column}" IS NOT NULL'))).scalar_one()
        results.append({"table": table, "column": column, "kind": kind, "rows_with_blob": count})
        total += count
    return {"total_rows_with_blob": total, "breakdown": results}


# ══════════════════════════════════════════════════════════════════════════
# FORCE-DELETE (CASCADE) — TEST-DATA CLEANUP ONLY
# ══════════════════════════════════════════════════════════════════════════
# The normal DELETE endpoints on a Requisition/Candidate (see
# capabilities/requisition/router.py and capabilities/acquisition/router.py)
# deliberately BLOCK deletion once real hiring activity (interviews,
# pipeline entries, offers, placements — and downstream of those,
# invoices/timesheets, commercial/billing history) is attached. That's
# the correct default: those are audit/financial records that should
# never silently disappear.
#
# These two endpoints are the deliberate escape hatch for clearing out
# TEST data during setup — they delete a requisition or candidate AND
# every real row that references it, across every downstream capability
# (pipeline, interviews, offers, placements, invoices, timesheets,
# communication log, vendor submissions, avatar interview sessions),
# in dependency-safe order. This is genuinely destructive and NOT
# something to expose or use against real production hiring data —
# there is no undo.
#
# Both require the literal confirmation string in the request body,
# the same pattern as db/drop_accfino_tiq_tables.py, so a stray click
# or a copy-pasted request can't trigger it by accident.

class ForceDeleteIn(BaseModel):
    confirm: str


async def _cascade_delete_requisition_rows(db: AsyncSession, req_id: int) -> None:
    """The actual cascade SQL, shared by the single-id and batch
    endpoints below — no confirm check, no commit, just the deletes.
    Caller is responsible for commit()."""
    p = {"rid": req_id}
    await db.execute(text(
        "DELETE FROM tiq_client_feedback WHERE pipeline_entry_id IN "
        "(SELECT id FROM tiq_pipeline_entries WHERE requisition_id = :rid)"), p)
    await db.execute(text("DELETE FROM tiq_vendor_submissions WHERE requisition_id = :rid"), p)
    await db.execute(text(
        "DELETE FROM tiq_avatar_interview_questions WHERE session_id IN "
        "(SELECT id FROM tiq_avatar_interview_sessions WHERE requisition_id = :rid "
        "OR interview_id IN (SELECT id FROM tiq_interviews WHERE requisition_id = :rid))"), p)
    await db.execute(text(
        "DELETE FROM tiq_avatar_interview_sessions WHERE requisition_id = :rid "
        "OR interview_id IN (SELECT id FROM tiq_interviews WHERE requisition_id = :rid)"), p)
    await db.execute(text(
        "DELETE FROM tiq_interview_feedback_links WHERE interview_id IN "
        "(SELECT id FROM tiq_interviews WHERE requisition_id = :rid)"), p)
    await db.execute(text(
        "DELETE FROM tiq_interview_scorecards WHERE interview_id IN "
        "(SELECT id FROM tiq_interviews WHERE requisition_id = :rid)"), p)
    # These two were missing until now — both tables have a NOT NULL FK
    # to tiq_interviews with no ON DELETE CASCADE, so leaving either one
    # unhandled makes the DELETE FROM tiq_interviews below raise a
    # foreign-key violation that aborts this entire transaction — NOT
    # just that one delete. Since everything in this function runs in
    # one transaction with a single commit() by the caller, that
    # failure silently rolled back every other delete already queued
    # here too, which is why force-delete could appear to do nothing at
    # all rather than fail loudly on the actual offending table.
    await db.execute(text(
        "DELETE FROM tiq_interview_decision_approvers WHERE interview_id IN "
        "(SELECT id FROM tiq_interviews WHERE requisition_id = :rid)"), p)
    await db.execute(text(
        "DELETE FROM tiq_interviewer_payments WHERE interview_id IN "
        "(SELECT id FROM tiq_interviews WHERE requisition_id = :rid)"), p)
    await db.execute(text("DELETE FROM tiq_interviews WHERE requisition_id = :rid"), p)
    await db.execute(text(
        "DELETE FROM tiq_timesheet_entries WHERE placement_id IN "
        "(SELECT id FROM tiq_placements WHERE requisition_id = :rid)"), p)
    await db.execute(text(
        "DELETE FROM tiq_invoices WHERE requisition_id = :rid OR placement_id IN "
        "(SELECT id FROM tiq_placements WHERE requisition_id = :rid)"), p)
    await db.execute(text(
        "UPDATE tiq_placements SET replaces_placement_id = NULL WHERE replaces_placement_id IN "
        "(SELECT id FROM tiq_placements WHERE requisition_id = :rid)"), p)
    await db.execute(text("DELETE FROM tiq_placements WHERE requisition_id = :rid"), p)
    await db.execute(text("DELETE FROM tiq_offers WHERE requisition_id = :rid"), p)
    await db.execute(text(
        "DELETE FROM tiq_pipeline_stage_history WHERE pipeline_entry_id IN "
        "(SELECT id FROM tiq_pipeline_entries WHERE requisition_id = :rid)"), p)
    await db.execute(text("DELETE FROM tiq_pipeline_entries WHERE requisition_id = :rid"), p)
    await db.execute(text("DELETE FROM tiq_communication_log WHERE requisition_id = :rid"), p)
    await db.execute(text("DELETE FROM tiq_vendor_requisition_assignments WHERE requisition_id = :rid"), p)
    await db.execute(text("DELETE FROM tiq_pipeline_stages WHERE requisition_id = :rid"), p)
    await db.execute(text("DELETE FROM tiq_applications WHERE requisition_id = :rid"), p)
    await db.execute(text("DELETE FROM tiq_requisitions WHERE id = :rid"), p)


async def _cascade_delete_candidate_rows(db: AsyncSession, candidate_id: int) -> None:
    """The actual cascade SQL, shared by the single-id and batch
    endpoints below — no confirm check, no commit, just the deletes.
    Caller is responsible for commit()."""
    p = {"cid": candidate_id}
    await db.execute(text(
        "DELETE FROM tiq_client_feedback WHERE pipeline_entry_id IN "
        "(SELECT id FROM tiq_pipeline_entries WHERE candidate_id = :cid)"), p)
    await db.execute(text("DELETE FROM tiq_vendor_submissions WHERE candidate_id = :cid"), p)
    await db.execute(text(
        "DELETE FROM tiq_avatar_interview_questions WHERE session_id IN "
        "(SELECT id FROM tiq_avatar_interview_sessions WHERE candidate_id = :cid "
        "OR interview_id IN (SELECT id FROM tiq_interviews WHERE candidate_id = :cid))"), p)
    await db.execute(text(
        "DELETE FROM tiq_avatar_interview_sessions WHERE candidate_id = :cid "
        "OR interview_id IN (SELECT id FROM tiq_interviews WHERE candidate_id = :cid)"), p)
    await db.execute(text(
        "DELETE FROM tiq_interview_feedback_links WHERE interview_id IN "
        "(SELECT id FROM tiq_interviews WHERE candidate_id = :cid)"), p)
    await db.execute(text(
        "DELETE FROM tiq_interview_scorecards WHERE interview_id IN "
        "(SELECT id FROM tiq_interviews WHERE candidate_id = :cid)"), p)
    # Same missing pair as _cascade_delete_requisition_rows above — see
    # that function's comment for why skipping either one silently
    # rolls back this whole cascade instead of just failing on it.
    await db.execute(text(
        "DELETE FROM tiq_interview_decision_approvers WHERE interview_id IN "
        "(SELECT id FROM tiq_interviews WHERE candidate_id = :cid)"), p)
    await db.execute(text(
        "DELETE FROM tiq_interviewer_payments WHERE interview_id IN "
        "(SELECT id FROM tiq_interviews WHERE candidate_id = :cid)"), p)
    await db.execute(text("DELETE FROM tiq_interviews WHERE candidate_id = :cid"), p)
    await db.execute(text(
        "DELETE FROM tiq_timesheet_entries WHERE placement_id IN "
        "(SELECT id FROM tiq_placements WHERE candidate_id = :cid)"), p)
    await db.execute(text(
        "DELETE FROM tiq_invoices WHERE placement_id IN "
        "(SELECT id FROM tiq_placements WHERE candidate_id = :cid)"), p)
    await db.execute(text(
        "UPDATE tiq_placements SET replaces_placement_id = NULL WHERE replaces_placement_id IN "
        "(SELECT id FROM tiq_placements WHERE candidate_id = :cid)"), p)
    await db.execute(text("DELETE FROM tiq_placements WHERE candidate_id = :cid"), p)
    await db.execute(text("DELETE FROM tiq_offers WHERE candidate_id = :cid"), p)
    await db.execute(text(
        "DELETE FROM tiq_pipeline_stage_history WHERE pipeline_entry_id IN "
        "(SELECT id FROM tiq_pipeline_entries WHERE candidate_id = :cid)"), p)
    await db.execute(text("DELETE FROM tiq_pipeline_entries WHERE candidate_id = :cid"), p)
    await db.execute(text("DELETE FROM tiq_communication_log WHERE candidate_id = :cid"), p)
    await db.execute(text("DELETE FROM tiq_applications WHERE candidate_id = :cid"), p)
    await db.execute(text(
        "DELETE FROM tiq_candidate_merge_log WHERE primary_candidate_id = :cid OR merged_candidate_id = :cid"), p)
    await db.execute(text("UPDATE tiq_candidates SET merged_into_id = NULL WHERE merged_into_id = :cid"), p)
    await db.execute(text("DELETE FROM tiq_candidate_pool_members WHERE candidate_id = :cid"), p)
    await db.execute(text("DELETE FROM tiq_candidates WHERE id = :cid"), p)


@router.delete("/requisitions/{req_id}/force-delete")
async def force_delete_requisition(
    req_id: int,
    payload: ForceDeleteIn,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Deletes a requisition and every real row referencing it — pipeline
    entries, interviews, offers, placements, invoices, timesheets,
    communication log, vendor submissions/assignments, avatar interview
    sessions, and applications. Does NOT delete candidates themselves
    (they may be linked to other requisitions too) — only the
    requisition-scoped rows above and their downstream children."""
    if payload.confirm != f"delete requisition {req_id}":
        raise HTTPException(
            400,
            f'Confirmation text must be exactly: delete requisition {req_id}',
        )

    exists = (await db.execute(text("SELECT 1 FROM tiq_requisitions WHERE id = :rid"), {"rid": req_id})).scalar_one_or_none()
    if not exists:
        raise HTTPException(404, "Requisition not found")

    await _cascade_delete_requisition_rows(db, req_id)
    await db.commit()
    return {"deleted": True, "requisition_id": req_id}


@router.delete("/candidates/{candidate_id}/force-delete")
async def force_delete_candidate(
    candidate_id: int,
    payload: ForceDeleteIn,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Deletes a candidate and every real row referencing it — pipeline
    entries, interviews, offers, placements, invoices, timesheets,
    communication log, vendor submissions, avatar interview sessions,
    applications, merge-log history, and pool memberships. Does NOT
    touch the requisitions this candidate applied to."""
    if payload.confirm != f"delete candidate {candidate_id}":
        raise HTTPException(
            400,
            f'Confirmation text must be exactly: delete candidate {candidate_id}',
        )

    exists = (await db.execute(text("SELECT 1 FROM tiq_candidates WHERE id = :cid"), {"cid": candidate_id})).scalar_one_or_none()
    if not exists:
        raise HTTPException(404, "Candidate not found")

    await _cascade_delete_candidate_rows(db, candidate_id)
    await db.commit()
    return {"deleted": True, "candidate_id": candidate_id}


# ── Batch versions — used by the File Manager tab's multi-select "Force
# Delete (cascade)" button. A single fixed confirm phrase covers the
# whole selection (the UI itself shows a native confirm() dialog before
# ever calling this), rather than requiring the exact id-per-row phrase
# the single-record endpoints above need — that phrasing only makes
# sense for a human typing one id at a time via /api/docs.

async def _generic_cascade_delete(db: AsyncSession, table: str, ids: List[int], _path: Optional[set] = None) -> None:
    """FK-aware cascade delete for the File Manager's raw table browser
    (delete_row/bulk_delete_rows below) — those two do a plain, uncascaded
    DELETE and simply fail with a FOREIGN KEY VIOLATION the moment any
    other table still references the row (e.g. deleting a tiq_applications
    row while a tiq_pipeline_entries row still points at it via
    application_id). This is the generic version of the hand-written
    cascades above (_cascade_delete_requisition_rows/_cascade_delete_candidate_rows) —
    those two hardcode a known set of child tables because they're on a
    tight, well-understood blast radius; this one instead DISCOVERS real
    foreign-key children at runtime via Postgres's information_schema, so
    it works for any tiq_* table the browser can reach, not just the two
    that got a dedicated hand-written cascade.

    Self-referencing / cyclical FKs (e.g. tiq_placements.replaces_placement_id,
    tiq_candidates.merged_into_id, or a genuine A->B->A cycle) are detected
    via _path (the set of tables already being processed in THIS recursion
    branch) and NULLed out rather than recursed into — recursing would
    either loop forever or try to delete rows this same call is already
    deleting. _path is passed by value (a new set unioned each call, never
    mutated in place) so sibling branches that legitimately reach the same
    child table from different parents each still process their own ids
    correctly, rather than one branch's visit silently skipping the other's.

    Only ever called from an explicit, confirm-phrase-gated force-delete
    endpoint (see force_delete_table_rows below) — never from the plain
    delete_row/bulk_delete_rows path, so ordinary single-row deletes keep
    failing loudly on a real FK conflict instead of silently cascading.
    """
    ids = list(ids)
    if not ids:
        return
    path = (_path or set()) | {table}

    children = (await db.execute(text(
        """
        SELECT tc.table_name AS child_table, kcu.column_name AS child_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = :table AND tc.table_schema = 'public'
        """
    ), {"table": table})).all()

    for child_table, child_column in children:
        if child_table in path:
            await db.execute(
                text(f'UPDATE "{child_table}" SET "{child_column}" = NULL WHERE "{child_column}" = ANY(:ids)'),
                {"ids": ids},
            )
            continue
        child_ids = (await db.execute(
            text(f'SELECT id FROM "{child_table}" WHERE "{child_column}" = ANY(:ids)'), {"ids": ids}
        )).scalars().all()
        if child_ids:
            await _generic_cascade_delete(db, child_table, list(child_ids), path)
            await db.execute(
                text(f'DELETE FROM "{child_table}" WHERE "{child_column}" = ANY(:ids)'), {"ids": ids}
            )

    await db.execute(text(f'DELETE FROM "{table}" WHERE id = ANY(:ids)'), {"ids": ids})


class ForceDeleteBatchIn(BaseModel):
    ids: List[int]
    confirm: str


@router.post("/requisitions/force-delete-batch")
async def force_delete_requisitions_batch(
    payload: ForceDeleteBatchIn,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if payload.confirm != "force delete requisitions":
        raise HTTPException(400, 'Confirmation text must be exactly: force delete requisitions')
    if not payload.ids:
        raise HTTPException(400, "No requisition ids provided")

    deleted, missing = [], []
    for req_id in payload.ids:
        exists = (await db.execute(text("SELECT 1 FROM tiq_requisitions WHERE id = :rid"), {"rid": req_id})).scalar_one_or_none()
        if not exists:
            missing.append(req_id)
            continue
        await _cascade_delete_requisition_rows(db, req_id)
        deleted.append(req_id)
    await db.commit()
    return {"deleted_ids": deleted, "missing_ids": missing}


@router.post("/candidates/force-delete-batch")
async def force_delete_candidates_batch(
    payload: ForceDeleteBatchIn,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if payload.confirm != "force delete candidates":
        raise HTTPException(400, 'Confirmation text must be exactly: force delete candidates')
    if not payload.ids:
        raise HTTPException(400, "No candidate ids provided")

    deleted, missing = [], []
    for candidate_id in payload.ids:
        exists = (await db.execute(text("SELECT 1 FROM tiq_candidates WHERE id = :cid"), {"cid": candidate_id})).scalar_one_or_none()
        if not exists:
            missing.append(candidate_id)
            continue
        await _cascade_delete_candidate_rows(db, candidate_id)
        deleted.append(candidate_id)
    await db.commit()
    return {"deleted_ids": deleted, "missing_ids": missing}


@router.post("/tables/{table}/force-delete-batch")
async def force_delete_table_rows(
    table: str,
    payload: ForceDeleteBatchIn,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """The File Manager's generic 'Force delete (cascade)' action for any
    tiq_* table OTHER than requisitions/candidates (those two keep their
    dedicated, hand-written cascades above — narrower and easier to
    reason about for the two highest-traffic cleanup targets). Everything
    else — tiq_applications, tiq_interviews, tiq_pipeline_entries, etc. —
    goes through _generic_cascade_delete's runtime FK discovery instead.

    Same confirm-phrase gate as the dedicated endpoints, just keyed to
    the table name so it can't be fired by a generic/scripted request
    without a human having typed the exact table they mean to wipe.
    """
    if not table.startswith("tiq_"):
        raise HTTPException(403, "Only tiq_* tables are accessible")
    if table in ("tiq_requisitions", "tiq_candidates"):
        raise HTTPException(400, f"Use the dedicated /{table.replace('tiq_', '')}/force-delete-batch endpoint for this table.")
    if payload.confirm != f"force delete {table}":
        raise HTTPException(400, f"Confirmation text must be exactly: force delete {table}")
    if not payload.ids:
        raise HTTPException(400, "No row ids provided")

    ids = payload.ids
    if table == "tiq_users":
        protected_ids = set((await db.execute(
            text("SELECT id FROM tiq_users WHERE id = ANY(:ids) AND is_protected = TRUE"), {"ids": ids}
        )).scalars().all())
        ids = [i for i in ids if i not in protected_ids]
        if not ids:
            raise HTTPException(403, "All selected accounts are protected and cannot be deleted.")

    existing = set((await db.execute(
        text(f'SELECT id FROM "{table}" WHERE id = ANY(:ids)'), {"ids": ids}
    )).scalars().all())
    missing = [i for i in ids if i not in existing]
    deleted = [i for i in ids if i in existing]
    if deleted:
        await _generic_cascade_delete(db, table, deleted)
        await db.commit()
    return {"deleted_ids": deleted, "missing_ids": missing}
