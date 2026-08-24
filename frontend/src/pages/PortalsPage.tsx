import { useEffect, useState } from "react";
import {
  Building2, Truck, Inbox, ClipboardCheck, Link2, Copy, Check, X,
  Trash2, ExternalLink,
} from "lucide-react";
import { portalApi, candidateTrackApi, requisitionApi } from "../lib/api";

export default function PortalsPage() {
  const [tab, setTab] = useState<"clients" | "vendors" | "submissions" | "feedback">("clients");

  return (
    <div className="tiq-content">
      <div className="tiq-page-header">
        <div className="tiq-page-title">Partners</div>
        <div className="tiq-page-sub">Clients and vendors participate directly — no more email back-and-forth.</div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16, marginBottom: 16 }}>
        <button className={`tiq-btn tiq-btn-sm ${tab === "clients" ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setTab("clients")}>
          <Building2 size={13} /> Client Portals
        </button>
        <button className={`tiq-btn tiq-btn-sm ${tab === "vendors" ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setTab("vendors")}>
          <Truck size={13} /> Vendor Portals
        </button>
        <button className={`tiq-btn tiq-btn-sm ${tab === "submissions" ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setTab("submissions")}>
          <Inbox size={13} /> Vendor Submissions
        </button>
        <button className={`tiq-btn tiq-btn-sm ${tab === "feedback" ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setTab("feedback")}>
          <ClipboardCheck size={13} /> Client Feedback
        </button>
      </div>

      {tab === "clients" && <ClientPortalsTab />}
      {tab === "vendors" && <VendorPortalsTab />}
      {tab === "submissions" && <SubmissionsTab />}
      {tab === "feedback" && <FeedbackTab />}
    </div>
  );
}

function copyToClipboard(text: string, onDone: () => void) {
  navigator.clipboard.writeText(text);
  onDone();
}

// ══════════════════════════════════════════════════════════════════════════
// CLIENT PORTALS TAB
// ══════════════════════════════════════════════════════════════════════════

function ClientPortalsTab() {
  const [clients, setClients] = useState<any[]>([]);
  const [tokens, setTokens] = useState<Record<number, any>>({});
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const cl = await candidateTrackApi.listClients();
      setClients(cl);
      const results = await Promise.all(cl.map((c: any) => portalApi.getClientToken(c.id).catch(() => ({ active: false }))));
      const map: Record<number, any> = {};
      cl.forEach((c: any, i: number) => { map[c.id] = results[i]; });
      setTokens(map);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const generate = async (clientId: number) => {
    const res = await portalApi.createClientToken(clientId);
    setTokens((prev) => ({ ...prev, [clientId]: { active: true, ...res } }));
  };
  const revoke = async (clientId: number) => {
    if (!confirm("Revoke this client's portal link? Their existing link will stop working immediately.")) return;
    await portalApi.revokeClientToken(clientId);
    setTokens((prev) => ({ ...prev, [clientId]: { active: false } }));
  };

  if (loading) return <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>;
  if (clients.length === 0) return <div className="tiq-empty">No clients yet — add one in Requisitions first.</div>;

  return (
    <div className="tiq-table-wrap">
      <table className="tiq-table">
        <thead><tr><th>Client</th><th>Portal Link</th><th style={{ width: 160 }}>Actions</th></tr></thead>
        <tbody>
          {clients.map((c: any) => {
            const t = tokens[c.id];
            const fullUrl = t?.active ? `${window.location.origin}${t.portal_path}` : "";
            return (
              <tr key={c.id}>
                <td style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</td>
                <td style={{ fontSize: 12, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t?.active ? fullUrl : <span style={{ color: "var(--text-muted)" }}>No active link</span>}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    {t?.active ? (
                      <>
                        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => copyToClipboard(fullUrl, () => { setCopiedId(c.id); setTimeout(() => setCopiedId(null), 1500); })}>
                          {copiedId === c.id ? <Check size={13} /> : <Copy size={13} />}
                        </button>
                        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => generate(c.id)} title="Rotate (invalidates old link)">Rotate</button>
                        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" style={{ color: "#ef4444" }} onClick={() => revoke(c.id)}>Revoke</button>
                      </>
                    ) : (
                      <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => generate(c.id)}><Link2 size={12} /> Generate Link</button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// VENDOR PORTALS TAB
// ══════════════════════════════════════════════════════════════════════════

function VendorPortalsTab() {
  const [vendors, setVendors] = useState<any[]>([]);
  const [requisitions, setRequisitions] = useState<any[]>([]);
  const [tokens, setTokens] = useState<Record<number, any>>({});
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [assignModal, setAssignModal] = useState<any | null>(null);
  const [assignReqId, setAssignReqId] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [v, r, a] = await Promise.all([candidateTrackApi.listVendors(), requisitionApi.list(), portalApi.listVendorAssignments()]);
      setVendors(v);
      setRequisitions(r);
      setAssignments(a);
      const results = await Promise.all(v.map((x: any) => portalApi.getVendorToken(x.id).catch(() => ({ active: false }))));
      const map: Record<number, any> = {};
      v.forEach((x: any, i: number) => { map[x.id] = results[i]; });
      setTokens(map);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const generate = async (vendorId: number) => {
    const res = await portalApi.createVendorToken(vendorId);
    setTokens((prev) => ({ ...prev, [vendorId]: { active: true, ...res } }));
  };
  const revoke = async (vendorId: number) => {
    if (!confirm("Revoke this vendor's portal link? Their existing link will stop working immediately.")) return;
    await portalApi.revokeVendorToken(vendorId);
    setTokens((prev) => ({ ...prev, [vendorId]: { active: false } }));
  };
  const assign = async () => {
    if (!assignModal || !assignReqId) return;
    await portalApi.assignVendor(assignModal.id, Number(assignReqId));
    setAssignReqId("");
    setAssignModal(null);
    await load();
  };
  const unassign = async (id: number) => {
    await portalApi.removeVendorAssignment(id);
    await load();
  };

  if (loading) return <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>;
  if (vendors.length === 0) return <div className="tiq-empty">No vendors yet — add one first.</div>;

  return (
    <div>
      <div className="tiq-table-wrap">
        <table className="tiq-table">
          <thead><tr><th>Vendor</th><th>Portal Link</th><th>Assigned Requisitions</th><th style={{ width: 200 }}>Actions</th></tr></thead>
          <tbody>
            {vendors.map((v: any) => {
              const t = tokens[v.id];
              const fullUrl = t?.active ? `${window.location.origin}${t.portal_path}` : "";
              const myAssignments = assignments.filter((a) => a.vendor_id === v.id);
              return (
                <tr key={v.id}>
                  <td style={{ fontWeight: 600, fontSize: 13 }}>{v.name}</td>
                  <td style={{ fontSize: 12, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t?.active ? fullUrl : <span style={{ color: "var(--text-muted)" }}>No active link</span>}
                  </td>
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 220 }}>
                      {myAssignments.map((a) => (
                        <span key={a.id} className="tiq-badge tiq-badge-slate" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {a.requisition_title}
                          <X size={10} style={{ cursor: "pointer" }} onClick={() => unassign(a.id)} />
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {t?.active ? (
                        <>
                          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => copyToClipboard(fullUrl, () => { setCopiedId(v.id); setTimeout(() => setCopiedId(null), 1500); })}>
                            {copiedId === v.id ? <Check size={13} /> : <Copy size={13} />}
                          </button>
                          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" style={{ color: "#ef4444" }} onClick={() => revoke(v.id)}>Revoke</button>
                        </>
                      ) : (
                        <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => generate(v.id)}><Link2 size={12} /> Generate Link</button>
                      )}
                      <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setAssignModal(v)}>+ Assign Req</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {assignModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 420, width: "94%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Assign {assignModal.name} to a Requisition</div>
              <button onClick={() => setAssignModal(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <select className="tiq-select" style={{ width: "100%" }} value={assignReqId} onChange={(e) => setAssignReqId(e.target.value)}>
              <option value="">— Select requisition —</option>
              {requisitions.map((r: any) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
            <div className="tiq-flex-end" style={{ marginTop: 16 }}>
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setAssignModal(null)}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" onClick={assign}>Assign</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// VENDOR SUBMISSIONS TAB
// ══════════════════════════════════════════════════════════════════════════

function SubmissionsTab() {
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState("Pending Review");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setSubmissions(await portalApi.listVendorSubmissions(statusFilter || undefined));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [statusFilter]);

  const accept = async (id: number) => {
    try {
      await portalApi.reviewVendorSubmission(id, "accept");
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not accept this submission.");
    }
  };
  const reject = async (id: number) => {
    const reason = prompt("Reason (optional):") || "";
    try {
      await portalApi.reviewVendorSubmission(id, "reject", reason);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not reject this submission.");
    }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["Pending Review", "Accepted", "Rejected", ""].map((s) => (
          <button key={s || "all"} className={`tiq-btn tiq-btn-sm ${statusFilter === s ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setStatusFilter(s)}>
            {s || "All"}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : submissions.length === 0 ? (
        <div className="tiq-empty">No submissions here yet.</div>
      ) : (
        <div className="tiq-table-wrap">
          <table className="tiq-table">
            <thead><tr><th>Candidate</th><th>Vendor</th><th>Requisition</th><th>Resume</th><th>Notes</th><th>Status</th><th style={{ width: 160 }}>Actions</th></tr></thead>
            <tbody>
              {submissions.map((s: any) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600, fontSize: 13 }}>
                    {s.full_name}
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.email} {s.phone}</div>
                  </td>
                  <td style={{ fontSize: 12 }}>{s.vendor_name}</td>
                  <td style={{ fontSize: 12 }}>{s.requisition_title}</td>
                  <td style={{ fontSize: 12 }}>
                    {s.has_resume ? <a href={portalApi.submissionResumeUrl(s.id)} target="_blank" rel="noreferrer">View</a> : "—"}
                  </td>
                  <td style={{ fontSize: 12, maxWidth: 200 }}>{s.vendor_notes}</td>
                  <td><span className="tiq-badge tiq-badge-slate">{s.status}</span></td>
                  <td>
                    {s.status === "Pending Review" && (
                      <div style={{ display: "flex", gap: 4 }}>
                        <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => accept(s.id)}><Check size={12} /> Accept</button>
                        <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ color: "#ef4444" }} onClick={() => reject(s.id)}><X size={12} /> Reject</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// CLIENT FEEDBACK TAB
// ══════════════════════════════════════════════════════════════════════════

function FeedbackTab() {
  const [feedback, setFeedback] = useState<any[]>([]);
  const [showAckd, setShowAckd] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setFeedback(await portalApi.listClientFeedback(showAckd ? undefined : false));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [showAckd]);

  const ack = async (id: number) => {
    await portalApi.acknowledgeFeedback(id);
    await load();
  };

  return (
    <div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 16 }}>
        <input type="checkbox" checked={showAckd} onChange={(e) => setShowAckd(e.target.checked)} />
        Show acknowledged feedback too
      </label>
      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : feedback.length === 0 ? (
        <div className="tiq-empty">No feedback from clients yet.</div>
      ) : (
        feedback.map((f: any) => (
          <div key={f.id} className="tiq-card" style={{ marginBottom: 10, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{f.candidate_name}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>from {f.contact_name || "a client contact"}</div>
              </div>
              <span className="tiq-badge tiq-badge-teal">{f.decision}</span>
            </div>
            {f.comments && <div style={{ fontSize: 13, marginTop: 8 }}>{f.comments}</div>}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{new Date(f.submitted_at).toLocaleString()}</span>
              {!f.acknowledged && (
                <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => ack(f.id)}><ClipboardCheck size={12} /> Mark Acknowledged</button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
