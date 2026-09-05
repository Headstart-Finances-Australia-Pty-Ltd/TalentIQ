"""
TalentIQ - ResumeCraft Agent
============================
Generates a tailored, industry-standard resume and a matching cover
letter for ONE specific job application.

Deliberately consumes the SAME match analysis CVAnalysis already computed
(matched/missing skills, extracted JD requirements, candidate profile —
see routers/cvintel.py's CVAnalysisRecord.result) rather than
re-extracting anything itself. That keeps "why this resume/letter looks
the way it does" and "why this candidate scored the way they did"
answerable from the exact same underlying analysis, instead of two
LLM calls quietly drifting apart on what the candidate's strengths and
gaps actually are.

Two independent generation calls (resume, cover letter) rather than one
combined prompt: they have different structured-output requirements
(strict JSON schema vs. free-form letter prose), different ideal
temperatures (lower for the resume's factual restructuring, slightly
higher for the letter's tone), and a failure in one must not blank out
the other.

Both functions degrade gracefully with a non-LLM fallback when no Groq
key is configured, mirroring generate_cover_letter()'s fallback pattern
in agents/jobhunt_agent.py — the feature stays usable (as a manually
fillable skeleton) rather than hard-failing.
"""
import json
import re
from typing import Optional

from utils.credentials import DEFAULT_GROQ_MODEL

try:
    from langchain_groq import ChatGroq
    _GROQ_AVAILABLE = True
except ImportError:
    _GROQ_AVAILABLE = False
    ChatGroq = None


# ── Structured resume schema ────────────────────────────────────────────
# Every template renderer (frontend preview + backend docx export) reads
# this exact shape. Keep any field additions backward compatible (new
# fields optional, renderers must tolerate missing keys).
RESUME_SCHEMA_HINT = """{
  "full_name": "", "headline": "", "email": "", "phone": "", "location": "",
  "linkedin": "", "portfolio": "",
  "summary": "3-5 sentence professional summary tailored to the target role, descriptive enough to stand alone",
  "core_skills": ["skill1", "skill2"],
  "experience": [
    {"job_title": "", "company": "", "location": "", "start_date": "", "end_date": "",
     "bullets": ["descriptive, achievement-oriented bullet, quantified where the source resume allows it"]}
  ],
  "education": [
    {"degree": "", "institution": "", "location": "", "year": "", "details": ""}
  ],
  "certifications": ["certification name"],
  "projects": [{"name": "", "description": ""}],
  "gap_fixes": ["one short sentence per CVAnalysis gap that was addressed, and how — empty array if none were addressable"]
}"""

EMPTY_RESUME_DATA = {
    "full_name": "", "headline": "", "email": "", "phone": "", "location": "",
    "linkedin": "", "portfolio": "", "summary": "", "core_skills": [],
    "experience": [], "education": [], "certifications": [], "projects": [],
    "gap_fixes": [],
}


def _extract_json(raw: str) -> Optional[dict]:
    """Same tolerant-parse approach as utils/llm_extraction._parse_json_response:
    strip code fences, try straight json.loads, fall back to pulling out
    the first {...} block if the model added any stray prose."""
    if not raw:
        return None
    cleaned = raw.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                return None
    return None


def _llm(groq_key: str, groq_model: str, temperature: float):
    return ChatGroq(
        api_key=groq_key, model=groq_model, temperature=temperature,
        max_tokens=4000, reasoning_format="hidden", reasoning_effort="low", max_retries=0,
    )


def _fallback_resume_data(resume_text: str, candidate_profile: dict) -> dict:
    """No-successful-AI-call fallback: a minimal structured skeleton
    pre-filled with whatever CVAnalysis already extracted, so the builder
    still opens with something real to edit. Deliberately does NOT stuff
    any explanatory text into `summary` or any other resume field —
    anything written there would otherwise get baked into the actual
    downloaded resume. The reason for the fallback belongs in the
    `ai_error` field alone, which the frontend shows in a dismissible
    banner, never inside the document content itself."""
    data = dict(EMPTY_RESUME_DATA)
    data["full_name"] = (candidate_profile or {}).get("name") or ""
    data["location"] = (candidate_profile or {}).get("location") or ""
    data["core_skills"] = (candidate_profile or {}).get("skills") or []
    return data


def _fallback_cover_letter(candidate_name: str, job_title: str, company_name: str) -> str:
    """Same principle as _fallback_resume_data: a clean, generic,
    SEND-SAFE letter with no bracketed instructions or references to
    Groq/API keys baked into the body \u2014 a person could plausibly forget
    to edit a placeholder before sending it, so internal/admin-facing
    explanations must never live here. That context goes in `ai_error`
    instead."""
    return (
        f"Dear Hiring Manager,\n\n"
        f"I am writing to express my interest in the {job_title or '[Job Title]'} role "
        f"at {company_name or '[Company Name]'}. Based on my background, I believe I "
        f"would be a strong contributor to your team.\n\n"
        f"[Add 2-3 sentences here on your relevant experience and why you're a fit for this role.]\n\n"
        f"I would welcome the opportunity to discuss how my experience aligns with "
        f"your needs.\n\n"
        f"Sincerely,\n{candidate_name or '[Your Name]'}"
    )


_NO_KEY_MESSAGE = (
    "No Groq API key is currently available for your account (checked your personal key, "
    "the shared Groq key pool, and the legacy global key in Admin Console \u2192 API Keys). "
    "The sections below are a blank editable template \u2014 fill them in manually, or ask an "
    "admin to add/check a key in the Groq Key Pool and regenerate."
)


def _call_failed_message(detail: Optional[str] = None) -> str:
    return (
        "AI generation hit an error and a blank editable template was used instead \u2014 "
        "this wasn't a missing API key. Edit the sections below manually, or click Generate "
        "again to retry."
        + (f" ({detail})" if detail else "")
    )


# ── Missed-qualification safety net ─────────────────────────────────────
# The LLM restructures/reprioritizes content, and occasionally drops a
# real line it should have kept (most often a certification or degree
# buried near the end of a long resume). Since we can't guarantee the
# model never does this, this heuristic double-checks its own output
# afterwards: scan the SOURCE resume for lines that look like a
# qualification/credential, then confirm each one is reflected somewhere
# in the generated content. Anything that isn't gets surfaced as a
# warning so the person can verify and re-add it manually, rather than
# it silently vanishing.
_CREDENTIAL_LINE_RE = re.compile(
    r"\b(bachelor|master|associate degree|diploma|ph\.?d|doctorate|"
    r"b\.?sc\b|m\.?sc\b|b\.?a\b|m\.?a\b|b\.?e\b|b\.?tech|m\.?tech|mba|"
    r"certificat|certified|licen[sc]e|accreditation|"
    r"pmp\b|cpa\b|cfa\b|scrum master|six sigma|itil\b|cissp\b|cisa\b|ccna\b|ccnp\b|"
    r"aws certified|azure.{0,15}certified|google.{0,15}certified|comptia)",
    re.IGNORECASE,
)
_CREDENTIAL_STOPWORDS = {
    "the", "and", "with", "from", "for", "this", "that", "have", "were", "was",
    "your", "you", "are", "will", "our",
}


def _dedupe_preserve_order(items):
    seen = set()
    out = []
    for item in items:
        key = item.lower()
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out





def _find_credential_lines(resume_text: str):
    lines = []
    for raw_line in (resume_text or "").split("\n"):
        line = raw_line.strip(" \t\u2022-*").strip()
        if not line or not (4 < len(line) < 160):
            continue
        # Skip bare section headers ("CERTIFICATIONS", "EDUCATION") — all
        # caps, no digits, short — which would otherwise match the regex
        # on the section-name word alone and produce a useless
        # "did you drop this line" false positive for the header itself.
        if line.isupper() and len(line.split()) <= 3:
            continue
        if _CREDENTIAL_LINE_RE.search(line):
            lines.append(line)
    return _dedupe_preserve_order(lines)


def _check_missed_qualifications(resume_text: str, resume_data: dict):
    """Returns up to 6 lines from the source resume that look like a
    qualification/credential but don't clearly appear anywhere in the
    generated resume_data — a heuristic nudge, not a guarantee (it can
    both miss real omissions and flag false positives), but a useful
    safety net given an LLM restructuring the whole document at once."""
    credential_lines = _find_credential_lines(resume_text)
    if not credential_lines:
        return []

    haystack_parts = [resume_data.get("summary") or ""]
    haystack_parts += resume_data.get("certifications") or []
    for edu in resume_data.get("education") or []:
        haystack_parts.append(" ".join(str(v) for v in edu.values() if v))
    for job in resume_data.get("experience") or []:
        haystack_parts.extend(job.get("bullets") or [])
    haystack = " ".join(haystack_parts).lower()

    missed = []
    for line in credential_lines:
        tokens = [
            t for t in re.findall(r"[A-Za-z][A-Za-z.+#]{2,}", line)
            if t.lower() not in _CREDENTIAL_STOPWORDS
        ]
        if tokens and not any(t.lower() in haystack for t in tokens):
            missed.append(line[:120])
    return missed[:6]


async def generate_tailored_resume(
    resume_text: str,
    jd_text: str,
    job_title: str,
    company_name: str,
    cv_result: dict,
    groq_key: Optional[str],
    groq_model: str = DEFAULT_GROQ_MODEL,
) -> dict:
    """Returns a dict matching RESUME_SCHEMA_HINT's shape plus
    `ai_powered` (bool) and, on a failed/skipped LLM call, `ai_error` /
    a note inside `summary` explaining why it's a blank skeleton."""
    cv_result = cv_result or {}
    matched = cv_result.get("matchedSkills") or []
    missing = cv_result.get("missingSkills") or []
    jd_req = cv_result.get("jdRequirements") or {}
    candidate_profile = cv_result.get("candidateProfile") or {}

    if groq_key and _GROQ_AVAILABLE:
        try:
            llm = _llm(groq_key, groq_model, temperature=0.4)
            prompt = f"""You are an expert resume writer who follows current, ATS-safe, reverse-chronological resume best practice. Rewrite/restructure the candidate's EXISTING resume below into a DESCRIPTIVE, fully-detailed version TAILORED for one specific job, using the match analysis TalentIQ's CVAnalysis already computed.

TARGET ROLE: {job_title or "the target role"} at {company_name or "the target company"}

JOB DESCRIPTION (may be truncated):
{(jd_text or "")[:8000]}

CVANALYSIS MATCH ANALYSIS (already computed \u2014 use it, do not re-derive it):
- Matched/strength skills to emphasize: {json.dumps(matched)[:2000]}
- Missing/gap skills identified by CVAnalysis: {json.dumps(missing)[:1000]}
- Extracted JD requirements: {json.dumps(jd_req)[:2000]}
- Candidate profile as extracted: {json.dumps(candidate_profile)[:1000]}

CANDIDATE'S EXISTING RESUME TEXT \u2014 this is the ONLY source of truth for facts (contact details, employers, dates, degrees, certifications). This is the FULL resume, start to finish \u2014 read ALL of it before writing anything. Education, Certifications, Qualifications, and Licenses sections are very often placed near the END of a resume; do not stop reading after the work-experience section, and do not let anything in those later sections go missing:
{(resume_text or "")[:20000]}

Rules:
1. EXTRACT EVERY REAL DETAIL from the ENTIRE resume text above, beginning to end: full name, email, phone, location/address, LinkedIn/portfolio if present, EVERY job in their work history (not just the most recent one or two), EVERY education entry, and EVERY certification/license/qualification mentioned anywhere \u2014 including any near the bottom of the document. Do not leave a field blank or an entry out if the source resume contains it. Before finalizing, re-scan the source text specifically for degree names, certification names, and license names, and confirm each one appears somewhere in your output.
2. NEVER invent employers, dates, degrees, certifications, or skills the candidate doesn't actually have anywhere in their resume text. Only reorganize, rephrase, re-prioritize, and elaborate on REAL content \u2014 never fabricate a new fact.
3. Write DESCRIPTIVE bullets: lead with a strong action verb, explain what was done, how, and the outcome/impact \u2014 not terse fragments. Quantify wherever the source resume allows it (numbers, %, scale); do not invent numbers that aren't implied by the source text.
4. GAP-CLOSING (this is important): for each missing/gap skill CVAnalysis identified, re-read the candidate's actual resume text looking for real, adjacent, or transferable experience that relates to it. Where genuine evidence exists, REPHRASE that existing bullet using the JD's own terminology so the ATS/recruiter can see the match (e.g. if the gap is "containerization" and the resume already mentions "used Docker to package the app," rewrite it as "Containerized the application using Docker" so the keyword is explicit). Where NO genuine evidence exists anywhere in the resume, do not touch that gap \u2014 leave it alone rather than fabricate.
5. For every gap you were able to address this way, add one short sentence to "gap_fixes" describing what you changed and why (e.g. "Rephrased your Docker/CI experience under Acme Corp to explicitly mention 'containerization', addressing the gap CVAnalysis flagged"). If a gap could NOT be addressed because the resume has no genuine related experience, do not mention it in gap_fixes at all. Return an empty array if no gaps were addressable.
6. Prioritize and foreground the experience/skills that match the job's essential requirements; de-emphasize (don't delete) less relevant history.
7. Write a tailored 3-5 sentence professional summary aimed at this exact role, descriptive enough to stand alone.
8. Output ONLY one JSON object, no prose before or after, matching EXACTLY this shape (omit no keys; use empty string/array if unknown):
{RESUME_SCHEMA_HINT}
"""
            response = llm.invoke(prompt).content
            data = _extract_json(response)
            if data:
                merged = dict(EMPTY_RESUME_DATA)
                merged.update({k: v for k, v in data.items() if k in EMPTY_RESUME_DATA})
                merged["ai_powered"] = True
                merged["groq_model"] = groq_model
                missed = _check_missed_qualifications(resume_text, merged)
                if missed:
                    merged["completeness_warning"] = (
                        "These lines from your uploaded resume don't clearly appear in the generated "
                        "resume below \u2014 double-check nothing was dropped, and add back anything missing: "
                        + " | ".join(missed)
                    )
                return merged
            fallback = _fallback_resume_data(resume_text, candidate_profile)
            fallback["ai_powered"] = False
            fallback["ai_error"] = _call_failed_message("model response wasn't valid JSON")
            return fallback
        except Exception as e:
            fallback = _fallback_resume_data(resume_text, candidate_profile)
            fallback["ai_powered"] = False
            fallback["ai_error"] = _call_failed_message(str(e))
            return fallback

    fallback = _fallback_resume_data(resume_text, candidate_profile)
    fallback["ai_powered"] = False
    fallback["ai_error"] = _NO_KEY_MESSAGE
    return fallback


async def generate_tailored_cover_letter(
    resume_text: str,
    jd_text: str,
    job_title: str,
    company_name: str,
    candidate_name: str,
    cv_result: dict,
    groq_key: Optional[str],
    groq_model: str = DEFAULT_GROQ_MODEL,
) -> dict:
    """Returns {"body": str, "ai_powered": bool, "groq_model"?: str, "ai_error"?: str}."""
    cv_result = cv_result or {}
    matched = cv_result.get("matchedSkills") or []
    jd_req = cv_result.get("jdRequirements") or {}

    if groq_key and _GROQ_AVAILABLE:
        try:
            llm = _llm(groq_key, groq_model, temperature=0.5)
            prompt = f"""Write a professional, ATS-friendly cover letter in standard business-letter format for {candidate_name or "the candidate"}, applying for the {job_title or "advertised"} role at {company_name or "the company"}.

Use these REAL matched strengths (from TalentIQ's CVAnalysis analysis) to justify fit \u2014 do not invent achievements the resume doesn't support:
Matched strengths: {json.dumps(matched)[:1500]}
Key JD requirements: {json.dumps(jd_req)[:1500]}

Resume for reference (may be truncated):
{(resume_text or "")[:12000]}

Structure, 4 short paragraphs, under 350 words total:
1. Opening \u2014 role, company, one-line hook.
2. Why they fit \u2014 2-3 concrete matched strengths tied to the JD's stated requirements.
3. Additional value / genuine motivation for this company \u2014 brief, specific, not generic flattery.
4. Closing \u2014 call to action, thanks.

Return ONLY the letter body text \u2014 no JSON, no markdown, no bracket placeholders. Start with 'Dear Hiring Manager,' unless a named contact is given."""
            body = llm.invoke(prompt).content.strip()
            if body:
                return {"body": body, "ai_powered": True, "groq_model": groq_model}
        except Exception as e:
            return {
                "body": _fallback_cover_letter(candidate_name, job_title, company_name),
                "ai_powered": False, "ai_error": _call_failed_message(str(e)),
            }

    return {
        "body": _fallback_cover_letter(candidate_name, job_title, company_name),
        "ai_powered": False,
        "ai_error": _NO_KEY_MESSAGE,
    }
