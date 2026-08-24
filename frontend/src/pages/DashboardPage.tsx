import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Building2, UserCheck, Video, DollarSign, TrendingUp, CheckCircle2, ChevronDown, ChevronRight, X } from "lucide-react";
import { governanceApi } from "../lib/api";
import { CAPABILITIES } from "../lib/capabilities";
import RecruitmentWorkflow from "../components/RecruitmentWorkflow";

// Built modules across the recruitment-platform capabilities, in capability
// order — this is what Quick Actions is generated from, so a newly-built
// module (or Talent Pool, which the hardcoded version below was missing)
// shows up automatically instead of the grid silently drifting from the
// rest of the app's navigation.
const QUICK_ACTIONS = CAPABILITIES.flatMap((cap) =>
  cap.modules.filter((m) => m.built).map((m) => ({
    to: m.route, icon: m.icon, title: m.tagline, desc: m.desc,
    color: cap.color, bg: cap.bg, emoji: cap.emoji, name: m.name,
  }))
);

// A colored pill used across every dashboard table for status-style counts.
function Pill({ value, color }: { value: number | string; color: string }) {
  return (
    <span style={{ display: "inline-block", minWidth: 24, padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: `${color}20`, color }}>
      {value}
    </span>
  );
}

// A vibrant stat tile used by the Business Overview section — a soft
// tinted background in the stat's own color, an icon in a matching
// colored badge, and a large bold number. Clickable: opens a detail
// modal breaking the number down by client + role, built from the same
// overview.by_requisition data already on the page — no extra API call.
function DashStat({ icon, label, value, color, onClick }: { icon: ReactNode; label: string; value: number | string; color: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 12, padding: "14px 16px", minWidth: 0,
        background: `linear-gradient(135deg, ${color}1A, ${color}08)`,
        border: `1px solid ${color}30`,
        cursor: onClick ? "pointer" : "default",
        transition: "transform .12s, box-shadow .12s",
      }}
      onMouseEnter={onClick ? (e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLElement).style.boxShadow = `0 6px 16px ${color}25`; } : undefined}
      onMouseLeave={onClick ? (e) => { (e.currentTarget as HTMLElement).style.transform = ""; (e.currentTarget as HTMLElement).style.boxShadow = ""; } : undefined}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 26, height: 26, borderRadius: 8, background: `${color}22`, color, flexShrink: 0,
        }}>
          {icon}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

// Detail modal for a clicked stat tile — a simple Client / Role table,
// filtered from overview.by_requisition per the tile's own meaning.
function TileDetailModal({ title, color, rows, valueLabel, onClose }: {
  title: string; color: string; rows: { client: string; role: string; value: number | string }[];
  valueLabel: string; onClose: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
         onClick={onClose}>
      <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 560, width: "100%", maxHeight: "80vh", overflowY: "auto" }}
           onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280" }}><X size={18} /></button>
        </div>
        {rows.length === 0 ? (
          <div style={{ textAlign: "center", padding: 28, color: "#94a3b8", fontSize: 13 }}>Nothing here yet.</div>
        ) : (
          <table className="tiq-table" style={{ fontSize: 13, width: "100%" }}>
            <thead>
              <tr><th>Client</th><th>Role</th><th style={{ textAlign: "center" }}>{valueLabel}</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.client}</td>
                  <td style={{ fontWeight: 600 }}>{r.role}</td>
                  <td style={{ textAlign: "center", fontWeight: 700, color }}>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// Shared card shell (colored header band + icon + title) used by every
// module's dashboard table, so all four modules look consistent.
function TableCard({ icon: Icon, color, title, children }: { icon: any; color: string; title: string; children: ReactNode }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", background: `linear-gradient(135deg, ${color}14, ${color}03)`, borderBottom: "1px solid var(--border)" }}>
        <Icon size={14} color={color} />
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", textTransform: "uppercase", letterSpacing: ".03em" }}>{title}</span>
      </div>
      <div style={{ overflowX: "auto" }}>{children}</div>
    </div>
  );
}

function EmptyRow({ colSpan, icon: Icon, text }: { colSpan: number; icon: any; text: string }) {
  return (
    <tr><td colSpan={colSpan} style={{ textAlign: "center", padding: "28px 16px" }}>
      <Icon size={22} color="var(--text-muted)" style={{ opacity: .5, marginBottom: 6 }} />
      <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{text}</div>
    </td></tr>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [clientFilter, setClientFilter] = useState<string>("");
  const [rolesByRoleOpen, setRolesByRoleOpen] = useState(false);
  const [rolesByClientOpen, setRolesByClientOpen] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<number | undefined>(undefined);
  const [openTile, setOpenTile] = useState<string | null>(null);

  useEffect(() => {
    governanceApi.listMyOrganisations().then((list) => {
      setOrgs(list);
      // Same default as Governance's own org switcher: prefer an org you
      // were INVITED into over the empty one every account owns by
      // default — see GovernancePage.tsx for the live-reproduced bug
      // this fixes (a team member's dashboard silently showing their
      // own, unrelated, empty org instead of the team they actually
      // work in).
      const invited = list.find((o: any) => o.role !== "Owner");
      setActiveOrgId(invited ? invited.organisation_id : list[0]?.organisation_id);
    });
  }, []);

  const { data: overview, isLoading: overviewLoading, error: overviewError } = useQuery({
    queryKey: ["dashboard-requisitions-overview", activeOrgId],
    queryFn: () => governanceApi.getRequisitionsOverview(activeOrgId),
    enabled: activeOrgId !== undefined,
    refetchInterval: 30_000,
  });
  const filteredRequisitions = overview ? (clientFilter ? overview.by_requisition.filter((r: any) => r.client_name === clientFilter) : overview.by_requisition) : [];

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <div>
      <div className="tiq-page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h1 className="tiq-page-title">Management Dashboard</h1>
          <p className="tiq-page-sub">Your TalentIQ activity at a glance</p>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600, alignSelf: "flex-end" }}>
          {today}
        </div>
      </div>

      {/* RECRUITMENT WORKFLOW — collapsed by default (same dropdown-style
          shrink/expand pattern as the per-role table below), mirroring
          the same diagram shown on the landing page. */}
      <div className="tiq-card tiq-mb-6" style={{ padding: 0, overflow: "hidden" }}>
        <button
          onClick={() => setWorkflowOpen((v) => !v)}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
            padding: "16px 24px", background: "none", border: "none", cursor: "pointer", textAlign: "left",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>
            Recruitment Workflow · How Your Hiring Flows Through TalentIQ
          </span>
          {workflowOpen ? <ChevronDown size={16} color="var(--text-muted)" /> : <ChevronRight size={16} color="var(--text-muted)" />}
        </button>
        {workflowOpen && (
          <div style={{ padding: "0 24px 24px" }}>
            <RecruitmentWorkflow compact />
          </div>
        )}
      </div>

      {/* BUSINESS OVERVIEW — open/closed roles by client, vendor sourcing
          per role, interviews per role (+ org-wide average), and offers
          by client/role with their acceptance-status breakdown. Pulls
          from Governance's requisitions-overview endpoint, which is
          itself computed live from Requisition/VendorSubmission/
          Interview/Offer — nothing duplicated here, this section just
          surfaces it on the dashboard where it's asked for first,
          instead of only living inside Governance -> Reporting. */}
      <div className="tiq-card tiq-mb-6" style={{ borderLeft: "4px solid #64748b" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
            Business Overview
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {orgs.length > 1 && (
              <select className="tiq-select" style={{ fontSize: 12 }} value={activeOrgId ?? ""} onChange={(e) => setActiveOrgId(Number(e.target.value))} title="Switch organisation">
                {orgs.map((o) => <option key={o.organisation_id} value={o.organisation_id}>{o.name} ({o.role})</option>)}
              </select>
            )}
            <Link to="/app/reporting" style={{ fontSize: 12, color: "var(--text-muted)", textDecoration: "none" }}>
              Full report in Governance →
            </Link>
          </div>
        </div>

        {overviewLoading ? (
          <div style={{ textAlign: "center", padding: 28, color: "var(--text-muted)" }}>Loading…</div>
        ) : overviewError ? (
          <div style={{ textAlign: "center", padding: 20, color: "var(--rose-500)", fontSize: 12 }}>Failed to load business overview.</div>
        ) : !overview || overview.summary.total_requisitions === 0 ? (
          <div style={{ textAlign: "center", padding: 28 }}>
            <Building2 size={22} color="var(--text-muted)" style={{ opacity: .5, marginBottom: 6 }} />
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>No requisitions yet — start one from Requisitions.</div>
          </div>
        ) : (
          <>
            {/* Summary stat row — all 6 in one line; each is clickable
                and opens a Client/Role breakdown built from
                overview.by_requisition (already fetched, no extra call). */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 12, marginBottom: 20 }}>
              <DashStat icon={<Building2 size={14} />} label="Open Roles" value={overview.summary.open_count} color="#10b981"
                        onClick={() => setOpenTile("open")} />
              <DashStat icon={<Building2 size={14} />} label="Closed Roles" value={overview.summary.closed_count} color="#64748b"
                        onClick={() => setOpenTile("closed")} />
              <DashStat icon={<Building2 size={14} />} label="Pending" value={overview.summary.pending_count} color="#f59e0b"
                        onClick={() => setOpenTile("pending")} />
              <DashStat icon={<Video size={14} />} label="Avg Interviews / Role" value={overview.summary.avg_interviews_per_role} color="#8b5cf6"
                        onClick={() => setOpenTile("interviews")} />
              <DashStat icon={<DollarSign size={14} />} label="Total Offers" value={overview.summary.total_offers} color="#3b82f6"
                        onClick={() => setOpenTile("offers")} />
              <DashStat icon={<CheckCircle2 size={14} />} label="Offers Accepted" value={overview.summary.offers_by_status?.Accepted || 0} color="#10b981"
                        onClick={() => setOpenTile("accepted")} />
            </div>

            {openTile && (() => {
              const configs: Record<string, { title: string; color: string; valueLabel: string; rows: { client: string; role: string; value: number | string }[] }> = {
                open: {
                  title: "Open Roles", color: "#10b981", valueLabel: "Status",
                  rows: overview.by_requisition.filter((r: any) => r.status_bucket === "Open")
                    .map((r: any) => ({ client: r.client_name, role: r.title, value: r.status })),
                },
                closed: {
                  title: "Closed Roles", color: "#64748b", valueLabel: "Status",
                  rows: overview.by_requisition.filter((r: any) => r.status_bucket === "Closed")
                    .map((r: any) => ({ client: r.client_name, role: r.title, value: r.status })),
                },
                pending: {
                  title: "Pending Roles", color: "#f59e0b", valueLabel: "Status",
                  rows: overview.by_requisition.filter((r: any) => r.status_bucket === "Pending")
                    .map((r: any) => ({ client: r.client_name, role: r.title, value: r.status })),
                },
                interviews: {
                  title: "Interviews by Role", color: "#8b5cf6", valueLabel: "Interviews",
                  rows: overview.by_requisition.filter((r: any) => r.interview_count > 0)
                    .map((r: any) => ({ client: r.client_name, role: r.title, value: r.interview_count })),
                },
                offers: {
                  title: "Offers by Role", color: "#3b82f6", valueLabel: "Offers",
                  rows: overview.by_requisition.filter((r: any) => r.offer_count > 0)
                    .map((r: any) => ({ client: r.client_name, role: r.title, value: r.offer_count })),
                },
                accepted: {
                  title: "Offers Accepted by Role", color: "#10b981", valueLabel: "Accepted",
                  rows: overview.by_requisition.filter((r: any) => (r.offers_by_status?.Accepted || 0) > 0)
                    .map((r: any) => ({ client: r.client_name, role: r.title, value: r.offers_by_status.Accepted })),
                },
              };
              const cfg = configs[openTile];
              return <TileDetailModal title={cfg.title} color={cfg.color} valueLabel={cfg.valueLabel} rows={cfg.rows} onClose={() => setOpenTile(null)} />;
            })()}

            <div style={{ marginTop: 20, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
              <button
                onClick={() => setRolesByClientOpen((v) => !v)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                  padding: "12px 16px", background: "linear-gradient(135deg, #64748b14, #64748b03)",
                  border: "none", cursor: "pointer", textAlign: "left",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Building2 size={14} color="#64748b" />
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", textTransform: "uppercase", letterSpacing: ".03em" }}>
                    Roles &amp; Offers by Client
                  </span>
                </div>
                {rolesByClientOpen ? <ChevronDown size={16} color="var(--text-muted)" /> : <ChevronRight size={16} color="var(--text-muted)" />}
              </button>
              {rolesByClientOpen && (
                <div style={{ padding: 20 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                    {/* By client */}
                    <TableCard icon={Building2} color="#64748b" title="Roles &amp; Offers by Client">
                      <div style={{ padding: "10px 16px 0" }}>
                        <select className="tiq-select" style={{ width: "100%", fontSize: 12 }} value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
                          <option value="">All Clients</option>
                          {overview.by_client.map((c: any) => <option key={c.client_name} value={c.client_name}>{c.client_name}</option>)}
                        </select>
                      </div>
                      <table className="tiq-table" style={{ fontSize: 12, width: "100%" }}>
                        <thead>
                          <tr>
                            <th>Client</th>
                            <th style={{ textAlign: "center" }}>Open</th>
                            <th style={{ textAlign: "center" }}>Closed</th>
                            <th style={{ textAlign: "center" }}>Pending</th>
                            <th style={{ textAlign: "center" }}>Offers</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(clientFilter ? overview.by_client.filter((c: any) => c.client_name === clientFilter) : overview.by_client).map((c: any) => (
                            <tr key={c.client_name}>
                              <td style={{ fontWeight: 600 }}>{c.client_name}</td>
                              <td style={{ textAlign: "center" }}><Pill value={c.open} color="#10b981" /></td>
                              <td style={{ textAlign: "center" }}><Pill value={c.closed} color="#64748b" /></td>
                              <td style={{ textAlign: "center" }}><Pill value={c.pending} color="#f59e0b" /></td>
                              <td style={{ textAlign: "center", fontWeight: 700 }}>{c.offer_count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableCard>

                    {/* Offer acceptance status, org-wide */}
                    <TableCard icon={UserCheck} color="#3b82f6" title="Offer Acceptance Status">
                      {Object.keys(overview.summary.offers_by_status || {}).length === 0 ? (
                        <EmptyRow colSpan={1} icon={UserCheck} text="No offers made yet" />
                      ) : (
                        <div style={{ padding: 16 }}>
                          {Object.entries(overview.summary.offers_by_status).map(([status, count]: [string, any]) => (
                            <div key={status} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 4px", borderBottom: "1px solid var(--border)" }}>
                              <span style={{ fontSize: 12 }}>{status}</span>
                              <Pill value={count} color={status === "Accepted" ? "#10b981" : status === "Rejected" ? "#ef4444" : status === "Sent" ? "#3b82f6" : "#64748b"} />
                            </div>
                          ))}
                        </div>
                      )}
                    </TableCard>
                  </div>
                </div>
              )}
            </div>

            {/* Per-role detail: vendor sourcing + screening + interviews +
                offers — collapsed by default (this table has one row per
                role, so it can get long fast) and expanded via the
                dropdown-style header below. */}
            <div style={{ marginTop: 20, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
              <button
                onClick={() => setRolesByRoleOpen((v) => !v)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                  padding: "12px 16px", background: "linear-gradient(135deg, #f43f5e14, #f43f5e03)",
                  border: "none", cursor: "pointer", textAlign: "left",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <TrendingUp size={14} color="#f43f5e" />
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", textTransform: "uppercase", letterSpacing: ".03em" }}>
                    Sourcing, Screening &amp; Interviews by Role
                  </span>
                  <span className="tiq-badge tiq-badge-slate" style={{ fontSize: 10 }}>{filteredRequisitions.length}</span>
                </div>
                {rolesByRoleOpen ? <ChevronDown size={16} color="var(--text-muted)" /> : <ChevronRight size={16} color="var(--text-muted)" />}
              </button>
              {rolesByRoleOpen && (
                <div style={{ overflowX: "auto" }}>
                  <table className="tiq-table" style={{ fontSize: 12, width: "100%" }}>
                    <thead>
                      <tr>
                        <th>Role</th>
                        <th>Client</th>
                        <th>Status</th>
                        <th>Vendor Sourcing (Submitted / Screened &amp; Matched)</th>
                        <th style={{ textAlign: "center" }}>Interviews</th>
                        <th style={{ textAlign: "center" }}>Offers</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRequisitions.length === 0 ? (
                        <EmptyRow colSpan={6} icon={TrendingUp} text={clientFilter ? "No roles for this client." : "No roles yet."} />
                      ) : filteredRequisitions.map((r: any) => (
                        <tr key={r.requisition_id}>
                          <td style={{ fontWeight: 600 }}>{r.title}</td>
                          <td>{r.client_name}</td>
                          <td>
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                              color: r.status_bucket === "Open" ? "#10b981" : r.status_bucket === "Closed" ? "#64748b" : "#f59e0b",
                              background: r.status_bucket === "Open" ? "rgba(16,185,129,.12)" : r.status_bucket === "Closed" ? "rgba(100,116,139,.12)" : "rgba(245,158,11,.12)",
                            }}>{r.status}</span>
                          </td>
                          <td>
                            {r.vendor_breakdown.length === 0 ? <span style={{ color: "var(--text-muted)" }}>— none sourced —</span> : (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {r.vendor_breakdown.map((v: any) => (
                                  <span key={v.vendor_id} className="tiq-badge tiq-badge-slate" style={{ fontSize: 10 }}>
                                    {v.vendor_name}: {v.submitted} / {v.accepted}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: "center", fontWeight: 700 }}>{r.interview_count}</td>
                          <td style={{ textAlign: "center", fontWeight: 700 }}>{r.offer_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* QUICK ACTIONS — a compact dropdown instead of a full card grid;
          still derived from the same capability config as the sidebar/
          landing page, so it can never silently drift out of sync. */}
      <div className="tiq-card tiq-mb-6" style={{ padding: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12 }}>
          Quick Actions
        </div>
        <select
          className="tiq-select"
          style={{ width: "100%", maxWidth: 420 }}
          defaultValue=""
          onChange={(e) => { if (e.target.value) navigate(e.target.value); }}
        >
          <option value="" disabled>Jump to a module…</option>
          {QUICK_ACTIONS.map((item) => (
            <option key={item.to} value={item.to}>{item.emoji} {item.name} — {item.title}</option>
          ))}
        </select>
      </div>
    </div>
  );
}