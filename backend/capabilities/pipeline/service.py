"""Service helpers for Pipeline & Placements (Phase 5)."""
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .models import PipelineStage, PipelineEntry, Offer, Placement, DEFAULT_STAGE_TEMPLATE


async def ensure_default_stages(db: AsyncSession, organisation_id: int) -> None:
    """Seeds the organisation-wide default stage template (Submitted ->
    ... -> Placed/Rejected) the first time it's needed — lazy, same
    pattern as get_or_create_default_organisation, so nothing has to run
    at registration time. Safe to call repeatedly; no-ops once seeded.

    The count-then-insert check below has a real race window: two
    near-simultaneous calls (React StrictMode double-invoking an effect
    in dev, two tabs both loading a fresh org's first requisition, etc.)
    can both see zero existing rows before either has committed, and
    both go on to insert a full duplicate set of 5 defaults — this is
    exactly what caused every requisition falling back to defaults to
    show the same stages multiplied several times over (see the
    migration in db/migrate_fix.py that cleans up any duplicates this
    already produced). A partial unique index on
    (organisation_id, name) WHERE requisition_id IS NULL — also added in
    that migration — makes the LOSING side of that race fail on its
    INSERT instead of silently succeeding with a duplicate; catching
    that here and treating it as "someone else already seeded this"
    closes the race instead of just cleaning up after it once.
    """
    existing = (await db.execute(
        select(func.count()).select_from(PipelineStage)
        .where(PipelineStage.organisation_id == organisation_id, PipelineStage.requisition_id.is_(None))
    )).scalar()
    if existing:
        return
    try:
        for tpl in DEFAULT_STAGE_TEMPLATE:
            db.add(PipelineStage(organisation_id=organisation_id, requisition_id=None, **tpl))
        await db.flush()
    except IntegrityError:
        # Lost the race — another concurrent call already inserted these
        # (caught by the partial unique index). Roll back OUR half-applied
        # insert attempt and treat it the same as "already seeded".
        await db.rollback()


async def get_effective_stages(db: AsyncSession, organisation_id: int, requisition_id: int) -> list:
    """A requisition's own custom stages if it has any, else the
    organisation's default template — "configurable per requisition,
    falls back sensibly" rather than every new requisition starting with
    an empty board."""
    custom = (await db.execute(
        select(PipelineStage).where(PipelineStage.organisation_id == organisation_id, PipelineStage.requisition_id == requisition_id)
        .order_by(PipelineStage.sort_order)
    )).scalars().all()
    if custom:
        return custom
    await ensure_default_stages(db, organisation_id)
    defaults = (await db.execute(
        select(PipelineStage).where(PipelineStage.organisation_id == organisation_id, PipelineStage.requisition_id.is_(None))
        .order_by(PipelineStage.sort_order)
    )).scalars().all()
    return defaults


async def get_next_sequence(db: AsyncSession, organisation_id: int) -> int:
    r = await db.execute(select(func.max(PipelineEntry.sequence_number)).where(PipelineEntry.organisation_id == organisation_id))
    return (r.scalar() or 0) + 1


async def sync_application_stage_label(db: AsyncSession, application_id: int, stage_name: str) -> None:
    """Mirrors the structured stage name back onto Application.stage —
    that free-text column is a courtesy display field for anything else
    already reading it (e.g. Interview Management's auto-advance writes
    into it too); PipelineEntry.current_stage_id is the real source of
    truth here, not this."""
    from capabilities.acquisition.models import Application
    app_row = (await db.execute(select(Application).where(Application.id == application_id))).scalar_one_or_none()
    if app_row:
        app_row.stage = stage_name
        app_row.updated_at = datetime.utcnow()


async def create_placement_from_offer(db: AsyncSession, offer: Offer, guarantee_period_days: int = 90) -> Placement:
    """Called when an Offer transitions to Accepted — this is the
    "full close-out of a hire" the capability plan describes: a placement
    record appears automatically, with the guarantee period end date
    already computed, rather than the recruiter having to remember to
    create one and do the date math by hand."""
    start = offer.start_date or datetime.utcnow()
    placement = Placement(
        organisation_id=offer.organisation_id, offer_id=offer.id,
        candidate_id=offer.candidate_id, requisition_id=offer.requisition_id,
        start_date=start, fee_amount=offer.salary_offered,
        fee_currency=offer.salary_currency, guarantee_period_days=guarantee_period_days,
        guarantee_end_date=start + timedelta(days=guarantee_period_days),
        status="Active",
    )
    db.add(placement)
    await db.flush()
    # Onboarding checklist appears the moment the Placement does, not
    # only once someone remembers to open the Onboarding tab for this
    # hire — see capabilities/onboarding/service.py.
    from capabilities.onboarding.service import seed_default_tasks
    await seed_default_tasks(db, offer.organisation_id, placement.id)
    return placement


async def clear_placement_references(db: AsyncSession, placement_id: int) -> None:
    """Same defensive pattern as capabilities/acquisition's
    _clear_merge_references — Placement.replaces_placement_id is a
    self-referencing FK with no cascade-delete behavior (deliberately: a
    replacement's history shouldn't vanish if the original is deleted),
    so deleting a placement that some OTHER placement points back to
    would otherwise fail outright with a Postgres FK violation."""
    from sqlalchemy import update as sa_update
    await db.execute(
        sa_update(Placement).where(Placement.replaces_placement_id == placement_id).values(replaces_placement_id=None)
    )
