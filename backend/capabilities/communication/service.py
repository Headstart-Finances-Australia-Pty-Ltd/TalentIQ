"""Service helpers for Communication & Automation (Phase 7)."""
import re
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from routers.joblens import _get_smtp_config, _send_email  # noqa: F401 — intentional reuse, same pattern already used by capabilities/acquisition/service.py importing _extract_text_from_file from routers.jobhunt

from .models import AutomationRule, CommunicationLog, AutomationRunLog, EmailTemplate

_PLACEHOLDER_RE = re.compile(r"\{\{(\w+)\}\}")


def render_template(text: str, context: dict) -> str:
    """Simple {{placeholder}} substitution — not Jinja2, deliberately: the
    set of placeholders is small and known (candidate_name,
    requisition_title, client_name, interview_round, interview_time,
    offer_salary, etc.), and a full templating engine would be able to
    execute far more than substitution for a feature whose input often
    comes from a recruiter typing a template, not a trusted developer.
    An unmatched placeholder is left as literal text (e.g. "{{unknown}}")
    rather than raising, so a template referencing a field this call site
    didn't provide degrades visibly instead of failing the whole send."""
    return _PLACEHOLDER_RE.sub(lambda m: str(context.get(m.group(1), m.group(0))), text)


async def fire_automation(
    db: AsyncSession,
    organisation_id: int,
    trigger_event: str,
    context: dict,
    triggering_user_id: Optional[int],
    to_email: Optional[str],
    candidate_id: Optional[int] = None,
    client_id: Optional[int] = None,
    vendor_id: Optional[int] = None,
    requisition_id: Optional[int] = None,
    pipeline_entry_id: Optional[int] = None,
    trigger_stage_name: Optional[str] = None,
) -> None:
    """Best-effort, never raises — called from INSIDE other capabilities'
    endpoints (Interview Management, Pipeline & Placements) right after
    the primary action succeeds. An automation failing to send (bad SMTP
    config, candidate has no email, etc.) must never roll back or block
    the actual interview-scheduling / stage-move / offer-status-change it
    was triggered by — that would make an unrelated, optional feature
    capable of breaking core workflows. Every attempt is still logged
    (AutomationRunLog) so a silently-failing rule is discoverable, just
    never blocking.

    triggering_user_id supplies the SMTP credentials (private, per-user —
    see module docstring): the recruiter who scheduled the interview /
    moved the stage / accepted the offer is treated as the "sender" of
    any automated email that fires as a result.
    """
    q = select(AutomationRule).where(
        AutomationRule.organisation_id == organisation_id,
        AutomationRule.trigger_event == trigger_event,
        AutomationRule.is_active.is_(True),
    )
    if trigger_event == "pipeline_stage_changed":
        q = q.where(AutomationRule.trigger_stage_name == (trigger_stage_name or ""))
    rules = (await db.execute(q)).scalars().all()

    for rule in rules:
        target_desc = context.get("candidate_name") or context.get("client_name") or f"rule #{rule.id}"
        try:
            template = (await db.execute(select(EmailTemplate).where(EmailTemplate.id == rule.template_id))).scalar_one_or_none()
            if not template:
                db.add(AutomationRunLog(organisation_id=organisation_id, automation_rule_id=rule.id, target_description=target_desc, status="Failed", detail="Template no longer exists."))
                continue
            if not to_email:
                db.add(AutomationRunLog(organisation_id=organisation_id, automation_rule_id=rule.id, target_description=target_desc, status="Skipped", detail="No email address on file for the recipient."))
                continue

            subject = render_template(template.subject, context)
            body = render_template(template.body, context)

            log = CommunicationLog(
                organisation_id=organisation_id, candidate_id=candidate_id, client_id=client_id,
                vendor_id=vendor_id, requisition_id=requisition_id, pipeline_entry_id=pipeline_entry_id,
                channel="Email", direction="Outbound", subject=subject, body=body, template_id=template.id,
                automated=True, automation_rule_id=rule.id, sent_by_user_id=triggering_user_id,
            )
            try:
                if not triggering_user_id:
                    raise ValueError("No recruiter user context to send as.")
                smtp_cfg = await _get_smtp_config(triggering_user_id, db)
                _send_email(smtp_cfg, to_email, subject, body)
                log.status = "Sent"
            except Exception as e:
                log.status = "Failed"
                log.failure_reason = str(e)[:500]
            db.add(log)
            await db.flush()
            db.add(AutomationRunLog(
                organisation_id=organisation_id, automation_rule_id=rule.id, communication_log_id=log.id,
                target_description=target_desc, status=log.status, detail=log.failure_reason or "",
            ))
        except Exception as e:
            # Belt-and-braces: even a bug in the logging path above must
            # not propagate up into the caller's transaction.
            db.add(AutomationRunLog(organisation_id=organisation_id, automation_rule_id=rule.id, target_description=target_desc, status="Failed", detail=f"Internal error: {str(e)[:300]}"))
