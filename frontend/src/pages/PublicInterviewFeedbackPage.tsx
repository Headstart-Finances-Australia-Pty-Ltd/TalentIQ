import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, XCircle, Calendar, Clock, MapPin, Star, ClipboardList } from "lucide-react";
import { publicInterviewFeedbackApi } from "../lib/api";

const RECOMMENDATION_OPTIONS = ["Strong Yes", "Yes", "Neutral", "No", "Strong No"];
const RECOMMENDATION_COLORS: Record<string, string> = {
  "Strong Yes": "#10b981", Yes: "#0d9488", Neutral: "#64748b", No: "#f59e0b", "Strong No": "#ef4444",
};
const DEFAULT_CRITERIA = ["Technical Skills", "Communication", "Culture Fit", "Overall Impression"];

export default function PublicInterviewFeedbackPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [recommendation, setRecommendation] = useState("Yes");
  const [criteriaScores, setCriteriaScores] = useState(DEFAULT_CRITERIA.map((c) => ({ criterion: c, score: 3, notes: "" })));
  const [strengths, setStrengths] = useState("");
  const [concerns, setConcerns] = useState("");
  const [overallNotes, setOverallNotes] = useState("");

  useEffect(() => {
    if (!token) return;
    publicInterviewFeedbackApi.get(token)
      .then((res) => { setData(res); if (res.already_submitted) setSubmitted(true); })
      .catch((e) => setError(e?.response?.data?.detail || "This feedback link is invalid or has expired."))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async () => {
    if (!token) return;
    setSubmitting(true);
    setError("");
    try {
      await publicInterviewFeedbackApi.submit(token, {
        recommendation, criteria_scores: criteriaScores, strengths, concerns, overall_notes: overallNotes,
      });
      setSubmitted(true);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not submit your feedback.");
    } finally {
      setSubmitting(false);
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
        <ClipboardList size={18} />
        <span style={{ fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: 0.4 }}>Interview Feedback</span>
      </div>
      <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 2 }}>{data.candidate_name}</div>
      <div style={{ color: "#6b7280", fontSize: 13, marginBottom: 4 }}>
        {data.round_name} — {data.interview_type} {data.requisition_title ? `· ${data.requisition_title}` : ""}
      </div>
      <div style={{ color: "#8b5cf6", fontSize: 12, fontWeight: 600, marginBottom: 20 }}>
        You're submitting as: {data.interviewer_name}
      </div>

      <div style={{ display: "grid", gap: 10, marginBottom: 22 }}>
        {data.scheduled_at && <DetailRow icon={<Calendar size={15} />} label={new Date(data.scheduled_at).toLocaleString()} />}
        <DetailRow icon={<Clock size={15} />} label={`${data.duration_minutes} minutes`} />
        {data.location_or_link && <DetailRow icon={<MapPin size={15} />} label={data.location_or_link} />}
      </div>

      {data.interview_status === "Cancelled" ? (
        <StatusBanner icon={<XCircle size={20} color="#ef4444" />} color="#ef4444" bg="rgba(239,68,68,.1)"
          text="This interview was cancelled — feedback can no longer be submitted." />
      ) : submitted ? (
        <StatusBanner icon={<CheckCircle2 size={20} color="#10b981" />} color="#10b981" bg="rgba(16,185,129,.1)"
          text="Thanks — your feedback has been recorded." />
      ) : (
        <div>
          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 8 }}>Recommendation</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {RECOMMENDATION_OPTIONS.map((r) => (
                <button key={r} type="button" onClick={() => setRecommendation(r)}
                  style={{
                    padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
                    border: recommendation === r ? `1.5px solid ${RECOMMENDATION_COLORS[r]}` : "1px solid #e5e7eb",
                    color: recommendation === r ? RECOMMENDATION_COLORS[r] : "#6b7280",
                    background: recommendation === r ? `${RECOMMENDATION_COLORS[r]}18` : "#fff",
                  }}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 8 }}>Criteria</label>
            {criteriaScores.map((c, idx) => (
              <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 13 }}>{c.criterion}</span>
                <div style={{ display: "flex", gap: 2 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" onClick={() => {
                      const next = [...criteriaScores]; next[idx] = { ...next[idx], score: n }; setCriteriaScores(next);
                    }} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                      <Star size={16} fill={n <= c.score ? "#f59e0b" : "none"} color="#f59e0b" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <FormField label="Strengths" value={strengths} onChange={setStrengths} />
          <FormField label="Concerns" value={concerns} onChange={setConcerns} />
          <FormField label="Overall Notes" value={overallNotes} onChange={setOverallNotes} />

          {error && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 10 }}>{error}</div>}
          <button onClick={submit} disabled={submitting}
            style={{ width: "100%", padding: "12px 16px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, marginTop: 6 }}>
            {submitting ? "Submitting…" : "Submit Feedback"}
          </button>
        </div>
      )}
    </PageShell>
  );
}

function FormField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 6 }}>{label}</label>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2}
        style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, fontSize: 13, boxSizing: "border-box", fontFamily: "inherit" }} />
    </div>
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
