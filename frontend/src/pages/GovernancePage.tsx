import { useEffect, useState } from "react";
import {
  LineChart, Users, Clock, Filter, Award, Trash2, UserPlus, X, Shield,
} from "lucide-react";
import { governanceApi } from "../lib/api";

const ROLE_COLORS: Record<string, { fg: string; bg: string }> = {
  Owner: { fg: "#8b5cf6", bg: "rgba(139,92,246,.12)" },
  Manager: { fg: "#0d9488", bg: "rgba(13,148,136,.12)" },
  Recruiter: { fg: "#3b82f6", bg: "rgba(59,130,246,.12)" },
};

export default function GovernancePage() {
  const [tab, setTab] = useState<"reporting" | "team">("reporting");
  const [orgs, setOrgs] = useState<any[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<number | undefined>(undefined);
  const [myRole, setMyRole] = useState<string | null>(null);

  useEffect(() => {
    governanceApi.listMyOrganisations().then((list) => {
      setOrgs(list);
      // Default to an org you were INVITED into, if any — that's a real
      // work context someone explicitly added you to. Every account also
      // owns its own org (lazily created on first use), but defaulting
      // to that first meant an invited team member's dashboard silently
      // showed their own empty org instead of the team they actually
      // work in — confirmed live: a Recruiter with a real requisition in
      // their team's org saw "no requisitions" because this defaulted to
      // their own, unrelated, empty one.
      const invited = list.find((o: any) => o.role !== "Owner");
      setActiveOrgId(invited ? invited.organisation_id : list[0]?.organisation_id);
    });
  }, []);

  useEffect(() => {
    if (activeOrgId === undefined) return;
    governanceApi.getMyRole(activeOrgId).then((r) => setMyRole(r.role));
  }, [activeOrgId]);

  return (
    <div className="tiq-content">
      <div className="tiq-page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="tiq-page-title">Governance</div>
          <div className="tiq-page-sub">Leadership sees the business; permissions match real roles.</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {orgs.length > 1 && (
            <select className="tiq-select" value={activeOrgId ?? ""} onChange={(e) => setActiveOrgId(Number(e.target.value))} title="Switch organisation">
              {orgs.map((o) => <option key={o.organisation_id} value={o.organisation_id}>{o.name} ({o.role})</option>)}
            </select>
          )}
          {myRole && (
            <span style={{
              fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 999,
              color: ROLE_COLORS[myRole]?.fg, background: ROLE_COLORS[myRole]?.bg,
              display: "inline-flex", alignItems: "center", gap: 6,
            }}>
              <Shield size={12} /> You are: {myRole}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16, marginBottom: 16 }}>
        <button className={`tiq-btn tiq-btn-sm ${tab === "reporting" ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setTab("reporting")}>
          <LineChart size={13} /> Reporting
        </button>
        <button className={`tiq-btn tiq-btn-sm ${tab === "team" ? "tiq-btn-primary" : "tiq-btn-outline"}`} onClick={() => setTab("team")}>
          <Users size={13} /> Team &amp; Access
        </button>
      </div>

      {activeOrgId !== undefined && (tab === "reporting" ? <ReportingTab orgId={activeOrgId} /> : <TeamTab myRole={myRole} orgId={activeOrgId} />)}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// REPORTING TAB
// ══════════════════════════════════════════════════════════════════════════

function ReportingTab({ orgId }: { orgId: number }) {
  const [timeToFill, setTimeToFill] = useState<any>(null);
  const [funnel, setFunnel] = useState<any>(null);
  const [sourceOfHire, setSourceOfHire] = useState<any>(null);
  const [recruiterPerf, setRecruiterPerf] = useState<any[]>([]);
  const [vendorPerf, setVendorPerf] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      governanceApi.getTimeToFill(orgId), governanceApi.getFunnel(orgId), governanceApi.getSourceOfHire(orgId),
      governanceApi.getRecruiterPerformance(orgId), governanceApi.getVendorPerformance(orgId),
    ]).then(([ttf, f, soh, rp, vp]) => {
      setTimeToFill(ttf); setFunnel(f); setSourceOfHire(soh); setRecruiterPerf(rp); setVendorPerf(vp);
    }).finally(() => setLoading(false));
  }, [orgId]);

  if (loading) return <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 24 }}>
        <StatCard icon={<Clock size={16} />} label="Avg. Time to Fill" value={timeToFill?.average_days != null ? `${timeToFill.average_days} days` : "—"} sub={`${timeToFill?.filled_requisition_count ?? 0} filled requisitions`} />
        <StatCard icon={<Filter size={16} />} label="Placement Rate" value={funnel?.placement_rate_pct != null ? `${funnel.placement_rate_pct}%` : "—"} sub={`${funnel?.placed ?? 0} of ${funnel?.total_in_pipeline ?? 0} in pipeline`} />
        <StatCard icon={<Filter size={16} />} label="Rejection Rate" value={funnel?.rejection_rate_pct != null ? `${funnel.rejection_rate_pct}%` : "—"} sub={`${funnel?.rejected ?? 0} rejected`} />
        <StatCard icon={<Award size={16} />} label="Total Placed" value={sourceOfHire?.total_placed ?? 0} sub="all-time" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginBottom: 16 }}>
        <div className="tiq-card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Source of Hire</div>
          {!sourceOfHire?.by_source?.length ? <Empty text="No placements yet." /> : sourceOfHire.by_source.map((s: any) => (
            <div key={s.source} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
              <span>{s.source}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 80, height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                  <span style={{ display: "block", width: `${s.pct}%`, height: "100%", background: "#0d9488" }} />
                </span>
                <span style={{ fontWeight: 700, minWidth: 30, textAlign: "right" }}>{s.count}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="tiq-card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Time to Fill by Requisition</div>
          {!timeToFill?.by_requisition?.length ? <Empty text="No filled requisitions yet." /> : timeToFill.by_requisition.slice(0, 8).map((r: any) => (
            <div key={r.requisition_id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
              <span>{r.requisition_title}</span><span style={{ fontWeight: 600 }}>{r.days_to_fill} days</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <div className="tiq-card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Recruiter Performance</div>
          {recruiterPerf.length === 0 ? <Empty text="No candidates owned yet." /> : (
            <table className="tiq-table" style={{ fontSize: 12 }}>
              <thead><tr><th>Recruiter</th><th style={{ textAlign: "center" }}>Candidates</th><th style={{ textAlign: "center" }}>Placements</th></tr></thead>
              <tbody>
                {recruiterPerf.map((r: any) => (
                  <tr key={r.user_id}><td>{r.name}</td><td style={{ textAlign: "center" }}>{r.candidates_owned}</td><td style={{ textAlign: "center", fontWeight: 700 }}>{r.placements}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="tiq-card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Vendor Performance</div>
          {vendorPerf.length === 0 ? <Empty text="No vendor submissions yet." /> : (
            <table className="tiq-table" style={{ fontSize: 12 }}>
              <thead><tr><th>Vendor</th><th style={{ textAlign: "center" }}>Submitted</th><th style={{ textAlign: "center" }}>Accepted</th><th style={{ textAlign: "center" }}>Placements</th></tr></thead>
              <tbody>
                {vendorPerf.map((v: any) => (
                  <tr key={v.vendor_id}><td>{v.vendor_name}</td><td style={{ textAlign: "center" }}>{v.submitted}</td><td style={{ textAlign: "center" }}>{v.accepted} ({v.acceptance_rate_pct}%)</td><td style={{ textAlign: "center", fontWeight: 700 }}>{v.placements}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub: string }) {
  return (
    <div className="tiq-card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>{icon} {label}</div>
      <div style={{ fontSize: 22, fontWeight: 800 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{sub}</div>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{text}</div>;
}

// ══════════════════════════════════════════════════════════════════════════
// TEAM & ACCESS TAB
// ══════════════════════════════════════════════════════════════════════════

function TeamTab({ myRole, orgId }: { myRole: string | null; orgId: number }) {
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", role: "Recruiter" });
  const [inviteError, setInviteError] = useState("");
  const canManage = myRole === "Owner" || myRole === "Manager";

  const load = async () => {
    setLoading(true);
    try { setTeam(await governanceApi.listTeam(orgId)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [orgId]);

  const invite = async () => {
    if (!inviteForm.email.trim()) { setInviteError("Enter an email address."); return; }
    try {
      await governanceApi.inviteMember(inviteForm.email.trim(), inviteForm.role, orgId);
      setShowInvite(false);
      setInviteForm({ email: "", role: "Recruiter" });
      await load();
    } catch (e: any) {
      setInviteError(e?.response?.data?.detail || "Could not add this person to your team.");
    }
  };
  const changeRole = async (membershipId: number, role: string) => {
    try { await governanceApi.changeMemberRole(membershipId, role, orgId); await load(); }
    catch (e: any) { alert(e?.response?.data?.detail || "Could not change this person's role."); }
  };
  const remove = async (membershipId: number, name: string) => {
    if (!confirm(`Remove ${name} from your team?`)) return;
    try { await governanceApi.removeMember(membershipId, orgId); await load(); }
    catch (e: any) { alert(e?.response?.data?.detail || "Could not remove this person."); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 500 }}>
          Owners and Managers see the whole organisation's reporting data; Recruiters see only their own numbers.
        </p>
        {canManage && (
          <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={() => setShowInvite(true)}><UserPlus size={14} /> Add Team Member</button>
        )}
      </div>

      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : (
        <div className="tiq-table-wrap">
          <table className="tiq-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th>{canManage && <th style={{ width: 140 }}>Actions</th>}</tr></thead>
            <tbody>
              {team.map((m: any) => {
                const colors = ROLE_COLORS[m.role] || ROLE_COLORS.Recruiter;
                return (
                  <tr key={m.user_id}>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>{m.name || "—"}</td>
                    <td style={{ fontSize: 12 }}>{m.email}</td>
                    <td>
                      {m.role === "Owner" || !canManage ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: colors.fg, background: colors.bg, padding: "3px 10px", borderRadius: 999 }}>{m.role}</span>
                      ) : (
                        <select className="tiq-select" style={{ fontSize: 12 }} value={m.role} onChange={(e) => changeRole(m.membership_id, e.target.value)}>
                          <option value="Manager">Manager</option>
                          <option value="Recruiter">Recruiter</option>
                        </select>
                      )}
                    </td>
                    {canManage && (
                      <td>
                        {m.role !== "Owner" && (
                          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => remove(m.membership_id, m.name || m.email)}><Trash2 size={12} /></button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showInvite && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 420, width: "94%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Add Team Member</div>
              <button onClick={() => setShowInvite(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            {inviteError && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 12 }}>{inviteError}</div>}
            <div className="tiq-form-group"><label className="tiq-label">Email *</label>
              <input className="tiq-input" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} placeholder="they must already have a TalentIQ Solution account" /></div>
            <div className="tiq-form-group"><label className="tiq-label">Role</label>
              <select className="tiq-select" value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}>
                <option value="Manager">Manager — sees the whole organisation</option>
                <option value="Recruiter">Recruiter — sees only their own numbers</option>
              </select></div>
            <div className="tiq-flex-end">
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setShowInvite(false)}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" onClick={invite}>Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
