import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Truck, Plus, X, Upload } from "lucide-react";
import { publicPortalApi } from "../lib/api";

export default function PublicVendorPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showSubmit, setShowSubmit] = useState(false);

  const load = () => {
    if (!token) return;
    publicPortalApi.getVendorPortal(token)
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Truck size={22} />
            <div style={{ fontWeight: 800, fontSize: 20 }}>{data.vendor_name}</div>
          </div>
          <button onClick={() => setShowSubmit(true)} disabled={data.assigned_requisitions.length === 0}
                  style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: data.assigned_requisitions.length === 0 ? "#e5e7eb" : "#0d9488", color: data.assigned_requisitions.length === 0 ? "#9ca3af" : "#fff", fontWeight: 700, cursor: data.assigned_requisitions.length === 0 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={14} /> Submit a Candidate
          </button>
        </div>

        <div style={{ background: "#fff", borderRadius: 14, padding: 20, marginBottom: 20, boxShadow: "0 2px 12px rgba(0,0,0,.04)" }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Requisitions You Can Submit For</div>
          {data.assigned_requisitions.length === 0 ? (
            <div style={{ fontSize: 13, color: "#94a3b8" }}>No requisitions have been assigned to you yet — contact your recruiting partner.</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {data.assigned_requisitions.map((r: any) => (
                <span key={r.id} style={{ fontSize: 12, background: "#f1f5f9", padding: "6px 12px", borderRadius: 999 }}>{r.title}</span>
              ))}
            </div>
          )}
        </div>

        <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 2px 12px rgba(0,0,0,.04)" }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Your Submissions</div>
          {data.submissions.length === 0 ? (
            <div style={{ fontSize: 13, color: "#94a3b8" }}>You haven't submitted any candidates yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.submissions.map((s: any) => (
                <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{s.full_name}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{new Date(s.submitted_at).toLocaleDateString()}</div>
                  </div>
                  <StatusBadge status={s.status} reason={s.rejection_reason} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showSubmit && (
        <SubmitCandidateModal
          requisitions={data.assigned_requisitions}
          onClose={() => setShowSubmit(false)}
          onSubmit={async (form) => {
            await publicPortalApi.submitVendorCandidate(token!, form);
            setShowSubmit(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status, reason }: { status: string; reason?: string }) {
  const colors: Record<string, { fg: string; bg: string }> = {
    "Pending Review": { fg: "#f59e0b", bg: "rgba(245,158,11,.12)" },
    Accepted: { fg: "#10b981", bg: "rgba(16,185,129,.12)" },
    Rejected: { fg: "#ef4444", bg: "rgba(239,68,68,.12)" },
  };
  const c = colors[status] || colors["Pending Review"];
  return (
    <span title={reason || ""} style={{ fontSize: 11, fontWeight: 700, color: c.fg, background: c.bg, padding: "3px 10px", borderRadius: 999 }}>
      {status}
    </span>
  );
}

function SubmitCandidateModal({ requisitions, onClose, onSubmit }: { requisitions: any[]; onClose: () => void; onSubmit: (form: FormData) => Promise<void> }) {
  const [form, setForm] = useState({
    requisition_id: requisitions[0]?.id ?? "", full_name: "", email: "", phone: "",
    current_title: "", current_employer: "", total_experience_years: "", vendor_notes: "",
  });
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!form.requisition_id) { setError("Select a requisition."); return; }
    if (!form.full_name.trim()) { setError("Candidate name is required."); return; }
    setSubmitting(true);
    setError("");
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, String(v)));
      if (resumeFile) fd.append("resume_file", resumeFile);
      await onSubmit(fd);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not submit this candidate.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 24, maxWidth: 480, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Submit a Candidate</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>
        {error && <div style={{ background: "#fef2f2", color: "#ef4444", padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{error}</div>}

        <FormField label="Requisition *">
          <select value={form.requisition_id} onChange={(e) => setForm({ ...form, requisition_id: e.target.value })} style={inputStyle}>
            {requisitions.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
        </FormField>
        <FormField label="Candidate Name *">
          <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} style={inputStyle} />
        </FormField>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><FormField label="Email"><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={inputStyle} /></FormField></div>
          <div style={{ flex: 1 }}><FormField label="Phone"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={inputStyle} /></FormField></div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><FormField label="Current Title"><input value={form.current_title} onChange={(e) => setForm({ ...form, current_title: e.target.value })} style={inputStyle} /></FormField></div>
          <div style={{ flex: 1 }}><FormField label="Current Employer"><input value={form.current_employer} onChange={(e) => setForm({ ...form, current_employer: e.target.value })} style={inputStyle} /></FormField></div>
        </div>
        <FormField label="Total Experience (years)">
          <input value={form.total_experience_years} onChange={(e) => setForm({ ...form, total_experience_years: e.target.value })} style={inputStyle} />
        </FormField>
        <FormField label="Resume (PDF or Word)">
          <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: "1px dashed #cbd5e1", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#64748b" }}>
            <Upload size={14} /> {resumeFile ? resumeFile.name : "Choose file"}
            <input type="file" hidden accept=".pdf,.doc,.docx" onChange={(e) => setResumeFile(e.target.files?.[0] || null)} />
          </label>
        </FormField>
        <FormField label="Notes for the recruiter">
          <textarea value={form.vendor_notes} onChange={(e) => setForm({ ...form, vendor_notes: e.target.value })} rows={2} style={inputStyle} />
        </FormField>

        <button onClick={submit} disabled={submitting} style={{ width: "100%", padding: 10, borderRadius: 8, border: "none", background: "#0d9488", color: "#fff", fontWeight: 700, cursor: "pointer", marginTop: 10 }}>
          {submitting ? "Submitting…" : "Submit Candidate"}
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb" };
function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>{children}</div>;
}
