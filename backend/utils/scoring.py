"""
TalentIQ - Dual-Track Scoring Engine
=====================================
Shared by CVIntel (routers/cvintel.py) and CandidateLens (routers/joblens.py)
so both modules score candidates the SAME way rather than maintaining two
divergent formulas.

Closes a specific gap: previously, "overall match" was a single blended
number (skills + experience + education) with NO separate accounting for
non-technical / logistics fit (salary expectation vs budget, notice period
vs hiring urgency, location/remote fit) — and the weights that produced
that number were hardcoded in Python, invisible and non-adjustable by the
recruiter using the product.

This module:
  1. Computes a NON-TECHNICAL score from JD logistics constraints
     (salary_budget_min/max, max_notice_days, remote_allowed/location)
     against candidate-stated logistics (expected_salary, notice_period_days,
     current_location) — entirely independent of the technical/skills score.
  2. Supports HARD DISQUALIFIERS — a candidate whose notice period exceeds
     the JD's stated maximum, or whose expected salary is far outside
     budget, is flagged regardless of how strong their technical score is,
     mirroring how a real recruiter would triage.
  3. Supports DYNAMIC, RECRUITER-ADJUSTABLE WEIGHTS for combining the two
     tracks into one composite score — passed in per-request/per-session
     rather than fixed in code. Falls back to sensible defaults so every
     existing caller keeps working unchanged if it passes no weights.
  4. Is pure Python / no LLM calls — so re-weighting an already-scored
     candidate (or a whole session) is instant and free, enabling a
     real-time "move the slider, see rankings change" UI.
"""
from typing import Optional


# ── DEFAULT WEIGHTS ──────────────────────────────────────────────────────
# Every weight is 0-1 and each group sums to 1.0. Callers may override any
# subset; missing keys fall back to these defaults (see merge_weights).
DEFAULT_WEIGHTS = {
    # Track-level split: how much the composite score leans on technical
    # fit vs. non-technical/logistics fit.
    "technical_overall": 0.70,
    "non_technical_overall": 0.30,

    # Within the technical track (must sum to 1.0)
    "tech_core_skills": 0.60,      # essential skill coverage
    "tech_experience": 0.25,       # years-of-experience fit
    "tech_education": 0.10,        # education requirement fit
    "tech_good_to_have": 0.05,     # bonus/nice-to-have coverage

    # Within the non-technical track (must sum to 1.0)
    "nontech_salary": 0.40,        # expected salary vs. JD budget
    "nontech_notice": 0.35,        # notice period vs. JD's max acceptable
    "nontech_location": 0.25,      # location/remote fit
}

# Hard-disqualifier thresholds — also overridable per request.
DEFAULT_DISQUALIFIERS = {
    "enabled": True,
    "notice_hard_limit": True,       # reject if notice_days > jd.max_notice_days
    "salary_overrun_pct": 25,        # reject if expected_salary > budget_max by more than this %
}


def merge_weights(overrides: Optional[dict]) -> dict:
    """Returns DEFAULT_WEIGHTS with any caller-supplied overrides applied.
    Never mutates DEFAULT_WEIGHTS. Silently ignores unknown keys so a
    slightly-stale frontend payload can't crash scoring."""
    w = dict(DEFAULT_WEIGHTS)
    if overrides:
        for k, v in overrides.items():
            if k in w and isinstance(v, (int, float)):
                w[k] = max(0.0, float(v))
    return w


def merge_disqualifiers(overrides: Optional[dict]) -> dict:
    d = dict(DEFAULT_DISQUALIFIERS)
    if overrides:
        for k, v in overrides.items():
            if k in d:
                d[k] = v
    return d


# ── NON-TECHNICAL SUB-SCORES ─────────────────────────────────────────────

def compute_salary_score(expected_salary: int, budget_min: int, budget_max: int) -> Optional[float]:
    """Returns 0-100, or None if there isn't enough data on either side to
    judge (no budget stated, or candidate didn't state an expectation) —
    callers should treat None as "not applicable" and re-normalize
    remaining sub-weights, not as a zero/penalty."""
    if not expected_salary or not budget_max:
        return None
    if expected_salary <= budget_max:
        # At or under budget ceiling scores highest; reward being well
        # under the ceiling slightly less steeply than being over it.
        if budget_min and expected_salary < budget_min:
            # Below the stated floor is usually fine (still a full match)
            # but flagged softly in case it signals a level mismatch.
            return 95.0
        return 100.0
    # Over budget: linear falloff, floored at 0.
    overrun_pct = (expected_salary - budget_max) / budget_max * 100
    return max(0.0, round(100 - overrun_pct * 2, 1))


def compute_notice_score(notice_days: int, max_notice_days: int) -> Optional[float]:
    """notice_days == -1 means 'not stated' (see llm_extraction.py) —
    distinct from 0, which means 'immediately available'."""
    if notice_days is None or notice_days < 0 or not max_notice_days:
        return None
    if notice_days <= max_notice_days:
        return 100.0
    # Linear falloff beyond the acceptable window, floored at 20 (matches
    # the spirit of the previous single-track scorer's floor for a
    # "late but not disqualifying" candidate when disqualifiers are off).
    over_days = notice_days - max_notice_days
    return max(20.0, round(100 - (over_days / max_notice_days) * 80, 1))


def compute_location_score(candidate_location: str, jd_location: str, remote_allowed: bool) -> Optional[float]:
    if remote_allowed:
        return 100.0
    if not candidate_location or not jd_location:
        return None
    cl, jl = candidate_location.strip().lower(), jd_location.strip().lower()
    if not cl or not jl:
        return None
    if cl == jl or cl in jl or jl in cl:
        return 100.0
    # Different stated locations, remote not offered — a genuine logistics
    # gap, but not necessarily disqualifying (relocation is possible).
    return 45.0


def compute_non_technical_score(logistics: dict, weights: dict) -> dict:
    """logistics = {
        expected_salary, notice_period_days, current_location,   # candidate
        salary_budget_min, salary_budget_max, max_notice_days,   # JD
        jd_location, remote_allowed,
    }
    Returns {"score": float, "salary_score": float|None,
             "notice_score": float|None, "location_score": float|None,
             "applicable": bool}  — applicable=False means NO logistics
    data was available on either side, so the composite formula should
    lean entirely on the technical score (see compute_composite_score).
    """
    salary_score = compute_salary_score(
        logistics.get("expected_salary") or 0,
        logistics.get("salary_budget_min") or 0,
        logistics.get("salary_budget_max") or 0,
    )
    notice_score = compute_notice_score(
        logistics.get("notice_period_days", -1),
        logistics.get("max_notice_days") or 0,
    )
    location_score = compute_location_score(
        logistics.get("current_location") or "",
        logistics.get("jd_location") or "",
        bool(logistics.get("remote_allowed")),
    )

    parts = [
        (salary_score, weights["nontech_salary"]),
        (notice_score, weights["nontech_notice"]),
        (location_score, weights["nontech_location"]),
    ]
    known = [(s, w) for s, w in parts if s is not None]
    if not known:
        return {
            "score": None, "salary_score": None, "notice_score": None,
            "location_score": None, "applicable": False,
        }
    total_w = sum(w for _, w in known) or 1.0
    score = round(sum(s * (w / total_w) for s, w in known), 1)
    return {
        "score": score, "salary_score": salary_score, "notice_score": notice_score,
        "location_score": location_score, "applicable": True,
    }


def check_hard_disqualifiers(logistics: dict, disqualifiers: dict) -> tuple[bool, Optional[str]]:
    """Returns (is_disqualified, reason). Pure business-rule check, runs
    independent of and in addition to the score — a candidate can score
    well but still be hard-disqualified (e.g. 95% skills match but a
    120-day notice period against a 30-day maximum)."""
    if not disqualifiers.get("enabled", True):
        return False, None

    notice_days = logistics.get("notice_period_days", -1)
    max_notice = logistics.get("max_notice_days") or 0
    if disqualifiers.get("notice_hard_limit") and max_notice and notice_days is not None and notice_days > max_notice:
        return True, f"Notice period ({notice_days}d) exceeds the role's maximum ({max_notice}d)"

    expected_salary = logistics.get("expected_salary") or 0
    budget_max = logistics.get("salary_budget_max") or 0
    overrun_limit_pct = disqualifiers.get("salary_overrun_pct", 25)
    if expected_salary and budget_max:
        overrun_pct = (expected_salary - budget_max) / budget_max * 100
        if overrun_pct > overrun_limit_pct:
            return True, (
                f"Expected salary is {overrun_pct:.0f}% over budget "
                f"(limit: {overrun_limit_pct}%)"
            )

    return False, None


def compute_composite_score(technical_score: float, non_technical: dict, weights: dict) -> float:
    """final = tech_score * W_tech + non_tech_score * W_nontech
    — the same formula RevaMatrix-AI's spec documents, made concrete here.
    If no logistics data was available at all (non_technical["applicable"]
    is False), the composite collapses to the technical score alone rather
    than silently multiplying by a non-technical score of 0 — an unscored
    dimension should not be treated as a failed one."""
    if not non_technical.get("applicable"):
        return round(technical_score, 1)
    w_tech = weights["technical_overall"]
    w_nontech = weights["non_technical_overall"]
    total_w = (w_tech + w_nontech) or 1.0
    composite = (technical_score * w_tech + non_technical["score"] * w_nontech) / total_w
    return round(composite, 1)
