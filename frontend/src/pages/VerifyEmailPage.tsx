import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, XCircle, Loader2, Zap, Home } from "lucide-react";
import { authApi } from "../lib/api";
import { useAuth } from "../hooks/useAuth";

// Lands here when the person clicks the link from send_verification_email
// (backend utils/email_send.py) — "/verify-email?token=...". Fires the
// verification call once on mount; success returns a real access token
// (see backend routers/auth.py's verify_email()), which we store via
// loginWithToken so the person is signed in immediately rather than
// being bounced back to a login form right after proving they own the
// email address.
export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();

  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [error, setError] = useState("");
  const [resendEmail, setResendEmail] = useState("");
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  // StrictMode-safe: effects run twice in dev, and the token is
  // single-use server-side, so a second call would otherwise land on
  // the (now-correct) "invalid or expired" branch even though the first
  // call actually succeeded.
  const ranOnce = useRef(false);

  useEffect(() => {
    if (ranOnce.current) return;
    ranOnce.current = true;

    if (!token) {
      setStatus("error");
      setError("This verification link is missing its token. Check the full link from your email.");
      return;
    }

    authApi.verifyEmail(token)
      .then((data) => {
        loginWithToken(data.access_token, data.user);
        setStatus("success");
        setTimeout(() => navigate("/app"), 1500);
      })
      .catch((err: any) => {
        setStatus("error");
        setError(err?.response?.data?.detail || "This verification link is invalid or has expired.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleResend = async () => {
    if (!resendEmail.trim()) return;
    setResendState("sending");
    try {
      await authApi.resendVerification(resendEmail.trim());
    } finally {
      setResendState("sent");
    }
  };

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
        <div className="tiq-brand-row" style={{ justifyContent: "center" }}>
          <div className="tiq-brand-icon"><Zap size={16} color="#f97316" fill="#f97316" /></div>
          <span className="tiq-logo-wordmark" style={{ fontSize: 20, color: "#00c7b7" }}>TalentIQ Solution</span>
        </div>

        {status === "verifying" && (
          <>
            <div style={{ margin: "20px 0" }}>
              <Loader2 size={32} className="tiq-spin" color="#00c7b7" />
            </div>
            <h1 className="tiq-auth-title">Verifying your email…</h1>
            <p className="tiq-auth-sub">Just a moment.</p>
          </>
        )}

        {status === "success" && (
          <>
            <div style={{
              width: 56, height: 56, borderRadius: "50%", background: "rgba(0,199,183,.1)",
              display: "flex", alignItems: "center", justifyContent: "center", margin: "16px auto",
            }}>
              <CheckCircle2 size={26} color="#00c7b7" />
            </div>
            <h1 className="tiq-auth-title">Email verified!</h1>
            <p className="tiq-auth-sub">Taking you to your dashboard…</p>
          </>
        )}

        {status === "error" && (
          <>
            <div style={{
              width: 56, height: 56, borderRadius: "50%", background: "rgba(239,68,68,.1)",
              display: "flex", alignItems: "center", justifyContent: "center", margin: "16px auto",
            }}>
              <XCircle size={26} color="#ef4444" />
            </div>
            <h1 className="tiq-auth-title">Verification failed</h1>
            <p className="tiq-auth-sub" style={{ marginBottom: 20 }}>{error}</p>

            {resendState === "sent" ? (
              <div className="tiq-alert tiq-alert-success">
                If that email exists and isn't verified yet, a new link was sent.
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="email" className="tiq-input" placeholder="you@company.com"
                  value={resendEmail} onChange={(e) => setResendEmail(e.target.value)}
                />
                <button
                  type="button" className="tiq-btn tiq-btn-primary"
                  onClick={handleResend} disabled={!resendEmail.trim() || resendState === "sending"}
                >
                  {resendState === "sending" ? "Sending…" : "Resend link"}
                </button>
              </div>
            )}

            <div className="tiq-auth-footer">
              <Link to="/login" className="tiq-auth-link">Back to sign in</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
