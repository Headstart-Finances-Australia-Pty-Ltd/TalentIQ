"""
TalentIQ — Capability: Commercials (Phase 8, authenticated)

Registered in main.py as: /api/commercials/*
"""
from datetime import datetime, date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update as sa_update

from db.database import get_db
from models.models import User
from utils.auth_utils import get_current_user
from capabilities.acquisition import service as acquisition_service
from capabilities.acquisition.models import Candidate
from capabilities.requisition.models import Requisition
from capabilities.pipeline.models import Placement

from .models import Invoice, TimesheetEntry, INVOICE_STATUSES, TIMESHEET_STATUSES
from .schemas import (
    InvoiceCreate, InvoiceUpdate, InvoiceStatusChange,
    TimesheetCreate, TimesheetUpdate, TimesheetsToInvoice,
)
from . import service

router = APIRouter()


async def _org(db: AsyncSession, user: User):
    return await acquisition_service.get_or_create_default_organisation(db, user)


def _fmt_invoice(i: Invoice, candidate_name: str = "", requisition_title: str = "") -> dict:
    return {
        "id": i.id, "sequence_number": i.sequence_number, "placement_id": i.placement_id,
        "client_id": i.client_id, "requisition_id": i.requisition_id, "requisition_title": requisition_title,
        "candidate_name": candidate_name,
        "invoice_number": i.invoice_number or "", "description": i.description or "",
        "amount": float(i.amount) if i.amount is not None else None, "currency": i.currency,
        "status": i.status,
        "issue_date": i.issue_date.isoformat() if i.issue_date else None,
        "due_date": i.due_date.isoformat() if i.due_date else None,
        "paid_date": i.paid_date.isoformat() if i.paid_date else None,
        "notes": i.notes or "",
        "created_at": i.created_at.isoformat() if i.created_at else None,
    }


def _fmt_timesheet(t: TimesheetEntry, candidate_name: str = "") -> dict:
    return {
        "id": t.id, "placement_id": t.placement_id, "candidate_name": candidate_name,
        "week_ending": t.week_ending.isoformat() if t.week_ending else None,
        "hours": float(t.hours) if t.hours is not None else None,
        "rate": float(t.rate) if t.rate is not None else None,
        "currency": t.currency, "amount": t.amount,
        "status": t.status, "invoice_id": t.invoice_id, "notes": t.notes or "",
        "submitted_at": t.submitted_at.isoformat() if t.submitted_at else None,
        "approved_at": t.approved_at.isoformat() if t.approved_at else None,
    }


async def _placement_context(db: AsyncSession, placement_id: int, org_id: int):
    p = (await db.execute(select(Placement).where(Placement.id == placement_id, Placement.organisation_id == org_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Placement not found in your organisation.")
    candidate = (await db.execute(select(Candidate).where(Candidate.id == p.candidate_id))).scalar_one_or_none()
    req = (await db.execute(select(Requisition).where(Requisition.id == p.requisition_id))).scalar_one_or_none()
    return p, (candidate.full_name if candidate else ""), (req.title if req else ""), (req.client_id if req else None)


# ══════════════════════════════════════════════════════════════════════════
# INVOICES
# ══════════════════════════════════════════════════════════════════════════

@router.post("/invoices")
async def create_invoice(payload: InvoiceCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    placement, candidate_name, req_title, client_id = await _placement_context(db, payload.placement_id, org.id)

    amount = payload.amount if payload.amount is not None else (float(placement.fee_amount) if placement.fee_amount is not None else None)
    if amount is None:
        raise HTTPException(400, "This placement has no fee amount on file — provide an amount explicitly.")
    currency = payload.currency or placement.fee_currency or "AUD"

    invoice = Invoice(
        organisation_id=org.id, sequence_number=await service.get_next_sequence(db, org.id),
        placement_id=placement.id, client_id=client_id, requisition_id=placement.requisition_id,
        description=payload.description.strip() or f"Placement fee — {candidate_name}".strip(),
        amount=amount, currency=currency, status="Draft",
        issue_date=payload.issue_date, due_date=payload.due_date, notes=payload.notes.strip(),
    )
    db.add(invoice)
    await db.commit()
    await db.refresh(invoice)
    return _fmt_invoice(invoice, candidate_name, req_title)


@router.get("/invoices")
async def list_invoices(status: Optional[str] = None, client_id: Optional[int] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    q = select(Invoice).where(Invoice.organisation_id == org.id)
    if status:
        q = q.where(Invoice.status == status)
    if client_id:
        q = q.where(Invoice.client_id == client_id)
    rows = (await db.execute(q.order_by(Invoice.created_at.desc()))).scalars().all()

    placement_ids = {i.placement_id for i in rows}
    placements = {p.id: p for p in (await db.execute(select(Placement).where(Placement.id.in_(placement_ids)))).scalars().all()} if placement_ids else {}
    candidate_ids = {p.candidate_id for p in placements.values()}
    candidate_names = dict((await db.execute(select(Candidate.id, Candidate.full_name).where(Candidate.id.in_(candidate_ids)))).all()) if candidate_ids else {}
    requisition_ids = {i.requisition_id for i in rows if i.requisition_id}
    requisition_titles = dict((await db.execute(select(Requisition.id, Requisition.title).where(Requisition.id.in_(requisition_ids)))).all()) if requisition_ids else {}

    out = []
    for i in rows:
        p = placements.get(i.placement_id)
        cname = candidate_names.get(p.candidate_id, "") if p else ""
        out.append(_fmt_invoice(i, cname, requisition_titles.get(i.requisition_id, "")))
    return out


@router.put("/invoices/{invoice_id}")
async def update_invoice(invoice_id: int, payload: InvoiceUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    i = (await db.execute(select(Invoice).where(Invoice.id == invoice_id, Invoice.organisation_id == org.id))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Invoice not found")
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(i, field, value)
    i.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(i)
    return _fmt_invoice(i)


@router.post("/invoices/{invoice_id}/status")
async def change_invoice_status(invoice_id: int, payload: InvoiceStatusChange, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if payload.status not in INVOICE_STATUSES:
        raise HTTPException(400, f"Status must be one of: {', '.join(INVOICE_STATUSES)}")
    org = await _org(db, current_user)
    i = (await db.execute(select(Invoice).where(Invoice.id == invoice_id, Invoice.organisation_id == org.id))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Invoice not found")
    i.status = payload.status
    if payload.status == "Paid" and not i.paid_date:
        i.paid_date = date.today()
    i.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(i)
    return _fmt_invoice(i)


@router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    i = (await db.execute(select(Invoice).where(Invoice.id == invoice_id, Invoice.organisation_id == org.id))).scalar_one_or_none()
    if not i:
        raise HTTPException(404, "Invoice not found")
    # Un-link any timesheet entries that were rolled into this invoice —
    # same defensive pattern as clearing merge/placement references
    # elsewhere in this app, so deleting an invoice never leaves a
    # timesheet pointing at a row that no longer exists.
    await db.execute(
        sa_update(TimesheetEntry).where(TimesheetEntry.invoice_id == invoice_id).values(invoice_id=None, status="Approved")
    )
    await db.delete(i)
    await db.commit()
    return {"deleted": True}


# ══════════════════════════════════════════════════════════════════════════
# GUARANTEE / REBATE ALERTS
# ══════════════════════════════════════════════════════════════════════════

@router.get("/guarantee-alerts")
async def get_guarantee_alerts(days: int = 14, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Placements whose guarantee period ends within `days` days —
    reuses Placement.guarantee_end_date (computed since Phase 5, see
    module docstring) rather than tracking a second copy of that date
    here. Only placements still actually "live" (Active or Guarantee
    Period) are surfaced — one that's already Fell Through, Completed, or
    Replaced doesn't need a deadline warning anymore."""
    org = await _org(db, current_user)
    now = datetime.utcnow()
    cutoff = now + timedelta(days=days)
    rows = (await db.execute(
        select(Placement).where(
            Placement.organisation_id == org.id,
            Placement.status.in_(["Active", "Guarantee Period"]),
            Placement.guarantee_end_date.isnot(None),
            Placement.guarantee_end_date <= cutoff,
        ).order_by(Placement.guarantee_end_date)
    )).scalars().all()

    candidate_ids = {p.candidate_id for p in rows}
    requisition_ids = {p.requisition_id for p in rows}
    candidate_names = dict((await db.execute(select(Candidate.id, Candidate.full_name).where(Candidate.id.in_(candidate_ids)))).all()) if candidate_ids else {}
    requisition_titles = dict((await db.execute(select(Requisition.id, Requisition.title).where(Requisition.id.in_(requisition_ids)))).all()) if requisition_ids else {}

    return [
        {
            "placement_id": p.id, "candidate_name": candidate_names.get(p.candidate_id, ""),
            "requisition_title": requisition_titles.get(p.requisition_id, ""),
            "guarantee_end_date": p.guarantee_end_date.isoformat() if p.guarantee_end_date else None,
            "days_remaining": (p.guarantee_end_date - now).days if p.guarantee_end_date else None,
            "status": p.status,
        }
        for p in rows
    ]


# ══════════════════════════════════════════════════════════════════════════
# REVENUE REPORT
# ══════════════════════════════════════════════════════════════════════════

@router.get("/revenue")
async def get_revenue_report(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    rows = (await db.execute(select(Invoice).where(Invoice.organisation_id == org.id))).scalars().all()

    total_invoiced = sum(float(i.amount) for i in rows if i.status != "Cancelled")
    total_paid = sum(float(i.amount) for i in rows if i.status == "Paid")
    total_outstanding = sum(float(i.amount) for i in rows if i.status in ("Sent", "Overdue"))

    by_requisition: dict = {}
    requisition_ids = {i.requisition_id for i in rows if i.requisition_id}
    requisition_titles = dict((await db.execute(select(Requisition.id, Requisition.title).where(Requisition.id.in_(requisition_ids)))).all()) if requisition_ids else {}
    for i in rows:
        if i.status == "Cancelled":
            continue
        key = i.requisition_id
        title = requisition_titles.get(key, "Unassigned")
        by_requisition.setdefault(title, 0)
        by_requisition[title] += float(i.amount)

    by_month: dict = {}
    for i in rows:
        if i.status == "Cancelled" or not i.issue_date:
            continue
        key = i.issue_date.strftime("%Y-%m")
        by_month.setdefault(key, 0)
        by_month[key] += float(i.amount)

    return {
        "total_invoiced": total_invoiced, "total_paid": total_paid, "total_outstanding": total_outstanding,
        "invoice_count": len([i for i in rows if i.status != "Cancelled"]),
        "by_requisition": [{"requisition_title": k, "amount": v} for k, v in sorted(by_requisition.items(), key=lambda x: -x[1])],
        "by_month": [{"month": k, "amount": v} for k, v in sorted(by_month.items())],
    }


# ══════════════════════════════════════════════════════════════════════════
# TIMESHEETS (optional — contract placements)
# ══════════════════════════════════════════════════════════════════════════

@router.post("/timesheets")
async def create_timesheet(payload: TimesheetCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    await _placement_context(db, payload.placement_id, org.id)   # validates the placement exists in this org
    t = TimesheetEntry(
        organisation_id=org.id, placement_id=payload.placement_id, week_ending=payload.week_ending,
        hours=payload.hours, rate=payload.rate, currency=payload.currency, notes=payload.notes.strip(),
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return _fmt_timesheet(t)


@router.get("/timesheets")
async def list_timesheets(placement_id: Optional[int] = None, status: Optional[str] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    q = select(TimesheetEntry).where(TimesheetEntry.organisation_id == org.id)
    if placement_id:
        q = q.where(TimesheetEntry.placement_id == placement_id)
    if status:
        q = q.where(TimesheetEntry.status == status)
    rows = (await db.execute(q.order_by(TimesheetEntry.week_ending.desc()))).scalars().all()

    placement_ids = {t.placement_id for t in rows}
    placements = {p.id: p for p in (await db.execute(select(Placement).where(Placement.id.in_(placement_ids)))).scalars().all()} if placement_ids else {}
    candidate_ids = {p.candidate_id for p in placements.values()}
    candidate_names = dict((await db.execute(select(Candidate.id, Candidate.full_name).where(Candidate.id.in_(candidate_ids)))).all()) if candidate_ids else {}

    out = []
    for t in rows:
        p = placements.get(t.placement_id)
        out.append(_fmt_timesheet(t, candidate_names.get(p.candidate_id, "") if p else ""))
    return out


@router.put("/timesheets/{timesheet_id}")
async def update_timesheet(timesheet_id: int, payload: TimesheetUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    t = (await db.execute(select(TimesheetEntry).where(TimesheetEntry.id == timesheet_id, TimesheetEntry.organisation_id == org.id))).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Timesheet entry not found")
    if t.status != "Submitted":
        raise HTTPException(400, f"Cannot edit a timesheet that's already {t.status.lower()}.")
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(t, field, value)
    await db.commit()
    await db.refresh(t)
    return _fmt_timesheet(t)


@router.post("/timesheets/{timesheet_id}/approve")
async def approve_timesheet(timesheet_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    t = (await db.execute(select(TimesheetEntry).where(TimesheetEntry.id == timesheet_id, TimesheetEntry.organisation_id == org.id))).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Timesheet entry not found")
    t.status = "Approved"
    t.approved_by_user_id = current_user.id
    t.approved_at = datetime.utcnow()
    await db.commit()
    await db.refresh(t)
    return _fmt_timesheet(t)


@router.delete("/timesheets/{timesheet_id}")
async def delete_timesheet(timesheet_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    t = (await db.execute(select(TimesheetEntry).where(TimesheetEntry.id == timesheet_id, TimesheetEntry.organisation_id == org.id))).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Timesheet entry not found")
    await db.delete(t)
    await db.commit()
    return {"deleted": True}


@router.post("/timesheets/to-invoice")
async def timesheets_to_invoice(payload: TimesheetsToInvoice, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Rolls a set of Approved timesheet entries into a single invoice —
    the entries must all belong to the SAME placement (an invoice is
    against one placement, see Invoice.placement_id)."""
    org = await _org(db, current_user)
    entries = (await db.execute(
        select(TimesheetEntry).where(TimesheetEntry.id.in_(payload.timesheet_ids), TimesheetEntry.organisation_id == org.id)
    )).scalars().all()
    if not entries:
        raise HTTPException(404, "No matching timesheet entries found.")
    not_approved = [e for e in entries if e.status != "Approved"]
    if not_approved:
        raise HTTPException(400, f"{len(not_approved)} of the selected entries aren't Approved yet.")
    placement_ids = {e.placement_id for e in entries}
    if len(placement_ids) > 1:
        raise HTTPException(400, "All selected timesheet entries must belong to the same placement.")
    placement_id = placement_ids.pop()

    placement, candidate_name, req_title, client_id = await _placement_context(db, placement_id, org.id)
    total = sum(e.amount for e in entries)
    currency = entries[0].currency or "AUD"

    invoice = Invoice(
        organisation_id=org.id, sequence_number=await service.get_next_sequence(db, org.id),
        placement_id=placement_id, client_id=client_id, requisition_id=placement.requisition_id,
        description=payload.description.strip() or f"Contract hours — {candidate_name} ({len(entries)} week(s))",
        amount=total, currency=currency, status="Draft",
    )
    db.add(invoice)
    await db.flush()
    for e in entries:
        e.status = "Invoiced"
        e.invoice_id = invoice.id
    await db.commit()
    await db.refresh(invoice)
    return _fmt_invoice(invoice, candidate_name, req_title)
