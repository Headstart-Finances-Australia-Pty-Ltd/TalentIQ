import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X, Trash2, Users, Download } from "lucide-react";
import { requisitionApi, candidateTrackApi, api } from "../lib/api";
import SearchableSelect from "../components/SearchableSelect";
import DataTable from "../components/DataTable";

// Must match the key AdminConsolePage.tsx's Modules Management > System
// Tools section toggles — that's what actually hides/shows this button,
// same pattern FileManagerPage.tsx uses for its Force Delete button.
const PULL_FROM_REQUISITIONS_MODULE_ROUTE = "hiring-managers/pull-from-requisitions";

// Hiring Managers — a directory across all clients, promoted to its own
// sidebar entry (was a toggle buried inside Requisitions) since it's
// really its own roster: a hiring manager is entered once and reused
// across however many roles they're linked to — including zero, for
// someone added ahead of any open role existing yet.
//
// Reuses the same ClientContact records/endpoints Requisitions' own
// "Hiring Manager" dropdown already reads from and writes to (see that
// page's client_id-scoped select) — linking a hiring manager to a role
// still happens on the requisition itself; this page is the roster +
// where-are-they-assigned view of the same underlying data, not a
// second, separate system.
export default function HiringManagersPage({ embedded = false }: { embedded?: boolean } = {}) {
  // Same query key AppLayout.tsx/AdminConsolePage.tsx use — shares the
  // cached result rather than re-fetching, and picks up a Modules
  // Management change immediately once that page's Save invalidates it.
  const { data: moduleToggles = {} } = useQuery({
    queryKey: ["module-toggles"],
    queryFn: () => api.get("/api/admin/module-toggles").then((r) => r.data as Record<string, boolean>),
  });
  const pullFromRequisitionsEnabled = moduleToggles[PULL_FROM_REQUISITIONS_MODULE_ROUTE] ?? true;

  const [clients, setClients] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [requisitions, setRequisitions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [formState, setFormState] = useState<null | { mode: "create" } | { mode: "edit"; contact: any }>(null);
  const [form, setForm] = useState({ client_id: "" as string | number, name: "", title: "", email: "", phone: "", department: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [detail, setDetail] = useState<any | null>(null);

  // One-time catch-up: some requisitions only ever got a hiring manager
  // typed as free-text (no formal ClientContact), so they never showed
  // up in this roster at all — this pulls them in without duplicating
  // anyone who already exists here.
  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState("");
  const pullFromRequisitions = async () => {
    setPulling(true); setPullMsg("");
    try {
      const r = await requisitionApi.pullHiringManagersFromRequisitions();
      const parts = [];
      if (r.created) parts.push(`${r.created} added`);
      if (r.linked_to_existing) parts.push(`${r.linked_to_existing} linked to existing entries`);
      if (r.skipped_no_client) parts.push(`${r.skipped_no_client} skipped (no client on the requisition)`);
      setPullMsg(parts.length ? parts.join(", ") + "." : "Nothing to pull — every requisition's hiring manager is already in the directory.");
      load();
    } catch (e: any) {
      setPullMsg(e?.response?.data?.detail || "Failed to pull hiring managers.");
    } finally {
      setPulling(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [cl, ct, reqs] = await Promise.all([
        candidateTrackApi.listClients(),
        requisitionApi.listContacts(),
        requisitionApi.list(),
      ]);
      setClients(cl);
      setContacts(ct);
      setRequisitions(reqs);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const clientNameById = (id: number) => clients.find((c: any) => c.id === id)?.name || "—";
  const rolesForContact = (contactId: number) => requisitions.filter((r: any) => r.hiring_manager_contact_id === contactId);

  const openAdd = () => {
    setForm({ client_id: clients[0]?.id ?? "", name: "", title: "", email: "", phone: "", department: "" });
    setFormState({ mode: "create" });
    setFormError("");
  };
  const openEdit = (c: any) => {
    setForm({ client_id: c.client_id, name: c.name, title: c.title || "", email: c.email || "", phone: c.phone || "", department: c.department || "" });
    setFormState({ mode: "edit", contact: c });
    setFormError("");
  };
  const submitForm = async () => {
    if (!form.name.trim()) { setFormError("Name is required."); return; }
    if (!form.client_id) { setFormError("Select which client this hiring manager belongs to."); return; }
    setSaving(true); setFormError("");
    try {
      const payload = { client_id: Number(form.client_id), name: form.name.trim(), title: form.title, email: form.email, phone: form.phone, department: form.department, is_primary: false, notes: "" };
      if (formState?.mode === "edit") await requisitionApi.updateContact(formState.contact.id, payload);
      else await requisitionApi.createContact(payload);
      setFormState(null);
      load();
    } catch (e: any) {
      setFormError(e?.response?.data?.detail || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };
  const handleDelete = async (c: any) => {
    if (!confirm(`Remove ${c.name} from the Hiring Managers directory?`)) return;
    await requisitionApi.deleteContact(c.id);
    setContacts((prev) => prev.filter((x) => x.id !== c.id));
    setDetail(null);
  };

  return (
    <div className={embedded ? "" : "tiq-content"}>
      {!embedded && (
        <div className="tiq-page-header">
          <div className="tiq-page-title">Hiring Managers</div>
          <div className="tiq-page-sub">A reusable roster, linked to whichever roles each person is actually assigned to.</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 16, marginBottom: 8, alignItems: "center" }}>
        <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={openAdd} disabled={clients.length === 0}
                title={clients.length === 0 ? "Add a client first, under Vendor Portal" : ""}>
          <Plus size={14} /> Add Hiring Manager
        </button>
        {pullFromRequisitionsEnabled && (
          <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={pullFromRequisitions} disabled={pulling}>
            <Download size={14} /> {pulling ? "Pulling…" : "Pull from Requisitions"}
          </button>
        )}
      </div>
      {pullMsg && <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>{pullMsg}</div>}

      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : contacts.length === 0 ? (
        <div className="tiq-empty">
          <Users size={22} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>No hiring managers yet. Click "Add Hiring Manager" to build the directory.</div>
        </div>
      ) : (
        <DataTable
          columns={["name", "client", "title_dept", "email", "phone", "roles_assigned"]}
          columnLabels={{ name: "Name", client: "Client", title_dept: "Title / Department", email: "Email", phone: "Phone", roles_assigned: "Roles Assigned" }}
          rows={contacts.map((c: any) => {
            const roles = rolesForContact(c.id);
            return {
              ...c,
              client: clientNameById(c.client_id),
              title_dept: [c.title, c.department].filter(Boolean).join(" · ") || "—",
              roles_assigned: roles.length === 0 ? "Not assigned" : roles.map((r: any) => r.title).join(", "),
            };
          })}
          getRowKey={(c: any) => c.id}
          actionsLabel="Actions"
          actionsWidth={90}
          renderActions={(c: any) => (
            <div style={{ display: "flex", gap: 4 }}>
              <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Edit" onClick={() => openEdit(c)}>Edit</button>
              <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Delete" onClick={() => handleDelete(c)}><Trash2 size={13} /></button>
            </div>
          )}
          renderCell={(c: any, col: string) => {
            switch (col) {
              case "name": return (
                <button type="button" onClick={() => setDetail(c)}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 600, color: "var(--brand-teal, #0d9488)", textDecoration: "underline" }}>
                  {c.name}
                </button>
              );
              case "client": return <span style={{ fontSize: 12 }}>{c.client}</span>;
              case "title_dept": return <span style={{ fontSize: 12 }}>{c.title_dept}</span>;
              case "email": return <span style={{ fontSize: 12 }}>{c.email || "—"}</span>;
              case "phone": return <span style={{ fontSize: 12 }}>{c.phone || "—"}</span>;
              case "roles_assigned": return <span style={{ fontSize: 12, color: c.roles_assigned === "Not assigned" ? "var(--text-muted)" : undefined }}>{c.roles_assigned}</span>;
              default: return null;
            }
          }}
        />
      )}

      {formState && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
             onMouseDown={(e) => { if (e.target === e.currentTarget) setFormState(null); }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 460, width: "94%", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{formState.mode === "edit" ? "Edit Hiring Manager" : "Add Hiring Manager"}</div>
              <button onClick={() => setFormState(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            {formError && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 12 }}>{formError}</div>}
            <div className="tiq-form-group"><label className="tiq-label">Client *</label>
              <SearchableSelect
                value={String(form.client_id || "")}
                onChange={(v) => setForm({ ...form, client_id: v })}
                placeholder="— Select a client —"
                options={clients.map((c: any) => ({ value: String(c.id), label: c.name }))}
              />
            </div>
            <div className="tiq-form-group"><label className="tiq-label">Name *</label>
              <input className="tiq-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                     placeholder="e.g. Priya Anand" /></div>
            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Title</label>
                <input className="tiq-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                       placeholder="e.g. Head of Talent" /></div>
              <div className="tiq-form-group"><label className="tiq-label">Department</label>
                <input className="tiq-input" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
            </div>
            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Email</label>
                <input className="tiq-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Phone</label>
                <input className="tiq-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: -6, marginBottom: 14 }}>
              To link this hiring manager to a role, open that requisition (Requisitions page) and set them as its
              Hiring Manager contact — they'll show up here under "Roles Assigned" automatically.
            </p>
            <div className="tiq-flex-end">
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setFormState(null)}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" disabled={saving} onClick={submitForm}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
             onMouseDown={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 440, width: "94%", maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{detail.name}</div>
              <button onClick={() => setDetail(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13.5 }}>
              <div><span style={{ color: "var(--text-muted)" }}>Client:</span> {clientNameById(detail.client_id)}</div>
              {detail.title && <div><span style={{ color: "var(--text-muted)" }}>Title:</span> {detail.title}</div>}
              {detail.department && <div><span style={{ color: "var(--text-muted)" }}>Department:</span> {detail.department}</div>}
              {detail.email && <div><span style={{ color: "var(--text-muted)" }}>Email:</span> {detail.email}</div>}
              {detail.phone && <div><span style={{ color: "var(--text-muted)" }}>Phone:</span> {detail.phone}</div>}
              <div>
                <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>Roles Assigned:</div>
                {rolesForContact(detail.id).length === 0 ? (
                  <div style={{ color: "var(--text-muted)" }}>Not assigned to any role yet.</div>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {rolesForContact(detail.id).map((r: any) => (
                      <li key={r.id}>{r.title} <span style={{ color: "var(--text-muted)" }}>(#{r.sequence_number} · {r.status})</span></li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="tiq-flex-end" style={{ marginTop: 16 }}>
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setDetail(null)}>Close</button>
              <button className="tiq-btn tiq-btn-outline" onClick={() => { openEdit(detail); setDetail(null); }}>Edit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
