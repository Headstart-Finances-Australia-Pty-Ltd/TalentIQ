import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Users, Save, Trash2, Plus, RefreshCw, Shield } from "lucide-react";
import DataTable from "../components/DataTable";

const adminApi = {
  listUsers: () => api.get("/api/admin/users").then(r => r.data),
  updateUser: (id: number, data: any) => api.put(`/api/admin/users/${id}`, data).then(r => r.data),
  deleteUser: (id: number) => api.delete(`/api/admin/users/${id}`).then(r => r.data),
};

function Badge({ val }: { val: string }) {
  const colors: Record<string, string> = {
    admin: "tiq-badge-violet", user: "tiq-badge-teal", recruiter: "tiq-badge-amber"
  };
  return <span className={`tiq-badge ${colors[val] || "tiq-badge-slate"}`}>{val}</span>;
}

function PlanStatusBadge({ val }: { val: string }) {
  const colors: Record<string, string> = {
    active: "tiq-badge-teal", demo: "tiq-badge-amber", expired: "tiq-badge-rose",
    cancelled: "tiq-badge-slate", none: "tiq-badge-slate",
  };
  return <span className={`tiq-badge ${colors[val] || "tiq-badge-slate"}`}>{val}</span>;
}

export default function AdminSetupPage({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any>(null);
  const [newPw, setNewPw] = useState("");
  const [msg, setMsg] = useState("");

  const { data: users = [], isLoading } = useQuery({ queryKey: ["admin-users"], queryFn: adminApi.listUsers });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => adminApi.updateUser(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-users"] }); setEditing(null); setNewPw(""); setMsg("Saved!"); setTimeout(() => setMsg(""), 2000); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminApi.deleteUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const save = () => {
    const data: any = {
      name: editing.name, email: editing.email, company: editing.company,
      phone: editing.phone, role: editing.role, is_active: editing.is_active,
    };
    if (newPw) data.password = newPw;
    updateMut.mutate({ id: editing.id, data });
  };

  return (
    <div>
      {/* Own header suppressed when embedded as an Admin Console tab —
          the console's own title + tab bar already says what this is,
          a second page-sized heading right under it was redundant. */}
      {!embedded && (
        <div className="tiq-page-header">
          <h1 className="tiq-page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Shield size={22} color="var(--violet-500)" /> User Management
          </h1>
          <p className="tiq-page-sub">View, edit and manage all registered users</p>
        </div>
      )}

      {msg && <div className="tiq-alert tiq-alert-success">{msg}</div>}

      {/* EDIT PANEL */}
      {editing && (
        <div className="tiq-card tiq-mb-6" style={{ border: "2px solid var(--violet-500)" }}>
          <div className="tiq-card-title">Editing: {editing.name}</div>
          <div className="tiq-grid-3" style={{ gap: 12, marginBottom: 12 }}>
            {[["name","Full Name"],["email","Email"],["company","Company"],["phone","Phone"]].map(([k,l]) => (
              <div key={k} className="tiq-form-group">
                <label className="tiq-label">{l}</label>
                <input className="tiq-input" value={editing[k] || ""} onChange={e => setEditing((p: any) => ({...p, [k]: e.target.value}))} />
              </div>
            ))}
            <div className="tiq-form-group">
              <label className="tiq-label">Role</label>
              <select className="tiq-input tiq-select" value={editing.role} onChange={e => setEditing((p: any) => ({...p, role: e.target.value}))}>
                <option value="user">user</option>
                <option value="admin">admin</option>
                <option value="recruiter">recruiter</option>
              </select>
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">Status</label>
              <select className="tiq-input tiq-select" value={editing.is_active ? "active" : "inactive"} onChange={e => setEditing((p: any) => ({...p, is_active: e.target.value === "active"}))}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">New Password (optional)</label>
              <input type="password" className="tiq-input" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Leave blank to keep current" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="tiq-btn tiq-btn-primary" onClick={save} disabled={updateMut.isPending}>
              <Save size={14} /> {updateMut.isPending ? "Saving…" : "Save changes"}
            </button>
            <button className="tiq-btn tiq-btn-outline" onClick={() => { setEditing(null); setNewPw(""); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* USERS TABLE */}
      <div className="tiq-card" style={{ padding: 0 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="tiq-card-title" style={{ margin: 0 }}>
            Registered Users ({users.length})
          </div>
          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => qc.invalidateQueries({ queryKey: ["admin-users"] })}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
        {isLoading ? (
          <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
        ) : (
          <DataTable
            columns={["id", "name", "email", "company", "phone", "role", "is_active", "plan_name", "plan_status", "plan_start_date", "plan_end_date", "payment_date", "transaction_number", "created_at", "last_login"]}
            columnLabels={{
              id: "ID", name: "Name", email: "Email", company: "Company", phone: "Phone", role: "Role", is_active: "Status",
              plan_name: "Plan", plan_status: "Plan Status", plan_start_date: "Plan Start", plan_end_date: "Plan End",
              payment_date: "Payment Date", transaction_number: "Transaction #",
              created_at: "Created", last_login: "Last Login",
            }}
            rows={users}
            getRowKey={(u: any) => u.id}
            rowStyle={(u: any) => editing?.id === u.id ? { background: "rgba(139,92,246,.05)" } : undefined}
            actionsLabel="Actions"
            actionsWidth={130}
            renderActions={(u: any) => (
              <div style={{ display: "flex", gap: 4 }}>
                <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => { setEditing({...u}); setNewPw(""); }}>
                  Edit
                </button>
                <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" style={{ color: "var(--rose-500)" }}
                  onClick={() => { if (confirm(`Delete ${u.name}?`)) deleteMut.mutate(u.id); }}>
                  <Trash2 size={12} />
                </button>
              </div>
            )}
            renderCell={(u: any, col: string) => {
              switch (col) {
                case "id": return <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{u.id}</span>;
                case "name": return <span style={{ fontWeight: 600 }}>{u.name}</span>;
                case "email": return <span style={{ fontSize: 13 }}>{u.email}</span>;
                case "company": return <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{u.company || "—"}</span>;
                case "phone": return <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{u.phone || "—"}</span>;
                case "role": return <Badge val={u.role} />;
                case "is_active": return (
                  <span className={`tiq-badge ${u.is_active ? "tiq-badge-teal" : "tiq-badge-rose"}`}>
                    {u.is_active ? "Active" : "Inactive"}
                  </span>
                );
                case "created_at": return <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}</span>;
                case "last_login": return <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{u.last_login ? new Date(u.last_login).toLocaleDateString() : "Never"}</span>;
                // Plan/billing columns — see routers/admin.py's list_users
                // for how these are derived from tiq_subscriptions.
                case "plan_name": return <span style={{ fontSize: 12, fontWeight: 600 }}>{u.plan_name || "—"}</span>;
                case "plan_status": return <PlanStatusBadge val={u.plan_status || "none"} />;
                case "plan_start_date": return <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{u.plan_start_date ? new Date(u.plan_start_date).toLocaleDateString() : "—"}</span>;
                case "plan_end_date": {
                  if (!u.plan_end_date) return <span style={{ fontSize: 11, color: "var(--text-muted)" }}>—</span>;
                  // 9999-12-31 is how "never expires" is represented on
                  // the backend (see routers/auth.py's register() and
                  // db/migrate_fix.py's admin backfill) — shown as a
                  // literal date it reads oddly, so render it as "Never".
                  const d = new Date(u.plan_end_date);
                  const never = d.getUTCFullYear() >= 9999;
                  return <span style={{ fontSize: 11, color: never ? "var(--teal-500)" : "var(--text-muted)", fontWeight: never ? 700 : 400 }}>
                    {never ? "Never" : d.toLocaleDateString()}
                  </span>;
                }
                case "payment_date": return <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {u.payment_date ? `${new Date(u.payment_date).toLocaleDateString()}${u.amount_paid_cents ? ` — $${(u.amount_paid_cents / 100).toFixed(2)}` : ""}` : "—"}
                </span>;
                case "transaction_number": return <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>{u.transaction_number || "—"}</span>;
                default: return u[col];
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
