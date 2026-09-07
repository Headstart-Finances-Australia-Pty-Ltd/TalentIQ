import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ClipboardCheck, Clock, CheckCircle, AlertTriangle, Lock, LogIn, Video, VideoOff, Eye } from "lucide-react";
import { skillstestApi } from "../lib/api";

function formatTime(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Cached per-tab only (sessionStorage, not localStorage) so a reload of
// the SAME tab resumes without retyping the password, but a fresh tab
// or a different device always has to go through the real login —
// there's no cookie/session on the backend to persist this for us.
function sessionKey(token: string) {
  return `tiq-assessment-pw-${token}`;
}

function privacyKey(token: string) {
  return `tiq-assessment-privacy-${token}`;
}

const SNAPSHOT_INTERVAL_MS = 45000;

export default function PublicAssessmentPage() {
  const { token } = useParams<{ token: string }>();
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [remaining, setRemaining] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [testData, setTestData] = useState<any>(null); // login response: questions, name, role, duration
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [cameraStatus, setCameraStatus] = useState<"pending" | "granted" | "denied">("pending");
  const [cameraRequesting, setCameraRequesting] = useState(false);
  // Consent gate, mirroring PublicInterviewPage's privacy notice — shown
  // once, right after login, before the webcam is ever requested or any
  // question is rendered. Cached per-tab only (sessionStorage) so a
  // reload of the same tab doesn't force re-consent mid-sitting.
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [pasteNotice, setPasteNotice] = useState(false);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const submittedRef = useRef(false);
  const autoTriedRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-assessment-status", token],
    queryFn: () => skillstestApi.getPublicTest(token as string),
    enabled: !!token,
    retry: false,
  });

  const loginMut = useMutation({
    mutationFn: (pwd: string) => skillstestApi.loginPublicTest(token as string, pwd),
    onSuccess: (res: any) => {
      if (res.status === "completed") {
        setSubmitted(true);
        return;
      }
      setTestData(res);
      setRemaining(typeof res.remainingSeconds === "number" ? res.remainingSeconds : null);
      const draft = res.draftAnswers || {};
      const restored: Record<number, string> = {};
      Object.entries(draft).forEach(([qid, ans]) => { restored[Number(qid)] = ans as string; });
      setAnswers(restored);
      setLoginError("");
      try { sessionStorage.setItem(sessionKey(token as string), password || sessionStorage.getItem(sessionKey(token as string)) || ""); } catch { /* ignore */ }
      try { setPrivacyAccepted(sessionStorage.getItem(privacyKey(token as string)) === "1"); } catch { setPrivacyAccepted(false); }
    },
    onError: (e: any) => {
      setLoginError(e?.response?.data?.detail || "Incorrect password. Check your invitation email.");
      try { sessionStorage.removeItem(sessionKey(token as string)); } catch { /* ignore */ }
    },
  });

  // If this tab already logged in once this session, try that password
  // silently before showing the login form at all.
  useEffect(() => {
    if (!token || autoTriedRef.current || testData) return;
    if (data?.status !== "in_progress" && data?.status !== "not_started") return;
    let cached = "";
    try { cached = sessionStorage.getItem(sessionKey(token)) || ""; } catch { /* ignore */ }
    if (cached) {
      autoTriedRef.current = true;
      setPassword(cached);
      loginMut.mutate(cached);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, token]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const acceptPrivacy = useCallback(() => {
    if (!token) return;
    try { sessionStorage.setItem(privacyKey(token), "1"); } catch { /* ignore */ }
    setPrivacyAccepted(true);
  }, [token]);

  // Webcam is a hard requirement for this sitting — no camera, no
  // questions. Called once automatically after consent, and again from
  // the "Try Again" button if the candidate initially blocked it.
  const requestCamera = useCallback(() => {
    setCameraRequesting(true);
    navigator.mediaDevices?.getUserMedia?.({ video: { width: 320, height: 240 } })
      .then(stream => {
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraStatus("granted");
      })
      .catch(() => {
        setCameraStatus("denied");
        if (token) skillstestApi.logProctoringEvent(token, "camera_denied");
      })
      .finally(() => setCameraRequesting(false));
  }, [token]);

  const submitMut = useMutation({
    mutationFn: () => skillstestApi.submitPublicTest(
      token as string,
      Object.entries(answers).map(([questionId, answer]) => ({ questionId: Number(questionId), answer })),
    ),
    onSuccess: () => {
      setSubmitted(true);
      stopCamera();
      try { sessionStorage.removeItem(sessionKey(token as string)); } catch { /* ignore */ }
    },
  });

  const doSubmit = useCallback(() => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    submitMut.mutate();
  }, [submitMut]);

  // Countdown — auto-submits (whatever's been answered so far) the
  // instant it hits zero, with no action needed from the candidate.
  useEffect(() => {
    if (remaining === null || submitted) return;
    if (remaining <= 0) { doSubmit(); return; }
    const t = setTimeout(() => setRemaining(r => (r !== null ? r - 1 : r)), 1000);
    return () => clearTimeout(t);
  }, [remaining, submitted, doSubmit]);

  // Periodic autosave of in-progress answers, purely so a server-side
  // auto-close (see backend _auto_close_if_time_up) or a resumed/
  // refreshed tab has something recent to fall back on if the
  // candidate's browser never gets to fire the explicit submit above.
  useEffect(() => {
    if (!testData || submitted || !token) return;
    const interval = setInterval(() => {
      const list = Object.entries(answers).map(([questionId, answer]) => ({ questionId: Number(questionId), answer }));
      if (list.length) skillstestApi.autosavePublicTest(token, list).catch(() => { /* best-effort */ });
    }, 15000);
    const onUnload = () => {
      const list = Object.entries(answers).map(([questionId, answer]) => ({ questionId: Number(questionId), answer }));
      if (list.length) skillstestApi.autosavePublicTest(token, list).catch(() => { /* best-effort */ });
    };
    window.addEventListener("beforeunload", onUnload);
    return () => { clearInterval(interval); window.removeEventListener("beforeunload", onUnload); };
  }, [testData, submitted, token, answers]);

  // ── Integrity monitoring — starts only once the test is actually
  // in progress, and stops the moment it's submitted. Tab-switch/focus
  // tracking here is a deterrent/audit trail only and never blocks the
  // candidate from continuing. The camera, unlike these, IS a hard
  // gate — see the cameraStatus !== "granted" render branch, which
  // withholds the questions entirely until it's on.
  useEffect(() => {
    if (!testData || submitted || !token) return;

    const logEvent = (type: string) => skillstestApi.logProctoringEvent(token, type);

    const onVisibility = () => {
      if (document.hidden) {
        setTabSwitchCount(c => c + 1);
        logEvent("tab_hidden");
      } else {
        logEvent("tab_visible");
      }
    };
    const onBlur = () => logEvent("window_blur");
    const onFocus = () => logEvent("window_focus");

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [testData, submitted, token]);

  // Webcam: requested once consent is given, with a permanent on-screen
  // red-dot + preview so nothing here is covert. Unlike a plain
  // deterrent, this is now a hard gate — see the cameraStatus !== "granted"
  // render branch below, which withholds the actual test questions
  // until the camera is on.
  useEffect(() => {
    if (!testData || !privacyAccepted || submitted || !token) return;
    if (cameraStatus === "granted") return;
    requestCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testData, privacyAccepted, submitted, token]);

  // The <video> element itself gets swapped out when the UI moves from
  // the camera gate to the main test view (different JSX subtree), so
  // re-attach the already-granted stream to whichever <video> node is
  // currently mounted rather than re-requesting getUserMedia.
  useEffect(() => {
    if (cameraStatus === "granted" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraStatus]);

  useEffect(() => {
    if (cameraStatus !== "granted" || !testData || submitted || !token) return;
    const interval = setInterval(() => {
      const video = videoRef.current, canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;
      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 240;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.5);
      skillstestApi.uploadProctoringSnapshot(token, dataUrl);
    }, SNAPSHOT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [cameraStatus, testData, submitted, token]);

  const flashPasteNotice = useCallback(() => {
    setPasteNotice(true);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setPasteNotice(false), 3000);
  }, []);

  const blockClipboard = useCallback((eventType: "paste_blocked" | "copy_blocked") => (e: React.ClipboardEvent) => {
    e.preventDefault();
    flashPasteNotice();
    if (token) skillstestApi.logProctoringEvent(token, eventType);
  }, [token, flashPasteNotice]);

  if (isLoading) {
    return <div style={{ maxWidth: 700, margin: "80px auto", textAlign: "center", color: "#6b7280" }}>Loading your assessment…</div>;
  }

  if (error || !data) {
    return (
      <div style={{ maxWidth: 500, margin: "80px auto", textAlign: "center" }}>
        <AlertTriangle size={32} color="#e11d48" style={{ marginBottom: 12 }} />
        <div style={{ fontSize: 16, fontWeight: 600 }}>This test link isn't valid.</div>
        <div style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>Contact your recruiter for a new link.</div>
      </div>
    );
  }

  if (data.status === "expired" || data.status === "completed" || submitted) {
    return (
      <div style={{ maxWidth: 500, margin: "80px auto", textAlign: "center" }}>
        <CheckCircle size={36} color={submitted ? "#10b981" : "#94a3b8"} style={{ marginBottom: 12 }} />
        <div style={{ fontSize: 17, fontWeight: 700 }}>
          {submitted ? "Thank you!" : data.status === "expired" ? "This invitation has expired." : "Already submitted"}
        </div>
        <div style={{ fontSize: 13.5, color: "#6b7280", marginTop: 8 }}>
          {submitted
            ? "Your responses have been submitted successfully. The recruiting team will be in touch."
            : data.message}
        </div>
      </div>
    );
  }

  // ── Login gate — shown until this tab has an authenticated session
  // (either the candidate just typed the password, or it auto-resumed
  // from sessionStorage above). This is also the moment the server
  // starts the countdown, so nothing here is time-limited yet.
  if (!testData) {
    return (
      <div style={{ maxWidth: 420, margin: "80px auto", padding: "0 20px" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <Lock size={30} color="#a855f7" style={{ marginBottom: 10 }} />
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {data.roleTitle ? `${data.roleTitle} — Skills Assessment` : "Skills Assessment"}
          </div>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>
            {data.candidateName ? `Welcome, ${data.candidateName}. ` : ""}
            Log in with the credentials from your invitation email to begin. The {data.durationMinutes}-minute timer starts as soon as you log in.
          </div>
        </div>

        <div className="tiq-alert tiq-alert-info" style={{ fontSize: 12, marginBottom: 14 }}>
          <Eye size={13} style={{ display: "inline", marginRight: 6 }} />
          This assessment monitors tab switches and, with your camera permission, takes periodic still photos
          for identity/integrity verification. Please complete it yourself, without notes, other people, or AI tools.
        </div>

        <div className="tiq-alert tiq-alert-warning" style={{ fontSize: 12, marginBottom: 14 }}>
          <Video size={13} style={{ display: "inline", marginRight: 6 }} />
          A working webcam on your laptop or PC is required to take this test — you won't be able to start
          the questions without one.
        </div>

        <form
          onSubmit={e => { e.preventDefault(); setLoginError(""); loginMut.mutate(password); }}
          style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 20 }}
        >
          <div className="tiq-form-group">
            <label className="tiq-label">Email</label>
            <input className="tiq-input" value={data.candidateEmail || ""} disabled />
          </div>
          <div className="tiq-form-group">
            <label className="tiq-label">Password</label>
            <input
              className="tiq-input" type="password" autoFocus
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder="From your invitation email"
            />
          </div>
          {loginError && (
            <div style={{ fontSize: 12.5, color: "#e11d48", marginBottom: 10 }}>{loginError}</div>
          )}
          <button className="tiq-btn tiq-btn-primary" type="submit" disabled={loginMut.isPending || !password} style={{ width: "100%", justifyContent: "center" }}>
            <LogIn size={14} /> {loginMut.isPending ? "Logging in…" : "Log In & Start Test"}
          </button>
        </form>
      </div>
    );
  }

  // ── Privacy / consent gate — shown once, immediately after login and
  // before the webcam is ever requested or any question is rendered.
  // Mirrors PublicInterviewPage's consent popup.
  if (!privacyAccepted) {
    return (
      <div style={{ maxWidth: 480, margin: "60px auto", padding: "0 20px" }}>
        <div style={{ background: "#ffffff", color: "#111827", borderRadius: 16, padding: 26, boxShadow: "0 10px 40px rgba(0,0,0,.12)", border: "1px solid #e5e7eb" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <Video size={18} color="#a855f7" />
            <div style={{ fontWeight: 800, fontSize: 17 }}>
              Before you begin{testData.candidateName ? `, ${testData.candidateName}` : ""}
            </div>
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "#374151", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <p style={{ margin: "0 0 10px" }}>
              This assessment requires <strong>webcam access for the full duration of the test</strong>. Once you continue, this
              sitting will:
            </p>
            <ul style={{ margin: "0 0 10px", paddingLeft: 20 }}>
              <li>Require a working webcam — the test questions won't open without one.</li>
              <li>Take periodic still photos from your camera for identity/integrity verification.</li>
              <li>Log tab switches, window focus changes, and copy/paste attempts.</li>
              <li>Be reviewed by recruiters and hiring managers involved in this process.</li>
            </ul>
            <p style={{ margin: 0 }}>
              By continuing, you consent to this camera access, monitoring, and review. Please make sure your laptop
              or PC has a working webcam before you proceed.
            </p>
          </div>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, marginBottom: 16, cursor: "pointer" }}>
            <input type="checkbox" checked={privacyChecked} onChange={e => setPrivacyChecked(e.target.checked)} style={{ marginTop: 2 }} />
            <span>I understand and agree to webcam access, monitoring, and review as described above, and confirm my device has a working webcam.</span>
          </label>
          <button className="tiq-btn tiq-btn-primary" style={{ width: "100%" }} disabled={!privacyChecked} onClick={acceptPrivacy}>
            I Agree — Continue
          </button>
        </div>
      </div>
    );
  }

  // ── Camera gate — the questions never render until the webcam is on.
  if (cameraStatus !== "granted") {
    return (
      <div style={{ maxWidth: 460, margin: "80px auto", padding: "0 20px", textAlign: "center" }}>
        <video ref={videoRef} autoPlay muted playsInline style={{ display: "none" }} />
        {cameraStatus === "denied" ? (
          <>
            <VideoOff size={32} color="#e11d48" style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 16, fontWeight: 700 }}>Webcam access is required</div>
            <div style={{ fontSize: 13, color: "#6b7280", marginTop: 8, marginBottom: 16 }}>
              We couldn't access a camera on this device. Please make sure your laptop/PC has a webcam,
              allow camera permission for this site (check the padlock icon in your address bar), close any
              other app using the camera, then try again. The test questions won't open until your camera is on.
            </div>
            <button className="tiq-btn tiq-btn-primary" disabled={cameraRequesting} onClick={requestCamera}>
              <Video size={14} /> {cameraRequesting ? "Checking camera…" : "Try Again"}
            </button>
          </>
        ) : (
          <>
            <Video size={32} color="#a855f7" style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 16, fontWeight: 700 }}>Checking your webcam…</div>
            <div style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>
              Please allow camera access when your browser prompts you.
            </div>
          </>
        )}
      </div>
    );
  }

  const questions = testData.questions || [];
  const answeredCount = Object.keys(answers).filter(k => answers[Number(k)]?.trim()).length;

  return (
    <div
      style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px 80px" }}
      onContextMenu={e => e.preventDefault()}
    >
      <canvas ref={canvasRef} style={{ display: "none" }} />

      <div style={{
        position: "sticky", top: 0, background: "#fff", zIndex: 10, padding: "16px 0",
        borderBottom: "1px solid #e5e7eb", marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ClipboardCheck size={20} color="#a855f7" />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{testData.roleTitle ? `${testData.roleTitle} — Skills Assessment` : "Skills Assessment"}</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>{answeredCount} / {questions.length} answered</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* Live self-view — deliberately always visible, never hidden
              or minimized, so recording is never happening without the
              candidate being able to see it's happening. */}
          {cameraStatus === "granted" && (
            <div style={{ position: "relative", width: 64, height: 48, borderRadius: 6, overflow: "hidden", border: "1px solid #e5e7eb" }}>
              <video ref={videoRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <span style={{ position: "absolute", top: 3, left: 3, width: 6, height: 6, borderRadius: "50%", background: "#e11d48" }} />
            </div>
          )}
          {cameraStatus === "denied" && (
            <span title="No camera access — this sitting has no photo verification" style={{ color: "#9ca3af" }}>
              <VideoOff size={16} />
            </span>
          )}
          {cameraStatus === "pending" && <Video size={16} color="#9ca3af" />}

          <div style={{
            display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 16,
            color: remaining !== null && remaining < 300 ? "#e11d48" : "#111827",
          }}>
            <Clock size={16} /> {remaining !== null ? formatTime(remaining) : "--:--"}
          </div>
        </div>
      </div>

      {pasteNotice && (
        <div className="tiq-alert tiq-alert-warning" style={{ marginBottom: 16, fontSize: 12.5 }}>
          Pasting isn't allowed for this assessment — please type your own answer.
        </div>
      )}
      {tabSwitchCount > 2 && (
        <div className="tiq-alert tiq-alert-warning" style={{ marginBottom: 16, fontSize: 12.5 }}>
          Leaving this tab is being logged ({tabSwitchCount} times so far) and visible to the recruiter.
        </div>
      )}

      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24 }}>
        Answer as many questions as you can within the time limit. The test auto-submits when time runs out —
        you don't need to click anything for that. You can also press "Finish Test" at any point to submit early. Good luck!
      </p>

      {questions.map((q: any, i: number) => (
        <div key={q.id} style={{ marginBottom: 24, padding: 18, border: "1px solid #e5e7eb", borderRadius: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: 12 }}>
            {i + 1}. {q.questionText}
          </div>
          {q.questionType === "mcq" ? (
            <div>
              {(q.options || []).map((opt: string, idx: number) => (
                <label key={idx} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", cursor: "pointer", fontSize: 13.5 }}>
                  <input
                    type="radio" name={`q-${q.id}`} checked={answers[q.id] === String(idx)}
                    onChange={() => setAnswers(a => ({ ...a, [q.id]: String(idx) }))}
                  />
                  {opt}
                </label>
              ))}
            </div>
          ) : (
            <textarea
              className="tiq-input" rows={4}
              value={answers[q.id] || ""}
              onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
              onPaste={blockClipboard("paste_blocked")}
              onCopy={blockClipboard("copy_blocked")}
              onCut={blockClipboard("copy_blocked")}
              onDrop={e => e.preventDefault()}
              autoComplete="off" autoCorrect="off" spellCheck={false}
              placeholder="Type your answer here — pasted text isn't accepted…"
            />
          )}
        </div>
      ))}

      <div style={{ textAlign: "center", marginTop: 32 }}>
        <button className="tiq-btn tiq-btn-primary" disabled={submitMut.isPending} onClick={doSubmit}>
          {submitMut.isPending ? "Submitting…" : "Finish Test"}
        </button>
        <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>
          You can finish any time — unanswered questions will simply be marked as unanswered.
        </div>
      </div>
    </div>
  );
}
