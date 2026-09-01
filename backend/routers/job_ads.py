"""
Job Ads — create a job posting once, then push it to LinkedIn and/or
Seek. See models/job_ads_models.py's module docstring on why posting
requires that platform's own partner API credentials, and reports a
clear "not configured" error rather than faking success without them.

Expected credentials, service names below — both are shareable
platform-wide (see utils/credentials.py's SHAREABLE_SERVICES) and
admin-configured only, via Admin Console > API Keys, same as
groq/apify/stripe: one Partner API credential covers every recruiter
on the deployment. Only needed once you actually have partner-level
access from each platform:
  linkedin_jobs: access_token   — LinkedIn Talent/Jobs API OAuth token
  seek_jobs:     api_key        — Seek Partner API key
"""
from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from models.models import User
from models.job_ads_models import JobAd
from utils.auth_utils import get_current_user
from utils.credentials import get_credential

router = APIRouter()


class JobAdCreate(BaseModel):
    title: str
    description: str = ""
    location: str = ""
    employment_type: str = ""
    salary_min: Optional[float] = None
    salary_max: Optional[float] = None
    requisition_id: Optional[int] = None


def _fmt(a: JobAd) -> dict:
    return {
        "id": a.id, "title": a.title, "description": a.description or "",
        "location": a.location or "", "employment_type": a.employment_type or "",
        "salary_min": a.salary_min, "salary_max": a.salary_max, "requisition_id": a.requisition_id,
        "linkedin_status": a.linkedin_status, "linkedin_post_url": a.linkedin_post_url or "", "linkedin_error": a.linkedin_error or "",
        "seek_status": a.seek_status, "seek_post_url": a.seek_post_url or "", "seek_error": a.seek_error or "",
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


@router.get("")
async def list_job_ads(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(JobAd).where(JobAd.user_id == current_user.id).order_by(JobAd.created_at.desc()))).scalars().all()
    return [_fmt(a) for a in rows]


@router.post("")
async def create_job_ad(payload: JobAdCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not payload.title.strip():
        raise HTTPException(400, "Title is required.")
    ad = JobAd(user_id=current_user.id, **payload.dict())
    db.add(ad)
    await db.commit()
    await db.refresh(ad)
    return _fmt(ad)


@router.delete("/{ad_id}")
async def delete_job_ad(ad_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ad = (await db.execute(select(JobAd).where(JobAd.id == ad_id, JobAd.user_id == current_user.id))).scalar_one_or_none()
    if not ad:
        raise HTTPException(404, "Job ad not found.")
    await db.delete(ad)
    await db.commit()
    return {"deleted": True}


async def _get_ad(ad_id: int, current_user: User, db: AsyncSession) -> JobAd:
    ad = (await db.execute(select(JobAd).where(JobAd.id == ad_id, JobAd.user_id == current_user.id))).scalar_one_or_none()
    if not ad:
        raise HTTPException(404, "Job ad not found.")
    return ad


@router.post("/{ad_id}/post-linkedin")
async def post_to_linkedin(ad_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ad = await _get_ad(ad_id, current_user, db)
    token = await get_credential(db, current_user.id, "linkedin_jobs", "access_token")
    if not token:
        ad.linkedin_status = "Failed"
        ad.linkedin_error = "LinkedIn job posting isn't configured — ask an admin to add a LinkedIn Talent/Jobs API access token in Admin Console > API Keys. This requires LinkedIn's own partner-level API access, which is separate from a normal LinkedIn login."
        await db.commit()
        raise HTTPException(400, ad.linkedin_error)

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                "https://api.linkedin.com/v2/simpleJobPostings",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={
                    "title": ad.title, "description": ad.description,
                    "location": {"countryCode": "", "city": ad.location},
                    "employmentStatus": ad.employment_type,
                },
            )
        if resp.status_code >= 400:
            ad.linkedin_status = "Failed"
            ad.linkedin_error = f"LinkedIn rejected the post ({resp.status_code}): {resp.text[:300]}"
            await db.commit()
            raise HTTPException(400, ad.linkedin_error)
        data = resp.json()
        ad.linkedin_status = "Posted"
        ad.linkedin_post_url = data.get("url", "")
        ad.linkedin_error = ""
        ad.updated_at = datetime.utcnow()
        await db.commit()
        return _fmt(ad)
    except HTTPException:
        raise
    except Exception as e:
        ad.linkedin_status = "Failed"
        ad.linkedin_error = f"Failed to reach LinkedIn: {str(e)[:200]}"
        await db.commit()
        raise HTTPException(502, ad.linkedin_error)


@router.post("/{ad_id}/post-seek")
async def post_to_seek(ad_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ad = await _get_ad(ad_id, current_user, db)
    api_key = await get_credential(db, current_user.id, "seek_jobs", "api_key")
    if not api_key:
        ad.seek_status = "Failed"
        ad.seek_error = "Seek job posting isn't configured — ask an admin to add a Seek Partner API key in Admin Console > API Keys. This requires a Seek Partner API agreement, which is separate from a normal Seek account."
        await db.commit()
        raise HTTPException(400, ad.seek_error)

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                "https://api.seek.com/job-postings",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "title": ad.title, "description": ad.description, "location": ad.location,
                    "workType": ad.employment_type,
                    "salary": {"min": ad.salary_min, "max": ad.salary_max} if ad.salary_min or ad.salary_max else None,
                },
            )
        if resp.status_code >= 400:
            ad.seek_status = "Failed"
            ad.seek_error = f"Seek rejected the post ({resp.status_code}): {resp.text[:300]}"
            await db.commit()
            raise HTTPException(400, ad.seek_error)
        data = resp.json()
        ad.seek_status = "Posted"
        ad.seek_post_url = data.get("url", "")
        ad.seek_error = ""
        ad.updated_at = datetime.utcnow()
        await db.commit()
        return _fmt(ad)
    except HTTPException:
        raise
    except Exception as e:
        ad.seek_status = "Failed"
        ad.seek_error = f"Failed to reach Seek: {str(e)[:200]}"
        await db.commit()
        raise HTTPException(502, ad.seek_error)
