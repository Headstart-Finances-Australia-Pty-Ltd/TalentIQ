import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, XCircle, Lock, Zap, Home, Eye, EyeOff } from "lucide-react";
import { authApi } from "../lib/api";

// Lands here when the person clicks the link from send_password_reset_email
// (backend utils/email_send.py) — "/reset-password?token=...". Mirrors
// VerifyEmailPage.tsx's shape (token from the URL, a status state machine)
// but the token is only used on submit here rather than immediately on
// mount, since setting a new password needs input from the person first.
export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [status, setStatus] = useState<"form" | "success" | "error">(token ? "form" : "error");
  const [error, setError] = useState(
    token ? "" : "This reset link is missing its token. Check the full link from your email."
  );
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await authApi.resetPassword(token, newPassword);
      setStatus("success");
      setTimeout(() => navigate("/login"), 2000);
    } catch (err: any) {
      setStatus("error");
      setError(err?.response?.data?.detail || "This reset link is invalid or has expired.");
    } finally {
      setLoading(false);
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

        {status === "form" && (
          <>
            <h1 className="tiq-auth-title">Set a new password</h1>
            <p className="tiq-auth-sub" style={{ marginBottom: 20 }}>Choose a new password for your account.</p>

            {error && (
              <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 16, textAlign: "left" }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ textAlign: "left" }}>
              <div className="tiq-form-group">
                <label className="tiq-label">New password</label>
                <div style={{ position: "relative" }}>
                  <Lock size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
                  <input type={showPw ? "text" : "password"} className="tiq-input"
                    style={{ paddingLeft: 36, paddingRight: 40 }}
                    value={newPassword} onChange={e => setNewPassword(e.target.value)}
                    placeholder="••••••••" required autoComplete="new-password" />
                  <button type="button" onClick={() => setShowPw(s => !s)}
                    style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center" }}>
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="tiq-form-group">
                <label className="tiq-label">Confirm new password</label>
                <div style={{ position: "relative" }}>
                  <Lock size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
                  <input type={showPw ? "text" : "password"} className="tiq-input"
                    style={{ paddingLeft: 36 }}
                    value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="••••••••" required autoComplete="new-password" />
                </div>
              </div>

              <button type="submit" className="tiq-btn tiq-btn-primary"
                style={{ width: "100%", justifyContent: "center", marginTop: 8 }}
                disabled={loading}>
                {loading ? "Resetting…" : "Reset password"}
              </button>
            </form>
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
            <h1 className="tiq-auth-title">Password reset!</h1>
            <p className="tiq-auth-sub">Taking you to sign in…</p>
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
            <h1 className="tiq-auth-title">Reset failed</h1>
            <p className="tiq-auth-sub" style={{ marginBottom: 20 }}>{error}</p>
            <div className="tiq-auth-footer">
              <Link to="/login" className="tiq-auth-link">Back to sign in</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
