"""
TalentIQ — Capability: Governance (Phase 9, authenticated)

Registered in main.py as: /api/governance/*
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from db.database import get_db
from models.models import User, Client
from utils.auth_utils import get_current_user
from capabilities.acquisition import service as acquisition_service
from capabilities.acquisition.models import Candidate
from capabilities.requisition.models import Requisition
from capabilities.pipeline.models import PipelineEntry, PipelineStage, Offer, Placement
from capabilities.portal.models import VendorSubmission
from capabilities.interview.models import Interview
from models.models import Vendor

from .models import OrganisationMembership, MEMBER_ROLES
from .schemas import InviteMember, MembershipRoleChange
from . import service

router = APIRouter()


async def _org(db: AsyncSession, user: User):
    return await acquisition_service.get_or_create_default_organisation(db, user)


async def _resolve_org_context(db: AsyncSession, user: User, org_id: Optional[int]):
    """Every Governance endpoint accepts an optional org_id, so a user who
    was invited into someone ELSE's organisation (as Manager or
    Recruiter) can actually act within it, not just appear in its team
    list with no way to use that membership.

    Without this, _org() alone always resolves to "the organisation I
    personally own" (get_or_create_default_organisation is strictly
    per-owner — see its own docstring), which would make inviting someone
    onto your team purely cosmetic: they'd show up in /team, but /me and
    every /metrics/* call would keep showing THEIR OWN org, never yours —
    confirmed live before this fix existed (Bob, invited as Recruiter
    into Alice's org, still resolved to his own org as Owner).

    Stated boundary, honestly: this resolves org context for Governance's
    OWN endpoints only. The other eight capabilities built this session
    (Requisitions, Candidates, Interviews, Pipeline, Portals, Comms,
    Commercials) still call plain _org()/get_or_create_default_organisation
    everywhere, meaning an invited team member still can't act on THOSE
    capabilities' data within someone else's org — only view that org's
    Governance reporting. Extending org-context switching to all eight
    already-shipped capabilities is a substantially larger, cross-cutting
    change that deserves its own careful pass, not a rushed addition
    bolted onto this one.
    """
    own_org = await acquisition_service.get_or_create_default_organisation(db, user)
    if org_id is None or org_id == own_org.id:
        return own_org, "Owner"

    from capabilities.acquisition.models import Organisation
    target_org = (await db.execute(select(Organisation).where(Organisation.id == org_id))).scalar_one_or_none()
    if not target_org:
        raise HTTPException(404, "Organisation not found.")
    role = await service.get_effective_role(db, target_org, user.id)
    if not role:
        raise HTTPException(403, "You're not a member of that organisation.")
    return target_org, role


async def _require_manager_or_owner(db: AsyncSession, org, user: User) -> str:
    role = await service.get_effective_role(db, org, user.id)
    if role not in ("Owner", "Manager"):
        raise HTTPException(403, "Only an Owner or Manager can do this.")
    return role


# ══════════════════════════════════════════════════════════════════════════
# TEAM & ACCESS
# ══════════════════════════════════════════════════════════════════════════

@router.get("/me")
async def get_my_role(org_id: Optional[int] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org, role = await _resolve_org_context(db, current_user, org_id)
    return {"organisation_id": org.id, "role": role}


@router.get("/organisations")
async def list_my_organisations(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Every organisation this user can act within — their own, plus any
    they've been invited into as Manager/Recruiter. Lets the frontend
    offer an org switcher instead of the user only ever seeing their own
    (see _resolve_org_context's docstring for why that distinction now
    exists)."""
    own_org = await _org(db, current_user)
    memberships = (await db.execute(select(OrganisationMembership).where(OrganisationMembership.user_id == current_user.id))).scalars().all()
    from capabilities.acquisition.models import Organisation
    other_org_ids = [m.organisation_id for m in memberships]
    other_orgs = {o.id: o for o in (await db.execute(select(Organisation).where(Organisation.id.in_(other_org_ids)))).scalars().all()} if other_org_ids else {}
    role_by_org = {m.organisation_id: m.role for m in memberships}

    result = [{"organisation_id": own_org.id, "name": own_org.name, "role": "Owner"}]
    for org_id, org in other_orgs.items():
        result.append({"organisation_id": org.id, "name": org.name, "role": role_by_org.get(org_id, "")})
    return result


@router.get("/team")
async def list_team(org_id: Optional[int] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org, _role = await _resolve_org_context(db, current_user, org_id)
    owner = (await db.execute(select(User).where(User.id == org.owner_user_id))).scalar_one_or_none()
    memberships = (await db.execute(select(OrganisationMembership).where(OrganisationMembership.organisation_id == org.id))).scalars().all()

    user_ids = {m.user_id for m in memberships}
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()} if user_ids else {}

    members = []
    if owner:
        members.append({"membership_id": None, "user_id": owner.id, "name": owner.name, "email": owner.email, "role": "Owner", "joined_at": None})
    for m in memberships:
        u = users.get(m.user_id)
        if u:
            members.append({"membership_id": m.id, "user_id": u.id, "name": u.name, "email": u.email, "role": m.role, "joined_at": m.joined_at.isoformat() if m.joined_at else None})
    return members


@router.post("/team/invite")
async def invite_member(payload: InviteMember, org_id: Optional[int] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org, _role = await _resolve_org_context(db, current_user, org_id)
    await _require_manager_or_owner(db, org, current_user)
    if payload.role not in MEMBER_ROLES:
        raise HTTPException(400, f"role must be one of: {', '.join(MEMBER_ROLES)}")

    invitee = (await db.execute(select(User).where(User.email == payload.email.strip().lower()))).scalar_one_or_none()
    if not invitee:
        raise HTTPException(404, f"No TalentIQ account found for {payload.email} — they need to register first, then you can add them to your team.")
    if invitee.id == org.owner_user_id:
        raise HTTPException(400, "This person already owns the organisation.")
    existing = (await db.execute(
        select(OrganisationMembership).where(OrganisationMembership.organisation_id == org.id, OrganisationMembership.user_id == invitee.id)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(409, f"{invitee.name or invitee.email} is already on your team.")

    membership = OrganisationMembership(organisation_id=org.id, user_id=invitee.id, role=payload.role, invited_by_user_id=current_user.id)
    db.add(membership)
    await db.commit()
    await db.refresh(membership)
    return {"membership_id": membership.id, "user_id": invitee.id, "name": invitee.name, "email": invitee.email, "role": membership.role}


@router.put("/team/{membership_id}")
async def change_member_role(membership_id: int, payload: MembershipRoleChange, org_id: Optional[int] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org, _role = await _resolve_org_context(db, current_user, org_id)
    await _require_manager_or_owner(db, org, current_user)
    if payload.role not in MEMBER_ROLES:
        raise HTTPException(400, f"role must be one of: {', '.join(MEMBER_ROLES)}")
    m = (await db.execute(select(OrganisationMembership).where(OrganisationMembership.id == membership_id, OrganisationMembership.organisation_id == org.id))).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Team member not found")
    m.role = payload.role
    await db.commit()
    return {"membership_id": m.id, "role": m.role}


@router.delete("/team/{membership_id}")
async def remove_member(membership_id: int, org_id: Optional[int] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org, _role = await _resolve_org_context(db, current_user, org_id)
    await _require_manager_or_owner(db, org, current_user)
    m = (await db.execute(select(OrganisationMembership).where(OrganisationMembership.id == membership_id, OrganisationMembership.organisation_id == org.id))).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Team member not found")
    await db.delete(m)
    await db.commit()
    return {"removed": True}


# ══════════════════════════════════════════════════════════════════════════
# REPORTING METRICS
# ══════════════════════════════════════════════════════════════════════════

@router.get("/metrics/time-to-fill")
async def time_to_fill(org_id: Optional[int] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Average days from a requisition being created to the resulting
    placement's start date — org-wide, computed from Requisition and
    Placement (Phase 5), nothing duplicated here."""
    org, _role = await _resolve_org_context(db, current_user, org_id)
    rows = (await db.execute(
        select(Requisition.id, Requisition.title, Requisition.created_at, Placement.start_date)
        .join(Placement, Placement.requisition_id == Requisition.id)
        .where(Requisition.organisation_id == org.id)
    )).all()

    entries = []
    for req_id, title, req_created, placement_start in rows:
        if not req_created or not placement_start:
            continue
        days = (placement_start - req_created).days
        entries.append({"requisition_id": req_id, "requisition_title": title, "days_to_fill": days})

    avg_days = sum(e["days_to_fill"] for e in entries) / len(entries) if entries else None
    return {"average_days": round(avg_days, 1) if avg_days is not None else None, "filled_requisition_count": len(entries), "by_requisition": entries}


@router.get("/metrics/funnel")
async def funnel_conversion(org_id: Optional[int] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """What fraction of everyone ever submitted to a pipeline ends up
    Placed vs Rejected vs still moving — computed from PipelineEntry's
    current stage_type (Phase 5), not a separate funnel-tracking table."""
    org, _role = await _resolve_org_context(db, current_user, org_id)
    rows = (await db.execute(
        select(PipelineStage.stage_type, func.count())
        .select_from(PipelineEntry)
        .join(PipelineStage, PipelineStage.id == PipelineEntry.current_stage_id)
        .where(PipelineEntry.organisation_id == org.id)
        .group_by(PipelineStage.stage_type)
    )).all()
    counts = {stage_type: count for stage_type, count in rows}
    total = sum(counts.values())
    placed = counts.get("placed", 0)
    rejected = counts.get("rejected", 0)
    active = counts.get("active", 0)
    return {
        "total_in_pipeline": total,
        "placed": placed, "rejected": rejected, "still_active": active,
        "placement_rate_pct": round(100 * placed / total, 1) if total else None,
        "rejection_rate_pct": round(100 * rejected / total, 1) if total else None,
    }


@router.get("/metrics/source-of-hire")
async def source_of_hire(org_id: Optional[int] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Where placed candidates actually came from (Candidate.source,
    set at candidate-creation time back in Phase 1) — only counts
    candidates with at least one Placement, not every candidate ever
    added."""
    org, _role = await _resolve_org_context(db, current_user, org_id)
    rows = (await db.execute(
        select(Candidate.source, func.count(func.distinct(Candidate.id)))
        .select_from(Candidate)
        .join(Placement, Placement.candidate_id == Candidate.id)
        .where(Candidate.organisation_id == org.id)
        .group_by(Candidate.source)
    )).all()
    total = sum(c for _, c in rows)
    return {
        "total_placed": total,
        "by_source": [{"source": src or "Unknown", "count": c, "pct": round(100 * c / total, 1) if total else 0} for src, c in sorted(rows, key=lambda x: -x[1])],
    }


@router.get("/metrics/recruiter-performance")
async def recruiter_performance(org_id: Optional[int] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Placements per recruiter (PipelineEntry.owner_user_id, set when a
    candidate is submitted to a pipeline — Phase 5). Role-scoped: a
    Recruiter sees only their own row; Owner/Manager see everyone's — see
    module docstring for the stated boundary on where role enforcement
    does and doesn't apply in this app today."""
    org, role = await _resolve_org_context(db, current_user, org_id)

    q = (
        select(PipelineEntry.owner_user_id, func.count(func.distinct(PipelineEntry.id)))
        .where(PipelineEntry.organisation_id == org.id, PipelineEntry.owner_user_id.isnot(None))
        .group_by(PipelineEntry.owner_user_id)
    )
    if not service.can_see_org_wide_data(role):
        q = q.where(PipelineEntry.owner_user_id == current_user.id)
    entry_counts = dict((await db.execute(q)).all())

    placed_q = (
        select(PipelineEntry.owner_user_id, func.count(func.distinct(Placement.id)))
        .select_from(Placement)
        .join(Offer, Offer.id == Placement.offer_id)
        .join(PipelineEntry, PipelineEntry.id == Offer.pipeline_entry_id)
        .where(PipelineEntry.organisation_id == org.id, PipelineEntry.owner_user_id.isnot(None))
        .group_by(PipelineEntry.owner_user_id)
    )
    if not service.can_see_org_wide_data(role):
        placed_q = placed_q.where(PipelineEntry.owner_user_id == current_user.id)
    placed_counts = dict((await db.execute(placed_q)).all())

    owner_ids = set(entry_counts) | set(placed_counts)
    names = dict((await db.execute(select(User.id, User.name).where(User.id.in_(owner_ids)))).all()) if owner_ids else {}

    return [
        {
            "user_id": uid, "name": names.get(uid, ""),
            "candidates_owned": entry_counts.get(uid, 0), "placements": placed_counts.get(uid, 0),
        }
        for uid in owner_ids
    ]


@router.get("/metrics/vendor-performance")
async def vendor_performance(org_id: Optional[int] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Submissions, acceptance rate, and resulting placements per vendor —
    computed from VendorSubmission (Phase 6) joined through to Placement
    (Phase 5) via the candidate it promoted into."""
    org, _role = await _resolve_org_context(db, current_user, org_id)
    submissions = (await db.execute(select(VendorSubmission).where(VendorSubmission.organisation_id == org.id))).scalars().all()

    by_vendor: dict = {}
    for s in submissions:
        by_vendor.setdefault(s.vendor_id, {"submitted": 0, "accepted": 0, "candidate_ids": []})
        by_vendor[s.vendor_id]["submitted"] += 1
        if s.status == "Accepted":
            by_vendor[s.vendor_id]["accepted"] += 1
            if s.candidate_id:
                by_vendor[s.vendor_id]["candidate_ids"].append(s.candidate_id)

    all_candidate_ids = [cid for v in by_vendor.values() for cid in v["candidate_ids"]]
    placed_candidate_ids = set()
    if all_candidate_ids:
        placed_rows = (await db.execute(select(Placement.candidate_id).where(Placement.candidate_id.in_(all_candidate_ids)))).scalars().all()
        placed_candidate_ids = set(placed_rows)

    vendor_ids = list(by_vendor.keys())
    vendor_names = dict((await db.execute(select(Vendor.id, Vendor.name).where(Vendor.id.in_(vendor_ids)))).all()) if vendor_ids else {}

    return [
        {
            "vendor_id": vid, "vendor_name": vendor_names.get(vid, ""),
            "submitted": v["submitted"], "accepted": v["accepted"],
            "placements": len([cid for cid in v["candidate_ids"] if cid in placed_candidate_ids]),
            "acceptance_rate_pct": round(100 * v["accepted"] / v["submitted"], 1) if v["submitted"] else 0,
        }
        for vid, v in by_vendor.items()
    ]


# ── Requisition status buckets — see /metrics/requisitions-overview.
# "On Hold" counts as open (still active, unfilled); "Cancelled" counts as
# closed alongside "Filled" (no longer being actively worked); Draft/
# Approved are pre-open (not yet published to the market) and reported
# separately rather than folded into either bucket, since lumping them
# into "open" would overstate live market activity and lumping them into
# "closed" would misreport them as done.
OPEN_STATUSES = {"Open", "On Hold"}
CLOSED_STATUSES = {"Filled", "Cancelled"}
PENDING_STATUSES = {"Draft", "Approved"}


@router.get("/metrics/requisitions-overview")
async def requisitions_overview(org_id: Optional[int] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """The cross-capability dashboard view: open/closed roles per client,
    who's sourcing candidates for each role and how many of those were
    actually screened through (accepted out of the vendor's submissions —
    see VendorSubmission's Phase 6 review-queue design, "Accepted" IS the
    screened-and-promoted-into-the-pipeline signal), interviews per role
    (+ the organisation-wide average), and offers per client/role with
    their acceptance-status breakdown. Every figure here is computed live
    from Requisition/VendorSubmission/Interview/Offer — nothing
    duplicated or pre-aggregated into a separate table."""
    org, _role = await _resolve_org_context(db, current_user, org_id)

    requisitions = (await db.execute(select(Requisition).where(Requisition.organisation_id == org.id))).scalars().all()
    req_ids = [r.id for r in requisitions]
    client_ids = {r.client_id for r in requisitions if r.client_id}
    clients = dict((await db.execute(select(Client.id, Client.name).where(Client.id.in_(client_ids)))).all()) if client_ids else {}

    # Vendor submissions per (requisition, vendor)
    submissions = (await db.execute(select(VendorSubmission).where(VendorSubmission.requisition_id.in_(req_ids)))).scalars().all() if req_ids else []
    vendor_ids = {s.vendor_id for s in submissions}
    vendor_names = dict((await db.execute(select(Vendor.id, Vendor.name).where(Vendor.id.in_(vendor_ids)))).all()) if vendor_ids else {}
    submissions_by_req: dict = {}
    for s in submissions:
        key = (s.requisition_id, s.vendor_id)
        bucket = submissions_by_req.setdefault(s.requisition_id, {})
        entry = bucket.setdefault(s.vendor_id, {"submitted": 0, "accepted": 0})
        entry["submitted"] += 1
        if s.status == "Accepted":
            entry["accepted"] += 1

    # Interviews per requisition
    interview_counts: dict = {}
    if req_ids:
        rows = (await db.execute(
            select(Interview.requisition_id, func.count())
            .where(Interview.requisition_id.in_(req_ids))
            .group_by(Interview.requisition_id)
        )).all()
        interview_counts = dict(rows)

    # Offers per requisition, plus status breakdown
    offers = (await db.execute(select(Offer).where(Offer.requisition_id.in_(req_ids)))).scalars().all() if req_ids else []
    offers_by_req: dict = {}
    offers_by_status_overall: dict = {}
    for o in offers:
        bucket = offers_by_req.setdefault(o.requisition_id, {"total": 0, "by_status": {}})
        bucket["total"] += 1
        bucket["by_status"][o.status] = bucket["by_status"].get(o.status, 0) + 1
        offers_by_status_overall[o.status] = offers_by_status_overall.get(o.status, 0) + 1

    by_requisition = []
    for r in requisitions:
        status_bucket = "Open" if r.status in OPEN_STATUSES else "Closed" if r.status in CLOSED_STATUSES else "Pending"
        vendor_breakdown = [
            {"vendor_id": vid, "vendor_name": vendor_names.get(vid, ""), "submitted": v["submitted"], "accepted": v["accepted"]}
            for vid, v in submissions_by_req.get(r.id, {}).items()
        ]
        offer_info = offers_by_req.get(r.id, {"total": 0, "by_status": {}})
        by_requisition.append({
            "requisition_id": r.id, "title": r.title,
            "client_id": r.client_id, "client_name": clients.get(r.client_id, "Unassigned"),
            "status": r.status, "status_bucket": status_bucket,
            "vendor_breakdown": vendor_breakdown,
            "interview_count": interview_counts.get(r.id, 0),
            "offer_count": offer_info["total"], "offers_by_status": offer_info["by_status"],
        })

    # Per-client rollup
    by_client: dict = {}
    for r in requisitions:
        client_name = clients.get(r.client_id, "Unassigned")
        bucket = by_client.setdefault(client_name, {"open": 0, "closed": 0, "pending": 0, "requisition_count": 0, "offer_count": 0})
        bucket["requisition_count"] += 1
        bucket["offer_count"] += offers_by_req.get(r.id, {"total": 0})["total"]
        if r.status in OPEN_STATUSES:
            bucket["open"] += 1
        elif r.status in CLOSED_STATUSES:
            bucket["closed"] += 1
        else:
            bucket["pending"] += 1

    open_count = len([r for r in requisitions if r.status in OPEN_STATUSES])
    closed_count = len([r for r in requisitions if r.status in CLOSED_STATUSES])
    pending_count = len(requisitions) - open_count - closed_count
    avg_interviews_per_role = round(sum(interview_counts.values()) / len(requisitions), 1) if requisitions else 0

    return {
        "summary": {
            "total_requisitions": len(requisitions),
            "open_count": open_count, "closed_count": closed_count, "pending_count": pending_count,
            "total_interviews": sum(interview_counts.values()),
            "avg_interviews_per_role": avg_interviews_per_role,
            "total_offers": len(offers),
            "offers_by_status": offers_by_status_overall,
        },
        "by_client": [{"client_name": k, **v} for k, v in sorted(by_client.items(), key=lambda x: -x[1]["requisition_count"])],
        "by_requisition": by_requisition,
    }
