"""
TalentIQ — Capability: Client & Vendor Collaboration (Phase 6, authenticated)

Registered in main.py as: /api/portal/*
Public (client/vendor-facing) endpoints live in public_router.py,
registered as: /api/public/portal/*

Client and Vendor are scoped by user_id (an older convention that
predates this app's organisation_id-based tables) — matching the exact
scoping already used everywhere else Client/Vendor are queried (see
capabilities/requisition/router.py and routers/candidatetrack.py), not
introducing a third scoping convention here.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from db.database import get_db
from models.models import User, Client, Vendor
from utils.auth_utils import get_current_user
from capabilities.acquisition import service as acquisition_service
from capabilities.acquisition.models import Candidate
from capabilities.requisition.models import Requisition
from capabilities.pipeline.models import PipelineEntry
from capabilities.pipeline import service as pipeline_service

from .models import (
    ClientPortalAccess, VendorPortalAccess, VendorRequisitionAssignment,
    VendorSubmission, ClientFeedback,
)
from .schemas import AssignVendor, VendorSubmissionReview
from . import service

router = APIRouter()


async def _org(db: AsyncSession, user: User):
    return await acquisition_service.get_or_create_default_organisation(db, user)


def _fmt_submission(s: VendorSubmission, vendor_name: str = "", requisition_title: str = "") -> dict:
    return {
        "id": s.id, "vendor_id": s.vendor_id, "vendor_name": vendor_name,
        "requisition_id": s.requisition_id, "requisition_title": requisition_title,
        "full_name": s.full_name, "email": s.email or "", "phone": s.phone or "",
        "current_title": s.current_title or "", "current_employer": s.current_employer or "",
        "total_experience_years": s.total_experience_years or "",
        "vendor_notes": s.vendor_notes or "",
        "has_resume": bool(s.resume_blob), "resume_filename": s.resume_filename or "",
        "status": s.status, "rejection_reason": s.rejection_reason or "",
        "candidate_id": s.candidate_id, "pipeline_entry_id": s.pipeline_entry_id,
        "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
        "reviewed_at": s.reviewed_at.isoformat() if s.reviewed_at else None,
    }


def _fmt_feedback(f: ClientFeedback, candidate_name: str = "") -> dict:
    return {
        "id": f.id, "pipeline_entry_id": f.pipeline_entry_id, "candidate_name": candidate_name,
        "client_id": f.client_id, "contact_name": f.contact_name or "",
        "decision": f.decision, "comments": f.comments or "",
        "acknowledged": f.acknowledged,
        "submitted_at": f.submitted_at.isoformat() if f.submitted_at else None,
    }


# ══════════════════════════════════════════════════════════════════════════
# CLIENT PORTAL — token management (recruiter side)
# ══════════════════════════════════════════════════════════════════════════

@router.post("/clients/{client_id}/token")
async def create_client_portal_token(client_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Generates (or rotates — a fresh call replaces the old token, which
    stops working immediately) the client's portal link."""
    org = await _org(db, current_user)
    client = (await db.execute(select(Client).where(Client.id == client_id, Client.user_id == current_user.id))).scalar_one_or_none()
    if not client:
        raise HTTPException(404, "Client not found")
    existing = (await db.execute(select(ClientPortalAccess).where(ClientPortalAccess.client_id == client_id))).scalar_one_or_none()
    token = service.generate_portal_token()
    if existing:
        existing.token = token
        existing.revoked_at = None
    else:
        db.add(ClientPortalAccess(organisation_id=org.id, client_id=client_id, token=token))
    await db.commit()
    return {"token": token, "portal_path": f"/client-portal/{token}"}


@router.get("/clients/{client_id}/token")
async def get_client_portal_token(client_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    client = (await db.execute(select(Client).where(Client.id == client_id, Client.user_id == current_user.id))).scalar_one_or_none()
    if not client:
        raise HTTPException(404, "Client not found")
    access = (await db.execute(select(ClientPortalAccess).where(ClientPortalAccess.client_id == client_id))).scalar_one_or_none()
    if not access or access.revoked_at:
        return {"active": False}
    return {"active": True, "token": access.token, "portal_path": f"/client-portal/{access.token}"}


@router.post("/clients/{client_id}/token/revoke")
async def revoke_client_portal_token(client_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    client = (await db.execute(select(Client).where(Client.id == client_id, Client.user_id == current_user.id))).scalar_one_or_none()
    if not client:
        raise HTTPException(404, "Client not found")
    access = (await db.execute(select(ClientPortalAccess).where(ClientPortalAccess.client_id == client_id))).scalar_one_or_none()
    if access:
        access.revoked_at = datetime.utcnow()
        await db.commit()
    return {"revoked": True}


# ══════════════════════════════════════════════════════════════════════════
# VENDOR PORTAL — token management + requisition assignment (recruiter side)
# ══════════════════════════════════════════════════════════════════════════

@router.post("/vendors/{vendor_id}/token")
async def create_vendor_portal_token(vendor_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    vendor = (await db.execute(select(Vendor).where(Vendor.id == vendor_id, Vendor.user_id == current_user.id))).scalar_one_or_none()
    if not vendor:
        raise HTTPException(404, "Vendor not found")
    existing = (await db.execute(select(VendorPortalAccess).where(VendorPortalAccess.vendor_id == vendor_id))).scalar_one_or_none()
    token = service.generate_portal_token()
    if existing:
        existing.token = token
        existing.revoked_at = None
    else:
        db.add(VendorPortalAccess(organisation_id=org.id, vendor_id=vendor_id, token=token))
    await db.commit()
    return {"token": token, "portal_path": f"/vendor-portal/{token}"}


@router.get("/vendors/{vendor_id}/token")
async def get_vendor_portal_token(vendor_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    vendor = (await db.execute(select(Vendor).where(Vendor.id == vendor_id, Vendor.user_id == current_user.id))).scalar_one_or_none()
    if not vendor:
        raise HTTPException(404, "Vendor not found")
    access = (await db.execute(select(VendorPortalAccess).where(VendorPortalAccess.vendor_id == vendor_id))).scalar_one_or_none()
    if not access or access.revoked_at:
        return {"active": False}
    return {"active": True, "token": access.token, "portal_path": f"/vendor-portal/{access.token}"}


@router.post("/vendors/{vendor_id}/token/revoke")
async def revoke_vendor_portal_token(vendor_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    vendor = (await db.execute(select(Vendor).where(Vendor.id == vendor_id, Vendor.user_id == current_user.id))).scalar_one_or_none()
    if not vendor:
        raise HTTPException(404, "Vendor not found")
    access = (await db.execute(select(VendorPortalAccess).where(VendorPortalAccess.vendor_id == vendor_id))).scalar_one_or_none()
    if access:
        access.revoked_at = datetime.utcnow()
        await db.commit()
    return {"revoked": True}


@router.post("/vendor-assignments")
async def assign_vendor_to_requisition(payload: AssignVendor, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    vendor = (await db.execute(select(Vendor).where(Vendor.id == payload.vendor_id, Vendor.user_id == current_user.id))).scalar_one_or_none()
    if not vendor:
        raise HTTPException(404, "Vendor not found")
    req = (await db.execute(select(Requisition).where(Requisition.id == payload.requisition_id, Requisition.organisation_id == org.id))).scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Requisition not found in your organisation")
    existing = (await db.execute(
        select(VendorRequisitionAssignment).where(
            VendorRequisitionAssignment.vendor_id == payload.vendor_id,
            VendorRequisitionAssignment.requisition_id == payload.requisition_id,
        )
    )).scalar_one_or_none()
    if existing:
        return {"id": existing.id, "already_assigned": True}
    assignment = VendorRequisitionAssignment(organisation_id=org.id, vendor_id=payload.vendor_id, requisition_id=payload.requisition_id)
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    return {"id": assignment.id, "already_assigned": False}


@router.get("/vendor-assignments")
async def list_vendor_assignments(vendor_id: Optional[int] = None, requisition_id: Optional[int] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    q = select(VendorRequisitionAssignment).where(VendorRequisitionAssignment.organisation_id == org.id)
    if vendor_id:
        q = q.where(VendorRequisitionAssignment.vendor_id == vendor_id)
    if requisition_id:
        q = q.where(VendorRequisitionAssignment.requisition_id == requisition_id)
    rows = (await db.execute(q)).scalars().all()

    vendor_ids = {r.vendor_id for r in rows}
    requisition_ids = {r.requisition_id for r in rows}
    vendor_names = dict((await db.execute(select(Vendor.id, Vendor.name).where(Vendor.id.in_(vendor_ids)))).all()) if vendor_ids else {}
    requisition_titles = dict((await db.execute(select(Requisition.id, Requisition.title).where(Requisition.id.in_(requisition_ids)))).all()) if requisition_ids else {}

    return [
        {
            "id": r.id, "vendor_id": r.vendor_id, "vendor_name": vendor_names.get(r.vendor_id, ""),
            "requisition_id": r.requisition_id, "requisition_title": requisition_titles.get(r.requisition_id, ""),
            "assigned_at": r.assigned_at.isoformat() if r.assigned_at else None,
        }
        for r in rows
    ]


@router.delete("/vendor-assignments/{assignment_id}")
async def remove_vendor_assignment(assignment_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    a = (await db.execute(select(VendorRequisitionAssignment).where(VendorRequisitionAssignment.id == assignment_id, VendorRequisitionAssignment.organisation_id == org.id))).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Assignment not found")
    await db.delete(a)
    await db.commit()
    return {"deleted": True}


# ══════════════════════════════════════════════════════════════════════════
# VENDOR SUBMISSIONS — review queue (recruiter side)
# ══════════════════════════════════════════════════════════════════════════

@router.get("/vendor-submissions")
async def list_vendor_submissions(status: Optional[str] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    q = select(VendorSubmission).where(VendorSubmission.organisation_id == org.id)
    if status:
        q = q.where(VendorSubmission.status == status)
    rows = (await db.execute(q.order_by(VendorSubmission.submitted_at.desc()))).scalars().all()

    vendor_ids = {s.vendor_id for s in rows}
    requisition_ids = {s.requisition_id for s in rows}
    vendor_names = dict((await db.execute(select(Vendor.id, Vendor.name).where(Vendor.id.in_(vendor_ids)))).all()) if vendor_ids else {}
    requisition_titles = dict((await db.execute(select(Requisition.id, Requisition.title).where(Requisition.id.in_(requisition_ids)))).all()) if requisition_ids else {}

    return [_fmt_submission(s, vendor_names.get(s.vendor_id, ""), requisition_titles.get(s.requisition_id, "")) for s in rows]


@router.get("/vendor-submissions/{submission_id}/resume")
async def download_submission_resume(submission_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from fastapi.responses import Response
    org = await _org(db, current_user)
    s = (await db.execute(select(VendorSubmission).where(VendorSubmission.id == submission_id, VendorSubmission.organisation_id == org.id))).scalar_one_or_none()
    if not s or not s.resume_blob:
        raise HTTPException(404, "No resume on file for this submission")
    return Response(content=s.resume_blob, media_type=s.resume_mimetype or "application/octet-stream",
                     headers={"Content-Disposition": f'inline; filename="{s.resume_filename or "resume"}"'})


@router.post("/vendor-submissions/{submission_id}/review")
async def review_vendor_submission(
    submission_id: int, payload: VendorSubmissionReview,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    """Accept promotes the raw submission into a real Candidate +
    PipelineEntry (see VendorSubmission's docstring for why that
    promotion is deferred to this point rather than happening at
    submission time). Reject just records a reason — no Candidate row is
    ever created for a rejected submission."""
    if payload.action not in ("accept", "reject"):
        raise HTTPException(400, "action must be 'accept' or 'reject'")
    org = await _org(db, current_user)
    s = (await db.execute(select(VendorSubmission).where(VendorSubmission.id == submission_id, VendorSubmission.organisation_id == org.id))).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Submission not found")
    if s.status != "Pending Review":
        raise HTTPException(400, f"This submission was already {s.status.lower()}.")

    if payload.action == "reject":
        s.status = "Rejected"
        s.rejection_reason = payload.rejection_reason.strip()
        s.reviewed_by_user_id = current_user.id
        s.reviewed_at = datetime.utcnow()
        await db.commit()
        return _fmt_submission(s)

    # Accept: create (or reuse, if this person is already a known
    # candidate) a Candidate row, then submit them into the requisition's
    # pipeline exactly the same way a recruiter manually adding a
    # candidate would — same dedup discipline as the bulk resume import
    # elsewhere in this app: check by email first, don't blindly create a
    # duplicate.
    candidate = None
    if s.email:
        candidate = (await db.execute(
            select(Candidate).where(Candidate.organisation_id == org.id, Candidate.email == s.email, Candidate.is_merged.is_(False))
        )).scalar_one_or_none()
    if not candidate:
        candidate = Candidate(
            organisation_id=org.id, full_name=s.full_name, email=s.email or "", phone=s.phone or "",
            current_title=s.current_title or "", current_employer=s.current_employer or "",
            total_experience_years=s.total_experience_years or "", source="Vendor",
            resume_blob=s.resume_blob, resume_filename=s.resume_filename, resume_mimetype=s.resume_mimetype,
            consent_given=True,  # a vendor submitting on a candidate's behalf implies consent was obtained upstream
        )
        db.add(candidate)
        await db.flush()

    pipeline_entry = (await db.execute(
        select(PipelineEntry).where(PipelineEntry.candidate_id == candidate.id, PipelineEntry.requisition_id == s.requisition_id)
    )).scalar_one_or_none()
    if not pipeline_entry:
        from capabilities.acquisition.models import Application
        application = (await db.execute(
            select(Application).where(Application.candidate_id == candidate.id, Application.requisition_id == s.requisition_id)
        )).scalar_one_or_none()
        if not application:
            application = Application(organisation_id=org.id, candidate_id=candidate.id, requisition_id=s.requisition_id, source="Vendor")
            db.add(application)
            await db.flush()
        stages = await pipeline_service.get_effective_stages(db, org.id, s.requisition_id)
        first_stage = stages[0] if stages else None
        pipeline_entry = PipelineEntry(
            organisation_id=org.id, sequence_number=await pipeline_service.get_next_sequence(db, org.id),
            application_id=application.id, candidate_id=candidate.id, requisition_id=s.requisition_id,
            current_stage_id=first_stage.id if first_stage else None, stage_entered_at=datetime.utcnow(),
            notes=f"Submitted via vendor portal. {s.vendor_notes}".strip(),
        )
        db.add(pipeline_entry)
        await db.flush()

    s.status = "Accepted"
    s.candidate_id = candidate.id
    s.pipeline_entry_id = pipeline_entry.id
    s.reviewed_by_user_id = current_user.id
    s.reviewed_at = datetime.utcnow()
    await db.commit()
    await db.refresh(s)
    return _fmt_submission(s)


# ══════════════════════════════════════════════════════════════════════════
# CLIENT FEEDBACK — inbox (recruiter side)
# ══════════════════════════════════════════════════════════════════════════

@router.get("/client-feedback")
async def list_client_feedback(acknowledged: Optional[bool] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    q = select(ClientFeedback).where(ClientFeedback.organisation_id == org.id)
    if acknowledged is not None:
        q = q.where(ClientFeedback.acknowledged == acknowledged)
    rows = (await db.execute(q.order_by(ClientFeedback.submitted_at.desc()))).scalars().all()

    entry_ids = {f.pipeline_entry_id for f in rows}
    candidate_by_entry = {}
    if entry_ids:
        entries = (await db.execute(select(PipelineEntry).where(PipelineEntry.id.in_(entry_ids)))).scalars().all()
        candidate_ids = {e.candidate_id for e in entries}
        candidate_names = dict((await db.execute(select(Candidate.id, Candidate.full_name).where(Candidate.id.in_(candidate_ids)))).all()) if candidate_ids else {}
        candidate_by_entry = {e.id: candidate_names.get(e.candidate_id, "") for e in entries}

    return [_fmt_feedback(f, candidate_by_entry.get(f.pipeline_entry_id, "")) for f in rows]


@router.post("/client-feedback/{feedback_id}/acknowledge")
async def acknowledge_feedback(feedback_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    f = (await db.execute(select(ClientFeedback).where(ClientFeedback.id == feedback_id, ClientFeedback.organisation_id == org.id))).scalar_one_or_none()
    if not f:
        raise HTTPException(404, "Feedback not found")
    f.acknowledged = True
    f.acknowledged_at = datetime.utcnow()
    await db.commit()
    return {"acknowledged": True}
