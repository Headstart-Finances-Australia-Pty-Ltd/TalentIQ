"""
TalentIQ - Skills Assessment Agent
==================================
Three independent AI responsibilities, kept separate because they run at
different times and answer different questions:

  1. generate_ai_questions()   — expert/admin-triggered, ahead of time,
     fills the question BANK (not a live per-candidate call).
  2. grade_short_answer()      — runs once per short-answer response, at
     submission time, comparing the candidate's free-text answer against
     the question's expert/AI-written grading guideline.
  3. generate_overall_evaluation() — runs once per completed sitting,
     after every individual answer is graded, to produce the single
     recruiter-facing verdict + reasoning stored on TestAssignment.

Plus one NON-AI piece:
  4. build_question_set()      — pure Python. Assembles a randomized,
     time-budgeted mix of questions from the bank for one candidate's
     sitting. Deliberately not an LLM call: which questions to serve is a
     scheduling/sampling problem (respect the 60-minute budget, split
     MCQ/short-answer time, vary category and difficulty), not a
     judgment call — an LLM would be slower, non-deterministic, and
     harder to guarantee actually fits the time budget.

Question variation across candidates comes from two places working
together: build_question_set() randomly samples a different subset (and
order) from the bank per candidate, and generate_ai_questions() is meant
to be run several times per skill/topic to seed the bank with multiple
differently-phrased questions on the same underlying concept — so two
candidates drawing from a well-stocked bank are unlikely to see identical
questions even for the same role.
"""
import json
import random
import re
from typing import Optional

from utils.credentials import DEFAULT_GROQ_MODEL

try:
    from langchain_groq import ChatGroq
    _GROQ_AVAILABLE = True
except ImportError:
    _GROQ_AVAILABLE = False
    ChatGroq = None


def _extract_json(raw: str):
    if not raw:
        return None
    cleaned = raw.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"[\{\[].*[\}\]]", cleaned, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                return None
    return None


def _llm(groq_key: str, groq_model: str, temperature: float, max_tokens: int = 3000):
    return ChatGroq(
        api_key=groq_key, model=groq_model, temperature=temperature,
        max_tokens=max_tokens, reasoning_format="hidden", reasoning_effort="low", max_retries=0,
    )


# Default time budget per question, used to seed new questions (editable
# afterwards per-question if one runs long/short in practice).
DEFAULT_ESTIMATED_SECONDS = {"mcq": 75, "short_answer": 210}


async def generate_ai_questions(
    category: str,
    skill_tag: str,
    difficulty: str,
    question_type: str,
    count: int,
    groq_key: Optional[str],
    groq_model: str = DEFAULT_GROQ_MODEL,
    jd_title: str = "",
    jd_text: str = "",
    jd_skills: Optional[list] = None,
    aptitude_subtype: Optional[str] = None,
) -> list:
    """Returns a list of dicts, each matching TestQuestion's fields
    (question_text, options/correct_option_index for mcq, or
    grading_guideline for short_answer). Raises RuntimeError if no key is
    configured or the model call fails — question generation is an
    explicit admin action with a visible button, not a silent background
    fallback, so surfacing the failure directly is more honest than
    quietly returning fewer/placeholder questions.

    jd_text/jd_skills are REQUIRED in practice (routers/skillstest.py's
    /questions/generate-ai always resolves them from a real JDRecord
    before calling this) so every AI-generated question is grounded in
    the actual job it's meant to screen for, not a generic guess at what
    a question for this role should look like in the abstract.

    Each of the four categories in TEST_CATEGORIES gets genuinely
    DIFFERENT prompt framing below, not just a relabeled generic
    question — a cognitive_aptitude question is a timed reasoning puzzle,
    a personality_psychometric one is a workplace-preference/style
    question with no objectively "wrong" answer being tested for
    knowledge, a situational_judgment one is a scenario + "what would you
    do", and skills_proficiency is the closest to a traditional
    knowledge/coding question. aptitude_subtype (numerical/verbal/
    abstract/logical) is REQUIRED for cognitive_aptitude and ignored
    otherwise — see TEST_APTITUDE_SUBTYPES in models.py.
    """
    if not (groq_key and _GROQ_AVAILABLE):
        raise RuntimeError(
            "No Groq API key is available (personal key, shared pool, or global fallback) — "
            "add one in Settings / Admin Console \u2192 API Keys, then try generating again."
        )
    if not jd_text.strip():
        raise RuntimeError("A job description is required to generate aligned questions — select one first.")
    if category == "cognitive_aptitude" and not aptitude_subtype:
        raise RuntimeError("Pick a reasoning type (numerical, verbal, abstract, or logical) for cognitive aptitude questions.")

    count = max(1, min(count, 20))
    is_mcq = question_type == "mcq"

    category_framing = {
        "cognitive_aptitude": (
            f"a {aptitude_subtype.upper() if aptitude_subtype else ''} REASONING question in the style of a "
            f"professional cognitive aptitude/psychometric test (like those used in graduate/professional hiring "
            f"assessments). This measures raw problem-solving speed and learning potential, NOT job knowledge — "
            f"{'a numerical reasoning question uses data/numbers/ratios/sequences to interpret and calculate' if aptitude_subtype == 'numerical' else ''}"
            f"{'a verbal reasoning question tests reading comprehension and logical inference from a short passage or statement' if aptitude_subtype == 'verbal' else ''}"
            f"{'an abstract reasoning question uses shapes/patterns/sequences with no language or numbers, testing pure pattern recognition (describe the pattern in text since this is a text-only format)' if aptitude_subtype == 'abstract' else ''}"
            f"{'a logical reasoning question presents premises/rules and asks what must follow, or spot the flaw in an argument' if aptitude_subtype == 'logical' else ''}"
            f". Do NOT test knowledge of the role's tools or domain \u2014 test raw reasoning ability, using the role's context only as flavor/setting for the puzzle."
        ),
        "personality_psychometric": (
            "a PERSONALITY/PSYCHOMETRIC question measuring character traits, soft skills, or motivational drivers "
            "relevant to cultural fit for this role \u2014 e.g. a workplace-preference statement ('I prefer to double-check "
            "my own work before submitting it' \u2014 agree/disagree style, reframed as 4 options ranging across a trait "
            "spectrum) or a self-report scenario about work style/motivation. There is NOT a single objectively "
            "'correct' answer being tested for knowledge here \u2014 for MCQ, write 4 genuinely different behavioral "
            "responses and mark the one that best reflects the trait/motivation this role's JD implies is desirable "
            "(e.g. high conscientiousness, collaboration, resilience) as 'correct'; for short-answer, ask the "
            "candidate to describe their own approach/preference and write the grading guideline around what a "
            "response demonstrating strong fit for this role's culture would show."
        ),
        "skills_proficiency": (
            "a SKILLS/PROFICIENCY question testing actual technical know-how or role-specific competence \u2014 a "
            "coding/technical challenge, a language/tool proficiency check, or a role-specific task/mini case study "
            "directly grounded in what this JD requires. This DOES have an objectively correct/best answer."
        ),
        "situational_judgment": (
            "a SITUATIONAL JUDGMENT question: describe a realistic, specific HYPOTHETICAL WORKPLACE SCENARIO this "
            "role would plausibly face (a conflict, a competing-priorities dilemma, an ethical grey area, a "
            "dealing-with-a-difficult-colleague/customer situation, etc.), then ask what the candidate would do. "
            "For MCQ, write 4 plausible response options of genuinely different effectiveness (not one obviously "
            "silly option) and mark the MOST EFFECTIVE professional response as correct; for short-answer, ask them "
            "to explain how they'd handle it, and write the grading guideline around sound judgment, stakeholder "
            "awareness, and conflict-resolution approach rather than one exact 'right' action."
        ),
    }[category]

    schema = (
        '{"questions": [{"question_text": "...", "options": ["A", "B", "C", "D"], '
        '"correct_option_index": 0}, ...]}'
        if is_mcq else
        '{"questions": [{"question_text": "...", "grading_guideline": "what a strong answer '
        'should cover, for the AI grader to check against"}, ...]}'
    )

    question_format_note = (
        "multiple choice with exactly 4 options and one correct/best answer"
        if is_mcq
        else "short free-text answer (no options) — write a grading guideline describing "
        "what a strong answer covers, for an AI grader to check a candidate's response against"
    )
    distinctness_note = (
        "Exactly one of the 4 options should be marked correct_option_index; the other 3 "
        "should be plausible, not obviously wrong."
        if is_mcq
        else 'Do not include a single "model answer" \u2014 write the guideline as evaluation '
        "criteria (key points, not exact wording) since candidates will phrase responses "
        "differently."
    )

    prompt = f"""Generate {count} DISTINCT {difficulty}-difficulty questions. Each one must be {category_framing}

Topic/skill focus: "{skill_tag}"

TARGET ROLE: {jd_title or "the role"}

JOB DESCRIPTION (context/grounding \u2014 reference its actual responsibilities, tools, or scenarios where relevant):
{jd_text[:6000]}

Key required/desirable skills for this role: {json.dumps(jd_skills or [])[:1000]}

Question format: {question_format_note}.

Make the {count} questions meaningfully DIFFERENT from each other \u2014 different scenarios, phrasing, or sub-aspects \u2014 not trivial rewordings, so that different candidates drawing different ones from a question bank get a genuinely comparable but not identical test.
{distinctness_note}

Output ONLY one JSON object, no prose before or after, matching exactly this shape:
{schema}
"""
    llm = _llm(groq_key, groq_model, temperature=0.8)
    try:
        response = llm.invoke(prompt).content
    except Exception as e:
        raise RuntimeError(f"AI question generation failed: {e}")

    data = _extract_json(response)
    if not data or "questions" not in data or not isinstance(data["questions"], list):
        raise RuntimeError("The AI response wasn't in the expected format \u2014 try generating again.")

    results = []
    for q in data["questions"][:count]:
        text = (q.get("question_text") or "").strip()
        if not text:
            continue
        item = {
            "category": category,
            "question_type": question_type,
            "question_text": text,
            "skill_tag": skill_tag,
            "difficulty": difficulty,
            "estimated_seconds": DEFAULT_ESTIMATED_SECONDS[question_type],
            "source": "ai_generated",
            "aptitude_subtype": aptitude_subtype if category == "cognitive_aptitude" else None,
        }
        if is_mcq:
            options = q.get("options") or []
            idx = q.get("correct_option_index")
            if len(options) != 4 or not isinstance(idx, int) or not (0 <= idx < 4):
                continue
            item["options"] = options
            item["correct_option_index"] = idx
        else:
            item["grading_guideline"] = (q.get("grading_guideline") or "").strip()
        results.append(item)

    if not results:
        raise RuntimeError("The AI didn't return any usable questions \u2014 try again, or narrow the topic.")
    return results


async def grade_short_answer(
    question_text: str,
    grading_guideline: str,
    candidate_answer: str,
    groq_key: Optional[str],
    groq_model: str = DEFAULT_GROQ_MODEL,
) -> dict:
    """Returns {"score": 0-100 float, "reasoning": str}. Falls back to a
    conservative "ungraded" marker (score=None) rather than guessing when
    no key is available or the call fails \u2014 an absent AI score should
    read as "needs manual review", never as a silent zero."""
    if not candidate_answer or not candidate_answer.strip():
        return {"score": 0.0, "reasoning": "No answer was submitted for this question."}

    if not (groq_key and _GROQ_AVAILABLE):
        return {"score": None, "reasoning": "Not graded \u2014 no Groq API key was available at submission time."}

    guideline_note = grading_guideline or (
        "(no specific guideline provided \u2014 use your own judgement on quality, "
        "relevance, and depth)"
    )
    prompt = f"""You are grading a candidate's short-answer response in a skills/aptitude/behavioral assessment.

QUESTION:
{question_text}

WHAT A STRONG ANSWER SHOULD COVER (grading guideline \u2014 not exact required wording, candidates will phrase things differently):
{guideline_note}

CANDIDATE'S ANSWER:
{candidate_answer[:3000]}

Score the answer 0-100 based on how well it addresses the guideline's key points, correctness, and depth of reasoning \u2014 partial credit for partially correct/incomplete answers. Then explain your reasoning in 1-3 sentences, specifically referencing what the answer got right or missed.

Output ONLY one JSON object, no prose before or after:
{{"score": 0-100 number, "reasoning": "1-3 sentence explanation"}}
"""
    try:
        llm = _llm(groq_key, groq_model, temperature=0.2, max_tokens=500)
        response = llm.invoke(prompt).content
        data = _extract_json(response)
        if data and isinstance(data.get("score"), (int, float)):
            return {
                "score": max(0.0, min(100.0, float(data["score"]))),
                "reasoning": (data.get("reasoning") or "").strip() or "No reasoning provided.",
            }
    except Exception as e:
        return {"score": None, "reasoning": f"Not graded \u2014 AI grading failed ({e})."}

    return {"score": None, "reasoning": "Not graded \u2014 the AI response wasn't in the expected format."}


async def generate_overall_evaluation(
    candidate_name: str,
    role_title: str,
    category_scores: dict,
    per_question_summary: list,
    groq_key: Optional[str],
    groq_model: str = DEFAULT_GROQ_MODEL,
) -> dict:
    """Returns {"overall_score": float, "summary": str, "reasoning": str}.
    per_question_summary is a list of short dicts like
    {"category", "type", "correct_or_score", "question_text"} \u2014 enough
    for the model to ground its narrative in specifics without re-reading
    every full answer verbatim."""
    if not (groq_key and _GROQ_AVAILABLE):
        avg = sum(category_scores.values()) / len(category_scores) if category_scores else 0.0
        return {
            "overall_score": round(avg, 1),
            "summary": "No Groq API key was available to generate a narrative evaluation.",
            "reasoning": f"Overall score is the plain average of category scores: {category_scores}.",
        }

    prompt = f"""Write a recruiter-facing evaluation of {candidate_name or "this candidate"}'s performance on a skills/aptitude/behavioral assessment{f" for the {role_title} role" if role_title else ""}.

Category scores (0-100): {json.dumps(category_scores)}

Per-question results:
{json.dumps(per_question_summary)[:4000]}

Write:
1. "summary": 2-4 sentences \u2014 the headline verdict a recruiter would want first (strong/weak areas, hire-worthiness signal).
2. "reasoning": a fuller paragraph explaining HOW the scores were reached \u2014 reference specific strengths/weaknesses seen across the questions, not just a repeat of the numbers.
3. "overall_score": a single 0-100 number representing overall performance (weigh categories reasonably; don't just average blindly if one category had far fewer questions).

This is for recruiters/admins only \u2014 the candidate never sees this. Be direct and specific, not generic.

Output ONLY one JSON object, no prose before or after:
{{"overall_score": 0-100 number, "summary": "...", "reasoning": "..."}}
"""
    try:
        llm = _llm(groq_key, groq_model, temperature=0.3, max_tokens=800)
        response = llm.invoke(prompt).content
        data = _extract_json(response)
        if data and isinstance(data.get("overall_score"), (int, float)):
            return {
                "overall_score": max(0.0, min(100.0, float(data["overall_score"]))),
                "summary": (data.get("summary") or "").strip(),
                "reasoning": (data.get("reasoning") or "").strip(),
            }
    except Exception:
        pass

    avg = sum(category_scores.values()) / len(category_scores) if category_scores else 0.0
    return {
        "overall_score": round(avg, 1),
        "summary": "AI narrative evaluation unavailable \u2014 showing the plain average of category scores instead.",
        "reasoning": f"Category scores: {category_scores}.",
    }


def build_question_set(available_questions: list, duration_minutes: int = 60, preferred_jd_record_id: Optional[int] = None) -> list:
    """Pure scheduling logic, no AI. `available_questions` is a list of
    TestQuestion ORM rows (or anything with the same attributes). Returns
    an ordered list of the SAME objects selected for one candidate's
    sitting.

    Splits the time budget 50/50 between MCQ and short-answer questions
    (per the product requirement), fills each half greedily from a
    shuffled pool so two candidates drawing from the same bank get a
    different subset and order, and interleaves categories within each
    half so a sitting isn't accidentally all-skills or all-behavior just
    because of shuffle order.

    When `preferred_jd_record_id` is given (the candidate's own role —
    see routers/skillstest.py's /assign, which passes the JobLensSession's
    jd_record_id), questions tagged to that JD are exhausted FIRST within
    each category before falling back to untagged/other-JD questions —
    so a sitting is built from role-specific questions whenever the bank
    has enough of them, and only pads out with generic ones if it
    doesn't, rather than silently ignoring the JD match entirely.
    """
    total_seconds = max(1, duration_minutes) * 60
    half_budget = total_seconds / 2

    mcq_pool = [q for q in available_questions if q.question_type == "mcq" and q.is_active]
    sa_pool = [q for q in available_questions if q.question_type == "short_answer" and q.is_active]

    def _fill(pool, budget_seconds):
        # Group by category so we can round-robin across skills / aptitude
        # / behavior instead of exhausting one category before touching
        # the others. Within each category, JD-matched questions are
        # shuffled and placed ahead of everything else so they're popped
        # (and therefore selected) first.
        by_category = {}
        for q in pool:
            by_category.setdefault(q.category, []).append(q)
        for cat, bucket in by_category.items():
            if preferred_jd_record_id is not None:
                matched = [q for q in bucket if getattr(q, "jd_record_id", None) == preferred_jd_record_id]
                other = [q for q in bucket if getattr(q, "jd_record_id", None) != preferred_jd_record_id]
                random.shuffle(matched)
                random.shuffle(other)
                by_category[cat] = matched + other
            else:
                random.shuffle(bucket)
        categories = list(by_category.keys())
        random.shuffle(categories)

        selected = []
        used_seconds = 0
        i = 0
        while categories and used_seconds < budget_seconds:
            cat = categories[i % len(categories)]
            bucket = by_category[cat]
            if not bucket:
                categories.remove(cat)
                continue
            q = bucket.pop(0)
            if used_seconds + (q.estimated_seconds or 90) <= budget_seconds or not selected:
                selected.append(q)
                used_seconds += (q.estimated_seconds or 90)
            if not bucket:
                categories.remove(cat)
                continue
            i += 1
        return selected

    selected = _fill(mcq_pool, half_budget) + _fill(sa_pool, half_budget)
    random.shuffle(selected)
    return selected
