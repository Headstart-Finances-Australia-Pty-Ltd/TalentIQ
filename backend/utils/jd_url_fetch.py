"""
TalentIQ - JD URL Fetcher
============================
Lets a recruiter paste a job-posting URL (Seek, LinkedIn, Indeed,
Greenhouse, Lever, Workday, etc.) instead of copy-pasting or uploading the
JD text. Shared by CVIntel and CandidateLens (both call
fetch_jd_from_url), so a URL is converted to JD text ONE way — the actual
scoring pipeline downstream is completely unchanged and identical between
the two modules either way.

Extraction strategy, in order:
  1. schema.org JobPosting structured data (a <script type="application/
     ld+json"> block with "@type": "JobPosting") — the SEO-standard way
     almost every modern job board (Seek, Indeed, Greenhouse, Lever,
     Workday, SmartRecruiters, and many LinkedIn postings) marks up a job
     page. This is the MOST RELIABLE method where it's present: it gives
     clean title/company/location/description fields directly, with no
     guessing about which part of the page is the JD vs. nav/footer/ads.
  2. Generic heuristic: look for the largest block of text inside common
     job-description containers, after stripping script/style/nav/footer/
     header elements.
  3. If neither yields enough text, return an error asking the person to
     paste the JD text manually — some pages (LinkedIn without being
     logged in, some heavily JS-rendered SPAs) genuinely don't expose
     enough content to a plain server-side fetch, and guessing at
     something that isn't really the JD would be worse than being honest
     about the limitation.

Honest limitations, stated plainly (not hidden):
  - This does a plain HTTP GET + HTML parse — no headless browser, no
    login. Pages that require a login to view (most of LinkedIn's full JD
    text) or render their content entirely client-side via JS with no
    fallback markup will often come back short/empty. LinkLens's existing
    LinkedIn CANDIDATE search (routers/linklens.py) uses a heavier,
    login-based Playwright automation — deliberately NOT reused here,
    since that requires the recruiter's own LinkedIn credentials and
    carries real account-risk/ToS considerations that aren't appropriate
    to invoke just to read a public job description.
  - Respects standard web etiquette: identifies itself with a normal
    browser User-Agent, has a short timeout, and does not retry
    aggressively against a site that's blocking or rate-limiting it.
"""
import ipaddress
import re
import socket
from typing import Optional
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
_FETCH_TIMEOUT_SECONDS = 12
_MIN_USABLE_TEXT_CHARS = 200  # below this, treat as "couldn't really get the JD"


class JDFetchError(Exception):
    """Raised with a message that's safe and useful to show directly to
    the person who pasted the URL (never leaks internals/stack traces)."""
    pass


def _validate_url_is_safe(url: str) -> str:
    """Basic SSRF protection: this fetches a URL the PERSON supplied, from
    the SERVER, on their behalf — without this check, someone could point
    it at http://169.254.169.254/ (cloud metadata endpoints), an internal
    admin panel on the server's own network, or localhost services, and
    use this feature to read data it was never meant to expose. Rejects
    anything that isn't a plain public http(s) URL."""
    try:
        parsed = urlparse(url.strip())
    except Exception:
        raise JDFetchError("That doesn't look like a valid URL.")

    if parsed.scheme not in ("http", "https"):
        raise JDFetchError("Only http:// and https:// URLs are supported.")
    if not parsed.hostname:
        raise JDFetchError("That doesn't look like a valid URL.")

    hostname = parsed.hostname.lower()
    if hostname in ("localhost", "0.0.0.0") or hostname.endswith(".local"):
        raise JDFetchError("That URL points to a local address, which isn't supported.")

    try:
        resolved_ips = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        raise JDFetchError("Couldn't resolve that URL's host — check it's correct.")

    for family, _, _, _, sockaddr in resolved_ips:
        ip_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise JDFetchError("That URL points to a private/internal address, which isn't supported.")

    return url.strip()


def _extract_json_ld_jobposting(soup: BeautifulSoup) -> Optional[dict]:
    """Looks for a schema.org JobPosting in any <script type="application/
    ld+json"> block — handles both a single JobPosting object and a
    @graph/array wrapper, since different site generators structure this
    differently."""
    import json as _json

    for script in soup.find_all("script", {"type": "application/ld+json"}):
        raw = script.string or script.get_text() or ""
        if not raw.strip():
            continue
        try:
            data = _json.loads(raw)
        except Exception:
            continue

        candidates = data if isinstance(data, list) else [data]
        # Some sites wrap it as {"@graph": [...]}
        for c in list(candidates):
            if isinstance(c, dict) and isinstance(c.get("@graph"), list):
                candidates.extend(c["@graph"])

        for item in candidates:
            if not isinstance(item, dict):
                continue
            item_type = item.get("@type")
            type_list = item_type if isinstance(item_type, list) else [item_type]
            if "JobPosting" in type_list:
                return item
    return None


def _html_to_text(html_fragment: str) -> str:
    """JobPosting.description is itself HTML — strip tags but keep
    paragraph/list structure as line breaks, which matters for a JD's
    bullet-pointed responsibilities/requirements sections."""
    frag_soup = BeautifulSoup(html_fragment or "", "html.parser")
    for br in frag_soup.find_all(["br"]):
        br.replace_with("\n")
    for block in frag_soup.find_all(["p", "li", "div", "h1", "h2", "h3", "h4"]):
        block.append("\n")
    text = frag_soup.get_text()
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _generic_extract(soup: BeautifulSoup) -> str:
    """Fallback when no JobPosting structured data is present: strip
    obviously-non-content elements, then take the largest remaining text
    block — a reasonable heuristic for "which part of this page is
    probably the job description" without a full readability algorithm."""
    for tag in soup(["script", "style", "nav", "header", "footer", "noscript", "svg", "form"]):
        tag.decompose()

    # Prefer a plausibly-named JD container if one exists (common patterns
    # across job boards / ATS platforms), before falling back to "biggest
    # text block on the page".
    for selector in [
        {"id": re.compile(r"job.?desc|job.?detail|posting.?desc", re.I)},
        {"class": re.compile(r"job.?desc|job.?detail|posting.?desc", re.I)},
    ]:
        container = soup.find(attrs=selector)
        if container:
            text = container.get_text(separator="\n").strip()
            if len(text) >= _MIN_USABLE_TEXT_CHARS:
                return text

    candidates = soup.find_all(["article", "main", "section", "div"])
    best_text = ""
    for c in candidates:
        text = c.get_text(separator="\n").strip()
        if len(text) > len(best_text):
            best_text = text
    return best_text


async def fetch_jd_from_url(url: str) -> dict:
    """Returns {"jd_text": str, "role": str, "company": str, "location":
    str, "source_url": str, "extraction_method": "structured_data"|
    "heuristic"}. Raises JDFetchError with a person-safe message on
    failure — callers should surface that message directly, not a generic
    500."""
    safe_url = _validate_url_is_safe(url)

    try:
        async with httpx.AsyncClient(
            timeout=_FETCH_TIMEOUT_SECONDS, follow_redirects=True,
            headers={"User-Agent": _USER_AGENT, "Accept-Language": "en-US,en;q=0.9"},
        ) as client:
            resp = await client.get(safe_url)
    except httpx.TimeoutException:
        raise JDFetchError("The job page took too long to respond. Try pasting the JD text directly instead.")
    except httpx.HTTPError as e:
        raise JDFetchError(f"Couldn't reach that URL ({type(e).__name__}). Try pasting the JD text directly instead.")

    if resp.status_code == 403 or resp.status_code == 999:  # 999 = LinkedIn's own bot-block status
        raise JDFetchError(
            "That site blocked automatic access to this page (common for LinkedIn and some job "
            "boards without being logged in). Please copy and paste the JD text directly instead."
        )
    if resp.status_code >= 400:
        raise JDFetchError(f"That URL returned an error (HTTP {resp.status_code}). Please check the link or paste the JD text directly.")

    soup = BeautifulSoup(resp.text, "html.parser")

    jobposting = _extract_json_ld_jobposting(soup)
    if jobposting:
        description_html = jobposting.get("description") or ""
        jd_text = _html_to_text(description_html)
        if len(jd_text) >= _MIN_USABLE_TEXT_CHARS:
            org = jobposting.get("hiringOrganization")
            company = ""
            if isinstance(org, dict):
                company = org.get("name") or ""
            elif isinstance(org, str):
                company = org
            location = ""
            loc = jobposting.get("jobLocation")
            if isinstance(loc, list) and loc:
                loc = loc[0]
            if isinstance(loc, dict):
                addr = loc.get("address")
                if isinstance(addr, dict):
                    location = ", ".join(filter(None, [addr.get("addressLocality"), addr.get("addressRegion"), addr.get("addressCountry")]))
            return {
                "jd_text": jd_text,
                "role": jobposting.get("title") or "",
                "company": company,
                "location": location,
                "source_url": safe_url,
                "extraction_method": "structured_data",
            }

    # Fallback: generic heuristic extraction
    jd_text = _generic_extract(soup)
    if len(jd_text) >= _MIN_USABLE_TEXT_CHARS:
        title_tag = soup.find("title")
        return {
            "jd_text": jd_text,
            "role": (title_tag.get_text().strip() if title_tag else ""),
            "company": "",
            "location": "",
            "source_url": safe_url,
            "extraction_method": "heuristic",
        }

    raise JDFetchError(
        "Couldn't extract enough job description text from that page — it may require login "
        "(common for LinkedIn) or render its content via JavaScript that a simple page fetch "
        "can't see. Please copy and paste the JD text directly instead."
    )
