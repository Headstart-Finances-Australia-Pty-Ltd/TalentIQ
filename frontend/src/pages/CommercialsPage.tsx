import { useEffect, useState } from "react";
import {
  Receipt, AlertTriangle, Clock3, TrendingUp, Plus, X, Trash2, ChevronDown,
} from "lucide-react";
import { commercialApi, pipelineApi } from "../lib/api";
import DataTable from "../components/DataTable";

const INVOICE_STATUSES = ["Draft", "Sent", "Paid", "Overdue", "Cancelled"];
const INVOICE_STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  Draft: { fg: "#64748b", bg: "rgba(100,116,139,.12)" },
  Sent: { fg: "#3b82f6", bg: "rgba(59,130,246,.12)" },
  Paid: { fg: "#10b981", bg: "rgba(16,185,129,.12)" },
  Overdue: { fg: "#ef4444", bg: "rgba(239,68,68,.12)" },
  Cancelled: { fg: "#94a3b8", bg: "rgba(148,163,184,.12)" },
};

export default function CommercialsPage() {
  const [tab, setTab] = useState<"invoices" | "alerts" | "timesheets" | "revenue">("invoices");

  return (
    <div className="tiq-content">
      <div className="tiq-page-header">
        <div className="tiq-page-title">Commercials</div>
        <div className="tiq-page-sub">The money side of a placement, tracked inside the platform.</div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16, marginBottom: 16 }}>
        <button className={`tiq-btn tiq-btn-sm ${tab === "invoices" ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setTab("invoices")}>
          <Receipt size={13} /> Invoices
        </button>
        <button className={`tiq-btn tiq-btn-sm ${tab === "alerts" ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setTab("alerts")}>
          <AlertTriangle size={13} /> Guarantee Alerts
        </button>
        <button className={`tiq-btn tiq-btn-sm ${tab === "timesheets" ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setTab("timesheets")}>
          <Clock3 size={13} /> Timesheets
        </button>
        <button className={`tiq-btn tiq-btn-sm ${tab === "revenue" ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setTab("revenue")}>
          <TrendingUp size={13} /> Revenue
        </button>
      </div>

      {tab === "invoices" && <InvoicesTab />}
      {tab === "alerts" && <AlertsTab />}
      {tab === "timesheets" && <TimesheetsTab />}
      {tab === "revenue" && <RevenueTab />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// INVOICES TAB
// ══════════════════════════════════════════════════════════════════════════

function InvoicesTab() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [placements, setPlacements] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ placement_id: "", description: "", amount: "", currency: "AUD", due_date: "" });
  const [formError, setFormError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [inv, pl] = await Promise.all([commercialApi.listInvoices(statusFilter ? { status: statusFilter } : undefined), pipelineApi.listPlacements()]);
      setInvoices(inv);
      setPlacements(pl);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [statusFilter]);

  const openAdd = () => { setForm({ placement_id: "", description: "", amount: "", currency: "AUD", due_date: "" }); setFormError(""); setShowForm(true); };

  const submit = async () => {
    if (!form.placement_id) { setFormError("Select a placement."); return; }
    try {
      await commercialApi.createInvoice({
        placement_id: Number(form.placement_id), description: form.description,
        amount: form.amount ? Number(form.amount) : undefined, currency: form.currency,
        due_date: form.due_date || undefined,
      });
      setShowForm(false);
      await load();
    } catch (e: any) {
      setFormError(e?.response?.data?.detail || "Could not create this invoice.");
    }
  };

  const changeStatus = async (id: number, status: string) => {
    try { await commercialApi.changeInvoiceStatus(id, status); await load(); }
    catch (e: any) { alert(e?.response?.data?.detail || "Could not change status."); }
  };
  const remove = async (id: number) => {
    if (!confirm("Delete this invoice?")) return;
    try { await commercialApi.deleteInvoice(id); await load(); }
    catch (e: any) { alert(e?.response?.data?.detail || "Could not delete this invoice."); }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button className={`tiq-btn tiq-btn-sm ${statusFilter === "" ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setStatusFilter("")}>All</button>
        {INVOICE_STATUSES.map((s) => (
          <button key={s} className={`tiq-btn tiq-btn-sm ${statusFilter === s ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setStatusFilter(s)}>{s}</button>
        ))}
        <button className="tiq-btn tiq-btn-primary tiq-btn-sm" style={{ marginLeft: "auto" }} onClick={openAdd}>
          <Plus size={14} /> New Invoice
        </button>
      </div>

      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : invoices.length === 0 ? (
        <div className="tiq-empty">No invoices yet — create one against a placement.</div>
      ) : (
        <DataTable
          columns={["candidate_name", "requisition_title", "description", "amount", "due_date", "status"]}
          columnLabels={{ candidate_name: "Candidate", requisition_title: "Requisition", description: "Description", amount: "Amount", due_date: "Due Date", status: "Status" }}
          rows={invoices.map((i: any) => ({ ...i, amount: `${i.currency} ${i.amount?.toLocaleString()}` }))}
          getRowKey={(i: any) => i.id}
          actionsLabel=""
          actionsWidth={50}
          renderActions={(i: any) => <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => remove(i.id)}><Trash2 size={12} /></button>}
          renderCell={(i: any, col: string) => {
            const colors = INVOICE_STATUS_COLORS[i.status] || INVOICE_STATUS_COLORS.Draft;
            switch (col) {
              case "candidate_name": return <span style={{ fontWeight: 600, fontSize: 13 }}>{i.candidate_name}</span>;
              case "requisition_title": return <span style={{ fontSize: 12 }}>{i.requisition_title}</span>;
              case "description": return <span style={{ fontSize: 12 }}>{i.description}</span>;
              case "amount": return <span style={{ fontSize: 12, fontWeight: 600 }}>{i.amount}</span>;
              case "due_date": return <span style={{ fontSize: 12 }}>{i.due_date ? new Date(i.due_date).toLocaleDateString() : "—"}</span>;
              case "status": return (
                <div style={{ position: "relative", display: "inline-block" }}>
                  <select value={i.status} onChange={(e) => changeStatus(i.id, e.target.value)}
                          style={{ fontSize: 11, fontWeight: 700, padding: "4px 22px 4px 10px", borderRadius: 999, border: "none", color: colors.fg, background: colors.bg, appearance: "none", WebkitAppearance: "none", MozAppearance: "none", cursor: "pointer" }}>
                    {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown size={11} style={{ position: "absolute", right: 6, top: 6, pointerEvents: "none", color: colors.fg }} />
                </div>
              );
              default: return null;
            }
          }}
        />
      )}

      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 440, width: "94%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>New Invoice</div>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            {formError && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 12 }}>{formError}</div>}
            <div className="tiq-form-group"><label className="tiq-label">Placement *</label>
              <select className="tiq-select" value={form.placement_id} onChange={(e) => setForm({ ...form, placement_id: e.target.value })}>
                <option value="">— Select placement —</option>
                {placements.map((p: any) => <option key={p.id} value={p.id}>{p.candidate_name} — {p.requisition_title}</option>)}
              </select></div>
            <div className="tiq-form-group"><label className="tiq-label">Description</label>
              <input className="tiq-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Defaults to 'Placement fee — <candidate>'" /></div>
            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Amount</label>
                <input className="tiq-input" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="Defaults to the placement fee" /></div>
              <div className="tiq-form-group"><label className="tiq-label">Due Date</label>
                <input className="tiq-input" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
            </div>
            <div className="tiq-flex-end">
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" onClick={submit}>Create Invoice</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// GUARANTEE ALERTS TAB
// ══════════════════════════════════════════════════════════════════════════

function AlertsTab() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    commercialApi.getGuaranteeAlerts(days).then(setAlerts).finally(() => setLoading(false));
  }, [days]);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: 13 }}>Show placements with a guarantee ending within</span>
        <select className="tiq-select" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 100 }}>
          {[7, 14, 30, 60].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
      </div>
      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : alerts.length === 0 ? (
        <div className="tiq-empty">No placements approaching their guarantee deadline.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {alerts.map((a: any) => (
            <div key={a.placement_id} className="tiq-card" style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{a.candidate_name}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{a.requisition_title}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{
                  fontWeight: 700, fontSize: 13,
                  color: a.days_remaining <= 3 ? "#ef4444" : a.days_remaining <= 7 ? "#f59e0b" : "#0d9488",
                }}>
                  {a.days_remaining <= 0 ? "Overdue" : `${a.days_remaining} day(s) left`}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>ends {new Date(a.guarantee_end_date).toLocaleDateString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// TIMESHEETS TAB
// ══════════════════════════════════════════════════════════════════════════

function TimesheetsTab() {
  const [timesheets, setTimesheets] = useState<any[]>([]);
  const [placements, setPlacements] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ placement_id: "", week_ending: "", hours: "", rate: "" });
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const [ts, pl] = await Promise.all([commercialApi.listTimesheets(statusFilter ? { status: statusFilter } : undefined), pipelineApi.listPlacements()]);
      setTimesheets(ts);
      setPlacements(pl);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [statusFilter]);

  const submit = async () => {
    if (!form.placement_id || !form.week_ending || !form.hours || !form.rate) { alert("All fields are required."); return; }
    try {
      await commercialApi.createTimesheet({
        placement_id: Number(form.placement_id), week_ending: form.week_ending,
        hours: Number(form.hours), rate: Number(form.rate),
      });
      setShowForm(false);
      setForm({ placement_id: "", week_ending: "", hours: "", rate: "" });
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not save this timesheet entry.");
    }
  };
  const approve = async (id: number) => { await commercialApi.approveTimesheet(id); await load(); };
  const remove = async (id: number) => { if (confirm("Delete this entry?")) { await commercialApi.deleteTimesheet(id); await load(); } };
  const toggleSelect = (id: number) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const rollUp = async () => {
    if (selected.size === 0) return;
    try {
      await commercialApi.timesheetsToInvoice(Array.from(selected));
      setSelected(new Set());
      await load();
      alert("Invoice created from the selected timesheet entries.");
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not create an invoice from these entries.");
    }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {["", "Submitted", "Approved", "Invoiced", "Rejected"].map((s) => (
          <button key={s || "all"} className={`tiq-btn tiq-btn-sm ${statusFilter === s ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setStatusFilter(s)}>{s || "All"}</button>
        ))}
        <button className="tiq-btn tiq-btn-primary tiq-btn-sm" style={{ marginLeft: "auto" }} onClick={() => setShowForm(true)}><Plus size={14} /> Log Hours</button>
        {selected.size > 0 && (
          <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={rollUp}><Receipt size={13} /> Invoice {selected.size} Selected</button>
        )}
      </div>

      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : timesheets.length === 0 ? (
        <div className="tiq-empty">No timesheet entries yet — optional, for contract placements billed by hours.</div>
      ) : (
        <DataTable
          columns={["select", "candidate_name", "week_ending", "hours", "rate", "amount", "status"]}
          columnLabels={{ select: "", candidate_name: "Candidate", week_ending: "Week Ending", hours: "Hours", rate: "Rate", amount: "Amount", status: "Status" }}
          rows={timesheets.map((t: any) => ({
            ...t,
            rate: `${t.currency} ${t.rate}`,
            amount: `${t.currency} ${t.amount?.toLocaleString()}`,
          }))}
          getRowKey={(t: any) => t.id}
          actionsLabel="Actions"
          actionsWidth={90}
          renderActions={(t: any) => (
            <div style={{ display: "flex", gap: 4 }}>
              {t.status === "Submitted" && <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => approve(t.id)}>Approve</button>}
              <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => remove(t.id)}><Trash2 size={12} /></button>
            </div>
          )}
          renderCell={(t: any, col: string) => {
            switch (col) {
              case "select": return t.status === "Approved" ? <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} /> : null;
              case "candidate_name": return <span style={{ fontWeight: 600, fontSize: 13 }}>{t.candidate_name}</span>;
              case "week_ending": return <span style={{ fontSize: 12 }}>{new Date(t.week_ending).toLocaleDateString()}</span>;
              case "hours": return <span style={{ fontSize: 12 }}>{t.hours}</span>;
              case "rate": return <span style={{ fontSize: 12 }}>{t.rate}</span>;
              case "amount": return <span style={{ fontSize: 12, fontWeight: 600 }}>{t.amount}</span>;
              case "status": return <span className="tiq-badge tiq-badge-slate">{t.status}</span>;
              default: return null;
            }
          }}
        />
      )}

      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 420, width: "94%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Log Hours</div>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div className="tiq-form-group"><label className="tiq-label">Placement *</label>
              <select className="tiq-select" value={form.placement_id} onChange={(e) => setForm({ ...form, placement_id: e.target.value })}>
                <option value="">— Select placement —</option>
                {placements.map((p: any) => <option key={p.id} value={p.id}>{p.candidate_name} — {p.requisition_title}</option>)}
              </select></div>
            <div className="tiq-form-group"><label className="tiq-label">Week Ending *</label>
              <input className="tiq-input" type="date" value={form.week_ending} onChange={(e) => setForm({ ...form, week_ending: e.target.value })} /></div>
            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Hours *</label>
                <input className="tiq-input" type="number" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Rate (per hour) *</label>
                <input className="tiq-input" type="number" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></div>
            </div>
            <div className="tiq-flex-end">
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" onClick={submit}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// REVENUE TAB
// ══════════════════════════════════════════════════════════════════════════

function RevenueTab() {
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    commercialApi.getRevenueReport().then(setReport).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>;
  if (!report) return null;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 24 }}>
        <StatCard label="Total Invoiced" value={report.total_invoiced} color="#0d9488" />
        <StatCard label="Total Paid" value={report.total_paid} color="#10b981" />
        <StatCard label="Outstanding" value={report.total_outstanding} color="#f59e0b" />
        <StatCard label="Invoices" value={report.invoice_count} isCount />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <div className="tiq-card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Revenue by Requisition</div>
          {report.by_requisition.length === 0 ? <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No data yet.</div> : (
            report.by_requisition.map((r: any) => (
              <div key={r.requisition_title} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                <span>{r.requisition_title}</span><span style={{ fontWeight: 600 }}>${r.amount.toLocaleString()}</span>
              </div>
            ))
          )}
        </div>
        <div className="tiq-card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Revenue by Month</div>
          {report.by_month.length === 0 ? <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No data yet.</div> : (
            report.by_month.map((m: any) => (
              <div key={m.month} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                <span>{m.month}</span><span style={{ fontWeight: 600 }}>${m.amount.toLocaleString()}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, isCount }: { label: string; value: number; color?: string; isCount?: boolean }) {
  return (
    <div className="tiq-card" style={{ padding: 16 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || "inherit" }}>
        {isCount ? value : `$${value.toLocaleString()}`}
      </div>
    </div>
  );
}
