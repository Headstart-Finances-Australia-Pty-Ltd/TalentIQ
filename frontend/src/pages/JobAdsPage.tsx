import { useEffect, useState } from "react";
import { FileEdit, Send, Plus, X, Trash2, Linkedin, Briefcase } from "lucide-react";
import { jobAdsApi } from "../lib/api";
import JDCreatorPage from "./JDCreatorPage";

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  "Not Posted": { fg: "#64748b", bg: "rgba(100,116,139,.12)" },
  "Posted": { fg: "#10b981", bg: "rgba(16,185,129,.12)" },
  "Failed": { fg: "#ef4444", bg: "rgba(239,68,68,.12)" },
};
function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS["Not Posted"];
  return <span style={{ fontSize: 11, fontWeight: 700, color: c.fg, background: c.bg, padding: "3px 9px", borderRadius: 999 }}>{status}</span>;
}

const emptyForm = { title: "", description: "", location: "", employment_type: "", salary_min: "", salary_max: "" };

// Job Ads — write a Position Description once (JD Creator tab, unchanged
// functionality, just relocated here), then push the SAME job straight
// to LinkedIn and Seek (Post Job tab) instead of re-typing it into each
// site separately.
export default function JobAdsPage() {
  const [tab, setTab] = useState<"creator" | "post">("creator");

  return (
    <div className="tiq-content">
      <div className="tiq-page-header">
        <div className="tiq-page-title">Job Ads</div>
        <div className="tiq-page-sub">Write it once, post it everywhere.</div>
      </div>

      <div className="tiq-tabs" style={{ marginTop: 16, marginBottom: 20 }}>
        <button className={`tiq-tab${tab === "creator" ? " active" : ""}`} onClick={() => setTab("creator")}>
          <FileEdit size={12} style={{ display: "inline", marginRight: 6 }} /> JD Creator
        </button>
        <button className={`tiq-tab${tab === "post" ? " active" : ""}`} onClick={() => setTab("post")}>
          <Send size={12} style={{ display: "inline", marginRight: 6 }} /> Post Job
        </button>
      </div>

      {tab === "creator" && <JDCreatorPage embedded />}
      {tab === "post" && <PostJobTab />}
    </div>
  );
}

function PostJobTab() {
  const [ads, setAds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [postingId, setPostingId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setAds(await jobAdsApi.list());
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const openAdd = () => { setForm(emptyForm); setFormError(""); setShowForm(true); };
  const submitAdd = async () => {
    if (!form.title.trim()) { setFormError("Title is required."); return; }
    setSaving(true); setFormError("");
    try {
      await jobAdsApi.create({
        ...form,
        salary_min: form.salary_min ? Number(form.salary_min) : null,
        salary_max: form.salary_max ? Number(form.salary_max) : null,
      });
      setShowForm(false);
      load();
    } catch (e: any) {
      setFormError(e?.response?.data?.detail || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };
  const handleDelete = async (id: number) => {
    if (!confirm("Delete this job ad? This doesn't remove anything already posted on LinkedIn/Seek.")) return;
    await jobAdsApi.delete(id);
    load();
  };

  const post = async (id: number, channel: "linkedin" | "seek") => {
    setPostingId(id);
    try {
      const updated = channel === "linkedin" ? await jobAdsApi.postLinkedIn(id) : await jobAdsApi.postSeek(id);
      setAds((prev) => prev.map((a) => (a.id === id ? updated : a)));
    } catch (e: any) {
      // Backend already wrote the Failed status + error message onto the
      // ad itself — just refresh this one row so it shows up.
      load();
    } finally {
      setPostingId(null);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={openAdd}>
          <Plus size={14} /> New Job Ad
        </button>
      </div>

      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : ads.length === 0 ? (
        <div className="tiq-empty">
          <Send size={22} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>No job ads yet. Click "New Job Ad" to create one, then post it to LinkedIn or Seek.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {ads.map((a) => (
            <div key={a.id} className="tiq-card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{a.title}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {[a.location, a.employment_type].filter(Boolean).join(" · ") || "—"}
                    {(a.salary_min || a.salary_max) && ` · $${a.salary_min ?? "?"} – $${a.salary_max ?? "?"}`}
                  </div>
                </div>
                <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Delete" onClick={() => handleDelete(a.id)}><Trash2 size={13} /></button>
              </div>
              {a.description && <p style={{ fontSize: 13, color: "#374151", marginBottom: 12, whiteSpace: "pre-wrap" }}>{a.description}</p>}

              <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <Linkedin size={14} color="#0a66c2" />
                    <StatusBadge status={a.linkedin_status} />
                    <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => post(a.id, "linkedin")} disabled={postingId === a.id}>
                      {postingId === a.id ? "Posting…" : a.linkedin_status === "Posted" ? "Re-post" : "Post to LinkedIn"}
                    </button>
                  </div>
                  {a.linkedin_status === "Posted" && a.linkedin_post_url && (
                    <a href={a.linkedin_post_url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "var(--brand-teal, #0d9488)" }}>View on LinkedIn</a>
                  )}
                  {a.linkedin_status === "Failed" && a.linkedin_error && (
                    <div style={{ fontSize: 11.5, color: "#ef4444", maxWidth: 320 }}>{a.linkedin_error}</div>
                  )}
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <Briefcase size={14} color="#e2492c" />
                    <StatusBadge status={a.seek_status} />
                    <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => post(a.id, "seek")} disabled={postingId === a.id}>
                      {postingId === a.id ? "Posting…" : a.seek_status === "Posted" ? "Re-post" : "Post to Seek"}
                    </button>
                  </div>
                  {a.seek_status === "Posted" && a.seek_post_url && (
                    <a href={a.seek_post_url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "var(--brand-teal, #0d9488)" }}>View on Seek</a>
                  )}
                  {a.seek_status === "Failed" && a.seek_error && (
                    <div style={{ fontSize: 11.5, color: "#ef4444", maxWidth: 320 }}>{a.seek_error}</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
             onMouseDown={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 500, width: "94%", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>New Job Ad</div>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            {formError && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 12 }}>{formError}</div>}
            <div className="tiq-form-group"><label className="tiq-label">Title *</label>
              <input className="tiq-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                     placeholder="e.g. Senior Backend Engineer" /></div>
            <div className="tiq-form-group"><label className="tiq-label">Description</label>
              <textarea className="tiq-input" rows={6} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                        placeholder="Paste from JD Creator, or write here" /></div>
            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Location</label>
                <input className="tiq-input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Employment Type</label>
                <input className="tiq-input" value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value })}
                       placeholder="e.g. Full-time" /></div>
            </div>
            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Salary Min</label>
                <input className="tiq-input" type="number" value={form.salary_min} onChange={(e) => setForm({ ...form, salary_min: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Salary Max</label>
                <input className="tiq-input" type="number" value={form.salary_max} onChange={(e) => setForm({ ...form, salary_max: e.target.value })} /></div>
            </div>
            <div className="tiq-flex-end">
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" disabled={saving} onClick={submitAdd}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
