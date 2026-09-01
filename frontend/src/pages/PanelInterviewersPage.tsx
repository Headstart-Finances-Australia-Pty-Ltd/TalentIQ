import { useEffect, useState } from "react";
import { Plus, X, Trash2, Pencil, Users, Search } from "lucide-react";
import { interviewApi } from "../lib/api";
import { ResizableFilterHeader } from "../components/ResizableFilterHeader";

const emptyForm = { name: "", expertise_area: "", company: "", phone: "", email: "", notes: "" };

const PANEL_INTERVIEWER_COL_WIDTHS: Record<string, number> = {
  name: 170, expertise_area: 180, company: 160, phone: 140, email: 190, assignment: 220,
};

// Raw value behind each column — used for the header filter dropdowns,
// sorting, and the global search box. Kept separate from the cell JSX
// (which links out to the panel popup) below.
function getInterviewerColValue(p: any, key: string): string {
  switch (key) {
    case "name": return p.name || "";
    case "expertise_area": return p.expertise_area || "";
    case "company": return p.company || "";
    case "phone": return p.phone || "";
    case "email": return p.email || "";
    case "assignment": return (p.assignments || []).length === 0
      ? "Not assigned"
      : p.assignments.map((a: any) => `Panel #${a.panel_number}${a.role_for ? ` (${a.role_for})` : ""}`).join(", ");
    default: return "";
  }
}
const INTERVIEWER_COLS = ["name", "expertise_area", "company", "phone", "email", "assignment"];

// Panel Interviewers — a real directory of subject-matter experts who sit
// on Panel Interview rounds, entered once and reused (see
// capabilities/interview/models.py's PanelInterviewer for the full
// reasoning). "Assignment" is derived server-side from Interview Panel
// setups whose member list includes this person — not stored here — so
// it can never drift out of sync with the real panel data.
export default function PanelInterviewersPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [people, setPeople] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  // Clicking a "Panel #N" badge in the Assignment column opens this —
  // same idea as Interview Scheduling's panel popup, kept local here
  // rather than shared, since it's a small, self-contained lookup.
  const [panelPopup, setPanelPopup] = useState<{ loading: boolean; data: any | null; error: string } | null>(null);

  // Per-column dropdown filter + sort + a global search box — same
  // pattern as Interview Scheduling's pipeline table.
  const [colWidths, setColWidths] = useState<Record<string, number>>(PANEL_INTERVIEWER_COL_WIDTHS);
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

  const colOptions = (key: string) => Array.from(new Set(people.map((p) => getInterviewerColValue(p, key)))).filter((v) => v !== "").sort();

  const displayPeople = (() => {
    let out = people;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((p) => INTERVIEWER_COLS.some((k) => getInterviewerColValue(p, k).toLowerCase().includes(q)));
    }
    for (const [key, val] of Object.entries(colFilters)) {
      if (!val) continue;
      out = out.filter((p) => val.has(getInterviewerColValue(p, key)));
    }
    if (sort) {
      const { col, dir } = sort;
      out = [...out].sort((a, b) => {
        const cmp = getInterviewerColValue(a, col).localeCompare(getInterviewerColValue(b, col));
        return dir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  })();

  const load = async () => {
    setLoading(true);
    try {
      setPeople(await interviewApi.listPanelInterviewers());
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditingId(null); setForm(emptyForm); setFormError(""); setShowForm(true); };
  const openEdit = (p: any) => {
    setEditingId(p.id);
    setForm({ name: p.name, expertise_area: p.expertise_area, company: p.company, phone: p.phone, email: p.email, notes: p.notes });
    setFormError("");
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setFormError("Name is required."); return; }
    setSaving(true); setFormError("");
    try {
      if (editingId) await interviewApi.updatePanelInterviewer(editingId, form);
      else await interviewApi.createPanelInterviewer(form);
      setShowForm(false);
      load();
    } catch (e: any) {
      setFormError(e?.response?.data?.detail || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Remove this panel interviewer from the directory? This does not affect existing panel setups.")) return;
    await interviewApi.deletePanelInterviewer(id);
    load();
  };

  const openPanelPopup = async (panelId: number) => {
    setPanelPopup({ loading: true, data: null, error: "" });
    try {
      const data = await interviewApi.getInterviewPanel(panelId);
      setPanelPopup({ loading: false, data, error: "" });
    } catch (e: any) {
      setPanelPopup({ loading: false, data: null, error: e?.response?.data?.detail || "Failed to load panel." });
    }
  };

  return (
    <div className={embedded ? "" : "tiq-content"}>
      {!embedded && (
        <div className="tiq-page-header">
          <div className="tiq-page-title">Panel Interviewers</div>
          <div className="tiq-page-sub">Your roster of subject-matter experts — entered once, reused across every panel they sit on.</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: embedded ? 0 : 16, marginBottom: 16 }}>
        <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={openAdd}>
          <Plus size={14} /> Add Interviewer
        </button>
      </div>

      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : people.length === 0 ? (
        <div className="tiq-empty">
          <Users size={22} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>No panel interviewers yet. Click "Add Interviewer" to build your roster.</div>
        </div>
      ) : (
        <div>
          <div style={{ position: "relative", maxWidth: 300, marginBottom: 10 }}>
            <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search interviewers…"
              className="tiq-input"
              style={{ paddingLeft: 28, fontSize: 12, height: 32, width: "100%", boxSizing: "border-box" }}
            />
            {search && (
              <X size={13} onClick={() => setSearch("")}
                style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", cursor: "pointer" }} />
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
            {displayPeople.length}{displayPeople.length !== people.length ? ` / ${people.length}` : ""} interviewers
          </div>
          <div className="tiq-table-wrap">
            <table className="tiq-table" style={{ tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <ResizableFilterHeader label="Expert Name" width={colWidths.name} onWidthChange={(w) => setColWidth("name", w)}
                    value={colFilters.name} options={colOptions("name")} onChange={(v) => setColFilter("name", v)}
                    sortDir={sort?.col === "name" ? sort.dir : null} onSortClick={() => toggleSort("name")} />
                  <ResizableFilterHeader label="Area" width={colWidths.expertise_area} onWidthChange={(w) => setColWidth("expertise_area", w)}
                    value={colFilters.expertise_area} options={colOptions("expertise_area")} onChange={(v) => setColFilter("expertise_area", v)}
                    sortDir={sort?.col === "expertise_area" ? sort.dir : null} onSortClick={() => toggleSort("expertise_area")} />
                  <ResizableFilterHeader label="Company" width={colWidths.company} onWidthChange={(w) => setColWidth("company", w)}
                    value={colFilters.company} options={colOptions("company")} onChange={(v) => setColFilter("company", v)}
                    sortDir={sort?.col === "company" ? sort.dir : null} onSortClick={() => toggleSort("company")} />
                  <ResizableFilterHeader label="Phone" width={colWidths.phone} onWidthChange={(w) => setColWidth("phone", w)}
                    value={colFilters.phone} options={colOptions("phone")} onChange={(v) => setColFilter("phone", v)}
                    sortDir={sort?.col === "phone" ? sort.dir : null} onSortClick={() => toggleSort("phone")} />
                  <ResizableFilterHeader label="Email" width={colWidths.email} onWidthChange={(w) => setColWidth("email", w)}
                    value={colFilters.email} options={colOptions("email")} onChange={(v) => setColFilter("email", v)}
                    sortDir={sort?.col === "email" ? sort.dir : null} onSortClick={() => toggleSort("email")} />
                  <ResizableFilterHeader label="Assignment" width={colWidths.assignment} onWidthChange={(w) => setColWidth("assignment", w)}
                    value={colFilters.assignment} options={colOptions("assignment")} onChange={(v) => setColFilter("assignment", v)}
                    sortDir={sort?.col === "assignment" ? sort.dir : null} onSortClick={() => toggleSort("assignment")} />
                  <th style={{ width: 90 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayPeople.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", padding: 28, color: "var(--text-muted)" }}>
                      No interviewers match the current search/filters.
                    </td>
                  </tr>
                )}
                {displayPeople.map((p, idx) => (
                  <tr key={p.id}>
                    <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{idx + 1}</td>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</td>
                    <td style={{ fontSize: 12 }}>{p.expertise_area || "—"}</td>
                    <td style={{ fontSize: 12 }}>{p.company || "—"}</td>
                    <td style={{ fontSize: 12 }}>{p.phone || "—"}</td>
                    <td style={{ fontSize: 12 }}>{p.email || "—"}</td>
                    <td style={{ fontSize: 12 }}>
                      {(p.assignments || []).length === 0 ? (
                        <span style={{ color: "var(--text-muted)" }}>Not assigned</span>
                      ) : (
                        p.assignments.map((a: any, i: number) => (
                          <span key={a.panel_id}>
                            <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" style={{ padding: "2px 6px" }}
                                    onClick={() => openPanelPopup(a.panel_id)}
                                    title={a.role_for}>
                              Panel #{a.panel_number}{a.role_for ? ` (${a.role_for})` : ""}
                            </button>
                            {i < p.assignments.length - 1 && ", "}
                          </span>
                        ))
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-start" }}>
                        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Edit" onClick={() => openEdit(p)}><Pencil size={13} /></button>
                        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Remove" onClick={() => handleDelete(p.id)}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
             onMouseDown={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 24, maxWidth: 460, width: "94%", boxShadow: "0 25px 60px rgba(0,0,0,.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{editingId ? "Edit Panel Interviewer" : "Add Panel Interviewer"}</div>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">Name</label>
              <input className="tiq-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">Area (Expertise)</label>
              <input className="tiq-input" placeholder="e.g. Payroll Systems, Clinical Nursing, Backend Architecture"
                     value={form.expertise_area} onChange={(e) => setForm({ ...form, expertise_area: e.target.value })} />
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">Company</label>
              <input className="tiq-input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div className="tiq-form-group" style={{ flex: 1 }}>
                <label className="tiq-label">Phone</label>
                <input className="tiq-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="tiq-form-group" style={{ flex: 1 }}>
                <label className="tiq-label">Email</label>
                <input className="tiq-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">Notes</label>
              <textarea className="tiq-input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            {formError && <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 10 }}>{formError}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="tiq-btn tiq-btn-primary" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {panelPopup && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
             onMouseDown={(e) => { if (e.target === e.currentTarget) setPanelPopup(null); }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 460, width: "94%", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{panelPopup.data ? `Panel #${panelPopup.data.panel_number}` : "Panel"}</div>
              <button onClick={() => setPanelPopup(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            {panelPopup.loading ? (
              <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
            ) : panelPopup.error ? (
              <div style={{ fontSize: 13, color: "#ef4444" }}>{panelPopup.error}</div>
            ) : panelPopup.data ? (
              <>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
                  {panelPopup.data.role_for}{panelPopup.data.company ? ` — ${panelPopup.data.company}` : ""}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {panelPopup.data.members.map((m: any) => (
                    <div key={m.id} style={{ padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{m.name}</div>
                      {m.expertise_area && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{m.expertise_area}</div>}
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

