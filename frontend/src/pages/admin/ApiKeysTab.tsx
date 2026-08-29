import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi, systemApi } from "../../lib/api";
import { Database, Cloud, CheckCircle2, XCircle, Loader2, Trash2, Eye, EyeOff, ArrowRightLeft } from "lucide-react";

// Shared "result banner" for a Test Connection check — success/failure
// with the provider's own message, not persisted, cleared whenever the
// form is edited again so a stale "✓ Connected" can't linger next to
// fields the admin has since changed.
function ResultBanner({ result }: { result: { ok: boolean; message: string } | null }) {
  if (!result) return null;
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, marginTop: 10,
      padding: "8px 12px", borderRadius: 6,
      background: result.ok ? "rgba(20,184,166,.08)" : "rgba(239,68,68,.08)",
      color: result.ok ? "var(--teal-500)" : "#ef4444",
    }}>
      {result.ok ? <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1 }} /> : <XCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />}
      <span>{result.message}</span>
    </div>
  );
}

function SavedKeyRow({ k, onDelete }: { k: any; onDelete: (id: number) => void }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
      border: "1px solid var(--border)", borderRadius: 8, marginBottom: 6,
    }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", minWidth: 140 }}>{k.key_name}</span>
      <span style={{ fontFamily: "monospace", fontSize: 13, color: "var(--text-muted)" }}>{k.key_preview || "—"}</span>
      <button className="tiq-btn tiq-btn-sm" style={{ marginLeft: "auto" }} onClick={() => onDelete(k.id)} title="Remove">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// Allocated-storage quota — lives in the same Database panel as the
// connection key since both are "how this app understands its Xata
// database", and shares that panel's save-then-invalidate shape. Goes
// through systemApi.setStorageQuota (a dedicated, numerically-validated
// endpoint), not the generic saveApiKey upsert used for the connection
// string/S3 fields, since this value drives a used_pct calculation and
// needs real bounds-checking rather than "any string the admin typed".
function StorageQuotaSection() {
  const qc = useQueryClient();
  const [gb, setGb] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: quota } = useQuery({ queryKey: ["storage-quota"], queryFn: systemApi.getStorageQuota });

  const saveMut = useMutation({
    mutationFn: (allocated_gb: number) => systemApi.setStorageQuota(allocated_gb),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["storage-quota"] });
      qc.invalidateQueries({ queryKey: ["admin-storage"] }); // File Manager's storage bar reads this
      setGb("");
      setError(null);
    },
    onError: (e: any) => setError(e?.response?.data?.detail || "Could not save."),
  });

  const parsed = parseFloat(gb);
  const valid = gb.trim() !== "" && !isNaN(parsed) && parsed > 0;

  return (
    <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
      <label className="tiq-label">Allocated storage quota (GB)</label>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px", lineHeight: 1.5 }}>
        Drives the used % shown on the File Manager storage bar.{" "}
        {quota
          ? quota.source === "override"
            ? <>Currently set to <strong>{quota.allocated_gb} GB</strong> here (overrides the environment default).</>
            : <>Currently falling back to the <code>DB_ALLOCATED_GB</code> environment default (<strong>{quota.allocated_gb} GB</strong>).</>
          : null}
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="tiq-input" type="number" min={0.1} step="any"
          placeholder={quota ? String(quota.allocated_gb) : "5"}
          value={gb}
          onChange={(e) => { setGb(e.target.value); setError(null); }}
          style={{ maxWidth: 140 }}
        />
        <button
          className="tiq-btn tiq-btn-primary tiq-btn-sm"
          disabled={!valid || saveMut.isPending}
          onClick={() => saveMut.mutate(parsed)}
        >
          {saveMut.isPending ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: "#ef4444", marginTop: 6 }}>{error}</div>}
    </div>
  );
}

// Both providers speak plain Postgres wire protocol (see db/database.py's
// module docstring), so ONE connection-string field genuinely serves
// either — this just needs to (a) remember which one is currently
// configured, and (b) show the right example format for whichever is
// selected. The provider choice is saved as its own key_name ("provider")
// under the same "database" service as connection_url, via the same
// generic upsert-by-(service,key_name) endpoint the S3 panel already
// uses for its multiple fields — no bespoke endpoint needed for a plain
// enum choice a <select> already constrains.
const DB_PROVIDERS: { value: string; label: string; placeholder: string }[] = [
  { value: "xata", label: "Xata", placeholder: "postgresql://<workspace-id>:<api-key>@<region>.sql.xata.sh:5432/<db>:<branch>" },
  { value: "neon", label: "Neon", placeholder: "postgresql://<user>:<password>@<endpoint>.neon.tech/<dbname>?sslmode=require" },
];

// One-click schema+data copy between two Postgres providers (e.g.
// Neon -> Xata). Deliberately separate fields from the "active
// connection" section above — a migration needs BOTH a source and a
// target connection string live at once, whereas the section above only
// ever tracks one "currently configured" string, so reusing that field
// would be ambiguous about which side it's on. Runs server-side as a
// background job (POST returns a job_id immediately); this component
// polls GET .../migrate/{job_id} while it's running. See
// db/provider_migration.py's docstring for why this is copy-only and
// safe to re-run after a partial failure.
function MigrationPanel() {
  const [sourceUrl, setSourceUrl] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [showSource, setShowSource] = useState(false);
  const [showTarget, setShowTarget] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const { data: job } = useQuery({
    queryKey: ["db-migration-job", jobId],
    queryFn: () => systemApi.getMigrationStatus(jobId as string),
    enabled: !!jobId,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 1500 : false),
  });

  const startMut = useMutation({
    mutationFn: () => systemApi.startDatabaseMigration(sourceUrl.trim(), targetUrl.trim()),
    onSuccess: (r) => { setJobId(r.job_id); setStartError(null); },
    onError: (e: any) => setStartError(e?.response?.data?.detail || "Could not start migration."),
  });

  const running = job?.status === "running";
  const canStart = sourceUrl.trim() && targetUrl.trim() && confirmed && !running && !startMut.isPending;

  return (
    <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <ArrowRightLeft size={14} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>Migrate to another provider</span>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px", lineHeight: 1.5 }}>
        Copies every <code>tiq_*</code> table's schema and data from a source connection string into a
        target one, in foreign-key-safe order. <strong>Copy-only</strong> — the source is never modified —
        and safe to run again if it's interrupted partway (already-copied rows are skipped, not duplicated).
        This does not switch the running app onto the target; update <code>DATABASE_URL</code> and redeploy
        for that, same as the section above.
      </p>

      <div className="tiq-form-group">
        <label className="tiq-label">Source connection string (copy FROM — e.g. Neon)</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="tiq-input"
            type={showSource ? "text" : "password"}
            placeholder="postgresql://<user>:<password>@<endpoint>.neon.tech/<dbname>?sslmode=require"
            value={sourceUrl}
            onChange={(e) => { setSourceUrl(e.target.value); setStartError(null); }}
            disabled={running}
            style={{ fontFamily: "monospace", fontSize: 12.5 }}
          />
          <button type="button" className="tiq-btn tiq-btn-sm" onClick={() => setShowSource((s) => !s)} title={showSource ? "Hide" : "Show"}>
            {showSource ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
      </div>

      <div className="tiq-form-group">
        <label className="tiq-label">Target connection string (copy TO — e.g. Xata)</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="tiq-input"
            type={showTarget ? "text" : "password"}
            placeholder="postgresql://<workspace-id>:<api-key>@<region>.sql.xata.sh:5432/<db>:<branch>"
            value={targetUrl}
            onChange={(e) => { setTargetUrl(e.target.value); setStartError(null); }}
            disabled={running}
            style={{ fontFamily: "monospace", fontSize: 12.5 }}
          />
          <button type="button" className="tiq-btn tiq-btn-sm" onClick={() => setShowTarget((s) => !s)} title={showTarget ? "Hide" : "Show"}>
            {showTarget ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
      </div>

      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "var(--text-muted)", margin: "4px 0 12px", cursor: running ? "default" : "pointer" }}>
        <input type="checkbox" checked={confirmed} disabled={running} onChange={(e) => setConfirmed(e.target.checked)} style={{ marginTop: 2 }} />
        I've checked these are the right source and target, and I understand this writes data into the target database.
      </label>

      <button
        className="tiq-btn tiq-btn-primary tiq-btn-sm"
        disabled={!canStart}
        onClick={() => startMut.mutate()}
      >
        {running || startMut.isPending ? <Loader2 size={13} className="tiq-spin" /> : null}
        {running ? "Migration running…" : "Start Migration"}
      </button>

      {startError && <div style={{ fontSize: 12, color: "#ef4444", marginTop: 8 }}>{startError}</div>}

      {job && (
        <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600 }}>
            {job.status === "running" && <Loader2 size={13} className="tiq-spin" />}
            {job.status === "completed" && <CheckCircle2 size={14} color="var(--teal-500)" />}
            {job.status === "failed" && <XCircle size={14} color="#ef4444" />}
            <span>
              {job.status === "running" && `Copying${job.current_table ? `: ${job.current_table}` : "..."}`}
              {job.status === "completed" && "Migration complete"}
              {job.status === "failed" && "Migration failed"}
            </span>
            {job.tables_total != null && (
              <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                — {job.tables_done}/{job.tables_total} tables, {job.rows_copied} row(s) copied
              </span>
            )}
          </div>

          {job.error && <div style={{ fontSize: 12, color: "#ef4444", marginTop: 6 }}>{job.error}</div>}

          {job.log?.length > 0 && (
            <div style={{
              marginTop: 8, maxHeight: 140, overflowY: "auto", fontFamily: "monospace", fontSize: 11,
              color: "var(--text-muted)", background: "var(--bg-secondary, rgba(0,0,0,.02))", borderRadius: 6, padding: 8,
            }}>
              {job.log.slice(-30).map((line: string, i: number) => <div key={i}>{line}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DatabasePanel() {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [showUrl, setShowUrl] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  // null until the admin actually touches the dropdown — lets it default
  // to whatever provider was last saved instead of always resetting to Xata.
  const [providerOverride, setProviderOverride] = useState<string | null>(null);

  const { data: current } = useQuery({ queryKey: ["system-db-current"], queryFn: systemApi.currentDatabaseInfo });
  const { data: globalKeys = [] } = useQuery({ queryKey: ["global-keys"], queryFn: authApi.listGlobalKeys });
  const savedKeys = globalKeys.filter((k: any) => k.service === "database");
  const savedConnectionKey = savedKeys.find((k: any) => k.key_name === "connection_url");
  const savedProvider = savedKeys.find((k: any) => k.key_name === "provider")?.key_value;

  // Default to Xata (per current setup) until a saved choice says otherwise.
  const provider = providerOverride ?? savedProvider ?? "xata";
  const providerMeta = DB_PROVIDERS.find((p) => p.value === provider) ?? DB_PROVIDERS[0];

  const testMut = useMutation({
    mutationFn: () => systemApi.testDatabaseConnection(url),
    onSuccess: (r) => setTestResult(r),
    onError: (e: any) => setTestResult({ ok: false, message: e?.response?.data?.detail || "Test failed." }),
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      // Save the connection string and which provider it belongs to
      // together — on selection, that one string is "the API key" for
      // whichever provider is chosen.
      await authApi.saveApiKey({ service: "database", key_name: "connection_url", key_value: url, is_global: true });
      await authApi.saveApiKey({ service: "database", key_name: "provider", key_value: provider, is_global: true });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["global-keys"] });
      setUrl("");
      setTestResult(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => authApi.deleteApiKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["global-keys"] }),
  });

  return (
    <div className="tiq-card" style={{ marginBottom: 20 }}>
      <div className="tiq-card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Database size={16} /> Database
      </div>

      {current && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px" }}>
          Currently connected to <strong>{current.database}</strong> on <code>{current.host}</code>.
        </p>
      )}

      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 14px", lineHeight: 1.5 }}>
        Test a connection string below before saving it. Saving records it here for reference and hand-off,
        but does <strong>not</strong> move this running app onto it — set it as the <code>DATABASE_URL</code> environment
        variable in your hosting platform and redeploy to actually switch, so every part of the app moves
        together consistently.
      </p>

      <div className="tiq-form-group">
        <label className="tiq-label">Provider</label>
        <select
          className="tiq-input"
          value={provider}
          onChange={(e) => { setProviderOverride(e.target.value); setTestResult(null); }}
          style={{ maxWidth: 220 }}
        >
          {DB_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        {savedProvider && (
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "6px 0 0" }}>
            Currently saved: <strong>{DB_PROVIDERS.find((p) => p.value === savedProvider)?.label ?? savedProvider}</strong>
          </p>
        )}
      </div>

      <div className="tiq-form-group">
        <label className="tiq-label">Connection string ({providerMeta.label})</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="tiq-input"
            type={showUrl ? "text" : "password"}
            placeholder={providerMeta.placeholder}
            value={url}
            onChange={(e) => { setUrl(e.target.value); setTestResult(null); }}
            style={{ fontFamily: "monospace", fontSize: 12.5 }}
          />
          <button type="button" className="tiq-btn tiq-btn-sm" onClick={() => setShowUrl((s) => !s)} title={showUrl ? "Hide" : "Show"}>
            {showUrl ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className="tiq-btn tiq-btn-sm" disabled={!url.trim() || testMut.isPending} onClick={() => testMut.mutate()}>
          {testMut.isPending ? <Loader2 size={13} className="tiq-spin" /> : null} Test Connection
        </button>
        <button
          className="tiq-btn tiq-btn-primary tiq-btn-sm"
          disabled={!url.trim() || !testResult?.ok || saveMut.isPending}
          onClick={() => saveMut.mutate()}
          title={!testResult?.ok ? "Test the connection successfully first" : ""}
        >
          {saveMut.isPending ? "Saving…" : "Save"}
        </button>
      </div>

      <ResultBanner result={testResult} />

      {savedConnectionKey && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Saved for reference
          </div>
          <SavedKeyRow key={savedConnectionKey.id} k={savedConnectionKey} onDelete={(id) => deleteMut.mutate(id)} />
        </div>
      )}

      <StorageQuotaSection />
      <MigrationPanel />
    </div>
  );
}

const S3_FIELDS: { name: string; label: string; placeholder: string; required: boolean }[] = [
  { name: "bucket_name", label: "Bucket name", placeholder: "talentiq-media", required: true },
  { name: "access_key_id", label: "Access key ID", placeholder: "", required: true },
  { name: "secret_access_key", label: "Secret access key", placeholder: "", required: true },
  { name: "region", label: "Region", placeholder: "auto (R2) / ap-southeast-2 (AWS)", required: false },
  { name: "endpoint_url", label: "Endpoint URL", placeholder: "https://<account-id>.r2.cloudflarestorage.com (leave blank for real AWS S3)", required: false },
];

function S3Panel() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [showSecret, setShowSecret] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const { data: globalKeys = [] } = useQuery({ queryKey: ["global-keys"], queryFn: authApi.listGlobalKeys });
  const savedKeys = globalKeys.filter((k: any) => k.service === "s3");

  const set = (name: string, value: string) => { setForm((f) => ({ ...f, [name]: value })); setTestResult(null); };
  const requiredFilled = S3_FIELDS.filter((f) => f.required).every((f) => (form[f.name] || "").trim());

  const testMut = useMutation({
    mutationFn: () => systemApi.testS3Connection({
      access_key_id: form.access_key_id || "", secret_access_key: form.secret_access_key || "",
      bucket_name: form.bucket_name || "", region: form.region, endpoint_url: form.endpoint_url,
    }),
    onSuccess: (r) => setTestResult(r),
    onError: (e: any) => setTestResult({ ok: false, message: e?.response?.data?.detail || "Test failed." }),
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      // One row per field, same generic upsert-by-(service,key_name)
      // endpoint the Groq/Ollama/Adzuna panels already use — no bespoke
      // "save all S3 fields" endpoint needed.
      for (const f of S3_FIELDS) {
        const value = (form[f.name] || "").trim();
        if (!value) continue;
        await authApi.saveApiKey({ service: "s3", key_name: f.name, key_value: value, is_global: true });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["global-keys"] });
      setForm({});
      setTestResult(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => authApi.deleteApiKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["global-keys"] }),
  });

  return (
    <div className="tiq-card">
      <div className="tiq-card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Cloud size={16} /> Object Storage (S3 / Cloudflare R2)
      </div>

      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 14px", lineHeight: 1.5 }}>
        Used for video/audio interview recordings — a bucket keeps large media out of the Postgres database
        entirely. Keep the bucket private; the app should always access it via short-lived signed URLs,
        never a public bucket policy.
      </p>

      {S3_FIELDS.map((f) => (
        <div className="tiq-form-group" key={f.name}>
          <label className="tiq-label">{f.label}{f.required && " *"}</label>
          {f.name === "secret_access_key" ? (
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="tiq-input" type={showSecret ? "text" : "password"}
                placeholder={f.placeholder} value={form[f.name] || ""}
                onChange={(e) => set(f.name, e.target.value)}
                style={{ fontFamily: "monospace", fontSize: 12.5 }}
              />
              <button type="button" className="tiq-btn tiq-btn-sm" onClick={() => setShowSecret((s) => !s)} title={showSecret ? "Hide" : "Show"}>
                {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          ) : (
            <input
              className="tiq-input" type="text" placeholder={f.placeholder}
              value={form[f.name] || ""} onChange={(e) => set(f.name, e.target.value)}
              style={{ fontFamily: f.name === "access_key_id" ? "monospace" : undefined, fontSize: f.name === "access_key_id" ? 12.5 : undefined }}
            />
          )}
        </div>
      ))}

      <div style={{ display: "flex", gap: 8 }}>
        <button className="tiq-btn tiq-btn-sm" disabled={!requiredFilled || testMut.isPending} onClick={() => testMut.mutate()}>
          {testMut.isPending ? <Loader2 size={13} className="tiq-spin" /> : null} Test Connection
        </button>
        <button
          className="tiq-btn tiq-btn-primary tiq-btn-sm"
          disabled={!requiredFilled || !testResult?.ok || saveMut.isPending}
          onClick={() => saveMut.mutate()}
          title={!testResult?.ok ? "Test the connection successfully first" : ""}
        >
          {saveMut.isPending ? "Saving…" : "Save"}
        </button>
      </div>

      <ResultBanner result={testResult} />

      {savedKeys.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Currently configured
          </div>
          {savedKeys.map((k: any) => <SavedKeyRow key={k.id} k={k} onDelete={(id) => deleteMut.mutate(id)} />)}
        </div>
      )}
    </div>
  );
}

export default function ApiKeysTab() {
  return (
    <div>
      <DatabasePanel />
      <S3Panel />
    </div>
  );
}
