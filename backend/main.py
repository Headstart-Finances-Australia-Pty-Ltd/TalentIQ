"""
TalentIQ Platform - FastAPI Backend
Serves React frontend from /static in production (Docker/Northflank).
"""
import sys
import os
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
from sqlalchemy import text

print(f"\n  TalentIQ Backend | Python {sys.version.split()[0]}")

from db.database import engine, Base, AsyncSessionLocal
from routers import auth, jobhunt, jobintel, linklens, dashboard
from routers import admin as admin_router
from routers import cvintel as cvintel_router
from routers import joblens as joblens_router
from routers import jdcreator as jdcreator_router
from routers import candidatetrack as candidatetrack_router
from capabilities.acquisition import router as acquisition_router
from capabilities.acquisition import public_router as acquisition_public_router
from capabilities.requisition import router as requisition_router
from capabilities.requisition import public_router as requisition_public_router
from capabilities.interview import router as interview_router
from capabilities.interview import public_router as interview_public_router
from capabilities.pipeline import router as pipeline_router
from capabilities.portal import router as portal_router
from capabilities.portal import public_router as portal_public_router
from capabilities.communication import router as communication_router
from capabilities.commercial import router as commercial_router
from capabilities.governance import router as governance_router
from capabilities.avatarinterview import router as avatarinterview_router
from capabilities.avatarinterview.router import public_router as avatarinterview_public_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("  Running DB migrations...")
    try:
        from db.migrate_fix import run as run_migrations
        await run_migrations()
    except Exception as e:
        print(f"  [!] Migration warning: {e}")

    print("  Creating TalentIQ tables (tiq_*) in neondb...")
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        print("  [OK] Tables ready.")

        # Backfill tiq_jd_vendor_links from existing candidate submissions —
        # this junction table didn't exist for earlier rows, and new rows
        # already maintain it directly (see routers/candidatetrack.py). Safe
        # to re-run every startup: ON CONFLICT DO NOTHING makes it a no-op
        # once fully backfilled.
        async with engine.begin() as conn:
            await conn.execute(text("""
                INSERT INTO tiq_jd_vendor_links (jd_id, vendor_id, first_linked_at)
                SELECT DISTINCT jd_id, vendor_id, now() FROM tiq_tracked_candidates
                ON CONFLICT (jd_id, vendor_id) DO NOTHING
            """))
        print("  [OK] JD-Vendor relationship table backfilled.")

        from db.seed_admin import seed
        await seed()

        from db.seed_skill_taxonomy import seed as seed_taxonomy
        await seed_taxonomy()
    except Exception as e:
        print(f"  [!] DB error: {e}\n")
    yield


app = FastAPI(
    title="TalentIQ API",
    version="1.0.0",
    lifespan=lifespan,
    # Hide docs in production
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API Routes ───────────────────────────────────────────────────────
app.include_router(auth.router,           prefix="/api/auth",      tags=["Auth"])
app.include_router(jobhunt.router,        prefix="/api/jobhunt",   tags=["JobHunt"])
app.include_router(jobintel.router,       prefix="/api/jobintel",  tags=["JobIntel"])
app.include_router(linklens.router,       prefix="/api/linklens",  tags=["LinkLens"])
app.include_router(dashboard.router,      prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(admin_router.router,   prefix="/api/admin",     tags=["Admin"])
app.include_router(cvintel_router.router, prefix="/api/cvintel",   tags=["CVIntel"])
app.include_router(joblens_router.router, prefix="/api/joblens",   tags=["JobLens"])
app.include_router(jdcreator_router.router, prefix="/api/jdcreator", tags=["JDCreator"])
app.include_router(candidatetrack_router.router, prefix="/api/candidatetrack", tags=["CandidateTracker"])

# ── Capability: Candidate Acquisition & Talent Pool (Phase 0 + Phase 1) ──
# Self-contained module — see backend/capabilities/acquisition/models.py
# for the architecture rationale. Additive only: no existing router/model
# above this line is modified.
app.include_router(acquisition_router.router, prefix="/api/acquisition", tags=["Acquisition"])
app.include_router(acquisition_public_router.router, prefix="/api/public/acquisition", tags=["Acquisition (Public)"])

# ── Capability: Job Requisitions (Phase 2) ──────────────────────────────
# Requisition's Python class moved here from capabilities/acquisition —
# same table (tiq_requisitions), Application's FK is unaffected. Importing
# both modules here (order doesn't matter) lets SQLAlchemy resolve the
# "Requisition"/"Application" string-based relationship on either side.
app.include_router(requisition_router.router, prefix="/api/requisitions", tags=["Requisitions"])
app.include_router(requisition_public_router.router, prefix="/api/public/requisitions", tags=["Requisitions (Public)"])

# ── Capability: Interview Management (Phase 4) ──────────────────────────
# From "let's interview them" to a recorded decision — human interviews
# (complementing the AI video interviews already in CandidateLens),
# structured interviewer scorecards, and token-based self-scheduling
# links (same pattern as the candidate portal/hiring-manager view link —
# no calendar OAuth integration). Additive only: links to Candidate
# (acquisition) and Requisition by FK, nothing existing is modified.
app.include_router(interview_router.router, prefix="/api/interviews", tags=["Interview Management"])
app.include_router(interview_public_router.router, prefix="/api/public/interviews", tags=["Interview Management (Public)"])

# ── Capability: Pipeline & Placements (Phase 5) ─────────────────────────
# Candidate moves to hired without leaving the system — Kanban pipeline
# (stages configurable per requisition, falling back to an org-wide
# default), offer approval, and placement/guarantee-period tracking.
# Wraps the existing Application row rather than modifying it (see
# capabilities/pipeline/models.py docstring) — additive only.
app.include_router(pipeline_router.router, prefix="/api/pipeline", tags=["Pipeline & Placements"])

# ── Capability: Client & Vendor Collaboration (Phase 6) ─────────────────
# Token-based client and vendor portals (same pattern as every other
# public link in this app — no separate login system for clients/vendors).
# Additive only: links to Client/Vendor/Requisition/Candidate/
# PipelineEntry by FK, nothing existing is modified.
app.include_router(portal_router.router, prefix="/api/portal", tags=["Client & Vendor Collaboration"])
app.include_router(portal_public_router.router, prefix="/api/public/portal", tags=["Client & Vendor Collaboration (Public)"])

# ── Capability: Communication & Automation (Phase 7) ────────────────────
# Every meaningful action logged automatically, in one place — templated
# email (reusing the SMTP infra already proven in routers/joblens.py, not
# a stub), a unified timeline, automation rules wired into ACTUAL trigger
# points in Interview Management and Pipeline & Placements, and a
# cross-capability "daily workbench" view. Additive only.
app.include_router(communication_router.router, prefix="/api/communication", tags=["Communication & Automation"])

# ── Capability: Commercials (Phase 8) ────────────────────────────────────
# The money side of a placement, tracked inside the platform — single-line
# invoicing against a Placement (Phase 5), guarantee/rebate deadline
# visibility (reuses Placement.guarantee_end_date, doesn't duplicate it),
# optional contractor timesheets, and a revenue report. Additive only.
app.include_router(commercial_router.router, prefix="/api/commercials", tags=["Commercials"])

# ── Capability: Governance (Phase 9) ─────────────────────────────────────
# Leadership sees the business; permissions match real roles. Reporting
# metrics (time-to-fill, funnel, source-of-hire, recruiter/vendor
# performance) computed from data every other capability already owns —
# nothing duplicated. Access control is a real team/role feature
# (OrganisationMembership), not a UI-only label — see
# capabilities/governance/models.py's docstring for the honest, stated
# boundary on where role enforcement does and doesn't reach yet.
app.include_router(governance_router.router, prefix="/api/governance", tags=["Governance"])

# ── AI Avatar Interviews (extends Interview Management, Phase 4, and
# CandidateLens, Phase 3) ────────────────────────────────────────────────
# Setup happens from Interview Management; the avatar-delivered Q&A and
# its evaluation feed back into CandidateLens's final-screening view
# alongside the existing video/emotion analysis. See
# capabilities/avatarinterview/models.py and navtalk_client.py for the
# explicit, isolated caveat on NavTalk's real API contract.
app.include_router(avatarinterview_router.router, prefix="/api/avatar-interviews", tags=["AI Avatar Interviews"])
app.include_router(avatarinterview_public_router, prefix="/api/public/avatar-interviews", tags=["AI Avatar Interviews (Public)"])


@app.get("/health")
async def health():
    try:
        async with AsyncSessionLocal() as s:
            await s.execute(text("SELECT 1"))
        db = "connected"
    except Exception as e:
        db = f"error: {str(e)[:80]}"
    return {"status": "healthy", "database": db}


# ── Serve React frontend (production/Docker only) ────────────────────
# In dev: Vite runs on :5173 and proxies /api → :8000
# In prod: FastAPI serves the built React app from /static
STATIC_DIR = Path(__file__).parent / "static"

if STATIC_DIR.exists():
    # Serve static assets (JS, CSS, images) under /assets
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

    # Serve favicon and other root-level static files
    @app.get("/favicon.ico", include_in_schema=False)
    async def favicon():
        f = STATIC_DIR / "favicon.ico"
        return FileResponse(str(f)) if f.exists() else FileResponse(str(STATIC_DIR / "index.html"))

    # Catch-all: return index.html for all non-API routes
    # This lets React Router handle /login, /app/jobhunt, etc.
    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(request: Request, full_path: str):
        # Don't intercept API calls (shouldn't happen but safety net)
        if full_path.startswith("api/"):
            from fastapi.responses import JSONResponse
            return JSONResponse({"detail": "Not found"}, status_code=404)
        index = STATIC_DIR / "index.html"
        return FileResponse(str(index))
else:
    # Development mode — no static files built yet
    @app.get("/")
    async def root():
        return {"status": "TalentIQ API running (dev mode — frontend on :5173)"}
