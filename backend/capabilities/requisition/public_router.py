"""
TalentIQ — Capability: Job Requisitions (PUBLIC, no auth)

A single read-only endpoint: a hiring manager gets a link
(/hm/{token}) and can see the status of their requisition without any
login — same token-as-auth pattern already proven by the candidate portal
and the public interview link.

Registered in main.py as: /api/public/requisitions/*
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from db.database import get_db
from models.models import Client, JDRecord
from .models import Requisition

router = APIRouter()


@router.get("/hm-view/{token}")
async def hiring_manager_view(token: str, db: AsyncSession = Depends(get_db)):
    r = (await db.execute(select(Requisition).where(Requisition.hm_view_token == token))).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "This link is invalid or has expired.")

    client_name, jd_title = "", ""
    if r.client_id:
        c = (await db.execute(select(Client).where(Client.id == r.client_id))).scalar_one_or_none()
        client_name = c.name if c else ""
    if r.jd_record_id:
        jd = (await db.execute(select(JDRecord).where(JDRecord.id == r.jd_record_id))).scalar_one_or_none()
        jd_title = jd.title if jd else ""

    return {
        "title": r.title,
        "status": r.status,
        "priority": r.priority,
        "vacancy_count": r.vacancy_count,
        "employment_type": r.employment_type or "",
        "location": r.location or "",
        "client_name": client_name,
        "jd_title": jd_title,
        "target_hire_date": r.target_hire_date.isoformat() if r.target_hire_date else None,
        "checklist": {
            "salary_approved": r.salary_approved,
            "headcount_approved": r.headcount_approved,
            "jd_approved": r.jd_approved,
            "location_confirmed": r.location_confirmed,
        },
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }
