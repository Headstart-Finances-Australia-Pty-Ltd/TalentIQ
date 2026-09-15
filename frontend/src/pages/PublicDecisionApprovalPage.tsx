import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, XCircle, Calendar, MapPin, Users, Gavel } from "lucide-react";
import { publicDecisionApprovalApi } from "../lib/api";

// Interview Decision's "send an online approval request" option — a
// named approver reviews the candidate/round here and records their
// own Approve/Reject plus comments, no login required (the token IS
// their identity). Multiple approvers can each have their own copy of
// this link for the same round; each one's submission is independent.
export default function PublicDecisionApprovalPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [comments, setComments] = useState("");
  const [pendingAction, setPendingAction] = useState<"Approved" | "Rejected" | null>(null);
  const [result, setResult] = useState<"Approved" | "Rejected" | null>(null);

  const load = () => {
    if (!token) return;
    setLoading(true);
    publicDecisionApprovalApi.get(token)
      .then((res) => {
        setData(res);
        setComments(res.comments || "");
        if (res.status === "Approved" || res.status === "Rejected") setResult(res.status);
      })
      .catch((e) => setError(e?.response?.data?.detail || "This approval link is invalid or has expired."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [token]);

  const submit = async (status: "Approved" | "Rejected") => {
    if (!token) return;
    setActing(true);
    try {
      await publicDecisionApprovalApi.submit(token, { status, comments });
      setResult(status);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not record your decision.");
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return <PageShell><div style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>Loading…</div></PageShell>;
  }

  if (error && !data) {
    return (
      <PageShell>
        <div style={{ textAlign: "center", padding: 20 }}>
          <XCircle size={40} color="#ef4444" style={{ marginBottom: 12 }} />
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Link not valid</div>
          <div style={{ color: "#6b7280", fontSize: 13 }}>{error}</div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, color: "#8b5cf6" }}>
        <Gavel size={18} />
        <span style={{ fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: 0.4 }}>Hiring Decision Approval</span>
      </div>
      <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 2 }}>{data.candidate_name}</div>
      <div style={{ color: "#6b7280", fontSize: 13, marginBottom: 20 }}>
        {data.round_name} — {data.interview_type} {data.requisition_title ? `· ${data.requisition_title}` : ""}
      </div>

      <div style={{ display: "grid", gap: 10, marginBottom: 20 }}>
        {data.scheduled_at && (
          <DetailRow icon={<Calendar size={15} />} label={new Date(data.scheduled_at).toLocaleString()} />
        )}
        {data.location_or_link && <DetailRow icon={<MapPin size={15} />} label={data.location_or_link} />}
        {data.interviewers?.length > 0 && (
          <DetailRow icon={<Users size={15} />} label={data.interviewers.filter(Boolean).join(", ")} />
        )}
      </div>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 20 }}>
        Requested of <strong>{data.approver_name}</strong>
      </div>

      {result ? (
        result === "Approved" ? (
          <StatusBanner icon={<CheckCircle2 size={20} color="#10b981" />} color="#10b981" bg="rgba(16,185,129,.1)"
            text="You've approved this hiring decision. The recruiter has been notified." />
        ) : (
          <StatusBanner icon={<XCircle size={20} color="#ef4444" />} color="#ef4444" bg="rgba(239,68,68,.1)"
            text="You've marked this hiring decision as not approved. The recruiter has been notified." />
        )
      ) : (
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
            Comments (optional)
          </label>
          <textarea
            value={comments} onChange={(e) => setComments(e.target.value)} rows={4}
            placeholder="Any notes to go along with your decision…"
            style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 12, boxSizing: "border-box", resize: "vertical" }}
          />
          {error && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 10 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setPendingAction("Rejected"); submit("Rejected"); }} disabled={acting}
              style={{ flex: 1, padding: "12px 16px", borderRadius: 8, border: "1px solid #ef4444", background: "#fff", color: "#ef4444", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
              {acting && pendingAction === "Rejected" ? "Submitting…" : "Not Approved"}
            </button>
            <button onClick={() => { setPendingAction("Approved"); submit("Approved"); }} disabled={acting}
              style={{ flex: 1, padding: "12px 16px", borderRadius: 8, border: "none", background: "#10b981", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
              {acting && pendingAction === "Approved" ? "Submitting…" : "Approve"}
            </button>
          </div>
        </div>
      )}
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 28, maxWidth: 460, width: "100%", boxShadow: "0 1px 3px rgba(0,0,0,.08)" }}>
        {children}
      </div>
    </div>
  );
}

function DetailRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#374151" }}>
      <span style={{ color: "#8b5cf6", display: "flex" }}>{icon}</span>
      {label}
    </div>
  );
}

function StatusBanner({ icon, color, bg, text }: { icon: React.ReactNode; color: string; bg: string; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderRadius: 10, background: bg, color, fontSize: 13, fontWeight: 600 }}>
      {icon} {text}
    </div>
  );
}
