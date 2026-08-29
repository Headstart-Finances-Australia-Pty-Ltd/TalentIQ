"""
Seeds realistic Phase 8 (Commercials) test data into your running TalentIQ
instance via its own API — same approach as the other seed_phaseN scripts.

Commercials covers:
  - Single-line invoicing against a Placement (Phase 5).
  - Guarantee/rebate deadline visibility (reuses Placement.guarantee_end_date
    from Phase 5 — nothing duplicated).
  - Optional contractor timesheets, rollable into an invoice.
  - A revenue report (by requisition, by month).

This script depends on at least one Placement already existing (same
dependency chain as the other seed_phaseN scripts — Placements come from
Phase 5's pipeline, an Offer being marked Accepted). If none is found, it
creates the full chain itself: candidate -> requisition -> pipeline entry
-> offer -> accepted -> placement.

Creates:
  - A Paid invoice against the first available placement (the "already
    settled" story).
  - A Sent (unpaid) invoice against a second placement, if one exists or
    can be created — so the Revenue Report's "Outstanding" figure isn't
    zero.
  - Two weeks of contractor timesheet entries against the same placement,
    one Approved and one still Submitted — so the Timesheets tab shows
    both the "ready to invoice" and "needs approval" states, and you can
    try the actual roll-up-into-invoice action yourself.

Usage:
    python seed_phase8_commercials.py --email you@example.com --password yourpassword
    python seed_phase8_commercials.py --email you@example.com --password yourpassword --register --name "Demo Recruiter"

Options:
    --base-url   Backend URL (default: http://localhost:8000)
    --reset      Cancels the invoices this script previously created
                 before reseeding (does not delete placements,
                 requisitions, or candidates)
"""
import argparse
import sys
from datetime import date, timedelta

import requests

SEED_MARKER = "[phase8-seed-data]"


def ensure_placement(session: requests.Session, base_url: str, candidate_name: str, candidate_email: str, requisition_title: str, salary: float) -> dict:
    placements = session.get(f"{base_url}/api/pipeline/placements").json()
    existing = next((p for p in placements if p["candidate_name"] == candidate_name), None)
    if existing:
        return existing

    candidates = session.get(f"{base_url}/api/acquisition/candidates").json()
    candidate = next((c for c in candidates if c["email"] == candidate_email), None)
    if not candidate:
        r = session.post(f"{base_url}/api/acquisition/candidates", json={
            "full_name": candidate_name, "email": candidate_email, "consent_given": True, "notes": SEED_MARKER,
        })
        candidate = r.json()
        print(f"  Created candidate: {candidate_name}")

    requisitions = session.get(f"{base_url}/api/requisitions/requisitions").json()
    requisition = next((r for r in requisitions if r["title"] == requisition_title), None)
    if not requisition:
        r = session.post(f"{base_url}/api/requisitions/requisitions", json={
            "title": requisition_title, "priority": "High", "vacancy_count": 1,
            "reason_for_hire": "New Position", "employment_type": "Full-time", "notes": SEED_MARKER,
        })
        requisition = r.json()
        print(f"  Created requisition: {requisition_title}")

    entry_res = session.post(f"{base_url}/api/pipeline/submit", json={"candidate_id": candidate["id"], "requisition_id": requisition["id"]})
    if entry_res.status_code not in (200, 409):
        print(f"  Could not submit to pipeline ({entry_res.status_code}): {entry_res.text[:200]}")
        return {}
    entries = session.get(f"{base_url}/api/pipeline/entries", params={"candidate_id": candidate["id"], "requisition_id": requisition["id"]}).json()
    if not entries:
        return {}
    entry_id = entries[0]["id"]

    offer_res = session.post(f"{base_url}/api/pipeline/entries/{entry_id}/offers", json={
        "salary_offered": salary, "salary_currency": "AUD", "start_date": (date.today() + timedelta(days=14)).isoformat(),
    })
    if offer_res.status_code != 200:
        print(f"  Could not create offer ({offer_res.status_code}): {offer_res.text[:200]}")
        return {}
    offer_id = offer_res.json()["id"]
    accept_res = session.post(f"{base_url}/api/pipeline/offers/{offer_id}/status", json={"status": "Accepted"})
    if accept_res.status_code == 200 and accept_res.json().get("placement"):
        print(f"  Placed {candidate_name} — placement created")

    placements = session.get(f"{base_url}/api/pipeline/placements").json()
    return next((p for p in placements if p["candidate_name"] == candidate_name), {})


def main():
    ap = argparse.ArgumentParser(description="Seed Phase 8 (Commercials) test data.")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--name", default="Demo Recruiter", help="Only used with --register")
    ap.add_argument("--register", action="store_true")
    ap.add_argument("--base-url", default="http://localhost:8000")
    ap.add_argument("--reset", action="store_true", help="Cancel previously seeded invoices first")
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

    if args.reset:
        print("\n--- Resetting ---")
        invoices = session.get(f"{args.base_url}/api/commercials/invoices").json()
        cancelled = 0
        for inv in invoices:
            if SEED_MARKER in (inv.get("description") or "") or SEED_MARKER in (inv.get("notes") or ""):
                session.post(f"{args.base_url}/api/commercials/invoices/{inv['id']}/status", json={"status": "Cancelled"})
                cancelled += 1
        print(f"  Cancelled {cancelled} previously seeded invoice(s).")

    print("\n--- Prerequisites ---")
    placement1 = ensure_placement(session, args.base_url, "Priya Anand", "priya.anand.p8@example.com", "Senior Backend Engineer", 115000)
    placement2 = ensure_placement(session, args.base_url, "Marcus Webb", "marcus.webb.p8@example.com", "Financial Analyst", 95000)

    if not placement1:
        print("Could not find or create a placement to seed against. Aborting.")
        sys.exit(1)

    print("\n--- Invoices ---")
    inv1 = session.post(f"{args.base_url}/api/commercials/invoices", json={
        "placement_id": placement1["id"], "issue_date": (date.today() - timedelta(days=20)).isoformat(),
        "due_date": (date.today() - timedelta(days=6)).isoformat(), "notes": SEED_MARKER,
    })
    if inv1.status_code == 200:
        inv1_id = inv1.json()["id"]
        session.post(f"{args.base_url}/api/commercials/invoices/{inv1_id}/status", json={"status": "Sent"})
        session.post(f"{args.base_url}/api/commercials/invoices/{inv1_id}/status", json={"status": "Paid"})
        print(f"  Created and paid an invoice for {placement1['candidate_name']}")

    if placement2:
        inv2 = session.post(f"{args.base_url}/api/commercials/invoices", json={
            "placement_id": placement2["id"], "issue_date": date.today().isoformat(),
            "due_date": (date.today() + timedelta(days=14)).isoformat(), "notes": SEED_MARKER,
        })
        if inv2.status_code == 200:
            inv2_id = inv2.json()["id"]
            session.post(f"{args.base_url}/api/commercials/invoices/{inv2_id}/status", json={"status": "Sent"})
            print(f"  Created and sent (unpaid) an invoice for {placement2['candidate_name']}")

    print("\n--- Timesheets ---")
    ts1 = session.post(f"{args.base_url}/api/commercials/timesheets", json={
        "placement_id": placement1["id"], "week_ending": (date.today() - timedelta(days=7)).isoformat(),
        "hours": 40, "rate": 85, "notes": SEED_MARKER,
    })
    if ts1.status_code == 200:
        session.post(f"{args.base_url}/api/commercials/timesheets/{ts1.json()['id']}/approve")
        print(f"  Logged and approved a week of hours for {placement1['candidate_name']}")

    ts2 = session.post(f"{args.base_url}/api/commercials/timesheets", json={
        "placement_id": placement1["id"], "week_ending": date.today().isoformat(),
        "hours": 38, "rate": 85, "notes": SEED_MARKER,
    })
    if ts2.status_code == 200:
        print(f"  Logged a second week of hours (still Submitted — try approving it yourself)")

    print(f"\nDone. {SEED_MARKER}")
    print("Open Commercials (/app/commercials):")
    print("  - Invoices: one Paid, one Sent (unpaid)")
    print("  - Guarantee Alerts: check with a wide window (e.g. 200 days) to see the seeded placements")
    print("  - Timesheets: one Approved (ready to roll into an invoice), one Submitted (needs approval)")
    print("  - Revenue: totals and breakdowns reflecting the invoices above")


if __name__ == "__main__":
    main()
