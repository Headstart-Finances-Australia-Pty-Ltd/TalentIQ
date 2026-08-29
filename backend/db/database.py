"""
TalentIQ - Database connection.

Provider: Xata Postgres (migrated from Neon — see MIGRATING_TO_XATA.md
at the repo root for the cutover notes, including the pgvector caveat
below). Nothing in this module is Xata-specific: it's a standard
asyncpg connection to whatever DATABASE_URL points at, over the plain
Postgres wire protocol, so any Postgres-compatible provider works.

DATABASE_URL is sourced from the DATABASE_URL environment variable.
There is NO hardcoded fallback — a real credential used to live here
as a "dev convenience" default, which meant it shipped inside every
zip/export of this codebase. That's a leaked credential the moment the
file leaves your machine, so the app now refuses to start at all if
DATABASE_URL isn't set, rather than silently falling back to some
connection string baked into the source.

Set DATABASE_URL in your hosting platform (Northflank, etc.) and in
your local .env for dev. A Xata connection string has the form
postgresql://<workspace-id>:<api-key>@<region>.sql.xata.sh:5432/<db>:<branch>
— note the api-key IS the password field here, so if it was ever
exposed in a shared zip, rotate it from the Xata dashboard (Account
Settings > API Keys) — changing the env var alone does not invalidate
the old key.

See Admin Console > API Keys for a UI to test a candidate connection
string and record which one is "current" — that panel intentionally
does NOT hot-swap this live engine (see test_connection_url's
docstring for why), so changing DATABASE_URL still requires updating
the environment variable and redeploying.
"""
import os, re
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

# python-dotenv was already a declared dependency (requirements.txt) but
# nothing in the codebase ever actually called load_dotenv() — so
# backend/.env was silently ignored by every entrypoint (main.py, the
# db/*.py one-off scripts), and local dev only worked because app.cmd
# separately did `set "DATABASE_URL=..."` by hand before launching
# uvicorn. Loading it here, at the top of the module every entrypoint
# imports first, fixes that for good: main.py, seed_admin.py,
# migrate_fix.py, etc. all get backend/.env populated automatically,
# regardless of which one started the process. Real environment
# variables (as set by Docker/Northflank in production) still win —
# override=False (the default) never replaces a variable that's
# already set.
ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(ENV_PATH)


def normalize_url(raw: str) -> str:
    """Shared normalization for any Postgres URL this app will connect
    to — the async driver rewrite + sslmode stripping (asyncpg takes ssl
    via connect_args, not a query param) was previously inlined once for
    the module-level DATABASE_URL; factored out here so the same rules
    apply to a candidate URL a user pastes into Admin Console > API Keys
    before it's ever tested or saved."""
    url = raw.strip()
    if url.startswith("postgresql+psycopg2://"):
        url = url.replace("postgresql+psycopg2://", "postgresql+asyncpg://", 1)
    elif url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif url.startswith("postgresql://") and "+asyncpg" not in url:
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return re.sub(r'[?&]sslmode=\S+', '', url).rstrip('?').strip()


_raw_database_url = os.getenv("DATABASE_URL")
if not _raw_database_url:
    raise RuntimeError(
        f"\n\n"
        f"  DATABASE_URL is not set.\n"
        f"  Expected .env file at:\n"
        f"      {ENV_PATH}\n"
        f"  {'This file does not exist.' if not ENV_PATH.exists() else 'This file exists but has no DATABASE_URL line in it.'}\n\n"
        f"  If that path looks wrong (e.g. a different/nested copy of the project\n"
        f"  than the one you expect), you're most likely running a DIFFERENT\n"
        f"  extraction of this codebase than the one with your existing .env —\n"
        f"  check for a duplicate/nested project folder before editing anything.\n\n"
        f"  Otherwise: create/edit that exact file and add a line:\n"
        f"      DATABASE_URL=postgresql+asyncpg://user:pass@host/dbname\n\n"
        f"  There is no built-in fallback by design (a previous version of this\n"
        f"  file had a real credential hardcoded here, which leaked into\n"
        f"  every zip export of this codebase — that fallback has been removed).\n"
        f"  In production (Docker/Northflank/etc.), set DATABASE_URL as a real\n"
        f"  platform environment variable instead of a .env file.\n"
    )
DATABASE_URL = normalize_url(_raw_database_url)

engine = create_async_engine(
    DATABASE_URL, echo=False, future=True,
    # Widened from pool_size=2/max_overflow=3 (5 total) — too small given
    # this session's concurrent access patterns (per-candidate and
    # per-chunk Groq key pool resolution, concurrent candidate scoring in
    # CandidateLens), which could genuinely queue behind only 5 available
    # connections even though the actual work is meant to run in parallel.
    # 10+20=30 was sized against Neon's smallest compute tier
    # (~97 usable connections on 0.25 CU) — that headroom estimate does
    # NOT carry over automatically to Xata's connection limits, which
    # depend on your Xata plan/cluster type. If you see connection-limit
    # errors under load post-cutover, check Xata's current docs for your
    # plan's connection ceiling and resize this pool accordingly.
    pool_size=10, max_overflow=20, pool_timeout=60,
    pool_recycle=300, pool_pre_ping=True,
    connect_args={"ssl": "require"},
)

AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession,
    expire_on_commit=False, autoflush=False, autocommit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# ── Admin Console > API Keys — "Database" panel support ────────────────

def get_connection_display_info(url: str = None) -> dict:
    """Host/database/user for display — NEVER the password. Defaults to
    the URL this process actually booted with, so the panel can show
    "you are currently connected to: ..." and an admin can visually
    confirm which database/branch is live (e.g. which Xata workspace
    and Database:Branch), without ever exposing the password/API key
    back to the browser."""
    target = normalize_url(url) if url else DATABASE_URL
    parts = urlsplit(target)
    return {
        "host": parts.hostname,
        "port": parts.port,
        "database": (parts.path or "").lstrip("/") or None,
        "user": parts.username,
        "scheme": parts.scheme,
    }


async def test_connection_url(raw_url: str) -> dict:
    """Validates a CANDIDATE connection string by opening a throwaway
    engine, running a trivial query, and disposing it immediately —
    never touches the live `engine`/`AsyncSessionLocal` this process is
    actually using to serve requests.

    Deliberately does NOT hot-swap the running app onto this URL, even
    on success: `engine`/`AsyncSessionLocal` are imported by value
    (`from db.database import AsyncSessionLocal`) in several routers
    (joblens, jobintel, linklens, avatarinterview, interview/portal
    public routers), so rebinding these two module-level names here
    would only redirect requests going through the get_db() dependency
    — those direct-import call sites would keep silently using the OLD
    connection until the process restarts anyway. A partial swap like
    that is worse than no swap: some requests would write to one
    database and some to the other with no visible indication why.
    Changing the live connection safely means updating the
    DATABASE_URL environment variable and redeploying, which restarts
    every one of those imports consistently at once."""
    url = normalize_url(raw_url)
    test_engine = create_async_engine(
        url, echo=False, future=True,
        pool_size=1, max_overflow=0, pool_timeout=10,
        connect_args={"ssl": "require"},
    )
    try:
        async with test_engine.connect() as conn:
            from sqlalchemy import text
            result = await conn.execute(text("SELECT version(), current_database()"))
            version, dbname = result.first()
        info = get_connection_display_info(url)
        return {
            "ok": True,
            "message": f"Connected to \"{dbname}\" on {info['host']}.",
            "server_version": version,
            **info,
        }
    except Exception as e:
        return {"ok": False, "message": f"Connection failed: {type(e).__name__}: {e}"}
    finally:
        await test_engine.dispose()
