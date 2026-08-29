"""
Creates ONE open job (JD) in your running TalentIQ instance and prints a
ready-to-share careers apply link — the same feature built into the app
(public careers page + role-specific deep link), just seeded for you so
there's something to click immediately.

Usage:
    python seed_demo_job.py --email you@example.com --password yourpassword
    python seed_demo_job.py --email you@example.com --password yourpassword --register --name "Demo Recruiter"

Options:
    --base-url   Backend URL (default: http://localhost:8000 — matches the
                 Vite dev-server proxy target in vite.config.ts)
    --frontend-url  Frontend URL used to build the printed link
                 (default: http://localhost:5173)
    --register   Create the account first if it doesn't exist yet
    --title      Job title to create (default: "Senior Data Engineer")
"""
import argparse
import sys
import requests

DEFAULT_JD_TITLE = "Senior Data Engineer"
DEFAULT_JD_DESCRIPTION = (
    "We're hiring a Senior Data Engineer to own our data pipeline architecture end to end. "
    "You'll design and maintain ETL pipelines, work closely with analytics and product teams, "
    "and help scale our data platform as the business grows.\n\n"
    "What you'll do:\n"
    "- Design, build, and maintain scalable ETL/ELT pipelines\n"
    "- Own data quality, monitoring, and pipeline reliability\n"
    "- Collaborate with analytics and product teams on data models\n"
    "- Mentor junior engineers and contribute to architecture decisions\n\n"
    "What we're looking for:\n"
    "- 5+ years of experience in data engineering\n"
    "- Strong Python and SQL skills\n"
    "- Experience with Airflow, Spark, and cloud data warehouses\n"
    "- Comfort working in a fast-moving, collaborative environment"
)


def main():
    ap = argparse.ArgumentParser(description="Seed one demo job and print its shareable apply link.")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--name", default="Demo Recruiter", help="Only used with --register")
    ap.add_argument("--register", action="store_true", help="Register the account first if it doesn't exist")
    ap.add_argument("--base-url", default="http://localhost:8000")
    ap.add_argument("--frontend-url", default="http://localhost:5173")
    ap.add_argument("--title", default=DEFAULT_JD_TITLE)
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
    token = r.json()["access_token"]
    session.headers.update({"Authorization": f"Bearer {token}"})
    print(f"Logged in as {args.email}")

    # 1) Create one open JD
    r = session.post(f"{args.base_url}/api/candidatetrack/jds", json={
        "jd_title": args.title, "status": "Open", "description": DEFAULT_JD_DESCRIPTION,
    })
    if r.status_code != 200:
        print(f"Could not create JD ({r.status_code}): {r.text}")
        sys.exit(1)
    jd = r.json()
    print(f"Created open role: \"{jd['jd_title']}\" (id={jd['id']})")

    # 2) Fetch/create this account's Organisation + careers page slug
    r = session.get(f"{args.base_url}/api/acquisition/organisation")
    if r.status_code != 200:
        print(f"Could not fetch organisation ({r.status_code}): {r.text}")
        sys.exit(1)
    org = r.json()

    # 3) Build both links — general careers page, and the role-specific deep
    #    link that auto-populates this exact job (see CareerApplyPage.tsx)
    general_url = f"{args.frontend_url}{org['apply_url_path']}"
    role_url = f"{general_url}?role={jd['id']}"

    print()
    print("=" * 70)
    print("Demo job is live. Share either link:")
    print()
    print(f"  Role-specific (auto-selects this job):\n    {role_url}")
    print()
    print(f"  General careers page (candidate picks from open roles):\n    {general_url}")
    print("=" * 70)


if __name__ == "__main__":
    main()
