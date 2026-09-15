import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Building2, Truck, Inbox, ClipboardCheck, Link2, Copy, Check, X,
  Trash2, ExternalLink, Plus, Upload, Search,
} from "lucide-react";
import { portalApi, candidateTrackApi, requisitionApi } from "../lib/api";
import CsvImportModal from "../components/candidatetrack/CsvImportModal";
import { ResizableFilterHeader } from "../components/ResizableFilterHeader";
import DataTable from "../components/DataTable";

const SECTION_BY_PATH: Record<string, "client" | "vendor"> = {
  "/app/client-portal": "client",
  "/app/vendor-portal": "vendor",
  "/app/portals": "client", // old combined route, kept working
};

// Client Portal shows client-related tabs (Clients + Client Feedback),
// Vendor Portal shows vendor-related tabs (Vendors & Portal Links +
// Vendor Submissions) — the natural mapping, restored after a brief
// detour where these were intentionally swapped and then swapped back.
export default function PortalsPage() {
  const location = useLocation();
  const section = SECTION_BY_PATH[location.pathname] || "client";
  const [clientPageTab, setClientPageTab] = useState<"clients" | "feedback">("clients");
  const [vendorPageTab, setVendorPageTab] = useState<"vendors" | "submissions">("vendors");

  return (
    <div className="tiq-content">
      <div className="tiq-page-header">
        <div className="tiq-page-title">{section === "client" ? "Client Portal" : "Vendor Portal"}</div>
        <div className="tiq-page-sub">
          {section === "client"
            ? "Your client directory, portal links, and their feedback on candidates."
            : "Vendor portal links, requisition assignments, and their candidate submissions."}
        </div>
      </div>

      {section === "client" ? (
        <>
          <div className="tiq-tabs">
            <button className={`tiq-tab${clientPageTab === "clients" ? " active" : ""}`} onClick={() => setClientPageTab("clients")}>
              <Building2 size={12} style={{ display: "inline", marginRight: 6 }} /> Clients
            </button>
            <button className={`tiq-tab${clientPageTab === "feedback" ? " active" : ""}`} onClick={() => setClientPageTab("feedback")}>
              <ClipboardCheck size={12} style={{ display: "inline", marginRight: 6 }} /> Client Feedback
            </button>
          </div>
          {clientPageTab === "clients" && <ClientPortalsTab />}
          {clientPageTab === "feedback" && <FeedbackTab />}
        </>
      ) : (
        <>
          <div className="tiq-tabs">
            <button className={`tiq-tab${vendorPageTab === "vendors" ? " active" : ""}`} onClick={() => setVendorPageTab("vendors")}>
              <Truck size={12} style={{ display: "inline", marginRight: 6 }} /> Vendors
            </button>
            <button className={`tiq-tab${vendorPageTab === "submissions" ? " active" : ""}`} onClick={() => setVendorPageTab("submissions")}>
              <Inbox size={12} style={{ display: "inline", marginRight: 6 }} /> Vendor Submissions
            </button>
          </div>
          {vendorPageTab === "vendors" && <VendorPortalsTab />}
          {vendorPageTab === "submissions" && <SubmissionsTab />}
        </>
      )}
    </div>
  );
}

function copyToClipboard(text: string, onDone: () => void) {
  navigator.clipboard.writeText(text);
  onDone();
}

// ══════════════════════════════════════════════════════════════════════════
// CLIENT PORTALS TAB
// ══════════════════════════════════════════════════════════════════════════

const emptyClientForm = { name: "", address: "", abn: "", phone: "", email: "", area_of_work: "" };

function ClientPortalsTab() {
  const [clients, setClients] = useState<any[]>([]);
  const [requisitions, setRequisitions] = useState<any[]>([]);
  const [tokens, setTokens] = useState<Record<number, any>>({});
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // "Add Client" and "Bulk Import Clients" moved here from Requisitions —
  // this is the client directory's actual home now; Requisitions just
  // reads from it (client dropdown).
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState(emptyClientForm);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");
  const [showCsv, setShowCsv] = useState(false);

  // Global search + per-column filters, same pattern as Requisitions'
  // own table (ResizableFilterHeader) — every field shown, each with a
  // dropdown filter (itself searchable once there are more than a
  // handful of values), plus one search box across all of them at once.
  const [globalSearch, setGlobalSearch] = useState("");
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [colWidths, setColWidths] = useState<Record<string, number>>({
    name: 180, address: 160, abn: 130, phone: 130, email: 190, area_of_work: 150, requisitions: 100, portal_link: 200,
  });
  const setColWidth = (key: string, w: number) => setColWidths((prev) => ({ ...prev, [key]: w }));
  const setColFilter = (key: string, v: string) => setColFilters((prev) => ({ ...prev, [key]: v }));

  const load = async () => {
    setLoading(true);
    try {
      const [cl, reqs] = await Promise.all([candidateTrackApi.listClients(), requisitionApi.list()]);
      setClients(cl);
      setRequisitions(reqs);
      const results = await Promise.all(cl.map((c: any) => portalApi.getClientToken(c.id).catch(() => ({ active: false }))));
      const map: Record<number, any> = {};
      cl.forEach((c: any, i: number) => { map[c.id] = results[i]; });
      setTokens(map);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const generate = async (clientId: number) => {
    const res = await portalApi.createClientToken(clientId);
    setTokens((prev) => ({ ...prev, [clientId]: { active: true, ...res } }));
  };
  const revoke = async (clientId: number) => {
    if (!confirm("Revoke this client's portal link? Their existing link will stop working immediately.")) return;
    await portalApi.revokeClientToken(clientId);
    setTokens((prev) => ({ ...prev, [clientId]: { active: false } }));
  };

  const openAdd = () => { setAddForm(emptyClientForm); setAddError(""); setShowAddForm(true); };
  const submitAdd = async () => {
    if (!addForm.name.trim()) { setAddError("Client name is required."); return; }
    setAddSaving(true); setAddError("");
    try {
      await candidateTrackApi.createClient(addForm);
      setShowAddForm(false);
      load();
    } catch (e: any) {
      setAddError(e?.response?.data?.detail || "Failed to save.");
    } finally {
      setAddSaving(false);
    }
  };

  const reqCount = (clientId: number) => requisitions.filter((r: any) => r.client_id === clientId).length;
  const portalLinkText = (c: any) => {
    const t = tokens[c.id];
    return t?.active ? `${window.location.origin}${t.portal_path}` : "No active link";
  };
  const getColValue = (c: any, key: string): string => {
    switch (key) {
      case "name": return c.name || "";
      case "address": return c.address || "—";
      case "abn": return c.abn || "—";
      case "phone": return c.phone || "—";
      case "email": return c.email || "—";
      case "area_of_work": return c.area_of_work || "—";
      case "requisitions": return String(reqCount(c.id));
      case "portal_link": return portalLinkText(c);
      default: return "";
    }
  };
  const colOptions = (key: string) => Array.from(new Set(clients.map((c) => getColValue(c, key)))).sort();
  const searchableKeys = ["name", "address", "abn", "phone", "email", "area_of_work"];
  const filteredClients = clients.filter((c: any) => {
    if (!Object.entries(colFilters).every(([key, val]) => !val || getColValue(c, key) === val)) return false;
    if (globalSearch.trim()) {
      const q = globalSearch.trim().toLowerCase();
      const haystack = searchableKeys.map((k) => getColValue(c, k)).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  return (
    <div>
      {/* All buttons in one row, left-aligned. */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, justifyContent: "flex-start" }}>
        <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={openAdd}>
          <Plus size={14} /> Add Client
        </button>
        <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setShowCsv(true)}>
          <Upload size={14} /> Bulk Import Clients
        </button>
      </div>

      <div style={{ position: "relative", maxWidth: 360, marginBottom: 12 }}>
        <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
        <input
          className="tiq-input" style={{ paddingLeft: 32 }}
          placeholder="Search clients…"
          value={globalSearch}
          onChange={(e) => setGlobalSearch(e.target.value)}
        />
        {globalSearch && (
          <button onClick={() => setGlobalSearch("")}
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
            <X size={14} />
          </button>
        )}
      </div>

      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : clients.length === 0 ? (
        <div className="tiq-empty">No clients yet — click "Add Client" or "Bulk Import Clients" to get started.</div>
      ) : filteredClients.length === 0 ? (
        <div className="tiq-empty">
          No clients match the current filters.{" "}
          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => { setColFilters({}); setGlobalSearch(""); }}>Clear filters</button>
        </div>
      ) : (
        <ClientPortalsTable
          clients={filteredClients} tokens={tokens} copiedId={copiedId} setCopiedId={setCopiedId}
          generate={generate} revoke={revoke} reqCount={reqCount}
          colFilters={colFilters} setColFilter={setColFilter} colOptions={colOptions}
          colWidths={colWidths} setColWidth={setColWidth}
        />
      )}

      {showAddForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
             onMouseDown={(e) => { if (e.target === e.currentTarget) setShowAddForm(false); }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 460, width: "94%", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Add Client</div>
              <button onClick={() => setShowAddForm(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            {addError && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 12 }}>{addError}</div>}
            <div className="tiq-form-group"><label className="tiq-label">Client / Company Name *</label>
              <input className="tiq-input" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                     placeholder="e.g. Commonwealth Bank of Australia" /></div>
            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Address</label>
                <input className="tiq-input" value={addForm.address} onChange={(e) => setAddForm({ ...addForm, address: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">ABN</label>
                <input className="tiq-input" value={addForm.abn} onChange={(e) => setAddForm({ ...addForm, abn: e.target.value })} /></div>
            </div>
            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Phone</label>
                <input className="tiq-input" value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Email</label>
                <input className="tiq-input" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} /></div>
            </div>
            <div className="tiq-form-group"><label className="tiq-label">Area of Work</label>
              <input className="tiq-input" value={addForm.area_of_work} onChange={(e) => setAddForm({ ...addForm, area_of_work: e.target.value })}
                     placeholder="e.g. Banking, Insurance" /></div>
            <div className="tiq-flex-end">
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setShowAddForm(false)}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" disabled={addSaving} onClick={submitAdd}>{addSaving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}

      {showCsv && (
        <CsvImportModal
          title="Clients"
          columns={["name", "address", "abn", "phone", "email", "area_of_work", "contact_name", "contact_title", "contact_email", "contact_phone"]}
          sampleRow={["Northwind Group", "Sydney NSW", "51 824 753 556", "02 9000 1000", "info@northwindgroup.example", "Financial Services", "Priya Anand", "Head of Talent", "priya.anand@northwindgroup.example", "0412 555 101"]}
          onImport={(form) => candidateTrackApi.importClientsCsv(form)}
          onClose={() => setShowCsv(false)}
          onDone={load}
        />
      )}
    </div>
  );
}

function ClientPortalsTable({ clients, tokens, copiedId, setCopiedId, generate, revoke, reqCount, colFilters, setColFilter, colOptions, colWidths, setColWidth }: any) {
  return (
    <div className="tiq-table-wrap">
      <table className="tiq-table" style={{ tableLayout: "fixed" }}>
        <thead>
          <tr>
            <ResizableFilterHeader label="Name" value={colFilters.name} options={colOptions("name")} onChange={(v) => setColFilter("name", v)} width={colWidths.name} onWidthChange={(w: number) => setColWidth("name", w)} />
            <ResizableFilterHeader label="Address" value={colFilters.address} options={colOptions("address")} onChange={(v) => setColFilter("address", v)} width={colWidths.address} onWidthChange={(w: number) => setColWidth("address", w)} />
            <ResizableFilterHeader label="ABN" value={colFilters.abn} options={colOptions("abn")} onChange={(v) => setColFilter("abn", v)} width={colWidths.abn} onWidthChange={(w: number) => setColWidth("abn", w)} />
            <ResizableFilterHeader label="Phone" value={colFilters.phone} options={colOptions("phone")} onChange={(v) => setColFilter("phone", v)} width={colWidths.phone} onWidthChange={(w: number) => setColWidth("phone", w)} />
            <ResizableFilterHeader label="Email" value={colFilters.email} options={colOptions("email")} onChange={(v) => setColFilter("email", v)} width={colWidths.email} onWidthChange={(w: number) => setColWidth("email", w)} />
            <ResizableFilterHeader label="Area of Work" value={colFilters.area_of_work} options={colOptions("area_of_work")} onChange={(v) => setColFilter("area_of_work", v)} width={colWidths.area_of_work} onWidthChange={(w: number) => setColWidth("area_of_work", w)} />
            <ResizableFilterHeader label="Requisitions" value={colFilters.requisitions} options={colOptions("requisitions")} onChange={(v) => setColFilter("requisitions", v)} width={colWidths.requisitions} onWidthChange={(w: number) => setColWidth("requisitions", w)} align="center" />
            <ResizableFilterHeader label="Portal Link" filterable={false} width={colWidths.portal_link} onWidthChange={(w: number) => setColWidth("portal_link", w)} />
            <th style={{ width: 170 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c: any) => {
            const t = tokens[c.id];
            const fullUrl = t?.active ? `${window.location.origin}${t.portal_path}` : "";
            return (
              <tr key={c.id}>
                <td style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</td>
                <td style={{ fontSize: 12 }}>{c.address || "—"}</td>
                <td style={{ fontSize: 12 }}>{c.abn || "—"}</td>
                <td style={{ fontSize: 12 }}>{c.phone || "—"}</td>
                <td style={{ fontSize: 12 }}>{c.email || "—"}</td>
                <td style={{ fontSize: 12 }}>{c.area_of_work || "—"}</td>
                <td style={{ fontSize: 12, textAlign: "center" }}>{reqCount(c.id)}</td>
                <td style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t?.active ? fullUrl : <span style={{ color: "var(--text-muted)" }}>No active link</span>}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    {t?.active ? (
                      <>
                        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => copyToClipboard(fullUrl, () => { setCopiedId(c.id); setTimeout(() => setCopiedId(null), 1500); })}>
                          {copiedId === c.id ? <Check size={13} /> : <Copy size={13} />}
                        </button>
                        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => generate(c.id)} title="Rotate (invalidates old link)">Rotate</button>
                        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" style={{ color: "#ef4444" }} onClick={() => revoke(c.id)}>Revoke</button>
                      </>
                    ) : (
                      <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => generate(c.id)}><Link2 size={12} /> Generate Link</button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// VENDOR PORTALS TAB
// ══════════════════════════════════════════════════════════════════════════

function VendorPortalsTab() {
  const [vendors, setVendors] = useState<any[]>([]);
  const [requisitions, setRequisitions] = useState<any[]>([]);
  const [tokens, setTokens] = useState<Record<number, any>>({});
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [assignModal, setAssignModal] = useState<any | null>(null);
  const [assignReqId, setAssignReqId] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [v, r, a] = await Promise.all([candidateTrackApi.listVendors(), requisitionApi.list(), portalApi.listVendorAssignments()]);
      setVendors(v);
      setRequisitions(r);
      setAssignments(a);
      const results = await Promise.all(v.map((x: any) => portalApi.getVendorToken(x.id).catch(() => ({ active: false }))));
      const map: Record<number, any> = {};
      v.forEach((x: any, i: number) => { map[x.id] = results[i]; });
      setTokens(map);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const generate = async (vendorId: number) => {
    const res = await portalApi.createVendorToken(vendorId);
    setTokens((prev) => ({ ...prev, [vendorId]: { active: true, ...res } }));
  };
  const revoke = async (vendorId: number) => {
    if (!confirm("Revoke this vendor's portal link? Their existing link will stop working immediately.")) return;
    await portalApi.revokeVendorToken(vendorId);
    setTokens((prev) => ({ ...prev, [vendorId]: { active: false } }));
  };
  const assign = async () => {
    if (!assignModal || !assignReqId) return;
    await portalApi.assignVendor(assignModal.id, Number(assignReqId));
    setAssignReqId("");
    setAssignModal(null);
    await load();
  };
  const unassign = async (id: number) => {
    await portalApi.removeVendorAssignment(id);
    await load();
  };

  if (loading) return <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>;
  if (vendors.length === 0) return <div className="tiq-empty">No vendors yet — add one first.</div>;

  return (
    <div>
      <div className="tiq-table-wrap">
        <DataTable
          columns={["name", "portal_link", "assigned"]}
          columnLabels={{ name: "Vendor", portal_link: "Portal Link", assigned: "Assigned Requisitions" }}
          rows={vendors.map((v: any) => {
            const t = tokens[v.id];
            const fullUrl = t?.active ? `${window.location.origin}${t.portal_path}` : "";
            const myAssignments = assignments.filter((a) => a.vendor_id === v.id);
            return { ...v, _fullUrl: fullUrl, _active: t?.active, _assignments: myAssignments, portal_link: t?.active ? fullUrl : "No active link", assigned: myAssignments.map((a: any) => a.requisition_title).join(", ") };
          })}
          getRowKey={(v: any) => v.id}
          actionsLabel="Actions"
          actionsWidth={200}
          renderActions={(v: any) => (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {v._active ? (
                <>
                  <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => copyToClipboard(v._fullUrl, () => { setCopiedId(v.id); setTimeout(() => setCopiedId(null), 1500); })}>
                    {copiedId === v.id ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                  <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" style={{ color: "#ef4444" }} onClick={() => revoke(v.id)}>Revoke</button>
                </>
              ) : (
                <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => generate(v.id)}><Link2 size={12} /> Generate Link</button>
              )}
              <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setAssignModal(v)}>+ Assign Req</button>
            </div>
          )}
          renderCell={(v: any, col: string) => {
            switch (col) {
              case "name": return <span style={{ fontWeight: 600, fontSize: 13 }}>{v.name}</span>;
              case "portal_link": return <span style={{ fontSize: 12, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {v._active ? v._fullUrl : <span style={{ color: "var(--text-muted)" }}>No active link</span>}
              </span>;
              case "assigned": return (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 220 }}>
                  {v._assignments.map((a: any) => (
                    <span key={a.id} className="tiq-badge tiq-badge-slate" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {a.requisition_title}
                      <X size={10} style={{ cursor: "pointer" }} onClick={() => unassign(a.id)} />
                    </span>
                  ))}
                </div>
              );
              default: return null;
            }
          }}
        />
      </div>

      {assignModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 420, width: "94%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Assign {assignModal.name} to a Requisition</div>
              <button onClick={() => setAssignModal(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <select className="tiq-select" style={{ width: "100%" }} value={assignReqId} onChange={(e) => setAssignReqId(e.target.value)}>
              <option value="">— Select requisition —</option>
              {requisitions.map((r: any) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
            <div className="tiq-flex-end" style={{ marginTop: 16 }}>
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setAssignModal(null)}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" onClick={assign}>Assign</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// VENDOR SUBMISSIONS TAB
// ══════════════════════════════════════════════════════════════════════════

function SubmissionsTab() {
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState("Pending Review");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setSubmissions(await portalApi.listVendorSubmissions(statusFilter || undefined));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [statusFilter]);

  const accept = async (id: number) => {
    try {
      await portalApi.reviewVendorSubmission(id, "accept");
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not accept this submission.");
    }
  };
  const reject = async (id: number) => {
    const reason = prompt("Reason (optional):") || "";
    try {
      await portalApi.reviewVendorSubmission(id, "reject", reason);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not reject this submission.");
    }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["Pending Review", "Accepted", "Rejected", ""].map((s) => (
          <button key={s || "all"} className={`tiq-btn tiq-btn-sm ${statusFilter === s ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setStatusFilter(s)}>
            {s || "All"}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : submissions.length === 0 ? (
        <div className="tiq-empty">No submissions here yet.</div>
      ) : (
        <div className="tiq-table-wrap">
        <DataTable
          columns={["full_name", "vendor_name", "requisition_title", "resume", "vendor_notes", "status"]}
          columnLabels={{ full_name: "Candidate", vendor_name: "Vendor", requisition_title: "Requisition", resume: "Resume", vendor_notes: "Notes", status: "Status" }}
          rows={submissions.map((s: any) => ({ ...s, resume: s.has_resume ? "View" : "—" }))}
          getRowKey={(s: any) => s.id}
          actionsLabel="Actions"
          actionsWidth={160}
          renderActions={(s: any) => s.status === "Pending Review" ? (
            <div style={{ display: "flex", gap: 4 }}>
              <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => accept(s.id)}><Check size={12} /> Accept</button>
              <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ color: "#ef4444" }} onClick={() => reject(s.id)}><X size={12} /> Reject</button>
            </div>
          ) : null}
          renderCell={(s: any, col: string) => {
            switch (col) {
              case "full_name": return (
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {s.full_name}
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.email} {s.phone}</div>
                </div>
              );
              case "vendor_name": return <span style={{ fontSize: 12 }}>{s.vendor_name}</span>;
              case "requisition_title": return <span style={{ fontSize: 12 }}>{s.requisition_title}</span>;
              case "resume": return <span style={{ fontSize: 12 }}>{s.has_resume ? <a href={portalApi.submissionResumeUrl(s.id)} target="_blank" rel="noreferrer">View</a> : "—"}</span>;
              case "vendor_notes": return <span style={{ fontSize: 12, maxWidth: 200 }}>{s.vendor_notes}</span>;
              case "status": return <span className="tiq-badge tiq-badge-slate">{s.status}</span>;
              default: return null;
            }
          }}
        />
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// CLIENT FEEDBACK TAB
// ══════════════════════════════════════════════════════════════════════════

function FeedbackTab() {
  const [feedback, setFeedback] = useState<any[]>([]);
  const [showAckd, setShowAckd] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setFeedback(await portalApi.listClientFeedback(showAckd ? undefined : false));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [showAckd]);

  const ack = async (id: number) => {
    await portalApi.acknowledgeFeedback(id);
    await load();
  };

  return (
    <div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 16 }}>
        <input type="checkbox" checked={showAckd} onChange={(e) => setShowAckd(e.target.checked)} />
        Show acknowledged feedback too
      </label>
      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : feedback.length === 0 ? (
        <div className="tiq-empty">No feedback from clients yet.</div>
      ) : (
        feedback.map((f: any) => (
          <div key={f.id} className="tiq-card" style={{ marginBottom: 10, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{f.candidate_name}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>from {f.contact_name || "a client contact"}</div>
              </div>
              <span className="tiq-badge tiq-badge-teal">{f.decision}</span>
            </div>
            {f.comments && <div style={{ fontSize: 13, marginTop: 8 }}>{f.comments}</div>}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{new Date(f.submitted_at).toLocaleString()}</span>
              {!f.acknowledged && (
                <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => ack(f.id)}><ClipboardCheck size={12} /> Mark Acknowledged</button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
