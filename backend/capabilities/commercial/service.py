"""Service helpers for Commercials (Phase 8)."""
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Invoice


async def get_next_sequence(db: AsyncSession, organisation_id: int) -> int:
    r = await db.execute(select(func.max(Invoice.sequence_number)).where(Invoice.organisation_id == organisation_id))
    return (r.scalar() or 0) + 1
