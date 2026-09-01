"""
Public Config (PUBLIC, no auth) — a tiny read-only surface for anything
the marketing/Landing page needs from the database without a login.

Currently just module-toggles: Admin Console > Modules Management
(routers/admin.py's get_module_toggles) lets an admin turn a module off
for the logged-in app's sidebar. The public Landing page advertises the
same modules to logged-out visitors, so it needs the same on/off map —
this is that same read, just without require_admin, so an anonymous
visitor's browser can call it too. Toggling a module here takes effect
on the Landing page the next time it loads/polls this endpoint, same as
it does for the sidebar — no separate "publish to landing page" step.

Registered in main.py as: /api/public/config/*
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from db.database import get_db

router = APIRouter()


@router.get("/module-toggles")
async def get_public_module_toggles(db: AsyncSession = Depends(get_db)):
    from models.models import ModuleToggle
    result = await db.execute(select(ModuleToggle))
    # Same "absent route == enabled" convention as the admin-only
    # endpoint this mirrors — an empty map means everything's on.
    return {row.module_route: row.enabled for row in result.scalars().all()}
