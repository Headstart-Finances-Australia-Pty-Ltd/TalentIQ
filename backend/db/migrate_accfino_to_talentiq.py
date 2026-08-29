"""
One-time data migration: copies every tiq_* table's data from the old
shared AccFino Neon project into the new dedicated TalentIQ Neon project.

WHY THIS EXISTS RATHER THAN pg_dump/pg_restore:
pg_dump --data-only doesn't guarantee foreign-key-safe insert order
(e.g. tiq_joblens_candidates references tiq_joblens_sessions — insert
child rows before the parent exists and you get a FK violation), and
pg_restore's usual fix for that (--disable-triggers) requires actual
Postgres superuser, which Neon does NOT grant to neondb_owner. So
instead of fighting that, this script imports the app's own SQLAlchemy
models (the exact same Base every router uses) and asks
Base.metadata.sorted_tables for the correct dependency order —
guaranteed consistent with the app's real schema, since it IS the
app's real schema.

This is COPY-ONLY. It never drops or modifies anything in the source
(AccFino) database. Dropping the old tiq_* tables from AccFino is a
separate, explicit step — see drop_accfino_tiq_tables.py — run only
after you've confirmed the new database looks right.

USAGE:
    python db/migrate_accfino_to_talentiq.py

It reads two connection strings from environment variables (does NOT
take them as command-line arguments, so they never end up in your
shell history):
    ACCFINO_DATABASE_URL   - the OLD shared Neon project (source)
    TALENTIQ_DATABASE_URL  - the NEW dedicated Neon project (target)

Safe to re-run: every table is copied with "ON CONFLICT (id) DO
NOTHING", so re-running after a partial failure just skips rows
already copied rather than erroring or duplicating them.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from sqlalchemy import MetaData, Table, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import create_async_engine

from db.database import normalize_url

# Importing main pulls in every router/capability module, which is what
# actually registers every model class onto Base.metadata. Importing
# db.database.Base alone is NOT enough — an unimported models module
# means its tables are silently absent from metadata and get skipped
# below without any error, which is worse than a crash.
import main  # noqa: F401  (import side-effect only — registers all models)
from db.database import Base

# Tables that are process-local bookkeeping, not real application data —
# copying these across would be actively wrong (the migration-fingerprint
# table in particular: the target computes and manages its OWN fingerprint
# on its own first successful boot, and overwriting it here could make it
# skip migrations it hasn't actually run yet).
SKIP_TABLES = {"tiq_migration_state"}


async def run():
    source_url = os.getenv("ACCFINO_DATABASE_URL")
    target_url = os.getenv("TALENTIQ_DATABASE_URL")
    if not source_url or not target_url:
        print(
            "Set both ACCFINO_DATABASE_URL (source, old shared project) and "
            "TALENTIQ_DATABASE_URL (target, new dedicated project) as "
            "environment variables before running this script, e.g.:\n\n"
            '  set ACCFINO_DATABASE_URL=postgresql://neondb_owner:...@ep-dawn-scene.../neondb\n'
            '  set TALENTIQ_DATABASE_URL=postgresql://neondb_owner:...@ep-falling-breeze.../TalentIQ\n'
            "  python db\\migrate_accfino_to_talentiq.py\n"
        )
        sys.exit(1)

    source_engine = create_async_engine(normalize_url(source_url), connect_args={"ssl": "require"})
    target_engine = create_async_engine(normalize_url(target_url), connect_args={"ssl": "require"})

    # Reflect which tiq_* tables actually EXIST in the source (AccFino) —
    # its schema may be older than the app's current models (columns/
    # tables added since AccFino was last migrated), so we only ever
    # attempt tables/columns that are genuinely present there, rather
    # than assuming source and target schemas are identical.
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
    skipped_missing = [
        t.name for t in Base.metadata.sorted_tables
        if t.name not in SKIP_TABLES and t.name not in existing_source_tables
    ]
    if skipped_missing:
        print(f"  Note: {len(skipped_missing)} table(s) in the app's current schema don't "
              f"exist yet in AccFino (newer than that deployment) — skipping, nothing to copy: "
              f"{', '.join(skipped_missing)}")

    print(f"\n  Copying {len(tables_in_order)} tables, in dependency-safe order...\n")

    total_rows = 0
    async with source_engine.connect() as src_conn, target_engine.connect() as tgt_conn:
        for table in tables_in_order:
            # Reflect the SOURCE table's actual columns (not the model's
            # current column list) so a column that exists in the model
            # but not yet in AccFino's older schema doesn't blow up the
            # SELECT — same reasoning as the table-existence check above.
            src_meta = MetaData()
            src_table = await src_conn.run_sync(
                lambda sync_conn: Table(table.name, src_meta, autoload_with=sync_conn)
            )
            result = await src_conn.execute(select(src_table))
            rows = result.mappings().all()
            if not rows:
                print(f"  {table.name}: 0 rows — skipping")
                continue

            # Only insert columns that exist on the TARGET table too
            # (the reverse case: target/current schema has a newer
            # column the source row has no value for — fine, it just
            # gets its column default / NULL).
            target_cols = set(table.columns.keys())
            payload = [{k: v for k, v in dict(r).items() if k in target_cols} for r in rows]

            stmt = pg_insert(table).values(payload)
            if "id" in target_cols:
                stmt = stmt.on_conflict_do_nothing(index_elements=["id"])
            result = await tgt_conn.execute(stmt)
            await tgt_conn.commit()
            inserted = result.rowcount if result.rowcount is not None else len(payload)
            total_rows += inserted
            print(f"  {table.name}: {len(payload)} row(s) read, {inserted} inserted "
                  f"(remainder already present, safe to re-run)")

        # Reset every integer PK sequence on the target to MAX(id)+1, so
        # the app's OWN next INSERT (a brand-new candidate, JD, etc.)
        # doesn't collide with an id that was just copied in verbatim
        # above (copied rows keep their original id; sequences don't
        # auto-advance for explicit-id inserts).
        print("\n  Resyncing auto-increment sequences on the target...")
        for table in tables_in_order:
            if "id" not in table.columns:
                continue
            try:
                await tgt_conn.execute(text(
                    f"SELECT setval(pg_get_serial_sequence('{table.name}', 'id'), "
                    f"COALESCE((SELECT MAX(id) FROM {table.name}), 0) + 1, false)"
                ))
            except Exception as e:
                print(f"  WARN: could not resync sequence for {table.name}: {e}")
        await tgt_conn.commit()

    await source_engine.dispose()
    await target_engine.dispose()

    print(f"\n  Done. {total_rows} row(s) newly inserted across {len(tables_in_order)} tables.")
    print("  Nothing was changed in the source (AccFino) database.")
    print("  Verify the new database looks right (log in, browse a few records) BEFORE")
    print("  running drop_accfino_tiq_tables.py to remove the old copy.")


if __name__ == "__main__":
    asyncio.run(run())
