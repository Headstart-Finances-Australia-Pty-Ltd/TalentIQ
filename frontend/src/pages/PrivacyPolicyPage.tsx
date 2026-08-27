import LegalPageLayout from "../components/LegalPageLayout";

export default function PrivacyPolicyPage() {
  return (
    <LegalPageLayout title="Privacy Policy" lastUpdated="27 August 2026">
      <p>
        This Privacy Policy explains how TalentIQ collects, uses, stores, and protects personal data
        across the recruitment platform — including data about recruiters and hiring teams, and data
        about job candidates who apply for roles, submit résumés, or complete phone and video
        interviews through TalentIQ. It applies whether you access TalentIQ as a logged-in recruiter,
        or through a public, token-based link as a candidate, hiring manager, client, or vendor.
      </p>

      <h2>1. Who is responsible for your data</h2>
      <p>
        Where a company ("Organisation") uses TalentIQ to run its hiring process, that Organisation is
        generally the <strong>data controller</strong> for candidate personal data — it decides which
        candidates to invite, which questions to ask, and what to do with the results. TalentIQ acts as
        the <strong>data processor</strong>, storing and processing that data on the Organisation's
        instructions and behalf. If you are a candidate with a question about how your specific
        application or interview data is being used, your first point of contact should be the
        Organisation that invited you to apply or interview.
      </p>

      <h2>2. What personal data we collect</h2>
      <h3>2.1 From recruiters and hiring team members</h3>
      <ul>
        <li>Account information: name, work email, company, phone number, password (stored as a salted hash, never in plain text).</li>
        <li>Usage data: actions taken within the Platform (e.g. requisitions created, candidates scored), for audit and support purposes.</li>
        <li>Optional integration credentials the Organisation chooses to connect (e.g. a Groq API key, SMTP settings, or a MorphCast licence key for emotion analysis) — these are stored per-Organisation and are never shared with other Organisations.</li>
      </ul>
      <h3>2.2 From candidates</h3>
      <ul>
        <li>Application details you provide: name, email, phone number, résumé/CV file, cover letter, and answers to any screening questions.</li>
        <li>Résumé content, including work history, education, skills, and any other information contained in the document you upload.</li>
        <li><strong>Video interview data</strong>: recorded video and audio of your interview session, only after you have reviewed and accepted the pre-interview privacy notice.</li>
        <li><strong>Derived data from your video interview</strong>: an automated transcript of your spoken answers; facial-emotion signals (e.g. happy/neutral/sad/angry proportions and a "dominant emotion") derived from your video using on-device/browser-based facial analysis technology; and AI-generated scores for communication, relevance, confidence, and an overall assessment, based on your transcript and the interview questions asked.</li>
        <li>Phone interview outcomes logged by the recruiter (e.g. notes and a recommendation), where a phone screening stage is used instead of, or alongside, video.</li>
        <li>Technical data such as IP address and browser/device information, collected automatically when you use a candidate-facing link, for security and troubleshooting purposes.</li>
      </ul>

      <h2>3. How we use personal data</h2>
      <ul>
        <li>To operate the Platform: matching candidates to requisitions, running AI-assisted résumé scoring against a job description, generating interview questions, and presenting results to the Organisation's recruiters and hiring managers.</li>
        <li>To conduct and score phone and video interviews, including automated transcription and analysis, so recruiters can review structured, comparable information about each candidate alongside the recording itself.</li>
        <li>To communicate with candidates about their application (for example, sending an interview invitation) via the Organisation's own configured email sending method.</li>
        <li>To maintain the security, integrity, and audit trail of the Platform, including logging when a candidate accepts the pre-interview privacy notice.</li>
        <li>To improve the Platform's features, in aggregated or de-identified form wherever feasible.</li>
      </ul>
      <p>
        We do not sell personal data. We do not use candidate video, audio, or résumé content to train
        general-purpose AI models outside the context of providing the Platform's screening features to
        the Organisation that collected it.
      </p>

      <h2>4. Who can see your data</h2>
      <p>
        Candidate data — including résumé content, interview recordings, transcripts, and AI-generated
        scores — is visible only to: (a) recruiters and hiring managers within the Organisation that
        collected it, subject to that Organisation's own internal access controls (including
        row-level checks that restrict a candidate's data to the recruiter who owns that hiring
        pipeline, or an administrator); and (b) TalentIQ personnel or automated systems, strictly as
        needed to operate, secure, and support the Platform. We do not share candidate data with other
        Organisations using TalentIQ, or with third parties for their own marketing purposes.
      </p>
      <p>
        Some processing (such as generating interview questions, scoring transcripts, or converting
        interview questions to natural-sounding speech) is performed by third-party AI infrastructure
        providers under contract, solely to provide that specific processing step, and not for their
        own independent use of the data beyond what is needed to return a result to the Platform.
      </p>

      <h2>5. Video interview consent</h2>
      <p>
        Before any camera or microphone access is requested, candidates are shown a clear notice
        explaining that the session will be recorded, securely stored, and reviewed by the
        Organisation's decision-makers, and must explicitly check a box confirming they understand and
        agree. This acceptance, together with a timestamp, is recorded against the candidate's
        interview record. If a candidate does not accept, the interview does not start and no
        recording is made.
      </p>

      <h2>6. Data retention</h2>
      <p>
        Candidate data is retained for as long as needed to support the Organisation's recruitment
        process and its own legal and record-keeping obligations, which vary by jurisdiction and by
        Organisation policy. An Organisation may delete a candidate's record, résumé, or video at any
        time through the Platform, which permanently removes the underlying stored file. Candidates
        who wish to request deletion of their data should contact the Organisation that collected it
        directly; TalentIQ will support such requests as the Organisation's processor.
      </p>

      <h2>7. Your rights</h2>
      <p>
        Depending on where you live, you may have rights to access, correct, delete, or port your
        personal data, or to object to or restrict certain processing (for example, automated
        scoring). Because the Organisation is generally the data controller, these requests should
        usually be directed to the Organisation first. Where TalentIQ can assist directly (for example,
        where no active Organisation relationship exists), contact us using the details below.
      </p>

      <h2>8. Children's data</h2>
      <p>
        TalentIQ is intended for use by individuals who are eligible to work in the relevant
        jurisdiction and is not directed at children. We do not knowingly collect personal data from
        children.
      </p>

      <h2>9. International data transfers</h2>
      <p>
        Data may be processed in a country other than the one you are located in, in order to operate
        the Platform's infrastructure and AI processing partners. Where this occurs, we and our
        Organisations rely on appropriate safeguards recognised under applicable data protection law.
      </p>

      <h2>10. Changes to this Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Material changes will be reflected by
        updating the "Last updated" date above.
      </p>

      <h2>11. Contact</h2>
      <p>
        If you are a candidate, please contact the Organisation that invited you to apply or
        interview. If you are a recruiter or Organisation administrator, contact TalentIQ support
        through your usual support channel. See also our <a href="/data-security">Data Security</a>{" "}
        page for details on how data is technically protected.
      </p>
    </LegalPageLayout>
  );
}
