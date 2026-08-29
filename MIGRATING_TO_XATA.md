# Migrating the database from Neon to Xata Postgres

Object storage (S3 / Cloudflare R2) is untouched by this migration — it
was already provider-agnostic (`backend/routers/admin.py`'s
`/system/s3/test`, `frontend/.../ApiKeysTab.tsx`'s "Object Storage"
panel) and needs no changes.

## What changed in the code

Nothing here is Neon-specific at the driver level — the app talks to
Postgres over the standard wire protocol via SQLAlchemy + asyncpg, so
swapping providers is a config change, not a code change. What *did*
change is comments, docstrings, and UI copy that assumed "the database"
meant Neon specifically:

- `backend/db/database.py` — module docstring, the missing-`DATABASE_URL`
  error message, and the connection-pool sizing comment
- `backend/routers/admin.py` — the storage-quota/billing comments
- `backend/models/models.py` — file header, and a new "XATA NOTE" next
  to the guarded `pgvector` import (see below)
- `backend/db/migrate_fix.py` — the `CREATE EXTENSION vector` step's
  comment
- `backend/main.py`, `backend/utils/credentials.py` — minor wording
- `frontend/src/pages/admin/ApiKeysTab.tsx` — the Database panel's
  label and connection-string placeholder

Historical one-off scripts (`db/migrate_accfino_to_talentiq.py`,
`db/drop_accfino_tiq_tables.py`) document a *previous*, unrelated
migration (AccFino → TalentIQ tables) and were left alone — they're an
accurate record of something that already happened on Neon, not live
configuration.

## What you still need to do yourself

I can't do these from here — this environment has no network access and
doesn't hold your real Xata credentials, so the following are yours to
run:

### 1. Get your Xata connection string

Xata's connection string maps onto standard Postgres fields differently
than Neon's:

| Postgres field | Xata value |
|---|---|
| user | Workspace ID |
| password | API key (`xau_...`) |
| host | `<region>.sql.xata.sh`, e.g. `us-east-1.sql.xata.sh` |
| port | 5432 |
| database | `<Database>:<Branch>`, e.g. `TalentIQ:main` |

Full string: `postgresql://<workspace-id>:<api-key>@<region>.sql.xata.sh:5432/<db>:<branch>`

You'll need direct-Postgres access enabled on the Xata database/workspace
(it's a toggle in Xata's dashboard) before this connection string is live.

### 2. Move the data — now a one-click button

The Database panel now has a **"Migrate to another provider"** section
with its own Source/Target connection-string fields (separate from the
"active connection" fields above, since a migration needs both a source
and target live at once). Paste the old Neon string as source and the
new Xata string as target, tick the confirmation checkbox, and click
**Start Migration**.

What it does server-side (`backend/db/provider_migration.py`, wired up
in `backend/routers/admin.py`):
1. Creates every `tiq_*` table on the target (`Base.metadata.create_all`)
   if not already present.
2. Best-effort `CREATE EXTENSION vector` + its ANN index on the target —
   expected to no-op on Xata's shared-cluster plan (see the pgvector
   caveat below); everything else still proceeds normally.
3. Copies every `tiq_*` table's rows from source to target, in
   foreign-key-safe dependency order (same approach as the existing
   `db/migrate_accfino_to_talentiq.py` CLI script, reused here).
4. Resyncs auto-increment sequences on the target so the app's next
   INSERT doesn't collide with a copied id.

It's **copy-only** (the source is never modified) and every insert uses
`ON CONFLICT (id) DO NOTHING`, so it's safe to click Start again if a
run gets interrupted — already-copied rows are skipped, not duplicated.

The button starts a background job and returns immediately; the panel
polls for progress (current table, rows copied, a scrolling log) every
1.5s while it runs. Jobs are tracked in-memory on the backend process —
fine for a one-off admin operation, but a job's progress is lost (not
the data already copied — that's safely in the target database) if the
backend process restarts mid-migration; just start it again.

If you'd rather run it from a terminal instead of the UI, the original
`pg_dump`/`pg_restore` approach in step 1 above still works too — the
UI button doesn't replace that, it's just faster for a straightforward
copy.

### 3. Read the pgvector caveat before you cut over

**Xata's default shared-cluster plan does not support Postgres
extensions at all** (it ships with `plpgsql` only) — `CREATE EXTENSION
vector` only works on a **Xata Dedicated Cluster** plan. This app
already anticipated a Postgres tier without the extension:

- `db/migrate_fix.py`'s `CREATE EXTENSION IF NOT EXISTS vector` step is
  wrapped in a per-statement try/except and silently no-ops on failure.
- `models.py`'s `Vector` import falls back to a plain `JSON` column if
  the `pgvector` package or extension isn't available.
- `utils/embeddings.py` / `utils/semantic_match.py` fall back to
  TF-IDF matching if DB-backed embeddings aren't available.

So the app **will run correctly on Xata's shared-cluster plan** — you
just won't get pgvector-backed semantic search on the skill taxonomy;
it'll silently use the TF-IDF fallback instead. If you need real
semantic search preserved, you need a Xata Dedicated Cluster plan (or
another pgvector-capable Postgres provider).

### 4. Update DATABASE_URL and redeploy

Same as any connection-string change in this app (see
`test_connection_url`'s docstring in `db/database.py` for why the admin
panel deliberately doesn't hot-swap): set the new Xata `DATABASE_URL` in
your hosting platform's environment variables and redeploy, so every
module that imports the engine picks it up consistently.

### 5. Neon stays available as a fallback option

The Database panel now has a Provider dropdown (Xata / Neon), defaulted
to Xata — both remain usable, not a one-way cutover. Selecting a
provider only changes the placeholder/example shown for the connection
string; the same "Test Connection" flow validates either (both speak
plain Postgres wire protocol). Saving records which provider the saved
connection string belongs to. If you ever need to fall back to Neon,
switch the dropdown, paste/test/save the Neon string, then update
`DATABASE_URL` and redeploy as in step 4 — no code change required
either way.

Rotate the old Neon credential once you're confident you won't need to
fall back to it (if it was ever exposed in a shared zip).
