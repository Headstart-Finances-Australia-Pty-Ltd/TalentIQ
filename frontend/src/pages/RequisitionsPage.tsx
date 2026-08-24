import { useEffect, useState } from "react";
import {
  ClipboardList, Plus, X, Check, Link2, ChevronRight,
  AlertTriangle, Copy, Upload, Trash2, Building2,
} from "lucide-react";
import { requisitionApi, candidateTrackApi } from "../lib/api";
import CsvImportModal from "../components/candidatetrack/CsvImportModal";

const STATUS_FLOW = ["Draft", "Approved", "Open", "On Hold", "Filled", "Cancelled"];
const STATUS_TRANSITIONS: Record<string, string[]> = {
  Draft: ["Approved", "Cancelled"],
  Approved: ["Open", "Cancelled"],
  Open: ["On Hold", "Filled", "Cancelled"],
  "On Hold": ["Open", "Cancelled"],
  Filled: [],
  Cancelled: [],
};
const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  Draft: { fg: "#64748b", bg: "rgba(100,116,139,.12)" },
  Approved: { fg: "#0d9488", bg: "rgba(13,148,136,.12)" },
  Open: { fg: "#10b981", bg: "rgba(16,185,129,.12)" },
  "On Hold": { fg: "#f59e0b", bg: "rgba(245,158,11,.12)" },
  Filled: { fg: "#3b82f6", bg: "rgba(59,130,246,.12)" },
  Cancelled: { fg: "#ef4444", bg: "rgba(239,68,68,.12)" },
};
const PRIORITIES = ["Critical", "High", "Normal", "Low"];
const PRIORITY_COLORS: Record<string, string> = { Critical: "#ef4444", High: "#f59e0b", Normal: "#64748b", Low: "#94a3b8" };
const REASONS = ["New Position", "Replacement", "Backfill", "Growth"];
const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Temporary"];

const emptyForm = {
  title: "", client_id: "" as string | number, jd_record_id: "" as string | number,
  priority: "Normal", vacancy_count: 1, reason_for_hire: "", employment_type: "",
  location: "", salary_min: "" as string | number, salary_max: "" as string | number,
  target_hire_date: "", hiring_manager_contact_id: "" as string | number,
  hiring_manager_name: "", hiring_manager_email: "", notes: "",
};

export default function RequisitionsPage() {
  const [requisitions, setRequisitions] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [jds, setJds] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [detailId, setDetailId] = useState<number | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const [showCsv, setShowCsv] = useState(false);
  const [showClientCsv, setShowClientCsv] = useState(false);
  const [showClientsTable, setShowClientsTable] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [selectedClients, setSelectedClients] = useState<Set<number>>(new Set());
  const [clientFormState, setClientFormState] = useState<null | { mode: "create" } | { mode: "edit"; client: any }>(null);
  const [clientForm, setClientForm] = useState({
    name: "", address: "", abn: "", area_of_work: "",
    contact_id: null as number | null, contact_name: "", contact_title: "", contact_email: "", contact_phone: "",
  });
  const [clientFormSaving, setClientFormSaving] = useState(false);
  const [clientFormError, setClientFormError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [reqs, cl, jdList, cts] = await Promise.all([
        requisitionApi.list(statusFilter ? { status: statusFilter } : undefined),
        candidateTrackApi.listClients(),
        candidateTrackApi.listJDs(),
        requisitionApi.listContacts(),
      ]);
      setRequisitions(reqs);
      setClients(cl);
      setJds(jdList);
      setContacts(cts);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter]);

  const openAdd = () => { setForm(emptyForm); setEditingId(null); setFormError(""); setShowForm(true); };
  const openEdit = (r: any) => {
    setForm({
      title: r.title, client_id: r.client_id ?? "", jd_record_id: r.jd_record_id ?? "",
      priority: r.priority, vacancy_count: r.vacancy_count, reason_for_hire: r.reason_for_hire,
      employment_type: r.employment_type, location: r.location,
      salary_min: r.salary_min ?? "", salary_max: r.salary_max ?? "",
      target_hire_date: r.target_hire_date ? r.target_hire_date.slice(0, 10) : "",
      hiring_manager_contact_id: r.hiring_manager_contact_id ?? "",
      hiring_manager_name: r.hiring_manager_name, hiring_manager_email: r.hiring_manager_email,
      notes: r.notes,
    });
    setEditingId(r.id);
    setFormError("");
    setShowForm(true);
  };

  const submitForm = async () => {
    if (!form.title.trim()) { setFormError("Title is required."); return; }
    setSaving(true);
    setFormError("");
    const payload = {
      ...form,
      client_id: form.client_id === "" ? null : Number(form.client_id),
      jd_record_id: form.jd_record_id === "" ? null : Number(form.jd_record_id),
      vacancy_count: Number(form.vacancy_count) || 1,
      salary_min: form.salary_min === "" ? null : Number(form.salary_min),
      salary_max: form.salary_max === "" ? null : Number(form.salary_max),
      target_hire_date: form.target_hire_date ? new Date(form.target_hire_date).toISOString() : null,
      hiring_manager_contact_id: form.hiring_manager_contact_id === "" ? null : Number(form.hiring_manager_contact_id),
    };
    try {
      if (editingId) await requisitionApi.update(editingId, payload);
      else await requisitionApi.create(payload);
      setShowForm(false);
      await load();
    } catch (e: any) {
      setFormError(e?.response?.data?.detail || "Could not save requisition.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this requisition? This cannot be undone.")) return;
    try {
      await requisitionApi.remove(id);
      if (detailId === id) setDetailId(null);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not delete this requisition. Please try again.");
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
    if (selected.size === requisitions.length) setSelected(new Set());
    else setSelected(new Set(requisitions.map((r) => r.id)));
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected requisition(s)? This cannot be undone.`)) return;
    try {
      const res = await requisitionApi.bulkDelete(Array.from(selected));
      setSelected(new Set());
      await load();
      if (res?.skipped?.length > 0) {
        const lines = res.skipped.map((s: any) => `• ${s.title}: ${s.reason}`).join("\n");
        alert(`Deleted ${res.deleted ?? 0} requisition(s).\n\n${res.skipped.length} could not be deleted:\n${lines}`);
      }
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not delete the selected requisitions. Please try again.");
    }
  };

  const handleStatusChange = async (id: number, status: string) => {
    try {
      await requisitionApi.changeStatus(id, status);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not change status.");
    }
  };

  const handleChecklistToggle = async (id: number, field: string, value: boolean) => {
    await requisitionApi.updateChecklist(id, { [field]: value });
    await load();
  };

  const copyHmLink = async (id: number) => {
    const res = await requisitionApi.generateHmViewLink(id);
    navigator.clipboard.writeText(`${window.location.origin}${res.view_url_path}`);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  // ── Clients table: edit / delete / bulk-select ──────────────────────
  // This table used to be read-only (name/address/ABN/area of work with
  // no actions at all) — everything below brings it in line with every
  // other table in the app (candidates, requisitions): row checkboxes,
  // select-all, per-row edit/delete, and bulk delete.
  const openAddClient = () => {
    setClientForm({ name: "", address: "", abn: "", area_of_work: "", contact_id: null, contact_name: "", contact_title: "", contact_email: "", contact_phone: "" });
    setClientFormState({ mode: "create" });
    setClientFormError("");
  };
  const openEditClient = (c: any) => {
    // Pre-fill the client's existing primary contact (if any) so editing a
    // client and managing its main contact person happen in the same
    // form — previously "Add Client" and "Add Client Contact" were two
    // separate buttons/modals for what's really one piece of information
    // a recruiter enters together when onboarding a client.
    const existingContact = contacts.find((ct: any) => ct.client_id === c.id && ct.is_primary)
      || contacts.find((ct: any) => ct.client_id === c.id);
    setClientForm({
      name: c.name || "", address: c.address || "", abn: c.abn || "", area_of_work: c.area_of_work || "",
      contact_id: existingContact?.id ?? null,
      contact_name: existingContact?.name || "", contact_title: existingContact?.title || "",
      contact_email: existingContact?.email || "", contact_phone: existingContact?.phone || "",
    });
    setClientFormState({ mode: "edit", client: c });
    setClientFormError("");
  };
  const submitClientForm = async () => {
    if (!clientForm.name.trim()) { setClientFormError("Client name is required."); return; }
    setClientFormSaving(true);
    setClientFormError("");
    try {
      const clientPayload = { name: clientForm.name, address: clientForm.address, abn: clientForm.abn, area_of_work: clientForm.area_of_work };
      let clientId: number;
      if (clientFormState?.mode === "edit") {
        await candidateTrackApi.updateClient(clientFormState.client.id, clientPayload);
        clientId = clientFormState.client.id;
      } else {
        const created = await candidateTrackApi.createClient(clientPayload);
        clientId = created.id;
      }

      // Contact fields are optional as a group — only touch the contact
      // record if at least one was actually filled in.
      const hasContactInput = clientForm.contact_name.trim() || clientForm.contact_email.trim() || clientForm.contact_phone.trim();
      if (hasContactInput) {
        const contactPayload = {
          client_id: clientId,
          name: clientForm.contact_name.trim() || clientForm.name.trim(), // fallback so email/phone-only input isn't rejected (name is required)
          title: clientForm.contact_title, email: clientForm.contact_email, phone: clientForm.contact_phone,
          is_primary: true,
        };
        if (clientForm.contact_id) await requisitionApi.updateContact(clientForm.contact_id, contactPayload);
        else await requisitionApi.createContact(contactPayload);
      }

      setClientFormState(null);
      await load();
    } catch (e: any) {
      setClientFormError(e?.response?.data?.detail || "Could not save client.");
    } finally {
      setClientFormSaving(false);
    }
  };
  const handleDeleteClient = async (c: any) => {
    if (!confirm(`Delete client "${c.name}"? This cannot be undone.`)) return;
    try {
      await candidateTrackApi.deleteClient(c.id);
      await load();
    } catch (e: any) {
      // Deleting a client with JDs/requisitions still attached is
      // rejected with a clear message rather than crashing outright —
      // surface it instead of failing silently.
      alert(e?.response?.data?.detail || "Could not delete this client.");
    }
  };
  const toggleSelectClient = (id: number) => {
    setSelectedClients((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleSelectAllClients = () => {
    if (selectedClients.size === clients.length) setSelectedClients(new Set());
    else setSelectedClients(new Set(clients.map((c: any) => c.id)));
  };
  const handleBulkDeleteClients = async () => {
    if (selectedClients.size === 0) return;
    if (!confirm(`Delete ${selectedClients.size} selected client(s)? This cannot be undone.`)) return;
    try {
      const res = await candidateTrackApi.bulkDeleteClients(Array.from(selectedClients));
      setSelectedClients(new Set());
      await load();
      // Bulk delete deletes what it safely can and reports the rest —
      // a client with JDs/requisitions attached is skipped, not silently
      // dropped or allowed to fail the whole batch.
      if (res?.skipped?.length > 0) {
        const lines = res.skipped.map((s: any) => `• ${s.name}: ${s.reason}`).join("\n");
        alert(`Deleted ${res.deleted?.length ?? 0} client(s).\n\n${res.skipped.length} could not be deleted:\n${lines}`);
      }
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not delete the selected clients.");
    }
  };

  const detail = requisitions.find((r) => r.id === detailId);

  return (
    <div className="tiq-content">
      <div className="tiq-page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="tiq-page-title">Requisitions</div>
          <div className="tiq-page-sub">A job doesn't exist until it's a structured, approved, owned object.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setShowClientsTable((v) => !v)}>
            <Building2 size={14} /> {showClientsTable ? "Hide Clients" : "Show Clients"}
          </button>
          <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={openAddClient}>
            <Building2 size={14} /> Add Client
          </button>
          <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setShowClientCsv(true)}>
            <Upload size={14} /> Bulk Import Clients
          </button>
          <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setShowCsv(true)}>
            <Upload size={14} /> Bulk Import Requisitions
          </button>
          <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={openAdd}>
            <Plus size={14} /> New Requisition
          </button>
        </div>
      </div>

      {/* ── Clients table — shown above the Requisitions table so a
          recruiter can see/manage clients right where they're building
          requisitions, without leaving this page. ─────────────────────── */}
      {showClientsTable && (
        <div className="tiq-card" style={{ marginTop: 16, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
              <Building2 size={14} /> Clients ({clients.length})
            </div>
            {selectedClients.size > 0 && (
              <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ color: "#ef4444", borderColor: "#ef4444" }}
                      onClick={handleBulkDeleteClients}>
                <Trash2 size={13} /> Delete {selectedClients.size} selected
              </button>
            )}
          </div>
          {clients.length === 0 ? (
            <div className="tiq-empty" style={{ padding: 12 }}>No clients yet — use "Bulk Import Clients" or add one via a requisition's client dropdown.</div>
          ) : (
            <div className="tiq-table-wrap">
              <table className="tiq-table">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>
                      <input type="checkbox" checked={clients.length > 0 && selectedClients.size === clients.length}
                             onChange={toggleSelectAllClients} title="Select all" />
                    </th>
                    <th>Name</th>
                    <th>Address</th>
                    <th>ABN</th>
                    <th>Area of Work</th>
                    <th style={{ textAlign: "center" }}>Requisitions</th>
                    <th style={{ textAlign: "center" }}>Contacts</th>
                    <th style={{ width: 90 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((cl: any) => (
                    <tr key={cl.id}>
                      <td><input type="checkbox" checked={selectedClients.has(cl.id)} onChange={() => toggleSelectClient(cl.id)} /></td>
                      <td style={{ fontWeight: 600 }}>{cl.name}</td>
                      <td style={{ fontSize: 12 }}>{cl.address || "—"}</td>
                      <td style={{ fontSize: 12 }}>{cl.abn || "—"}</td>
                      <td style={{ fontSize: 12 }}>{cl.area_of_work || "—"}</td>
                      <td style={{ textAlign: "center" }}>{requisitions.filter((r) => r.client_id === cl.id).length}</td>
                      <td style={{ textAlign: "center" }}>{contacts.filter((ct: any) => ct.client_id === cl.id).length}</td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Edit" onClick={() => openEditClient(cl)}>Edit</button>
                          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Delete" onClick={() => handleDeleteClient(cl)}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 16, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button className={`tiq-btn tiq-btn-sm ${statusFilter === "" ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setStatusFilter("")}>All</button>
        {STATUS_FLOW.map((s) => (
          <button key={s} className={`tiq-btn tiq-btn-sm ${statusFilter === s ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setStatusFilter(s)}>{s}</button>
        ))}
        {selected.size > 0 && (
          <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ marginLeft: "auto", color: "#ef4444", borderColor: "#ef4444" }}
                  onClick={handleBulkDelete}>
            <Trash2 size={13} /> Delete {selected.size} selected
          </button>
        )}
      </div>

      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : requisitions.length === 0 ? (
        <div className="tiq-empty">No requisitions yet. Create one to get the intake workflow started.</div>
      ) : (
        <div className="tiq-table-wrap">
          <table className="tiq-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input type="checkbox" checked={selected.size > 0 && selected.size === requisitions.length}
                         onChange={toggleSelectAll} />
                </th>
                <th>Title</th>
                <th>Client</th>
                <th>Priority</th>
                <th>Vacancies</th>
                <th>Status</th>
                <th>Checklist</th>
                <th>Applications</th>
                <th style={{ width: 90 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requisitions.map((r) => (
                <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => setDetailId(r.id)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.title} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>#{r.sequence_number}</span></div>
                    {r.jd_title && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>JD: {r.jd_title}</div>}
                  </td>
                  <td style={{ fontSize: 12 }}>{r.client_name || "—"}</td>
                  <td><span className="tiq-badge" style={{ background: `${PRIORITY_COLORS[r.priority]}20`, color: PRIORITY_COLORS[r.priority] }}>{r.priority}</span></td>
                  <td style={{ textAlign: "center" }}>{r.vacancy_count}</td>
                  <td>
                    <span className="tiq-badge" style={{ background: STATUS_COLORS[r.status]?.bg, color: STATUS_COLORS[r.status]?.fg }}>{r.status}</span>
                  </td>
                  <td>
                    {r.checklist_complete ? (
                      <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#10b981", fontSize: 11 }}><Check size={13} /> Complete</span>
                    ) : (
                      <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#f59e0b", fontSize: 11 }}><AlertTriangle size={13} /> Incomplete</span>
                    )}
                  </td>
                  <td style={{ textAlign: "center" }}>{r.application_count}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => openEdit(r)}>Edit</button>
                      <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => handleDelete(r.id)}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Detail / Workflow drawer ─────────────────────────────── */}
      {detail && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
             onClick={() => setDetailId(null)}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 640, width: "94%", maxHeight: "88vh", overflowY: "auto" }}
               onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{detail.title}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>#{detail.sequence_number} · {detail.client_name || "No client"}</div>
              </div>
              <button onClick={() => setDetailId(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div className="tiq-label" style={{ marginBottom: 8 }}>Status Workflow</div>
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                {STATUS_FLOW.map((s, i) => (
                  <div key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="tiq-badge" style={{
                      background: s === detail.status ? STATUS_COLORS[s].bg : "#f1f5f9",
                      color: s === detail.status ? STATUS_COLORS[s].fg : "#94a3b8",
                      fontWeight: s === detail.status ? 700 : 500,
                      border: s === detail.status ? `1.5px solid ${STATUS_COLORS[s].fg}` : "none",
                    }}>{s}</span>
                    {i < STATUS_FLOW.length - 1 && <ChevronRight size={12} color="#cbd5e1" />}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(STATUS_TRANSITIONS[detail.status] || []).map((next) => (
                  <button key={next} className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => handleStatusChange(detail.id, next)}>
                    Move to {next}
                  </button>
                ))}
                {(STATUS_TRANSITIONS[detail.status] || []).length === 0 && (
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Terminal status — no further transitions.</span>
                )}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div className="tiq-label" style={{ marginBottom: 8 }}>Intake Checklist</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  ["salary_approved", "Salary approved"],
                  ["headcount_approved", "Headcount approved"],
                  ["jd_approved", "JD approved"],
                  ["location_confirmed", "Location confirmed"],
                ].map(([field, label]) => (
                  <label key={field} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={!!detail[field]} onChange={(e) => handleChecklistToggle(detail.id, field, e.target.checked)} />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div className="tiq-grid-2" style={{ marginBottom: 20, fontSize: 13 }}>
              <div><span className="tiq-label">Priority</span><div>{detail.priority}</div></div>
              <div><span className="tiq-label">Vacancies</span><div>{detail.vacancy_count}</div></div>
              <div><span className="tiq-label">Employment Type</span><div>{detail.employment_type || "—"}</div></div>
              <div><span className="tiq-label">Location</span><div>{detail.location || "—"}</div></div>
              <div><span className="tiq-label">Salary Range</span><div>{detail.salary_min || detail.salary_max ? `${detail.salary_min ?? "?"} – ${detail.salary_max ?? "?"}` : "—"}</div></div>
              <div><span className="tiq-label">Target Hire Date</span><div>{detail.target_hire_date ? new Date(detail.target_hire_date).toLocaleDateString() : "—"}</div></div>
              <div><span className="tiq-label">Hiring Manager</span><div>{detail.hiring_manager_name || "—"} {detail.hiring_manager_email && `(${detail.hiring_manager_email})`}</div></div>
              <div><span className="tiq-label">Applications</span><div>{detail.application_count}</div></div>
            </div>

            <div className="tiq-flex-end">
              <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => copyHmLink(detail.id)}>
                {linkCopied ? <Check size={13} /> : <Link2 size={13} />} {linkCopied ? "Copied!" : "Copy Hiring Manager Link"}
              </button>
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setDetailId(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add/Edit Requisition Modal ────────────────────────────── */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 640, width: "94%", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{editingId ? "Edit Requisition" : "New Requisition"}</div>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            {formError && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 12 }}>{formError}</div>}

            <div className="tiq-form-group"><label className="tiq-label">Title *</label>
              <input className="tiq-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>

            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Client</label>
                <select className="tiq-select" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value, hiring_manager_contact_id: "" })}>
                  <option value="">— None —</option>
                  {clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
              <div className="tiq-form-group"><label className="tiq-label">Linked JD</label>
                <select className="tiq-select" value={form.jd_record_id} onChange={(e) => setForm({ ...form, jd_record_id: e.target.value })}>
                  <option value="">— None —</option>
                  {jds.map((j: any) => <option key={j.id} value={j.id}>{j.jd_title}</option>)}
                </select></div>
              <div className="tiq-form-group"><label className="tiq-label">Priority</label>
                <select className="tiq-select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select></div>
              <div className="tiq-form-group"><label className="tiq-label">Vacancy Count</label>
                <input className="tiq-input" type="number" min={1} value={form.vacancy_count} onChange={(e) => setForm({ ...form, vacancy_count: Number(e.target.value) })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Reason for Hire</label>
                <select className="tiq-select" value={form.reason_for_hire} onChange={(e) => setForm({ ...form, reason_for_hire: e.target.value })}>
                  <option value="">— Select —</option>
                  {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select></div>
              <div className="tiq-form-group"><label className="tiq-label">Employment Type</label>
                <select className="tiq-select" value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value })}>
                  <option value="">— Select —</option>
                  {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select></div>
              <div className="tiq-form-group"><label className="tiq-label">Location</label>
                <input className="tiq-input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Target Hire Date</label>
                <input className="tiq-input" type="date" value={form.target_hire_date} onChange={(e) => setForm({ ...form, target_hire_date: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Salary Min</label>
                <input className="tiq-input" type="number" value={form.salary_min} onChange={(e) => setForm({ ...form, salary_min: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Salary Max</label>
                <input className="tiq-input" type="number" value={form.salary_max} onChange={(e) => setForm({ ...form, salary_max: e.target.value })} /></div>
            </div>

            <div className="tiq-form-group"><label className="tiq-label">Hiring Manager Contact (from Client)</label>
              <select className="tiq-select" value={form.hiring_manager_contact_id}
                      onChange={(e) => setForm({ ...form, hiring_manager_contact_id: e.target.value })}>
                <option value="">— None / use name+email below —</option>
                {contacts.filter((c: any) => !form.client_id || c.client_id === Number(form.client_id)).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}{c.title ? ` — ${c.title}` : ""}</option>
                ))}
              </select>
            </div>
            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Hiring Manager Name (fallback)</label>
                <input className="tiq-input" value={form.hiring_manager_name} onChange={(e) => setForm({ ...form, hiring_manager_name: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Hiring Manager Email (fallback)</label>
                <input className="tiq-input" value={form.hiring_manager_email} onChange={(e) => setForm({ ...form, hiring_manager_email: e.target.value })} /></div>
            </div>
            <div className="tiq-form-group"><label className="tiq-label">Notes</label>
              <textarea className="tiq-input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>

            <div className="tiq-flex-end" style={{ marginTop: 16 }}>
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" disabled={saving} onClick={submitForm}>{saving ? "Saving…" : "Save Requisition"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add/Edit Client Modal ─────────────────────────────────── */}
      {clientFormState && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 480, width: "94%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{clientFormState.mode === "edit" ? "Edit Client" : "Add Client"}</div>
              <button onClick={() => setClientFormState(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            {clientFormError && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 12 }}>{clientFormError}</div>}
            <div className="tiq-form-group"><label className="tiq-label">Client / Company Name *</label>
              <input className="tiq-input" value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
                     placeholder="e.g. Commonwealth Bank of Australia" /></div>
            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Address</label>
                <input className="tiq-input" value={clientForm.address} onChange={(e) => setClientForm({ ...clientForm, address: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">ABN</label>
                <input className="tiq-input" value={clientForm.abn} onChange={(e) => setClientForm({ ...clientForm, abn: e.target.value })} /></div>
            </div>
            <div className="tiq-form-group"><label className="tiq-label">Area of Work</label>
              <input className="tiq-input" value={clientForm.area_of_work} onChange={(e) => setClientForm({ ...clientForm, area_of_work: e.target.value })}
                     placeholder="e.g. Banking, Insurance" /></div>

            <div style={{ borderTop: "1px solid var(--border)", margin: "16px 0 14px", paddingTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Primary Contact</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
                Optional — the main point of contact at this client (e.g. HR or hiring manager). Leave blank to skip.
              </div>
            </div>
            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Contact Name</label>
                <input className="tiq-input" value={clientForm.contact_name} onChange={(e) => setClientForm({ ...clientForm, contact_name: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Title</label>
                <input className="tiq-input" value={clientForm.contact_title} onChange={(e) => setClientForm({ ...clientForm, contact_title: e.target.value })} /></div>
            </div>
            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Contact Email</label>
                <input className="tiq-input" value={clientForm.contact_email} onChange={(e) => setClientForm({ ...clientForm, contact_email: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Contact Phone</label>
                <input className="tiq-input" value={clientForm.contact_phone} onChange={(e) => setClientForm({ ...clientForm, contact_phone: e.target.value })} /></div>
            </div>

            <div className="tiq-flex-end">
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setClientFormState(null)}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" disabled={clientFormSaving} onClick={submitClientForm}>
                {clientFormSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Import Requisitions (CSV) ──────────────────────────── */}
      {showCsv && (
        <CsvImportModal
          title="Requisitions"
          columns={["title", "client_name", "priority", "vacancy_count", "reason_for_hire", "employment_type", "location", "salary_min", "salary_max", "target_hire_date", "hiring_manager_name", "hiring_manager_email", "notes"]}
          sampleRow={["Senior Data Engineer", "Northwind Group", "High", "2", "Growth", "Full-time", "Sydney NSW", "120000", "150000", "2026-11-01", "Priya Anand", "priya.anand@northwindgroup.example", "Urgent — client needs by Q4"]}
          onImport={(form) => requisitionApi.csvImport(form)}
          onClose={() => setShowCsv(false)}
          onDone={load}
        />
      )}

      {/* ── Bulk Import Clients (CSV) — kept here too, not just buried in
          CandidateLens → Management → Clients, since this is where a
          recruiter is actually working when they need to add clients
          before/while building requisitions. ─────────────────────────── */}
      {showClientCsv && (
        <CsvImportModal
          title="Clients"
          columns={["name", "address", "abn", "area_of_work", "contact_name", "contact_title", "contact_email", "contact_phone"]}
          sampleRow={["Northwind Group", "Sydney NSW", "51 824 753 556", "Financial Services", "Priya Anand", "Head of Talent", "priya.anand@northwindgroup.example", "0412 555 101"]}
          onImport={(form) => candidateTrackApi.importClientsCsv(form)}
          onClose={() => setShowClientCsv(false)}
          onDone={load}
        />
      )}
    </div>
  );
}
