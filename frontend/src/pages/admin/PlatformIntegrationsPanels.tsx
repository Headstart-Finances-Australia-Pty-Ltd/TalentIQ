import { useEffect, useRef, useState, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi, groqPoolApi, interviewApi, systemApi } from "../../lib/api";
import { Pencil, Trash2, Eye, EyeOff, CheckCircle2, XCircle, Loader2 } from "lucide-react";

// ── Shared small helpers, local to this file ─────────────────────────
// Mirrors the labeled-input / saved-keys-bar helpers SettingsPage.tsx
// used to define inline (these panels used to live there) — kept here
// instead of exported from a shared module since nothing else needs
// them yet.

export function Field(props: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  const { label, value, onChange, type = "text", placeholder = "" } = props;
  return (
    <div className="tiq-form-group">
      <label className="tiq-label">{label}</label>
      <input type={type} className="tiq-input" value={value}
        onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function useSavedKeys(service: string) {
  const { data: allKeys = [] } = useQuery({ queryKey: ["api-keys"], queryFn: authApi.listApiKeys });
  return allKeys.filter((k: any) => k.service === service);
}

// Same inline show/edit/delete row pattern used across this admin
// console (see SavedKeyRow in ApiKeysTab.tsx), extended with inline
// editing so replacing a credential doesn't require deleting it first.
function SavedKeysBar({ service }: { service: string }) {
  const qc = useQueryClient();
  const keys = useSavedKeys(service);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const deleteMut = useMutation({
    mutationFn: (id: number) => authApi.deleteApiKey(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["api-keys"] }); qc.invalidateQueries({ queryKey: ["global-keys"] }); },
  });

  const startEdit = (k: any) => { setEditingId(k.id); setEditValue(""); setError(""); };
  const cancelEdit = () => { setEditingId(null); setEditValue(""); setError(""); };
  const saveEdit = async (k: any) => {
    if (!editValue.trim()) { setError("Enter a new value first."); return; }
    setSaving(true); setError("");
    try {
      await authApi.saveApiKey({ service: k.service, key_name: k.key_name, key_value: editValue.trim(), is_global: k.is_global });
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      qc.invalidateQueries({ queryKey: ["global-keys"] });
      cancelEdit();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Failed to update — try again.");
    } finally {
      setSaving(false);
    }
  };

  if (keys.length === 0) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
        Currently saved
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {keys.map((k: any) => (
          <Fragment key={k.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8 }}>
              <span style={{ fontFamily: "monospace", fontSize: 12.5 }}>{k.key_name}</span>
              <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{k.key_preview || "—"}</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>{new Date(k.created_at).toLocaleDateString()}</span>
              <div style={{ display: "flex", gap: 4 }}>
                <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Edit — enter a new value to replace this key"
                  onClick={() => (editingId === k.id ? cancelEdit() : startEdit(k))}>
                  <Pencil size={13} />
                </button>
                <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" style={{ color: "var(--rose-500)" }} title="Delete this key"
                  onClick={() => { if (confirm(`Delete ${k.service} / ${k.key_name}?`)) deleteMut.mutate(k.id); }}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            {editingId === k.id && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>New value for {k.key_name}:</span>
                <input
                  type={k.key_name.toLowerCase().includes("password") || k.key_name.toLowerCase().includes("key") ? "password" : "text"}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveEdit(k); if (e.key === "Escape") cancelEdit(); }}
                  placeholder="Enter the new value — current value is never shown, for security"
                  autoFocus
                  style={{ flex: 1, padding: "6px 10px", fontSize: 12.5, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
                />
                <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={() => saveEdit(k)} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
                <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={cancelEdit} disabled={saving}>Cancel</button>
                {error && <div style={{ fontSize: 11.5, color: "var(--rose-500)" }}>{error}</div>}
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// Generic "save these fields under this service" mutation — mirrors
// SettingsPage.tsx's old saveKey(), minus the SHAREABLE-service
// decision logic since every panel here already knows whether it's
// global or not.
function useSaveFields(service: string, isGlobal: boolean, onDone?: (msg: string) => void) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const save = async (fields: Record<string, string>, successLabel?: string) => {
    const entries = Object.entries(fields).filter(([, v]) => v.trim() !== "");
    if (entries.length === 0) { onDone?.("Enter at least one value to save."); return; }
    setSaving(true);
    try {
      for (const [key_name, key_value] of entries) {
        await authApi.saveApiKey({ service, key_name, key_value, is_global: isGlobal });
      }
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      qc.invalidateQueries({ queryKey: ["global-keys"] });
      onDone?.(successLabel || `✅ ${service} credentials saved successfully!` + (isGlobal ? " (shared with all users)" : ""));
    } catch (e: any) {
      onDone?.(`❌ Failed to save ${service}: ${e.response?.data?.detail || e.message}`);
    } finally {
      setSaving(false);
    }
  };
  return { save, saving };
}

function StatusMsg({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <div style={{
      fontSize: 12, marginBottom: 12, padding: "8px 12px", borderRadius: 6,
      background: msg.startsWith("❌") ? "rgba(239,68,68,.08)" : "rgba(20,184,166,.08)",
      color: msg.startsWith("❌") ? "#ef4444" : "var(--teal-500)",
    }}>
      {msg}
    </div>
  );
}

// ── Apify — Seek Job Search ──────────────────────────────────────────
export function ApifyPanel() {
  const [apify, setApify] = useState({ api_token: "", actor_id: "" });
  const [msg, setMsg] = useState("");
  const { save, saving } = useSaveFields("apify", true, (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); });

  return (
    <div className="tiq-card tiq-mb-6">
      <div className="tiq-card-title">Apify — Seek Job Search</div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
        Get a token at <a href="https://console.apify.com/settings/integrations" target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal-500)" }}>console.apify.com</a>. Runs a Seek (seek.com.au / seek.co.nz) scraping Actor for JobHunt and JobIntel searches, and automatically upgrades JobHunt's LinkedIn search to a richer Apify actor (full descriptions, salary, applicant counts) when set — LinkedIn search still works without this, just with less detail.
      </p>
      <StatusMsg msg={msg} />
      <SavedKeysBar service="apify" />
      <div className="tiq-grid-2">
        <Field label="API Token" value={apify.api_token} onChange={(v) => setApify((a) => ({ ...a, api_token: v }))} type="password" placeholder="e.g. apify_api_…" />
        <Field label="Actor ID (optional)" value={apify.actor_id} onChange={(v) => setApify((a) => ({ ...a, actor_id: v }))} placeholder="default: automation-lab/seek-scraper" />
      </div>
      <p style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "4px 0 8px" }}>
        Shared platform-wide — every user on this deployment automatically uses whatever you save here.
        Leave Actor ID blank to use the default Seek scraper Actor, or point it at any other Seek Actor you've picked from the Apify Store.
      </p>
      <button className="tiq-btn tiq-btn-primary" onClick={() => save(apify)} disabled={saving}>
        {saving ? "Saving…" : "Save Apify Settings"}
      </button>
    </div>
  );
}

// ── Ollama — Local/Self-Hosted LLM ───────────────────────────────────
export function OllamaPanel() {
  const [ollama, setOllama] = useState({ base_url: "http://localhost:11434", model: "llama3" });
  const [msg, setMsg] = useState("");
  const { save, saving } = useSaveFields("ollama", true, (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); });

  return (
    <div className="tiq-card tiq-mb-6">
      <div className="tiq-card-title">Ollama — Local/Self-Hosted LLM</div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
        Used as a fallback for JD Creator when no Groq key is set. Requires{" "}
        <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal-500)" }}>Ollama</a>{" "}
        running locally (or reachable at the URL below) with a model pulled, e.g. <code>ollama pull llama3</code>.
      </p>
      <StatusMsg msg={msg} />
      <SavedKeysBar service="ollama" />
      <div className="tiq-grid-2">
        <Field label="Base URL" value={ollama.base_url} onChange={(v) => setOllama((o) => ({ ...o, base_url: v }))} placeholder="http://localhost:11434" />
        <Field label="Model" value={ollama.model} onChange={(v) => setOllama((o) => ({ ...o, model: v }))} placeholder="llama3" />
      </div>
      <p style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "4px 0 8px" }}>
        Shared platform-wide — every user on this deployment automatically uses whatever you save here.
      </p>
      <button className="tiq-btn tiq-btn-primary" onClick={() => save(ollama)} disabled={saving}>
        {saving ? "Saving…" : "Save Ollama Settings"}
      </button>
    </div>
  );
}

// ── MorphCast — Video Interview Emotion AI ───────────────────────────
export function MorphcastPanel() {
  const [morphcast, setMorphcast] = useState({ license_key: "" });
  const [msg, setMsg] = useState("");
  const { save, saving } = useSaveFields("morphcast", false, (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); });

  return (
    <div className="tiq-card tiq-mb-6">
      <div className="tiq-card-title">MorphCast — Video Interview Emotion AI</div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
        Powers the facial emotion analysis during CandidateLens video interviews (Video Review column).
        Get a free license key at{" "}
        <a href="https://www.morphcast.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal-500)" }}>morphcast.com</a>{" "}
        — a key is required on every load; without one, interviews still run but skip emotion analysis.
      </p>
      <StatusMsg msg={msg} />
      <SavedKeysBar service="morphcast" />
      <div className="tiq-grid-2">
        <Field label="License Key" value={morphcast.license_key} onChange={(v) => setMorphcast({ license_key: v })} placeholder="paste your MorphCast license key" />
      </div>
      <button className="tiq-btn tiq-btn-primary" onClick={() => save(morphcast)} disabled={saving}>
        {saving ? "Saving…" : "Save MorphCast Key"}
      </button>
    </div>
  );
}

// ── NavTalk — AI Avatar Interviews ───────────────────────────────────
export function NavTalkPanel() {
  const [navtalk, setNavtalk] = useState({ api_key: "", avatar_persona_id: "" });
  const [msg, setMsg] = useState("");
  const { save, saving } = useSaveFields("navtalk", false, (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); });

  return (
    <div className="tiq-card tiq-mb-6">
      <div className="tiq-card-title">NavTalk — AI Avatar Interviews</div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
        Powers "Video Interview (AI Avatar)" rounds in Interviews — a NavTalk avatar asks each candidate their
        personalized questions, and their spoken answers are transcribed and evaluated automatically.
      </p>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
        Get your API key and avatar persona ID from your NavTalk.ai dashboard.
      </p>
      <StatusMsg msg={msg} />
      <SavedKeysBar service="navtalk" />
      <div className="tiq-grid-2">
        <Field label="API Key" value={navtalk.api_key} onChange={(v) => setNavtalk((n) => ({ ...n, api_key: v }))} type="password" placeholder="nvtk_..." />
        <Field label="Avatar Persona ID" value={navtalk.avatar_persona_id} onChange={(v) => setNavtalk((n) => ({ ...n, avatar_persona_id: v }))} placeholder="e.g. persona_abc123" />
      </div>
      <button className="tiq-btn tiq-btn-primary" onClick={() => save(navtalk)} disabled={saving}>
        {saving ? "Saving…" : "Save NavTalk Credentials"}
      </button>
    </div>
  );
}

// ── Calendly — Interview Scheduling ──────────────────────────────────
export function CalendlyPanel() {
  const qc = useQueryClient();
  const [calendly, setCalendly] = useState({ booking_url: "", api_key: "", event_type_uri: "" });
  const [msg, setMsg] = useState("");
  const { save, saving } = useSaveFields("calendly", false, (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); });

  const [calendlyEventTypes, setCalendlyEventTypes] = useState<any[] | null>(null);
  const [fetchingCalendlyTypes, setFetchingCalendlyTypes] = useState(false);
  const [calendlyFetchError, setCalendlyFetchError] = useState("");

  const [webhookConnected, setWebhookConnected] = useState(false);
  const [publicBaseUrlConfigured, setPublicBaseUrlConfigured] = useState(true);
  const [webhookBusy, setWebhookBusy] = useState(false);
  const [webhookMsg, setWebhookMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    interviewApi.calendlyWebhookStatus()
      .then((r: any) => { setWebhookConnected(!!r.connected); setPublicBaseUrlConfigured(!!r.public_base_url_configured); })
      .catch(() => { /* non-fatal — button will just surface any real error on click */ });
  }, []);

  const connectWebhook = async () => {
    setWebhookBusy(true); setWebhookMsg(null);
    try {
      await interviewApi.connectCalendlyWebhook();
      setWebhookConnected(true);
      setWebhookMsg({ ok: true, text: "Connected — bookings will now sync automatically." });
    } catch (e: any) {
      setWebhookMsg({ ok: false, text: e?.response?.data?.detail || "Failed to connect the webhook." });
    } finally {
      setWebhookBusy(false);
    }
  };
  const disconnectWebhook = async () => {
    setWebhookBusy(true); setWebhookMsg(null);
    try {
      await interviewApi.disconnectCalendlyWebhook();
      setWebhookConnected(false);
      setWebhookMsg({ ok: true, text: "Disconnected." });
    } catch (e: any) {
      setWebhookMsg({ ok: false, text: e?.response?.data?.detail || "Failed to disconnect the webhook." });
    } finally {
      setWebhookBusy(false);
    }
  };

  const fetchCalendlyEventTypes = async () => {
    setFetchingCalendlyTypes(true);
    setCalendlyFetchError("");
    try {
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
    <div className="tiq-card tiq-mb-6">
      <div className="tiq-card-title">Calendly — Interview Scheduling</div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
        Lets Interviews hand candidates a Calendly link to book their own time instead of TalentIQ Solution's
        own link-based flow — Calendly handles the actual time-slot picking and calendar conflicts.
      </p>
      <StatusMsg msg={msg} />
      <SavedKeysBar service="calendly" />

      <div className="tiq-form-group">
        <label className="tiq-label">Booking Link</label>
        <input className="tiq-input" value={calendly.booking_url}
          onChange={(e) => setCalendly((c) => ({ ...c, booking_url: e.target.value }))}
          placeholder="https://calendly.com/your-username/30min" />
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
        Paste your public Calendly page URL — this is the link every candidate gets. To change the
        event, duration, or availability later, edit it in Calendly and update the link here; no
        redeploy needed. Find it under your event type's <strong>Share</strong> button in Calendly.
      </p>
      <div style={{ marginBottom: 18 }}>
        <button className="tiq-btn tiq-btn-primary" onClick={() => save(calendly)} disabled={saving}>
          {saving ? "Saving…" : "Save Calendly Link"}
        </button>
      </div>

      <details>
        <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          Advanced: generate a single-use link per candidate instead (optional)
        </summary>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "10px 0" }}>
          Get your Personal Access Token from{" "}
          <a href="https://calendly.com/integrations/api_webhooks" target="_blank" rel="noreferrer" style={{ color: "var(--brand-teal, #0d9488)" }}>
            Calendly → Integrations → API & Webhooks
          </a>. If a Booking Link is set above, it takes priority and this is ignored.
        </p>
        <div className="tiq-grid-2">
          <Field label="Personal Access Token" value={calendly.api_key} onChange={(v) => setCalendly((c) => ({ ...c, api_key: v }))} type="password" placeholder="eyJraWQiOi..." />
          <div className="tiq-form-group">
            <label className="tiq-label">Event Type</label>
            {calendlyEventTypes ? (
              <select className="tiq-select" value={calendly.event_type_uri}
                onChange={(e) => setCalendly((c) => ({ ...c, event_type_uri: e.target.value }))}>
                <option value="">— Select an event type —</option>
                {calendlyEventTypes.map((et: any) => (
                  <option key={et.uri} value={et.uri}>{et.name} ({et.duration} min)</option>
                ))}
              </select>
            ) : (
              <input className="tiq-input" value={calendly.event_type_uri}
                onChange={(e) => setCalendly((c) => ({ ...c, event_type_uri: e.target.value }))}
                placeholder="Click 'Fetch My Event Types' or paste an event type URI" />
            )}
          </div>
        </div>
        {calendlyFetchError && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 10, fontSize: 12 }}>{calendlyFetchError}</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="tiq-btn tiq-btn-outline" onClick={fetchCalendlyEventTypes} disabled={fetchingCalendlyTypes || !calendly.api_key.trim()}>
            {fetchingCalendlyTypes ? "Fetching…" : "Fetch My Event Types"}
          </button>
          <button className="tiq-btn tiq-btn-primary" onClick={() => save(calendly)} disabled={saving}>
            {saving ? "Saving…" : "Save Calendly Credentials"}
          </button>
        </div>
      </details>

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Automatic booking sync</div>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          When a candidate books a slot through your Calendly link, automatically mark that round{" "}
          <strong>Scheduled</strong> in Interview Scheduling with the real booked time. Needs your Personal
          Access Token above (not just a plain Booking Link).
        </p>
        {!publicBaseUrlConfigured && (
          <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 10, fontSize: 12 }}>
            This server has no PUBLIC_BASE_URL configured, so Calendly has nowhere reachable to send booking
            events to — this only works once TalentIQ is deployed somewhere with a real public URL, not on a
            local dev server.
          </div>
        )}
        {webhookMsg && (
          <div style={{ fontSize: 12, color: webhookMsg.ok ? "#10b981" : "var(--rose-500)", marginBottom: 10 }}>
            {webhookMsg.text}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: webhookConnected ? "#10b981" : "#d1d5db" }} />
          <span style={{ fontSize: 12.5 }}>{webhookConnected ? "Connected" : "Not connected"}</span>
          {webhookConnected ? (
            <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={disconnectWebhook} disabled={webhookBusy}>
              {webhookBusy ? "Disconnecting…" : "Disconnect"}
            </button>
          ) : (
            <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={connectWebhook} disabled={webhookBusy || !publicBaseUrlConfigured}>
              {webhookBusy ? "Connecting…" : "Connect automatic booking sync"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Meeting Link (Zoom / Teams / Google Meet) ─────────────────────────
// A personal default — each recruiter has their own recurring meeting
// room, so this is deliberately NOT in SHAREABLE_SERVICES (same as
// Calendly above). Used to pre-fill Interview Scheduling's Location/
// Meeting Link field whenever it's left blank at scheduling time (see
// InterviewsPage.tsx), and by Panel Interview's "Send Invite" action —
// Calendly itself has no API for switching which video platform a
// booking uses (that's configured on the Calendly event type itself),
// so this is the practical equivalent: one saved link, reused instead
// of typed fresh (or left blank) every time.
export function MeetingLinkPanel() {
  const [meeting, setMeeting] = useState({ platform: "zoom", link: "" });
  const [msg, setMsg] = useState("");
  const { save, saving } = useSaveFields("meeting_platform", false, (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); });

  return (
    <div className="tiq-card tiq-mb-6">
      <div className="tiq-card-title">Meeting Link — Zoom / Teams / Google Meet</div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
        Your default video-call link, used to pre-fill the Location/Meeting Link field whenever it's left blank
        while scheduling a Video or Panel Interview round, and for Panel Interview's "Send Invite" email. Paste
        your own recurring Zoom Personal Meeting Room, Microsoft Teams meeting, or Google Meet link — this doesn't
        create new meetings automatically, it just saves you retyping (or forgetting to set) the same link every time.
      </p>
      <StatusMsg msg={msg} />
      <SavedKeysBar service="meeting_platform" />
      <div className="tiq-form-group">
        <label className="tiq-label">Platform</label>
        <select className="tiq-input tiq-select" value={meeting.platform} onChange={(e) => setMeeting({ ...meeting, platform: e.target.value })}>
          <option value="zoom">Zoom</option>
          <option value="teams">Microsoft Teams</option>
          <option value="meet">Google Meet</option>
          <option value="other">Other</option>
        </select>
      </div>
      <Field label="Meeting Link" value={meeting.link} onChange={(v) => setMeeting({ ...meeting, link: v })}
        placeholder="https://zoom.us/j/…, https://teams.microsoft.com/…, or https://meet.google.com/…" />
      <button className="tiq-btn tiq-btn-primary" onClick={() => save(meeting)} disabled={saving || !meeting.link.trim()}>
        {saving ? "Saving…" : "Save Meeting Link"}
      </button>
    </div>
  );
}

// ── Groq Key Pool — scale capacity automatically ─────────────────────
export function GroqKeyPoolPanel() {
  const { data: poolKeys = [], refetch: refetchPool } = useQuery({ queryKey: ["groq-pool"], queryFn: groqPoolApi.list });
  const [newPoolKey, setNewPoolKey] = useState({ key_value: "", model: "" });

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

  const autoFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (autoFetchTimer.current) clearTimeout(autoFetchTimer.current);
    const key = newPoolKey.key_value.trim();
    if (key.length < 20) return;
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

  const [editingPoolId, setEditingPoolId] = useState<number | null>(null);
  const [editPoolModel, setEditPoolModel] = useState("");
  const [editPoolKeyValue, setEditPoolKeyValue] = useState("");
  const startPoolEdit = (k: any) => { setEditingPoolId(k.id); setEditPoolModel(k.model || ""); setEditPoolKeyValue(""); setFetchedModels(null); setModelsFetchError(""); };
  const cancelPoolEdit = () => { setEditingPoolId(null); setEditPoolModel(""); setEditPoolKeyValue(""); setFetchedModels(null); setModelsFetchError(""); };
  const editPoolMut = useMutation({
    mutationFn: ({ id, model, key_value }: { id: number; model?: string; key_value?: string }) =>
      groqPoolApi.update(id, { model, ...(key_value ? { key_value } : {}) }),
    onSuccess: () => { refetchPool(); flashPool("Pool key updated."); cancelPoolEdit(); },
    onError: (e: any) => flashPool(`❌ ${e.response?.data?.detail || "Failed to update key"}`),
  });

  return (
    <div className="tiq-card tiq-mb-6">
      <div className="tiq-card-title">Groq Key Pool — scale capacity automatically</div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
        Add multiple Groq keys here (from separate Groq accounts if you want real added
        throughput — Groq's rate limits apply per account, not per key). The platform
        automatically spreads load across whichever keys are healthy, and routes around
        any that are temporarily rate-limited, recovering them automatically once they
        cool down.
      </p>

      <StatusMsg msg={poolMsg} />

      {poolKeys.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Keys in pool ({poolKeys.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(() => {
              const byAddedAsc = [...poolKeys].sort((a: any, b: any) => new Date(a.added_at || 0).getTime() - new Date(b.added_at || 0).getTime());
              const numberOf = new Map(byAddedAsc.map((k: any, i: number) => [k.id, i + 1]));
              return poolKeys.map((k: any) => (
                <div key={k.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, opacity: k.is_active ? 1 : 0.5 }}>
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 6, flexShrink: 0, background: "var(--surface-2, rgba(0,0,0,.06))", fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
                      {numberOf.get(k.id)}
                    </span>
                    <span style={{ fontFamily: "monospace", fontSize: 13 }}>{k.key_preview}</span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{k.model || "platform default"}</span>
                    {k.cooldown_until && new Date(k.cooldown_until) > new Date() && (
                      <span style={{ fontSize: 11, color: "#f59e0b" }}>⏳ cooling down</span>
                    )}
                    {!k.is_active && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>disabled</span>}
                    <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                      <button className="tiq-btn tiq-btn-sm" onClick={() => (editingPoolId === k.id ? cancelPoolEdit() : startPoolEdit(k))}>
                        <Pencil size={13} />
                      </button>
                      <button className="tiq-btn tiq-btn-sm" onClick={() => togglePoolMut.mutate({ id: k.id, is_active: !k.is_active })}>
                        {k.is_active ? "Disable" : "Enable"}
                      </button>
                      <button className="tiq-btn tiq-btn-sm" style={{ color: "#ef4444" }} onClick={() => { if (confirm("Remove this key from the pool?")) removePoolMut.mutate(k.id); }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  {editingPoolId === k.id && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 14px", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 8px 8px", marginTop: -1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap", width: 90 }}>Replace key:</span>
                        <input
                          type="password"
                          value={editPoolKeyValue}
                          onChange={(e) => setEditPoolKeyValue(e.target.value)}
                          placeholder="leave blank to keep the current key, only change the model"
                          style={{ flex: 1, padding: "6px 10px", fontSize: 12.5, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
                        />
                        <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ whiteSpace: "nowrap" }}
                          onClick={() => (editPoolKeyValue.trim() ? fetchModelsForKey(editPoolKeyValue.trim()) : fetchModelsForExistingPoolKey(k.id))}
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
                          <select value={editPoolModel} onChange={(e) => setEditPoolModel(e.target.value)}
                            style={{ flex: 1, padding: "6px 10px", fontSize: 12.5, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)" }}>
                            <option value="">Platform default</option>
                            {fetchedModels.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        ) : (
                          <input value={editPoolModel} onChange={(e) => setEditPoolModel(e.target.value)}
                            placeholder="leave blank for platform default, or fetch models above to pick from a live list"
                            style={{ flex: 1, padding: "6px 10px", fontSize: 12.5, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)" }} />
                        )}
                      </div>
                      {modelsFetchError && <div style={{ fontSize: 11.5, color: "#ef4444" }}>{modelsFetchError}</div>}
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={cancelPoolEdit} disabled={editPoolMut.isPending}>Cancel</button>
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

        <Field label="API Key" value={newPoolKey.key_value}
          onChange={(v) => { setNewPoolKey((k) => ({ ...k, key_value: v })); setFetchedModels(null); setModelsFetchError(""); }}
          type="password" placeholder="gsk_…" />

        <div style={{ marginBottom: 4, display: "flex", alignItems: "center", gap: 10 }}>
          {fetchingModels && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Checking with Groq…</span>}
          {!fetchingModels && fetchedModels && (
            <span style={{ fontSize: 12, color: "var(--teal-500)" }}>✓ {fetchedModels.length} models available for this key</span>
          )}
          {!fetchingModels && !fetchedModels && !modelsFetchError && newPoolKey.key_value.trim().length > 0 && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Models will load automatically once the key looks complete…</span>
          )}
          <button type="button" className="tiq-btn tiq-btn-sm" onClick={() => fetchModelsForKey()} disabled={fetchingModels || !newPoolKey.key_value.trim()}>
            {fetchedModels ? "Refetch" : "Fetch now"}
          </button>
          {modelsFetchError && <span style={{ fontSize: 12, color: "#ef4444" }}>{modelsFetchError}</span>}
        </div>

        <div style={{ marginTop: 12, marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Model</label>
          {fetchedModels ? (
            <select value={newPoolKey.model} onChange={(e) => setNewPoolKey((k) => ({ ...k, model: e.target.value }))} className="tiq-input" style={{ width: "100%" }}>
              <option value="">Platform default</option>
              {fetchedModels.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <Field label="" value={newPoolKey.model} onChange={(v) => setNewPoolKey((k) => ({ ...k, model: v }))}
              placeholder="leave blank for platform default, or fetch models above to pick from a live list" />
          )}
        </div>

        <button className="tiq-btn tiq-btn-primary" onClick={() => addPoolMut.mutate()} disabled={addPoolMut.isPending || !newPoolKey.key_value.trim()}>
          {addPoolMut.isPending ? "Adding…" : `Add as Key #${poolKeys.length + 1}`}
        </button>
      </div>
    </div>
  );
}

// ── Result banner for a Test Connection check — mirrors ApiKeysTab.tsx's
// ResultBanner (kept local here rather than shared, same reasoning as
// this file's other small helpers: nothing else needs it yet). ────────
function TestResultBanner({ result }: { result: { ok: boolean; message: string } | null }) {
  if (!result) return null;
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, marginTop: 10, marginBottom: 4,
      padding: "8px 12px", borderRadius: 6,
      background: result.ok ? "rgba(20,184,166,.08)" : "rgba(239,68,68,.08)",
      color: result.ok ? "var(--teal-500)" : "#ef4444",
    }}>
      {result.ok ? <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1 }} /> : <XCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />}
      <span>{result.message}</span>
    </div>
  );
}

// Single saved-key row with a delete button — mirrors ApiKeysTab.tsx's
// own SavedKeyRow (kept local here too, same as that file's copy, since
// neither is exported and duplicating one tiny presentational row is
// simpler than introducing a shared module for it).
function ConfiguredKeyRow({ k, onDelete }: { k: any; onDelete: (id: number) => void }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
      border: "1px solid var(--border)", borderRadius: 8,
    }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", minWidth: 140 }}>{k.key_name}</span>
      <span style={{ fontFamily: "monospace", fontSize: 13, color: "var(--text-muted)" }}>{k.key_preview || "—"}</span>
      <button className="tiq-btn tiq-btn-sm" style={{ marginLeft: "auto" }} onClick={() => onDelete(k.id)} title="Remove">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ── Stripe — Billing / Checkout ───────────────────────────────────────
// Unlike the simpler save-only panels above, this one gets a genuine
// "Test Connection" step before Save is enabled — same pattern
// ApiKeysTab.tsx's DatabasePanel/S3Panel use — since a bad Stripe key
// fails silently at checkout time otherwise (see routers/billing.py's
// _get_stripe()). Webhook secret has no equivalent live test (Stripe
// only ever sends it inside a real webhook payload), so that field
// just saves directly.
export function StripePanel() {
  const qc = useQueryClient();
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [showWebhook, setShowWebhook] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [msg, setMsg] = useState("");

  const savedKeys = useSavedKeys("stripe");
  const savedSecret = savedKeys.find((k: any) => k.key_name === "secret_key");
  const savedWebhook = savedKeys.find((k: any) => k.key_name === "webhook_secret");

  const testMut = useMutation({
    mutationFn: () => systemApi.testStripeConnection(secretKey.trim()),
    onSuccess: (r) => setTestResult(r),
    onError: (e: any) => setTestResult({ ok: false, message: e?.response?.data?.detail || "Test failed." }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => authApi.deleteApiKey(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["api-keys"] }); qc.invalidateQueries({ queryKey: ["global-keys"] }); },
  });

  const saveSecret = async () => {
    try {
      await authApi.saveApiKey({ service: "stripe", key_name: "secret_key", key_value: secretKey.trim(), is_global: true });
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      qc.invalidateQueries({ queryKey: ["global-keys"] });
      setSecretKey(""); setTestResult(null);
      setMsg("✅ Stripe secret key saved successfully!");
    } catch (e: any) {
      setMsg(`❌ Failed to save: ${e.response?.data?.detail || e.message}`);
    }
    setTimeout(() => setMsg(""), 3000);
  };

  const saveWebhook = async () => {
    if (!webhookSecret.trim()) return;
    try {
      await authApi.saveApiKey({ service: "stripe", key_name: "webhook_secret", key_value: webhookSecret.trim(), is_global: true });
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      qc.invalidateQueries({ queryKey: ["global-keys"] });
      setWebhookSecret("");
      setMsg("✅ Stripe webhook secret saved successfully!");
    } catch (e: any) {
      setMsg(`❌ Failed to save: ${e.response?.data?.detail || e.message}`);
    }
    setTimeout(() => setMsg(""), 3000);
  };

  return (
    <div className="tiq-card tiq-mb-6">
      <div className="tiq-card-title">Stripe — Billing &amp; Checkout</div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
        Powers the Pricing page's paid-plan checkout. Get the secret key from your{" "}
        <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal-500)" }}>Stripe Dashboard → API keys</a>,
        and the webhook signing secret from{" "}
        <a href="https://dashboard.stripe.com/webhooks" target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal-500)" }}>Dashboard → Webhooks</a> after
        pointing an endpoint at <code>&lt;your domain&gt;/api/billing/webhook</code>. Shared platform-wide — falls back to the <code>STRIPE_SECRET_KEY</code> /{" "}
        <code>STRIPE_WEBHOOK_SECRET</code> environment variables if nothing is saved here.
      </p>
      <StatusMsg msg={msg} />

      <div className="tiq-form-group">
        <label className="tiq-label">Secret Key</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="tiq-input" type={showSecret ? "text" : "password"}
            placeholder="sk_live_… or sk_test_…" value={secretKey}
            onChange={(e) => { setSecretKey(e.target.value); setTestResult(null); }}
            style={{ fontFamily: "monospace", fontSize: 12.5 }}
          />
          <button type="button" className="tiq-btn tiq-btn-sm" onClick={() => setShowSecret((s) => !s)} title={showSecret ? "Hide" : "Show"}>
            {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="tiq-btn tiq-btn-sm" disabled={!secretKey.trim() || testMut.isPending} onClick={() => testMut.mutate()}>
          {testMut.isPending ? <Loader2 size={13} className="tiq-spin" /> : null} Test Connection
        </button>
        <button
          className="tiq-btn tiq-btn-primary tiq-btn-sm"
          disabled={!secretKey.trim() || !testResult?.ok}
          onClick={saveSecret}
          title={!testResult?.ok ? "Test the connection successfully first" : ""}
        >
          Save Secret Key
        </button>
      </div>
      <TestResultBanner result={testResult} />
      {savedSecret && (
        <div style={{ marginTop: 14 }}>
          <ConfiguredKeyRow k={savedSecret} onDelete={(id) => deleteMut.mutate(id)} />
        </div>
      )}

      <div className="tiq-form-group" style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
        <label className="tiq-label">Webhook Signing Secret</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="tiq-input" type={showWebhook ? "text" : "password"}
            placeholder="whsec_…" value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            style={{ fontFamily: "monospace", fontSize: 12.5 }}
          />
          <button type="button" className="tiq-btn tiq-btn-sm" onClick={() => setShowWebhook((s) => !s)} title={showWebhook ? "Hide" : "Show"}>
            {showWebhook ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
      </div>
      <button className="tiq-btn tiq-btn-primary tiq-btn-sm" disabled={!webhookSecret.trim()} onClick={saveWebhook}>
        Save Webhook Secret
      </button>
      {savedWebhook && (
        <div style={{ marginTop: 14 }}>
          <ConfiguredKeyRow k={savedWebhook} onDelete={(id) => deleteMut.mutate(id)} />
        </div>
      )}
    </div>
  );
}

// ── LinkedIn Jobs — Job Ad Posting ────────────────────────────────────
// Distinct from the private, per-user "linkedin" service LinkLens uses
// for candidate-search logins (see SettingsPage.tsx) — this is a
// LinkedIn Talent/Jobs partner-API OAuth token used only to push a Job
// Ads posting live (see routers/job_ads.py), configured once here for
// every recruiter on the deployment.
export function LinkedInJobsPanel() {
  const [linkedinJobs, setLinkedinJobs] = useState({ access_token: "" });
  const [msg, setMsg] = useState("");
  const { save, saving } = useSaveFields("linkedin_jobs", true, (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); });

  return (
    <div className="tiq-card tiq-mb-6">
      <div className="tiq-card-title">LinkedIn Jobs — Job Ad Posting</div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
        Lets Job Ads push a posting live on LinkedIn. Requires LinkedIn's own Talent/Jobs partner-level API
        access (a separate agreement from a normal LinkedIn login, and from the LinkedIn credentials on the
        Settings page used for LinkLens candidate search) — apply via your LinkedIn Talent Solutions account
        team for an OAuth access token with the job-posting scope.
      </p>
      <StatusMsg msg={msg} />
      <SavedKeysBar service="linkedin_jobs" />
      <Field label="Access Token" value={linkedinJobs.access_token} onChange={(v) => setLinkedinJobs({ access_token: v })}
        type="password" placeholder="LinkedIn Talent/Jobs API OAuth token" />
      <p style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "4px 0 8px" }}>
        Shared platform-wide — every recruiter's Job Ads posts use whatever token is saved here.
      </p>
      <button className="tiq-btn tiq-btn-primary" onClick={() => save(linkedinJobs)} disabled={saving}>
        {saving ? "Saving…" : "Save LinkedIn Jobs Token"}
      </button>
    </div>
  );
}

// ── Seek Jobs — Job Ad Posting ────────────────────────────────────────
// Distinct from the "apify" service (used to SCRAPE Seek search results
// for JobHunt/JobIntel) — this is a Seek Partner API key used to POST a
// Job Ads listing live on Seek (see routers/job_ads.py).
export function SeekJobsPanel() {
  const [seekJobs, setSeekJobs] = useState({ api_key: "" });
  const [msg, setMsg] = useState("");
  const { save, saving } = useSaveFields("seek_jobs", true, (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); });

  return (
    <div className="tiq-card tiq-mb-6">
      <div className="tiq-card-title">Seek Jobs — Job Ad Posting</div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
        Lets Job Ads push a posting live on Seek (seek.com.au / seek.co.nz). Requires a Seek Partner API
        agreement — separate from a normal Seek account, and from the Apify token above (which only scrapes
        Seek's public search results for JobHunt/JobIntel, not posting).
      </p>
      <StatusMsg msg={msg} />
      <SavedKeysBar service="seek_jobs" />
      <Field label="API Key" value={seekJobs.api_key} onChange={(v) => setSeekJobs({ api_key: v })}
        type="password" placeholder="Seek Partner API key" />
      <p style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "4px 0 8px" }}>
        Shared platform-wide — every recruiter's Job Ads posts use whatever key is saved here.
      </p>
      <button className="tiq-btn tiq-btn-primary" onClick={() => save(seekJobs)} disabled={saving}>
        {saving ? "Saving…" : "Save Seek Jobs Key"}
      </button>
    </div>
  );
}
