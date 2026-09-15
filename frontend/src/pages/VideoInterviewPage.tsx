import JobLensWorkspace from "./JobLensPage";

// Split out of the original combined "CandidateLens" module — the
// third of three stages. Operates only on candidates already
// shortlisted in Resume Screening; no JD/CV upload here.
export default function VideoInterviewPage({ embedded = false }: { embedded?: boolean } = {}) {
  return <JobLensWorkspace mode="video" embedded={embedded} />;
}
