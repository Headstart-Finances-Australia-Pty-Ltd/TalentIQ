import LegalPageLayout from "../components/LegalPageLayout";

export default function DataSecurityPage() {
  return (
    <LegalPageLayout title="Data Security" lastUpdated="27 August 2026">
      <p>
        This page describes, in plain terms, how TalentIQ Solution technically protects the data it stores —
        including recruiter accounts, candidate résumés, and recorded video and audio interviews. It is
        intended to complement, not replace, our <a href="/privacy">Privacy Policy</a> and{" "}
        <a href="/terms">Terms of Use</a>.
      </p>

      <h2>1. Where data lives</h2>
      <p>
        Candidate résumés, recorded interview video and audio, and derived analysis (transcripts,
        scores, and emotion signals) are stored as encrypted-at-rest binary records directly inside
        TalentIQ Solution's primary application database, alongside the structured candidate record they belong
        to (name, application status, scores, and so on) — rather than being scattered across separate
        file-storage buckets with their own independent access rules. This means a candidate's résumé,
        video, transcript, and score all live in one place, governed by the same access controls, which
        reduces the number of systems that would need to be compromised to expose that data.
      </p>
      <p>
        The database itself runs on managed, encrypted-at-rest PostgreSQL infrastructure. Backups, where
        enabled by the hosting provider, are similarly encrypted.
      </p>

      <h2>2. Encryption in transit</h2>
      <p>
        All traffic between a candidate's, recruiter's, or hiring manager's browser and TalentIQ Solution's
        servers is encrypted using TLS (HTTPS). This includes candidate-facing pages such as job
        applications, video interviews, and hiring-manager review links — not just the logged-in
        recruiter application.
      </p>

      <h2>3. Access control</h2>
      <ul>
        <li><strong>Organisation isolation</strong> — every requisition, candidate, and interview record belongs to a specific Organisation. Recruiters can only see data belonging to their own Organisation.</li>
        <li><strong>Row-level ownership within an Organisation</strong> — for sensitive records such as interview video, access is further restricted to the specific recruiter who owns that hiring pipeline, or a user with the Organisation's "admin" role — not to every user in the Organisation by default.</li>
        <li><strong>Token-based candidate access</strong> — candidates, hiring managers, clients, and vendors reach their specific record through a long, randomly generated, unguessable link rather than a shared password, and that link only ever exposes the single record it was generated for.</li>
        <li><strong>Password storage</strong> — recruiter account passwords are never stored in plain text; they are hashed using a modern, salted hashing algorithm before storage.</li>
        <li><strong>Admin-gated platform configuration</strong> — settings that affect every user in an Organisation (such as shared AI/API credentials or interview-wide settings like answer time and interview voice) can only be changed by a user with the "admin" role.</li>
      </ul>

      <h2>4. Video interview consent and recording controls</h2>
      <p>
        Camera and microphone access is never requested from a candidate's browser until they have
        explicitly reviewed and accepted a privacy notice describing that the session will be recorded,
        stored, and reviewed. This acceptance is recorded with a timestamp against that candidate's
        interview record before the interview can begin, and is enforced on the server as well as in
        the browser — a recording cannot be submitted without a recorded acceptance.
      </p>

      <h2>5. AI processing</h2>
      <p>
        Some processing steps — generating interview questions, transcribing interview audio, scoring
        transcripts, and converting interview questions to natural-sounding speech — are performed
        using AI infrastructure, using credentials configured by the Organisation (or a platform-wide
        credential managed by a TalentIQ Solution administrator). Content sent to these providers is used solely
        to return the requested result and is not used by TalentIQ Solution to train models outside the context
        of the Platform.
      </p>

      <h2>6. Application security practices</h2>
      <ul>
        <li>All API access requires an authenticated session token (for recruiters) or a valid, unguessable interview/portal token (for candidates and external parties) — there is no unauthenticated access to another party's data.</li>
        <li>Input validation and file-type checks are applied to uploaded documents (résumés, job descriptions) before they are processed or stored.</li>
        <li>The Platform is built and deployed using standard secure software development practices, including dependency management and regular framework updates.</li>
      </ul>

      <h2>7. Deletion</h2>
      <p>
        When a recruiter or Organisation administrator deletes a candidate record, résumé, or video
        through the Platform, the underlying stored binary data is permanently removed from the
        database — it is not merely hidden from view.
      </p>

      <h2>8. Reporting a security concern</h2>
      <p>
        If you believe you have found a security vulnerability in TalentIQ Solution, please report it
        responsibly through your Organisation's TalentIQ Solution administrator or your usual TalentIQ Solution support
        channel, rather than testing it against real candidate or Organisation data. We take all
        reports seriously and will investigate promptly.
      </p>
    </LegalPageLayout>
  );
}
