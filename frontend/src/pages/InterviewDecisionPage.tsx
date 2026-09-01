import { useEffect, useState } from "react";
import { Gavel, Search, X } from "lucide-react";
import { interviewApi } from "../lib/api";
import { ResizableFilterHeader } from "../components/ResizableFilterHeader";

const DECISION_COLORS: Record<string, { fg: string; bg: string }> = {
  Pending: { fg: "#64748b", bg: "rgba(100,116,139,.12)" },
  Advance: { fg: "#10b981", bg: "rgba(16,185,129,.12)" },
  Reject: { fg: "#ef4444", bg: "rgba(239,68,68,.12)" },
  Hold: { fg: "#f59e0b", bg: "rgba(245,158,11,.12)" },
};
const APPROVAL_COLORS: Record<string, { fg: string }> = {
  Pending: { fg: "#64748b" },
  Approved: { fg: "#10b981" },
  Cancelled: { fg: "#ef4444" },
};

const DECISION_COL_WIDTHS: Record<string, number> = {
  candidate_name: 170, requisition_role: 180, round: 130, interview_type: 130,
  status: 120, decision: 110, decision_finalized_at: 130, approval_status: 120,
};

// Raw value behind each column — used for the header filter dropdowns,
// sorting, and the global search box. Kept separate from the cell JSX
// (badges, colors) below.
function getDecisionColValue(i: any, key: string): string {
  switch (key) {
    case "candidate_name": return i.candidate_name || "";
    case "requisition_role": return i.requisition_role || i.requisition_title || "";
    case "round": return `${i.round_name || ""}${i.round_number > 1 ? ` #${i.round_number}` : ""}`;
    case "interview_type": return i.interview_type || "";
    case "status": return i.status || "";
    case "decision": return i.decision || "Pending";
    case "decision_finalized_at": return i.decision_finalized_at ? new Date(i.decision_finalized_at).toLocaleDateString() : "";
    case "approval_status": return i.approval_status && i.approval_status !== "Pending" ? i.approval_status : "";
    default: return "";
  }
}
const DECISION_COLS = ["candidate_name", "requisition_role", "round", "interview_type", "status", "decision", "decision_finalized_at", "approval_status"];

// Interview Decision — every interview round across every candidate,
// filtered/sorted around its DECISION rather than its schedule (that's
// Interview Scheduling's job). Same underlying /interviews data, just a
// different lens: "what have we decided, and what's still Pending."
export default function InterviewDecisionPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [interviews, setInterviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [decisionFilter, setDecisionFilter] = useState("");

  // Per-column dropdown filter + sort + a global search box — same
  // pattern as Interview Scheduling's pipeline table.
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

  const load = async () => {
    setLoading(true);
    try {
      setInterviews(await interviewApi.list());
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const filtered = (decisionFilter ? interviews.filter((i) => (i.decision || "Pending") === decisionFilter) : interviews)
    .map((i) => ({ ...i, round: `${i.round_name}${i.round_number > 1 ? ` #${i.round_number}` : ""}` }));

  const colOptions = (key: string) => Array.from(new Set(filtered.map((i) => getDecisionColValue(i, key)))).filter((v) => v !== "").sort();

  const displayRows = (() => {
    let out = filtered;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((i) => DECISION_COLS.some((k) => getDecisionColValue(i, k).toLowerCase().includes(q)));
    }
    for (const [key, val] of Object.entries(colFilters)) {
      if (!val) continue;
      out = out.filter((i) => val.has(getDecisionColValue(i, key)));
    }
    if (sort) {
      const { col, dir } = sort;
      out = [...out].sort((a, b) => {
        const cmp = getDecisionColValue(a, col).localeCompare(getDecisionColValue(b, col));
        return dir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  })();

  return (
    <div className={embedded ? "" : "tiq-content"}>
      {!embedded && (
        <div className="tiq-page-header">
          <div className="tiq-page-title">Interview Decision</div>
          <div className="tiq-page-sub">Every round's decision, in one place — regardless of stage or schedule.</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: embedded ? 0 : 16, marginBottom: 16, alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Decision:</label>
        <select className="tiq-select" style={{ fontSize: 12, padding: "5px 10px" }} value={decisionFilter} onChange={(e) => setDecisionFilter(e.target.value)}>
          <option value="">All</option>
          {Object.keys(DECISION_COLORS).map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="tiq-empty">
          <Gavel size={22} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>No interview rounds{decisionFilter ? ` with decision "${decisionFilter}"` : ""} yet.</div>
        </div>
      ) : (
        <div>
          <div style={{ position: "relative", maxWidth: 300, marginBottom: 10 }}>
            <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search decisions…"
              className="tiq-input"
              style={{ paddingLeft: 28, fontSize: 12, height: 32, width: "100%", boxSizing: "border-box" }}
            />
            {search && (
              <X size={13} onClick={() => setSearch("")}
                style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", cursor: "pointer" }} />
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
            {displayRows.length}{displayRows.length !== filtered.length ? ` / ${filtered.length}` : ""} rounds
          </div>
          <div className="tiq-table-wrap">
            <table className="tiq-table" style={{ tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <ResizableFilterHeader label="Candidate" width={colWidths.candidate_name} onWidthChange={(w) => setColWidth("candidate_name", w)}
                    value={colFilters.candidate_name} options={colOptions("candidate_name")} onChange={(v) => setColFilter("candidate_name", v)}
                    sortDir={sort?.col === "candidate_name" ? sort.dir : null} onSortClick={() => toggleSort("candidate_name")} />
                  <ResizableFilterHeader label="Requisition / Role" width={colWidths.requisition_role} onWidthChange={(w) => setColWidth("requisition_role", w)}
                    value={colFilters.requisition_role} options={colOptions("requisition_role")} onChange={(v) => setColFilter("requisition_role", v)}
                    sortDir={sort?.col === "requisition_role" ? sort.dir : null} onSortClick={() => toggleSort("requisition_role")} />
                  <ResizableFilterHeader label="Round" width={colWidths.round} onWidthChange={(w) => setColWidth("round", w)}
                    value={colFilters.round} options={colOptions("round")} onChange={(v) => setColFilter("round", v)}
                    sortDir={sort?.col === "round" ? sort.dir : null} onSortClick={() => toggleSort("round")} />
                  <ResizableFilterHeader label="Type" width={colWidths.interview_type} onWidthChange={(w) => setColWidth("interview_type", w)}
                    value={colFilters.interview_type} options={colOptions("interview_type")} onChange={(v) => setColFilter("interview_type", v)}
                    sortDir={sort?.col === "interview_type" ? sort.dir : null} onSortClick={() => toggleSort("interview_type")} />
                  <ResizableFilterHeader label="Status" width={colWidths.status} onWidthChange={(w) => setColWidth("status", w)}
                    value={colFilters.status} options={colOptions("status")} onChange={(v) => setColFilter("status", v)}
                    sortDir={sort?.col === "status" ? sort.dir : null} onSortClick={() => toggleSort("status")} />
                  <ResizableFilterHeader label="Decision" width={colWidths.decision} onWidthChange={(w) => setColWidth("decision", w)}
                    value={colFilters.decision} options={colOptions("decision")} onChange={(v) => setColFilter("decision", v)}
                    sortDir={sort?.col === "decision" ? sort.dir : null} onSortClick={() => toggleSort("decision")} />
                  <ResizableFilterHeader label="Decision Date" width={colWidths.decision_finalized_at} onWidthChange={(w) => setColWidth("decision_finalized_at", w)}
                    value={colFilters.decision_finalized_at} options={colOptions("decision_finalized_at")} onChange={(v) => setColFilter("decision_finalized_at", v)}
                    sortDir={sort?.col === "decision_finalized_at" ? sort.dir : null} onSortClick={() => toggleSort("decision_finalized_at")} />
                  <ResizableFilterHeader label="Approval" width={colWidths.approval_status} onWidthChange={(w) => setColWidth("approval_status", w)}
                    value={colFilters.approval_status} options={colOptions("approval_status")} onChange={(v) => setColFilter("approval_status", v)}
                    sortDir={sort?.col === "approval_status" ? sort.dir : null} onSortClick={() => toggleSort("approval_status")} />
                </tr>
              </thead>
              <tbody>
                {displayRows.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: "center", padding: 28, color: "var(--text-muted)" }}>
                      No rounds match the current search/filters.
                    </td>
                  </tr>
                )}
                {displayRows.map((i, idx) => {
                  const dc = DECISION_COLORS[i.decision] || DECISION_COLORS.Pending;
                  const ac = APPROVAL_COLORS[i.approval_status] || APPROVAL_COLORS.Pending;
                  return (
                    <tr key={i.id}>
                      <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{idx + 1}</td>
                      <td style={{ fontWeight: 600, fontSize: 13 }}>{i.candidate_name}</td>
                      <td style={{ fontSize: 12 }}>{i.requisition_role || i.requisition_title || "—"}</td>
                      <td style={{ fontSize: 12 }}>{i.round_name}{i.round_number > 1 ? ` #${i.round_number}` : ""}</td>
                      <td style={{ fontSize: 12 }}>{i.interview_type}</td>
                      <td style={{ fontSize: 12 }}>{i.status}</td>
                      <td>
                        <span style={{ fontSize: 11, fontWeight: 700, color: dc.fg, background: dc.bg, padding: "3px 9px", borderRadius: 999 }}>
                          {i.decision || "Pending"}
                        </span>
                      </td>
                      <td style={{ fontSize: 12 }}>{i.decision_finalized_at ? new Date(i.decision_finalized_at).toLocaleDateString() : "—"}</td>
                      <td>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: ac.fg }}>
                          {i.approval_status && i.approval_status !== "Pending" ? (i.approval_status === "Approved" ? "✓ Approved" : "✕ Cancelled") : "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
