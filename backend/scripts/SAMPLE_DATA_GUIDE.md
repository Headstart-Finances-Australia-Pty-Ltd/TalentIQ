# TalentIQ — Sample Data & Testing Guide (Phase 0 – Phase 9)

Seven independent seed scripts, one per built-out phase, all live in `backend/scripts/`:

| Script | Seeds |
|---|---|
| `seed_phase3_screening.py` | CandidateLens sessions (3 JDs x sample CVs) + MarketIntel runs (4) |
| `seed_phase4_interviews.py` | Sample candidates (if needed) + requisitions (if needed) + Interviews across every status + Scorecards + a live self-scheduling link |
| `seed_phase5_pipeline.py` | Sample candidates/requisitions (if needed) + a full Kanban pipeline: one candidate placed (with an auto-created guarantee-period placement), one mid-pipeline, one rejected |
| `seed_phase6_portals.py` | A client with a live portal link + a candidate already in their pipeline to review; a vendor with a live portal link, assigned to a requisition, with one submission already sitting in the review queue |
| `seed_phase7_communication.py` | 4 email templates + 4 automation rules wired to real triggers, then actually performs the actions that fire them (schedules an interview, rejects a candidate) so the Automation Log and a candidate's Timeline both have real, observable activity immediately |
| `seed_phase8_commercials.py` | Creates its own placements if needed, then a Paid invoice, a Sent (unpaid) invoice, and two weeks of contractor timesheet entries (one Approved, one still Submitted) — so Invoices, Guarantee Alerts, Timesheets, and Revenue all have real data immediately |
| `seed_phase9_governance.py` | Creates a second account and invites it into your organisation as a Recruiter, then gives that Recruiter something to own — so Reporting and Team & Access both have real, multi-person data to show, not just your own single-owner view |

Phases 0–2 (Talent Pool, Requisitions) don't have a seed script of their own — `sample-candidates.csv` (referenced in step 1 below) covers candidate data, and the seed scripts above create their own requisitions if none exist yet.

Both scripts talk to your **already-running** backend over its own API — they don't touch the database directly, so they work the same way whether you're running locally or against a deployed instance.

---

## Prerequisites

- Backend running and reachable (default assumed: `http://localhost:8000`)
- Frontend running (default assumed: `http://localhost:5173` — only needed to actually click through the seeded data / open the self-scheduling link)
- Python with `requests` installed: `pip install requests`

---

## Recommended upload sequence

The phases build on each other loosely — Phase 4 needs *some* candidates to exist (it'll create its own sample ones if none are found, but reusing your real data makes the demo more meaningful). Recommended order:

### 1. Candidates first (Acquisition / Talent Pool)
Import your real candidate data so Phase 3 and Phase 4 have something realistic to work against:
- Go to **Talent Acquisition & Pool** (`/app/acquisition`)
- Use **Import Candidate CSV** with `sample-candidates.csv` (from earlier in this project), *or*
- Use **Bulk Import Resumes/Cover Letters** to upload real resume/cover-letter files

If you skip this step entirely, `seed_phase4_interviews.py` will create 3 sample candidates of its own automatically — you don't have to do this first, but it's better if you do.

### 2. Requisitions (optional but recommended)
- Go to **Job Requisitions** (`/app/requisitions`) and create a couple of real ones, *or* let `seed_phase4_interviews.py` create 2 sample ones automatically if none exist.

### 3. Run the Phase 3 seed script
```bash
cd backend/scripts
python seed_phase3_screening.py --email you@example.com --password yourpassword
```
Add `--register --name "Your Name"` on the first run if that account doesn't exist yet.

This creates CandidateLens sessions and MarketIntel runs — independent of your real candidate data (it uploads its own sample CVs against sample JDs), so it's safe to run regardless of what you did in steps 1–2.

Check it worked: open **CandidateLens** (`/app/joblens`) and **MarketIntel** (`/app/jobintel`).

### 4. Run the Phase 4 seed script
```bash
python seed_phase4_interviews.py --email you@example.com --password yourpassword
```
(Use the same account as step 3 — no need to `--register` again.)

This is the one that benefits from step 1: if you already have 3+ candidates in your organisation, it schedules interviews against **your real candidates** instead of creating placeholder ones. Either way, it produces:
- A candidate taken through 3 completed rounds with scorecards (the "hired" story)
- A candidate mid-process: one round completed, one scheduled in the future
- A candidate with a cancelled interview and a no-show (the "didn't work out" stories)
- One interview left with a **live self-scheduling link** — the script prints a URL at the end; open it in a browser to test the actual candidate-facing confirmation flow yourself

Check it worked: open **Interview Management** (`/app/interviews`).

### 5. (Optional) Set up Calendly instead of TalentIQ's own scheduling link
If you want to test the Calendly integration instead of (or alongside) the built-in token-based scheduling links:
1. Go to **Settings → API Keys → Calendly**
2. Get a Personal Access Token from Calendly: **Calendly → Integrations → API & Webhooks**
3. Paste it in, click **Fetch My Event Types**, and pick the event type you want interviews to book against
4. Save

After that, every interview's scheduling-link modal in Interview Management will offer a **"Generate Calendly Link"** option in addition to TalentIQ's own.

### 6. Run the Phase 5 seed script
```bash
python seed_phase5_pipeline.py --email you@example.com --password yourpassword
```
(Same account as before — no need to `--register` again.)

Like Phase 4, this benefits from step 1: if you already have candidates and requisitions, it builds the pipeline against those instead of creating placeholder ones. Either way, it produces, across your first two requisitions:
- **One candidate taken all the way to Placed** — moved through every stage, given an offer, the offer approved and accepted, which **automatically creates a Placement** with the guarantee-period end date already computed
- **One candidate sitting mid-pipeline** in Interviewing — nothing decided yet
- **One candidate Rejected** out of Client Review, with a reason recorded
- The created placement is then nudged into **Guarantee Period** status, so the Placements tab's status filters all have something behind them

Check it worked: open **Pipeline & Placements** (`/app/pipeline`) — pick a requisition from the dropdown to see its Kanban board, or check the **Offers** / **Placements** tabs directly.

### 7. Run the Phase 6 seed script
```bash
python seed_phase6_portals.py --email you@example.com --password yourpassword
```
(Same account as before — no need to `--register` again.)

This creates a client and a vendor, each with a live, working portal link printed directly in the script's output — open either one in a browser (no login required, that's the point) to see the actual candidate-facing experience:

- **The client portal link** shows a candidate already sitting in that client's requisition pipeline, with a "Give Feedback" button you can actually click through — approve, reject, or request an interview, with comments. Try it, then check **Client & Vendor Collaboration → Client Feedback** in the app to see it land in the recruiter's inbox.
- **The vendor portal link** shows the requisition the vendor's been assigned to, plus one candidate they've already "submitted" (Ethan Walker), sitting in Pending Review. Check **Client & Vendor Collaboration → Vendor Submissions** to accept or reject it — accepting turns it into a real candidate on the Pipeline board, exactly like a recruiter adding one manually would.

Worth noting what's deliberately NOT shown to the client: open the client portal link and confirm the candidate's email/phone are absent — that's the "scoped document access" feature working as intended, not a bug.

### 8. Run the Phase 7 seed script
```bash
python seed_phase7_communication.py --email you@example.com --password yourpassword
```
(Same account as before — no need to `--register` again.)

This one doesn't just configure automation rules and leave them idle — it actually **performs the actions that fire them**: schedules a real interview (fires "Auto-confirm interview") and moves a candidate to Rejected (fires "Auto-notify rejection"), so the moment you open the app there's real activity to look at, not just an empty setup.

Check it worked: open **Communication & Automation** (`/app/communication`):
- **Workbench** — a live cross-capability view (today's interviews, expiring offers, pending vendor submissions, unacknowledged client feedback, stale pipeline entries)
- **Templates** — the 4 templates created above
- **Timeline** — search for the candidate the script names in its output to see a mixed automated + manual history for one person
- **Automation** — the 4 rules, plus a real activity log entry for each action just performed

One honest thing to expect: unless you've configured SMTP first (**Settings → API Keys**, service `smtp`, key names `host`/`port`/`username`/`password`/`from_email`), every automated send will show **Failed** in the Automation Log with a clear reason — that's correct, not broken. The point of the automation firing is proven either way; actual email delivery just needs real SMTP credentials, which this script can't supply on your behalf. Scheduling the interview and moving the pipeline stage both succeed regardless — automation failing to send never blocks the action that triggered it.

### 9. Run the Phase 8 seed script
```bash
python seed_phase8_commercials.py --email you@example.com --password yourpassword
```
(Same account as before — no need to `--register` again.)

If no placements exist yet, this script creates the full chain itself (candidate → requisition → pipeline entry → offer → accepted → placement) rather than requiring you to have run Phase 5's script first — though reusing real placements from earlier scripts makes the numbers more meaningful.

Check it worked: open **Commercials** (`/app/commercials`):
- **Invoices** — one Paid, one Sent (unpaid), so the status filter tabs both have something behind them
- **Guarantee Alerts** — switch the window to 200 days to see the seeded placements (their guarantee periods run ~90 days from a future start date, so the default 14-day window will likely show nothing yet — that's correct, not a bug)
- **Timesheets** — one Approved entry (try selecting it and clicking "Invoice Selected" yourself) and one still Submitted (try approving it)
- **Revenue** — totals, outstanding balance, and breakdowns by requisition and by month, reflecting the invoices above

### 10. Run the Phase 9 seed script
```bash
python seed_phase9_governance.py --email you@example.com --password yourpassword
```
(Same account as before — no need to `--register` again. This one creates a SECOND account automatically, since testing team/role access control meaningfully needs two different people, not just yourself.)

Check it worked: open **Governance** (`/app/reporting`):
- **Reporting** — time-to-fill, funnel conversion, source-of-hire, and recruiter/vendor performance, all computed live from whatever's in your organisation (run `seed_phase5_pipeline.py` and `seed_phase6_portals.py` first if these look sparse — Governance doesn't create its own placements/vendor data, it reports on what already exists)
- **Team & Access** — you as Owner, plus the seeded Recruiter account. Try changing their role to Manager, or removing them.
- **The real test**: log in as the seeded Recruiter yourself (credentials are printed by the script — default `demo.recruiter.p9@example.com` / `DemoRecruiter123`) and open Governance → Reporting → Recruiter Performance. You should see only their own row, not your whole organisation's — that's the actual access-control feature working, not just a role label with nothing behind it. If you have more than one organisation you're a member of, use the org switcher at the top of the page.

---

## Resetting

All seven scripts support `--reset`:

```bash
python seed_phase3_screening.py --email you@example.com --password yourpassword --reset
python seed_phase4_interviews.py --email you@example.com --password yourpassword --reset
python seed_phase5_pipeline.py --email you@example.com --password yourpassword --reset
python seed_phase6_portals.py --email you@example.com --password yourpassword --reset
python seed_phase7_communication.py --email you@example.com --password yourpassword --reset
python seed_phase8_commercials.py --email you@example.com --password yourpassword --reset
python seed_phase9_governance.py --email you@example.com --password yourpassword --reset
```

`--reset` only removes data tagged with that script's own marker, or (Phase 4/5) all interviews/pipeline entries on the account, or (Phase 6) revokes and regenerates the client/vendor portal links, or (Phase 7) deactivates the automation rules it created, or (Phase 8) cancels the invoices it created, or (Phase 9) removes the seeded Recruiter from your team (their account itself isn't deleted). None of these touch your real data from a different capability.

---

## Full command reference

```bash
# Phase 3
python seed_phase3_screening.py --email you@example.com --password yourpassword [--register --name "Your Name"] [--base-url http://localhost:8000] [--reset]

# Phase 4
python seed_phase4_interviews.py --email you@example.com --password yourpassword [--register --name "Your Name"] [--base-url http://localhost:8000] [--reset]

# Phase 5
python seed_phase5_pipeline.py --email you@example.com --password yourpassword [--register --name "Your Name"] [--base-url http://localhost:8000] [--reset]

# Phase 6
python seed_phase6_portals.py --email you@example.com --password yourpassword [--register --name "Your Name"] [--base-url http://localhost:8000] [--reset]

# Phase 7
python seed_phase7_communication.py --email you@example.com --password yourpassword [--register --name "Your Name"] [--base-url http://localhost:8000] [--reset]

# Phase 8
python seed_phase8_commercials.py --email you@example.com --password yourpassword [--register --name "Your Name"] [--base-url http://localhost:8000] [--reset]

# Phase 9
python seed_phase9_governance.py --email you@example.com --password yourpassword [--register --name "Your Name"] [--base-url http://localhost:8000] [--recruiter-email ...] [--recruiter-password ...] [--reset]
```

All seven scripts were run **back-to-back on the same fresh database** as part of verifying this pack — confirmed they don't conflict with each other's data, and that Phase 9's reporting metrics correctly picked up real placements from Phase 5, a real vendor submission from Phase 6, and correctly scoped a Recruiter's view to only their own data versus the Owner's full-organisation view.
