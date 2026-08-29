import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Shield, Grid3x3, Database, Save, KeyRound } from "lucide-react";
import { CAPABILITIES, JOBSEEKER_MODULES } from "../lib/capabilities";
import AdminSetupPage from "./AdminSetupPage";
import FileManagerPage from "./FileManagerPage";
import ApiKeysTab from "./admin/ApiKeysTab";

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

  const isEnabled = (route: string, defaultValue: boolean = true) => pending[route] ?? toggles?.[route] ?? defaultValue;
  const toggle = (route: string, defaultValue: boolean = true) => setPending((p) => ({ ...p, [route]: !isEnabled(route, defaultValue) }));

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
  // Job Seeker Tools (JobHunter, CV Analysis) live outside CAPABILITIES
  // entirely — they're not one of the recruiter-facing phase groups, so
  // they were missing from this table even though they're real,
  // toggleable sidebar entries (see AppLayout.tsx's own separate
  // filtering of JOBSEEKER_MODULES). Folded in here as one more
  // "phase"-shaped group so the table and its totals include them
  // without needing a special case in the render below.
  const allGroups = [...CAPABILITIES, { phase: "", name: "Job Seeker Tools", emoji: "🧭", modules: JOBSEEKER_MODULES }];
  const totalModules = allGroups.reduce((n, c) => n + c.modules.length, 0);
  const enabledCount = allGroups.reduce((n, c) => n + c.modules.filter((m) => isEnabled(m.route)).length, 0);

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
              {allGroups.map((cap) => (
                cap.modules.map((m, i) => (
                  <tr key={m.route}>
                    <td style={{ textAlign: "center" }}>
                      <input type="checkbox" checked={isEnabled(m.route)} onChange={() => toggle(m.route)} />
                    </td>
                    {i === 0 ? (
                      <td rowSpan={cap.modules.length} style={{ fontWeight: 600, verticalAlign: "top", color: "var(--text-secondary)" }}>
                        {cap.emoji} {cap.phase || cap.name}
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

      {/* System Tools — not a real navigable page, so it lives outside
          CAPABILITIES/JOBSEEKER_MODULES entirely (adding it there would
          make it a fake sidebar route). Reuses the exact same
          isEnabled/toggle/pending state and the same module-toggles
          API — FileManagerPage.tsx checks this same route key
          ("admin/force-delete-test-data") to decide whether to render
          its Force Delete button. Keep the key in sync between the two
          files if it's ever renamed. */}
      {!isLoading && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "var(--text-secondary)" }}>
            System Tools
          </div>
          <div className="tiq-table-wrap">
            <table className="tiq-table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Active</th>
                  <th>Tool</th>
                  <th>Where it appears</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ textAlign: "center" }}>
                    <input type="checkbox" checked={isEnabled("admin/force-delete-test-data")}
                      onChange={() => toggle("admin/force-delete-test-data")} />
                  </td>
                  <td style={{ fontWeight: 600 }}>Force Delete (cascade) — test data cleanup</td>
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    File Manager tab, when browsing Requisitions or Candidates
                  </td>
                  <td>
                    {isEnabled("admin/force-delete-test-data") ? (
                      <span className="tiq-badge tiq-badge-teal">Visible</span>
                    ) : (
                      <span className="tiq-badge" style={{ background: "#fee2e2", color: "#b91c1c" }}>Hidden</span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td style={{ textAlign: "center" }}>
                    <input type="checkbox" checked={isEnabled(SHOW_PLATFORM_AI_STATUS_ROUTE, false)}
                      onChange={() => toggle(SHOW_PLATFORM_AI_STATUS_ROUTE, false)} />
                  </td>
                  <td style={{ fontWeight: 600 }}>Platform AI & Search Services status card</td>
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Settings → API Keys tab, for non-admins only (shows whether Adzuna/Groq/Ollama are configured)
                  </td>
                  <td>
                    {isEnabled(SHOW_PLATFORM_AI_STATUS_ROUTE, false) ? (
                      <span className="tiq-badge tiq-badge-teal">Visible</span>
                    ) : (
                      <span className="tiq-badge" style={{ background: "#fee2e2", color: "#b91c1c" }}>Hidden</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "8px 0 0" }}>
            This permanently deletes records (interviews, pipeline entries, offers, invoices, etc.) with no undo —
            hiding it here is recommended once test-data setup is done, especially on a deployment with real hiring data.
          </p>
        </div>
      )}
    </div>
  );
}

// Must match the route key used in SettingsPage.tsx's non-admin "Platform
// AI & Search Services" status card — that key is what actually
// hides/shows it. Off (hidden) by default, unlike the other System Tools
// toggle above — an admin has to explicitly tick this on before non-admins
// see any status readout about the platform-wide Adzuna/Groq/Ollama setup.
const SHOW_PLATFORM_AI_STATUS_ROUTE = "settings/show-platform-ai-status";

export default function AdminConsolePage() {
  const [tab, setTab] = useState<"modules" | "users" | "files" | "apikeys">("modules");

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
        <button className={`tiq-tab${tab === "apikeys" ? " active" : ""}`} onClick={() => setTab("apikeys")}>
          <KeyRound size={12} style={{ display: "inline", marginRight: 6 }} /> API Keys
        </button>
      </div>

      {tab === "modules" && <ModulesManagementTab />}
      {tab === "users" && <AdminSetupPage embedded />}
      {tab === "files" && <FileManagerPage embedded />}
      {tab === "apikeys" && <ApiKeysTab />}
    </div>
  );
}
