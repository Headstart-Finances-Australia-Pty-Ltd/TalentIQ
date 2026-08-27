"""
Seeds a single, coherent END-TO-END demo dataset into your running
TalentIQ instance via its own API: 4 requisitions across 4 clients, and
12 candidates (comfortably over the "at least 10" bar) each carried as
far through the real Requisition -> Sourcing/Screening -> Interviews ->
Pipeline -> Offer -> Placement journey as their assigned outcome calls
for — with a deliberate spread of outcomes so every status filter,
tile, and drill-down across the platform has real data behind it, not
just the one happy path.

This is the ONE script to run for a full guided walkthrough. The
individual seed_phaseN_*.py scripts still exist and still work (see
SAMPLE_DATA_GUIDE.md) if you want to seed a single module in isolation
— this script deliberately does NOT touch Vendor/Client portals (Phase
6), Communication automation (Phase 7), Commercials/invoicing (Phase 8),
or Team & Access (Phase 9), all of which already have their own focused
seed script. Run those afterwards if you want the full picture — see
E2E_DEMO_GUIDE.md for the recommended order.

What this creates, per candidate:
  - A Candidate (Talent Pool / Acquisition)
  - A Resume Screening pass (CandidateLens/joblens — real ATS scoring
    against a real JD, run once per requisition against that
    requisition's whole candidate group)
  - For shortlisted candidates: a Phone Interview screening result
    (contacted + recommendation + notes) in the split-out Phone
    Interview module
  - A real Requisition Pipeline entry, moved through real stage
    transitions
  - Formal Interview Scheduling rounds (Phone Interview / Video
    Interview / Panel Interview) as their story calls for, exercising:
      - single-interviewer manual decisions
      - multi-interviewer PANEL MAJORITY auto-decisions (both a
        majority-Selected and a majority-Rejected outcome)
      - the scheduling-approval workflow (an external authority
        approving via a public link, and an internal in-app approval)
      - a cancelled interview
      - a live self-scheduling link
      - a live public panel-feedback link
  - Offers (Sent, and Approved+Accepted -> auto-created Placement) for
    those who get that far
  - Rejections, with a reason, at three different stages (Resume
    Screening, a formal Interview round, and Client Review) so the
    "didn't work out" stories are real too, not just the happy path

The 12 outcomes, by requisition:
  Senior Backend Engineer @ Northwind Group
    - Sophia Nguyen   -> PLACED   (panel majority-Selected + external approval link)
    - Daniel Kim      -> REJECTED at Phone Interview (single-interviewer manual decision)
    - Chloe Anderson  -> INTERVIEWING (panel scheduled; public feedback link printed)
  Data Analyst @ Bluewave Solutions
    - Ryan Mitchell   -> PLACED   (panel approved in-app by the designated approver)
    - Zoe Campbell    -> OFFER SENT (not yet accepted/rejected)
    - Liam Foster     -> REJECTED at Resume Screening (never shortlisted)
  Financial Controller @ Coastal Financial
    - Emma Torres     -> PLACED
    - Jack Sullivan   -> REJECTED at Client Review (his Panel round is CANCELLED)
    - Grace Patel     -> INTERVIEWING (Phone round left as a live self-schedule link)
  Registered Nurse @ Aurora Health
    - Henry Osei      -> PLACED
    - Amelia Rossi    -> REJECTED at Video Interview (2-interviewer panel majority-Rejected)
    - Oliver Dubois   -> OFFER SENT

Usage:
    python seed_e2e_demo.py --email you@example.com --password yourpassword
    python seed_e2e_demo.py --email you@example.com --password yourpassword --register --name "Demo Recruiter"

Options:
    --base-url   Backend URL (default: http://localhost:8000)
    --reset      Delete data this script previously created (matched by
                 a marker in notes, or by the .e2e@example.com email
                 suffix for candidates) before reseeding
"""
import argparse
import sys
from datetime import datetime, timedelta

import requests

SEED_MARKER = "[e2e-demo-seed-data]"
EMAIL_SUFFIX = ".e2e@example.com"

CLIENTS = [
    {"name": "Northwind Group", "address": "Sydney NSW", "abn": "51 824 753 556", "area_of_work": "Financial Services"},
    {"name": "Bluewave Solutions", "address": "Melbourne VIC", "abn": "63 002 916 004", "area_of_work": "Technology"},
    {"name": "Coastal Financial", "address": "Brisbane QLD", "abn": "34 612 445 981", "area_of_work": "Banking"},
    {"name": "Aurora Health", "address": "Perth WA", "abn": "27 130 795 646", "area_of_work": "Healthcare"},
]

REQUISITIONS = [
    {"title": "Senior Backend Engineer", "client": "Northwind Group", "location": "Sydney NSW",
     "salary_min": 140000, "salary_max": 170000, "employment_type": "Full-time"},
    {"title": "Data Analyst", "client": "Bluewave Solutions", "location": "Melbourne VIC",
     "salary_min": 95000, "salary_max": 120000, "employment_type": "Full-time"},
    {"title": "Financial Controller", "client": "Coastal Financial", "location": "Brisbane QLD",
     "salary_min": 150000, "salary_max": 180000, "employment_type": "Full-time"},
    {"title": "Registered Nurse", "client": "Aurora Health", "location": "Perth WA",
     "salary_min": 85000, "salary_max": 100000, "employment_type": "Full-time"},
]

JD_TEXT = {
    "Senior Backend Engineer": """Senior Backend Engineer — Northwind Group (Sydney NSW)
Essential skills: Python, FastAPI or Django, PostgreSQL, REST API design, Docker, Git, CI/CD.
Good to have: Kubernetes, AWS, Redis, Kafka, GraphQL.
Minimum 5 years professional software engineering experience. Salary AUD 140,000-170,000.""",
    "Data Analyst": """Data Analyst — Bluewave Solutions (Melbourne VIC)
Essential skills: SQL, Python or R, Excel, data visualisation (Power BI or Tableau), statistics.
Good to have: dbt, Snowflake, A/B testing experience.
Minimum 3 years experience. Salary AUD 95,000-120,000.""",
    "Financial Controller": """Financial Controller — Coastal Financial (Brisbane QLD)
Essential skills: Financial reporting, month-end close, budgeting & forecasting, statutory compliance, CPA/CA qualification.
Good to have: ERP system migration experience, team leadership.
Minimum 8 years experience. Salary AUD 150,000-180,000.""",
    "Registered Nurse": """Registered Nurse — Aurora Health (Perth WA)
Essential skills: AHPRA registration, acute care experience, patient assessment, medication administration.
Good to have: ICU or ED experience, triage certification.
Minimum 2 years post-registration experience. Salary AUD 85,000-100,000.""",
}

# (full_name, current_title, current_employer, years, skills, cv_text, outcome)
# outcome in: placed | offer_sent | interviewing | rejected_resume | rejected_phone | rejected_video | rejected_client_review
CANDIDATES_BY_REQ = [
    [  # Senior Backend Engineer
        ("Sophia Nguyen", "Senior Software Engineer", "Redgate Advisory", "7",
         ["Python", "FastAPI", "PostgreSQL", "Docker", "Kubernetes", "AWS"],
         "7 years Python/FastAPI backend engineering. Owns PostgreSQL schema design, Docker + Kubernetes on AWS EKS, CI/CD with GitHub Actions. B.Sc Computer Science.",
         "placed"),
        ("Daniel Kim", "Backend Developer", "Pinnacle Systems", "5",
         ["Python", "Django", "PostgreSQL", "Git"],
         "5 years Django REST Framework, PostgreSQL, basic Docker. Limited cloud/Kubernetes exposure. B.Sc Information Technology.",
         "rejected_phone"),
        ("Chloe Anderson", "Software Engineer", "Acme Pty Ltd", "6",
         ["Python", "FastAPI", "PostgreSQL", "Redis", "Docker"],
         "6 years FastAPI + Redis caching layers, PostgreSQL, Docker Compose for local dev, some Kafka exposure. B.Eng Software Engineering.",
         "interviewing"),
    ],
    [  # Data Analyst
        ("Ryan Mitchell", "Data Analyst", "Coastal Financial", "4",
         ["SQL", "Python", "Power BI", "Excel"],
         "4 years SQL + Python analytics, built Power BI dashboards for exec reporting, strong Excel modelling. B.Com Economics.",
         "placed"),
        ("Zoe Campbell", "Junior Data Analyst", "Meridian Retail", "3",
         ["SQL", "Excel", "Tableau"],
         "3 years SQL reporting and Tableau dashboards for retail ops. Learning Python. Diploma in Data Analytics.",
         "offer_sent"),
        ("Liam Foster", "Sales Coordinator", "Meridian Retail", "2",
         ["Excel"],
         "2 years sales coordination, heavy Excel use for pipeline tracking, no SQL or BI tool experience. Diploma in Business.",
         "rejected_resume"),
    ],
    [  # Financial Controller
        ("Emma Torres", "Finance Manager", "Northwind Group", "9",
         ["Financial Reporting", "Budgeting", "CPA", "Statutory Compliance"],
         "9 years finance leadership, CPA qualified, led month-end close and statutory reporting for a 200-person org, budgeting & forecasting owner.",
         "placed"),
        ("Jack Sullivan", "Senior Accountant", "Bluewave Solutions", "6",
         ["Financial Reporting", "Budgeting"],
         "6 years senior accountant, financial reporting and budgeting support, working towards CPA. No team leadership experience yet.",
         "rejected_client_review"),
        ("Grace Patel", "Finance Manager", "Aurora Health", "8",
         ["Financial Reporting", "Budgeting", "CPA", "ERP Migration"],
         "8 years finance manager, CPA qualified, led an ERP migration project, budgeting & forecasting, statutory compliance.",
         "interviewing"),
    ],
    [  # Registered Nurse
        ("Henry Osei", "Registered Nurse", "St Luke's Hospital", "5",
         ["AHPRA Registration", "Acute Care", "ICU", "Patient Assessment"],
         "5 years acute care nursing, AHPRA registered, 2 years ICU experience, strong patient assessment and medication administration record.",
         "placed"),
        ("Amelia Rossi", "Registered Nurse", "Westside Medical Centre", "3",
         ["AHPRA Registration", "Patient Assessment"],
         "3 years general ward nursing, AHPRA registered, patient assessment and medication administration, no ICU/ED exposure yet.",
         "rejected_video"),
        ("Oliver Dubois", "Registered Nurse", "St Luke's Hospital", "4",
         ["AHPRA Registration", "Acute Care", "ED", "Triage Certification"],
         "4 years acute care, AHPRA registered, ED experience with triage certification, calm under pressure.",
         "offer_sent"),
    ],
]

REJECTION_REASONS = {
    "rejected_resume": "Resume screening: essential skills threshold not met for this role.",
    "rejected_phone": "Phone Interview: recruiter recommended Reject — insufficient depth on core requirements.",
    "rejected_video": "Video Interview panel majority voted Reject — concerns on role-specific experience.",
    "rejected_client_review": "Client passed after review — looking for more domain-specific leadership experience.",
}


def auth(session, base_url, email, password, name, register):
    if register:
        r = session.post(f"{base_url}/api/auth/register", json={"name": name, "email": email, "password": password})
        if r.status_code in (200, 201):
            print(f"Registered new account: {email}")
        elif r.status_code in (400, 409):
            print(f"Account already exists — continuing to log in: {email}")
        else:
            print(f"Registration failed ({r.status_code}): {r.text}")
            sys.exit(1)
    r = session.post(f"{base_url}/api/auth/login", json={"email": email, "password": password})
    if r.status_code != 200:
        print(f"Login failed ({r.status_code}): {r.text}")
        print('Tip: pass --register --name "Your Name" if this account doesn\'t exist yet.')
        sys.exit(1)
    session.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    print(f"Logged in as {email}")


def reset(session, base_url):
    print("Resetting: deleting previously seeded e2e-demo data...")
    ivs = session.get(f"{base_url}/api/interviews/interviews").json()
    marked = [i["id"] for i in ivs if SEED_MARKER in (i.get("notes") or "")]
    if marked:
        session.post(f"{base_url}/api/interviews/interviews/bulk-delete", json={"ids": marked})
    print(f"  Deleted {len(marked)} interview(s).")

    cands = session.get(f"{base_url}/api/acquisition/candidates").json()
    e2e_cands = [c for c in cands if (c.get("email") or "").endswith(EMAIL_SUFFIX)]
    for c in e2e_cands:
        entries = session.get(f"{base_url}/api/pipeline/entries", params={"candidate_id": c["id"]}).json()
        if entries:
            session.post(f"{base_url}/api/pipeline/entries/bulk-delete", json={"ids": [e["id"] for e in entries]})
    print(f"  Deleted pipeline entries (and cascaded offers/placements) for {len(e2e_cands)} candidate(s).")

    reqs = session.get(f"{base_url}/api/requisitions/requisitions").json()
    marked_reqs = [r for r in reqs if SEED_MARKER in (r.get("notes") or "")]
    for r in marked_reqs:
        session.delete(f"{base_url}/api/requisitions/requisitions/{r['id']}")
    print(f"  Deleted {len(marked_reqs)} requisition(s).")
    print("  Note: candidates and joblens Resume/Phone Screening sessions are left in place")
    print("  (re-running without --reset simply reuses/updates them).")


def ensure_clients(session, base_url):
    existing = {c["name"]: c for c in session.get(f"{base_url}/api/candidatetrack/clients").json()}
    out = {}
    for c in CLIENTS:
        if c["name"] in existing:
            out[c["name"]] = existing[c["name"]]
            continue
        r = session.post(f"{base_url}/api/candidatetrack/clients", json=c)
        if r.status_code == 200:
            out[c["name"]] = r.json()
            print(f"  Created client: {c['name']}")
        else:
            print(f"  Could not create client {c['name']} ({r.status_code}): {r.text[:200]}")
    return out


def ensure_requisition(session, base_url, spec, clients_by_name):
    existing = session.get(f"{base_url}/api/requisitions/requisitions").json()
    match = next((r for r in existing if r["title"] == spec["title"] and SEED_MARKER in (r.get("notes") or "")), None)
    if match:
        return match
    client = clients_by_name.get(spec["client"])
    r = session.post(f"{base_url}/api/requisitions/requisitions", json={
        "title": spec["title"], "client_id": client["id"] if client else None,
        "priority": "High", "vacancy_count": 1, "reason_for_hire": "New Position",
        "employment_type": spec["employment_type"], "location": spec["location"],
        "salary_min": spec["salary_min"], "salary_max": spec["salary_max"],
        "target_hire_date": (datetime.utcnow() + timedelta(days=45)).isoformat(),
        "hiring_manager_name": "Alex Morgan", "hiring_manager_email": "alex.morgan@example.com",
        "notes": SEED_MARKER,
    })
    if r.status_code != 200:
        print(f"  Could not create requisition '{spec['title']}' ({r.status_code}): {r.text[:200]}")
        return None
    req = r.json()
    session.post(f"{base_url}/api/requisitions/requisitions/{req['id']}/status", json={"status": "Approved"})
    session.post(f"{base_url}/api/requisitions/requisitions/{req['id']}/status", json={"status": "Open"})
    print(f"  Created requisition: {spec['title']} @ {spec['client']} -> Open")
    return req


def ensure_candidate(session, base_url, name, title, employer, years, skills, requisition_title):
    email = name.lower().replace(" ", ".") + EMAIL_SUFFIX
    existing = session.get(f"{base_url}/api/acquisition/candidates", params={"search": email}).json()
    match = next((c for c in existing if c["email"] == email), None)
    if match:
        return match
    r = session.post(f"{base_url}/api/acquisition/candidates", json={
        "full_name": name, "email": email, "phone": "0400 000 000",
        "location": "Australia", "current_title": title, "current_employer": employer,
        "total_experience_years": years, "skills": skills, "source": "manual",
        "consent_given": True, "notes": f"{SEED_MARKER} Applying for {requisition_title}",
    })
    if r.status_code == 200:
        return r.json()
    if r.status_code == 409:
        # Already exists (e.g. a near-simultaneous re-run) — fetch and reuse it.
        again = session.get(f"{base_url}/api/acquisition/candidates", params={"search": email}).json()
        match = next((c for c in again if c["email"] == email), None)
        if match:
            return match
    print(f"  Could not create candidate {name} ({r.status_code}): {r.text[:200]}")
    return None


def run_resume_screening(session, base_url, req_title, candidates):
    """One joblens session per requisition — real ATS scoring against a
    real JD, against plain-text CVs (same technique as
    seed_phase3_screening.py). Returns {candidate_name: joblens_candidate_id}."""
    files = [("cv_files", (f"{name.lower().replace(' ', '_')}.txt", cv_text.encode("utf-8"), "text/plain"))
             for name, _title, _employer, _years, _skills, cv_text, _outcome in candidates]
    data = {"jd_text": JD_TEXT[req_title], "low_threshold": 40, "high_threshold": 70}
    r = session.post(f"{base_url}/api/joblens/run", data=data, files=files)
    if r.status_code != 200:
        print(f"  Could not run Resume Screening for '{req_title}' ({r.status_code}): {r.text[:200]}")
        return {}
    result = r.json()
    by_name = {c["name"]: c["id"] for c in result.get("candidates", [])}
    print(f"  Resume Screening run: {req_title} ({len(by_name)} candidates scored)")
    return by_name


def stage_id_by_name(stages, name):
    return next((s["id"] for s in stages if s["name"] == name), None)


def create_interview(session, base_url, candidate_id, requisition_id, round_name, round_number,
                      interview_type, interviewers, scheduled_at, duration_minutes=45,
                      location_or_link="https://meet.example.com/interview-room",
                      approver_name="", approver_email=""):
    payload = {
        "candidate_id": candidate_id, "requisition_id": requisition_id,
        "round_name": round_name, "round_number": round_number, "interview_type": interview_type,
        "interviewers": interviewers, "duration_minutes": duration_minutes,
        "location_or_link": location_or_link,
        "scheduled_at": scheduled_at.isoformat() if scheduled_at else None,
        "notes": SEED_MARKER, "approver_name": approver_name, "approver_email": approver_email,
    }
    r = session.post(f"{base_url}/api/interviews/interviews", json=payload)
    if r.status_code != 200:
        print(f"    Could not create interview '{round_name}' ({r.status_code}): {r.text[:200]}")
        return None
    return r.json()


def submit_scorecard(session, base_url, interview_id, interviewer_name, recommendation, strengths="", concerns=""):
    session.post(f"{base_url}/api/interviews/interviews/{interview_id}/scorecards", json={
        "interviewer_name": interviewer_name, "recommendation": recommendation,
        "criteria_scores": [
            {"criterion": "Technical Skills", "score": 4, "notes": ""},
            {"criterion": "Communication", "score": 4, "notes": ""},
            {"criterion": "Culture Fit", "score": 4, "notes": ""},
        ],
        "strengths": strengths, "concerns": concerns, "overall_notes": SEED_MARKER,
    })


def main():
    ap = argparse.ArgumentParser(description="Seed a full end-to-end TalentIQ demo dataset (Requisition -> Placement).")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--name", default="Demo Recruiter", help="Only used with --register")
    ap.add_argument("--register", action="store_true")
    ap.add_argument("--base-url", default="http://localhost:8000")
    ap.add_argument("--reset", action="store_true")
    args = ap.parse_args()

    session = requests.Session()
    auth(session, args.base_url, args.email, args.password, args.name, args.register)

    if args.reset:
        reset(session, args.base_url)

    print("\n--- Clients & Requisitions ---")
    clients_by_name = ensure_clients(session, args.base_url)
    requisitions = []
    for spec in REQUISITIONS:
        req = ensure_requisition(session, args.base_url, spec, clients_by_name)
        requisitions.append(req)

    now = datetime.utcnow()
    links_to_print = []

    for req, candidates in zip(requisitions, CANDIDATES_BY_REQ):
        if not req:
            continue
        print(f"\n--- {req['title']} @ {req.get('client_name') or 'no client'} ---")

        # 1) Candidates (Talent Pool)
        cand_objs = {}
        for name, title, employer, years, skills, cv_text, outcome in candidates:
            c = ensure_candidate(session, args.base_url, name, title, employer, years, skills, req["title"])
            if c:
                cand_objs[name] = c
                print(f"  Candidate ready: {name} ({outcome})")

        # 2) Resume Screening (CandidateLens/joblens) — real ATS run,
        #    then shortlist everyone except the "rejected_resume" story.
        jl_ids = run_resume_screening(session, args.base_url, req["title"], candidates)
        for name, _title, _employer, _years, _skills, _cv, outcome in candidates:
            jl_id = jl_ids.get(name)
            if jl_id and outcome != "rejected_resume":
                session.put(f"{args.base_url}/api/joblens/candidates/{jl_id}/shortlist")

        # 3) Phone Interview screening (joblens split module) for
        #    everyone who was shortlisted.
        for name, _title, _employer, _years, _skills, _cv, outcome in candidates:
            jl_id = jl_ids.get(name)
            if not jl_id or outcome == "rejected_resume":
                continue
            session.post(f"{args.base_url}/api/joblens/candidates/{jl_id}/phone-contacted")
            rec = "Reject" if outcome == "rejected_phone" else "Proceed"
            note = "Struggled to speak to production incidents in depth." if outcome == "rejected_phone" else "Strong communicator, confirmed availability."
            session.post(f"{args.base_url}/api/joblens/candidates/{jl_id}/phone-result", json={"recommendation": rec, "notes": note})

        # 4) Pipeline + formal Interview Scheduling + Offers/Placements
        for name, title, employer, years, skills, cv_text, outcome in candidates:
            c = cand_objs.get(name)
            if not c:
                continue

            if outcome == "rejected_resume":
                # Never entered the formal pipeline — screened out at Resume Screening.
                print(f"  {name}: rejected at Resume Screening — not shortlisted, no pipeline entry created.")
                continue

            sub = session.post(f"{args.base_url}/api/pipeline/submit", json={"candidate_id": c["id"], "requisition_id": req["id"]})
            if sub.status_code == 409:
                entry = session.get(f"{args.base_url}/api/pipeline/entries",
                                     params={"candidate_id": c["id"], "requisition_id": req["id"]}).json()
                entry = entry[0] if entry else None
            elif sub.status_code == 200:
                entry = sub.json()
            else:
                print(f"  {name}: could not submit to pipeline ({sub.status_code}): {sub.text[:150]}")
                continue
            if not entry:
                continue
            stages = session.get(f"{args.base_url}/api/pipeline/stages", params={"requisition_id": req["id"]}).json()

            def move(stage_name, notes=None):
                sid = stage_id_by_name(stages, stage_name)
                if sid:
                    body = {"stage_id": sid}
                    if notes:
                        body["notes"] = notes
                    session.post(f"{args.base_url}/api/pipeline/entries/{entry['id']}/move-stage", json=body)

            move("Client Review")

            # ── Phone Interview round (formal Interview Scheduling — a
            #    separate, richer record from joblens's own phone-screen
            #    fields above; recruiters use this one for time/place/
            #    approval/decision tracking). Single interviewer -> manual
            #    decision (majority isn't meaningful for 1 voter).
            phone_iv = create_interview(
                session, args.base_url, c["id"], req["id"], "Phone Interview", 1, "Phone Interview",
                [{"name": "Jordan Blake", "email": "jordan.blake@example.com"}],
                now - timedelta(days=14),
            )
            if not phone_iv:
                continue

            if outcome == "rejected_phone":
                session.post(f"{args.base_url}/api/interviews/interviews/{phone_iv['id']}/status", json={"status": "Completed"})
                session.post(f"{args.base_url}/api/interviews/interviews/{phone_iv['id']}/decision", json={"decision": "Rejected"})
                move("Rejected", notes=REJECTION_REASONS["rejected_phone"])
                session.put(f"{args.base_url}/api/pipeline/entries/{entry['id']}", json={"rejection_reason": REJECTION_REASONS["rejected_phone"]})
                print(f"  {name}: REJECTED at Phone Interview (manual decision, single interviewer)")
                continue

            if name == "Grace Patel":
                # Leave this one's Phone round in "Requested" with a live
                # self-scheduling link instead of completing it — so
                # there's a real candidate-facing link to test.
                slots = [(now + timedelta(days=d, hours=h)).isoformat() for d, h in [(2, 10), (2, 14), (3, 11)]]
                link_res = session.post(f"{args.base_url}/api/interviews/interviews/{phone_iv['id']}/self-schedule-link",
                                         json={"proposed_slots": slots})
                if link_res.status_code == 200:
                    links_to_print.append(("Grace Patel — self-scheduling link (Phone Interview)",
                                            f"{args.base_url.replace('8000', '5173')}{link_res.json()['schedule_url_path']}"))
                move("Interviewing")
                print(f"  {name}: Phone Interview left Requested with a live self-scheduling link")
                continue

            session.post(f"{args.base_url}/api/interviews/interviews/{phone_iv['id']}/status", json={"status": "Completed"})
            session.post(f"{args.base_url}/api/interviews/interviews/{phone_iv['id']}/decision", json={"decision": "Selected"})

            # ── Video Interview round
            video_iv = create_interview(
                session, args.base_url, c["id"], req["id"], "Video Interview", 2, "Video Interview",
                [{"name": "Priya Anand", "email": "priya.anand@example.com"}] if outcome != "rejected_video" else
                [{"name": "Priya Anand", "email": "priya.anand@example.com"}, {"name": "Marcus Webb", "email": "marcus.webb@example.com"}],
                now - timedelta(days=9),
            )
            if not video_iv:
                continue

            if outcome == "rejected_video":
                session.post(f"{args.base_url}/api/interviews/interviews/{video_iv['id']}/status", json={"status": "Completed"})
                submit_scorecard(session, args.base_url, video_iv["id"], "Priya Anand", "No", concerns="Not enough acute-care depth for this role.")
                submit_scorecard(session, args.base_url, video_iv["id"], "Marcus Webb", "No", concerns="Same concern — recommend passing.")
                move("Rejected", notes=REJECTION_REASONS["rejected_video"])
                session.put(f"{args.base_url}/api/pipeline/entries/{entry['id']}", json={"rejection_reason": REJECTION_REASONS["rejected_video"]})
                print(f"  {name}: REJECTED at Video Interview (2-interviewer panel majority)")
                continue

            session.post(f"{args.base_url}/api/interviews/interviews/{video_iv['id']}/status", json={"status": "Completed"})
            session.post(f"{args.base_url}/api/interviews/interviews/{video_iv['id']}/decision", json={"decision": "Selected"})
            move("Interviewing")

            if outcome == "rejected_client_review":
                # A Panel round gets scheduled, then CANCELLED, and the
                # client passes independently of it — the "client just
                # said no" story, distinct from an interview-driven reject.
                panel_iv = create_interview(
                    session, args.base_url, c["id"], req["id"], "Panel Interview", 3, "Panel Interview",
                    [{"name": "Priya Anand", "email": "priya.anand@example.com"},
                     {"name": "Marcus Webb", "email": "marcus.webb@example.com"},
                     {"name": "Elena Kovac", "email": "elena.kovac@example.com"}],
                    now + timedelta(days=4),
                )
                if panel_iv:
                    session.post(f"{args.base_url}/api/interviews/interviews/{panel_iv['id']}/status",
                                 json={"status": "Cancelled", "cancellation_reason": "Client put the role on hold for this candidate while reviewing budget."})
                move("Rejected", notes=REJECTION_REASONS["rejected_client_review"])
                session.put(f"{args.base_url}/api/pipeline/entries/{entry['id']}", json={"rejection_reason": REJECTION_REASONS["rejected_client_review"]})
                print(f"  {name}: Panel Interview CANCELLED; REJECTED at Client Review")
                continue

            # ── Panel Interview round — 3 interviewers, majority decision.
            approver_name = "Alex Morgan" if outcome == "placed" and name in ("Sophia Nguyen", "Ryan Mitchell") else ""
            approver_email = "alex.morgan@example.com" if approver_name else ""
            panel_iv = create_interview(
                session, args.base_url, c["id"], req["id"], "Panel Interview", 3, "Panel Interview",
                [{"name": "Priya Anand", "email": "priya.anand@example.com"},
                 {"name": "Marcus Webb", "email": "marcus.webb@example.com"},
                 {"name": "Elena Kovac", "email": "elena.kovac@example.com"}],
                now + timedelta(days=5) if outcome == "interviewing" else now - timedelta(days=4),
                approver_name=approver_name, approver_email=approver_email,
            )
            if not panel_iv:
                continue

            if outcome == "interviewing":
                move("Interviewing")
                if name == "Chloe Anderson":
                    detail = session.get(f"{args.base_url}/api/interviews/interviews/{panel_iv['id']}").json()
                    fl = (detail.get("feedback_links") or [])
                    if fl:
                        links_to_print.append((f"{name} — panel feedback link ({fl[0]['interviewer_name']})",
                                                f"{args.base_url.replace('8000', '5173')}{fl[0]['feedback_url_path']}"))
                print(f"  {name}: Panel Interview scheduled, decision Pending — INTERVIEWING")
                continue

            # placed / offer_sent: majority-Selected panel (2 Strong Yes,
            # 1 Neutral — a real majority, not unanimous, to show the
            # "doesn't need everyone" behaviour honestly).
            session.post(f"{args.base_url}/api/interviews/interviews/{panel_iv['id']}/status", json={"status": "Completed"})
            submit_scorecard(session, args.base_url, panel_iv["id"], "Priya Anand", "Strong Yes", strengths="Excellent technical depth and communicates clearly.")
            submit_scorecard(session, args.base_url, panel_iv["id"], "Marcus Webb", "Strong Yes", strengths="Would be a strong culture fit.")
            submit_scorecard(session, args.base_url, panel_iv["id"], "Elena Kovac", "Neutral", concerns="Good, but not the strongest candidate we've seen.")

            if approver_name and name == "Sophia Nguyen":
                detail = session.get(f"{args.base_url}/api/interviews/interviews/{panel_iv['id']}").json()
                if detail.get("approval_url_path"):
                    links_to_print.append((f"{name} — panel scheduling-approval link ({approver_name})",
                                            f"{args.base_url.replace('8000', '5173')}{detail['approval_url_path']}"))
            elif approver_name and name == "Ryan Mitchell":
                session.post(f"{args.base_url}/api/interviews/interviews/{panel_iv['id']}/approval/approve")

            move("Offer")
            offer_res = session.post(f"{args.base_url}/api/pipeline/entries/{entry['id']}/offers", json={
                "salary_offered": (req.get("salary_max") or 120000) - 5000, "salary_currency": "AUD",
                "start_date": (now + timedelta(days=21)).isoformat(),
                "expiry_date": (now + timedelta(days=7)).isoformat(),
                "notes": SEED_MARKER,
            })
            if offer_res.status_code != 200:
                print(f"  {name}: could not create offer ({offer_res.status_code}): {offer_res.text[:150]}")
                continue
            offer = offer_res.json()

            if outcome == "offer_sent":
                print(f"  {name}: Panel majority-Selected -> OFFER SENT (pending decision)")
                continue

            session.post(f"{args.base_url}/api/pipeline/offers/{offer['id']}/status", json={"status": "Approved"})
            accept_res = session.post(f"{args.base_url}/api/pipeline/offers/{offer['id']}/status", json={"status": "Accepted"})
            placement_note = ""
            if accept_res.status_code == 200 and accept_res.json().get("placement"):
                placement_note = f" — guarantee period ends {accept_res.json()['placement']['guarantee_end_date']}"
            print(f"  {name}: Panel majority-Selected -> Offer accepted -> PLACED{placement_note}")

    print(f"\nDone. {SEED_MARKER}")
    print("=" * 70)
    print("Open these to see the seeded data:")
    print("  Requisitions           /app/requisitions")
    print("  Talent Pool            /app/acquisition")
    print("  Resume Screening       /app/resumescreening")
    print("  Phone Interview        /app/phoneinterview")
    print("  Video Interview        /app/videointerview  (webcam step — see the guide)")
    print("  Interview Scheduling   /app/interviews")
    print("  Pipeline & Placements  /app/pipeline")
    print("  Management Dashboard   /app/dashboard")
    if links_to_print:
        print("\nLive links to test yourself (open in a browser — no login needed):")
        for label, url in links_to_print:
            print(f"  {label}\n    {url}")
    print("=" * 70)


if __name__ == "__main__":
    main()
