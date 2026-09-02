import { useEffect, useState } from "react";
import { Plus, X, Trash2, Pencil, Users2, Search } from "lucide-react";
import { interviewApi, requisitionApi } from "../lib/api";
import { ResizableFilterHeader } from "../components/ResizableFilterHeader";

const emptyForm = { role_for: "", company: "", interviewer_ids: [] as number[], setup_date: "" };

const INTERVIEW_PANEL_COL_WIDTHS: Record<string, number> = {
  panel_number: 90, role_for: 190, company: 160, interviewers: 220, setup_date: 130,
};

// Raw value behind each column — used for header filter dropdowns,
// sorting, and the global search box.
function getPanelColValue(p: any, key: string): string {
  switch (key) {
    case "panel_number": return String(p.panel_number ?? "");
    case "role_for": return p.role_for || "";
    case "company": return p.company || "";
    case "interviewers": return (p.members || []).length === 0 ? "" : p.members.map((m: any) => m.name).join(", ");
    case "setup_date": return p.setup_date ? new Date(p.setup_date).toLocaleDateString() : "";
    default: return "";
  }
}
const PANEL_COLS = ["panel_number", "role_for", "company", "interviewers", "setup_date"];

// Interview Panel — a reusable, NUMBERED group of Panel Interviewers
// convened for a given role at a given company. Interview Scheduling's
// Panel column shows just this panel's number (see InterviewsPage.tsx's
// PanelNumberCell); clicking it opens a popup listing the full member
// list, fetched fresh from here rather than duplicated per interview row.
export default function InterviewPanelPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [panels, setPanels] = useState<any[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [requisitions, setRequisitions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Per-column dropdown filter + sort + a global search box — same
  // pattern as Interview Scheduling's pipeline table.
  const [colWidths, setColWidths] = useState<Record<string, number>>(INTERVIEW_PANEL_COL_WIDTHS);
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

  const colOptions = (key: string) => Array.from(new Set(panels.map((p) => getPanelColValue(p, key)))).filter((v) => v !== "").sort();

  const displayPanels = (() => {
    let out = panels;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((p) => PANEL_COLS.some((k) => getPanelColValue(p, k).toLowerCase().includes(q)));
    }
    for (const [key, val] of Object.entries(colFilters)) {
      if (!val) continue;
      out = out.filter((p) => val.has(getPanelColValue(p, key)));
    }
    if (sort) {
      const { col, dir } = sort;
      out = [...out].sort((a, b) => {
        let cmp: number;
        if (col === "panel_number") cmp = (a.panel_number ?? 0) - (b.panel_number ?? 0);
        else cmp = getPanelColValue(a, col).localeCompare(getPanelColValue(b, col));
        return dir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  })();

  const load = async () => {
    setLoading(true);
    try {
      const [pnls, ppl, reqs] = await Promise.all([
        interviewApi.listInterviewPanels(), interviewApi.listPanelInterviewers(), requisitionApi.list(),
      ]);
      setPanels(pnls);
      setPeople(ppl);
      setRequisitions(reqs);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // Requisition titles for the Role For dropdown — deduplicated, since
  // more than one open req can share a title (e.g. two "Data Analyst"
  // reqs for different clients). "Role For" still accepts free text too
  // (see the input below) for a panel set up ahead of a requisition
  // existing yet, or for a role that was never entered as one.
  const requisitionRoleOptions = Array.from(new Set(requisitions.map((r: any) => r.title).filter(Boolean))).sort();

  const openAdd = () => { setEditingId(null); setForm(emptyForm); setFormError(""); setShowForm(true); };
  const openEdit = (p: any) => {
    setEditingId(p.id);
    setForm({ role_for: p.role_for, company: p.company, interviewer_ids: p.interviewer_ids, setup_date: p.setup_date ? p.setup_date.slice(0, 10) : "" });
    setFormError("");
    setShowForm(true);
  };

  const toggleInterviewer = (id: number) => {
    setForm((f) => ({
      ...f,
      interviewer_ids: f.interviewer_ids.includes(id) ? f.interviewer_ids.filter((x) => x !== id) : [...f.interviewer_ids, id],
    }));
  };

  const handleSave = async () => {
    if (form.interviewer_ids.length === 0) { setFormError("Select at least one interviewer for this panel."); return; }
    setSaving(true); setFormError("");
    try {
      const payload = { ...form, setup_date: form.setup_date ? new Date(form.setup_date).toISOString() : null };
      if (editingId) await interviewApi.updateInterviewPanel(editingId, payload);
      else await interviewApi.createInterviewPanel(payload);
      setShowForm(false);
      load();
    } catch (e: any) {
      setFormError(e?.response?.data?.detail || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this panel setup? Any Interview Scheduling rounds using it will keep their existing interviewer list but lose the panel number link.")) return;
    await interviewApi.deleteInterviewPanel(id);
    load();
  };

  return (
    <div className={embedded ? "" : "tiq-content"}>
      {!embedded && (
        <div className="tiq-page-header">
          <div className="tiq-page-title">Interview Panel</div>
          <div className="tiq-page-sub">Group your Panel Interviewers into reusable, numbered panels for a role.</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: embedded ? 0 : 16, marginBottom: 16 }}>
        <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={openAdd} disabled={people.length === 0}
                title={people.length === 0 ? "Add at least one Panel Interviewer first" : ""}>
          <Plus size={14} /> New Panel
        </button>
        {people.length === 0 && (
          <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>
            Add interviewers under the Panel Interviewers tab first.
          </span>
        )}
      </div>

      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : panels.length === 0 ? (
        <div className="tiq-empty">
          <Users2 size={22} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>No panels set up yet. Click "New Panel" to create one.</div>
        </div>
      ) : (
        <div>
          <div style={{ position: "relative", maxWidth: 300, marginBottom: 10 }}>
            <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search panels…"
              className="tiq-input"
              style={{ paddingLeft: 28, fontSize: 12, height: 32, width: "100%", boxSizing: "border-box" }}
            />
            {search && (
              <X size={13} onClick={() => setSearch("")}
                style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", cursor: "pointer" }} />
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
            {displayPanels.length}{displayPanels.length !== panels.length ? ` / ${panels.length}` : ""} panels
          </div>
          <div className="tiq-table-wrap">
            <table className="tiq-table" style={{ tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <ResizableFilterHeader label="Panel #" width={colWidths.panel_number} onWidthChange={(w) => setColWidth("panel_number", w)}
                    value={colFilters.panel_number} options={colOptions("panel_number")} onChange={(v) => setColFilter("panel_number", v)}
                    sortDir={sort?.col === "panel_number" ? sort.dir : null} onSortClick={() => toggleSort("panel_number")} />
                  <ResizableFilterHeader label="Role For" width={colWidths.role_for} onWidthChange={(w) => setColWidth("role_for", w)}
                    value={colFilters.role_for} options={colOptions("role_for")} onChange={(v) => setColFilter("role_for", v)}
                    sortDir={sort?.col === "role_for" ? sort.dir : null} onSortClick={() => toggleSort("role_for")} />
                  <ResizableFilterHeader label="Company" width={colWidths.company} onWidthChange={(w) => setColWidth("company", w)}
                    value={colFilters.company} options={colOptions("company")} onChange={(v) => setColFilter("company", v)}
                    sortDir={sort?.col === "company" ? sort.dir : null} onSortClick={() => toggleSort("company")} />
                  <ResizableFilterHeader label="Interviewers" width={colWidths.interviewers} onWidthChange={(w) => setColWidth("interviewers", w)}
                    value={colFilters.interviewers} options={colOptions("interviewers")} onChange={(v) => setColFilter("interviewers", v)}
                    sortDir={sort?.col === "interviewers" ? sort.dir : null} onSortClick={() => toggleSort("interviewers")} />
                  <ResizableFilterHeader label="Setup Date" width={colWidths.setup_date} onWidthChange={(w) => setColWidth("setup_date", w)}
                    value={colFilters.setup_date} options={colOptions("setup_date")} onChange={(v) => setColFilter("setup_date", v)}
                    sortDir={sort?.col === "setup_date" ? sort.dir : null} onSortClick={() => toggleSort("setup_date")} />
                  <th style={{ width: 90 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayPanels.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: 28, color: "var(--text-muted)" }}>
                      No panels match the current search/filters.
                    </td>
                  </tr>
                )}
                {displayPanels.map((p, idx) => (
                  <tr key={p.id}>
                    <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{idx + 1}</td>
                    <td style={{ fontWeight: 700, fontSize: 13 }}>{p.panel_number}</td>
                    <td style={{ fontSize: 12 }}>{p.role_for || "—"}</td>
                    <td style={{ fontSize: 12 }}>{p.company || "—"}</td>
                    <td style={{ fontSize: 12 }}>{(p.members || []).length === 0 ? "—" : p.members.map((m: any) => m.name).join(", ")}</td>
                    <td style={{ fontSize: 12 }}>{p.setup_date ? new Date(p.setup_date).toLocaleDateString() : "—"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-start" }}>
                        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Edit" onClick={() => openEdit(p)}><Pencil size={13} /></button>
                        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Delete" onClick={() => handleDelete(p.id)}><Trash2 size={13} /></button>
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
          <div style={{ background: "#fff", borderRadius: 14, padding: 24, maxWidth: 460, width: "94%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{editingId ? "Edit Panel" : "New Panel"}</div>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">Role For</label>
              <input
                className="tiq-input" list="panel-role-options"
                placeholder="e.g. Senior Backend Engineer"
                value={form.role_for}
                onChange={(e) => setForm({ ...form, role_for: e.target.value })}
              />
              {/* Suggests existing requisition titles as you type, but still
                  accepts free text — a panel can be set up before its
                  requisition exists yet, or for a role never entered as one. */}
              <datalist id="panel-role-options">
                {requisitionRoleOptions.map((title) => <option key={title} value={title} />)}
              </datalist>
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">Company</label>
              <input className="tiq-input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">Panel Setup Date</label>
              <input type="date" className="tiq-input" value={form.setup_date} onChange={(e) => setForm({ ...form, setup_date: e.target.value })} />
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">Interviewers (select multiple)</label>
              <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
                {people.map((pi) => (
                  <label key={pi.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 4px", cursor: "pointer", fontSize: 13 }}>
                    <input type="checkbox" checked={form.interviewer_ids.includes(pi.id)} onChange={() => toggleInterviewer(pi.id)} />
                    <span>{pi.name}</span>
                    <span className="tiq-badge" style={{
                      fontSize: 9.5,
                      background: pi.interviewer_type === "External" ? "rgba(139,92,246,.12)" : "rgba(13,148,136,.12)",
                      color: pi.interviewer_type === "External" ? "var(--violet-500, #8b5cf6)" : "var(--brand-teal, #0d9488)",
                    }}>
                      {pi.interviewer_type || "Internal"}
                    </span>
                    {pi.expertise_area && <span style={{ color: "var(--text-muted)", fontSize: 11 }}>— {pi.expertise_area}</span>}
                  </label>
                ))}
              </div>
            </div>
            {formError && <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 10 }}>{formError}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="tiq-btn tiq-btn-primary" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
