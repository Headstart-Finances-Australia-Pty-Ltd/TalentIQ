"""
Drops every tiq_* table from the OLD AccFino Neon project — the final
cleanup step, run ONLY after migrate_accfino_to_talentiq.py has copied
everything to the new TalentIQ project and you've verified it (logged
in, browsed some real records, confirmed counts look right).

This is DESTRUCTIVE and irreversible. It will not run without an
explicit typed confirmation — there is no --yes/-f flag to skip that,
on purpose.

USAGE:
    set ACCFINO_DATABASE_URL=postgresql://neondb_owner:...@ep-dawn-scene.../neondb
    python db\\drop_accfino_tiq_tables.py

It will list every tiq_* table it's about to drop and ask you to type
the exact phrase shown before doing anything.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from db.database import normalize_url

CONFIRM_PHRASE = "drop accfino tiq tables"


async def run():
    source_url = os.getenv("ACCFINO_DATABASE_URL")
    if not source_url:
        print("Set ACCFINO_DATABASE_URL as an environment variable first — the old, "
              "shared AccFino project's connection string.")
        sys.exit(1)

    engine = create_async_engine(normalize_url(source_url), connect_args={"ssl": "require"})

    async with engine.connect() as conn:
        result = await conn.execute(text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema='public' AND table_name LIKE 'tiq_%' ORDER BY table_name"
        ))
        tables = result.scalars().all()

        if not tables:
            print("No tiq_* tables found in this database — nothing to do.")
            return

        print(f"\n  About to permanently DROP {len(tables)} table(s) from this AccFino database:\n")
        for t in tables:
            count = (await conn.execute(text(f"SELECT COUNT(*) FROM {t}"))).scalar_one()
            print(f"    {t}  ({count} rows)")

        print(
            f"\n  This cannot be undone. Only proceed if you've already run "
            f"migrate_accfino_to_talentiq.py AND confirmed the new database looks right.\n"
        )
        typed = input(f'  Type exactly "{CONFIRM_PHRASE}" to proceed, anything else to cancel: ')
        if typed.strip() != CONFIRM_PHRASE:
            print("  Cancelled — nothing was dropped.")
            return

        print("\n  Dropping...")
        for t in tables:
            await conn.execute(text(f'DROP TABLE IF EXISTS "{t}" CASCADE'))
            print(f"    dropped {t}")
        await conn.commit()

    await engine.dispose()
    print(f"\n  Done. {len(tables)} table(s) dropped from AccFino.")
    print("  Reminder: rotate this database's password in the Neon console now — it's")
    print("  been typed into chat/scripts during this migration and should be treated as exposed.")


if __name__ == "__main__":
    asyncio.run(run())
