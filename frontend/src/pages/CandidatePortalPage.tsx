import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Zap, Upload, CheckCircle2 } from "lucide-react";
import { publicAcquisitionApi } from "../lib/api";

export default function CandidatePortalPage() {
  const { token } = useParams<{ token: string }>();
  const [profile, setProfile] = useState<any>(null);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState({
    phone: "", location: "", linkedin_url: "", portfolio_url: "",
    availability: "", notice_period_days: "", preferred_employment_type: "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const [coverLetterFile, setCoverLetterFile] = useState<File | null>(null);
  const [coverLetterText, setCoverLetterText] = useState("");
  const [savingCoverLetter, setSavingCoverLetter] = useState(false);

  const load = async () => {
    if (!token) return;
    try {
      const p = await publicAcquisitionApi.getProfile(token);
      setProfile(p);
      setForm({
        phone: p.phone || "", location: p.location || "", linkedin_url: p.linkedin_url || "",
        portfolio_url: p.portfolio_url || "", availability: p.availability || "",
        notice_period_days: p.notice_period_days ?? "", preferred_employment_type: p.preferred_employment_type || "",
      });
      setCoverLetterText(p.cover_letter_text || "");
    } catch {
      setLoadError("This profile link is invalid or has expired.");
    }
  };

  useEffect(() => { load(); }, [token]);

  const save = async () => {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const data = new FormData();
      Object.entries(form).forEach(([k, v]) => { if (v !== "") data.append(k, String(v)); });
      await publicAcquisitionApi.updateProfile(token!, data);
      if (file) await publicAcquisitionApi.updateResume(token!, file);
      setFile(null);
      setSaved(true);
      await load();
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not save your changes.");
    } finally {
      setSaving(false);
    }
  };

  const saveCoverLetterFile = async () => {
    if (!coverLetterFile || !token) return;
    if (!/\.(pdf|docx?)$/i.test(coverLetterFile.name)) {
      setError("Cover letter must be a PDF or Word document (.pdf, .docx, .doc).");
      return;
    }
    setSavingCoverLetter(true);
    setError("");
    try {
      await publicAcquisitionApi.updateCoverLetterFile(token, coverLetterFile);
      setCoverLetterFile(null);
      setSaved(true);
      await load();
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not upload cover letter.");
    } finally {
      setSavingCoverLetter(false);
    }
  };

  const saveCoverLetterText = async () => {
    if (!token) return;
    setSavingCoverLetter(true);
    setError("");
    try {
      await publicAcquisitionApi.updateCoverLetterText(token, coverLetterText);
      setSaved(true);
      await load();
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not save cover letter text.");
    } finally {
      setSavingCoverLetter(false);
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
  if (!profile) return <div style={shellStyle}><div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div></div>;

  return (
    <div style={shellStyle}>
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <Zap size={18} color="#f97316" fill="#f97316" />
          <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text-muted)" }}>Your Candidate Profile</span>
        </div>
        <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 4 }}>{profile.full_name}</div>
        <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>{profile.email}</div>

        {error && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 14 }}>{error}</div>}
        {saved && <div className="tiq-alert tiq-alert-success" style={{ marginBottom: 14 }}><CheckCircle2 size={14} style={{ marginRight: 6 }} />Saved.</div>}

        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
          You can keep your contact and availability details up to date below. To change your name or email, please
          contact your recruiter directly.
        </div>

        <div className="tiq-grid-2">
          <div className="tiq-form-group"><label className="tiq-label">Phone</label>
            <input className="tiq-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="tiq-form-group"><label className="tiq-label">Location</label>
            <input className="tiq-input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
          <div className="tiq-form-group"><label className="tiq-label">LinkedIn URL</label>
            <input className="tiq-input" value={form.linkedin_url} onChange={(e) => setForm({ ...form, linkedin_url: e.target.value })} /></div>
          <div className="tiq-form-group"><label className="tiq-label">Portfolio URL</label>
            <input className="tiq-input" value={form.portfolio_url} onChange={(e) => setForm({ ...form, portfolio_url: e.target.value })} /></div>
          <div className="tiq-form-group"><label className="tiq-label">Availability</label>
            <input className="tiq-input" placeholder="e.g. Immediate, 2 weeks" value={form.availability} onChange={(e) => setForm({ ...form, availability: e.target.value })} /></div>
          <div className="tiq-form-group"><label className="tiq-label">Notice Period (days)</label>
            <input className="tiq-input" type="number" value={form.notice_period_days} onChange={(e) => setForm({ ...form, notice_period_days: e.target.value })} /></div>
        </div>
        <div className="tiq-form-group"><label className="tiq-label">Preferred Employment Type</label>
          <select className="tiq-select" value={form.preferred_employment_type} onChange={(e) => setForm({ ...form, preferred_employment_type: e.target.value })}>
            <option value="">—</option>
            <option value="Full-time">Full-time</option>
            <option value="Contract">Contract</option>
            <option value="Part-time">Part-time</option>
          </select>
        </div>

        <div className="tiq-form-group">
          <label className="tiq-label">Resume {profile.has_resume && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(currently: {profile.resume_filename})</span>}</label>
          <label className="tiq-btn tiq-btn-outline" style={{ cursor: "pointer", display: "inline-flex" }}>
            <Upload size={14} /> {file ? file.name : "Replace resume"}
            <input type="file" hidden accept=".pdf,.docx,.doc,.txt" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
        </div>

        <div className="tiq-form-group">
          <label className="tiq-label">
            Cover Letter {profile.has_cover_letter && profile.cover_letter_filename && (
              <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(file on record: {profile.cover_letter_filename})</span>
            )}
          </label>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
            <label className="tiq-btn tiq-btn-outline" style={{ cursor: "pointer", display: "inline-flex" }}>
              <Upload size={14} /> {coverLetterFile ? coverLetterFile.name : "Upload PDF or Word"}
              <input type="file" hidden accept=".pdf,.docx,.doc" onChange={(e) => setCoverLetterFile(e.target.files?.[0] || null)} />
            </label>
            {coverLetterFile && (
              <button className="tiq-btn tiq-btn-primary tiq-btn-sm" disabled={savingCoverLetter} onClick={saveCoverLetterFile}>
                {savingCoverLetter ? "Uploading…" : "Save File"}
              </button>
            )}
          </div>
          <textarea className="tiq-input" rows={6} value={coverLetterText} onChange={(e) => setCoverLetterText(e.target.value)}
                    placeholder="Or write your cover letter here instead of uploading a file..." />
          <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ marginTop: 8 }} disabled={savingCoverLetter} onClick={saveCoverLetterText}>
            {savingCoverLetter ? "Saving…" : "Save Cover Letter Text"}
          </button>
        </div>

        {profile.skills?.length > 0 && (
          <div style={{ marginTop: 8, marginBottom: 8 }}>
            <div className="tiq-label">Skills on file</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {profile.skills.map((s: string) => <span key={s} className="tiq-badge tiq-badge-slate">{s}</span>)}
            </div>
          </div>
        )}

        <button className="tiq-btn tiq-btn-primary tiq-btn-lg" style={{ width: "100%", marginTop: 12 }} disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
