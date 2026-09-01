import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, Zap } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { billingApi } from "../lib/api";

function fmtPrice(cents: number) {
  if (!cents) return "Free";
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: cents % 100 === 0 ? 0 : 2 })}`;
}

// Public Pricing page — reached via the "Pricing" nav link next to "Job
// Seeker Tools" on the landing page. Paid plans open Stripe Checkout as
// an actual popup window (window.open), not a full-page redirect away
// from TalentIQ — the popup's success/cancel page (CheckoutResultPage)
// posts a message back here and closes itself once done, so this page
// never has to navigate away at all.
export default function PricingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    billingApi.listPlans().then(setPlans).finally(() => setLoading(false));
  }, []);

  // Listens for the popup's postMessage once Stripe redirects it to our
  // own success/cancel page — see CheckoutResultPage.tsx.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== "stripe-checkout-result") return;
      setBusySlug(null);
      if (e.data.status === "success") {
        setMessage({ ok: true, text: "Payment successful — your plan is now active." });
      } else if (e.data.status === "cancelled") {
        setMessage({ ok: false, text: "Checkout was cancelled — no charge was made." });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const openCheckoutPopup = async (slug: string) => {
    if (!user) { navigate("/login", { state: { from: "/pricing" } }); return; }
    setMessage(null);
    setBusySlug(slug);
    try {
      const { checkout_url } = await billingApi.createCheckout(slug, period);
      const w = 480, h = 720;
      const left = window.screenX + (window.outerWidth - w) / 2;
      const top = window.screenY + (window.outerHeight - h) / 2;
      const popup = window.open(checkout_url, "stripe_checkout", `width=${w},height=${h},left=${left},top=${top}`);
      if (!popup) {
        setMessage({ ok: false, text: "Your browser blocked the payment popup — allow popups for this site and try again." });
        setBusySlug(null);
      }
    } catch (e: any) {
      setMessage({ ok: false, text: e?.response?.data?.detail || "Failed to start checkout." });
      setBusySlug(null);
    }
  };

  const startFreeDemo = async () => {
    if (!user) { navigate("/login", { state: { from: "/pricing" } }); return; }
    setMessage(null);
    setBusySlug("free_demo");
    try {
      await billingApi.startFreeDemo();
      // Pull the actual configured length from the plan data already
      // loaded above, rather than a hardcoded "14-day" — otherwise this
      // message goes stale the moment an admin changes demo_days in
      // Admin Console, exactly like the plan card's own copy used to.
      const demoPlan = plans.find((p) => p.is_free_demo);
      const days = demoPlan?.demo_days || 14;
      setMessage({ ok: true, text: `Your ${days}-day free demo has started — head to your dashboard.` });
    } catch (e: any) {
      setMessage({ ok: false, text: e?.response?.data?.detail || "Failed to start the free demo." });
    } finally {
      setBusySlug(null);
    }
  };

  return (
    <div style={{ background: "#ffffff", color: "#0f172a", fontFamily: "'Inter',system-ui,sans-serif", minHeight: "100vh" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 5%", height: 68, borderBottom: "1px solid #f1f5f9" }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "#5ee8db", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Zap size={18} color="#f97316" fill="#f97316" />
          </div>
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.5px", color: "#00c7b7" }}>TalentIQ Solution</span>
        </Link>
        <Link to={user ? "/app" : "/login"} style={{ fontSize: 13, fontWeight: 600, padding: "8px 18px", borderRadius: 8, background: "linear-gradient(135deg,#fdba74,#fb923c)", color: "#7c2d12", textDecoration: "none" }}>
          {user ? "Go to Dashboard →" : "Sign in"}
        </Link>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "64px 24px 100px", textAlign: "center" }}>
        <h1 style={{ fontSize: "clamp(28px,4vw,42px)", fontWeight: 800, letterSpacing: "-1px", marginBottom: 12 }}>
          Simple, transparent pricing
        </h1>
        <p style={{ fontSize: 16, color: "#64748b", marginBottom: 32 }}>
          Start with a free plan. Upgrade whenever you're ready — cancel anytime.
        </p>

        <div style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: 4, borderRadius: 999, background: "#f1f5f9", marginBottom: 40 }}>
          {(["monthly", "yearly"] as const).map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              style={{
                padding: "8px 20px", borderRadius: 999, border: "none", cursor: "pointer", fontSize: 13.5, fontWeight: 700,
                background: period === p ? "#ffffff" : "transparent",
                color: period === p ? "#0f172a" : "#64748b",
                boxShadow: period === p ? "0 1px 4px rgba(0,0,0,.1)" : "none",
              }}>
              {p === "monthly" ? "Monthly" : "Yearly (save ~15%)"}
            </button>
          ))}
        </div>

        {message && (
          <div style={{
            maxWidth: 480, margin: "0 auto 32px", padding: "12px 18px", borderRadius: 10, fontSize: 13.5, fontWeight: 600,
            background: message.ok ? "rgba(16,185,129,.1)" : "rgba(239,68,68,.1)", color: message.ok ? "#10b981" : "#ef4444",
          }}>
            {message.text}
          </div>
        )}

        {loading ? (
          <div style={{ padding: 60, color: "#94a3b8" }}>Loading plans…</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(plans.length, 4)}, 1fr)`, gap: 20, textAlign: "left" }}>
            {plans.map((plan) => {
              const price = plan.is_free_demo ? 0 : (period === "yearly" ? plan.price_yearly : plan.price_monthly);
              return (
                <div key={plan.slug} style={{
                  border: plan.highlight ? "2px solid #00c7b7" : "1px solid #e2e8f0",
                  borderRadius: 16, padding: 28, position: "relative",
                  boxShadow: plan.highlight ? "0 8px 30px rgba(0,199,183,.15)" : "0 1px 4px rgba(0,0,0,.04)",
                  display: "flex", flexDirection: "column",
                }}>
                  {plan.badge && (
                    <span style={{
                      position: "absolute", top: -12, left: 24, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4,
                      textTransform: "uppercase", padding: "4px 12px", borderRadius: 999,
                      background: plan.highlight ? "#00c7b7" : "#f1f5f9", color: plan.highlight ? "#ffffff" : "#475569",
                    }}>
                      {plan.badge}
                    </span>
                  )}
                  <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6, marginTop: 6 }}>{plan.name}</div>
                  <div style={{ fontSize: 13, color: "#64748b", marginBottom: 18, minHeight: 36 }}>{plan.description}</div>
                  <div style={{ marginBottom: 20 }}>
                    <span style={{ fontSize: 34, fontWeight: 800 }}>{fmtPrice(price)}</span>
                    {!!price && <span style={{ fontSize: 13, color: "#94a3b8" }}> / {period === "yearly" ? "year" : "month"}</span>}
                  </div>
                  <ul style={{ listStyle: "none", padding: 0, margin: "0 0 24px", flex: 1 }}>
                    {/* Auto-generated from the plan's own structured fields
                        (not hand-typed text) so these two lines can never
                        go stale the way a manually-written "14 days" or
                        "Up to 25 candidates" bullet could the moment an
                        admin changes the actual demo_days/max_candidates
                        value in Admin Console. */}
                    {plan.is_free_demo && !!plan.demo_days && (
                      <li style={{ display: "flex", gap: 8, fontSize: 13.5, color: "#334155", marginBottom: 10, lineHeight: 1.4, fontWeight: 700 }}>
                        <Check size={15} color="#00c7b7" style={{ flexShrink: 0, marginTop: 1 }} />
                        {plan.demo_days}-day free access
                      </li>
                    )}
                    {!!plan.max_candidates && (
                      <li style={{ display: "flex", gap: 8, fontSize: 13.5, color: "#334155", marginBottom: 10, lineHeight: 1.4, fontWeight: 700 }}>
                        <Check size={15} color="#00c7b7" style={{ flexShrink: 0, marginTop: 1 }} />
                        Up to {plan.max_candidates.toLocaleString()} candidates
                      </li>
                    )}
                    {/* Drop any hand-typed Features bullet that's just
                        restating the same day-count or candidate-count
                        the two auto-generated lines above already show —
                        an admin editing the old free-text bullet to match
                        a new demo_days/max_candidates value (rather than
                        deleting it, now that it's redundant) would
                        otherwise show the same fact twice. Matched
                        loosely by shape ("N day(s)…", "…N candidates…"),
                        not exact wording, so this keeps working even if
                        the admin phrases it slightly differently next time. */}
                    {(plan.features || [])
                      .filter((f: string) => {
                        if (plan.is_free_demo && plan.demo_days && /^\s*\d+[\s-]*days?\b/i.test(f)) return false;
                        if (plan.max_candidates && /\bcandidates?\b/i.test(f) && /\d/.test(f)) return false;
                        return true;
                      })
                      .map((f: string, i: number) => (
                        <li key={i} style={{ display: "flex", gap: 8, fontSize: 13.5, color: "#334155", marginBottom: 10, lineHeight: 1.4 }}>
                          <Check size={15} color="#00c7b7" style={{ flexShrink: 0, marginTop: 1 }} />
                          {f}
                        </li>
                      ))}
                  </ul>
                  {plan.is_free_demo ? (
                    <button onClick={startFreeDemo} disabled={busySlug === plan.slug}
                      style={{ padding: "11px 0", borderRadius: 10, border: "1px solid #00c7b7", background: "#ffffff", color: "#00c7b7", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                      {busySlug === plan.slug ? "Starting…" : "Start Free Demo"}
                    </button>
                  ) : (
                    <button onClick={() => openCheckoutPopup(plan.slug)} disabled={busySlug === plan.slug}
                      style={{
                        padding: "11px 0", borderRadius: 10, border: "none", fontWeight: 700, fontSize: 14, cursor: "pointer",
                        background: plan.highlight ? "linear-gradient(135deg,#5ee8db,#00c7b7)" : "#0f172a",
                        color: plan.highlight ? "#053b36" : "#ffffff",
                      }}>
                      {busySlug === plan.slug ? "Opening checkout…" : "Subscribe"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
