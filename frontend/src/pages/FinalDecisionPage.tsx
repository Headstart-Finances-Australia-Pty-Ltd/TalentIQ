import JobLensWorkspace from "./JobLensPage";

// Split out of the original combined "CandidateLens" module — the final
// stage after Resume Screening -> Phone Interview -> Video Interview.
// Brings each candidate's score from all three stages together in one
// table so the recruiter can make (and record) the final shortlist call.
export default function FinalDecisionPage({ embedded = false }: { embedded?: boolean } = {}) {
  return <JobLensWorkspace mode="final" embedded={embedded} />;
}
