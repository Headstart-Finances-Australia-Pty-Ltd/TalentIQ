"""
Billing — public pricing page data, Stripe checkout (one-time payment
per billing period, not Stripe's recurring subscription object — see
models/billing_models.py's module docstring for why), free-demo
activation, and Admin Console CRUD for the plans themselves.

Needs a Stripe secret key and webhook signing secret to actually take
payments — configure them in Admin Console > API Keys > Stripe (stored
in the database, shared platform-wide, same as Database/S3), or fall
back to these environment variables if unset there:
  STRIPE_SECRET_KEY   sk_live_... or sk_test_...
  STRIPE_WEBHOOK_SECRET   whsec_... (from Stripe Dashboard -> Webhooks,
                           endpoint URL: <PUBLIC_BASE_URL>/api/billing/webhook)
Without either, the Pricing page still renders (plans are just data), but
clicking a paid plan returns a clear "payment isn't configured yet" error
instead of a confusing failure — see _get_stripe() below.
"""
import os
from datetime import datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, Header
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from models.models import User
from models.billing_models import PricingPlan, Subscription, SubscriptionHistory
from utils.auth_utils import get_current_user, require_admin
from utils.credentials import get_global_credentials
from utils.email_send import get_system_smtp_config, send_payment_confirmation_email

router = APIRouter()

PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "")


async def record_subscription_history(db: AsyncSession, sub: Subscription) -> None:
    """Snapshots the CURRENT state of a user's single Subscription row
    into the append-only SubscriptionHistory table — call this BEFORE
    mutating sub's plan_slug/status/dates to the new plan, while it
    still holds the OLD term's values, so the old term is preserved as
    its own row rather than silently lost the moment Subscription's one
    row gets overwritten in place. (Calling this AFTER mutating sub
    would log a duplicate of the new state instead of the old one it's
    meant to preserve — the entire point of this function.) Does not
    commit — the caller's own db.commit() covers this insert too.
    No-ops if sub has no real prior plan to preserve (a brand new
    Subscription row with an empty plan_slug — nothing to lose there)."""
    if not sub.plan_slug:
        return
    db.add(SubscriptionHistory(
        user_id=sub.user_id, plan_slug=sub.plan_slug, billing_period=sub.billing_period,
        status=sub.status, start_date=sub.start_date, end_date=sub.end_date,
        amount_paid_cents=sub.amount_paid_cents, stripe_checkout_session_id=sub.stripe_checkout_session_id,
        notes=sub.notes, recorded_at=datetime.utcnow(),
    ))


async def _get_stripe(db: AsyncSession):
    """Secret key: DB-stored global credential (Admin Console > API Keys
    > Stripe) wins if set, else the STRIPE_SECRET_KEY environment
    variable — same "admin-configured DB value overrides the env
    default" pattern utils/storage.py uses for S3."""
    creds = await get_global_credentials(db, "stripe")
    secret = creds.get("secret_key") or os.environ.get("STRIPE_SECRET_KEY", "")
    if not secret:
        raise HTTPException(503, "Payment gateway isn't configured yet — set a Stripe secret key in Admin Console > API Keys, or STRIPE_SECRET_KEY on the server.")
    import stripe
    stripe.api_key = secret
    return stripe


# ── Public: pricing page data ────────────────────────────────────────────

@router.get("/plans")
async def list_public_plans(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(PricingPlan).where(PricingPlan.is_active.is_(True)).order_by(PricingPlan.sort_order)
    )).scalars().all()
    return [r.to_public_dict() for r in rows]


@router.get("/my-subscription")
async def my_subscription(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sub = (await db.execute(select(Subscription).where(Subscription.user_id == current_user.id))).scalar_one_or_none()
    if not sub:
        return {"status": "none", "plan_slug": "", "billing_period": "", "start_date": None, "end_date": None, "amount_paid_cents": 0}
    return sub.to_dict()


@router.get("/my-plan-history")
async def my_plan_history(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Current plan + every past plan term this user has ever had —
    "old plan data should not be overwritten, it can be pulled whenever
    required" (see SubscriptionHistory's docstring). Used by the app
    topbar's plan badge popup."""
    sub = (await db.execute(select(Subscription).where(Subscription.user_id == current_user.id))).scalar_one_or_none()
    rows = (await db.execute(
        select(SubscriptionHistory).where(SubscriptionHistory.user_id == current_user.id).order_by(SubscriptionHistory.recorded_at.desc())
    )).scalars().all()
    plan_names = {p.slug: p.name for p in (await db.execute(select(PricingPlan))).scalars().all()}
    return {
        "current": {**(sub.to_dict() if sub else {"status": "none", "plan_slug": "", "billing_period": "", "start_date": None, "end_date": None, "amount_paid_cents": 0}),
                    "plan_name": plan_names.get(sub.plan_slug, sub.plan_slug) if sub and sub.plan_slug else ""},
        "history": [{**h.to_dict(), "plan_name": plan_names.get(h.plan_slug, h.plan_slug)} for h in rows],
    }


# ── Free demo — no payment required ──────────────────────────────────────

@router.post("/start-free-demo")
async def start_free_demo(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    plan = (await db.execute(select(PricingPlan).where(PricingPlan.is_free_demo.is_(True), PricingPlan.is_active.is_(True)))).scalar_one_or_none()
    if not plan:
        raise HTTPException(404, "No free demo plan is currently configured.")

    sub = (await db.execute(select(Subscription).where(Subscription.user_id == current_user.id))).scalar_one_or_none()
    if sub and sub.status in ("demo", "active") and sub.end_date and sub.end_date > datetime.utcnow():
        raise HTTPException(400, "You already have an active plan or demo.")

    now = datetime.utcnow()
    end = now + timedelta(days=plan.demo_days or 14)
    if not sub:
        sub = Subscription(user_id=current_user.id)
        db.add(sub)
    else:
        # Preserve whatever plan this user was on before, if any — must
        # happen BEFORE the mutations below, while sub still holds the
        # OLD term's values (see record_subscription_history's docstring).
        await record_subscription_history(db, sub)
    sub.plan_slug = plan.slug
    sub.billing_period = ""
    sub.status = "demo"
    sub.start_date = now
    sub.end_date = end
    sub.notes = ((sub.notes or "") + f"\n{now.date()}: Started {plan.demo_days}-day free demo ({plan.name}).").strip()
    await db.commit()
    return sub.to_dict()


# ── Paid plans — Stripe Checkout (opened as a popup window by the frontend) ──

class CreateCheckoutRequest(BaseModel):
    plan_slug: str
    billing_period: str  # "monthly" | "yearly"


@router.post("/create-checkout")
async def create_checkout(
    payload: CreateCheckoutRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.billing_period not in ("monthly", "yearly"):
        raise HTTPException(400, "billing_period must be 'monthly' or 'yearly'.")
    plan = (await db.execute(select(PricingPlan).where(PricingPlan.slug == payload.plan_slug, PricingPlan.is_active.is_(True)))).scalar_one_or_none()
    if not plan:
        raise HTTPException(404, "Plan not found.")

    amount = plan.price_yearly_cents if payload.billing_period == "yearly" else plan.price_monthly_cents
    if not amount:
        raise HTTPException(400, "This plan is free — no payment needed. Use Start Free Demo instead.")

    stripe = await _get_stripe(db)
    if not PUBLIC_BASE_URL:
        raise HTTPException(503, "This server has no PUBLIC_BASE_URL configured, so Stripe has nowhere reachable to redirect back to. Set the PUBLIC_BASE_URL environment variable first.")

    period_label = "year" if payload.billing_period == "yearly" else "month"
    session = stripe.checkout.Session.create(
        payment_method_types=["card"],
        mode="payment",
        customer_email=current_user.email or None,
        line_items=[{
            "price_data": {
                "currency": "usd",
                "unit_amount": amount,
                "product_data": {
                    "name": f"TalentIQ {plan.name}",
                    "description": f"{plan.description or ''} — billed per {period_label}",
                },
            },
            "quantity": 1,
        }],
        metadata={
            "user_id": str(current_user.id),
            "plan_slug": plan.slug,
            "billing_period": payload.billing_period,
        },
        # These land INSIDE the popup window the frontend opens (see
        # PricingPage.tsx) — the success page there closes itself and
        # notifies the opener via postMessage, rather than navigating the
        # user's main tab away to Stripe and back.
        success_url=f"{PUBLIC_BASE_URL}/billing/checkout-result?status=success&session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{PUBLIC_BASE_URL}/billing/checkout-result?status=cancelled",
    )
    return {"checkout_url": session.url}


@router.post("/webhook")
async def stripe_webhook(request: Request, stripe_signature: str = Header(None, alias="stripe-signature"), db: AsyncSession = Depends(get_db)):
    creds = await get_global_credentials(db, "stripe")
    webhook_secret = creds.get("webhook_secret") or os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    if not webhook_secret:
        raise HTTPException(503, "Stripe webhook secret not configured — set it in Admin Console > API Keys, or STRIPE_WEBHOOK_SECRET on the server.")
    stripe = await _get_stripe(db)
    payload = await request.body()

    try:
        event = stripe.Webhook.construct_event(payload, stripe_signature, webhook_secret)
    except Exception:
        raise HTTPException(400, "Invalid Stripe signature.")

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        meta = session.get("metadata", {}) or {}
        user_id = int(meta.get("user_id") or 0)
        plan_slug = meta.get("plan_slug", "")
        billing_period = meta.get("billing_period", "monthly")

        from db.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            plan = (await db.execute(select(PricingPlan).where(PricingPlan.slug == plan_slug))).scalar_one_or_none()
            if user_id and plan:
                sub = (await db.execute(select(Subscription).where(Subscription.user_id == user_id))).scalar_one_or_none()
                now = datetime.utcnow()
                end = now + timedelta(days=366 if billing_period == "yearly" else 31)
                if not sub:
                    sub = Subscription(user_id=user_id)
                    db.add(sub)
                else:
                    # Preserve the OLD plan term before overwriting it
                    # below — must happen while sub still holds the old
                    # values (see record_subscription_history's docstring).
                    await record_subscription_history(db, sub)
                # Renewing/upgrading extends from today, not stacked onto
                # a stale previous end_date — this endpoint fires once
                # per completed checkout, so "start today, run one period"
                # is always correct here regardless of prior state.
                sub.plan_slug = plan_slug
                sub.billing_period = billing_period
                sub.status = "active"
                sub.start_date = now
                sub.end_date = end
                # For a normal checkout, amount_total IS the plan's full
                # price. For a change_plan upgrade (see change_plan()
                # below), amount_total is only the SMALLER net amount
                # actually charged today after the unused-time credit was
                # applied — amount_paid_cents should still reflect the
                # plan's real nominal price so "what plan am I on and
                # what's it worth" stays consistent everywhere it's
                # displayed; the credit itself is recorded in notes and
                # counted against refunded_cents isn't right either (it
                # was never refunded, it was applied as a discount) — so
                # it's simply noted in text for a human reading history.
                credit_applied_cents = int(meta.get("credit_applied_cents") or 0)
                nominal_amount = plan.price_yearly_cents if billing_period == "yearly" else plan.price_monthly_cents
                sub.amount_paid_cents = nominal_amount if credit_applied_cents else session.get("amount_total", 0)
                sub.stripe_customer_id = session.get("customer", "") or sub.stripe_customer_id
                sub.stripe_checkout_session_id = session.get("id", "")
                # Present directly on the session payload for mode="payment"
                # checkouts — no extra Stripe API call needed. This is what
                # change_plan/cancel_plan below refund against; without it,
                # neither can ever issue a refund for this term.
                sub.stripe_payment_intent_id = session.get("payment_intent", "") or sub.stripe_payment_intent_id
                amount_display = f"${(session.get('amount_total', 0) or 0) / 100:.2f}"
                if credit_applied_cents:
                    sub.notes = ((sub.notes or "") + f"\n{now.date()}: Changed to {plan.name} ({billing_period}) — "
                                 f"${nominal_amount/100:.2f} plan, ${credit_applied_cents/100:.2f} credit applied, "
                                 f"{amount_display} charged today").strip()
                else:
                    sub.notes = ((sub.notes or "") + f"\n{now.date()}: {plan.name} ({billing_period}) — {amount_display}").strip()
                await db.commit()

                # TalentIQ's own confirmation, via the platform's
                # configured System Email SMTP — deliberately independent
                # of Stripe's native receipt, which Stripe withholds in
                # test mode unless the checkout email belongs to a
                # verified user on the Stripe account itself. Best-effort:
                # a failure here must never roll back or re-raise, since
                # the subscription is already committed and the payment
                # already succeeded — an unconfigured/broken mailbox
                # shouldn't turn a successful purchase into a 500 for
                # Stripe's webhook retry logic to keep hammering.
                user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
                if user:
                    try:
                        smtp_cfg = await get_system_smtp_config(db)
                        send_payment_confirmation_email(smtp_cfg, user.email, user.name, plan.name, billing_period, amount_display)
                        print(f"[billing webhook] Payment confirmation email sent to {user.email}")
                    except Exception as e:
                        print(f"[billing webhook] Failed to send payment confirmation email to {user.email}: {e}")

    return {"received": True}


# ── Mid-cycle plan changes & cancellation ─────────────────────────────────
#
# Straight-line, time-based proration — computed here rather than via
# Stripe's built-in proration, because that only applies to Stripe's
# recurring Subscription object, and this app deliberately uses one-time
# Checkout Session payments instead (see module docstring). The "value"
# of a term is simply what fraction of its days remain, applied to what
# was actually paid for it.

def compute_unused_credit_cents(sub: Subscription, now: datetime) -> int:
    if not sub or sub.status != "active" or not sub.start_date or not sub.end_date or not sub.amount_paid_cents:
        return 0
    total_days = (sub.end_date - sub.start_date).days or 1
    remaining_days = max(0, (sub.end_date - now).days)
    if remaining_days <= 0:
        return 0
    return round(sub.amount_paid_cents * remaining_days / total_days)


class ChangePlanRequest(BaseModel):
    plan_slug: str
    billing_period: str  # "monthly" | "yearly"


@router.post("/change-plan")
async def change_plan(
    payload: ChangePlanRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upgrade or downgrade an ACTIVE paid plan before its term ends.
    Upgrade: charges only (new plan price - unused credit from the old
    term), via a smaller Checkout Session — the plan switches once that
    payment completes (see the change_plan branch in the webhook above).
    Downgrade (new plan price < unused credit): no new charge needed;
    switches immediately and refunds the leftover credit to the
    original card. Use /start-free-demo for a brand new signup with no
    prior plan, and /cancel-plan to drop a plan entirely instead of
    switching to another paid one."""
    if payload.billing_period not in ("monthly", "yearly"):
        raise HTTPException(400, "billing_period must be 'monthly' or 'yearly'.")
    plan = (await db.execute(select(PricingPlan).where(PricingPlan.slug == payload.plan_slug, PricingPlan.is_active.is_(True)))).scalar_one_or_none()
    if not plan:
        raise HTTPException(404, "Plan not found.")
    new_amount = plan.price_yearly_cents if payload.billing_period == "yearly" else plan.price_monthly_cents
    if not new_amount:
        raise HTTPException(400, "This plan is free — cancel your current plan first, then use Start Free Demo.")

    sub = (await db.execute(select(Subscription).where(Subscription.user_id == current_user.id))).scalar_one_or_none()
    if not sub or sub.status != "active":
        raise HTTPException(400, "You don't have an active paid plan to change — use Create Checkout for a new plan instead.")
    if sub.plan_slug == plan.slug and sub.billing_period == payload.billing_period:
        raise HTTPException(400, "You're already on this plan.")

    now = datetime.utcnow()
    credit_cents = compute_unused_credit_cents(sub, now)
    net_charge = max(0, new_amount - credit_cents)

    if net_charge > 0:
        # Upgrade (or a downgrade whose credit doesn't fully cover the
        # new plan) — collect the smaller net amount via a real Checkout
        # Session, same popup flow as a brand new purchase. The plan
        # itself doesn't switch until this payment actually completes
        # (webhook above), same as any other checkout.
        stripe = await _get_stripe(db)
        if not PUBLIC_BASE_URL:
            raise HTTPException(503, "This server has no PUBLIC_BASE_URL configured, so Stripe has nowhere reachable to redirect back to. Set the PUBLIC_BASE_URL environment variable first.")
        period_label = "year" if payload.billing_period == "yearly" else "month"
        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            mode="payment",
            customer_email=current_user.email or None,
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "unit_amount": net_charge,
                    "product_data": {
                        "name": f"TalentIQ {plan.name} (plan change)",
                        "description": f"{plan.description or ''} — billed per {period_label}. "
                                        f"${credit_cents/100:.2f} credit applied for unused time on your current plan.",
                    },
                },
                "quantity": 1,
            }],
            metadata={
                "user_id": str(current_user.id),
                "plan_slug": plan.slug,
                "billing_period": payload.billing_period,
                "credit_applied_cents": str(credit_cents),
            },
            success_url=f"{PUBLIC_BASE_URL}/billing/checkout-result?status=success&session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{PUBLIC_BASE_URL}/billing/checkout-result?status=cancelled",
        )
        return {"requires_payment": True, "checkout_url": session.url, "credit_applied_cents": credit_cents, "net_charge_cents": net_charge}

    # Downgrade: the old plan's unused credit already covers the new
    # plan's full price. The plan switch itself still happens
    # immediately (no reason to make the person wait on that) — but any
    # actual cash refund for the leftover credit is queued for manual
    # admin approval, same as cancel_plan's pending_refund_cents, rather
    # than calling Stripe automatically. Only the "charge more" side of
    # a plan change (the upgrade branch above) stays automatic; anything
    # that moves money OUT always needs a human.
    leftover_cents = credit_cents - new_amount

    await record_subscription_history(db, sub)
    period_days = 366 if payload.billing_period == "yearly" else 31
    sub.plan_slug = plan.slug
    sub.billing_period = payload.billing_period
    sub.status = "active"
    sub.start_date = now
    sub.end_date = now + timedelta(days=period_days)
    sub.amount_paid_cents = new_amount
    sub.pending_refund_cents = (sub.pending_refund_cents or 0) + max(0, leftover_cents)
    note = f"\n{now.date()}: Downgraded to {plan.name} ({payload.billing_period}) — ${credit_cents/100:.2f} credit from prior plan"
    if leftover_cents > 0:
        note += f", ${leftover_cents/100:.2f} refund pending admin approval"
    sub.notes = ((sub.notes or "") + note).strip()
    await db.commit()

    user = current_user
    try:
        smtp_cfg = await get_system_smtp_config(db)
        send_payment_confirmation_email(
            smtp_cfg, user.email, user.name, plan.name, payload.billing_period,
            f"${leftover_cents/100:.2f} refund pending approval" if leftover_cents > 0 else "$0.00 (covered by credit)",
        )
    except Exception as e:
        print(f"[billing change-plan] Failed to send confirmation email to {user.email}: {e}")

    return {"requires_payment": False, "credit_applied_cents": credit_cents, "pending_refund_cents": max(0, leftover_cents)}


@router.post("/cancel-plan")
async def cancel_plan(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cancel the current ACTIVE paid plan immediately (not at its
    original end_date). The prorated, unused portion is calculated
    right now and queued as pending_refund_cents — deliberately NOT
    refunded automatically here. A cancellation is pure cash leaving
    the account with no offsetting plan change, so it always needs an
    admin to review and manually issue it (see admin_issue_refund
    below), unlike upgrade/downgrade, which apply credit automatically
    since a live plan swap is happening in the same transaction. A free
    demo has nothing to refund — this just ends it."""
    sub = (await db.execute(select(Subscription).where(Subscription.user_id == current_user.id))).scalar_one_or_none()
    if not sub or sub.status not in ("active", "demo"):
        raise HTTPException(400, "You don't have an active plan to cancel.")

    now = datetime.utcnow()
    credit_cents = compute_unused_credit_cents(sub, now) if sub.status == "active" else 0

    await record_subscription_history(db, sub)
    was_status = sub.status
    sub.status = "cancelled"
    sub.end_date = now
    sub.pending_refund_cents = (sub.pending_refund_cents or 0) + credit_cents
    note = f"\n{now.date()}: Cancelled ({was_status})"
    if credit_cents:
        note += f" — ${credit_cents/100:.2f} prorated credit calculated, pending admin approval to refund"
    sub.notes = ((sub.notes or "") + note).strip()
    await db.commit()

    return {"cancelled": True, "pending_refund_cents": credit_cents}


class IssueRefundRequest(BaseModel):
    amount_cents: int = 0  # 0 = refund the full pending_refund_cents


@router.post("/admin/subscriptions/{sub_user_id}/issue-refund")
async def admin_issue_refund(
    sub_user_id: int,
    payload: IssueRefundRequest,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """The manual step that actually moves money for a cancellation's
    prorated credit — see cancel_plan's docstring for why this isn't
    automatic. Supports a partial amount (payload.amount_cents) for a
    negotiated/partial refund; defaults to the full pending amount."""
    sub = (await db.execute(select(Subscription).where(Subscription.user_id == sub_user_id))).scalar_one_or_none()
    if not sub or not (sub.pending_refund_cents or 0):
        raise HTTPException(400, "This user has no pending refund.")
    if not sub.stripe_payment_intent_id:
        raise HTTPException(400, "No payment record to refund against — this needs to be handled outside Stripe.")

    amount = payload.amount_cents or sub.pending_refund_cents
    if amount <= 0 or amount > sub.pending_refund_cents:
        raise HTTPException(400, f"amount_cents must be between 1 and the pending amount (${sub.pending_refund_cents/100:.2f}).")

    stripe = await _get_stripe(db)
    try:
        stripe.Refund.create(payment_intent=sub.stripe_payment_intent_id, amount=amount)
    except Exception as e:
        raise HTTPException(502, f"Stripe refund failed: {str(e)[:200]}")

    now = datetime.utcnow()
    sub.pending_refund_cents = (sub.pending_refund_cents or 0) - amount
    sub.refunded_cents = (sub.refunded_cents or 0) + amount
    sub.notes = ((sub.notes or "") + f"\n{now.date()}: Admin issued ${amount/100:.2f} refund").strip()
    await db.commit()

    return {"refunded_cents": amount, "remaining_pending_cents": sub.pending_refund_cents}


@router.get("/admin/pending-refunds")
async def admin_list_pending_refunds(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Queue for the manual refund step cancel_plan defers — every
    subscription still sitting on an un-actioned prorated credit."""
    rows = (await db.execute(select(Subscription).where(Subscription.pending_refund_cents > 0))).scalars().all()
    user_ids = [r.user_id for r in rows]
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()} if user_ids else {}
    plan_names = {p.slug: p.name for p in (await db.execute(select(PricingPlan))).scalars().all()}
    return [
        {
            "user_id": r.user_id,
            "user_email": users[r.user_id].email if r.user_id in users else "",
            "user_name": users[r.user_id].name if r.user_id in users else "",
            "plan_name": plan_names.get(r.plan_slug, r.plan_slug),
            "pending_refund_cents": r.pending_refund_cents or 0,
            "has_payment_record": bool(r.stripe_payment_intent_id),
            "cancelled_at": r.updated_at.isoformat() if r.updated_at else None,
            "notes": r.notes or "",
        }
        for r in rows
    ]


# ── Admin Console: manage plans ──────────────────────────────────────────

class PricingPlanIn(BaseModel):
    slug: str
    name: str
    description: str = ""
    price_monthly_cents: int = 0
    price_yearly_cents: int = 0
    badge: str = ""
    highlight: bool = False
    is_free_demo: bool = False
    demo_days: int = 14
    max_candidates: int = 0
    features: List[str] = []
    sort_order: int = 0
    is_active: bool = True


def _fmt_admin_plan(p: PricingPlan) -> dict:
    return {
        "id": p.id, "slug": p.slug, "name": p.name, "description": p.description or "",
        "price_monthly_cents": p.price_monthly_cents or 0, "price_yearly_cents": p.price_yearly_cents or 0,
        "badge": p.badge or "", "highlight": bool(p.highlight),
        "is_free_demo": bool(p.is_free_demo), "demo_days": p.demo_days or 0,
        "max_candidates": p.max_candidates or 0,
        "features": p.features or [], "sort_order": p.sort_order or 0, "is_active": bool(p.is_active),
    }


@router.get("/admin/plans")
async def admin_list_plans(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(PricingPlan).order_by(PricingPlan.sort_order))).scalars().all()
    return [_fmt_admin_plan(p) for p in rows]


@router.post("/admin/plans")
async def admin_create_plan(payload: PricingPlanIn, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(select(PricingPlan).where(PricingPlan.slug == payload.slug))).scalar_one_or_none()
    if existing:
        raise HTTPException(400, f"A plan with slug '{payload.slug}' already exists.")
    p = PricingPlan(**payload.dict())
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return _fmt_admin_plan(p)


@router.put("/admin/plans/{plan_id}")
async def admin_update_plan(plan_id: int, payload: PricingPlanIn, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    p = (await db.execute(select(PricingPlan).where(PricingPlan.id == plan_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Plan not found.")
    for k, v in payload.dict().items():
        setattr(p, k, v)
    p.updated_at = datetime.utcnow()
    await db.commit()
    return _fmt_admin_plan(p)


@router.delete("/admin/plans/{plan_id}")
async def admin_delete_plan(plan_id: int, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    p = (await db.execute(select(PricingPlan).where(PricingPlan.id == plan_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Plan not found.")
    await db.delete(p)
    await db.commit()
    return {"deleted": True}
