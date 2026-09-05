import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";
import {
  Zap, Shield, Download, ArrowRight, CheckCircle,
  Globe, Database, Star, TrendingUp, Mail, Twitter, Linkedin,
} from "lucide-react";
import { CAPABILITIES, CORE_PIPELINE_CAPABILITIES, SUPPORTING_CAPABILITIES, JOBSEEKER_MODULES } from "../lib/capabilities";
import RecruitmentWorkflow from "../components/RecruitmentWorkflow";

const ALL_MODULES = CAPABILITIES.flatMap((cap) => cap.modules.map((m) => ({ ...m, capability: cap.name })));

// Derived from CAPABILITIES itself (not hardcoded) so this can never
// drift out of sync again if a capability is later added, removed, or
// merged into another one.
const STATS = [
  { value: String(CAPABILITIES.length), label: "Capabilities" },
  { value: "100%", label: "Data Ownership" },
  { value: "1", label: "Database" },
  { value: "AI", label: "LLM Powered" },
];
const BUILT_MODULE_COUNT = ALL_MODULES.filter((m) => m.built).length;

// Same on/off map Admin Console > Modules Management edits and the app
// sidebar (AppLayout.tsx) already reads — this is the public,
// unauthenticated read of it (see routers/public_config.py) so a
// logged-out visitor's browser can filter the same way. A short
// refetchInterval means a module an admin just turned off/on stops
// showing up here (or starts appearing again) without the visitor
// needing to hard-refresh — same "dynamic" behavior as the sidebar,
// just polled instead of React Query's default refetch-on-focus, since
// there's no guarantee a marketing-page visitor's tab ever loses focus.
function useVisibleModules() {
  const { data: moduleToggles = {} } = useQuery({
    queryKey: ["public-module-toggles"],
    queryFn: () => api.get("/api/public/config/module-toggles").then((r) => r.data as Record<string, boolean>),
    refetchInterval: 60_000,
  });
  const isModuleEnabled = (route: string) => moduleToggles[route] ?? true;

  const filterCaps = (caps: typeof CAPABILITIES) =>
    caps
      .map((cap) => ({ ...cap, modules: cap.modules.filter((m) => isModuleEnabled(m.route)) }))
      .filter((cap) => cap.modules.length > 0);

  return {
    visibleCapabilities: filterCaps(CAPABILITIES),
    visibleCorePipeline: filterCaps(CORE_PIPELINE_CAPABILITIES),
    visibleSupporting: filterCaps(SUPPORTING_CAPABILITIES),
    visibleJobseekerModules: JOBSEEKER_MODULES.filter((m) => isModuleEnabled(m.route)),
  };
}

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function NavDropdown({ label, items }: { label: string; items: { name: string; route: string; capability?: string; emoji?: string }[] }) {
  const [open, setOpen] = useState(false);
  // The panel below renders with `marginTop: 4` and is taken out of
  // normal flow (position: absolute), so this wrapper's own hoverable
  // box only ever covers the button itself — it does NOT grow to
  // include the panel floating underneath it. The instant the pointer
  // crosses that 4px gap on its way down to the panel, it's technically
  // over neither element, so onMouseLeave fired immediately and closed
  // the menu — then re-entering the panel (a DOM descendant, so it can
  // still trigger the wrapper's onMouseEnter) reopened it a frame later.
  // That close-then-reopen inside one pointer movement is what looked
  // like "disappearing" or, on a fast/lucky mouse path, "sometimes
  // stays". A short close delay bridges that gap: leaving either the
  // button or the panel schedules a close, but re-entering either one
  // (which cancels the pending timer below) means a mouse merely
  // passing through the gap never actually closes it.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 200); };
  useEffect(() => () => cancelClose(), []);
  return (
    <div style={{ position: "relative" }}
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}>
      <button style={{
        fontSize: 13, color: "#64748b", padding: "6px 10px", borderRadius: 6,
        fontWeight: 700, background: open ? "#f8fafc" : "transparent",
        border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
      }}>
        {label}
        <span style={{ fontSize: 9, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, marginTop: 4,
          background: "#ffffff", borderRadius: 10, border: "1px solid #f1f5f9",
          boxShadow: "0 12px 32px rgba(0,0,0,.12)", padding: 6, minWidth: 220, zIndex: 200,
        }}>
          {items.map(m => (
            <Link key={m.name} to={m.route}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 13, color: "#374151", padding: "8px 10px", borderRadius: 6, textDecoration: "none", fontWeight: 500 }}
              onMouseEnter={e => { e.currentTarget.style.background = "#f8fafc"; e.currentTarget.style.color = "#0f172a"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#374151"; }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {m.emoji && <span style={{ fontSize: 14 }}>{m.emoji}</span>}
                {m.name}
              </span>
              {m.capability && <span style={{ fontSize: 9.5, color: "#94a3b8", fontWeight: 700 }}>{m.capability}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// Grouped mega-menu for "Recruitment Platform" — the flat list was hard to
// scan with all of CAPABILITIES' worth of modules in it. Grouped by capability,
// each with its emoji + name as a non-clickable header, links below it.
function CapabilityColumn({ cap }: { cap: (typeof CAPABILITIES)[0] }) {
  return (
    <div>
      <a href={`#${slugify(cap.name)}`}
        style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, textDecoration: "none" }}>
        <span style={{ fontSize: 15 }}>{cap.emoji}</span>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: cap.color, textTransform: "uppercase", letterSpacing: ".03em" }}>{cap.name}</span>
      </a>
      {cap.modules.map(m => (
        <Link key={m.route} to={m.route}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11.5, color: "#64748b", padding: "3px 0", paddingLeft: 21, textDecoration: "none", fontWeight: 500 }}
          onMouseEnter={e => (e.currentTarget.style.color = "#0f172a")}
          onMouseLeave={e => (e.currentTarget.style.color = "#64748b")}>
          <span>{m.name}</span>
          {!m.built && <span style={{ fontSize: 8.5, color: "#94a3b8", fontWeight: 700 }}>Soon</span>}
        </Link>
      ))}
    </div>
  );
}

function RecruitmentMegaMenu({ core, supporting }: { core: typeof CAPABILITIES; supporting: typeof CAPABILITIES }) {
  const [open, setOpen] = useState(false);
  // Same gap-between-trigger-and-panel issue as NavDropdown above (the
  // panel is position:absolute and this wrapper's hover box doesn't
  // extend to cover it), made worse here since the panel is also
  // horizontally re-centered (`left: 50%, translateX(-50%)`) rather than
  // left-aligned under the button — an even easier gap to "fall out of"
  // on the way down. Same delayed-close fix.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 200); };
  useEffect(() => () => cancelClose(), []);
  return (
    <div style={{ position: "relative" }}
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}>
      <button style={{
        fontSize: 13, color: "#64748b", padding: "6px 10px", borderRadius: 6,
        fontWeight: 700, background: open ? "#f8fafc" : "transparent",
        border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
      }}>
        Recruitment Platform
        <span style={{ fontSize: 9, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", marginTop: 4,
          background: "#ffffff", borderRadius: 12, border: "1px solid #f1f5f9",
          boxShadow: "0 16px 40px rgba(0,0,0,.14)", padding: 20, zIndex: 200, width: 640,
        }}>
          {core.length > 0 && (
            <>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10 }}>
                Recruitment Capabilities
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 190px)", gap: "16px 20px", marginBottom: supporting.length > 0 ? 18 : 0 }}>
                {core.map(cap => <CapabilityColumn key={cap.name} cap={cap} />)}
              </div>
            </>
          )}
          {core.length > 0 && supporting.length > 0 && (
            <div style={{ height: 1, background: "#f1f5f9", margin: "0 0 16px" }} />
          )}
          {supporting.length > 0 && (
            <>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10 }}>
                Supporting Capabilities
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 190px)", gap: "16px 20px" }}>
                {supporting.map(cap => <CapabilityColumn key={cap.name} cap={cap} />)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

type ModuleDef = {
  icon: typeof Zap; emoji?: string; name: string; route: string;
  tagline: string; desc: string; features: string[]; built: boolean;
};

function ModuleCard({ m, isEven, color, bg }: { m: ModuleDef; isEven: boolean; color: string; bg: string }) {
  const Icon = m.icon;
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64,
      marginBottom: 80, alignItems: "center",
      direction: isEven ? "ltr" : "rtl",
    }}>
      <div style={{ direction: "ltr" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 16, padding: "6px 14px", borderRadius: 20, background: bg, border: `1px solid ${color}30` }}>
          {m.emoji ? <span style={{ fontSize: 14 }}>{m.emoji}</span> : <Icon size={14} color={color} />}
          <span style={{ fontSize: 12, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: ".5px" }}>{m.name}</span>
        </div>
        <h3 style={{ fontSize: "clamp(22px,3vw,32px)", fontWeight: 800, letterSpacing: "-.5px", marginBottom: 14, color: "#0f172a", lineHeight: 1.2 }}>{m.tagline}</h3>
        <p style={{ fontSize: 16, color: "#64748b", lineHeight: 1.8, marginBottom: 28 }}>{m.desc}</p>
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 32px" }}>
          {m.features.map(f => (
            <li key={f} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, fontSize: 14, color: "#374151" }}>
              <CheckCircle size={15} color={color} style={{ flexShrink: 0 }} /> {f}
            </li>
          ))}
        </ul>
        <Link to="/register" style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "10px 22px", borderRadius: 10, fontSize: 13, fontWeight: 600,
          background: bg, border: `1.5px solid ${color}50`,
          color, textDecoration: "none",
        }}>
          {m.built ? `Try ${m.name}` : `Preview ${m.name}`} <ArrowRight size={13} />
        </Link>
      </div>

      {/* Visual card */}
      <div style={{ direction: "ltr" }}>
        <div style={{
          background: "white", borderRadius: 20, padding: 28,
          border: "1.5px solid #f1f5f9",
          boxShadow: "0 8px 40px rgba(0,0,0,.08)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid #f1f5f9" }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: m.emoji ? 22 : undefined }}>
              {m.emoji ? m.emoji : <Icon size={22} color={color} />}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>{m.name}</div>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>AI Module</div>
            </div>
            {m.built ? (
              <div style={{ marginLeft: "auto", padding: "4px 12px", borderRadius: 20, background: "#f0fdf4", border: "1px solid #bbf7d0", fontSize: 11, color: "#16a34a", fontWeight: 700 }}>● Live</div>
            ) : (
              <div style={{ marginLeft: "auto", padding: "4px 12px", borderRadius: 20, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 11, color: "#64748b", fontWeight: 700 }}>Coming Soon</div>
            )}
          </div>
          {m.features.map((f, fi) => (
            <div key={f} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
              background: fi % 2 === 0 ? "#f8fafc" : "transparent",
              borderRadius: 8, marginBottom: 4, fontSize: 13, color: "#475569",
            }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
              {f}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


export default function LandingPage() {
  const { user } = useAuth();
  const isLoggedIn = !!user;
  const { visibleCapabilities, visibleCorePipeline, visibleSupporting, visibleJobseekerModules } = useVisibleModules();
  return (
    <div style={{ background: "#ffffff", color: "#0f172a", fontFamily: "'Inter',system-ui,sans-serif", overflowX: "hidden" }}>

      {/* ── NAV ── */}
      <nav style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "0 5%", height: 68,
        background: "rgba(255,255,255,0.92)", backdropFilter: "blur(12px)",
        borderBottom: "1px solid #f1f5f9",
        position: "sticky", top: 0, zIndex: 100,
        boxShadow: "0 1px 3px rgba(0,0,0,.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "#5ee8db", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,199,183,.35)", flexShrink: 0 }}>
            <Zap size={18} color="#f97316" fill="#f97316" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
            <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.5px", color: "#00c7b7" }}>
              TalentIQ Solution
            </span>
            <span style={{ fontSize: 9, fontStyle: "italic", fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", color: "#fb923c" }}>
              AI-Powered Talent Intelligence
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <RecruitmentMegaMenu core={visibleCorePipeline} supporting={visibleSupporting} />
          {visibleJobseekerModules.length > 0 && <NavDropdown label="Job Seeker Tools" items={visibleJobseekerModules} />}
          <Link to="/pricing" style={{
            fontSize: 13.5, fontWeight: 600, color: "#374151", textDecoration: "none",
            padding: "8px 14px", borderRadius: 8,
          }}
            onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
            Pricing
          </Link>
          <div style={{ width: 1, height: 20, background: "#e2e8f0", margin: "0 6px" }} />
          {isLoggedIn ? (
            <Link to="/app"
              style={{ fontSize: 13, fontWeight: 600, padding: "8px 18px", borderRadius: 8, background: "linear-gradient(135deg,#fdba74,#fb923c)", color: "#7c2d12", textDecoration: "none", boxShadow: "0 2px 8px rgba(251,146,60,.35)" }}>
              Go to Dashboard →
            </Link>
          ) : (
            <>
              <Link to="/login"
                style={{ fontSize: 13, color: "#374151", padding: "7px 16px", borderRadius: 8, textDecoration: "none", fontWeight: 500, border: "1px solid #e2e8f0" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                Sign in
              </Link>
              <Link to="/register"
                style={{ fontSize: 13, fontWeight: 600, padding: "8px 18px", borderRadius: 8, background: "linear-gradient(135deg,#fdba74,#fb923c)", color: "#7c2d12", textDecoration: "none", boxShadow: "0 2px 8px rgba(251,146,60,.35)" }}>
                Get started
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* ── HERO ── */}
      <section style={{
        background: "linear-gradient(160deg, #f0f9ff 0%, #f5f3ff 50%, #fff7ed 100%)",
        padding: "96px 5% 80px", textAlign: "center",
        borderBottom: "1px solid #f1f5f9",
      }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 24,
          padding: "6px 16px", borderRadius: 20,
          background: "white", border: "1px solid #e0f2fe",
          fontSize: 12, fontWeight: 600, color: "#0284c7",
          boxShadow: "0 1px 4px rgba(14,165,233,.15)",
        }}>
          <Zap size={11} fill="#0284c7" color="#0284c7" /> AI-Native Recruiting, Reimagined
        </div>

        <h1 style={{ fontSize: "clamp(36px,6vw,68px)", fontWeight: 900, lineHeight: 1.06, letterSpacing: "-2px", marginBottom: 24, color: "#0f172a" }}>
          Hire smarter with<br />
          <span style={{ background: "linear-gradient(135deg,#5ee8db,#00c7b7,#009e90)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            an AI-native recruitment platform
          </span>
        </h1>

        <p style={{ fontSize: 19, color: "#475569", lineHeight: 1.7, marginBottom: 40, maxWidth: 620, margin: "0 auto 40px" }}>
          One platform for recruiters and job seekers — source and screen candidates with AI, and manage the
          entire hiring pipeline from first contact through to offer.
        </p>

        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          {isLoggedIn ? (
            <Link to="/app" style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "14px 32px", borderRadius: 12, fontWeight: 700, fontSize: 15,
              background: "linear-gradient(135deg,#fdba74,#fb923c)", color: "#7c2d12",
              textDecoration: "none", boxShadow: "0 4px 16px rgba(251,146,60,.4)",
            }}>
              Go to Dashboard <ArrowRight size={16} />
            </Link>
          ) : (
            <>
              <Link to="/register" style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "14px 32px", borderRadius: 12, fontWeight: 700, fontSize: 15,
                background: "linear-gradient(135deg,#fdba74,#fb923c)", color: "#7c2d12",
                textDecoration: "none", boxShadow: "0 4px 16px rgba(251,146,60,.4)",
              }}>
                Start free <ArrowRight size={16} />
              </Link>
              <Link to="/login" style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "14px 32px", borderRadius: 12, fontWeight: 600, fontSize: 15,
                border: "1.5px solid #e2e8f0", color: "#374151",
                textDecoration: "none", background: "white",
                boxShadow: "0 1px 4px rgba(0,0,0,.06)",
              }}>
                Sign in
              </Link>
            </>
          )}
        </div>

        {/* STATS */}
        <div style={{ display: "flex", justifyContent: "center", gap: 48, marginTop: 64, flexWrap: "wrap" }}>
          {STATS.map(({ value, label }) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 32, fontWeight: 900, color: "#0f172a", letterSpacing: "-1px" }}>{value}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2, textTransform: "uppercase", letterSpacing: "1px", fontWeight: 600 }}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS — end-to-end workflow diagram ── */}
      <section style={{ padding: "72px 5% 88px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: "#94a3b8", marginBottom: 12 }}>
            HOW IT WORKS
          </div>
          <h2 style={{ fontSize: "clamp(26px,3.6vw,40px)", fontWeight: 800, letterSpacing: "-1px", color: "#0f172a", marginBottom: 16 }}>
            End-to-end, not a bundle of tools
          </h2>
          <p style={{ fontSize: 16, color: "#64748b", maxWidth: 600, margin: "0 auto" }}>
            A requisition flows through one connected pipeline — sourcing to placement — while {SUPPORTING_CAPABILITIES.length} supporting
            capabilities operate underneath the whole thing, not bolted on at the edges.
          </p>
        </div>
        <RecruitmentWorkflow />
      </section>

      {/* ── MODULES ── */}
      <style>{`html { scroll-behavior: smooth; }`}</style>
      <section style={{ padding: "96px 5% 48px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: "#94a3b8", marginBottom: 12 }}>
            {CAPABILITIES.length} CAPABILITIES, ONE PLATFORM
          </div>
          <h2 style={{ fontSize: "clamp(28px,4vw,44px)", fontWeight: 800, letterSpacing: "-1px", color: "#0f172a", marginBottom: 16 }}>
            Every tool you need to hire smarter
          </h2>
          <p style={{ fontSize: 17, color: "#64748b", maxWidth: 620, margin: "0 auto" }}>
            The recruitment platform is architected as {CAPABILITIES.length} capabilities, from candidate acquisition through to
            reporting — each one a complete, working part of the hiring pipeline, built in order — plus a set of
            standalone <strong>job seeker tools</strong>. Everything shares the same database, so your data compounds.
          </p>
        </div>

        {/* Jump-to-capability strip — makes moving between sections explicit */}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
          {visibleCapabilities.map((capability) => (
            <a key={capability.name} href={`#${slugify(capability.name)}`} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "7px 14px", borderRadius: 20, textDecoration: "none",
              background: capability.bg, border: `1px solid ${capability.color}35`,
              fontSize: 12.5, fontWeight: 700, color: capability.color,
            }}>
              <span>{capability.emoji}</span>{capability.name}
            </a>
          ))}
          {visibleJobseekerModules.length > 0 && (
            <a href="#job-seeker-tools" style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "7px 14px", borderRadius: 20, textDecoration: "none",
              background: "rgba(14,165,233,.12)", border: "1px solid #0ea5e935",
              fontSize: 12.5, fontWeight: 700, color: "#0ea5e9",
            }}>
              <span>🧑‍💻</span>Job Seeker Tools
            </a>
          )}
        </div>
      </section>

      {visibleCapabilities.map((capability, idx) => (
        <section key={capability.name} id={slugify(capability.name)} style={{
          padding: "72px 5%",
          background: idx % 2 === 0 ? "#ffffff" : "#f8fafc",
          borderTop: "1px solid #f1f5f9",
        }}>
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 8 }}>
              <div style={{
                width: 56, height: 56, borderRadius: 16, background: capability.bg,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0,
              }}>
                {capability.emoji}
              </div>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: capability.color, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4 }}>
                  Capability {idx + 1} of {visibleCapabilities.length}
                </div>
                <h3 style={{ fontSize: "clamp(24px,3vw,34px)", fontWeight: 800, letterSpacing: "-.5px", color: "#0f172a" }}>{capability.name}</h3>
              </div>
            </div>
            <p style={{ fontSize: 15.5, color: "#64748b", marginBottom: 48, maxWidth: 640 }}>
              {capability.summary}
            </p>
            {capability.modules.map((m, i) => (
              <ModuleCard key={m.name} m={m} isEven={i % 2 === 0} color={capability.color} bg={capability.bg} />
            ))}
          </div>
        </section>
      ))}

      {visibleJobseekerModules.length > 0 && (
        <section id="job-seeker-tools" style={{
          padding: "72px 5%", background: visibleCapabilities.length % 2 === 0 ? "#ffffff" : "#f8fafc",
          borderTop: "1px solid #f1f5f9",
        }}>
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 8 }}>
              <div style={{
                width: 56, height: 56, borderRadius: 16, background: "rgba(14,165,233,.12)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0,
              }}>
                🧑‍💻
              </div>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "#0ea5e9", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4 }}>
                  For Individuals
                </div>
                <h3 style={{ fontSize: "clamp(24px,3vw,34px)", fontWeight: 800, letterSpacing: "-.5px", color: "#0f172a" }}>Job Seeker Tools</h3>
              </div>
            </div>
            <p style={{ fontSize: 15.5, color: "#64748b", marginBottom: 48, maxWidth: 640 }}>
              Standalone tools for individuals managing their own job search — separate from the recruiter-facing
              platform above, sharing the same AI engine underneath.
            </p>
            {visibleJobseekerModules.map((m, i) => (
              <ModuleCard key={m.name} m={m} isEven={i % 2 === 0} color="#0ea5e9" bg="rgba(14,165,233,.12)" />
            ))}
          </div>
        </section>
      )}

      {/* ── WHY ── */}
      <section style={{ background: "#f8fafc", borderTop: "1px solid #f1f5f9", borderBottom: "1px solid #f1f5f9", padding: "80px 5%" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <h2 style={{ fontSize: "clamp(26px,4vw,40px)", fontWeight: 800, letterSpacing: "-.5px", color: "#0f172a", marginBottom: 12 }}>Why TalentIQ Solution?</h2>
            <p style={{ fontSize: 16, color: "#64748b" }}>Built for teams that want AI-powered hiring without the SaaS sprawl.</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
            {[
              { icon: Shield, color: "#0ea5e9", title: "Every click saved", body: "Every search, match, and profile is persisted to our database — your data compounds over time." },
              { icon: Download, color: "#6366f1", title: "Export anywhere", body: "Download job matches, market reports, and candidate lists as Excel spreadsheets at any point." },
              { icon: TrendingUp, color: "#f59e0b", title: "Grows with you", body: "Start with job hunting. Add market intelligence. Build a recruiting pipeline. Each module is composable." },
              { icon: Zap, color: "#34d399", title: "LangChain + AI", body: "Each module is a composable LangChain agent — easy to extend, chain, and deploy for your workflow." },
              { icon: Globe, color: "#f472b6", title: "No vendor lock-in", body: "Self-hosted, open architecture. Swap any LLM, API, or database. Your keys, your data." },
              { icon: Database, color: "#fb923c", title: "One platform, one database", body: "Stop juggling separate SaaS products. TalentIQ Solution unifies candidate acquisition, screening, and market research." },
            ].map(({ icon: Icon, color, title, body }) => (
              <div key={title} style={{
                padding: 28, background: "white", borderRadius: 16,
                border: "1.5px solid #f1f5f9",
                boxShadow: "0 2px 8px rgba(0,0,0,.04)",
              }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: `${color}15`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                  <Icon size={20} color={color} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>{title}</div>
                <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.7 }}>{body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{
        background: "#00c7b7",
        padding: "80px 5%", textAlign: "center",
      }}>
        <h2 style={{ fontSize: "clamp(28px,5vw,52px)", fontWeight: 900, letterSpacing: "-1.5px", marginBottom: 16, color: "white" }}>
          Ready to hire smarter?
        </h2>
        <p style={{ fontSize: 18, color: "rgba(255,255,255,.85)", marginBottom: 40 }}>
          Free to start. {BUILT_MODULE_COUNT} modules live today. Your data stays yours.
        </p>
        {isLoggedIn ? (
          <Link to="/app" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "16px 40px", borderRadius: 12, fontWeight: 700, fontSize: 16,
            background: "white", color: "#009e90",
            textDecoration: "none", boxShadow: "0 4px 20px rgba(0,0,0,.2)",
          }}>
            Go to Dashboard <ArrowRight size={17} />
          </Link>
        ) : (
          <Link to="/register" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "16px 40px", borderRadius: 12, fontWeight: 700, fontSize: 16,
            background: "white", color: "#009e90",
            textDecoration: "none", boxShadow: "0 4px 20px rgba(0,0,0,.2)",
          }}>
            Create free account <ArrowRight size={17} />
          </Link>
        )}
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ background: "#0f172a", color: "white", padding: "56px 5% 32px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1.6fr 1fr 1fr", gap: 40, marginBottom: 48 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: "#5ee8db", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,199,183,.35)" }}>
                  <Zap size={16} color="#f97316" fill="#f97316" />
                </div>
                <span style={{ fontSize: 16, fontWeight: 800, color: "#00c7b7" }}>TalentIQ Solution</span>
              </div>
              <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.7, maxWidth: 240 }}>
                The AI-native recruitment platform — one database, zero vendor lock-in, built to scale with you.
              </p>
              <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                {[Twitter, Linkedin, Mail].map((Icon, i) => (
                  <div key={i} style={{ width: 34, height: 34, borderRadius: 8, border: "1px solid #1e293b", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                    <Icon size={15} color="#64748b" />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: "#475569", marginBottom: 16 }}>Modules</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 20 }}>
                {[...visibleCapabilities.flatMap((cap) => cap.modules), ...visibleJobseekerModules].map(m => (
                  <Link key={m.name} to={m.route} style={{ display: "block", fontSize: 13, color: "#64748b", textDecoration: "none", marginBottom: 10 }}
                    onMouseEnter={e => (e.currentTarget.style.color = "white")}
                    onMouseLeave={e => (e.currentTarget.style.color = "#64748b")}>
                    {m.name}
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: "#475569", marginBottom: 16 }}>Platform</div>
              {[["Sign in", "/login"], ["Register", "/register"], ["Dashboard", "/app"]].map(([label, to]) => (
                <Link key={label} to={to} style={{ display: "block", fontSize: 13, color: "#64748b", textDecoration: "none", marginBottom: 10 }}
                  onMouseEnter={e => (e.currentTarget.style.color = "white")}
                  onMouseLeave={e => (e.currentTarget.style.color = "#64748b")}>
                  {label}
                </Link>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: "#475569", marginBottom: 16 }}>Legal Centre</div>
              {[["Terms of Use", "/terms"], ["Privacy Policy", "/privacy"], ["Data Security", "/data-security"]].map(([label, to]) => (
                <Link key={label} to={to} style={{ display: "block", fontSize: 13, color: "#64748b", textDecoration: "none", marginBottom: 10 }}
                  onMouseEnter={e => (e.currentTarget.style.color = "white")}
                  onMouseLeave={e => (e.currentTarget.style.color = "#64748b")}>
                  {label}
                </Link>
              ))}
            </div>
          </div>
          <div style={{ borderTop: "1px solid #1e293b", paddingTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div style={{ fontSize: 12, color: "#475569" }}>© {new Date().getFullYear()} TalentIQ Solution Platform. All rights reserved.</div>
            <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
              <Link to="/terms" style={{ fontSize: 12, color: "#475569", textDecoration: "none" }}>Terms of Use</Link>
              <Link to="/privacy" style={{ fontSize: 12, color: "#475569", textDecoration: "none" }}>Privacy Policy</Link>
              <Link to="/data-security" style={{ fontSize: 12, color: "#475569", textDecoration: "none" }}>Data Security</Link>
              <div style={{ fontSize: 12, color: "#475569" }}>Built with LangChain · Playwright</div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
