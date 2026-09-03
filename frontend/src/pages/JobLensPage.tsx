import { useNavigate, useSearchParams } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ResizableFilterHeader } from "../components/ResizableFilterHeader";
import { useLatestMutation } from "../hooks/useLatestMutation";
import {
  Users, Upload, FileText, Play, Download, ChevronDown, ChevronUp,
  CheckCircle, Clock, XCircle, Star, Video, RefreshCw, Sparkles, BarChart2, Gavel,
  Trash2, Mail, Building2, AlertTriangle, Phone, CalendarClock, PhoneCall, MessageSquare, X, Search } from "lucide-react";
import { api, interviewApi, authApi } from "../lib/api";
import { useAuth } from "../hooks/useAuth";

// Same fixed per-stage colors as the sidebar (see capabilities.ts) — kept
// here too so the Next Steps buttons' icons visually match the sidebar
// entry they navigate to, regardless of which page they're rendered on.
const STAGE_ICON_COLOR = { phone: "#ec4899", video: "#00c7b7", decision: "#10b981" } as const;
import JDManagementTab from "../components/candidatetrack/JDManagementTab";
import VendorManagementTab from "../components/candidatetrack/VendorManagementTab";
import CandidateTrackingTab from "../components/candidatetrack/CandidateTrackingTab";
import ClientManagementTab from "../components/candidatetrack/ClientManagementTab";
import DataTable from "../components/DataTable";
import {
  SliderRow, ScoringWeights, DEFAULT_SCORING_WEIGHTS,
  ScoringDisqualifiers, DEFAULT_DISQUALIFIERS, ScoreBreakdownGrid, JDLinkFetcher,
} from "./CVIntelPage";

// Fetches a protected file (video/resume) via the authenticated axios
// client — a plain <a href> wouldn't carry the Bearer token, since that's
// sent as a header, not a cookie — then opens it in a new tab as a blob URL.
async function openBlobInNewTab(url: string, fallbackType?: string) {
  try {
    const res = await api.get(url, { responseType: "blob" });
    const blob = fallbackType ? new Blob([res.data], { type: fallbackType }) : res.data;
    const objectUrl = URL.createObjectURL(blob);
    window.open(objectUrl, "_blank");
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch {
    alert("Could not load the file.");
  }
}
import HistoryDropdown from "../components/HistoryDropdown";

// ── Scoring Weights & Logistics Constraints panel (CandidateLens) ─────────
// Same dynamic weighting engine as CVIntel (reuses SliderRow/ScoringWeights
// from CVIntelPage), plus the JD-side logistics constraints CandidateLens
// needs up front for a whole batch: salary budget, max notice, remote OK.
function CandidateLensWeightsPanel({
  weights, setWeights, disqualifiers, setDisqualifiers,
  salaryMin, setSalaryMin, salaryMax, setSalaryMax,
  maxNotice, setMaxNotice, remoteAllowed, setRemoteAllowed,
}: {
  weights: ScoringWeights; setWeights: (w: ScoringWeights) => void;
  disqualifiers: ScoringDisqualifiers; setDisqualifiers: (d: ScoringDisqualifiers) => void;
  salaryMin: number; setSalaryMin: (v: number) => void;
  salaryMax: number; setSalaryMax: (v: number) => void;
  maxNotice: number; setMaxNotice: (v: number) => void;
  remoteAllowed: boolean; setRemoteAllowed: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const pct = (v: number) => Math.round(v * 100);
  const frac = (v: number) => v / 100;
  const inputStyle = {
    width: "100%", padding: "6px 10px", fontSize: 12.5, border: "1px solid var(--border)",
    borderRadius: 8, background: "var(--bg-tertiary)", color: "var(--text-primary)",
  } as const;

  return (
    <div style={{ border: "1.5px solid var(--border)", borderRadius: 10, overflow: "hidden", marginTop: 16, marginBottom: 16 }}>
      <button type="button" onClick={() => setOpen(o => !o)} style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", background: open ? "var(--bg-secondary)" : "transparent",
        border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
        color: open ? "var(--text-primary)" : "var(--text-secondary)",
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <BarChart2 size={13} color="var(--text-muted)" />
          Scoring Weights &amp; Logistics Constraints
          <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "var(--bg-tertiary)", color: "var(--text-muted)", fontWeight: 600 }}>
            {pct(weights.technical_overall)}% tech / {pct(weights.non_technical_overall)}% logistics
          </span>
        </span>
        {open ? <ChevronUp size={14} color="var(--text-muted)" /> : <ChevronDown size={14} color="var(--text-muted)" />}
      </button>
      {open && (
        <div style={{ padding: 14 }}>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
            Set the role's budget/notice constraints once for this batch — every candidate's
            expected salary, notice period, and location (auto-extracted from their resume) is
            scored against these. Weights control how much logistics fit affects ranking vs.
            technical skill match, and can be re-applied to already-scored candidates instantly.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Salary budget min ($)</label>
              <input type="number" min={0} value={salaryMin || ""} placeholder="e.g. 90000"
                onChange={e => setSalaryMin(Number(e.target.value) || 0)} style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Salary budget max ($)</label>
              <input type="number" min={0} value={salaryMax || ""} placeholder="e.g. 120000"
                onChange={e => setSalaryMax(Number(e.target.value) || 0)} style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Max notice period (days)</label>
              <input type="number" min={0} value={maxNotice || ""} placeholder="e.g. 30"
                onChange={e => setMaxNotice(Number(e.target.value) || 0)} style={inputStyle} />
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 16, cursor: "pointer" }}>
            <input type="checkbox" checked={remoteAllowed} onChange={e => setRemoteAllowed(e.target.checked)} />
            Remote / work-from-home allowed for this role
          </label>

          <SliderRow label="Technical weight (vs. Non-Technical)" value={pct(weights.technical_overall)}
            onChange={v => setWeights({ ...weights, technical_overall: frac(v), non_technical_overall: frac(100 - v) })} />

          <div style={{ marginTop: 14, marginBottom: 8, fontSize: 11.5, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.3 }}>
            Technical track
          </div>
          <SliderRow label="Core skills coverage" value={pct(weights.tech_core_skills)}
            onChange={v => setWeights({ ...weights, tech_core_skills: frac(v) })} />
          <SliderRow label="Experience fit" value={pct(weights.tech_experience)}
            onChange={v => setWeights({ ...weights, tech_experience: frac(v) })} />
          <SliderRow label="Education fit" value={pct(weights.tech_education)}
            onChange={v => setWeights({ ...weights, tech_education: frac(v) })} />
          <SliderRow label="Good-to-have bonus" value={pct(weights.tech_good_to_have)}
            onChange={v => setWeights({ ...weights, tech_good_to_have: frac(v) })} />

          <div style={{ marginTop: 14, marginBottom: 8, fontSize: 11.5, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.3 }}>
            Non-technical track
          </div>
          <SliderRow label="Salary vs. budget" value={pct(weights.nontech_salary)}
            onChange={v => setWeights({ ...weights, nontech_salary: frac(v) })} />
          <SliderRow label="Notice period fit" value={pct(weights.nontech_notice)}
            onChange={v => setWeights({ ...weights, nontech_notice: frac(v) })} />
          <SliderRow label="Location / remote fit" value={pct(weights.nontech_location)}
            onChange={v => setWeights({ ...weights, nontech_location: frac(v) })} />

          <div style={{ marginTop: 14, marginBottom: 8, fontSize: 11.5, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.3 }}>
            Hard disqualifiers
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={disqualifiers.enabled}
              onChange={e => setDisqualifiers({ ...disqualifiers, enabled: e.target.checked })} />
            Enable hard disqualifiers (auto-mark "Not Qualified" regardless of score)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 8, cursor: "pointer", opacity: disqualifiers.enabled ? 1 : 0.5 }}>
            <input type="checkbox" checked={disqualifiers.notice_hard_limit} disabled={!disqualifiers.enabled}
              onChange={e => setDisqualifiers({ ...disqualifiers, notice_hard_limit: e.target.checked })} />
            Reject if notice period exceeds the max above
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, opacity: disqualifiers.enabled ? 1 : 0.5 }}>
            <span>Reject if expected salary exceeds budget by more than</span>
            <input type="number" min={0} max={200} value={disqualifiers.salary_overrun_pct} disabled={!disqualifiers.enabled}
              onChange={e => setDisqualifiers({ ...disqualifiers, salary_overrun_pct: Number(e.target.value) })}
              style={{ width: 56, padding: "3px 6px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-tertiary)", color: "var(--text-primary)" }} />
            <span>%</span>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── API ───────────────────────────────────────────────────────────────────
const jobLensApi = {
  deleteSession: (id: number) => api.delete(`/api/joblens/sessions/${id}`).then(r => r.data),
  // Scoring N candidates involves 2-3 sequential Groq calls each — even
  // with backend-side concurrency, a larger batch can legitimately take
  // several minutes. The global 60s default (fine for everything else)
  // isn't enough here.
  run: (form: FormData) => api.post("/api/joblens/run", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 300_000,
  }).then(r => r.data),
  sessions: () => api.get("/api/joblens/sessions").then(r => r.data),
  session: (id: number) => api.get(`/api/joblens/sessions/${id}`).then(r => r.data),
  generateQuestions: (sid: number, cid: number, regenerate = false) =>
    api.post(`/api/joblens/sessions/${sid}/candidates/${cid}/questions`, null, { params: regenerate ? { regenerate: true } : {} }).then(r => r.data),
  toggleShortlist: (cid: number) =>
    api.put(`/api/joblens/candidates/${cid}/shortlist`).then(r => r.data),
  saveInterviewResult: (cid: number, result: any) =>
    api.post(`/api/joblens/candidates/${cid}/interview-result`, result).then(r => r.data),
  export: (sid: number) =>
    api.get(`/api/joblens/sessions/${sid}/export`, { responseType: "blob" }).then(r => r.data),
  prepareInvite: (cid: number) =>
    api.post(`/api/joblens/candidates/${cid}/prepare-invite`).then(r => r.data),
  getMorphcastKey: () =>
    api.get(`/api/joblens/morphcast-key`).then(r => r.data),
  getInterviewSettings: () =>
    api.get(`/api/joblens/interview-settings`).then(r => r.data),
  synthesizeSpeech: (text: string) =>
    api.post(`/api/joblens/tts`, { text }, { responseType: "blob", timeout: 30_000 }).then(r => r.data),
  getVideoViewToken: (cid: number) =>
    api.post(`/api/joblens/candidates/${cid}/video-view-token`).then(r => r.data),
  markContacted: (cid: number) =>
    api.post(`/api/joblens/candidates/${cid}/mark-contacted`).then(r => r.data),
  // Actually delivers the invite via the recruiter's own SMTP config
  // (Settings > API Keys > SMTP), server-side — no local mail client
  // involved. Backend resolves the sender purely from the logged-in
  // user's saved "smtp" credentials (host/port/username/password/
  // from_email); nothing about the sender is passed from the frontend.
  sendInvite: (cid: number, data: { to_email: string; subject: string; body_html: string }) =>
    api.post(`/api/joblens/candidates/${cid}/send-invite`, data).then(r => r.data),
  markPhoneContacted: (cid: number) =>
    api.post(`/api/joblens/candidates/${cid}/phone-contacted`).then(r => r.data),
  // Emails the recruiter's Calendly booking link to the candidate so they
  // can self-schedule the initial HR phone screening. Also registers/
  // updates this candidate's Interview Scheduling row (Phone Interview
  // round) — see backend _get_or_create_joblens_interview.
  sendPhoneCalendlyLink: (cid: number, data?: { to_email?: string; subject?: string; body_html?: string; booking_url?: string }) =>
    api.post(`/api/joblens/candidates/${cid}/phone-interview/send-calendly-link`, data || {}).then(r => r.data),
  // Resolves/mints the real booking link WITHOUT emailing anything, so
  // the compose modal can show a working link in the editable message
  // body before Send — same shape as prepareInvite for Video Interview.
  preparePhoneCalendlyLink: (cid: number) =>
    api.post(`/api/joblens/candidates/${cid}/phone-interview/prepare-calendly-link`).then(r => r.data),
  // Click-to-call: bridges the recruiter's own Telephony caller number
  // (Settings > API Keys > Telephony) to this candidate's phone.
  callPhoneCandidate: (cid: number) =>
    api.post(`/api/joblens/candidates/${cid}/phone-interview/call`).then(r => r.data),
  // Pulls the Twilio recording for the most recent call to this
  // candidate and transcribes it — on-demand (no webhook), since Twilio
  // recordings usually take a few seconds to a minute to become
  // available. Only works for Twilio calls, not Windows/Android Caller
  // ones (no access to that call's audio at all — see backend docstring).
  fetchPhoneTranscript: (cid: number) =>
    api.post(`/api/joblens/candidates/${cid}/phone-interview/fetch-transcript`).then(r => r.data),
  // Texts the candidate the time they'll be called, and sets that time
  // on this candidate's Interview Scheduling row (scheduled_at/status).
  sendPhoneScheduleSms: (cid: number, data: { scheduled_at: string; message?: string }) =>
    api.post(`/api/joblens/candidates/${cid}/phone-interview/send-sms-schedule`, data).then(r => r.data),
  updateStatus: (cid: number, status: string) =>
    api.put(`/api/joblens/candidates/${cid}/status`, { status }).then(r => r.data),
  savePhoneResult: (cid: number, data: { recommendation: string; notes: string }) =>
    api.post(`/api/joblens/candidates/${cid}/phone-result`, data).then(r => r.data),
  saveVideoResult: (cid: number, data: { recommendation: string; notes: string }) =>
    api.post(`/api/joblens/candidates/${cid}/video-result`, data).then(r => r.data),
  uploadVideo: (cid: number, blob: Blob) => {
    const form = new FormData();
    form.append("file", blob, "interview.webm");
    return api.post(`/api/joblens/candidates/${cid}/video`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then(r => r.data);
  },
  reanalyzeVideo: (cid: number) =>
    api.post(`/api/joblens/candidates/${cid}/reanalyze-video`).then(r => r.data),
  // Backfill: queues analysis for every one of the recruiter's OWN
  // candidates who has a stored video but no completed analysis yet
  // (never ran, failed, or stuck Pending) — see the backend endpoint's
  // docstring for the exact criteria.
  analyzeUnanalyzedVideos: () =>
    api.post(`/api/joblens/candidates/analyze-unanalyzed-videos`).then(r => r.data),
  requisitionOptions: () =>
    api.get(`/api/joblens/requisition-options`).then(r => r.data),
  requisitionCandidates: (requisitionId: number) =>
    api.get(`/api/joblens/requisition-candidates`, { params: { requisition_id: requisitionId } }).then(r => r.data),
  // Screening Decision's bulk "Send Rejection Email" — one individually
  // addressed email per candidate (never a shared To/CC list), so no
  // candidate ever sees another's name or address. {name} in
  // body_html_template is replaced with each candidate's own first name
  // right before THEIR email goes out. Returns which sends succeeded vs
  // failed so the popup can report exactly that, not just "done".
  sendRejectionEmails: (data: { candidate_ids: number[]; subject: string; body_html_template: string }) =>
    api.post(`/api/joblens/candidates/reject-email`, data).then(r => r.data),
};

// ─── HELPERS ───────────────────────────────────────────────────────────────
const CANDIDATE_STATUSES = ["Qualified", "Review", "Not Qualified"];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    "Qualified":     "tiq-badge-teal",
    "Review":        "tiq-badge-amber",
    "Not Qualified": "tiq-badge-rose",
    "Pending":       "tiq-badge-slate",
    "Not Started":   "tiq-badge-slate",
    "Completed":     "tiq-badge-teal",
  };
  return <span className={`tiq-badge ${map[status] || "tiq-badge-slate"}`}>{status}</span>;
}

// Small pill for a Proceed/Hold/Reject recommendation — used by both the
// Phone Score column (Video Interview page) and the Telephonic/Video
// Interview columns (Final Decision page) to show a prior stage's outcome.
function RecommendationBadge({ value }: { value: string }) {
  const map: Record<string, string> = { Proceed: "tiq-badge-teal", Hold: "tiq-badge-amber", Reject: "tiq-badge-rose" };
  return <span className={`tiq-badge ${map[value] || "tiq-badge-slate"}`}>{value}</span>;
}

function ScoreCell({ score, low, high }: { score: number; low: number; high: number }) {
  const color = score >= high ? "#10b981" : score >= low ? "#f59e0b" : "#ef4444";
  return (
    <span style={{ fontWeight: 700, color, fontSize: 14 }}>
      {score.toFixed(1)}%
    </span>
  );
}

function ProgressBar({ value, color = "var(--teal-500)" }: { value: number; color?: string }) {
  return (
    <div style={{ height: 6, background: "var(--bg-tertiary)", borderRadius: 3, overflow: "hidden", minWidth: 80 }}>
      <div style={{ height: "100%", width: `${Math.min(100, value)}%`, background: color, borderRadius: 3 }} />
    </div>
  );
}

// ─── ANCHORED POPOVER ───────────────────────────────────────────────────────
// A small, borderless, no-backdrop popover that appears right next to
// whatever triggered it (a "+N more" link, a resume-summary snippet, etc.)
// and closes on outside click. No dimmed background, no centering.
function AnchoredPopover({
  x, y, onClose, width = 300, openAbove = false, children
}: { x: number; y: number; onClose: () => void; width?: number; openAbove?: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    const escHandler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [onClose]);

  const clampedX = Math.max(8, Math.min(x, window.innerWidth - width - 12));

  return (
    <div ref={ref} style={{
      position: "fixed", left: clampedX, top: y, zIndex: 1500, width,
      maxHeight: 320, overflowY: "auto",
      background: "#ffffff", color: "#111827",
      border: "1px solid #e5e7eb", borderRadius: 10, padding: 12,
      boxShadow: "0 8px 28px rgba(0,0,0,.16)",
      // openAbove flips the card so its BOTTOM edge sits at `y` (the
      // row's top) instead of its top edge — this is what actually
      // makes it render "on top of" the clicked row rather than below
      // it, without needing to know the popover's rendered height
      // ahead of time.
      transform: openAbove ? "translateY(-100%)" : undefined,
    }}>
      {children}
    </div>
  );
}

// ─── VIDEO PLAYER MODAL ─────────────────────────────────────────────────
// "View recorded video" opens this instead of a new browser tab. Fetches
// a short-lived, video-scoped token (proves the ownership check already
// passed) and points a native <video> straight at the Range-aware
// streaming endpoint — the browser buffers just the first chunk and
// starts playing almost immediately, rather than the old approach of
// downloading the entire file into memory before anything could play.
function VideoPlayerModal({ candidateId, candidateName, onClose }: { candidateId: number; candidateName: string; onClose: () => void }) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    jobLensApi.getVideoViewToken(candidateId)
      .then(r => { if (!cancelled) setVideoUrl(r.url); })
      .catch(() => { if (!cancelled) setError("Could not load this video. Please try again."); });
    return () => { cancelled = true; };
  }, [candidateId]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "#000", borderRadius: 14, padding: 16, maxWidth: 820, width: "92%", boxShadow: "0 25px 60px rgba(0,0,0,.5)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>▶ {candidateName} — Recorded Interview</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#fff", fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
        {error ? (
          <div style={{ color: "#f87171", padding: 40, textAlign: "center" }}>{error}</div>
        ) : !videoUrl ? (
          <div style={{ color: "#9ca3af", padding: 40, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <span className="tiq-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Loading video…
          </div>
        ) : (
          <video src={videoUrl} controls autoPlay style={{ width: "100%", maxHeight: "70vh", borderRadius: 8, display: "block", background: "#000" }} />
        )}
      </div>
    </div>
  );
}

// ─── MORPHCAST LOADER ───────────────────────────────────────────────────────
declare global {
  interface Window { CY?: any; MphTools?: any; }
}

// License key is fetched at runtime from Settings > API Keys (service:
// morphcast) via jobLensApi.getMorphcastKey() — MorphCast's SDK now
// requires a real key on every load, there's no keyless trial mode.

function loadMorphcastScripts(): Promise<void> {
  function load(src: string, dataConfig?: string) {
    return new Promise<void>((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement("script");
      s.src = src;
      if (dataConfig) s.setAttribute("data-config", dataConfig);
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }
  return (async () => {
    await load(
      "https://sdk.morphcast.com/mphtools/v1.1/mphtools.js",
      "cameraPrivacyPopup, compatibilityUI, compatibilityAutoCheck"
    );
    await load("https://ai-sdk.morphcast.com/v1.16/ai-sdk.js");
  })();
}

type EmotionAgg = { angry: number; disgust: number; fear: number; happy: number; sad: number; surprise: number; neutral: number; };
const EMPTY_EMO: EmotionAgg = { angry: 0, disgust: 0, fear: 0, happy: 0, sad: 0, surprise: 0, neutral: 0 };
const ANSWER_SECONDS = 30;

// ─── VIDEO INTERVIEW MODAL ─────────────────────────────────────────────────
function VideoInterviewModal({
  candidate, questions, sessionId, onClose, onDone
}: {
  candidate: any; questions: string[]; sessionId: number;
  onClose: () => void; onDone: (emotions: any, videoBlob: Blob | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const engineRef = useRef<any>(null);
  const isRecordingRef = useRef(false);

  const [qIdx, setQIdx] = useState(0);
  const [recording, setRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [answerSeconds, setAnswerSeconds] = useState(ANSWER_SECONDS);
  const [timeLeft, setTimeLeft] = useState(ANSWER_SECONDS);
  const [started, setStarted] = useState(false);
  const [mcReady, setMcReady] = useState(false);
  const [mcStatus, setMcStatus] = useState("Initialising camera & emotion AI…");
  const [agg, setAgg] = useState<EmotionAgg>({ ...EMPTY_EMO });
  const [avgAgg, setAvgAgg] = useState<EmotionAgg>({ ...EMPTY_EMO });
  const [samples, setSamples] = useState(0);
  const [dominant, setDominant] = useState("Neutral");
  const [licenseKey, setLicenseKey] = useState("");
  const [keyChecked, setKeyChecked] = useState(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  // Prefetch cache: question text -> already-fetched audio Blob. Edge-TTS
  // is a real network round-trip per question (see utils/tts.py) — with
  // no prefetch, that latency landed right when the recruiter/candidate
  // was waiting to hear the NEXT question, which is what "question
  // reading is also taking time" actually is. Fetching question i+1's
  // audio while question i is still being answered hides that latency
  // almost entirely, since it's usually done well before the timer ends.
  const ttsCacheRef = useRef<Map<string, Blob>>(new Map());
  const prefetchTts = (q: string) => {
    if (!q || ttsCacheRef.current.has(q)) return;
    jobLensApi.synthesizeSpeech(q)
      .then((blob: Blob) => { ttsCacheRef.current.set(q, blob); })
      .catch(() => { /* best-effort — speakQuestion() will just fetch it fresh if this never lands */ });
  };
  // Same recording/storage/review consent gate as the candidate's public
  // interview page — shown first, every time this modal opens; camera/mic
  // access is never requested until it's explicitly accepted.
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [privacyChecked, setPrivacyChecked] = useState(false);

  // Fetch the recruiter's MorphCast key + the admin-configured interview
  // settings (answer time, TTS voice) as soon as the modal mounts, so
  // they're ready by the time Start Interview fires.
  useEffect(() => {
    jobLensApi.getMorphcastKey()
      .then(r => setLicenseKey(r.license_key || ""))
      .catch(() => setLicenseKey(""))
      .finally(() => setKeyChecked(true));
    jobLensApi.getInterviewSettings()
      .then(r => { setAnswerSeconds(r.answer_seconds || ANSWER_SECONDS); setTimeLeft(r.answer_seconds || ANSWER_SECONDS); })
      .catch(() => { /* keep the 30s default */ });
  }, []);

  // Keep ref in sync so the MorphCast event handler (closure) sees current value
  isRecordingRef.current = recording;

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Capped to 480p — an interview is a talking-head recording, not
        // action footage, so this resolution stays perfectly reviewable
        // while cutting the raw capture size dramatically before it ever
        // reaches MediaRecorder. Browsers still fall back to whatever the
        // webcam actually supports if 480p isn't available (ideal, not
        // exact/min), so this never blocks the camera from starting.
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: true,
      });
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setStarted(true);
      // Record the WHOLE interview as a single continuous MediaRecorder
      // session (started once, stopped once) — starting/stopping a new
      // recorder per-question would produce several independent WebM
      // fragments that can't simply be concatenated into one playable file.
      //
      // Compression: prefer VP9 (noticeably better compression than the
      // VP8 default at the same visual quality) and fall back through
      // progressively more basic mime types if the browser doesn't
      // support it. Bitrate is capped explicitly rather than left to the
      // browser's own default (which targets resolution-based quality,
      // not file size, and can land anywhere from ~1–3+ Mbps) — 500kbps
      // video + 48kbps audio is plenty for a compressed talking-head
      // recording and keeps a multi-minute interview to low tens of MB
      // instead of hundreds, directly reducing what lands in video_blob.
      try {
        const preferredMimeTypes = [
          "video/webm;codecs=vp9,opus",
          "video/webm;codecs=vp8,opus",
          "video/webm",
        ];
        const mimeType = preferredMimeTypes.find(t => MediaRecorder.isTypeSupported(t)) || "video/webm";
        const mr = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 500_000,
          audioBitsPerSecond: 48_000,
        });
        mediaRef.current = mr;
        chunksRef.current = [];
        mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        mr.start();
      } catch { /* MediaRecorder unsupported — emotion AI + timer still work */ }
      await initMorphcast();
      speakQuestion(questions[0] || "");
    } catch {
      alert(
        "Camera/Mic is blocked. Please:\n" +
        "1) Click the padlock in the address bar and allow Camera/Mic\n" +
        "2) Check OS-level privacy settings allow this browser\n" +
        "3) Close other apps using the camera (Zoom/Teams/OBS)"
      );
    }
  };

  const initMorphcast = async () => {
    if (keyChecked && !licenseKey) {
      setMcStatus("Emotion AI not configured (add a free MorphCast license key in Settings > API Keys) — interview will continue without facial analysis.");
      return;
    }
    try {
      await loadMorphcastScripts();
      window.MphTools?.CompatibilityAutoCheck?.run?.();

      const CY = (window as any).CY;
      if (!CY) throw new Error("MorphCast SDK unavailable");

      const source = CY.createSource.fromVideoElement(videoRef.current);
      let loader = CY.loader()
        .addModule(CY.modules().FACE_DETECTOR.name)
        .addModule(CY.modules().FACE_EMOTION.name)
        .source(source);
      if (licenseKey) loader = loader.licenseKey(licenseKey);

      const engine = await loader.load();
      engineRef.current = engine;

      const handleEmotion = (evt: any) => {
        if (!isRecordingRef.current) return;
        const detail = evt?.detail || evt;
        const out = detail?.output || detail?.data || detail?.result || undefined;
        const emo = out?.face?.emotion || out?.face0?.emotion || out?.emotion || null;
        if (!emo) return;

        const vals: EmotionAgg = {
          angry:    Number(emo.angry ?? emo.Angry ?? 0),
          disgust:  Number(emo.disgust ?? emo.Disgust ?? 0),
          fear:     Number(emo.fear ?? emo.Fear ?? 0),
          happy:    Number(emo.happy ?? emo.Happy ?? 0),
          sad:      Number(emo.sad ?? emo.Sad ?? 0),
          surprise: Number(emo.surprise ?? emo.Surprise ?? 0),
          neutral:  Number(emo.neutral ?? emo.Neutral ?? 0),
        };
        const [domKey] = Object.entries(vals).reduce(
          (max, c) => (c[1] > max[1] ? c : max),
          ["neutral", 0]
        ) as [keyof EmotionAgg, number];

        setAgg(prev => {
          const updated = { ...prev, [domKey]: prev[domKey] + 1 } as EmotionAgg;
          const total = Object.values(updated).reduce((a, b) => a + b, 1);
          setAvgAgg({
            angry: Math.round(updated.angry / total * 100),
            disgust: Math.round(updated.disgust / total * 100),
            fear: Math.round(updated.fear / total * 100),
            happy: Math.round(updated.happy / total * 100),
            sad: Math.round(updated.sad / total * 100),
            surprise: Math.round(updated.surprise / total * 100),
            neutral: Math.round(updated.neutral / total * 100),
          });
          const domEntry = Object.entries(updated).reduce((a, b) => (b[1] > a[1] ? b : a), ["neutral", 0]);
          setDominant(domEntry[0].charAt(0).toUpperCase() + domEntry[0].slice(1));
          setSamples(total);
          return updated;
        });
      };

      window.addEventListener("CY_FACE_EMOTION", handleEmotion);
      window.addEventListener("CY_FACE_EMOTION_RESULT", handleEmotion);
      window.addEventListener("cy.face.emotion", handleEmotion);

      await engine.start();
      setMcReady(true);
      setMcStatus("Emotion AI active — recording only while you answer.");
    } catch (e: any) {
      setMcStatus("Emotion AI unavailable (" + (e?.message || "init failed") + ") — interview will continue without facial analysis.");
    }
  };

  // Speaks the question using Microsoft Edge's neural voice (natural,
  // human-sounding, via edge-tts) when the backend has it
  // configured/available; falls back to the browser's built-in
  // SpeechSynthesis voice on any failure (not configured, network hiccup,
  // etc.) so the interview is never blocked on TTS.
  const speakQuestion = async (q: string) => {
    if (!q) { startRecording(); return; }
    setIsSpeaking(true);
    try {
      const audioBlob: Blob = ttsCacheRef.current.get(q) || await jobLensApi.synthesizeSpeech(q);
      ttsCacheRef.current.delete(q); // one-shot — don't hold every question's audio in memory for the whole interview
      const url = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      ttsAudioRef.current = audio;
      audio.onended = () => { setIsSpeaking(false); URL.revokeObjectURL(url); startRecording(); };
      audio.onerror = () => { setIsSpeaking(false); URL.revokeObjectURL(url); startRecording(); };
      await audio.play();
      return;
    } catch { /* Server-side TTS not available/enabled — fall back below */ }

    if (!("speechSynthesis" in window)) { setIsSpeaking(false); startRecording(); return; }
    const utter = new SpeechSynthesisUtterance(q);
    utter.rate = 0.92;
    utter.pitch = 1.05;
    utter.lang = "en-US";
    utter.onend = () => { setIsSpeaking(false); startRecording(); };
    utter.onerror = () => { setIsSpeaking(false); startRecording(); };
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
  };

  const startRecording = () => {
    // Actual video capture already started once in startCamera() and runs
    // continuously for the whole interview — this just drives the
    // per-question UI (timer, REC indicator).
    setRecording(true);
    setTimeLeft(answerSeconds);
    // Kick off the NEXT question's TTS now, in the background, instead of
    // waiting until nextQuestion() actually needs it — see ttsCacheRef.
    prefetchTts(questions[qIdx + 1] || "");
  };

  // Countdown timer — pauses while TTS is speaking
  const timerTickRef = useRef<any>(null);
  useEffect(() => {
    if (!recording || isSpeaking) return;
    if (timeLeft <= 0) { nextQuestion(); return; }
    timerTickRef.current = setTimeout(() => setTimeLeft(t => t - 1), 1000);
    return () => clearTimeout(timerTickRef.current);
  }, [recording, isSpeaking, timeLeft]);

  const nextQuestion = () => {
    if (timerTickRef.current) { clearTimeout(timerTickRef.current); timerTickRef.current = null; }
    setRecording(false);
    if (qIdx < questions.length - 1) {
      setTimeout(() => {
        setQIdx(i => i + 1);
        speakQuestion(questions[qIdx + 1] || "");
      }, 500);
    } else {
      finishInterview();
    }
  };

  const finishInterview = async () => {
    if (timerTickRef.current) { clearTimeout(timerTickRef.current); timerTickRef.current = null; }
    setRecording(false);
    speechSynthesis.cancel();
    if (ttsAudioRef.current) { ttsAudioRef.current.pause(); ttsAudioRef.current = null; }
    try { await engineRef.current?.stop?.(); await engineRef.current?.destroy?.(); } catch {}

    // Stop the single continuous recorder and wait for it to fully flush
    // its last chunk (fires asynchronously) before building the final blob.
    const videoBlob: Blob | null = await new Promise(resolve => {
      const mr = mediaRef.current;
      if (!mr || mr.state === "inactive") {
        resolve(chunksRef.current.length ? new Blob(chunksRef.current, { type: "video/webm" }) : null);
        return;
      }
      mr.onstop = () => {
        resolve(chunksRef.current.length ? new Blob(chunksRef.current, { type: "video/webm" }) : null);
      };
      mr.stop();
    });

    const tracks = (videoRef.current?.srcObject as MediaStream)?.getTracks?.() || [];
    tracks.forEach(t => t.stop());

    const emotions = samples > 0
      ? { ...avgAgg, dominant }
      : { happy: 0, neutral: 100, sad: 0, angry: 0, disgust: 0, fear: 0, surprise: 0, dominant: "Neutral" };
    onDone(emotions, videoBlob);
  };

  const currentQ = questions[qIdx] || "Loading...";

  if (!privacyAccepted) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: "#ffffff", color: "#111827", borderRadius: 16, padding: 28, maxWidth: 560, width: "95%", boxShadow: "0 25px 60px rgba(0,0,0,.4)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 17, color: "#111827" }}>
              <Video size={16} style={{ display: "inline", marginRight: 8, color: "#0d9488" }} />
              Before you begin — {candidate.name}
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", fontSize: 20 }}>×</button>
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "#374151", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <p style={{ margin: "0 0 10px" }}>
              This video interview will <strong>record camera, microphone, and facial expressions</strong> for
              the full duration of the session. The recording will be:
            </p>
            <ul style={{ margin: "0 0 10px", paddingLeft: 20 }}>
              <li><strong>Stored securely</strong> on this account.</li>
              <li><strong>Reviewed by decision-makers</strong> involved in this hiring process.</li>
              <li>Analysed by AI to help assess communication, relevance, and confidence.</li>
            </ul>
            <p style={{ margin: 0 }}>By continuing, you confirm the candidate has agreed to this recording, storage, and review.</p>
          </div>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, marginBottom: 16, cursor: "pointer" }}>
            <input type="checkbox" checked={privacyChecked} onChange={e => setPrivacyChecked(e.target.checked)} style={{ marginTop: 2 }} />
            <span>I understand and agree that this interview will be recorded, stored, and reviewed by decision-makers as described above.</span>
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="tiq-btn tiq-btn-primary" style={{ flex: 1 }} disabled={!privacyChecked} onClick={() => setPrivacyAccepted(true)}>
              I Agree — Continue to Interview
            </button>
            <button className="tiq-btn tiq-btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#ffffff", color: "#111827", borderRadius: 16, padding: 28, maxWidth: 760, width: "95%", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,.4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 17, color: "#111827" }}>
            <Video size={16} style={{ display: "inline", marginRight: 8, color: "#ef4444" }} />
            Video Interview — {candidate.name}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", fontSize: 20 }}>×</button>
        </div>

        <div style={{ position: "relative" }}>
          <video ref={videoRef} style={{ width: "100%", borderRadius: 12, background: "#000", minHeight: 240 }} playsInline muted />
          {isSpeaking && (
            <div style={{ position: "absolute", bottom: 12, left: 12, padding: "4px 10px", borderRadius: 20, background: "rgba(0,199,183,.9)", color: "white", fontSize: 11, fontWeight: 700 }}>
              🔊 Reading question…
            </div>
          )}
          {recording && (
            <div style={{ position: "absolute", top: 12, right: 12, padding: "4px 10px", borderRadius: 20, background: "rgba(239,68,68,.9)", color: "white", fontSize: 11, fontWeight: 700 }}>
              ● REC
            </div>
          )}
        </div>

        {started && (
          <div style={{ fontSize: 11, color: mcReady ? "#0d9488" : "#6b7280", marginTop: 8 }}>
            {mcStatus}
          </div>
        )}

        {started && (
          <div style={{ margin: "16px 0", padding: 14, background: "#f3f4f6", borderRadius: 10, borderLeft: "4px solid #0d9488" }}>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Question {qIdx + 1} / {questions.length}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#111827" }}>{currentQ}</div>
          </div>
        )}

        {recording && (
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: "#ef4444" }}>{timeLeft}s</div>
            <div style={{ fontSize: 10, color: "#6b7280" }}>remaining</div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          {!started ? (
            <button className="tiq-btn tiq-btn-primary" onClick={startCamera}>
              <Video size={14} /> Start Interview
            </button>
          ) : (
            <button className="tiq-btn tiq-btn-outline" onClick={nextQuestion} disabled={isSpeaking}>
              {qIdx < questions.length - 1 ? "Next Question →" : "Finish Interview"}
            </button>
          )}
          <button className="tiq-btn tiq-btn-ghost" onClick={finishInterview}>End Now</button>
        </div>
      </div>
    </div>
  );
}

// ─── CANDIDATE CONTACT / SEND INVITE MODAL ─────────────────────────────────
// Sends the invite for real, server-side, over SMTP — using whichever
// SMTP credentials the CURRENTLY LOGGED-IN recruiter has saved under
// Settings > API Keys (service "smtp"). No mailto:, no local mail
// client involved, and no sender is hardcoded here: the "From" address
// is resolved entirely on the backend from that recruiter's own saved
// from_email (see _send_email / _get_smtp_config in routers/joblens.py).
// If that recruiter hasn't configured SMTP yet, the send fails with a
// clear error telling them to set it up in Settings — it never silently
// falls back to someone else's credentials.
function escapeHtmlForEmail(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function ContactModal({
  candidate, token, onClose, onSent
}: { candidate: any; token: string; onClose: () => void; onSent: () => void }) {
  const link = `${window.location.origin}/interview/${token}`;
  const [toEmail, setToEmail] = useState(candidate.email || "");
  const [subject, setSubject] = useState(`Video Interview Invitation - ${candidate.name}`);
  const [body, setBody] = useState(
`Dear ${candidate.name},

Thank you for your application. We would like to invite you to complete a short video interview as the next step in our recruitment process.

Please click the link below to begin. It works directly in your browser — no account or login required:

${link}

Please note: this video interview will be recorded, securely stored, and reviewed by our hiring decision-makers as part of the recruitment process. Please ensure you are in a quiet, well-lit location, dressed professionally, and ready to present yourself as you would for an in-person interview.

Regards,
HR Team`
  );
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [opened, setOpened] = useState(false);

  const handleSend = async () => {
    setSending(true);
    setSendError("");
    try {
      // Turn the plain-text draft into a simple HTML email — escape it
      // first, then re-linkify the interview URL and turn line breaks
      // into <br/>, so the candidate gets a clickable link either way.
      let html = escapeHtmlForEmail(body);
      const escapedLink = escapeHtmlForEmail(link);
      html = html.split(escapedLink).join(`<a href="${link}" target="_blank" rel="noopener noreferrer">${link}</a>`);
      html = html.replace(/\n/g, "<br/>");
      const body_html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827;">${html}</div>`;

      await jobLensApi.sendInvite(candidate.id, { to_email: toEmail, subject, body_html });
      try { await jobLensApi.markContacted(candidate.id); } catch { /* non-fatal */ }
      setOpened(true);
      onSent();
    } catch (e: any) {
      setSendError(
        e.response?.data?.detail ||
        "Failed to send. Check your SMTP settings under Settings > API Keys."
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#ffffff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 560, width: "94%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,.4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>
            <Mail size={15} style={{ display: "inline", marginRight: 6, color: "#0d9488" }} />
            Send Video Interview Invite — {candidate.name}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#6b7280" }}>×</button>
        </div>

        {opened ? (
          <div style={{ padding: "20px 0", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0d9488", marginBottom: 8 }}>
              ✅ Invite sent to {toEmail}
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
              Sent via your SMTP settings from Settings &gt; API Keys.
            </div>
            <button className="tiq-btn tiq-btn-outline" onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            <div className="tiq-form-group">
              <label className="tiq-label" style={{ color: "#374151" }}>To</label>
              <input className="tiq-input" value={toEmail} onChange={e => setToEmail(e.target.value)} />
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label" style={{ color: "#374151" }}>Subject</label>
              <input className="tiq-input" value={subject} onChange={e => setSubject(e.target.value)} />
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label" style={{ color: "#374151" }}>Message</label>
              <textarea className="tiq-input" style={{ minHeight: 220, fontFamily: "inherit", fontSize: 13, whiteSpace: "pre-wrap" }}
                value={body} onChange={e => setBody(e.target.value)} />
            </div>
            {sendError && (
              <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 10, padding: "8px 12px", borderRadius: 6, background: "rgba(239,68,68,.08)" }}>
                {sendError}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="tiq-btn tiq-btn-primary" onClick={handleSend} disabled={!toEmail || sending}>
                {sending ? "Sending…" : "Send"}
              </button>
              <button className="tiq-btn tiq-btn-ghost" onClick={onClose} disabled={sending}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── ANALYZE UNANALYZED VIDEOS (backfill) ───────────────────────────────────
// Page-header action on Video Interview: queues analysis for every one of
// the recruiter's own candidates who has a stored recording but no
// completed analysis on file — never ran, failed earlier (e.g. before
// the Groq Key Pool bug fix), or got stuck "Pending". A recruiter
// shouldn't have to click "Reanalyze" on each candidate one at a time
// after fixing something like a missing/broken Groq key.
function AnalyzeUnanalyzedVideosButton() {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const run = async () => {
    setState("running"); setMessage("");
    try {
      const r = await jobLensApi.analyzeUnanalyzedVideos();
      setState("done");
      setMessage(
        r.queued > 0
          ? `Queued ${r.queued} candidate${r.queued === 1 ? "" : "s"} for analysis — refresh in a bit to see results.`
          : "Nothing to do — every candidate with a stored video already has a completed analysis."
      );
    } catch (e: any) {
      setState("error");
      setMessage(e?.response?.data?.detail || "Failed to queue analysis.");
    }
  };

  return (
    <div style={{ textAlign: "right" }}>
      <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={run} disabled={state === "running"}
        title="Analyze every stored interview video that hasn't been successfully analysed yet">
        <Sparkles size={13} /> {state === "running" ? "Queuing…" : "Analyze Unanalyzed Videos"}
      </button>
      {message && (
        <div style={{ fontSize: 11, color: state === "error" ? "var(--rose-500)" : "var(--text-muted)", marginTop: 4, maxWidth: 260 }}>
          {message}
        </div>
      )}
    </div>
  );
}

// ─── SEND CALENDLY LINK MODAL ───────────────────────────────────────────────
// Mirrors ContactModal above exactly (To/Subject/Message compose UI,
// Send/Cancel) — clicking "Send Calendly Link" used to fire the email
// immediately with a fixed template and no chance to review/edit it,
// unlike Video Interview's "Send Interview Invite", which always opens
// this same kind of compose modal first. prepare-calendly-link resolves
// a real, working booking link up front (same idea as prepareInvite's
// token) so the editable message body already has a working link in it
// before Send is ever clicked.
function CalendlyModal({
  candidate, onClose, onSent,
}: { candidate: any; onClose: () => void; onSent: () => void }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [bookingUrl, setBookingUrl] = useState("");
  const [toEmail, setToEmail] = useState(candidate.email || "");
  const [subject, setSubject] = useState("Schedule your phone screening interview");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    jobLensApi.preparePhoneCalendlyLink(candidate.id)
      .then(r => {
        setBookingUrl(r.booking_url);
        setToEmail(r.candidate_email || candidate.email || "");
        setBody(
`Hi ${candidate.name || "there"},

Thanks for your interest — we'd like to set up a quick initial phone screening interview with you.

Please use the link below to pick a time that works for you:

${r.booking_url}

Looking forward to speaking with you.`
        );
      })
      .catch((e: any) => setLoadError(e?.response?.data?.detail || "Failed to prepare the Calendly link."))
      .finally(() => setLoading(false));
  }, [candidate.id]);

  const handleSend = async () => {
    setSending(true);
    setSendError("");
    try {
      let html = escapeHtmlForEmail(body);
      if (bookingUrl) {
        const escapedLink = escapeHtmlForEmail(bookingUrl);
        html = html.split(escapedLink).join(`<a href="${bookingUrl}" target="_blank" rel="noopener noreferrer">${bookingUrl}</a>`);
      }
      html = html.replace(/\n/g, "<br/>");
      const body_html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827;">${html}</div>`;

      await jobLensApi.sendPhoneCalendlyLink(candidate.id, { to_email: toEmail, subject, body_html, booking_url: bookingUrl });
      setSent(true);
      onSent();
    } catch (e: any) {
      setSendError(e?.response?.data?.detail || "Failed to send. Check your SMTP settings under Settings > API Keys.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#ffffff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 560, width: "94%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,.4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>
            <CalendarClock size={15} style={{ display: "inline", marginRight: 6, color: STAGE_ICON_COLOR.phone }} />
            Send Calendly Link — {candidate.name}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#6b7280" }}>×</button>
        </div>

        {loading ? (
          <div style={{ padding: "24px 0", textAlign: "center", color: "#6b7280", fontSize: 13 }}>Preparing your Calendly link…</div>
        ) : loadError ? (
          <div style={{ padding: "12px 0" }}>
            <div style={{ fontSize: 13, color: "#ef4444", marginBottom: 14 }}>{loadError}</div>
            <button className="tiq-btn tiq-btn-outline" onClick={onClose}>Close</button>
          </div>
        ) : sent ? (
          <div style={{ padding: "20px 0", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0d9488", marginBottom: 8 }}>
              ✅ Calendly link sent to {toEmail}
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
              Sent via your SMTP settings from Settings &gt; API Keys.
            </div>
            <button className="tiq-btn tiq-btn-outline" onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            <div className="tiq-form-group">
              <label className="tiq-label" style={{ color: "#374151" }}>To</label>
              <input className="tiq-input" value={toEmail} onChange={e => setToEmail(e.target.value)} />
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label" style={{ color: "#374151" }}>Subject</label>
              <input className="tiq-input" value={subject} onChange={e => setSubject(e.target.value)} />
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label" style={{ color: "#374151" }}>Message</label>
              <textarea className="tiq-input" style={{ minHeight: 200, fontFamily: "inherit", fontSize: 13, whiteSpace: "pre-wrap" }}
                value={body} onChange={e => setBody(e.target.value)} />
            </div>
            {sendError && (
              <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 10, padding: "8px 12px", borderRadius: 6, background: "rgba(239,68,68,.08)" }}>
                {sendError}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="tiq-btn tiq-btn-primary" onClick={handleSend} disabled={!toEmail || sending}>
                {sending ? "Sending…" : "Send"}
              </button>
              <button className="tiq-btn tiq-btn-ghost" onClick={onClose} disabled={sending}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── SCORE DETAILS MODAL ────────────────────────────────────────────────────
// Backs the Resume Screening table's "Details" column — a centered popup
// with the candidate's full score breakdown (ScoreBreakdownGrid),
// categorized strengths, profile summary, and the Shortlist toggle, so
// none of that needs a permanently-expanded row anymore.
function ScoreDetailsModal({
  c, shortlisted, onToggleShortlist, onClose,
}: { c: any; shortlisted: boolean; onToggleShortlist: () => void; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#ffffff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 620, width: "94%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,.4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>
            Score Details — {c.name}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#6b7280" }}>×</button>
        </div>

        {c.summary && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#6b7280", marginBottom: 6 }}>Profile Summary</div>
            <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.6 }}>{c.summary}</div>
          </div>
        )}

        {c.strengths_breakdown?.scoreBreakdown && (
          <ScoreBreakdownGrid breakdown={c.strengths_breakdown.scoreBreakdown} />
        )}

        {c.strengths_breakdown && (
          <div style={{ marginTop: 4, marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#6b7280", marginBottom: 8 }}>Strengths Breakdown</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              {[
                ["Essential Matched", c.strengths_breakdown.essentialMatched, "#10b981"],
                ["Technical Skills", c.strengths_breakdown.technicalSkills, "#3b82f6"],
                ["Business Skills", c.strengths_breakdown.businessSkills, "#8b5cf6"],
                ["Soft Skills", c.strengths_breakdown.softSkills, "#ec4899"],
                ["Significant Experience", c.strengths_breakdown.significantExperience, "#f59e0b"],
                ["Certifications & Degrees", c.strengths_breakdown.certificationsDegrees, "#06b6d4"],
              ].map(([label, items, color]: any) => items?.length > 0 && (
                <div key={label}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color, marginBottom: 4 }}>{label}</div>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {items.map((s: string, i: number) => (
                      <li key={i} style={{ fontSize: 12, color: "#374151", marginBottom: 3 }}>• {s}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {c.bonus > 0 && (
          <div style={{ marginBottom: 16, fontSize: 12, color: "#f59e0b" }}>
            🎯 Bonus: +{c.bonus} pts — {c.bonus_reasons}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CALL CANDIDATE POPUP ───────────────────────────────────────────────────
// Phone Interview's "Call Candidate" button opens this: shows who's about
// to be called and from what number, then places a click-to-call via the
// recruiter's own Telephony credentials (Settings > API Keys > Telephony)
// — Twilio rings the recruiter's own caller number first, then bridges
// to the candidate the moment it's answered (see backend
// utils/telephony.place_click_to_call). No dialer UI here — the actual
// audio call happens over the recruiter's own phone line, not in-browser.
function CallCandidatePopup({
  candidateName, candidatePhone, callerNumber, telephonyConfigured, callMut, onClose, androidCaller,
}: { candidateName: string; candidatePhone: string; callerNumber: string; telephonyConfigured: boolean; callMut: any; onClose: () => void; androidCaller: { enabled: boolean; apiBase: string; mode: "direct" | "relay" } }) {
  // Windows/Android Caller path — entirely separate from callMut (Twilio),
  // only offered when enabled in Settings. Two ways it reaches the
  // recruiter's laptop, matching Settings → Phone Connection:
  //  - Relay mode: goes through TalentIQ's OWN backend
  //    (/api/android-caller/*), which forwards to whichever laptop agent
  //    is connected for this user — works from any device.
  //  - Direct mode: this browser tab calls the Local API on
  //    127.0.0.1 directly — only works on the same laptop as the phone.
  const [androidCallState, setAndroidCallState] = useState<"idle" | "dialing" | "active" | "error">("idle");
  const [androidCallError, setAndroidCallError] = useState("");
  const base = (androidCaller.apiBase || "http://127.0.0.1:4000").replace(/\/$/, "");
  const startAndroidCall = async () => {
    setAndroidCallError(""); setAndroidCallState("dialing");
    try {
      if (androidCaller.mode === "relay") {
        await api.post("/api/android-caller/call", { to_number: candidatePhone });
      } else {
        const res = await fetch(`${base}/api/call`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toNumber: candidatePhone }),
        });
        const data = await res.json();
        if (!res.ok) { setAndroidCallError(data.message || "Failed to start call."); setAndroidCallState("error"); return; }
      }
      setAndroidCallState("active");
    } catch (e: any) {
      setAndroidCallError(
        androidCaller.mode === "relay"
          ? (e?.response?.data?.detail || "Failed to start call — is the agent (npm run start:agent) running and connected?")
          : "Could not reach the Local API — is the Local API (npm start in server/) running on this laptop?"
      );
      setAndroidCallState("error");
    }
  };
  const hangUpAndroidCall = async () => {
    try {
      if (androidCaller.mode === "relay") await api.post("/api/android-caller/hangup");
      else await fetch(`${base}/api/hangup`, { method: "POST" });
    } catch { /* best-effort */ }
    setAndroidCallState("idle");
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#ffffff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 380, width: "92%", boxShadow: "0 25px 60px rgba(0,0,0,.4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>
            <PhoneCall size={16} style={{ display: "inline", marginRight: 8, color: "#ec4899" }} />
            Call {candidateName}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#6b7280" }}><X size={18} /></button>
        </div>

        {!candidatePhone ? (
          <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.6 }}>
            This candidate has no phone number on file.
          </div>
        ) : androidCaller.enabled ? (
          <div>
            <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.6, marginBottom: 16 }}>
              This dials <strong>{candidatePhone}</strong> on your own Android phone over ADB (Settings → Phone
              Connection).{" "}
              {androidCaller.mode === "relay"
                ? "Make sure the agent (npm run start:agent) is running on your laptop and shows \"connected\"."
                : "Make sure the Local API (npm start in server/) is running on this laptop and the phone shows \"connected\"."}
            </div>
            {androidCallError && (
              <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 12 }}>{androidCallError}</div>
            )}
            {androidCallState === "active" ? (
              <div>
                <div style={{ fontSize: 11, color: "#10b981", fontWeight: 700, marginBottom: 6 }}>Dialing on your phone now</div>
                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 12 }}>
                  No sound? Check Windows' speaker icon has your phone selected (Bluetooth "Hands-Free") — or tap
                  "Audio route" on the phone's own in-call screen once.
                </div>
                <button className="tiq-btn tiq-btn-outline" style={{ width: "100%" }} onClick={hangUpAndroidCall}>Hang Up</button>
              </div>
            ) : (
              <button className="tiq-btn tiq-btn-primary" style={{ width: "100%" }} disabled={androidCallState === "dialing"} onClick={startAndroidCall}>
                {androidCallState === "dialing" ? "Placing call…" : "Start Call (my phone)"}
              </button>
            )}
          </div>
        ) : !telephonyConfigured ? (
          <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.6 }}>
            Telephony isn't set up yet. Add your Twilio Account SID, Auth Token, and Caller Number, or enable the
            Windows/Android Caller, under <strong>Settings → API Keys</strong> first.
          </div>
        ) : callMut.isSuccess ? (
          <div>
            <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.6, marginBottom: 12 }}>
              Calling your phone (<strong>{callMut.data?.caller_number}</strong>) now — once you pick up, you'll be
              connected straight through to <strong>{candidateName}</strong> at {callMut.data?.candidate_number}.
            </div>
            <div style={{ fontSize: 11, color: "#10b981", fontWeight: 700 }}>Call status: {callMut.data?.status}</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.6, marginBottom: 16 }}>
              This will call <strong>your</strong> caller number (<strong>{callerNumber}</strong>) first — once you
              answer, it connects you straight through to <strong>{candidateName}</strong> at{" "}
              <strong>{candidatePhone}</strong>.
            </div>
            {callMut.isError && (
              <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 12 }}>
                {callMut.error?.response?.data?.detail || "Failed to place the call."}
              </div>
            )}
            <button className="tiq-btn tiq-btn-primary" style={{ width: "100%" }} disabled={callMut.isPending} onClick={() => callMut.mutate()}>
              {callMut.isPending ? "Placing call…" : "Start Call"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CANDIDATE ROW ─────────────────────────────────────────────────────────
type PopoverKind = "resume" | "matched" | "missing" | "questions" | "videoAnalysis" | "videoTranscript" | "scoreBreakdown";
type PopoverState = { kind: PopoverKind; x: number; y: number; width: number; anchor: HTMLElement; openAbove: boolean } | null;

function CandidateRow({
  c, rank, sessionId, lowT, highT, onRefresh, theadRef, jdEssential, jdGoodToHave, jdOptional, mode = "resume", focusCandidateId,
  selectable = false, selected = false, onToggleSelect,
}: { c: any; rank: number; sessionId: number; lowT: number; highT: number; onRefresh: () => void; theadRef: React.RefObject<HTMLTableSectionElement>; jdEssential: string[]; jdGoodToHave: string[]; jdOptional: string[]; mode?: "resume" | "phone" | "video" | "final"; focusCandidateId?: number | null; selectable?: boolean; selected?: boolean; onToggleSelect?: () => void }) {
  const isFocused = focusCandidateId === c.id;
  const rowRef = useRef<HTMLTableRowElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (isFocused && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Categorize matched/missing skills by JD tier (Essential/Preferred/
  // Optional) and, for matched skills, also by type (Technical/Business)
  // using the candidate's strengths_breakdown — both lenses use data
  // already extracted server-side, no new backend calls needed here.
  const essentialSet = new Set((jdEssential || []).map(s => s.toLowerCase()));
  const goodToHaveSet = new Set((jdGoodToHave || []).map(s => s.toLowerCase()));
  const optionalSet = new Set((jdOptional || []).map(s => s.toLowerCase()));
  const technicalList = (c.strengths_breakdown?.technicalSkills || []).map((s: string) => s.toLowerCase());
  const businessList = (c.strengths_breakdown?.businessSkills || []).map((s: string) => s.toLowerCase());
  const fuzzyIncludes = (list: string[], term: string) => list.some(t => t.includes(term) || term.includes(t));

  const matchedByCategory: Record<string, string[]> = { Essential: [], Preferred: [], Technical: [], Business: [] };
  (c.matched_skills || []).forEach((skill: string) => {
    const s = skill.toLowerCase();
    if (essentialSet.has(s)) matchedByCategory.Essential.push(skill);
    else if (goodToHaveSet.has(s)) matchedByCategory.Preferred.push(skill);
    if (fuzzyIncludes(technicalList, s)) matchedByCategory.Technical.push(skill);
    else if (fuzzyIncludes(businessList, s)) matchedByCategory.Business.push(skill);
  });

  const missingByCategory: Record<string, string[]> = { Essential: [], Preferred: [], Optional: [] };
  (c.missing_skills || []).forEach((skill: string) => {
    const s = skill.toLowerCase();
    if (essentialSet.has(s)) missingByCategory.Essential.push(skill);
    else if (goodToHaveSet.has(s)) missingByCategory.Preferred.push(skill);
    else if (optionalSet.has(s)) missingByCategory.Optional.push(skill);
    else missingByCategory.Essential.push(skill); // fallback — shouldn't normally happen
  });

  const [interviewOpen, setInterviewOpen] = useState(false);
  const [questions, setQuestions] = useState<string[]>(c.interview_questions || []);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [contacted, setContacted] = useState(!!c.contacted);
  const [inviteToken, setInviteToken] = useState<string | null>(c.interview_token || null);
  const [preparingInvite, setPreparingInvite] = useState(false);
  const [popover, setPopover] = useState<PopoverState>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showVideoPlayer, setShowVideoPlayer] = useState(false);

  // Local, instantly-updated shortlist state — decoupled from the parent
  // session refetch so the checkbox never waits on a network round trip.
  const [shortlisted, setShortlisted] = useState(!!c.shortlisted);
  useEffect(() => { setShortlisted(!!c.shortlisted); }, [c.shortlisted]);
  useEffect(() => { setContacted(!!c.contacted); }, [c.contacted]);

  const shortlistMut = useMutation({
    mutationFn: () => jobLensApi.toggleShortlist(c.id),
    onMutate: () => { setShortlisted(s => !s); },
    onError: () => { setShortlisted(s => !s); },
    onSuccess: () => { onRefresh(); },
  });

  const reanalyzeMut = useMutation({
    mutationFn: () => jobLensApi.reanalyzeVideo(c.id),
    onSuccess: () => { onRefresh(); },
  });

  // ── Phone Interview stage (mode === "phone") ──────────────────────
  const [phoneRecommendation, setPhoneRecommendation] = useState(c.phone_screening_recommendation || "Proceed");
  const [phoneNotes, setPhoneNotes] = useState(c.phone_screening_notes || "");
  const phoneContactMut = useMutation({
    mutationFn: () => jobLensApi.markPhoneContacted(c.id),
    onSuccess: () => { onRefresh(); },
    onError: () => { setPhoneContactedOptimistic(null); },
  });
  // Checkbox used to only ever read c.phone_screening_status — a prop
  // that only updates once BOTH the mutation finishes AND the full
  // candidate list refetch triggered by onRefresh() completes. That
  // round-trip is what made ticking it feel slow/unresponsive: the
  // click did nothing visually until a full list refetch landed.
  // Ticking immediately on click and only falling back to the server
  // value once it actually reflects "contacted" removes that lag —
  // errors revert it via onError above.
  const [phoneContactedOptimistic, setPhoneContactedOptimistic] = useState<boolean | null>(null);
  const [phoneScreeningPopupOpen, setPhoneScreeningPopupOpen] = useState(false);
  // "Send Calendly Link" now opens CalendlyModal (compose UI, same
  // pattern as Video Interview's ContactModal) instead of firing the
  // email immediately with a fixed template — calendlySent just tracks
  // whether it's been sent at least once, for the cell's quick-glance line.
  const [calendlyModalOpen, setCalendlyModalOpen] = useState(false);
  const [calendlySent, setCalendlySent] = useState(false);

  // ── Telephony: click-to-call popup + SMS-schedule (Settings > API
  // Keys > Telephony) ─────────────────────────────────────────────────
  const [showCallPopup, setShowCallPopup] = useState(false);
  const [smsScheduleAt, setSmsScheduleAt] = useState("");
  const [smsError, setSmsError] = useState("");
  const [smsSent, setSmsSent] = useState(false);
  const callMut = useMutation({
    mutationFn: () => jobLensApi.callPhoneCandidate(c.id),
    onSuccess: () => { onRefresh(); },
  });
  // Pulls + transcribes the Twilio recording for the last call — see
  // backend fetch_phone_transcript's docstring on why this is an
  // on-demand button rather than automatic (no webhook dependency).
  const [showPhoneTranscript, setShowPhoneTranscript] = useState(false);
  const phoneTranscriptMut = useMutation({
    mutationFn: () => jobLensApi.fetchPhoneTranscript(c.id),
    onSuccess: () => { setShowPhoneTranscript(true); onRefresh(); },
  });
  const smsScheduleMut = useMutation({
    mutationFn: () => jobLensApi.sendPhoneScheduleSms(c.id, { scheduled_at: new Date(smsScheduleAt).toISOString() }),
    onSuccess: () => { setSmsError(""); setSmsSent(true); onRefresh(); },
    onError: (err: any) => { setSmsError(err?.response?.data?.detail || "Failed to send SMS."); },
  });
  const statusMut = useMutation({
    mutationFn: (status: string) => jobLensApi.updateStatus(c.id, status),
    onSuccess: () => { onRefresh(); },
  });
  const { data: telephonyStatus } = useQuery({
    queryKey: ["telephony-status"], queryFn: interviewApi.telephonyStatus, staleTime: 60_000,
  });
  const telephonyConfigured = !!telephonyStatus?.configured;
  // Windows/Android Caller settings — same api-keys query SettingsPage
  // uses (shared cache under this queryKey), so enabling it there is
  // reflected here without any extra endpoint.
  const { data: savedApiKeys = [] } = useQuery({ queryKey: ["api-keys"], queryFn: authApi.listApiKeys, staleTime: 30_000 });
  const androidCallerKeys = savedApiKeys.filter((k: any) => k.service === "android_caller");
  const androidCaller = {
    enabled: androidCallerKeys.find((k: any) => k.key_name === "enabled")?.key_preview === "true",
    apiBase: androidCallerKeys.find((k: any) => k.key_name === "api_base")?.key_preview || "http://127.0.0.1:4000",
    mode: (androidCallerKeys.find((k: any) => k.key_name === "mode")?.key_preview === "direct" ? "direct" : "relay") as "direct" | "relay",
  };

  const phoneResultMut = useMutation({
    mutationFn: (payload?: { recommendation?: string; notes?: string }) =>
      jobLensApi.savePhoneResult(c.id, {
        recommendation: payload?.recommendation ?? phoneRecommendation,
        notes: payload?.notes ?? phoneNotes,
      }),
    onSuccess: () => { onRefresh(); },
  });

  // ── Video Interview stage — Decision & Comments (mode === "video") ────
  const [videoRecommendation, setVideoRecommendation] = useState(c.video_screening_recommendation || "Proceed");
  const [videoNotes, setVideoNotes] = useState(c.video_screening_notes || "");
  const videoResultMut = useMutation({
    mutationFn: (payload?: { recommendation?: string; notes?: string }) =>
      jobLensApi.saveVideoResult(c.id, {
        recommendation: payload?.recommendation ?? videoRecommendation,
        notes: payload?.notes ?? videoNotes,
      }),
    onSuccess: () => { onRefresh(); },
  });

  const genQuestions = async (regenerate = false) => {
    setGenLoading(true); setGenError("");
    try {
      const r = await jobLensApi.generateQuestions(sessionId, c.id, regenerate);
      setQuestions(r.questions || []);
      // Surfaced so "Regenerate keeps giving the same questions" is
      // recognisable as "AI generation is failing, here's why" instead
      // of looking like a silent no-op — see generate_questions()'s
      // docstring on the backend for the full story.
      setGenError(r.error || "");
    } finally {
      setGenLoading(false);
    }
  };

  const handleInterviewDone = async (emotions: any, videoBlob: Blob | null) => {
    // Always close the modal and refresh, even if a step below fails —
    // this used to run these calls with no outer try/catch, so if
    // saveInterviewResult ever threw (a network hiccup, a 500, etc.) the
    // whole function threw right there and setInterviewOpen(false)/
    // onRefresh() below it never ran: the modal was stuck open with the
    // recording already gone and no way out except reloading the page.
    // uploadVideo failing was ALSO silently swallowed with zero feedback,
    // so a failed upload looked identical to a successful one — no error,
    // just a missing video later with no clue why.
    let warning = "";
    try {
      await jobLensApi.saveInterviewResult(c.id, emotions);
    } catch (e: any) {
      warning = e?.response?.data?.detail || "Failed to save interview result.";
    }
    if (videoBlob) {
      try {
        await jobLensApi.uploadVideo(c.id, videoBlob);
      } catch (e: any) {
        warning = warning
          ? `${warning} Video upload also failed: ${e?.response?.data?.detail || e?.message || "unknown error"}.`
          : `Video upload failed (${e?.response?.data?.detail || e?.message || "unknown error"}) — the interview result was saved, but there's no recording to analyse.`;
      }
    }
    setInterviewOpen(false);
    onRefresh();
    if (warning) alert(warning);
  };

  const handleContactClick = async () => {
    setPreparingInvite(true);
    try {
      let tok = inviteToken;
      if (!tok) {
        const r = await jobLensApi.prepareInvite(c.id);
        tok = r.token;
        setInviteToken(tok);
      }
      setContactOpen(true);
    } finally {
      setPreparingInvite(false);
    }
  };

  // Anchored to the actual row (not just a one-time x/y snapshot), and
  // recomputed on scroll — see the effect below. Previously this stored
  // fixed viewport coordinates measured once at click time, which meant
  // scrolling the page afterward left the popover glued to that same
  // spot on screen while the row it belonged to scrolled away underneath
  // it, looking completely detached from what it was actually showing.
  const positionPopoverAbove = (kind: PopoverKind, anchor: HTMLElement) => {
    const cellRect = anchor.getBoundingClientRect();
    const headerBottom = theadRef.current?.getBoundingClientRect().bottom ?? 0;
    // Opens ON TOP of the row it was clicked from: anchored so its
    // bottom edge sits just above the row's top edge (translateY(-100%)
    // in the render below does the actual flip, since we don't know the
    // popover's own height in advance). Falls back to opening below when
    // there isn't room above — e.g. the row is right under the sticky
    // header already — so it's never rendered off-screen or under the
    // header either way.
    // AnchoredPopover caps itself at maxHeight 320 (see its own comment)
    // — that box has to actually fit somewhere in the viewport, not just
    // avoid the header. The old fallback clamped `y` to
    // `window.innerHeight - 60`, which put the popover's TOP that close
    // to the bottom of the screen and let its body (up to 320px tall)
    // run straight off the bottom edge — invisible, and with no way to
    // scroll it into view since it's position:fixed, not part of page
    // flow. Below, "opening below" is only chosen when the popover's
    // full height actually fits in the remaining space; otherwise it
    // opens above regardless of the row's position, and as a last
    // resort (a row that's both hard up against the header AND the
    // bottom of a short viewport) the whole thing is clamped inside the
    // viewport rather than letting either edge escape it.
    const POPOVER_MAX_HEIGHT = 320;
    const roomAbove = cellRect.top - headerBottom;
    const roomBelow = window.innerHeight - cellRect.bottom;
    const openAbove = roomAbove >= Math.min(POPOVER_MAX_HEIGHT, roomBelow) || roomBelow < 160;
    const y = openAbove
      ? Math.min(cellRect.top - 6, window.innerHeight - 8)
      : Math.max(
          headerBottom + 6,
          Math.min(cellRect.bottom + 6, window.innerHeight - POPOVER_MAX_HEIGHT - 8),
        );
    setPopover({ kind, x: cellRect.left, y, width: cellRect.width, anchor, openAbove });
  };

  const openPopover = (kind: PopoverKind) => (e: React.MouseEvent) => {
    const cell = (e.currentTarget as HTMLElement).closest("td");
    if (!cell) return;
    positionPopoverAbove(kind, cell);
  };

  // Keep the popover glued to its row while the page scrolls, instead of
  // sitting still in the viewport while the row moves out from under it.
  useEffect(() => {
    if (!popover) return;
    const reposition = () => positionPopoverAbove(popover.kind, popover.anchor);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popover?.kind, popover?.anchor]);

  const resumeSummary: { experience?: string[]; skills?: string[]; education?: string[]; achievements?: string[]; availability_work_rights?: string[] } = c.resume_summary || {};
  const resumeSummaryFlat: string[] = [
    ...(resumeSummary.experience || []),
    ...(resumeSummary.skills || []),
    ...(resumeSummary.education || []),
    ...(resumeSummary.achievements || []),
    ...(resumeSummary.availability_work_rights || []),
  ];

  return (
    <>
      <tr ref={rowRef} style={{ background: isFocused ? "rgba(139,92,246,.10)" : c.rejection_email_sent_at ? "rgba(239,68,68,.05)" : shortlisted ? "rgba(0,199,183,.05)" : undefined }}>
        {selectable && (
          <td style={{ textAlign: "center" }}>
            <input type="checkbox" checked={selected} onChange={onToggleSelect} />
          </td>
        )}
        <td style={{ fontWeight: 700, color: "var(--text-muted)", fontSize: 12 }}>#{rank}</td>

        {/* Candidate */}
        <td>
          <div style={{ fontWeight: 600 }}>{c.name}</div>
          {mode === "resume" && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.filename}</div>}
        </td>

        {mode === "resume" && <td style={{ fontSize: 12 }}>{c.email}</td>}

        {/* Phone — common to every stage */}
        <td style={{ fontSize: 12 }}>{c.phone}</td>

        {mode === "resume" && <td style={{ fontSize: 12 }}>{c.source_vendor_name || "—"}</td>}

        {/* Resume Summary — top experience bullet + skills preview, click for the full categorized breakdown */}
        {mode === "resume" && (
          <td style={{ fontSize: 11, minWidth: 200 }}>
            {resumeSummaryFlat.length > 0 ? (
              <>
                <ul style={{ margin: 0, paddingLeft: 14 }}>
                  {(resumeSummary.experience || []).slice(0, 1).map((s, i) => <li key={`e${i}`} style={{ marginBottom: 2 }}>{s}</li>)}
                  {(resumeSummary.skills || []).slice(0, 1).map((s, i) => <li key={`s${i}`} style={{ marginBottom: 2 }}>{s}</li>)}
                </ul>
                <button onClick={openPopover("resume")}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", paddingLeft: 14, fontSize: 10, textDecoration: "underline" }}>
                  View full summary
                </button>
              </>
            ) : (
              <span style={{ color: "var(--text-muted)" }}>
                {c.experience_years || "No resume summary available"}
              </span>
            )}
          </td>
        )}

        {/* ATS / Resume Screening Score — every stage carries this forward. Click to see the full score breakdown. */}
        <td onClick={c.strengths_breakdown?.scoreBreakdown ? openPopover("scoreBreakdown") : undefined}
          style={{ cursor: c.strengths_breakdown?.scoreBreakdown ? "pointer" : undefined }}
          title={c.strengths_breakdown?.scoreBreakdown ? "Click for full score breakdown" : undefined}>
          <div><ScoreCell score={c.ats_score} low={lowT} high={highT} /></div>
          <ProgressBar value={c.ats_score}
            color={c.ats_score >= highT ? "#10b981" : c.ats_score >= lowT ? "#f59e0b" : "#ef4444"} />
          {c.technical_score != null && (
            <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.5 }}>
              Tech {Math.round(c.technical_score)}%
              {c.non_technical_score != null && <> · Logistics {Math.round(c.non_technical_score)}%</>}
            </div>
          )}
        </td>

        {/* Key Strength — categorized by JD tier (Essential/Preferred) and skill type (Technical/Business). Click anywhere in the cell for the full strengths breakdown. */}
        {mode === "resume" && (
          <td style={{ fontSize: 10, minWidth: 170, color: "var(--teal-500)", cursor: (c.matched_skills || []).length > 0 ? "pointer" : undefined }}
            onClick={(c.matched_skills || []).length > 0 ? openPopover("matched") : undefined}
            title={(c.matched_skills || []).length > 0 ? "Click for full strengths breakdown" : undefined}>
            {(["Essential", "Preferred", "Technical", "Business"] as const).map(cat => matchedByCategory[cat].length > 0 && (
              <div key={cat} style={{ marginBottom: 3 }}>
                <span style={{ fontWeight: 700, fontSize: 9, textTransform: "uppercase" }}>{cat}: </span>
                <span>{matchedByCategory[cat].slice(0, 3).join(", ")}{matchedByCategory[cat].length > 3 ? "…" : ""}</span>
              </div>
            ))}
            {Object.values(matchedByCategory).every(v => v.length === 0) && (c.matched_skills || []).length === 0 && (
              <span style={{ color: "var(--text-muted)" }}>—</span>
            )}
            {(c.matched_skills || []).length > 0 && (
              <button onClick={openPopover("matched")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 9, textDecoration: "underline", padding: 0 }}>
                View all ({c.matched_skills.length})
              </button>
            )}
          </td>
        )}

        {/* Considerations — categorized by JD tier (Essential/Preferred/Optional) */}
        {mode === "resume" && (
          <td style={{ fontSize: 10, minWidth: 170, color: "var(--rose-500)" }}>
            {(["Essential", "Preferred", "Optional"] as const).map(cat => missingByCategory[cat].length > 0 && (
              <div key={cat} style={{ marginBottom: 3 }}>
                <span style={{ fontWeight: 700, fontSize: 9, textTransform: "uppercase" }}>{cat}: </span>
                <span>{missingByCategory[cat].slice(0, 3).join(", ")}{missingByCategory[cat].length > 3 ? "…" : ""}</span>
              </div>
            ))}
            {(c.missing_skills || []).length === 0 && <span style={{ color: "var(--text-muted)" }}>—</span>}
            {(c.missing_skills || []).length > 0 && (
              <button onClick={openPopover("missing")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 9, textDecoration: "underline", padding: 0 }}>
                View all ({c.missing_skills.length})
              </button>
            )}
          </td>
        )}

        {mode === "resume" && (
          <td onClick={(e) => e.stopPropagation()}>
            <select
              className="tiq-select"
              value={c.status}
              disabled={statusMut.isPending}
              onChange={(e) => statusMut.mutate(e.target.value)}
              style={{
                fontSize: 11, fontWeight: 700, padding: "3px 22px 3px 8px", borderRadius: 999, border: "none",
                color: c.status === "Qualified" ? "#0d9488" : c.status === "Review" ? "#b45309" : "#be123c",
                background: c.status === "Qualified" ? "rgba(13,148,136,.12)" : c.status === "Review" ? "rgba(245,158,11,.14)" : "rgba(244,63,94,.12)",
                cursor: statusMut.isPending ? "wait" : "pointer",
              }}
              title="Manual override — the AI's own score and breakdown are unaffected, only this label changes"
            >
              {CANDIDATE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {c.status === "Not Qualified" && c.hard_disqualified && c.disqualify_reason && (
              <div style={{ fontSize: 10, color: "#ef4444", marginTop: 4, maxWidth: 160, lineHeight: 1.4 }}>
                ({c.disqualify_reason})
              </div>
            )}
          </td>
        )}

        {/* Recommendation — composed deterministically in Python from the
            already-judged essential/good-to-have verdicts (see
            routers/joblens.py's _build_recommendation), never a fresh LLM
            narrative, so it can't claim a strength/gap those verdicts
            don't already contain. Shown on both Resume Screening and
            Screening Decision — every candidate applying to this same JD
            gets their own independently-computed text here. */}
        {(mode === "resume" || mode === "final") && (
          <td style={{ fontSize: 11.5, lineHeight: 1.5, color: "#334155", maxWidth: 320 }}>
            {c.screening_recommendation || <span style={{ color: "var(--text-muted)" }}>—</span>}
          </td>
        )}

        {/* Interview Questions — shared field, generated for either the phone call or the video round */}
        {(mode === "phone" || mode === "video") && (
          <td style={{ minWidth: 200 }}>
            <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" style={{ fontSize: 10, marginBottom: 4 }}
              onClick={() => genQuestions(true)} disabled={genLoading}
              title="Generated from both the Job Description and this candidate's own resume">
              <Sparkles size={10} /> {genLoading ? "Generating…" : questions.length ? "Regenerate" : "Generate"}
            </button>
            {questions.length > 0 ? (
              <>
                <ol style={{ margin: 0, paddingLeft: 14, fontSize: 11 }}>
                  {questions.slice(0, 2).map((q, i) => <li key={i} style={{ marginBottom: 2 }}>{q}</li>)}
                </ol>
                {questions.length > 2 && (
                  <button onClick={openPopover("questions")}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 10, textDecoration: "underline", padding: 0 }}>
                    View all ({questions.length})
                  </button>
                )}
              </>
            ) : (
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>No questions yet</div>
            )}
            {genError && (
              <div style={{ fontSize: 10, color: "#f59e0b", marginTop: 4, lineHeight: 1.4 }}>{genError}</div>
            )}
          </td>
        )}

        {/* Video Interview — start/re-run the webcam round, view the original
            resume alongside it, and see the emotion-analysis review once
            the recording's been processed, all in the one place the
            recruiter is actually working from during this stage. */}
        {mode === "video" && (
          <td style={{ minWidth: 190 }}>
            <button className="tiq-btn tiq-btn-primary tiq-btn-sm"
              onClick={() => { if (!questions.length) genQuestions(); setInterviewOpen(true); }}>
              <Video size={12} /> {c.video_status === "Completed" ? "Re-run" : "Start"}
            </button>
            <div style={{ marginTop: 6 }}><StatusBadge status={c.video_status} /></div>

            {c.has_resume_file && (
              <button type="button" onClick={() => openBlobInNewTab(`/api/joblens/candidates/${c.id}/resume-file`)}
                style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", fontSize: 10, color: "var(--text-muted)", marginTop: 6, display: "block" }}>
                📄 View original resume
              </button>
            )}
            {c.has_video && (
              <button type="button" onClick={() => setShowVideoPlayer(true)}
                style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", fontSize: 10, color: "var(--teal-500)", marginTop: 4, display: "block" }}>
                ▶ View recorded video
              </button>
            )}
            {/* Transcript is now saved as soon as transcription succeeds,
                independent of whether the LLM scoring step after it
                succeeds or fails — see _run_video_analysis — so this can
                be available even when analysis itself shows "Failed". */}
            {c.video_transcript && (
              <button type="button" onClick={openPopover("videoTranscript")}
                style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", fontSize: 10, color: "var(--teal-500)", marginTop: 4, display: "block" }}>
                📝 View transcript
              </button>
            )}

            {/* Only show the analysis spinner once there's actually a video
                to analyse — video_analysis_status defaults to "Pending"
                for every candidate from the moment they're created, long
                before anyone's done a video round at all. Without the
                has_video check here, this showed "Queued…" permanently
                for candidates who'd never even started their video
                interview, which is what looked like it was "stuck". */}
            {c.has_video && (c.video_analysis_status === "Pending" || c.video_analysis_status === "Processing") && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                <span className="tiq-spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
                {c.video_analysis_status === "Processing" ? "Analysing…" : "Queued…"}
              </div>
            )}
            {c.has_video && c.video_analysis_status === "Failed" && (
              <div style={{ fontSize: 11, color: "var(--rose-500)", marginTop: 6 }}>
                Analysis failed{c.video_analysis?.error ? ` — ${c.video_analysis.error}` : ""}
              </div>
            )}
            {/* Reanalyze — previously defined (reanalyzeMut) but never
                actually wired to a button anywhere, so there was no way
                to retry a Failed/stuck-Pending analysis, or re-run a
                Completed one (e.g. after fixing a Groq key) without
                re-recording the whole interview. Visible for ANY status
                except while one is actively Processing, to avoid
                double-triggering the same in-flight run. */}
            {c.has_video && c.video_analysis_status !== "Processing" && (
              <button type="button" onClick={() => reanalyzeMut.mutate()} disabled={reanalyzeMut.isPending}
                style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", fontSize: 10, color: "var(--text-muted)", marginTop: 4, display: "block" }}>
                <RefreshCw size={10} style={{ display: "inline", marginRight: 3 }} />
                {reanalyzeMut.isPending ? "Queuing…" : c.video_analysis_status === "Completed" ? "Re-run analysis" : "Retry analysis"}
              </button>
            )}
            {reanalyzeMut.isError && (
              <div style={{ fontSize: 10, color: "var(--rose-500)", marginTop: 2 }}>
                {(reanalyzeMut.error as any)?.response?.data?.detail || "Failed to queue analysis."}
              </div>
            )}

            {(c.dominant_emotion || c.emotion_happy != null) && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>Video Review</div>
                <div style={{ fontSize: 11, lineHeight: 1.7 }}>
                  <div>😊 Happy: {Math.round(c.emotion_happy ?? 0)}%</div>
                  <div>😐 Neutral: {Math.round(c.emotion_neutral ?? 0)}%</div>
                  <div>😢 Sad: {Math.round(c.emotion_sad ?? 0)}%</div>
                  <div>😡 Angry: {Math.round(c.emotion_angry ?? 0)}%</div>
                </div>
                <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>Dominant: {c.dominant_emotion || "—"}</div>
              </div>
            )}
            {c.video_analysis_status === "Completed" && c.video_analysis && !c.video_analysis.error && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>AI Interview Scores</div>
                <div style={{ fontSize: 11, lineHeight: 1.7 }}>
                  <div>Overall: <strong>{c.video_analysis.overall_score ?? "—"}</strong></div>
                  <div>Communication: <strong>{c.video_analysis.communication_score ?? "—"}</strong></div>
                  <div>Relevance: <strong>{c.video_analysis.relevance_score ?? "—"}</strong></div>
                  <div>Confidence: <strong>{c.video_analysis.confidence_score ?? "—"}</strong></div>
                </div>
              </div>
            )}
            {c.video_analysis_status === "Completed" && c.video_analysis && (
              <button onClick={openPopover("videoAnalysis")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 10, textDecoration: "underline", padding: 0, marginTop: 6, display: "block" }}>
                View full AI analysis ({c.video_analysis.overall_score ?? "—"})
              </button>
            )}
          </td>
        )}

        {/* Telephonic Screening — carried into Final Decision */}
        {mode === "final" && (
          <td>
            {c.phone_screening_recommendation ? (
              <RecommendationBadge value={c.phone_screening_recommendation} />
            ) : <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>}
          </td>
        )}

        {/* Video Interview score — carried into Final Decision */}
        {mode === "final" && (
          <td>
            {c.video_analysis?.overall_score != null ? (
              <div style={{ fontWeight: 700, color: "var(--violet-500)" }}>{c.video_analysis.overall_score}</div>
            ) : <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>}
            {c.video_screening_recommendation && (
              <div style={{ marginTop: 4 }}><RecommendationBadge value={c.video_screening_recommendation} /></div>
            )}
          </td>
        )}

        {/* Next Steps — jumps straight into the next stage for this exact
            candidate (auto-selects this session and scrolls to them
            there), instead of leaving the recruiter to navigate over and
            find them again manually. What's offered depends on which
            stage this row is already on: Resume Screening can jump
            anywhere (gated on Qualified/shortlisted, since nothing's
            confirmed yet at that point); Phone/Video Interview are
            already past that gate just by being visible on their own
            page, so their next steps are offered unconditionally. */}
        {/* Next Steps — Resume Screening offers all three: Phone Interview,
            Video Interview, Screening Decision. Icons are the same lucide
            icons already used for these stages elsewhere (sidebar,
            column headers) — no extra emoji glyph layered on top of them. */}
        {mode === "resume" && (
          <td style={{ minWidth: 200 }}>
            {(shortlisted || c.status === "Qualified") ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ width: "100%", justifyContent: "flex-start", textAlign: "left" }}
                        onClick={() => navigate(`/app/phoneinterview?session=${sessionId}&candidate=${c.id}`)}>
                  <Phone size={14} strokeWidth={2.5} color={STAGE_ICON_COLOR.phone} /> Phone Interview
                </button>
                <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ width: "100%", justifyContent: "flex-start", textAlign: "left" }}
                        onClick={() => navigate(`/app/videointerview?session=${sessionId}&candidate=${c.id}`)}>
                  <Video size={14} strokeWidth={2.5} color={STAGE_ICON_COLOR.video} /> Video Interview
                </button>
                <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ width: "100%", justifyContent: "flex-start", textAlign: "left" }}
                        onClick={() => navigate(`/app/finaldecision?session=${sessionId}&candidate=${c.id}`)}>
                  <CheckCircle size={14} strokeWidth={2.5} color={STAGE_ICON_COLOR.decision} /> Screening Decision
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Shortlist or mark Qualified first</div>
            )}
          </td>
        )}

        {/* Phone Screening — consolidated status + contacted-tracking +
            outcome + notes, all in one place, matching how a recruiter
            actually works through a call: confirm you reached them, then
            record what came of it. phoneContactMut existed before this but
            had no UI trigger anywhere, so a candidate's status could never
            move off "Not Started" — this checkbox is that missing trigger. */}
        {mode === "phone" && (
          <td style={{ minWidth: 160 }}>
            {/* "Send Calendly Link" now sits above the Phone Interview
                trigger, as its own direct action — it used to be tucked
                inside the popup below, one extra click away from what's
                usually the very first thing a recruiter does for a new
                candidate. Opens CalendlyModal (compose UI) instead of
                firing an email immediately with a fixed template. */}
            <button type="button" onClick={() => setCalendlyModalOpen(true)}
              className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ width: "100%", justifyContent: "flex-start", marginBottom: 6 }}
              disabled={!c.email} title={!c.email ? "No candidate email on file" : ""}>
              <CalendarClock size={13} strokeWidth={2.5} color={STAGE_ICON_COLOR.phone} /> Send Calendly Link
            </button>
            {/* Clicking opens the Phone Screening popup — Call, Text Call
                Time, "reached" checkbox, recommendation and notes all
                live there. Button label is fixed ("Phone Interview",
                matching the Video Interview column's fixed "Start"/
                "Re-run" label) instead of doubling as the status text —
                the status has its own badge below now, same as Video
                Interview's StatusBadge under its Start button. */}
            <button type="button" onClick={() => setPhoneScreeningPopupOpen(true)}
              className="tiq-btn tiq-btn-primary tiq-btn-sm" style={{ width: "100%", justifyContent: "flex-start" }}>
              <Phone size={13} strokeWidth={2.5} /> Phone Interview
            </button>
            <div style={{ marginTop: 6 }}><StatusBadge status={c.phone_screening_status || "Not Started"} /></div>
            {/* Direct, always-visible transcript access — same placement
                pattern as Video Interview's "▶ View recorded video" link
                right in the cell, rather than only reachable inside the
                Phone Interview popup. Opens the popup pre-scrolled to
                the transcript toggle would be nicer, but simplest and
                least fragile is just opening the popup itself, where the
                fetch/view controls already live. */}
            {c.phone_transcript && (
              <button type="button" onClick={() => setPhoneScreeningPopupOpen(true)}
                style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", fontSize: 10, color: "var(--teal-500)", marginTop: 4, display: "block" }}>
                📝 View transcript
              </button>
            )}
            {/* Quick-glance summary so recruiters don't have to open the
                popup just to see what's already happened. */}
            <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>
              {calendlySent && <div style={{ color: "#10b981" }}>Calendly link sent</div>}
              {c.phone_call_status && <div>Last call: {c.phone_call_status}</div>}
              {c.phone_interview_scheduled_at && <div>Scheduled: {new Date(c.phone_interview_scheduled_at).toLocaleString()}</div>}
              {c.phone_screening_at && <div>Updated {new Date(c.phone_screening_at).toLocaleDateString()}</div>}
            </div>
            {calendlyModalOpen && (
              <CalendlyModal
                candidate={c}
                onClose={() => setCalendlyModalOpen(false)}
                onSent={() => { setCalendlySent(true); onRefresh(); }}
              />
            )}
          </td>
        )}

        {/* Next Steps — Phone Interview offers Video Interview and
            Screening Decision only (not a link back to itself). Already
            past the Qualified/shortlisted gate just by being on this
            page, so offered unconditionally. */}
        {mode === "phone" && (
          <td style={{ minWidth: 200 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ width: "100%", justifyContent: "flex-start", textAlign: "left" }}
                      onClick={() => navigate(`/app/videointerview?session=${sessionId}&candidate=${c.id}`)}>
                <Video size={14} strokeWidth={2.5} color={STAGE_ICON_COLOR.video} /> Video Interview
              </button>
              <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ width: "100%", justifyContent: "flex-start", textAlign: "left" }}
                      onClick={() => navigate(`/app/finaldecision?session=${sessionId}&candidate=${c.id}`)}>
                <CheckCircle size={14} strokeWidth={2.5} color={STAGE_ICON_COLOR.decision} /> Screening Decision
              </button>
            </div>
          </td>
        )}

        {/* Decision — Video Interview's recruiter-logged outcome */}
        {mode === "video" && (
          <td style={{ minWidth: 150 }}>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {["Proceed", "Hold", "Reject"].map((r) => (
                <button key={r} type="button"
                  onClick={() => setVideoRecommendation(r)}
                  style={{
                    padding: "4px 9px", borderRadius: 999, fontSize: 10, fontWeight: 700, cursor: "pointer",
                    border: videoRecommendation === r ? "1.5px solid var(--violet-500)" : "1px solid var(--border)",
                    color: videoRecommendation === r ? "var(--violet-500)" : "var(--text-muted)",
                    background: videoRecommendation === r ? "rgba(139,92,246,.08)" : "transparent",
                  }}>
                  {r}
                </button>
              ))}
            </div>
            {videoResultMut.isPending && (
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>Saving…</div>
            )}
            {c.video_screening_at && (
              <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 4 }}>
                {new Date(c.video_screening_at).toLocaleDateString()}
              </div>
            )}
          </td>
        )}

        {/* Comments — Video Interview's recruiter-logged notes */}
        {mode === "video" && (
          <td style={{ minWidth: 180 }}>
            <textarea className="tiq-input" rows={2} style={{ fontSize: 11 }}
              placeholder="Comments…" value={videoNotes} onChange={(e) => setVideoNotes(e.target.value)} />
            <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ marginTop: 4, fontSize: 10 }}
              onClick={() => videoResultMut.mutate({})} disabled={videoResultMut.isPending}>
              {videoResultMut.isPending ? "Saving…" : "Save"}
            </button>
          </td>
        )}

        {/* Candidate Contact — sends the candidate their video-interview
            invite as a real email, composed here in ContactModal and
            delivered server-side over the recruiter's own saved SMTP
            config (Settings > API Keys > SMTP) via the backend
            /send-invite endpoint. No local mail client involved. */}
        {mode === "video" && (
          <td style={{ minWidth: 170 }}>
            <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={handleContactClick} disabled={preparingInvite}>
              <Mail size={12} /> {preparingInvite ? "Preparing…" : "Send Interview Invite"}
            </button>
            {contacted && (
              <div style={{ fontSize: 10.5, color: "#10b981", marginTop: 4 }}>✓ Invite sent</div>
            )}
          </td>
        )}

        {/* Next Steps — Video Interview offers Screening Decision only;
            nothing further after it in the pipeline. */}
        {mode === "video" && (
          <td style={{ minWidth: 200 }}>
            <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ width: "100%", justifyContent: "flex-start", textAlign: "left" }}
                    onClick={() => navigate(`/app/finaldecision?session=${sessionId}&candidate=${c.id}`)}>
              <CheckCircle size={14} strokeWidth={2.5} color={STAGE_ICON_COLOR.decision} /> Screening Decision
            </button>
          </td>
        )}
        {/* Details — full score breakdown, in a popup */}
        {mode === "resume" && (
          <td>
            <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setShowDetailsModal(true)}>
              View
            </button>
          </td>
        )}

        {/* Shortlist — the final hire/no-hire call, made here after all three stages */}
        {mode === "final" && (
          <td style={{ textAlign: "center" }}>
            <input type="checkbox" checked={shortlisted} onChange={() => shortlistMut.mutate()} />
          </td>
        )}
        {/* Rejection Email — tracks the Screening Decision bulk "Send
            Rejection Email" action (see the toolbar button + popup in
            JobLensWorkspace below); nothing to click here, just status. */}
        {mode === "final" && (
          <td style={{ fontSize: 11.5 }}>
            {c.rejection_email_sent_at ? (
              <span style={{ color: "#ef4444", fontWeight: 700 }}>
                Sent Rejection Letter<br />
                <span style={{ fontWeight: 400, color: "var(--text-muted)", fontSize: 10.5 }}>
                  {new Date(c.rejection_email_sent_at).toLocaleDateString()}
                </span>
              </span>
            ) : (
              <span style={{ color: "var(--text-muted)" }}>Not sent</span>
            )}
          </td>
        )}
      </tr>

      {phoneScreeningPopupOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1150, display: "flex", alignItems: "center", justifyContent: "center" }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setPhoneScreeningPopupOpen(false); }}>
          <div style={{ background: "#ffffff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 420, width: "92%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                <Phone size={16} style={{ display: "inline", marginRight: 8, color: STAGE_ICON_COLOR.phone }} />
                Phone Screening — {c.name}
              </div>
              <button onClick={() => setPhoneScreeningPopupOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#6b7280" }}><X size={18} /></button>
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 12, color: c.phone_screening_status === "Completed" ? "#10b981" : "var(--text-muted)" }}>
              Status: {c.phone_screening_status || "Not Started"}
            </div>

            {/* Send Calendly Link moved out to its own button directly in
                the table cell (above Phone Interview) — see the compose
                modal (CalendlyModal) it now opens instead of living here. */}
            {calendlySent && (
              <div style={{ fontSize: 9.5, color: "#10b981", marginBottom: 6 }}>Calendly link sent</div>
            )}

            {/* Call — click-to-call popup, bridges the recruiter's own
                configured caller number (Settings > API Keys > Telephony,
                or a paired Windows/Android device — see Settings > Phone
                Connection) to this candidate's phone. */}
            <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ width: "100%", justifyContent: "flex-start", textAlign: "left", marginBottom: 6, fontSize: 11 }}
              onClick={() => setShowCallPopup(true)}
              disabled={!c.phone}
              title={!c.phone ? "No candidate phone number on file" : telephonyConfigured ? "" : "Set up Telephony in Settings first"}>
              <PhoneCall size={13} strokeWidth={2.5} color={STAGE_ICON_COLOR.phone} /> Call Candidate
            </button>
            {c.phone_call_status && (
              <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginBottom: 6 }}>
                Last call: {c.phone_call_status}{c.phone_called_at ? ` · ${new Date(c.phone_called_at).toLocaleString()}` : ""}
              </div>
            )}

            {/* Call transcript — Twilio calls only (the click-to-call
                bridge above now records the conversation; see
                utils/telephony.place_click_to_call). A call placed via
                the Windows/Android Caller instead dials on the
                recruiter's own phone's native SIM — a real cellular call
                TalentIQ has no access to the audio of, so there's
                nothing to transcribe for that path. */}
            {c.phone_call_status && (
              <>
                <button type="button" onClick={() => phoneTranscriptMut.mutate()} disabled={phoneTranscriptMut.isPending}
                  style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", fontSize: 10.5, color: "var(--teal-500)", marginBottom: 4, display: "block" }}>
                  🎙 {phoneTranscriptMut.isPending ? "Fetching…" : c.phone_transcript ? "Refresh call transcript" : "Fetch Call Transcript"}
                </button>
                {phoneTranscriptMut.isError && (
                  <div style={{ fontSize: 9.5, color: "var(--rose-500)", marginBottom: 6 }}>
                    {(phoneTranscriptMut.error as any)?.response?.data?.detail || "Failed to fetch transcript."}
                  </div>
                )}
                {c.phone_transcript && (
                  <>
                    <button type="button" onClick={() => setShowPhoneTranscript(t => !t)}
                      style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", fontSize: 10.5, color: "var(--teal-500)", marginBottom: 6, display: "block" }}>
                      📝 {showPhoneTranscript ? "Hide transcript ▲" : "View transcript ▼"}
                    </button>
                    {showPhoneTranscript && (
                      <div style={{ padding: 10, background: "#f8fafc", borderRadius: 8, fontSize: 11, lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: 220, overflowY: "auto", marginBottom: 8, color: "#111827" }}>
                        {c.phone_transcript}
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {/* Text-schedule — the interviewer picks a time and TalentIQ
                texts the candidate, setting that same time on the
                Interview Scheduling row (calendar + table) — the
                alternative to letting the candidate self-schedule via
                Calendly above. */}
            <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
              <input type="datetime-local" className="tiq-input" style={{ fontSize: 11, padding: "4px 6px", flex: 1 }}
                value={smsScheduleAt} onChange={e => { setSmsScheduleAt(e.target.value); setSmsSent(false); setSmsError(""); }} />
            </div>
            <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ width: "100%", justifyContent: "flex-start", textAlign: "left", marginBottom: 6, fontSize: 11 }}
              onClick={() => { setSmsError(""); setSmsSent(false); smsScheduleMut.mutate(); }}
              disabled={!c.phone || !smsScheduleAt || smsScheduleMut.isPending}>
              <MessageSquare size={13} strokeWidth={2.5} color={STAGE_ICON_COLOR.phone} />
              {smsScheduleMut.isPending ? "Sending…" : "Text Call Time"}
            </button>
            {smsSent && <div style={{ fontSize: 9.5, color: "#10b981", marginBottom: 6 }}>Text sent — time saved to schedule</div>}
            {smsError && <div style={{ fontSize: 9.5, color: "#ef4444", marginBottom: 6 }}>{smsError}</div>}
            {c.phone_interview_scheduled_at && (
              <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginBottom: 6 }}>
                Scheduled: {new Date(c.phone_interview_scheduled_at).toLocaleString()}
              </div>
            )}
            {!telephonyConfigured && (
              <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginBottom: 6 }}>
                Set up Telephony under Settings → API Keys (or pair a device under Settings → Phone Connection) to enable calling/texting.
              </div>
            )}

            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginBottom: 8, cursor: (phoneContactedOptimistic ?? (!!c.phone_screening_status && c.phone_screening_status !== "Not Started")) ? "default" : "pointer" }}>
              <input type="checkbox"
                checked={phoneContactedOptimistic ?? (!!c.phone_screening_status && c.phone_screening_status !== "Not Started")}
                disabled={phoneContactMut.isPending || (phoneContactedOptimistic ?? (!!c.phone_screening_status && c.phone_screening_status !== "Not Started"))}
                onChange={() => { setPhoneContactedOptimistic(true); phoneContactMut.mutate(); }} />
              Candidate reached by phone
            </label>
            {phoneContactMut.isError && (
              <div style={{ fontSize: 9.5, color: "var(--rose-500)", marginBottom: 6 }}>
                {(phoneContactMut.error as any)?.response?.data?.detail || "Failed to mark as contacted — try again."}
              </div>
            )}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
              {["Proceed", "Hold", "Reject"].map((r) => (
                <button key={r} type="button"
                  onClick={() => setPhoneRecommendation(r)}
                  style={{
                    padding: "4px 9px", borderRadius: 999, fontSize: 10, fontWeight: 700, cursor: "pointer",
                    border: phoneRecommendation === r ? "1.5px solid var(--violet-500)" : "1px solid var(--border)",
                    color: phoneRecommendation === r ? "var(--violet-500)" : "var(--text-muted)",
                    background: phoneRecommendation === r ? "rgba(139,92,246,.08)" : "transparent",
                  }}>
                  {r}
                </button>
              ))}
            </div>
            <textarea className="tiq-input" rows={2} style={{ fontSize: 11, width: "100%" }}
              placeholder="Notes…" value={phoneNotes} onChange={(e) => setPhoneNotes(e.target.value)} />
            <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ marginTop: 4, fontSize: 11 }}
              onClick={() => phoneResultMut.mutate({})} disabled={phoneResultMut.isPending}>
              {phoneResultMut.isPending ? "Saving…" : "Save"}
            </button>
            {c.phone_screening_at && (
              <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 4 }}>
                {new Date(c.phone_screening_at).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>
      )}

      {showCallPopup && (
        <CallCandidatePopup
          candidateName={c.name}
          candidatePhone={c.phone}
          callerNumber={telephonyStatus?.caller_number || ""}
          telephonyConfigured={telephonyConfigured}
          callMut={callMut}
          onClose={() => setShowCallPopup(false)}
          androidCaller={androidCaller}
        />
      )}

      {showDetailsModal && (
        <ScoreDetailsModal
          c={c}
          shortlisted={shortlisted}
          onToggleShortlist={() => shortlistMut.mutate()}
          onClose={() => setShowDetailsModal(false)}
        />
      )}

      {showVideoPlayer && (
        <VideoPlayerModal
          candidateId={c.id}
          candidateName={c.name}
          onClose={() => setShowVideoPlayer(false)}
        />
      )}


      {interviewOpen && questions.length > 0 && (
        <VideoInterviewModal
          candidate={c}
          questions={questions}
          sessionId={sessionId}
          onClose={() => setInterviewOpen(false)}
          onDone={handleInterviewDone}
        />
      )}

      {contactOpen && inviteToken && (
        <ContactModal
          candidate={c}
          token={inviteToken}
          onClose={() => setContactOpen(false)}
          onSent={() => setContacted(true)}
        />
      )}

      {popover?.kind === "resume" && (
        <AnchoredPopover x={popover.x} y={popover.y} width={Math.max(popover.width, 320)} openAbove={popover.openAbove} onClose={() => setPopover(null)}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10 }}>Full Resume Summary</div>
          {([
            ["Experience", resumeSummary.experience, "#f59e0b"],
            ["Skills", resumeSummary.skills, "#3b82f6"],
            ["Education", resumeSummary.education, "#06b6d4"],
            ["Achievements", resumeSummary.achievements, "#10b981"],
            ["Availability & Work Rights", resumeSummary.availability_work_rights, "#8b5cf6"],
          ] as const).map(([label, items, color]) => items && items.length > 0 && (
            <div key={label} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color, marginBottom: 4 }}>{label}</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, lineHeight: 1.6 }}>
                {items.map((s, i) => <li key={i} style={{ marginBottom: 3 }}>{s}</li>)}
              </ul>
            </div>
          ))}
        </AnchoredPopover>
      )}

      {popover?.kind === "matched" && (
        <AnchoredPopover x={popover.x} y={popover.y} width={Math.max(popover.width, 300)} openAbove={popover.openAbove} onClose={() => setPopover(null)}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10 }}>All Key Strengths</div>
          {(["Essential", "Preferred", "Technical", "Business"] as const).map(cat => matchedByCategory[cat].length > 0 && (
            <div key={cat} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>{cat}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {matchedByCategory[cat].map((s: string) => (
                  <span key={s} style={{ background: "#0d9488", color: "#fff", fontSize: 10, padding: "3px 8px", borderRadius: 999 }}>{s}</span>
                ))}
              </div>
            </div>
          ))}
        </AnchoredPopover>
      )}

      {popover?.kind === "missing" && (
        <AnchoredPopover x={popover.x} y={popover.y} width={Math.max(popover.width, 300)} openAbove={popover.openAbove} onClose={() => setPopover(null)}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10 }}>All Considerations</div>
          {(["Essential", "Preferred", "Optional"] as const).map(cat => missingByCategory[cat].length > 0 && (
            <div key={cat} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>{cat}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {missingByCategory[cat].map((s: string) => (
                  <span key={s} style={{ background: "#e11d48", color: "#fff", fontSize: 10, padding: "3px 8px", borderRadius: 999 }}>{s}</span>
                ))}
              </div>
            </div>
          ))}
        </AnchoredPopover>
      )}

      {popover?.kind === "scoreBreakdown" && c.strengths_breakdown?.scoreBreakdown && (
        <AnchoredPopover x={popover.x} y={popover.y} width={Math.max(popover.width, 360)} openAbove={popover.openAbove} onClose={() => setPopover(null)}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10 }}>Full Score Breakdown</div>
          <ScoreBreakdownGrid breakdown={c.strengths_breakdown.scoreBreakdown} />
        </AnchoredPopover>
      )}

      {popover?.kind === "questions" && (
        <AnchoredPopover x={popover.x} y={popover.y} width={Math.max(popover.width, 320)} openAbove={popover.openAbove} onClose={() => setPopover(null)}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10 }}>
            {mode === "video" ? "All Video Interview Questions" : "All Interview Questions"}
          </div>
          <ol style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.6 }}>
            {questions.map((q, i) => <li key={i} style={{ marginBottom: 6 }}>{q}</li>)}
          </ol>
        </AnchoredPopover>
      )}

      {popover?.kind === "videoAnalysis" && c.video_analysis && (
        <AnchoredPopover x={popover.x} y={popover.y} width={Math.max(popover.width, 340)} openAbove={popover.openAbove} onClose={() => setPopover(null)}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10 }}>AI Video Interview Analysis</div>
          <div style={{ display: "flex", gap: 14, marginBottom: 10, flexWrap: "wrap" }}>
            {[
              ["Overall", c.video_analysis.overall_score, "#8b5cf6"],
              ["Communication", c.video_analysis.communication_score, "#0d9488"],
              ["Relevance", c.video_analysis.relevance_score, "#0d9488"],
              ["Confidence", c.video_analysis.confidence_score, "#0d9488"],
            ].map(([label, val, color]: any) => (
              <div key={label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 800, color }}>{val ?? "—"}</div>
                <div style={{ fontSize: 9.5, color: "#6b7280" }}>{label}</div>
              </div>
            ))}
          </div>
          {c.video_analysis.summary && (
            <p style={{ fontSize: 11.5, color: "#374151", marginBottom: 10, lineHeight: 1.6 }}>{c.video_analysis.summary}</p>
          )}
          {c.video_analysis.auto_decision && (
            <div style={{ fontSize: 11, marginBottom: 10, padding: "8px 10px", borderRadius: 8, background: "#f8fafc", color: "#374151" }}>
              <Gavel size={11} style={{ display: "inline", marginRight: 5, verticalAlign: -1 }} />
              Auto-decided <strong>{c.video_analysis.auto_decision}</strong> from a weighted score of{" "}
              <strong>{c.video_analysis.auto_decision_score}</strong> (Settings → Adjust Auto-Decision) — change it
              manually below if you disagree.
            </div>
          )}
          {c.video_analysis.strengths?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#0d9488", marginBottom: 4 }}>STRENGTHS</div>
              <ul style={{ margin: 0, paddingLeft: 14, fontSize: 11.5 }}>
                {c.video_analysis.strengths.map((s: string, i: number) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {c.video_analysis.concerns?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#e11d48", marginBottom: 4 }}>CONCERNS</div>
              <ul style={{ margin: 0, paddingLeft: 14, fontSize: 11.5 }}>
                {c.video_analysis.concerns.map((s: string, i: number) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {c.video_analysis.qa_pairs?.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#374151", marginBottom: 6 }}>QUESTION-BY-QUESTION</div>
              {/* The recording is one continuous file with no built-in
                  boundaries between questions — this breakdown is the
                  LLM's best-effort alignment of the transcript to each
                  question actually asked (see _analyze_transcript's
                  prompt), not a hard timestamp split. An empty answer
                  means it looks like that question went unanswered
                  (skipped, cut off, inaudible), not that something broke. */}
              {c.video_analysis.qa_pairs.map((qa: { question: string; answer_transcript: string }, i: number) => (
                <div key={i} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: i < c.video_analysis.qa_pairs.length - 1 ? "1px solid #e5e7eb" : "none" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#111827", marginBottom: 3 }}>Q{i + 1}: {qa.question}</div>
                  <div style={{ fontSize: 11, color: qa.answer_transcript ? "#374151" : "#9ca3af", lineHeight: 1.5 }}>
                    {qa.answer_transcript || "(no answer detected for this question)"}
                  </div>
                </div>
              ))}
            </div>
          )}
          {c.video_transcript && (
            <>
              <button type="button" onClick={() => setShowTranscript(t => !t)}
                style={{ marginTop: 4, background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 11, color: "#0d9488" }}>
                {showTranscript ? "Hide full transcript ▲" : "View full transcript ▼"}
              </button>
              {showTranscript && (
                <div style={{ marginTop: 8, padding: 10, background: "#f8fafc", borderRadius: 8, fontSize: 11.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                  {c.video_transcript}
                </div>
              )}
            </>
          )}
        </AnchoredPopover>
      )}

      {/* Standalone transcript popover — reachable directly via "View
          transcript" in the cell, independent of whether AI analysis
          (scoring) ever completed. See _run_video_analysis: the
          transcript is now saved the moment transcription succeeds,
          even if the LLM scoring step after it fails. */}
      {popover?.kind === "videoTranscript" && c.video_transcript && (
        <AnchoredPopover x={popover.x} y={popover.y} width={Math.max(popover.width, 340)} openAbove={popover.openAbove} onClose={() => setPopover(null)}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10 }}>Interview Transcript</div>
          <div style={{ padding: 10, background: "#f8fafc", borderRadius: 8, fontSize: 11.5, lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: 360, overflowY: "auto" }}>
            {c.video_transcript}
          </div>
        </AnchoredPopover>
      )}
    </>
  );
}

// ─── MAIN PAGE ─────────────────────────────────────────────────────────────
// Raw, sortable/filterable value behind each column of the main
// candidate table, keyed the same as colWidths above — used for the
// header dropdown filters, the global search box, and column sorting.
// This is deliberately separate from how CandidateRow actually renders
// each cell (badges, buttons, progress bars…): filtering/sorting always
// compares the underlying data, never the JSX.
// Converts a plain-text email draft (blank line = new paragraph) into
// HTML — used only right before sending/previewing, so the "Send
// Rejection Email" composer can be a normal-looking text editor instead
// of exposing raw markup for someone to accidentally mangle.
function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${esc(para).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

const CANDIDATE_TABLE_COLS: Record<string, "text" | "number"> = {
  candidate: "text", email: "text", phone: "text", vendor: "text", resumeSummary: "text",
  atsScore: "number", keyStrength: "text", considerations: "text", status: "text",
  interviewQuestions: "text", videoInterview: "text", phoneScreeningDecision: "text",
  videoInterviewScore: "number", phoneScreening: "text", decision: "text", comments: "text",
  candidateContact: "text", shortlist: "text", rejectionEmail: "text", recommendation: "text",
};

function getCandidateColValue(c: any, key: string): string | number | null {
  switch (key) {
    case "candidate": return c.name || "";
    case "email": return c.email || "";
    case "phone": return c.phone || "";
    case "vendor": return c.source_vendor_name || "";
    case "resumeSummary": {
      const rs = c.resume_summary || {};
      return [...(rs.experience || []), ...(rs.skills || []), ...(rs.education || []), ...(rs.achievements || []), ...(rs.availability_work_rights || [])].join(", ");
    }
    case "atsScore": return c.ats_score ?? null;
    case "keyStrength": return (c.matched_skills || []).join(", ");
    case "considerations": return (c.missing_skills || []).join(", ");
    case "status": return c.status || "";
    case "interviewQuestions": return (c.interview_questions || []).join(" | ");
    case "videoInterview": return c.video_status || "";
    case "phoneScreeningDecision": return c.phone_screening_recommendation || "";
    case "videoInterviewScore": return c.video_analysis?.overall_score ?? null;
    case "phoneScreening": return c.phone_screening_status || "";
    case "decision": return c.video_screening_recommendation || "";
    case "comments": return c.video_screening_notes || "";
    case "candidateContact": return c.contacted ? "Sent" : "Not Sent";
    case "shortlist": return c.shortlisted ? "Yes" : "No";
    case "rejectionEmail": return c.rejection_email_sent_at ? "Sent" : "Not Sent";
    case "recommendation": return c.screening_recommendation || "";
    default: return null;
  }
}

export default function JobLensWorkspace({ mode = "resume", embedded = false }: { mode?: "resume" | "phone" | "video" | "final"; embedded?: boolean }) {
    const { user } = useAuth();
    const isAdmin = user?.role === "admin";
    const qc = useQueryClient();
  const [jdText, setJdText] = useState("");
  const [pasteTextOpen, setPasteTextOpen] = useState(false);
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [cvFiles, setCvFiles] = useState<FileList | null>(null);

  // New Analysis: optional sourcing from Requisitions + Vendor Management,
  // additive to the original paste/upload flow (which stays default/unchanged).
  const [jdSource, setJdSource] = useState<"upload" | "requisition">("upload");
  const [selectedRequisitionId, setSelectedRequisitionId] = useState<number | "">("");
  const [cvSource, setCvSource] = useState<"upload" | "vendor">("upload");
  const [selectedApplicationIds, setSelectedApplicationIds] = useState<number[]>([]);

  const { data: requisitionOptions = [] } = useQuery({
    queryKey: ["joblens-requisition-options"],
    queryFn: jobLensApi.requisitionOptions,
    enabled: jdSource === "requisition",
  });
  const { data: requisitionCandidateOptions = [] } = useQuery({
    queryKey: ["joblens-requisition-candidates", selectedRequisitionId],
    queryFn: () => jobLensApi.requisitionCandidates(selectedRequisitionId as number),
    enabled: cvSource === "vendor" && !!selectedRequisitionId,
  });
  const [lowT, setLowT] = useState(40);
  const [highT, setHighT] = useState(70);
  // ── Dual-track scoring: dynamic weights + logistics constraints ──────
  const [clWeights, setClWeights] = useState<ScoringWeights>(DEFAULT_SCORING_WEIGHTS);
  const [clDisqualifiers, setClDisqualifiers] = useState<ScoringDisqualifiers>(DEFAULT_DISQUALIFIERS);
  const [salaryMin, setSalaryMin] = useState(0);
  const [salaryMax, setSalaryMax] = useState(0);
  const [maxNotice, setMaxNotice] = useState(0);
  const [remoteAllowed, setRemoteAllowed] = useState(false);
  const [showReweightPanel, setShowReweightPanel] = useState(false);
  const reweightMut = useMutation({
    mutationFn: (sessionId: number) => api.post(`/api/joblens/sessions/${sessionId}/reweight`, {
      weights: clWeights,
      disqualifiers: clDisqualifiers,
      salary_budget_min: salaryMin,
      salary_budget_max: salaryMax,
      max_notice_days: maxNotice,
      remote_allowed: remoteAllowed,
    }).then(r => r.data),
    onSuccess: () => {
      if (activeSessionId) qc.invalidateQueries({ queryKey: ["joblens-session", activeSessionId] });
    },
  });
  const [searchParams] = useSearchParams();
  const [activeSessionId, setActiveSessionId] = useState<number | null>(() => {
    const fromUrl = searchParams.get("session");
    return fromUrl ? Number(fromUrl) : null;
  });

  // ── Video Interview auto-decision: weights + threshold constraints ───
  // Same "configurable, re-appliable, never silently overwrites a manual
  // choice unless explicitly re-applied" idea as the resume-screening
  // weights above, applied to the AI analysis's three sub-scores instead.
  // Placed after activeSessionId's declaration on purpose — this used to
  // sit BEFORE it (right after reweightMut), and the useEffect's
  // dependency array referenced activeSessionId at that point in the
  // component body, before its `const` had actually run: a genuine
  // temporal-dead-zone crash ("Cannot access 'activeSessionId' before
  // initialization") on every single render of this page, not just
  // video mode — dependency arrays are evaluated immediately as part of
  // the useEffect(...) call itself, unlike the effect body/callbacks
  // below, which only run later and were never the actual problem.
  const [showVideoDecisionPanel, setShowVideoDecisionPanel] = useState(false);
  const [vdWeights, setVdWeights] = useState({ communication: 30, relevance: 40, confidence: 30 });
  const [vdThresholds, setVdThresholds] = useState({ proceed_min: 70, reject_max: 40 });
  const [vdLoaded, setVdLoaded] = useState<number | null>(null);
  useEffect(() => {
    if (mode === "video" && activeSessionId && showVideoDecisionPanel && vdLoaded !== activeSessionId) {
      api.get(`/api/joblens/sessions/${activeSessionId}/video-decision-settings`).then(({ data }) => {
        setVdWeights({
          communication: Math.round((data.weights.communication ?? 0.3) * 100),
          relevance: Math.round((data.weights.relevance ?? 0.4) * 100),
          confidence: Math.round((data.weights.confidence ?? 0.3) * 100),
        });
        setVdThresholds(data.thresholds);
        setVdLoaded(activeSessionId);
      });
    }
  }, [mode, activeSessionId, showVideoDecisionPanel, vdLoaded]);
  const videoReweightMut = useMutation({
    mutationFn: (sessionId: number) => api.post(`/api/joblens/sessions/${sessionId}/video-decision-settings`, {
      weights: { communication: vdWeights.communication / 100, relevance: vdWeights.relevance / 100, confidence: vdWeights.confidence / 100 },
      thresholds: vdThresholds,
    }).then(r => r.data),
    onSuccess: () => {
      if (activeSessionId) qc.invalidateQueries({ queryKey: ["joblens-session", activeSessionId] });
    },
  });
  const vdWeightTotal = vdWeights.communication + vdWeights.relevance + vdWeights.confidence;

  const [tab, setTab] = useState<"new"|"history">(
    mode === "resume" && !searchParams.get("session") ? "new" : "history"
  );
  // Set once from the URL on first load — a candidate arriving here via
  // "Start Phone Interview" / "Start Video Interview" from Resume
  // Screening should land with that exact person already expanded and
  // scrolled to, not just dropped on a session list to go find them
  // again themselves.
  const [focusCandidateId] = useState<number | null>(() => {
    const fromUrl = searchParams.get("candidate");
    return fromUrl ? Number(fromUrl) : null;
  });
  const [managementView, setManagementView] = useState<"tracking"|"clients"|"jds"|"vendors">("tracking");
  const jdFileRef = useRef<HTMLInputElement>(null);
  const cvFileRef = useRef<HTMLInputElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => jobLensApi.deleteSession(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["joblens-sessions"] });
      if (activeSessionId === id) setActiveSessionId(null);
    },
    // Previously missing entirely — a failed delete (e.g. a 404 for a
    // session that's already gone, or a backend error) just left the
    // session sitting there in the list with zero feedback, which is
    // indistinguishable from "the click didn't register" from the
    // user's side. Now it actually says why.
    onError: (e: any) => {
      alert(e?.response?.data?.detail || "Failed to delete this session. Please try again.");
    },
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ["joblens-sessions"],
    queryFn: jobLensApi.sessions,
  });

  // Auto-load the latest session on arrival — previously Phone/Video
  // Interview (and Resume Screening's Results tab, landed on directly)
  // required manually opening the session dropdown every time, even
  // though in practice there's usually just the one active session a
  // recruiter is working through right now. Only kicks in when nothing
  // else has already claimed a session: not the URL's own ?session= (a
  // deliberate deep link from "Start Phone/Video Interview" takes
  // priority), and not a session the person already picked by hand in
  // this same visit.
  const [userPickedSession, setUserPickedSession] = useState(false);

  // Column widths for the main candidate table — same resizable-column
  // pattern as Requisitions/Talent Pool, just without per-column
  // dropdown filtering (this table's columns are mostly free text/
  // actions, not the kind of categorical data a filter dropdown suits).
  // A single shared key set works across all four modes since exactly
  // one of resume/phone/video/final's column sets is ever visible at a
  // time — no key collisions in practice.
  const [colWidths, setColWidths] = useState<Record<string, number>>({
    rank: 50, candidate: 170, email: 190, phone: 130, vendor: 130, resumeSummary: 220,
    atsScore: 130, keyStrength: 180, considerations: 170, status: 110, interviewQuestions: 220,
    videoInterview: 200, phoneScreeningDecision: 150, videoInterviewScore: 150, nextSteps: 210,
    phoneScreening: 230, decision: 160, comments: 190, candidateContact: 180, details: 90, shortlist: 100,
    rejectionEmail: 150, selectCol: 40, recommendation: 280,
  });
  const setColWidth = (key: string, w: number) => setColWidths((prev) => ({ ...prev, [key]: w }));

  // Per-column dropdown filter (Excel-style, single value + built-in
  // search — see ResizableFilterHeader), a global search box above the
  // table, and click-to-sort headers, for the main candidate table.
  // Reset whenever the mode tab or the active session changes so a
  // filter/sort left on from a different table/session doesn't silently
  // hide rows on the next one.
  const [candColFilters, setCandColFilters] = useState<Record<string, Set<string>>>({});
  const [candSort, setCandSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  const [candSearch, setCandSearch] = useState("");
  useEffect(() => {
    setCandColFilters({});
    setCandSort(null);
    setCandSearch("");
  }, [mode, activeSessionId]);
  const setCandColFilter = (key: string, next: Set<string> | undefined) =>
    setCandColFilters((prev) => { const n = { ...prev }; if (next) n[key] = next; else delete n[key]; return n; });
  const toggleCandSort = (col: string) => setCandSort((prev) => {
    if (!prev || prev.col !== col) return { col, dir: "asc" };
    if (prev.dir === "asc") return { col, dir: "desc" };
    return null;
  });

  // Screening Decision's "Send Rejection Email" bulk action — a
  // checkbox per row (mode === "final" only) plus a popup composer.
  // Reset alongside the filter/sort/search state above, same reasoning:
  // a selection left over from a different session/tab shouldn't
  // silently carry into the next one.
  const [selectedForRejection, setSelectedForRejection] = useState<Set<number>>(new Set());
  const [showRejectionComposer, setShowRejectionComposer] = useState(false);
  const [rejectionSubject, setRejectionSubject] = useState("Update on your application");
  // Plain text, not HTML — the composer is a normal-looking email editor
  // (blank line = new paragraph), not a raw-markup box. textToHtml()
  // below converts it right before sending/previewing, so nobody has to
  // read or edit "<p>" tags to draft a rejection letter.
  const [rejectionBody, setRejectionBody] = useState(
    "Hi {name},\n\n" +
    "Thank you for taking the time to apply and for the effort you put into the interview process with us. " +
    "We really enjoyed learning about your background.\n\n" +
    "After careful consideration, we've decided to move forward with other candidates whose experience more " +
    "closely matches what we need for this particular role. This wasn't an easy decision, and it isn't a " +
    "reflection of your skills or potential.\n\n" +
    "We'll keep your details on file and would love to consider you for future opportunities that may be a " +
    "better fit. We wish you all the very best in your job search.\n\n" +
    "Warm regards,\nThe Hiring Team"
  );
  const [sendingRejection, setSendingRejection] = useState(false);
  const [rejectionResult, setRejectionResult] = useState<{ sent: any[]; failed: any[] } | null>(null);
  useEffect(() => {
    setSelectedForRejection(new Set());
    setRejectionResult(null);
  }, [mode, activeSessionId]);
  useEffect(() => {
    if (activeSessionId || userPickedSession || searchParams.get("session")) return;
    if (sessions.length > 0) {
      setActiveSessionId(sessions[0].id);
      setTab("history");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  const { data: activeSession, refetch: refetchSession } = useQuery({
    queryKey: ["joblens-session", activeSessionId],
    queryFn: () => jobLensApi.session(activeSessionId!),
    enabled: !!activeSessionId,
    // Automatic video analysis runs in the background after upload — poll
    // while any candidate is still Pending/Processing so the result shows
    // up without the user needing to manually hit Refresh.
    refetchInterval: (query) => {
      const candidates = (query.state.data as any)?.candidates || [];
      // has_video check matters here even more than in the cell display:
      // without it, ANY session containing a candidate who simply hasn't
      // done their video round yet (the default, normal state for most
      // candidates most of the time) polls the backend every 5 seconds
      // forever, since video_analysis_status defaults to "Pending" from
      // creation — not just a cosmetic "stuck spinner" bug but ongoing,
      // pointless load on the server for as long as that session stays open.
      const stillWorking = candidates.some((c: any) =>
        c.has_video && (c.video_analysis_status === "Pending" || c.video_analysis_status === "Processing")
      );
      return stillWorking ? 5000 : false;
    },
  });

  // Whenever a session finishes loading, pre-fill the weight sliders and
  // logistics inputs with what was actually used for it — so reopening a
  // past session to tweak it starts from "what it already had", not the
  // global defaults, and the Reweight panel always reflects reality.
  const lastSyncedSessionId = useRef<number | null>(null);
  useEffect(() => {
    if (!activeSession || activeSession.id === lastSyncedSessionId.current) return;
    lastSyncedSessionId.current = activeSession.id;
    if (activeSession.weights && Object.keys(activeSession.weights).length) {
      setClWeights({ ...DEFAULT_SCORING_WEIGHTS, ...activeSession.weights });
    }
    if (activeSession.disqualifiers && Object.keys(activeSession.disqualifiers).length) {
      setClDisqualifiers({ ...DEFAULT_DISQUALIFIERS, ...activeSession.disqualifiers });
    }
    setSalaryMin(activeSession.salary_budget_min || 0);
    setSalaryMax(activeSession.salary_budget_max || 0);
    setMaxNotice(activeSession.max_notice_days || 0);
    setRemoteAllowed(!!activeSession.jd_remote_allowed);
  }, [activeSession]);

  const runMut = useMutation({
    mutationKey: ["joblens-run"],
    mutationFn: () => {
      const form = new FormData();
      form.append("jd_text", jdSource === "upload" ? jdText : "");
      form.append("low_threshold", String(lowT));
      form.append("high_threshold", String(highT));
      if (jdSource === "upload" && jdFile) form.append("jd_file", jdFile);
      if (jdSource === "requisition" && selectedRequisitionId) form.append("requisition_id", String(selectedRequisitionId));
      if (cvSource === "upload" && cvFiles) for (let i = 0; i < cvFiles.length; i++) form.append("cv_files", cvFiles[i]);
      if (cvSource === "vendor" && selectedApplicationIds.length) form.append("source_application_ids", selectedApplicationIds.join(","));
      form.append("weights", JSON.stringify(clWeights));
      form.append("disqualifiers", JSON.stringify(clDisqualifiers));
      form.append("salary_budget_min", String(salaryMin));
      form.append("salary_budget_max", String(salaryMax));
      form.append("max_notice_days", String(maxNotice));
      form.append("remote_allowed", String(remoteAllowed));
      return jobLensApi.run(form);
    },
    onSuccess: (data) => {
      setActiveSessionId(data.session_id);
      setTab("history");
      qc.invalidateQueries({ queryKey: ["joblens-sessions"] });
      qc.invalidateQueries({ queryKey: ["joblens-session", data.session_id] });
    },
  });

  // Reads the same mutation from the shared, app-level mutation cache — this
  // is what survives the user switching to another agent page while a batch
  // of CVs is still being scored, and picks the result back up when they
  // return, whether or not this specific page instance was the one that
  // originally triggered it.
  const runState = useLatestMutation<any>(["joblens-run"]);
  const lastSeenRunSessionId = useRef<number | null>(null);
  useEffect(() => {
    if (runState.status === "success" && runState.data?.session_id
        && runState.data.session_id !== lastSeenRunSessionId.current) {
      lastSeenRunSessionId.current = runState.data.session_id;
      qc.invalidateQueries({ queryKey: ["joblens-sessions"] });
      qc.invalidateQueries({ queryKey: ["joblens-session", runState.data.session_id] });
      setActiveSessionId(runState.data.session_id);
      setTab("history");
    }
  }, [runState.status, runState.data?.session_id, qc]);

  const exportMut = useMutation({
    mutationFn: (id: number) => jobLensApi.export(id),
    onSuccess: (blob, id) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `joblens_${id}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    },
  });

  const allCandidates: any[] = activeSession?.candidates || [];
  // Phone/Video pages act on anyone who's cleared Resume Screening —
  // either the AI scored them Qualified, or a recruiter manually
  // shortlisted them (e.g. a "Review" candidate worth a call anyway).
  // Previously this ONLY checked the manual shortlist flag, which meant
  // Qualified candidates the recruiter hadn't separately ticked a
  // checkbox for were invisible here — Phone/Video Interview looked
  // empty even with a session full of Qualified candidates sitting one
  // page away.
  //
  // Screening Decision (mode === "final") is the odd one out: it's the
  // end-of-process summary for EVERY candidate's outcome, not another
  // funnel stage, so a "Not Qualified" candidate belongs there too —
  // that's specifically where a recruiter needs to see them, to send
  // the rejection email. Excluding them here (as this filter otherwise
  // correctly does for Phone/Video) meant a candidate who failed
  // screening simply vanished from the app with no record and no way
  // to notify them.
  const candidates: any[] = (mode === "resume" || mode === "final") ? allCandidates : allCandidates.filter(c => c.shortlisted || c.status === "Qualified");
  const qualified  = candidates.filter(c => c.status === "Qualified").length;
  const review     = candidates.filter(c => c.status === "Review").length;
  const shortlisted = candidates.filter(c => c.shortlisted).length;
  const phoneContacted = candidates.filter(c => c.phone_screening_status && c.phone_screening_status !== "Not Started").length;
  const phoneCompleted = candidates.filter(c => c.phone_screening_status === "Completed").length;
  const videoCompleted = candidates.filter(c => c.video_status === "Completed").length;
  const videoPending   = candidates.filter(c => c.video_status !== "Completed").length;
  const finalShortlisted = candidates.filter(c => c.shortlisted).length;
  const finalPending     = candidates.length - finalShortlisted;

  // Unique values per column (for the filter dropdown options) always
  // come from the full `candidates` list, not the already-filtered one —
  // otherwise picking a value in one column would shrink the choices
  // available in every other column's dropdown.
  const candColOptions = (key: string): string[] =>
    Array.from(new Set(candidates.map(c => String(getCandidateColValue(c, key) ?? "")).filter(v => v !== ""))).sort();

  const displayCandidates = (() => {
    let out = candidates;
    if (candSearch.trim()) {
      const q = candSearch.trim().toLowerCase();
      out = out.filter(c => Object.keys(CANDIDATE_TABLE_COLS).some(k =>
        String(getCandidateColValue(c, k) ?? "").toLowerCase().includes(q)));
    }
    for (const [key, val] of Object.entries(candColFilters)) {
      if (!val) continue;
      out = out.filter(c => val.has(String(getCandidateColValue(c, key) ?? "")));
    }
    if (candSort) {
      const { col, dir } = candSort;
      out = [...out].sort((a, b) => {
        const av = getCandidateColValue(a, col), bv = getCandidateColValue(b, col);
        if (av === null || av === "" || av === undefined) return 1;
        if (bv === null || bv === "" || bv === undefined) return -1;
        let cmp: number;
        if (CANDIDATE_TABLE_COLS[col] === "number") {
          cmp = Number(av) - Number(bv);
        } else {
          cmp = String(av).localeCompare(String(bv));
        }
        return dir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  })();

  const MODE_META = {
    resume: { title: "Resume Screening", sub: "AI-ranked CVs — score, shortlist, and export candidates against a JD.", icon: Users, color: "#8b5cf6" },
    phone:  { title: "Phone Interview",  sub: "AI-generated call questions and logged outcomes for Qualified/shortlisted candidates.", icon: Users, color: "#ec4899" },
    video:  { title: "Video Interview",  sub: "Webcam interviews with live emotion analysis and AI-scored transcripts, for Qualified/shortlisted candidates.", icon: Video, color: "#00c7b7" },
    final:  { title: "Screening Decision", sub: "Resume, phone, and video interview scores side by side — make the final shortlist call.", icon: CheckCircle, color: "#10b981" },
  } as const;
  const meta = MODE_META[mode];

  return (
    <div className={embedded ? "" : "tiq-content"}>
      {!embedded && (
        <div className="tiq-page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div className="tiq-page-title">{meta.title}</div>
            <div className="tiq-page-sub">{meta.sub}</div>
          </div>
          {mode === "video" && <AnalyzeUnanalyzedVideosButton />}
        </div>
      )}
      {embedded && mode === "video" && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <AnalyzeUnanalyzedVideosButton />
        </div>
      )}

      {/* Tabs row — session dropdown sits left-aligned on its own row below */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          {mode === "resume" && (
            <div className="tiq-tabs">
              <button className={`tiq-tab${tab === "new" ? " active" : ""}`} onClick={() => setTab("new")}>
                <Play size={12} style={{ display: "inline", marginRight: 6 }} /> New Analysis
              </button>
              <button className={`tiq-tab${tab === "history" ? " active" : ""}`} onClick={() => setTab("history")}>
                <BarChart2 size={12} style={{ display: "inline", marginRight: 6 }} /> Results
                {sessions.length > 0 && <span className="tiq-badge tiq-badge-slate" style={{ marginLeft: 8, fontSize: 10 }}>{sessions.length}</span>}
              </button>
            </div>
          )}
        </div>
        {mode !== "resume" && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
            Showing candidates who scored Qualified or were manually shortlisted in Resume Screening. Manage the candidate pool and run new scoring there.
          </div>
        )}

        {(tab === "history" || mode !== "resume") && sessions.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, maxWidth: 380, width: "100%" }}>
            <HistoryDropdown
              value={activeSessionId}
              onChange={id => { setActiveSessionId(id as number | null); setUserPickedSession(true); }}
              options={sessions.map((s: any) => ({
                id: s.id,
                label: `Session #${s.sequence_number || s.id} · ${s.cv_count} CVs · ${new Date(s.created_at).toLocaleDateString()}`,
              }))}
              onDelete={id => deleteMutation.mutate(id as number)}
              placeholder="Select a session…"
              confirmDeleteMessage="Delete this session?"
            />
          </div>
        )}
      </div>

      {tab === "new" && (
        <div style={{ maxWidth: 900 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
            {/* JD */}
            <div className="tiq-card">
              <div className="tiq-card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <FileText size={15} color="var(--violet-500)" /> Job Description
              </div>
              <div style={{ display: "flex", gap: 14, marginBottom: 12, fontSize: 12 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                  <input type="radio" checked={jdSource === "upload"} onChange={() => setJdSource("upload")} />
                  Paste / Upload
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                  <input type="radio" checked={jdSource === "requisition"} onChange={() => setJdSource("requisition")} />
                  From Requisitions
                </label>
              </div>

              {jdSource === "requisition" ? (
                <div className="tiq-form-group">
                  <label className="tiq-label">Select Requisition</label>
                  <select className="tiq-input" value={selectedRequisitionId}
                    onChange={e => { setSelectedRequisitionId(e.target.value ? Number(e.target.value) : ""); setSelectedApplicationIds([]); }}>
                    <option value="">Select a requisition…</option>
                    {requisitionOptions.map((j: any) => (
                      <option key={j.id} value={j.id}>{j.title} — {j.client_name || "No client"}</option>
                    ))}
                  </select>
                  {requisitionOptions.length === 0 && (
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                      No open requisitions yet — create one on the Requisitions page first.
                    </div>
                  )}
                  {selectedRequisitionId && !requisitionOptions.find((j: any) => j.id === selectedRequisitionId)?.has_jd && (
                    <div style={{ fontSize: 11, color: "var(--amber-500, #f59e0b)", marginTop: 6 }}>
                      This requisition has no JD attached yet — attach one on the Requisitions page before running analysis.
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                    <button className="tiq-btn tiq-btn-outline tiq-btn-sm"
                      onClick={() => jdFileRef.current?.click()}>
                      <Upload size={12} /> Upload JD
                    </button>
                    {jdFile && <span style={{ fontSize: 12, color: "var(--teal-500)", alignSelf: "center" }}>✓ {jdFile.name}</span>}
                  </div>
                  <input ref={jdFileRef} type="file" accept=".txt,.pdf,.doc,.docx" style={{ display: "none" }}
                    onChange={e => setJdFile(e.target.files?.[0] || null)} />

                  <div style={{ marginTop: 10 }}>
                    <JDLinkFetcher endpoint="/api/joblens/fetch-jd-url" onFetched={(text) => {
                      setJdText(text); setJdFile(null); setPasteTextOpen(true);
                    }} />
                  </div>

                  <button type="button" onClick={() => setPasteTextOpen(o => !o)}
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, color: "var(--teal-500)", textDecoration: "underline", marginTop: 4 }}>
                    {pasteTextOpen ? "Hide paste-text box ▲" : (jdText ? "Edit pasted text ▾" : "Or paste text instead ▾")}
                  </button>

                  {pasteTextOpen && (
                    <textarea
                      value={jdText}
                      onChange={e => setJdText(e.target.value)}
                      placeholder="Paste job description here..."
                      autoFocus
                      style={{ width: "100%", minHeight: 200, padding: 10, fontSize: 12, marginTop: 8,
                        fontFamily: "monospace", border: "1.5px solid var(--border)",
                        borderRadius: 8, resize: "vertical", outline: "none",
                        background: "var(--bg-secondary)", color: "var(--text-primary)" }}
                    />
                  )}
                </>
              )}
            </div>

            {/* CVs + Settings */}
            <div className="tiq-card">
              <div className="tiq-card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Users size={15} color="var(--teal-500)" /> CV Files & Thresholds
              </div>
              <div style={{ display: "flex", gap: 14, marginBottom: 12, fontSize: 12 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                  <input type="radio" checked={cvSource === "upload"} onChange={() => setCvSource("upload")} />
                  Upload Files
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                  <input type="radio" checked={cvSource === "vendor"}
                    onChange={() => { setCvSource("vendor"); setJdSource("requisition"); }} />
                  From Candidate Table
                </label>
              </div>

              {cvSource === "vendor" ? (
                <div style={{ marginBottom: 16 }}>
                  {!selectedRequisitionId ? (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Select a JD from the dropdown on the left to load its candidates.</div>
                  ) : requisitionCandidateOptions.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No candidates submitted for this requisition yet.</div>
                  ) : (
                    <>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
                        Showing candidates submitted for this requisition — check the header box to select all.
                      </div>
                      <div className="tiq-card" style={{ padding: 0, marginBottom: 8 }}>
                        <DataTable
                          columns={["Name", "Email", "Status", "Resume"]}
                          rows={requisitionCandidateOptions.map((vc: any) => ({
                            id: vc.id,
                            "Name": vc.name,
                            "Email": vc.email || "—",
                            "Status": vc.status,
                            "Resume": vc.has_resume ? "Available" : "Missing",
                            _raw: vc,
                          }))}
                          getRowKey={(row) => row.id}
                          selectable
                          selectedKeys={selectedApplicationIds}
                          onSelectionChange={(keys) => setSelectedApplicationIds(
                            (keys as number[]).filter(id => requisitionCandidateOptions.find((vc: any) => vc.id === id)?.has_resume)
                          )}
                          emptyMessage="No candidates"
                        />
                      </div>
                    </>
                  )}
                  {selectedApplicationIds.length > 0 && (
                    <div style={{ fontSize: 12, color: "var(--teal-500)", fontWeight: 600 }}>
                      {selectedApplicationIds.length} candidate{selectedApplicationIds.length > 1 ? "s" : ""} selected
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div
                    onClick={() => cvFileRef.current?.click()}
                    style={{ border: "2px dashed var(--border)", borderRadius: 10, padding: 20,
                      textAlign: "center", cursor: "pointer", marginBottom: 16 }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--teal-500)")}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}
                  >
                    <Upload size={28} color="var(--text-muted)" style={{ margin: "0 auto 8px" }} />
                    <div style={{ fontSize: 13 }}>
                      {cvFiles ? (
                        <span style={{ color: "var(--teal-500)", fontWeight: 600 }}>
                          {cvFiles.length} CV{cvFiles.length > 1 ? "s" : ""} selected
                        </span>
                      ) : (
                        <span>Click to select CVs (PDF, DOCX) — multiple allowed</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>PDF, DOCX supported</div>
                  </div>
                  <input ref={cvFileRef} type="file" accept=".pdf,.doc,.docx" multiple style={{ display: "none" }}
                    onChange={e => setCvFiles(e.target.files)} />
                </>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="tiq-form-group">
                  <label className="tiq-label">Low Threshold (Review)</label>
                  <input type="number" className="tiq-input" value={lowT} min={0} max={100}
                    onChange={e => setLowT(Number(e.target.value))} />
                </div>
                <div className="tiq-form-group">
                  <label className="tiq-label">High Threshold (Qualified)</label>
                  <input type="number" className="tiq-input" value={highT} min={0} max={100}
                    onChange={e => setHighT(Number(e.target.value))} />
                </div>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                Score ≥ {highT}% → Qualified · {lowT}–{highT}% → Review · &lt;{lowT}% → Not Qualified
              </div>
            </div>
          </div>

          <CandidateLensWeightsPanel
            weights={clWeights} setWeights={setClWeights}
            disqualifiers={clDisqualifiers} setDisqualifiers={setClDisqualifiers}
            salaryMin={salaryMin} setSalaryMin={setSalaryMin}
            salaryMax={salaryMax} setSalaryMax={setSalaryMax}
            maxNotice={maxNotice} setMaxNotice={setMaxNotice}
            remoteAllowed={remoteAllowed} setRemoteAllowed={setRemoteAllowed}
          />

          <div style={{ textAlign: "center" }}>
            <button className="tiq-btn tiq-btn-primary"
              style={{ padding: "12px 40px", fontSize: 15, justifyContent: "center" }}
              onClick={() => runMut.mutate()}
              disabled={
                runState.status === "pending" ||
                (jdSource === "upload" ? (!jdText.trim() && !jdFile) : !selectedRequisitionId) ||
                (cvSource === "upload" ? !cvFiles?.length : selectedApplicationIds.length === 0)
              }>
              {runState.status === "pending"
                ? <><span className="tiq-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Analysing CVs…</>
                : <><Sparkles size={16} /> Run JobLens Analysis</>}
            </button>
            {runState.status === "pending" && (
              <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-muted)" }}>
                Extracting text, scoring CVs… This keeps running even if you switch to another page.
              </div>
            )}
            {runState.status === "error" && (
              <div className="tiq-alert tiq-alert-error" style={{ marginTop: 12, maxWidth: 500, margin: "12px auto 0" }}>
                {(runState.error as any)?.response?.data?.detail || "Analysis failed"}
              </div>
            )}
          </div>
        </div>
      )}

      {(tab === "history" || mode !== "resume") && (
        <div>
          {activeSession ? (
            <div>
              {/* Summary — tiles are mode-specific: Resume Screening
                  tracks scoring outcomes; Phone/Video Interview track
                  how far each candidate's gotten through that specific
                  stage, since "Qualified" alone doesn't say whether
                  anyone's actually been called or recorded yet. */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 12 }}>
                {(mode === "resume" ? [
                  { label: "Total Candidates", value: candidates.length, color: "var(--text-primary)", icon: Users },
                  { label: "Qualified", value: qualified, color: "#10b981", icon: CheckCircle },
                  { label: "Review", value: review, color: "#f59e0b", icon: Clock },
                  { label: "Shortlisted", value: shortlisted, color: "var(--violet-500)", icon: Star },
                ] : mode === "phone" ? [
                  { label: "Ready for Phone Interview", value: candidates.length, color: "var(--text-primary)", icon: Users },
                  { label: "Qualified", value: qualified, color: "#10b981", icon: CheckCircle },
                  { label: "Contacted", value: phoneContacted, color: "#3b82f6", icon: Clock },
                  { label: "Completed", value: phoneCompleted, color: "var(--violet-500)", icon: Star },
                ] : mode === "video" ? [
                  { label: "Ready for Video Interview", value: candidates.length, color: "var(--text-primary)", icon: Users },
                  { label: "Qualified", value: qualified, color: "#10b981", icon: CheckCircle },
                  { label: "Completed", value: videoCompleted, color: "var(--violet-500)", icon: Star },
                  { label: "Pending", value: videoPending, color: "#f59e0b", icon: Clock },
                ] : [
                  { label: "Total Candidates", value: candidates.length, color: "var(--text-primary)", icon: Users },
                  { label: "Qualified", value: qualified, color: "#10b981", icon: CheckCircle },
                  { label: "Shortlisted", value: finalShortlisted, color: "var(--violet-500)", icon: Star },
                  { label: "Awaiting Decision", value: finalPending, color: "#f59e0b", icon: Clock },
                ]).map(({ label, value, color, icon: Icon }) => (
                  <div key={label} className="tiq-card" style={{ textAlign: "center", padding: "8px 12px" }}>
                    <Icon size={16} color={color} style={{ margin: "0 auto 3px" }} />
                    <div style={{ fontSize: 22, fontWeight: 900, color, lineHeight: 1.2 }}>{value}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{label}</div>
                  </div>
                ))}
              </div>

              {isAdmin && activeSession.ai_powered && (
                <div className="tiq-alert tiq-alert-success tiq-mb-4" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Sparkles size={14} /> AI-powered scoring by Groq LLM
                </div>
              )}

              {/* JD Summary — role/location/company extracted server-side
                  (LLM when available, filtered heuristic otherwise), not
                  guessed from raw text client-side. */}
              {activeSession.jd_text && (activeSession.jd_role || activeSession.jd_location || activeSession.jd_company || (activeSession.jd_skills || []).length > 0) && (
                <div className="tiq-card tiq-mb-4" style={{ borderLeft: "4px solid var(--violet-500)" }}>
                  {/* Heading only makes sense where the skills breakdown
                      below it actually exists (Resume Screening) — on
                      Phone/Video/Final, this card is just a compact
                      title/location/client reminder, not a "summary" of
                      anything else on the page. */}
                  {mode === "resume" && (
                    <div className="tiq-card-title" style={{ fontSize: 12, marginBottom: 12 }}>Job Description Summary</div>
                  )}
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 40px" }}>
                    {activeSession.jd_role && (
                      <span style={{ fontSize: 13 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginRight: 6 }}>JD TITLE:</span>
                        <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{activeSession.jd_role}</span>
                      </span>
                    )}
                    {activeSession.jd_location && (
                      <span style={{ fontSize: 13 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginRight: 6 }}>LOCATION:</span>
                        <span style={{ color: "var(--text-secondary)" }}>{activeSession.jd_location}</span>
                      </span>
                    )}
                    {(activeSession.jd_client_name || activeSession.jd_company) && (
                      <span style={{ fontSize: 13 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginRight: 6 }}>CLIENT NAME:</span>
                        <span style={{ color: "var(--text-secondary)" }}>{activeSession.jd_client_name || activeSession.jd_company}</span>
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: mode === "resume" ? 8 : 0 }}>
                    {/* Skills breakdown — Resume Screening only. Phone/Video
                        Interview just need title/location/client as a
                        quick reminder of which role this is; the full
                        essential/good-to-have skill list is what's being
                        SCORED against, which matters during screening,
                        not while conducting a call or recording a video
                        round. */}
                    {mode === "resume" && ((activeSession.jd_essential_skills?.length > 0 || activeSession.jd_good_to_have_skills?.length > 0 || activeSession.jd_optional_skills?.length > 0) ? (
                      <>
                        {activeSession.jd_essential_skills?.length > 0 && (
                          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", width: 90, flexShrink: 0, paddingTop: 2 }}>ESSENTIAL</span>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {activeSession.jd_essential_skills.slice(0, 25).map((s: string) => (
                                <span key={s} className="tiq-badge" style={{ fontSize: 10, background: "#ef444420", color: "#ef4444" }}>{s}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {activeSession.jd_good_to_have_skills?.length > 0 && (
                          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", width: 90, flexShrink: 0, paddingTop: 2 }}>GOOD TO HAVE</span>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {activeSession.jd_good_to_have_skills.slice(0, 25).map((s: string) => (
                                <span key={s} className="tiq-badge" style={{ fontSize: 10, background: "#f59e0b20", color: "#f59e0b" }}>{s}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {activeSession.jd_optional_skills?.length > 0 && (
                          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", width: 90, flexShrink: 0, paddingTop: 2 }}>OPTIONAL</span>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {activeSession.jd_optional_skills.slice(0, 25).map((s: string) => (
                                <span key={s} className="tiq-badge tiq-badge-slate" style={{ fontSize: 10 }}>{s}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (activeSession.jd_skills || []).length > 0 && (
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", width: 90, flexShrink: 0, paddingTop: 2 }}>SKILLS</span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {(activeSession.jd_skills || []).slice(0, 25).map((s: string) => (
                            <span key={s} className="tiq-badge tiq-badge-violet" style={{ fontSize: 10 }}>{s}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Table — full pane width */}
              <div className="tiq-card" style={{ padding: 0 }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    Ranked Candidates
                    <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 400, marginLeft: 8 }}>
                      Threshold: {activeSession.low_threshold}% / {activeSession.high_threshold}%
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => refetchSession()}>
                      <RefreshCw size={12} />
                    </button>
                    {mode === "video" && (
                      <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setShowVideoDecisionPanel(o => !o)}>
                        <Gavel size={12} /> {showVideoDecisionPanel ? "Hide Auto-Decision" : "Adjust Auto-Decision"}
                      </button>
                    )}
                    <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setShowReweightPanel(o => !o)}>
                      <BarChart2 size={12} /> {showReweightPanel ? "Hide Weights" : "Adjust Weights"}
                    </button>
                    <button className="tiq-btn tiq-btn-outline tiq-btn-sm"
                      onClick={() => exportMut.mutate(activeSessionId!)} disabled={exportMut.isPending}>
                      <Download size={12} /> Export Excel
                    </button>
                  </div>
                </div>
                {/* Global search — matches against every filterable column
                    (name, email, phone, status, scores, notes…), on top
                    of the per-column dropdown filters in the header. */}
                <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ position: "relative", maxWidth: 300 }}>
                    <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                    <input
                      value={candSearch}
                      onChange={e => setCandSearch(e.target.value)}
                      placeholder="Search candidates…"
                      className="tiq-input"
                      style={{ paddingLeft: 28, fontSize: 12, height: 32, width: "100%", boxSizing: "border-box" }}
                    />
                    {candSearch && (
                      <X size={13} onClick={() => setCandSearch("")}
                        style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", cursor: "pointer" }} />
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                    {displayCandidates.length}{displayCandidates.length !== candidates.length ? ` / ${candidates.length}` : ""} candidates
                  </div>
                  {mode === "final" && (
                    <div style={{ marginTop: 10 }}>
                      <button
                        className="tiq-btn tiq-btn-outline tiq-btn-sm"
                        disabled={selectedForRejection.size === 0}
                        onClick={() => { setRejectionResult(null); setShowRejectionComposer(true); }}
                      >
                        <Mail size={12} /> Send Rejection Email {selectedForRejection.size > 0 ? `(${selectedForRejection.size})` : ""}
                      </button>
                      {selectedForRejection.size === 0 && (
                        <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>
                          Tick candidates in the table below to enable this.
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {mode === "video" && showVideoDecisionPanel && (
                  <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
                      Every completed video analysis auto-sets a Proceed / Hold / Reject recommendation from these
                      weights and thresholds — recruiters can still change it manually afterward, and a manual
                      change is never silently overwritten by a later re-analysis. Use "Apply" below to instantly
                      recompute the recommendation for every already-analyzed candidate in this session with new
                      settings, the same way Resume Screening's weights can be re-applied without re-scoring from
                      scratch.
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: vdWeightTotal === 100 ? "var(--text-muted)" : "#f59e0b", marginBottom: 8 }}>
                      Weights total: {vdWeightTotal}%{vdWeightTotal !== 100 && " (doesn't need to be exactly 100 — just shown for reference)"}
                    </div>
                    <SliderRow label="Communication" value={vdWeights.communication}
                      onChange={v => setVdWeights({ ...vdWeights, communication: v })} />
                    <SliderRow label="Relevance to questions asked" value={vdWeights.relevance}
                      onChange={v => setVdWeights({ ...vdWeights, relevance: v })} />
                    <SliderRow label="Confidence" value={vdWeights.confidence}
                      onChange={v => setVdWeights({ ...vdWeights, confidence: v })} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14, marginBottom: 4 }}>
                      <div>
                        <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Proceed if score ≥</label>
                        <input type="number" min={0} max={100} className="tiq-input" value={vdThresholds.proceed_min}
                          onChange={e => setVdThresholds({ ...vdThresholds, proceed_min: Number(e.target.value) })} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Reject if score ≤</label>
                        <input type="number" min={0} max={100} className="tiq-input" value={vdThresholds.reject_max}
                          onChange={e => setVdThresholds({ ...vdThresholds, reject_max: Number(e.target.value) })} />
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 14 }}>
                      Score ≥ {vdThresholds.proceed_min} → Proceed · {vdThresholds.reject_max}–{vdThresholds.proceed_min} → Hold · ≤ {vdThresholds.reject_max} → Reject
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <button className="tiq-btn tiq-btn-primary tiq-btn-sm"
                        onClick={() => videoReweightMut.mutate(activeSessionId!)}
                        disabled={videoReweightMut.isPending || !activeSessionId}>
                        {videoReweightMut.isPending
                          ? <><span className="tiq-spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> Applying…</>
                          : <><Sparkles size={12} /> Apply to Already-Analyzed Candidates</>}
                      </button>
                      {videoReweightMut.isSuccess && (
                        <div style={{ fontSize: 10.5, color: "#10b981", marginTop: 4 }}>
                          Updated {videoReweightMut.data?.updated ?? 0} candidate(s).
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {showReweightPanel && (
                  <div style={{ padding: "0 16px" }}>
                    <CandidateLensWeightsPanel
                      weights={clWeights} setWeights={setClWeights}
                      disqualifiers={clDisqualifiers} setDisqualifiers={setClDisqualifiers}
                      salaryMin={salaryMin} setSalaryMin={setSalaryMin}
                      salaryMax={salaryMax} setSalaryMax={setSalaryMax}
                      maxNotice={maxNotice} setMaxNotice={setMaxNotice}
                      remoteAllowed={remoteAllowed} setRemoteAllowed={setRemoteAllowed}
                    />
                    <div style={{ textAlign: "right", paddingBottom: 12 }}>
                      <button className="tiq-btn tiq-btn-primary tiq-btn-sm"
                        onClick={() => reweightMut.mutate(activeSessionId!)}
                        disabled={reweightMut.isPending || !activeSessionId}>
                        {reweightMut.isPending
                          ? <><span className="tiq-spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> Re-ranking…</>
                          : <><Sparkles size={12} /> Re-apply Weights &amp; Re-rank</>}
                      </button>
                      <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 4 }}>
                        Instant — no AI re-analysis, just recomputes the composite score from what's already extracted.
                      </div>
                    </div>
                  </div>
                )}
                <div style={{ overflowX: "auto" }}>
                  <table className="tiq-table" style={{ minWidth: mode === "resume" ? 1200 : mode === "video" ? 1150 : mode === "phone" ? 900 : 850, width: "100%", tableLayout: "fixed" }}>
                    <thead ref={theadRef}>
                      <tr>
                        {mode === "final" && (
                          <th style={{ width: colWidths.selectCol, textAlign: "center" }}>
                            <input
                              type="checkbox"
                              title="Select all visible"
                              checked={displayCandidates.length > 0 && displayCandidates.every((c) => selectedForRejection.has(c.id))}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedForRejection(new Set(displayCandidates.map((c) => c.id)));
                                else setSelectedForRejection(new Set());
                              }}
                            />
                          </th>
                        )}
                        {/* # is the row's rank in the current view (after
                            any sort/filter), not a data field, so it's
                            neither filterable nor sortable itself. */}
                        <ResizableFilterHeader label="#" filterable={false} width={colWidths.rank} onWidthChange={(w) => setColWidth("rank", w)} align="center" />
                        <ResizableFilterHeader label="Candidate" width={colWidths.candidate} onWidthChange={(w) => setColWidth("candidate", w)}
                          value={candColFilters.candidate} options={candColOptions("candidate")} onChange={(v) => setCandColFilter("candidate", v)}
                          sortDir={candSort?.col === "candidate" ? candSort.dir : null} onSortClick={() => toggleCandSort("candidate")} />
                        {mode === "resume" && <ResizableFilterHeader label="Email" width={colWidths.email} onWidthChange={(w) => setColWidth("email", w)}
                          value={candColFilters.email} options={candColOptions("email")} onChange={(v) => setCandColFilter("email", v)}
                          sortDir={candSort?.col === "email" ? candSort.dir : null} onSortClick={() => toggleCandSort("email")} />}
                        <ResizableFilterHeader label="Phone" width={colWidths.phone} onWidthChange={(w) => setColWidth("phone", w)}
                          value={candColFilters.phone} options={candColOptions("phone")} onChange={(v) => setCandColFilter("phone", v)}
                          sortDir={candSort?.col === "phone" ? candSort.dir : null} onSortClick={() => toggleCandSort("phone")} />
                        {mode === "resume" && <ResizableFilterHeader label="Vendor" width={colWidths.vendor} onWidthChange={(w) => setColWidth("vendor", w)}
                          value={candColFilters.vendor} options={candColOptions("vendor")} onChange={(v) => setCandColFilter("vendor", v)}
                          sortDir={candSort?.col === "vendor" ? candSort.dir : null} onSortClick={() => toggleCandSort("vendor")} />}
                        {mode === "resume" && <ResizableFilterHeader label="Resume Summary" width={colWidths.resumeSummary} onWidthChange={(w) => setColWidth("resumeSummary", w)}
                          value={candColFilters.resumeSummary} options={candColOptions("resumeSummary")} onChange={(v) => setCandColFilter("resumeSummary", v)}
                          sortDir={candSort?.col === "resumeSummary" ? candSort.dir : null} onSortClick={() => toggleCandSort("resumeSummary")} />}
                        <ResizableFilterHeader label={mode === "final" ? "Resume Screening Score" : "ATS Score"} width={colWidths.atsScore} onWidthChange={(w) => setColWidth("atsScore", w)}
                          value={candColFilters.atsScore} options={candColOptions("atsScore")} onChange={(v) => setCandColFilter("atsScore", v)}
                          sortDir={candSort?.col === "atsScore" ? candSort.dir : null} onSortClick={() => toggleCandSort("atsScore")} />
                        {mode === "resume" && <ResizableFilterHeader label="Key Strength" width={colWidths.keyStrength} onWidthChange={(w) => setColWidth("keyStrength", w)}
                          value={candColFilters.keyStrength} options={candColOptions("keyStrength")} onChange={(v) => setCandColFilter("keyStrength", v)}
                          sortDir={candSort?.col === "keyStrength" ? candSort.dir : null} onSortClick={() => toggleCandSort("keyStrength")} />}
                        {mode === "resume" && <ResizableFilterHeader label="Considerations" width={colWidths.considerations} onWidthChange={(w) => setColWidth("considerations", w)}
                          value={candColFilters.considerations} options={candColOptions("considerations")} onChange={(v) => setCandColFilter("considerations", v)}
                          sortDir={candSort?.col === "considerations" ? candSort.dir : null} onSortClick={() => toggleCandSort("considerations")} />}
                        {mode === "resume" && <ResizableFilterHeader label="Status" width={colWidths.status} onWidthChange={(w) => setColWidth("status", w)}
                          value={candColFilters.status} options={candColOptions("status")} onChange={(v) => setCandColFilter("status", v)}
                          sortDir={candSort?.col === "status" ? candSort.dir : null} onSortClick={() => toggleCandSort("status")} />}
                        {/* Free-text, essentially unique per candidate — a
                            dropdown filter wouldn't be useful here, so this
                            is sortable but not filterable, like Next Steps/
                            Details below. */}
                        {(mode === "resume" || mode === "final") && <ResizableFilterHeader label="Recommendation" filterable={false} width={colWidths.recommendation} onWidthChange={(w) => setColWidth("recommendation", w)}
                          sortDir={candSort?.col === "recommendation" ? candSort.dir : null} onSortClick={() => toggleCandSort("recommendation")} />}
                        {(mode === "phone" || mode === "video") && <ResizableFilterHeader label="Interview Questions" width={colWidths.interviewQuestions} onWidthChange={(w) => setColWidth("interviewQuestions", w)}
                          value={candColFilters.interviewQuestions} options={candColOptions("interviewQuestions")} onChange={(v) => setCandColFilter("interviewQuestions", v)}
                          sortDir={candSort?.col === "interviewQuestions" ? candSort.dir : null} onSortClick={() => toggleCandSort("interviewQuestions")} />}
                        {mode === "video" && <ResizableFilterHeader label="Video Interview" width={colWidths.videoInterview} onWidthChange={(w) => setColWidth("videoInterview", w)}
                          value={candColFilters.videoInterview} options={candColOptions("videoInterview")} onChange={(v) => setCandColFilter("videoInterview", v)}
                          sortDir={candSort?.col === "videoInterview" ? candSort.dir : null} onSortClick={() => toggleCandSort("videoInterview")} />}
                        {mode === "final" && <ResizableFilterHeader label="Phone Screening Decision" width={colWidths.phoneScreeningDecision} onWidthChange={(w) => setColWidth("phoneScreeningDecision", w)}
                          value={candColFilters.phoneScreeningDecision} options={candColOptions("phoneScreeningDecision")} onChange={(v) => setCandColFilter("phoneScreeningDecision", v)}
                          sortDir={candSort?.col === "phoneScreeningDecision" ? candSort.dir : null} onSortClick={() => toggleCandSort("phoneScreeningDecision")} />}
                        {mode === "final" && <ResizableFilterHeader label="Video Interview Score" width={colWidths.videoInterviewScore} onWidthChange={(w) => setColWidth("videoInterviewScore", w)}
                          value={candColFilters.videoInterviewScore} options={candColOptions("videoInterviewScore")} onChange={(v) => setCandColFilter("videoInterviewScore", v)}
                          sortDir={candSort?.col === "videoInterviewScore" ? candSort.dir : null} onSortClick={() => toggleCandSort("videoInterviewScore")} />}
                        {/* Next Steps is just navigation buttons — no
                            underlying data, so it stays non-filterable and
                            non-sortable like # and Details/Shortlist below. */}
                        {mode === "resume" && <ResizableFilterHeader label="Next Steps" filterable={false} width={colWidths.nextSteps} onWidthChange={(w) => setColWidth("nextSteps", w)} />}
                        {mode === "phone" && <ResizableFilterHeader label="Manual Phone Screening" width={colWidths.phoneScreening} onWidthChange={(w) => setColWidth("phoneScreening", w)}
                          value={candColFilters.phoneScreening} options={candColOptions("phoneScreening")} onChange={(v) => setCandColFilter("phoneScreening", v)}
                          sortDir={candSort?.col === "phoneScreening" ? candSort.dir : null} onSortClick={() => toggleCandSort("phoneScreening")} />}
                        {mode === "phone" && <ResizableFilterHeader label="Next Steps" filterable={false} width={colWidths.nextSteps} onWidthChange={(w) => setColWidth("nextSteps", w)} />}
                        {mode === "video" && <ResizableFilterHeader label="Decision" width={colWidths.decision} onWidthChange={(w) => setColWidth("decision", w)}
                          value={candColFilters.decision} options={candColOptions("decision")} onChange={(v) => setCandColFilter("decision", v)}
                          sortDir={candSort?.col === "decision" ? candSort.dir : null} onSortClick={() => toggleCandSort("decision")} />}
                        {mode === "video" && <ResizableFilterHeader label="Comments" width={colWidths.comments} onWidthChange={(w) => setColWidth("comments", w)}
                          value={candColFilters.comments} options={candColOptions("comments")} onChange={(v) => setCandColFilter("comments", v)}
                          sortDir={candSort?.col === "comments" ? candSort.dir : null} onSortClick={() => toggleCandSort("comments")} />}
                        {mode === "video" && <ResizableFilterHeader label="Candidate Contact" width={colWidths.candidateContact} onWidthChange={(w) => setColWidth("candidateContact", w)}
                          value={candColFilters.candidateContact} options={candColOptions("candidateContact")} onChange={(v) => setCandColFilter("candidateContact", v)}
                          sortDir={candSort?.col === "candidateContact" ? candSort.dir : null} onSortClick={() => toggleCandSort("candidateContact")} />}
                        {mode === "video" && <ResizableFilterHeader label="Next Steps" filterable={false} width={colWidths.nextSteps} onWidthChange={(w) => setColWidth("nextSteps", w)} />}
                        {mode === "resume" && <ResizableFilterHeader label="Details" filterable={false} width={colWidths.details} onWidthChange={(w) => setColWidth("details", w)} />}
                        {mode === "final" && <ResizableFilterHeader label="Shortlist" width={colWidths.shortlist} onWidthChange={(w) => setColWidth("shortlist", w)}
                          value={candColFilters.shortlist} options={candColOptions("shortlist")} onChange={(v) => setCandColFilter("shortlist", v)}
                          sortDir={candSort?.col === "shortlist" ? candSort.dir : null} onSortClick={() => toggleCandSort("shortlist")} />}
                        {mode === "final" && <ResizableFilterHeader label="Rejection Email" width={colWidths.rejectionEmail} onWidthChange={(w) => setColWidth("rejectionEmail", w)}
                          value={candColFilters.rejectionEmail} options={candColOptions("rejectionEmail")} onChange={(v) => setCandColFilter("rejectionEmail", v)}
                          sortDir={candSort?.col === "rejectionEmail" ? candSort.dir : null} onSortClick={() => toggleCandSort("rejectionEmail")} />}
                      </tr>
                    </thead>
                    <tbody>
                      {displayCandidates.map((c, i) => (
                        <CandidateRow
                          key={c.id}
                          c={c}
                          rank={i + 1}
                          sessionId={activeSessionId!}
                          lowT={activeSession.low_threshold}
                          highT={activeSession.high_threshold}
                          onRefresh={refetchSession}
                          theadRef={theadRef}
                          jdEssential={activeSession.jd_essential_skills || []}
                          jdGoodToHave={activeSession.jd_good_to_have_skills || []}
                          jdOptional={activeSession.jd_optional_skills || []}
                          mode={mode}
                          focusCandidateId={focusCandidateId}
                          selectable={mode === "final"}
                          selected={selectedForRejection.has(c.id)}
                          onToggleSelect={() => setSelectedForRejection((prev) => {
                            const next = new Set(prev);
                            if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                            return next;
                          })}
                        />
                      ))}
                      {displayCandidates.length === 0 && (
                        <tr>
                          <td colSpan={20} style={{ textAlign: "center", padding: 28, color: "var(--text-muted)" }}>
                            No candidates match the current search/filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="tiq-card">
              <div className="tiq-empty">
                <Users size={44} color="var(--violet-500)" style={{ opacity: .4 }} />
                <div className="tiq-empty-title">Select a Session</div>
                <div style={{ fontSize: 13 }}>
                  {sessions.length > 0
                    ? "Choose a session from the dropdown above, or run a new analysis."
                    : "No sessions yet — run a new analysis to get started."}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Send Rejection Email popup (Screening Decision only) ──────
          One individually-addressed email per selected candidate — see
          jobLensApi.sendRejectionEmails / the backend's
          send_rejection_emails for why this is a loop of single sends,
          never a shared To/CC list. {name} in the body is replaced with
          each candidate's own first name right before their email goes
          out, so this editable draft is a genuine template, not a
          literal message sent verbatim to everyone. */}
      {showRejectionComposer && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center" }}
          onMouseDown={(e) => { if (e.target === e.currentTarget && !sendingRejection) setShowRejectionComposer(false); }}>
          <div style={{ background: "#ffffff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 560, width: "94%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                <Mail size={16} style={{ display: "inline", marginRight: 8, verticalAlign: "middle" }} />
                Send Rejection Email
              </div>
              {!sendingRejection && (
                <button onClick={() => setShowRejectionComposer(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
              )}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
              Going to <strong>{selectedForRejection.size}</strong> candidate{selectedForRejection.size === 1 ? "" : "s"} — each gets their own
              separate email addressed to them by name; no candidate will see any other candidate's name or email address.
            </div>

            {!rejectionResult ? (
              <>
                <div className="tiq-form-group">
                  <label className="tiq-label">Subject</label>
                  <input className="tiq-input" value={rejectionSubject} onChange={(e) => setRejectionSubject(e.target.value)} disabled={sendingRejection} />
                </div>
                <div className="tiq-form-group">
                  <label className="tiq-label">Message — use <code>{"{name}"}</code> where the candidate's first name should go</label>
                  <textarea
                    className="tiq-input" rows={12} value={rejectionBody}
                    onChange={(e) => setRejectionBody(e.target.value)}
                    disabled={sendingRejection}
                    placeholder="Write like a normal email — leave a blank line between paragraphs."
                    style={{ fontSize: 13, lineHeight: 1.5, resize: "vertical" }}
                  />
                </div>
                <div style={{ background: "var(--slate-50, #f8fafc)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, marginBottom: 16 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>
                    Preview (as the first selected candidate would see it)
                  </div>
                  <div
                    style={{ fontSize: 13, lineHeight: 1.5 }}
                    dangerouslySetInnerHTML={{
                      __html: textToHtml(rejectionBody.replace(/\{name\}/g, (() => {
                        const firstId = Array.from(selectedForRejection)[0];
                        const cand = candidates.find((c: any) => c.id === firstId);
                        return (cand?.name || "").split(" ")[0] || "there";
                      })())),
                    }}
                  />
                </div>
                <div className="tiq-flex-end">
                  <button className="tiq-btn tiq-btn-ghost" onClick={() => setShowRejectionComposer(false)} disabled={sendingRejection}>Cancel</button>
                  <button
                    className="tiq-btn tiq-btn-primary"
                    disabled={sendingRejection || !rejectionSubject.trim() || !rejectionBody.trim()}
                    onClick={async () => {
                      setSendingRejection(true);
                      try {
                        const res = await jobLensApi.sendRejectionEmails({
                          candidate_ids: Array.from(selectedForRejection),
                          subject: rejectionSubject.trim(),
                          body_html_template: textToHtml(rejectionBody),
                        });
                        setRejectionResult(res);
                        setSelectedForRejection(new Set());
                        refetchSession();
                      } catch (e: any) {
                        alert(e?.response?.data?.detail || "Failed to send rejection emails.");
                      } finally {
                        setSendingRejection(false);
                      }
                    }}
                  >
                    {sendingRejection ? "Sending…" : `Send to ${selectedForRejection.size} Candidate${selectedForRejection.size === 1 ? "" : "s"}`}
                  </button>
                </div>
              </>
            ) : (
              <div>
                {rejectionResult.sent.length > 0 && (
                  <div className="tiq-alert tiq-alert-success" style={{ marginBottom: 10 }}>
                    Sent to {rejectionResult.sent.length}: {rejectionResult.sent.map((s: any) => s.name).join(", ")}
                  </div>
                )}
                {rejectionResult.failed.length > 0 && (
                  <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Failed for {rejectionResult.failed.length}:</div>
                    {rejectionResult.failed.map((f: any, i: number) => (
                      <div key={i} style={{ fontSize: 12 }}>{f.name || `Candidate #${f.candidate_id}`} — {f.error}</div>
                    ))}
                  </div>
                )}
                <div className="tiq-flex-end">
                  <button className="tiq-btn tiq-btn-primary" onClick={() => { setShowRejectionComposer(false); setRejectionResult(null); }}>Done</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}