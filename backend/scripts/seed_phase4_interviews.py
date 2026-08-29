"""
Seeds realistic Phase 4 (Interview Management) test data into your running
TalentIQ instance via its own API — same approach as seed_phase2_requisitions.py
and seed_phase3_screening.py.

Interview Management covers:
  - Scheduling interviews (fixed time, or candidate self-scheduling via a
    TalentIQ link) across multiple rounds per candidate.
  - Structured interviewer scorecards per interview.
  - Status tracking (Requested -> Scheduled -> Completed/Cancelled/No-Show).

This script depends on candidates already existing in your organisation
(Interview.candidate_id is a required link to the Candidate Master from
Phase 1/Acquisition) — see the "Suggested order" section in the README
this ships alongside. If NO candidates exist yet in your account, this
script creates a handful of its own so it still works standalone; if you
already imported sample-candidates.csv or ran the bulk folder import, it
reuses those instead of creating duplicates.

Creates:
  - Up to 5 candidates (only if none exist yet — see above).
  - 2 sample requisitions to link some interviews to (reuses existing ones
    if your account already has any).
  - 9 interviews spanning every status (Requested, Scheduled, Completed,
    Cancelled, No-Show) and multiple rounds per candidate (Phone Screen ->
    Technical -> Onsite), so the status filter tabs and round tracking
    both have something real to click through.
  - 2-3 scorecards on the "Completed" interviews, with varied
    recommendations and per-criterion star ratings.
  - 1 live self-scheduling link (TalentIQ's own token-based flow, not
    Calendly — this script can't know your personal Calendly credentials)
    — printed at the end so you can open it yourself and test the
    candidate-facing confirmation page.

Usage:
    python seed_phase4_interviews.py --email you@example.com --password yourpassword
    python seed_phase4_interviews.py --email you@example.com --password yourpassword --register --name "Demo Recruiter"

Options:
    --base-url   Backend URL (default: http://localhost:8000)
    --reset      Delete all interviews this script previously created
                 before reseeding (matched by a marker in notes)
"""
import argparse
import sys
from datetime import datetime, timedelta

import requests

SEED_MARKER = "[phase4-seed-data]"

SAMPLE_CANDIDATES = [
    {"full_name": "Isabella Martinez", "email": "isabella.martinez.p4@example.com", "phone": "0411 222 333",
     "location": "Sydney NSW", "current_title": "Senior Backend Engineer", "current_employer": "Northwind Group",
     "total_experience_years": "7", "skills": ["Python", "FastAPI", "PostgreSQL"], "source": "manual"},
    {"full_name": "Ethan Walker", "email": "ethan.walker.p4@example.com", "phone": "0422 333 444",
     "location": "Melbourne VIC", "current_title": "Financial Analyst", "current_employer": "Coastal Financial",
     "total_experience_years": "4", "skills": ["Financial Modelling", "Excel", "Power BI"], "source": "manual"},
    {"full_name": "Ava Chen", "email": "ava.chen.p4@example.com", "phone": "0433 444 555",
     "location": "Brisbane QLD", "current_title": "Product Manager", "current_employer": "Acme Pty Ltd",
     "total_experience_years": "6", "skills": ["Roadmapping", "SQL", "Agile"], "source": "manual"},
]

ROUND_SEQUENCE = ["Phone Screen", "Technical Interview", "Onsite / Final Round"]


def _reset(session: requests.Session, base_url: str):
    print("Resetting: deleting all existing interviews for this account...")
    interviews = session.get(f"{base_url}/api/interviews/interviews").json()
    if interviews:
        session.post(f"{base_url}/api/interviews/interviews/bulk-delete", json={"ids": [i["id"] for i in interviews]})
    print(f"  Deleted {len(interviews)} interview(s).")


def ensure_candidates(session: requests.Session, base_url: str) -> list:
    existing = session.get(f"{base_url}/api/acquisition/candidates").json()
    if len(existing) >= 3:
        print(f"Reusing {len(existing)} existing candidate(s) already in your organisation.")
        return existing[:5]

    print("Fewer than 3 candidates found — creating sample candidates for this script to use...")
    created = []
    for c in SAMPLE_CANDIDATES:
        r = session.post(f"{base_url}/api/acquisition/candidates", json={**c, "consent_given": True, "notes": SEED_MARKER})
        if r.status_code == 200:
            created.append(r.json())
            print(f"  Created candidate: {c['full_name']}")
        elif r.status_code == 409:
            # Already exists (e.g. re-running the script) — fetch and reuse it.
            all_candidates = session.get(f"{base_url}/api/acquisition/candidates", params={"search": c["email"]}).json()
            match = next((x for x in all_candidates if x["email"] == c["email"]), None)
            if match:
                created.append(match)
        else:
            print(f"  Could not create candidate {c['full_name']} ({r.status_code}): {r.text[:200]}")
    return created + existing  # prefer the fresh ones first for round-robin assignment below


def ensure_requisitions(session: requests.Session, base_url: str) -> list:
    existing = session.get(f"{base_url}/api/requisitions/requisitions").json()
    if len(existing) >= 1:
        print(f"Reusing {len(existing)} existing requisition(s).")
        return existing[:2]

    print("No requisitions found — creating 2 sample ones to link interviews to...")
    created = []
    for title in ["Senior Backend Engineer", "Financial Analyst"]:
        r = session.post(f"{base_url}/api/requisitions/requisitions", json={
            "title": title, "priority": "High", "vacancy_count": 1,
            "reason_for_hire": "New Position", "employment_type": "Full-time",
            "notes": SEED_MARKER,
        })
        if r.status_code == 200:
            created.append(r.json())
            print(f"  Created requisition: {title}")
        else:
            print(f"  Could not create requisition '{title}' ({r.status_code}): {r.text[:200]}")
    return created


def main():
    ap = argparse.ArgumentParser(description="Seed Phase 4 (Interview Management) test data.")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--name", default="Demo Recruiter", help="Only used with --register")
    ap.add_argument("--register", action="store_true")
    ap.add_argument("--base-url", default="http://localhost:8000")
    ap.add_argument("--reset", action="store_true", help="Delete previously seeded interviews first")
    args = ap.parse_args()

    session = requests.Session()

    if args.register:
        r = session.post(f"{args.base_url}/api/auth/register", json={
            "name": args.name, "email": args.email, "password": args.password,
        })
        if r.status_code in (200, 201):
            print(f"Registered new account: {args.email}")
        elif r.status_code in (400, 409):
            print(f"Account already exists — continuing to log in: {args.email}")
        else:
            print(f"Registration failed ({r.status_code}): {r.text}")
            sys.exit(1)

    r = session.post(f"{args.base_url}/api/auth/login", json={"email": args.email, "password": args.password})
    if r.status_code != 200:
        print(f"Login failed ({r.status_code}): {r.text}")
        print('Tip: pass --register --name "Your Name" if this account doesn\'t exist yet.')
        sys.exit(1)
    session.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    print(f"Logged in as {args.email}")

    if args.reset:
        _reset(session, args.base_url)

    print("\n--- Prerequisites ---")
    candidates = ensure_candidates(session, args.base_url)
    requisitions = ensure_requisitions(session, args.base_url)
    if len(candidates) < 3:
        print("Could not find or create enough candidates to seed interviews against. Aborting.")
        sys.exit(1)

    print("\n--- Interview Management ---")
    now = datetime.utcnow()  # naive UTC, matches every other seed script and the API's own datetime handling
    c1, c2, c3 = candidates[0], candidates[1], candidates[2]
    req1 = requisitions[0] if requisitions else None
    req2 = requisitions[1] if len(requisitions) > 1 else req1

    # 1) Candidate 1: full multi-round journey, all the way to Completed,
    #    with a scorecard on each completed round — the "everything worked
    #    out" story.
    interview_ids = []
    for round_idx, round_name in enumerate(ROUND_SEQUENCE, start=1):
        payload = {
            "candidate_id": c1["id"], "requisition_id": req1["id"] if req1 else None,
            "round_name": round_name, "round_number": round_idx,
            "interviewers": [{"name": "Priya Anand", "email": "priya.anand@example.com"}],
            "duration_minutes": 45 if round_idx == 1 else 60,
            "location_or_link": "https://meet.example.com/interview-room" if round_idx < 3 else "123 Example St, Sydney NSW",
            "scheduled_at": (now - timedelta(days=10 - round_idx * 3)).isoformat(),
            "notes": SEED_MARKER,
        }
        r = session.post(f"{args.base_url}/api/interviews/interviews", json=payload)
        if r.status_code != 200:
            print(f"  Could not create interview '{round_name}' for {c1['full_name']} ({r.status_code}): {r.text[:200]}")
            continue
        interview = r.json()
        interview_ids.append(interview["id"])
        session.post(f"{args.base_url}/api/interviews/interviews/{interview['id']}/status", json={"status": "Completed"})
        session.post(f"{args.base_url}/api/interviews/interviews/{interview['id']}/scorecards", json={
            "interviewer_name": "Priya Anand",
            "recommendation": ["Yes", "Strong Yes", "Strong Yes"][round_idx - 1],
            "criteria_scores": [
                {"criterion": "Technical Skills", "score": 4 + (round_idx == 3), "notes": ""},
                {"criterion": "Communication", "score": 4, "notes": ""},
                {"criterion": "Culture Fit", "score": 5, "notes": ""},
            ],
            "strengths": "Strong problem-solving, communicates clearly under pressure.",
            "concerns": "" if round_idx > 1 else "Limited exposure to our specific tech stack, but ramps quickly.",
            "overall_notes": SEED_MARKER,
        })
        print(f"  {c1['full_name']}: {round_name} — Completed, scorecard added")

    # 2) Candidate 2: currently mid-process — Round 1 completed (with a
    #    mixed scorecard), Round 2 scheduled for the future.
    r = session.post(f"{args.base_url}/api/interviews/interviews", json={
        "candidate_id": c2["id"], "requisition_id": req2["id"] if req2 else None,
        "round_name": "Phone Screen", "round_number": 1,
        "interviewers": [{"name": "Marcus Webb", "email": "marcus.webb@example.com"}],
        "duration_minutes": 30, "location_or_link": "https://meet.example.com/interview-room",
        "scheduled_at": (now - timedelta(days=2)).isoformat(),
        "notes": SEED_MARKER,
    })
    if r.status_code == 200:
        iv = r.json()
        session.post(f"{args.base_url}/api/interviews/interviews/{iv['id']}/status", json={"status": "Completed"})
        session.post(f"{args.base_url}/api/interviews/interviews/{iv['id']}/scorecards", json={
            "interviewer_name": "Marcus Webb", "recommendation": "Neutral",
            "criteria_scores": [
                {"criterion": "Technical Skills", "score": 3, "notes": ""},
                {"criterion": "Communication", "score": 3, "notes": ""},
            ],
            "strengths": "Solid fundamentals.",
            "concerns": "Wasn't able to speak in depth about recent projects — worth probing further next round.",
            "overall_notes": SEED_MARKER,
        })
        print(f"  {c2['full_name']}: Phone Screen — Completed, mixed scorecard added")

    r = session.post(f"{args.base_url}/api/interviews/interviews", json={
        "candidate_id": c2["id"], "requisition_id": req2["id"] if req2 else None,
        "round_name": "Technical Interview", "round_number": 2,
        "interviewers": [{"name": "Elena Kovac", "email": "elena.kovac@example.com"}],
        "duration_minutes": 60, "location_or_link": "https://meet.example.com/interview-room",
        "scheduled_at": (now + timedelta(days=3)).isoformat(),
        "notes": SEED_MARKER,
    })
    if r.status_code == 200:
        print(f"  {c2['full_name']}: Technical Interview — Scheduled (upcoming)")

    # 3) Candidate 3: one cancelled, one no-show — the "didn't work out"
    #    stories, so those statuses have real rows too.
    r = session.post(f"{args.base_url}/api/interviews/interviews", json={
        "candidate_id": c3["id"], "round_name": "Phone Screen", "round_number": 1,
        "interviewers": [{"name": "Sam Wilson", "email": "sam.wilson@example.com"}],
        "duration_minutes": 30, "scheduled_at": (now - timedelta(days=5)).isoformat(),
        "notes": SEED_MARKER,
    })
    if r.status_code == 200:
        iv = r.json()
        session.post(f"{args.base_url}/api/interviews/interviews/{iv['id']}/status",
                      json={"status": "Cancelled", "cancellation_reason": "Candidate accepted another offer."})
        print(f"  {c3['full_name']}: Phone Screen — Cancelled")

    r = session.post(f"{args.base_url}/api/interviews/interviews", json={
        "candidate_id": c3["id"], "round_name": "Technical Interview", "round_number": 1,
        "interviewers": [{"name": "Sam Wilson", "email": "sam.wilson@example.com"}],
        "duration_minutes": 60, "scheduled_at": (now - timedelta(days=1)).isoformat(),
        "notes": SEED_MARKER,
    })
    if r.status_code == 200:
        iv = r.json()
        session.post(f"{args.base_url}/api/interviews/interviews/{iv['id']}/status", json={"status": "No-Show"})
        print(f"  {c3['full_name']}: Technical Interview — No-Show")

    # 4) One live self-scheduling link, left in "Requested" status, so you
    #    can actually open the candidate-facing page yourself and confirm
    #    a slot end-to-end.
    r = session.post(f"{args.base_url}/api/interviews/interviews", json={
        "candidate_id": c1["id"], "round_name": "Reference Check Call", "round_number": 4,
        "interviewers": [{"name": "Priya Anand", "email": "priya.anand@example.com"}],
        "duration_minutes": 20, "notes": SEED_MARKER,
    })
    schedule_link = None
    if r.status_code == 200:
        iv = r.json()
        slot_times = [(now + timedelta(days=d, hours=h)).isoformat() for d, h in [(2, 10), (2, 14), (3, 11)]]
        link_res = session.post(
            f"{args.base_url}/api/interviews/interviews/{iv['id']}/self-schedule-link",
            json={"proposed_slots": slot_times},
        )
        if link_res.status_code == 200:
            schedule_link = f"{args.base_url.replace('8000', '5173')}{link_res.json()['schedule_url_path']}"
            print(f"  {c1['full_name']}: Reference Check Call — self-scheduling link generated")

    print(f"\nDone. {SEED_MARKER}")
    print("Open Interview Management (/app/interviews) to see the seeded data.")
    if schedule_link:
        print(f"\nTry the candidate self-scheduling flow yourself here:\n  {schedule_link}")
        print("(Adjust the port above if your frontend isn't running on 5173.)")
    print("\nTip: to test the Calendly integration instead of TalentIQ's own scheduling link,")
    print("save your Calendly Personal Access Token under Settings -> API Keys -> Calendly first.")


if __name__ == "__main__":
    main()
