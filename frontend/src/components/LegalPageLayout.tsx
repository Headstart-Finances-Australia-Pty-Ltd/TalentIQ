import { Link } from "react-router-dom";
import { Zap } from "lucide-react";

// Shared chrome for the legal pages linked from the footer's Legal Centre
// (Terms of Use, Privacy Policy, Data Security) — simple header with a way
// back to the site, consistent typography for long-form legal content, and
// a footer link row so a reader can jump between the three without going
// back to the homepage first.
export default function LegalPageLayout({
  title, lastUpdated, children,
}: { title: string; lastUpdated: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#ffffff", color: "#111827" }}>
      <div style={{ borderBottom: "1px solid #e5e7eb", padding: "18px 5%" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link to="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "#5ee8db", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Zap size={14} color="#f97316" fill="#f97316" />
            </div>
            <span style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>TalentIQ</span>
          </Link>
          <Link to="/" style={{ fontSize: 13, color: "#0d9488", textDecoration: "none", fontWeight: 600 }}>← Back to home</Link>
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "48px 5% 80px" }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: "#0d9488", marginBottom: 10 }}>
          Legal Centre
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 6, color: "#0f172a" }}>{title}</h1>
        <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 36 }}>Last updated: {lastUpdated}</div>

        <div className="tiq-legal-content" style={{ fontSize: 15, lineHeight: 1.75, color: "#1f2937" }}>
          {children}
        </div>

        <div style={{ marginTop: 56, paddingTop: 24, borderTop: "1px solid #e5e7eb", display: "flex", gap: 24, flexWrap: "wrap" }}>
          <Link to="/terms" style={{ fontSize: 13, color: "#0d9488", textDecoration: "none" }}>Terms of Use</Link>
          <Link to="/privacy" style={{ fontSize: 13, color: "#0d9488", textDecoration: "none" }}>Privacy Policy</Link>
          <Link to="/data-security" style={{ fontSize: 13, color: "#0d9488", textDecoration: "none" }}>Data Security</Link>
        </div>
      </div>

      <style>{`
        .tiq-legal-content h2 { font-size: 20px; font-weight: 800; color: #0f172a; margin: 36px 0 12px; }
        .tiq-legal-content h3 { font-size: 16px; font-weight: 700; color: #0f172a; margin: 24px 0 8px; }
        .tiq-legal-content p { margin: 0 0 14px; }
        .tiq-legal-content ul, .tiq-legal-content ol { margin: 0 0 14px; padding-left: 22px; }
        .tiq-legal-content li { margin-bottom: 6px; }
        .tiq-legal-content strong { color: #0f172a; }
        .tiq-legal-content a { color: #0d9488; }
      `}</style>
    </div>
  );
}
