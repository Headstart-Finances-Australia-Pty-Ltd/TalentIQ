# TalentIQ — End-to-End Demo Guide (Requisition → Placement)

One script, `seed_e2e_demo.py`, seeds a single coherent dataset — 4 requisitions
across 4 clients, and **12 candidates** (comfortably over "at least 10") — each
carried as far through the real Requisition → Sourcing/Screening → Interviews →
Pipeline → Offer → Placement journey as their assigned outcome calls for. This
guide is the walkthrough to follow after running it.

It complements, but doesn't replace, `SAMPLE_DATA_GUIDE.md`'s phase-by-phase
scripts — this one is for testing the **core candidate journey** end to end in
one sitting. Run the Phase 6–9 scripts afterwards (portals, automation,
commercials, governance) if you want the full platform picture.

---

## 1. The data flow

```
1. Requisition        Opened at a client
2. Candidate           Added to Talent Pool
3. Screening            Resume → Phone → Video (CandidateLens split)
4. Pipeline              Client Review → Interviewing
5. Interview Scheduling   Phone / Video / Panel — approval + majority vote
6. Offer                   Sent → Approved → Accepted
7. Placement                 Active → Guarantee Period
```

A candidate can exit as **Rejected** at Screening, at a formal Interview round,
or at Client Review — the dataset deliberately includes all three exit points,
not just the happy path to Placement.

**Two screening layers, on purpose.** CandidateLens's own Phone/Video Interview
modules (AI-generated questions, ATS scoring, contacted/recommendation
tracking) are a *lighter, faster* screening layer a recruiter runs against
their whole candidate pool. Interview Scheduling's Phone/Video/Panel rounds
are the *formal, auditable* record — time, place, named interviewers,
approval, and a majority-vote decision. Real recruiting workflows use both:
CandidateLens narrows the pool fast; Interview Scheduling is what actually
gets scheduled, approved, and recorded against the candidate's official
history. The seed script exercises both, deliberately, so you can see the
difference yourself.

---

## 2. Prerequisites

- Backend running and reachable (default assumed: `http://localhost:8000`)
- Frontend running (default assumed: `http://localhost:5173`)
- Python with `requests` installed: `pip install requests`

---

## 3. Run it

```bash
cd backend/scripts
python seed_e2e_demo.py --email you@example.com --password yourpassword
```

Add `--register --name "Your Name"` on the very first run if that account
doesn't exist yet. Re-running without `--reset` is safe — candidates,
requisitions, and interviews are matched by email/marker and reused rather
than duplicated.

The script prints its progress requisition by requisition, and finishes with
a block of **live links** — a self-scheduling link, a public panel-feedback
link, and a public scheduling-approval link — copy these into a browser to
test the actual candidate/interviewer/approver-facing pages yourself, no
login required. Keep that output around; you'll need those links in step 5.

To start over: add `--reset` (deletes this script's own interviews,
requisitions, and pipeline entries — candidates and Resume Screening sessions
are left in place and simply reused on the next run).

---

## 4. The 12 candidates

| Candidate | Requisition | Outcome | What it demonstrates |
|---|---|---|---|
| Sophia Nguyen | Senior Backend Engineer | **Placed** | Panel majority-Selected (2 of 3 votes) + external scheduling-approval link |
| Daniel Kim | Senior Backend Engineer | Rejected at Phone Interview | Manual decision (single interviewer — no majority to compute) |
| Chloe Anderson | Senior Backend Engineer | Interviewing | Panel scheduled, decision Pending; public panel-feedback link |
| Ryan Mitchell | Data Analyst | **Placed** | Panel approved in-app by the designated approver |
| Zoe Campbell | Data Analyst | Offer Sent | Stops before accept/reject — tests the pending-offer state |
| Liam Foster | Data Analyst | Rejected at Resume Screening | Never shortlisted — no pipeline entry at all |
| Emma Torres | Financial Controller | **Placed** | Straightforward full journey |
| Jack Sullivan | Financial Controller | Rejected at Client Review | Panel interview scheduled then **Cancelled** |
| Grace Patel | Financial Controller | Interviewing | Phone round left **Requested** with a live self-scheduling link |
| Henry Osei | Registered Nurse | **Placed** | Straightforward full journey |
| Amelia Rossi | Registered Nurse | Rejected at Video Interview | 2-interviewer panel, majority-**Rejected** |
| Oliver Dubois | Registered Nurse | Offer Sent | Second pending-offer example |

4 Placed, 2 Offer Sent, 2 Interviewing, 4 Rejected (one at each of three
different stages, plus a cancelled-interview variant) — every status filter
across the platform has real data behind it.

---

## 5. Walk through it

Go through these in order — each builds on data the last one created.

### 5.1 Requisitions (`/app/requisitions`)
Open the 4 requisitions (Senior Backend Engineer, Data Analyst, Financial
Controller, Registered Nurse), all **Open**, each linked to a client. Check
the checklist and hiring-manager fields are populated.

### 5.2 Talent Pool (`/app/acquisition`)
All 12 candidates, searchable by name or skill. Open one — Sophia Nguyen, say
— and check her profile shows current title, employer, experience, and
skills.

### 5.3 Resume Screening (`/app/resumescreening`)
Four sessions, one per requisition, each with real ATS scores computed
against a real JD (not placeholder numbers) — this ran the actual
scoring engine, no shortcut. Open the Data Analyst session and confirm **Liam
Foster** is *not* shortlisted (that's his rejection story) while the other
two are.

### 5.4 Phone Interview — CandidateLens (`/app/phoneinterview`)
The shortlisted candidates from each session, now with a Phone Screening
result recorded: contacted, a Proceed/Hold/Reject recommendation, and notes.
Check **Daniel Kim** shows a **Reject** recommendation with notes about
insufficient depth — this is the CandidateLens-side echo of his formal
rejection (see 5.6).

### 5.5 Video Interview — CandidateLens (`/app/videointerview`)
This is the one deliberately hands-on step — a webcam recording can't be
scripted headlessly. Pick any shortlisted candidate here and click **Start**
yourself: TalentIQ will ask for camera/microphone access, ask a few AI-
generated questions, and run live emotion analysis on your own responses.
This is the best single feature to demo live, in person.

### 5.6 Interview Scheduling (`/app/interviews`)
The formal record — open a few interviews and look for:
- **Sophia Nguyen's Panel Interview**: 3 scorecards (2 Strong Yes, 1
  Neutral), decision auto-resolved to **Selected** — majority, not
  unanimous. Click the gavel icon to see the Decision & Approval panel, and
  the approval status/history for her external approver.
- **Amelia Rossi's Video Interview**: 2 interviewers, both voted **No** →
  auto-resolved to **Rejected**. Same majority engine, opposite outcome.
- **Daniel Kim's Phone Interview**: 1 interviewer, decision set **Rejected**
  manually — the gavel panel explains why a majority vote doesn't apply here.
- **Jack Sullivan's Panel Interview**: status **Cancelled**, with a reason.
- **Grace Patel's Phone Interview**: status **Requested**, no fixed time —
  open the self-scheduling link the script printed to see the actual
  candidate-facing confirmation page.
- **Chloe Anderson's Panel Interview**: open the panel-feedback link the
  script printed — it's one interviewer's personal, tokenized online
  feedback form. Submit it, then refresh her interview in-app and watch the
  decision recompute in real time as votes come in.

### 5.7 Pipeline & Placements (`/app/pipeline`)
Pick each requisition from the dropdown to see its Kanban board — Client
Review, Interviewing, Offer, Placed, and Rejected columns should all have
real cards. Check the **Offers** tab for Zoe Campbell and Oliver Dubois still
sitting in **Sent**. Check the **Placements** tab for the 4 Placed
candidates, each with a computed guarantee-period end date.

### 5.8 Management Dashboard (`/app/dashboard`)
Open **Business Overview** and click through the tiles — Open Roles, Offers,
**Clients**, and **Roles Tracked** all drill into a real table. Confirm the
Offer Acceptance Status breakdown shows both Accepted and Sent counts.

---

## 6. Reset and re-run

```bash
python seed_e2e_demo.py --email you@example.com --password yourpassword --reset
```

This is safe to run repeatedly while you're testing — it only removes data
this script itself created.

---

## 7. What this script deliberately does NOT do

To keep this one script focused on the core candidate journey, it doesn't
touch:

- **Vendor/Client portals** (external submission and feedback links) — run
  `seed_phase6_portals.py`
- **Communication automation** (templates, rules, the activity log) — run
  `seed_phase7_communication.py`
- **Commercials** (invoices, timesheets, revenue) — run
  `seed_phase8_commercials.py`
- **Team & Access / multi-recruiter reporting** — run
  `seed_phase9_governance.py`

All four still work exactly as documented in `SAMPLE_DATA_GUIDE.md`, and are
safe to run after this script — none of them touch or duplicate what it
creates.
