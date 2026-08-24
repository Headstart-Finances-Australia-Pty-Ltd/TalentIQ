"""
Seeds realistic Phase 2 (Job Requisitions) test data into your running
TalentIQ instance via its own API — same approach as seed_demo_job.py.

Creates:
  - A handful of sample clients (skips ones that already exist by name)
  - 2-3 client contacts per client (so the "Hiring Manager Contact"
    dropdown has real options to test against)
  - ~18 requisitions spread across every status (Draft, Approved, Open,
    On Hold, Filled, Cancelled) and every priority, with varied vacancy
    counts, employment types, salary ranges, and target hire dates — so
    the status-filter tabs, checklist, and hiring-manager link all have
    something real to click through.

Usage:
    python seed_phase2_requisitions.py --email you@example.com --password yourpassword
    python seed_phase2_requisitions.py --email you@example.com --password yourpassword --register --name "Demo Recruiter"

Options:
    --base-url   Backend URL (default: http://localhost:8000)
    --reset      Delete all requisitions/contacts this script previously
                 created (matched by a marker in notes) before reseeding
"""
import argparse
import random
import sys
from datetime import datetime, timedelta

import requests

random.seed(7)

SEED_MARKER = "[phase2-seed-data]"

SAMPLE_CLIENTS = [
    {"name": "Northwind Group", "address": "Sydney NSW", "abn": "51 824 753 556", "area_of_work": "Financial Services"},
    {"name": "Bluewave Solutions", "address": "Melbourne VIC", "abn": "63 002 916 004", "area_of_work": "Technology"},
    {"name": "Coastal Financial", "address": "Brisbane QLD", "abn": "34 612 445 981", "area_of_work": "Banking"},
]

CONTACTS_BY_CLIENT = {
    "Northwind Group": [
        {"name": "Priya Anand", "title": "Head of Talent", "email": "priya.anand@northwindgroup.example", "phone": "0412 555 101", "is_primary": True},
        {"name": "Marcus Webb", "title": "Finance Director", "email": "marcus.webb@northwindgroup.example", "phone": "0412 555 102", "is_primary": False},
    ],
    "Bluewave Solutions": [
        {"name": "Elena Kovac", "title": "VP Engineering", "email": "elena.kovac@bluewavesolutions.example", "phone": "0413 555 201", "is_primary": True},
        {"name": "Sam O'Neill", "title": "HR Business Partner", "email": "sam.oneill@bluewavesolutions.example", "phone": "0413 555 202", "is_primary": False},
    ],
    "Coastal Financial": [
        {"name": "Grace Liu", "title": "Chief Operating Officer", "email": "grace.liu@coastalfinancial.example", "phone": "0414 555 301", "is_primary": True},
    ],
}

TITLES = [
    "Senior Data Engineer", "Financial Controller", "Product Manager", "DevOps Engineer",
    "Backend Developer", "Marketing Manager", "Business Analyst", "Accountant",
    "Machine Learning Engineer", "Customer Success Manager", "QA Engineer", "Legal Counsel",
    "Frontend Developer", "Supply Chain Analyst", "HR Business Partner", "Network Engineer",
    "Sales Executive", "UX Designer",
]
LOCATIONS = ["Sydney NSW", "Melbourne VIC", "Brisbane QLD", "Remote", "Perth WA"]
EMPLOYMENT_TYPES = ["Full-time", "Contract", "Part-time"]
REASONS = ["New Position", "Replacement", "Backfill", "Growth"]
PRIORITIES = ["Critical", "High", "Normal", "Low"]

# Each requisition is created in Draft, then walked forward through
# whatever transitions get it to the target status — exercising the real
# status-transition endpoint rather than a raw DB write.
STATUS_PATHS = {
    "Draft": [],
    "Approved": ["Approved"],
    "Open": ["Approved", "Open"],
    "On Hold": ["Approved", "Open", "On Hold"],
    "Filled": ["Approved", "Open", "Filled"],
    "Cancelled": ["Cancelled"],
}
# How many requisitions to create per status, in order.
STATUS_DISTRIBUTION = ["Draft", "Draft", "Draft", "Approved", "Approved", "Open", "Open",
                        "Open", "Open", "Open", "On Hold", "On Hold", "Filled", "Filled",
                        "Filled", "Cancelled", "Open", "Approved"]


def main():
    ap = argparse.ArgumentParser(description="Seed Phase 2 requisition test data.")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--name", default="Demo Recruiter", help="Only used with --register")
    ap.add_argument("--register", action="store_true")
    ap.add_argument("--base-url", default="http://localhost:8000")
    ap.add_argument("--reset", action="store_true", help="Delete previously seeded requisitions/contacts first")
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
        print("Tip: pass --register --name \"Your Name\" if this account doesn't exist yet.")
        sys.exit(1)
    session.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    print(f"Logged in as {args.email}")

    if args.reset:
        _reset(session, args.base_url)

    # 1) Clients — reuse existing ones by name, create missing ones.
    existing_clients = {c["name"]: c for c in session.get(f"{args.base_url}/api/candidatetrack/clients").json()}
    clients_by_name = {}
    for c in SAMPLE_CLIENTS:
        if c["name"] in existing_clients:
            clients_by_name[c["name"]] = existing_clients[c["name"]]
            print(f"Client already exists: {c['name']}")
            continue
        r = session.post(f"{args.base_url}/api/candidatetrack/clients", json=c)
        if r.status_code != 200:
            print(f"Could not create client {c['name']} ({r.status_code}): {r.text}")
            continue
        clients_by_name[c["name"]] = r.json()
        print(f"Created client: {c['name']}")

    # 2) Client contacts
    existing_contacts = session.get(f"{args.base_url}/api/requisitions/client-contacts").json()
    existing_contact_names = {(c["client_id"], c["name"]) for c in existing_contacts}
    contacts_by_client_id = {}
    for client_name, contacts in CONTACTS_BY_CLIENT.items():
        client = clients_by_name.get(client_name)
        if not client:
            continue
        contacts_by_client_id.setdefault(client["id"], [])
        for contact in contacts:
            if (client["id"], contact["name"]) in existing_contact_names:
                continue
            r = session.post(f"{args.base_url}/api/requisitions/client-contacts", json={**contact, "client_id": client["id"]})
            if r.status_code == 200:
                contacts_by_client_id[client["id"]].append(r.json())
                print(f"Created contact: {contact['name']} ({client_name})")
        # Refresh full contact list per client for hiring-manager linking below
        contacts_by_client_id[client["id"]] = session.get(
            f"{args.base_url}/api/requisitions/client-contacts", params={"client_id": client["id"]}
        ).json()

    # 3) Requisitions — walked through their real status transitions.
    client_list = list(clients_by_name.values())
    created, transitioned_ok, checklist_set = 0, 0, 0
    for i, target_status in enumerate(STATUS_DISTRIBUTION):
        title = TITLES[i % len(TITLES)]
        client = random.choice(client_list) if client_list and random.random() > 0.1 else None
        contacts = contacts_by_client_id.get(client["id"], []) if client else []
        hm_contact = random.choice(contacts) if contacts and random.random() > 0.3 else None

        salary_base = random.choice([70000, 90000, 110000, 130000, 160000])
        payload = {
            "title": title,
            "client_id": client["id"] if client else None,
            "priority": random.choice(PRIORITIES),
            "vacancy_count": random.choice([1, 1, 1, 2, 3]),
            "reason_for_hire": random.choice(REASONS),
            "employment_type": random.choice(EMPLOYMENT_TYPES),
            "location": random.choice(LOCATIONS),
            "salary_min": salary_base,
            "salary_max": salary_base + random.choice([10000, 20000, 30000]),
            "target_hire_date": (datetime.utcnow() + timedelta(days=random.randint(14, 90))).isoformat(),
            "hiring_manager_contact_id": hm_contact["id"] if hm_contact else None,
            "hiring_manager_name": "" if hm_contact else "Alex Morgan",
            "hiring_manager_email": "" if hm_contact else "alex.morgan@example.com",
            "notes": SEED_MARKER,
        }
        r = session.post(f"{args.base_url}/api/requisitions/requisitions", json=payload)
        if r.status_code != 200:
            print(f"Could not create requisition '{title}' ({r.status_code}): {r.text}")
            continue
        req = r.json()
        created += 1

        # Walk through the real status-transition endpoint.
        ok = True
        for step in STATUS_PATHS[target_status]:
            sr = session.post(f"{args.base_url}/api/requisitions/requisitions/{req['id']}/status", json={"status": step})
            if sr.status_code != 200:
                ok = False
                print(f"  Transition {req['title']} -> {step} failed: {sr.text}")
                break
        if ok:
            transitioned_ok += 1

        # Give roughly half of them a partially/fully completed checklist,
        # so the dashboard's Complete/Incomplete split has real variety.
        if random.random() > 0.4:
            checklist = {
                "salary_approved": random.random() > 0.3,
                "headcount_approved": random.random() > 0.3,
                "jd_approved": random.random() > 0.5,
                "location_confirmed": random.random() > 0.2,
            }
            cr = session.put(f"{args.base_url}/api/requisitions/requisitions/{req['id']}/checklist", json=checklist)
            if cr.status_code == 200:
                checklist_set += 1

        print(f"Created requisition #{req['sequence_number']}: {title} -> {target_status} "
              f"({'client: ' + client['name'] if client else 'no client'})")

    print()
    print("=" * 60)
    print(f"Done. {created} requisitions created, {transitioned_ok} reached their target status, "
          f"{checklist_set} got checklist data.")
    print(f"Open http://localhost:5173/app/requisitions to see them (use the status tabs to filter).")
    print("=" * 60)


def _reset(session: requests.Session, base_url: str):
    print("Resetting previously seeded data...")
    reqs = session.get(f"{base_url}/api/requisitions/requisitions").json()
    deleted = 0
    for r in reqs:
        if SEED_MARKER in (r.get("notes") or ""):
            dr = session.delete(f"{base_url}/api/requisitions/requisitions/{r['id']}")
            if dr.status_code == 200:
                deleted += 1
    print(f"Deleted {deleted} previously seeded requisitions.")


if __name__ == "__main__":
    main()
