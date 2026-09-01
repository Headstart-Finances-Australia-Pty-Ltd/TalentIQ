import { useEffect, useState } from "react";
import {
  Workflow, Plus, X, Trash2, DollarSign, Clock, ChevronDown, History,
  CheckCircle2, AlertTriangle,
} from "lucide-react";
import { pipelineApi, acquisitionApi, requisitionApi } from "../lib/api";
import DataTable from "../components/DataTable";

const OFFER_STATUSES = ["Draft", "Pending Approval", "Approved", "Sent", "Accepted", "Rejected", "Withdrawn", "Expired"];
const OFFER_STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  Draft: { fg: "#64748b", bg: "rgba(100,116,139,.12)" },
  "Pending Approval": { fg: "#f59e0b", bg: "rgba(245,158,11,.12)" },
  Approved: { fg: "#0d9488", bg: "rgba(13,148,136,.12)" },
  Sent: { fg: "#3b82f6", bg: "rgba(59,130,246,.12)" },
  Accepted: { fg: "#10b981", bg: "rgba(16,185,129,.12)" },
  Rejected: { fg: "#ef4444", bg: "rgba(239,68,68,.12)" },
  Withdrawn: { fg: "#94a3b8", bg: "rgba(148,163,184,.12)" },
  Expired: { fg: "#f43f5e", bg: "rgba(244,63,94,.12)" },
};
const PLACEMENT_STATUSES = ["Active", "Guarantee Period", "Completed", "Fell Through", "Replaced"];
const PLACEMENT_STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  Active: { fg: "#0d9488", bg: "rgba(13,148,136,.12)" },
  "Guarantee Period": { fg: "#f59e0b", bg: "rgba(245,158,11,.12)" },
  Completed: { fg: "#10b981", bg: "rgba(16,185,129,.12)" },
  "Fell Through": { fg: "#ef4444", bg: "rgba(239,68,68,.12)" },
  Replaced: { fg: "#8b5cf6", bg: "rgba(139,92,246,.12)" },
};
const STAGE_TYPE_COLORS: Record<string, string> = { active: "#64748b", placed: "#10b981", rejected: "#ef4444" };

export default function PipelinePage({ embedded = false }: { embedded?: boolean } = {}) {
  const [tab, setTab] = useState<"board" | "offers" | "placements">("board");
  const [requisitions, setRequisitions] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [selectedReq, setSelectedReq] = useState<number | "">("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([requisitionApi.list(), acquisitionApi.listCandidates()]).then(([reqs, cands]) => {
      setRequisitions(reqs);
      setCandidates(cands);
      if (reqs.length > 0) setSelectedReq(reqs[0].id);
      setLoading(false);
    });
  }, []);

  return (
    <div className={embedded ? "" : "tiq-content"}>
      {!embedded && (
        <div className="tiq-page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="tiq-page-title">Placements</div>
            <div className="tiq-page-sub">Candidate moves to hired without leaving the system.</div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 16, marginBottom: 16 }}>
        <button className={`tiq-btn tiq-btn-sm ${tab === "board" ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setTab("board")}>
          <Workflow size={13} /> Board
        </button>
        <button className={`tiq-btn tiq-btn-sm ${tab === "offers" ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setTab("offers")}>
          <DollarSign size={13} /> Offers
        </button>
        <button className={`tiq-btn tiq-btn-sm ${tab === "placements" ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setTab("placements")}>
          <CheckCircle2 size={13} /> Placements
        </button>
      </div>

      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : tab === "board" ? (
        <BoardTab requisitions={requisitions} candidates={candidates} selectedReq={selectedReq} setSelectedReq={setSelectedReq} />
      ) : tab === "offers" ? (
        <OffersTab />
      ) : (
        <PlacementsTab />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// BOARD TAB
// ══════════════════════════════════════════════════════════════════════════

function BoardTab({ requisitions, candidates, selectedReq, setSelectedReq }: any) {
  const [board, setBoard] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [submitForm, setSubmitForm] = useState({ candidate_id: "", owner_user_id: "", notes: "" });
  const [submitError, setSubmitError] = useState("");
  const [detailEntry, setDetailEntry] = useState<any | null>(null);

  const loadBoard = async () => {
    if (!selectedReq) { setBoard(null); return; }
    setLoading(true);
    try {
      const res = await pipelineApi.getBoard(Number(selectedReq));
      setBoard(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadBoard(); }, [selectedReq]);

  const handleSubmit = async () => {
    if (!submitForm.candidate_id) { setSubmitError("Select a candidate."); return; }
    setSubmitError("");
    try {
      await pipelineApi.submit({
        candidate_id: Number(submitForm.candidate_id), requisition_id: Number(selectedReq),
        notes: submitForm.notes,
      });
      setShowSubmit(false);
      setSubmitForm({ candidate_id: "", owner_user_id: "", notes: "" });
      await loadBoard();
    } catch (e: any) {
      setSubmitError(e?.response?.data?.detail || "Could not add this candidate to the pipeline.");
    }
  };

  const moveCard = async (entryId: number, stageId: number) => {
    try {
      await pipelineApi.moveStage(entryId, stageId);
      await loadBoard();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not move this candidate.");
    }
  };

  const openDetail = async (entryId: number) => {
    const entry = await pipelineApi.getEntry(entryId);
    setDetailEntry(entry);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <select className="tiq-select" value={selectedReq} onChange={(e) => setSelectedReq(e.target.value ? Number(e.target.value) : "")}>
          <option value="">— Select a requisition —</option>
          {requisitions.map((r: any) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
        {selectedReq && (
          <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={() => setShowSubmit(true)}>
            <Plus size={14} /> Add Candidate to Pipeline
          </button>
        )}
      </div>

      {!selectedReq ? (
        <div className="tiq-empty">Select a requisition to see its pipeline board.</div>
      ) : loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : board ? (
        <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
          {board.stages.map((stage: any) => (
            <div key={stage.id} style={{ minWidth: 260, flex: "0 0 260px" }}>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px",
                borderRadius: 8, marginBottom: 8, background: "rgba(0,0,0,.03)",
                borderLeft: `3px solid ${stage.color || STAGE_TYPE_COLORS[stage.stage_type] || "#64748b"}`,
              }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{stage.name}</span>
                <span className="tiq-badge tiq-badge-slate">{stage.entries.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 60 }}>
                {stage.entries.map((entry: any) => (
                  <div key={entry.id} className="tiq-card" style={{ padding: 12, cursor: "pointer" }} onClick={() => openDetail(entry.id)}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{entry.candidate_name}</div>
                    {entry.offer_count > 0 && (
                      <span className="tiq-badge tiq-badge-teal" style={{ fontSize: 10, marginTop: 4 }}>
                        <DollarSign size={9} style={{ verticalAlign: "middle" }} /> {entry.offer_count} offer{entry.offer_count > 1 ? "s" : ""}
                      </span>
                    )}
                    <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 8 }}>
                      <select
                        className="tiq-select" style={{ fontSize: 11, padding: "4px 6px", width: "100%" }}
                        value={stage.id}
                        onChange={(e) => moveCard(entry.id, Number(e.target.value))}
                      >
                        {board.stages.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* ── Add Candidate to Pipeline Modal ─────────────────────── */}
      {showSubmit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 460, width: "94%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Add Candidate to Pipeline</div>
              <button onClick={() => setShowSubmit(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            {submitError && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 12 }}>{submitError}</div>}
            <div className="tiq-form-group"><label className="tiq-label">Candidate *</label>
              <select className="tiq-select" value={submitForm.candidate_id} onChange={(e) => setSubmitForm({ ...submitForm, candidate_id: e.target.value })}>
                <option value="">— Select candidate —</option>
                {candidates.map((c: any) => <option key={c.id} value={c.id}>{c.full_name} {c.current_title ? `— ${c.current_title}` : ""}</option>)}
              </select></div>
            <div className="tiq-form-group"><label className="tiq-label">Notes</label>
              <textarea className="tiq-input" rows={2} value={submitForm.notes} onChange={(e) => setSubmitForm({ ...submitForm, notes: e.target.value })} /></div>
            <div className="tiq-flex-end">
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setShowSubmit(false)}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" onClick={handleSubmit}>Add to Pipeline</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Entry Detail Modal ───────────────────────────────────── */}
      {detailEntry && <EntryDetailModal entry={detailEntry} onClose={() => setDetailEntry(null)} onChanged={loadBoard} />}
    </div>
  );
}

function EntryDetailModal({ entry, onClose, onChanged }: { entry: any; onClose: () => void; onChanged: () => void }) {
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [showOfferForm, setShowOfferForm] = useState(false);
  const [offerForm, setOfferForm] = useState({ salary_offered: "", salary_currency: "AUD", start_date: "", expiry_date: "", notes: "" });
  const [offerError, setOfferError] = useState("");

  const loadHistory = async () => {
    const h = await pipelineApi.getStageHistory(entry.id);
    setHistory(h);
    setShowHistory(true);
  };

  const submitOffer = async () => {
    try {
      await pipelineApi.createOffer(entry.id, {
        salary_offered: offerForm.salary_offered ? Number(offerForm.salary_offered) : null,
        salary_currency: offerForm.salary_currency,
        start_date: offerForm.start_date ? new Date(offerForm.start_date).toISOString() : null,
        expiry_date: offerForm.expiry_date ? new Date(offerForm.expiry_date).toISOString() : null,
        notes: offerForm.notes,
      });
      setShowOfferForm(false);
      onChanged();
      onClose();
    } catch (e: any) {
      setOfferError(e?.response?.data?.detail || "Could not create offer.");
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Remove ${entry.candidate_name} from this pipeline?`)) return;
    await pipelineApi.deleteEntry(entry.id);
    onChanged();
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 520, width: "94%", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{entry.candidate_name}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
          {entry.requisition_title} — currently in <b>{entry.current_stage_name}</b>
        </div>

        {entry.notes && <div style={{ fontSize: 13, marginBottom: 14 }}>{entry.notes}</div>}

        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={loadHistory}>
            <History size={13} /> Stage History
          </button>
          <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setShowOfferForm(true)}>
            <DollarSign size={13} /> Create Offer
          </button>
          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" style={{ color: "#ef4444", marginLeft: "auto" }} onClick={handleDelete}>
            <Trash2 size={13} /> Remove
          </button>
        </div>

        {showHistory && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Stage History</div>
            {history.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No transitions recorded yet.</div>
            ) : history.map((h) => (
              <div key={h.id} style={{ fontSize: 12, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                {h.from_stage ? `${h.from_stage} → ${h.to_stage}` : `Entered ${h.to_stage}`}
                <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>{new Date(h.changed_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}

        {entry.offers?.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Offers</div>
            {entry.offers.map((o: any) => {
              const colors = OFFER_STATUS_COLORS[o.status] || OFFER_STATUS_COLORS.Draft;
              return (
                <div key={o.id} style={{ fontSize: 12, padding: "6px 0", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between" }}>
                  <span>{o.salary_offered ? `${o.salary_currency} ${o.salary_offered.toLocaleString()}` : "No salary set"}</span>
                  <span style={{ fontWeight: 700, color: colors.fg }}>{o.status}</span>
                </div>
              );
            })}
          </div>
        )}

        {showOfferForm && (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>New Offer</div>
            {offerError && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 10 }}>{offerError}</div>}
            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Salary Offered</label>
                <input className="tiq-input" type="number" value={offerForm.salary_offered}
                       onChange={(e) => setOfferForm({ ...offerForm, salary_offered: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Currency</label>
                <input className="tiq-input" value={offerForm.salary_currency}
                       onChange={(e) => setOfferForm({ ...offerForm, salary_currency: e.target.value })} /></div>
            </div>
            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Start Date</label>
                <input className="tiq-input" type="date" value={offerForm.start_date}
                       onChange={(e) => setOfferForm({ ...offerForm, start_date: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Expiry Date</label>
                <input className="tiq-input" type="date" value={offerForm.expiry_date}
                       onChange={(e) => setOfferForm({ ...offerForm, expiry_date: e.target.value })} /></div>
            </div>
            <div className="tiq-form-group"><label className="tiq-label">Notes</label>
              <textarea className="tiq-input" rows={2} value={offerForm.notes}
                        onChange={(e) => setOfferForm({ ...offerForm, notes: e.target.value })} /></div>
            <div className="tiq-flex-end">
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setShowOfferForm(false)}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" onClick={submitOffer}>Save Offer</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// OFFERS TAB
// ══════════════════════════════════════════════════════════════════════════

function OffersTab() {
  const [offers, setOffers] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setOffers(await pipelineApi.listOffers(statusFilter || undefined));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [statusFilter]);

  const changeStatus = async (id: number, status: string) => {
    try {
      const res = await pipelineApi.changeOfferStatus(id, status);
      if (res.placement) {
        alert(`Offer accepted — a placement record was created automatically (guarantee period ends ${new Date(res.placement.guarantee_end_date).toLocaleDateString()}).`);
      }
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not change offer status.");
    }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Status:</label>
        <select className="tiq-select" style={{ fontSize: 12, padding: "5px 10px" }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All</option>
          {OFFER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : offers.length === 0 ? (
        <div className="tiq-empty">No offers yet — create one from a candidate's pipeline card.</div>
      ) : (
        <DataTable
          columns={["candidate_name", "requisition_title", "salary", "start_date", "expiry_date", "status"]}
          columnLabels={{ candidate_name: "Candidate", requisition_title: "Requisition", salary: "Salary", start_date: "Start Date", expiry_date: "Expiry", status: "Status" }}
          rows={offers.map((o: any) => ({
            ...o,
            salary: o.salary_offered ? `${o.salary_currency} ${o.salary_offered.toLocaleString()}` : "—",
          }))}
          getRowKey={(o: any) => o.id}
          renderCell={(o: any, col: string) => {
            const colors = OFFER_STATUS_COLORS[o.status] || OFFER_STATUS_COLORS.Draft;
            switch (col) {
              case "candidate_name": return <span style={{ fontWeight: 600, fontSize: 13 }}>{o.candidate_name}</span>;
              case "requisition_title": return <span style={{ fontSize: 12 }}>{o.requisition_title}</span>;
              case "salary": return <span style={{ fontSize: 12 }}>{o.salary}</span>;
              case "start_date": return <span style={{ fontSize: 12 }}>{o.start_date ? new Date(o.start_date).toLocaleDateString() : "—"}</span>;
              case "expiry_date": return <span style={{ fontSize: 12 }}>{o.expiry_date ? new Date(o.expiry_date).toLocaleDateString() : "—"}</span>;
              case "status": return (
                <div style={{ position: "relative", display: "inline-block" }}>
                  <select value={o.status} onChange={(e) => changeStatus(o.id, e.target.value)}
                          style={{ fontSize: 11, fontWeight: 700, padding: "4px 22px 4px 10px", borderRadius: 999, border: "none", color: colors.fg, background: colors.bg, appearance: "none", WebkitAppearance: "none", MozAppearance: "none", cursor: "pointer" }}>
                    {OFFER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown size={11} style={{ position: "absolute", right: 6, top: 6, pointerEvents: "none", color: colors.fg }} />
                </div>
              );
              default: return null;
            }
          }}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// PLACEMENTS TAB
// ══════════════════════════════════════════════════════════════════════════

function PlacementsTab() {
  const [placements, setPlacements] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setPlacements(await pipelineApi.listPlacements(statusFilter || undefined));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [statusFilter]);

  const changeStatus = async (id: number, status: string) => {
    if (status === "Fell Through") {
      const reason = prompt("Reason (optional):") || "";
      try { await pipelineApi.changePlacementStatus(id, status, reason); await load(); }
      catch (e: any) { alert(e?.response?.data?.detail || "Could not change status."); }
      return;
    }
    try {
      await pipelineApi.changePlacementStatus(id, status);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not change status.");
    }
  };

  const guaranteeDaysLeft = (p: any) => {
    if (!p.guarantee_end_date) return null;
    const diff = Math.ceil((new Date(p.guarantee_end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Status:</label>
        <select className="tiq-select" style={{ fontSize: 12, padding: "5px 10px" }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All</option>
          {PLACEMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : placements.length === 0 ? (
        <div className="tiq-empty">No placements yet — these are created automatically when an offer is marked Accepted.</div>
      ) : (
        <DataTable
          columns={["candidate_name", "requisition_title", "start_date", "fee", "guarantee", "status"]}
          columnLabels={{ candidate_name: "Candidate", requisition_title: "Requisition", start_date: "Start Date", fee: "Fee", guarantee: "Guarantee Period", status: "Status" }}
          rows={placements.map((p: any) => ({
            ...p,
            fee: p.fee_amount ? `${p.fee_currency} ${p.fee_amount.toLocaleString()}` : "—",
            guarantee: `${p.guarantee_period_days} days`,
          }))}
          getRowKey={(p: any) => p.id}
          renderCell={(p: any, col: string) => {
            const colors = PLACEMENT_STATUS_COLORS[p.status] || PLACEMENT_STATUS_COLORS.Active;
            const daysLeft = guaranteeDaysLeft(p);
            switch (col) {
              case "candidate_name": return <span style={{ fontWeight: 600, fontSize: 13 }}>{p.candidate_name}</span>;
              case "requisition_title": return <span style={{ fontSize: 12 }}>{p.requisition_title}</span>;
              case "start_date": return <span style={{ fontSize: 12 }}>{p.start_date ? new Date(p.start_date).toLocaleDateString() : "—"}</span>;
              case "fee": return <span style={{ fontSize: 12 }}>{p.fee}</span>;
              case "guarantee": return (
                <div style={{ fontSize: 12 }}>
                  {p.guarantee_period_days} days
                  {daysLeft !== null && daysLeft >= 0 && p.status !== "Completed" && (
                    <div style={{ fontSize: 11, color: daysLeft <= 14 ? "#f59e0b" : "var(--text-muted)", display: "flex", alignItems: "center", gap: 3 }}>
                      {daysLeft <= 14 && <AlertTriangle size={10} />} <Clock size={10} /> {daysLeft} day{daysLeft !== 1 ? "s" : ""} left
                    </div>
                  )}
                </div>
              );
              case "status": return (
                <div style={{ position: "relative", display: "inline-block" }}>
                  <select value={p.status} onChange={(e) => changeStatus(p.id, e.target.value)}
                          style={{ fontSize: 11, fontWeight: 700, padding: "4px 22px 4px 10px", borderRadius: 999, border: "none", color: colors.fg, background: colors.bg, appearance: "none", WebkitAppearance: "none", MozAppearance: "none", cursor: "pointer" }}>
                    {PLACEMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown size={11} style={{ position: "absolute", right: 6, top: 6, pointerEvents: "none", color: colors.fg }} />
                </div>
              );
              default: return null;
            }
          }}
        />
      )}
    </div>
  );
}
