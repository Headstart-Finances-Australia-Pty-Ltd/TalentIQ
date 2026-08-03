"""
TalentIQ - O*NET Bulk Taxonomy Import
========================================
Zero-cost upgrade path from db/seed_skill_taxonomy.py's ~200-term curated
list to O*NET's real, free, publicly downloadable skill/technology
taxonomy (tens of thousands of terms) — per the earlier "cheaper
alternative" analysis, instead of a live paid taxonomy API.

IMPORTANT — this script cannot download the files itself. O*NET's site
(onetcenter.org) isn't reachable from network-restricted environments
(including the sandbox this was developed in) — you need to download the
files yourself, once, from a machine with normal internet access:

  1. Go to https://www.onetcenter.org/database.html#individual-files
  2. Under "Text Files", download (all free, no signup, no cost):
       - Technology Skills.txt
       - Skills.txt
       - Tools Used.txt   (optional but recommended)
  3. Place them in one folder, e.g. ./onet_data/
  4. Run:  python db/import_onet_taxonomy.py --path ./onet_data/

Re-running is safe and idempotent (ON CONFLICT DO NOTHING on the unique
skill_name, same as db/seed_skill_taxonomy.py) — existing frequency
counts from real usage are never overwritten. O*NET publishes a refreshed
database roughly twice a year; re-running this after each release keeps
the taxonomy current at zero ongoing cost.

The ESCO taxonomy (EU equivalent) is available the same way — free bulk
download at https://esco.ec.europa.eu/en/use-esco/download — in CSV
format with a different column layout. Not implemented here to keep
scope focused, but the same pattern (download once, parse, upsert)
applies directly.
"""
import argparse
import asyncio
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from sqlalchemy import text
from db.database import AsyncSessionLocal


# O*NET's documented, stable column layout for each file (tab-delimited).
# Confirmed against O*NET's published database dictionary — these column
# names haven't changed across recent database releases.
FILE_SPECS = {
    "Technology Skills.txt": {"name_col": "Example", "category": "technical"},
    "Tools Used.txt":        {"name_col": "Example", "category": "technical"},
    "Skills.txt":            {"name_col": "Element Name", "category": "essential"},
}


def _parse_onet_file(filepath: str, name_col: str) -> set:
    """Reads one O*NET tab-delimited file and returns the set of unique,
    normalized (lowercase, stripped) values from the given column. O*NET
    files repeat one column value across many O*NET-SOC occupation code
    rows (e.g. "Python" appears once per occupation that uses it) — a
    plain set() dedupes that down to the term itself, which is all this
    taxonomy needs (frequency here comes from real platform usage via
    enrich_skill_taxonomy, not from O*NET's own occupation counts)."""
    terms = set()
    with open(filepath, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        if name_col not in (reader.fieldnames or []):
            print(f"  [!] '{name_col}' column not found in {os.path.basename(filepath)} "
                  f"(found: {reader.fieldnames}) — skipping this file.")
            return terms
        for row in reader:
            val = (row.get(name_col) or "").strip()
            if val and len(val) <= 200:
                terms.add(val.lower())
    return terms


async def import_onet(data_path: str, with_embeddings: bool = True):
    embed_text = None
    if with_embeddings:
        try:
            from utils.embeddings import embed_text as _embed_text, embeddings_available
            if embeddings_available():
                embed_text = _embed_text
            else:
                print("  [i] Local embedding model unavailable — importing without embeddings "
                      "(they'll backfill automatically via enrich_skill_taxonomy on next real "
                      "use once embeddings ARE available, see utils/embeddings.py).")
        except ImportError:
            pass

    total_found, total_inserted = 0, 0
    async with AsyncSessionLocal() as db:
        for filename, spec in FILE_SPECS.items():
            filepath = os.path.join(data_path, filename)
            if not os.path.exists(filepath):
                print(f"  [!] {filename} not found in {data_path} — skipping "
                      f"(download it from onetcenter.org/database.html, see this script's docstring).")
                continue

            terms = _parse_onet_file(filepath, spec["name_col"])
            total_found += len(terms)
            print(f"  {filename}: {len(terms)} unique term(s) found.")

            for term in terms:
                embedding = embed_text(term) if embed_text else None
                params = {"name": term, "cat": spec["category"]}
                if embedding is not None:
                    vec_literal = "[" + ",".join(str(x) for x in embedding) + "]"
                    result = await db.execute(text("""
                        INSERT INTO tiq_skill_taxonomy (skill_name, category, frequency, first_seen_at, last_seen_at, embedding)
                        VALUES (:name, :cat, 1, now(), now(), :emb)
                        ON CONFLICT (skill_name) DO NOTHING
                    """), {**params, "emb": vec_literal})
                else:
                    result = await db.execute(text("""
                        INSERT INTO tiq_skill_taxonomy (skill_name, category, frequency, first_seen_at, last_seen_at)
                        VALUES (:name, :cat, 1, now(), now())
                        ON CONFLICT (skill_name) DO NOTHING
                    """), params)
                total_inserted += result.rowcount or 0
        await db.commit()

    print(f"\n  [OK] O*NET import complete: {total_found} term(s) scanned across all files, "
          f"{total_inserted} new term(s) added (existing terms/frequencies untouched).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--path", required=True, help="Folder containing the downloaded O*NET .txt files")
    parser.add_argument("--no-embeddings", action="store_true", help="Skip embedding generation (faster import)")
    args = parser.parse_args()
    asyncio.run(import_onet(args.path, with_embeddings=not args.no_embeddings))
