"""
Billing — pricing plans (admin-managed) + per-user subscriptions.

Structure mirrors a common pattern: plans live in the database (editable
from Admin Console, not hardcoded), and each user has a subscription
record tracking which plan, which billing period, and the exact
start/end dates of the current paid term — set explicitly rather than
relying on Stripe's own recurring-subscription billing cycle, so "when
does this expire" is always a plain, readable date on our own side
regardless of what's happening on Stripe's.

Payment itself uses a one-time Stripe Checkout Session per billing
period (not Stripe's recurring subscription objects) — simpler to reason
about, and matches "monthly or yearly, with a real start and end date"
exactly: renewing is just buying the next period the same way, not
"Stripe auto-charged me and I have to go look up why."
"""
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, JSON, Float
from sqlalchemy.orm import relationship

from db.database import Base


class PricingPlan(Base):
    """One row per plan shown on the public Pricing page and manageable
    from Admin Console — Console changes take effect immediately, no
    deploy needed, matching how a recruiter expects to tweak pricing."""
    __tablename__ = "tiq_pricing_plans"

    id                = Column(Integer, primary_key=True, index=True)
    slug              = Column(String(60), unique=True, index=True, nullable=False)  # e.g. "starter", "pro" — stable identifier for Subscription.plan_slug and Stripe metadata
    name              = Column(String(200), nullable=False)
    description       = Column(Text)
    price_monthly_cents = Column(Integer, default=0)   # 0 = free
    price_yearly_cents  = Column(Integer, default=0)   # 0 = free
    badge             = Column(String(50))              # "Popular", "Best Value", "Free", ...
    highlight         = Column(Boolean, default=False)  # visually emphasized card
    is_free_demo      = Column(Boolean, default=False)  # the one "Start Free Demo" plan, no payment required
    demo_days         = Column(Integer, default=14)     # only meaningful when is_free_demo
    # How many candidates this plan is advertised to cover (screening +
    # interview rounds combined) — 0 means unlimited/not stated. A real,
    # structured field rather than free text in `features`, specifically
    # so the number shown on the public Pricing page can be generated
    # from here instead of a hand-typed "Up to 25 candidates" bullet
    # that silently goes stale whenever the plan changes. NOTE: this is
    # a displayed/advertised limit only — nothing in the app currently
    # reads this field to actually cap how many candidates a user can
    # process; enforcing it against real usage would be separate work.
    max_candidates    = Column(Integer, default=0)
    features          = Column(JSON, default=list)      # list[str], shown as a bullet list
    sort_order        = Column(Integer, default=0)
    is_active         = Column(Boolean, default=True)   # inactive plans are hidden from the public page but kept for existing subscribers' history
    created_at        = Column(DateTime, default=datetime.utcnow)
    updated_at        = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_public_dict(self) -> dict:
        return {
            "slug": self.slug,
            "name": self.name,
            "description": self.description or "",
            "price_monthly": self.price_monthly_cents or 0,
            "price_yearly": self.price_yearly_cents or 0,
            "badge": self.badge or "",
            "highlight": bool(self.highlight),
            "is_free_demo": bool(self.is_free_demo),
            "demo_days": self.demo_days or 0,
            "max_candidates": self.max_candidates or 0,
            "features": self.features or [],
        }


class Subscription(Base):
    """A user's current (or most recent) plan term. One row is created/
    updated per activation — a renewal or upgrade updates the SAME row
    rather than piling up history rows, since "what plan is this user on
    right now" is a single current fact; see notes for a short human-
    readable log of past changes instead of a separate audit table."""
    __tablename__ = "tiq_subscriptions"

    id                       = Column(Integer, primary_key=True, index=True)
    user_id                  = Column(Integer, ForeignKey("tiq_users.id"), unique=True, index=True, nullable=False)
    plan_slug                = Column(String(60), default="")
    billing_period           = Column(String(10), default="")   # "monthly" | "yearly" | "" (free demo has no period)
    status                   = Column(String(20), default="none")  # none | demo | active | expired | cancelled
    start_date               = Column(DateTime, nullable=True)
    end_date                 = Column(DateTime, nullable=True)
    amount_paid_cents        = Column(Integer, default=0)      # last successful payment amount, for reference
    stripe_customer_id       = Column(String(120), default="")
    stripe_checkout_session_id = Column(String(120), default="")
    notes                    = Column(Text, default="")         # short human-readable log: "2026-06-01: Pro (monthly) - $49.00"
    created_at               = Column(DateTime, default=datetime.utcnow)
    updated_at               = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", backref="subscription")

    def to_dict(self) -> dict:
        return {
            "plan_slug": self.plan_slug,
            "billing_period": self.billing_period,
            "status": self.status,
            "start_date": self.start_date.isoformat() if self.start_date else None,
            "end_date": self.end_date.isoformat() if self.end_date else None,
            "amount_paid_cents": self.amount_paid_cents or 0,
        }


class SubscriptionHistory(Base):
    """Append-only log of every plan term a user has ever been on — a
    snapshot row written alongside every meaningful update to that
    user's single current Subscription row above (upgrade, renewal,
    free-demo activation, admin-granted Enterprise), never edited or
    overwritten afterward. Subscription answers "what plan is this user
    on right now"; this answers "what plans has this user ever been on,
    and what did they pay" — the "old plan data should not be
    overwritten, it can be pulled whenever required" record. See
    routers/billing.py's record_subscription_history()."""
    __tablename__ = "tiq_subscription_history"

    id                       = Column(Integer, primary_key=True, index=True)
    user_id                  = Column(Integer, ForeignKey("tiq_users.id"), index=True, nullable=False)
    plan_slug                = Column(String(60), default="")
    billing_period           = Column(String(10), default="")
    status                   = Column(String(20), default="none")
    start_date               = Column(DateTime, nullable=True)
    end_date                 = Column(DateTime, nullable=True)
    amount_paid_cents        = Column(Integer, default=0)
    stripe_checkout_session_id = Column(String(120), default="")
    notes                    = Column(Text, default="")
    recorded_at              = Column(DateTime, default=datetime.utcnow)   # when THIS history row was written, not the plan's own start_date

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "plan_slug": self.plan_slug,
            "billing_period": self.billing_period,
            "status": self.status,
            "start_date": self.start_date.isoformat() if self.start_date else None,
            "end_date": self.end_date.isoformat() if self.end_date else None,
            "amount_paid_cents": self.amount_paid_cents or 0,
            "stripe_checkout_session_id": self.stripe_checkout_session_id or "",
            "notes": self.notes or "",
            "recorded_at": self.recorded_at.isoformat() if self.recorded_at else None,
        }
