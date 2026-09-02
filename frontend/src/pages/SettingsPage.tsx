import { useNavigate } from "react-router-dom";
import { useState, useEffect, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings, Key, User, Shield, Trash2, Pencil, Home} from "lucide-react";
import { authApi, candidateLensSettingsApi, api } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import DataTable from "../components/DataTable";
import { MeetingLinkPanel } from "./admin/PlatformIntegrationsPanels";

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"profile" | "apikeys" | "admin">("profile");

  // ── PROFILE ──────────────────────────────────────────────────────
  const [profile, setProfile] = useState({
    name: user?.name || "",
    company: user?.company || "",
    phone: user?.phone || "",
    address: user?.address || "",
  });
  const profileMut = useMutation({
    mutationFn: () => authApi.updateProfile(profile),
    onSuccess: () => refreshUser(),
  });

  // ── PASSWORD ─────────────────────────────────────────────────────
  const [pw, setPw] = useState({ old: "", next: "", confirm: "" });
  const [pwErr, setPwErr] = useState("");
  const [pwOk, setPwOk] = useState(false);
  const pwMut = useMutation({
    mutationFn: () => authApi.changePassword(pw.old, pw.next),
    onSuccess: () => { setPwOk(true); setPw({ old: "", next: "", confirm: "" }); },
    onError: (e: any) => setPwErr(e.response?.data?.detail || "Failed"),
  });

  // ── API KEYS ─────────────────────────────────────────────────────
  const { data: savedKeys = [] } = useQuery({ queryKey: ["api-keys"], queryFn: authApi.listApiKeys });
  const smtpSavedKeys = savedKeys.filter((k: any) => k.service === "smtp");

  // Each service stores its fields independently
  const [linkedin, setLinkedin] = useState({ email: "", password: "" });
  // port starts blank (not pre-filled with "587") so that saving with
  // it left empty never overwrites an already-saved custom port (e.g.
  // 465 for SSL) — the saveKey() call below only sends non-empty
  // fields, so a blank port here means "leave it as whatever's saved".
  const [smtp, setSmtp] = useState({ host: "", port: "", username: "", password: "", from_email: "" });
  const [telephony, setTelephony] = useState({ account_sid: "", auth_token: "", caller_number: "" });
  const telephonySavedKeys = savedKeys.filter((k: any) => k.service === "telephony");
  // ── Phone Connection (Windows/Android Caller) ───────────────────────
  // Alternative to Twilio telephony above: a small Local API the
  // recruiter runs on their own Windows laptop, which drives their own
  // Android phone's dialer over ADB — real SIM call, no per-minute
  // Twilio cost, no cloud number. Only the fields needed to reach that
  // Local API are stored server-side (per-user, never shared); the
  // pairing/dialing calls themselves go straight from this browser tab
  // to the Local API on localhost, since only the browser is running on
  // the same machine as the paired phone.
  const androidCallerSavedKeys = savedKeys.filter((k: any) => k.service === "android_caller");
  const savedApiBase = androidCallerSavedKeys.find((k: any) => k.key_name === "api_base")?.key_preview;
  const savedEnabled = androidCallerSavedKeys.find((k: any) => k.key_name === "enabled")?.key_preview;
  const savedMode = androidCallerSavedKeys.find((k: any) => k.key_name === "mode")?.key_preview;
  const savedAgentTokenKey = androidCallerSavedKeys.find((k: any) => k.key_name === "agent_token");
  const [androidCaller, setAndroidCaller] = useState({ api_base: "http://127.0.0.1:4000" });
  const [androidCallerMode, setAndroidCallerMode] = useState<"direct" | "relay">("relay");
  const [androidCallerEnabled, setAndroidCallerEnabled] = useState(false);
  const [androidCallerLoaded, setAndroidCallerLoaded] = useState(false);
  useEffect(() => {
    // api_base/enabled/mode aren't secrets — the backend returns them
    // back in full (see UNMASKED_PREVIEW_FIELDS), so pre-fill the real
    // saved values once, the first time they load. agent_token IS a
    // secret and stays masked — see savedKeysBar for that one.
    if (!androidCallerLoaded && androidCallerSavedKeys.length > 0) {
      if (savedApiBase) setAndroidCaller({ api_base: savedApiBase });
      if (savedEnabled) setAndroidCallerEnabled(savedEnabled === "true");
      if (savedMode === "direct" || savedMode === "relay") setAndroidCallerMode(savedMode);
      setAndroidCallerLoaded(true);
    }
  }, [androidCallerSavedKeys, savedApiBase, savedEnabled, savedMode, androidCallerLoaded]);
  // The WebSocket URL the Relay-mode agent needs, derived from wherever
  // this frontend itself was loaded from — TalentIQ's backend and
  // frontend are served from the same origin (see main.py's StaticFiles
  // mount), so this always points at the right place without needing a
  // separate "API URL" setting anywhere.
  const relayServerUrl = `${window.location.origin.replace(/^http/, "ws")}/api/android-caller/ws`;
  const [generatingToken, setGeneratingToken] = useState(false);
  const [freshAgentToken, setFreshAgentToken] = useState("");
  const [tokenGenError, setTokenGenError] = useState("");
  const generateAgentToken = async () => {
    setGeneratingToken(true); setTokenGenError(""); setFreshAgentToken("");
    try {
      const { data } = await api.post("/api/android-caller/generate-token");
      setFreshAgentToken(data.agent_token);
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    } catch (e: any) {
      setTokenGenError(e?.response?.data?.detail || "Failed to generate a token.");
    } finally {
      setGeneratingToken(false);
    }
  };
  const [relayStatus, setRelayStatus] = useState<{ agentConnected: boolean; deviceConnected: boolean; needsAuthorization?: boolean } | null>(null);
  const [relayStatusChecking, setRelayStatusChecking] = useState(false);
  const checkRelayStatus = async () => {
    setRelayStatusChecking(true);
    try {
      const { data } = await api.get("/api/android-caller/status");
      setRelayStatus(data);
    } catch {
      setRelayStatus(null);
    } finally {
      setRelayStatusChecking(false);
    }
  };
  const [androidHealth, setAndroidHealth] = useState<{ reachable: boolean; deviceConnected: boolean; needsAuthorization?: boolean } | null>(null);
  const [androidHealthChecking, setAndroidHealthChecking] = useState(false);
  const checkAndroidHealth = async (base: string) => {
    setAndroidHealthChecking(true);
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/api/health`);
      const data = await res.json();
      setAndroidHealth({ reachable: true, deviceConnected: !!data.deviceConnected, needsAuthorization: !!data.needsAuthorization });
    } catch {
      setAndroidHealth({ reachable: false, deviceConnected: false });
    } finally {
      setAndroidHealthChecking(false);
    }
  };
  const [pairIp, setPairIp] = useState("");
  const [pairPort, setPairPort] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [pairMsg, setPairMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [connectIp, setConnectIp] = useState("");
  const [connectPort, setConnectPort] = useState("5555");
  const [connectMsg, setConnectMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [connectBusy, setConnectBusy] = useState(false);
  const androidApiBase = () => (androidCaller.api_base || "http://127.0.0.1:4000").replace(/\/$/, "");
  const runAndroidPair = async () => {
    setPairBusy(true); setPairMsg(null);
    try {
      if (androidCallerMode === "relay") {
        await api.post("/api/android-caller/pair", { ip: pairIp, port: pairPort, code: pairCode });
        setPairMsg({ ok: true, text: "Paired. Now connect below." });
        checkRelayStatus();
      } else {
        const res = await fetch(`${androidApiBase()}/api/adb/pair`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ip: pairIp, port: pairPort, code: pairCode }),
        });
        const data = await res.json();
        setPairMsg({ ok: res.ok, text: res.ok ? "Paired. Now connect below." : data.message || "Pairing failed." });
        if (res.ok) checkAndroidHealth(androidApiBase());
      }
    } catch (e: any) {
      setPairMsg({
        ok: false,
        text: androidCallerMode === "relay"
          ? (e?.response?.data?.detail || "Pairing failed — is the agent (npm run start:agent) running and connected?")
          : "Could not reach the Local API — is the Local API (npm start in server/) running on this laptop?",
      });
    } finally {
      setPairBusy(false);
    }
  };
  const runAndroidConnect = async () => {
    setConnectBusy(true); setConnectMsg(null);
    try {
      if (androidCallerMode === "relay") {
        await api.post("/api/android-caller/connect", { ip: connectIp || pairIp, port: connectPort });
        setConnectMsg({ ok: true, text: "Connected! Check connection below." });
        checkRelayStatus();
      } else {
        const res = await fetch(`${androidApiBase()}/api/adb/connect`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ip: connectIp || pairIp, port: connectPort }),
        });
        const data = await res.json();
        setConnectMsg({ ok: res.ok, text: res.ok ? "Connected! Status below should flip to \"phone connected\"." : data.message || "Connect failed." });
        if (res.ok) checkAndroidHealth(androidApiBase());
      }
    } catch (e: any) {
      setConnectMsg({
        ok: false,
        text: androidCallerMode === "relay"
          ? (e?.response?.data?.detail || "Connect failed — is the agent (npm run start:agent) running and connected?")
          : "Could not reach the Local API — is the Local API (npm start in server/) running on this laptop?",
      });
    } finally {
      setConnectBusy(false);
    }
  };

  const [interviewSettings, setInterviewSettings] = useState({ answer_seconds: "30", tts_voice: "en-US-JennyNeural", tts_engine: "edge" });
  const [keyMsg, setKeyMsg] = useState("");

  // ── Interview Settings (Admin Console) — answer time + TTS voice ────
  const { data: liveInterviewSettings } = useQuery({
    queryKey: ["interview-settings"], queryFn: candidateLensSettingsApi.get,
  });
  const [edgeVoices, setEdgeVoices] = useState<Record<string, string>>({});
  const [interviewSettingsLoaded, setInterviewSettingsLoaded] = useState(false);
  useEffect(() => {
    if (liveInterviewSettings && !interviewSettingsLoaded) {
      setInterviewSettings({
        answer_seconds: String(liveInterviewSettings.answer_seconds ?? 30),
        tts_voice: liveInterviewSettings.tts_voice || "en-US-JennyNeural",
        tts_engine: liveInterviewSettings.tts_engine || "edge",
      });
      setEdgeVoices(liveInterviewSettings.edge_voices || {});
      setInterviewSettingsLoaded(true);
    }
  }, [liveInterviewSettings, interviewSettingsLoaded]);

  const flashMsg = (m: string) => { setKeyMsg(m); setTimeout(() => setKeyMsg(""), 3000); };

  const [savingService, setSavingService] = useState("");
  const isAdmin = user?.role === "admin";
  const { data: globalKeys = [] } = useQuery({ queryKey: ["global-keys"], queryFn: authApi.listGlobalKeys });
  const globalServiceSet = new Set(globalKeys.map((k: any) => k.service));
  const SHAREABLE = ["groq", "ollama", "apify"];

  // Whether non-admins see the "Platform AI & Search Services" status
  // readout below at all — same module-toggles endpoint/query key
  // AdminConsolePage.tsx's Modules Management > System Tools uses for
  // this same toggle. Off (hidden) unless an admin explicitly ticks it
  // on there; only fetched for non-admins since admins always see the
  // full editable cards instead of this readout.
  const SHOW_PLATFORM_AI_STATUS_ROUTE = "settings/show-platform-ai-status";
  const { data: moduleToggles = {} } = useQuery({
    queryKey: ["module-toggles"],
    queryFn: () => api.get("/api/admin/module-toggles").then(r => r.data as Record<string, boolean>),
    enabled: !isAdmin,
  });
  const showPlatformAiStatus = moduleToggles[SHOW_PLATFORM_AI_STATUS_ROUTE] ?? false;

  // Whether Groq is configured platform-wide can come from either the
  // legacy single is_global key (covered by globalServiceSet below) OR
  // the Groq Key Pool, which lives in its own table and is invisible to
  // GET /global-keys — checked separately so the status card doesn't
  // wrongly say "Not yet configured" when the admin set Groq up via the
  // pool instead.
  const { data: groqPoolActive } = useQuery({ queryKey: ["groq-pool-active"], queryFn: authApi.groqPoolActive });

  const saveKey = async (service: string, fields: Record<string, string>) => {
    const entries = Object.entries(fields).filter(([, v]) => v.trim() !== "");
    if (entries.length === 0) { flashMsg("Enter at least one value to save."); return; }
    setSavingService(service);
    // Apify/Groq/Ollama are admin-only to even open (backend rejects a
    // non-admin save with 403 — see routers/auth.py), so there's no
    // legitimate "admin-private, not shared" case for them: whatever the
    // admin sets here IS the platform-wide value every other user
    // inherits. Always save as global rather than gating on a checkbox —
    // a missed tick there was silently saving these as admin-only
    // private keys, which is exactly why non-admins were seeing "Not yet
    // configured" despite the admin having filled the form in and saved.
    const isGlobal = isAdmin && SHAREABLE.includes(service);
    try {
      for (const [key_name, key_value] of entries) {
        await authApi.saveApiKey({ service, key_name, key_value, is_global: isGlobal });
      }
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      flashMsg("✅ " + service + " credentials saved successfully!" + (isGlobal ? " (shared with all users)" : ""));
    } catch (e: any) {
      flashMsg("❌ Failed to save " + service + ": " + (e.response?.data?.detail || e.message));
    } finally {
      setSavingService("");
    }
  };

  const deleteKeyMut = useMutation({
    mutationFn: (id: number) => authApi.deleteApiKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  const [savingInterview, setSavingInterview] = useState(false);
  const saveInterviewSettings = async () => {
    const seconds = Math.max(10, Math.min(600, Number(interviewSettings.answer_seconds) || 30));
    setSavingInterview(true);
    try {
      await authApi.saveApiKey({ service: "interview", key_name: "answer_seconds", key_value: String(seconds), is_global: true });
      await authApi.saveApiKey({ service: "interview", key_name: "tts_engine", key_value: interviewSettings.tts_engine, is_global: true });
      if (interviewSettings.tts_engine !== "browser") {
        await authApi.saveApiKey({ service: "interview", key_name: "tts_voice", key_value: interviewSettings.tts_voice, is_global: true });
      }
      qc.invalidateQueries({ queryKey: ["interview-settings"] });
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      flashMsg("✅ Interview settings saved — applies to every recruiter and candidate.");
    } catch (e: any) {
      flashMsg("❌ Failed to save interview settings: " + (e.response?.data?.detail || e.message));
    } finally {
      setSavingInterview(false);
    }
  };

  // ── Inline editing for an already-saved key ─────────────────────────
  // The actual key value is never returned by the API (see key_preview
  // instead), so "editing" means: type a NEW value to replace the old
  // one — the backend's POST /api-keys already upserts on matching
  // service+key_name, so this reuses that same endpoint.
  const [editingKeyId, setEditingKeyId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const startEdit = (k: any) => { setEditingKeyId(k.id); setEditValue(""); setEditError(""); };
  const cancelEdit = () => { setEditingKeyId(null); setEditValue(""); setEditError(""); };
  const saveEdit = async (k: any) => {
    if (!editValue.trim()) { setEditError("Enter a new value first."); return; }
    setEditSaving(true);
    setEditError("");
    try {
      await authApi.saveApiKey({ service: k.service, key_name: k.key_name, key_value: editValue.trim(), is_global: k.is_global });
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      qc.invalidateQueries({ queryKey: ["global-keys"] });
      flashMsg(`✅ ${k.service} / ${k.key_name} updated successfully!`);
      cancelEdit();
    } catch (e: any) {
      setEditError(e?.response?.data?.detail || "Failed to update — try again.");
    } finally {
      setEditSaving(false);
    }
  };

  // ── Saved-keys summary shown at the TOP of each service's own card ──
  // Same inline show/edit/delete pattern as the Groq Key Pool section
  // below, applied generically to every other service — so a saved key
  // is visible and manageable right where you'd go looking for it,
  // instead of only in the catch-all table at the bottom of the page.
  const savedKeysFor = (service: string) => savedKeys.filter((k: any) => k.service === service);

  const savedKeysBar = (service: string) => {
    const keys = savedKeysFor(service);
    if (keys.length === 0) return null;
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
          Currently saved
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {keys.map((k: any) => (
            <Fragment key={k.id}>
              <div style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                border: "1px solid var(--border)", borderRadius: 8,
              }}>
                <span style={{ fontFamily: "monospace", fontSize: 12.5 }}>{k.key_name}</span>
                <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{k.key_preview || "—"}</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
                  {new Date(k.created_at).toLocaleDateString()}
                </span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Edit — enter a new value to replace this key"
                    onClick={() => editingKeyId === k.id ? cancelEdit() : startEdit(k)}>
                    <Pencil size={13} />
                  </button>
                  <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" style={{ color: "var(--rose-500)" }}
                    title="Delete this key"
                    onClick={() => { if (confirm(`Delete ${k.service} / ${k.key_name}?`)) deleteKeyMut.mutate(k.id); }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {editingKeyId === k.id && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
                  background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8,
                }}>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                    New value for {k.key_name}:
                  </span>
                  <input
                    type={k.key_name.toLowerCase().includes("password") || k.key_name.toLowerCase().includes("key") ? "password" : "text"}
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") saveEdit(k); if (e.key === "Escape") cancelEdit(); }}
                    placeholder="Enter the new value — current value is never shown, for security"
                    autoFocus
                    style={{ flex: 1, padding: "6px 10px", fontSize: 12.5, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
                  />
                  <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={() => saveEdit(k)} disabled={editSaving}>
                    {editSaving ? "Saving…" : "Save"}
                  </button>
                  <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={cancelEdit} disabled={editSaving}>
                    Cancel
                  </button>
                  {editError && <div style={{ fontSize: 11.5, color: "var(--rose-500)" }}>{editError}</div>}
                </div>
              )}
            </Fragment>
          ))}
        </div>
      </div>
    );
  };

  // Services that already show/manage their own saved key(s) inline in
  // their own card (via savedKeysBar above, the Groq Key Pool's own
  // listing, or — for "interview" — the live-loaded Interview Settings
  // form) — plus "database" and "s3", which are platform infrastructure
  // credentials managed exclusively in Admin Console > API Keys (see
  // ApiKeysTab.tsx's DatabasePanel/S3Panel). Those two are deliberately
  // excluded here, not just "not yet given a card": a regular per-user
  // Settings page is the wrong place for infra secrets to be editable/
  // deletable from, even for the admin who configured them. The
  // catch-all "Saved keys" table at the bottom only needs to show
  // whatever's left: services with no dedicated settings window
  // anywhere in the app.
  const DEDICATED_UI_SERVICES = ["apify", "groq", "linkedin", "calendly", "navtalk", "ollama", "morphcast", "smtp", "telephony", "android_caller", "interview", "database", "s3", "meeting_platform"];
  const otherSavedKeys = savedKeys.filter((k: any) => !DEDICATED_UI_SERVICES.includes(k.service));

  // ── ADMIN USERS ──────────────────────────────────────────────────
  const { data: users = [] } = useQuery({
    queryKey: ["admin-users-settings"],
    queryFn: authApi.listUsers,
    enabled: user?.role === "admin",
  });
  const deactivateMut = useMutation({
    mutationFn: (id: number) => authApi.deactivateUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users-settings"] }),
  });

  const inp = (label: string, val: string, set: (v: string) => void, type = "text", ph = "") => (
    <div className="tiq-form-group">
      <label className="tiq-label">{label}</label>
      <input type={type} className="tiq-input" value={val}
        onChange={e => set(e.target.value)} placeholder={ph} />
    </div>
  );

  return (
    <div>
      <div className="tiq-page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <h1 className="tiq-page-title">Settings</h1>
        <p className="tiq-page-sub">Manage your account, credentials and API keys</p>
      </div>
      <button onClick={() => navigate("/")} className="tiq-btn tiq-btn-ghost tiq-btn-sm"
        style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, alignSelf: "flex-start" }}>
        <Home size={14} /> Home
      </button>

      <div className="tiq-tabs">
        <button className={`tiq-tab${tab === "profile" ? " active" : ""}`} onClick={() => setTab("profile")}>
          <User size={13} style={{ display: "inline", marginRight: 6 }} />Profile
        </button>
        <button className={`tiq-tab${tab === "apikeys" ? " active" : ""}`} onClick={() => setTab("apikeys")}>
          <Key size={13} style={{ display: "inline", marginRight: 6 }} />API Keys
        </button>
        {user?.role === "admin" && (
          <button className={`tiq-tab${tab === "admin" ? " active" : ""}`} onClick={() => setTab("admin")}>
            <Shield size={13} style={{ display: "inline", marginRight: 6 }} />Users
          </button>
        )}
      </div>

      {/* ── PROFILE TAB ── */}
      {tab === "profile" && (
        <div style={{ maxWidth: 560 }}>
          <div className="tiq-card tiq-mb-6">
            <div className="tiq-card-title">Personal information</div>
            <div className="tiq-grid-2">
              {inp("Full name", profile.name, v => setProfile(p => ({ ...p, name: v })))}
              {inp("Company", profile.company, v => setProfile(p => ({ ...p, company: v })))}
              {inp("Phone", profile.phone, v => setProfile(p => ({ ...p, phone: v })))}
              <div className="tiq-form-group">
                <label className="tiq-label">Email (User ID — read only)</label>
                <input className="tiq-input" value={user?.email || ""} disabled style={{ opacity: .6 }} />
              </div>
            </div>
            {inp("Address", profile.address, v => setProfile(p => ({ ...p, address: v })))}
            {profileMut.isSuccess && <div className="tiq-alert tiq-alert-success">Profile updated.</div>}
            <button className="tiq-btn tiq-btn-primary" onClick={() => profileMut.mutate()} disabled={profileMut.isPending}>
              {profileMut.isPending ? "Saving…" : "Save changes"}
            </button>
          </div>

          <div className="tiq-card">
            <div className="tiq-card-title">Change password</div>
            {pwErr && <div className="tiq-alert tiq-alert-error">{pwErr}</div>}
            {pwOk && <div className="tiq-alert tiq-alert-success">Password changed.</div>}
            {inp("Current password", pw.old, v => setPw(p => ({ ...p, old: v })), "password")}
            {inp("New password", pw.next, v => setPw(p => ({ ...p, next: v })), "password")}
            {inp("Confirm new password", pw.confirm, v => setPw(p => ({ ...p, confirm: v })), "password")}
            <button className="tiq-btn tiq-btn-outline"
              onClick={() => {
                setPwErr(""); setPwOk(false);
                if (pw.next !== pw.confirm) { setPwErr("Passwords don't match"); return; }
                pwMut.mutate();
              }}
              disabled={!pw.old || !pw.next || pwMut.isPending}>
              {pwMut.isPending ? "Changing…" : "Change password"}
            </button>
          </div>
        </div>
      )}

      {/* ── API KEYS TAB ── */}
      {tab === "apikeys" && (
        <div style={{ maxWidth: 680 }}>
          {keyMsg && <div className="tiq-alert tiq-alert-success tiq-mb-4">{keyMsg}</div>}

          {/* LINKEDIN */}
          <div className="tiq-card tiq-mb-6">
            <div className="tiq-card-title">LinkedIn — Candidate Search</div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              Your LinkedIn login credentials. Used by LinkLens agent to search candidate profiles via Playwright browser automation.
            </p>
            {savedKeysBar("linkedin")}
            <div className="tiq-grid-2">
              {inp("LinkedIn Email", linkedin.email, v => setLinkedin(l => ({ ...l, email: v })), "email", "you@email.com")}
              {inp("LinkedIn Password", linkedin.password, v => setLinkedin(l => ({ ...l, password: v })), "password", "••••••••")}
            </div>
            <button className="tiq-btn tiq-btn-primary" onClick={() => saveKey("linkedin", linkedin)} disabled={savingService === "linkedin"}>
              {savingService === "linkedin" ? "Saving…" : "Save LinkedIn Credentials"}
            </button>
          </div>

          {/* Meeting Link — a personal default (each recruiter has their
              own recurring room), so unlike Apify/Calendly/etc. below,
              this belongs directly here for every user, not behind
              Admin Console. */}
          <MeetingLinkPanel />

          {/* Apify/Groq/Ollama/Calendly/NavTalk/MorphCast are now
              managed by admins from Admin Console → API Keys, not here
              (they're platform-shared or admin-private credentials, and
              every other user already inherits whatever's configured
              there — see utils/credentials.py SHAREABLE_SERVICES). This
              status readout is all non-admins see, and only if an admin
              has switched it on via Admin Console → Modules Management. */}
          {!isAdmin && showPlatformAiStatus ? (
            <div className="tiq-card tiq-mb-6">
              <div className="tiq-card-title">Platform AI & Search Services</div>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
                Apify, Groq, and Ollama are configured platform-wide by your administrator — every feature that
                uses them (resume summaries, JD skill extraction, interview questions, CVAnalysis scoring, job
                search, and more) automatically uses whatever is set up here, no action needed from you.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { key: "apify", label: "Apify (Seek job search)" },
                  { key: "groq", label: "Groq (AI / LLM)" },
                  { key: "ollama", label: "Ollama (local LLM fallback)" },
                ].map(({ key, label }) => {
                  // Groq alone has a second path to "configured": the
                  // Groq Key Pool, a separate table that GET /global-keys
                  // never sees (see authApi.groqPoolActive).
                  const configured = globalServiceSet.has(key) || (key === "groq" && !!groqPoolActive?.active);
                  return (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: configured ? "#10b981" : "#d1d5db",
                      flexShrink: 0,
                    }} />
                    <span>{label}</span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {configured ? "Configured" : "Not yet configured"}
                    </span>
                  </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* INTERVIEW SETTINGS — admin-only platform-wide controls for
              CandidateLens's phone/video interview experience: how long a
              candidate gets to answer each question, and which voice reads
              questions aloud (Microsoft Edge natural voice — default/first
              choice — or the browser's built-in — more mechanical —
              SpeechSynthesis voice). */}
          {isAdmin ? (
            <div className="tiq-card tiq-mb-6">
              <div className="tiq-card-title">Video Interview Settings</div>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
                Applies platform-wide to every Phone and Video Interview — for every recruiter and
                every candidate link.
              </p>
              <div className="tiq-grid-2">
                <div className="tiq-form-group">
                  <label className="tiq-label">Answer time per question (seconds)</label>
                  <input type="number" min={10} max={600} className="tiq-input"
                    value={interviewSettings.answer_seconds}
                    onChange={e => setInterviewSettings(s => ({ ...s, answer_seconds: e.target.value }))} />
                </div>
                <div className="tiq-form-group">
                  <label className="tiq-label">Question voice engine</label>
                  <select className="tiq-select" value={interviewSettings.tts_engine}
                    onChange={e => {
                      const engine = e.target.value;
                      const defaultVoice = engine === "edge" ? "en-US-JennyNeural" : "";
                      setInterviewSettings(s => ({ ...s, tts_engine: engine, tts_voice: defaultVoice }));
                    }}>
                    <option value="edge">Microsoft Edge — online natural voice (default, no setup, needs internet)</option>
                    <option value="browser">Browser default (built-in, more mechanical)</option>
                  </select>
                </div>
              </div>
              {interviewSettings.tts_engine === "edge" && (
                <div className="tiq-form-group">
                  <label className="tiq-label">Microsoft Edge voice</label>
                  <select className="tiq-select" value={interviewSettings.tts_voice}
                    onChange={e => setInterviewSettings(s => ({ ...s, tts_voice: e.target.value }))}>
                    {Object.entries(
                      Object.keys(edgeVoices).length ? edgeVoices : {
                        "en-US-JennyNeural": "Jenny (US English, female) — warm, default",
                        "en-US-AriaNeural": "Aria (US English, female)",
                        "en-US-GuyNeural": "Guy (US English, male)",
                        "en-US-DavisNeural": "Davis (US English, male)",
                        "en-GB-SoniaNeural": "Sonia (British English, female)",
                        "en-GB-RyanNeural": "Ryan (British English, male)",
                        "en-AU-NatashaNeural": "Natasha (Australian English, female)",
                        "en-IN-NeerjaNeural": "Neerja (Indian English, female)",
                      }
                    ).map(([id, label]) => <option key={id} value={id}>{label as string}</option>)}
                  </select>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                    Needs outbound internet access from the server to Microsoft's speech service — no model
                    download or extra setup otherwise.
                  </div>
                </div>
              )}
              <button className="tiq-btn tiq-btn-primary" onClick={saveInterviewSettings} disabled={savingInterview}>
                {savingInterview ? "Saving…" : "Save Interview Settings"}
              </button>
            </div>
          ) : null}

          {/* SMTP — this is what "Send Interview Invite" on the Video
              Interview screen actually sends through: the backend reads
              these credentials fresh, per-request, for whichever
              recruiter is logged in (never a shared/admin fallback), so
              whatever is saved here takes effect immediately on the very
              next invite send — no separate "activate" step. */}
          <div className="tiq-card tiq-mb-6">
            <div className="tiq-card-title">SMTP — Candidate Email Invites</div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              Used by CandidateLens to send video-interview invite emails to candidates.
              For Gmail, use an <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal-500)" }}>app password</a>, not your regular password.
            </p>

            {/* Always-visible status of what's currently saved for THIS
                user, so the section never just looks empty/unset after
                a page reload — the values themselves stay masked (same
                security model as every other credential in this app;
                see key_preview in list_api_keys). Same inline
                show/edit/delete bar every other service's card uses. */}
            {smtpSavedKeys.length > 0 ? (
              savedKeysBar("smtp")
            ) : (
              <div style={{
                fontSize: 12, marginBottom: 16, padding: "10px 12px", borderRadius: 8,
                background: "rgba(239,68,68,.06)", border: "1px solid rgba(239,68,68,.2)", color: "var(--text-muted)",
              }}>
                Not configured yet — invite sending will fail until all fields below are saved at least once.
              </div>
            )}

            <div className="tiq-grid-2">
              {inp("SMTP Host", smtp.host, v => setSmtp(s => ({ ...s, host: v })), "text", "e.g. smtp.gmail.com")}
              {inp("SMTP Port", smtp.port, v => setSmtp(s => ({ ...s, port: v })), "text", "587")}
              {inp("Username", smtp.username, v => setSmtp(s => ({ ...s, username: v })), "text", "you@company.com")}
              {inp("Password", smtp.password, v => setSmtp(s => ({ ...s, password: v })), "password", "••••••••")}
              {inp("From Email", smtp.from_email, v => setSmtp(s => ({ ...s, from_email: v })), "email", "recruiting@company.com")}
            </div>
            <button className="tiq-btn tiq-btn-primary" onClick={() => saveKey("smtp", smtp)} disabled={savingService === "smtp"}>
              {savingService === "smtp" ? "Saving…" : smtpSavedKeys.length > 0 ? "Update SMTP Settings" : "Save SMTP Settings"}
            </button>
          </div>

          {/* TELEPHONY — powers Phone Interview's "Call Candidate" (click-to-call)
              and "Text Call Time" (SMS scheduling) actions. Strictly private per
              user, same as SMTP above — never shared, never falls back to
              another user's or admin's credentials. */}
          <div className="tiq-card tiq-mb-6">
            <div className="tiq-card-title">Telephony — Click-to-Call &amp; SMS</div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              Powers Phone Interview's "Call Candidate" button (bridges your own phone to the candidate's — Twilio
              rings you first, then connects you through once you pick up) and "Text Call Time" (SMS scheduling).
              Get your Account SID, Auth Token, and a phone number from your{" "}
              <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal-500)" }}>Twilio Console</a>.
            </p>

            {telephonySavedKeys.length > 0 ? (
              savedKeysBar("telephony")
            ) : (
              <div style={{
                fontSize: 12, marginBottom: 16, padding: "10px 12px", borderRadius: 8,
                background: "rgba(239,68,68,.06)", border: "1px solid rgba(239,68,68,.2)", color: "var(--text-muted)",
              }}>
                Not configured yet — calling and texting will fail until all fields below are saved at least once.
              </div>
            )}

            <div className="tiq-grid-2">
              {inp("Account SID", telephony.account_sid, v => setTelephony(t => ({ ...t, account_sid: v })), "text", "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")}
              {inp("Auth Token", telephony.auth_token, v => setTelephony(t => ({ ...t, auth_token: v })), "password", "••••••••")}
              {inp("Caller Number", telephony.caller_number, v => setTelephony(t => ({ ...t, caller_number: v })), "text", "+15551234567")}
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: -6, marginBottom: 14 }}>
              Caller Number is your Twilio phone number, in E.164 format (e.g. +15551234567) — this is both the
              number that rings you for a click-to-call and the "From" number candidates see on texts.
            </p>
            <button className="tiq-btn tiq-btn-primary" onClick={() => saveKey("telephony", telephony)} disabled={savingService === "telephony"}>
              {savingService === "telephony" ? "Saving…" : telephonySavedKeys.length > 0 ? "Update Telephony Settings" : "Save Telephony Settings"}
            </button>
          </div>

          {/* PHONE CONNECTION — Windows/Android Caller. Alternative to
              Twilio above: dials out on the recruiter's own Android SIM by
              driving the phone over ADB from a small Node app running on
              their own Windows laptop. Two ways that app can reach
              TalentIQ — see windows-android-caller/README.md for the
              full comparison:
                - Relay (recommended): the laptop app connects OUT to
                  this backend over a WebSocket (npm run start:agent) —
                  works from any device signed into TalentIQ, no
                  CORS/mixed-content concerns.
                - Direct: this browser tab calls a local HTTP server on
                  that same laptop (npm start) — simpler, but only works
                  from a browser open on that exact machine. */}
          <div className="tiq-card tiq-mb-6">
            <div className="tiq-card-title">Phone Connection — Windows/Android Caller</div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              An alternative to Telephony above for "Call Candidate": instead of Twilio, this drives{" "}
              <strong>your own Android phone's dialer</strong> over ADB from a small app running on your Windows
              laptop — a real call on your own SIM, free, but only while that laptop app is running and the phone
              is paired over Wi-Fi. See the app's README for one-time phone/laptop setup.
            </p>

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 14, cursor: "pointer" }}>
              <input type="checkbox" checked={androidCallerEnabled}
                onChange={e => setAndroidCallerEnabled(e.target.checked)} />
              Use my Windows/Android caller for "Call Candidate" instead of Twilio
            </label>

            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {([
                { id: "relay" as const, label: "Relay mode (recommended)" },
                { id: "direct" as const, label: "Direct mode" },
              ]).map(m => (
                <button key={m.id} type="button" onClick={() => setAndroidCallerMode(m.id)}
                  style={{
                    padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
                    border: androidCallerMode === m.id ? "1.5px solid var(--violet-500)" : "1px solid var(--border)",
                    color: androidCallerMode === m.id ? "var(--violet-500)" : "var(--text-muted)",
                    background: androidCallerMode === m.id ? "rgba(139,92,246,.08)" : "transparent",
                  }}>
                  {m.label}
                </button>
              ))}
            </div>

            {androidCallerSavedKeys.length > 0 && savedKeysBar("android_caller")}

            {androidCallerMode === "relay" ? (
              <>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.6 }}>
                  The laptop app (<code>npm run start:agent</code>) connects <strong>out</strong> to TalentIQ, so it works from
                  any device you sign into TalentIQ from — not just that laptop's own browser. Paste these two
                  values into that app's <code>server/.env</code>:
                </p>
                <div className="tiq-form-group">
                  <label className="tiq-label">Server URL (SERVER_URL)</label>
                  <input className="tiq-input" readOnly value={relayServerUrl}
                    onFocus={e => e.target.select()} style={{ fontFamily: "monospace", fontSize: 12 }} />
                </div>
                <div className="tiq-form-group">
                  <label className="tiq-label">Agent Token (AGENT_TOKEN)</label>
                  {freshAgentToken ? (
                    <input className="tiq-input" readOnly value={freshAgentToken}
                      onFocus={e => e.target.select()} style={{ fontFamily: "monospace", fontSize: 12 }} />
                  ) : (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {savedAgentTokenKey ? "Already generated — shown only once, when created. Generate a new one below to replace it." : "Not generated yet."}
                    </div>
                  )}
                </div>
                {tokenGenError && <div style={{ fontSize: 11.5, color: "var(--rose-500)", marginBottom: 8 }}>{tokenGenError}</div>}
                <button type="button" className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={generateAgentToken} disabled={generatingToken} style={{ marginBottom: 16 }}>
                  {generatingToken ? "Generating…" : savedAgentTokenKey ? "Generate new token (invalidates the old one)" : "Generate token"}
                </button>

                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <button type="button" className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={checkRelayStatus} disabled={relayStatusChecking}>
                    {relayStatusChecking ? "Checking…" : "Check connection"}
                  </button>
                  {relayStatus && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: !relayStatus.agentConnected ? "var(--rose-500)" : relayStatus.deviceConnected ? "#10b981" : "#f59e0b" }}>
                      {!relayStatus.agentConnected
                        ? "Agent not connected — is the agent (npm run start:agent) running on your laptop?"
                        : relayStatus.deviceConnected
                        ? "Agent connected — phone connected"
                        : relayStatus.needsAuthorization
                        ? "Agent connected — phone detected but not authorized"
                        : "Agent connected — no phone connected yet"}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="tiq-grid-2">
                  {inp("Local API Base URL", androidCaller.api_base, v => setAndroidCaller({ api_base: v }), "text", "http://127.0.0.1:4000")}
                </div>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: -6, marginBottom: 14 }}>
                  Default port is 4000 (set by <code>server/.env</code> in the Windows/Android Caller app, run via
                  <code>npm start</code> in its <code>server/</code> folder). Leave as localhost unless you changed
                  <code>PORT</code> there. Only works from a browser open on that same laptop.
                </p>

                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                  <button type="button" className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => checkAndroidHealth(androidApiBase())} disabled={androidHealthChecking}>
                    {androidHealthChecking ? "Checking…" : "Check connection"}
                  </button>
                  {androidHealth && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: !androidHealth.reachable ? "var(--rose-500)" : androidHealth.deviceConnected ? "#10b981" : "#f59e0b" }}>
                      {!androidHealth.reachable
                        ? "Local API unreachable — is the Local API (npm start in server/) running on this laptop?"
                        : androidHealth.deviceConnected
                        ? "Phone connected"
                        : androidHealth.needsAuthorization
                        ? "Phone detected but not authorized — accept the prompt on the phone"
                        : "Local API is running, but no phone connected yet"}
                    </span>
                  )}
                </div>
              </>
            )}

            <button className="tiq-btn tiq-btn-primary" style={{ marginBottom: 18 }}
              onClick={() => saveKey("android_caller", { api_base: androidCaller.api_base, enabled: String(androidCallerEnabled), mode: androidCallerMode })}
              disabled={savingService === "android_caller"}>
              {savingService === "android_caller" ? "Saving…" : androidCallerSavedKeys.length > 0 ? "Update Phone Connection Settings" : "Save Phone Connection Settings"}
            </button>

            <details>
              <summary style={{ fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: "var(--text-secondary)" }}>
                Pair or connect a phone (one-time / per Wi-Fi session)
              </summary>
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>1. Pair (Android 11+, one time per phone)</div>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
                  On the phone: Settings → Developer options → Wireless debugging → Pair device with pairing code —
                  copy the IP, port, and 6-digit code shown there into here.
                </p>
                <div className="tiq-grid-2">
                  {inp("Phone IP", pairIp, setPairIp, "text", "192.168.1.42")}
                  {inp("Pairing port", pairPort, setPairPort, "text", "37251")}
                </div>
                {inp("Pairing code", pairCode, setPairCode, "text", "123456")}
                {pairMsg && <div style={{ fontSize: 11.5, color: pairMsg.ok ? "#10b981" : "var(--rose-500)", marginBottom: 8 }}>{pairMsg.text}</div>}
                <button type="button" className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={runAndroidPair} disabled={pairBusy} style={{ marginBottom: 16 }}>
                  {pairBusy ? "Pairing…" : "Pair device"}
                </button>

                <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>2. Connect</div>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
                  Back on the phone's main Wireless debugging screen (not the pairing dialog) — it shows a{" "}
                  <em>different</em> IP:port. Enter that here. Older Android: run <code>adb tcpip 5555</code> over
                  USB once and use port 5555.
                </p>
                <div className="tiq-grid-2">
                  {inp("Phone IP", connectIp, setConnectIp, "text", "192.168.1.42")}
                  {inp("Connect port", connectPort, setConnectPort, "text", "5555")}
                </div>
                {connectMsg && <div style={{ fontSize: 11.5, color: connectMsg.ok ? "#10b981" : "var(--rose-500)", marginBottom: 8 }}>{connectMsg.text}</div>}
                <button type="button" className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={runAndroidConnect} disabled={connectBusy}>
                  {connectBusy ? "Connecting…" : "Connect"}
                </button>
              </div>
            </details>
          </div>

          {/* SAVED KEYS LIST — only services with no dedicated card above
              (e.g. infra credentials not surfaced as their own settings
              window in this UI). Everything else is now managed inline,
              at the top of its own card, via savedKeysBar(). */}
          <div className="tiq-card">
            <div className="tiq-card-title">Other saved keys</div>
            {otherSavedKeys.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                Nothing here — every saved key belongs to a service with its own settings card above.
              </div>
            ) : (
              <div className="tiq-table-wrap">
                <DataTable
                  columns={["service", "key_name", "key_preview", "created_at"]}
                  columnLabels={{ service: "Service", key_name: "Key", key_preview: "Value", created_at: "Saved" }}
                  rows={otherSavedKeys}
                  getRowKey={(k: any) => k.id}
                  actionsLabel=""
                  actionsWidth={70}
                  renderActions={(k: any) => (
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Edit — enter a new value to replace this key"
                        onClick={() => editingKeyId === k.id ? cancelEdit() : startEdit(k)}>
                        <Pencil size={13} />
                      </button>
                      <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" style={{ color: "var(--rose-500)" }}
                        onClick={() => deleteKeyMut.mutate(k.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                  renderCell={(k: any, col: string) => {
                    switch (col) {
                      case "service": return <span className="tiq-badge tiq-badge-slate">{k.service}</span>;
                      case "key_name": return <span style={{ fontFamily: "monospace", fontSize: 12 }}>{k.key_name}</span>;
                      case "key_preview": return <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{k.key_preview || "—"}</span>;
                      case "created_at": return <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{new Date(k.created_at).toLocaleDateString()}</span>;
                      default: return null;
                    }
                  }}
                />
                {editingKeyId && (() => {
                  const k = otherSavedKeys.find((x: any) => x.id === editingKeyId);
                  if (!k) return null;
                  return (
                    <div style={{ background: "var(--bg-secondary)", padding: "10px 14px", marginTop: 8, borderRadius: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                          New value for {k.service} / {k.key_name}:
                        </span>
                        <input
                          type={k.key_name.toLowerCase().includes("password") || k.key_name.toLowerCase().includes("key") ? "password" : "text"}
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") saveEdit(k); if (e.key === "Escape") cancelEdit(); }}
                          placeholder="Enter the new value — current value is never shown, for security"
                          autoFocus
                          style={{ flex: 1, padding: "6px 10px", fontSize: 12.5, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
                        />
                        <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={() => saveEdit(k)} disabled={editSaving}>
                          {editSaving ? "Saving…" : "Save"}
                        </button>
                        <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={cancelEdit} disabled={editSaving}>
                          Cancel
                        </button>
                      </div>
                      {editError && <div style={{ fontSize: 11.5, color: "var(--rose-500)", marginTop: 6 }}>{editError}</div>}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ADMIN TAB ── */}
      {tab === "admin" && user?.role === "admin" && (
        <div>
          <div className="tiq-card">
            <div className="tiq-card-title">All users ({users.length})</div>
            <div className="tiq-table-wrap">
              <DataTable
                columns={["idx", "name", "email", "role", "company", "is_active", "last_login"]}
                columnLabels={{ idx: "#", name: "Name", email: "Email (User ID)", role: "Role", company: "Company", is_active: "Status", last_login: "Last login" }}
                rows={users.map((u: any, i: number) => ({ ...u, idx: i + 1 }))}
                getRowKey={(u: any) => u.id}
                actionsLabel=""
                actionsWidth={100}
                renderActions={(u: any) => (
                  u.id !== user.id && u.is_active ? (
                    <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" style={{ color: "var(--rose-500)", fontSize: 11 }}
                      onClick={() => deactivateMut.mutate(u.id)}>Deactivate</button>
                  ) : null
                )}
                renderCell={(u: any, col: string) => {
                  switch (col) {
                    case "idx": return <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{u.idx}</span>;
                    case "name": return <span style={{ fontWeight: 600 }}>{u.name}</span>;
                    case "email": return <span style={{ fontSize: 13 }}>{u.email}</span>;
                    case "role": return <span className={`tiq-badge ${u.role === "admin" ? "tiq-badge-violet" : "tiq-badge-slate"}`}>{u.role}</span>;
                    case "company": return <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{u.company || "—"}</span>;
                    case "is_active": return <span className={`tiq-badge ${u.is_active ? "tiq-badge-teal" : "tiq-badge-rose"}`}>{u.is_active ? "Active" : "Inactive"}</span>;
                    case "last_login": return <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{u.last_login ? new Date(u.last_login).toLocaleDateString() : "Never"}</span>;
                    default: return null;
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}