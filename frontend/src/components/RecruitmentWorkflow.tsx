import { Fragment } from "react";
import { Link } from "react-router-dom";
import { Flag, Play } from "lucide-react";
import { CORE_PIPELINE_CAPABILITIES, SUPPORTING_CAPABILITIES, type Capability } from "../lib/capabilities";

function Bubble({ cap, compact }: { cap: Capability; compact?: boolean }) {
  const built = cap.modules.some((m) => m.built);
  const firstRoute = cap.modules[0]?.route ?? "/app";
  const size = compact ? 44 : 56;
  return (
    <Link to={firstRoute} style={{ textDecoration: "none", flexShrink: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: compact ? 80 : 96 }}>
        <div style={{ position: "relative" }}>
          <div style={{
            width: size, height: size, borderRadius: "50%",
            background: cap.bg, border: `2px solid ${cap.color}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: compact ? 19 : 24, transition: "transform .15s, box-shadow .15s",
            boxShadow: `0 2px 8px ${cap.color}25`,
          }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "scale(1.08)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ""; }}
          >
            {cap.emoji}
          </div>
          <span style={{
            position: "absolute", bottom: -1, right: -1, width: 11, height: 11, borderRadius: "50%",
            background: built ? "#10b981" : "#cbd5e1", border: "2px solid white",
          }} title={built ? "Live" : "Coming soon"} />
        </div>
        <div style={{
          marginTop: 8, fontSize: compact ? 10 : 11, fontWeight: 700, color: "#334155",
          textAlign: "center", lineHeight: 1.25,
        }}>
          {cap.name}
        </div>
      </div>
    </Link>
  );
}

// Non-clickable bookend markers — these aren't capabilities, just the
// pipeline's literal start and finish, styled distinctly (solid dark fill,
// no colored border) so they read as structural rather than a tenth module.
function Endpoint({ label, icon: Icon, compact }: { label: string; icon: typeof Play; compact?: boolean }) {
  const size = compact ? 44 : 56;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: compact ? 66 : 76, flexShrink: 0 }}>
      <div style={{
        width: size, height: size, borderRadius: "50%", background: "#0f172a",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 2px 8px rgba(15,23,42,.25)",
      }}>
        <Icon size={compact ? 17 : 21} color="white" />
      </div>
      <div style={{
        marginTop: 8, fontSize: compact ? 10 : 11, fontWeight: 800, color: "#0f172a",
        textAlign: "center", textTransform: "uppercase", letterSpacing: ".04em",
      }}>
        {label}
      </div>
    </div>
  );
}

// A thick, dark, flexible connector that stretches to fill whatever space
// is available between two bubbles. minWidth:0 is essential here — without
// it, a flex item defaults to min-width:auto, which lets the browser
// silently protect against shrinking below "content size". Mixed with the
// old nested-wrapper layout (bubble+connector grouped per capability),
// that meant each capability's wrapper had a different min-content floor
// than the plain connector segments, so the growth math came out uneven
// (visible as inconsistent gap widths). Flattening every bubble and
// connector into true siblings of ONE row — all connectors identical,
// all bubbles fixed-width — removes that asymmetry entirely.
function Connector({ compact }: { compact?: boolean }) {
  return (
    <div style={{
      flex: "1 1 0%", minWidth: 0, marginTop: compact ? 21 : 27,
      position: "relative", height: 3,
    }}>
      <div style={{ position: "absolute", inset: 0, background: "#334155", borderRadius: 2 }} />
      <div style={{
        position: "absolute", right: -1, top: "50%", transform: "translateY(-50%)",
        width: 0, height: 0,
        borderTop: "6px solid transparent", borderBottom: "6px solid transparent",
        borderLeft: "9px solid #334155",
      }} />
    </div>
  );
}

export default function RecruitmentWorkflow({ compact = false }: { compact?: boolean }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", width: "100%" }}>
        <Endpoint label="Start" icon={Play} compact={compact} />
        <Connector compact={compact} />
        {CORE_PIPELINE_CAPABILITIES.map((cap) => (
          <Fragment key={cap.name}>
            <Bubble cap={cap} compact={compact} />
            <Connector compact={compact} />
          </Fragment>
        ))}
        <Endpoint label="Finish" icon={Flag} compact={compact} />
      </div>

      <div style={{
        textAlign: "center", margin: compact ? "20px 0 14px" : "28px 0 16px",
        fontSize: compact ? 10 : 11, fontWeight: 700, color: "#94a3b8",
        textTransform: "uppercase", letterSpacing: ".06em",
      }}>
        Supporting capabilities — active throughout the pipeline
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: compact ? 4 : 8 }}>
        {SUPPORTING_CAPABILITIES.map((cap) => <Bubble key={cap.name} cap={cap} compact={compact} />)}
      </div>
    </div>
  );
}
