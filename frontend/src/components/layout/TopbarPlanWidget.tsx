import { useEffect, useState } from "react";
import { X, TrendingUp, Check, Clock, AlertTriangle } from "lucide-react";
import { billingApi } from "../../lib/api";

function fmtPrice(cents: number) {
  if (!cents) return "Free";
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: cents % 100 === 0 ? 0 : 2 })}`;
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.getUTCFullYear() >= 9999 ? "Never" : d.toLocaleDateString();
}
// Days until end_date, or null if there's no real end date to count down
// to (no plan, or the 9999 "never expires" sentinel — see auth.py's
// register() for where that comes from).
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (d.getUTCFullYear() >= 9999) return null;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}
// Client-side estimate only, shown before confirming a cancel/downgrade
// so the person knows roughly what to expect — the real number is
// always computed server-side (routers/billing.py's
// compute_unused_credit_cents) at the moment the action is confirmed,
// since that's the only place with authoritative, up-to-the-second data.
function estimateUnusedCreditCents(sub: any): number {
  if (!sub || sub.status !== "active" || !sub.start_date || !sub.end_date || !sub.amount_paid_cents) return 0;
  const start = new Date(sub.start_date).getTime();
  const end = new Date(sub.end_date).getTime();
  const totalDays = Math.max(1, (end - start) / 86400000);
  const remainingDays = Math.max(0, (end - Date.now()) / 86400000);
  if (remainingDays <= 0) return 0;
  return Math.round(sub.amount_paid_cents * (remainingDays / totalDays));
}

/**
 * The app topbar's plan badge + "Upgrade Plan" button, plus a
 * self-triggered renewal-reminder toast. Reachable from here:
 *   - An expiry warning toast that appears ON ITS OWN (no click needed)
 *     whenever the current plan's end_date is 7 days away or less —
 *     shown once per browser session (dismissing it, or upgrading,
 *     both suppress it until the next full page load) rather than
 *     nagging on every navigation within the app.
 *   - Clicking the plan name badge opens the PLAN HISTORY popup — current
 *     term plus every past term this user has ever had (see
 *     routers/billing.py's my-plan-history / SubscriptionHistory), plus
 *     a "Cancel Plan" action with a prorated-refund preview.
 *   - Clicking "Upgrade Plan" opens the plan PICKER popup. Selecting a
 *     plan when there's already an active paid one goes through
 *     billingApi.changePlan (prorated switch — see routers/billing.py)
 *     instead of a brand new full-price checkout; selecting a plan with
 *     no active paid plan yet uses the original createCheckout flow.
 *     Either way, a payment (when one's still needed) opens as an
 *     actual popup window — the same window.open + postMessage pattern
 *     PricingPage.tsx already uses, so there's only one checkout
 *     implementation to keep working, not two that could drift apart.
 */
export default function TopbarPlanWidget() {
  const [current, setCurrent] = useState<any>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showExpiryToast, setShowExpiryToast] = useState(false);

  const loadCurrent = () => {
    billingApi.mySubscription().then((data) => {
      setCurrent(data);
      const days = daysUntil(data?.end_date);
      // <= 7 days out, and not already expired past the point a renewal
      // would even help (a genuinely lapsed plan still shows via the
      // "No Plan"/expired badge itself, not this toast) — 0 covers
      // "expires today".
      if (data?.status !== "none" && days !== null && days <= 7 && days >= 0) {
        setShowExpiryToast(true);
      }
    }).catch(() => {});
  };
  useEffect(loadCurrent, []);

  const planLabel = current?.plan_slug
    ? current.plan_slug.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
    : "No Plan";
  const daysLeft = daysUntil(current?.end_date);

  return (
    <>
      <button
        onClick={() => setShowHistory(true)}
        title="View plan history"
        style={{
          display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600,
          color: "var(--text-secondary)", padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)",
          background: "transparent", cursor: "pointer",
        }}
      >
        <Clock size={12} /> {planLabel}
      </button>
      {/* Already on the top plan — nothing left to upgrade TO, so the
          button (and the "expires soon" nudge toward it below) would
          just be pointing an Enterprise customer at a picker with
          nothing above their current plan. */}
      {current?.plan_slug !== "enterprise" && (
        <button
          onClick={() => setShowPicker(true)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700,
            color: "#fff", padding: "5px 12px", borderRadius: 6, border: "none",
            background: "var(--teal-500, #00c7b7)", cursor: "pointer",
          }}
        >
          <TrendingUp size={12} /> {current?.status === "active" ? "Change Plan" : "Upgrade Plan"}
        </button>
      )}

      {showExpiryToast && daysLeft !== null && (
        <div style={{
          position: "fixed", top: 64, right: 24, zIndex: 1250, maxWidth: 340,
          background: "#fff", color: "#111827", borderRadius: 12, padding: 14,
          boxShadow: "0 12px 32px rgba(0,0,0,.18)", border: "1px solid #fde68a",
          display: "flex", gap: 10, alignItems: "flex-start",
        }}>
          <AlertTriangle size={18} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 3 }}>
              {daysLeft === 0 ? "Your plan expires today" : `Your plan expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
              {planLabel} ends {fmtDate(current?.end_date)}. Renew now to avoid any interruption.
            </div>
            <button
              onClick={() => { setShowExpiryToast(false); setShowPicker(true); }}
              style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "var(--teal-500, #00c7b7)", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}
            >
              Upgrade Now
            </button>
          </div>
          <button onClick={() => setShowExpiryToast(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", flexShrink: 0 }}>
            <X size={15} />
          </button>
        </div>
      )}

      {showHistory && (
        <PlanHistoryPopup
          onClose={() => setShowHistory(false)}
          current={current}
          onCancelled={() => { loadCurrent(); }}
        />
      )}
      {showPicker && (
        <PlanPickerPopup
          current={current}
          onClose={() => setShowPicker(false)}
          onUpgraded={() => { loadCurrent(); }}
        />
      )}
    </>
  );
}

function PlanPickerPopup({ current, onClose, onUpgraded }: { current: any; onClose: () => void; onUpgraded: () => void }) {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    billingApi.listPlans().then(setPlans).finally(() => setLoading(false));
  }, []);

  // Same postMessage contract Stripe's success/cancel page
  // (CheckoutResultPage.tsx) already posts back to PricingPage — reused
  // verbatim here so that page doesn't need to know or care which
  // window opened the popup. Applies whether the popup came from a
  // brand new checkout OR a change-plan upgrade balance — both land on
  // the same success_url/cancel_url.
  useEffect(() => {
    const onMessageEvt = (e: MessageEvent) => {
      if (e.data?.type !== "stripe-checkout-result") return;
      setBusySlug(null);
      if (e.data.status === "success") {
        setMessage({ ok: true, text: "Payment successful — your plan is now active." });
        onUpgraded();
      } else if (e.data.status === "cancelled") {
        setMessage({ ok: false, text: "Checkout was cancelled — no charge was made." });
      }
    };
    window.addEventListener("message", onMessageEvt);
    return () => window.removeEventListener("message", onMessageEvt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startFreeDemo = async (slug: string) => {
    setMessage(null);
    setBusySlug(slug);
    try {
      await billingApi.startFreeDemo();
      setMessage({ ok: true, text: "Your free demo has started." });
      onUpgraded();
    } catch (e: any) {
      setMessage({ ok: false, text: e?.response?.data?.detail || "Failed to start the free demo." });
    } finally {
      setBusySlug(null);
    }
  };

  const openStripePopup = (checkout_url: string) => {
    const w = 480, h = 720;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const popup = window.open(checkout_url, "stripe_checkout", `width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) {
      setMessage({ ok: false, text: "Your browser blocked the payment popup — allow popups for this site and try again." });
      setBusySlug(null);
    }
  };

  const hasActivePlan = current?.status === "active" && !!current?.plan_slug;

  const selectPlan = async (slug: string) => {
    setMessage(null);
    setBusySlug(slug);
    try {
      if (hasActivePlan) {
        // Already on a paid plan — prorate the switch instead of a
        // fresh full-price checkout.
        const result = await billingApi.changePlan(slug, period);
        if (result.requires_payment) {
          setMessage({
            ok: true,
            text: `$${(result.credit_applied_cents / 100).toFixed(2)} credit applied from your current plan — `
              + `pay the remaining $${(result.net_charge_cents / 100).toFixed(2)} to switch.`,
          });
          openStripePopup(result.checkout_url);
        } else {
          setBusySlug(null);
          setMessage({
            ok: true,
            text: result.pending_refund_cents > 0
              ? `Switched plans immediately — a $${(result.pending_refund_cents / 100).toFixed(2)} refund for the leftover credit is pending admin approval.`
              : "Switched plans immediately — your existing credit fully covered the new plan.",
          });
          onUpgraded();
        }
      } else {
        const { checkout_url } = await billingApi.createCheckout(slug, period);
        openStripePopup(checkout_url);
      }
    } catch (e: any) {
      setMessage({ ok: false, text: e?.response?.data?.detail || "Failed to change plan." });
      setBusySlug(null);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1300, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 720, width: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,.4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{hasActivePlan ? "Change Plan" : "Upgrade Plan"}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 16 }}>
          {hasActivePlan
            ? "Switching plans credits the unused time left on your current plan toward the new one — you'll only " +
              "pay the difference (or get any leftover refunded automatically if the new plan costs less)."
            : "Choose a plan below. Paid plans open Stripe Checkout in a popup window — this window stays open, and " +
              "you'll see a confirmation here once payment completes."}
        </p>

        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {(["monthly", "yearly"] as const).map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              style={{
                padding: "6px 14px", borderRadius: 20, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                border: period === p ? "none" : "1px solid #e5e7eb",
                background: period === p ? "#111827" : "transparent",
                color: period === p ? "#fff" : "#374151",
              }}>
              {p === "monthly" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>

        {message && (
          <div className={`tiq-alert ${message.ok ? "tiq-alert-success" : "tiq-alert-error"}`} style={{ marginBottom: 14, fontSize: 13 }}>
            {message.text}
          </div>
        )}

        {loading ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>Loading plans…</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(plans.length, 3)}, 1fr)`, gap: 12 }}>
            {plans.map((plan) => {
              const price = plan.is_free_demo ? 0 : (period === "yearly" ? plan.price_yearly : plan.price_monthly);
              const isCurrent = hasActivePlan && current.plan_slug === plan.slug && current.billing_period === period;
              return (
                <div key={plan.slug} style={{ border: isCurrent ? "2px solid var(--teal-500, #00c7b7)" : "1px solid #e5e7eb", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column" }}>
                  <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>{plan.name}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>
                    {plan.is_free_demo ? "Free" : `${fmtPrice(price)}${period === "yearly" ? "/yr" : "/mo"}`}
                  </div>
                  <ul style={{ listStyle: "none", padding: 0, margin: "0 0 14px", flex: 1, fontSize: 12 }}>
                    {plan.is_free_demo && !!plan.demo_days && (
                      <li style={{ display: "flex", gap: 6, marginBottom: 6 }}><Check size={13} color="#00c7b7" />{plan.demo_days}-day free access</li>
                    )}
                    {!!plan.max_candidates && (
                      <li style={{ display: "flex", gap: 6, marginBottom: 6 }}><Check size={13} color="#00c7b7" />Up to {plan.max_candidates.toLocaleString()} candidates</li>
                    )}
                    {(plan.features || []).slice(0, 3).map((f: string, i: number) => (
                      <li key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}><Check size={13} color="#00c7b7" />{f}</li>
                    ))}
                  </ul>
                  <button
                    onClick={() => plan.is_free_demo ? startFreeDemo(plan.slug) : selectPlan(plan.slug)}
                    disabled={busySlug === plan.slug || isCurrent}
                    style={{
                      padding: "9px 0", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 13,
                      cursor: isCurrent ? "default" : "pointer",
                      background: isCurrent ? "#e5e7eb" : "var(--teal-500, #00c7b7)",
                      color: isCurrent ? "#6b7280" : "#fff",
                    }}
                  >
                    {isCurrent ? "Current Plan" : busySlug === plan.slug ? "Working…" : plan.is_free_demo ? "Start Free Demo" : hasActivePlan ? "Switch to This Plan" : "Select & Pay"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanHistoryPopup({ current, onClose, onCancelled }: { current: any; onClose: () => void; onCancelled: () => void }) {
  const [data, setData] = useState<{ current: any; history: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    billingApi.myPlanHistory().then(setData).finally(() => setLoading(false));
  }, []);

  const canCancel = current?.status === "active" || current?.status === "demo";
  const estimatedRefund = estimateUnusedCreditCents(current);

  const doCancel = async () => {
    setCancelling(true);
    try {
      const r = await billingApi.cancelPlan();
      setResult({
        ok: true,
        text: r.pending_refund_cents > 0
          ? `Plan cancelled — a $${(r.pending_refund_cents / 100).toFixed(2)} refund for unused time has been `
            + `calculated and is awaiting approval. You'll receive it once an admin processes it.`
          : "Plan cancelled.",
      });
      setConfirming(false);
      onCancelled();
    } catch (e: any) {
      setResult({ ok: false, text: e?.response?.data?.detail || "Failed to cancel your plan." });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1300, display: "flex", alignItems: "center", justifyContent: "center" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 560, width: "94%", maxHeight: "84vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,.4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Your Plan</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>

        {result && (
          <div className={`tiq-alert ${result.ok ? "tiq-alert-success" : "tiq-alert-error"}`} style={{ marginBottom: 14, fontSize: 13 }}>
            {result.text}
          </div>
        )}

        {loading ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            {data?.current && (
              <div style={{ border: "2px solid var(--teal-500, #00c7b7)", borderRadius: 10, padding: 14, marginBottom: 14, background: "rgba(0,199,183,.05)" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--teal-500)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>
                  Current Plan
                </div>
                <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{data.current.plan_name || "No Plan"}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", flexWrap: "wrap", gap: 14 }}>
                  <span>Status: <strong style={{ color: "#111827" }}>{data.current.status}</strong></span>
                  <span>Start: {fmtDate(data.current.start_date)}</span>
                  <span>End: {fmtDate(data.current.end_date)}</span>
                  {!!data.current.amount_paid_cents && <span>Paid: {fmtPrice(data.current.amount_paid_cents)}</span>}
                  {!!data.current.refunded_cents && <span>Refunded: {fmtPrice(data.current.refunded_cents)}</span>}
                  {!!data.current.pending_refund_cents && (
                    <span style={{ color: "#b45309", fontWeight: 700 }}>
                      {fmtPrice(data.current.pending_refund_cents)} refund pending approval
                    </span>
                  )}
                </div>
              </div>
            )}

            {canCancel && !result?.ok && (
              <div style={{ marginBottom: 18 }}>
                {!confirming ? (
                  <button
                    onClick={() => setConfirming(true)}
                    style={{ fontSize: 12.5, fontWeight: 700, color: "#dc2626", background: "none", border: "1px solid #fecaca", borderRadius: 8, padding: "7px 14px", cursor: "pointer" }}
                  >
                    Cancel Plan
                  </button>
                ) : (
                  <div style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 10, padding: 14 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: "#991b1b" }}>
                      Cancel your current plan?
                    </div>
                    <div style={{ fontSize: 12.5, color: "#7f1d1d", marginBottom: 12 }}>
                      {current?.status === "active" && estimatedRefund > 0
                        ? `You'll lose access immediately, and an estimated ${fmtPrice(estimatedRefund)} will be refunded ` +
                          `to your original card for the unused time remaining on this term. The exact amount is ` +
                          `calculated at the moment you confirm.`
                        : "You'll lose access immediately. There's no remaining unused time to refund."}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={doCancel}
                        disabled={cancelling}
                        style={{ fontSize: 12.5, fontWeight: 700, color: "#fff", background: "#dc2626", border: "none", borderRadius: 8, padding: "7px 14px", cursor: "pointer" }}
                      >
                        {cancelling ? "Cancelling…" : "Yes, Cancel & Refund"}
                      </button>
                      <button
                        onClick={() => setConfirming(false)}
                        disabled={cancelling}
                        style={{ fontSize: 12.5, fontWeight: 700, color: "#374151", background: "none", border: "1px solid #d1d5db", borderRadius: 8, padding: "7px 14px", cursor: "pointer" }}
                      >
                        Never mind
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>
              Past Plans & Payments
            </div>
            {!data?.history?.length ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>No previous plan history yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.history.map((h) => (
                  <div key={h.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 13.5 }}>{h.plan_name}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>{h.status}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)", display: "flex", flexWrap: "wrap", gap: 12 }}>
                      <span>{fmtDate(h.start_date)} → {fmtDate(h.end_date)}</span>
                      {!!h.amount_paid_cents && <span>Paid {fmtPrice(h.amount_paid_cents)}</span>}
                      {h.stripe_checkout_session_id && <span style={{ fontFamily: "monospace" }}>{h.stripe_checkout_session_id.slice(0, 20)}…</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
