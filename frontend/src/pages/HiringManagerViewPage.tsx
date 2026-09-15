import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Zap, Check, X, Briefcase } from "lucide-react";
import { publicRequisitionApi } from "../lib/api";

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  Draft: { fg: "#64748b", bg: "#f1f5f9" },
  Approved: { fg: "#0d9488", bg: "#ccfbf1" },
  Open: { fg: "#10b981", bg: "#d1fae5" },
  "On Hold": { fg: "#f59e0b", bg: "#fef3c7" },
  Filled: { fg: "#3b82f6", bg: "#dbeafe" },
  Cancelled: { fg: "#ef4444", bg: "#fee2e2" },
};

export default function HiringManagerViewPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    publicRequisitionApi.hmView(token)
      .then(setData)
      .catch(() => setError("This link is invalid or has expired."));
  }, [token]);

  const shellStyle: React.CSSProperties = {
    minHeight: "100vh", background: "#f8fafd", display: "flex", justifyContent: "center", padding: "48px 16px",
  };
  const cardStyle: React.CSSProperties = {
    background: "#fff", borderRadius: 16, padding: 32, maxWidth: 560, width: "100%",
    boxShadow: "0 1px 3px rgba(0,0,0,.08)", border: "1px solid #e5e9f0",
  };

  if (error) return <div style={shellStyle}><div style={cardStyle}>{error}</div></div>;
  if (!data) return <div style={shellStyle}><div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div></div>;

  const statusColor = STATUS_COLORS[data.status] || STATUS_COLORS.Draft;
  const checklistItems = [
    ["salary_approved", "Salary approved"],
    ["headcount_approved", "Headcount approved"],
    ["jd_approved", "JD approved"],
    ["location_confirmed", "Location confirmed"],
  ];

  return (
    <div style={shellStyle}>
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <Zap size={18} color="#f97316" fill="#f97316" />
          <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text-muted)" }}>Requisition Status</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <Briefcase size={20} color="#334155" />
          <div style={{ fontWeight: 800, fontSize: 22 }}>{data.title}</div>
        </div>
        {data.client_name && <div style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 16 }}>{data.client_name}</div>}

        <span style={{
          display: "inline-block", padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 700,
          background: statusColor.bg, color: statusColor.fg, marginBottom: 24,
        }}>
          {data.status}
        </span>

        <div className="tiq-grid-2" style={{ fontSize: 13, marginBottom: 24 }}>
          <div><div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 2 }}>Priority</div><div>{data.priority}</div></div>
          <div><div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 2 }}>Vacancies</div><div>{data.vacancy_count}</div></div>
          <div><div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 2 }}>Employment Type</div><div>{data.employment_type || "—"}</div></div>
          <div><div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 2 }}>Location</div><div>{data.location || "—"}</div></div>
          {data.jd_title && (
            <div style={{ gridColumn: "1 / -1" }}><div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 2 }}>Job Description</div><div>{data.jd_title}</div></div>
          )}
          {data.target_hire_date && (
            <div><div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 2 }}>Target Hire Date</div><div>{new Date(data.target_hire_date).toLocaleDateString()}</div></div>
          )}
        </div>

        <div style={{ borderTop: "1px solid #e5e9f0", paddingTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 10 }}>
            Intake Checklist
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {checklistItems.map(([field, label]) => (
              <div key={field} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                {data.checklist?.[field] ? <Check size={15} color="#10b981" /> : <X size={15} color="#cbd5e1" />}
                <span style={{ color: data.checklist?.[field] ? "var(--text-primary)" : "var(--text-muted)" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 24, fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
          This is a read-only status view — contact your recruiter for updates or questions.
        </div>
      </div>
    </div>
  );
}
