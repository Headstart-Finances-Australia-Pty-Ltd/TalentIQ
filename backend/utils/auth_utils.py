"""
TalentIQ – Auth Utilities: JWT tokens + bcrypt password hashing
"""

import os
import uuid
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from db.database import get_db, ENV_PATH
from models.models import User

# SECRET_KEY is DATABASE-backed, not .env-backed — unlike DATABASE_URL,
# this one doesn't have a bootstrapping problem (the app already has a
# working DB connection by the time anything needs to sign/verify a
# token), so it belongs in the database like every other credential.
#
# An explicit SECRET_KEY environment variable, if set, still wins — a
# production deployment that prefers classic env-var config (Docker
# secrets, Northflank env vars, etc.) can keep doing that. But if it's
# NOT set, this is no longer an error: bootstrap_secret_key() below
# reads (or, on the very first run ever, generates and stores) a
# random key from the tiq_system_config table, called once during
# main.py's startup lifespan, after migrations have created that
# table. Nothing needs to be typed into any .env file, ever, for this
# one — a fresh zip extraction into a brand-new folder just works,
# reading the same key back out of the same database.
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


async def bootstrap_secret_key(db: AsyncSession) -> None:
    """Call once during app startup, after migrations run (so
    tiq_system_config exists). No-op if SECRET_KEY was already supplied
    via a real environment variable. Safe under concurrent startup
    (multiple workers booting at once) — ON CONFLICT DO NOTHING means
    only one writer's generated key actually gets stored, and every
    worker re-reads afterward so they all end up using that same
    winning value rather than each trusting its own generated one."""
    global SECRET_KEY
    if SECRET_KEY:
        return
    from sqlalchemy import text
    import secrets as _secrets

    row = (await db.execute(
        text("SELECT config_value FROM tiq_system_config WHERE config_key = 'secret_key'")
    )).scalar_one_or_none()
    if not row:
        await db.execute(text(
            "INSERT INTO tiq_system_config (config_key, config_value) VALUES ('secret_key', :v) "
            "ON CONFLICT (config_key) DO NOTHING"
        ), {"v": _secrets.token_hex(32)})
        await db.commit()
        row = (await db.execute(
            text("SELECT config_value FROM tiq_system_config WHERE config_key = 'secret_key'")
        )).scalar_one()
    SECRET_KEY = row


def _require_secret_key() -> str:
    """Every real usage site below calls this instead of reading the
    module global directly, so a genuinely missing bootstrap (e.g. a
    standalone script that imports this module without ever calling
    main.py's lifespan) fails with a clear, actionable message instead
    of a confusing jose/JWT error several layers down."""
    if not SECRET_KEY:
        raise RuntimeError(
            "SECRET_KEY has not been bootstrapped yet. This is normally set "
            "automatically during app startup (main.py's lifespan calls "
            "bootstrap_secret_key()) — if you're seeing this from a standalone "
            "script, call `await bootstrap_secret_key(db)` yourself first, or "
            "set a SECRET_KEY environment variable as an explicit override."
        )
    return SECRET_KEY


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, _require_secret_key(), algorithm=ALGORITHM)


def generate_reset_token() -> str:
    return str(uuid.uuid4())


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, _require_secret_key(), algorithms=[ALGORITHM])
        user_id: int = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise credentials_exception
    return user


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


# Note: an unused verify_token() helper previously lived here with its
# own separate hardcoded fallback secret ("talentiq-secret-key" — a
# *different* string from the one above, so it would have silently
# rejected every token if it were ever actually called with no
# SECRET_KEY set). It had no call sites anywhere in the codebase, so
# it's removed rather than fixed. Use get_current_user's Depends-based
# flow, or jose.jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
# directly with the module-level SECRET_KEY/ALGORITHM above, instead.
