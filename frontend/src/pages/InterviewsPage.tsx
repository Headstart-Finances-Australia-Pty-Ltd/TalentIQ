import { useEffect, useState } from "react";
import {
  Plus, X, Trash2, Link2, Copy, Check, Calendar, ClipboardList,
  ChevronDown, Star, ExternalLink, Bot, RefreshCw,
} from "lucide-react";
import { interviewApi, acquisitionApi, requisitionApi, avatarInterviewApi } from "../lib/api";

const STATUS_FLOW = ["Requested", "Scheduled", "Completed", "Cancelled", "No-Show", "Rescheduled"];
const INTERVIEW_TYPES = ["HR Screening", "Telephonic Screening", "Video Interview (AI Avatar)", "Specialist", "Hiring Manager", "Panel"];
const AVATAR_INTERVIEW_TYPE = "Video Interview (AI Avatar)";
// Only "HR Screening" is ever self-schedulable — enforced server-side too
// (see backend capabilities/interview/router.py), this mirrors that so
// the UI doesn't offer an option the API will just reject.
const SELF_SCHEDULABLE_TYPES = new Set(["HR Screening", "Telephonic Screening"]);
const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  Requested: { fg: "#64748b", bg: "rgba(100,116,139,.12)" },
  Scheduled: { fg: "#0d9488", bg: "rgba(13,148,136,.12)" },
  Completed: { fg: "#10b981", bg: "rgba(16,185,129,.12)" },
  Cancelled: { fg: "#ef4444", bg: "rgba(239,68,68,.12)" },
  "No-Show": { fg: "#f59e0b", bg: "rgba(245,158,11,.12)" },
  Rescheduled: { fg: "#8b5cf6", bg: "rgba(139,92,246,.12)" },
};
const RECOMMENDATION_OPTIONS = ["Strong Yes", "Yes", "Neutral", "No", "Strong No"];
const RECOMMENDATION_COLORS: Record<string, string> = {
  "Strong Yes": "#10b981", Yes: "#0d9488", Neutral: "#64748b", No: "#f59e0b", "Strong No": "#ef4444",
};
const DEFAULT_CRITERIA = ["Technical Skills", "Communication", "Culture Fit", "Overall Impression"];

const emptyForm = {
  candidate_id: "" as string | number,
  requisition_id: "" as string | number,
  round_name: "", round_number: 1,
  interview_type: "HR Screening",
  interviewers: [{ name: "", email: "" }],
  duration_minutes: 60, location_or_link: "",
  scheduling_mode: "fixed" as "fixed" | "self_schedule",
  scheduled_at: "",
  proposed_slots: [""] as string[],
  notes: "",
};

export default function InterviewsPage() {
  const [interviews, setInterviews] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [requisitions, setRequisitions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [scorecardTarget, setScorecardTarget] = useState<any | null>(null);
  const [scorecards, setScorecards] = useState<any[]>([]);
  const [scorecardForm, setScorecardForm] = useState<any>(null);
  const [savingScorecard, setSavingScorecard] = useState(false);

  const [linkModalInterview, setLinkModalInterview] = useState<any | null>(null);
  const [generatedLink, setGeneratedLink] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [calendlyConfigured, setCalendlyConfigured] = useState(false);
  const [generatingCalendly, setGeneratingCalendly] = useState(false);

  const [avatarModalInterview, setAvatarModalInterview] = useState<any | null>(null);
  const [avatarSession, setAvatarSession] = useState<any | null>(null);
  const [loadingAvatarSession, setLoadingAvatarSession] = useState(false);
  const [creatingAvatarSession, setCreatingAvatarSession] = useState(false);
  const [avatarSessionError, setAvatarSessionError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [iv, cands, reqs] = await Promise.all([
        interviewApi.list(statusFilter ? { status: statusFilter } : undefined),
        acquisitionApi.listCandidates(),
        requisitionApi.list(),
      ]);
      setInterviews(iv);
      setCandidates(cands);
      setRequisitions(reqs);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter]);

  useEffect(() => {
    interviewApi.calendlyStatus().then((s) => setCalendlyConfigured(s.configured)).catch(() => setCalendlyConfigured(false));
  }, []);

  const candidateName = (id: number) => candidates.find((c) => c.id === id)?.full_name || "";

  const openAdd = () => {
    setForm(emptyForm); setEditingId(null); setFormError(""); setShowForm(true);
  };
  const openEdit = (i: any) => {
    setForm({
      candidate_id: i.candidate_id, requisition_id: i.requisition_id ?? "",
      round_name: i.round_name, round_number: i.round_number,
      interview_type: i.interview_type || "HR Screening",
      interviewers: i.interviewers?.length ? i.interviewers : [{ name: "", email: "" }],
      duration_minutes: i.duration_minutes, location_or_link: i.location_or_link,
      scheduling_mode: "fixed",
      scheduled_at: i.scheduled_at ? i.scheduled_at.slice(0, 16) : "",
      proposed_slots: i.proposed_slots?.length ? i.proposed_slots.map((s: string) => s.slice(0, 16)) : [""],
      notes: i.notes,
    });
    setEditingId(i.id);
    setFormError("");
    setShowForm(true);
  };

  const submitForm = async () => {
    if (!form.candidate_id) { setFormError("Select a candidate."); return; }
    if (!form.round_name.trim()) { setFormError("Round name is required."); return; }
    setSaving(true);
    setFormError("");
    const interviewers = form.interviewers.filter((x) => x.name.trim());
    try {
      if (editingId) {
        await interviewApi.update(editingId, {
          round_name: form.round_name, round_number: Number(form.round_number),
          interview_type: form.interview_type,
          interviewers, duration_minutes: Number(form.duration_minutes),
          location_or_link: form.location_or_link,
          requisition_id: form.requisition_id === "" ? null : Number(form.requisition_id),
          scheduled_at: form.scheduling_mode === "fixed" && form.scheduled_at ? new Date(form.scheduled_at).toISOString() : undefined,
          notes: form.notes,
        });
      } else {
        const payload: any = {
          candidate_id: Number(form.candidate_id),
          requisition_id: form.requisition_id === "" ? null : Number(form.requisition_id),
          round_name: form.round_name, round_number: Number(form.round_number),
          interview_type: form.interview_type,
          interviewers, duration_minutes: Number(form.duration_minutes),
          location_or_link: form.location_or_link, notes: form.notes,
        };
        if (form.scheduling_mode === "fixed" && form.scheduled_at) {
          payload.scheduled_at = new Date(form.scheduled_at).toISOString();
        } else if (form.scheduling_mode === "self_schedule") {
          payload.proposed_slots = form.proposed_slots.filter(Boolean).map((s) => new Date(s).toISOString());
        }
        await interviewApi.create(payload);
      }
      setShowForm(false);
      await load();
    } catch (e: any) {
      setFormError(e?.response?.data?.detail || "Could not save interview.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this interview? This cannot be undone.")) return;
    try {
      await interviewApi.remove(id);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not delete this interview.");
    }
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selected.size === interviews.length) setSelected(new Set());
    else setSelected(new Set(interviews.map((i) => i.id)));
  };
  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected interview(s)? This cannot be undone.`)) return;
    try {
      await interviewApi.bulkDelete(Array.from(selected));
      setSelected(new Set());
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not delete the selected interviews.");
    }
  };

  const handleStatusChange = async (id: number, status: string) => {
    if (status === "Cancelled") {
      const reason = prompt("Reason for cancelling (optional):") || "";
      try { await interviewApi.changeStatus(id, status, reason); await load(); }
      catch (e: any) { alert(e?.response?.data?.detail || "Could not change status."); }
      return;
    }
    try {
      await interviewApi.changeStatus(id, status);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not change status.");
    }
  };

  // ── Scorecards ─────────────────────────────────────────────────────
  const openScorecards = async (i: any) => {
    setScorecardTarget(i);
    const list = await interviewApi.listScorecards(i.id);
    setScorecards(list);
    setScorecardForm(null);
  };
  const openNewScorecard = () => {
    setScorecardForm({
      interviewer_name: "", recommendation: "Yes",
      criteria_scores: DEFAULT_CRITERIA.map((c) => ({ criterion: c, score: 3, notes: "" })),
      strengths: "", concerns: "", overall_notes: "",
    });
  };
  const saveScorecard = async () => {
    if (!scorecardTarget || !scorecardForm) return;
    if (!scorecardForm.interviewer_name.trim()) { alert("Interviewer name is required."); return; }
    setSavingScorecard(true);
    try {
      await interviewApi.createScorecard(scorecardTarget.id, scorecardForm);
      const list = await interviewApi.listScorecards(scorecardTarget.id);
      setScorecards(list);
      setScorecardForm(null);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not save scorecard.");
    } finally {
      setSavingScorecard(false);
    }
  };
  const deleteScorecard = async (id: number) => {
    if (!confirm("Delete this scorecard?")) return;
    await interviewApi.deleteScorecard(id);
    if (scorecardTarget) {
      const list = await interviewApi.listScorecards(scorecardTarget.id);
      setScorecards(list);
    }
    await load();
  };

  // ── Self-schedule link generation ───────────────────────────────────
  const openLinkModal = (i: any) => {
    setLinkModalInterview(i);
    setGeneratedLink("");
  };
  const generateLink = async (slots: string[]) => {
    if (!linkModalInterview) return;
    const validSlots = slots.filter(Boolean).map((s) => new Date(s).toISOString());
    if (validSlots.length === 0) { alert("Add at least one proposed time slot."); return; }
    try {
      const res = await interviewApi.createSelfScheduleLink(linkModalInterview.id, validSlots);
      setGeneratedLink(`${window.location.origin}${res.schedule_url_path}`);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not generate the scheduling link.");
    }
  };
  const copyLink = () => {
    navigator.clipboard.writeText(generatedLink);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const generateCalendlyLink = async () => {
    if (!linkModalInterview) return;
    setGeneratingCalendly(true);
    try {
      const res = await interviewApi.createCalendlyLink(linkModalInterview.id);
      setGeneratedLink(res.calendly_scheduling_url);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not generate a Calendly link.");
    } finally {
      setGeneratingCalendly(false);
    }
  };

  // ── AI Avatar Interview ─────────────────────────────────────────────
  const openAvatarModal = async (i: any) => {
    setAvatarModalInterview(i);
    setAvatarSession(null);
    setAvatarSessionError("");
    setLoadingAvatarSession(true);
    try {
      const sessions = await avatarInterviewApi.listByInterview(i.id);
      if (sessions.length > 0) {
        const full = await avatarInterviewApi.get(sessions[0].id);
        setAvatarSession(full);
      }
    } finally {
      setLoadingAvatarSession(false);
    }
  };
  const createAvatarSession = async () => {
    if (!avatarModalInterview) return;
    setCreatingAvatarSession(true);
    setAvatarSessionError("");
    try {
      const session = await avatarInterviewApi.create(avatarModalInterview.id);
      setAvatarSession(session);
    } catch (e: any) {
      setAvatarSessionError(e?.response?.data?.detail || "Could not set up the avatar interview.");
    } finally {
      setCreatingAvatarSession(false);
    }
  };
  const refreshAvatarSession = async () => {
    if (!avatarSession) return;
    setLoadingAvatarSession(true);
    try {
      const full = await avatarInterviewApi.get(avatarSession.id);
      setAvatarSession(full);
    } finally {
      setLoadingAvatarSession(false);
    }
  };

  return (
    <div className="tiq-content">
      <div className="tiq-page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="tiq-page-title">Interviews</div>
          <div className="tiq-page-sub">From "let's interview them" to a recorded decision.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={openAdd}>
            <Plus size={14} /> Schedule Interview
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button className={`tiq-btn tiq-btn-sm ${statusFilter === "" ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setStatusFilter("")}>All</button>
        {STATUS_FLOW.map((s) => (
          <button key={s} className={`tiq-btn tiq-btn-sm ${statusFilter === s ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setStatusFilter(s)}>{s}</button>
        ))}
        {selected.size > 0 && (
          <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ marginLeft: "auto", color: "#ef4444", borderColor: "#ef4444" }}
                  onClick={handleBulkDelete}>
            <Trash2 size={13} /> Delete {selected.size} selected
          </button>
        )}
      </div>

      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : interviews.length === 0 ? (
        <div className="tiq-empty">No interviews scheduled yet. Click "Schedule Interview" to set one up.</div>
      ) : (
        <div className="tiq-table-wrap">
          <table className="tiq-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input type="checkbox" checked={interviews.length > 0 && selected.size === interviews.length} onChange={toggleSelectAll} />
                </th>
                <th>Candidate</th>
                <th>Round</th>
                <th>Requisition</th>
                <th>When</th>
                <th>Duration</th>
                <th>Interviewers</th>
                <th>Location / Link</th>
                <th>Status</th>
                <th>Scorecards</th>
                <th style={{ width: 160 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {interviews.map((i) => {
                const colors = STATUS_COLORS[i.status] || STATUS_COLORS.Requested;
                return (
                  <tr key={i.id}>
                    <td><input type="checkbox" checked={selected.has(i.id)} onChange={() => toggleSelect(i.id)} /></td>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>{i.candidate_name || candidateName(i.candidate_id)}</td>
                    <td style={{ fontSize: 12 }}>
                      {i.round_name} <span style={{ color: "var(--text-muted)" }}>#{i.round_number}</span>
                      <div>
                        <span className="tiq-badge tiq-badge-slate" style={{ fontSize: 10 }}>{i.interview_type || "HR Screening"}</span>
                      </div>
                    </td>
                    <td style={{ fontSize: 12 }}>{i.requisition_title || "—"}</td>
                    <td style={{ fontSize: 12 }}>
                      {i.scheduled_at ? new Date(i.scheduled_at).toLocaleString() : (
                        i.calendly_scheduling_url ? (
                          <a href={i.calendly_scheduling_url} target="_blank" rel="noreferrer" style={{ color: "var(--brand-teal, #0d9488)" }}>
                            Calendly link sent
                          </a>
                        ) : i.self_schedule_token ? <span style={{ color: "var(--text-muted)" }}>Awaiting self-schedule</span> : "—"
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>{i.duration_minutes} min</td>
                    <td style={{ fontSize: 12 }}>{(i.interviewers || []).map((x: any) => x.name).join(", ") || "—"}</td>
                    <td style={{ fontSize: 12, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={i.location_or_link}>
                      {i.location_or_link || "—"}
                    </td>
                    <td>
                      <div style={{ position: "relative", display: "inline-block" }}>
                        <select
                          value={i.status}
                          onChange={(e) => handleStatusChange(i.id, e.target.value)}
                          style={{
                            fontSize: 11, fontWeight: 700, padding: "4px 22px 4px 10px", borderRadius: 999,
                            border: "none", color: colors.fg, background: colors.bg, appearance: "none", cursor: "pointer",
                          }}
                        >
                          {STATUS_FLOW.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <ChevronDown size={11} style={{ position: "absolute", right: 6, top: 6, pointerEvents: "none", color: colors.fg }} />
                      </div>
                    </td>
                    <td>
                      <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => openScorecards(i)}>
                        <ClipboardList size={12} /> {i.scorecard_count || 0}
                      </button>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Edit" onClick={() => openEdit(i)}>Edit</button>
                        {SELF_SCHEDULABLE_TYPES.has(i.interview_type || "HR Screening") ? (
                          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Self-schedule link" onClick={() => openLinkModal(i)}><Link2 size={13} /></button>
                        ) : (
                          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" disabled style={{ opacity: 0.35, cursor: "not-allowed" }}
                                  title={`${i.interview_type} rounds must be scheduled directly — self-scheduling isn't available`}>
                            <Link2 size={13} />
                          </button>
                        )}
                        {i.interview_type === AVATAR_INTERVIEW_TYPE && (
                          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="AI Avatar Interview" onClick={() => openAvatarModal(i)}>
                            <Bot size={13} />
                          </button>
                        )}
                        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Delete" onClick={() => handleDelete(i.id)}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add/Edit Interview Modal ─────────────────────────────── */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 640, width: "94%", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{editingId ? "Edit Interview" : "Schedule Interview"}</div>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            {formError && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 12 }}>{formError}</div>}

            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Candidate *</label>
                <select className="tiq-select" value={form.candidate_id} disabled={!!editingId}
                        onChange={(e) => setForm({ ...form, candidate_id: e.target.value })}>
                  <option value="">— Select candidate —</option>
                  {candidates.map((c: any) => <option key={c.id} value={c.id}>{c.full_name} {c.current_title ? `— ${c.current_title}` : ""}</option>)}
                </select></div>
              <div className="tiq-form-group"><label className="tiq-label">Requisition (optional)</label>
                <select className="tiq-select" value={form.requisition_id}
                        onChange={(e) => setForm({ ...form, requisition_id: e.target.value })}>
                  <option value="">— Not linked to a requisition —</option>
                  {requisitions.map((r: any) => <option key={r.id} value={r.id}>{r.title}</option>)}
                </select></div>
            </div>

            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Round Name *</label>
                <input className="tiq-input" value={form.round_name} placeholder="e.g. Phone Screen, Technical, Onsite"
                       onChange={(e) => setForm({ ...form, round_name: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Round Number</label>
                <input className="tiq-input" type="number" min={1} value={form.round_number}
                       onChange={(e) => setForm({ ...form, round_number: Number(e.target.value) })} /></div>
            </div>

            <div className="tiq-form-group">
              <label className="tiq-label">Interview Type</label>
              <select className="tiq-select" value={form.interview_type}
                      onChange={(e) => setForm({ ...form, interview_type: e.target.value, scheduling_mode: SELF_SCHEDULABLE_TYPES.has(e.target.value) ? form.scheduling_mode : "fixed" })}>
                {INTERVIEW_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                {SELF_SCHEDULABLE_TYPES.has(form.interview_type)
                  ? "Candidates can pick their own time for this round."
                  : "This round type must be scheduled directly by a recruiter — no self-scheduling link is available for it."}
              </div>
            </div>

            <div className="tiq-form-group">
              <label className="tiq-label">Interviewers</label>
              {form.interviewers.map((iv, idx) => (
                <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <input className="tiq-input" placeholder="Name" value={iv.name}
                         onChange={(e) => {
                           const next = [...form.interviewers]; next[idx] = { ...next[idx], name: e.target.value };
                           setForm({ ...form, interviewers: next });
                         }} />
                  <input className="tiq-input" placeholder="Email (optional)" value={iv.email}
                         onChange={(e) => {
                           const next = [...form.interviewers]; next[idx] = { ...next[idx], email: e.target.value };
                           setForm({ ...form, interviewers: next });
                         }} />
                  <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => {
                    setForm({ ...form, interviewers: form.interviewers.filter((_, i2) => i2 !== idx) });
                  }}><X size={14} /></button>
                </div>
              ))}
              <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => setForm({ ...form, interviewers: [...form.interviewers, { name: "", email: "" }] })}>
                + Add interviewer
              </button>
            </div>

            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Duration (minutes)</label>
                <input className="tiq-input" type="number" min={15} step={15} value={form.duration_minutes}
                       onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Location / Video Call Link</label>
                <input className="tiq-input" value={form.location_or_link}
                       onChange={(e) => setForm({ ...form, location_or_link: e.target.value })} /></div>
            </div>

            {!editingId && (
              <div className="tiq-form-group">
                <label className="tiq-label">Scheduling</label>
                <div style={{ display: "flex", gap: 16, marginBottom: 10, fontSize: 13 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="radio" checked={form.scheduling_mode === "fixed"} onChange={() => setForm({ ...form, scheduling_mode: "fixed" })} />
                    I already know the time
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: SELF_SCHEDULABLE_TYPES.has(form.interview_type) ? "pointer" : "not-allowed", opacity: SELF_SCHEDULABLE_TYPES.has(form.interview_type) ? 1 : 0.5 }}
                         title={SELF_SCHEDULABLE_TYPES.has(form.interview_type) ? "" : "Only HR Screening and Telephonic Screening rounds can be self-scheduled"}>
                    <input type="radio" disabled={!SELF_SCHEDULABLE_TYPES.has(form.interview_type)}
                           checked={form.scheduling_mode === "self_schedule"} onChange={() => setForm({ ...form, scheduling_mode: "self_schedule" })} />
                    Let the candidate pick from options
                  </label>
                </div>
                {form.scheduling_mode === "fixed" ? (
                  <input className="tiq-input" type="datetime-local" value={form.scheduled_at}
                         onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
                ) : (
                  <div>
                    {form.proposed_slots.map((slot, idx) => (
                      <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                        <input className="tiq-input" type="datetime-local" value={slot}
                               onChange={(e) => {
                                 const next = [...form.proposed_slots]; next[idx] = e.target.value;
                                 setForm({ ...form, proposed_slots: next });
                               }} />
                        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => {
                          setForm({ ...form, proposed_slots: form.proposed_slots.filter((_, i2) => i2 !== idx) });
                        }}><X size={14} /></button>
                      </div>
                    ))}
                    <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => setForm({ ...form, proposed_slots: [...form.proposed_slots, ""] })}>
                      + Add time option
                    </button>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                      A self-scheduling link will be generated after saving — find it via the <Link2 size={11} style={{ verticalAlign: "middle" }} /> icon on the interview row.
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="tiq-form-group"><label className="tiq-label">Notes</label>
              <textarea className="tiq-input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>

            <div className="tiq-flex-end">
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" disabled={saving} onClick={submitForm}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Self-Schedule Link Modal ─────────────────────────────── */}
      {linkModalInterview && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 480, width: "94%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Self-Scheduling Link</div>
              <button onClick={() => setLinkModalInterview(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              Propose a few time options for {linkModalInterview.candidate_name || candidateName(linkModalInterview.candidate_id)} — they'll pick one via a link, no login required.
            </div>

            {generatedLink ? (
              <div>
                <div className="tiq-alert tiq-alert-success" style={{ marginBottom: 12, wordBreak: "break-all", fontSize: 12 }}>{generatedLink}</div>
                <div className="tiq-flex-end">
                  <button className="tiq-btn tiq-btn-outline" onClick={copyLink}>
                    {linkCopied ? <Check size={14} /> : <Copy size={14} />} {linkCopied ? "Copied!" : "Copy Link"}
                  </button>
                  <button className="tiq-btn tiq-btn-primary" onClick={() => setLinkModalInterview(null)}>Done</button>
                </div>
              </div>
            ) : (
              <div>
                {calendlyConfigured && (
                  <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
                    <button className="tiq-btn tiq-btn-outline" style={{ width: "100%", justifyContent: "center" }}
                            onClick={generateCalendlyLink} disabled={generatingCalendly}>
                      <ExternalLink size={14} /> {generatingCalendly ? "Generating…" : "Generate Calendly Link"}
                    </button>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, textAlign: "center" }}>
                      Calendly handles time-slot picking and calendar conflicts for you.
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", margin: "10px 0" }}>— or use TalentIQ's own link —</div>
                  </div>
                )}
                <SelfScheduleSlotsForm onGenerate={generateLink} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── AI Avatar Interview Modal ────────────────────────────── */}
      {avatarModalInterview && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 640, width: "94%", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontWeight: 800, fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
                <Bot size={18} /> AI Avatar Interview
              </div>
              <button onClick={() => setAvatarModalInterview(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
              {avatarModalInterview.candidate_name} — {avatarModalInterview.round_name}
            </div>

            {loadingAvatarSession ? (
              <div style={{ textAlign: "center", padding: 24, color: "var(--text-muted)" }}>Loading…</div>
            ) : !avatarSession ? (
              <div>
                <div className="tiq-alert" style={{ marginBottom: 16, fontSize: 12, background: "rgba(59,130,246,.08)", border: "1px solid rgba(59,130,246,.2)", padding: 12, borderRadius: 8 }}>
                  This will generate personalized questions (with model answers) from the candidate's profile and the job description,
                  then create a NavTalk avatar session for them to complete. Requires a Groq key (for questions) and NavTalk credentials
                  (Settings → API Keys) — set those up first if you haven't.
                </div>
                {avatarSessionError && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 12, fontSize: 12 }}>{avatarSessionError}</div>}
                <button className="tiq-btn tiq-btn-primary" onClick={createAvatarSession} disabled={creatingAvatarSession}>
                  <Bot size={14} /> {creatingAvatarSession ? "Setting up…" : "Set Up Avatar Interview"}
                </button>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                  <AvatarStatusBadge status={avatarSession.status} />
                  <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={refreshAvatarSession}><RefreshCw size={12} /> Refresh</button>
                  {avatarSession.candidate_join_url && (
                    <a href={avatarSession.candidate_join_url} target="_blank" rel="noreferrer" className="tiq-btn tiq-btn-outline tiq-btn-sm">
                      <ExternalLink size={12} /> Candidate Join Link
                    </a>
                  )}
                </div>

                {avatarSession.failure_reason && (
                  <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 16, fontSize: 12 }}>{avatarSession.failure_reason}</div>
                )}

                {avatarSession.overall_qa_score != null && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16 }}>
                    <QaScoreTile label="Overall" value={avatarSession.overall_qa_score} />
                    <QaScoreTile label="Context" value={avatarSession.overall_context_score} />
                    <QaScoreTile label="Semantic" value={avatarSession.overall_semantic_score} />
                    <QaScoreTile label="Key Points" value={avatarSession.overall_keypoints_score} />
                  </div>
                )}

                {avatarSession.questions?.length > 0 && (
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Questions &amp; Answers</div>
                    {avatarSession.questions.map((q: any) => (
                      <div key={q.id} className="tiq-card" style={{ padding: 14, marginBottom: 10 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{q.order_index}. {q.question}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
                          <b>Model answer:</b> {q.model_answer}
                        </div>
                        {q.candidate_answer ? (
                          <>
                            <div style={{ fontSize: 12, marginBottom: 6 }}><b>Candidate's answer:</b> {q.candidate_answer}</div>
                            {q.overall_score != null && (
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 10 }}>
                                <span className="tiq-badge tiq-badge-teal">Overall: {q.overall_score}</span>
                                <span className="tiq-badge tiq-badge-slate">Context: {q.context_score}</span>
                                <span className="tiq-badge tiq-badge-slate">Semantic: {q.semantic_score}</span>
                                <span className="tiq-badge tiq-badge-slate">Key Points: {q.keypoints_score}</span>
                              </div>
                            )}
                            {q.notes && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>{q.notes}</div>}
                          </>
                        ) : (
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Awaiting candidate's answer…</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Scorecards Modal ─────────────────────────────────────── */}
      {scorecardTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 620, width: "94%", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                Scorecards — {scorecardTarget.candidate_name || candidateName(scorecardTarget.candidate_id)} ({scorecardTarget.round_name})
              </div>
              <button onClick={() => setScorecardTarget(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>

            {!scorecardForm && (
              <>
                {scorecards.length === 0 ? (
                  <div className="tiq-empty" style={{ margin: "16px 0" }}>No scorecards submitted yet.</div>
                ) : (
                  <div style={{ margin: "14px 0" }}>
                    {scorecards.map((s) => (
                      <div key={s.id} className="tiq-card" style={{ marginBottom: 10, padding: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>{s.interviewer_name}</div>
                            {s.recommendation && (
                              <span style={{ fontSize: 11, fontWeight: 700, color: RECOMMENDATION_COLORS[s.recommendation] }}>{s.recommendation}</span>
                            )}
                          </div>
                          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => deleteScorecard(s.id)}><Trash2 size={12} /></button>
                        </div>
                        {s.criteria_scores?.length > 0 && (
                          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 10 }}>
                            {s.criteria_scores.map((c: any, idx: number) => (
                              <div key={idx} style={{ fontSize: 11 }}>
                                <span style={{ color: "var(--text-muted)" }}>{c.criterion}:</span>{" "}
                                <span style={{ fontWeight: 700 }}>
                                  {Array.from({ length: 5 }).map((_, si) => (
                                    <Star key={si} size={10} fill={si < c.score ? "#f59e0b" : "none"} color="#f59e0b" style={{ verticalAlign: "middle" }} />
                                  ))}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {s.strengths && <div style={{ fontSize: 12, marginTop: 8 }}><b>Strengths:</b> {s.strengths}</div>}
                        {s.concerns && <div style={{ fontSize: 12, marginTop: 4 }}><b>Concerns:</b> {s.concerns}</div>}
                        {s.overall_notes && <div style={{ fontSize: 12, marginTop: 4, color: "var(--text-muted)" }}>{s.overall_notes}</div>}
                      </div>
                    ))}
                  </div>
                )}
                <button className="tiq-btn tiq-btn-outline" onClick={openNewScorecard}>
                  <Plus size={14} /> Add Scorecard
                </button>
              </>
            )}

            {scorecardForm && (
              <div style={{ marginTop: 14 }}>
                <div className="tiq-grid-2">
                  <div className="tiq-form-group"><label className="tiq-label">Interviewer Name *</label>
                    <input className="tiq-input" value={scorecardForm.interviewer_name}
                           onChange={(e) => setScorecardForm({ ...scorecardForm, interviewer_name: e.target.value })} /></div>
                  <div className="tiq-form-group"><label className="tiq-label">Recommendation</label>
                    <select className="tiq-select" value={scorecardForm.recommendation}
                            onChange={(e) => setScorecardForm({ ...scorecardForm, recommendation: e.target.value })}>
                      {RECOMMENDATION_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select></div>
                </div>

                <div className="tiq-form-group">
                  <label className="tiq-label">Criteria</label>
                  {scorecardForm.criteria_scores.map((c: any, idx: number) => (
                    <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                      <input className="tiq-input" style={{ flex: 1 }} value={c.criterion}
                             onChange={(e) => {
                               const next = [...scorecardForm.criteria_scores]; next[idx] = { ...next[idx], criterion: e.target.value };
                               setScorecardForm({ ...scorecardForm, criteria_scores: next });
                             }} />
                      <div style={{ display: "flex", gap: 2 }}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button key={n} type="button" onClick={() => {
                            const next = [...scorecardForm.criteria_scores]; next[idx] = { ...next[idx], score: n };
                            setScorecardForm({ ...scorecardForm, criteria_scores: next });
                          }} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                            <Star size={16} fill={n <= c.score ? "#f59e0b" : "none"} color="#f59e0b" />
                          </button>
                        ))}
                      </div>
                      <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => {
                        setScorecardForm({ ...scorecardForm, criteria_scores: scorecardForm.criteria_scores.filter((_: any, i2: number) => i2 !== idx) });
                      }}><X size={13} /></button>
                    </div>
                  ))}
                  <button className="tiq-btn tiq-btn-ghost tiq-btn-sm"
                          onClick={() => setScorecardForm({ ...scorecardForm, criteria_scores: [...scorecardForm.criteria_scores, { criterion: "", score: 3, notes: "" }] })}>
                    + Add criterion
                  </button>
                </div>

                <div className="tiq-form-group"><label className="tiq-label">Strengths</label>
                  <textarea className="tiq-input" rows={2} value={scorecardForm.strengths}
                            onChange={(e) => setScorecardForm({ ...scorecardForm, strengths: e.target.value })} /></div>
                <div className="tiq-form-group"><label className="tiq-label">Concerns</label>
                  <textarea className="tiq-input" rows={2} value={scorecardForm.concerns}
                            onChange={(e) => setScorecardForm({ ...scorecardForm, concerns: e.target.value })} /></div>
                <div className="tiq-form-group"><label className="tiq-label">Overall Notes</label>
                  <textarea className="tiq-input" rows={2} value={scorecardForm.overall_notes}
                            onChange={(e) => setScorecardForm({ ...scorecardForm, overall_notes: e.target.value })} /></div>

                <div className="tiq-flex-end">
                  <button className="tiq-btn tiq-btn-ghost" onClick={() => setScorecardForm(null)}>Cancel</button>
                  <button className="tiq-btn tiq-btn-primary" disabled={savingScorecard} onClick={saveScorecard}>
                    {savingScorecard ? "Saving…" : "Save Scorecard"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SelfScheduleSlotsForm({ onGenerate }: { onGenerate: (slots: string[]) => void }) {
  const [slots, setSlots] = useState<string[]>([""]);
  return (
    <div>
      {slots.map((slot, idx) => (
        <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <input className="tiq-input" type="datetime-local" value={slot}
                 onChange={(e) => { const next = [...slots]; next[idx] = e.target.value; setSlots(next); }} />
          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => setSlots(slots.filter((_, i2) => i2 !== idx))}><X size={14} /></button>
        </div>
      ))}
      <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => setSlots([...slots, ""])}>+ Add time option</button>
      <div className="tiq-flex-end" style={{ marginTop: 16 }}>
        <button className="tiq-btn tiq-btn-primary" onClick={() => onGenerate(slots)}>
          <Calendar size={14} /> Generate Link
        </button>
      </div>
    </div>
  );
}

const AVATAR_STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  "Draft": { fg: "#64748b", bg: "rgba(100,116,139,.12)" },
  "Questions Generated": { fg: "#3b82f6", bg: "rgba(59,130,246,.12)" },
  "Avatar Session Created": { fg: "#8b5cf6", bg: "rgba(139,92,246,.12)" },
  "In Progress": { fg: "#f59e0b", bg: "rgba(245,158,11,.12)" },
  "Completed": { fg: "#10b981", bg: "rgba(16,185,129,.12)" },
  "Failed": { fg: "#ef4444", bg: "rgba(239,68,68,.12)" },
};
function AvatarStatusBadge({ status }: { status: string }) {
  const c = AVATAR_STATUS_COLORS[status] || AVATAR_STATUS_COLORS.Draft;
  return <span style={{ fontSize: 11, fontWeight: 700, color: c.fg, background: c.bg, padding: "4px 12px", borderRadius: 999 }}>{status}</span>;
}
function QaScoreTile({ label, value }: { label: string; value: number | null }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800 }}>{value != null ? value : "—"}</div>
    </div>
  );
}
