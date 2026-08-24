"""
TalentIQ — Interview self-scheduling (public, unauthenticated)

Registered in main.py as: /api/public/interviews/*
Mirrors the proven token-as-auth pattern already used for the candidate
portal, hiring-manager view link, and CandidateLens public interview
flow — the long random token IS the authentication, no candidate login
system required.
"""
from datetime import datetime

from fastapi import APIRouter, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from db.database import AsyncSessionLocal
from capabilities.acquisition.models import Candidate
from capabilities.requisition.models import Requisition

from .models import Interview
from .schemas import PublicSlotConfirm

router = APIRouter()


async def _get_db():
    async with AsyncSessionLocal() as db:
        yield db


@router.get("/{token}")
async def public_get_schedule_request(token: str):
    async with AsyncSessionLocal() as db:
        i = (await db.execute(select(Interview).where(Interview.self_schedule_token == token))).scalar_one_or_none()
        if not i:
            raise HTTPException(404, "This scheduling link is invalid or has expired.")
        candidate = (await db.execute(select(Candidate).where(Candidate.id == i.candidate_id))).scalar_one_or_none()
        requisition_title = ""
        if i.requisition_id:
            req = (await db.execute(select(Requisition).where(Requisition.id == i.requisition_id))).scalar_one_or_none()
            requisition_title = req.title if req else ""
        return {
            "round_name": i.round_name,
            "candidate_name": candidate.full_name if candidate else "",
            "requisition_title": requisition_title,
            "duration_minutes": i.duration_minutes,
            "location_or_link": i.location_or_link or "",
            "interviewers": i.interviewers or [],
            "proposed_slots": i.proposed_slots or [],
            "already_confirmed": i.status == "Scheduled",
            "confirmed_slot": i.scheduled_at.isoformat() if i.scheduled_at else None,
        }


@router.post("/{token}/confirm")
async def public_confirm_slot(token: str, payload: PublicSlotConfirm):
    async with AsyncSessionLocal() as db:
        i = (await db.execute(select(Interview).where(Interview.self_schedule_token == token))).scalar_one_or_none()
        if not i:
            raise HTTPException(404, "This scheduling link is invalid or has expired.")
        if i.status == "Scheduled":
            raise HTTPException(400, "A time has already been confirmed for this interview.")
        # Compare parsed datetime VALUES, not raw ISO strings — pydantic
        # re-serializing a parsed datetime doesn't always reproduce the
        # exact original string (trailing zeros, timezone notation), so a
        # naive string-equality check could reject a legitimately-selected
        # slot.
        proposed_dt = [datetime.fromisoformat(s) for s in (i.proposed_slots or [])]
        if payload.selected_slot not in proposed_dt:
            raise HTTPException(400, "That time isn't one of the proposed options — please pick one from the list.")
        i.scheduled_at = payload.selected_slot
        i.status = "Scheduled"
        i.candidate_selected_at = datetime.utcnow()
        i.updated_at = datetime.utcnow()
        await db.commit()
        return {"confirmed": True, "scheduled_at": i.scheduled_at.isoformat()}
