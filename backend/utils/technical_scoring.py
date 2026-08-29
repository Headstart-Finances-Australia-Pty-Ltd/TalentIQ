"""
TalentIQ - Shared Technical Scoring Engine
=============================================
THIS is the fix for CVIntel and CandidateLens producing different scores
for the same resume/JD pair. Before this module existed, each router had
its OWN separate copy of the skill-matching and scoring logic:

  - CVIntel (routers/cvintel.py):  _compute_weighted_score — a genuinely
    weighted formula bounded by real skills/experience/education match
    percentages (0-100 each), with a small fixed 5-point baseline.
  - CandidateLens (routers/joblens.py): _score_from_verdicts — a
    DIFFERENT formula: essential_pct * 0.75, plus up to +15 for
    good-to-have matches, plus a FLAT +10/+5 regex bonus for merely
    mentioning "degree" or "N years experience" ANYWHERE in the resume
    text — regardless of whether that experience/education actually
    matches what THIS specific JD asked for. That flat, JD-independent
    bonus (+15 combined, awarded to nearly any real resume) is why
    CandidateLens scores ran noticeably higher than CVIntel's for
    identical inputs.

  They also used two SEPARATE JD-extraction functions with two separate
  LLM prompts (CVIntel: llm_extraction.extract_jd_requirements_categorized;
  CandidateLens: its own extract_jd_details) — meaning even the essential
  vs. good-to-have CATEGORIZATION of the same JD could come out
  differently between the two modules before either scored anything.

This module is now the ONLY place technical scoring logic lives. Both
routers call compute_technical_score() with the SAME jd_req shape (from
the SAME extract_jd_requirements_categorized) and the SAME strengths shape
(from the SAME extract_candidate_strengths) — so the same resume/JD pair
now produces the same technical score in both modules, by construction,
not by convention.
"""
import re
from typing import List


# Two kinds of entries, both one-directional (key = the general/JD-style
# term; values = things that, if found in a resume, PROVE the general term
# is satisfied):
#   - true synonyms/abbreviations (AI <-> Artificial Intelligence)
#   - specific technique -> general skill it's a form of (Dimensional
#     Modelling is A KIND OF Data Modeling, so it should count)
# The second category is deliberately curated rather than inferred by
# fuzzy string similarity — inferring "X modeling matches Y modeling" from
# string shape alone is exactly what causes false positives (e.g.
# "financial modeling" and "data modeling" share a word but are unrelated
# skills). Encoding actual verified domain relationships avoids that.
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
    "llm": ["large language model", "large language models", "gpt", "generative ai"],
    "data governance": ["governance framework", "data governance framework",
        "data stewardship", "data catalog", "data cataloguing", "data lineage",
        "data quality framework", "collibra", "alation"],
    "edw": ["enterprise data warehouse"], "enterprise data warehouse": ["edw"],
    "mdm": ["master data management"], "master data management": ["mdm"],
    "data mesh": ["domain-oriented data", "data domain", "data products"],
    "kpi": ["key performance indicator"],
    "ux": ["user experience"], "ui": ["user interface"],
    "qa": ["quality assurance"],
    "pm": ["project management", "project manager"],
    "hr": ["human resources"],
    "crm": ["customer relationship management", "salesforce"],
    "erp": ["enterprise resource planning", "sap", "oracle erp", "netsuite"],
    # ── Data modeling / architecture: specific technique -> general skill ──
    "data modeling": [
        "dimensional modeling", "dimensional model", "data vault",
        "data vault 2.0", "star schema", "snowflake schema",
        "entity relationship modeling", "er modeling", "erd",
        "third normal form", "3nf modeling", "kimball", "inmon",
        "fsldm", "logical data modeling", "physical data modeling",
        "conceptual data modeling", "normalization", "denormalization",
    ],
    "data modelling": ["data modeling"],  # falls through to the US-spelling key above via normalization
    "data architecture": [
        "data mesh", "data fabric", "lakehouse", "data lakehouse",
        "enterprise data warehouse", "edw", "data lake", "data warehouse",
        "solution architecture", "enterprise architecture",
    ],
    "cloud architecture": ["aws", "azure", "gcp", "multi-cloud", "hybrid cloud"],
}

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


def normalize_skill(s: str) -> str:
    s = re.sub(r"\s+", " ", s.strip().lower())
    for pattern, repl in _UK_TO_US_SPELLING:
        s = re.sub(pattern, repl, s)
    return s


def normalize_text(s: str) -> str:
    """Same UK/US spelling normalization as normalize_skill, applied to a
    full block of text (resume/JD) rather than a single skill phrase — both
    sides of a comparison need this or spelling normalization does nothing."""
    s = s.lower()
    for pattern, repl in _UK_TO_US_SPELLING:
        s = re.sub(pattern, repl, s)
    return s


def skill_present(skill: str, candidate_skills: set, resume_lower: str) -> bool:
    """A skill counts as present if any of the following hold — designed to
    catch real-world phrasing variance rather than only an exact match:
      1. it's in the LLM-extracted candidate skill list (allowing either
         side to be a substring of the other, e.g. "python" vs "python 3")
      2. the exact phrase appears literally in the resume text (after
         UK/US spelling normalization on both sides)
      3. a known synonym, abbreviation, or specific-technique-that-implies-
         the-general-skill appears in the resume text (curated list, not
         blind fuzzy matching — see _SKILL_SYNONYMS above for why)
      4. for multi-word skills, all of its significant words appear
         somewhere in the resume (not necessarily contiguous)
      5. (last resort) semantic matching — real embeddings if available,
         else TF-IDF — see utils/embeddings.py and utils/semantic_match.py
    """
    sk = normalize_skill(skill)

    if any(sk in cs or cs in sk for cs in candidate_skills):
        return True

    if sk in resume_lower:
        return True

    for variant in _SKILL_SYNONYMS.get(sk, []):
        if normalize_skill(variant) in resume_lower:
            return True

    words = [w for w in sk.split() if len(w) > 2]
    if len(words) >= 2 and all(w in resume_lower for w in words):
        return True

    from utils.embeddings import embedding_requirement_match
    if embedding_requirement_match(skill, list(candidate_skills)):
        return True

    from utils.semantic_match import semantic_requirement_match
    if semantic_requirement_match(skill, resume_lower, list(candidate_skills)):
        return True

    return False


def _category_coverage(
    essential: List[str], good_to_have: List[str],
    matched: List[str], matched_good: List[str],
    requirement_types: dict,
) -> dict:
    """Cross-tabulates the essential+good-to-have requirements by TYPE
    (technical/tool/domain/qualification/soft_skill — see
    requirement_types, tagged during JD extraction) rather than by TIER.
    Purely a DIAGNOSTIC/DISPLAY breakdown — it does not feed back into
    the composite score, which stays driven by the tier-based
    skills_pct/experience_pct/education_pct/good_to_have_bonus_pct exactly
    as before, so this can't destabilize a score you've already seen.
    Returns {"technical": {"matched": n, "total": m, "pct": x|None}, ...}
    for each of the 5 types — pct is None (not 0) when a JD has zero
    requirements of that type, since "no requirements of this type" isn't
    the same as "candidate has 0% of them"."""
    matched_set = {normalize_skill(s) for s in (matched + matched_good)}
    all_terms = list(dict.fromkeys(essential + good_to_have))  # dedup, preserve order

    categories = ["technical", "tool", "domain", "qualification", "soft_skill"]
    counts = {c: {"matched": 0, "total": 0} for c in categories}

    for term in all_terms:
        term_type = requirement_types.get(normalize_skill(term))
        if term_type not in categories:
            continue  # untagged/unrecognized type — excluded from this diagnostic view, not from the actual score
        counts[term_type]["total"] += 1
        if normalize_skill(term) in matched_set:
            counts[term_type]["matched"] += 1

    breakdown = {}
    for c in categories:
        total = counts[c]["total"]
        matched_n = counts[c]["matched"]
        breakdown[c] = {
            "matched": matched_n,
            "total": total,
            "pct": round(matched_n / total * 100) if total else None,
        }
    return breakdown


def compute_technical_score(jd_req: dict, strengths: dict, resume: str, weights: dict) -> dict:
    """The technical track's score, used identically by CVIntel and
    CandidateLens (see this module's docstring for why that wasn't true
    before). jd_req and strengths both come from the shared
    utils/llm_extraction.py functions (extract_jd_requirements_categorized
    and extract_candidate_strengths respectively) — same shape, same
    extraction prompts, in both callers.

    Weights (from utils.scoring.merge_weights) default to tech_core_skills
    60% / tech_experience 25% / tech_education 10% / tech_good_to_have 5%,
    plus a fixed 5-point baseline content-depth allowance not exposed as a
    slider since it isn't a recruiter-meaningful lever.
    """
    resume_lower = normalize_text(resume)
    candidate_skill_set = {
        normalize_skill(s) for s in
        (strengths.get("technical_skills", []) + strengths.get("business_skills", []))
    }

    essential = [s for s in jd_req.get("essential", []) if s]
    good_to_have = [s for s in jd_req.get("good_to_have", []) if s]

    if "essential_matched" in strengths or "essential_missing" in strengths:
        matched = strengths.get("essential_matched", [])
        missing = strengths.get("essential_missing", [])
        matched_good = strengths.get("good_to_have_matched", [])
    else:
        matched = [s for s in essential if skill_present(normalize_skill(s), candidate_skill_set, resume_lower)]
        missing = [s for s in essential if s not in matched]
        matched_good = [s for s in good_to_have if skill_present(normalize_skill(s), candidate_skill_set, resume_lower)]

    skills_pct = round(len(matched) / len(essential) * 100) if essential else 70

    min_years = jd_req.get("min_years_experience") or 0
    cand_years = strengths.get("years_experience") or 0
    if min_years <= 0:
        experience_pct = 85
    else:
        experience_pct = max(20, min(100, round(cand_years / min_years * 100)))

    edu_req = (jd_req.get("education_requirement") or "").lower()
    edu_cand = (strengths.get("education") or "").lower()
    if not edu_req:
        education_pct = 90
    elif edu_cand and (edu_cand in edu_req or edu_req in edu_cand or
                        any(w in edu_cand for w in ["bachelor", "master", "phd", "degree", "diploma"] if w in edu_req)):
        education_pct = 100
    else:
        education_pct = 45

    good_to_have_bonus_pct = min(100, len(matched_good) * 25) if good_to_have else 60
    # Genuine good-to-have COVERAGE % (distinct from good_to_have_bonus_pct
    # above, which is a capped bonus curve used only inside the composite
    # formula) — this is what's shown in the breakdown as "Good to Have %".
    good_to_have_pct = round(len(matched_good) / len(good_to_have) * 100) if good_to_have else None

    category_breakdown = _category_coverage(
        essential, good_to_have, matched, matched_good, jd_req.get("requirement_types", {}),
    )

    tech_w_sum = (
        weights["tech_core_skills"] + weights["tech_experience"] +
        weights["tech_education"] + weights["tech_good_to_have"]
    ) or 1.0
    overall = (
        skills_pct * (weights["tech_core_skills"] / tech_w_sum) * 0.95 +
        experience_pct * (weights["tech_experience"] / tech_w_sum) * 0.95 +
        education_pct * (weights["tech_education"] / tech_w_sum) * 0.95 +
        good_to_have_bonus_pct * (weights["tech_good_to_have"] / tech_w_sum) * 0.95 +
        75 * 0.05
    )
    overall = max(8, min(98, round(overall)))

    return {
        "overall": overall,
        "skills_pct": skills_pct,
        "experience_pct": experience_pct,
        "education_pct": education_pct,
        "matched": matched,
        "missing": missing,
        "matched_good_to_have": matched_good,
        # ── Full score breakdown for display ────────────────────────────
        # essential_pct/good_to_have_pct/qualification_pct are genuine
        # coverage percentages (not the capped/curved values used inside
        # the composite formula above); category_breakdown cross-tabulates
        # the SAME essential+good-to-have requirements by type instead of
        # by tier. None of this changes "overall" — it's a transparency
        # layer on top of the existing score.
        "essential_pct": skills_pct,
        "good_to_have_pct": good_to_have_pct,
        "qualification_pct": education_pct,
        "category_breakdown": category_breakdown,
    }
