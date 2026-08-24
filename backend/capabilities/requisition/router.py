"""
TalentIQ — Capability: Job Requisitions (authenticated)

Every endpoint is organisation-scoped and works fully on its own — a
requisition doesn't need Screening/Interview/Pipeline to exist to be
useful; it just needs Phase 0 (Application FK target) which is already in
place. Registered in main.py as: /api/requisitions/*
"""
from datetime import datetime
from typing import Optional
import csv
import io

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from db.database import get_db
from models.models import User, Client, JDRecord
from utils.auth_utils import get_current_user
from capabilities.acquisition import service as acquisition_service
from capabilities.acquisition.models import Application
from capabilities.interview.models import Interview
from capabilities.pipeline.models import PipelineEntry, Offer
from .models import Requisition, ClientContact, REQUISITION_STATUSES, REQUISITION_PRIORITIES
from .schemas import (
    RequisitionCreate, RequisitionUpdate, RequisitionStatusChange, ChecklistUpdate,
    ClientContactCreate, ClientContactUpdate, BulkIds,
)
from . import service

router = APIRouter()


async def _org(db: AsyncSession, user: User):
    return await acquisition_service.get_or_create_default_organisation(db, user)


async def _next_sequence(db: AsyncSession, organisation_id: int) -> int:
    r = await db.execute(select(func.max(Requisition.sequence_number)).where(Requisition.organisation_id == organisation_id))
    return (r.scalar() or 0) + 1


async def _client_name(db: AsyncSession, client_id: Optional[int]) -> str:
    if not client_id:
        return ""
    c = (await db.execute(select(Client).where(Client.id == client_id))).scalar_one_or_none()
    return c.name if c else ""


async def _jd_title(db: AsyncSession, jd_record_id: Optional[int]) -> str:
    if not jd_record_id:
        return ""
    jd = (await db.execute(select(JDRecord).where(JDRecord.id == jd_record_id))).scalar_one_or_none()
    return jd.title if jd else ""


async def _application_count(db: AsyncSession, requisition_id: int) -> int:
    r = await db.execute(select(func.count()).select_from(Application).where(Application.requisition_id == requisition_id))
    return r.scalar() or 0


async def _fmt(db: AsyncSession, r: Requisition) -> dict:
    """Single-row formatter — used by create/get/update/status endpoints
    where one extra query per lookup is negligible. NOT used by
    list_requisitions (see _fmt_batch below) — calling this in a per-row
    loop there was a real N+1: 3 extra queries (client, JD, application
    count) PER requisition, so a page of 50 requisitions issued 150+ extra
    sequential round trips on top of the list query itself."""
    return _fmt_batch(
        r,
        client_name=await _client_name(db, r.client_id),
        jd_title=await _jd_title(db, r.jd_record_id),
        application_count=await _application_count(db, r.id),
    )


def _fmt_batch(r: Requisition, client_name: str, jd_title: str, application_count: int) -> dict:
    """Same shape as _fmt, but takes pre-fetched lookups so list_requisitions
    can batch all clients/JDs/application-counts in 3 queries total instead
    of 3 queries per row."""
    return {
        "id": r.id,
        "sequence_number": r.sequence_number,
        "title": r.title,
        "status": r.status,
        "priority": r.priority,
        "vacancy_count": r.vacancy_count,
        "reason_for_hire": r.reason_for_hire or "",
        "employment_type": r.employment_type or "",
        "location": r.location or "",
        "salary_min": r.salary_min,
        "salary_max": r.salary_max,
        "target_hire_date": r.target_hire_date.isoformat() if r.target_hire_date else None,
        "client_id": r.client_id,
        "client_name": client_name,
        "jd_record_id": r.jd_record_id,
        "jd_title": jd_title,
        "hiring_manager_contact_id": r.hiring_manager_contact_id,
        "hiring_manager_name": r.hiring_manager_name or "",
        "hiring_manager_email": r.hiring_manager_email or "",
        "salary_approved": r.salary_approved,
        "headcount_approved": r.headcount_approved,
        "jd_approved": r.jd_approved,
        "location_confirmed": r.location_confirmed,
        "checklist_complete": r.checklist_complete,
        "approved_at": r.approved_at.isoformat() if r.approved_at else None,
        "hm_view_token": r.hm_view_token,
        "application_count": application_count,
        "notes": r.notes or "",
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


# ══════════════════════════════════════════════════════════════════════════
# REQUISITIONS — CRUD
# ══════════════════════════════════════════════════════════════════════════

@router.post("/requisitions")
async def create_requisition(payload: RequisitionCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not payload.title.strip():
        raise HTTPException(400, "Title is required.")
    if payload.priority not in REQUISITION_PRIORITIES:
        raise HTTPException(400, f"Priority must be one of: {', '.join(REQUISITION_PRIORITIES)}")
    org = await _org(db, current_user)

    if payload.client_id:
        c = (await db.execute(select(Client).where(Client.id == payload.client_id, Client.user_id == current_user.id))).scalar_one_or_none()
        if not c:
            raise HTTPException(404, "Client not found")
    if payload.jd_record_id:
        jd = (await db.execute(select(JDRecord).where(JDRecord.id == payload.jd_record_id, JDRecord.user_id == current_user.id))).scalar_one_or_none()
        if not jd:
            raise HTTPException(404, "JD not found")
    if payload.hiring_manager_contact_id:
        contact = (await db.execute(select(ClientContact).where(ClientContact.id == payload.hiring_manager_contact_id, ClientContact.organisation_id == org.id))).scalar_one_or_none()
        if not contact:
            raise HTTPException(404, "Hiring manager contact not found")

    req = Requisition(
        organisation_id=org.id, sequence_number=await _next_sequence(db, org.id),
        owner_user_id=current_user.id, client_id=payload.client_id, jd_record_id=payload.jd_record_id,
        title=payload.title.strip(), status="Draft", priority=payload.priority,
        vacancy_count=max(1, payload.vacancy_count), reason_for_hire=payload.reason_for_hire,
        employment_type=payload.employment_type, location=payload.location,
        salary_min=payload.salary_min, salary_max=payload.salary_max, target_hire_date=payload.target_hire_date,
        hiring_manager_contact_id=payload.hiring_manager_contact_id,
        hiring_manager_name=payload.hiring_manager_name.strip(), hiring_manager_email=payload.hiring_manager_email.strip(),
        notes=payload.notes.strip(),
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return await _fmt(db, req)


@router.get("/requisitions")
async def list_requisitions(
    status: Optional[str] = None, priority: Optional[str] = None, client_id: Optional[int] = None,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    org = await _org(db, current_user)
    q = select(Requisition).where(Requisition.organisation_id == org.id)
    if status:
        q = q.where(Requisition.status == status)
    if priority:
        q = q.where(Requisition.priority == priority)
    if client_id:
        q = q.where(Requisition.client_id == client_id)
    q = q.order_by(Requisition.created_at.desc())
    rows = (await db.execute(q)).scalars().all()

    # Batch every per-row lookup _fmt used to do individually (see _fmt's
    # docstring) into 3 queries total for the whole page, instead of 3 per
    # requisition.
    client_ids = {r.client_id for r in rows if r.client_id}
    jd_ids = {r.jd_record_id for r in rows if r.jd_record_id}
    req_ids = [r.id for r in rows]

    client_names = {}
    if client_ids:
        res = await db.execute(select(Client.id, Client.name).where(Client.id.in_(client_ids)))
        client_names = dict(res.all())

    jd_titles = {}
    if jd_ids:
        res = await db.execute(select(JDRecord.id, JDRecord.title).where(JDRecord.id.in_(jd_ids)))
        jd_titles = dict(res.all())

    application_counts = {}
    if req_ids:
        res = await db.execute(
            select(Application.requisition_id, func.count())
            .where(Application.requisition_id.in_(req_ids))
            .group_by(Application.requisition_id)
        )
        application_counts = dict(res.all())

    return [
        _fmt_batch(
            r,
            client_name=client_names.get(r.client_id, "") if r.client_id else "",
            jd_title=jd_titles.get(r.jd_record_id, "") if r.jd_record_id else "",
            application_count=application_counts.get(r.id, 0),
        )
        for r in rows
    ]


@router.post("/requisitions/csv-import")
async def csv_import_requisitions(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Bulk-load requisitions from a CSV file — e.g. a folder export from
    another ATS/spreadsheet. Expected columns (title required, everything
    else optional): title, client_name, priority, vacancy_count,
    reason_for_hire, employment_type, location, salary_min, salary_max,
    target_hire_date (YYYY-MM-DD), hiring_manager_name,
    hiring_manager_email, notes.

    Standing policy: a requisition is never left without its intended
    client just because that client doesn't exist in the system yet.
    If client_name doesn't match an existing Client (case-insensitive),
    the client is created automatically (name only) and the requisition
    is linked to it — every requisition with a client_name always ends up
    with a real client_id. Rows with the SAME new client_name later in
    the same file reuse that one newly-created client rather than
    creating a duplicate."""
    org = await _org(db, current_user)
    raw = await file.read()
    text = raw.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))

    clients = (await db.execute(select(Client).where(Client.user_id == current_user.id))).scalars().all()
    client_by_name = {c.name.strip().lower(): c for c in clients}

    created, skipped, errors = 0, 0, []
    clients_created = 0
    for i, raw_row in enumerate(reader, start=2):  # row 1 is the header
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in raw_row.items() if k}
        title = row.get("title", "")
        if not title:
            skipped += 1
            errors.append(f"Row {i}: missing 'title', skipped")
            continue

        client_id = None
        client_name = row.get("client_name", "")
        if client_name:
            client = client_by_name.get(client_name.lower())
            if not client:
                # Auto-create the client — a requisition never gets left
                # orphaned just because the client hasn't been entered yet.
                client = Client(user_id=current_user.id, name=client_name)
                db.add(client)
                await db.flush()  # need client.id before the requisition below can reference it
                client_by_name[client_name.lower()] = client
                clients_created += 1
                errors.append(f"Row {i}: client '{client_name}' didn't exist — created it and linked this requisition")
            client_id = client.id

        priority = row.get("priority", "Normal") or "Normal"
        if priority not in REQUISITION_PRIORITIES:
            errors.append(f"Row {i}: priority '{priority}' not recognized — defaulted to Normal")
            priority = "Normal"

        try:
            vacancy_count = max(1, int(row.get("vacancy_count") or 1))
        except ValueError:
            vacancy_count = 1
        try:
            salary_min = int(row["salary_min"]) if row.get("salary_min") else None
        except ValueError:
            salary_min = None
        try:
            salary_max = int(row["salary_max"]) if row.get("salary_max") else None
        except ValueError:
            salary_max = None
        target_hire_date = None
        if row.get("target_hire_date"):
            try:
                target_hire_date = datetime.strptime(row["target_hire_date"], "%Y-%m-%d")
            except ValueError:
                errors.append(f"Row {i}: target_hire_date '{row['target_hire_date']}' not in YYYY-MM-DD format, ignored")

        req = Requisition(
            organisation_id=org.id, sequence_number=await _next_sequence(db, org.id),
            owner_user_id=current_user.id, client_id=client_id,
            title=title, status="Draft", priority=priority, vacancy_count=vacancy_count,
            reason_for_hire=row.get("reason_for_hire", ""), employment_type=row.get("employment_type", ""),
            location=row.get("location", ""), salary_min=salary_min, salary_max=salary_max,
            target_hire_date=target_hire_date,
            hiring_manager_name=row.get("hiring_manager_name", ""), hiring_manager_email=row.get("hiring_manager_email", ""),
            notes=row.get("notes", ""),
        )
        db.add(req)
        created += 1

    await db.commit()
    return {"created": created, "skipped": skipped, "clients_created": clients_created, "errors": errors[:30]}


@router.get("/requisitions/{req_id}")
async def get_requisition(req_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    r = (await db.execute(select(Requisition).where(Requisition.id == req_id, Requisition.organisation_id == org.id))).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Requisition not found")
    return await _fmt(db, r)


@router.put("/requisitions/{req_id}")
async def update_requisition(req_id: int, payload: RequisitionUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    r = (await db.execute(select(Requisition).where(Requisition.id == req_id, Requisition.organisation_id == org.id))).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Requisition not found")
    if payload.priority and payload.priority not in REQUISITION_PRIORITIES:
        raise HTTPException(400, f"Priority must be one of: {', '.join(REQUISITION_PRIORITIES)}")

    data = payload.dict(exclude_unset=True)
    for field, value in data.items():
        setattr(r, field, value)
    r.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(r)
    return await _fmt(db, r)


async def _blocking_requisition_refs(db: AsyncSession, requisition_id: int) -> str:
    """Returns a human-readable reason a requisition can't be deleted, or
    "" if it's clear. Interviews, pipeline entries, and offers are real
    hiring-activity records — deleting the requisition out from under
    them would either silently orphan that history or crash outright with
    a raw Postgres FK violation (confirmed live: deleting a requisition
    with an interview attached previously returned a bare
    "Internal Server Error" with zero explanation — this replaces that
    with a specific, actionable message, same policy as
    capabilities.acquisition.router._blocking_client_refs for clients)."""
    interview_count = (await db.execute(select(func.count()).select_from(Interview).where(Interview.requisition_id == requisition_id))).scalar() or 0
    pipeline_count = (await db.execute(select(func.count()).select_from(PipelineEntry).where(PipelineEntry.requisition_id == requisition_id))).scalar() or 0
    offer_count = (await db.execute(select(func.count()).select_from(Offer).where(Offer.requisition_id == requisition_id))).scalar() or 0
    if interview_count or pipeline_count or offer_count:
        parts = []
        if pipeline_count:
            parts.append(f"{pipeline_count} pipeline entr{'y' if pipeline_count == 1 else 'ies'}")
        if interview_count:
            parts.append(f"{interview_count} interview(s)")
        if offer_count:
            parts.append(f"{offer_count} offer(s)")
        return f"Cannot delete this requisition — it still has {' and '.join(parts)} linked. Remove those first."
    return ""


@router.delete("/requisitions/{req_id}")
async def delete_requisition(req_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    r = (await db.execute(select(Requisition).where(Requisition.id == req_id, Requisition.organisation_id == org.id))).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Requisition not found")
    reason = await _blocking_requisition_refs(db, req_id)
    if reason:
        raise HTTPException(400, reason)
    await db.delete(r)
    await db.commit()
    return {"deleted": True}


@router.post("/requisitions/bulk-delete")
async def bulk_delete_requisitions(payload: BulkIds, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Per-requisition, not a single blanket DELETE — same reasoning as
    capabilities.acquisition.router.bulk_delete_clients: a bulk selection
    is very likely to mix deletable requisitions with ones that still
    have hiring activity attached, and a single all-or-nothing DELETE
    would let one blocked requisition fail the entire batch."""
    org = await _org(db, current_user)
    rows = (await db.execute(select(Requisition).where(Requisition.id.in_(payload.ids), Requisition.organisation_id == org.id))).scalars().all()
    deleted, skipped = [], []
    for r in rows:
        reason = await _blocking_requisition_refs(db, r.id)
        if reason:
            skipped.append({"id": r.id, "title": r.title, "reason": reason})
            continue
        await db.delete(r)
        deleted.append(r.id)
    await db.commit()
    return {"deleted": len(deleted), "deleted_ids": deleted, "skipped": skipped}


# ══════════════════════════════════════════════════════════════════════════
# STATUS WORKFLOW + INTAKE CHECKLIST
# ══════════════════════════════════════════════════════════════════════════

@router.post("/requisitions/{req_id}/status")
async def change_status(req_id: int, payload: RequisitionStatusChange, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    r = (await db.execute(select(Requisition).where(Requisition.id == req_id, Requisition.organisation_id == org.id))).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Requisition not found")
    if payload.status not in REQUISITION_STATUSES:
        raise HTTPException(400, f"Status must be one of: {', '.join(REQUISITION_STATUSES)}")
    try:
        service.validate_status_transition(r.status, payload.status)
    except ValueError as e:
        raise HTTPException(400, str(e))

    if payload.status == "Approved" and r.status != "Approved":
        r.approved_at = datetime.utcnow()
        r.approved_by_user_id = current_user.id
    r.status = payload.status
    r.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(r)
    return await _fmt(db, r)


@router.put("/requisitions/{req_id}/checklist")
async def update_checklist(req_id: int, payload: ChecklistUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    r = (await db.execute(select(Requisition).where(Requisition.id == req_id, Requisition.organisation_id == org.id))).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Requisition not found")
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(r, field, value)
    r.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(r)
    return await _fmt(db, r)


@router.post("/requisitions/{req_id}/hm-view-link")
async def generate_hm_view_link(req_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Generates (or returns the existing) read-only hiring-manager view
    link — the lightweight alternative to a full hiring-manager login."""
    org = await _org(db, current_user)
    r = (await db.execute(select(Requisition).where(Requisition.id == req_id, Requisition.organisation_id == org.id))).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Requisition not found")
    if not r.hm_view_token:
        r.hm_view_token = service.generate_view_token()
        await db.commit()
    return {"hm_view_token": r.hm_view_token, "view_url_path": f"/hm/{r.hm_view_token}"}


# ══════════════════════════════════════════════════════════════════════════
# CLIENT CONTACTS
# ══════════════════════════════════════════════════════════════════════════

@router.post("/client-contacts")
async def create_contact(payload: ClientContactCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    c = (await db.execute(select(Client).where(Client.id == payload.client_id, Client.user_id == current_user.id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Client not found")
    contact = ClientContact(
        organisation_id=org.id, client_id=payload.client_id, name=payload.name.strip(),
        title=payload.title.strip(), email=payload.email.strip(), phone=payload.phone.strip(),
        department=payload.department.strip(), is_primary=payload.is_primary, notes=payload.notes.strip(),
    )
    db.add(contact)
    await db.commit()
    await db.refresh(contact)
    return {
        "id": contact.id, "client_id": contact.client_id, "name": contact.name, "title": contact.title,
        "email": contact.email, "phone": contact.phone, "department": contact.department,
        "is_primary": contact.is_primary, "notes": contact.notes,
    }


@router.get("/client-contacts")
async def list_contacts(client_id: Optional[int] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    q = select(ClientContact).where(ClientContact.organisation_id == org.id)
    if client_id:
        q = q.where(ClientContact.client_id == client_id)
    rows = (await db.execute(q.order_by(ClientContact.is_primary.desc(), ClientContact.name))).scalars().all()
    return [{
        "id": c.id, "client_id": c.client_id, "name": c.name, "title": c.title or "",
        "email": c.email or "", "phone": c.phone or "", "department": c.department or "",
        "is_primary": c.is_primary, "notes": c.notes or "",
    } for c in rows]


@router.put("/client-contacts/{contact_id}")
async def update_contact(contact_id: int, payload: ClientContactUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    c = (await db.execute(select(ClientContact).where(ClientContact.id == contact_id, ClientContact.organisation_id == org.id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Contact not found")
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(c, field, value)
    c.updated_at = datetime.utcnow()
    await db.commit()
    return {"updated": True}


@router.delete("/client-contacts/{contact_id}")
async def delete_contact(contact_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    c = (await db.execute(select(ClientContact).where(ClientContact.id == contact_id, ClientContact.organisation_id == org.id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Contact not found")
    await db.delete(c)
    await db.commit()
    return {"deleted": True}
