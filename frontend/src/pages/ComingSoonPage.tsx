import { useLocation, Link } from "react-router-dom";
import { CheckCircle2, ArrowLeft, Sparkles } from "lucide-react";
import { findModuleByRoute } from "../lib/capabilities";

export default function ComingSoonPage() {
  const location = useLocation();
  const match = findModuleByRoute(location.pathname);

  if (!match) {
    return (
      <div className="tiq-content">
        <div className="tiq-page-title">Not found</div>
      </div>
    );
  }

  const { capability, module } = match;
  const Icon = module.icon;

  return (
    <div className="tiq-content">
      <div style={{ maxWidth: 720, margin: "40px auto 0" }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 20,
          padding: "6px 14px", borderRadius: 20, background: capability.bg,
          border: `1px solid ${capability.color}40`,
        }}>
          <Icon size={14} color={capability.color} />
          <span style={{ fontSize: 12, fontWeight: 700, color: capability.color, textTransform: "uppercase", letterSpacing: ".05em" }}>
            {capability.emoji} {capability.name}
          </span>
        </div>

        <h1 style={{ fontSize: 32, fontWeight: 800, color: "var(--text-primary)", marginBottom: 10, letterSpacing: "-0.5px" }}>
          {module.tagline}
        </h1>
        <p style={{ fontSize: 15, color: "var(--text-muted)", lineHeight: 1.7, marginBottom: 28, maxWidth: 620 }}>
          {module.desc}
        </p>

        <div className="tiq-card" style={{ padding: 28, marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <Sparkles size={16} color={capability.color} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>What this module will do</span>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
            {module.features.map((f) => (
              <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, color: "var(--text-secondary)" }}>
                <CheckCircle2 size={16} color={capability.color} style={{ flexShrink: 0, marginTop: 1 }} />
                {f}
              </li>
            ))}
          </ul>
        </div>

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap",
          padding: "14px 18px", borderRadius: 12, background: "var(--bg-subtle, #f8fafc)", border: "1px solid var(--border)",
        }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            This capability is being built next, following the same one-capability-at-a-time approach as the rest of the platform.
          </div>
          <Link to="/app" className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ flexShrink: 0 }}>
            <ArrowLeft size={14} /> Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
