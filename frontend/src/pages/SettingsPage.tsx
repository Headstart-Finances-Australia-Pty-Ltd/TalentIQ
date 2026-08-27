import { useNavigate } from "react-router-dom";
import { useState, useEffect, useRef, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings, Key, User, Shield, Trash2, Pencil, Home} from "lucide-react";
import { authApi, groqPoolApi, interviewApi, candidateLensSettingsApi } from "../lib/api";
import { useAuth } from "../hooks/useAuth";

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

  // Each service stores its fields independently
  const [adzuna, setAdzuna] = useState({ app_id: "", app_key: "" });
  const [groq, setGroq] = useState({ api_key: "", model: "" });
  const [linkedin, setLinkedin] = useState({ email: "", password: "" });
  const [calendly, setCalendly] = useState({ api_key: "", event_type_uri: "" });
  const [navtalk, setNavtalk] = useState({ api_key: "", avatar_persona_id: "" });
  const [calendlyEventTypes, setCalendlyEventTypes] = useState<any[] | null>(null);
  const [fetchingCalendlyTypes, setFetchingCalendlyTypes] = useState(false);
  const [calendlyFetchError, setCalendlyFetchError] = useState("");
  const [smtp, setSmtp] = useState({ host: "", port: "587", username: "", password: "", from_email: "" });
  const [ollama, setOllama] = useState({ base_url: "http://localhost:11434", model: "llama3" });
  const [morphcast, setMorphcast] = useState({ license_key: "" });
  const [interviewSettings, setInterviewSettings] = useState({ answer_seconds: "30", tts_voice: "af_heart", tts_engine: "kokoro" });
  const [keyMsg, setKeyMsg] = useState("");

  // ── Interview Settings (Admin Console) — answer time + TTS voice ────
  const { data: liveInterviewSettings } = useQuery({
    queryKey: ["interview-settings"], queryFn: candidateLensSettingsApi.get,
  });
  const [kokoroVoices, setKokoroVoices] = useState<Record<string, string>>({});
  const [edgeVoices, setEdgeVoices] = useState<Record<string, string>>({});
  const [kokoroError, setKokoroError] = useState<string | null>(null);
  const [interviewSettingsLoaded, setInterviewSettingsLoaded] = useState(false);
  useEffect(() => {
    if (liveInterviewSettings && !interviewSettingsLoaded) {
      setInterviewSettings({
        answer_seconds: String(liveInterviewSettings.answer_seconds ?? 30),
        tts_voice: liveInterviewSettings.tts_voice || "af_heart",
        tts_engine: liveInterviewSettings.tts_engine || "kokoro",
      });
      setKokoroVoices(liveInterviewSettings.kokoro_voices || {});
      setEdgeVoices(liveInterviewSettings.edge_voices || {});
      setKokoroError(liveInterviewSettings.kokoro_error || null);
      setInterviewSettingsLoaded(true);
    }
  }, [liveInterviewSettings, interviewSettingsLoaded]);

  const flashMsg = (m: string) => { setKeyMsg(m); setTimeout(() => setKeyMsg(""), 3000); };

  const [savingService, setSavingService] = useState("");
  const isAdmin = user?.role === "admin";
  const { data: globalKeys = [] } = useQuery({ queryKey: ["global-keys"], queryFn: authApi.listGlobalKeys });
  const globalServiceSet = new Set(globalKeys.map((k: any) => k.service));
  const SHAREABLE = ["groq", "ollama", "adzuna"];
  const [globalToggle, setGlobalToggle] = useState<Record<string, boolean>>({});

  // ── GROQ KEY POOL (admin only) ───────────────────────────────────
  const { data: poolKeys = [], refetch: refetchPool } = useQuery({
    queryKey: ["groq-pool"], queryFn: groqPoolApi.list, enabled: isAdmin,
  });
  const [newPoolKey, setNewPoolKey] = useState({ key_value: "", model: "" });
  // Pulled live from Groq's own API using the key just typed in, rather
  // than a hardcoded list — a fixed list is exactly the kind of thing
  // that goes stale the moment Groq adds or retires a model (hit this
  // directly, twice, earlier this session).
  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsFetchError, setModelsFetchError] = useState("");
  const fetchModelsForKey = async (keyOverride?: string) => {
    const key = (keyOverride ?? newPoolKey.key_value).trim();
    if (!key) { setModelsFetchError("Enter the API key above first."); return; }
    setFetchingModels(true); setModelsFetchError(""); setFetchedModels(null);
    try {
      const res = await groqPoolApi.listModels(key);
      setFetchedModels(res.models || []);
    } catch (e: any) {
      setModelsFetchError(e.response?.data?.detail || "Could not fetch models for this key.");
    } finally {
      setFetchingModels(false);
    }
  };
  // Fetches models for an ALREADY-SAVED pool key using its stored value
  // server-side — the value itself is never sent to or requested from
  // the browser, so "just change the model" never requires re-entering
  // or knowing the existing key.
  const fetchModelsForExistingPoolKey = async (poolId: number) => {
    setFetchingModels(true); setModelsFetchError(""); setFetchedModels(null);
    try {
      const res = await groqPoolApi.listModelsForExisting(poolId);
      setFetchedModels(res.models || []);
    } catch (e: any) {
      setModelsFetchError(e.response?.data?.detail || "Could not fetch models for this key.");
    } finally {
      setFetchingModels(false);
    }
  };
  // Auto-fetches shortly after the user stops typing/pasting a
  // plausible-looking key — no extra click needed, models just show up
  // the way they would if you were looking at Groq's own console. The
  // manual button stays as a fallback (e.g. to retry after a transient
  // network error) but isn't the primary path anymore.
  const autoFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (autoFetchTimer.current) clearTimeout(autoFetchTimer.current);
    const key = newPoolKey.key_value.trim();
    if (key.length < 20) return; // too short to plausibly be a real key yet
    autoFetchTimer.current = setTimeout(() => { fetchModelsForKey(key); }, 600);
    return () => { if (autoFetchTimer.current) clearTimeout(autoFetchTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newPoolKey.key_value]);
  const [poolMsg, setPoolMsg] = useState("");
  const flashPool = (m: string) => { setPoolMsg(m); setTimeout(() => setPoolMsg(""), 3000); };

  const addPoolMut = useMutation({
    mutationFn: () => groqPoolApi.add({ key_value: newPoolKey.key_value.trim(), model: newPoolKey.model.trim() || undefined }),
    onSuccess: () => { refetchPool(); setNewPoolKey({ key_value: "", model: "" }); setFetchedModels(null); setModelsFetchError(""); flashPool("Key added to pool."); },
    onError: (e: any) => flashPool(`❌ ${e.response?.data?.detail || "Failed to add key"}`),
  });
  const togglePoolMut = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) => groqPoolApi.update(id, { is_active }),
    onSuccess: () => refetchPool(),
    onError: (e: any) => flashPool(`❌ ${e.response?.data?.detail || "Failed to update key"}`),
  });
  const removePoolMut = useMutation({
    mutationFn: (id: number) => groqPoolApi.remove(id),
    onSuccess: () => { refetchPool(); flashPool("Key removed from pool."); },
    onError: (e: any) => flashPool(`❌ ${e.response?.data?.detail || "Failed to remove key"}`),
  });

  // ── Inline editing for an existing pool key ─────────────────────────
  // Lets an admin change the model and/or replace the key value on an
  // existing pool entry, instead of only being able to Disable/Remove it
  // and add a brand new one. The key value field starts blank (the real
  // value is never returned by the API) — leaving it blank keeps the
  // current key and only updates the model.
  const [editingPoolId, setEditingPoolId] = useState<number | null>(null);
  const [editPoolModel, setEditPoolModel] = useState("");
  const [editPoolKeyValue, setEditPoolKeyValue] = useState("");
  const startPoolEdit = (k: any) => {
    setEditingPoolId(k.id); setEditPoolModel(k.model || ""); setEditPoolKeyValue("");
    setFetchedModels(null); setModelsFetchError("");
  };
  const cancelPoolEdit = () => {
    setEditingPoolId(null); setEditPoolModel(""); setEditPoolKeyValue("");
    setFetchedModels(null); setModelsFetchError("");
  };
  const editPoolMut = useMutation({
    mutationFn: ({ id, model, key_value }: { id: number; model?: string; key_value?: string }) =>
      groqPoolApi.update(id, { model, ...(key_value ? { key_value } : {}) }),
    onSuccess: () => { refetchPool(); flashPool("Pool key updated."); cancelPoolEdit(); },
    onError: (e: any) => flashPool(`❌ ${e.response?.data?.detail || "Failed to update key"}`),
  });

  const saveKey = async (service: string, fields: Record<string, string>) => {
    const entries = Object.entries(fields).filter(([, v]) => v.trim() !== "");
    if (entries.length === 0) { flashMsg("Enter at least one value to save."); return; }
    setSavingService(service);
    const isGlobal = isAdmin && SHAREABLE.includes(service) && !!globalToggle[service];
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

  const globalCheckbox = (service: string) => isAdmin && (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", margin: "8px 0" }}>
      <input type="checkbox" checked={!!globalToggle[service]}
        onChange={e => setGlobalToggle(g => ({ ...g, [service]: e.target.checked }))} />
      Make this available to all users (admin only — Groq/Ollama/Adzuna can be shared platform-wide)
    </label>
  );

  const fetchCalendlyEventTypes = async () => {
    setFetchingCalendlyTypes(true);
    setCalendlyFetchError("");
    try {
      // Uses whatever token is CURRENTLY SAVED on the server, so save the
      // token first if it hasn't been saved yet this session.
      if (calendly.api_key.trim()) {
        await authApi.saveApiKey({ service: "calendly", key_name: "api_key", key_value: calendly.api_key.trim(), is_global: false });
        qc.invalidateQueries({ queryKey: ["api-keys"] });
      }
      const types = await interviewApi.calendlyEventTypes();
      setCalendlyEventTypes(types);
      if (types.length === 0) setCalendlyFetchError("No active event types found on this Calendly account.");
    } catch (e: any) {
      setCalendlyFetchError(e?.response?.data?.detail || "Could not fetch event types — check your Personal Access Token.");
      setCalendlyEventTypes(null);
    } finally {
      setFetchingCalendlyTypes(false);
    }
  };

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

          {/* ADZUNA / GROQ / OLLAMA — admin-managed only. These three are
              platform-shared credentials (see utils/credentials.py
              SHAREABLE_SERVICES); every user already inherits whatever the
              admin configures here, so only admins get the editable form —
              everyone else sees a simple status readout instead. */}
          {isAdmin ? (
            <div className="tiq-card tiq-mb-6">
              <div className="tiq-card-title">Adzuna — Job Search API</div>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
                Free at <a href="https://developer.adzuna.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal-500)" }}>developer.adzuna.com</a>. Needed for JobHunt and JobIntel agents.
              </p>
              <div className="tiq-grid-2">
                {inp("App ID", adzuna.app_id, v => setAdzuna(a => ({ ...a, app_id: v })), "text", "e.g. 638c0962")}
                {inp("App Key", adzuna.app_key, v => setAdzuna(a => ({ ...a, app_key: v })), "password", "e.g. 04681adc…")}
              </div>
              {globalCheckbox("adzuna")}
              <button className="tiq-btn tiq-btn-primary" onClick={() => saveKey("adzuna", adzuna)} disabled={savingService === "adzuna"}>
                {savingService === "adzuna" ? "Saving…" : "Save Adzuna Keys"}
              </button>
            </div>
          ) : null}

          {isAdmin ? (
            <div className="tiq-card tiq-mb-6">
              <div className="tiq-card-title">Groq Key Pool — scale capacity automatically</div>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
                Add multiple Groq keys here (from separate Groq accounts if you want real added
                throughput — Groq's rate limits apply per account, not per key). The platform
                automatically spreads load across whichever keys are healthy, and routes around
                any that are temporarily rate-limited, recovering them automatically once they
                cool down.
              </p>

              {poolMsg && (
                <div style={{ fontSize: 12, marginBottom: 12, padding: "8px 12px", borderRadius: 6,
                  background: poolMsg.startsWith("❌") ? "rgba(239,68,68,.08)" : "rgba(20,184,166,.08)",
                  color: poolMsg.startsWith("❌") ? "#ef4444" : "var(--teal-500)" }}>
                  {poolMsg}
                </div>
              )}

              {poolKeys.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
                    Keys in pool ({poolKeys.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {(() => {
                      // Numbered by chronological addition order (oldest = #1),
                      // not by current display position — the list itself
                      // shows newest-first, but "key #1" should always mean
                      // "the first one I added", not shift around based on
                      // display order.
                      const byAddedAsc = [...poolKeys].sort((a: any, b: any) =>
                        new Date(a.added_at || 0).getTime() - new Date(b.added_at || 0).getTime()
                      );
                      const numberOf = new Map(byAddedAsc.map((k: any, i: number) => [k.id, i + 1]));
                      return poolKeys.map((k: any) => (
                      <div key={k.id}>
                      <div style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                        border: "1px solid var(--border)", borderRadius: 8,
                        opacity: k.is_active ? 1 : 0.5,
                      }}>
                        <span style={{
                          display: "flex", alignItems: "center", justifyContent: "center",
                          width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                          background: "var(--surface-2, rgba(0,0,0,.06))", fontSize: 11, fontWeight: 700,
                          color: "var(--text-muted)",
                        }}>
                          {numberOf.get(k.id)}
                        </span>
                        <span style={{ fontFamily: "monospace", fontSize: 13 }}>{k.key_preview}</span>
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{k.model || "platform default"}</span>
                        {k.cooldown_until && new Date(k.cooldown_until) > new Date() && (
                          <span style={{ fontSize: 11, color: "#f59e0b" }}>⏳ cooling down</span>
                        )}
                        {!k.is_active && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>disabled</span>}
                        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                          <button
                            className="tiq-btn tiq-btn-sm"
                            onClick={() => editingPoolId === k.id ? cancelPoolEdit() : startPoolEdit(k)}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            className="tiq-btn tiq-btn-sm"
                            onClick={() => togglePoolMut.mutate({ id: k.id, is_active: !k.is_active })}
                          >
                            {k.is_active ? "Disable" : "Enable"}
                          </button>
                          <button
                            className="tiq-btn tiq-btn-sm"
                            style={{ color: "#ef4444" }}
                            onClick={() => { if (confirm("Remove this key from the pool?")) removePoolMut.mutate(k.id); }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                      {editingPoolId === k.id && (
                        <div style={{
                          display: "flex", flexDirection: "column", gap: 8, padding: "10px 14px",
                          background: "var(--bg-secondary)", border: "1px solid var(--border)", borderTop: "none",
                          borderRadius: "0 0 8px 8px", marginTop: -1,
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap", width: 90 }}>Replace key:</span>
                            <input
                              type="password"
                              value={editPoolKeyValue}
                              onChange={e => setEditPoolKeyValue(e.target.value)}
                              placeholder="leave blank to keep the current key, only change the model"
                              style={{ flex: 1, padding: "6px 10px", fontSize: 12.5, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
                            />
                            <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ whiteSpace: "nowrap" }}
                              onClick={() => editPoolKeyValue.trim() ? fetchModelsForKey(editPoolKeyValue.trim()) : fetchModelsForExistingPoolKey(k.id)}
                              disabled={fetchingModels}>
                              {fetchingModels ? "Fetching…" : (fetchedModels ? "Refetch" : "Fetch now")}
                            </button>
                          </div>
                          <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: -2 }}>
                            Leave "Replace key" blank and click Fetch now to pull the live model list using THIS key's
                            already-stored value (never sent to your browser) — or type a new value above first to
                            fetch models for that key instead.
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap", width: 90 }}>Model:</span>
                            {fetchedModels ? (
                              <select
                                value={editPoolModel}
                                onChange={e => setEditPoolModel(e.target.value)}
                                style={{ flex: 1, padding: "6px 10px", fontSize: 12.5, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
                              >
                                <option value="">Platform default</option>
                                {fetchedModels.map(m => <option key={m} value={m}>{m}</option>)}
                              </select>
                            ) : (
                              <input
                                value={editPoolModel}
                                onChange={e => setEditPoolModel(e.target.value)}
                                placeholder="leave blank for platform default, or fetch models above to pick from a live list"
                                style={{ flex: 1, padding: "6px 10px", fontSize: 12.5, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
                              />
                            )}
                          </div>
                          {modelsFetchError && <div style={{ fontSize: 11.5, color: "#ef4444" }}>{modelsFetchError}</div>}
                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={cancelPoolEdit} disabled={editPoolMut.isPending}>
                              Cancel
                            </button>
                            <button className="tiq-btn tiq-btn-primary tiq-btn-sm"
                              onClick={() => editPoolMut.mutate({ id: k.id, model: editPoolModel.trim(), key_value: editPoolKeyValue.trim() || undefined })}
                              disabled={editPoolMut.isPending}>
                              {editPoolMut.isPending ? "Saving…" : "Save"}
                            </button>
                          </div>
                        </div>
                      )}
                      </div>
                      ));
                    })()}
                  </div>
                </div>
              )}

              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>
                  Add a new key — will become Key #{poolKeys.length + 1}
                </div>

                {inp("API Key", newPoolKey.key_value, v => { setNewPoolKey(k => ({ ...k, key_value: v })); setFetchedModels(null); setModelsFetchError(""); }, "password", "gsk_…")}

                <div style={{ marginBottom: 4, display: "flex", alignItems: "center", gap: 10 }}>
                  {fetchingModels && (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Checking with Groq…</span>
                  )}
                  {!fetchingModels && fetchedModels && (
                    <span style={{ fontSize: 12, color: "var(--teal-500)" }}>✓ {fetchedModels.length} models available for this key</span>
                  )}
                  {!fetchingModels && !fetchedModels && !modelsFetchError && newPoolKey.key_value.trim().length > 0 && (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Models will load automatically once the key looks complete…</span>
                  )}
                  <button
                    type="button"
                    className="tiq-btn tiq-btn-sm"
                    onClick={() => fetchModelsForKey()}
                    disabled={fetchingModels || !newPoolKey.key_value.trim()}
                  >
                    {fetchedModels ? "Refetch" : "Fetch now"}
                  </button>
                  {modelsFetchError && <span style={{ fontSize: 12, color: "#ef4444" }}>{modelsFetchError}</span>}
                </div>

                <div style={{ marginTop: 12, marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Model</label>
                  {fetchedModels ? (
                    <select
                      value={newPoolKey.model}
                      onChange={e => setNewPoolKey(k => ({ ...k, model: e.target.value }))}
                      className="tiq-input"
                      style={{ width: "100%" }}
                    >
                      <option value="">Platform default</option>
                      {fetchedModels.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  ) : (
                    <>
                      {inp("", newPoolKey.model, v => setNewPoolKey(k => ({ ...k, model: v })), "text", "leave blank for platform default, or fetch models above to pick from a live list")}
                    </>
                  )}
                </div>

                <button
                  className="tiq-btn tiq-btn-primary"
                  onClick={() => addPoolMut.mutate()}
                  disabled={addPoolMut.isPending || !newPoolKey.key_value.trim()}
                >
                  {addPoolMut.isPending ? "Adding…" : `Add as Key #${poolKeys.length + 1}`}
                </button>
              </div>
            </div>
          ) : null}

          {/* LINKEDIN */}
          <div className="tiq-card tiq-mb-6">
            <div className="tiq-card-title">LinkedIn — Candidate Search</div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              Your LinkedIn login credentials. Used by LinkLens agent to search candidate profiles via Playwright browser automation.
            </p>
            <div className="tiq-grid-2">
              {inp("LinkedIn Email", linkedin.email, v => setLinkedin(l => ({ ...l, email: v })), "email", "you@email.com")}
              {inp("LinkedIn Password", linkedin.password, v => setLinkedin(l => ({ ...l, password: v })), "password", "••••••••")}
            </div>
            <button className="tiq-btn tiq-btn-primary" onClick={() => saveKey("linkedin", linkedin)} disabled={savingService === "linkedin"}>
              {savingService === "linkedin" ? "Saving…" : "Save LinkedIn Credentials"}
            </button>
          </div>

          {/* CALENDLY */}
          <div className="tiq-card tiq-mb-6">
            <div className="tiq-card-title">Calendly — Interview Scheduling</div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
              Lets Interviews generate a single-use Calendly scheduling link for a candidate instead of
              TalentIQ's own link-based flow — Calendly handles the actual time-slot picking and calendar conflicts.
            </p>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              Get your Personal Access Token from{" "}
              <a href="https://calendly.com/integrations/api_webhooks" target="_blank" rel="noreferrer" style={{ color: "var(--brand-teal, #0d9488)" }}>
                Calendly → Integrations → API & Webhooks
              </a>. This is a private credential — only you can use it, same as your LinkedIn login above.
            </p>
            <div className="tiq-grid-2">
              {inp("Personal Access Token", calendly.api_key, v => setCalendly(c => ({ ...c, api_key: v })), "password", "eyJraWQiOi...")}
              <div className="tiq-form-group">
                <label className="tiq-label">Event Type</label>
                {calendlyEventTypes ? (
                  <select className="tiq-select" value={calendly.event_type_uri}
                          onChange={e => setCalendly(c => ({ ...c, event_type_uri: e.target.value }))}>
                    <option value="">— Select an event type —</option>
                    {calendlyEventTypes.map((et: any) => (
                      <option key={et.uri} value={et.uri}>{et.name} ({et.duration} min)</option>
                    ))}
                  </select>
                ) : (
                  <input className="tiq-input" value={calendly.event_type_uri}
                         onChange={e => setCalendly(c => ({ ...c, event_type_uri: e.target.value }))}
                         placeholder="Click 'Fetch My Event Types' or paste an event type URI" />
                )}
              </div>
            </div>
            {calendlyFetchError && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 10, fontSize: 12 }}>{calendlyFetchError}</div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="tiq-btn tiq-btn-outline" onClick={fetchCalendlyEventTypes} disabled={fetchingCalendlyTypes || !calendly.api_key.trim()}>
                {fetchingCalendlyTypes ? "Fetching…" : "Fetch My Event Types"}
              </button>
              <button className="tiq-btn tiq-btn-primary" onClick={() => saveKey("calendly", calendly)} disabled={savingService === "calendly"}>
                {savingService === "calendly" ? "Saving…" : "Save Calendly Credentials"}
              </button>
            </div>
          </div>

          {/* NAVTALK */}
          <div className="tiq-card tiq-mb-6">
            <div className="tiq-card-title">NavTalk — AI Avatar Interviews</div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
              Powers "Video Interview (AI Avatar)" rounds in Interviews — a NavTalk avatar asks each candidate their
              personalized questions, and their spoken answers are transcribed and evaluated automatically.
            </p>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              Get your API key and avatar persona ID from your NavTalk.ai dashboard. This is a private credential —
              only you can use it, same as your LinkedIn login above.
            </p>
            <div className="tiq-grid-2">
              {inp("API Key", navtalk.api_key, v => setNavtalk(n => ({ ...n, api_key: v })), "password", "nvtk_...")}
              {inp("Avatar Persona ID", navtalk.avatar_persona_id, v => setNavtalk(n => ({ ...n, avatar_persona_id: v })), "text", "e.g. persona_abc123")}
            </div>
            <button className="tiq-btn tiq-btn-primary" onClick={() => saveKey("navtalk", navtalk)} disabled={savingService === "navtalk"}>
              {savingService === "navtalk" ? "Saving…" : "Save NavTalk Credentials"}
            </button>
          </div>

          {isAdmin ? (
            <div className="tiq-card tiq-mb-6">
              <div className="tiq-card-title">Ollama — Local/Self-Hosted LLM</div>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
                Used as a fallback for JD Creator when no Groq key is set. Requires{" "}
                <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal-500)" }}>Ollama</a>{" "}
                running locally (or reachable at the URL below) with a model pulled, e.g. <code>ollama pull llama3</code>.
              </p>
              <div className="tiq-grid-2">
                {inp("Base URL", ollama.base_url, v => setOllama(o => ({ ...o, base_url: v })), "text", "http://localhost:11434")}
                {inp("Model", ollama.model, v => setOllama(o => ({ ...o, model: v })), "text", "llama3")}
              </div>
              {globalCheckbox("ollama")}
              <button className="tiq-btn tiq-btn-primary" onClick={() => saveKey("ollama", ollama)} disabled={savingService === "ollama"}>
                {savingService === "ollama" ? "Saving…" : "Save Ollama Settings"}
              </button>
            </div>
          ) : (
            <div className="tiq-card tiq-mb-6">
              <div className="tiq-card-title">Platform AI & Search Services</div>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
                Adzuna, Groq, and Ollama are configured platform-wide by your administrator — every feature that
                uses them (resume summaries, JD skill extraction, interview questions, CVAnalysis scoring, job
                search, and more) automatically uses whatever is set up here, no action needed from you.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { key: "adzuna", label: "Adzuna (job search)" },
                  { key: "groq", label: "Groq (AI / LLM)" },
                  { key: "ollama", label: "Ollama (local LLM fallback)" },
                ].map(({ key, label }) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: globalServiceSet.has(key) ? "#10b981" : "#d1d5db",
                      flexShrink: 0,
                    }} />
                    <span>{label}</span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {globalServiceSet.has(key) ? "Configured" : "Not yet configured"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* INTERVIEW SETTINGS — admin-only platform-wide controls for
              CandidateLens's phone/video interview experience: how long a
              candidate gets to answer each question, and which voice reads
              questions aloud (Kokoro-82M natural voice, or the browser's
              built-in — more mechanical — SpeechSynthesis voice). */}
          {isAdmin ? (
            <div className="tiq-card tiq-mb-6">
              <div className="tiq-card-title">Interview Settings — Admin Console</div>
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
                      const defaultVoice = engine === "edge" ? "en-US-JennyNeural" : "af_heart";
                      setInterviewSettings(s => ({ ...s, tts_engine: engine, tts_voice: defaultVoice }));
                    }}>
                    <option value="kokoro">Kokoro-82M — self-hosted, natural voice</option>
                    <option value="edge">Microsoft Edge — online natural voice (no setup, needs internet)</option>
                    <option value="browser">Browser default (built-in, more mechanical)</option>
                  </select>
                </div>
              </div>
              {interviewSettings.tts_engine === "kokoro" && (
                <div className="tiq-form-group">
                  <label className="tiq-label">Kokoro voice</label>
                  <select className="tiq-select" value={interviewSettings.tts_voice}
                    onChange={e => setInterviewSettings(s => ({ ...s, tts_voice: e.target.value }))}>
                    {Object.entries(
                      Object.keys(kokoroVoices).length ? kokoroVoices : {
                        af_heart: "Heart (US English, female) — warm, default",
                        af_bella: "Bella (US English, female)",
                        af_nicole: "Nicole (US English, female)",
                        am_adam: "Adam (US English, male)",
                        am_michael: "Michael (US English, male)",
                        bf_emma: "Emma (British English, female)",
                        bm_george: "George (British English, male)",
                      }
                    ).map(([id, label]) => <option key={id} value={id}>{label as string}</option>)}
                  </select>
                  {kokoroError && (
                    <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 6 }}>
                      Kokoro isn't loaded yet on the server ({kokoroError}) — interviews will use the browser
                      voice until model files finish downloading on first use, or switch to Microsoft Edge below.
                    </div>
                  )}
                </div>
              )}
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

          {/* MORPHCAST */}
          <div className="tiq-card tiq-mb-6">
            <div className="tiq-card-title">MorphCast — Video Interview Emotion AI</div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              Powers the facial emotion analysis during CandidateLens video interviews (Video Review column).
              Get a free license key at{" "}
              <a href="https://www.morphcast.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal-500)" }}>morphcast.com</a>{" "}
              — a key is required on every load; without one, interviews still run but skip emotion analysis.
            </p>
            <div className="tiq-grid-2">
              {inp("License Key", morphcast.license_key, v => setMorphcast({ license_key: v }), "text", "paste your MorphCast license key")}
            </div>
            <button className="tiq-btn tiq-btn-primary" onClick={() => saveKey("morphcast", morphcast)} disabled={savingService === "morphcast"}>
              {savingService === "morphcast" ? "Saving…" : "Save MorphCast Key"}
            </button>
          </div>

          {/* SMTP */}
          <div className="tiq-card tiq-mb-6">
            <div className="tiq-card-title">SMTP — Candidate Email Invites</div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              Used by CandidateLens to send video-interview invite emails to candidates.
              For Gmail, use an <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal-500)" }}>app password</a>, not your regular password.
            </p>
            <div className="tiq-grid-2">
              {inp("SMTP Host", smtp.host, v => setSmtp(s => ({ ...s, host: v })), "text", "e.g. smtp.gmail.com")}
              {inp("SMTP Port", smtp.port, v => setSmtp(s => ({ ...s, port: v })), "text", "587")}
              {inp("Username", smtp.username, v => setSmtp(s => ({ ...s, username: v })), "text", "you@company.com")}
              {inp("Password", smtp.password, v => setSmtp(s => ({ ...s, password: v })), "password", "••••••••")}
              {inp("From Email", smtp.from_email, v => setSmtp(s => ({ ...s, from_email: v })), "email", "recruiting@company.com")}
            </div>
            <button className="tiq-btn tiq-btn-primary" onClick={() => saveKey("smtp", smtp)} disabled={savingService === "smtp"}>
              {savingService === "smtp" ? "Saving…" : "Save SMTP Settings"}
            </button>
          </div>

          {/* SAVED KEYS LIST */}
          <div className="tiq-card">
            <div className="tiq-card-title">Saved keys</div>
            {savedKeys.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>No keys saved yet.</div>
            ) : (
              <div className="tiq-table-wrap">
                <table className="tiq-table">
                  <thead><tr><th>Service</th><th>Key</th><th>Value</th><th>Saved</th><th></th></tr></thead>
                  <tbody>
                    {savedKeys.map((k: any) => (
                      <Fragment key={k.id}>
                        <tr>
                          <td><span className="tiq-badge tiq-badge-slate">{k.service}</span></td>
                          <td style={{ fontFamily: "monospace", fontSize: 12 }}>{k.key_name}</td>
                          <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{k.key_preview || "—"}</td>
                          <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{new Date(k.created_at).toLocaleDateString()}</td>
                          <td style={{ display: "flex", gap: 4 }}>
                            <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Edit — enter a new value to replace this key"
                              onClick={() => editingKeyId === k.id ? cancelEdit() : startEdit(k)}>
                              <Pencil size={13} />
                            </button>
                            <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" style={{ color: "var(--rose-500)" }}
                              onClick={() => deleteKeyMut.mutate(k.id)}>
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                        {editingKeyId === k.id && (
                          <tr>
                            <td colSpan={5} style={{ background: "var(--bg-secondary)", padding: "10px 14px" }}>
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
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
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
              <table className="tiq-table">
                <thead>
                  <tr><th>Name</th><th>Email (User ID)</th><th>Role</th><th>Company</th><th>Status</th><th>Last login</th><th></th></tr>
                </thead>
                <tbody>
                  {users.map((u: any) => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 600 }}>{u.name}</td>
                      <td style={{ fontSize: 13 }}>{u.email}</td>
                      <td><span className={`tiq-badge ${u.role === "admin" ? "tiq-badge-violet" : "tiq-badge-slate"}`}>{u.role}</span></td>
                      <td style={{ fontSize: 13, color: "var(--text-muted)" }}>{u.company || "—"}</td>
                      <td><span className={`tiq-badge ${u.is_active ? "tiq-badge-teal" : "tiq-badge-rose"}`}>{u.is_active ? "Active" : "Inactive"}</span></td>
                      <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{u.last_login ? new Date(u.last_login).toLocaleDateString() : "Never"}</td>
                      <td>
                        {u.id !== user.id && u.is_active && (
                          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" style={{ color: "var(--rose-500)", fontSize: 11 }}
                            onClick={() => deactivateMut.mutate(u.id)}>Deactivate</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}