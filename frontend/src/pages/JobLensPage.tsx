import { useNavigate, useSearchParams } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ResizableFilterHeader } from "../components/ResizableFilterHeader";
import { useLatestMutation } from "../hooks/useLatestMutation";
import {
  Users, Upload, FileText, Play, Download, ChevronDown, ChevronUp,
  CheckCircle, Clock, XCircle, Star, Video, RefreshCw, Sparkles, BarChart2,
  Trash2, Mail, Building2, AlertTriangle, Phone, CalendarClock } from "lucide-react";
import { api } from "../lib/api";
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
  sendPhoneCalendlyLink: (cid: number, data?: { to_email?: string; subject?: string; body_html?: string }) =>
    api.post(`/api/joblens/candidates/${cid}/phone-interview/send-calendly-link`, data || {}).then(r => r.data),
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
  requisitionOptions: () =>
    api.get(`/api/joblens/requisition-options`).then(r => r.data),
  requisitionCandidates: (requisitionId: number) =>
    api.get(`/api/joblens/requisition-candidates`, { params: { requisition_id: requisitionId } }).then(r => r.data),
};

// ─── HELPERS ───────────────────────────────────────────────────────────────
const CANDIDATE_STATUSES = ["Qualified", "Review", "Not Qualified"];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    "Qualified":     "tiq-badge-teal",
    "Review":        "tiq-badge-amber",
    "Not Qualified": "tiq-badge-rose",
    "Pending":       "tiq-badge-slate",
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
      const audioBlob: Blob = await jobLensApi.synthesizeSpeech(q);
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

// ─── CANDIDATE ROW ─────────────────────────────────────────────────────────
type PopoverKind = "resume" | "matched" | "missing" | "questions" | "videoAnalysis" | "scoreBreakdown";
type PopoverState = { kind: PopoverKind; x: number; y: number; width: number; anchor: HTMLElement; openAbove: boolean } | null;

function CandidateRow({
  c, rank, sessionId, lowT, highT, onRefresh, theadRef, jdEssential, jdGoodToHave, jdOptional, mode = "resume", focusCandidateId,
}: { c: any; rank: number; sessionId: number; lowT: number; highT: number; onRefresh: () => void; theadRef: React.RefObject<HTMLTableSectionElement>; jdEssential: string[]; jdGoodToHave: string[]; jdOptional: string[]; mode?: "resume" | "phone" | "video" | "final"; focusCandidateId?: number | null }) {
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
  });
  const [calendlySendError, setCalendlySendError] = useState("");
  const [calendlySent, setCalendlySent] = useState(false);
  const sendCalendlyMut = useMutation({
    mutationFn: () => jobLensApi.sendPhoneCalendlyLink(c.id),
    onSuccess: () => { setCalendlySendError(""); setCalendlySent(true); onRefresh(); },
    onError: (err: any) => { setCalendlySendError(err?.response?.data?.detail || "Failed to send Calendly link."); },
  });
  const statusMut = useMutation({
    mutationFn: (status: string) => jobLensApi.updateStatus(c.id, status),
    onSuccess: () => { onRefresh(); },
  });
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
    setGenLoading(true);
    try {
      const r = await jobLensApi.generateQuestions(sessionId, c.id, regenerate);
      setQuestions(r.questions || []);
    } finally {
      setGenLoading(false);
    }
  };

  const handleInterviewDone = async (emotions: any, videoBlob: Blob | null) => {
    await jobLensApi.saveInterviewResult(c.id, emotions);
    if (videoBlob) {
      try { await jobLensApi.uploadVideo(c.id, videoBlob); } catch { /* score/result already saved; video upload failure is non-fatal */ }
    }
    setInterviewOpen(false);
    onRefresh();
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
    const roomAbove = cellRect.top - headerBottom;
    const openAbove = roomAbove > 160;
    const y = openAbove ? cellRect.top - 6 : Math.min(Math.max(cellRect.bottom + 6, headerBottom + 6), window.innerHeight - 60);
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
      <tr ref={rowRef} style={{ background: isFocused ? "rgba(139,92,246,.10)" : shortlisted ? "rgba(0,199,183,.05)" : undefined }}>
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
            {c.has_video && c.video_analysis_status === "Failed" && <div style={{ fontSize: 11, color: "var(--rose-500)", marginTop: 6 }}>Analysis failed</div>}

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
          <td style={{ minWidth: 160 }}>
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
          <td style={{ minWidth: 220 }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: c.phone_screening_status === "Completed" ? "#10b981" : "var(--text-muted)" }}>
              {c.phone_screening_status || "Not Started"}
            </div>
            {/* Emails the recruiter's Calendly booking link to the candidate
                so they can self-schedule the initial HR phone screening.
                Also registers/updates this candidate's row in Interview
                Scheduling (see backend send-calendly-link endpoint). */}
            <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ width: "100%", justifyContent: "flex-start", textAlign: "left", marginBottom: 6, fontSize: 10.5 }}
              onClick={() => { setCalendlySendError(""); setCalendlySent(false); sendCalendlyMut.mutate(); }}
              disabled={sendCalendlyMut.isPending || !c.email}>
              <CalendarClock size={13} strokeWidth={2.5} color={STAGE_ICON_COLOR.phone} />
              {sendCalendlyMut.isPending ? "Sending…" : "Send Calendly Link"}
            </button>
            {!c.email && (
              <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginBottom: 6 }}>No candidate email on file</div>
            )}
            {calendlySent && (
              <div style={{ fontSize: 9.5, color: "#10b981", marginBottom: 6 }}>Calendly link sent</div>
            )}
            {calendlySendError && (
              <div style={{ fontSize: 9.5, color: "#ef4444", marginBottom: 6 }}>{calendlySendError}</div>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginBottom: 8, cursor: c.phone_screening_status && c.phone_screening_status !== "Not Started" ? "default" : "pointer" }}>
              <input type="checkbox"
                checked={!!c.phone_screening_status && c.phone_screening_status !== "Not Started"}
                disabled={phoneContactMut.isPending || (!!c.phone_screening_status && c.phone_screening_status !== "Not Started")}
                onChange={() => phoneContactMut.mutate()} />
              Candidate reached by phone
            </label>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
              {["Proceed", "Hold", "Reject"].map((r) => (
                <button key={r} type="button"
                  onClick={() => { setPhoneRecommendation(r); phoneResultMut.mutate({ recommendation: r }); }}
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
            <textarea className="tiq-input" rows={2} style={{ fontSize: 11 }}
              placeholder="Notes…" value={phoneNotes} onChange={(e) => setPhoneNotes(e.target.value)} />
            <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ marginTop: 4, fontSize: 10 }}
              onClick={() => phoneResultMut.mutate({})} disabled={phoneResultMut.isPending}>
              {phoneResultMut.isPending ? "Saving…" : "Save"}
            </button>
            {c.phone_screening_at && (
              <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 4 }}>
                {new Date(c.phone_screening_at).toLocaleDateString()}
              </div>
            )}
          </td>
        )}

        {/* Next Steps — Phone Interview offers Video Interview and
            Screening Decision only (not a link back to itself). Already
            past the Qualified/shortlisted gate just by being on this
            page, so offered unconditionally. */}
        {mode === "phone" && (
          <td style={{ minWidth: 160 }}>
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
                  onClick={() => { setVideoRecommendation(r); videoResultMut.mutate({ recommendation: r }); }}
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
          <td style={{ minWidth: 150 }}>
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
      </tr>

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
    </>
  );
}

// ─── MAIN PAGE ─────────────────────────────────────────────────────────────
export default function JobLensWorkspace({ mode = "resume" }: { mode?: "resume" | "phone" | "video" | "final" }) {
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
    videoInterview: 200, phoneScreeningDecision: 150, videoInterviewScore: 150, nextSteps: 170,
    phoneScreening: 230, decision: 160, comments: 190, candidateContact: 180, details: 90, shortlist: 100,
  });
  const setColWidth = (key: string, w: number) => setColWidths((prev) => ({ ...prev, [key]: w }));
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
  const candidates: any[] = mode === "resume" ? allCandidates : allCandidates.filter(c => c.shortlisted || c.status === "Qualified");
  const qualified  = candidates.filter(c => c.status === "Qualified").length;
  const review     = candidates.filter(c => c.status === "Review").length;
  const shortlisted = candidates.filter(c => c.shortlisted).length;
  const phoneContacted = candidates.filter(c => c.phone_screening_status && c.phone_screening_status !== "Not Started").length;
  const phoneCompleted = candidates.filter(c => c.phone_screening_status === "Completed").length;
  const videoCompleted = candidates.filter(c => c.video_status === "Completed").length;
  const videoPending   = candidates.filter(c => c.video_status !== "Completed").length;
  const finalShortlisted = candidates.filter(c => c.shortlisted).length;
  const finalPending     = candidates.length - finalShortlisted;

  const MODE_META = {
    resume: { title: "Resume Screening", sub: "AI-ranked CVs — score, shortlist, and export candidates against a JD.", icon: Users, color: "#8b5cf6" },
    phone:  { title: "Phone Interview",  sub: "AI-generated call questions and logged outcomes for Qualified/shortlisted candidates.", icon: Users, color: "#ec4899" },
    video:  { title: "Video Interview",  sub: "Webcam interviews with live emotion analysis and AI-scored transcripts, for Qualified/shortlisted candidates.", icon: Video, color: "#00c7b7" },
    final:  { title: "Screening Decision", sub: "Resume, phone, and video interview scores side by side — make the final shortlist call.", icon: CheckCircle, color: "#10b981" },
  } as const;
  const meta = MODE_META[mode];

  return (
    <div>
      <div className="tiq-page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <h1 className="tiq-page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <meta.icon size={22} color={meta.color} /> {meta.title}
        </h1>
        <p className="tiq-page-sub">{meta.sub}</p>
      </div>

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
                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
                    <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setShowReweightPanel(o => !o)}>
                      <BarChart2 size={12} /> {showReweightPanel ? "Hide Weights" : "Adjust Weights"}
                    </button>
                    <button className="tiq-btn tiq-btn-outline tiq-btn-sm"
                      onClick={() => exportMut.mutate(activeSessionId!)} disabled={exportMut.isPending}>
                      <Download size={12} /> Export Excel
                    </button>
                  </div>
                </div>
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
                        <ResizableFilterHeader label="#" filterable={false} width={colWidths.rank} onWidthChange={(w) => setColWidth("rank", w)} align="center" />
                        <ResizableFilterHeader label="Candidate" filterable={false} width={colWidths.candidate} onWidthChange={(w) => setColWidth("candidate", w)} />
                        {mode === "resume" && <ResizableFilterHeader label="Email" filterable={false} width={colWidths.email} onWidthChange={(w) => setColWidth("email", w)} />}
                        <ResizableFilterHeader label="Phone" filterable={false} width={colWidths.phone} onWidthChange={(w) => setColWidth("phone", w)} />
                        {mode === "resume" && <ResizableFilterHeader label="Vendor" filterable={false} width={colWidths.vendor} onWidthChange={(w) => setColWidth("vendor", w)} />}
                        {mode === "resume" && <ResizableFilterHeader label="Resume Summary" filterable={false} width={colWidths.resumeSummary} onWidthChange={(w) => setColWidth("resumeSummary", w)} />}
                        <ResizableFilterHeader label={mode === "final" ? "Resume Screening Score" : "ATS Score"} filterable={false} width={colWidths.atsScore} onWidthChange={(w) => setColWidth("atsScore", w)} />
                        {mode === "resume" && <ResizableFilterHeader label="Key Strength" filterable={false} width={colWidths.keyStrength} onWidthChange={(w) => setColWidth("keyStrength", w)} />}
                        {mode === "resume" && <ResizableFilterHeader label="Considerations" filterable={false} width={colWidths.considerations} onWidthChange={(w) => setColWidth("considerations", w)} />}
                        {mode === "resume" && <ResizableFilterHeader label="Status" filterable={false} width={colWidths.status} onWidthChange={(w) => setColWidth("status", w)} />}
                        {(mode === "phone" || mode === "video") && <ResizableFilterHeader label="Interview Questions" filterable={false} width={colWidths.interviewQuestions} onWidthChange={(w) => setColWidth("interviewQuestions", w)} />}
                        {mode === "video" && <ResizableFilterHeader label="Video Interview" filterable={false} width={colWidths.videoInterview} onWidthChange={(w) => setColWidth("videoInterview", w)} />}
                        {mode === "final" && <ResizableFilterHeader label="Phone Screening Decision" filterable={false} width={colWidths.phoneScreeningDecision} onWidthChange={(w) => setColWidth("phoneScreeningDecision", w)} />}
                        {mode === "final" && <ResizableFilterHeader label="Video Interview Score" filterable={false} width={colWidths.videoInterviewScore} onWidthChange={(w) => setColWidth("videoInterviewScore", w)} />}
                        {mode === "resume" && <ResizableFilterHeader label="Next Steps" filterable={false} width={colWidths.nextSteps} onWidthChange={(w) => setColWidth("nextSteps", w)} />}
                        {mode === "phone" && <ResizableFilterHeader label="Manual Phone Screening" filterable={false} width={colWidths.phoneScreening} onWidthChange={(w) => setColWidth("phoneScreening", w)} />}
                        {mode === "phone" && <ResizableFilterHeader label="Next Steps" filterable={false} width={colWidths.nextSteps} onWidthChange={(w) => setColWidth("nextSteps", w)} />}
                        {mode === "video" && <ResizableFilterHeader label="Decision" filterable={false} width={colWidths.decision} onWidthChange={(w) => setColWidth("decision", w)} />}
                        {mode === "video" && <ResizableFilterHeader label="Comments" filterable={false} width={colWidths.comments} onWidthChange={(w) => setColWidth("comments", w)} />}
                        {mode === "video" && <ResizableFilterHeader label="Candidate Contact" filterable={false} width={colWidths.candidateContact} onWidthChange={(w) => setColWidth("candidateContact", w)} />}
                        {mode === "video" && <ResizableFilterHeader label="Next Steps" filterable={false} width={colWidths.nextSteps} onWidthChange={(w) => setColWidth("nextSteps", w)} />}
                        {mode === "resume" && <ResizableFilterHeader label="Details" filterable={false} width={colWidths.details} onWidthChange={(w) => setColWidth("details", w)} />}
                        {mode === "final" && <ResizableFilterHeader label="Shortlist" filterable={false} width={colWidths.shortlist} onWidthChange={(w) => setColWidth("shortlist", w)} />}
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((c, i) => (
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
                        />
                      ))}
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
    </div>
  );
}