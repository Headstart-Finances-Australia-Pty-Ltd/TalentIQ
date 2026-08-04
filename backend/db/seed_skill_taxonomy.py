"""
Seeds a broad, curated skill taxonomy into tiq_skill_taxonomy on first
startup — closes the "static, narrow hardcoded skill list" gap.

Previously the ONLY skill bank was DOMAIN_SKILLS in routers/cvintel.py (a
~120-term hand-written list), and tiq_skill_taxonomy started completely
empty, only growing organically from live LLM extractions (see
utils.llm_extraction.enrich_skill_taxonomy). That means day-one matching
quality for anything outside DOMAIN_SKILLS was weak until the platform had
accumulated real usage.

This seeds several hundred additional terms across categories an IT/
business recruiter commonly needs — closer in spirit (though far smaller
in scale) to a formal taxonomy like ESCO/O*NET, without depending on a
live external API this environment can't reach. It's additive and
idempotent (ON CONFLICT DO NOTHING on the unique skill_name), so it's
always safe to re-run and never overwrites frequency counts already
accumulated from real usage.
"""
import asyncio, sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from sqlalchemy import text
from db.database import AsyncSessionLocal

# category -> terms. Categories match SkillTaxonomy.category's existing
# vocabulary (technical/business/soft/essential/certification) — "essential"
# is reused here for domain/methodology terms that aren't cleanly technical
# tools but are still core hard requirements (e.g. "agile", "GAAP").
SEED_TAXONOMY: dict[str, list[str]] = {
    "technical": [
        # Cloud / DevOps / Infra
        "terraform", "ansible", "puppet", "chef", "helm", "istio", "prometheus", "grafana",
        "jenkins", "gitlab ci", "github actions", "circleci", "argo cd", "gitops",
        "cloudformation", "aws lambda", "azure functions", "google cloud functions",
        "eks", "aks", "gke", "openshift", "rancher", "vault", "consul",
        # Languages / frameworks
        "rust", "kotlin", "swift", "scala", "ruby", "rails", "php", "laravel",
        "vue", "angular", "svelte", "next.js", "nuxt", "express", "fastapi",
        "spring boot", "asp.net", ".net core", "graphql", "grpc", "webassembly",
        # Data / AI
        "pandas", "numpy", "pytorch", "tensorflow", "keras", "scikit-learn", "mlflow",
        "kubeflow", "vector database", "qdrant", "pinecone", "weaviate", "faiss",
        "langchain", "llamaindex", "rag", "prompt engineering", "fine-tuning",
        "computer vision", "reinforcement learning", "time series forecasting",
        "feature engineering", "a/b testing", "statistical modeling",
        # Mobile
        "ios development", "android development", "react native", "flutter", "xamarin",
        # Security
        "penetration testing", "siem", "soc", "iam", "zero trust", "owasp",
        "vulnerability management", "incident response", "threat modeling",
        "iso 27001", "soc 2", "gdpr compliance", "pci dss",
        # QA / testing
        "selenium", "cypress", "playwright automation", "jest", "pytest", "junit",
        "test automation", "load testing", "performance testing",
    ],
    "business": [
        "product management", "product roadmap", "go-to-market strategy", "okrs",
        "stakeholder management", "vendor management", "contract negotiation",
        "change management", "business process reengineering", "six sigma",
        "lean methodology", "kanban", "scrum master", "safe agile",
        "financial modeling", "p&l management", "budgeting", "forecasting",
        "mergers and acquisitions", "due diligence", "market research",
        "competitive analysis", "pricing strategy", "customer success",
        "account management", "channel partnerships", "supply chain management",
        "procurement", "inventory management", "logistics", "erp implementation",
        "crm implementation", "digital transformation", "business intelligence",
        "gaap", "ifrs", "sox compliance", "internal audit", "risk assessment",
        "regulatory reporting", "kyc", "aml", "credit risk", "underwriting",
    ],
    "soft": [
        "cross-functional collaboration", "conflict resolution", "mentoring",
        "coaching", "public speaking", "negotiation", "executive presence",
        "critical thinking", "adaptability", "time management", "delegation",
        "active listening", "emotional intelligence", "decision making",
        "stakeholder communication", "cultural competency", "resilience",
    ],
    "essential": [
        "agile", "waterfall", "prince2", "pmp", "itil", "togaf certified",
        "ci/cd pipelines", "infrastructure as code", "site reliability engineering",
        "on-call rotation", "incident management", "sla management",
        "data privacy", "accessibility (wcag)", "internationalization",
        "cross-browser compatibility", "mobile-first design", "responsive design",
    ],
    "certification": [
        "aws certified solutions architect", "aws certified developer",
        "azure administrator associate", "azure solutions architect expert",
        "google cloud professional architect", "cissp", "ceh", "comptia security+",
        "certified scrum master", "safe agilist", "six sigma black belt",
        "cpa", "cfa", "cma", "shrm-cp", "phr",
    ],
}


async def seed():
    async with AsyncSessionLocal() as db:
        all_terms = [
            (term.strip().lower(), category)
            for category, terms in SEED_TAXONOMY.items()
            for term in terms
            if term.strip()
        ]

        # ── Fast skip on every startup after the first ──────────────────
        # Previously this ran ~200 INDIVIDUAL INSERT statements — one
        # network round-trip each — on EVERY app startup, forever, even
        # though after the first run every single one was a no-op
        # (ON CONFLICT DO NOTHING). Over a real network DB connection
        # that's easily several seconds added to every single launch, and
        # was a genuine, measurable cause of the app being slower to start
        # than before this seed script existed.
        #
        # Fingerprints the term list itself (same pattern as
        # db/migrate_fix.py) rather than just checking a row count — a
        # row-count-only check would correctly skip on a normal repeat
        # startup, but would ALSO wrongly skip a future update that adds
        # MORE terms to SEED_TAXONOMY once organic usage has already
        # pushed the table's row count past the old list's length.
        # Fingerprinting the actual content means a genuine change to this
        # list is always picked up, while an unchanged list is always a
        # single fast query away from skipping the rest entirely.
        import hashlib
        fingerprint = hashlib.sha256(
            "|".join(f"{n}:{c}" for n, c in sorted(all_terms)).encode()
        ).hexdigest()

        await db.execute(text(
            "CREATE TABLE IF NOT EXISTS tiq_skill_taxonomy_seed_state (id INTEGER PRIMARY KEY, fingerprint VARCHAR(64))"
        ))
        existing_fp = (await db.execute(
            text("SELECT fingerprint FROM tiq_skill_taxonomy_seed_state WHERE id = 1")
        )).scalar_one_or_none()
        if existing_fp == fingerprint:
            print(f"  Skill taxonomy seed list unchanged ({len(all_terms)} terms) — skipping.")
            await db.commit()
            return

        # ── Single bulk statement instead of one round-trip per term ────
        # Even on the genuine first run (or a real update to the list),
        # sequential awaits per term was needlessly slow — one multi-row
        # INSERT with the same ON CONFLICT DO NOTHING behavior does the
        # same job in a single round-trip.
        values_sql = ", ".join(f"(:name{i}, :cat{i}, 1, now(), now())" for i in range(len(all_terms)))
        params = {}
        for i, (name, cat) in enumerate(all_terms):
            params[f"name{i}"] = name
            params[f"cat{i}"] = cat

        result = await db.execute(text(f"""
            INSERT INTO tiq_skill_taxonomy (skill_name, category, frequency, first_seen_at, last_seen_at)
            VALUES {values_sql}
            ON CONFLICT (skill_name) DO NOTHING
        """), params)

        await db.execute(text(
            "INSERT INTO tiq_skill_taxonomy_seed_state (id, fingerprint) VALUES (1, :fp) "
            "ON CONFLICT (id) DO UPDATE SET fingerprint = :fp"
        ), {"fp": fingerprint})
        await db.commit()
        print(f"  [OK] Skill taxonomy seed: {result.rowcount or 0} new term(s) added "
              f"(existing terms from real usage were left untouched).")


if __name__ == "__main__":
    asyncio.run(seed())
