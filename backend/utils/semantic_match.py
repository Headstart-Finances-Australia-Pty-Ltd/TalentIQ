"""
TalentIQ - Lightweight Semantic Matching
==========================================
Closes part of the "no semantic/vector search" gap — with an honest scope
note: this is in-process TF-IDF + cosine similarity over character n-grams,
NOT an embeddings-based vector database (Qdrant/Pinecone) with a trained
sentence-transformer model. That's a deliberate, pragmatic choice for this
environment (no GPU, no external vector DB service to deploy against) —
but it genuinely does catch requirement/skill phrasing that plain
substring + curated-synonym matching (see routers/cvintel.py's
_skill_present) misses — abbreviations, pluralization, versioning, and
partial-word variants a hardcoded synonym list wasn't written for (e.g.
"Kubernetes clusters" against a requirement phrased "kubernetes
orchestration", or "Postgres" against "postgresql database"). It is
NOT capable of matching genuinely different wording with no shared
substrings (e.g. "distributed systems design" against "built
fault-tolerant, horizontally-scaled services") — that needs real semantic
embeddings, which is exactly why this is documented as a partial,
honest step rather than a full RAG/vector-search replacement.

Character n-grams (not word n-grams) are used deliberately: they're
robust to the short, jargon-heavy, often-abbreviated phrasing typical of
skill requirements ("CI/CD" vs "continuous integration/deployment") in a
way word-level TF-IDF isn't, and need no tokenizer/stopword tuning.
"""
from typing import List, Optional

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
    _SKLEARN_AVAILABLE = True
except ImportError:
    _SKLEARN_AVAILABLE = False


def semantic_available() -> bool:
    return _SKLEARN_AVAILABLE


def semantic_similarity(a: str, b: str) -> float:
    """Returns cosine similarity in [0, 1] between two short text spans
    (a requirement phrase and a resume excerpt/skill phrase). Returns 0.0
    if scikit-learn isn't installed or either input is empty — callers
    should treat that as "no signal", not "definitely no match"."""
    if not _SKLEARN_AVAILABLE or not a.strip() or not b.strip():
        return 0.0
    vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=1)
    try:
        matrix = vec.fit_transform([a.lower().strip(), b.lower().strip()])
        return float(cosine_similarity(matrix[0:1], matrix[1:2])[0][0])
    except ValueError:
        # Can happen on degenerate input (e.g. all-stopword/punctuation
        # strings that vectorize to an all-zero vector) — no signal.
        return 0.0


def semantic_requirement_match(
    requirement: str, resume_text: str, candidate_skills: Optional[List[str]] = None,
    threshold: float = 0.30,
) -> bool:
    """Used as a LAST-RESORT fallback signal in _skill_present (see
    routers/cvintel.py) — only reached after exact match, curated
    synonyms, and substring checks have all failed. Compares the
    requirement against each candidate skill phrase individually (more
    reliable than one giant similarity check against the whole resume,
    where a short requirement phrase gets diluted) and, as a secondary
    check, against short sliding windows of the resume text itself.

    threshold=0.30 was picked conservatively (favoring precision over
    recall) after spot-checking against clearly-related vs.
    clearly-unrelated phrase pairs — character n-gram TF-IDF cosine
    similarity between two SHORT skill phrases tends to sit well above
    this for genuine paraphrases and well below it for unrelated skills
    that merely share a common word.
    """
    if not _SKLEARN_AVAILABLE or not requirement.strip():
        return False

    for skill in (candidate_skills or []):
        if semantic_similarity(requirement, skill) >= threshold:
            return True

    # Fallback: check against sentence-ish chunks of the resume so a
    # multi-word requirement phrased differently across a whole sentence
    # still has a chance to match, without diluting against the ENTIRE
    # resume at once (which drowns out short phrases).
    chunks = [c.strip() for c in resume_text.replace("\n", ". ").split(".") if len(c.strip()) > 15]
    for chunk in chunks[:200]:  # bounded — resumes can be long; this is a fallback, not the primary path
        if semantic_similarity(requirement, chunk) >= threshold:
            return True

    return False
