import { useState } from "react";
import { Outlet, NavLink, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, Settings, LogOut, Shield, Database, Home,
  ChevronDown, ChevronRight, Zap,
} from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { CAPABILITIES, CORE_PIPELINE_CAPABILITIES, SUPPORTING_CAPABILITIES, JOBSEEKER_MODULES } from "../../lib/capabilities";
import TopbarPlanWidget from "./TopbarPlanWidget";

// Matches .tiq-nav-item's own font exactly (14px / 500 / rgba(255,255,255,.6))
// so a capability header reads at the same weight as the module links inside
// it — the only visual differentiators are the chevron and the indent.
const CAPABILITY_LABEL_STYLE: React.CSSProperties = {
  fontSize: 14, fontWeight: 500, color: "rgba(255,255,255,.68)", lineHeight: "20px",
};

function CapabilityGroup({ capability, moduleToggles }: { capability: (typeof CAPABILITIES)[0]; moduleToggles: Record<string, boolean> }) {
  // Collapsed by default, per explicit direction — the sidebar was
  // previously changed to default-expanded when Placements only had one
  // module and it was easy to miss; now that Placements (and every
  // other phase) shows its full module list directly as three separate
  // clickable entries, there's less need for auto-expansion to compensate.
  // Still just one click to expand any group that's collapsed.
  const [open, setOpen] = useState(false);
  // A missing entry means enabled — see Admin Console > Modules
  // Management and routers/admin.py's get_module_toggles, which only
  // ever stores rows for modules an admin has actually turned off.
  const visibleModules = capability.modules.filter((m) => moduleToggles[m.route] !== false);
  if (visibleModules.length === 0) return null;
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between", width: "100%",
          background: "none", border: "none", cursor: "pointer", padding: "9px 12px",
          textAlign: "left", borderRadius: "var(--radius-sm)",
        }}
      >
        {/* Fixed-width icon column — guarantees every capability's label
            starts at the exact same x position, regardless of how wide any
            individual emoji glyph happens to render (this was the cause of
            the inconsistent indentation between rows). */}
        <span style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0 }}>
          <span style={{ width: 18, flexShrink: 0, fontSize: 14, lineHeight: "20px", textAlign: "center" }}>
            {capability.emoji}
          </span>
          <span style={CAPABILITY_LABEL_STYLE}>{capability.name}</span>
        </span>
        <span style={{ flexShrink: 0, marginLeft: 8, marginTop: 3 }}>
          {open ? <ChevronDown size={13} color="rgba(255,255,255,.4)" /> : <ChevronRight size={13} color="rgba(255,255,255,.4)" />}
        </span>
      </button>
      {open && visibleModules.map(({ route, name, icon: Icon, color, built }) => (
        <NavLink key={route} to={route}
          className={({ isActive }) => `tiq-nav-item${isActive ? " active" : ""}`}
          style={{ padding: "6px 12px 6px 34px", fontSize: 12 }}>
          <Icon size={13.5} color={color} />
          <span style={{ flex: 1 }}>{name}</span>
          {!built && (
            <span style={{
              fontSize: 8.5, fontWeight: 800, padding: "1px 6px", borderRadius: 8,
              background: "rgba(255,255,255,.1)", color: "rgba(255,255,255,.4)",
              textTransform: "uppercase", letterSpacing: "0.04em",
            }}>
              Soon
            </span>
          )}
        </NavLink>
      ))}
    </div>
  );
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  // Loaded once for the whole sidebar — every CapabilityGroup reads from
  // this same map rather than each fetching its own copy. Defaults to
  // {} (nothing hidden) while loading, so the sidebar renders fully
  // populated immediately rather than flashing empty first.
  //
  // Uses the PUBLIC endpoint (routers/public_config.py), not the
  // admin-only /api/admin/module-toggles — the toggle map itself isn't
  // sensitive, and every logged-in user's sidebar needs to read it, not
  // just admins'. (Using the admin-only endpoint here used to mean a
  // non-admin's sidebar fetch silently 403'd, fell back to the {}
  // default, and so never actually hid anything an admin had toggled
  // off — this fixes that.) Polled every 60s so a module an admin
  // toggles shows/hides for every already-logged-in user's sidebar
  // shortly after, not just on next full page load.
  const { data: moduleToggles = {} } = useQuery({
    queryKey: ["module-toggles"],
    queryFn: () => api.get("/api/public/config/module-toggles").then(r => r.data as Record<string, boolean>),
    refetchInterval: 60_000,
  });

  return (
    <div className="tiq-app-shell">
      <aside className="tiq-sidebar">
        <div className="tiq-logo">
          <div className="tiq-logo-row">
            <div className="tiq-logo-icon"><Zap size={16} color="#f97316" fill="#f97316" /></div>
            <div className="tiq-logo-wordmark">TalentIQ Solution</div>
          </div>
          <div className="tiq-logo-sub">Platform</div>
        </div>

        <nav className="tiq-nav">
          <div className="tiq-nav-section">Overview</div>
          <NavLink to="/app" end
            className={({ isActive }) => `tiq-nav-item${isActive ? " active" : ""}`}>
            <LayoutDashboard size={16} />Dashboard
          </NavLink>

          <div className="tiq-nav-section">Recruitment Modules</div>
          {CORE_PIPELINE_CAPABILITIES.map((capability) => <CapabilityGroup key={capability.name} capability={capability} moduleToggles={moduleToggles} />)}

          <div className="tiq-nav-section">Supporting Modules</div>
          {SUPPORTING_CAPABILITIES.map((capability) => <CapabilityGroup key={capability.name} capability={capability} moduleToggles={moduleToggles} />)}

          {/* Job Seeker Tools live outside CAPABILITIES entirely (they're
              not part of the recruiter-facing phase groups), so they
              need their own toggle-filtering here rather than going
              through CapabilityGroup — and since this is a flat list,
              not a phase group, the section title itself has to be
              hidden by hand when nothing's left to show under it, which
              CapabilityGroup's own "return null" handles automatically
              for the phase groups above. */}
          {(() => {
            const visibleJobseekerModules = JOBSEEKER_MODULES.filter((m) => moduleToggles[m.route] !== false);
            if (visibleJobseekerModules.length === 0) return null;
            return (
              <>
                <div className="tiq-nav-section">Job Seeker Tools</div>
                {visibleJobseekerModules.map(({ route, name, icon: Icon, emoji }) => (
                  <NavLink key={route} to={route}
                    className={({ isActive }) => `tiq-nav-item${isActive ? " active" : ""}`}>
                    {emoji ? <span style={{ width: 16, textAlign: "center", fontSize: 14 }}>{emoji}</span> : <Icon size={16} />}
                    {name}
                  </NavLink>
                ))}
              </>
            );
          })()}

          <div className="tiq-nav-section">Account</div>
          <NavLink to="/app/settings"
            className={({ isActive }) => `tiq-nav-item${isActive ? " active" : ""}`}>
            <Settings size={16} />Settings
          </NavLink>

          {isAdmin && (
            <>
              <div className="tiq-nav-section">Admin</div>
              <NavLink to="/app/admin-console"
                className={({ isActive }) => `tiq-nav-item${isActive ? " active" : ""}`}>
                <Shield size={16} />Admin Console
              </NavLink>
            </>
          )}
        </nav>

        <div className="tiq-sidebar-footer">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              background: "rgba(0,199,183,.2)", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 700, color: "#00c7b7",
            }}>
              {user?.name?.[0]?.toUpperCase()}
            </div>
            <div style={{ overflow: "hidden" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "white", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {user?.name}
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,.35)" }}>{user?.role}</div>
            </div>
          </div>
        </div>
      </aside>

      <main className="tiq-main">
        <div className="tiq-topbar">
          <div style={{ fontSize: 14, color: "var(--text-muted)" }}>
            Welcome back, <strong style={{ color: "var(--text-primary)" }}>{user?.name?.split(" ")[0]}</strong>
          </div>
          {isAdmin && user?.name?.split(" ")[0]?.toLowerCase() !== "admin" && (
            <span className="tiq-badge tiq-badge-violet">Admin</span>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
            <TopbarPlanWidget />
            <Link to="/" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textDecoration: "none", padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
              onMouseEnter={e => { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.background = "var(--bg-secondary)"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "transparent"; }}>
              <Home size={12} /> Home
            </Link>
            <button onClick={logout} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "#ef4444", padding: "5px 10px", borderRadius: 6, border: "1px solid #fecaca", background: "transparent", cursor: "pointer" }}
              onMouseEnter={e => { e.currentTarget.style.background = "#fef2f2"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
              <LogOut size={12} /> Sign out
            </button>
          </div>
        </div>
        <div className="tiq-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
