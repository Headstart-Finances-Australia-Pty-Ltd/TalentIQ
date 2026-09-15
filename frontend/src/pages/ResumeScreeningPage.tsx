import JobLensWorkspace from "./JobLensPage";

// Split out of the original combined "CandidateLens" module — this is
// the first of three stages (Resume Screening -> Phone Interview ->
// Video Interview). All three share the same underlying workspace
// (session/candidate data, scoring engine) via the `mode` prop; this
// page is the only one of the three that can create new JD/CV analysis
// sessions or touch Client/JD/Vendor management.
export default function ResumeScreeningPage({ embedded = false }: { embedded?: boolean } = {}) {
  return <JobLensWorkspace mode="resume" embedded={embedded} />;
}
