import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Zap, Home, Check, MailCheck } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { billingApi, authApi } from "../lib/api";

function fmtPrice(cents: number) {
  if (!cents) return "Free";
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: cents % 100 === 0 ? 0 : 2 })}`;
}

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", company: "", phone: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Set once registration succeeds — swaps the form out for a "check
  // your email" screen instead of navigating anywhere, since the account
  // isn't usable yet (see backend routers/auth.py's register()/login()).
  const [registered, setRegistered] = useState<{ email: string; message: string } | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");

  // Same plan data the public Pricing page reads (billingApi.listPlans)
  // — shown here as a compact picker so a plan is chosen at signup
  // rather than left for later. Defaults to whichever plan has the
  // lowest sort_order once loaded (see the effect below); there's no
  // plan literally named "Basic" in this deployment's seeded data, so
  // "the entry-level plan, first in the list" is the closest match —
  // rename or reorder a plan in Admin Console > Pricing Plans if a
  // different one should default here instead.
  const [plans, setPlans] = useState<any[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [selectedSlug, setSelectedSlug] = useState<string>("");

  useEffect(() => {
    billingApi.listPlans()
      .then((data: any[]) => {
        setPlans(data);
        if (data.length) setSelectedSlug(data[0].slug);
      })
      .finally(() => setPlansLoading(false));
  }, []);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await register({ ...form, plan_slug: selectedSlug || undefined });
      if (result.requires_verification === false) {
        // Deploy-time exception: the platform's first-ever account is
        // pre-verified (see backend routers/auth.py's register()) since
        // there's no admin yet to have received/configured verification
        // email in the first place. Straight to sign in.
        navigate("/login");
        return;
      }
      setRegistered({ email: result.email, message: result.message });
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const status = err?.response?.status;
      const msg = err?.message;
      if (detail) setError(`Error ${status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
      else if (status) setError(`HTTP ${status}: ${JSON.stringify(err?.response?.data)}`);
      else setError(`Network error: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!registered) return;
    setResendState("sending");
    try {
      await authApi.resendVerification(registered.email);
    } finally {
      setResendState("sent");
    }
  };

  if (registered) {
    return (
      <div className="tiq-auth-wrap" style={{ position: "relative" }}>
        <Link to="/" style={{
          position: "absolute", top: 20, right: 20,
          display: "inline-flex", alignItems: "center", gap: 5,
          fontSize: 12, fontWeight: 600, color: "var(--text-muted)",
          textDecoration: "none", padding: "6px 12px", borderRadius: 6,
          border: "1px solid var(--border)",
        }}>
          <Home size={12} /> Home
        </Link>
        <div className="tiq-auth-card" style={{ maxWidth: 480, textAlign: "center" }}>
          <div style={{
            width: 56, height: 56, borderRadius: "50%", background: "rgba(0,199,183,.1)",
            display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px",
          }}>
            <MailCheck size={26} color="#00c7b7" />
          </div>
          <h1 className="tiq-auth-title">Check your email</h1>
          <p className="tiq-auth-sub" style={{ marginBottom: 4 }}>{registered.message}</p>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
            Sent to <strong>{registered.email}</strong>. The link expires in 24 hours.
          </p>

          {resendState === "sent" ? (
            <div className="tiq-alert tiq-alert-success">
              If that email exists and isn't verified yet, a new link was sent.
            </div>
          ) : (
            <button
              type="button"
              className="tiq-btn"
              style={{ width: "100%", justifyContent: "center" }}
              onClick={handleResend}
              disabled={resendState === "sending"}
            >
              {resendState === "sending" ? "Sending…" : "Resend verification email"}
            </button>
          )}

          <div className="tiq-auth-footer">
            Already verified? <Link to="/login" className="tiq-auth-link">Sign in</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tiq-auth-wrap" style={{ position: "relative" }}>
      <Link to="/" style={{
        position: "absolute", top: 20, right: 20,
        display: "inline-flex", alignItems: "center", gap: 5,
        fontSize: 12, fontWeight: 600, color: "var(--text-muted)",
        textDecoration: "none", padding: "6px 12px", borderRadius: 6,
        border: "1px solid var(--border)",
      }}
        onMouseEnter={e => { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.background = "var(--bg-secondary)"; }}
        onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "transparent"; }}>
        <Home size={12} /> Home
      </Link>
      <div className="tiq-auth-card" style={{ maxWidth: 560 }}>
        <div className="tiq-brand-row">
          <div className="tiq-brand-icon"><Zap size={16} color="#f97316" fill="#f97316" /></div>
          <span className="tiq-logo-wordmark" style={{ fontSize: 20, color: "#00c7b7" }}>TalentIQ Solution</span>
        </div>
        <h1 className="tiq-auth-title">Create your account</h1>
        <p className="tiq-auth-sub">Get started with all three AI agents</p>

        {error && (
          <div className="tiq-alert tiq-alert-error" style={{ fontFamily: "monospace", fontSize: 12, whiteSpace: "pre-wrap" }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="tiq-grid-2">
            <div className="tiq-form-group">
              <label className="tiq-label">Full name</label>
              <input className="tiq-input" value={form.name} onChange={set("name")} placeholder="Jane Smith" required />
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">Company</label>
              <input className="tiq-input" value={form.company} onChange={set("company")} placeholder="Acme Corp" />
            </div>
          </div>
          <div className="tiq-form-group">
            <label className="tiq-label">Email address</label>
            <input type="email" className="tiq-input" value={form.email} onChange={set("email")} placeholder="you@company.com" required />
          </div>
          <div className="tiq-form-group">
            <label className="tiq-label">Phone (optional)</label>
            <input className="tiq-input" value={form.phone} onChange={set("phone")} placeholder="+61 400 000 000" />
          </div>
          <div className="tiq-form-group">
            <label className="tiq-label">Password</label>
            <input type="password" className="tiq-input" value={form.password} onChange={set("password")} placeholder="min. 8 characters" required minLength={8} />
          </div>

          <div className="tiq-form-group">
            <label className="tiq-label">Choose a plan</label>
            {plansLoading ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 0" }}>Loading plans…</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(plans.length, 2)}, 1fr)`, gap: 10 }}>
                {plans.map((plan) => {
                  const selected = selectedSlug === plan.slug;
                  const price = plan.is_free_demo ? 0 : plan.price_monthly;
                  return (
                    <button
                      type="button"
                      key={plan.slug}
                      onClick={() => setSelectedSlug(plan.slug)}
                      style={{
                        textAlign: "left", padding: "12px 14px", borderRadius: 10, cursor: "pointer",
                        border: selected ? "2px solid var(--teal-500)" : "1px solid var(--border)",
                        background: selected ? "rgba(0,199,183,.06)" : "transparent",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700 }}>{plan.name}</span>
                        {selected && <Check size={14} color="var(--teal-500)" />}
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                        {plan.is_free_demo
                          ? `Free for ${plan.demo_days} days`
                          : `${fmtPrice(price)}/mo`}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            <p style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "6px 0 0" }}>
              You can change this any time from Pricing. Paid plans are set up via Stripe checkout after your account is created.
            </p>
          </div>

          <button type="submit" className="tiq-btn tiq-btn-primary"
            style={{ width: "100%", justifyContent: "center", marginTop: 8 }} disabled={loading}>
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>
        <div className="tiq-auth-footer">
          Already have an account? <Link to="/login" className="tiq-auth-link">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
