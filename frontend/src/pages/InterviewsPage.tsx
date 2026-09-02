import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Plus, X, Trash2, Link2, Copy, Check, Calendar, ClipboardList,
  ChevronDown, Star, ExternalLink, Bot, RefreshCw, ShieldCheck, Gavel, Mail, Search,
} from "lucide-react";
import { interviewApi, acquisitionApi, requisitionApi, avatarInterviewApi, api } from "../lib/api";
import { ResizableFilterHeader } from "../components/ResizableFilterHeader";

// Default column widths for the pipeline table — same resizable-column
// pattern as Requisitions/Screening, keyed by the same names used in
// getGroupColValue() below.
const INTERVIEWS_DEFAULT_COL_WIDTHS: Record<string, number> = {
  candidate: 160, requisition: 170, resume: 120, phoneLink: 120, phone: 150,
  videoEmail: 120, video: 150, panelSchedule: 140, panelInterviewers: 140,
  panelStatus: 110, panelDecision: 170,
};

// Raw, sortable/filterable value behind each column of the consolidated
// pipeline table — kept separate from the cell JSX (badges, buttons,
// stacked dates) below, since filtering/sorting always compares the
// underlying data, not the rendered markup.
function getGroupColValue(g: any, key: string): string {
  const r = g.resume, p = g.phone, v = g.video, pan = g.panel;
  switch (key) {
    case "candidate": return g.candidate_name || "";
    case "requisition": return [g.requisition_role, g.company].filter(Boolean).join(" · ");
    case "resume": return r?.status || "";
    case "phoneLink": return p?.calendly_link_sent_at ? "Sent" : "Not sent";
    case "phone": return p?.status || "";
    case "videoEmail": return v?.video_invite_sent_at ? "Sent" : "Not sent";
    case "video": return v?.status || "";
    case "panelSchedule": return pan?.scheduled_at ? new Date(pan.scheduled_at).toLocaleString() : "";
    case "panelInterviewers": return pan?.panel_number != null ? `Panel #${pan.panel_number}` : (pan?.interviewers || []).map((x: any) => x.name).join(", ");
    case "panelStatus": return pan?.status || "";
    case "panelDecision": return pan?.decision || (pan ? "Pending" : "");
    default: return "";
  }
}

// Must match the key AdminConsolePage.tsx's Modules Management > System
// Tools section toggles — that's what actually hides/shows this button,
// same pattern FileManagerPage.tsx uses for its Force Delete button.
const SYNC_CANDIDATELENS_MODULE_ROUTE = "interviews/sync-candidatelens-completions";

const STATUS_FLOW = ["Requested", "Scheduled", "Completed", "Cancelled", "No-Show", "Rescheduled"];
// Exactly three round classes. Resume Screening now lives entirely in
// its own capability (Screening -> Resume Screening / Phone Interview /
// Video Interview — the CandidateLens split), so it's not one of these.
// "Video Interview" covers every delivery mode — a live human video
// call, CandidateLens's webcam+emotion-analysis flow, or an AI Avatar
// session (Bot icon below) — chosen per round rather than a separate type.
const INTERVIEW_TYPES = ["Phone Interview", "Video Interview", "Panel Interview", "Final Interview", "HR Interview"];
const AVATAR_INTERVIEW_TYPE = "Video Interview";
// Only "Phone Interview" is ever self-schedulable — enforced
// server-side too (see backend capabilities/interview/router.py), this
// mirrors that so the UI doesn't offer an option the API will just
// reject. Video/Panel rounds involve other people's calendars a
// recruiter needs to actually coordinate.
const SELF_SCHEDULABLE_TYPES = new Set(["Phone Interview"]);
const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  Requested: { fg: "#64748b", bg: "rgba(100,116,139,.12)" },
  Scheduled: { fg: "#0d9488", bg: "rgba(13,148,136,.12)" },
  Completed: { fg: "#10b981", bg: "rgba(16,185,129,.12)" },
  Cancelled: { fg: "#ef4444", bg: "rgba(239,68,68,.12)" },
  "No-Show": { fg: "#f59e0b", bg: "rgba(245,158,11,.12)" },
  Rescheduled: { fg: "#8b5cf6", bg: "rgba(139,92,246,.12)" },
};

// Small colored status pill, editable — used in every one of the four
// per-round column groups (Resume Screening / Phone / Video / Panel) in
// the consolidated per-candidate row below.
function MiniBadge({ status, onChange }: { status: string; onChange: (s: string) => void }) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.Requested;
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <select
        value={status}
        onChange={(e) => onChange(e.target.value)}
        style={{
          fontSize: 11, fontWeight: 700, padding: "4px 20px 4px 9px", borderRadius: 999,
          border: "none", color: colors.fg, background: colors.bg, appearance: "none", WebkitAppearance: "none", MozAppearance: "none", cursor: "pointer",
        }}
      >
        {STATUS_FLOW.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <ChevronDown size={10} style={{ position: "absolute", right: 5, top: 6, pointerEvents: "none", color: colors.fg }} />
    </div>
  );
}
function Muted() {
  return <span style={{ color: "var(--text-muted)", fontSize: 12 }}>Not started</span>;
}
const DECISION_COLORS: Record<string, { fg: string; bg: string }> = {
  Pending: { fg: "#64748b", bg: "rgba(100,116,139,.12)" },
  Selected: { fg: "#10b981", bg: "rgba(16,185,129,.12)" },
  Rejected: { fg: "#ef4444", bg: "rgba(239,68,68,.12)" },
  Hold: { fg: "#f59e0b", bg: "rgba(245,158,11,.12)" },
};
const APPROVAL_COLORS: Record<string, { fg: string; bg: string }> = {
  Pending: { fg: "#64748b", bg: "rgba(100,116,139,.12)" },
  Approved: { fg: "#10b981", bg: "rgba(16,185,129,.12)" },
  Cancelled: { fg: "#ef4444", bg: "rgba(239,68,68,.12)" },
};
const RECOMMENDATION_OPTIONS = ["Strong Yes", "Yes", "Neutral", "No", "Strong No"];
const RECOMMENDATION_COLORS: Record<string, string> = {
  "Strong Yes": "#10b981", Yes: "#0d9488", Neutral: "#64748b", No: "#f59e0b", "Strong No": "#ef4444",
};
const DEFAULT_CRITERIA = ["Technical Skills", "Communication", "Culture Fit", "Overall Impression"];

// ── Calendly popup widget (same pattern as the public Prama-ai site) ──
// Loads Calendly's own overlay script once so booking links open as an
// in-page popup instead of a new browser tab.
declare global {
  interface Window {
    Calendly?: { initPopupWidget: (options: { url: string }) => void };
  }
}
const CALENDLY_CSS = "https://assets.calendly.com/assets/external/widget.css";
const CALENDLY_JS = "https://assets.calendly.com/assets/external/widget.js";

function loadCalendlyWidget() {
  if (!document.querySelector(`link[href="${CALENDLY_CSS}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = CALENDLY_CSS;
    document.head.appendChild(link);
  }
  if (!document.querySelector(`script[src="${CALENDLY_JS}"]`)) {
    const script = document.createElement("script");
    script.src = CALENDLY_JS;
    script.async = true;
    document.body.appendChild(script);
  }
}

function openCalendlyPopup(url: string, e?: React.MouseEvent) {
  if (window.Calendly) {
    e?.preventDefault();
    window.Calendly.initPopupWidget({ url });
  } else if (!e) {
    // Plain button with no href to fall back to, and the widget script
    // hasn't finished loading yet — open a normal tab instead.
    window.open(url, "_blank", "noreferrer");
  }
  // If e IS set but Calendly isn't ready yet, the click just falls
  // through to the anchor's normal href/target="_blank" behaviour.
}

const emptyForm = {
  candidate_id: "" as string | number,
  requisition_id: "" as string | number,
  round_name: "", round_number: 1,
  interview_type: "Phone Interview",
  interviewers: [{ name: "", email: "" }],
  duration_minutes: 60, location_or_link: "",
  scheduling_mode: "fixed" as "fixed" | "self_schedule",
  scheduled_at: "",
  proposed_slots: [""] as string[],
  notes: "",
  approver_name: "", approver_email: "",
  panel_id: "" as string | number,
};

export default function InterviewsPage({ embedded = false }: { embedded?: boolean } = {}) {
  // Same query key AppLayout.tsx/AdminConsolePage.tsx use — shares the
  // cached result rather than re-fetching, and picks up a Modules
  // Management change immediately once that page's Save invalidates it.
  const { data: moduleToggles = {} } = useQuery({
    queryKey: ["module-toggles"],
    queryFn: () => api.get("/api/admin/module-toggles").then((r) => r.data as Record<string, boolean>),
  });
  const syncCandidateLensEnabled = moduleToggles[SYNC_CANDIDATELENS_MODULE_ROUTE] ?? true;

  const [interviews, setInterviews] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [requisitions, setRequisitions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Per-column dropdown filter + sort + a global search box for the
  // pipeline table below — same pattern as RequisitionsPage/ScreeningPage.
  const [colWidths, setColWidths] = useState<Record<string, number>>(INTERVIEWS_DEFAULT_COL_WIDTHS);
  const setColWidth = (key: string, w: number) => setColWidths((prev) => ({ ...prev, [key]: w }));
  const [pipelineColFilters, setPipelineColFilters] = useState<Record<string, Set<string>>>({});
  const setPipelineColFilter = (key: string, next: Set<string> | undefined) =>
    setPipelineColFilters((prev) => { const n = { ...prev }; if (next) n[key] = next; else delete n[key]; return n; });
  const [pipelineSort, setPipelineSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  const togglePipelineSort = (col: string) => setPipelineSort((prev) => {
    if (!prev || prev.col !== col) return { col, dir: "asc" };
    if (prev.dir === "asc") return { col, dir: "desc" };
    return null;
  });
  const [pipelineSearch, setPipelineSearch] = useState("");

  // Settings > API Keys > Meeting Link's saved default — see openAdd
  // below for where this gets used.
  const [defaultMeetingLink, setDefaultMeetingLink] = useState("");
  useEffect(() => {
    interviewApi.meetingLink().then((r: any) => setDefaultMeetingLink(r.link || "")).catch(() => {});
  }, []);
  const [sendingPanelInviteId, setSendingPanelInviteId] = useState<number | null>(null);

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
  const [generatedLinkIsCalendly, setGeneratedLinkIsCalendly] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [calendlyConfigured, setCalendlyConfigured] = useState(false);
  const [generatingCalendly, setGeneratingCalendly] = useState(false);

  // Load Calendly's popup-widget script once on mount, same as the
  // public website, so booking links can open as an overlay.
  useEffect(() => { loadCalendlyWidget(); }, []);

  const [decisionTarget, setDecisionTarget] = useState<any | null>(null);
  const [decisionDetail, setDecisionDetail] = useState<any | null>(null);
  const [loadingDecision, setLoadingDecision] = useState(false);
  const [decisionActionError, setDecisionActionError] = useState("");
  const [decisionActing, setDecisionActing] = useState(false);
  const [copiedLinkToken, setCopiedLinkToken] = useState("");

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

  // One-time catch-up: creates Interview Scheduling rows for CandidateLens
  // candidates who completed Resume Screening / Phone / Video Interview
  // BEFORE that auto-logging existed — see backend backfill_interview_scheduling's
  // docstring. Not needed for anything completed going forward (that
  // logs itself in real time now); this is only for pre-existing gaps.
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState("");
  const runBackfill = async () => {
    setBackfillBusy(true); setBackfillMsg("");
    try {
      const { data } = await api.post("/api/joblens/candidates/backfill-interview-scheduling");
      setBackfillMsg(`Added/updated ${data.resume} Resume Screening, ${data.phone} Phone Interview, ${data.video} Video Interview row(s).`);
      load();
    } catch (e: any) {
      setBackfillMsg(e?.response?.data?.detail || "Backfill failed.");
    } finally {
      setBackfillBusy(false);
    }
  };

  useEffect(() => {
    interviewApi.calendlyStatus().then((s) => setCalendlyConfigured(s.configured)).catch(() => setCalendlyConfigured(false));
  }, []);

  const candidateName = (id: number) => candidates.find((c) => c.id === id)?.full_name || "";

  // Consolidates the flat interviews list into ONE row per (candidate,
  // role) — previously every CandidateLens round (Resume Screening,
  // Phone Interview, Video Interview) for the same candidate showed as
  // its OWN separate row with no easy way to see all three stages for
  // one candidate/role at a glance, and a candidate considered for two
  // different roles had no way to tell those apart either. Grouping key:
  // joblens_candidate_id for CandidateLens-sourced rows (each JobLens
  // candidate belongs to exactly one session = one role, so this alone
  // already means "one candidate, one role"); candidate_id+requisition_id
  // for Talent-Pool-sourced rows, since the same Talent-Pool candidate
  // CAN legitimately be in multiple requisitions' pipelines at once.
  // Panel-members popup — Interview Scheduling shows only the panel
  // NUMBER; clicking it fetches the full member list fresh rather than
  // duplicating it into every interview row's payload.
  const [panelPopup, setPanelPopup] = useState<{ loading: boolean; data: any | null; error: string } | null>(null);
  const openPanelPopup = async (panelId: number) => {
    setPanelPopup({ loading: true, data: null, error: "" });
    try {
      const data = await interviewApi.getInterviewPanel(panelId);
      setPanelPopup({ loading: false, data, error: "" });
    } catch (e: any) {
      setPanelPopup({ loading: false, data: null, error: e?.response?.data?.detail || "Failed to load panel." });
    }
  };

  const groupedRows = useMemo(() => {
    const groups = new Map<string, any>();
    for (const i of interviews) {
      const key = i.joblens_candidate_id
        ? `jl-${i.joblens_candidate_id}`
        : `tp-${i.candidate_id}-${i.requisition_id || "none"}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key, candidate_id: i.candidate_id, candidate_name: i.candidate_name,
          requisition_number: i.requisition_number, requisition_role: i.requisition_role, company: i.company,
          resume: null, phone: null, video: null, panel: null,
        });
      }
      const g = groups.get(key);
      if (i.interview_type === "Resume Screening") g.resume = i;
      else if (i.interview_type === "Phone Interview") g.phone = i;
      else if (i.interview_type === "Video Interview") g.video = i;
      else g.panel = i; // Panel Interview, or any other/legacy custom type
    }
    for (const g of groups.values()) {
      // Whichever round is furthest along gets the shared Actions column
      // (Edit/Decision/Self-schedule/Scorecards/Delete) — normally the
      // one actually being worked on right now.
      g.primary = g.video || g.phone || g.resume || g.panel || null;
    }
    return Array.from(groups.values());
  }, [interviews]);

  const PIPELINE_COLS = ["candidate", "requisition", "resume", "phoneLink", "phone", "videoEmail", "video", "panelSchedule", "panelInterviewers", "panelStatus", "panelDecision"];

  // Unique values per column always come from the full groupedRows list
  // (not the already-filtered one) so picking a value in one column's
  // dropdown doesn't shrink the choices available in every other column.
  const pipelineColOptions = (key: string): string[] =>
    Array.from(new Set(groupedRows.map((g) => getGroupColValue(g, key)).filter((v) => v !== ""))).sort();

  const displayRows = useMemo(() => {
    let out = groupedRows;
    if (pipelineSearch.trim()) {
      const q = pipelineSearch.trim().toLowerCase();
      out = out.filter((g) => PIPELINE_COLS.some((k) => getGroupColValue(g, k).toLowerCase().includes(q)));
    }
    for (const [key, val] of Object.entries(pipelineColFilters)) {
      if (!val) continue;
      out = out.filter((g) => val.has(getGroupColValue(g, key)));
    }
    if (pipelineSort) {
      const { col, dir } = pipelineSort;
      out = [...out].sort((a, b) => {
        const av = getGroupColValue(a, col), bv = getGroupColValue(b, col);
        if (!av) return 1;
        if (!bv) return -1;
        const cmp = av.localeCompare(bv);
        return dir === "asc" ? cmp : -cmp;
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedRows, pipelineSearch, pipelineColFilters, pipelineSort]);

  const openAdd = () => {
    // Pre-fill Location/Meeting Link from the recruiter's saved default
    // (Settings > API Keys > Meeting Link) so Zoom/Teams/Meet doesn't
    // need retyping — or worse, get left blank — every time. Only
    // applied when opening a brand-new form; openEdit below always uses
    // whatever's already saved on that specific round.
    setForm({ ...emptyForm, location_or_link: defaultMeetingLink }); setEditingId(null); setFormError(""); setShowForm(true);
  };
  const openEdit = (i: any) => {
    setForm({
      candidate_id: i.candidate_id, requisition_id: i.requisition_id ?? "",
      round_name: i.round_name, round_number: i.round_number,
      interview_type: i.interview_type || "Phone Interview",
      interviewers: i.interviewers?.length ? i.interviewers : [{ name: "", email: "" }],
      duration_minutes: i.duration_minutes, location_or_link: i.location_or_link,
      scheduling_mode: "fixed",
      scheduled_at: i.scheduled_at ? i.scheduled_at.slice(0, 16) : "",
      proposed_slots: i.proposed_slots?.length ? i.proposed_slots.map((s: string) => s.slice(0, 16)) : [""],
      notes: i.notes,
      approver_name: i.approver_name || "", approver_email: i.approver_email || "",
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
          approver_name: form.approver_name, approver_email: form.approver_email,
        });
      } else {
        const payload: any = {
          candidate_id: Number(form.candidate_id),
          requisition_id: form.requisition_id === "" ? null : Number(form.requisition_id),
          round_name: form.round_name, round_number: Number(form.round_number),
          interview_type: form.interview_type,
          interviewers, duration_minutes: Number(form.duration_minutes),
          location_or_link: form.location_or_link, notes: form.notes,
          approver_name: form.approver_name, approver_email: form.approver_email,
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

  // ── Decision & Approval panel ─────────────────────────────────────
  const openDecisionPanel = async (i: any) => {
    setDecisionTarget(i);
    setDecisionDetail(null);
    setDecisionActionError("");
    setLoadingDecision(true);
    try {
      const full = await interviewApi.get(i.id);
      setDecisionDetail(full);
    } finally {
      setLoadingDecision(false);
    }
  };
  const refreshDecisionDetail = async () => {
    if (!decisionTarget) return;
    const full = await interviewApi.get(decisionTarget.id);
    setDecisionDetail(full);
    await load();
  };
  const generateApprovalLink = async () => {
    if (!decisionTarget) return;
    setDecisionActing(true);
    setDecisionActionError("");
    try {
      await interviewApi.regenerateApprovalLink(decisionTarget.id);
      await refreshDecisionDetail();
    } catch (e: any) {
      setDecisionActionError(e?.response?.data?.detail || "Could not generate an approval link. Set an approver name or email first.");
    } finally {
      setDecisionActing(false);
    }
  };
  const approveInApp = async () => {
    if (!decisionTarget) return;
    setDecisionActing(true);
    setDecisionActionError("");
    try {
      await interviewApi.approveInApp(decisionTarget.id);
      await refreshDecisionDetail();
    } catch (e: any) {
      setDecisionActionError(e?.response?.data?.detail || "Could not approve this interview.");
    } finally {
      setDecisionActing(false);
    }
  };
  const setManualDecision = async (decision: string) => {
    if (!decisionTarget) return;
    setDecisionActing(true);
    setDecisionActionError("");
    try {
      await interviewApi.setDecision(decisionTarget.id, decision);
      await refreshDecisionDetail();
    } catch (e: any) {
      setDecisionActionError(e?.response?.data?.detail || "Could not record a decision.");
    } finally {
      setDecisionActing(false);
    }
  };
  const copyFeedbackLink = (token: string, path: string) => {
    navigator.clipboard.writeText(`${window.location.origin}${path}`);
    setCopiedLinkToken(token);
    setTimeout(() => setCopiedLinkToken(""), 2000);
  };

  // ── Self-schedule link generation ───────────────────────────────────
  const openLinkModal = (i: any) => {
    setLinkModalInterview(i);
    setGeneratedLink("");
    setGeneratedLinkIsCalendly(false);
    setCalendlyEmailed(false);
  };
  const generateLink = async (slots: string[]) => {
    if (!linkModalInterview) return;
    const validSlots = slots.filter(Boolean).map((s) => new Date(s).toISOString());
    if (validSlots.length === 0) { alert("Add at least one proposed time slot."); return; }
    try {
      const res = await interviewApi.createSelfScheduleLink(linkModalInterview.id, validSlots);
      setGeneratedLink(`${window.location.origin}${res.schedule_url_path}`);
      setGeneratedLinkIsCalendly(false);
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
      setGeneratedLinkIsCalendly(true);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not generate a Calendly link.");
    } finally {
      setGeneratingCalendly(false);
    }
  };

  // Emails the Calendly link straight to the candidate — same link
  // generateCalendlyLink shows, just delivered instead of copy/pasted.
  const [emailingCalendly, setEmailingCalendly] = useState(false);
  const [calendlyEmailed, setCalendlyEmailed] = useState(false);
  const emailCalendlyToCandidate = async () => {
    if (!linkModalInterview) return;
    setEmailingCalendly(true);
    try {
      await interviewApi.emailCalendlyLink(linkModalInterview.id);
      setCalendlyEmailed(true);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not email the Calendly link.");
    } finally {
      setEmailingCalendly(false);
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
    <div className={embedded ? "" : "tiq-content"}>
      {!embedded && (
        <div className="tiq-page-header">
          <div className="tiq-page-title">Interviews</div>
          <div className="tiq-page-sub">From "let's interview them" to a recorded decision.</div>
        </div>
      )}

      {/* Action buttons + status filter, all left-aligned together in one
          row flush with the table's left edge below — these used to sit
          in the page header, pushed to the far right of the page by
          justify-content: space-between, which visually had nothing to
          do with the table they act on. */}
      <div style={{ display: "flex", gap: 8, marginTop: embedded ? 0 : 16, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={openAdd}>
          <Plus size={14} /> Schedule Interview
        </button>
        {syncCandidateLensEnabled && (
          <div>
            <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={runBackfill} disabled={backfillBusy}
              title="Add Interview Scheduling rows for CandidateLens candidates who completed a stage before this was tracked automatically">
              {backfillBusy ? "Syncing…" : "Sync CandidateLens Completions"}
            </button>
            {backfillMsg && <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 4, maxWidth: 240 }}>{backfillMsg}</div>}
          </div>
        )}
        <label style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, marginLeft: 8 }}>Status:</label>
        <select className="tiq-select" style={{ fontSize: 12, padding: "5px 10px" }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All</option>
          {STATUS_FLOW.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : interviews.length === 0 ? (
        <div className="tiq-empty">No interviews scheduled yet. Click "Schedule Interview" to set one up.</div>
      ) : (
        <div>
          {/* Global search — matches candidate, requisition, and every
              per-round status/date column, on top of the per-column
              dropdown filters in the header below. */}
          <div style={{ position: "relative", maxWidth: 300, marginBottom: 10 }}>
            <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              value={pipelineSearch}
              onChange={(e) => setPipelineSearch(e.target.value)}
              placeholder="Search pipeline…"
              className="tiq-input"
              style={{ paddingLeft: 28, fontSize: 12, height: 32, width: "100%", boxSizing: "border-box" }}
            />
            {pipelineSearch && (
              <X size={13} onClick={() => setPipelineSearch("")}
                style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", cursor: "pointer" }} />
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
            {displayRows.length}{displayRows.length !== groupedRows.length ? ` / ${groupedRows.length}` : ""} rows
          </div>
        <div className="tiq-table-wrap">
          <table className="tiq-table" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <ResizableFilterHeader label="Candidate" width={colWidths.candidate} onWidthChange={(w) => setColWidth("candidate", w)}
                  value={pipelineColFilters.candidate} options={pipelineColOptions("candidate")} onChange={(v) => setPipelineColFilter("candidate", v)}
                  sortDir={pipelineSort?.col === "candidate" ? pipelineSort.dir : null} onSortClick={() => togglePipelineSort("candidate")} />
                <ResizableFilterHeader label="Requisition" width={colWidths.requisition} onWidthChange={(w) => setColWidth("requisition", w)}
                  value={pipelineColFilters.requisition} options={pipelineColOptions("requisition")} onChange={(v) => setPipelineColFilter("requisition", v)}
                  sortDir={pipelineSort?.col === "requisition" ? pipelineSort.dir : null} onSortClick={() => togglePipelineSort("requisition")} />
                <ResizableFilterHeader label="Resume Screening" width={colWidths.resume} onWidthChange={(w) => setColWidth("resume", w)}
                  value={pipelineColFilters.resume} options={pipelineColOptions("resume")} onChange={(v) => setPipelineColFilter("resume", v)}
                  sortDir={pipelineSort?.col === "resume" ? pipelineSort.dir : null} onSortClick={() => togglePipelineSort("resume")} />
                <ResizableFilterHeader label="Phone Schedule Link" width={colWidths.phoneLink} onWidthChange={(w) => setColWidth("phoneLink", w)}
                  value={pipelineColFilters.phoneLink} options={pipelineColOptions("phoneLink")} onChange={(v) => setPipelineColFilter("phoneLink", v)}
                  sortDir={pipelineSort?.col === "phoneLink" ? pipelineSort.dir : null} onSortClick={() => togglePipelineSort("phoneLink")} />
                <ResizableFilterHeader label="Phone Interview" width={colWidths.phone} onWidthChange={(w) => setColWidth("phone", w)}
                  value={pipelineColFilters.phone} options={pipelineColOptions("phone")} onChange={(v) => setPipelineColFilter("phone", v)}
                  sortDir={pipelineSort?.col === "phone" ? pipelineSort.dir : null} onSortClick={() => togglePipelineSort("phone")} />
                <ResizableFilterHeader label="Video Email" width={colWidths.videoEmail} onWidthChange={(w) => setColWidth("videoEmail", w)}
                  value={pipelineColFilters.videoEmail} options={pipelineColOptions("videoEmail")} onChange={(v) => setPipelineColFilter("videoEmail", v)}
                  sortDir={pipelineSort?.col === "videoEmail" ? pipelineSort.dir : null} onSortClick={() => togglePipelineSort("videoEmail")} />
                <ResizableFilterHeader label="Video Interview" width={colWidths.video} onWidthChange={(w) => setColWidth("video", w)}
                  value={pipelineColFilters.video} options={pipelineColOptions("video")} onChange={(v) => setPipelineColFilter("video", v)}
                  sortDir={pipelineSort?.col === "video" ? pipelineSort.dir : null} onSortClick={() => togglePipelineSort("video")} />
                <ResizableFilterHeader label="Panel Schedule" width={colWidths.panelSchedule} onWidthChange={(w) => setColWidth("panelSchedule", w)}
                  value={pipelineColFilters.panelSchedule} options={pipelineColOptions("panelSchedule")} onChange={(v) => setPipelineColFilter("panelSchedule", v)}
                  sortDir={pipelineSort?.col === "panelSchedule" ? pipelineSort.dir : null} onSortClick={() => togglePipelineSort("panelSchedule")} />
                <ResizableFilterHeader label="Panel Interviewers" width={colWidths.panelInterviewers} onWidthChange={(w) => setColWidth("panelInterviewers", w)}
                  value={pipelineColFilters.panelInterviewers} options={pipelineColOptions("panelInterviewers")} onChange={(v) => setPipelineColFilter("panelInterviewers", v)}
                  sortDir={pipelineSort?.col === "panelInterviewers" ? pipelineSort.dir : null} onSortClick={() => togglePipelineSort("panelInterviewers")} />
                <ResizableFilterHeader label="Panel Status" width={colWidths.panelStatus} onWidthChange={(w) => setColWidth("panelStatus", w)}
                  value={pipelineColFilters.panelStatus} options={pipelineColOptions("panelStatus")} onChange={(v) => setPipelineColFilter("panelStatus", v)}
                  sortDir={pipelineSort?.col === "panelStatus" ? pipelineSort.dir : null} onSortClick={() => togglePipelineSort("panelStatus")} />
                <ResizableFilterHeader label="Panel Feedback & Decision" width={colWidths.panelDecision} onWidthChange={(w) => setColWidth("panelDecision", w)}
                  value={pipelineColFilters.panelDecision} options={pipelineColOptions("panelDecision")} onChange={(v) => setPipelineColFilter("panelDecision", v)}
                  sortDir={pipelineSort?.col === "panelDecision" ? pipelineSort.dir : null} onSortClick={() => togglePipelineSort("panelDecision")} />
                <th style={{ width: 150 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 && (
                <tr>
                  <td colSpan={12} style={{ textAlign: "center", padding: 28, color: "var(--text-muted)" }}>
                    No rows match the current search/filters.
                  </td>
                </tr>
              )}
              {displayRows.map((g, idx) => {
                const r = g.resume, p = g.phone, v = g.video, pan = g.panel;
                const dc = pan ? (DECISION_COLORS[pan.decision] || DECISION_COLORS.Pending) : null;
                return (
                  <tr key={g.key}>
                    <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{idx + 1}</td>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>{g.candidate_name || candidateName(g.candidate_id)}</td>

                    {/* Requisition — number + role on one line, company
                        below, instead of three separate columns that
                        were 90% empty space for any single-line value. */}
                    <td style={{ fontSize: 12 }}>
                      {(g.requisition_number != null || g.requisition_role) ? (
                        <>
                          <div>{g.requisition_number != null ? `${g.requisition_number}  ` : ""}{g.requisition_role || "—"}</div>
                          {g.company && <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{g.company}</div>}
                        </>
                      ) : "—"}
                    </td>

                    {/* Resume Screening — status + date stacked in one cell */}
                    <td>
                      {r ? (
                        <>
                          <MiniBadge status={r.status} onChange={(s) => handleStatusChange(r.id, s)} />
                          <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 3 }}>
                            {r.completed_at ? new Date(r.completed_at).toLocaleDateString() : "—"}
                          </div>
                        </>
                      ) : <Muted />}
                    </td>

                    {/* Phone Schedule Link — sent/not-sent + date stacked */}
                    <td>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: p?.calendly_link_sent_at ? "#0d9488" : "var(--text-muted)" }}>
                        {p?.calendly_link_sent_at ? "Sent" : "Not sent"}
                      </div>
                      <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>
                        {p?.calendly_link_sent_at ? new Date(p.calendly_link_sent_at).toLocaleDateString() : "—"}
                      </div>
                    </td>

                    {/* Phone Interview — status + date stacked */}
                    <td>
                      {p ? (
                        <>
                          <MiniBadge status={p.status} onChange={(s) => handleStatusChange(p.id, s)} />
                          <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 3 }}>
                            {p.status === "Completed" && p.completed_at ? new Date(p.completed_at).toLocaleDateString()
                              : p.scheduled_at ? new Date(p.scheduled_at).toLocaleString() : "—"}
                          </div>
                        </>
                      ) : <Muted />}
                    </td>

                    {/* Video Email — sent/not-sent + date stacked */}
                    <td>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: v?.video_invite_sent_at ? "#0d9488" : "var(--text-muted)" }}>
                        {v?.video_invite_sent_at ? "Sent" : "Not sent"}
                      </div>
                      <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>
                        {v?.video_invite_sent_at ? new Date(v.video_invite_sent_at).toLocaleDateString() : "—"}
                      </div>
                    </td>

                    {/* Video Interview — status + date stacked */}
                    <td>
                      {v ? (
                        <>
                          <MiniBadge status={v.status} onChange={(s) => handleStatusChange(v.id, s)} />
                          <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 3 }}>
                            {v.status === "Completed" && v.completed_at ? new Date(v.completed_at).toLocaleDateString()
                              : v.scheduled_at ? new Date(v.scheduled_at).toLocaleString() : "—"}
                          </div>
                        </>
                      ) : <Muted />}
                    </td>

                    {/* Panel Interview */}
                    <td style={{ fontSize: 11.5 }}>
                      {pan?.scheduled_at ? (
                        <>
                          <div>{new Date(pan.scheduled_at).toLocaleString()}</div>
                          {/* Fixed-time invite email — Panel Interview can't use
                              the self-schedule Calendly link (SELF_SCHEDULABLE_TYPES
                              is Phone Interview only), so this sends the already-set
                              date/time + meeting link directly instead. */}
                          <button
                            className="tiq-btn tiq-btn-ghost tiq-btn-sm"
                            style={{ padding: "1px 6px", fontSize: 10.5, marginTop: 2 }}
                            disabled={sendingPanelInviteId === pan.id}
                            onClick={async () => {
                              setSendingPanelInviteId(pan.id);
                              try {
                                await interviewApi.sendFixedInvite(pan.id);
                                await load();
                              } catch (e: any) {
                                alert(e?.response?.data?.detail || "Failed to send invite.");
                              } finally {
                                setSendingPanelInviteId(null);
                              }
                            }}
                            title={pan.invite_sent_at ? `Invite sent ${new Date(pan.invite_sent_at).toLocaleString()} — click to resend` : "Email the candidate this date/time + meeting link"}
                          >
                            <Mail size={10} style={{ marginRight: 3 }} />
                            {sendingPanelInviteId === pan.id ? "Sending…" : pan.invite_sent_at ? "Resend Invite" : "Send Invite"}
                          </button>
                        </>
                      ) : "—"}
                    </td>
                    <td style={{ fontSize: 11.5 }}>
                      {pan?.panel_number != null ? (
                        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => openPanelPopup(pan.panel_id)}
                                title="View panel members">
                          Panel #{pan.panel_number}
                        </button>
                      ) : (
                        <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block" }}
                              title={(pan?.interviewers || []).map((x: any) => x.name).join(", ")}>
                          {(pan?.interviewers || []).map((x: any) => x.name).join(", ") || "—"}
                        </span>
                      )}
                    </td>
                    <td>{pan ? <MiniBadge status={pan.status} onChange={(s) => handleStatusChange(pan.id, s)} /> : <Muted />}</td>

                    {/* Panel Feedback & Decision — link(s), decision, and
                        decision date combined into one cell. */}
                    <td style={{ fontSize: 11.5 }}>
                      {pan ? (
                        <>
                          {pan.feedback_links_summary?.length ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 4 }}>
                              {pan.feedback_links_summary.map((fl: any, i: number) => (
                                <a key={i} href={fl.url_path} target="_blank" rel="noreferrer" style={{ color: "var(--brand-teal, #0d9488)" }}>
                                  {fl.interviewer_name || `Link ${i + 1}`}
                                </a>
                              ))}
                            </div>
                          ) : <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>No feedback links</div>}
                          <span style={{ fontSize: 11, fontWeight: 700, color: dc!.fg, background: dc!.bg, padding: "3px 9px", borderRadius: 999 }}>
                            {pan.decision || "Pending"}
                          </span>
                          <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 3 }}>
                            {pan.decision_finalized_at ? new Date(pan.decision_finalized_at).toLocaleDateString() : "—"}
                          </div>
                        </>
                      ) : <Muted />}
                    </td>

                    <td>
                      {/* Left-aligned — acts on whichever round is
                          furthest along (video > phone > resume > panel),
                          normally the one actually being managed right now. */}
                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-start" }}>
                        {g.primary ? (
                          <>
                            <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Edit" onClick={() => openEdit(g.primary)}>Edit</button>
                            <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Decision & Approval" onClick={() => openDecisionPanel(g.primary)}>
                              <Gavel size={13} />
                            </button>
                            {SELF_SCHEDULABLE_TYPES.has(g.primary.interview_type || "Phone Interview") && (
                              <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Self-schedule link" onClick={() => openLinkModal(g.primary)}><Link2 size={13} /></button>
                            )}
                            {g.primary.interview_type === AVATAR_INTERVIEW_TYPE && (
                              <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="AI Avatar Interview" onClick={() => openAvatarModal(g.primary)}>
                                <Bot size={13} />
                              </button>
                            )}
                            <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Scorecards" onClick={() => openScorecards(g.primary)}>
                              <ClipboardList size={12} /> {g.primary.scorecard_count || 0}
                            </button>
                            <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Delete" onClick={() => handleDelete(g.primary.id)}><Trash2 size={13} /></button>
                          </>
                        ) : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
                         title={SELF_SCHEDULABLE_TYPES.has(form.interview_type) ? "" : "Only Phone Interview rounds can be self-scheduled"}>
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

            <div className="tiq-form-group">
              <label className="tiq-label"><ShieldCheck size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />Approver (authority who signs off on this round)</label>
              <div className="tiq-grid-2">
                <input className="tiq-input" placeholder="Approver name" value={form.approver_name}
                       onChange={(e) => setForm({ ...form, approver_name: e.target.value })} />
                <input className="tiq-input" placeholder="Approver email" value={form.approver_email}
                       onChange={(e) => setForm({ ...form, approver_email: e.target.value })} />
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                Optional. Once set, an approval link can be generated from the <Gavel size={11} style={{ verticalAlign: "middle" }} /> icon on the interview row —
                the approver can approve or cancel this round online, no login required.
              </div>
            </div>

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
                {generatedLinkIsCalendly && (
                  <div style={{ marginBottom: 12 }}>
                    <button className="tiq-btn tiq-btn-outline" style={{ width: "100%", justifyContent: "center" }}
                            onClick={emailCalendlyToCandidate} disabled={emailingCalendly}>
                      <Mail size={14} /> {emailingCalendly ? "Sending…" : calendlyEmailed ? "Sent — Send Again" : "Email to Candidate"}
                    </button>
                    {calendlyEmailed && (
                      <div style={{ fontSize: 11, color: "#10b981", marginTop: 6, textAlign: "center" }}>
                        Calendly link emailed — tracked on this interview in Interview Scheduling.
                      </div>
                    )}
                  </div>
                )}
                <div className="tiq-flex-end">
                  {generatedLinkIsCalendly && (
                    <button className="tiq-btn tiq-btn-outline" onClick={() => openCalendlyPopup(generatedLink)}>
                      <ExternalLink size={14} /> Open Calendly
                    </button>
                  )}
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
                    <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", margin: "10px 0" }}>— or use TalentIQ Solution's own link —</div>
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

      {/* ── Panel Members Popup ──────────────────────────────────── */}
      {panelPopup && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
             onMouseDown={(e) => { if (e.target === e.currentTarget) setPanelPopup(null); }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 460, width: "94%", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                {panelPopup.data ? `Panel #${panelPopup.data.panel_number}` : "Panel"}
              </div>
              <button onClick={() => setPanelPopup(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            {panelPopup.loading ? (
              <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
            ) : panelPopup.error ? (
              <div style={{ fontSize: 13, color: "#ef4444" }}>{panelPopup.error}</div>
            ) : panelPopup.data ? (
              <>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
                  {panelPopup.data.role_for}{panelPopup.data.company ? ` — ${panelPopup.data.company}` : ""}
                  {panelPopup.data.setup_date && <> · Set up {new Date(panelPopup.data.setup_date).toLocaleDateString()}</>}
                </div>
                {panelPopup.data.members.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--text-muted)" }}>No interviewers on this panel.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {panelPopup.data.members.map((m: any) => (
                      <div key={m.id} style={{ padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{m.name}</div>
                        {m.expertise_area && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{m.expertise_area}</div>}
                        {m.company && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{m.company}</div>}
                        <div style={{ fontSize: 11.5, marginTop: 4 }}>
                          {m.email && <div>{m.email}</div>}
                          {m.phone && <div>{m.phone}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : null}
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

      {/* ── Decision & Approval Modal ────────────────────────────── */}
      {decisionTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 620, width: "94%", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontWeight: 800, fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
                <Gavel size={18} /> Decision &amp; Approval
              </div>
              <button onClick={() => setDecisionTarget(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
              {decisionTarget.candidate_name || candidateName(decisionTarget.candidate_id)} — {decisionTarget.round_name} ({decisionTarget.interview_type})
            </div>

            {loadingDecision || !decisionDetail ? (
              <div style={{ textAlign: "center", padding: 24, color: "var(--text-muted)" }}>Loading…</div>
            ) : (
              <div>
                {decisionActionError && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 14, fontSize: 12 }}>{decisionActionError}</div>}

                {/* Round decision */}
                <div className="tiq-card" style={{ padding: 14, marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>Round Decision</div>
                    {(() => {
                      const dc = DECISION_COLORS[decisionDetail.decision] || DECISION_COLORS.Pending;
                      return <span style={{ fontSize: 11, fontWeight: 700, color: dc.fg, background: dc.bg, padding: "4px 12px", borderRadius: 999 }}>{decisionDetail.decision}</span>;
                    })()}
                  </div>
                  {(decisionDetail.interviewers?.length || 0) >= 2 ? (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Determined by majority of the {decisionDetail.interviewers.length} assigned panel members' scorecards
                      ({(decisionDetail.scorecards || []).length} submitted so far). Use the Scorecards panel to record each panelist's recommendation —
                      the decision finalizes automatically once a majority is reached.
                    </div>
                  ) : decisionDetail.decision !== "Pending" ? (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Decision recorded {decisionDetail.decision_finalized_at ? `on ${new Date(decisionDetail.decision_finalized_at).toLocaleString()}` : ""}.
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
                        This round has {decisionDetail.interviewers?.length || 0} assigned interviewer(s) — a panel majority isn't meaningful here.
                        Record the outcome directly:
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ color: "#10b981", borderColor: "#10b981" }}
                                disabled={decisionActing} onClick={() => setManualDecision("Selected")}>Selected</button>
                        <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ color: "#ef4444", borderColor: "#ef4444" }}
                                disabled={decisionActing} onClick={() => setManualDecision("Rejected")}>Rejected</button>
                        <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ color: "#f59e0b", borderColor: "#f59e0b" }}
                                disabled={decisionActing} onClick={() => setManualDecision("Hold")}>Hold</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Scheduling approval */}
                <div className="tiq-card" style={{ padding: 14, marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>Scheduling Approval</div>
                    {(() => {
                      const ac = APPROVAL_COLORS[decisionDetail.approval_status] || APPROVAL_COLORS.Pending;
                      return <span style={{ fontSize: 11, fontWeight: 700, color: ac.fg, background: ac.bg, padding: "4px 12px", borderRadius: 999 }}>{decisionDetail.approval_status}</span>;
                    })()}
                  </div>
                  {!decisionDetail.approver_name && !decisionDetail.approver_email ? (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      No approver set for this round — add one via Edit to enable online approval/cancellation.
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 12, marginBottom: 8 }}>
                        Authority: <b>{decisionDetail.approver_name || decisionDetail.approver_email}</b>
                        {decisionDetail.approved_by && decisionDetail.approval_status === "Approved" && (
                          <span style={{ color: "var(--text-muted)" }}> — approved by {decisionDetail.approved_by} on {new Date(decisionDetail.approved_at).toLocaleString()}</span>
                        )}
                        {decisionDetail.cancelled_by && decisionDetail.approval_status === "Cancelled" && (
                          <span style={{ color: "var(--text-muted)" }}> — cancelled by {decisionDetail.cancelled_by} on {new Date(decisionDetail.cancelled_at).toLocaleString()}</span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {decisionDetail.approval_url_path && (
                          <button className="tiq-btn tiq-btn-outline tiq-btn-sm"
                                  onClick={() => copyFeedbackLink(decisionDetail.approval_token, decisionDetail.approval_url_path)}>
                            {copiedLinkToken === decisionDetail.approval_token ? <Check size={12} /> : <Copy size={12} />} Copy Approval Link
                          </button>
                        )}
                        <button className="tiq-btn tiq-btn-outline tiq-btn-sm" disabled={decisionActing} onClick={generateApprovalLink}>
                          <RefreshCw size={12} /> {decisionDetail.approval_token ? "Regenerate Link" : "Generate Link"}
                        </button>
                        {decisionDetail.approval_status === "Pending" && (
                          <button className="tiq-btn tiq-btn-primary tiq-btn-sm" disabled={decisionActing} onClick={approveInApp}>
                            Approve In-App
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Panel feedback links */}
                <div className="tiq-card" style={{ padding: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Panel Feedback Links</div>
                  {(decisionDetail.feedback_links || []).length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      No interviewers assigned yet — add them via Edit to generate individual online feedback links.
                    </div>
                  ) : (
                    <div>
                      {decisionDetail.feedback_links.map((l: any) => (
                        <div key={l.token} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>
                              {l.interviewer_name} {l.is_internal && <span className="tiq-badge tiq-badge-slate" style={{ fontSize: 9, marginLeft: 4 }}>Internal</span>}
                            </div>
                            <div style={{ fontSize: 11, color: l.submitted ? "#10b981" : "var(--text-muted)" }}>
                              {l.submitted ? "✓ Feedback submitted" : "Awaiting feedback"}
                            </div>
                          </div>
                          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => copyFeedbackLink(l.token, l.feedback_url_path)}>
                            {copiedLinkToken === l.token ? <Check size={12} /> : <Copy size={12} />} {copiedLinkToken === l.token ? "Copied" : "Copy Link"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
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
