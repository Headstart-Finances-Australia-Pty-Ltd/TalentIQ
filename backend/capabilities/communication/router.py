"""
TalentIQ — Capability: Communication & Automation (Phase 7, authenticated)

Registered in main.py as: /api/communication/*
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_

from db.database import get_db
from models.models import User
from utils.auth_utils import get_current_user
from capabilities.acquisition import service as acquisition_service
from capabilities.acquisition.models import Candidate
from capabilities.requisition.models import Requisition
from capabilities.pipeline.models import PipelineEntry, Offer
from capabilities.interview.models import Interview
from capabilities.portal.models import VendorSubmission, ClientFeedback

from .models import (
    EmailTemplate, CommunicationLog, AutomationRule, AutomationRunLog,
    TEMPLATE_CATEGORIES, TRIGGER_EVENTS,
)
from .schemas import (
    TemplateCreate, TemplateUpdate, LogEntryCreate, SendEmailRequest,
    AutomationRuleCreate, AutomationRuleUpdate,
)
from . import service

router = APIRouter()


async def _org(db: AsyncSession, user: User):
    return await acquisition_service.get_or_create_default_organisation(db, user)


def _fmt_template(t: EmailTemplate) -> dict:
    return {"id": t.id, "name": t.name, "category": t.category, "subject": t.subject, "body": t.body,
            "created_at": t.created_at.isoformat() if t.created_at else None}


def _fmt_log(l: CommunicationLog, sender_name: str = "") -> dict:
    return {
        "id": l.id, "candidate_id": l.candidate_id, "client_id": l.client_id, "vendor_id": l.vendor_id,
        "requisition_id": l.requisition_id, "pipeline_entry_id": l.pipeline_entry_id,
        "channel": l.channel, "direction": l.direction, "subject": l.subject or "", "body": l.body or "",
        "template_id": l.template_id, "status": l.status, "failure_reason": l.failure_reason or "",
        "automated": l.automated, "sender_name": sender_name,
        "sent_at": l.sent_at.isoformat() if l.sent_at else None,
    }


def _fmt_rule(r: AutomationRule, template_name: str = "") -> dict:
    return {
        "id": r.id, "name": r.name, "trigger_event": r.trigger_event,
        "trigger_stage_name": r.trigger_stage_name or "", "template_id": r.template_id,
        "template_name": template_name, "is_active": r.is_active,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


# ══════════════════════════════════════════════════════════════════════════
# EMAIL TEMPLATES
# ══════════════════════════════════════════════════════════════════════════

@router.get("/templates")
async def list_templates(category: Optional[str] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    q = select(EmailTemplate).where(EmailTemplate.organisation_id == org.id)
    if category:
        q = q.where(EmailTemplate.category == category)
    rows = (await db.execute(q.order_by(EmailTemplate.name))).scalars().all()
    return [_fmt_template(t) for t in rows]


@router.post("/templates")
async def create_template(payload: TemplateCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    if payload.category not in TEMPLATE_CATEGORIES:
        raise HTTPException(400, f"category must be one of: {', '.join(TEMPLATE_CATEGORIES)}")
    t = EmailTemplate(organisation_id=org.id, name=payload.name.strip(), category=payload.category, subject=payload.subject, body=payload.body)
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return _fmt_template(t)


@router.put("/templates/{template_id}")
async def update_template(template_id: int, payload: TemplateUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    t = (await db.execute(select(EmailTemplate).where(EmailTemplate.id == template_id, EmailTemplate.organisation_id == org.id))).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Template not found")
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(t, field, value)
    t.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(t)
    return _fmt_template(t)


@router.delete("/templates/{template_id}")
async def delete_template(template_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    t = (await db.execute(select(EmailTemplate).where(EmailTemplate.id == template_id, EmailTemplate.organisation_id == org.id))).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Template not found")
    in_use = (await db.execute(select(func.count()).select_from(AutomationRule).where(AutomationRule.template_id == template_id))).scalar()
    if in_use:
        raise HTTPException(400, f"Cannot delete this template — {in_use} automation rule(s) still use it. Update or delete those first.")
    await db.delete(t)
    await db.commit()
    return {"deleted": True}


# ══════════════════════════════════════════════════════════════════════════
# TIMELINE / MANUAL LOG / SEND EMAIL
# ══════════════════════════════════════════════════════════════════════════

@router.get("/timeline")
async def get_timeline(
    candidate_id: Optional[int] = None, client_id: Optional[int] = None,
    vendor_id: Optional[int] = None, requisition_id: Optional[int] = None,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    if not any([candidate_id, client_id, vendor_id, requisition_id]):
        raise HTTPException(400, "Provide at least one of candidate_id, client_id, vendor_id, requisition_id.")
    org = await _org(db, current_user)
    q = select(CommunicationLog).where(CommunicationLog.organisation_id == org.id)
    filters = []
    if candidate_id:
        filters.append(CommunicationLog.candidate_id == candidate_id)
    if client_id:
        filters.append(CommunicationLog.client_id == client_id)
    if vendor_id:
        filters.append(CommunicationLog.vendor_id == vendor_id)
    if requisition_id:
        filters.append(CommunicationLog.requisition_id == requisition_id)
    q = q.where(or_(*filters)).order_by(CommunicationLog.sent_at.desc())
    rows = (await db.execute(q)).scalars().all()

    user_ids = {l.sent_by_user_id for l in rows if l.sent_by_user_id}
    sender_names = dict((await db.execute(select(User.id, User.name).where(User.id.in_(user_ids)))).all()) if user_ids else {}
    return [_fmt_log(l, sender_names.get(l.sent_by_user_id, "")) for l in rows]


@router.post("/log")
async def create_log_entry(payload: LogEntryCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    log = CommunicationLog(
        organisation_id=org.id, candidate_id=payload.candidate_id, client_id=payload.client_id,
        vendor_id=payload.vendor_id, requisition_id=payload.requisition_id, pipeline_entry_id=payload.pipeline_entry_id,
        channel=payload.channel, direction=payload.direction, subject=payload.subject, body=payload.body,
        status="Logged", sent_by_user_id=current_user.id,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)
    return _fmt_log(log, current_user.name)


@router.post("/send-email")
async def send_email(payload: SendEmailRequest, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    subject, body = payload.subject or "", payload.body or ""
    if payload.template_id:
        template = (await db.execute(select(EmailTemplate).where(EmailTemplate.id == payload.template_id, EmailTemplate.organisation_id == org.id))).scalar_one_or_none()
        if not template:
            raise HTTPException(404, "Template not found")
        context = {}
        if payload.candidate_id:
            c = (await db.execute(select(Candidate).where(Candidate.id == payload.candidate_id))).scalar_one_or_none()
            if c:
                context.update({"candidate_name": c.full_name, "candidate_email": c.email or ""})
        if payload.requisition_id:
            r = (await db.execute(select(Requisition).where(Requisition.id == payload.requisition_id))).scalar_one_or_none()
            if r:
                context["requisition_title"] = r.title
        subject = service.render_template(template.subject, context)
        body = service.render_template(template.body, context)
    if not subject or not body:
        raise HTTPException(400, "Provide either a template_id or both subject and body.")

    log = CommunicationLog(
        organisation_id=org.id, candidate_id=payload.candidate_id, client_id=payload.client_id,
        vendor_id=payload.vendor_id, requisition_id=payload.requisition_id, pipeline_entry_id=payload.pipeline_entry_id,
        channel="Email", direction="Outbound", subject=subject, body=body, template_id=payload.template_id,
        sent_by_user_id=current_user.id,
    )
    try:
        smtp_cfg = await service._get_smtp_config(current_user.id, db)
        service._send_email(smtp_cfg, payload.to_email, subject, body)
        log.status = "Sent"
    except HTTPException as e:
        log.status = "Failed"
        log.failure_reason = str(e.detail)[:500]
        db.add(log)
        await db.commit()
        raise
    except Exception as e:
        log.status = "Failed"
        log.failure_reason = str(e)[:500]
        db.add(log)
        await db.commit()
        raise HTTPException(500, f"Failed to send: {str(e)[:200]}")

    db.add(log)
    await db.commit()
    await db.refresh(log)
    return _fmt_log(log, current_user.name)


# ══════════════════════════════════════════════════════════════════════════
# AUTOMATION RULES
# ══════════════════════════════════════════════════════════════════════════

@router.get("/automation-rules")
async def list_automation_rules(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    rows = (await db.execute(select(AutomationRule).where(AutomationRule.organisation_id == org.id).order_by(AutomationRule.created_at.desc()))).scalars().all()
    template_ids = {r.template_id for r in rows}
    template_names = dict((await db.execute(select(EmailTemplate.id, EmailTemplate.name).where(EmailTemplate.id.in_(template_ids)))).all()) if template_ids else {}
    return [_fmt_rule(r, template_names.get(r.template_id, "")) for r in rows]


@router.post("/automation-rules")
async def create_automation_rule(payload: AutomationRuleCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if payload.trigger_event not in TRIGGER_EVENTS:
        raise HTTPException(400, f"trigger_event must be one of: {', '.join(TRIGGER_EVENTS)}")
    org = await _org(db, current_user)
    template = (await db.execute(select(EmailTemplate).where(EmailTemplate.id == payload.template_id, EmailTemplate.organisation_id == org.id))).scalar_one_or_none()
    if not template:
        raise HTTPException(404, "Template not found")
    rule = AutomationRule(
        organisation_id=org.id, name=payload.name.strip(), trigger_event=payload.trigger_event,
        trigger_stage_name=payload.trigger_stage_name.strip(), template_id=payload.template_id, is_active=payload.is_active,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return _fmt_rule(rule, template.name)


@router.put("/automation-rules/{rule_id}")
async def update_automation_rule(rule_id: int, payload: AutomationRuleUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    r = (await db.execute(select(AutomationRule).where(AutomationRule.id == rule_id, AutomationRule.organisation_id == org.id))).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Rule not found")
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(r, field, value)
    r.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(r)
    return _fmt_rule(r)


@router.delete("/automation-rules/{rule_id}")
async def delete_automation_rule(rule_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    r = (await db.execute(select(AutomationRule).where(AutomationRule.id == rule_id, AutomationRule.organisation_id == org.id))).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Rule not found")
    await db.delete(r)
    await db.commit()
    return {"deleted": True}


@router.get("/automation-log")
async def get_automation_log(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org(db, current_user)
    rows = (await db.execute(select(AutomationRunLog).where(AutomationRunLog.organisation_id == org.id).order_by(AutomationRunLog.triggered_at.desc()).limit(200))).scalars().all()
    rule_ids = {r.automation_rule_id for r in rows}
    rule_names = dict((await db.execute(select(AutomationRule.id, AutomationRule.name).where(AutomationRule.id.in_(rule_ids)))).all()) if rule_ids else {}
    return [
        {
            "id": r.id, "rule_name": rule_names.get(r.automation_rule_id, ""), "target_description": r.target_description or "",
            "status": r.status, "detail": r.detail or "", "triggered_at": r.triggered_at.isoformat() if r.triggered_at else None,
        }
        for r in rows
    ]


# ══════════════════════════════════════════════════════════════════════════
# RECRUITER DAILY WORKBENCH
# ══════════════════════════════════════════════════════════════════════════

@router.get("/workbench")
async def get_workbench(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """A single aggregated view pulling from every other capability built
    so far — interviews today, offers expiring soon, candidates awaiting
    vendor-submission review, unacknowledged client feedback, and
    pipeline entries that have sat in the same stage without movement —
    exactly the "what needs my attention right now" list the capability
    plan's "recruiter daily workbench" line describes, built by actually
    querying those capabilities' own tables rather than duplicating their
    data into a new one."""
    org = await _org(db, current_user)
    now = datetime.utcnow()

    interviews_today = (await db.execute(
        select(Interview).where(
            Interview.organisation_id == org.id, Interview.status == "Scheduled",
            Interview.scheduled_at.isnot(None),
            Interview.scheduled_at >= now.replace(hour=0, minute=0, second=0, microsecond=0),
            Interview.scheduled_at < now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1),
        ).order_by(Interview.scheduled_at)
    )).scalars().all()

    offers_expiring = (await db.execute(
        select(Offer).where(
            Offer.organisation_id == org.id, Offer.status.in_(["Sent", "Approved"]),
            Offer.expiry_date.isnot(None), Offer.expiry_date >= now, Offer.expiry_date <= now + timedelta(days=3),
        ).order_by(Offer.expiry_date)
    )).scalars().all()

    pending_submissions_count = (await db.execute(
        select(func.count()).select_from(VendorSubmission).where(VendorSubmission.organisation_id == org.id, VendorSubmission.status == "Pending Review")
    )).scalar() or 0

    unacknowledged_feedback_count = (await db.execute(
        select(func.count()).select_from(ClientFeedback).where(ClientFeedback.organisation_id == org.id, ClientFeedback.acknowledged.is_(False))
    )).scalar() or 0

    stale_cutoff = now - timedelta(days=7)
    stale_entries = (await db.execute(
        select(PipelineEntry).where(
            PipelineEntry.organisation_id == org.id, PipelineEntry.stage_entered_at < stale_cutoff,
        ).order_by(PipelineEntry.stage_entered_at).limit(20)
    )).scalars().all()

    # Batch-fetch display names for everything gathered above.
    candidate_ids = {i.candidate_id for i in interviews_today} | {o.candidate_id for o in offers_expiring} | {e.candidate_id for e in stale_entries}
    candidate_names = dict((await db.execute(select(Candidate.id, Candidate.full_name).where(Candidate.id.in_(candidate_ids)))).all()) if candidate_ids else {}
    requisition_ids = {i.requisition_id for i in interviews_today if i.requisition_id} | {o.requisition_id for o in offers_expiring} | {e.requisition_id for e in stale_entries}
    requisition_titles = dict((await db.execute(select(Requisition.id, Requisition.title).where(Requisition.id.in_(requisition_ids)))).all()) if requisition_ids else {}

    return {
        "interviews_today": [
            {"id": i.id, "candidate_name": candidate_names.get(i.candidate_id, ""), "round_name": i.round_name,
             "scheduled_at": i.scheduled_at.isoformat() if i.scheduled_at else None}
            for i in interviews_today
        ],
        "offers_expiring_soon": [
            {"id": o.id, "candidate_name": candidate_names.get(o.candidate_id, ""), "requisition_title": requisition_titles.get(o.requisition_id, ""),
             "expiry_date": o.expiry_date.isoformat() if o.expiry_date else None}
            for o in offers_expiring
        ],
        "pending_vendor_submissions": pending_submissions_count,
        "unacknowledged_client_feedback": unacknowledged_feedback_count,
        "stale_pipeline_entries": [
            {"id": e.id, "candidate_name": candidate_names.get(e.candidate_id, ""), "requisition_title": requisition_titles.get(e.requisition_id, ""),
             "days_in_stage": (now - e.stage_entered_at).days if e.stage_entered_at else None}
            for e in stale_entries
        ],
    }
