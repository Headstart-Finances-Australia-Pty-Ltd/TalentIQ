import { useEffect, useState } from "react";
import {
  LayoutDashboard, Mail, Clock, Zap, Plus, X, Trash2, Send,
  AlertTriangle, Inbox, ClipboardCheck, CalendarClock,
} from "lucide-react";
import { communicationApi, acquisitionApi } from "../lib/api";
import DataTable from "../components/DataTable";

const TEMPLATE_CATEGORIES = ["Interview Invite", "Offer", "Rejection", "Follow-up", "General"];
const TRIGGER_EVENTS = [
  { value: "interview_scheduled", label: "Interview Scheduled" },
  { value: "interview_completed", label: "Interview Completed" },
  { value: "offer_sent", label: "Offer Sent" },
  { value: "offer_accepted", label: "Offer Accepted" },
  { value: "offer_rejected", label: "Offer Rejected" },
  { value: "pipeline_stage_changed", label: "Pipeline Stage Changed" },
  { value: "placement_created", label: "Placement Created" },
];
const CHANNELS = ["Note", "Call", "Email", "SMS"];

export default function CommunicationPage() {
  const [tab, setTab] = useState<"workbench" | "activity" | "templates" | "timeline" | "automation">("workbench");

  return (
    <div className="tiq-content">
      <div className="tiq-page-header">
        <div className="tiq-page-title">Comms</div>
        <div className="tiq-page-sub">Every meaningful action logged automatically, in one place.</div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16, marginBottom: 16 }}>
        <button className={`tiq-btn tiq-btn-sm ${tab === "workbench" ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setTab("workbench")}>
          <LayoutDashboard size={13} /> Workbench
        </button>
        <button className={`tiq-btn tiq-btn-sm ${tab === "activity" ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setTab("activity")}>
          <Send size={13} /> Email Activity
        </button>
        <button className={`tiq-btn tiq-btn-sm ${tab === "templates" ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setTab("templates")}>
          <Mail size={13} /> Templates
        </button>
        <button className={`tiq-btn tiq-btn-sm ${tab === "timeline" ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setTab("timeline")}>
          <Clock size={13} /> Timeline
        </button>
        <button className={`tiq-btn tiq-btn-sm ${tab === "automation" ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setTab("automation")}>
          <Zap size={13} /> Automation
        </button>
      </div>

      {tab === "workbench" && <WorkbenchTab />}
      {tab === "activity" && <EmailActivityTab />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "timeline" && <TimelineTab />}
      {tab === "automation" && <AutomationTab />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// WORKBENCH TAB
// ══════════════════════════════════════════════════════════════════════════

function WorkbenchTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    communicationApi.getWorkbench().then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>;
  if (!data) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
      <WorkbenchCard icon={<CalendarClock size={16} />} title="Interviews Today" count={data.interviews_today.length}>
        {data.interviews_today.length === 0 ? <Empty text="Nothing scheduled today." /> : data.interviews_today.map((i: any) => (
          <Row key={i.id} title={i.candidate_name} sub={`${i.round_name} — ${i.scheduled_at ? new Date(i.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}`} />
        ))}
      </WorkbenchCard>

      <WorkbenchCard icon={<AlertTriangle size={16} />} title="Offers Expiring Soon" count={data.offers_expiring_soon.length}>
        {data.offers_expiring_soon.length === 0 ? <Empty text="No offers expiring in the next 3 days." /> : data.offers_expiring_soon.map((o: any) => (
          <Row key={o.id} title={o.candidate_name} sub={`${o.requisition_title} — expires ${o.expiry_date ? new Date(o.expiry_date).toLocaleDateString() : ""}`} />
        ))}
      </WorkbenchCard>

      <WorkbenchCard icon={<Inbox size={16} />} title="Pending Vendor Submissions" count={data.pending_vendor_submissions}>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {data.pending_vendor_submissions === 0 ? "Nothing waiting for review." : `${data.pending_vendor_submissions} candidate(s) waiting — review in Partners.`}
        </div>
      </WorkbenchCard>

      <WorkbenchCard icon={<ClipboardCheck size={16} />} title="Unacknowledged Client Feedback" count={data.unacknowledged_client_feedback}>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {data.unacknowledged_client_feedback === 0 ? "All caught up." : `${data.unacknowledged_client_feedback} piece(s) waiting — review in Partners.`}
        </div>
      </WorkbenchCard>

      <WorkbenchCard icon={<Clock size={16} />} title="Stale Pipeline Entries (7+ days)" count={data.stale_pipeline_entries.length} wide>
        {data.stale_pipeline_entries.length === 0 ? <Empty text="No candidates stuck in a stage." /> : data.stale_pipeline_entries.map((e: any) => (
          <Row key={e.id} title={e.candidate_name} sub={`${e.requisition_title} — ${e.days_in_stage} day(s) in current stage`} />
        ))}
      </WorkbenchCard>
    </div>
  );
}

function WorkbenchCard({ icon, title, count, children, wide }: { icon: React.ReactNode; title: string; count: number; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="tiq-card" style={{ padding: 16, gridColumn: wide ? "1 / -1" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13 }}>{icon} {title}</div>
        <span className="tiq-badge tiq-badge-slate">{count}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
    </div>
  );
}
function Row({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{sub}</div>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{text}</div>;
}

// ══════════════════════════════════════════════════════════════════════════
// EMAIL ACTIVITY TAB — the "presentation table": every email TalentIQ has
// actually sent, grouped by which module/action sent it. Pulled live from
// GET /api/communication/by-module (tiq_communication_log), so this always
// reflects real current data — never a hardcoded or cached snapshot.
// ══════════════════════════════════════════════════════════════════════════

function EmailActivityTab() {
  const [data, setData] = useState<{ modules: any[]; grand_total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await communicationApi.getEmailActivityByModule());
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Failed to load email activity.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>;
  if (error) return <div style={{ padding: 20, color: "var(--rose-500)", fontSize: 12 }}>{error}</div>;
  if (!data) return null;

  return (
    <div className="tiq-card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <Send size={15} /> Email Activity by Module
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="tiq-badge tiq-badge-slate">{data.grand_total} total</span>
          <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={load}>Refresh</button>
        </div>
      </div>
      <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 14 }}>
        Every real email send across the platform — Video Interview invites, Phone/Interview Scheduling
        Calendly links, Screening/Interview Decision rejection emails, decision-approval requests, and
        Comms' own automation rules and direct sends — computed live from the unified communication log.
      </p>
      {data.modules.length === 0 ? (
        <Empty text="No emails logged yet." />
      ) : (
        <div className="tiq-table-wrap">
          <table className="tiq-table">
            <thead>
              <tr>
                <th>Module / Action</th>
                <th style={{ width: 90 }}>Sent</th>
                <th style={{ width: 90 }}>Failed</th>
                <th style={{ width: 90 }}>Other</th>
                <th style={{ width: 90 }}>Total</th>
                <th style={{ width: 170 }}>Last Sent</th>
              </tr>
            </thead>
            <tbody>
              {data.modules.map((m: any) => (
                <tr key={m.module}>
                  <td style={{ fontWeight: 600, fontSize: 12.5 }}>{m.module}</td>
                  <td style={{ color: "#10b981", fontWeight: 700 }}>{m.sent}</td>
                  <td style={{ color: m.failed > 0 ? "#ef4444" : "var(--text-muted)", fontWeight: m.failed > 0 ? 700 : 400 }}>{m.failed}</td>
                  <td style={{ color: "var(--text-muted)" }}>{m.other}</td>
                  <td style={{ fontWeight: 700 }}>{m.total}</td>
                  <td style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                    {m.last_sent_at ? new Date(m.last_sent_at).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// TEMPLATES TAB
// ══════════════════════════════════════════════════════════════════════════

function TemplatesTab() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ name: "", category: "General", subject: "", body: "" });

  const load = async () => {
    setLoading(true);
    try { setTemplates(await communicationApi.listTemplates()); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openAdd = () => { setForm({ name: "", category: "General", subject: "", body: "" }); setEditing(null); setShowForm(true); };
  const openEdit = (t: any) => { setForm({ name: t.name, category: t.category, subject: t.subject, body: t.body }); setEditing(t); setShowForm(true); };

  const save = async () => {
    if (!form.name.trim() || !form.subject.trim()) { alert("Name and subject are required."); return; }
    try {
      if (editing) await communicationApi.updateTemplate(editing.id, form);
      else await communicationApi.createTemplate(form);
      setShowForm(false);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not save template.");
    }
  };
  const remove = async (id: number) => {
    if (!confirm("Delete this template?")) return;
    try { await communicationApi.deleteTemplate(id); await load(); }
    catch (e: any) { alert(e?.response?.data?.detail || "Could not delete this template."); }
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={openAdd}><Plus size={14} /> New Template</button>
      </div>
      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : templates.length === 0 ? (
        <div className="tiq-empty">No templates yet.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
          {templates.map((t: any) => (
            <div key={t.id} className="tiq-card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="tiq-badge tiq-badge-teal">{t.category}</span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => openEdit(t)}>Edit</button>
                  <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => remove(t.id)}><Trash2 size={12} /></button>
                </div>
              </div>
              <div style={{ fontWeight: 700, fontSize: 14, marginTop: 8 }}>{t.name}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{t.subject}</div>
              <div style={{ fontSize: 12, marginTop: 8, maxHeight: 60, overflow: "hidden", textOverflow: "ellipsis" }}>{t.body}</div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 520, width: "94%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{editing ? "Edit Template" : "New Template"}</div>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Name *</label>
                <input className="tiq-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Category</label>
                <select className="tiq-select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {TEMPLATE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></div>
            </div>
            <div className="tiq-form-group"><label className="tiq-label">Subject *</label>
              <input className="tiq-input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="e.g. Your interview for {{requisition_title}}" /></div>
            <div className="tiq-form-group"><label className="tiq-label">Body</label>
              <textarea className="tiq-input" rows={6} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })}
                        placeholder="Hi {{candidate_name}}, ..." /></div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>
              Available placeholders: candidate_name, candidate_email, requisition_title, round_name, interview_time, location_or_link, stage_name, offer_salary, offer_currency
            </div>
            <div className="tiq-flex-end">
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// TIMELINE TAB
// ══════════════════════════════════════════════════════════════════════════

function TimelineTab() {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState("");
  const [timeline, setTimeline] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showLogForm, setShowLogForm] = useState(false);
  const [logForm, setLogForm] = useState({ channel: "Note", direction: "Internal", subject: "", body: "" });

  useEffect(() => { acquisitionApi.listCandidates().then(setCandidates); }, []);

  const load = async (candidateId: string) => {
    if (!candidateId) { setTimeline([]); return; }
    setLoading(true);
    try { setTimeline(await communicationApi.getTimeline({ candidate_id: Number(candidateId) })); } finally { setLoading(false); }
  };

  const submitLog = async () => {
    if (!selectedCandidate) return;
    try {
      await communicationApi.logEntry({ candidate_id: Number(selectedCandidate), ...logForm });
      setShowLogForm(false);
      setLogForm({ channel: "Note", direction: "Internal", subject: "", body: "" });
      await load(selectedCandidate);
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not save this log entry.");
    }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
        <select className="tiq-select" value={selectedCandidate} onChange={(e) => { setSelectedCandidate(e.target.value); load(e.target.value); }}>
          <option value="">— Select a candidate —</option>
          {candidates.map((c: any) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
        </select>
        {selectedCandidate && (
          <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setShowLogForm(true)}><Plus size={13} /> Log Something</button>
        )}
      </div>

      {!selectedCandidate ? (
        <div className="tiq-empty">Select a candidate to see their full communication history.</div>
      ) : loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : timeline.length === 0 ? (
        <div className="tiq-empty">No communication logged for this candidate yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {timeline.map((l: any) => (
            <div key={l.id} className="tiq-card" style={{ padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="tiq-badge tiq-badge-slate">{l.channel}</span>
                  {l.automated && <span className="tiq-badge tiq-badge-violet"><Zap size={9} style={{ verticalAlign: "middle" }} /> Automated</span>}
                  <StatusPill status={l.status} />
                </div>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{new Date(l.sent_at).toLocaleString()}</span>
              </div>
              {l.subject && <div style={{ fontWeight: 700, fontSize: 13, marginTop: 8 }}>{l.subject}</div>}
              {l.body && <div style={{ fontSize: 13, marginTop: 4, whiteSpace: "pre-wrap" }}>{l.body}</div>}
              {l.status === "Failed" && l.failure_reason && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 6 }}>{l.failure_reason}</div>}
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>by {l.sender_name || "—"}</div>
            </div>
          ))}
        </div>
      )}

      {showLogForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 440, width: "94%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Log Something</div>
              <button onClick={() => setShowLogForm(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div className="tiq-form-group"><label className="tiq-label">Channel</label>
              <select className="tiq-select" value={logForm.channel} onChange={(e) => setLogForm({ ...logForm, channel: e.target.value })}>
                {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select></div>
            <div className="tiq-form-group"><label className="tiq-label">Subject</label>
              <input className="tiq-input" value={logForm.subject} onChange={(e) => setLogForm({ ...logForm, subject: e.target.value })} /></div>
            <div className="tiq-form-group"><label className="tiq-label">Notes</label>
              <textarea className="tiq-input" rows={3} value={logForm.body} onChange={(e) => setLogForm({ ...logForm, body: e.target.value })} /></div>
            <div className="tiq-flex-end">
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setShowLogForm(false)}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" onClick={submitLog}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, { fg: string; bg: string }> = {
    Sent: { fg: "#10b981", bg: "rgba(16,185,129,.12)" },
    Failed: { fg: "#ef4444", bg: "rgba(239,68,68,.12)" },
    Logged: { fg: "#64748b", bg: "rgba(100,116,139,.12)" },
    Skipped: { fg: "#f59e0b", bg: "rgba(245,158,11,.12)" },
  };
  const c = colors[status] || colors.Logged;
  return <span style={{ fontSize: 10, fontWeight: 700, color: c.fg, background: c.bg, padding: "2px 8px", borderRadius: 999 }}>{status}</span>;
}

// ══════════════════════════════════════════════════════════════════════════
// AUTOMATION TAB
// ══════════════════════════════════════════════════════════════════════════

function AutomationTab() {
  const [rules, setRules] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [log, setLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", trigger_event: "interview_scheduled", trigger_stage_name: "", template_id: "" });

  const load = async () => {
    setLoading(true);
    try {
      const [r, t, l] = await Promise.all([communicationApi.listAutomationRules(), communicationApi.listTemplates(), communicationApi.getAutomationLog()]);
      setRules(r); setTemplates(t); setLog(l);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name.trim() || !form.template_id) { alert("Name and template are required."); return; }
    if (form.trigger_event === "pipeline_stage_changed" && !form.trigger_stage_name.trim()) {
      alert("Enter the exact stage name this rule should fire on (e.g. 'Rejected', 'Placed')."); return;
    }
    try {
      await communicationApi.createAutomationRule({ ...form, template_id: Number(form.template_id) });
      setShowForm(false);
      setForm({ name: "", trigger_event: "interview_scheduled", trigger_stage_name: "", template_id: "" });
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not save this rule.");
    }
  };
  const toggleActive = async (rule: any) => {
    await communicationApi.updateAutomationRule(rule.id, { is_active: !rule.is_active });
    await load();
  };
  const remove = async (id: number) => {
    if (!confirm("Delete this automation rule?")) return;
    await communicationApi.deleteAutomationRule(id);
    await load();
  };

  if (loading) return <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={() => setShowForm(true)}><Plus size={14} /> New Rule</button>
      </div>

      {rules.length === 0 ? (
        <div className="tiq-empty" style={{ marginBottom: 24 }}>No automation rules yet.</div>
      ) : (
        <DataTable
          columns={["name", "trigger", "template_name", "is_active"]}
          columnLabels={{ name: "Rule", trigger: "Trigger", template_name: "Template", is_active: "Active" }}
          rows={rules.map((r: any) => ({
            ...r,
            trigger: `${TRIGGER_EVENTS.find((t) => t.value === r.trigger_event)?.label || r.trigger_event}${r.trigger_stage_name ? ` (${r.trigger_stage_name})` : ""}`,
          }))}
          getRowKey={(r: any) => r.id}
          actionsLabel=""
          actionsWidth={50}
          renderActions={(r: any) => <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => remove(r.id)}><Trash2 size={12} /></button>}
          renderCell={(r: any, col: string) => {
            switch (col) {
              case "name": return <span style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</span>;
              case "trigger": return <span style={{ fontSize: 12 }}>{r.trigger}</span>;
              case "template_name": return <span style={{ fontSize: 12 }}>{r.template_name}</span>;
              case "is_active": return (
                <label style={{ display: "inline-flex", alignItems: "center", cursor: "pointer" }}>
                  <input type="checkbox" checked={r.is_active} onChange={() => toggleActive(r)} />
                </label>
              );
              default: return null;
            }
          }}
        />
      )}

      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Recent Automation Activity</div>
      {log.length === 0 ? (
        <div className="tiq-empty">Nothing has fired yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {log.slice(0, 30).map((l: any) => (
            <div key={l.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "rgba(0,0,0,.02)", borderRadius: 8, fontSize: 12 }}>
              <span><b>{l.rule_name}</b> → {l.target_description}</span>
              <StatusPill status={l.status} />
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 440, width: "94%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>New Automation Rule</div>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div className="tiq-form-group"><label className="tiq-label">Rule Name *</label>
              <input className="tiq-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="tiq-form-group"><label className="tiq-label">When</label>
              <select className="tiq-select" value={form.trigger_event} onChange={(e) => setForm({ ...form, trigger_event: e.target.value })}>
                {TRIGGER_EVENTS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select></div>
            {form.trigger_event === "pipeline_stage_changed" && (
              <div className="tiq-form-group"><label className="tiq-label">Stage Name *</label>
                <input className="tiq-input" value={form.trigger_stage_name} onChange={(e) => setForm({ ...form, trigger_stage_name: e.target.value })}
                       placeholder="e.g. Rejected, Placed, Interviewing" /></div>
            )}
            <div className="tiq-form-group"><label className="tiq-label">Send Template *</label>
              <select className="tiq-select" value={form.template_id} onChange={(e) => setForm({ ...form, template_id: e.target.value })}>
                <option value="">— Select template —</option>
                {templates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select></div>
            <div className="tiq-flex-end">
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" onClick={save}>Save Rule</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
