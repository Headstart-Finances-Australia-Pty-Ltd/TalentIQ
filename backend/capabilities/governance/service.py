"""Service helpers for Governance (Phase 9)."""
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from capabilities.acquisition.models import Organisation
from .models import OrganisationMembership


async def get_effective_role(db: AsyncSession, org: Organisation, user_id: int) -> Optional[str]:
    """Returns "Owner", "Manager", "Recruiter", or None (not a member of
    this organisation at all). Checks Organisation.owner_user_id first
    (see models.py docstring for why the owner isn't a row in
    OrganisationMembership), then falls back to the membership table."""
    if org.owner_user_id == user_id:
        return "Owner"
    m = (await db.execute(
        select(OrganisationMembership).where(OrganisationMembership.organisation_id == org.id, OrganisationMembership.user_id == user_id)
    )).scalar_one_or_none()
    return m.role if m else None


def can_see_org_wide_data(role: Optional[str]) -> bool:
    """Owner and Manager see the whole organisation's reporting data;
    Recruiter sees only what they personally own (see router.py's
    metrics endpoints for where this is actually applied)."""
    return role in ("Owner", "Manager")
