import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Database, Table, ChevronRight, Save, Trash2, Plus, Search, Play, RefreshCw, ChevronLeft, ChevronDown, ChevronUp, X, Cloud as CloudIcon, Folder as FolderIcon, File as FileIcon, Download } from "lucide-react";
import DataTable from "../components/DataTable";

const adminApi = {
  tables: () => api.get("/api/admin/tables").then(r => r.data),
  storage: () => api.get("/api/admin/storage").then(r => r.data),
  schema: (t: string) => api.get(`/api/admin/tables/${t}/schema`).then(r => r.data),
  rows: (t: string, page: number, search?: string) =>
    api.get(`/api/admin/tables/${t}/rows`, { params: { page, page_size: 25, search } }).then(r => r.data),
  updateRow: (t: string, id: number, data: any) => api.put(`/api/admin/tables/${t}/rows/${id}`, { data }).then(r => r.data),
  deleteRow: (t: string, id: number) => api.delete(`/api/admin/tables/${t}/rows/${id}`).then(r => r.data),
  bulkDeleteRows: (t: string, ids: number[]) => api.delete(`/api/admin/tables/${t}/rows`, { data: { ids } }).then(r => r.data),
  insertRow: (t: string, data: any) => api.post(`/api/admin/tables/${t}/rows`, { data }).then(r => r.data),
  query: (sql: string) => api.post("/api/admin/query", { sql }).then(r => r.data),
  forceDeleteRequisitions: (ids: number[]) =>
    api.post("/api/admin/requisitions/force-delete-batch", { ids, confirm: "force delete requisitions" }).then(r => r.data),
  forceDeleteCandidates: (ids: number[]) =>
    api.post("/api/admin/candidates/force-delete-batch", { ids, confirm: "force delete candidates" }).then(r => r.data),
  // Generic version of the two above, for any OTHER tiq_* table (e.g.
  // tiq_applications) whose rows can't be plain-deleted once something
  // still references them — see routers/admin.py's
  // force_delete_table_rows / _generic_cascade_delete.
  forceDeleteTableRows: (t: string, ids: number[]) =>
    api.post(`/api/admin/tables/${t}/force-delete-batch`, { ids, confirm: `force delete ${t}` }).then(r => r.data),
  moduleToggles: () => api.get("/api/admin/module-toggles").then(r => r.data as Record<string, boolean>),
  // Cloud storage (Cloudflare R2 / any S3-compatible bucket) — separate
  // from everything above, which is all Postgres table/row access.
  r2Browse: (prefix: string, continuationToken?: string | null) =>
    api.get("/api/admin/storage/r2/browse", { params: { prefix, continuation_token: continuationToken || undefined } }).then(r => r.data),
  r2DownloadUrl: (key: string) => api.get("/api/admin/storage/r2/download", { params: { key } }).then(r => r.data.url as string),
  r2Delete: (key: string) => api.delete("/api/admin/storage/r2/object", { params: { key } }).then(r => r.data),
  r2Usage: () => api.get("/api/admin/storage/r2/usage").then(r => r.data),
};

// Must match the route key AdminConsolePage.tsx's Modules Management >
// System Tools section toggles — that's what actually hides/shows this
// button. Kept as a named constant here (rather than a bare string
// repeated twice) so a rename can't silently drift between the two files.
const FORCE_DELETE_MODULE_ROUTE = "admin/force-delete-test-data";

// Compact "1.2 GB" / "340 MB" style formatting — used for both the
// overall database-usage banner and the per-table sizes in the left box.
function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function FileManagerPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [editRow, setEditRow] = useState<any>(null);
  const [newRow, setNewRow] = useState(false);
  const [newData, setNewData] = useState<any>({});
  const [sqlQuery, setSqlQuery] = useState("SELECT * FROM tiq_users LIMIT 10");
  const [sqlResult, setSqlResult] = useState<any>(null);
  const [sqlError, setSqlError] = useState("");
  const [tab, setTab] = useState<"browser"|"sql">("browser");
  const [mainTab, setMainTab] = useState<"database"|"storage">("database");
  const [msg, setMsg] = useState("");

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };

  const { data: tables = [] } = useQuery({ queryKey: ["admin-tables"], queryFn: adminApi.tables, refetchInterval: 30000 });
  const { data: storage } = useQuery({ queryKey: ["admin-storage"], queryFn: adminApi.storage, refetchInterval: 30000 });

  // Same query key AppLayout.tsx/AdminConsolePage.tsx use — shares the
  // cached result rather than re-fetching, and picks up a Modules
  // Management change immediately once that page's Save invalidates it.
  const { data: moduleToggles = {} } = useQuery({ queryKey: ["module-toggles"], queryFn: adminApi.moduleToggles });
  const forceDeleteEnabled = moduleToggles[FORCE_DELETE_MODULE_ROUTE] ?? true;

  const { data: schema = [] } = useQuery({
    queryKey: ["schema", activeTable],
    queryFn: () => adminApi.schema(activeTable!),
    enabled: !!activeTable,
  });

  const { data: rowData, refetch: refetchRows, isLoading: rowsLoading } = useQuery({
    queryKey: ["rows", activeTable, page],
    queryFn: () => adminApi.rows(activeTable!, page),
    enabled: !!activeTable,
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => adminApi.updateRow(activeTable!, id, data),
    onSuccess: () => { refetchRows(); setEditRow(null); flash("Row updated."); },
    onError: (e: any) => { flash(`❌ Update failed: ${e.response?.data?.detail || e.message}`); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminApi.deleteRow(activeTable!, id),
    onSuccess: () => { refetchRows(); flash("Row deleted."); },
    onError: (e: any) => { flash(`❌ Delete failed: ${e.response?.data?.detail || e.message}`); },
  });

  const [selectedRowIds, setSelectedRowIds] = useState<Array<number | string>>([]);
  const bulkDeleteMut = useMutation({
    mutationFn: (ids: number[]) => adminApi.bulkDeleteRows(activeTable!, ids),
    onSuccess: (_data, ids) => { refetchRows(); setSelectedRowIds([]); flash(`Deleted ${ids.length} row(s).`); },
    onError: (e: any) => { flash(`❌ Bulk delete failed: ${e.response?.data?.detail || e.message}`); },
  });

  // Force-delete (cascade) — a plain DELETE fails/is blocked once real
  // hiring activity (interviews, pipeline entries, offers, etc.) is
  // still attached. Requisitions/Candidates use their own dedicated,
  // hand-written cascades (routers/admin.py); every other table falls
  // through to the generic FK-discovery cascade (force_delete_table_rows)
  // so this works for tiq_applications, tiq_interviews, etc. too, not
  // just the two originally covered tables.
  const forceDeleteMut = useMutation({
    mutationFn: (ids: number[]) =>
      activeTable === "tiq_requisitions" ? adminApi.forceDeleteRequisitions(ids)
      : activeTable === "tiq_candidates" ? adminApi.forceDeleteCandidates(ids)
      : adminApi.forceDeleteTableRows(activeTable!, ids),
    onSuccess: (data, ids) => {
      refetchRows();
      setSelectedRowIds([]);
      const skipped = data?.missing_ids?.length ? `, ${data.missing_ids.length} already gone` : "";
      flash(`Force-deleted ${data?.deleted_ids?.length ?? ids.length} row(s) and everything linked to them${skipped}.`);
    },
    onError: (e: any) => { flash(`❌ Force delete failed: ${e.response?.data?.detail || e.message}`); },
  });

  const insertMut = useMutation({
    mutationFn: (data: any) => adminApi.insertRow(activeTable!, data),
    onSuccess: () => { refetchRows(); setNewRow(false); setNewData({}); flash("Row inserted."); },
    onError: (e: any) => { flash(`❌ Insert failed: ${e.response?.data?.detail || e.message}`); },
  });

  const runSql = async () => {
    setSqlError(""); setSqlResult(null);
    try { setSqlResult(await adminApi.query(sqlQuery)); }
    catch (e: any) { setSqlError(e.response?.data?.detail || e.message); }
  };

  const editableSchema = schema.filter((c: any) => c.column_name !== "id");
  const rows = rowData?.rows || [];
  const cols = rowData?.columns || [];
  const total = rowData?.total || 0;
  const totalPages = Math.ceil(total / 25);

  return (
    <div>
      {!embedded && (
        <div className="tiq-page-header">
          <h1 className="tiq-page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Database size={22} color="var(--teal-500)" /> File & Database Manager
          </h1>
          <p className="tiq-page-sub">Browse, edit and manage TalentIQ's database tables and cloud-stored files</p>
        </div>
      )}

      {msg && <div className="tiq-alert tiq-alert-success" style={{ marginBottom: 16 }}>{msg}</div>}

      <div className="tiq-tabs" style={{ marginBottom: 20 }}>
        <button className={`tiq-tab${mainTab === "database" ? " active" : ""}`} onClick={() => setMainTab("database")}>
          <Database size={13} style={{ display: "inline", marginRight: 6 }} />Database
        </button>
        <button className={`tiq-tab${mainTab === "storage" ? " active" : ""}`} onClick={() => setMainTab("storage")}>
          <CloudIcon size={13} style={{ display: "inline", marginRight: 6 }} />Cloud Storage (R2)
        </button>
      </div>

      {mainTab === "storage" && <CloudStoragePanel />}

      {mainTab === "database" && (
      <>
      {/* DATABASE STORAGE USAGE — total used vs. the allocated plan
          quota, refreshed every 30s alongside the table list. */}
      {storage && (
        <div className="tiq-card" style={{ marginBottom: 16, padding: "14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".5px" }}>
              Database Storage
            </div>
            <div style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 700 }}>{formatBytes(storage.total_bytes)}</span>
              <span style={{ color: "var(--text-muted)" }}> / {formatBytes(storage.allocated_bytes)} ({storage.used_pct}%)</span>
            </div>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: "var(--bg-tertiary)", overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${Math.min(100, storage.used_pct)}%`,
              background: storage.used_pct >= 90 ? "#ef4444" : storage.used_pct >= 70 ? "#f59e0b" : "var(--teal-500)",
              transition: "width .3s ease",
            }} />
          </div>
          {storage.used_pct >= 70 && (
            <div style={{ fontSize: 11.5, color: storage.used_pct >= 90 ? "#ef4444" : "#f59e0b", marginTop: 6 }}>
              {storage.used_pct >= 90 ? "⚠ Nearing the allocated limit" : "Approaching the allocated limit"} — see the largest tables below.
            </div>
          )}
        </div>
      )}

      <div className="tiq-tabs">
        <button className={`tiq-tab${tab==="browser"?" active":""}`} onClick={() => setTab("browser")}>
          <Table size={13} style={{display:"inline",marginRight:6}} />Table Browser
        </button>
        <button className={`tiq-tab${tab==="sql"?" active":""}`} onClick={() => setTab("sql")}>
          <Play size={13} style={{display:"inline",marginRight:6}} />SQL Query
        </button>
      </div>

      {tab === "browser" && (
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20, alignItems: "flex-start" }}>
          {/* TABLE LIST */}
          <div className="tiq-card" style={{ padding: 0 }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".5px" }}>
              Tables ({tables.length})
            </div>
            {tables.map((t: any) => (
              <div key={t.table} onClick={() => { setActiveTable(t.table); setPage(1); setEditRow(null); setNewRow(false); }}
                style={{
                  padding: "10px 16px", cursor: "pointer", fontSize: 13,
                  background: activeTable === t.table ? "rgba(0,199,183,.08)" : "transparent",
                  borderLeft: activeTable === t.table ? "3px solid var(--teal-500)" : "3px solid transparent",
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: activeTable === t.table ? 700 : 400 }}>
                    {t.table.replace("tiq_", "")}
                  </span>
                  <span className="tiq-badge tiq-badge-slate" style={{ fontSize: 10 }}>{t.rows}</span>
                </div>
                <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>
                  {formatBytes(t.size_bytes)}
                </div>
              </div>
            ))}
          </div>

          {/* TABLE CONTENT */}
          <div>
            {!activeTable ? (
              <div className="tiq-card">
                <div className="tiq-empty">
                  <Database size={40} />
                  <div className="tiq-empty-title">Select a table</div>
                  <div>Click any table on the left to browse its records</div>
                </div>
              </div>
            ) : (
              <>
                {/* INSERT NEW ROW */}
                {newRow && (
                  <div className="tiq-card tiq-mb-4" style={{ border: "2px solid var(--teal-500)" }}>
                    <div className="tiq-card-title">Insert New Row into {activeTable}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 12 }}>
                      {editableSchema.map((c: any) => (
                        <div key={c.column_name} className="tiq-form-group">
                          <label className="tiq-label">{c.column_name} <span style={{color:"var(--text-muted)",fontWeight:400}}>({c.data_type})</span></label>
                          <input className="tiq-input" value={newData[c.column_name] || ""}
                            onChange={e => setNewData((p: any) => ({...p, [c.column_name]: e.target.value}))} />
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="tiq-btn tiq-btn-primary" onClick={() => insertMut.mutate(newData)}>
                        <Plus size={14} /> Insert Row
                      </button>
                      <button className="tiq-btn tiq-btn-outline" onClick={() => { setNewRow(false); setNewData({}); }}>Cancel</button>
                    </div>
                  </div>
                )}

                {/* EDIT ROW PANEL */}
                {editRow && (
                  <div className="tiq-card tiq-mb-4" style={{ border: "2px solid var(--amber-400)" }}>
                    <div className="tiq-card-title">Edit Row ID {editRow.id}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 12 }}>
                      {Object.entries(editRow).filter(([k]) => k !== "id").map(([k, v]) => (
                        <div key={k} className="tiq-form-group">
                          <label className="tiq-label">{k}</label>
                          <input className="tiq-input" value={String(v ?? "")}
                            onChange={e => setEditRow((p: any) => ({...p, [k]: e.target.value}))} />
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="tiq-btn tiq-btn-primary" onClick={() => updateMut.mutate({ id: editRow.id, data: editRow })}>
                        <Save size={14} /> Save
                      </button>
                      <button className="tiq-btn tiq-btn-outline" onClick={() => setEditRow(null)}>Cancel</button>
                    </div>
                  </div>
                )}

                {/* TABLE HEADER */}
                <div className="tiq-card" style={{ padding: 0 }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>
                      {activeTable} <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 400 }}>({total} rows)</span>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {selectedRowIds.length > 0 && (
                        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" style={{ color: "var(--rose-500)" }}
                          onClick={() => { if (confirm(`Delete ${selectedRowIds.length} selected row(s)?`)) bulkDeleteMut.mutate(selectedRowIds as number[]); }}>
                          <Trash2 size={12} /> Delete {selectedRowIds.length} selected
                        </button>
                      )}
                      {forceDeleteEnabled && selectedRowIds.length > 0 && !!activeTable && (
                        <button className="tiq-btn tiq-btn-sm" style={{ background: "#b91c1c", color: "#fff", border: "none" }}
                          disabled={forceDeleteMut.isPending}
                          onClick={() => {
                            const label = activeTable === "tiq_requisitions" ? "requisition"
                              : activeTable === "tiq_candidates" ? "candidate"
                              : `${activeTable} row`;
                            const ok = confirm(
                              `Force delete ${selectedRowIds.length} ${label}(s)?\n\n` +
                              `This ALSO permanently deletes every row in other tables that still references ` +
                              `these — interviews, pipeline entries, offers, placements, invoices, timesheets, ` +
                              `communication records, and so on — no undo. Only use this on test data.`
                            );
                            if (ok) forceDeleteMut.mutate(selectedRowIds as number[]);
                          }}>
                          <Trash2 size={12} /> {forceDeleteMut.isPending ? "Force deleting…" : `Force delete ${selectedRowIds.length} (cascade)`}
                        </button>
                      )}
                      <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => refetchRows()}>
                        <RefreshCw size={12} />
                      </button>
                      <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={() => { setNewRow(true); setEditRow(null); }}>
                        <Plus size={13} /> New Row
                      </button>
                    </div>
                  </div>

                  {rowsLoading ? (
                    <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
                  ) : (
                    <DataTable
                      columns={cols}
                      rows={rows}
                      getRowKey={(row) => row.id}
                      rowStyle={(row) => editRow?.id === row.id ? { background: "rgba(251,191,36,.05)" } : undefined}
                      selectable
                      selectedKeys={selectedRowIds}
                      onSelectionChange={setSelectedRowIds}
                      actionsLabel="Actions"
                      emptyMessage="No records"
                      renderActions={(row) => (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="tiq-btn tiq-btn-outline tiq-btn-sm"
                            onClick={() => { setEditRow({...row}); setNewRow(false); }}>Edit</button>
                          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" style={{ color: "var(--rose-500)" }}
                            onClick={() => { if (confirm(`Delete row ${row.id}?`)) deleteMut.mutate(row.id); }}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      )}
                    />
                  )}

                  {/* PAGINATION */}
                  {totalPages > 1 && (
                    <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        Page {page} of {totalPages} ({total} rows)
                      </span>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}>
                          <ChevronLeft size={13} />
                        </button>
                        <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}>
                          <ChevronRight size={13} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "sql" && (
        <div className="tiq-card">
          <div className="tiq-card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Play size={16} /> SQL Query Runner (SELECT only)
          </div>
          <textarea
            value={sqlQuery}
            onChange={e => setSqlQuery(e.target.value)}
            style={{ width: "100%", minHeight: 120, padding: 12, fontFamily: "monospace", fontSize: 13,
              border: "1.5px solid var(--border)", borderRadius: 8, resize: "vertical", outline: "none" }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10, marginBottom: 16 }}>
            <button className="tiq-btn tiq-btn-primary" onClick={runSql}>
              <Play size={14} /> Run Query
            </button>
            <div style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>
              Only SELECT statements. Use Table Browser for edits.
            </div>
          </div>

          {sqlError && <div className="tiq-alert tiq-alert-error" style={{ fontFamily: "monospace", fontSize: 12 }}>{sqlError}</div>}

          {sqlResult && (
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
                {sqlResult.count} row(s) returned
              </div>
              <DataTable
                columns={sqlResult.columns}
                rows={sqlResult.rows}
                getRowKey={(_row, i) => i}
                emptyMessage="No rows returned"
              />
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}

// ── CLOUD STORAGE (Cloudflare R2 / S3-compatible bucket) ───────────────
// Fully separate data source from everything above: lists actual OBJECTS
// in the configured bucket (see utils/storage.py + Admin Console > API
// Keys), not Postgres rows. Folder-by-folder browsing mirrors the
// account-folder/kind/sub_id key layout every upload uses.

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function CloudStoragePanel() {
  const [prefix, setPrefix] = useState("");
  const [tokenStack, setTokenStack] = useState<Array<string | null>>([null]);
  const [msg, setMsg] = useState("");
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };

  const currentToken = tokenStack[tokenStack.length - 1];

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["r2-browse", prefix, currentToken],
    queryFn: () => adminApi.r2Browse(prefix, currentToken || undefined),
  });

  // Separate from the folder-browse query above: computing total bucket
  // usage means walking every object (R2/S3 has no single "bucket size"
  // stat), so it's fetched once per tab visit rather than refetched on
  // every folder navigation the way `data` above is.
  const { data: usage, refetch: refetchUsage } = useQuery({
    queryKey: ["r2-usage"],
    queryFn: adminApi.r2Usage,
  });

  const deleteMut = useMutation({
    mutationFn: (key: string) => adminApi.r2Delete(key),
    onSuccess: (_d, key) => { refetch(); flash(`Deleted ${key.split("/").pop()}.`); },
    onError: (e: any) => flash(`❌ Delete failed: ${e.response?.data?.detail || e.message}`),
  });

  const openFile = async (key: string) => {
    try {
      const url = await adminApi.r2DownloadUrl(key);
      window.open(url, "_blank");
    } catch (e: any) {
      flash(`❌ Could not open file: ${e.response?.data?.detail || e.message}`);
    }
  };

  const navigateTo = (newPrefix: string) => { setPrefix(newPrefix); setTokenStack([null]); };
  const goNextPage = () => { if (data?.nextContinuationToken) setTokenStack(s => [...s, data.nextContinuationToken]); };
  const goPrevPage = () => { setTokenStack(s => s.length > 1 ? s.slice(0, -1) : s); };

  const crumbs = prefix ? prefix.replace(/\/$/, "").split("/") : [];

  if (!isLoading && data && !data.configured) {
    return (
      <div className="tiq-alert tiq-alert-info">
        Cloud storage isn't configured yet. Add your Cloudflare R2 (or any S3-compatible) bucket credentials
        under <strong>Admin Console → API Keys</strong> (access key, secret key, bucket name, and endpoint URL) —
        this tab will list its contents once that's saved.
      </div>
    );
  }

  return (
    <div>
      {msg && <div className="tiq-alert tiq-alert-success" style={{ marginBottom: 16 }}>{msg}</div>}

      {/* CLOUD STORAGE USAGE — same style as the Database tab's usage
          bar, against the allocated_gb quota set in Admin Console >
          API Keys (Object Storage panel). */}
      {usage?.configured && usage.allocated_bytes != null && usage.used_pct != null && (
        <div className="tiq-card" style={{ marginBottom: 16, padding: "14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".5px" }}>
              Cloud Storage
            </div>
            <div style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 700 }}>{formatBytes(usage.total_bytes)}</span>
              <span style={{ color: "var(--text-muted)" }}> / {formatBytes(usage.allocated_bytes)} ({usage.used_pct}%)</span>
            </div>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: "var(--bg-tertiary)", overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${Math.min(100, usage.used_pct)}%`,
              background: usage.used_pct >= 90 ? "#ef4444" : usage.used_pct >= 70 ? "#f59e0b" : "var(--teal-500)",
              transition: "width .3s ease",
            }} />
          </div>
          {usage.used_pct >= 70 && (
            <div style={{ fontSize: 11.5, color: usage.used_pct >= 90 ? "#ef4444" : "#f59e0b", marginTop: 6 }}>
              {usage.used_pct >= 90 ? "⚠ Nearing the allocated limit" : "Approaching the allocated limit"} — {usage.object_count} object(s) in the bucket.
            </div>
          )}
          {usage.truncated && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
              Bucket has more objects than could be scanned in one pass — the figure above is a lower bound.
            </div>
          )}
        </div>
      )}

      {data?.configured && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Bucket: <strong style={{ color: "var(--text-primary)" }}>{data.bucket}</strong>
          </div>
          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => { refetch(); refetchUsage(); }}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      )}

      {/* BREADCRUMB */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, marginBottom: 12, fontSize: 13 }}>
        <span style={{ cursor: "pointer", color: "var(--teal-500)", fontWeight: prefix === "" ? 700 : 400 }} onClick={() => navigateTo("")}>
          Bucket Root
        </span>
        {crumbs.map((c, i) => {
          const crumbPrefix = crumbs.slice(0, i + 1).join("/") + "/";
          return (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <ChevronRight size={12} color="var(--text-muted)" />
              <span
                style={{ cursor: "pointer", color: i === crumbs.length - 1 ? "var(--text-primary)" : "var(--teal-500)", fontWeight: i === crumbs.length - 1 ? 700 : 400 }}
                onClick={() => navigateTo(crumbPrefix)}
              >
                {c}
              </span>
            </span>
          );
        })}
      </div>

      <div className="tiq-card" style={{ padding: 0 }}>
        {isLoading ? (
          <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
        ) : (
          <>
            {(data?.folders?.length ?? 0) === 0 && (data?.files?.length ?? 0) === 0 ? (
              <div className="tiq-empty">
                <CloudIcon size={40} />
                <div className="tiq-empty-title">Empty</div>
                <div>No folders or files at this level of the bucket.</div>
              </div>
            ) : (
              <table className="tiq-table">
                <thead>
                  <tr><th>Name</th><th>Size</th><th>Last Modified</th><th></th></tr>
                </thead>
                <tbody>
                  {(data?.folders || []).map((f: string) => {
                    const label = f.replace(prefix, "").replace(/\/$/, "");
                    return (
                      <tr key={f} style={{ cursor: "pointer" }} onClick={() => navigateTo(f)}>
                        <td style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                          <FolderIcon size={15} color="var(--teal-500)" /> {label || f}
                        </td>
                        <td>—</td>
                        <td>—</td>
                        <td><ChevronRight size={14} color="var(--text-muted)" /></td>
                      </tr>
                    );
                  })}
                  {(data?.files || []).map((file: any) => {
                    const label = file.key.replace(prefix, "");
                    return (
                      <tr key={file.key}>
                        <td style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <FileIcon size={15} color="var(--text-muted)" /> {label}
                        </td>
                        <td>{formatBytes(file.sizeBytes)}</td>
                        <td>{formatDate(file.lastModified)}</td>
                        <td style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                          <Download size={15} style={{ cursor: "pointer" }} onClick={() => openFile(file.key)} />
                          <Trash2 size={15} style={{ cursor: "pointer" }} color="var(--rose-500, #e11d48)"
                            onClick={() => { if (confirm(`Permanently delete "${label}" from the bucket?`)) deleteMut.mutate(file.key); }} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}

        {(tokenStack.length > 1 || data?.isTruncated) && (
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={goPrevPage} disabled={tokenStack.length <= 1}>
              <ChevronLeft size={13} /> Prev
            </button>
            <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={goNextPage} disabled={!data?.isTruncated}>
              Next <ChevronRight size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}