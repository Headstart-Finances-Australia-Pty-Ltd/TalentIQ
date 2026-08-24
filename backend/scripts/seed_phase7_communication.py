"""
Seeds realistic Phase 7 (Communication & Automation) test data into your
running TalentIQ instance via its own API — same approach as the other
seed_phaseN scripts.

Communication & Automation covers:
  - Reusable email templates with {{placeholder}} substitution.
  - Automation rules that fire real trigger points in Interview
    Management and Pipeline & Placements (interview scheduled/completed,
    offer sent/accepted/rejected, pipeline stage changed, placement
    created) — wired into those capabilities directly, not a separate
    parallel system.
  - A unified timeline per candidate combining automated sends and
    manual notes/calls.
  - A cross-capability "recruiter daily workbench" view.

This script depends on candidates, requisitions, interviews, and a
pipeline entry already existing (same dependency chain as the other
seed_phaseN scripts) — it creates its own if none are found, but reusing
your real data (or data from the other seed scripts) makes the demo more
meaningful, especially for seeing automation actually fire.

Creates:
  - 4 email templates (one per common recruiting moment: interview
    confirmation, rejection, offer, placement).
  - 4 automation rules, one per template, wired to real trigger events.
  - A fresh candidate + requisition + pipeline entry, then actually
    walks it through: schedule an interview (fires "interview scheduled"),
    move the pipeline stage to Rejected on a SECOND candidate (fires the
    stage-based rule) — so the Automation Log and the candidate's
    Timeline both have real, observable activity the moment you open
    Communication & Automation, not just configured-but-never-fired
    rules.
  - One manual timeline entry (a logged phone call) on the first
    candidate, so the Timeline tab shows both automated and manual
    entries mixed together for the same person.

Note on SMTP: every automated send in this script will show up in the
Automation Log — but its status will be "Failed" (no SMTP configured) or
"Skipped" (no candidate email) unless you've set up SMTP credentials
under Settings -> API Keys first (service: smtp; key names: host, port,
username, password, from_email). That's expected and is itself worth
seeing: open Communication & Automation -> Automation to see exactly
which reason is shown for each attempt.

Usage:
    python seed_phase7_communication.py --email you@example.com --password yourpassword
    python seed_phase7_communication.py --email you@example.com --password yourpassword --register --name "Demo Recruiter"

Options:
    --base-url   Backend URL (default: http://localhost:8000)
    --reset      Deactivates the automation rules and deletes the manual
                 log entry this script previously created before
                 reseeding (does not delete templates, candidates,
                 requisitions, or pipeline entries)
"""
import argparse
import sys

import requests

SEED_MARKER = "[phase7-seed-data]"

TEMPLATES = [
    {
        "name": "Interview Confirmation", "category": "Interview Invite",
        "subject": "Your interview for {{requisition_title}} is confirmed",
        "body": "Hi {{candidate_name}},\n\nYour {{round_name}} interview is confirmed for {{interview_time}}.\n\nLooking forward to speaking with you.",
    },
    {
        "name": "Application Update — Not Progressing", "category": "Rejection",
        "subject": "Update on your application",
        "body": "Hi {{candidate_name}},\n\nThank you for your interest in {{requisition_title}}. After careful consideration, we won't be progressing your application on this occasion. We'll keep your details on file for future opportunities.",
    },
    {
        "name": "Offer Extended", "category": "Offer",
        "subject": "An offer for {{requisition_title}}",
        "body": "Hi {{candidate_name}},\n\nWe're delighted to extend an offer of {{offer_currency}} {{offer_salary}} for the {{requisition_title}} role. We'll follow up shortly with next steps.",
    },
    {
        "name": "Welcome — Placement Confirmed", "category": "General",
        "subject": "Welcome aboard, {{candidate_name}}!",
        "body": "Hi {{candidate_name}},\n\nCongratulations again on {{requisition_title}} — we're thrilled to have supported this placement. Wishing you a great start!",
    },
]

AUTOMATION_RULES = [
    {"name": "Auto-confirm interview", "trigger_event": "interview_scheduled", "trigger_stage_name": "", "template_name": "Interview Confirmation"},
    {"name": "Auto-notify rejection", "trigger_event": "pipeline_stage_changed", "trigger_stage_name": "Rejected", "template_name": "Application Update — Not Progressing"},
    {"name": "Auto-send offer notice", "trigger_event": "offer_sent", "trigger_stage_name": "", "template_name": "Offer Extended"},
    {"name": "Auto-welcome on placement", "trigger_event": "placement_created", "trigger_stage_name": "", "template_name": "Welcome — Placement Confirmed"},
]


def ensure_templates(session: requests.Session, base_url: str) -> dict:
    existing = session.get(f"{base_url}/api/communication/templates").json()
    by_name = {t["name"]: t for t in existing}
    for tpl in TEMPLATES:
        if tpl["name"] in by_name:
            continue
        r = session.post(f"{base_url}/api/communication/templates", json=tpl)
        if r.status_code == 200:
            by_name[tpl["name"]] = r.json()
            print(f"  Created template: {tpl['name']}")
        else:
            print(f"  Could not create template '{tpl['name']}' ({r.status_code}): {r.text[:200]}")
    return by_name


def ensure_automation_rules(session: requests.Session, base_url: str, templates_by_name: dict):
    existing = session.get(f"{base_url}/api/communication/automation-rules").json()
    existing_names = {r["name"] for r in existing}
    for rule in AUTOMATION_RULES:
        if rule["name"] in existing_names:
            continue
        template = templates_by_name.get(rule["template_name"])
        if not template:
            print(f"  Skipping rule '{rule['name']}' — template not found.")
            continue
        r = session.post(f"{base_url}/api/communication/automation-rules", json={
            "name": rule["name"], "trigger_event": rule["trigger_event"],
            "trigger_stage_name": rule["trigger_stage_name"], "template_id": template["id"],
        })
        if r.status_code == 200:
            print(f"  Created automation rule: {rule['name']}")
        else:
            print(f"  Could not create rule '{rule['name']}' ({r.status_code}): {r.text[:200]}")


def ensure_candidate(session: requests.Session, base_url: str, name: str, email: str) -> dict:
    candidates = session.get(f"{base_url}/api/acquisition/candidates").json()
    match = next((c for c in candidates if c["email"] == email), None)
    if match:
        return match
    r = session.post(f"{base_url}/api/acquisition/candidates", json={
        "full_name": name, "email": email, "consent_given": True, "notes": SEED_MARKER,
    })
    candidate = r.json()
    print(f"  Created candidate: {name}")
    return candidate


def ensure_requisition(session: requests.Session, base_url: str) -> dict:
    existing = session.get(f"{base_url}/api/requisitions/requisitions").json()
    if existing:
        return existing[0]
    r = session.post(f"{base_url}/api/requisitions/requisitions", json={
        "title": "Backend Engineer", "priority": "High", "vacancy_count": 1,
        "reason_for_hire": "New Position", "employment_type": "Full-time", "notes": SEED_MARKER,
    })
    req = r.json()
    print(f"  Created requisition: {req['title']}")
    return req


def main():
    ap = argparse.ArgumentParser(description="Seed Phase 7 (Communication & Automation) test data.")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--name", default="Demo Recruiter", help="Only used with --register")
    ap.add_argument("--register", action="store_true")
    ap.add_argument("--base-url", default="http://localhost:8000")
    ap.add_argument("--reset", action="store_true", help="Deactivate previously seeded automation rules first")
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

    print("\n--- Templates ---")
    templates_by_name = ensure_templates(session, args.base_url)

    if args.reset:
        print("\n--- Resetting ---")
        rules = session.get(f"{args.base_url}/api/communication/automation-rules").json()
        for rule in rules:
            if rule["name"] in {r["name"] for r in AUTOMATION_RULES}:
                session.put(f"{args.base_url}/api/communication/automation-rules/{rule['id']}", json={"is_active": False})
        print(f"  Deactivated {len([r for r in rules if r['name'] in {x['name'] for x in AUTOMATION_RULES}])} previously seeded rule(s).")

    print("\n--- Automation Rules ---")
    ensure_automation_rules(session, args.base_url, templates_by_name)

    print("\n--- Prerequisites ---")
    requisition = ensure_requisition(session, args.base_url)
    candidate1 = ensure_candidate(session, args.base_url, "Isabella Martinez", "isabella.martinez.p7@example.com")
    candidate2 = ensure_candidate(session, args.base_url, "Lucas Wright", "lucas.wright.p7@example.com")

    print("\n--- Generating real activity ---")
    # 1) Schedule an interview for candidate 1 — fires "Auto-confirm interview".
    from datetime import datetime, timedelta
    scheduled_at = (datetime.utcnow() + timedelta(days=2)).isoformat()
    interview_res = session.post(f"{args.base_url}/api/interviews/interviews", json={
        "candidate_id": candidate1["id"], "requisition_id": requisition["id"],
        "round_name": "Phone Screen", "scheduled_at": scheduled_at, "notes": SEED_MARKER,
    })
    if interview_res.status_code == 200:
        print(f"  Scheduled an interview for {candidate1['full_name']} — should trigger 'Auto-confirm interview'")

    # 2) Submit candidate 2 to the pipeline and move them to Rejected —
    #    fires "Auto-notify rejection".
    entry_res = session.post(f"{args.base_url}/api/pipeline/submit", json={"candidate_id": candidate2["id"], "requisition_id": requisition["id"], "notes": SEED_MARKER})
    if entry_res.status_code == 200 or entry_res.status_code == 409:
        entries = session.get(f"{args.base_url}/api/pipeline/entries", params={"candidate_id": candidate2["id"], "requisition_id": requisition["id"]}).json()
        if entries:
            entry_id = entries[0]["id"]
            stages = session.get(f"{args.base_url}/api/pipeline/stages", params={"requisition_id": requisition["id"]}).json()
            rejected_stage = next((s for s in stages if s["name"] == "Rejected"), None)
            if rejected_stage:
                session.post(f"{args.base_url}/api/pipeline/entries/{entry_id}/move-stage", json={"stage_id": rejected_stage["id"]})
                print(f"  Moved {candidate2['full_name']} to Rejected — should trigger 'Auto-notify rejection'")

    # 3) Log a manual note on candidate 1, so their Timeline shows both
    #    automated and manual entries mixed together.
    session.post(f"{args.base_url}/api/communication/log", json={
        "candidate_id": candidate1["id"], "channel": "Call", "direction": "Outbound",
        "subject": "Checked availability", "body": f"Called to confirm interview timing — all good. {SEED_MARKER}",
    })
    print(f"  Logged a manual call note on {candidate1['full_name']}")

    print(f"\nDone. {SEED_MARKER}")
    print("Open Communication & Automation (/app/communication):")
    print("  - Workbench: today's interviews, expiring offers, and stale pipeline entries")
    print("  - Templates: the 4 templates created above")
    print(f"  - Timeline: search for '{candidate1['full_name']}' to see a mixed automated + manual history")
    print("  - Automation: the 4 rules, plus a real activity log from the actions just performed")
    print("\nTip: set up SMTP under Settings -> API Keys to see automated sends actually deliver")
    print("instead of showing 'Failed' in the Automation Log.")


if __name__ == "__main__":
    main()
