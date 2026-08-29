"""
TalentIQ — Client & Vendor Collaboration (public, unauthenticated)

Registered in main.py as: /api/public/portal/*
Same token-as-auth pattern as every other public flow in this app.
"""
from datetime import datetime

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy import select

from db.database import AsyncSessionLocal
from models.models import Client, Vendor
from capabilities.acquisition.models import Candidate
from capabilities.requisition.models import Requisition
from capabilities.pipeline.models import PipelineEntry

from .models import ClientPortalAccess, VendorPortalAccess, VendorRequisitionAssignment, VendorSubmission, ClientFeedback, CLIENT_FEEDBACK_DECISIONS
from .schemas import ClientFeedbackSubmit
from . import service

router = APIRouter()


# ══════════════════════════════════════════════════════════════════════════
# CLIENT PORTAL
# ══════════════════════════════════════════════════════════════════════════

@router.get("/client/{token}")
async def client_portal_view(token: str):
    async with AsyncSessionLocal() as db:
        access = (await db.execute(select(ClientPortalAccess).where(ClientPortalAccess.token == token))).scalar_one_or_none()
        if not access:
            raise HTTPException(404, "This portal link is invalid.")
        if access.revoked_at:
            raise HTTPException(403, "This portal link has been revoked. Contact your recruiter for a new one.")
        client = (await db.execute(select(Client).where(Client.id == access.client_id))).scalar_one_or_none()
        if not client:
            raise HTTPException(404, "Client not found.")

        requisitions = (await db.execute(select(Requisition).where(Requisition.client_id == client.id))).scalars().all()
        req_ids = [r.id for r in requisitions]
        entries = (await db.execute(select(PipelineEntry).where(PipelineEntry.requisition_id.in_(req_ids)))).scalars().all() if req_ids else []

        candidate_ids = {e.candidate_id for e in entries}
        candidates = {c.id: c for c in (await db.execute(select(Candidate).where(Candidate.id.in_(candidate_ids)))).scalars().all()} if candidate_ids else {}

        from capabilities.pipeline.models import PipelineStage
        stage_ids = {e.current_stage_id for e in entries if e.current_stage_id}
        stage_names = dict((await db.execute(select(PipelineStage.id, PipelineStage.name).where(PipelineStage.id.in_(stage_ids)))).all()) if stage_ids else {}

        entries_by_req: dict = {r.id: [] for r in requisitions}
        for e in entries:
            candidate = candidates.get(e.candidate_id)
            if not candidate:
                continue
            card = {
                "pipeline_entry_id": e.id,
                "full_name": candidate.full_name,
                "current_title": candidate.current_title or "",
                "current_employer": candidate.current_employer or "",
                "total_experience_years": candidate.total_experience_years or "",
                "skills": candidate.skills or [],
                "has_resume": bool(candidate.resume_blob),
                "stage": stage_names.get(e.current_stage_id, ""),
            }
            # Scoped document access: a client never sees direct contact
            # details, only what's needed to review and decide — see
            # service.redact_candidate_contact's docstring.
            card = service.redact_candidate_contact(card)
            entries_by_req.setdefault(e.requisition_id, []).append(card)

        return {
            "client_name": client.name,
            "requisitions": [
                {"id": r.id, "title": r.title, "status": r.status, "candidates": entries_by_req.get(r.id, [])}
                for r in requisitions
            ],
        }


@router.get("/client/{token}/resume/{pipeline_entry_id}")
async def client_portal_download_resume(token: str, pipeline_entry_id: int):
    """Scoped document access, part 2: a client CAN download the resume
    (they need to actually evaluate the candidate) but the JSON view above
    never exposes the candidate's direct email/phone alongside it — this
    endpoint is verified against the SAME client's own requisitions only,
    so a client can't fetch a resume via an entry ID that isn't theirs."""
    async with AsyncSessionLocal() as db:
        access = (await db.execute(select(ClientPortalAccess).where(ClientPortalAccess.token == token))).scalar_one_or_none()
        if not access or access.revoked_at:
            raise HTTPException(403, "This portal link is invalid or has been revoked.")
        entry = (await db.execute(select(PipelineEntry).where(PipelineEntry.id == pipeline_entry_id))).scalar_one_or_none()
        if not entry:
            raise HTTPException(404, "Not found")
        req = (await db.execute(select(Requisition).where(Requisition.id == entry.requisition_id, Requisition.client_id == access.client_id))).scalar_one_or_none()
        if not req:
            raise HTTPException(403, "This candidate isn't part of your requisitions.")
        candidate = (await db.execute(select(Candidate).where(Candidate.id == entry.candidate_id))).scalar_one_or_none()
        if not candidate or not candidate.resume_blob:
            raise HTTPException(404, "No resume on file.")
        return Response(content=candidate.resume_blob, media_type=candidate.resume_mimetype or "application/octet-stream",
                         headers={"Content-Disposition": f'inline; filename="{candidate.resume_filename or "resume"}"'})


@router.post("/client/{token}/feedback")
async def client_portal_submit_feedback(token: str, payload: ClientFeedbackSubmit):
    if payload.decision not in CLIENT_FEEDBACK_DECISIONS:
        raise HTTPException(400, f"decision must be one of: {', '.join(CLIENT_FEEDBACK_DECISIONS)}")
    async with AsyncSessionLocal() as db:
        access = (await db.execute(select(ClientPortalAccess).where(ClientPortalAccess.token == token))).scalar_one_or_none()
        if not access or access.revoked_at:
            raise HTTPException(403, "This portal link is invalid or has been revoked.")
        entry = (await db.execute(select(PipelineEntry).where(PipelineEntry.id == payload.pipeline_entry_id))).scalar_one_or_none()
        if not entry:
            raise HTTPException(404, "Candidate not found.")
        req = (await db.execute(select(Requisition).where(Requisition.id == entry.requisition_id, Requisition.client_id == access.client_id))).scalar_one_or_none()
        if not req:
            raise HTTPException(403, "This candidate isn't part of your requisitions.")
        db.add(ClientFeedback(
            organisation_id=access.organisation_id, pipeline_entry_id=payload.pipeline_entry_id, client_id=access.client_id,
            contact_name=payload.contact_name.strip(), decision=payload.decision, comments=payload.comments.strip(),
        ))
        await db.commit()
        return {"submitted": True}


# ══════════════════════════════════════════════════════════════════════════
# VENDOR PORTAL
# ══════════════════════════════════════════════════════════════════════════

@router.get("/vendor/{token}")
async def vendor_portal_view(token: str):
    async with AsyncSessionLocal() as db:
        access = (await db.execute(select(VendorPortalAccess).where(VendorPortalAccess.token == token))).scalar_one_or_none()
        if not access:
            raise HTTPException(404, "This portal link is invalid.")
        if access.revoked_at:
            raise HTTPException(403, "This portal link has been revoked. Contact your recruiting contact for a new one.")
        vendor = (await db.execute(select(Vendor).where(Vendor.id == access.vendor_id))).scalar_one_or_none()
        if not vendor:
            raise HTTPException(404, "Vendor not found.")

        assignments = (await db.execute(select(VendorRequisitionAssignment).where(VendorRequisitionAssignment.vendor_id == vendor.id))).scalars().all()
        req_ids = [a.requisition_id for a in assignments]
        requisitions = (await db.execute(select(Requisition).where(Requisition.id.in_(req_ids)))).scalars().all() if req_ids else []

        submissions = (await db.execute(select(VendorSubmission).where(VendorSubmission.vendor_id == vendor.id).order_by(VendorSubmission.submitted_at.desc()))).scalars().all()

        return {
            "vendor_name": vendor.name,
            "assigned_requisitions": [{"id": r.id, "title": r.title, "status": r.status} for r in requisitions],
            "submissions": [
                {
                    "id": s.id, "full_name": s.full_name, "requisition_id": s.requisition_id,
                    "status": s.status, "rejection_reason": s.rejection_reason or "",
                    "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
                }
                for s in submissions
            ],
        }


@router.post("/vendor/{token}/submit")
async def vendor_portal_submit_candidate(
    token: str,
    requisition_id: int = Form(...),
    full_name: str = Form(...),
    email: str = Form(""),
    phone: str = Form(""),
    current_title: str = Form(""),
    current_employer: str = Form(""),
    total_experience_years: str = Form(""),
    vendor_notes: str = Form(""),
    resume_file: UploadFile = File(None),
):
    async with AsyncSessionLocal() as db:
        access = (await db.execute(select(VendorPortalAccess).where(VendorPortalAccess.token == token))).scalar_one_or_none()
        if not access or access.revoked_at:
            raise HTTPException(403, "This portal link is invalid or has been revoked.")
        assignment = (await db.execute(
            select(VendorRequisitionAssignment).where(
                VendorRequisitionAssignment.vendor_id == access.vendor_id,
                VendorRequisitionAssignment.requisition_id == requisition_id,
            )
        )).scalar_one_or_none()
        if not assignment:
            raise HTTPException(403, "You haven't been assigned to this requisition.")
        if not full_name.strip():
            raise HTTPException(400, "Candidate name is required.")

        submission = VendorSubmission(
            organisation_id=access.organisation_id, vendor_id=access.vendor_id, requisition_id=requisition_id,
            full_name=full_name.strip(), email=email.strip(), phone=phone.strip(),
            current_title=current_title.strip(), current_employer=current_employer.strip(),
            total_experience_years=total_experience_years.strip(), vendor_notes=vendor_notes.strip(),
        )
        if resume_file and resume_file.filename:
            submission.resume_blob = await resume_file.read()
            submission.resume_filename = resume_file.filename
            submission.resume_mimetype = resume_file.content_type or "application/octet-stream"
        db.add(submission)
        await db.commit()
        await db.refresh(submission)
        return {"id": submission.id, "status": submission.status}
