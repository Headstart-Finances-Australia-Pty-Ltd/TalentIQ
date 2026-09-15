import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Building2, FileText, MessageSquare, X } from "lucide-react";
import { publicPortalApi } from "../lib/api";

const DECISIONS = ["Approved", "Rejected", "Interview Requested", "Feedback Only"];

export default function PublicClientPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [feedbackTarget, setFeedbackTarget] = useState<any | null>(null);

  const load = () => {
    if (!token) return;
    publicPortalApi.getClientPortal(token)
      .then(setData)
      .catch((e) => setError(e?.response?.data?.detail || "This portal link is invalid or has been revoked."))
      .finally(() => setLoading(false));
  };
  useEffect(load, [token]);

  if (loading) return <Centered>Loading…</Centered>;
  if (error) return <Centered><span style={{ color: "#ef4444" }}>{error}</span></Centered>;
  if (!data) return null;

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: "32px 20px" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <Building2 size={22} />
          <div style={{ fontWeight: 800, fontSize: 20 }}>{data.client_name}</div>
        </div>

        {data.requisitions.length === 0 ? (
          <div style={{ color: "#64748b" }}>No open requisitions to review right now.</div>
        ) : (
          data.requisitions.map((req: any) => (
            <div key={req.id} style={{ background: "#fff", borderRadius: 14, padding: 20, marginBottom: 20, boxShadow: "0 2px 12px rgba(0,0,0,.04)" }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{req.title}</div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>{req.status}</div>
              {req.candidates.length === 0 ? (
                <div style={{ fontSize: 13, color: "#94a3b8" }}>No candidates submitted for this role yet.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {req.candidates.map((c: any) => (
                    <div key={c.pipeline_entry_id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{c.full_name}</div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>{c.current_title} {c.current_employer ? `at ${c.current_employer}` : ""}</div>
                        {c.total_experience_years && <div style={{ fontSize: 12, color: "#64748b" }}>{c.total_experience_years} years experience</div>}
                        {c.skills?.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                            {c.skills.slice(0, 6).map((s: string) => (
                              <span key={s} style={{ fontSize: 10, background: "#f1f5f9", padding: "2px 8px", borderRadius: 999 }}>{s}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#0d9488", background: "rgba(13,148,136,.1)", padding: "3px 10px", borderRadius: 999 }}>{c.stage}</span>
                        {c.has_resume && (
                          <a href={publicPortalApi.clientResumeUrl(token!, c.pipeline_entry_id)} target="_blank" rel="noreferrer"
                             style={{ fontSize: 12, color: "#0d9488", display: "flex", alignItems: "center", gap: 4 }}>
                            <FileText size={12} /> View Resume
                          </a>
                        )}
                        <button onClick={() => setFeedbackTarget(c)} style={{ fontSize: 12, color: "#fff", background: "#0d9488", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                          <MessageSquare size={12} /> Give Feedback
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {feedbackTarget && (
        <FeedbackModal
          candidate={feedbackTarget}
          onClose={() => setFeedbackTarget(null)}
          onSubmit={async (contact_name, decision, comments) => {
            await publicPortalApi.submitClientFeedback(token!, { pipeline_entry_id: feedbackTarget.pipeline_entry_id, contact_name, decision, comments });
            setFeedbackTarget(null);
          }}
        />
      )}
    </div>
  );
}

function FeedbackModal({ candidate, onClose, onSubmit }: { candidate: any; onClose: () => void; onSubmit: (name: string, decision: string, comments: string) => Promise<void> }) {
  const [contactName, setContactName] = useState("");
  const [decision, setDecision] = useState("Feedback Only");
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!contactName.trim()) { alert("Please enter your name."); return; }
    setSubmitting(true);
    try {
      await onSubmit(contactName, decision, comments);
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 24, maxWidth: 440, width: "94%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Feedback — {candidate.full_name}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>
        {done ? (
          <div style={{ textAlign: "center", padding: "16px 0", color: "#0d9488", fontWeight: 600 }}>Thanks — your feedback has been sent.</div>
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>Your Name</label>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb" }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>Decision</label>
              <select value={decision} onChange={(e) => setDecision(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb" }}>
                {DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>Comments</label>
              <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb" }} />
            </div>
            <button onClick={submit} disabled={submitting} style={{ width: "100%", padding: 10, borderRadius: 8, border: "none", background: "#0d9488", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
              {submitting ? "Sending…" : "Submit Feedback"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>{children}</div>;
}
