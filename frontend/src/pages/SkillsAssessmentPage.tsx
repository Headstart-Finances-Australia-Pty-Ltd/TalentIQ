import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Trash2, Sparkles, Send, Copy, X, ChevronRight,
  AlertTriangle, CheckCircle, Clock, PenLine, RefreshCw, Mail, KeyRound, Eye,
} from "lucide-react";
import { skillstestApi, joblensApi, candidateTrackApi } from "../lib/api";

// Aligned with the standard pre-employment assessment taxonomy. Two
// categories from that taxonomy — background/verification checks and
// physical/drug tests — are deliberately NOT here: those are external
// verification processes (records checks, lab results), not something a
// candidate answers their way through in a timed test, so they don't
// belong in this question-based module at all.
const CATEGORIES = ["cognitive_aptitude", "personality_psychometric", "skills_proficiency", "situational_judgment"];
const CATEGORY_LABELS: Record<string, string> = {
  cognitive_aptitude: "Cognitive Aptitude",
  personality_psychometric: "Personality & Psychometric",
  skills_proficiency: "Skills & Proficiency",
  situational_judgment: "Situational Judgment",
};
const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  cognitive_aptitude: "Numerical, verbal, abstract & logical reasoning — problem-solving speed and learning potential.",
  personality_psychometric: "Character traits, soft skills & motivational drivers — cultural fit and behavioral tendencies.",
  skills_proficiency: "Technical know-how — coding challenges, language proficiency, role-specific tasks/case studies.",
  situational_judgment: "Hypothetical workplace scenarios — judgment and conflict resolution.",
};
const APTITUDE_SUBTYPES = ["numerical", "verbal", "abstract", "logical"];
const APTITUDE_SUBTYPE_LABELS: Record<string, string> = {
  numerical: "Numerical Reasoning", verbal: "Verbal Reasoning", abstract: "Abstract Reasoning", logical: "Logical Reasoning",
};
const DIFFICULTIES = ["easy", "medium", "hard"];

function CategoryBadge({ category, aptitudeSubtype }: { category: string; aptitudeSubtype?: string | null }) {
  const colors: Record<string, string> = {
    cognitive_aptitude: "tiq-badge-violet",
    personality_psychometric: "tiq-badge-amber",
    skills_proficiency: "tiq-badge-teal",
    situational_judgment: "tiq-badge-rose",
  };
  const label = CATEGORY_LABELS[category] || category;
  return (
    <span className={`tiq-badge ${colors[category] || "tiq-badge-slate"}`}>
      {label}{aptitudeSubtype ? ` · ${APTITUDE_SUBTYPE_LABELS[aptitudeSubtype] || aptitudeSubtype}` : ""}
    </span>
  );
}

// ── Question Bank tab ─────────────────────────────────────────────────────

function AddQuestionForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [category, setCategory] = useState("skills_proficiency");
  const [aptitudeSubtype, setAptitudeSubtype] = useState("numerical");
  const [questionType, setQuestionType] = useState<"mcq" | "short_answer">("mcq");
  const [questionText, setQuestionText] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [correctIndex, setCorrectIndex] = useState(0);
  const [gradingGuideline, setGradingGuideline] = useState("");
  const [skillTag, setSkillTag] = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [jdRecordId, setJdRecordId] = useState<number | "">("");

  const { data: jds = [] } = useQuery({ queryKey: ["jd-records"], queryFn: candidateTrackApi.listJDs });

  const createMut = useMutation({
    mutationFn: () => skillstestApi.createQuestion({
      category, question_type: questionType, question_text: questionText,
      options: questionType === "mcq" ? options : undefined,
      correct_option_index: questionType === "mcq" ? correctIndex : undefined,
      grading_guideline: questionType === "short_answer" ? gradingGuideline : undefined,
      skill_tag: skillTag, difficulty,
      jd_record_id: jdRecordId || undefined,
      aptitude_subtype: category === "cognitive_aptitude" ? aptitudeSubtype : undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["skillstest-questions"] }); onDone(); },
  });

  const valid = questionText.trim() && skillTag.trim() &&
    (questionType === "short_answer" || options.every(o => o.trim()));

  return (
    <div className="tiq-card" style={{ marginBottom: 16 }}>
      <div className="tiq-card-title">Add Expert Question</div>
      <div className="tiq-grid-2">
        <div className="tiq-form-group">
          <label className="tiq-label">Category</label>
          <select className="tiq-input" value={category} onChange={e => setCategory(e.target.value)}>
            {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
          <div style={{ fontSize: 11.5, color: "#9ca3af", marginTop: 4 }}>{CATEGORY_DESCRIPTIONS[category]}</div>
        </div>
        {category === "cognitive_aptitude" && (
          <div className="tiq-form-group">
            <label className="tiq-label">Reasoning Type</label>
            <select className="tiq-input" value={aptitudeSubtype} onChange={e => setAptitudeSubtype(e.target.value)}>
              {APTITUDE_SUBTYPES.map(s => <option key={s} value={s}>{APTITUDE_SUBTYPE_LABELS[s]}</option>)}
            </select>
          </div>
        )}
        <div className="tiq-form-group">
          <label className="tiq-label">Type</label>
          <select className="tiq-input" value={questionType} onChange={e => setQuestionType(e.target.value as any)}>
            <option value="mcq">Multiple Choice (4 options)</option>
            <option value="short_answer">Short Answer</option>
          </select>
        </div>
        <div className="tiq-form-group">
          <label className="tiq-label">Skill / Topic Tag</label>
          <input className="tiq-input" value={skillTag} onChange={e => setSkillTag(e.target.value)} placeholder="e.g. Python, Leadership, Attention to Detail" />
        </div>
        <div className="tiq-form-group">
          <label className="tiq-label">Difficulty</label>
          <select className="tiq-input" value={difficulty} onChange={e => setDifficulty(e.target.value)}>
            {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="tiq-form-group">
          <label className="tiq-label">Job Description <span style={{ fontWeight: 400, color: "#6b7280" }}>(optional — tag it to prioritize for that role's tests)</span></label>
          <select className="tiq-input" value={jdRecordId} onChange={e => setJdRecordId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">No specific JD (general question)</option>
            {jds.map((jd: any) => <option key={jd.id} value={jd.id}>{jd.jd_title}</option>)}
          </select>
        </div>
      </div>
      <div className="tiq-form-group">
        <label className="tiq-label">Question Text</label>
        <textarea className="tiq-input" rows={2} value={questionText} onChange={e => setQuestionText(e.target.value)} />
      </div>
      {questionType === "mcq" ? (
        <div className="tiq-form-group">
          <label className="tiq-label">Options (select the correct one)</label>
          {options.map((opt, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <input type="radio" checked={correctIndex === i} onChange={() => setCorrectIndex(i)} />
              <input
                className="tiq-input" value={opt}
                onChange={e => setOptions(options.map((o, idx) => idx === i ? e.target.value : o))}
                placeholder={`Option ${i + 1}`}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="tiq-form-group">
          <label className="tiq-label">Grading Guideline <span style={{ fontWeight: 400, color: "#6b7280" }}>(what the AI grader should check for — not exact wording)</span></label>
          <textarea className="tiq-input" rows={3} value={gradingGuideline} onChange={e => setGradingGuideline(e.target.value)} />
        </div>
      )}
      <div className="tiq-flex-end" style={{ gap: 8 }}>
        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={onDone}>Cancel</button>
        <button className="tiq-btn tiq-btn-primary tiq-btn-sm" disabled={!valid || createMut.isPending} onClick={() => createMut.mutate()}>
          {createMut.isPending ? "Saving…" : "Add Question"}
        </button>
      </div>
      {createMut.isError && <div className="tiq-alert tiq-alert-error" style={{ marginTop: 8 }}>Could not save question.</div>}
    </div>
  );
}

function GenerateAiForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [category, setCategory] = useState("skills_proficiency");
  const [aptitudeSubtype, setAptitudeSubtype] = useState("numerical");
  const [questionType, setQuestionType] = useState<"mcq" | "short_answer">("mcq");
  const [skillTag, setSkillTag] = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [count, setCount] = useState(5);
  const [jdRecordId, setJdRecordId] = useState<number | "">("");

  const { data: jds = [] } = useQuery({ queryKey: ["jd-records"], queryFn: candidateTrackApi.listJDs });

  const genMut = useMutation({
    mutationFn: () => skillstestApi.generateAiQuestions({
      category, question_type: questionType, skill_tag: skillTag, difficulty, count,
      jd_record_id: jdRecordId,
      aptitude_subtype: category === "cognitive_aptitude" ? aptitudeSubtype : undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["skillstest-questions"] }); onDone(); },
  });

  return (
    <div className="tiq-card" style={{ marginBottom: 16, background: "rgba(168,85,247,.06)", border: "1px solid rgba(168,85,247,.25)" }}>
      <div className="tiq-card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Sparkles size={15} color="#a855f7" /> Generate Questions with AI
      </div>
      <div className="tiq-grid-2">
        <div className="tiq-form-group" style={{ gridColumn: "1 / -1" }}>
          <label className="tiq-label">Job Description <span style={{ fontWeight: 400, color: "#e11d48" }}>(required — questions are always generated to match this JD)</span></label>
          <select className="tiq-input" value={jdRecordId} onChange={e => setJdRecordId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Select a JD from JD Management…</option>
            {jds.map((jd: any) => <option key={jd.id} value={jd.id}>{jd.jd_title}</option>)}
          </select>
          {jds.length === 0 && (
            <div style={{ fontSize: 12, color: "#e11d48", marginTop: 6 }}>
              No job descriptions found — add one in JD Management first.
            </div>
          )}
        </div>
        <div className="tiq-form-group">
          <label className="tiq-label">Category</label>
          <select className="tiq-input" value={category} onChange={e => setCategory(e.target.value)}>
            {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
          <div style={{ fontSize: 11.5, color: "#9ca3af", marginTop: 4 }}>{CATEGORY_DESCRIPTIONS[category]}</div>
        </div>
        {category === "cognitive_aptitude" && (
          <div className="tiq-form-group">
            <label className="tiq-label">Reasoning Type <span style={{ fontWeight: 400, color: "#e11d48" }}>(required)</span></label>
            <select className="tiq-input" value={aptitudeSubtype} onChange={e => setAptitudeSubtype(e.target.value)}>
              {APTITUDE_SUBTYPES.map(s => <option key={s} value={s}>{APTITUDE_SUBTYPE_LABELS[s]}</option>)}
            </select>
          </div>
        )}
        <div className="tiq-form-group">
          <label className="tiq-label">Type</label>
          <select className="tiq-input" value={questionType} onChange={e => setQuestionType(e.target.value as any)}>
            <option value="mcq">Multiple Choice</option>
            <option value="short_answer">Short Answer</option>
          </select>
        </div>
        <div className="tiq-form-group">
          <label className="tiq-label">Skill / Topic</label>
          <input className="tiq-input" value={skillTag} onChange={e => setSkillTag(e.target.value)} placeholder="e.g. SQL, Teamwork, Prioritization under pressure" />
        </div>
        <div className="tiq-form-group">
          <label className="tiq-label">Difficulty</label>
          <select className="tiq-input" value={difficulty} onChange={e => setDifficulty(e.target.value)}>
            {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="tiq-form-group">
          <label className="tiq-label">How many</label>
          <input className="tiq-input" type="number" min={1} max={20} value={count} onChange={e => setCount(Number(e.target.value))} />
        </div>
      </div>
      <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 10px" }}>
        Tip: run this a few times per skill — a bigger, more varied bank for this JD means each candidate is more likely to get a genuinely different set of questions.
      </p>
      <div className="tiq-flex-end" style={{ gap: 8 }}>
        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={onDone}>Cancel</button>
        <button
          className="tiq-btn tiq-btn-primary tiq-btn-sm"
          disabled={!skillTag.trim() || !jdRecordId || genMut.isPending}
          onClick={() => genMut.mutate()}
        >
          <Sparkles size={14} /> {genMut.isPending ? "Generating…" : `Generate ${count}`}
        </button>
      </div>
      {genMut.isError && (
        <div className="tiq-alert tiq-alert-error" style={{ marginTop: 8 }}>
          {(genMut.error as any)?.response?.data?.detail || "Generation failed."}
        </div>
      )}
    </div>
  );
}

function QuestionBankTab() {
  const [showAdd, setShowAdd] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [filterCategory, setFilterCategory] = useState("");
  const qc = useQueryClient();

  const { data: questions = [], isLoading } = useQuery({
    queryKey: ["skillstest-questions", filterCategory],
    queryFn: () => skillstestApi.listQuestions(filterCategory ? { category: filterCategory } : undefined),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => skillstestApi.deleteQuestion(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skillstest-questions"] }),
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <select className="tiq-input" style={{ maxWidth: 200 }} value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => { setShowGenerate(v => !v); setShowAdd(false); }}>
            <Sparkles size={14} /> Generate with AI
          </button>
          <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={() => { setShowAdd(v => !v); setShowGenerate(false); }}>
            <Plus size={14} /> Add Question
          </button>
        </div>
      </div>

      {showAdd && <AddQuestionForm onDone={() => setShowAdd(false)} />}
      {showGenerate && <GenerateAiForm onDone={() => setShowGenerate(false)} />}

      <div className="tiq-table-wrap">
        <table className="tiq-table">
          <thead>
            <tr><th>Question</th><th>Category</th><th>Type</th><th>Skill</th><th>Difficulty</th><th>JD</th><th>Source</th><th></th></tr>
          </thead>
          <tbody>
            {!isLoading && questions.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", color: "#6b7280", padding: 24 }}>No questions yet — add one or generate with AI.</td></tr>
            )}
            {questions.map((q: any) => (
              <tr key={q.id}>
                <td style={{ maxWidth: 360 }}>{q.questionText}</td>
                <td><CategoryBadge category={q.category} aptitudeSubtype={q.aptitudeSubtype} /></td>
                <td>{q.questionType === "mcq" ? "Multiple Choice" : "Short Answer"}</td>
                <td>{q.skillTag}</td>
                <td>{q.difficulty}</td>
                <td>{q.jdTitle ? <span className="tiq-badge tiq-badge-slate">{q.jdTitle}</span> : <span style={{ color: "#9ca3af" }}>—</span>}</td>
                <td>{q.source === "ai_generated" ? <span className="tiq-badge tiq-badge-violet">AI</span> : <span className="tiq-badge tiq-badge-slate">Expert</span>}</td>
                <td>
                  <Trash2 size={15} style={{ cursor: "pointer" }} color="var(--rose-500, #e11d48)"
                    onClick={() => { if (confirm("Delete this question?")) deleteMut.mutate(q.id); }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Send Invite modal ────────────────────────────────────────────────────
// Same pattern as Video Interview's "Send Interview Invite" modal in
// JobLensPage.tsx: the recruiter can edit subject/body before it goes
// out, but the actual send happens server-side over their own saved
// SMTP credentials. The one difference here is the one-time plaintext
// password — it only exists in memory right after /assign or
// /reset-credentials, so it's baked into the draft body up front rather
// than fetched again on send.
function escapeHtmlForEmail(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function InviteModal({
  assignmentId, candidateName, candidateEmail, roleTitle, link, accessPassword, onClose, onSent,
}: {
  assignmentId: number; candidateName: string; candidateEmail: string; roleTitle: string;
  link: string; accessPassword: string; onClose: () => void; onSent: () => void;
}) {
  const [toEmail, setToEmail] = useState(candidateEmail || "");
  const [subject, setSubject] = useState(`Skills Assessment Invitation${roleTitle ? ` — ${roleTitle}` : ""}`);
  const [body, setBody] = useState(
`Dear ${candidateName || "Candidate"},

As the next step in our recruitment process${roleTitle ? ` for the ${roleTitle} role` : ""}, please complete the online skills assessment below.

Login link: ${link}
Email: ${toEmail}
Password: ${accessPassword}

Important: please take this assessment on a laptop or PC with a working webcam. Camera access is required — the test questions will not open until your camera is on.

The timer starts as soon as you log in, so please make sure you have a quiet block of uninterrupted time before you begin. You can press "Finish Test" at any point to submit early — otherwise it will submit automatically, with whatever you've answered so far, when time runs out.

Regards,
HR Team`
  );
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    setSending(true);
    setSendError("");
    try {
      let html = escapeHtmlForEmail(body);
      const escapedLink = escapeHtmlForEmail(link);
      html = html.split(escapedLink).join(`<a href="${link}" target="_blank" rel="noopener noreferrer">${link}</a>`);
      html = html.replace(/\n/g, "<br/>");
      const body_html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827;">${html}</div>`;

      await skillstestApi.sendAssignmentInvite(assignmentId, { to_email: toEmail, subject, body_html });
      setSent(true);
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
            <Mail size={15} style={{ display: "inline", marginRight: 6, color: "#a855f7" }} />
            Send Skills Assessment Invite
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#6b7280" }}>×</button>
        </div>

        {sent ? (
          <div style={{ padding: "20px 0", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#a855f7", marginBottom: 8 }}>
              ✅ Invite sent to {toEmail}
            </div>
            <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            <div className="tiq-alert tiq-alert-info" style={{ fontSize: 12, marginBottom: 12 }}>
              <KeyRound size={13} style={{ display: "inline", marginRight: 6 }} />
              This password is shown once — if you close this without sending, use "Resend Invite" from the list to generate a new one.
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">To</label>
              <input className="tiq-input" value={toEmail} onChange={e => setToEmail(e.target.value)} />
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">Subject</label>
              <input className="tiq-input" value={subject} onChange={e => setSubject(e.target.value)} />
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">Message</label>
              <textarea className="tiq-input" rows={12} value={body} onChange={e => setBody(e.target.value)} />
            </div>
            {sendError && <div style={{ fontSize: 12.5, color: "#e11d48", marginBottom: 10 }}>{sendError}</div>}
            <div className="tiq-flex-end" style={{ gap: 8 }}>
              <button className="tiq-btn tiq-btn-ghost" onClick={onClose}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" disabled={sending || !toEmail} onClick={handleSend}>
                <Send size={14} /> {sending ? "Sending…" : "Send Invite"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Assign Test tab ───────────────────────────────────────────────────────

function AssignTestTab() {
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [candidateId, setCandidateId] = useState<number | null>(null);
  const [duration, setDuration] = useState(60);
  const [expiryDays, setExpiryDays] = useState(7);
  const [resultLink, setResultLink] = useState<string | null>(null);
  const [assignedId, setAssignedId] = useState<number | null>(null);
  const [questionCount, setQuestionCount] = useState<number | null>(null);
  const [accessPassword, setAccessPassword] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  const { data: sessions = [] } = useQuery({ queryKey: ["joblens-sessions"], queryFn: joblensApi.listSessions });
  const { data: sessionDetail } = useQuery({
    queryKey: ["joblens-session", sessionId],
    queryFn: () => joblensApi.getSession(sessionId as number),
    enabled: !!sessionId,
  });

  const assignMut = useMutation({
    mutationFn: () => skillstestApi.assignTest({
      joblens_candidate_id: candidateId, duration_minutes: duration, invite_expiry_days: expiryDays,
    }),
    onSuccess: (a: any) => {
      setResultLink(`${window.location.origin}/assessment/${a.token}`);
      setAssignedId(a.id);
      setQuestionCount(a.questionCount);
      setAccessPassword(a.accessPassword);
    },
  });

  const regenerateMut = useMutation({
    mutationFn: () => skillstestApi.regenerateAssignment(assignedId as number),
    onSuccess: (a: any) => setQuestionCount(a.questionCount),
  });

  const candidates = sessionDetail?.candidates || [];
  const selectedCandidate = candidates.find((c: any) => c.id === candidateId);

  return (
    <div className="tiq-card">
      <div className="tiq-grid-2">
        <div className="tiq-form-group">
          <label className="tiq-label">JobLens Session</label>
          <select className="tiq-input" value={sessionId || ""} onChange={e => { setSessionId(Number(e.target.value) || null); setCandidateId(null); setResultLink(null); setAssignedId(null); setQuestionCount(null); }}>
            <option value="">Select a session…</option>
            {sessions.map((s: any) => (
              <option key={s.id} value={s.id}>{s.jd_preview || `Session #${s.sequence_number}`}</option>
            ))}
          </select>
        </div>
        <div className="tiq-form-group">
          <label className="tiq-label">Candidate</label>
          <select className="tiq-input" value={candidateId || ""} disabled={!sessionId} onChange={e => { setCandidateId(Number(e.target.value) || null); setResultLink(null); setAssignedId(null); setQuestionCount(null); }}>
            <option value="">Select a candidate…</option>
            {candidates.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name} ({c.email || "no email"}) — {c.ats_score}%</option>
            ))}
          </select>
        </div>
        <div className="tiq-form-group">
          <label className="tiq-label">Duration (minutes)</label>
          <input className="tiq-input" type="number" min={10} max={180} value={duration} onChange={e => setDuration(Number(e.target.value))} />
        </div>
        <div className="tiq-form-group">
          <label className="tiq-label">Invite link expires in (days)</label>
          <input className="tiq-input" type="number" min={1} max={30} value={expiryDays} onChange={e => setExpiryDays(Number(e.target.value))} />
        </div>
      </div>

      {sessionId && (
        <div className="tiq-alert tiq-alert-info" style={{ marginBottom: 12, fontSize: 12.5 }}>
          Questions tagged to this role's JD (Question Bank → generated or tagged against the matching JD Management entry) are prioritized first when assembling this test — generic bank questions only fill in any remaining time.
        </div>
      )}

      {assignMut.isError && (
        <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 12 }}>
          {(assignMut.error as any)?.response?.data?.detail || "Could not assign test."}
        </div>
      )}

      {resultLink && (
        <div className="tiq-alert tiq-alert-success" style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}><CheckCircle size={14} style={{ display: "inline", marginRight: 6 }} />Test assigned ({questionCount} questions) — send this link and password to the candidate:</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input className="tiq-input" readOnly value={resultLink} onClick={e => (e.target as HTMLInputElement).select()} />
            <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => navigator.clipboard.writeText(resultLink)}>
              <Copy size={14} /> Copy
            </button>
          </div>
          {accessPassword && (
            <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <KeyRound size={14} color="#a855f7" />
              <input className="tiq-input" readOnly value={accessPassword} onClick={e => (e.target as HTMLInputElement).select()} style={{ maxWidth: 220 }} />
              <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => navigator.clipboard.writeText(accessPassword)}>
                <Copy size={14} /> Copy
              </button>
              <span style={{ fontSize: 11.5, color: "#6b7280" }}>Shown once — the candidate logs in with their email + this password, which starts their timer.</span>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={() => setShowInvite(true)}>
              <Mail size={13} /> Send Invite Email
            </button>
            <button
              className="tiq-btn tiq-btn-ghost tiq-btn-sm"
              disabled={regenerateMut.isPending}
              onClick={() => regenerateMut.mutate()}
            >
              <RefreshCw size={13} /> {regenerateMut.isPending ? "Drawing a new set…" : "Refresh — draw a different set of questions"}
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 4 }}>
            Same link, freshly randomized questions — only works before the candidate opens it.
          </div>
          {regenerateMut.isError && (
            <div style={{ fontSize: 12, color: "#e11d48", marginTop: 6 }}>
              {(regenerateMut.error as any)?.response?.data?.detail || "Could not regenerate."}
            </div>
          )}
        </div>
      )}

      <div className="tiq-flex-end">
        <button className="tiq-btn tiq-btn-primary" disabled={!candidateId || assignMut.isPending} onClick={() => assignMut.mutate()}>
          <Send size={14} /> {assignMut.isPending ? "Assigning…" : "Assign Test & Generate Link"}
        </button>
      </div>

      {showInvite && assignedId && resultLink && (
        <InviteModal
          assignmentId={assignedId}
          candidateName={selectedCandidate?.name || ""}
          candidateEmail={selectedCandidate?.email || ""}
          roleTitle={sessionDetail?.jd_role || ""}
          link={resultLink}
          accessPassword={accessPassword || ""}
          onClose={() => setShowInvite(false)}
          onSent={() => setShowInvite(false)}
        />
      )}
    </div>
  );
}

// ── Results tab ───────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, { cls: string; label: string }> = {
    not_started: { cls: "tiq-badge-slate", label: "Not Started" },
    in_progress: { cls: "tiq-badge-amber", label: "In Progress" },
    completed: { cls: "tiq-badge-teal", label: "Completed" },
    expired: { cls: "tiq-badge-rose", label: "Expired" },
  };
  const m = map[status] || { cls: "tiq-badge-slate", label: status };
  return <span className={`tiq-badge ${m.cls}`}>{m.label}</span>;
}

function ProctoringSection({ assignmentId, summary }: { assignmentId: number; summary: any }) {
  const { data } = useQuery({
    queryKey: ["skillstest-proctoring-snapshots", assignmentId],
    queryFn: () => skillstestApi.getProctoringSnapshots(assignmentId),
  });
  const snapshots = data?.snapshots || [];
  const flags = [
    summary?.tabSwitchCount > 0 && `${summary.tabSwitchCount} tab switch${summary.tabSwitchCount === 1 ? "" : "es"}`,
    summary?.windowBlurCount > 0 && `${summary.windowBlurCount} window blur${summary.windowBlurCount === 1 ? "" : "s"}`,
    summary?.pasteBlockedCount > 0 && `${summary.pasteBlockedCount} paste attempt${summary.pasteBlockedCount === 1 ? "" : "s"} blocked`,
    summary?.copyBlockedCount > 0 && `${summary.copyBlockedCount} copy/cut attempt${summary.copyBlockedCount === 1 ? "" : "s"} blocked`,
    summary?.cameraDenied && "candidate did not grant camera access",
  ].filter(Boolean);

  return (
    <div className="tiq-card" style={{ marginBottom: 12, background: "rgba(148,163,184,.08)" }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
        <Eye size={13} style={{ display: "inline", marginRight: 6 }} />Integrity Signals
      </div>
      {flags.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "#6b7280" }}>No tab switches, blocked paste attempts, or camera issues logged.</div>
      ) : (
        <ul style={{ fontSize: 12.5, color: "#475569", margin: "0 0 8px 18px", padding: 0 }}>
          {flags.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      )}
      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: snapshots.length ? 8 : 0 }}>
        These are logged, deterrent signals, not proof of misconduct — review alongside the answers themselves.
      </div>
      {snapshots.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {snapshots.map((s: any) => (
            <img
              key={s.id} src={`data:image/jpeg;base64,${s.imageData}`} title={new Date(s.capturedAt).toLocaleTimeString()}
              style={{ width: 56, height: 42, objectFit: "cover", borderRadius: 4, border: "1px solid #e5e7eb" }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ResultsTab() {
  const [openId, setOpenId] = useState<number | null>(null);
  const [inviteFor, setInviteFor] = useState<any | null>(null);
  const [invitePassword, setInvitePassword] = useState<string>("");
  const { data: assignments = [] } = useQuery({ queryKey: ["skillstest-assignments"], queryFn: skillstestApi.listAssignments });
  const { data: detail } = useQuery({
    queryKey: ["skillstest-assignment", openId],
    queryFn: () => skillstestApi.getAssignment(openId as number),
    enabled: !!openId,
  });
  const qc = useQueryClient();
  const deleteMut = useMutation({
    mutationFn: (id: number) => skillstestApi.deleteAssignment(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["skillstest-assignments"] }); setOpenId(null); },
  });
  const regenerateMut = useMutation({
    mutationFn: (id: number) => skillstestApi.regenerateAssignment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skillstest-assignments"] }),
  });
  const resendMut = useMutation({
    // A fresh password every time "Resend" is clicked — the old one
    // (from whenever this was first assigned, or last resent) was never
    // stored anywhere retrievable, by design, so there's nothing to
    // resend but a brand new one.
    mutationFn: (id: number) => skillstestApi.resetAssignmentCredentials(id),
    onSuccess: (r: any, id: number) => {
      const a = assignments.find((x: any) => x.id === id);
      setInvitePassword(r.accessPassword);
      setInviteFor(a);
    },
  });

  return (
    <div>
      <div className="tiq-table-wrap">
        <table className="tiq-table">
          <thead>
            <tr><th>Candidate</th><th>Role</th><th>Status</th><th>Overall Score</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            {assignments.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "#6b7280", padding: 24 }}>No tests assigned yet.</td></tr>
            )}
            {assignments.map((a: any) => (
              <tr key={a.id} style={{ cursor: "pointer" }} onClick={() => setOpenId(a.id)}>
                <td>{a.candidateName}</td>
                <td>{a.roleTitle || "—"}</td>
                <td>{statusBadge(a.status)}{a.inviteSentAt && <span style={{ fontSize: 10.5, color: "#6b7280", marginLeft: 6 }}>invited</span>}</td>
                <td>{a.status === "completed" ? `${Math.round(a.overallScore)}%` : "—"}</td>
                <td>{a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "—"}</td>
                <td onClick={e => e.stopPropagation()} style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  {(a.status === "not_started" || a.status === "in_progress") && (
                    <span title="Resend invite with a new password">
                      <Mail size={15} style={{ cursor: "pointer" }}
                        onClick={() => resendMut.mutate(a.id)} />
                    </span>
                  )}
                  {a.status === "not_started" && (
                    <span title="Draw a different set of questions">
                      <RefreshCw size={15} style={{ cursor: "pointer" }}
                        onClick={() => regenerateMut.mutate(a.id)} />
                    </span>
                  )}
                  <Trash2 size={15} style={{ cursor: "pointer" }} color="var(--rose-500, #e11d48)"
                    onClick={() => { if (confirm("Delete this assignment?")) deleteMut.mutate(a.id); }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {inviteFor && (
        <InviteModal
          assignmentId={inviteFor.id}
          candidateName={inviteFor.candidateName}
          candidateEmail={inviteFor.candidateEmail}
          roleTitle={inviteFor.roleTitle}
          link={`${window.location.origin}/assessment/${inviteFor.token}`}
          accessPassword={invitePassword}
          onClose={() => setInviteFor(null)}
          onSent={() => { setInviteFor(null); qc.invalidateQueries({ queryKey: ["skillstest-assignments"] }); }}
        />
      )}

      {openId && detail && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setOpenId(null)}>
          <div className="tiq-card" style={{ background: "#fff", maxWidth: 700, width: "100%", maxHeight: "85vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{detail.candidateName}</div>
                <div style={{ fontSize: 13, color: "#6b7280" }}>{detail.roleTitle}</div>
              </div>
              <X size={18} style={{ cursor: "pointer" }} onClick={() => setOpenId(null)} />
            </div>

            <ProctoringSection assignmentId={detail.id} summary={detail.proctoringSummary} />

            {detail.status === "completed" ? (
              <>
                <div style={{ display: "flex", gap: 16, margin: "12px 0", flexWrap: "wrap" }}>
                  <div className="tiq-card" style={{ flex: 1, minWidth: 120, textAlign: "center" }}>
                    <div style={{ fontSize: 26, fontWeight: 800, color: "var(--teal-500)" }}>{Math.round(detail.overallScore)}%</div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>Overall</div>
                  </div>
                  {Object.entries(detail.categoryScores || {}).map(([cat, score]: any) => (
                    <div key={cat} className="tiq-card" style={{ flex: 1, minWidth: 120, textAlign: "center" }}>
                      <div style={{ fontSize: 22, fontWeight: 700 }}>{Math.round(score)}%</div>
                      <div style={{ fontSize: 11, color: "#6b7280", textTransform: "capitalize" }}>{cat}</div>
                    </div>
                  ))}
                </div>
                <div className="tiq-card" style={{ background: "rgba(13,148,136,.06)", marginBottom: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>AI Evaluation</div>
                  <div style={{ fontSize: 13.5, marginBottom: 8 }}>{detail.aiSummary}</div>
                  <div style={{ fontSize: 12.5, color: "#475569" }}>{detail.aiReasoning}</div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Per-Question Breakdown</div>
                {(detail.answers || []).map((ans: any) => (
                  <div key={ans.id} className="tiq-card" style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{ans.questionText}</div>
                      <CategoryBadge category={ans.category} aptitudeSubtype={ans.aptitudeSubtype} />
                    </div>
                    <div style={{ fontSize: 12.5, color: "#475569", margin: "6px 0" }}>
                      <strong>Answer:</strong> {ans.questionType === "mcq" ? (ans.options?.[Number(ans.candidateAnswer)] ?? "No answer") : (ans.candidateAnswer || "No answer")}
                    </div>
                    {ans.questionType === "mcq" ? (
                      <div style={{ fontSize: 12, color: ans.isCorrect ? "#10b981" : "#e11d48" }}>
                        {ans.isCorrect ? "✓ Correct" : `✗ Incorrect — correct answer: ${ans.options?.[ans.correctOptionIndex]}`}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12 }}>
                        <span style={{ fontWeight: 700 }}>AI Score: {ans.aiScore != null ? `${Math.round(ans.aiScore)}%` : "Not graded"}</span>
                        {ans.aiReasoning && <div style={{ color: "#6b7280", marginTop: 2 }}>{ans.aiReasoning}</div>}
                      </div>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <div className="tiq-alert tiq-alert-info">
                <Clock size={14} style={{ display: "inline", marginRight: 6 }} />
                {statusBadge(detail.status)} — no evaluation yet.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function SkillsAssessmentPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [tab, setTab] = useState<"bank" | "assign" | "results">("bank");

  // Kept as plain text (not JSX) so both the standalone header and the
  // embedded-only sub-line below can render it without reaching into
  // element props — see the two render paths right below.
  const DESCRIPTION =
    "A 60-minute online test of skills, aptitude, and behavior — AI-generated and expert-authored questions, " +
    "AI-graded with full reasoning. Results are visible to recruiters/admins only, never the candidate.";

  return (
    <div className={embedded ? "" : "tiq-content"}>
      {embedded ? (
        // The description stays even when embedded inside the Screening
        // tab bar (see ScreeningPage.tsx's "skills" tab) — this module
        // has enough of its own context (60-minute timed test, AI-graded,
        // results hidden from candidates) that dropping it would leave
        // the Question Bank/Assign Test/Results sub-tabs below with no
        // explanation of what they belong to. Only the redundant "Skills
        // Assessment" title is skipped here, since the selected tab
        // above already says that.
        <div className="tiq-page-sub" style={{ marginBottom: 20 }}>{DESCRIPTION}</div>
      ) : (
        <div className="tiq-page-header">
          <div className="tiq-page-title">Skills Assessment</div>
          <div className="tiq-page-sub">{DESCRIPTION}</div>
        </div>
      )}

      <div className="tiq-tabs" style={{ marginBottom: 20 }}>
        <button className={`tiq-tab${tab === "bank" ? " active" : ""}`} onClick={() => setTab("bank")}>Question Bank</button>
        <button className={`tiq-tab${tab === "assign" ? " active" : ""}`} onClick={() => setTab("assign")}>Assign Test</button>
        <button className={`tiq-tab${tab === "results" ? " active" : ""}`} onClick={() => setTab("results")}>Results</button>
      </div>

      {tab === "bank" && <QuestionBankTab />}
      {tab === "assign" && <AssignTestTab />}
      {tab === "results" && <ResultsTab />}
    </div>
  );
}
