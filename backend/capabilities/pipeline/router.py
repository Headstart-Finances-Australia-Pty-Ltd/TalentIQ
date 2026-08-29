"""
TalentIQ — Capability: Pipeline & Placements (Phase 5, authenticated)

Registered in main.py as: /api/pipeline/*
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from db.database import get_db
from models.models import User
from utils.auth_utils import get_current_user
from capabilities.acquisition import service as acquisition_service
from capabilities.acquisition.models import Candidate, Application
from capabilities.requisition.models import Requisition
from capabilities.communication import service as service_communication

from .models import PipelineStage, PipelineEntry, PipelineStageHistory, Offer, Placement, OFFER_STATUSES, PLACEMENT_STATUSES
from .schemas import (
    StageCreate, StageUpdate, SubmitToPipeline, MoveStage, EntryUpdate,
    OfferCreate, OfferUpdate, OfferStatusChange,
    PlacementUpdate, PlacementStatusChange, BulkIds,
)
from . import service

router = APIRouter()


async def _org(db: AsyncSession, user: User):
    return await acquisition_service.get_or_create_default_organisation(db, user)


async def _requisition_title(db: AsyncSession, requisition_id: Optional[int]) -> str:
    if not requisition_id:
        return ""
    r = (await db.execute(select(Requisition).where(Requisition.id == requisition_id))).scalar_one_or_none()
    return r.title if r else ""


def _fmt_stage(s: PipelineStage) -> dict:
    return {
        "id": s.id, "requisition_id": s.requisition_id, "name": s.name,
        "sort_order": s.sort_order, "stage_type": s.stage_type, "color": s.color or "",
        "is_terminal": s.is_terminal,
    }


def _fmt_offer(o: Offer) -> dict:
    return {
        "id": o.id, "pipeline_entry_id": o.pipeline_entry_id,
        "candidate_id": o.candidate_id, "requisition_id": o.requisition_id,
        "salary_offered": float(o.salary_offered) if o.salary_offered is not None else None,
        "salary_currency": o.salary_currency, "status": o.status,
        "start_date": o.start_date.isoformat() if o.start_date else None,
        "expiry_date": o.expiry_date.isoformat() if o.expiry_date else None,
        "approved_by_user_id": o.approved_by_user_id,
        "approved_at": o.approved_at.isoformat() if o.approved_at else None,
        "notes": o.notes or "",
        "created_at": o.created_at.isoformat() if o.created_at else None,
    }


def _fmt_placement(p: Placement) -> dict:
    return {
        "id": p.id, "offer_id": p.offer_id, "candidate_id": p.candidate_id, "requisition_id": p.requisition_id,
        "start_date": p.start_date.isoformat() if p.start_date else None,
        "fee_amount": float(p.fee_amount) if p.fee_amount is not None else None,
        "fee_currency": p.fee_currency,
        "guarantee_period_days": p.guarantee_period_days,
        "guarantee_end_date": p.guarantee_end_date.isoformat() if p.guarantee_end_date else None,
        "status": p.status, "fell_through_reason": p.fell_through_reason or "",
        "replaces_placement_id": p.replaces_placement_id,
        "notes": p.notes or "",
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def _fmt_entry(e: PipelineEntry, candidate_name: str = "", requisition_title: str = "", stage_name: str = "", offers=None) -> dict:
    return {
        "id": e.id, "sequence_number": e.sequence_number,
        "application_id": e.application_id, "candidate_id": e.candidate_id, "candidate_name": candidate_name,
        "requisition_id": e.requisition_id, "requisition_title": requisition_title,
        "owner_user_id": e.owner_user_id,
        "current_stage_id": e.current_stage_id, "current_stage_name": stage_name,
        "stage_entered_at": e.stage_entered_at.isoformat() if e.stage_entered_at else None,
        "rejection_reason": e.rejection_reason or "", "notes": e.notes or "",
        "offers": offers if offers is not None else [],
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "updated_at": e.updated_at.isoformat() if e.updated_at else None,
    }


# ══════════════════════════════════════════════════════════════════════════
# STAGES
# ══════════════════════════════════════════════════════════════════════════

@router.get("/stages")
async def list_stages(requisition_id: Optional[int] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    if requisition_id:
        stages = await service.get_effective_stages(db, org.id, requisition_id)
    else:
        await service.ensure_default_stages(db, org.id)
        stages = (await db.execute(
            select(PipelineStage).where(PipelineStage.organisation_id == org.id, PipelineStage.requisition_id.is_(None))
            .order_by(PipelineStage.sort_order)
        )).scalars().all()
    return [_fmt_stage(s) for s in stages]


@router.post("/stages")
async def create_stage(payload: StageCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    stage = PipelineStage(
        organisation_id=org.id, requisition_id=payload.requisition_id,
        name=payload.name.strip(), sort_order=payload.sort_order,
        stage_type=payload.stage_type, color=payload.color,
    )
    db.add(stage)
    await db.commit()
    await db.refresh(stage)
    return _fmt_stage(stage)


@router.put("/stages/{stage_id}")
async def update_stage(stage_id: int, payload: StageUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    s = (await db.execute(select(PipelineStage).where(PipelineStage.id == stage_id, PipelineStage.organisation_id == org.id))).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Stage not found")
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(s, field, value)
    await db.commit()
    await db.refresh(s)
    return _fmt_stage(s)


@router.delete("/stages/{stage_id}")
async def delete_stage(stage_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    s = (await db.execute(select(PipelineStage).where(PipelineStage.id == stage_id, PipelineStage.organisation_id == org.id))).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Stage not found")
    in_use = (await db.execute(select(func.count()).select_from(PipelineEntry).where(PipelineEntry.current_stage_id == stage_id))).scalar()
    if in_use:
        raise HTTPException(400, f"Cannot delete this stage — {in_use} candidate(s) are currently in it. Move them first.")
    await db.delete(s)
    await db.commit()
    return {"deleted": True}


# ══════════════════════════════════════════════════════════════════════════
# PIPELINE ENTRIES (the Kanban board)
# ══════════════════════════════════════════════════════════════════════════

@router.post("/submit")
async def submit_to_pipeline(payload: SubmitToPipeline, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    candidate = (await db.execute(select(Candidate).where(Candidate.id == payload.candidate_id, Candidate.organisation_id == org.id))).scalar_one_or_none()
    if not candidate:
        raise HTTPException(404, "Candidate not found in your organisation.")
    req = (await db.execute(select(Requisition).where(Requisition.id == payload.requisition_id, Requisition.organisation_id == org.id))).scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Requisition not found in your organisation.")

    # Reuse an existing Application for this candidate+requisition pair
    # (e.g. one created via the public "Apply Now" career page) rather
    # than violating Application's uq_candidate_requisition constraint.
    application = (await db.execute(
        select(Application).where(Application.candidate_id == payload.candidate_id, Application.requisition_id == payload.requisition_id)
    )).scalar_one_or_none()
    if not application:
        application = Application(
            organisation_id=org.id, candidate_id=payload.candidate_id, requisition_id=payload.requisition_id,
            source="manual",
        )
        db.add(application)
        await db.flush()

    existing_entry = (await db.execute(select(PipelineEntry).where(PipelineEntry.application_id == application.id))).scalar_one_or_none()
    if existing_entry:
        raise HTTPException(409, "This candidate is already in this requisition's pipeline.")

    stages = await service.get_effective_stages(db, org.id, payload.requisition_id)
    first_stage = stages[0] if stages else None

    entry = PipelineEntry(
        organisation_id=org.id, sequence_number=await service.get_next_sequence(db, org.id),
        application_id=application.id, candidate_id=payload.candidate_id, requisition_id=payload.requisition_id,
        owner_user_id=payload.owner_user_id or current_user.id,
        current_stage_id=first_stage.id if first_stage else None,
        stage_entered_at=datetime.utcnow(), notes=payload.notes.strip(),
    )
    db.add(entry)
    await db.flush()
    if first_stage:
        db.add(PipelineStageHistory(pipeline_entry_id=entry.id, from_stage_id=None, to_stage_id=first_stage.id, changed_by_user_id=current_user.id))
        await service.sync_application_stage_label(db, application.id, first_stage.name)
    await db.commit()
    await db.refresh(entry)
    return _fmt_entry(entry, candidate.full_name, req.title, first_stage.name if first_stage else "")


@router.get("/board")
async def get_board(requisition_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Returns the Kanban board for one requisition: its effective stages,
    each with the pipeline entries currently sitting in it."""
    org = await _org(db, current_user)
    stages = await service.get_effective_stages(db, org.id, requisition_id)
    entries = (await db.execute(
        select(PipelineEntry).where(PipelineEntry.organisation_id == org.id, PipelineEntry.requisition_id == requisition_id)
    )).scalars().all()

    candidate_ids = {e.candidate_id for e in entries}
    candidate_names = {}
    if candidate_ids:
        res = await db.execute(select(Candidate.id, Candidate.full_name).where(Candidate.id.in_(candidate_ids)))
        candidate_names = dict(res.all())

    entry_ids = [e.id for e in entries]
    offer_counts = {}
    if entry_ids:
        res = await db.execute(
            select(Offer.pipeline_entry_id, func.count()).where(Offer.pipeline_entry_id.in_(entry_ids)).group_by(Offer.pipeline_entry_id)
        )
        offer_counts = dict(res.all())

    entries_by_stage: dict = {s.id: [] for s in stages}
    unassigned = []
    for e in entries:
        card = _fmt_entry(e, candidate_names.get(e.candidate_id, ""))
        card["offer_count"] = offer_counts.get(e.id, 0)
        card.pop("offers", None)
        if e.current_stage_id in entries_by_stage:
            entries_by_stage[e.current_stage_id].append(card)
        else:
            unassigned.append(card)

    return {
        "stages": [{**_fmt_stage(s), "entries": entries_by_stage.get(s.id, [])} for s in stages],
        "unassigned": unassigned,
    }


@router.get("/entries")
async def list_entries(
    requisition_id: Optional[int] = None, candidate_id: Optional[int] = None,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    org = await _org(db, current_user)
    q = select(PipelineEntry).where(PipelineEntry.organisation_id == org.id)
    if requisition_id:
        q = q.where(PipelineEntry.requisition_id == requisition_id)
    if candidate_id:
        q = q.where(PipelineEntry.candidate_id == candidate_id)
    entries = (await db.execute(q.order_by(PipelineEntry.created_at.desc()))).scalars().all()

    candidate_ids = {e.candidate_id for e in entries}
    requisition_ids = {e.requisition_id for e in entries}
    stage_ids = {e.current_stage_id for e in entries if e.current_stage_id}

    candidate_names = dict((await db.execute(select(Candidate.id, Candidate.full_name).where(Candidate.id.in_(candidate_ids)))).all()) if candidate_ids else {}
    requisition_titles = dict((await db.execute(select(Requisition.id, Requisition.title).where(Requisition.id.in_(requisition_ids)))).all()) if requisition_ids else {}
    stage_names = dict((await db.execute(select(PipelineStage.id, PipelineStage.name).where(PipelineStage.id.in_(stage_ids)))).all()) if stage_ids else {}

    return [
        _fmt_entry(e, candidate_names.get(e.candidate_id, ""), requisition_titles.get(e.requisition_id, ""), stage_names.get(e.current_stage_id, ""))
        for e in entries
    ]


@router.get("/entries/{entry_id}")
async def get_entry(entry_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    e = (await db.execute(select(PipelineEntry).where(PipelineEntry.id == entry_id, PipelineEntry.organisation_id == org.id))).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "Pipeline entry not found")
    candidate = (await db.execute(select(Candidate).where(Candidate.id == e.candidate_id))).scalar_one_or_none()
    req = (await db.execute(select(Requisition).where(Requisition.id == e.requisition_id))).scalar_one_or_none()
    stage = (await db.execute(select(PipelineStage).where(PipelineStage.id == e.current_stage_id))).scalar_one_or_none() if e.current_stage_id else None
    offers = (await db.execute(select(Offer).where(Offer.pipeline_entry_id == e.id))).scalars().all()
    return _fmt_entry(
        e, candidate.full_name if candidate else "", req.title if req else "", stage.name if stage else "",
        [_fmt_offer(o) for o in offers],
    )


@router.put("/entries/{entry_id}")
async def update_entry(entry_id: int, payload: EntryUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    e = (await db.execute(select(PipelineEntry).where(PipelineEntry.id == entry_id, PipelineEntry.organisation_id == org.id))).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "Pipeline entry not found")
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(e, field, value)
    e.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(e)
    return _fmt_entry(e)


@router.post("/entries/{entry_id}/move-stage")
async def move_stage(entry_id: int, payload: MoveStage, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    e = (await db.execute(select(PipelineEntry).where(PipelineEntry.id == entry_id, PipelineEntry.organisation_id == org.id))).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "Pipeline entry not found")
    new_stage = (await db.execute(select(PipelineStage).where(PipelineStage.id == payload.stage_id, PipelineStage.organisation_id == org.id))).scalar_one_or_none()
    if not new_stage:
        raise HTTPException(404, "Stage not found")

    old_stage_id = e.current_stage_id
    e.current_stage_id = new_stage.id
    e.stage_entered_at = datetime.utcnow()
    e.updated_at = datetime.utcnow()
    db.add(PipelineStageHistory(
        pipeline_entry_id=e.id, from_stage_id=old_stage_id, to_stage_id=new_stage.id,
        changed_by_user_id=current_user.id, notes=payload.notes.strip(),
    ))
    await service.sync_application_stage_label(db, e.application_id, new_stage.name)
    await db.commit()
    await db.refresh(e)

    candidate = (await db.execute(select(Candidate).where(Candidate.id == e.candidate_id))).scalar_one_or_none()
    req_title = await _requisition_title(db, e.requisition_id)
    await service_communication.fire_automation(
        db, org.id, "pipeline_stage_changed",
        context={"candidate_name": candidate.full_name if candidate else "", "requisition_title": req_title, "stage_name": new_stage.name},
        triggering_user_id=current_user.id, to_email=(candidate.email if candidate else None) or None,
        candidate_id=e.candidate_id, requisition_id=e.requisition_id, pipeline_entry_id=e.id,
        trigger_stage_name=new_stage.name,
    )
    await db.commit()

    return _fmt_entry(e, stage_name=new_stage.name)


@router.get("/entries/{entry_id}/history")
async def get_stage_history(entry_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    e = (await db.execute(select(PipelineEntry).where(PipelineEntry.id == entry_id, PipelineEntry.organisation_id == org.id))).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "Pipeline entry not found")
    rows = (await db.execute(
        select(PipelineStageHistory).where(PipelineStageHistory.pipeline_entry_id == entry_id).order_by(PipelineStageHistory.changed_at)
    )).scalars().all()
    stage_ids = {h.from_stage_id for h in rows if h.from_stage_id} | {h.to_stage_id for h in rows}
    stage_names = dict((await db.execute(select(PipelineStage.id, PipelineStage.name).where(PipelineStage.id.in_(stage_ids)))).all()) if stage_ids else {}
    return [
        {
            "id": h.id, "from_stage": stage_names.get(h.from_stage_id, ""), "to_stage": stage_names.get(h.to_stage_id, ""),
            "notes": h.notes or "", "changed_at": h.changed_at.isoformat() if h.changed_at else None,
        }
        for h in rows
    ]


@router.delete("/entries/{entry_id}")
async def delete_entry(entry_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    e = (await db.execute(select(PipelineEntry).where(PipelineEntry.id == entry_id, PipelineEntry.organisation_id == org.id))).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "Pipeline entry not found")
    await db.delete(e)
    await db.commit()
    return {"deleted": True}


@router.post("/entries/bulk-delete")
async def bulk_delete_entries(payload: BulkIds, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    rows = (await db.execute(select(PipelineEntry).where(PipelineEntry.id.in_(payload.ids), PipelineEntry.organisation_id == org.id))).scalars().all()
    for e in rows:
        await db.delete(e)
    await db.commit()
    return {"deleted": len(rows)}


# ══════════════════════════════════════════════════════════════════════════
# OFFERS
# ══════════════════════════════════════════════════════════════════════════

@router.post("/entries/{entry_id}/offers")
async def create_offer(entry_id: int, payload: OfferCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    e = (await db.execute(select(PipelineEntry).where(PipelineEntry.id == entry_id, PipelineEntry.organisation_id == org.id))).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "Pipeline entry not found")
    offer = Offer(
        organisation_id=org.id, pipeline_entry_id=entry_id, candidate_id=e.candidate_id, requisition_id=e.requisition_id,
        salary_offered=payload.salary_offered, salary_currency=payload.salary_currency,
        start_date=payload.start_date, expiry_date=payload.expiry_date, notes=payload.notes.strip(),
        status="Draft",
    )
    db.add(offer)
    await db.commit()
    await db.refresh(offer)
    return _fmt_offer(offer)


@router.get("/offers")
async def list_offers(status: Optional[str] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    q = select(Offer).where(Offer.organisation_id == org.id)
    if status:
        q = q.where(Offer.status == status)
    rows = (await db.execute(q.order_by(Offer.created_at.desc()))).scalars().all()

    candidate_ids = {o.candidate_id for o in rows}
    requisition_ids = {o.requisition_id for o in rows}
    candidate_names = dict((await db.execute(select(Candidate.id, Candidate.full_name).where(Candidate.id.in_(candidate_ids)))).all()) if candidate_ids else {}
    requisition_titles = dict((await db.execute(select(Requisition.id, Requisition.title).where(Requisition.id.in_(requisition_ids)))).all()) if requisition_ids else {}

    out = []
    for o in rows:
        d = _fmt_offer(o)
        d["candidate_name"] = candidate_names.get(o.candidate_id, "")
        d["requisition_title"] = requisition_titles.get(o.requisition_id, "")
        out.append(d)
    return out


@router.put("/offers/{offer_id}")
async def update_offer(offer_id: int, payload: OfferUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    o = (await db.execute(select(Offer).where(Offer.id == offer_id, Offer.organisation_id == org.id))).scalar_one_or_none()
    if not o:
        raise HTTPException(404, "Offer not found")
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(o, field, value)
    o.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(o)
    return _fmt_offer(o)


@router.post("/offers/{offer_id}/status")
async def change_offer_status(offer_id: int, payload: OfferStatusChange, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if payload.status not in OFFER_STATUSES:
        raise HTTPException(400, f"Status must be one of: {', '.join(OFFER_STATUSES)}")
    org = await _org(db, current_user)
    o = (await db.execute(select(Offer).where(Offer.id == offer_id, Offer.organisation_id == org.id))).scalar_one_or_none()
    if not o:
        raise HTTPException(404, "Offer not found")

    if payload.status == "Approved":
        o.approved_by_user_id = current_user.id
        o.approved_at = datetime.utcnow()

    o.status = payload.status
    o.updated_at = datetime.utcnow()

    placement = None
    if payload.status == "Accepted":
        existing_placement = (await db.execute(select(Placement).where(Placement.offer_id == o.id))).scalar_one_or_none()
        if not existing_placement:
            placement = await service.create_placement_from_offer(db, o)
        # Auto-advance the pipeline entry (and its Application) to a
        # "Placed" stage if the requisition has one — the "auto-updates
        # candidate stage" behavior this capability plan calls for.
        entry = (await db.execute(select(PipelineEntry).where(PipelineEntry.id == o.pipeline_entry_id))).scalar_one_or_none()
        if entry:
            stages = await service.get_effective_stages(db, org.id, entry.requisition_id)
            placed_stage = next((s for s in stages if s.stage_type == "placed"), None)
            if placed_stage:
                # Capture the OLD stage BEFORE overwriting current_stage_id —
                # doing this in the other order (as an earlier version of
                # this code did) meant from_stage_id and to_stage_id ended
                # up identical, since entry.current_stage_id had already
                # been mutated by the time the history row read it. Caught
                # by actually inspecting the resulting history log, not by
                # re-reading the code.
                previous_stage_id = entry.current_stage_id
                entry.current_stage_id = placed_stage.id
                entry.stage_entered_at = datetime.utcnow()
                db.add(PipelineStageHistory(pipeline_entry_id=entry.id, from_stage_id=previous_stage_id, to_stage_id=placed_stage.id, changed_by_user_id=current_user.id, notes="Auto-advanced on offer acceptance"))
                await service.sync_application_stage_label(db, entry.application_id, placed_stage.name)

    await db.commit()
    await db.refresh(o)
    result = _fmt_offer(o)
    if placement:
        await db.refresh(placement)
        result["placement"] = _fmt_placement(placement)

    if payload.status in ("Sent", "Accepted", "Rejected"):
        candidate = (await db.execute(select(Candidate).where(Candidate.id == o.candidate_id))).scalar_one_or_none()
        req_title = await _requisition_title(db, o.requisition_id)
        trigger_map = {"Sent": "offer_sent", "Accepted": "offer_accepted", "Rejected": "offer_rejected"}
        await service_communication.fire_automation(
            db, org.id, trigger_map[payload.status],
            context={"candidate_name": candidate.full_name if candidate else "", "requisition_title": req_title,
                     "offer_salary": str(o.salary_offered) if o.salary_offered else "", "offer_currency": o.salary_currency or ""},
            triggering_user_id=current_user.id, to_email=(candidate.email if candidate else None) or None,
            candidate_id=o.candidate_id, requisition_id=o.requisition_id, pipeline_entry_id=o.pipeline_entry_id,
        )
        if placement:
            await service_communication.fire_automation(
                db, org.id, "placement_created",
                context={"candidate_name": candidate.full_name if candidate else "", "requisition_title": req_title},
                triggering_user_id=current_user.id, to_email=(candidate.email if candidate else None) or None,
                candidate_id=o.candidate_id, requisition_id=o.requisition_id,
            )
        await db.commit()

    return result


@router.delete("/offers/{offer_id}")
async def delete_offer(offer_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    o = (await db.execute(select(Offer).where(Offer.id == offer_id, Offer.organisation_id == org.id))).scalar_one_or_none()
    if not o:
        raise HTTPException(404, "Offer not found")
    await db.delete(o)  # cascades to its placement, if any, via relationship cascade
    await db.commit()
    return {"deleted": True}


# ══════════════════════════════════════════════════════════════════════════
# PLACEMENTS
# ══════════════════════════════════════════════════════════════════════════

@router.get("/placements")
async def list_placements(status: Optional[str] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    q = select(Placement).where(Placement.organisation_id == org.id)
    if status:
        q = q.where(Placement.status == status)
    rows = (await db.execute(q.order_by(Placement.created_at.desc()))).scalars().all()

    candidate_ids = {p.candidate_id for p in rows}
    requisition_ids = {p.requisition_id for p in rows}
    candidate_names = dict((await db.execute(select(Candidate.id, Candidate.full_name).where(Candidate.id.in_(candidate_ids)))).all()) if candidate_ids else {}
    requisition_titles = dict((await db.execute(select(Requisition.id, Requisition.title).where(Requisition.id.in_(requisition_ids)))).all()) if requisition_ids else {}

    out = []
    for p in rows:
        d = _fmt_placement(p)
        d["candidate_name"] = candidate_names.get(p.candidate_id, "")
        d["requisition_title"] = requisition_titles.get(p.requisition_id, "")
        out.append(d)
    return out


@router.put("/placements/{placement_id}")
async def update_placement(placement_id: int, payload: PlacementUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    p = (await db.execute(select(Placement).where(Placement.id == placement_id, Placement.organisation_id == org.id))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Placement not found")
    data = payload.dict(exclude_unset=True)
    for field, value in data.items():
        setattr(p, field, value)
    if "start_date" in data or "guarantee_period_days" in data:
        from datetime import timedelta
        p.guarantee_end_date = p.start_date + timedelta(days=p.guarantee_period_days)
    p.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(p)
    return _fmt_placement(p)


@router.post("/placements/{placement_id}/status")
async def change_placement_status(placement_id: int, payload: PlacementStatusChange, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if payload.status not in PLACEMENT_STATUSES:
        raise HTTPException(400, f"Status must be one of: {', '.join(PLACEMENT_STATUSES)}")
    org = await _org(db, current_user)
    p = (await db.execute(select(Placement).where(Placement.id == placement_id, Placement.organisation_id == org.id))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Placement not found")
    p.status = payload.status
    if payload.status == "Fell Through":
        p.fell_through_reason = payload.fell_through_reason.strip()
    p.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(p)
    return _fmt_placement(p)


@router.delete("/placements/{placement_id}")
async def delete_placement(placement_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    p = (await db.execute(select(Placement).where(Placement.id == placement_id, Placement.organisation_id == org.id))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Placement not found")
    await service.clear_placement_references(db, placement_id)
    await db.delete(p)
    await db.commit()
    return {"deleted": True}
