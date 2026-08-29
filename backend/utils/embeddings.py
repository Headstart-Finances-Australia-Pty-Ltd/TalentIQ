"""
TalentIQ - Local CPU Embeddings
==================================
Zero-cost upgrade path from utils/semantic_match.py's TF-IDF fallback,
per the earlier "cheaper alternative" analysis:

- Model: sentence-transformers/all-MiniLM-L6-v2 — 80MB, CPU-only, no GPU
  required, no per-call API cost (runs in-process).
- Storage: pgvector extension on the EXISTING Postgres database (see
  models.SkillTaxonomy.embedding and db/migrate_fix.py) instead of a
  separate Qdrant/Pinecone service — no new vendor, no new bill.

Everything in this module degrades gracefully: if the model can't be
loaded (package not installed, or — as will happen in any network-
restricted sandbox — no route to huggingface.co to download the weights
the FIRST time), every function here returns None/empty rather than
raising, and callers fall back to the TF-IDF tier in semantic_match.py.
The failure is cached after the first attempt so a broken/offline
environment doesn't retry a slow, doomed model load on every single
request.
"""
from typing import List, Optional
import threading

_model = None
_load_attempted = False
_load_lock = threading.Lock()
_EMBED_DIM = 384  # all-MiniLM-L6-v2's output size — must match models.SkillTaxonomy.embedding's Vector(384)


def _get_model():
    global _model, _load_attempted
    if _load_attempted:
        return _model
    with _load_lock:
        if _load_attempted:  # re-check inside the lock (another thread may have just finished)
            return _model
        _load_attempted = True
        try:
            from sentence_transformers import SentenceTransformer
            _model = SentenceTransformer("all-MiniLM-L6-v2")
            print("  [OK] Local embedding model loaded (all-MiniLM-L6-v2, CPU).")
        except Exception as e:
            # Deliberately broad: covers the package not being installed,
            # no network route to download the weights on first use, a
            # corrupted cache, out-of-memory, etc. — all of these mean
            # "embeddings aren't available right now", handled identically
            # by every caller (fall back to TF-IDF).
            print(f"  [!] Local embedding model unavailable, falling back to TF-IDF matching — {type(e).__name__}: {str(e)[:200]}")
            _model = None
    return _model


def embeddings_available() -> bool:
    return _get_model() is not None


def embed_text(text: str) -> Optional[List[float]]:
    """Returns a 384-dim embedding, or None if the model isn't available.
    Safe to call speculatively — never raises."""
    if not text or not text.strip():
        return None
    model = _get_model()
    if model is None:
        return None
    try:
        vec = model.encode(text.strip(), show_progress_bar=False, convert_to_numpy=True)
        return vec.tolist()
    except Exception as e:
        print(f"  [!] embed_text failed — {type(e).__name__}: {str(e)[:200]}")
        return None


def embed_batch(texts: List[str]) -> Optional[List[List[float]]]:
    """Batched version — one model call for many texts, meaningfully
    faster than calling embed_text in a loop when scoring many candidates
    or requirements at once. Returns None (not a list of Nones) if the
    model is unavailable, mirroring embed_text's contract."""
    texts = [t.strip() for t in texts if t and t.strip()]
    if not texts:
        return []
    model = _get_model()
    if model is None:
        return None
    try:
        vecs = model.encode(texts, show_progress_bar=False, convert_to_numpy=True)
        return [v.tolist() for v in vecs]
    except Exception as e:
        print(f"  [!] embed_batch failed — {type(e).__name__}: {str(e)[:200]}")
        return None


def cosine_similarity_vec(a: List[float], b: List[float]) -> float:
    """Plain-Python cosine similarity — no numpy dependency at the call
    site, since callers may just have two already-computed embedding
    lists (e.g. one from this process, one loaded back from pgvector)."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def embedding_requirement_match(
    requirement: str, candidate_skills: List[str], threshold: float = 0.55,
) -> bool:
    """Embeddings-based tier of the skill-matching fallback chain (see
    routers/cvintel.py's _skill_present) — tried BEFORE the TF-IDF tier
    in utils/semantic_match.py since real embeddings catch genuine
    paraphrases (no shared substring) that character n-gram TF-IDF
    structurally cannot. threshold=0.55 is higher than semantic_match's
    0.30 because cosine similarity on true sentence embeddings sits in a
    different, generally higher range for genuine matches than character
    n-gram TF-IDF does — the two thresholds are not directly comparable.

    Returns False (not an error) if embeddings aren't available — the
    caller is expected to then try the TF-IDF tier as a further fallback.
    """
    if not embeddings_available() or not requirement.strip() or not candidate_skills:
        return False
    req_vec = embed_text(requirement)
    if req_vec is None:
        return False
    skill_vecs = embed_batch(candidate_skills)
    if not skill_vecs:
        return False
    return any(cosine_similarity_vec(req_vec, sv) >= threshold for sv in skill_vecs)
