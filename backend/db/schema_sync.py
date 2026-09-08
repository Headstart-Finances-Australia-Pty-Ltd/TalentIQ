"""
Automatic schema drift guard.

WHY THIS EXISTS
----------------
On 2026-09-08, `/api/resumecraft/generate` started throwing
`UndefinedColumnError: column "job_id" of relation
"tiq_application_documents" does not exist`. The model
(`ApplicationDocument.job_id`) had been added to models.py, but this repo
has no Alembic version history — schema changes are applied via a manual
list of `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` statements in
migrate_fix.py, run once at startup. `Base.metadata.create_all()` does
NOT help here: it only creates tables that don't exist yet, it never adds
columns to a table that's already there. Whoever added `job_id` to the
model simply forgot the matching line in migrate_fix.py, and nothing in
the startup path would have caught that until a real request hit it in
production.

WHAT THIS DOES
--------------
At startup, after create_all(), this walks every model in Base.metadata
and diffs its columns against the live table via SQLAlchemy's inspector.
Any column that exists on the model but not in the database gets added
automatically with `ADD COLUMN IF NOT EXISTS`. This turns "developer
forgot a migration line" from a silent landmine (only discovered when a
request 500s) into a startup-log line, with no code change required for
the common case of "I added a plain nullable column to a model."

WHAT THIS DELIBERATELY DOES NOT DO
-----------------------------------
This is a narrow safety net, not a replacement for real migrations:
  - Never drops or renames a column (ambiguous — could be a rename in
    disguise, and dropping is destructive). Renames/drops still require
    an explicit, reviewed line in migrate_fix.py, same as today.
  - Never alters an existing column's type or nullability.
  - Never adds a FOREIGN KEY / CHECK / UNIQUE constraint — only the bare
    column, so a bad or out-of-order constraint can never fail startup.
    If a new column needs a constraint, add it explicitly in
    migrate_fix.py once the column exists.
  - Skips any column that is NOT NULL with no default: adding that to a
    table that may already have rows needs a real backfill plan, which
    is a human decision, not an automatic one. It's logged loudly
    instead so it can't fail silently.

In short: this closes the specific hole that caused today's incident
(a plain, nullable, no-FK column silently missing) while leaving
anything genuinely risky to the existing reviewed-migration path.
"""
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.orm import DeclarativeBase


async def sync_missing_columns(engine: AsyncEngine, Base: type[DeclarativeBase]) -> None:
    async with engine.begin() as conn:
        existing_tables = await conn.run_sync(
            lambda sync_conn: set(inspect(sync_conn).get_table_names())
        )

        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                # Brand new table — create_all() just built it with every
                # column already, nothing to diff.
                continue

            existing_columns = await conn.run_sync(
                lambda sync_conn, t=table: {
                    col["name"] for col in inspect(sync_conn).get_columns(t.name)
                }
            )

            for column in table.columns:
                if column.name in existing_columns:
                    continue

                if not column.nullable and column.server_default is None:
                    print(
                        f"  [!] SCHEMA DRIFT (not auto-fixed): "
                        f"{table.name}.{column.name} is NOT NULL with no default "
                        f"and is missing from the database. This needs a reviewed "
                        f"backfill migration in migrate_fix.py, not an automatic one."
                    )
                    continue

                ddl_type = column.type.compile(dialect=engine.dialect)
                stmt = (
                    f'ALTER TABLE {table.name} '
                    f'ADD COLUMN IF NOT EXISTS "{column.name}" {ddl_type}'
                )
                if column.server_default is not None:
                    stmt += f" DEFAULT {column.server_default.arg.text}"

                print(f"  [migrate] auto-adding missing column: {table.name}.{column.name} ({ddl_type})")
                await conn.execute(text(stmt))

                if any(fk.column.table is not table for fk in column.foreign_keys):
                    print(
                        f"  [!] NOTE: {table.name}.{column.name} has a foreign key "
                        f"in the model that was NOT added to the database (constraints "
                        f"are intentionally not auto-applied). Add it explicitly in "
                        f"migrate_fix.py if referential integrity is required."
                    )
