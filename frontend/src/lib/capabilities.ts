import type { LucideIcon } from "lucide-react";
import {
  UserPlus, Users, FileEdit, ClipboardList, Briefcase, BrainCircuit, BarChart2,
  Video, Workflow, Building2, MessageSquare, Receipt, LineChart, Phone, CheckCircle,
} from "lucide-react";

export type CapabilityModule = {
  name: string;
  route: string;
  icon: LucideIcon;
  emoji?: string;
  tagline: string;
  desc: string;
  features: string[];
  built: boolean;
};

export type Capability = {
  phase: string;
  name: string;
  emoji: string;
  color: string;
  bg: string;
  summary: string;
  modules: CapabilityModule[];
};

// The full nine-capability architecture, ordered to match the real hiring
// workflow (Requisitions → Talent Pool → Screening → Interviews →
// Placements, then the four supporting capabilities) — NOT the order they
// were built in. Every capability has a real, permanent place in the
// product now — modules not built yet route to a placeholder page instead
// of a dead link, and get filled in without the navigation structure
// changing underneath them.
export const CAPABILITIES: Capability[] = [
  {
    phase: "Phase 2", name: "Requisitions", emoji: "📋", color: "#0d9488", bg: "rgba(13,148,136,.10)",
    summary: "A job doesn't exist until it's a structured, approved, owned object.",
    modules: [
      {
        name: "Requisitions", route: "/app/requisitions", icon: ClipboardList, emoji: "📋", built: true,
        tagline: "Approval workflow for every open role",
        desc: "Turn a JD into an owned, approved requisition — headcount, budget, hiring manager, and priority tracked from Draft through to Filled.",
        features: ["Draft → Approved → Open → Filled workflow", "Recruiter & hiring-manager ownership", "Vacancy count & priority", "Intake checklist"],
      },
      {
        name: "JD Creator", route: "/app/jdcreator", icon: FileEdit, built: true,
        tagline: "AI-generated job descriptions in seconds",
        desc: "Enter a role title, required skills, experience, and education — get a formal, professionally-written Position Description, ready to download as Word.",
        features: ["AI-written purpose & responsibilities", "Company branding from your profile", "One-click Word (.docx) download", "Saved JD history"],
      },
    ],
  },
  {
    phase: "Phase 1", name: "Talent Pool", emoji: "🎯", color: "#00c7b7", bg: "rgba(0,199,183,.12)",
    summary: "Every candidate, from every channel, in one reusable record.",
    modules: [
      {
        name: "Talent Pool", route: "/app/acquisition", icon: UserPlus, built: true,
        tagline: "Every candidate, one record, reusable forever",
        desc: "Candidates come in from a public careers page, bulk resume/cover-letter folder import, CSV, or manual entry — all landing in one deduplicated record, reusable across every future role.",
        features: ["Public careers page + apply link", "Bulk folder import (resumes + cover letters)", "Duplicate detection & merge", "Talent pools & tags"],
      },
      {
        name: "LinkExplore", route: "/app/linklens", icon: Users, built: true,
        tagline: "LinkedIn candidate search at scale",
        desc: "Search LinkedIn at scale. Find candidates by title, location, and skills, extract structured profiles and contact details.",
        features: ["Playwright-powered LinkedIn scraping", "Structured profile extraction", "Email pattern guessing", "Bulk candidate export"],
      },
    ],
  },
  {
    phase: "Phase 3", name: "Screening", emoji: "🔍", color: "#fb923c", bg: "rgba(251,146,60,.10)",
    summary: "AI ranks, scores, and explains every candidate against every role.",
    modules: [
      {
        name: "Resume Screening", route: "/app/resumescreening", icon: Briefcase, built: true,
        tagline: "AI-ranked CVs against a job description",
        desc: "Upload a JD and multiple CVs. AI ranks candidates by ATS score, explains matched vs missing skills, and shortlists who moves on to Phone Interview.",
        features: ["Multi-CV batch scoring", "Matched vs missing skills", "Shortlisting & re-weighting", "Excel export"],
      },
      {
        name: "Phone Interview", route: "/app/phoneinterview", icon: Phone, built: true,
        tagline: "AI call questions, recruiter-logged outcomes",
        desc: "For candidates shortlisted in Resume Screening: AI-generated phone screening questions, plus a simple recommendation and notes once the call happens.",
        features: ["AI-generated screening questions", "Contacted / outcome tracking", "Proceed, Hold, or Reject recommendation", "Call notes"],
      },
      {
        name: "Video Interview", route: "/app/videointerview", icon: Video, built: true,
        tagline: "Webcam interviews with live emotion analysis",
        desc: "Webcam-based AI video interviews with real-time emotion analysis, auto-scored transcripts, and full playback — for candidates who've passed Phone Interview.",
        features: ["Webcam video interviews", "Live emotion analysis", "AI-scored transcript & Q&A", "Recording playback"],
      },
      {
        name: "Final Decision", route: "/app/finaldecision", icon: CheckCircle, built: true,
        tagline: "Resume, phone, and video scores — one final call",
        desc: "Every candidate's Resume Screening, Phone Interview, and Video Interview scores side by side, with a single Shortlist column to record the final hire/no-hire decision.",
        features: ["Resume Screening score", "Phone Interview outcome", "Video Interview score", "Final Shortlist decision"],
      },
      {
        name: "MarketIntel", route: "/app/jobintel", icon: BarChart2, built: true,
        tagline: "Job market intelligence & salary analytics",
        desc: "Turn hundreds of job postings into market signals. Track skill demand, salary trends, and hiring patterns to advise clients and set expectations.",
        features: ["Skill & tool demand ranking", "Salary range extraction", "Experience level breakdown", "Domain & company-type split"],
      },
    ],
  },
  {
    phase: "Phase 4", name: "Interviews", emoji: "🎥", color: "#8b5cf6", bg: "rgba(139,92,246,.10)",
    summary: "From \"let's interview them\" to a recorded decision.",
    modules: [
      {
        name: "Interview Scheduling", route: "/app/interviews", icon: Video, built: true,
        tagline: "Phone → Video → Panel, scored and decided",
        desc: "A structured round sequence — Phone Interview, Video Interview, then Panel Interview — with interviewers, time/place/artifacts tracked per round, online approval by a designated authority, and panel decisions by majority vote.",
        features: ["Phone → Video → Panel round classes", "Interviewers assigned per round", "Online approval/cancellation by a designated authority", "Majority-vote round decisions, auto-applied"],
      },
    ],
  },
  {
    phase: "Phase 5", name: "Placements", emoji: "🚀", color: "#f43f5e", bg: "rgba(244,63,94,.10)",
    summary: "Candidate moves to hired without leaving the system.",
    modules: [
      {
        name: "Pipeline & Offers", route: "/app/pipeline", icon: Workflow, built: true,
        tagline: "A configurable pipeline from submission to placement",
        desc: "A Kanban pipeline with stages configurable per client or requisition, offer tracking with approvals, and placement records — the full close-out of a hire.",
        features: ["Configurable Kanban stages", "Submission & ownership tracking", "Offer approval & expiry", "Placement & guarantee period"],
      },
    ],
  },
  {
    phase: "Phase 6", name: "Partners", emoji: "🤝", color: "#3b82f6", bg: "rgba(59,130,246,.10)",
    summary: "Clients and vendors participate directly — no more email back-and-forth.",
    modules: [
      {
        name: "Client & Vendor Portals", route: "/app/portals", icon: Building2, built: true,
        tagline: "Clients and vendors, inside the platform",
        desc: "A client portal to review, approve, and give feedback on candidates, and a vendor portal to submit candidates and track status — with document access controlled per audience.",
        features: ["Client candidate review & approval", "Vendor submission portal", "Feedback & interview requests", "Scoped document access"],
      },
    ],
  },
  {
    phase: "Phase 7", name: "Comms", emoji: "💬", color: "#eab308", bg: "rgba(234,179,8,.10)",
    summary: "Every meaningful action logged automatically, in one place.",
    modules: [
      {
        name: "Communication Hub", route: "/app/communication", icon: MessageSquare, built: true,
        tagline: "Templated email, timelines, and automation",
        desc: "Send and log templated emails tied to every candidate and client, a unified activity timeline, and automation triggers that remove the manual admin recruiters do today.",
        features: ["Templated email send + log", "Unified candidate/client timeline", "Automation triggers", "Recruiter daily workbench"],
      },
    ],
  },
  {
    phase: "Phase 8", name: "Commercials", emoji: "💰", color: "#14b8a6", bg: "rgba(20,184,166,.10)",
    summary: "The money side of a placement, tracked inside the platform.",
    modules: [
      {
        name: "Billing & Placements", route: "/app/commercials", icon: Receipt, built: true,
        tagline: "Placement fees, invoices, and guarantees",
        desc: "Track placement fees, single-line invoicing, and guarantee/rebate deadlines — the essentials an agency needs without a full accounting system.",
        features: ["Placement fee & invoice tracking", "Guarantee / rebate deadline alerts", "Contractor timesheets (optional)", "Revenue by placement"],
      },
    ],
  },
  {
    phase: "Phase 9", name: "Governance", emoji: "📊", color: "#64748b", bg: "rgba(100,116,139,.10)",
    summary: "Leadership sees the business; permissions match real roles.",
    modules: [
      {
        name: "Reporting & Access", route: "/app/reporting", icon: LineChart, built: true,
        tagline: "Metrics and role-based dashboards",
        desc: "Time-to-fill, funnel conversion, and source-of-hire — real counted metrics, not predictions — plus role-scoped dashboards for recruiters, managers, and agency owners.",
        features: ["Time-to-fill & funnel conversion", "Source-of-hire tracking", "Role-based dashboards", "Recruiter & vendor performance"],
      },
    ],
  },
];

export const JOBSEEKER_MODULES: CapabilityModule[] = [
  {
    name: "JobHunter", route: "/app/jobhunt", icon: Users, emoji: "🔎", built: true,
    tagline: "AI-powered job search & resume matching",
    desc: "Upload your resume, set your criteria, and let AI scrape live jobs, score your ATS fit, and draft personalised cover letters.",
    features: ["Live job scraping via Adzuna API", "ATS resume scoring 0–100%", "AI cover letter generation", "One-click Excel export"],
  },
  {
    name: "CVAnalysis", route: "/app/cvintel", icon: BrainCircuit, emoji: "📄", built: true,
    tagline: "ATS resume analyser & gap finder",
    desc: "Score your own resume against a job description instantly. Get matched skills, missing skills, and AI-powered improvement suggestions.",
    features: ["Instant ATS keyword scoring", "Matched vs missing skills", "AI improvement suggestions", "ATS formatting checker"],
  },
];

export function findModuleByRoute(pathname: string): { capability: Capability; module: CapabilityModule } | null {
  for (const capability of CAPABILITIES) {
    const module = capability.modules.find((m) => m.route === pathname);
    if (module) return { capability, module };
  }
  return null;
}

// Shared split between the sequential hiring pipeline and the capabilities
// that run underneath the whole thing — used by both the sidebar (as two
// nav sections) and the workflow diagram (as two rows), so they can never
// drift out of sync with each other.
export const CORE_PIPELINE_NAMES = [
  "Requisitions", "Talent Pool", "Screening",
  "Interviews", "Placements",
];
export const SUPPORTING_CAPABILITY_NAMES = [
  "Partners", "Comms",
  "Commercials", "Governance",
];

export const CORE_PIPELINE_CAPABILITIES = CORE_PIPELINE_NAMES.map(
  (name) => CAPABILITIES.find((c) => c.name === name)!,
);
export const SUPPORTING_CAPABILITIES = SUPPORTING_CAPABILITY_NAMES.map(
  (name) => CAPABILITIES.find((c) => c.name === name)!,
);
