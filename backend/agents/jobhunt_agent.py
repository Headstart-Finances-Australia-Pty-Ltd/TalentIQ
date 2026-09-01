"""
TalentIQ – JobHunt LangChain Agent
Combines job scraping (Apify Seek scraper), resume parsing, ATS matching, and
cover letter generation. All results persisted to PostgreSQL.
"""

import re
import json
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta

import requests
from langchain_core.tools import Tool
from langchain.agents import AgentExecutor, create_react_agent
from langchain_core.prompts import PromptTemplate

from utils.credentials import DEFAULT_GROQ_MODEL

# langchain_groq is optional – fall back gracefully if not installed
try:
    from langchain_groq import ChatGroq
    _GROQ_AVAILABLE = True
except ImportError:
    _GROQ_AVAILABLE = False
    ChatGroq = None  # type: ignore


# ─────────────────────────────────────────────
# JOB SCRAPER (Apify — Seek scraper actor)
# ─────────────────────────────────────────────

# Default Apify Actor used for Seek job search. This can be overridden per
# deployment by saving a value for service="apify", key_name="actor_id" in
# Settings (see routers/jobhunt.py) — useful if an admin prefers a different
# Seek actor from the Apify Store. "automation-lab/seek-scraper" scrapes
# seek.com.au / seek.co.nz by keyword, location, work type, and date range,
# and needs no login or official API key — just an Apify account token.
DEFAULT_APIFY_SEEK_ACTOR = "automation-lab/seek-scraper"

# Seek's own work-type filter vocabulary, mapped from the free-text job_type
# values used elsewhere in TalentIQ.
_SEEK_WORK_TYPE_MAP = {
    "full-time": "full time",
    "full_time": "full time",
    "full time": "full time",
    "part-time": "part time",
    "part_time": "part time",
    "part time": "part time",
    "contract": "contract/temp",
    "temporary": "contract/temp",
    "contract/temp": "contract/temp",
    "casual": "casual/vacation",
    "vacation": "casual/vacation",
    "casual/vacation": "casual/vacation",
}

RECRUITMENT_AGENCIES = [
    "michael page", "hays", "randstad", "adecco", "manpower", "robert half",
    "hudson", "kelly services", "peoplebank", "talent international", "aquent",
    "workpac", "drake", "programmed", "page personnel", "chandler macleod"
]

CONSULTING_FIRMS = [
    "accenture", "deloitte", "kpmg", "ey", "pwc", "capgemini", "cognizant",
    "infosys", "tcs", "ibm", "bain", "boston consulting group", "mckinsey"
]


def classify_company_type(company_name: str) -> str:
    if not company_name:
        return "Unknown"
    name = company_name.lower()
    if any(a in name for a in RECRUITMENT_AGENCIES):
        return "Recruitment Agency"
    if any(c in name for c in CONSULTING_FIRMS):
        return "Consulting Company"
    if any(w in name for w in ["recruitment", "staffing", "talent", "headhunter"]):
        return "Recruitment Agency"
    if any(w in name for w in ["consulting", "advisory", "solutions"]):
        return "Consulting Company"
    return "Business"


def normalize_location(location: str) -> str:
    if not location:
        return ""
    parts = location.split(",")
    return parts[-1].strip() if len(parts) > 1 else location.strip()


def _parse_seek_salary(salary_text: Optional[str]) -> tuple[Optional[int], Optional[int]]:
    """Best-effort extraction of a (min, max) integer salary range from
    Seek's free-text salary string, e.g. "$120,000 – $150,000 per year"."""
    if not salary_text:
        return None, None
    numbers = re.findall(r"[\d,]+(?:\.\d+)?", salary_text)
    cleaned = []
    for n in numbers:
        try:
            val = float(n.replace(",", ""))
        except ValueError:
            continue
        # Ignore stray small numbers (e.g. "per year" fragments) that
        # obviously aren't salary figures.
        if val >= 1000:
            cleaned.append(int(val))
    if not cleaned:
        return None, None
    if len(cleaned) == 1:
        return cleaned[0], cleaned[0]
    return min(cleaned), max(cleaned)


def _parse_seek_listing_date(listing_date: Optional[str], scraped_at: Optional[str]) -> str:
    """Seek returns a relative string like "3d ago" / "Today" rather than an
    absolute date. Convert it to an ISO date (YYYY-MM-DD) using scrapedAt (or
    now) as the reference point, falling back to that reference date."""
    reference = datetime.utcnow()
    if scraped_at:
        try:
            reference = datetime.strptime(scraped_at[:10], "%Y-%m-%d")
        except Exception:
            pass

    if not listing_date:
        return reference.strftime("%Y-%m-%d")

    text = listing_date.strip().lower()
    if text in ("today", "just posted", "new"):
        return reference.strftime("%Y-%m-%d")

    match = re.match(r"(\d+)\s*(d|day|days|h|hour|hours|w|week|weeks)", text)
    if match:
        amount = int(match.group(1))
        unit = match.group(2)
        if unit.startswith("h"):
            delta = timedelta(hours=amount)
        elif unit.startswith("w"):
            delta = timedelta(weeks=amount)
        else:
            delta = timedelta(days=amount)
        return (reference - delta).strftime("%Y-%m-%d")

    return reference.strftime("%Y-%m-%d")


def estimate_recency_rank(published_date: Optional[str]) -> float:
    """Best-effort 'days ago' estimate from a published_date string, used
    to sort a MERGED list of jobs by recency across sources that report
    dates completely differently — LinkedIn's raw relative text ("3 days
    ago", "1 week ago", "Just now", see _linkedin_posted_display) vs
    Seek's absolute ISO date (see _parse_seek_listing_date above). Lower
    = more recent. Unparseable/missing strings sort LAST (treated as
    very old) rather than raising or silently floating to the top."""
    if not published_date:
        return 9999.0
    text = published_date.strip().lower()
    if text in ("just now", "just posted", "today", "new"):
        return 0.0

    match = re.match(r"(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago", text)
    if match:
        amount = int(match.group(1))
        unit = match.group(2)
        days_per_unit = {
            "second": 1 / 86400, "minute": 1 / 1440, "hour": 1 / 24,
            "day": 1, "week": 7, "month": 30, "year": 365,
        }
        return amount * days_per_unit[unit]

    # Compact forms occasionally seen ("3d", "2mo", "1w")
    compact = re.match(r"(\d+)\s*(mo|w|d|h)$", text)
    if compact:
        amount = int(compact.group(1))
        days_per_unit = {"h": 1 / 24, "d": 1, "w": 7, "mo": 30}
        return amount * days_per_unit[compact.group(2)]

    # ISO date (Seek's format, or LinkedIn's ISO fallback when no relative
    # text was available at all)
    try:
        dt = datetime.strptime(text[:10], "%Y-%m-%d")
        return max(0.0, (datetime.utcnow() - dt).days)
    except Exception:
        pass
    return 9999.0


def scrape_jobs_apify_seek(
    role: str,
    location: str,
    job_type: str,
    salary_min: Optional[int],
    salary_max: Optional[int],
    apify_api_token: str,
    actor_id: Optional[str] = None,
    max_results: int = 25,
    date_posted: str = "",
) -> List[Dict]:
    """Fetch Seek (seek.com.au / seek.co.nz) job listings via an Apify actor
    and return a normalized list.

    Seek has no official public job-search API and blocks direct scraping
    from generic clients, so this runs a purpose-built Apify Actor (see
    DEFAULT_APIFY_SEEK_ACTOR) through Apify's hosted run-sync endpoint —
    Apify handles the proxying/anti-bot handling on Seek's side, TalentIQ
    just supplies search parameters and an Apify account token.
    """
    if not apify_api_token:
        return [{"error": "Apify authentication failed — add your Apify API token in Settings."}]

    actor = (actor_id or DEFAULT_APIFY_SEEK_ACTOR).strip() or DEFAULT_APIFY_SEEK_ACTOR
    # Actor IDs are addressed as "owner/name" in the Apify Store but need to
    # be "owner~name" in the REST URL.
    actor_path = actor.replace("/", "~")
    run_url = f"https://api.apify.com/v2/acts/{actor_path}/run-sync-get-dataset-items"

    payload: Dict[str, Any] = {
        "keywords": [role] if role else [],
        "location": "" if (not location or location.lower() == "all") else location,
        "maxResults": max_results,
    }
    if job_type and job_type.lower() != "all":
        seek_work_type = _SEEK_WORK_TYPE_MAP.get(job_type.lower())
        if seek_work_type:
            payload["workType"] = seek_work_type
    if date_posted:
        seek_days = _DATE_POSTED_TO_SEEK_DAYS.get(date_posted)
        if seek_days:
            payload["dateRange"] = seek_days

    try:
        response = requests.post(
            run_url,
            params={"token": apify_api_token},
            json=payload,
            timeout=120,
        )
        if response.status_code == 401:
            return [{"error": "Apify authentication failed — check your API token in Settings."}]
        if response.status_code == 404:
            return [{"error": f"Apify actor '{actor}' not found — check the Actor ID in Settings."}]
        if response.status_code >= 400:
            # Surface Apify's own error message rather than a generic one —
            # this is the difference between "something went wrong" and an
            # actionable reason (insufficient balance, actor requires a
            # proxy tier your plan doesn't include, bad input schema after
            # the actor's maintainer changed it, etc.). Apify's error body
            # is normally {"error": {"type": ..., "message": ...}}.
            detail = f"HTTP {response.status_code}"
            try:
                body = response.json()
                err = body.get("error")
                if isinstance(err, dict):
                    detail = err.get("message") or err.get("type") or detail
                elif isinstance(err, str):
                    detail = err
            except Exception:
                pass
            return [{"error": f"Apify actor '{actor}' failed: {detail[:250]}"}]
        response.raise_for_status()
        items = response.json()
    except requests.exceptions.Timeout:
        return [{"error": "Apify Seek search timed out. Try again in a moment, or reduce Max Results."}]
    except requests.exceptions.ConnectionError:
        return [{"error": "Could not connect to Apify API. Check network/internet access."}]
    except Exception as e:
        return [{"error": f"Apify API error: {str(e)[:150]}"}]

    if not isinstance(items, list):
        return [{"error": "Unexpected response shape from Apify — check the configured Actor ID."}]

    jobs = []
    for job in items:
        if not isinstance(job, dict):
            continue

        company = job.get("company") or job.get("advertiserName") or "Unknown"
        raw_location = job.get("location") or location
        description = job.get("fullDescription") or job.get("shortDescription") or ""
        salary_text = job.get("salary") or ""
        s_min, s_max = _parse_seek_salary(salary_text)
        title = job.get("title") or "Unknown"

        jobs.append({
            "title": title,
            "company": company,
            "published_date": _parse_seek_listing_date(job.get("listingDate"), job.get("scrapedAt")),
            "location": normalize_location(raw_location) if raw_location else "",
            "job_type": job.get("workType") or job_type or "N/A",
            "description": description,
            "source": "Seek",
            "company_type": classify_company_type(company),
            "apply_link": job.get("url") or "",
            "source_site": "Seek",
            "salary_min": s_min,
            "salary_max": s_max,
        })

    # Optional client-side salary filtering — the Seek scraper actor doesn't
    # take salary bounds as input (salary is only shown for ~20-30% of
    # listings), so filter after the fact when the caller asked for a range.
    if salary_min or salary_max:
        filtered = []
        for j in jobs:
            j_min, j_max = j.get("salary_min"), j.get("salary_max")
            if j_min is None and j_max is None:
                filtered.append(j)  # keep undisclosed-salary listings rather than dropping them
                continue
            if salary_min and (j_max or j_min or 0) < salary_min:
                continue
            if salary_max and (j_min or j_max or 0) > salary_max:
                continue
            filtered.append(j)
        jobs = filtered

    # Deduplicate
    seen = set()
    unique = []
    for j in jobs:
        key = (j["title"].lower(), j["company"].lower())
        if key not in seen:
            seen.add(key)
            unique.append(j)
    return unique


# ─────────────────────────────────────────────
# JOB SCRAPER (Apify — LinkedIn Jobs Scraper actor, optional richer path)
# ─────────────────────────────────────────────

# Same publisher/family as DEFAULT_APIFY_SEEK_ACTOR, also keyed off the
# user's existing Apify token — no separate credential needed. Runs
# LinkedIn's own public guest jobs API server-side (through Apify's
# proxying), same no-login approach as scrape_jobs_linkedin below, but
# with full job-detail pages fetched (salary, seniority, applicant
# count, full description) and Apify's proxy/retry handling in front of
# it, which the direct in-process scraper below doesn't have. Used as
# an automatic upgrade when the user has Apify configured (see
# routers/jobhunt.py) — if it fails for any reason (no credits, actor
# unavailable), the caller falls back to the free direct scraper rather
# than failing the whole "LinkedIn" source.
DEFAULT_APIFY_LINKEDIN_ACTOR = "automation-lab/linkedin-jobs-scraper"


def scrape_jobs_apify_linkedin(
    role: str,
    location: str,
    job_type: str,
    apify_api_token: str,
    actor_id: Optional[str] = None,
    max_results: int = 25,
    date_posted: str = "",
    remote_type: str = "",
    experience_level: str = "",
    sort_by: str = "relevance",
) -> List[Dict]:
    """Fetch LinkedIn job listings via an Apify actor and return a
    normalized list in the same shape as scrape_jobs_apify_seek /
    scrape_jobs_linkedin, so all three are interchangeable to the caller.

    scrapeJobDetails is deliberately OFF here (the actor's own default is
    ON): fetching each job's full detail page is what made this path much
    slower than the original guest-endpoint tool this was ported from —
    the actor's own docs cite ~5s for 100 listings in list mode vs up to
    ~60s with full details. List mode still returns title, company,
    location, postedAt, salary and the apply URL — everything JobHunter's
    results table and matching actually use — so the extra detail-page
    round trip per job isn't worth trading away the speed for.
    """
    if not apify_api_token:
        return [{"error": "Apify authentication failed — add your Apify API token in Settings."}]

    actor = (actor_id or DEFAULT_APIFY_LINKEDIN_ACTOR).strip() or DEFAULT_APIFY_LINKEDIN_ACTOR
    actor_path = actor.replace("/", "~")
    run_url = f"https://api.apify.com/v2/acts/{actor_path}/run-sync-get-dataset-items"

    payload: Dict[str, Any] = {
        "searchQuery": role or "",
        "location": "" if (not location or location.lower() == "all") else location,
        "maxJobs": max_results,
        "scrapeJobDetails": False,
    }
    if job_type and job_type.lower() != "all":
        li_type = _LINKEDIN_JOB_TYPE_MAP.get(job_type.lower())
        if li_type:
            payload["jobType"] = li_type
    if date_posted:
        tpr = _DATE_POSTED_TO_LINKEDIN_TPR.get(date_posted)
        if tpr:
            payload["datePosted"] = tpr
    if remote_type:
        wt = _REMOTE_TYPE_TO_LINKEDIN_WT.get(remote_type)
        if wt:
            payload["workplaceType"] = wt
    if experience_level:
        exp = _EXPERIENCE_TO_LINKEDIN_E.get(experience_level)
        if exp:
            payload["experienceLevel"] = exp
    if sort_by:
        sb = _SORT_TO_LINKEDIN.get(sort_by)
        if sb:
            payload["sortBy"] = sb

    try:
        response = requests.post(
            run_url, params={"token": apify_api_token}, json=payload, timeout=45,
        )
        if response.status_code == 401:
            return [{"error": "Apify authentication failed — check your API token in Settings."}]
        if response.status_code == 404:
            return [{"error": f"Apify actor '{actor}' not found — check the Actor ID in Settings."}]
        if response.status_code >= 400:
            detail = f"HTTP {response.status_code}"
            try:
                body = response.json()
                err = body.get("error")
                if isinstance(err, dict):
                    detail = err.get("message") or err.get("type") or detail
                elif isinstance(err, str):
                    detail = err
            except Exception:
                pass
            return [{"error": f"Apify actor '{actor}' failed: {detail[:250]}"}]
        response.raise_for_status()
        items = response.json()
    except requests.exceptions.Timeout:
        return [{"error": "Apify LinkedIn search timed out. Try again in a moment, or reduce Max Results."}]
    except requests.exceptions.ConnectionError:
        return [{"error": "Could not connect to Apify API. Check network/internet access."}]
    except Exception as e:
        return [{"error": f"Apify API error: {str(e)[:150]}"}]

    if not isinstance(items, list):
        return [{"error": "Unexpected response shape from Apify — check the configured Actor ID."}]

    jobs = []
    for job in items:
        if not isinstance(job, dict):
            continue
        company = job.get("companyName") or "Unknown"
        description = job.get("descriptionText") or ""
        s_min, s_max = _parse_seek_salary(job.get("salary") or "")  # generic $-range text parsing

        jobs.append({
            "title": job.get("title") or "Unknown",
            "company": company,
            "published_date": (job.get("postedAt") or "").strip(),
            "location": normalize_location(job.get("location") or location) if (job.get("location") or location) else "",
            "job_type": job.get("employmentType") or job_type or "N/A",
            "description": description,
            "source": "LinkedIn",
            "company_type": classify_company_type(company),
            "apply_link": job.get("applyUrl") or job.get("url") or "",
            "source_site": "LinkedIn",
            "salary_min": s_min,
            "salary_max": s_max,
        })

    # Deduplicate — same reasoning as scrape_jobs_apify_seek
    seen = set()
    unique = []
    for j in jobs:
        key = (j["title"].lower(), j["company"].lower())
        if key not in seen:
            seen.add(key)
            unique.append(j)
    return unique


# ─────────────────────────────────────────────
# JOB SCRAPER (LinkedIn — public guest job search, no API key/login)
# ─────────────────────────────────────────────

# LinkedIn's own "jobs-guest" endpoint is what linkedin.com/jobs itself
# calls to lazily load more results on scroll — it's served to anonymous
# (logged-out) visitors, so it needs no LinkedIn account, cookies, or
# API key, the same no-credential approach Seek's Apify actor uses on
# its side (see scrape_jobs_apify_seek above). This is a direct port of
# the well-known "linkedin-jobs-api" Node approach (guest endpoint +
# HTML-fragment parsing) into this backend, so JobHunter's "LinkedIn"
# source is a real, independent scraper rather than routed through a
# third-party Apify actor.
_LINKEDIN_GUEST_SEARCH_URL = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"

# Rotate through a small pool of realistic desktop-browser user agents —
# LinkedIn's guest endpoint is more likely to serve results (rather than
# a verification challenge) to traffic that looks like an ordinary
# browser than to a fixed, unfamiliar UA string.
_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
]

# LinkedIn's own work-type filter codes (f_JT), mapped from the free-text
# job_type values used elsewhere in TalentIQ — same idea as
# _SEEK_WORK_TYPE_MAP above, different target vocabulary. Matches the
# shared tool's full option set (Full-time/Part-time/Contract/Temporary/
# Volunteer/Internship) rather than the earlier partial mapping.
_LINKEDIN_JOB_TYPE_MAP = {
    "full-time": "F", "full_time": "F", "full time": "F",
    "part-time": "P", "part_time": "P", "part time": "P",
    "contract": "C",
    "temporary": "T",
    "volunteer": "V",
    "internship": "I",
}

# Date-posted filter, mapped to each source's own vocabulary — "" means
# "any time" (no filter applied) for both.
_DATE_POSTED_TO_LINKEDIN_TPR = {"24h": "r86400", "week": "r604800", "month": "r2592000"}
_DATE_POSTED_TO_SEEK_DAYS = {"24h": "1", "week": "7", "month": "30"}

# Workplace type (remote/on-site/hybrid) — LinkedIn's f_JT-adjacent f_WT
# filter. LinkedIn-only: Seek's actor has no equivalent input.
_REMOTE_TYPE_TO_LINKEDIN_WT = {"onsite": "1", "remote": "2", "hybrid": "3"}

# Seniority filter — LinkedIn's f_E codes. LinkedIn-only, same reason.
_EXPERIENCE_TO_LINKEDIN_E = {
    "internship": "1", "entry": "2", "associate": "3",
    "senior": "4", "director": "5", "executive": "6",
}

# Sort order — LinkedIn's own sortBy param ("R" relevance / "DD" most
# recent). "ats_score" isn't listed here — it's handled entirely
# client-side once matching completes (see JobHuntPage.tsx), since no
# match exists yet at search time.
_SORT_TO_LINKEDIN = {"recent": "DD", "relevance": "R"}


def _linkedin_posted_display(ago_time: Optional[str], iso_datetime: Optional[str]) -> str:
    """Shows the job's posted time exactly the way the source tool this
    was ported from does — a plain relative string like "3 days ago" or
    "Just now" (LinkedIn's own .job-search-card__listdate text / the
    Apify actor's postedAt field) rather than a computed absolute date.
    Only falls back to the machine-readable <time datetime="..."> ISO
    value, formatted as a plain date, on the rare listing where LinkedIn
    doesn't render the relative text at all."""
    if ago_time and ago_time.strip():
        return ago_time.strip()
    if iso_datetime:
        try:
            return datetime.fromisoformat(iso_datetime.replace("Z", "+00:00")).strftime("%Y-%m-%d")
        except Exception:
            pass
    return ""


def scrape_jobs_linkedin(
    role: str,
    location: str,
    job_type: str,
    max_results: int = 25,
    date_posted: str = "",
    remote_type: str = "",
    experience_level: str = "",
    sort_by: str = "relevance",
) -> List[Dict]:
    """Fetch LinkedIn job listings via LinkedIn's own public guest job
    search endpoint (no login, no API key, no Apify account needed) and
    return a normalized list in the same shape scrape_jobs_apify_seek
    produces, so the caller (routers/jobhunt.py) can merge both sources
    interchangeably.

    This is a real, independent scraper — not a mock — but it IS scraping
    a public page rather than calling an official API, so results can be
    thinner (LinkedIn's guest cards don't expose a job description) and
    occasionally rate-limited/blocked; both are reported back as an
    {"error": ...} item rather than silently substituting fake data.
    """
    import random

    session_headers = {
        "User-Agent": random.choice(_USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.linkedin.com/jobs",
        "X-Requested-With": "XMLHttpRequest",
    }

    keyword = (role or "").strip()
    loc = "" if (not location or location.lower() == "all") else location.strip()
    linkedin_job_type = _LINKEDIN_JOB_TYPE_MAP.get((job_type or "").lower(), "")
    linkedin_tpr = _DATE_POSTED_TO_LINKEDIN_TPR.get(date_posted, "") if date_posted else ""
    linkedin_wt = _REMOTE_TYPE_TO_LINKEDIN_WT.get(remote_type, "") if remote_type else ""
    linkedin_exp = _EXPERIENCE_TO_LINKEDIN_E.get(experience_level, "") if experience_level else ""
    linkedin_sort = _SORT_TO_LINKEDIN.get(sort_by, "") if sort_by else ""

    def build_url(start: int) -> str:
        params: Dict[str, str] = {}
        if keyword:
            params["keywords"] = keyword
        if loc:
            params["location"] = loc
        if linkedin_job_type:
            params["f_JT"] = linkedin_job_type
        if linkedin_tpr:
            params["f_TPR"] = linkedin_tpr
        if linkedin_wt:
            params["f_WT"] = linkedin_wt
        if linkedin_exp:
            params["f_E"] = linkedin_exp
        if linkedin_sort:
            params["sortBy"] = linkedin_sort
        params["start"] = str(start)
        from urllib.parse import urlencode
        return f"{_LINKEDIN_GUEST_SEARCH_URL}?{urlencode(params)}"

    from bs4 import BeautifulSoup
    import time as _time

    all_jobs: List[Dict] = []
    start = 0
    batch_size = 25
    consecutive_empty = 0

    while len(all_jobs) < max_results and consecutive_empty < 2:
        try:
            resp = requests.get(build_url(start), headers=session_headers, timeout=15)
        except requests.exceptions.Timeout:
            return [{"error": "LinkedIn job search timed out. Try again in a moment."}] if not all_jobs else all_jobs[:max_results]
        except requests.exceptions.ConnectionError:
            return [{"error": "Could not connect to LinkedIn. Check network/internet access."}] if not all_jobs else all_jobs[:max_results]

        if resp.status_code == 429:
            return [{"error": "LinkedIn rate-limited this search — wait a bit and try again."}] if not all_jobs else all_jobs[:max_results]
        if resp.status_code != 200:
            return [{"error": f"LinkedIn returned HTTP {resp.status_code} — it may be blocking automated requests right now."}] if not all_jobs else all_jobs[:max_results]

        soup = BeautifulSoup(resp.text, "html.parser")
        cards = soup.find_all("li")
        if not cards:
            consecutive_empty += 1
            start += batch_size
            continue

        found_this_batch = 0
        for card in cards:
            title_el = card.select_one(".base-search-card__title")
            company_el = card.select_one(".base-search-card__subtitle")
            if not title_el or not company_el:
                continue
            title = title_el.get_text(strip=True)
            company = company_el.get_text(strip=True)
            if not title or not company:
                continue

            location_el = card.select_one(".job-search-card__location")
            time_el = card.find("time")
            salary_el = card.select_one(".job-search-card__salary-info")
            link_el = card.select_one(".base-card__full-link")
            ago_el = card.select_one(".job-search-card__listdate")

            location_text = location_el.get_text(strip=True) if location_el else loc
            salary_text = salary_el.get_text(" ", strip=True) if salary_el else ""
            s_min, s_max = _parse_seek_salary(salary_text)  # generic "$X - $Y" text parsing, not Seek-specific

            all_jobs.append({
                "title": title,
                "company": company,
                "published_date": _linkedin_posted_display(
                    ago_el.get_text(strip=True) if ago_el else None,
                    time_el.get("datetime") if time_el else None,
                ),
                "location": normalize_location(location_text) if location_text else "",
                "job_type": job_type or "N/A",
                # LinkedIn's guest search-results cards don't include a
                # description snippet (only the detail page does, which
                # would need one extra request per job) — left blank
                # rather than faked; the Apply link takes candidates
                # straight to the real listing for the full description.
                "description": "",
                "source": "LinkedIn",
                "company_type": classify_company_type(company),
                "apply_link": (link_el.get("href") or "").split("?")[0] if link_el else "",
                "source_site": "LinkedIn",
                "salary_min": s_min,
                "salary_max": s_max,
            })
            found_this_batch += 1

        if found_this_batch == 0:
            consecutive_empty += 1
        else:
            consecutive_empty = 0

        start += batch_size
        if len(all_jobs) >= max_results:
            break
        _time.sleep(0.6)  # be a reasonably polite guest, not a fixed hammer

    return all_jobs[:max_results]


def fetch_job_description(url: str, timeout: int = 8) -> str:
    """Best-effort fetch of a job's full description from its own listing
    page — used ONLY at match time (see routers/jobhunt.py's /match), for
    jobs whose description came back empty from the search step itself.

    Why this exists: LinkedIn results (both the free scraper and the
    Apify LinkedIn actor with scrapeJobDetails off, see
    scrape_jobs_apify_linkedin) deliberately skip the per-job detail
    page during SEARCH to keep browsing fast — that was the single
    biggest search-speed win. But an empty description means JD-
    requirement extraction (extract_jd_requirements_categorized) has
    nothing to read, which short-circuits straight to the deterministic
    keyword fallback WITHOUT EVER CALLING GROQ AT ALL — no LLM call
    means no failure to blame Settings for; there was simply nothing to
    extract from. This fetch trades a small amount of one-time latency
    at match time (once per job that needs it, not per search) to give
    the LLM real content to work with, restoring genuine AI-powered
    matching for LinkedIn jobs.

    Handles LinkedIn's own job page structure; returns "" (never raises)
    for any other domain or on any failure — the caller already falls
    back to matching on just title/company when description is empty,
    exactly as before this function existed.
    """
    if not url:
        return ""
    try:
        import random
        headers = {"User-Agent": random.choice(_USER_AGENTS), "Accept-Language": "en-US,en;q=0.9"}
        resp = requests.get(url, headers=headers, timeout=timeout)
        if resp.status_code != 200:
            return ""
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(resp.text, "html.parser")
        if "linkedin.com" in url:
            node = (
                soup.select_one(".show-more-less-html__markup")
                or soup.select_one(".description__text")
                or soup.select_one("[class*='description']")
            )
            return node.get_text(" ", strip=True)[:8000] if node else ""
        return ""
    except Exception:
        return ""


# ─────────────────────────────────────────────
# RESUME PARSER (text-based)
# ─────────────────────────────────────────────

def parse_resume_text(text: str) -> Dict:
    """Extract structured info from raw resume text"""
    lines = [l.strip() for l in text.splitlines() if l.strip()]

    # Simple name heuristic – first non-blank line
    applicant_name = lines[0] if lines else "Applicant"

    # Email
    email_match = re.search(
        r"[a-zA-Z][\w.+-]*@[\w-]+\.(com|net|org|edu|gov|io|co|au|uk|in|nz|ca|us|biz|info|me)\b",
        text, re.IGNORECASE,
    )
    email = email_match.group() if email_match else None

    # Skills detection (simple keyword matching)
    tech_keywords = [
        "python", "java", "javascript", "typescript", "react", "sql", "postgresql",
        "fastapi", "django", "flask", "node", "aws", "azure", "docker", "kubernetes",
        "langchain", "tensorflow", "pytorch", "pandas", "scikit-learn", "tableau",
        "power bi", "excel", "git", "linux", "rest api", "graphql", "mongodb",
        "redis", "spark", "hadoop", "snowflake", "dbt", "airflow",
    ]
    text_lower = text.lower()
    skills = [kw for kw in tech_keywords if kw in text_lower]

    # Experience years
    exp_matches = re.findall(r"(\d+)\s*\+?\s*years?\s*(of\s+)?(experience|exp)", text_lower)
    experience_years = float(exp_matches[0][0]) if exp_matches else 0.0

    return {
        "applicant_name": applicant_name,
        "email": email,
        "skills": skills,
        "experience_years": experience_years,
        "raw_text": text,
    }


# ─────────────────────────────────────────────
# RESUME-JOB MATCHER
# ─────────────────────────────────────────────

def extract_requirements_from_description(description: str) -> List[str]:
    """Heuristically extract key requirements from job description"""
    lines = [l.strip() for l in description.splitlines() if l.strip()]
    req_patterns = [
        r"experience (with|in)\s+(.+)",
        r"knowledge of\s+(.+)",
        r"proficiency in\s+(.+)",
        r"skills? in\s+(.+)",
        r"familiar(ity)? with\s+(.+)",
    ]
    requirements = []
    for line in lines:
        if len(line) > 10 and (
            line.startswith(("-", "•", "*")) or
            any(re.search(p, line, re.IGNORECASE) for p in req_patterns)
        ):
            clean = line.lstrip("-•* ").rstrip(".")
            if len(clean) > 5:
                requirements.append(clean)
    return requirements[:15]


# ══════════════════════════════════════════════════════════════════════════════
# ATS MATCHING — structured extraction + deterministic weighted scoring.
#
# The old version asked the LLM to reply in an ad-hoc "SCORE:XX
# STRENGTHS:s1|s2|s3" text format and regex-parsed it — fragile and prone to
# silently wrong scores whenever the model's formatting drifted even
# slightly. This mirrors the same structured approach used in CVAnalysis:
# extract facts as JSON, then score with plain deterministic Python math.
#
# Since a resume is matched against MANY jobs in one batch, the candidate's
# profile is extracted ONCE per batch (see extract_candidate_profile below)
# and reused — only the per-job requirement extraction repeats per job.
# ══════════════════════════════════════════════════════════════════════════════

_JOBHUNT_SKILL_BANK = [
    "python","javascript","typescript","react","node","sql","postgresql","mongodb",
    "aws","azure","gcp","docker","kubernetes","git","agile","rest","api","graphql",
    "machine learning","ai","artificial intelligence","data science","excel","power bi","tableau","salesforce",
    "django","flask","java","c#","c++","go","spark","kafka","airflow","dbt",
    "snowflake","databricks","stakeholder management","cloud architecture",
    "data mesh","data fabric","data vault","lakehouse","enterprise data warehouse","edw",
    "data governance","master data management","collibra","alation","teradata","hadoop",
    "synapse","azure data factory","enterprise architecture","solution architecture","togaf",
    "basel","banking","bfsi","insurance","risk management","regulatory compliance",
    "microservices","devops","ci/cd","accounting","tax","audit","payroll",
    "financial reporting","budgeting","forecasting","reconciliation",
    "leadership","communication","problem solving","project management","scrum",
]


def _normalize_skill(s: str) -> str:
    s = re.sub(r"\s+", " ", s.strip().lower())
    for pattern, repl in _UK_TO_US_SPELLING:
        s = re.sub(pattern, repl, s)
    return s


def _normalize_text(s: str) -> str:
    s = s.lower()
    for pattern, repl in _UK_TO_US_SPELLING:
        s = re.sub(pattern, repl, s)
    return s


_UK_TO_US_SPELLING = [
    (r"\bmodelling\b", "modeling"), (r"\blabelling\b", "labeling"),
    (r"\bcancelled\b", "canceled"), (r"\btravelling\b", "traveling"),
    (r"\borganisation", "organization"), (r"\bcolour", "color"),
    (r"\blicence", "license"), (r"\bcentre\b", "center"),
    (r"\bprogramme\b", "program"), (r"\banalyse", "analyze"),
    (r"\boptimise", "optimize"), (r"\bcategorise", "categorize"),
    (r"\bcustomise", "customize"), (r"\bfavour", "favor"),
    (r"\bbehaviour", "behavior"), (r"\bvisualise", "visualize"),
    (r"\bsummarise", "summarize"), (r"\bspecialise", "specialize"),
]

# Same taxonomy used in CVAnalysis (routers/cvintel.py) and CandidateLens
# (routers/joblens.py) — true synonyms/abbreviations plus curated specific-
# technique -> general-skill relationships (e.g. Dimensional Modeling IS a
# form of Data Modeling), not blind fuzzy string similarity, so it doesn't
# introduce false positives.
_SKILL_SYNONYMS = {
    "ai": ["artificial intelligence"], "artificial intelligence": ["ai"],
    "ml": ["machine learning"], "machine learning": ["ml",
        "regression", "classification", "neural network", "deep learning",
        "supervised learning", "unsupervised learning", "random forest",
        "gradient boosting", "xgboost", "scikit-learn", "tensorflow", "pytorch"],
    "bi": ["business intelligence"], "business intelligence": ["bi"],
    "power bi": ["powerbi", "power-bi"],
    "aws": ["amazon web services", "ec2", "s3", "redshift", "lambda",
        "aws glue", "amazon redshift", "cloudformation"],
    "amazon web services": ["aws"],
    "azure": ["microsoft azure", "azure data factory", "azure synapse",
        "azure synapse analytics", "adls", "adls gen2", "azure devops"],
    "gcp": ["google cloud platform", "google cloud", "bigquery", "gcp bigquery"],
    "google cloud platform": ["gcp"],
    "api": ["apis", "application programming interface", "rest api", "restful api", "graphql"],
    "apis": ["api"],
    "etl": ["extract transform load", "extract, transform, load", "elt",
        "data pipeline", "airflow", "dbt", "informatica", "talend", "ssis"],
    "elt": ["etl"],
    "data pipeline": ["etl", "elt", "airflow", "dbt", "data pipelines"],
    "sql": ["structured query language", "t-sql", "pl/sql", "mysql", "postgresql", "postgres"],
    "ci/cd": ["ci cd", "continuous integration", "continuous deployment", "jenkins", "github actions"],
    "devops": ["dev ops"],
    "nlp": ["natural language processing"], "natural language processing": ["nlp"],
    "data governance": ["governance framework", "data governance framework",
        "data stewardship", "data catalog", "data cataloguing", "data lineage",
        "data quality framework", "collibra", "alation"],
    "edw": ["enterprise data warehouse"], "enterprise data warehouse": ["edw"],
    "mdm": ["master data management"], "master data management": ["mdm"],
    "crm": ["customer relationship management", "salesforce"],
    "erp": ["enterprise resource planning", "sap", "oracle erp", "netsuite"],
    "data modeling": [
        "dimensional modeling", "dimensional model", "data vault",
        "data vault 2.0", "star schema", "snowflake schema",
        "entity relationship modeling", "er modeling", "erd",
        "third normal form", "3nf modeling", "kimball", "inmon",
        "fsldm", "logical data modeling", "physical data modeling",
        "conceptual data modeling", "normalization", "denormalization",
    ],
    "data architecture": [
        "data mesh", "data fabric", "lakehouse", "data lakehouse",
        "enterprise data warehouse", "edw", "data lake", "data warehouse",
        "solution architecture", "enterprise architecture",
    ],
    "cloud architecture": ["aws", "azure", "gcp", "multi-cloud", "hybrid cloud"],
}


def _skill_present(skill: str, candidate_skills: set, resume_lower: str) -> bool:
    """See routers/cvintel.py's _skill_present for the full rationale —
    checks extracted-skill overlap, exact substring (after UK/US spelling
    normalization), known synonyms/specific-technique relationships, and
    (for multi-word skills) all significant words appearing anywhere in
    the resume, not just as one exact contiguous phrase."""
    sk = _normalize_skill(skill)
    if any(sk in cs or cs in sk for cs in candidate_skills):
        return True
    if sk in resume_lower:
        return True
    for variant in _SKILL_SYNONYMS.get(sk, []):
        if _normalize_text(variant) in resume_lower:
            return True
    words = [w for w in sk.split() if len(w) > 2]
    if len(words) >= 2 and all(w in resume_lower for w in words):
        return True
    return False


async def extract_candidate_profile(resume_text: str, groq_api_key: Optional[str] = None, groq_model: str = DEFAULT_GROQ_MODEL) -> Dict:
    """Extract a structured, categorized candidate profile ONCE per resume
    — reused across every job in a match batch rather than re-extracted
    per job. Delegates to the shared extraction module (also used by
    CVAnalysis and CandidateLens) so all three present strengths the same
    way: Technical Skills, Business Skills, Soft Skills, Significant
    Experience, and Certifications & Degrees."""
    from utils.llm_extraction import extract_candidate_strengths_general
    strengths = await extract_candidate_strengths_general(resume_text, groq_api_key, groq_model)
    # hard_skills kept for backward-compat with the deterministic matching
    # logic below — technical + business skills combined.
    strengths["hard_skills"] = strengths.get("technical_skills", []) + strengths.get("business_skills", [])
    strengths["_ai_powered"] = strengths.get("ai_powered", False)
    return strengths


async def _extract_job_requirements(
    job: Dict, groq_api_key: Optional[str] = None, groq_model: str = DEFAULT_GROQ_MODEL,
    db=None, user_id: Optional[int] = None,
) -> Dict:
    """Categorized JD requirements (Essential / Good to Have / Optional) via
    the shared extraction module — same schema CVAnalysis and CandidateLens
    use, so "similar and essential, preferred requirements from the JD" show
    up consistently everywhere.

    Pass db + user_id to let this draw its own key from the shared Groq
    key pool (see utils/groq_pool.py) rather than being stuck with the one
    key resolved once at the top of routers/jobhunt.py's /match — CVAnalysis
    already does this (see routers/cvintel.py); JobHunter's matching didn't,
    which meant a single rate-limited/bad pool key failed EVERY job in a
    batch with no chance to rotate, even with other healthy keys sitting
    in the pool."""
    from utils.llm_extraction import extract_jd_requirements_categorized
    description = job.get("description", "") or ""
    req = await extract_jd_requirements_categorized(description, groq_api_key, groq_model, db=db, user_id=user_id)
    # required_hard_skills kept for backward-compat with the deterministic
    # matching logic below — falls back to the old heuristic extractor if
    # the shared one came back empty (e.g. a very short description).
    if not req.get("essential") and not req.get("good_to_have"):
        req["required_hard_skills"] = extract_requirements_from_description(description)[:10]
    else:
        req["required_hard_skills"] = req.get("essential", [])
    return req


async def calculate_match(
    resume_text: str, job: Dict, groq_api_key: Optional[str] = None,
    candidate_profile: Optional[Dict] = None, groq_model: str = DEFAULT_GROQ_MODEL,
    ollama_base_url: Optional[str] = None, ollama_model: Optional[str] = None,
    known_terms_hint: Optional[list] = None, db=None, user_id: Optional[int] = None,
) -> Dict:
    """Calculate ATS score and generate insights for a single job.
    Pass a pre-extracted `candidate_profile` (from extract_candidate_profile)
    when matching one resume against many jobs, to avoid re-extracting the
    same resume on every call.

    Essential/good-to-have matching is judged by the LLM per-item (same fix
    as CVAnalysis) rather than deterministic string/token matching, which
    can't reliably judge long capability-statement requirements or
    requirements phrased differently than the resume (e.g. "Data Modeling"
    vs a resume that says "Dimensional Modeling"). This does mean one LLM
    call per job (matching is inherently job-specific, unlike the
    resume-intrinsic technical/business/soft skills below, which stay
    cached in candidate_profile and are NOT re-extracted here).

    Tries Ollama first when configured (see utils.llm_extraction), then
    Groq, then a deterministic heuristic. Pass `db` to enrich the shared
    skill taxonomy after a successful LLM match (best-effort, never blocks
    or fails the match itself). Pass `user_id` too (alongside `db`) so
    THIS job's chunks can independently draw their own key from the
    shared Groq key pool instead of all sharing one fixed key for the
    whole batch — see _extract_job_requirements's docstring."""
    if candidate_profile is None:
        candidate_profile = await extract_candidate_profile(resume_text, groq_api_key, groq_model)

    requirements = await _extract_job_requirements(job, groq_api_key, groq_model, db=db, user_id=user_id)
    essential = [s for s in requirements.get("essential", requirements.get("required_hard_skills", [])) if s]
    good_to_have = [s for s in requirements.get("good_to_have", []) if s]

    from utils.llm_extraction import extract_candidate_strengths, enrich_skill_taxonomy
    verdicts = await extract_candidate_strengths(
        resume_text, {"essential": essential, "good_to_have": good_to_have}, groq_api_key, groq_model,
        ollama_base_url=ollama_base_url, ollama_model=ollama_model, known_terms_hint=known_terms_hint,
        db=db, user_id=user_id,
    )
    if db is not None and verdicts.get("ai_powered"):
        await enrich_skill_taxonomy(db, {
            "essential": essential,
            "good_to_have": good_to_have,
            "technical": verdicts.get("technical_skills", []),
            "business": verdicts.get("business_skills", []),
            "soft": verdicts.get("soft_skills", []),
        })
    if "essential_matched" in verdicts or "essential_missing" in verdicts:
        matched = verdicts.get("essential_matched", [])
        missed = verdicts.get("essential_missing", [])
        matched_good = verdicts.get("good_to_have_matched", [])
    else:
        # Fallback only if the LLM path didn't return verdicts for some reason
        text_lower = _normalize_text(resume_text)
        candidate_skills = {_normalize_skill(s) for s in candidate_profile.get("hard_skills", [])}
        matched = [s for s in essential if _skill_present(_normalize_skill(s), candidate_skills, text_lower)]
        missed = [s for s in essential if s not in matched]
        matched_good = [s for s in good_to_have if _skill_present(_normalize_skill(s), candidate_skills, text_lower)]

    skills_pct = round(len(matched) / len(essential) * 100) if essential else 65

    min_years = requirements.get("min_years_experience") or 0
    cand_years = candidate_profile.get("years_experience") or 0
    experience_pct = 85 if min_years <= 0 else max(20, min(100, round(cand_years / min_years * 100)))

    ats_score = round(skills_pct * 0.60 + experience_pct * 0.25 + (min(100, len(matched_good) * 25) if good_to_have else 60) * 0.10 + 75 * 0.05, 1)
    ats_score = max(10, min(98, ats_score))

    summary = [
        f"ATS match score: {ats_score}%",
        f"Matched {len(matched)} of {len(essential)} essential requirements.",
    ]
    if missed:
        summary.append(f"Gaps: {', '.join(missed[:3])}")

    return {
        "ats_score": ats_score,
        "strengths": matched[:8],
        "improvements": missed[:5],
        "summary": summary,
        # ── Categorized strengths — same schema as CVAnalysis/CandidateLens ──
        "strengths_breakdown": {
            "essential_matched": matched,
            "technical_skills": candidate_profile.get("technical_skills", []),
            "business_skills": candidate_profile.get("business_skills", []),
            "soft_skills": candidate_profile.get("soft_skills", []),
            "significant_experience": candidate_profile.get("significant_experience", []),
            "certifications_degrees": candidate_profile.get("certifications_degrees", []),
            "years_experience": candidate_profile.get("years_experience", 0),
            "education": candidate_profile.get("education", ""),
            "ai_powered": verdicts.get("ai_powered", False),
        },
        # ── Categorized JD requirements ──
        "jd_requirements": {
            "essential": requirements.get("essential", requirements.get("required_hard_skills", [])),
            "good_to_have": requirements.get("good_to_have", []),
            "optional": requirements.get("optional", []),
            "min_years_experience": requirements.get("min_years_experience", 0),
            "education_requirement": requirements.get("education_requirement", ""),
        },
    }


# ─────────────────────────────────────────────
# COVER LETTER GENERATOR
# ─────────────────────────────────────────────

def _extract_keywords(text: str) -> List[str]:
    stop = {"the", "and", "for", "with", "in", "of", "to", "a", "on", "as", "is", "an"}
    return [w for w in re.findall(r"\b\w+\b", text.lower()) if w not in stop and len(w) > 3]


def generate_cover_letter(
    resume_text: str,
    resume_info: Dict,
    job: Dict,
    groq_api_key: Optional[str] = None,
    groq_model: str = DEFAULT_GROQ_MODEL,
) -> str:
    """Generate a personalised cover letter for a job"""
    job_title = job.get("title", "the position")
    company = job.get("company", "your organization")
    job_desc = job.get("description", "")
    candidate_name = resume_info.get("applicant_name", "Your Name")

    # Use LLM if available
    if groq_api_key and _GROQ_AVAILABLE and ChatGroq:
        try:
            from utils.llm_extraction import _truncate_for_llm
            llm = ChatGroq(api_key=groq_api_key, model=groq_model, temperature=0.5, max_tokens=4000, reasoning_format="hidden", reasoning_effort="low", max_retries=0)
            prompt = (
                f"Write a professional, concise cover letter for {candidate_name} "
                f"applying for the {job_title} role at {company}.\n\n"
                f"Job description: {_truncate_for_llm(job_desc, 'JD text', 8000)}\n\n"
                f"Resume highlights: {_truncate_for_llm(resume_text, 'resume text', 8000)}\n\n"
                "Write 3 paragraphs: opening, strengths alignment, closing. "
                "Return only the letter text."
            )
            return llm.invoke(prompt).content
        except Exception:
            pass

    # Fallback: template-based
    job_keywords = _extract_keywords(job_desc)
    resume_lines = [l.strip().lstrip("• ") for l in resume_text.split("\n") if l.strip()]
    scored = sorted(
        [(sum(1 for kw in job_keywords if kw in l.lower()), l) for l in resume_lines],
        key=lambda x: x[0], reverse=True
    )
    top_strengths = [l for s, l in scored[:4] if s > 0]
    strengths_text = "\n".join(f"- {s}" for s in top_strengths) or "- [Your relevant strengths]"

    is_agency = any(w in company.lower() for w in ["recruit", "agency", "talent", "staffing"])
    greeting = f"I am writing to express my strong interest in the {job_title} role"
    if not is_agency:
        greeting += f" at {company}"
    greeting += "."

    letter = (
        f"Dear Hiring Manager,\n\n"
        f"{greeting} With proven experience aligned to your requirements, "
        f"I am confident in my ability to contribute effectively from day one.\n\n"
        f"Top reasons I am a strong fit:\n{strengths_text}\n\n"
    )
    if not is_agency:
        letter += f"I am particularly drawn to {company} because of its innovation and leadership.\n\n"
    letter += (
        f"I would welcome the opportunity to contribute my expertise to your team. "
        f"Thank you for considering my application.\n\n"
        f"Warm regards,\n{candidate_name}"
    )
    return letter


# ─────────────────────────────────────────────
# LANGCHAIN AGENT BUILDER
# ─────────────────────────────────────────────

def build_jobhunt_agent(groq_api_key: str) -> AgentExecutor:
    """Build a LangChain ReAct agent wrapping JobHunt tools"""
    if not _GROQ_AVAILABLE or not ChatGroq:
        raise RuntimeError("langchain-groq is not installed. Run: pip install langchain-groq")
    llm = ChatGroq(api_key=groq_api_key, model=DEFAULT_GROQ_MODEL, temperature=0, max_tokens=4000, reasoning_format="hidden", reasoning_effort="low", max_retries=0)

    tools = [
        Tool(
            name="ScrapeJobs",
            func=lambda q: f"Job scraping configured for: {q}",
            description="Scrape Seek job listings via Apify given role, location, type, salary range.",
        ),
        Tool(
            name="ParseResume",
            func=lambda text: str(parse_resume_text(text)),
            description="Parse a resume text and extract structured information.",
        ),
        Tool(
            name="MatchResumeToJob",
            func=lambda x: "Match calculation complete",
            description="Calculate ATS score and identify strengths/gaps between a resume and job.",
        ),
        Tool(
            name="GenerateCoverLetter",
            func=lambda x: "Cover letter generated",
            description="Generate a personalized cover letter for a specific job application.",
        ),
    ]

    prompt = PromptTemplate.from_template(
        "You are the JobHunt AI agent. Help users find matching jobs and prepare applications.\n\n"
        "Available tools: {tools}\nTool names: {tool_names}\n\n"
        "User request: {input}\n\n{agent_scratchpad}"
    )

    agent = create_react_agent(llm, tools, prompt)
    return AgentExecutor(agent=agent, tools=tools, verbose=False, max_iterations=5)