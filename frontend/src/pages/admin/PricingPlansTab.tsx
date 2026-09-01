import { useEffect, useState } from "react";
import { Plus, X, Trash2, Pencil, DollarSign, Search } from "lucide-react";
import { billingApi } from "../../lib/api";
import { ResizableFilterHeader } from "../../components/ResizableFilterHeader";

const emptyForm = {
  slug: "", name: "", description: "",
  price_monthly_cents: 0, price_yearly_cents: 0,
  badge: "", highlight: false, is_free_demo: false, demo_days: 14, max_candidates: 0,
  features: [""] as string[], sort_order: 0, is_active: true,
};

const PLAN_COL_WIDTHS: Record<string, number> = {
  sort_order: 80, name: 170, slug: 140, price_monthly_cents: 100, price_yearly_cents: 100,
  badge: 110, is_free_demo: 100, max_candidates: 110, is_active: 90,
};

// Raw value behind each column — used for header filter dropdowns,
// sorting, and the global search box. Kept separate from the cell JSX
// (badges, formatted prices) below.
function getPlanColValue(p: any, key: string): string {
  switch (key) {
    case "sort_order": return String(p.sort_order ?? "");
    case "name": return p.name || "";
    case "slug": return p.slug || "";
    case "price_monthly_cents": return p.is_free_demo ? "" : `$${(p.price_monthly_cents / 100).toFixed(2)}`;
    case "price_yearly_cents": return p.is_free_demo ? "" : `$${(p.price_yearly_cents / 100).toFixed(2)}`;
    case "badge": return p.badge || "";
    case "is_free_demo": return p.is_free_demo ? `${p.demo_days} days` : "";
    case "max_candidates": return p.max_candidates ? String(p.max_candidates) : "Unlimited";
    case "is_active": return p.is_active ? "Yes" : "No";
    default: return "";
  }
}
const PLAN_COLS = ["sort_order", "name", "slug", "price_monthly_cents", "price_yearly_cents", "badge", "is_free_demo", "max_candidates", "is_active"];
const NUMERIC_PLAN_COLS = new Set(["sort_order"]);

// Admin Console -> Pricing Plans — the same rows the public /pricing page
// reads from (billingApi.listPlans), so changes here take effect
// immediately with no deploy needed.
export default function PricingPlansTab() {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Per-column dropdown filter + sort + a global search box — same
  // pattern as every other table in the app.
  const [colWidths, setColWidths] = useState<Record<string, number>>(PLAN_COL_WIDTHS);
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

  const colOptions = (key: string) => Array.from(new Set(plans.map((p) => getPlanColValue(p, key)))).filter((v) => v !== "").sort();

  const displayPlans = (() => {
    let out = plans;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((p) => PLAN_COLS.some((k) => getPlanColValue(p, k).toLowerCase().includes(q)));
    }
    for (const [key, val] of Object.entries(colFilters)) {
      if (!val) continue;
      out = out.filter((p) => val.has(getPlanColValue(p, key)));
    }
    if (sort) {
      const { col, dir } = sort;
      out = [...out].sort((a, b) => {
        let cmp: number;
        if (NUMERIC_PLAN_COLS.has(col)) cmp = (Number(a[col]) || 0) - (Number(b[col]) || 0);
        else cmp = getPlanColValue(a, col).localeCompare(getPlanColValue(b, col));
        return dir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  })();

  const load = async () => {
    setLoading(true);
    try {
      setPlans(await billingApi.adminListPlans());
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditingId(null); setForm(emptyForm); setFormError(""); setShowForm(true); };

  // Same redundant-bullet detection as the public Pricing page's display
  // filter (PricingPage.tsx) — but applied here to the actual STORED
  // features list, at the moment a plan is opened for editing, so the
  // duplicate text (e.g. "Up to 10 candidates" sitting alongside the
  // dedicated Max Candidates field showing 10) gets removed from the
  // data itself on next Save, not just hidden on the public page. Only
  // runs once per open, not reactively as the admin types, so it can't
  // strip something they're actively composing.
  const stripRedundantFeatures = (features: string[], isFreeDemo: boolean, demoDays: number, maxCandidates: number) =>
    features.filter((f) => {
      if (isFreeDemo && demoDays && /^\s*\d+[\s-]*days?\b/i.test(f)) return false;
      if (maxCandidates && /\bcandidates?\b/i.test(f) && /\d/.test(f)) return false;
      return true;
    });

  const openEdit = (p: any) => {
    setEditingId(p.id);
    const cleanedFeatures = stripRedundantFeatures(p.features || [], p.is_free_demo, p.demo_days, p.max_candidates || 0);
    setForm({
      slug: p.slug, name: p.name, description: p.description,
      price_monthly_cents: p.price_monthly_cents, price_yearly_cents: p.price_yearly_cents,
      badge: p.badge, highlight: p.highlight, is_free_demo: p.is_free_demo, demo_days: p.demo_days,
      max_candidates: p.max_candidates || 0,
      features: cleanedFeatures.length ? cleanedFeatures : [""], sort_order: p.sort_order, is_active: p.is_active,
    });
    setFormError("");
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.slug.trim() || !form.name.trim()) { setFormError("Slug and Name are required."); return; }
    setSaving(true); setFormError("");
    const payload = { ...form, features: form.features.filter((f) => f.trim()) };
    try {
      if (editingId) await billingApi.adminUpdatePlan(editingId, payload);
      else await billingApi.adminCreatePlan(payload);
      setShowForm(false);
      load();
    } catch (e: any) {
      setFormError(e?.response?.data?.detail || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this plan? Existing subscribers keep their current term, but the plan disappears from the Pricing page.")) return;
    await billingApi.adminDeletePlan(id);
    load();
  };

  const updateFeature = (i: number, val: string) => {
    const next = [...form.features];
    next[i] = val;
    setForm({ ...form, features: next });
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={openAdd}>
          <Plus size={14} /> New Plan
        </button>
      </div>

      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : plans.length === 0 ? (
        <div className="tiq-empty">
          <DollarSign size={22} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>No pricing plans yet. Click "New Plan" to create one.</div>
        </div>
      ) : (
        <div>
          <div style={{ position: "relative", maxWidth: 300, marginBottom: 10 }}>
            <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search plans…"
              className="tiq-input"
              style={{ paddingLeft: 28, fontSize: 12, height: 32, width: "100%", boxSizing: "border-box" }}
            />
            {search && (
              <X size={13} onClick={() => setSearch("")}
                style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", cursor: "pointer" }} />
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
            {displayPlans.length}{displayPlans.length !== plans.length ? ` / ${plans.length}` : ""} plans
          </div>
          <div className="tiq-table-wrap">
            <table className="tiq-table" style={{ tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <ResizableFilterHeader label="Order" width={colWidths.sort_order} onWidthChange={(w) => setColWidth("sort_order", w)} align="center"
                    value={colFilters.sort_order} options={colOptions("sort_order")} onChange={(v) => setColFilter("sort_order", v)}
                    sortDir={sort?.col === "sort_order" ? sort.dir : null} onSortClick={() => toggleSort("sort_order")} />
                  <ResizableFilterHeader label="Name" width={colWidths.name} onWidthChange={(w) => setColWidth("name", w)}
                    value={colFilters.name} options={colOptions("name")} onChange={(v) => setColFilter("name", v)}
                    sortDir={sort?.col === "name" ? sort.dir : null} onSortClick={() => toggleSort("name")} />
                  <ResizableFilterHeader label="Slug" width={colWidths.slug} onWidthChange={(w) => setColWidth("slug", w)}
                    value={colFilters.slug} options={colOptions("slug")} onChange={(v) => setColFilter("slug", v)}
                    sortDir={sort?.col === "slug" ? sort.dir : null} onSortClick={() => toggleSort("slug")} />
                  <ResizableFilterHeader label="Monthly" width={colWidths.price_monthly_cents} onWidthChange={(w) => setColWidth("price_monthly_cents", w)}
                    value={colFilters.price_monthly_cents} options={colOptions("price_monthly_cents")} onChange={(v) => setColFilter("price_monthly_cents", v)}
                    sortDir={sort?.col === "price_monthly_cents" ? sort.dir : null} onSortClick={() => toggleSort("price_monthly_cents")} />
                  <ResizableFilterHeader label="Yearly" width={colWidths.price_yearly_cents} onWidthChange={(w) => setColWidth("price_yearly_cents", w)}
                    value={colFilters.price_yearly_cents} options={colOptions("price_yearly_cents")} onChange={(v) => setColFilter("price_yearly_cents", v)}
                    sortDir={sort?.col === "price_yearly_cents" ? sort.dir : null} onSortClick={() => toggleSort("price_yearly_cents")} />
                  <ResizableFilterHeader label="Badge" width={colWidths.badge} onWidthChange={(w) => setColWidth("badge", w)}
                    value={colFilters.badge} options={colOptions("badge")} onChange={(v) => setColFilter("badge", v)}
                    sortDir={sort?.col === "badge" ? sort.dir : null} onSortClick={() => toggleSort("badge")} />
                  <ResizableFilterHeader label="Free Demo" width={colWidths.is_free_demo} onWidthChange={(w) => setColWidth("is_free_demo", w)}
                    value={colFilters.is_free_demo} options={colOptions("is_free_demo")} onChange={(v) => setColFilter("is_free_demo", v)}
                    sortDir={sort?.col === "is_free_demo" ? sort.dir : null} onSortClick={() => toggleSort("is_free_demo")} />
                  <ResizableFilterHeader label="Max Candidates" width={colWidths.max_candidates} onWidthChange={(w) => setColWidth("max_candidates", w)}
                    value={colFilters.max_candidates} options={colOptions("max_candidates")} onChange={(v) => setColFilter("max_candidates", v)}
                    sortDir={sort?.col === "max_candidates" ? sort.dir : null} onSortClick={() => toggleSort("max_candidates")} />
                  <ResizableFilterHeader label="Active" width={colWidths.is_active} onWidthChange={(w) => setColWidth("is_active", w)}
                    value={colFilters.is_active} options={colOptions("is_active")} onChange={(v) => setColFilter("is_active", v)}
                    sortDir={sort?.col === "is_active" ? sort.dir : null} onSortClick={() => toggleSort("is_active")} />
                  <th style={{ width: 90 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayPlans.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ textAlign: "center", padding: 28, color: "var(--text-muted)" }}>
                      No plans match the current search/filters.
                    </td>
                  </tr>
                )}
                {displayPlans.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{p.sort_order}</td>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>{p.name}{p.highlight && " ⭐"}</td>
                    <td style={{ fontSize: 12, fontFamily: "monospace" }}>{p.slug}</td>
                    <td style={{ fontSize: 12 }}>{p.is_free_demo ? "—" : `$${(p.price_monthly_cents / 100).toFixed(2)}`}</td>
                    <td style={{ fontSize: 12 }}>{p.is_free_demo ? "—" : `$${(p.price_yearly_cents / 100).toFixed(2)}`}</td>
                    <td style={{ fontSize: 12 }}>{p.badge || "—"}</td>
                    <td style={{ fontSize: 12 }}>{p.is_free_demo ? `${p.demo_days} days` : "—"}</td>
                    <td style={{ fontSize: 12 }}>{p.max_candidates ? p.max_candidates.toLocaleString() : "Unlimited"}</td>
                    <td style={{ fontSize: 12 }}>{p.is_active ? "Yes" : "No"}</td>
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
          <div style={{ background: "#fff", borderRadius: 14, padding: 24, maxWidth: 520, width: "94%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{editingId ? "Edit Plan" : "New Plan"}</div>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <div className="tiq-form-group" style={{ flex: 1 }}>
                <label className="tiq-label">Slug (stable ID, no spaces)</label>
                <input className="tiq-input" placeholder="e.g. professional" value={form.slug}
                  disabled={!!editingId} onChange={(e) => setForm({ ...form, slug: e.target.value.trim().toLowerCase().replace(/\s+/g, "_") })} />
              </div>
              <div className="tiq-form-group" style={{ flex: 1 }}>
                <label className="tiq-label">Display Name</label>
                <input className="tiq-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </div>

            <div className="tiq-form-group">
              <label className="tiq-label">Description</label>
              <input className="tiq-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 14, cursor: "pointer" }}>
              <input type="checkbox" checked={form.is_free_demo} onChange={(e) => setForm({ ...form, is_free_demo: e.target.checked })} />
              This is the Free Demo plan (no payment — starts a time-limited trial)
            </label>

            {form.is_free_demo ? (
              <div className="tiq-form-group">
                <label className="tiq-label">Demo length (days)</label>
                <input type="number" min={1} className="tiq-input" value={form.demo_days}
                  onChange={(e) => setForm({ ...form, demo_days: Number(e.target.value) })} />
              </div>
            ) : (
              <div style={{ display: "flex", gap: 10 }}>
                <div className="tiq-form-group" style={{ flex: 1 }}>
                  <label className="tiq-label">Monthly price (USD)</label>
                  <input type="number" min={0} step={0.01} className="tiq-input" value={form.price_monthly_cents / 100}
                    onChange={(e) => setForm({ ...form, price_monthly_cents: Math.round(Number(e.target.value) * 100) })} />
                </div>
                <div className="tiq-form-group" style={{ flex: 1 }}>
                  <label className="tiq-label">Yearly price (USD)</label>
                  <input type="number" min={0} step={0.01} className="tiq-input" value={form.price_yearly_cents / 100}
                    onChange={(e) => setForm({ ...form, price_yearly_cents: Math.round(Number(e.target.value) * 100) })} />
                </div>
              </div>
            )}

            <div className="tiq-form-group">
              <label className="tiq-label">Max Candidates (0 = unlimited)</label>
              <input type="number" min={0} className="tiq-input" value={form.max_candidates}
                onChange={(e) => setForm({ ...form, max_candidates: Number(e.target.value) })} />
              <p style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "4px 0 0" }}>
                Shown on the public Pricing page as "Up to N candidates" — generated from this number automatically,
                so it's always accurate. You no longer need (and should remove) any hand-typed "Up to N candidates"
                or "N days" bullet from Features below; those won't update themselves when you change this or the
                Demo length field.
              </p>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <div className="tiq-form-group" style={{ flex: 1 }}>
                <label className="tiq-label">Badge (optional)</label>
                <input className="tiq-input" placeholder="e.g. Popular, Best Value" value={form.badge} onChange={(e) => setForm({ ...form, badge: e.target.value })} />
              </div>
              <div className="tiq-form-group" style={{ flex: 1 }}>
                <label className="tiq-label">Sort Order</label>
                <input type="number" className="tiq-input" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
              </div>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={form.highlight} onChange={(e) => setForm({ ...form, highlight: e.target.checked })} />
              Highlight this plan (visually emphasized card)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 16, cursor: "pointer" }}>
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              Active (visible on the public Pricing page)
            </label>

            <div className="tiq-form-group">
              <label className="tiq-label">Features</label>
              {form.features.map((f, i) => (
                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <input className="tiq-input" placeholder="e.g. Unlimited resume screening" value={f} onChange={(e) => updateFeature(i, e.target.value)} />
                  <button type="button" className="tiq-btn tiq-btn-ghost tiq-btn-sm"
                    onClick={() => setForm({ ...form, features: form.features.filter((_, idx) => idx !== i) })}>
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button type="button" className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setForm({ ...form, features: [...form.features, ""] })}>
                <Plus size={12} /> Add Feature
              </button>
            </div>

            {formError && <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 10, marginTop: 10 }}>{formError}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tiq-btn tiq-btn-primary" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
