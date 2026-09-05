import { useEffect, useState } from "react";
import { Gavel, Search, X, Mail, Calendar, Plus, Paperclip, Download, Trash2 } from "lucide-react";
import { interviewApi } from "../lib/api";
import { ResizableFilterHeader } from "../components/ResizableFilterHeader";

// Backend values stay Pending/Selected/Rejected/Hold (see
// capabilities/interview/models.py's DECISION_STATUSES) — "Hold" is
// just LABELED "Review" here, matching how recruiters actually talk
// about it, without a backend rename touching every place that value
// is checked (_apply_decision_side_effects, panel-majority logic, etc).
const DECISION_LABELS: Record<string, string> = { Pending: "Pending", Selected: "Selected", Rejected: "Rejected", Hold: "Review" };
const DECISION_VALUES = ["Pending", "Hold", "Selected", "Rejected"];
const DECISION_COLORS: Record<string, { fg: string; bg: string }> = {
  Pending: { fg: "#64748b", bg: "rgba(100,116,139,.12)" },
  Selected: { fg: "#10b981", bg: "rgba(16,185,129,.12)" },
  Rejected: { fg: "#ef4444", bg: "rgba(239,68,68,.12)" },
  Hold: { fg: "#f59e0b", bg: "rgba(245,158,11,.12)" },
};
const ROUND_STATUS_COLORS: Record<string, string> = {
  Requested: "#64748b", Scheduled: "#0ea5e9", Completed: "#10b981",
  Cancelled: "#ef4444", "No-Show": "#f59e0b", Rescheduled: "#8b5cf6",
};
const INTERVIEW_STATUSES = ["Requested", "Scheduled", "Completed", "Cancelled", "No-Show", "Rescheduled"];
const ROUND_TYPES = ["Phone Interview", "Video Interview", "Panel Interview", "Final Interview", "HR Interview"];
const APPROVAL_LABELS: Record<string, { label: string; fg: string }> = {
  Pending: { label: "Pending", fg: "#64748b" },
  Approved: { label: "✓ Approved", fg: "#10b981" },
  "Not Approved": { label: "✕ Not Approved", fg: "#ef4444" },
};

const DECISION_COL_WIDTHS: Record<string, number> = {
  candidate_name: 170, requisition_role: 180, rounds: 260,
  decision: 130, decision_finalized_at: 130, approval: 170, rejectionEmail: 140,
};

function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text.split(/\n{2,}/).map((para) => `<p>${esc(para).replace(/\n/g, "<br/>")}</p>`).join("");
}

// One row per interview ROUND (from the API) gets grouped here into one
// row per CANDIDATE, since a candidate legitimately has several rounds
// (Phone, Video, Panel…) and showing each as a separate table row was
// both repetitive and made "what's this candidate's overall decision"
// impossible to answer at a glance. Decision/Approval/Rejection-Email
// are all tracked against the LATEST round (most recently scheduled,
// falling back to most recently created) — there's no separate
// "candidate-level" decision entity in the data model, and the latest
// round is the one that's actually still live/relevant.
// Best available date for a round — scheduled_at when it's actually
// set, else updated_at (when its status was last changed, e.g. flipped
// to Completed — a much better proxy for "when this actually happened"
// than created_at, which is just row-insert time and can put rounds in
// a meaningless order if several were created in the same batch).
// created_at is the last-resort fallback so sorting always has SOME
// value to compare, even for a round with no activity at all yet.
function roundDate(r: any): Date | null {
  const raw = r.scheduled_at || r.updated_at || r.created_at || null;
  return raw ? new Date(raw) : null;
}

// Same fallback chain as roundDate above, but as the raw YYYY-MM-DD
// string a <input type="date"> needs — sliced directly from whichever
// ISO string is available rather than round-tripped through a Date
// object, so there's no risk of a timezone shift moving the displayed
// day. Purely a display pre-fill: this does NOT get saved anywhere
// unless the admin actually touches this field (see updateRoundDate),
// so showing an approximate fallback date here can't silently write it
// back as if it were a real scheduled_at.
function roundDateInputValue(r: any): string {
  const raw = r.scheduled_at || r.updated_at || r.created_at || "";
  return raw ? raw.slice(0, 10) : "";
}

function groupByCandidate(rows: any[]) {
  const groups = new Map<string, any>();
  for (const i of rows) {
    const key = i.joblens_candidate_id ? `jl-${i.joblens_candidate_id}` : i.candidate_id ? `c-${i.candidate_id}` : `n-${i.candidate_name}-${i.requisition_id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key, candidate_name: i.candidate_name, requisition_role: i.requisition_role || i.requisition_title || "",
        candidate_id: i.candidate_id, joblens_candidate_id: i.joblens_candidate_id, requisition_id: i.requisition_id,
        rounds: [],
      });
    }
    groups.get(key).rounds.push(i);
  }
  const out = Array.from(groups.values());
  for (const g of out) {
    g.rounds.sort((a: any, b: any) => (roundDate(a)?.getTime() ?? 0) - (roundDate(b)?.getTime() ?? 0));
    // Collapse duplicate rows sharing the same (type, round number) —
    // real data has produced several identical "Phone Interview" rows
    // for one candidate with no round_number to distinguish them (a
    // genuine second Phone Interview round would be round_number 2, not
    // another round_number 1), which is display noise, not a real
    // second round. Keeps the one with the highest id (most recently
    // created) per (type, number) pair, on the reasonable assumption
    // that's the intended, up-to-date one.
    const byKey = new Map<string, any>();
    for (const r of g.rounds) {
      const k = `${r.interview_type}::${r.round_number || 1}`;
      const existing = byKey.get(k);
      if (!existing || (r.id || 0) > (existing.id || 0)) byKey.set(k, r);
    }
    g.rounds = Array.from(byKey.values()).sort(
      (a: any, b: any) => (roundDate(a)?.getTime() ?? 0) - (roundDate(b)?.getTime() ?? 0)
    );
    g.latest = g.rounds[g.rounds.length - 1];
  }
  return out;
}

function getGroupColValue(g: any, key: string): string {
  const latest = g.latest || {};
  switch (key) {
    case "candidate_name": return g.candidate_name || "";
    case "requisition_role": return g.requisition_role || "";
    case "rounds": return g.rounds.map((r: any) => `${r.interview_type} ${r.status}`).join(", ");
    case "decision": return DECISION_LABELS[latest.decision || "Pending"] || latest.decision || "Pending";
    case "decision_finalized_at": return latest.decision_finalized_at ? new Date(latest.decision_finalized_at).toLocaleDateString() : "";
    case "approval": return latest.decision_approval_status && latest.decision_approval_status !== "Pending" ? latest.decision_approval_status : "";
    case "rejectionEmail": return latest.rejection_email_sent_at ? "Sent" : "Not Sent";
    default: return "";
  }
}
const GROUP_COLS = ["candidate_name", "requisition_role", "rounds", "decision", "decision_finalized_at", "approval"];

export default function InterviewDecisionPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [interviews, setInterviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [decisionFilter, setDecisionFilter] = useState("");
  const [savingDecisionId, setSavingDecisionId] = useState<number | null>(null);

  const [colWidths, setColWidths] = useState<Record<string, number>>(DECISION_COL_WIDTHS);
  const setColWidth = (key: string, w: number) => setColWidths((prev) => ({ ...prev, [key]: w }));
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const setColFilter = (key: string, next: Set<string> | undefined) => setColFilters((prev) => { const n = { ...prev }; if (next) n[key] = next; else delete n[key]; return n; });
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  const toggleSort = (col: string) => setSort((prev) => {
    if (!prev || prev.col !== col) return { col, dir: "asc" };
    if (prev.dir === "asc") return { col, dir: "desc" };
    return null;
  });
  const [search, setSearch] = useState("");

  const [selectedForRejection, setSelectedForRejection] = useState<Set<string>>(new Set());
  const [showRejectionComposer, setShowRejectionComposer] = useState(false);
  const [rejectionSubject, setRejectionSubject] = useState("Update on your application");
  const [rejectionBody, setRejectionBody] = useState(
    "Hi {name},\n\n" +
    "Thank you for taking the time to interview with us. We really enjoyed learning about your background and experience.\n\n" +
    "After careful consideration, we've decided to move forward with other candidates for this role. This wasn't an easy " +
    "decision, and it isn't a reflection of your skills or potential.\n\n" +
    "We'll keep your details on file and would love to consider you for future opportunities that may be a better fit. " +
    "We wish you all the very best in your job search.\n\n" +
    "Warm regards,\nThe Hiring Team"
  );
  const [sendingRejection, setSendingRejection] = useState(false);
  const [rejectionResult, setRejectionResult] = useState<{ sent: any[]; failed: any[] } | null>(null);

  const [roundsPopupGroup, setRoundsPopupGroup] = useState<any | null>(null);
  const [approvalPopupGroup, setApprovalPopupGroup] = useState<any | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      // Interview Decision only shows candidates who PASSED Screening
      // Decision — see capabilities/interview/router.py's
      // list_interviews, which stamps screening_passed on every
      // JobLens-linked row (a candidate never screened through JobLens
      // at all — a plain ATS Candidate — has no screening to fail, so
      // those always pass through).
      const all = await interviewApi.list();
      setInterviews(all.filter((i: any) => i.screening_passed !== false));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    setSelectedForRejection(new Set());
    setRejectionResult(null);
  }, [interviews.length]);

  const allGroups = groupByCandidate(interviews);
  const filteredGroups = decisionFilter ? allGroups.filter((g) => (g.latest.decision || "Pending") === decisionFilter) : allGroups;

  const colOptions = (key: string) => Array.from(new Set(filteredGroups.map((g) => getGroupColValue(g, key)))).filter((v) => v !== "").sort();

  const displayGroups = (() => {
    let out = filteredGroups;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((g) => GROUP_COLS.some((k) => getGroupColValue(g, k).toLowerCase().includes(q)));
    }
    for (const [key, val] of Object.entries(colFilters)) {
      if (!val) continue;
      out = out.filter((g) => val.has(getGroupColValue(g, key)));
    }
    if (sort) {
      const { col, dir } = sort;
      out = [...out].sort((a, b) => {
        const cmp = getGroupColValue(a, col).localeCompare(getGroupColValue(b, col));
        return dir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  })();

  const changeDecision = async (round: any, next: string) => {
    setSavingDecisionId(round.id);
    try {
      await interviewApi.setDecision(round.id, next);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Failed to update decision.");
    } finally {
      setSavingDecisionId(null);
    }
  };

  return (
    <div className={embedded ? "" : "tiq-content"}>
      {!embedded && (
        <div className="tiq-page-header">
          <div className="tiq-page-title">Interview Decision</div>
          <div className="tiq-page-sub">One row per candidate — every round they've had, with an overall decision and approval sign-off.</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: embedded ? 0 : 16, marginBottom: 16, alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Decision:</label>
        <select className="tiq-select" style={{ fontSize: 12, padding: "5px 10px" }} value={decisionFilter} onChange={(e) => setDecisionFilter(e.target.value)}>
          <option value="">All</option>
          {DECISION_VALUES.map((d) => <option key={d} value={d}>{DECISION_LABELS[d]}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : filteredGroups.length === 0 ? (
        <div className="tiq-empty">
          <Gavel size={22} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>No candidates{decisionFilter ? ` with decision "${DECISION_LABELS[decisionFilter]}"` : ""} yet.</div>
        </div>
      ) : (
        <div>
          <div style={{ position: "relative", maxWidth: 300, marginBottom: 10 }}>
            <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search candidates…"
              className="tiq-input"
              style={{ paddingLeft: 28, fontSize: 12, height: 32, width: "100%", boxSizing: "border-box" }}
            />
            {search && (
              <X size={13} onClick={() => setSearch("")}
                style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", cursor: "pointer" }} />
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
            {displayGroups.length}{displayGroups.length !== filteredGroups.length ? ` / ${filteredGroups.length}` : ""} candidates
          </div>
          <div style={{ marginBottom: 10 }}>
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
          <div className="tiq-table-wrap">
            <table className="tiq-table" style={{ tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th style={{ width: 32, textAlign: "center" }}>
                    <input
                      type="checkbox"
                      title="Select all visible"
                      checked={displayGroups.length > 0 && displayGroups.every((g) => selectedForRejection.has(g.key))}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedForRejection(new Set(displayGroups.map((g) => g.key)));
                        else setSelectedForRejection(new Set());
                      }}
                    />
                  </th>
                  <th style={{ width: 36 }}>#</th>
                  <ResizableFilterHeader label="Candidate" width={colWidths.candidate_name} onWidthChange={(w) => setColWidth("candidate_name", w)}
                    value={colFilters.candidate_name} options={colOptions("candidate_name")} onChange={(v) => setColFilter("candidate_name", v)}
                    sortDir={sort?.col === "candidate_name" ? sort.dir : null} onSortClick={() => toggleSort("candidate_name")} />
                  <ResizableFilterHeader label="Requisition / Role" width={colWidths.requisition_role} onWidthChange={(w) => setColWidth("requisition_role", w)}
                    value={colFilters.requisition_role} options={colOptions("requisition_role")} onChange={(v) => setColFilter("requisition_role", v)}
                    sortDir={sort?.col === "requisition_role" ? sort.dir : null} onSortClick={() => toggleSort("requisition_role")} />
                  <ResizableFilterHeader label="Rounds" width={colWidths.rounds} onWidthChange={(w) => setColWidth("rounds", w)}
                    value={colFilters.rounds} options={colOptions("rounds")} onChange={(v) => setColFilter("rounds", v)}
                    sortDir={sort?.col === "rounds" ? sort.dir : null} onSortClick={() => toggleSort("rounds")} />
                  <ResizableFilterHeader label="Decision" width={colWidths.decision} onWidthChange={(w) => setColWidth("decision", w)}
                    value={colFilters.decision} options={colOptions("decision")} onChange={(v) => setColFilter("decision", v)}
                    sortDir={sort?.col === "decision" ? sort.dir : null} onSortClick={() => toggleSort("decision")} />
                  <ResizableFilterHeader label="Decision Date" width={colWidths.decision_finalized_at} onWidthChange={(w) => setColWidth("decision_finalized_at", w)}
                    value={colFilters.decision_finalized_at} options={colOptions("decision_finalized_at")} onChange={(v) => setColFilter("decision_finalized_at", v)}
                    sortDir={sort?.col === "decision_finalized_at" ? sort.dir : null} onSortClick={() => toggleSort("decision_finalized_at")} />
                  <ResizableFilterHeader label="Approval" width={colWidths.approval} onWidthChange={(w) => setColWidth("approval", w)}
                    value={colFilters.approval} options={colOptions("approval")} onChange={(v) => setColFilter("approval", v)}
                    sortDir={sort?.col === "approval" ? sort.dir : null} onSortClick={() => toggleSort("approval")} />
                  <ResizableFilterHeader label="Rejection Email" width={colWidths.rejectionEmail} onWidthChange={(w) => setColWidth("rejectionEmail", w)}
                    value={colFilters.rejectionEmail} options={colOptions("rejectionEmail")} onChange={(v) => setColFilter("rejectionEmail", v)}
                    sortDir={sort?.col === "rejectionEmail" ? sort.dir : null} onSortClick={() => toggleSort("rejectionEmail")} />
                </tr>
              </thead>
              <tbody>
                {displayGroups.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: "center", padding: 28, color: "var(--text-muted)" }}>
                      No candidates match the current search/filters.
                    </td>
                  </tr>
                )}
                {displayGroups.map((g, idx) => {
                  const latest = g.latest;
                  const currentDecision = latest.decision || "Pending";
                  const dc = DECISION_COLORS[currentDecision] || DECISION_COLORS.Pending;
                  const panelLocked = latest.interview_type === "Panel Interview" && (latest.interviewers || []).length >= 2;
                  const appr = APPROVAL_LABELS[latest.decision_approval_status || "Pending"];
                  return (
                    <tr key={g.key}>
                      <td style={{ textAlign: "center" }}>
                        <input type="checkbox" checked={selectedForRejection.has(g.key)}
                          onChange={() => setSelectedForRejection((prev) => {
                            const next = new Set(prev);
                            if (next.has(g.key)) next.delete(g.key); else next.add(g.key);
                            return next;
                          })} />
                      </td>
                      <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{idx + 1}</td>
                      <td style={{ fontWeight: 600, fontSize: 13 }}>{g.candidate_name}</td>
                      <td style={{ fontSize: 12 }}>{g.requisition_role || "—"}</td>
                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                          {g.rounds.slice(0, 3).map((r: any) => {
                            const d = roundDate(r);
                            return (
                              <span key={r.id} title={d ? d.toLocaleString() : "Not yet scheduled"}
                                style={{
                                  fontSize: 10.5, fontWeight: 600, padding: "2px 7px", borderRadius: 999,
                                  background: "var(--slate-100, #f1f5f9)", color: ROUND_STATUS_COLORS[r.status] || "#64748b",
                                  whiteSpace: "nowrap",
                                }}>
                                {r.interview_type}: {r.status}{d ? ` (${d.toLocaleDateString()})` : ""}
                              </span>
                            );
                          })}
                          {g.rounds.length > 3 && (
                            <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>+{g.rounds.length - 3} more</span>
                          )}
                          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" style={{ padding: "1px 6px", fontSize: 10 }}
                            onClick={() => setRoundsPopupGroup(g)}>
                            <Calendar size={10} style={{ marginRight: 3 }} />Manage
                          </button>
                        </div>
                      </td>
                      <td>
                        <select
                          value={currentDecision}
                          disabled={panelLocked || savingDecisionId === latest.id}
                          onChange={(e) => changeDecision(latest, e.target.value)}
                          title={panelLocked ? "This round has 2+ interviewers — its decision is determined by panel majority scorecards." : "Change decision"}
                          style={{
                            fontSize: 11.5, fontWeight: 700, color: dc.fg, background: dc.bg, border: "none",
                            padding: "3px 6px", borderRadius: 8, cursor: panelLocked ? "not-allowed" : "pointer",
                          }}
                        >
                          {DECISION_VALUES.map((v) => <option key={v} value={v}>{DECISION_LABELS[v]}</option>)}
                        </select>
                      </td>
                      <td style={{ fontSize: 12 }}>{latest.decision_finalized_at ? new Date(latest.decision_finalized_at).toLocaleDateString() : "—"}</td>
                      <td>
                        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" style={{ padding: "2px 6px", fontSize: 11, color: appr.fg, fontWeight: 700 }}
                          onClick={() => setApprovalPopupGroup(g)}>
                          {appr.label}
                        </button>
                        {latest.decision_approved_by && (
                          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                            by {latest.decision_approved_by}{latest.decision_approved_at ? ` on ${new Date(latest.decision_approved_at).toLocaleDateString()}` : ""}
                          </div>
                        )}
                        {(latest.decision_approvers || []).length > 0 && (
                          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                            {(latest.decision_approvers || []).filter((a: any) => a.status === "Pending").length > 0
                              ? `${(latest.decision_approvers || []).filter((a: any) => a.status === "Pending").length} online request(s) pending`
                              : `${(latest.decision_approvers || []).length} online approver(s) responded`}
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: 11.5 }}>
                        {latest.rejection_email_sent_at ? (
                          <span style={{ color: "#ef4444", fontWeight: 700 }}>
                            Sent Rejection Letter<br />
                            <span style={{ fontWeight: 400, color: "var(--text-muted)", fontSize: 10.5 }}>
                              {new Date(latest.rejection_email_sent_at).toLocaleDateString()}
                            </span>
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>Not sent</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Manage Rounds popup ──────────────────────────────────────── */}
      {roundsPopupGroup && (
        <RoundsPopup
          group={roundsPopupGroup}
          onClose={() => setRoundsPopupGroup(null)}
          onChanged={async () => { await load(); }}
        />
      )}

      {/* ── Approval popup ───────────────────────────────────────────── */}
      {approvalPopupGroup && (
        <ApprovalPopup
          round={approvalPopupGroup.latest}
          candidateName={approvalPopupGroup.candidate_name}
          onClose={() => setApprovalPopupGroup(null)}
          onSaved={async () => { await load(); setApprovalPopupGroup(null); }}
        />
      )}

      {/* ── Send Rejection Email popup ───────────────────────────────── */}
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
                        const firstKey = Array.from(selectedForRejection)[0];
                        const g = allGroups.find((gr) => gr.key === firstKey);
                        return (g?.candidate_name || "").split(" ")[0] || "there";
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
                        const ids = Array.from(selectedForRejection)
                          .map((key) => allGroups.find((g) => g.key === key)?.latest?.id)
                          .filter((id): id is number => !!id);
                        const res = await interviewApi.sendInterviewRejectionEmails({
                          interview_ids: ids,
                          subject: rejectionSubject.trim(),
                          body_html_template: textToHtml(rejectionBody),
                        });
                        setRejectionResult(res);
                        setSelectedForRejection(new Set());
                        await load();
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
                      <div key={i} style={{ fontSize: 12 }}>{f.name || `#${f.interview_id}`} — {f.error}</div>
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

// ── Manage Rounds popup — edit an existing round's status/date, or add
// a brand-new round for this candidate. ─────────────────────────────
function RoundsPopup({ group, onClose, onChanged }: { group: any; onClose: () => void; onChanged: () => Promise<void> }) {
  const [savingId, setSavingId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newType, setNewType] = useState(ROUND_TYPES[0]);
  const [newDate, setNewDate] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const updateRoundDate = async (round: any, dateStr: string) => {
    setSavingId(round.id);
    try {
      await interviewApi.update(round.id, { scheduled_at: dateStr ? new Date(dateStr).toISOString() : null });
      await onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Failed to update date.");
    } finally {
      setSavingId(null);
    }
  };
  const updateRoundStatus = async (round: any, status: string) => {
    setSavingId(round.id);
    try {
      await interviewApi.changeStatus(round.id, status);
      await onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Failed to update status.");
    } finally {
      setSavingId(null);
    }
  };
  const updateRoundType = async (round: any, type: string) => {
    setSavingId(round.id);
    try {
      await interviewApi.update(round.id, { interview_type: type, round_name: type });
      await onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Failed to change round type.");
    } finally {
      setSavingId(null);
    }
  };
  const deleteRound = async (round: any) => {
    if (!confirm(`Delete this ${round.interview_type || "interview"} round? This cannot be undone.`)) return;
    setSavingId(round.id);
    try {
      await interviewApi.remove(round.id);
      await onChanged();
      // If that was the last remaining round for this candidate, the
      // group no longer exists after refresh — close the popup instead
      // of leaving it open on an empty list with nothing left to manage.
      if (group.rounds.length <= 1) onClose();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Failed to delete this round.");
    } finally {
      setSavingId(null);
    }
  };
  const addRound = async () => {
    setAdding(true);
    setError("");
    try {
      // A second round of a type that's already here gets round_number
      // 2 (3, 4…) automatically — same type, genuinely a NEW round, not
      // an accidental duplicate of an existing one at number 1. That's
      // exactly the distinction the display-side dedup above relies on.
      const sameTypeCount = group.rounds.filter((r: any) => r.interview_type === newType).length;
      await interviewApi.create({
        candidate_id: group.candidate_id || undefined,
        joblens_candidate_id: group.joblens_candidate_id || undefined,
        requisition_id: group.requisition_id || undefined,
        round_name: newType,
        interview_type: newType,
        round_number: sameTypeCount + 1,
        scheduled_at: newDate ? new Date(newDate).toISOString() : undefined,
      });
      setShowAdd(false);
      setNewDate("");
      await onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Failed to add round.");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#ffffff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 480, width: "94%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,.4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Rounds — {group.candidate_name}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>
        {error && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 10, fontSize: 12 }}>{error}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          {group.rounds.map((r: any) => (
            <div key={r.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <select value={r.interview_type} disabled={savingId === r.id} onChange={(e) => updateRoundType(r, e.target.value)}
                  style={{ fontSize: 13, fontWeight: 700, padding: "3px 6px", borderRadius: 6, border: "1px solid #e5e7eb", flex: 1 }}>
                  {ROUND_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {r.round_number > 1 && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>#{r.round_number}</span>}
                <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" style={{ padding: "2px 6px", color: "#ef4444" }}
                        disabled={savingId === r.id} title="Delete this round" onClick={() => deleteRound(r)}>
                  <Trash2 size={13} />
                </button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <select value={r.status} disabled={savingId === r.id} onChange={(e) => updateRoundStatus(r, e.target.value)}
                  style={{ fontSize: 12, padding: "5px 8px", borderRadius: 6, border: "1px solid #e5e7eb", flex: 1 }}>
                  {INTERVIEW_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <input type="date" disabled={savingId === r.id}
                  value={roundDateInputValue(r)}
                  onChange={(e) => updateRoundDate(r, e.target.value)}
                  style={{ fontSize: 12, padding: "5px 8px", borderRadius: 6, border: "1px solid #e5e7eb" }} />
              </div>
            </div>
          ))}
        </div>
        {showAdd ? (
          <div style={{ border: "1px dashed #cbd5e1", borderRadius: 10, padding: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>Add a round</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <select value={newType} onChange={(e) => setNewType(e.target.value)} style={{ fontSize: 12, padding: "5px 8px", borderRadius: 6, border: "1px solid #e5e7eb", flex: 1 }}>
                {ROUND_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
                style={{ fontSize: 12, padding: "5px 8px", borderRadius: 6, border: "1px solid #e5e7eb" }} />
            </div>
            <div className="tiq-flex-end">
              <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => setShowAdd(false)} disabled={adding}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={addRound} disabled={adding}>{adding ? "Adding…" : "Add Round"}</button>
            </div>
          </div>
        ) : (
          <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setShowAdd(true)}>
            <Plus size={12} /> Add Round
          </button>
        )}
      </div>
    </div>
  );
}

// ── Approval popup — records who signed off on the hiring decision,
// when, notes, and an optional attachment kept for future reference. ──
function ApprovalPopup({ round, candidateName, onClose, onSaved }: { round: any; candidateName: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [tab, setTab] = useState<"manual" | "online">("manual");

  const [status, setStatus] = useState(round.decision_approval_status || "Pending");
  const [approvedBy, setApprovedBy] = useState(round.decision_approved_by || "");
  const [approvalDate, setApprovalDate] = useState(round.decision_approved_at ? round.decision_approved_at.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(round.decision_approval_notes || "");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  // Online approvers — see InterviewDecisionApprover. Kept in local
  // state seeded from the round's own data, refreshed via onSaved()
  // (which reloads the whole page's data) after adding/removing one.
  const [approvers, setApprovers] = useState<any[]>(round.decision_approvers || []);
  const [newApproverName, setNewApproverName] = useState("");
  const [newApproverEmail, setNewApproverEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const downloadExisting = async () => {
    setDownloading(true);
    try {
      const blob = await interviewApi.downloadDecisionApprovalAttachment(round.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = round.decision_approval_attachment_filename || "attachment";
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setError("Failed to download attachment.");
    } finally {
      setDownloading(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await interviewApi.setDecisionApproval(round.id, { status, approved_by: approvedBy, approval_date: approvalDate, notes, attachment });
      await onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Failed to save approval.");
    } finally {
      setSaving(false);
    }
  };

  const inviteApprover = async () => {
    if (!newApproverName.trim() || !newApproverEmail.trim()) return;
    setInviting(true);
    setError("");
    try {
      const created = await interviewApi.addDecisionApprover(round.id, { approver_name: newApproverName.trim(), approver_email: newApproverEmail.trim() });
      setApprovers((prev) => [...prev, created]);
      setNewApproverName("");
      setNewApproverEmail("");
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Failed to send approval request.");
    } finally {
      setInviting(false);
    }
  };

  const removeApprover = async (id: number) => {
    setRemovingId(id);
    setError("");
    try {
      await interviewApi.removeDecisionApprover(id);
      setApprovers((prev) => prev.filter((a) => a.id !== id));
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Failed to remove approver.");
    } finally {
      setRemovingId(null);
    }
  };

  const APPROVER_STATUS_COLORS: Record<string, string> = { Pending: "#64748b", Approved: "#10b981", Rejected: "#ef4444" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div style={{ background: "#ffffff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 480, width: "94%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,.4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Approval — {candidateName}</div>
          {!saving && <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>}
        </div>

        {/* Two ways to record an approval: fill it in yourself (Manual),
            or ask someone else to record their own via a tokenized
            emailed link (Online) — see InterviewDecisionApprover. */}
        <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid #e5e7eb" }}>
          <button onClick={() => setTab("manual")}
            style={{
              padding: "8px 14px", fontSize: 12.5, fontWeight: 700, background: "none", border: "none", cursor: "pointer",
              color: tab === "manual" ? "#8b5cf6" : "#64748b", borderBottom: tab === "manual" ? "2px solid #8b5cf6" : "2px solid transparent",
            }}>
            Manual
          </button>
          <button onClick={() => setTab("online")}
            style={{
              padding: "8px 14px", fontSize: 12.5, fontWeight: 700, background: "none", border: "none", cursor: "pointer",
              color: tab === "online" ? "#8b5cf6" : "#64748b", borderBottom: tab === "online" ? "2px solid #8b5cf6" : "2px solid transparent",
            }}>
            Request Online Approval {approvers.length > 0 ? `(${approvers.length})` : ""}
          </button>
        </div>

        {error && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 10, fontSize: 12 }}>{error}</div>}

        {tab === "manual" ? (
          <>
            <div className="tiq-form-group">
              <label className="tiq-label">Status</label>
              <select className="tiq-input" value={status} onChange={(e) => setStatus(e.target.value)} disabled={saving}>
                <option value="Pending">Pending</option>
                <option value="Approved">Approved</option>
                <option value="Not Approved">Not Approved</option>
              </select>
            </div>
            <div className="tiq-grid-2">
              <div className="tiq-form-group">
                <label className="tiq-label">Approved By</label>
                <input className="tiq-input" value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} placeholder="Name" disabled={saving} />
              </div>
              <div className="tiq-form-group">
                <label className="tiq-label">Date</label>
                <input type="date" className="tiq-input" value={approvalDate} onChange={(e) => setApprovalDate(e.target.value)} disabled={saving} />
              </div>
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">Notes</label>
              <textarea className="tiq-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={saving} />
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">Attachment (optional — kept for future reference)</label>
              {round.decision_approval_attachment_filename && !attachment && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 12 }}>
                  <Paperclip size={12} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{round.decision_approval_attachment_filename}</span>
                  <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={downloadExisting} disabled={downloading}>
                    <Download size={11} /> {downloading ? "…" : "Download"}
                  </button>
                </div>
              )}
              <input type="file" onChange={(e) => setAttachment(e.target.files?.[0] || null)} disabled={saving} style={{ fontSize: 12 }} />
              {round.decision_approval_attachment_filename && (
                <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "4px 0 0" }}>Choosing a new file replaces the one above.</p>
              )}
            </div>
            <div className="tiq-flex-end">
              <button className="tiq-btn tiq-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Approval"}</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
              Email someone a link where they record their own Approve/Reject and comments — no login needed on their end.
              You can add more than one approver for the same round; each responds independently.
            </p>
            {approvers.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                {approvers.map((a) => (
                  <div key={a.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{a.approver_name}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{a.approver_email}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: APPROVER_STATUS_COLORS[a.status] || "#64748b" }}>{a.status}</span>
                        {a.decided_at && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{new Date(a.decided_at).toLocaleDateString()}</div>}
                      </div>
                    </div>
                    {a.comments && <div style={{ fontSize: 12, marginTop: 6, color: "#334155", fontStyle: "italic" }}>"{a.comments}"</div>}
                    {a.status === "Pending" && (
                      <div className="tiq-flex-end" style={{ marginTop: 6 }}>
                        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" style={{ color: "#ef4444" }}
                          disabled={removingId === a.id} onClick={() => removeApprover(a.id)}>
                          {removingId === a.id ? "Removing…" : "Remove"}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div style={{ border: "1px dashed #cbd5e1", borderRadius: 10, padding: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>Add an approver</div>
              <div className="tiq-grid-2" style={{ marginBottom: 8 }}>
                <input className="tiq-input" placeholder="Name" value={newApproverName} onChange={(e) => setNewApproverName(e.target.value)} disabled={inviting} />
                <input className="tiq-input" placeholder="Email" type="email" value={newApproverEmail} onChange={(e) => setNewApproverEmail(e.target.value)} disabled={inviting} />
              </div>
              <div className="tiq-flex-end">
                <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={inviteApprover} disabled={inviting || !newApproverName.trim() || !newApproverEmail.trim()}>
                  <Mail size={11} /> {inviting ? "Sending…" : "Send Approval Request"}
                </button>
              </div>
            </div>
            <div className="tiq-flex-end" style={{ marginTop: 16 }}>
              <button className="tiq-btn tiq-btn-ghost" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
