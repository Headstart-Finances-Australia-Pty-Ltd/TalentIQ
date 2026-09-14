import { useEffect, useState } from "react";
import { RefreshCw, Banknote, AlertTriangle } from "lucide-react";
import { billingApi } from "../../lib/api";

function fmtCents(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

/**
 * Admin Console > Refunds — the manual approval queue routers/billing.py's
 * cancel_plan() defers to. A cancellation calculates the prorated
 * unused-time credit immediately and queues it here (pending_refund_cents)
 * rather than refunding automatically, since it's real cash leaving the
 * account with no offsetting plan change — unlike an upgrade/downgrade
 * mid-cycle switch, which applies credit and moves any leftover
 * automatically because a live plan change is happening in the same
 * transaction. Every row here is a user waiting on an admin to actually
 * fire the Stripe refund (or partially/fully decline it, outside this UI,
 * by editing the row directly in File Manager if a dispute needs that).
 */
export default function RefundsTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmUserId, setConfirmUserId] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    billingApi.adminListPendingRefunds().then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const issueRefund = async (userId: number) => {
    setBusyUserId(userId);
    setMessage(null);
    try {
      const r = await billingApi.adminIssueRefund(userId);
      setMessage({ ok: true, text: `Refunded ${fmtCents(r.refunded_cents)}.` });
      setConfirmUserId(null);
      load();
    } catch (e: any) {
      setMessage({ ok: false, text: e?.response?.data?.detail || "Failed to issue refund." });
    } finally {
      setBusyUserId(null);
    }
  };

  const totalPending = rows.reduce((sum, r) => sum + (r.pending_refund_cents || 0), 0);

  return (
    <div className="tiq-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <div className="tiq-card-title">Pending Refunds</div>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, marginBottom: 0, lineHeight: 1.5, maxWidth: 640 }}>
            Prorated credit from cancelled plans, calculated automatically but held here for manual approval
            before any money actually moves. Upgrades and downgrades apply credit automatically and never
            appear in this list — only cancellations do.
          </p>
        </div>
        <button className="tiq-btn tiq-btn-sm" onClick={load} disabled={loading} style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {!!rows.length && (
        <div style={{ fontSize: 13, fontWeight: 700, margin: "10px 0 16px", color: "var(--text-secondary)" }}>
          {rows.length} pending — {fmtCents(totalPending)} total
        </div>
      )}

      {message && (
        <div className={`tiq-alert ${message.ok ? "tiq-alert-success" : "tiq-alert-error"}`} style={{ marginBottom: 14, fontSize: 13 }}>
          {message.text}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
      ) : !rows.length ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
          Nothing pending — every cancellation refund has been actioned.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => (
            <div key={r.user_id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{r.user_name || r.user_email}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{r.user_email} · was on {r.plan_name}</div>
                {!r.has_payment_record && (
                  <div style={{ fontSize: 11.5, color: "#b45309", display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                    <AlertTriangle size={12} /> No Stripe payment record — must be refunded manually outside this tool
                  </div>
                )}
              </div>
              <div style={{ fontWeight: 800, fontSize: 16, color: "#111827" }}>{fmtCents(r.pending_refund_cents)}</div>
              {confirmUserId === r.user_id ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12.5, color: "#7f1d1d" }}>Refund {fmtCents(r.pending_refund_cents)} via Stripe?</span>
                  <button
                    onClick={() => issueRefund(r.user_id)}
                    disabled={busyUserId === r.user_id}
                    style={{ fontSize: 12.5, fontWeight: 700, color: "#fff", background: "#dc2626", border: "none", borderRadius: 8, padding: "7px 14px", cursor: "pointer" }}
                  >
                    {busyUserId === r.user_id ? "Refunding…" : "Confirm"}
                  </button>
                  <button
                    onClick={() => setConfirmUserId(null)}
                    disabled={busyUserId === r.user_id}
                    style={{ fontSize: 12.5, fontWeight: 700, color: "#374151", background: "none", border: "1px solid #d1d5db", borderRadius: 8, padding: "7px 14px", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmUserId(r.user_id)}
                  disabled={!r.has_payment_record}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700,
                    color: "#fff", background: r.has_payment_record ? "var(--teal-500, #00c7b7)" : "#9ca3af",
                    border: "none", borderRadius: 8, padding: "8px 14px",
                    cursor: r.has_payment_record ? "pointer" : "not-allowed",
                  }}
                >
                  <Banknote size={13} /> Issue Refund
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
