import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Shield, Grid3x3, Database, Save } from "lucide-react";
import { CAPABILITIES } from "../lib/capabilities";
import AdminSetupPage from "./AdminSetupPage";
import FileManagerPage from "./FileManagerPage";

const moduleToggleApi = {
  get: () => api.get("/api/admin/module-toggles").then(r => r.data as Record<string, boolean>),
  save: (payload: { module_route: string; enabled: boolean }[]) =>
    api.put("/api/admin/module-toggles", payload).then(r => r.data as Record<string, boolean>),
};

function ModulesManagementTab() {
  const qc = useQueryClient();
  const { data: toggles, isLoading } = useQuery({ queryKey: ["module-toggles"], queryFn: moduleToggleApi.get });

  // Local edit buffer — a route present here overrides the server's
  // last-saved state; absent means "use whatever's saved" (defaulting
  // to enabled if that's also missing, same rule the sidebar itself
  // uses). Keeping this separate from `toggles` means Save only sends
  // rows actually touched in this sitting, not the entire module list
  // every time.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [savedMsg, setSavedMsg] = useState("");

  const isEnabled = (route: string) => pending[route] ?? toggles?.[route] ?? true;
  const toggle = (route: string) => setPending((p) => ({ ...p, [route]: !isEnabled(route) }));

  const saveMut = useMutation({
    mutationFn: () => moduleToggleApi.save(Object.entries(pending).map(([module_route, enabled]) => ({ module_route, enabled }))),
    onSuccess: (data) => {
      qc.setQueryData(["module-toggles"], data);
      setPending({});
      setSavedMsg("Saved — the sidebar will reflect this on next page load.");
      setTimeout(() => setSavedMsg(""), 4000);
    },
  });

  const dirty = Object.keys(pending).length > 0;
  const totalModules = CAPABILITIES.reduce((n, c) => n + c.modules.length, 0);
  const enabledCount = CAPABILITIES.reduce((n, c) => n + c.modules.filter((m) => isEnabled(m.route)).length, 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
          Untick a module to hide it from the sidebar for everyone on this deployment. Ticking it back on restores it —
          nothing about the module itself (its data, routes, or functionality) is affected either way.
          <br />{enabledCount} of {totalModules} modules currently visible.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {savedMsg && <span style={{ fontSize: 12, color: "#10b981" }}>{savedMsg}</span>}
          <button className="tiq-btn tiq-btn-primary tiq-btn-sm" disabled={!dirty || saveMut.isPending} onClick={() => saveMut.mutate()}>
            <Save size={13} /> {saveMut.isPending ? "Saving…" : `Save${dirty ? ` (${Object.keys(pending).length})` : ""}`}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : (
        <div className="tiq-table-wrap">
          <table className="tiq-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Active</th>
                <th>Phase</th>
                <th>Module</th>
                <th>Route</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((cap) => (
                cap.modules.map((m, i) => (
                  <tr key={m.route}>
                    <td style={{ textAlign: "center" }}>
                      <input type="checkbox" checked={isEnabled(m.route)} onChange={() => toggle(m.route)} />
                    </td>
                    {i === 0 ? (
                      <td rowSpan={cap.modules.length} style={{ fontWeight: 600, verticalAlign: "top", color: "var(--text-secondary)" }}>
                        {cap.emoji} {cap.phase}
                      </td>
                    ) : null}
                    <td style={{ fontWeight: 600 }}>{m.name}</td>
                    <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{m.route}</td>
                    <td>
                      {!m.built ? (
                        <span className="tiq-badge tiq-badge-slate">Not yet built</span>
                      ) : isEnabled(m.route) ? (
                        <span className="tiq-badge tiq-badge-teal">Visible</span>
                      ) : (
                        <span className="tiq-badge" style={{ background: "#fee2e2", color: "#b91c1c" }}>Hidden</span>
                      )}
                    </td>
                  </tr>
                ))
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminConsolePage() {
  const [tab, setTab] = useState<"modules" | "users" | "files">("modules");

  return (
    <div>
      <div className="tiq-page-header">
        <h1 className="tiq-page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Shield size={22} color="var(--violet-500)" /> Admin Console
        </h1>
        <p className="tiq-page-sub">Modules, users, and the database — all admin controls in one place</p>
      </div>

      <div className="tiq-tabs" style={{ marginBottom: 20 }}>
        <button className={`tiq-tab${tab === "modules" ? " active" : ""}`} onClick={() => setTab("modules")}>
          <Grid3x3 size={12} style={{ display: "inline", marginRight: 6 }} /> Modules Management
        </button>
        <button className={`tiq-tab${tab === "users" ? " active" : ""}`} onClick={() => setTab("users")}>
          <Shield size={12} style={{ display: "inline", marginRight: 6 }} /> User Management
        </button>
        <button className={`tiq-tab${tab === "files" ? " active" : ""}`} onClick={() => setTab("files")}>
          <Database size={12} style={{ display: "inline", marginRight: 6 }} /> File Manager
        </button>
      </div>

      {tab === "modules" && <ModulesManagementTab />}
      {tab === "users" && <AdminSetupPage embedded />}
      {tab === "files" && <FileManagerPage embedded />}
    </div>
  );
}
