import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Building2, UserCheck, Video, DollarSign, TrendingUp, CheckCircle2, ChevronDown, ChevronRight, X } from "lucide-react";
import { governanceApi } from "../lib/api";
import RecruitmentWorkflow from "../components/RecruitmentWorkflow";
import DataTable from "../components/DataTable";

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
          <DataTable
            columns={["client", "role", "value"]}
            columnLabels={{ client: "Client", role: "Role", value: valueLabel }}
            rows={rows.map((r, i) => ({ ...r, _key: i }))}
            getRowKey={(r: any) => r._key}
            renderCell={(r: any, col: string) => {
              switch (col) {
                case "client": return r.client;
                case "role": return <span style={{ fontWeight: 600 }}>{r.role}</span>;
                case "value": return <span style={{ textAlign: "center", fontWeight: 700, color, display: "block" }}>{r.value}</span>;
                default: return null;
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

// Generic large modal shell for a tile's drill-down — same overlay/card
// pattern as TileDetailModal, but takes arbitrary children instead of a
// fixed client/role/value table, for tiles whose drill-down is a richer
// multi-table view (e.g. Clients, Roles Tracked below).
function TileDrilldownModal({ title, color, icon, onClose, children }: {
  title: string; color: string; icon: ReactNode; onClose: () => void; children: ReactNode;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
         onClick={onClose}>
      <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 860, width: "100%", maxHeight: "86vh", overflowY: "auto" }}
           onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 16, color }}>
            {icon} {title}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={18} /></button>
        </div>
        {children}
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
  const [clientFilter, setClientFilter] = useState<string>("");
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [activeOrgId, setActiveOrgId] = useState<number | undefined>(undefined);
  const [openTile, setOpenTile] = useState<string | null>(null);

  // Was a strict waterfall: wait for the org list to fully round-trip,
  // THEN start the (separate) overview request once activeOrgId was set
  // from it — two sequential network calls for what's almost always a
  // single-org user. Now both fire in parallel: the overview query
  // starts immediately with org_id=undefined (the backend already
  // defaults that to the user's own org — see _resolve_org_context), and
  // only refetches with a different org_id if the org list comes back
  // showing they were invited into a DIFFERENT org than their own,
  // which is the less common case.
  const { data: orgs = [] } = useQuery<any[]>({
    queryKey: ["governance-my-organisations"],
    queryFn: governanceApi.listMyOrganisations,
  });
  useEffect(() => {
    if (orgs.length === 0) return;
    const invited = orgs.find((o: any) => o.role !== "Owner");
    const preferredOrgId = invited ? invited.organisation_id : orgs[0]?.organisation_id;
    if (preferredOrgId !== undefined) setActiveOrgId(preferredOrgId);
  }, [orgs]);

  const { data: overview, isLoading: overviewLoading, error: overviewError } = useQuery({
    queryKey: ["dashboard-requisitions-overview", activeOrgId],
    queryFn: () => governanceApi.getRequisitionsOverview(activeOrgId),
    refetchInterval: 30_000,
  });
  const filteredRequisitions = overview ? (clientFilter ? overview.by_requisition.filter((r: any) => r.client_name === clientFilter) : overview.by_requisition) : [];

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <div>
      <div className="tiq-page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h1 className="tiq-page-title">Management Dashboard</h1>
          <p className="tiq-page-sub">Your TalentIQ Solution activity at a glance</p>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600, alignSelf: "flex-end" }}>
          {today}
        </div>
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
          <div style={{ textAlign: "center", padding: 20, color: "var(--rose-500)", fontSize: 12 }}>
            Failed to load business overview.
            {(overviewError as any)?.response?.data?.detail && (
              <div style={{ marginTop: 4, color: "var(--text-muted)" }}>{(overviewError as any).response.data.detail}</div>
            )}
          </div>
        ) : !overview ? (
          <div style={{ textAlign: "center", padding: 28 }}>
            <Building2 size={22} color="var(--text-muted)" style={{ opacity: .5, marginBottom: 6 }} />
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>No requisitions yet — start one from Requisitions.</div>
          </div>
        ) : (
          <>
            {overview.summary.total_requisitions === 0 && (
              <div style={{ textAlign: "center", padding: "0 0 16px", color: "var(--text-muted)", fontSize: 12 }}>
                No requisitions yet — start one from Requisitions. Showing zeros until then.
              </div>
            )}
            {/* Summary stat tiles — all clickable, each opens a drill-down
                (Client/Role breakdown, or a richer multi-table view for
                Clients/Roles Tracked below) built from overview data
                already fetched, no extra calls. Flex-wrap + centered so
                the row wraps onto a second row instead of squeezing
                tiles down as more are added. */}
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12, marginBottom: 20 }}>
              <div style={{ flex: "1 1 150px", maxWidth: 200 }}>
                <DashStat icon={<Building2 size={14} />} label="Open Roles" value={overview.summary.open_count} color="#10b981"
                          onClick={() => setOpenTile("open")} />
              </div>
              <div style={{ flex: "1 1 150px", maxWidth: 200 }}>
                <DashStat icon={<Building2 size={14} />} label="Closed Roles" value={overview.summary.closed_count} color="#64748b"
                          onClick={() => setOpenTile("closed")} />
              </div>
              <div style={{ flex: "1 1 150px", maxWidth: 200 }}>
                <DashStat icon={<Building2 size={14} />} label="Pending" value={overview.summary.pending_count} color="#f59e0b"
                          onClick={() => setOpenTile("pending")} />
              </div>
              <div style={{ flex: "1 1 150px", maxWidth: 200 }}>
                <DashStat icon={<Video size={14} />} label="Avg Interviews / Role" value={overview.summary.avg_interviews_per_role} color="#8b5cf6"
                          onClick={() => setOpenTile("interviews")} />
              </div>
              <div style={{ flex: "1 1 150px", maxWidth: 200 }}>
                <DashStat icon={<DollarSign size={14} />} label="Total Offers" value={overview.summary.total_offers} color="#3b82f6"
                          onClick={() => setOpenTile("offers")} />
              </div>
              <div style={{ flex: "1 1 150px", maxWidth: 200 }}>
                <DashStat icon={<CheckCircle2 size={14} />} label="Offers Accepted" value={overview.summary.offers_by_status?.Accepted || 0} color="#10b981"
                          onClick={() => setOpenTile("accepted")} />
              </div>
              <div style={{ flex: "1 1 150px", maxWidth: 200 }}>
                <DashStat icon={<Building2 size={14} />} label="Clients" value={overview.by_client.length} color="#64748b"
                          onClick={() => setOpenTile("clients")} />
              </div>
              <div style={{ flex: "1 1 150px", maxWidth: 200 }}>
                <DashStat icon={<TrendingUp size={14} />} label="Roles Tracked" value={overview.by_requisition.length} color="#f43f5e"
                          onClick={() => setOpenTile("roles")} />
              </div>
            </div>

            {openTile && openTile !== "clients" && openTile !== "roles" && (() => {
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

            {openTile === "clients" && (
              <TileDrilldownModal title="Roles & Offers by Client" color="#64748b" icon={<Building2 size={18} />} onClose={() => setOpenTile(null)}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                  {/* By client */}
                  <TableCard icon={Building2} color="#64748b" title="Roles &amp; Offers by Client">
                    <div style={{ padding: "10px 16px 0" }}>
                      <select className="tiq-select" style={{ width: "100%", fontSize: 12 }} value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
                        <option value="">All Clients</option>
                        {overview.by_client.map((c: any) => <option key={c.client_name} value={c.client_name}>{c.client_name}</option>)}
                      </select>
                    </div>
                    <DataTable
                      columns={["client_name", "open", "closed", "pending", "offer_count"]}
                      columnLabels={{ client_name: "Client", open: "Open", closed: "Closed", pending: "Pending", offer_count: "Offers" }}
                      rows={clientFilter ? overview.by_client.filter((c: any) => c.client_name === clientFilter) : overview.by_client}
                      getRowKey={(c: any) => c.client_name}
                      renderCell={(c: any, col: string) => {
                        switch (col) {
                          case "client_name": return <span style={{ fontWeight: 600 }}>{c.client_name}</span>;
                          case "open": return <div style={{ textAlign: "center" }}><Pill value={c.open} color="#10b981" /></div>;
                          case "closed": return <div style={{ textAlign: "center" }}><Pill value={c.closed} color="#64748b" /></div>;
                          case "pending": return <div style={{ textAlign: "center" }}><Pill value={c.pending} color="#f59e0b" /></div>;
                          case "offer_count": return <div style={{ textAlign: "center", fontWeight: 700 }}>{c.offer_count}</div>;
                          default: return null;
                        }
                      }}
                    />
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
              </TileDrilldownModal>
            )}

            {openTile === "roles" && (
              <TileDrilldownModal
                title="Sourcing, Screening & Interviews by Role" color="#f43f5e" icon={<TrendingUp size={18} />}
                onClose={() => setOpenTile(null)}
              >
                <div style={{ marginBottom: 12 }}>
                  <select className="tiq-select" style={{ width: 220, fontSize: 12 }} value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
                    <option value="">All Clients</option>
                    {overview.by_client.map((c: any) => <option key={c.client_name} value={c.client_name}>{c.client_name}</option>)}
                  </select>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <DataTable
                    columns={["title", "client_name", "status", "vendor_breakdown", "interview_count", "offer_count"]}
                    columnLabels={{ title: "Role", client_name: "Client", status: "Status", vendor_breakdown: "Vendor Sourcing (Submitted / Screened & Matched)", interview_count: "Interviews", offer_count: "Offers" }}
                    rows={filteredRequisitions}
                    getRowKey={(r: any) => r.requisition_id}
                    emptyMessage={clientFilter ? "No roles for this client." : "No roles yet."}
                    renderCell={(r: any, col: string) => {
                      switch (col) {
                        case "title": return <span style={{ fontWeight: 600 }}>{r.title}</span>;
                        case "client_name": return r.client_name;
                        case "status": return (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                            color: r.status_bucket === "Open" ? "#10b981" : r.status_bucket === "Closed" ? "#64748b" : "#f59e0b",
                            background: r.status_bucket === "Open" ? "rgba(16,185,129,.12)" : r.status_bucket === "Closed" ? "rgba(100,116,139,.12)" : "rgba(245,158,11,.12)",
                          }}>{r.status}</span>
                        );
                        case "vendor_breakdown": return r.vendor_breakdown.length === 0 ? <span style={{ color: "var(--text-muted)" }}>— none sourced —</span> : (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {r.vendor_breakdown.map((v: any) => (
                              <span key={v.vendor_id} className="tiq-badge tiq-badge-slate" style={{ fontSize: 10 }}>
                                {v.vendor_name}: {v.submitted} / {v.accepted}
                              </span>
                            ))}
                          </div>
                        );
                        case "interview_count": return <div style={{ textAlign: "center", fontWeight: 700 }}>{r.interview_count}</div>;
                        case "offer_count": return <div style={{ textAlign: "center", fontWeight: 700 }}>{r.offer_count}</div>;
                        default: return null;
                      }
                    }}
                  />
                </div>
              </TileDrilldownModal>
            )}
          </>
        )}
      </div>

      {/* RECRUITMENT WORKFLOW — moved below Business Overview so the
          numbers come first and the explanatory diagram follows. Still
          collapsed by default (same dropdown-style shrink/expand pattern
          as the per-role table above), mirroring the same diagram shown
          on the landing page. */}
      <div className="tiq-card tiq-mb-6" style={{ padding: 0, overflow: "hidden" }}>
        <button
          onClick={() => setWorkflowOpen((v) => !v)}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
            padding: "16px 24px", background: "none", border: "none", cursor: "pointer", textAlign: "left",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>
            Recruitment Workflow · How Your Hiring Flows Through TalentIQ Solution
          </span>
          {workflowOpen ? <ChevronDown size={16} color="var(--text-muted)" /> : <ChevronRight size={16} color="var(--text-muted)" />}
        </button>
        {workflowOpen && (
          <div style={{ padding: "0 24px 24px" }}>
            <RecruitmentWorkflow compact />
          </div>
        )}
      </div>
    </div>
  );
}