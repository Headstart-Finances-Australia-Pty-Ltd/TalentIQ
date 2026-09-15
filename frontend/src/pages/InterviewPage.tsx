import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Users, Users2, Video, Gavel } from "lucide-react";
import PanelInterviewersPage from "./PanelInterviewersPage";
import InterviewPanelPage from "./InterviewPanelPage";
import InterviewsPage from "./InterviewsPage";
import InterviewDecisionPage from "./InterviewDecisionPage";

const TAB_BY_PATH: Record<string, "panel-interviewers" | "interview-panel" | "scheduling" | "decision"> = {
  "/app/interview": "scheduling",
  "/app/interview/panel-interviewers": "panel-interviewers",
  "/app/interview/interview-panel": "interview-panel",
  "/app/interview/scheduling": "scheduling",
  "/app/interview/decision": "decision",
};

// One page, one left-pane sidebar entry ("Interview"), four tabs —
// everything to do with interview rounds now lives here instead of
// being split across Placements (Interview Scheduling used to be a tab
// there) and nowhere in particular (Panel Interviewers/Interview Panel
// were new additions with no natural home yet). Placements now covers
// exactly what comes AFTER a decision is made: Pipeline & Offers and
// Onboarding.
export default function InterviewPage() {
  const location = useLocation();
  const [tab, setTab] = useState<"panel-interviewers" | "interview-panel" | "scheduling" | "decision">(
    TAB_BY_PATH[location.pathname] || "scheduling"
  );
  useEffect(() => {
    const nextTab = TAB_BY_PATH[location.pathname];
    if (nextTab) setTab(nextTab);
  }, [location.pathname]);

  return (
    <div className="tiq-content">
      <div className="tiq-page-header">
        <div className="tiq-page-title">Interview</div>
        <div className="tiq-page-sub">Panels, scheduling, and decisions — everything for a candidate's interview rounds.</div>
      </div>

      <div className="tiq-tabs" style={{ marginBottom: 20 }}>
        <button className={`tiq-tab${tab === "scheduling" ? " active" : ""}`} onClick={() => setTab("scheduling")}>
          <Video size={12} style={{ display: "inline", marginRight: 6 }} /> Interview Scheduling
        </button>
        <button className={`tiq-tab${tab === "panel-interviewers" ? " active" : ""}`} onClick={() => setTab("panel-interviewers")}>
          <Users size={12} style={{ display: "inline", marginRight: 6 }} /> Panel Interviewers
        </button>
        <button className={`tiq-tab${tab === "interview-panel" ? " active" : ""}`} onClick={() => setTab("interview-panel")}>
          <Users2 size={12} style={{ display: "inline", marginRight: 6 }} /> Interview Panel
        </button>
        <button className={`tiq-tab${tab === "decision" ? " active" : ""}`} onClick={() => setTab("decision")}>
          <Gavel size={12} style={{ display: "inline", marginRight: 6 }} /> Interview Decision
        </button>
      </div>

      {tab === "scheduling" && <InterviewsPage embedded />}
      {tab === "panel-interviewers" && <PanelInterviewersPage embedded />}
      {tab === "interview-panel" && <InterviewPanelPage embedded />}
      {tab === "decision" && <InterviewDecisionPage embedded />}
    </div>
  );
}
