"""
Seeds realistic Phase 6 (Client & Vendor Collaboration) test data into your
running TalentIQ instance via its own API — same approach as the other
seed_phaseN scripts.

Client & Vendor Collaboration covers:
  - A client portal (token-based link) where a hiring-company contact can
    review candidates in their own requisitions' pipelines, download
    resumes, and leave feedback (approve/reject/request interview) — with
    direct candidate contact details always hidden from the client view.
  - A vendor portal (token-based link) where an assigned subcontractor
    recruiter can submit candidates for specific requisitions they've
    been granted access to; submissions land in a review queue rather
    than the live pipeline until a recruiter accepts them.

This script depends on requisitions and candidates already existing (same
dependency as the other seed_phaseN scripts) — it creates its own sample
ones if none are found.

Creates:
  - A client with a generated portal link, one requisition, and one
    candidate already in that requisition's pipeline — so opening the
    printed client-portal link immediately shows something real to
    review and leave feedback on.
  - A vendor with a generated portal link, assigned to that same
    requisition, with one already-submitted candidate sitting in
    "Pending Review" — so opening Client & Vendor Collaboration ->
    Vendor Submissions immediately has something to accept or reject,
    and opening the printed vendor-portal link shows a real submission
    history entry.

Usage:
    python seed_phase6_portals.py --email you@example.com --password yourpassword
    python seed_phase6_portals.py --email you@example.com --password yourpassword --register --name "Demo Recruiter"

Options:
    --base-url   Backend URL (default: http://localhost:8000)
    --reset      Revokes the client/vendor portal links and deletes the
                 vendor submission this script previously created before
                 reseeding (does not delete the client/vendor/requisition/
                 candidate records themselves)
"""
import argparse
import sys

import requests

SEED_MARKER = "[phase6-seed-data]"


def ensure_client(session: requests.Session, base_url: str) -> dict:
    existing = session.get(f"{base_url}/api/candidatetrack/clients").json()
    if existing:
        print(f"Reusing existing client: {existing[0]['name']}")
        return existing[0]
    r = session.post(f"{base_url}/api/candidatetrack/clients", json={"name": "Northwind Group", "area_of_work": "Financial Services"})
    client = r.json()
    print(f"Created client: {client['name']}")
    return client


def ensure_vendor(session: requests.Session, base_url: str) -> dict:
    existing = session.get(f"{base_url}/api/candidatetrack/vendors").json()
    if existing:
        print(f"Reusing existing vendor: {existing[0]['name']}")
        return existing[0]
    r = session.post(f"{base_url}/api/candidatetrack/vendors", json={"name": "Apex Staffing Partners", "coverage_region": "Sydney/Melbourne"})
    vendor = r.json()
    print(f"Created vendor: {vendor['name']}")
    return vendor


def ensure_requisition(session: requests.Session, base_url: str, client_id: int) -> dict:
    existing = session.get(f"{base_url}/api/requisitions/requisitions", params={"client_id": client_id}).json()
    if existing:
        print(f"Reusing existing requisition for this client: {existing[0]['title']}")
        return existing[0]
    r = session.post(f"{base_url}/api/requisitions/requisitions", json={
        "title": "Senior Backend Engineer", "client_id": client_id, "priority": "High",
        "vacancy_count": 1, "reason_for_hire": "New Position", "employment_type": "Full-time",
        "notes": SEED_MARKER,
    })
    req = r.json()
    print(f"Created requisition: {req['title']}")
    return req


def ensure_candidate_in_pipeline(session: requests.Session, base_url: str, requisition_id: int) -> None:
    candidates = session.get(f"{base_url}/api/acquisition/candidates").json()
    candidate = next((c for c in candidates if c["email"] == "priya.anand.p6@example.com"), None)
    if not candidate:
        r = session.post(f"{base_url}/api/acquisition/candidates", json={
            "full_name": "Priya Anand", "email": "priya.anand.p6@example.com", "phone": "0433 555 111",
            "current_title": "Backend Engineer", "current_employer": "Redgate Advisory",
            "total_experience_years": "6", "skills": ["Python", "FastAPI", "PostgreSQL"],
            "consent_given": True, "notes": SEED_MARKER,
        })
        candidate = r.json()
        print(f"  Created candidate: {candidate['full_name']}")

    entries = session.get(f"{base_url}/api/pipeline/entries", params={"requisition_id": requisition_id, "candidate_id": candidate["id"]}).json()
    if not entries:
        session.post(f"{base_url}/api/pipeline/submit", json={"candidate_id": candidate["id"], "requisition_id": requisition_id, "notes": SEED_MARKER})
        print(f"  Added {candidate['full_name']} to the pipeline for this requisition")


def main():
    ap = argparse.ArgumentParser(description="Seed Phase 6 (Client & Vendor Collaboration) test data.")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--name", default="Demo Recruiter", help="Only used with --register")
    ap.add_argument("--register", action="store_true")
    ap.add_argument("--base-url", default="http://localhost:8000")
    ap.add_argument("--reset", action="store_true", help="Revoke previously seeded portal links first")
    args = ap.parse_args()

    session = requests.Session()

    if args.register:
        r = session.post(f"{args.base_url}/api/auth/register", json={"name": args.name, "email": args.email, "password": args.password})
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

    print("\n--- Prerequisites ---")
    client = ensure_client(session, args.base_url)
    vendor = ensure_vendor(session, args.base_url)
    requisition = ensure_requisition(session, args.base_url, client["id"])

    if args.reset:
        print("\n--- Resetting ---")
        session.post(f"{args.base_url}/api/portal/clients/{client['id']}/token/revoke")
        session.post(f"{args.base_url}/api/portal/vendors/{vendor['id']}/token/revoke")
        print("  Revoked existing client/vendor portal links (new ones will be generated below).")

    print("\n--- Client Portal ---")
    ensure_candidate_in_pipeline(session, args.base_url, requisition["id"])
    client_token_res = session.post(f"{args.base_url}/api/portal/clients/{client['id']}/token").json()
    client_portal_url = f"{args.base_url.replace('8000', '5173')}{client_token_res['portal_path']}"
    print(f"  Client portal link generated for {client['name']}:")
    print(f"    {client_portal_url}")

    print("\n--- Vendor Portal ---")
    assign_res = session.post(f"{args.base_url}/api/portal/vendor-assignments", json={"vendor_id": vendor["id"], "requisition_id": requisition["id"]})
    if assign_res.status_code == 200:
        print(f"  Assigned {vendor['name']} to '{requisition['title']}'")
    vendor_token_res = session.post(f"{args.base_url}/api/portal/vendors/{vendor['id']}/token").json()
    vendor_token = vendor_token_res["token"]
    vendor_portal_url = f"{args.base_url.replace('8000', '5173')}{vendor_token_res['portal_path']}"
    print(f"  Vendor portal link generated for {vendor['name']}:")
    print(f"    {vendor_portal_url}")

    # Submit one sample candidate through the vendor's public portal (as
    # the vendor would), so the recruiter's review queue has something
    # real waiting in it.
    existing_submissions = session.get(f"{args.base_url}/api/portal/vendor-submissions").json()
    already_seeded = any(s["full_name"] == "Ethan Walker" and s["vendor_id"] == vendor["id"] for s in existing_submissions)
    if not already_seeded:
        submit_res = session.post(
            f"{args.base_url}/api/public/portal/vendor/{vendor_token}/submit",
            data={
                "requisition_id": requisition["id"], "full_name": "Ethan Walker",
                "email": "ethan.walker.p6@example.com", "phone": "0466 222 333",
                "current_title": "Backend Developer", "current_employer": "Coastal Financial",
                "total_experience_years": "4", "vendor_notes": f"Strong technical fit, available immediately. {SEED_MARKER}",
            },
        )
        if submit_res.status_code == 200:
            print("  Submitted a sample candidate (Ethan Walker) through the vendor portal — sitting in Pending Review")
        else:
            print(f"  Could not submit sample candidate ({submit_res.status_code}): {submit_res.text[:200]}")
    else:
        print("  Sample vendor submission already exists — skipped.")

    print(f"\nDone. {SEED_MARKER}")
    print("Open Client & Vendor Collaboration (/app/portals) to manage links, review the vendor")
    print("submission queue, and see client feedback once you've left some via the client link above.")
    print("\nTry both portals yourself:")
    print(f"  Client portal: {client_portal_url}")
    print(f"  Vendor portal: {vendor_portal_url}")
    print("(Adjust the port above if your frontend isn't running on 5173.)")


if __name__ == "__main__":
    main()
