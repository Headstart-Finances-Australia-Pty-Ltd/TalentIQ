"""
Live schema+data copy between two Postgres providers (e.g. Neon → Xata),
triggered from Admin Console > API Keys' "Migrate" button rather than run
as a CLI script.

This shares its core strategy with migrate_accfino_to_talentiq.py — see
that script's docstring for WHY (Base.metadata.sorted_tables gives
FK-safe insert order without needing pg_restore's --disable-triggers,
which managed Postgres providers generally don't grant superuser for).
This module is that same strategy, parameterized for arbitrary
source/target URLs and instrumented with a progress callback instead of
print(), so an HTTP endpoint can report live status instead of you
watching a terminal.

COPY-ONLY. This never drops or modifies anything in the source database.
Every insert uses ON CONFLICT (id) DO NOTHING, so a migration is safe to
re-run after a partial failure (a dropped connection, a target outage
mid-copy, etc.) — it just skips rows already present on the target
rather than erroring or duplicating them.

Scope: every tiq_* table currently known to Base.metadata AND present
in the source database — same scoping as migrate_accfino_to_talentiq.py.
Tables outside that prefix (e.g. a coexisting AccFino schema) are never
touched.
"""
from typing import Awaitable, Callable, Optional

from sqlalchemy import MetaData, Table, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import create_async_engine

from db.database import normalize_url, Base

# Process-local bookkeeping the TARGET must compute for itself on its own
# first successful boot — copying this across from the source could make
# the target skip migrations it hasn't actually run yet. Same exclusion
# as migrate_accfino_to_talentiq.py.
SKIP_TABLES = {"tiq_migration_state"}

ProgressFn = Callable[[dict], Optional[Awaitable[None]]]


async def _emit(on_progress: ProgressFn, update: dict):
    """on_progress may be sync or async — callers (the admin router's
    in-memory job store) only need a plain dict mutation, but this
    doesn't assume that."""
    result = on_progress(update)
    if result is not None:
        await result


async def run_provider_migration(source_url: str, target_url: str, on_progress: ProgressFn) -> dict:
    """Copies schema + data from source_url into target_url. Returns a
    summary dict: {"tables_copied": int, "rows_copied": int}. Raises on
    any unrecoverable error (a bad connection string, a source table the
    target genuinely can't accept) — the caller is responsible for
    catching that and recording it as a failed job."""
    source_engine = create_async_engine(normalize_url(source_url), connect_args={"ssl": "require"})
    target_engine = create_async_engine(normalize_url(target_url), connect_args={"ssl": "require"})

    try:
        # 1. Schema first. A fresh create_all already includes every
        # column that migrate_fix.py's historical ALTER TABLE ADD COLUMN
        # steps exist to back-fill onto OLDER already-deployed databases
        # — those backfill statements matter for upgrading an existing
        # live schema, not for creating a brand-new one, so they're not
        # needed here. Idempotent: create_all only creates what's missing,
        # safe to re-run.
        await _emit(on_progress, {"phase": "schema", "message": "Creating tables on target..."})
        async with target_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        # 2. pgvector extension + its ANN index — the two pieces of DDL
        # create_all can't express (see models.py's "XATA NOTE" next to
        # the guarded Vector import). Best-effort and non-fatal: Xata's
        # default shared-cluster plan doesn't support extensions at all,
        # so failing here is EXPECTED on that plan — same safe-no-op
        # precedent as migrate_fix.py's identical statement. The embedding
        # column itself was already created (as JSON or vector, whichever
        # models.py resolved) by step 1 regardless of this step's outcome.
        try:
            async with target_engine.begin() as conn:
                await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
                await conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS idx_tiq_skill_taxonomy_embedding "
                    "ON tiq_skill_taxonomy USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
                ))
            await _emit(on_progress, {"phase": "schema", "message": "pgvector extension + index ready on target."})
        except Exception as e:
            await _emit(on_progress, {
                "phase": "schema",
                "message": f"pgvector unavailable on target (expected on Xata shared-cluster plans — "
                           f"semantic search will fall back to TF-IDF matching instead): {type(e).__name__}",
            })

        # 3. Which tiq_* tables actually exist in the SOURCE — it may be
        # older than the app's current models (columns/tables added
        # since), so only ever attempt tables genuinely present there.
        async with source_engine.connect() as conn:
            result = await conn.execute(text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema='public' AND table_name LIKE 'tiq_%'"
            ))
            existing_source_tables = set(result.scalars().all())

        tables_in_order = [
            t for t in Base.metadata.sorted_tables
            if t.name not in SKIP_TABLES and t.name in existing_source_tables
        ]
        await _emit(on_progress, {
            "phase": "copy", "tables_total": len(tables_in_order),
            "message": f"Copying {len(tables_in_order)} table(s), FK-safe order...",
        })

        total_rows = 0
        async with source_engine.connect() as src_conn, target_engine.connect() as tgt_conn:
            for i, table in enumerate(tables_in_order, start=1):
                await _emit(on_progress, {"phase": "copy", "current_table": table.name, "tables_done": i - 1})

                # Reflect the SOURCE table's actual columns (not the
                # model's current column list) so a column that exists in
                # the model but not yet in an older source schema doesn't
                # blow up the SELECT.
                src_meta = MetaData()
                src_table = await src_conn.run_sync(
                    lambda sync_conn: Table(table.name, src_meta, autoload_with=sync_conn)
                )
                result = await src_conn.execute(select(src_table))
                rows = result.mappings().all()
                if not rows:
                    await _emit(on_progress, {"phase": "copy", "tables_done": i, "message": f"{table.name}: 0 rows"})
                    continue

                # Only insert columns that exist on the TARGET table too.
                target_cols = set(table.columns.keys())
                payload = [{k: v for k, v in dict(r).items() if k in target_cols} for r in rows]

                stmt = pg_insert(table).values(payload)
                if "id" in target_cols:
                    stmt = stmt.on_conflict_do_nothing(index_elements=["id"])
                result = await tgt_conn.execute(stmt)
                await tgt_conn.commit()
                inserted = result.rowcount if result.rowcount is not None else len(payload)
                total_rows += inserted
                await _emit(on_progress, {
                    "phase": "copy", "tables_done": i, "rows_copied": total_rows,
                    "message": f"{table.name}: {len(payload)} row(s) read, {inserted} inserted "
                               f"(remainder already present, safe to re-run)",
                })

            # Reset every integer PK sequence on the target to MAX(id)+1,
            # so the app's OWN next INSERT doesn't collide with an id that
            # was just copied in verbatim (copied rows keep their original
            # id; sequences don't auto-advance for explicit-id inserts).
            await _emit(on_progress, {"phase": "sequences", "message": "Resyncing auto-increment sequences on target..."})
            for table in tables_in_order:
                if "id" not in table.columns:
                    continue
                try:
                    await tgt_conn.execute(text(
                        f"SELECT setval(pg_get_serial_sequence('{table.name}', 'id'), "
                        f"COALESCE((SELECT MAX(id) FROM {table.name}), 0) + 1, false)"
                    ))
                except Exception as e:
                    await _emit(on_progress, {"phase": "sequences", "message": f"WARN: could not resync sequence for {table.name}: {e}"})
            await tgt_conn.commit()

        return {"tables_copied": len(tables_in_order), "rows_copied": total_rows}
    finally:
        await source_engine.dispose()
        await target_engine.dispose()
