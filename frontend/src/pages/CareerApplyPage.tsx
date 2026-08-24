import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Zap, CheckCircle2, Upload, Briefcase, X } from "lucide-react";
import { publicAcquisitionApi } from "../lib/api";

export default function CareerApplyPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const roleParam = searchParams.get("role"); // deep-link: /careers/:slug?role=<jd_id> auto-selects that role
  const [info, setInfo] = useState<{ organisation_name: string; open_roles: { id: number; title: string }[] } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", location: "", role_of_interest: "", jd_record_id: "" });
  const [lockedRole, setLockedRole] = useState<{ id: number; title: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [coverLetterMode, setCoverLetterMode] = useState<"none" | "file" | "text">("none");
  const [coverLetterFile, setCoverLetterFile] = useState<File | null>(null);
  const [coverLetterText, setCoverLetterText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!slug) return;
    publicAcquisitionApi.getCareerPage(slug)
      .then((data) => {
        setInfo(data);
        // Auto-populate the role from wherever this link was clicked —
        // the ?role=<jd_id> query param, matched against this org's
        // currently open roles. Falls back to the manual picker/free-text
        // if the role no longer exists or has since closed.
        if (roleParam) {
          const match = data.open_roles.find((r: any) => String(r.id) === roleParam);
          if (match) {
            setLockedRole(match);
            setForm((f) => ({ ...f, jd_record_id: String(match.id) }));
          }
        }
      })
      .catch(() => setLoadError("This careers page could not be found."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const submit = async () => {
    if (!form.full_name.trim() || !form.email.trim()) { setError("Name and email are required."); return; }
    setSubmitting(true);
    setError("");
    try {
      const data = new FormData();
      data.append("full_name", form.full_name);
      data.append("email", form.email);
      data.append("phone", form.phone);
      data.append("location", form.location);
      data.append("role_of_interest", form.role_of_interest);
      if (form.jd_record_id) data.append("jd_record_id", form.jd_record_id);
      if (file) data.append("resume", file);
      if (coverLetterMode === "file" && coverLetterFile) data.append("cover_letter_file", coverLetterFile);
      if (coverLetterMode === "text" && coverLetterText.trim()) data.append("cover_letter_text", coverLetterText.trim());
      const res = await publicAcquisitionApi.apply(slug!, data);
      setResult(res);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Something went wrong submitting your application.");
    } finally {
      setSubmitting(false);
    }
  };

  const shellStyle: React.CSSProperties = {
    minHeight: "100vh", background: "#f8fafd", display: "flex", justifyContent: "center", padding: "48px 16px",
  };
  const cardStyle: React.CSSProperties = {
    background: "#fff", borderRadius: 16, padding: 32, maxWidth: 560, width: "100%",
    boxShadow: "0 1px 3px rgba(0,0,0,.08)", border: "1px solid #e5e9f0",
  };

  if (loadError) return <div style={shellStyle}><div style={cardStyle}>{loadError}</div></div>;
  if (!info) return <div style={shellStyle}><div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div></div>;

  if (result) {
    return (
      <div style={shellStyle}>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <CheckCircle2 size={40} color="#00c7b7" style={{ marginBottom: 12 }} />
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>Application received</div>
          <div style={{ color: "var(--text-muted)", fontSize: 14 }}>{result.message}</div>
          <a href={result.portal_url_path} style={{ display: "inline-block", marginTop: 16, fontSize: 13, color: "#00c7b7" }}>
            View / update your profile anytime →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={shellStyle}>
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <Zap size={18} color="#f97316" fill="#f97316" />
          <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text-muted)" }}>Careers at {info.organisation_name}</span>
        </div>
        <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 20 }}>Apply Now</div>

        {error && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 14 }}>{error}</div>}

        {info.open_roles.length > 0 && lockedRole ? (
          <div className="tiq-form-group">
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
              background: "#EAFBF8", border: "1px solid #00c7b7", borderRadius: 10, padding: "10px 14px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Briefcase size={16} color="#009e90" />
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Applying for</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{lockedRole.title}</div>
                </div>
              </div>
              <button
                type="button"
                title="Apply for a different role instead"
                onClick={() => { setLockedRole(null); setForm({ ...form, jd_record_id: "" }); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        ) : info.open_roles.length > 0 ? (
          <div className="tiq-form-group">
            <label className="tiq-label">Role you're interested in</label>
            <select className="tiq-select" value={form.jd_record_id} onChange={(e) => setForm({ ...form, jd_record_id: e.target.value })}>
              <option value="">General application (no specific role)</option>
              {info.open_roles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          </div>
        ) : (
          <div className="tiq-form-group">
            <label className="tiq-label">What role are you interested in?</label>
            <input className="tiq-input" value={form.role_of_interest} onChange={(e) => setForm({ ...form, role_of_interest: e.target.value })} />
          </div>
        )}

        <div className="tiq-form-group"><label className="tiq-label">Full Name *</label>
          <input className="tiq-input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
        <div className="tiq-form-group"><label className="tiq-label">Email *</label>
          <input className="tiq-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div className="tiq-form-group"><label className="tiq-label">Phone</label>
          <input className="tiq-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        <div className="tiq-form-group"><label className="tiq-label">Location</label>
          <input className="tiq-input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>

        <div className="tiq-form-group">
          <label className="tiq-label">Resume (PDF/DOCX/DOC/TXT)</label>
          <label className="tiq-btn tiq-btn-outline" style={{ cursor: "pointer", display: "inline-flex" }}>
            <Upload size={14} /> {file ? file.name : "Choose file"}
            <input type="file" hidden accept=".pdf,.docx,.doc,.txt" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
        </div>

        <div className="tiq-form-group">
          <label className="tiq-label">Cover Letter (optional)</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button type="button" className={`tiq-btn tiq-btn-sm ${coverLetterMode === "none" ? "tiq-btn-primary" : "tiq-btn-outline"}`}
                    onClick={() => setCoverLetterMode("none")}>None</button>
            <button type="button" className={`tiq-btn tiq-btn-sm ${coverLetterMode === "file" ? "tiq-btn-primary" : "tiq-btn-outline"}`}
                    onClick={() => setCoverLetterMode("file")}>Upload File</button>
            <button type="button" className={`tiq-btn tiq-btn-sm ${coverLetterMode === "text" ? "tiq-btn-primary" : "tiq-btn-outline"}`}
                    onClick={() => setCoverLetterMode("text")}>Write Text</button>
          </div>
          {coverLetterMode === "file" && (
            <label className="tiq-btn tiq-btn-outline" style={{ cursor: "pointer", display: "inline-flex" }}>
              <Upload size={14} /> {coverLetterFile ? coverLetterFile.name : "Choose PDF or Word file"}
              <input type="file" hidden accept=".pdf,.docx,.doc" onChange={(e) => setCoverLetterFile(e.target.files?.[0] || null)} />
            </label>
          )}
          {coverLetterMode === "text" && (
            <textarea className="tiq-input" rows={6} value={coverLetterText} onChange={(e) => setCoverLetterText(e.target.value)}
                      placeholder="Dear Hiring Manager, ..." />
          )}
        </div>

        <button className="tiq-btn tiq-btn-primary tiq-btn-lg" style={{ width: "100%", marginTop: 8 }} disabled={submitting} onClick={submit}>
          {submitting ? "Submitting…" : "Submit Application"}
        </button>
      </div>
    </div>
  );
}
