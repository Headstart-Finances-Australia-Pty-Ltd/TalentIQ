import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Workflow, UserCheck } from "lucide-react";
import PipelinePage from "./PipelinePage";
import OnboardingTab from "./OnboardingTab";

const TAB_BY_PATH: Record<string, "pipeline" | "onboarding"> = {
  "/app/pipeline": "pipeline",
  "/app/onboarding": "onboarding",
};

// One page, reached via two separate sidebar entries (see
// capabilities.ts's Phase 5) so clicking "Onboarding" in the left pane
// actually lands on Onboarding, not on Pipeline with an extra click
// required. Interview Scheduling and the two new Panel pages moved out
// to their own "Interview" page (InterviewPage.tsx) — Placements now
// covers exactly what comes AFTER an interview decision is made:
// Pipeline & Offers through to Onboarding.
export default function PlacementsPage() {
  const location = useLocation();
  const [tab, setTab] = useState<"pipeline" | "onboarding">(TAB_BY_PATH[location.pathname] || "pipeline");
  useEffect(() => {
    const nextTab = TAB_BY_PATH[location.pathname];
    if (nextTab) setTab(nextTab);
  }, [location.pathname]);

  return (
    <div className="tiq-content">
      <div className="tiq-page-header">
        <div className="tiq-page-title">Placements</div>
        <div className="tiq-page-sub">Candidate moves to hired without leaving the system.</div>
      </div>

      <div className="tiq-tabs" style={{ marginBottom: 20 }}>
        <button className={`tiq-tab${tab === "pipeline" ? " active" : ""}`} onClick={() => setTab("pipeline")}>
          <Workflow size={12} style={{ display: "inline", marginRight: 6 }} /> Pipeline & Offers
        </button>
        <button className={`tiq-tab${tab === "onboarding" ? " active" : ""}`} onClick={() => setTab("onboarding")}>
          <UserCheck size={12} style={{ display: "inline", marginRight: 6 }} /> Onboarding
        </button>
      </div>

      {tab === "pipeline" && <PipelinePage embedded />}
      {tab === "onboarding" && <OnboardingTab />}
    </div>
  );
}
