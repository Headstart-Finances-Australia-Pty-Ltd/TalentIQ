import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Briefcase, Phone, Video, CheckCircle } from "lucide-react";
import ResumeScreeningPage from "./ResumeScreeningPage";
import PhoneInterviewPage from "./PhoneInterviewPage";
import VideoInterviewPage from "./VideoInterviewPage";
import FinalDecisionPage from "./FinalDecisionPage";

const TAB_BY_PATH: Record<string, "resume" | "phone" | "video" | "decision"> = {
  "/app/resumescreening": "resume",
  "/app/phoneinterview": "phone",
  "/app/videointerview": "video",
  "/app/finaldecision": "decision",
};

// One page, one left-pane sidebar entry ("Screening"), four tabs —
// mirrors InterviewPage.tsx. Resume Screening -> Phone Interview ->
// Video Interview -> Screening Decision all share the same JobLensPage
// workspace already (via the `mode` prop); this just gives them one
// shared header/tab bar instead of each being its own full page, same
// as Interview Scheduling/Panel Interviewers/Interview Panel/Interview
// Decision under Interview.
export default function ScreeningPage() {
  const location = useLocation();
  const [tab, setTab] = useState<"resume" | "phone" | "video" | "decision">(
    TAB_BY_PATH[location.pathname] || "resume"
  );
  useEffect(() => {
    const nextTab = TAB_BY_PATH[location.pathname];
    if (nextTab) setTab(nextTab);
  }, [location.pathname]);

  return (
    <div className="tiq-content">
      <div className="tiq-page-header">
        <div className="tiq-page-title">Screening</div>
        <div className="tiq-page-sub">AI ranks, scores, and explains every candidate against every role.</div>
      </div>

      <div className="tiq-tabs" style={{ marginBottom: 20 }}>
        <button className={`tiq-tab${tab === "resume" ? " active" : ""}`} onClick={() => setTab("resume")}>
          <Briefcase size={12} style={{ display: "inline", marginRight: 6 }} /> Resume Screening
        </button>
        <button className={`tiq-tab${tab === "phone" ? " active" : ""}`} onClick={() => setTab("phone")}>
          <Phone size={12} style={{ display: "inline", marginRight: 6 }} /> Phone Interview
        </button>
        <button className={`tiq-tab${tab === "video" ? " active" : ""}`} onClick={() => setTab("video")}>
          <Video size={12} style={{ display: "inline", marginRight: 6 }} /> Video Interview
        </button>
        <button className={`tiq-tab${tab === "decision" ? " active" : ""}`} onClick={() => setTab("decision")}>
          <CheckCircle size={12} style={{ display: "inline", marginRight: 6 }} /> Screening Decision
        </button>
      </div>

      {tab === "resume" && <ResumeScreeningPage embedded />}
      {tab === "phone" && <PhoneInterviewPage embedded />}
      {tab === "video" && <VideoInterviewPage embedded />}
      {tab === "decision" && <FinalDecisionPage embedded />}
    </div>
  );
}
