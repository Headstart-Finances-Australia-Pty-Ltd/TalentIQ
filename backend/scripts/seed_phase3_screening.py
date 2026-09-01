"""
Seeds realistic Phase 3 (Screening & Matching) test data into your running
TalentIQ instance via its own API — same approach as seed_phase2_requisitions.py.

Screening & Matching covers two modules:

  - CandidateLens (/api/joblens)  — upload a JD + multiple CVs, get ATS
    scores, interview questions, and a shortlist.
  - MarketIntel (/api/jobintel)   — simulated job-market analytics runs
    (skill demand, salary trends, experience breakdown). This module has
    no external dependency (no Apify/Groq key needed) since it uses the
    built-in simulator.

Creates:
  - 3 CandidateLens sessions, each a different JD (Backend Engineer,
    Financial Analyst, Product Manager) scored against 4-5 sample CVs
    with varied skill overlap, so the low/mid/high score bands and the
    shortlist/reject views all have real data to click through. Runs
    without a Groq key by default (heuristic keyword scoring); if the
    account has a Groq key saved, CandidateLens automatically upgrades to
    LLM-powered scoring + AI-generated interview questions — no script
    changes needed either way.
  - 4 MarketIntel runs across different roles/locations, each producing
    ~120 simulated job records with skill/tool/salary/experience insights.

Usage:
    python seed_phase3_screening.py --email you@example.com --password yourpassword
    python seed_phase3_screening.py --email you@example.com --password yourpassword --register --name "Demo Recruiter"

Options:
    --base-url   Backend URL (default: http://localhost:8000)
    --reset      Delete all CandidateLens sessions and MarketIntel runs
                 this script previously created before reseeding
"""
import argparse
import sys

import requests

SEED_MARKER = "[phase3-seed-data]"

# ── CandidateLens: sample JDs + CVs ─────────────────────────────────────────
# Each JD is paired with CVs that deliberately span the score range: a
# couple of strong matches, a partial match, and a weak/irrelevant one —
# so the resulting session shows the full low/mid/high threshold spread
# instead of every candidate landing in the same band.

JOBS = [
    {
        "title": "Senior Backend Engineer",
        "jd_text": """Senior Backend Engineer — Bluewave Solutions (Melbourne VIC, Hybrid)

We're hiring a Senior Backend Engineer to help scale our core platform.

Essential skills: Python, FastAPI or Django, PostgreSQL, REST API design,
Docker, unit testing, Git, CI/CD.
Good to have: Kubernetes, AWS, async programming, Redis, message queues
(Kafka/RabbitMQ), GraphQL.
Minimum 5 years of professional software engineering experience.
Bachelor's degree in Computer Science or equivalent experience.
Salary range: AUD 130,000 - 160,000. Remote work considered for the right
candidate.""",
        "cvs": [
            ("olivia_chen.txt", """Olivia Chen
Senior Software Engineer

Experience:
- 7 years building backend services in Python (FastAPI, Django) at scale.
- Designed and maintained REST APIs serving 2M+ daily requests.
- PostgreSQL schema design, query optimisation, and read-replica setup.
- Containerised all services with Docker; migrated deployment to
  Kubernetes on AWS EKS.
- Built async job pipelines using Celery and Redis; introduced Kafka for
  event streaming between services.
- Strong CI/CD background: GitHub Actions, automated unit + integration
  test suites (pytest), trunk-based development with Git.

Education: B.Sc. Computer Science, University of Melbourne.
"""),
            ("marcus_webb.txt", """Marcus Webb
Backend Developer

Summary: 6 years of experience as a backend engineer, primarily Python.

- Built and maintained internal REST APIs using Django REST Framework.
- Wrote unit tests with pytest, used Git for version control daily.
- Worked with PostgreSQL for primary data storage; some MySQL exposure.
- Set up Docker containers for local development; basic CI pipeline with
  GitHub Actions.
- Limited exposure to Kubernetes (helped deploy to an existing cluster
  but didn't own it).
- No formal experience with Kafka/RabbitMQ or GraphQL.

Education: B.Sc. Information Technology.
"""),
            ("priya_anand.txt", """Priya Anand
Full-Stack Developer

- 3 years experience, mostly frontend (React) with some Node.js backend
  work for small internal tools.
- Basic familiarity with REST APIs and PostgreSQL from bootcamp projects.
- Used Git for version control. No production Docker or cloud experience.
- Currently learning Python and FastAPI in personal projects.

Education: Coding bootcamp graduate, Diploma in Web Development.
"""),
            ("james_okafor.txt", """James Okafor
Retail Store Manager

- 8 years managing retail operations, staff scheduling, and inventory.
- Proficient in Excel and point-of-sale systems.
- No software engineering or programming experience.

Education: Diploma in Business Administration.
"""),
        ],
    },
    {
        "title": "Financial Analyst",
        "jd_text": """Financial Analyst — Coastal Financial (Brisbane QLD)

Coastal Financial is looking for a Financial Analyst to join our
corporate finance team.

Essential skills: Financial modelling, Excel (advanced), variance
analysis, budgeting & forecasting, financial reporting, GAAP/IFRS
knowledge.
Good to have: SQL, Power BI or Tableau, experience with ERP systems
(SAP/Oracle), CFA or CPA progress.
Minimum 3 years of experience in financial analysis or corporate
finance.
Bachelor's degree in Finance, Accounting, or Economics required.
Salary range: AUD 85,000 - 105,000.""",
        "cvs": [
            ("grace_liu.txt", """Grace Liu
Financial Analyst

- 5 years in corporate finance, building monthly variance and budget
  forecast models in Excel (advanced formulas, pivot tables, macros).
- Prepared quarterly financial reports under IFRS for board review.
- Built Power BI dashboards for revenue and cost tracking used by
  leadership.
- Working knowledge of SQL for pulling data from the finance data
  warehouse.
- Currently completing CPA.

Education: B.Com (Finance), University of Queensland.
"""),
            ("sam_oneill.txt", """Sam O'Neill
Accountant

- 4 years as a staff accountant, primarily accounts payable/receivable
  and month-end close under GAAP.
- Intermediate Excel skills (vlookup, pivot tables); limited financial
  modelling experience.
- No SQL or BI tool experience.
- Used SAP for journal entries and reconciliations.

Education: B.Com (Accounting).
"""),
            ("elena_kovac.txt", """Elena Kovac
Software Engineer

- 6 years as a backend engineer working on Python microservices.
- No finance, accounting, or financial modelling background.
- Strong Excel skills used only for personal budgeting.

Education: B.Sc. Computer Science.
"""),
        ],
    },
    {
        "title": "Product Manager",
        "jd_text": """Product Manager — Northwind Group (Sydney NSW, Hybrid)

We're looking for a Product Manager to own our core product roadmap.

Essential skills: Product roadmapping, stakeholder management, user
research, writing PRDs/specs, Agile/Scrum, data-informed decision making.
Good to have: SQL, A/B testing, Figma, background in fintech or SaaS,
experience managing engineering teams of 5+.
Minimum 4 years of product management experience.
Salary range: AUD 140,000 - 170,000.""",
        "cvs": [
            ("hannah_reyes.txt", """Hannah Reyes
Senior Product Manager

- 6 years in product management, most recently at a fintech SaaS
  company owning the payments roadmap for a team of 8 engineers.
- Ran continuous user research (interviews + surveys) to prioritise the
  backlog; wrote detailed PRDs and acceptance criteria.
- Ran Agile/Scrum ceremonies (sprint planning, retros) as product owner.
- Used SQL daily to pull funnel and retention metrics; ran A/B tests on
  onboarding flows using an in-house experimentation platform.
- Comfortable in Figma for reviewing and annotating designs.

Education: B.A. Business, MBA.
"""),
            ("daniel_kim.txt", """Daniel Kim
Associate Product Manager

- 2 years as an APM at a mid-size SaaS company.
- Wrote user stories and helped run sprint planning under a senior PM's
  guidance. Limited experience owning a roadmap independently.
- Basic SQL (simple SELECT queries) for pulling usage reports.
- No formal A/B testing or fintech experience.

Education: B.Sc. Information Systems.
"""),
            ("olivia_chen_pm.txt", """Olivia Chen
Senior Software Engineer

- 7 years building backend services in Python. Not a product role —
  no roadmap ownership, PRD writing, or stakeholder management
  experience. Occasionally consulted by PMs on technical feasibility.

Education: B.Sc. Computer Science.
"""),
        ],
    },
]

# ── MarketIntel: sample simulation runs ─────────────────────────────────────
MARKET_RUNS = [
    {"role": "Software Engineer", "location": "Sydney NSW", "industry": "Technology", "max_results": 150},
    {"role": "Financial Analyst", "location": "Melbourne VIC", "industry": "Banking", "max_results": 120},
    {"role": "Product Manager", "location": "Australia", "industry": "SaaS", "max_results": 100},
    {"role": "Data Engineer", "location": "Brisbane QLD", "industry": "Technology", "max_results": 100},
]


def _reset(session: requests.Session, base_url: str):
    """Delete CandidateLens sessions and MarketIntel runs previously
    created by this script. CandidateLens sessions don't carry a notes
    field to tag with SEED_MARKER, so --reset removes ALL of the current
    user's sessions/runs — same trade-off as starting from a fresh
    account, just spelled out here instead of silently assumed."""
    print("Resetting: deleting all existing CandidateLens sessions and MarketIntel runs for this account...")
    sessions = session.get(f"{base_url}/api/joblens/sessions").json()
    for s in sessions:
        session.delete(f"{base_url}/api/joblens/sessions/{s['id']}")
    runs = session.get(f"{base_url}/api/jobintel/runs").json()
    for r in runs:
        session.delete(f"{base_url}/api/jobintel/runs/{r['id']}")
    print(f"  Deleted {len(sessions)} CandidateLens session(s), {len(runs)} MarketIntel run(s).")


def seed_candidatelens(session: requests.Session, base_url: str):
    print("\n--- CandidateLens (Screening & Matching) ---")
    for job in JOBS:
        files = [("cv_files", (fname, content.encode("utf-8"), "text/plain")) for fname, content in job["cvs"]]
        data = {
            "jd_text": job["jd_text"],
            "low_threshold": 40,
            "high_threshold": 70,
        }
        r = session.post(f"{base_url}/api/joblens/run", data=data, files=files)
        if r.status_code != 200:
            print(f"  Could not create session for '{job['title']}' ({r.status_code}): {r.text[:300]}")
            continue
        result = r.json()
        session_id = result.get("id") or result.get("session_id")
        n_candidates = len(result.get("candidates", []))
        print(f"  Created session: {job['title']}  (session_id={session_id}, {n_candidates} candidates scored)")


def seed_marketintel(session: requests.Session, base_url: str):
    print("\n--- MarketIntel (Screening & Matching) ---")
    for run in MARKET_RUNS:
        r = session.post(f"{base_url}/api/jobintel/run", json=run)
        if r.status_code != 200:
            print(f"  Could not start run for '{run['role']}' ({r.status_code}): {r.text[:300]}")
            continue
        result = r.json()
        print(f"  Started run: {run['role']} / {run['location']}  (run_id={result['id']}, status={result['status']})")
    print("  Note: runs complete in the background (a few seconds each) — refresh the MarketIntel page shortly.")


def main():
    ap = argparse.ArgumentParser(description="Seed Phase 3 (Screening & Matching) test data.")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--name", default="Demo Recruiter", help="Only used with --register")
    ap.add_argument("--register", action="store_true")
    ap.add_argument("--base-url", default="http://localhost:8000")
    ap.add_argument("--reset", action="store_true", help="Delete previously seeded sessions/runs first")
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

    seed_candidatelens(session, args.base_url)
    seed_marketintel(session, args.base_url)

    print(f"\nDone. {SEED_MARKER}")
    print("Open Resume Screening (/app/resumescreening) and MarketIntel (/app/jobintel) to see the seeded data.")
    print("Tip: save a Groq API key under Settings -> API Keys before running this script to get")
    print("LLM-powered scoring + AI-generated interview questions instead of heuristic keyword scoring.")


if __name__ == "__main__":
    main()
