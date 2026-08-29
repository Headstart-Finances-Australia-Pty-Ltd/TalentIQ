from sqlalchemy.ext.asyncio import AsyncSession
from .models import OnboardingTask, DEFAULT_ONBOARDING_TASKS


async def seed_default_tasks(db: AsyncSession, organisation_id: int, placement_id: int) -> None:
    """Called right after a Placement is created (see pipeline/service.py's
    create_placement_from_offer) so a fresh hire's onboarding checklist
    exists immediately, not only once someone remembers to open the
    Onboarding tab for them. Uses db.add + flush, matching the caller's
    own not-yet-committed transaction — the caller commits once, for the
    Placement and this checklist together."""
    for i, task in enumerate(DEFAULT_ONBOARDING_TASKS):
        db.add(OnboardingTask(
            organisation_id=organisation_id, placement_id=placement_id,
            title=task["title"], category=task["category"], sort_order=i,
        ))
    await db.flush()
