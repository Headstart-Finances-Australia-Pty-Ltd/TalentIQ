import JobLensWorkspace from "./JobLensPage";

// Split out of the original combined "CandidateLens" module — the
// second of three stages. Operates only on candidates already
// shortlisted in Resume Screening; no JD/CV upload here.
export default function PhoneInterviewPage({ embedded = false }: { embedded?: boolean } = {}) {
  return <JobLensWorkspace mode="phone" embedded={embedded} />;
}
