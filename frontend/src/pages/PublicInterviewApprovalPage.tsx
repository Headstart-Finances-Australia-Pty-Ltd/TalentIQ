import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, XCircle, Calendar, Clock, MapPin, Users, ShieldCheck } from "lucide-react";
import { publicInterviewApprovalApi } from "../lib/api";

export default function PublicInterviewApprovalPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [result, setResult] = useState<"approved" | "cancelled" | null>(null);

  const load = () => {
    if (!token) return;
    setLoading(true);
    publicInterviewApprovalApi.get(token)
      .then((res) => {
        setData(res);
        if (res.approval_status === "Approved") setResult("approved");
        if (res.status === "Cancelled") setResult("cancelled");
      })
      .catch((e) => setError(e?.response?.data?.detail || "This approval link is invalid or has expired."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [token]);

  const approve = async () => {
    if (!token) return;
    setActing(true);
    try {
      await publicInterviewApprovalApi.approve(token);
      setResult("approved");
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not approve this interview.");
    } finally {
      setActing(false);
    }
  };

  const cancel = async () => {
    if (!token) return;
    setActing(true);
    try {
      await publicInterviewApprovalApi.cancel(token, cancelReason);
      setResult("cancelled");
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not cancel this interview.");
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
        <ShieldCheck size={18} />
        <span style={{ fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: 0.4 }}>Interview Approval</span>
      </div>
      <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 2 }}>{data.candidate_name}</div>
      <div style={{ color: "#6b7280", fontSize: 13, marginBottom: 20 }}>
        {data.round_name} — {data.interview_type} {data.requisition_title ? `· ${data.requisition_title}` : ""}
      </div>

      <div style={{ display: "grid", gap: 10, marginBottom: 24 }}>
        {data.scheduled_at && (
          <DetailRow icon={<Calendar size={15} />} label={new Date(data.scheduled_at).toLocaleString()} />
        )}
        <DetailRow icon={<Clock size={15} />} label={`${data.duration_minutes} minutes`} />
        {data.location_or_link && <DetailRow icon={<MapPin size={15} />} label={data.location_or_link} />}
        {data.interviewers?.length > 0 && (
          <DetailRow icon={<Users size={15} />} label={data.interviewers.filter(Boolean).join(", ")} />
        )}
      </div>

      {result === "approved" ? (
        <StatusBanner icon={<CheckCircle2 size={20} color="#10b981" />} color="#10b981" bg="rgba(16,185,129,.1)"
          text="You've approved this interview. The recruiter has been notified." />
      ) : result === "cancelled" ? (
        <StatusBanner icon={<XCircle size={20} color="#ef4444" />} color="#ef4444" bg="rgba(239,68,68,.1)"
          text="This interview has been cancelled." />
      ) : showCancelForm ? (
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
            Reason for cancelling (optional)
          </label>
          <textarea
            value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3}
            style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 12, boxSizing: "border-box" }}
          />
          {error && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 10 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowCancelForm(false)} disabled={acting}
              style={{ flex: 1, padding: "10px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              Back
            </button>
            <button onClick={cancel} disabled={acting}
              style={{ flex: 1, padding: "10px 16px", borderRadius: 8, border: "none", background: "#ef4444", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
              {acting ? "Cancelling…" : "Confirm Cancellation"}
            </button>
          </div>
        </div>
      ) : (
        <div>
          {error && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 10 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowCancelForm(true)} disabled={acting}
              style={{ flex: 1, padding: "12px 16px", borderRadius: 8, border: "1px solid #ef4444", background: "#fff", color: "#ef4444", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
              Cancel Interview
            </button>
            <button onClick={approve} disabled={acting}
              style={{ flex: 1, padding: "12px 16px", borderRadius: 8, border: "none", background: "#10b981", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
              {acting ? "Approving…" : "Approve Interview"}
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
