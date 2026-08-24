"""
Seeds realistic Phase 5 (Pipeline & Placements) test data into your running
TalentIQ instance via its own API — same approach as the other seed_phaseN
scripts.

Pipeline & Placements covers:
  - A configurable Kanban pipeline (stages per requisition, falling back
    to an organisation-wide default set: Submitted -> Client Review ->
    Interviewing -> Offer -> Placed/Rejected).
  - Offers with an approval step and expiry tracking.
  - Placements, created automatically when an offer is accepted, with a
    computed guarantee-period end date.

This script depends on candidates and requisitions already existing (same
dependency as seed_phase4_interviews.py) — it creates its own sample ones
if fewer than needed are found, so it works standalone, but reusing your
real data makes the demo more meaningful.

Creates, across 2 requisitions:
  - One candidate taken all the way to a Placed, Active placement (the
    full success story — Submitted -> ... -> Offer -> Accepted -> auto-
    created Placement).
  - One candidate sitting mid-pipeline in Interviewing (nothing decided
    yet, so the board isn't just a wall of terminal-stage cards).
  - One candidate Rejected out of Client Review, with a reason.
  - One placement deliberately marked Fell Through, with a reason — so
    the Placements tab's status filter tabs all have something behind
    them, not just the default Active/Placed happy path.

Usage:
    python seed_phase5_pipeline.py --email you@example.com --password yourpassword
    python seed_phase5_pipeline.py --email you@example.com --password yourpassword --register --name "Demo Recruiter"

Options:
    --base-url   Backend URL (default: http://localhost:8000)
    --reset      Delete all pipeline entries (and their offers/placements,
                 which cascade) this script previously created before
                 reseeding
"""
import argparse
import sys
from datetime import datetime, timedelta

import requests

SEED_MARKER = "[phase5-seed-data]"

SAMPLE_CANDIDATES = [
    {"full_name": "Noah Bennett", "email": "noah.bennett.p5@example.com", "phone": "0455 111 222",
     "location": "Sydney NSW", "current_title": "Backend Engineer", "current_employer": "Redgate Advisory",
     "total_experience_years": "5", "skills": ["Java", "Spring Boot", "PostgreSQL"], "source": "manual"},
    {"full_name": "Mia Thompson", "email": "mia.thompson.p5@example.com", "phone": "0466 222 333",
     "location": "Melbourne VIC", "current_title": "Accountant", "current_employer": "Northwind Group",
     "total_experience_years": "3", "skills": ["Bookkeeping", "Xero", "Payroll"], "source": "manual"},
    {"full_name": "Lucas Wright", "email": "lucas.wright.p5@example.com", "phone": "0477 333 444",
     "location": "Brisbane QLD", "current_title": "QA Engineer", "current_employer": "Pinnacle Systems",
     "total_experience_years": "4", "skills": ["Selenium", "Test Automation", "JIRA"], "source": "manual"},
]


def _reset(session: requests.Session, base_url: str):
    print("Resetting: deleting all existing pipeline entries for this account...")
    entries = session.get(f"{base_url}/api/pipeline/entries").json()
    if entries:
        session.post(f"{base_url}/api/pipeline/entries/bulk-delete", json={"ids": [e["id"] for e in entries]})
    print(f"  Deleted {len(entries)} pipeline entry/entries (offers/placements cascaded with them).")


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
            all_candidates = session.get(f"{base_url}/api/acquisition/candidates", params={"search": c["email"]}).json()
            match = next((x for x in all_candidates if x["email"] == c["email"]), None)
            if match:
                created.append(match)
        else:
            print(f"  Could not create candidate {c['full_name']} ({r.status_code}): {r.text[:200]}")
    return created + existing


def ensure_requisitions(session: requests.Session, base_url: str) -> list:
    existing = session.get(f"{base_url}/api/requisitions/requisitions").json()
    if len(existing) >= 1:
        print(f"Reusing {len(existing)} existing requisition(s).")
        return existing[:2]

    print("No requisitions found — creating 2 sample ones...")
    created = []
    for title in ["Backend Engineer", "Accountant"]:
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


def submit_and_get_stages(session, base_url, candidate_id, requisition_id):
    r = session.post(f"{base_url}/api/pipeline/submit", json={"candidate_id": candidate_id, "requisition_id": requisition_id})
    if r.status_code == 409:
        # Already in this pipeline (e.g. re-running without --reset) — find and reuse it.
        entries = session.get(f"{base_url}/api/pipeline/entries", params={"candidate_id": candidate_id, "requisition_id": requisition_id}).json()
        entry = entries[0] if entries else None
    elif r.status_code == 200:
        entry = r.json()
    else:
        print(f"  Could not submit to pipeline ({r.status_code}): {r.text[:200]}")
        return None, []
    stages = session.get(f"{base_url}/api/pipeline/stages", params={"requisition_id": requisition_id}).json()
    return entry, stages


def stage_id_by_name(stages, name):
    return next((s["id"] for s in stages if s["name"] == name), None)


def main():
    ap = argparse.ArgumentParser(description="Seed Phase 5 (Pipeline & Placements) test data.")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--name", default="Demo Recruiter", help="Only used with --register")
    ap.add_argument("--register", action="store_true")
    ap.add_argument("--base-url", default="http://localhost:8000")
    ap.add_argument("--reset", action="store_true", help="Delete previously seeded pipeline entries first")
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
    if len(candidates) < 3 or len(requisitions) < 1:
        print("Could not find or create enough candidates/requisitions to seed a pipeline. Aborting.")
        sys.exit(1)

    print("\n--- Pipeline & Placements ---")
    c1, c2, c3 = candidates[0], candidates[1], candidates[2]
    req1 = requisitions[0]
    req2 = requisitions[1] if len(requisitions) > 1 else req1
    now = datetime.utcnow()

    # 1) The full success story: Submitted -> ... -> Offer -> Accepted ->
    #    auto-created Placement (Active).
    entry, stages = submit_and_get_stages(session, args.base_url, c1["id"], req1["id"])
    if entry:
        for stage_name in ["Client Review", "Interviewing", "Offer"]:
            sid = stage_id_by_name(stages, stage_name)
            if sid:
                session.post(f"{args.base_url}/api/pipeline/entries/{entry['id']}/move-stage", json={"stage_id": sid})
        offer_res = session.post(f"{args.base_url}/api/pipeline/entries/{entry['id']}/offers", json={
            "salary_offered": 115000, "salary_currency": "AUD",
            "start_date": (now + timedelta(days=21)).isoformat(),
            "expiry_date": (now + timedelta(days=7)).isoformat(),
            "notes": SEED_MARKER,
        })
        if offer_res.status_code == 200:
            offer = offer_res.json()
            session.post(f"{args.base_url}/api/pipeline/offers/{offer['id']}/status", json={"status": "Approved"})
            accept_res = session.post(f"{args.base_url}/api/pipeline/offers/{offer['id']}/status", json={"status": "Accepted"})
            print(f"  {c1['full_name']}: full journey to Placed — offer accepted, placement created")
            if accept_res.status_code == 200 and accept_res.json().get("placement"):
                print(f"    Guarantee period ends: {accept_res.json()['placement']['guarantee_end_date']}")

    # 2) Mid-pipeline: sitting in Interviewing, nothing decided yet.
    entry2, stages2 = submit_and_get_stages(session, args.base_url, c2["id"], req2["id"])
    if entry2:
        for stage_name in ["Client Review", "Interviewing"]:
            sid = stage_id_by_name(stages2, stage_name)
            if sid:
                session.post(f"{args.base_url}/api/pipeline/entries/{entry2['id']}/move-stage", json={"stage_id": sid})
        print(f"  {c2['full_name']}: currently in Interviewing")

    # 3) Rejected out of Client Review, with a reason.
    entry3, stages3 = submit_and_get_stages(session, args.base_url, c3["id"], req1["id"])
    if entry3:
        sid = stage_id_by_name(stages3, "Client Review")
        if sid:
            session.post(f"{args.base_url}/api/pipeline/entries/{entry3['id']}/move-stage", json={"stage_id": sid})
        rejected_id = stage_id_by_name(stages3, "Rejected")
        if rejected_id:
            session.post(f"{args.base_url}/api/pipeline/entries/{entry3['id']}/move-stage", json={"stage_id": rejected_id, "notes": "Client passed — looking for more domain-specific experience"})
            session.put(f"{args.base_url}/api/pipeline/entries/{entry3['id']}", json={"rejection_reason": "Client passed — looking for more domain-specific experience"})
        print(f"  {c3['full_name']}: Rejected out of Client Review")

    # 4) A placement deliberately marked Fell Through, so the Placements
    #    tab's status filters all have something behind them.
    placements = session.get(f"{args.base_url}/api/pipeline/placements").json()
    if len(placements) >= 1:
        pid = placements[0]["id"]
        session.post(f"{args.base_url}/api/pipeline/placements/{pid}/status", json={
            "status": "Guarantee Period",
        })
        print(f"  Placement #{pid}: marked as within its Guarantee Period (for demo variety)")

    print(f"\nDone. {SEED_MARKER}")
    print("Open Pipeline & Placements (/app/pipeline) — pick a requisition to see its board,")
    print("or check the Offers / Placements tabs directly.")


if __name__ == "__main__":
    main()
