"""
Seeds realistic Phase 9 (Governance) test data into your running TalentIQ
instance via its own API — same approach as the other seed_phaseN scripts.

Governance covers:
  - Reporting: time-to-fill, funnel conversion, source-of-hire, and
    recruiter/vendor performance — all computed live from data every
    other capability already owns, not duplicated here.
  - Access Control: a real multi-person team (OrganisationMembership) —
    Owner, Manager, Recruiter roles that actually affect what's visible,
    not just a label.

This script is different from the others: it needs a SECOND account to
demonstrate team/role scoping meaningfully (inviting yourself into your
own org isn't a real test of anything). It creates that second account
itself if you don't provide one.

Creates:
  - Invites a second user (created automatically if
    --recruiter-email/--recruiter-password aren't both already a real
    account) into your organisation as a Recruiter.
  - Has that Recruiter "own" one candidate's pipeline progression, so
    the Recruiter Performance report has two different rows to compare —
    open it as the Owner (sees both) vs. logging in as the Recruiter
    (sees only their own).
  - Depends on requisitions/candidates/placements existing for the
    reporting metrics to show anything meaningful — reuses whatever the
    other seed_phaseN scripts already created; run seed_phase5_pipeline.py
    first if you haven't, so Time to Fill / Source of Hire / Funnel
    aren't empty.

Usage:
    python seed_phase9_governance.py --email you@example.com --password yourpassword
    python seed_phase9_governance.py --email you@example.com --password yourpassword --register --name "Demo Recruiter"

Options:
    --base-url            Backend URL (default: http://localhost:8000)
    --recruiter-email     Email for the second (Recruiter) account this
                           script creates/reuses (default: a generated
                           demo address)
    --recruiter-password  Password for that account (default: a fixed
                           demo password — change it if this isn't a
                           throwaway environment)
    --reset                Removes the Recruiter this script invited from
                           your team before reseeding (does not delete
                           their account, requisitions, or candidates)
"""
import argparse
import sys

import requests

SEED_MARKER = "[phase9-seed-data]"


def main():
    ap = argparse.ArgumentParser(description="Seed Phase 9 (Governance) test data.")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--name", default="Demo Recruiter", help="Only used with --register")
    ap.add_argument("--register", action="store_true")
    ap.add_argument("--base-url", default="http://localhost:8000")
    ap.add_argument("--recruiter-email", default="demo.recruiter.p9@example.com")
    ap.add_argument("--recruiter-password", default="DemoRecruiter123")
    ap.add_argument("--reset", action="store_true", help="Remove the previously seeded Recruiter from your team first")
    args = ap.parse_args()

    owner_session = requests.Session()

    if args.register:
        r = owner_session.post(f"{args.base_url}/api/auth/register", json={"name": args.name, "email": args.email, "password": args.password})
        if r.status_code in (200, 201):
            print(f"Registered new account: {args.email}")
        elif r.status_code in (400, 409):
            print(f"Account already exists — continuing to log in: {args.email}")
        else:
            print(f"Registration failed ({r.status_code}): {r.text}")
            sys.exit(1)

    r = owner_session.post(f"{args.base_url}/api/auth/login", json={"email": args.email, "password": args.password})
    if r.status_code != 200:
        print(f"Login failed ({r.status_code}): {r.text}")
        print('Tip: pass --register --name "Your Name" if this account doesn\'t exist yet.')
        sys.exit(1)
    owner_session.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    print(f"Logged in as {args.email} (this will be the Owner)")

    print("\n--- Setting up the Recruiter account ---")
    recruiter_session = requests.Session()
    reg = recruiter_session.post(f"{args.base_url}/api/auth/register", json={
        "name": "Demo Recruiter (Phase 9)", "email": args.recruiter_email, "password": args.recruiter_password,
    })
    if reg.status_code in (200, 201):
        print(f"  Created recruiter account: {args.recruiter_email}")
    elif reg.status_code in (400, 409):
        print(f"  Recruiter account already exists — reusing: {args.recruiter_email}")
    else:
        print(f"  Could not create recruiter account ({reg.status_code}): {reg.text[:200]}")
        sys.exit(1)
    r = recruiter_session.post(f"{args.base_url}/api/auth/login", json={"email": args.recruiter_email, "password": args.recruiter_password})
    if r.status_code != 200:
        print(f"  Could not log in as the recruiter account ({r.status_code}): {r.text[:200]}")
        sys.exit(1)
    recruiter_session.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})

    if args.reset:
        print("\n--- Resetting ---")
        team = owner_session.get(f"{args.base_url}/api/governance/team").json()
        existing = next((m for m in team if m["email"] == args.recruiter_email and m["membership_id"]), None)
        if existing:
            owner_session.delete(f"{args.base_url}/api/governance/team/{existing['membership_id']}")
            print(f"  Removed {args.recruiter_email} from your team.")

    print("\n--- Inviting the Recruiter onto your team ---")
    invite_res = owner_session.post(f"{args.base_url}/api/governance/team/invite", json={"email": args.recruiter_email, "role": "Recruiter"})
    if invite_res.status_code == 200:
        print(f"  Invited {args.recruiter_email} as Recruiter.")
    elif invite_res.status_code == 409:
        print(f"  {args.recruiter_email} is already on your team.")
    else:
        print(f"  Could not invite ({invite_res.status_code}): {invite_res.text[:200]}")

    print("\n--- Giving the Recruiter something to own ---")
    requisitions = owner_session.get(f"{args.base_url}/api/requisitions/requisitions").json()
    if not requisitions:
        req_res = owner_session.post(f"{args.base_url}/api/requisitions/requisitions", json={
            "title": "Governance Demo Role", "priority": "Medium", "vacancy_count": 1,
            "reason_for_hire": "New Position", "employment_type": "Full-time", "notes": SEED_MARKER,
        })
        requisitions = [req_res.json()]
    requisition_id = requisitions[0]["id"]

    candidates = owner_session.get(f"{args.base_url}/api/acquisition/candidates").json()
    demo_candidate = next((c for c in candidates if c["email"] == "governance.demo.p9@example.com"), None)
    if not demo_candidate:
        cand_res = owner_session.post(f"{args.base_url}/api/acquisition/candidates", json={
            "full_name": "Governance Demo Candidate", "email": "governance.demo.p9@example.com",
            "consent_given": True, "notes": SEED_MARKER,
        })
        demo_candidate = cand_res.json()

    team = owner_session.get(f"{args.base_url}/api/governance/team").json()
    recruiter_member = next((m for m in team if m["email"] == args.recruiter_email), None)
    if recruiter_member:
        entries = owner_session.get(f"{args.base_url}/api/pipeline/entries", params={"candidate_id": demo_candidate["id"], "requisition_id": requisition_id}).json()
        if not entries:
            submit_res = owner_session.post(f"{args.base_url}/api/pipeline/submit", json={
                "candidate_id": demo_candidate["id"], "requisition_id": requisition_id,
                "owner_user_id": recruiter_member["user_id"], "notes": SEED_MARKER,
            })
            if submit_res.status_code == 200:
                print(f"  Submitted a candidate owned by the Recruiter — Recruiter Performance now has a real row.")

    print(f"\nDone. {SEED_MARKER}")
    print("Open Governance (/app/reporting):")
    print("  - Reporting: time-to-fill / funnel / source-of-hire reflect whatever placements exist in your")
    print("    organisation (run seed_phase5_pipeline.py first if these look empty)")
    print("  - Team & Access: you (Owner) plus the seeded Recruiter — try changing their role or removing them")
    print(f"  - Log in as the Recruiter yourself to see the difference: {args.recruiter_email} / {args.recruiter_password}")
    print("    Recruiter Performance will show only their own row, not the whole organisation's.")


if __name__ == "__main__":
    main()
