import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Workflow, Video, UserCheck } from "lucide-react";
import PipelinePage from "./PipelinePage";
import InterviewsPage from "./InterviewsPage";
import OnboardingTab from "./OnboardingTab";

const TAB_BY_PATH: Record<string, "pipeline" | "interviews" | "onboarding"> = {
  "/app/pipeline": "pipeline",
  "/app/interviews": "interviews",
  "/app/onboarding": "onboarding",
};

// One page, reached via three separate sidebar entries (see
// capabilities.ts's Phase 5) so clicking "Onboarding" in the left pane
// actually lands on Onboarding, not on Pipeline with an extra click
// required — the tab bar here just lets you move between the three
// once you've arrived, same page and data either way.
export default function PlacementsPage() {
  const location = useLocation();
  const [tab, setTab] = useState<"pipeline" | "interviews" | "onboarding">(
    TAB_BY_PATH[location.pathname] || "pipeline"
  );
  // Guards against React Router NOT remounting this component when
  // navigating between its three sibling routes (pipeline/interviews/
  // onboarding all render the same PlacementsPage) — relying on the
  // useState initializer alone only sets the tab on first mount; without
  // this, clicking a second sidebar link after the first could leave the
  // tab bar stuck showing whichever page you landed on originally.
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
        <button className={`tiq-tab${tab === "interviews" ? " active" : ""}`} onClick={() => setTab("interviews")}>
          <Video size={12} style={{ display: "inline", marginRight: 6 }} /> Interview Scheduling
        </button>
        <button className={`tiq-tab${tab === "pipeline" ? " active" : ""}`} onClick={() => setTab("pipeline")}>
          <Workflow size={12} style={{ display: "inline", marginRight: 6 }} /> Pipeline & Offers
        </button>
        <button className={`tiq-tab${tab === "onboarding" ? " active" : ""}`} onClick={() => setTab("onboarding")}>
          <UserCheck size={12} style={{ display: "inline", marginRight: 6 }} /> Onboarding
        </button>
      </div>

      {tab === "pipeline" && <PipelinePage embedded />}
      {tab === "interviews" && <InterviewsPage embedded />}
      {tab === "onboarding" && <OnboardingTab />}
    </div>
  );
}
