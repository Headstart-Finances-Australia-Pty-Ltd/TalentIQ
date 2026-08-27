"""
One-time migration: fix columns that were created as PostgreSQL ENUMs.
Converts them to plain VARCHAR so we can use string values directly.
Run once on startup via main.py lifespan.
"""
import asyncio
import sys
import os
import hashlib
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from db.database import engine
from sqlalchemy import text

MIGRATIONS = [
    # Client: location -> address rename; partnership_from removed from the
    # model (left as an orphaned column in the DB — no destructive DROP)
    "ALTER TABLE tiq_clients RENAME COLUMN location TO address",

    # Vendor: location -> address, area_of_coverage -> coverage_region
    "ALTER TABLE tiq_vendors RENAME COLUMN location TO address",
    "ALTER TABLE tiq_vendors RENAME COLUMN area_of_coverage TO coverage_region",

    # JD: uploaded JD document (Word/PDF), alongside the existing description text
    "ALTER TABLE tiq_jd_records ADD COLUMN IF NOT EXISTS jd_file_blob BYTEA",
    "ALTER TABLE tiq_jd_records ADD COLUMN IF NOT EXISTS jd_file_filename VARCHAR(300)",
    "ALTER TABLE tiq_jd_records ADD COLUMN IF NOT EXISTS jd_file_mimetype VARCHAR(100)",

    # Candidate: address + work permission status
    "ALTER TABLE tiq_tracked_candidates ADD COLUMN IF NOT EXISTS address VARCHAR(300)",
    "ALTER TABLE tiq_tracked_candidates ADD COLUMN IF NOT EXISTS work_permission VARCHAR(50)",

    # CandidateTrack: cover letter, uploaded/stored independently of the resume
    "ALTER TABLE tiq_tracked_candidates ADD COLUMN IF NOT EXISTS cover_letter_blob BYTEA",
    "ALTER TABLE tiq_tracked_candidates ADD COLUMN IF NOT EXISTS cover_letter_filename VARCHAR(300)",
    "ALTER TABLE tiq_tracked_candidates ADD COLUMN IF NOT EXISTS cover_letter_mimetype VARCHAR(100)",

    "ALTER TABLE tiq_jd_records ADD COLUMN IF NOT EXISTS essential_skills JSON DEFAULT '[]'",
    "ALTER TABLE tiq_jd_records ADD COLUMN IF NOT EXISTS good_to_have_skills JSON DEFAULT '[]'",
    "ALTER TABLE tiq_jd_records ADD COLUMN IF NOT EXISTS optional_skills JSON DEFAULT '[]'",
    "ALTER TABLE tiq_jd_records ADD COLUMN IF NOT EXISTS min_years_experience INTEGER DEFAULT 0",
    "ALTER TABLE tiq_jd_records ADD COLUMN IF NOT EXISTS education_requirement VARCHAR(300)",

    "ALTER TABLE tiq_job_matches ADD COLUMN IF NOT EXISTS strengths_breakdown JSON",
    "ALTER TABLE tiq_job_matches ADD COLUMN IF NOT EXISTS jd_requirements JSON",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS strengths_breakdown JSON",

    # Per-user sequential numbering (session numbers isolated per user)
    "ALTER TABLE tiq_job_searches ADD COLUMN IF NOT EXISTS sequence_number INTEGER",
    "ALTER TABLE tiq_jobintel_runs ADD COLUMN IF NOT EXISTS sequence_number INTEGER",
    "ALTER TABLE tiq_linklens_searches ADD COLUMN IF NOT EXISTS sequence_number INTEGER",
    "ALTER TABLE tiq_joblens_sessions ADD COLUMN IF NOT EXISTS sequence_number INTEGER",
    "ALTER TABLE tiq_jd_documents ADD COLUMN IF NOT EXISTS sequence_number INTEGER",
    "ALTER TABLE tiq_cvanalysis_records ADD COLUMN IF NOT EXISTS sequence_number INTEGER",
    "ALTER TABLE tiq_jd_records ADD COLUMN IF NOT EXISTS sequence_number INTEGER",
    "ALTER TABLE tiq_vendors ADD COLUMN IF NOT EXISTS sequence_number INTEGER",

    # Vendor Management: new profile fields
    "ALTER TABLE tiq_vendors ADD COLUMN IF NOT EXISTS location VARCHAR(300)",
    "ALTER TABLE tiq_vendors ADD COLUMN IF NOT EXISTS area_of_coverage VARCHAR(300)",
    "ALTER TABLE tiq_vendors ADD COLUMN IF NOT EXISTS technical_area VARCHAR(300)",

    # JD Management: proper Client link (company_name kept as legacy fallback)
    "ALTER TABLE tiq_jd_records ADD COLUMN IF NOT EXISTS client_id INTEGER",

    # CandidateLens: optional link to a JD Management record, categorized
    # requirements, and denormalized client name for the summary panel
    "ALTER TABLE tiq_joblens_sessions ADD COLUMN IF NOT EXISTS jd_record_id INTEGER",
    "ALTER TABLE tiq_joblens_sessions ADD COLUMN IF NOT EXISTS jd_client_name VARCHAR(300)",
    "ALTER TABLE tiq_joblens_sessions ADD COLUMN IF NOT EXISTS jd_essential_skills JSON DEFAULT '[]'",
    "ALTER TABLE tiq_joblens_sessions ADD COLUMN IF NOT EXISTS jd_good_to_have_skills JSON DEFAULT '[]'",
    "ALTER TABLE tiq_joblens_sessions ADD COLUMN IF NOT EXISTS jd_optional_skills JSON DEFAULT '[]'",

    # CandidateLens: candidate sourced from Vendor Management instead of a
    # raw manual CV upload
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS source_vendor_id INTEGER",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS source_vendor_name VARCHAR(300)",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS source_tracked_candidate_id INTEGER",

    "ALTER TABLE tiq_user_api_keys ADD COLUMN IF NOT EXISTS is_global BOOLEAN DEFAULT FALSE NOT NULL",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS resume_file_blob BYTEA",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS resume_file_mimetype VARCHAR(100)",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS video_blob BYTEA",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS video_mimetype VARCHAR(50) DEFAULT 'video/webm'",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS video_transcript TEXT",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS video_analysis JSON",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS video_analysis_status VARCHAR(20) DEFAULT 'Pending'",
    "ALTER TABLE tiq_joblens_sessions ADD COLUMN IF NOT EXISTS jd_role VARCHAR(300)",
    "ALTER TABLE tiq_joblens_sessions ADD COLUMN IF NOT EXISTS jd_location VARCHAR(300)",
    "ALTER TABLE tiq_joblens_sessions ADD COLUMN IF NOT EXISTS jd_company VARCHAR(300)",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS experience_years VARCHAR(20)",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS summary TEXT",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS resume_summary JSON DEFAULT '[]'",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS interview_token VARCHAR(64)",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS contacted BOOLEAN DEFAULT FALSE",
    "ALTER TABLE tiq_jd_documents ADD COLUMN IF NOT EXISTS job_type VARCHAR(50)",
    "ALTER TABLE tiq_jd_documents ADD COLUMN IF NOT EXISTS contract_duration VARCHAR(50)",
    "ALTER TABLE tiq_jd_documents ADD COLUMN IF NOT EXISTS organisational_context TEXT",
    "ALTER TABLE tiq_jd_documents ADD COLUMN IF NOT EXISTS required_qualifications JSON DEFAULT '[]'",
    "ALTER TABLE tiq_jd_documents ADD COLUMN IF NOT EXISTS preferred_qualifications JSON DEFAULT '[]'",
    "ALTER TABLE tiq_jd_documents ADD COLUMN IF NOT EXISTS llm_provider VARCHAR(20)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_tiq_joblens_candidates_interview_token ON tiq_joblens_candidates (interview_token)",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS emotion_disgust INTEGER DEFAULT 0",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS emotion_surprise INTEGER DEFAULT 0",
    # emotion_fear was missing here entirely — present on the model
    # (JobLensCandidate.emotion_fear) and read/written by the video
    # analysis code, but with no migration at all, not even in the
    # original CREATE TABLE block below (which only has happy/neutral/
    # sad/angry). Same failure mode as video_screening_*: any query
    # touching this table 500s the moment the column is actually needed.
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS emotion_fear INTEGER DEFAULT 0",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS dominant_emotion VARCHAR(20) DEFAULT 'Neutral'",

    # interview_questions/video_status/emotion_happy/emotion_neutral/
    # emotion_sad/emotion_angry/shortlisted only ever existed inside the
    # "CREATE TABLE IF NOT EXISTS tiq_joblens_candidates (...)" bootstrap
    # statement further below — which is a no-op on any database where
    # that table already exists (true for every real deployment by now).
    # Whoever added these to the model apparently added them to that
    # CREATE block and stopped there, assuming it was equivalent to an
    # ALTER — it isn't, for anyone who already has the table. Same
    # "column does not exist" 500 as video_screening_*/emotion_fear,
    # just on older, more foundational columns, which is why this broke
    # far more than just the video-related views.
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS interview_questions JSON DEFAULT '[]'",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS video_status VARCHAR(50) DEFAULT 'Pending'",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS emotion_happy INTEGER DEFAULT 0",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS emotion_neutral INTEGER DEFAULT 0",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS emotion_sad INTEGER DEFAULT 0",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS emotion_angry INTEGER DEFAULT 0",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS shortlisted BOOLEAN DEFAULT FALSE",
    "ALTER TABLE tiq_jobintel_records ADD COLUMN IF NOT EXISTS job_group VARCHAR(200)",
    "ALTER TABLE tiq_jobintel_records ADD COLUMN IF NOT EXISTS company_type VARCHAR(200)",
    # Create JobLens tables if they don't exist (added after initial deployment)
    """CREATE TABLE IF NOT EXISTS tiq_joblens_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES tiq_users(id) ON DELETE CASCADE,
        jd_text TEXT,
        jd_skills JSON DEFAULT '[]',
        low_threshold INTEGER DEFAULT 40,
        high_threshold INTEGER DEFAULT 70,
        cv_count INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'completed',
        created_at TIMESTAMP DEFAULT NOW()
    )""",
    """CREATE TABLE IF NOT EXISTS tiq_joblens_candidates (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES tiq_joblens_sessions(id) ON DELETE CASCADE,
        name VARCHAR(200),
        email VARCHAR(200),
        phone VARCHAR(100),
        filename VARCHAR(300),
        ats_score FLOAT DEFAULT 0.0,
        status VARCHAR(50) DEFAULT 'Not Qualified',
        matched_skills JSON DEFAULT '[]',
        missing_skills JSON DEFAULT '[]',
        bonus INTEGER DEFAULT 0,
        bonus_reasons TEXT,
        interview_questions JSON DEFAULT '[]',
        video_status VARCHAR(50) DEFAULT 'Pending',
        emotion_happy INTEGER DEFAULT 0,
        emotion_neutral INTEGER DEFAULT 0,
        emotion_sad INTEGER DEFAULT 0,
        emotion_angry INTEGER DEFAULT 0,
        shortlisted BOOLEAN DEFAULT FALSE
    )""",
    # Fix tiq_linklens_searches.status - was ENUM agentstatus, now VARCHAR
    """ALTER TABLE tiq_linklens_searches
       ALTER COLUMN status TYPE VARCHAR(50)
       USING status::text""",

    # Fix tiq_jobintel_runs.status - same problem
    """ALTER TABLE tiq_jobintel_runs
       ALTER COLUMN status TYPE VARCHAR(50)
       USING status::text""",

    # Fix tiq_users.role if it was created as userenum
    """ALTER TABLE tiq_users
       ALTER COLUMN role TYPE VARCHAR(50)
       USING role::text""",

    # Add any missing columns
    "ALTER TABLE tiq_linklens_searches ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP",
    "ALTER TABLE tiq_jobintel_runs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP",

    # Missing indexes on foreign key columns — SQLAlchemy's ForeignKey()
    # only creates the constraint, never an index, so every dashboard
    # query filtering/joining on these columns was doing a full sequential
    # scan. Harmless with a handful of test rows; gets progressively
    # slower as real data accumulates, which is exactly the "dashboard is
    # slow now" symptom this fixes. CREATE INDEX IF NOT EXISTS is safe to
    # run repeatedly and doesn't lock the table for reads.
    "CREATE INDEX IF NOT EXISTS idx_tiq_user_api_keys_user_id ON tiq_user_api_keys(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_resumes_user_id ON tiq_resumes(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_job_searches_user_id ON tiq_job_searches(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_jobs_search_id ON tiq_jobs(search_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_job_matches_user_id ON tiq_job_matches(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_job_matches_resume_id ON tiq_job_matches(resume_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_job_matches_job_id ON tiq_job_matches(job_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_jobintel_runs_user_id ON tiq_jobintel_runs(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_jobintel_records_run_id ON tiq_jobintel_records(run_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_linklens_searches_user_id ON tiq_linklens_searches(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_linkedin_profiles_search_id ON tiq_linkedin_profiles(search_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_audit_logs_user_id ON tiq_audit_logs(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_joblens_sessions_user_id ON tiq_joblens_sessions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_joblens_sessions_jd_record_id ON tiq_joblens_sessions(jd_record_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_joblens_candidates_session_id ON tiq_joblens_candidates(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_joblens_candidates_source_vendor_id ON tiq_joblens_candidates(source_vendor_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_joblens_candidates_source_tracked_candidate_id ON tiq_joblens_candidates(source_tracked_candidate_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_jd_documents_user_id ON tiq_jd_documents(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_cvanalysis_records_user_id ON tiq_cvanalysis_records(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_jd_records_user_id ON tiq_jd_records(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_jd_records_client_id ON tiq_jd_records(client_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_vendors_user_id ON tiq_vendors(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_clients_user_id ON tiq_clients(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_tracked_candidates_user_id ON tiq_tracked_candidates(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_tracked_candidates_jd_id ON tiq_tracked_candidates(jd_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_tracked_candidates_vendor_id ON tiq_tracked_candidates(vendor_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_tracked_candidates_duplicate_of_id ON tiq_tracked_candidates(duplicate_of_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_candidate_status_log_candidate_id ON tiq_candidate_status_log(candidate_id)",

    # ── Missing FK indexes, part 2 ───────────────────────────────────────
    # The block above covers every FK column that existed when this
    # capability first shipped. These 7 are FK columns added to
    # ALREADY-EXISTING tables (tiq_candidates, tiq_requisitions,
    # tiq_applications) via ADD COLUMN further up this file. The ORM model
    # declares index=True on every one of them, but that only auto-creates
    # an index when create_all() builds a table from scratch — it has no
    # effect on a column bolted onto a table that already existed, which is
    # exactly what every ADD COLUMN in this file does. Confirmed via a
    # metadata cross-check (every ORM-declared FK column vs. every
    # CREATE INDEX actually present in this file): these 7 were the only
    # gaps, and every query filtering/joining on them — including the
    # application-count-per-requisition rollup added alongside the
    # requisitions N+1 fix — was doing a full sequential scan on Neon
    # without them.
    "CREATE INDEX IF NOT EXISTS idx_tiq_candidates_owner_user_id ON tiq_candidates(owner_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_candidates_merged_into_id ON tiq_candidates(merged_into_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_requisitions_jd_record_id ON tiq_requisitions(jd_record_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_requisitions_hiring_manager_contact_id ON tiq_requisitions(hiring_manager_contact_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_requisitions_approved_by_user_id ON tiq_requisitions(approved_by_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_applications_requisition_id ON tiq_applications(requisition_id)",
    "CREATE INDEX IF NOT EXISTS idx_tiq_applications_jd_record_id ON tiq_applications(jd_record_id)",

    # ── Dual-track scoring engine (RevaMatrix-AI parity): decoupled
    # technical/non-technical scoring, dynamic weights, hard disqualifiers.
    # See utils/scoring.py, and the JobLensSession/JobLensCandidate model
    # docstrings for what each field is used for.
    "ALTER TABLE tiq_joblens_sessions ADD COLUMN IF NOT EXISTS salary_budget_min INTEGER DEFAULT 0",
    "ALTER TABLE tiq_joblens_sessions ADD COLUMN IF NOT EXISTS salary_budget_max INTEGER DEFAULT 0",
    "ALTER TABLE tiq_joblens_sessions ADD COLUMN IF NOT EXISTS max_notice_days INTEGER DEFAULT 0",
    "ALTER TABLE tiq_joblens_sessions ADD COLUMN IF NOT EXISTS jd_remote_allowed BOOLEAN DEFAULT FALSE",
    "ALTER TABLE tiq_joblens_sessions ADD COLUMN IF NOT EXISTS weights JSON DEFAULT '{}'",
    "ALTER TABLE tiq_joblens_sessions ADD COLUMN IF NOT EXISTS disqualifiers JSON DEFAULT '{}'",

    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS technical_score FLOAT DEFAULT 0.0",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS non_technical_score FLOAT",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS logistics JSON DEFAULT '{}'",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS hard_disqualified BOOLEAN DEFAULT FALSE",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS disqualify_reason VARCHAR(300)",

    # JD Management: same logistics constraints, so a JD authored/tracked
    # there can feed CandidateLens sessions created from it (jd_record_id
    # link already exists) without re-entering budget/notice constraints.
    "ALTER TABLE tiq_jd_records ADD COLUMN IF NOT EXISTS salary_budget_min INTEGER DEFAULT 0",
    "ALTER TABLE tiq_jd_records ADD COLUMN IF NOT EXISTS salary_budget_max INTEGER DEFAULT 0",
    "ALTER TABLE tiq_jd_records ADD COLUMN IF NOT EXISTS max_notice_days INTEGER DEFAULT 0",
    "ALTER TABLE tiq_jd_records ADD COLUMN IF NOT EXISTS remote_allowed BOOLEAN DEFAULT FALSE",

    # ── Zero-cost semantic search: pgvector on the SAME Postgres DB ──────
    # (Supabase/Neon both support this extension natively) instead of a
    # separate Qdrant/Pinecone service. See utils/embeddings.py and
    # models.SkillTaxonomy.embedding. Safe no-op if the extension is
    # already present or unavailable on this Postgres tier — caught by
    # migrate_fix.py's existing per-statement try/except below, and the
    # embedding column falls back to plain JSON storage (see models.py's
    # guarded Vector import) if the extension truly can't be created.
    "CREATE EXTENSION IF NOT EXISTS vector",
    "ALTER TABLE tiq_skill_taxonomy ADD COLUMN IF NOT EXISTS embedding vector(384)",
    # Approximate nearest-neighbor index (cosine distance) — makes
    # semantic taxonomy lookup fast even at tens of thousands of terms.
    # Requires at least a few rows to build well; harmless to create early.
    "CREATE INDEX IF NOT EXISTS idx_tiq_skill_taxonomy_embedding "
    "ON tiq_skill_taxonomy USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)",

    # ── Fix: duplicate Organisation rows from a create-race ─────────────
    # get_or_create_default_organisation() had a check-then-insert race:
    # the Talent Pool page fires several requests concurrently on load,
    # and on a brand-new account each one could see "no organisation yet"
    # before any of them committed. The unique constraint on
    # public_apply_slug caught most collisions (as a crash — now fixed in
    # service.py), but if two racing requests ever computed genuinely
    # different slugs, BOTH inserts could succeed, leaving two
    # Organisation rows for the same owner_user_id. From then on, every
    # request for that account hit the same crash permanently — reported
    # as "csv import failed" / "candidates list failed with 500" even on
    # a clean reinstall, because reinstalling the app never touches
    # existing production data. This repoints every affected row to the
    # oldest (canonical) organisation per user, removes the duplicates,
    # then adds a real database-level uniqueness guarantee so this class
    # of bug can't happen again regardless of application-level races.
    """
    UPDATE tiq_candidates t SET organisation_id = c.keep_id
    FROM tiq_organisations o
    JOIN (SELECT owner_user_id, MIN(id) AS keep_id FROM tiq_organisations GROUP BY owner_user_id) c
      ON o.owner_user_id = c.owner_user_id
    WHERE t.organisation_id = o.id AND o.id <> c.keep_id
    """,
    """
    UPDATE tiq_talent_pools t SET organisation_id = c.keep_id
    FROM tiq_organisations o
    JOIN (SELECT owner_user_id, MIN(id) AS keep_id FROM tiq_organisations GROUP BY owner_user_id) c
      ON o.owner_user_id = c.owner_user_id
    WHERE t.organisation_id = o.id AND o.id <> c.keep_id
    """,
    """
    UPDATE tiq_candidate_merge_log t SET organisation_id = c.keep_id
    FROM tiq_organisations o
    JOIN (SELECT owner_user_id, MIN(id) AS keep_id FROM tiq_organisations GROUP BY owner_user_id) c
      ON o.owner_user_id = c.owner_user_id
    WHERE t.organisation_id = o.id AND o.id <> c.keep_id
    """,
    """
    UPDATE tiq_applications t SET organisation_id = c.keep_id
    FROM tiq_organisations o
    JOIN (SELECT owner_user_id, MIN(id) AS keep_id FROM tiq_organisations GROUP BY owner_user_id) c
      ON o.owner_user_id = c.owner_user_id
    WHERE t.organisation_id = o.id AND o.id <> c.keep_id
    """,
    """
    UPDATE tiq_requisitions t SET organisation_id = c.keep_id
    FROM tiq_organisations o
    JOIN (SELECT owner_user_id, MIN(id) AS keep_id FROM tiq_organisations GROUP BY owner_user_id) c
      ON o.owner_user_id = c.owner_user_id
    WHERE t.organisation_id = o.id AND o.id <> c.keep_id
    """,
    """
    UPDATE tiq_client_contacts t SET organisation_id = c.keep_id
    FROM tiq_organisations o
    JOIN (SELECT owner_user_id, MIN(id) AS keep_id FROM tiq_organisations GROUP BY owner_user_id) c
      ON o.owner_user_id = c.owner_user_id
    WHERE t.organisation_id = o.id AND o.id <> c.keep_id
    """,
    """
    DELETE FROM tiq_organisations o
    USING (SELECT owner_user_id, MIN(id) AS keep_id FROM tiq_organisations GROUP BY owner_user_id) c
    WHERE o.owner_user_id = c.owner_user_id AND o.id <> c.keep_id
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_tiq_organisations_owner_user_id ON tiq_organisations(owner_user_id)",

    # ── Defensive safety net for capabilities/acquisition tables ────────
    # The actual bug that triggered this: cover_letter_* columns were
    # added to the Candidate model AFTER tiq_candidates already existed
    # live (create_all only creates missing TABLES, never adds columns to
    # ones that already exist) — reported directly as:
    # asyncpg.exceptions.UndefinedColumnError: column
    # tiq_candidates.cover_letter_blob does not exist.
    #
    # Rather than fix only that one column and risk missing the next one
    # the same way, every NULLABLE column on every acquisition-capability
    # table is listed here defensively. ADD COLUMN IF NOT EXISTS is a
    # guaranteed no-op for columns that already exist, so this is 100%
    # safe to run against a database that's already fully up to date —
    # it costs nothing and closes off this entire class of bug for these
    # tables going forward. (NOT NULL / primary-key columns are
    # deliberately excluded — those are guaranteed present since table
    # creation and adding them defensively would carry real risk instead
    # of being a safe no-op.)
    "ALTER TABLE tiq_organisations ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE",

    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS owner_user_id INTEGER",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS sequence_number INTEGER",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS email VARCHAR(200)",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS phone VARCHAR(50)",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS location VARCHAR(300)",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS linkedin_url TEXT",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS portfolio_url TEXT",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS current_employer VARCHAR(300)",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS current_title VARCHAR(300)",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS total_experience_years VARCHAR(20)",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS skills JSON",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS education TEXT",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS certifications JSON",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS work_rights VARCHAR(100)",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS salary_expectation VARCHAR(100)",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS notice_period_days INTEGER",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS preferred_locations JSON",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS preferred_employment_type VARCHAR(100)",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS availability VARCHAR(100)",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS source VARCHAR(100)",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS referral_source VARCHAR(300)",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS consent_given BOOLEAN",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS consent_at TIMESTAMP WITHOUT TIME ZONE",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS status VARCHAR(30)",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS tags JSON",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS resume_blob BYTEA",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS resume_filename VARCHAR(300)",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS resume_mimetype VARCHAR(100)",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS resume_text TEXT",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS cover_letter_blob BYTEA",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS cover_letter_filename VARCHAR(300)",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS cover_letter_mimetype VARCHAR(100)",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS cover_letter_text TEXT",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS notes TEXT",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITHOUT TIME ZONE",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS portal_token VARCHAR(64)",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS is_merged BOOLEAN",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS merged_into_id INTEGER",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE",
    "ALTER TABLE tiq_candidates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE",

    "ALTER TABLE tiq_talent_pools ADD COLUMN IF NOT EXISTS description TEXT",
    "ALTER TABLE tiq_talent_pools ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE",

    "ALTER TABLE tiq_candidate_pool_members ADD COLUMN IF NOT EXISTS added_at TIMESTAMP WITHOUT TIME ZONE",

    "ALTER TABLE tiq_candidate_merge_log ADD COLUMN IF NOT EXISTS field_snapshot JSON",
    "ALTER TABLE tiq_candidate_merge_log ADD COLUMN IF NOT EXISTS merged_at TIMESTAMP WITHOUT TIME ZONE",

    "ALTER TABLE tiq_applications ADD COLUMN IF NOT EXISTS requisition_id INTEGER",
    "ALTER TABLE tiq_applications ADD COLUMN IF NOT EXISTS jd_record_id INTEGER",
    "ALTER TABLE tiq_applications ADD COLUMN IF NOT EXISTS source VARCHAR(100)",
    "ALTER TABLE tiq_applications ADD COLUMN IF NOT EXISTS stage VARCHAR(50)",
    "ALTER TABLE tiq_applications ADD COLUMN IF NOT EXISTS applied_at TIMESTAMP WITHOUT TIME ZONE",
    "ALTER TABLE tiq_applications ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE",
    "ALTER TABLE tiq_applications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE",

    # Phase 2 — Job Requisitions: tiq_requisitions already exists as a
    # Phase 0/1 stub (id/organisation_id/owner_user_id/client_id/title/
    # status/created_at/updated_at only); these add the full intake
    # workflow. tiq_client_contacts is a brand-new table, created
    # automatically by create_all() — no migration needed for it.
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS sequence_number INTEGER",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS jd_record_id INTEGER REFERENCES tiq_jd_records(id)",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'Normal'",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS vacancy_count INTEGER DEFAULT 1",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS reason_for_hire VARCHAR(30)",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS employment_type VARCHAR(50)",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS location VARCHAR(300)",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS salary_min INTEGER",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS salary_max INTEGER",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS target_hire_date TIMESTAMP",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS hiring_manager_contact_id INTEGER",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS hiring_manager_name VARCHAR(200)",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS hiring_manager_email VARCHAR(200)",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS salary_approved BOOLEAN DEFAULT FALSE",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS headcount_approved BOOLEAN DEFAULT FALSE",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS jd_approved BOOLEAN DEFAULT FALSE",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS location_confirmed BOOLEAN DEFAULT FALSE",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS approved_by_user_id INTEGER REFERENCES tiq_users(id)",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS hm_view_token VARCHAR(64)",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS notes TEXT",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_tiq_requisitions_hm_view_token ON tiq_requisitions(hm_view_token)",

    # ── Data repair: Req # (sequence_number) duplicates ──────────────────
    # csv_import_requisitions used to call the "SELECT MAX(sequence_number)
    # + 1" helper once PER ROW inside a loop, all within the same
    # not-yet-committed transaction — so several rows in one CSV import
    # could see the same MAX and get handed the same, or an
    # out-of-order, sequence_number. Fixed going forward (see
    # capabilities/requisition/router.py), but this repairs data already
    # created by the buggy version: renumber every existing requisition
    # sequentially, per organisation, in original creation order (by id).
    # Idempotent — re-running this once numbers are already clean is a
    # no-op, since the WHERE clause only touches rows that disagree.
    """
    UPDATE tiq_requisitions r
    SET sequence_number = ranked.rn
    FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY organisation_id ORDER BY id) AS rn
        FROM tiq_requisitions
    ) ranked
    WHERE r.id = ranked.id AND r.sequence_number IS DISTINCT FROM ranked.rn
    """,

    # ── Interview Management (Phase 4) — defensive retrofit ──────────────
    # tiq_interviews itself was created fresh via create_all() when
    # Interview Management first shipped, so this single column is the
    # only entry needed here — everything else on that table got its
    # index/column correctly from the initial CREATE TABLE. Added here
    # (not just in the model) in case an install already ran that first
    # version before interview_type existed: ALTER on an already-existing
    # table needs an explicit statement, same reasoning as every other
    # entry in this file (see the acquisition/requisition retrofit
    # entries above, and capabilities/interview/models.py's own docstring
    # for the fresh-vs-ALTER distinction this file exists to bridge).
    "ALTER TABLE tiq_interviews ADD COLUMN IF NOT EXISTS interview_type VARCHAR(30) DEFAULT 'HR Screening'",
    "ALTER TABLE tiq_interviews ALTER COLUMN interview_type SET DEFAULT 'Phone Interview'",

    # ── Interview Management — Screening/Approval/Panel-Majority additions ──
    # tiq_interviews already existed (created above by the entry just
    # above this one), so every new column needs its own explicit ALTER —
    # create_all() alone never adds columns to a table that already
    # exists. tiq_interview_feedback_links is a BRAND NEW table, so it
    # needs no ALTER entry at all — create_all() in main.py's lifespan
    # handles it the same way it did tiq_interviews and
    # tiq_interview_scorecards on first deploy.
    "ALTER TABLE tiq_interviews ADD COLUMN IF NOT EXISTS decision VARCHAR(20) DEFAULT 'Pending'",
    "ALTER TABLE tiq_interviews ADD COLUMN IF NOT EXISTS decision_finalized_at TIMESTAMP",
    "ALTER TABLE tiq_interviews ADD COLUMN IF NOT EXISTS approver_name VARCHAR(200)",
    "ALTER TABLE tiq_interviews ADD COLUMN IF NOT EXISTS approver_email VARCHAR(200)",
    "ALTER TABLE tiq_interviews ADD COLUMN IF NOT EXISTS approver_user_id INTEGER REFERENCES tiq_users(id)",
    "ALTER TABLE tiq_interviews ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) DEFAULT 'Pending'",
    "ALTER TABLE tiq_interviews ADD COLUMN IF NOT EXISTS approval_token VARCHAR(64)",
    "ALTER TABLE tiq_interviews ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP",
    "ALTER TABLE tiq_interviews ADD COLUMN IF NOT EXISTS approved_by VARCHAR(200)",
    "ALTER TABLE tiq_interviews ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP",
    "ALTER TABLE tiq_interviews ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(200)",
    "ALTER TABLE tiq_interviews ADD COLUMN IF NOT EXISTS artifacts JSON DEFAULT '[]'",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_tiq_interviews_approval_token ON tiq_interviews(approval_token)",

    # Interview-scheduling integration with JobLens/CandidateLens (Resume
    # Screening / Phone Interview / Video Interview) — those candidates
    # live in tiq_joblens_candidates, a separate table from the Talent
    # Pool's tiq_candidates that candidate_id has always pointed at.
    # candidate_id must become nullable for a JobLens-originated
    # interview row to be insertable at all (it has NO Talent Pool
    # Candidate to reference), and joblens_candidate_id is the
    # alternative reference for that case — see Interview.candidate_id's
    # docstring in capabilities/interview/models.py for the "exactly one
    # of the two is set" rule this enables.
    "ALTER TABLE tiq_interviews ALTER COLUMN candidate_id DROP NOT NULL",
    "ALTER TABLE tiq_interviews ADD COLUMN IF NOT EXISTS joblens_candidate_id INTEGER REFERENCES tiq_joblens_candidates(id)",

    # Interview Scheduling was simplified twice: first to a Resume
    # Screening -> Telephonic -> Video -> Panel sequence, then again to
    # exactly three classes (Phone Interview / Video Interview / Panel
    # Interview) once Resume Screening moved into its own capability
    # (the CandidateLens split — see frontend/src/lib/capabilities.ts)
    # and "Video Interview (AI Avatar)" was folded into "Video Interview"
    # as a delivery mode rather than its own type (see
    # capabilities/avatarinterview/router.py's AVATAR_INTERVIEW_TYPE).
    # Remap every old value onto its closest equivalent so no existing
    # row is left holding a value outside the current models.INTERVIEW_TYPES.
    # Resume Screening rounds have no equivalent left in Interview
    # Scheduling at all (that stage now lives entirely in the Screening
    # capability) — remapped to Phone Interview as the closest "first
    # live conversation" stage, rather than left dangling.
    "UPDATE tiq_interviews SET interview_type = 'Panel Interview' WHERE interview_type = 'Panel'",
    "UPDATE tiq_interviews SET interview_type = 'Phone Interview' WHERE interview_type IN ('Telephonic Screening', 'Telephonic Interview', 'HR Screening', 'Resume Screening')",
    "UPDATE tiq_interviews SET interview_type = 'Video Interview' WHERE interview_type = 'Video Interview (AI Avatar)'",
    "UPDATE tiq_interviews SET interview_type = 'Panel Interview' WHERE interview_type IN ('Specialist', 'Hiring Manager')",

    # ── AI Avatar Interviews — Q&A evaluation write-back to CandidateLens ──
    # tiq_joblens_candidates has been live since Phase 3, so these two new
    # columns need the same explicit ALTER treatment as everything else in
    # this file — create_all() alone won't add columns to a table that
    # already exists. See capabilities/avatarinterview/models.py's module
    # docstring for what writes to these.
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS qa_evaluation JSON",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS qa_evaluation_score FLOAT",

    # ── CandidateLens split: Phone Interview stage ──────────────────────
    # tiq_joblens_candidates already existed, so these four new columns
    # (see JobLensCandidate's own docstring) need the same explicit ALTER
    # treatment as everything else in this file.
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS phone_screening_status VARCHAR(20) DEFAULT 'Not Started'",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS phone_screening_recommendation VARCHAR(20)",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS phone_screening_notes TEXT",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS phone_screening_at TIMESTAMP",

    # video_screening_recommendation/_notes/_at (JobLensCandidate model) —
    # the video-stage equivalent of the three phone_screening_* columns
    # directly above, added to the model but MISSING from this file, which
    # is exactly why they never existed on the real database: every query
    # against tiq_joblens_candidates (GET /api/joblens/sessions/{id}
    # included) was crashing with a "column does not exist" error the
    # moment it hit the DB, surfacing to the frontend as a 500 and,
    # without an error boundary, a blank page — nothing about this was a
    # frontend bug, the page had nothing to render because the API call
    # backing it never succeeded.
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS video_screening_recommendation VARCHAR(20)",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS video_screening_notes TEXT",
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS video_screening_at TIMESTAMP",

    # Requisition: JD document (Text/Word/PDF) attached directly on the
    # requisition itself, next to Title — see Requisition's docstring.
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS jd_file_blob BYTEA",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS jd_file_filename VARCHAR(300)",
    "ALTER TABLE tiq_requisitions ADD COLUMN IF NOT EXISTS jd_file_mimetype VARCHAR(100)",

    # CandidateLens: candidates sourced from a Requisition's submitted
    # Applications (Candidate Acquisition capability), alongside the
    # existing Vendor Management source_tracked_candidate_id.
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS source_application_id INTEGER",

    # CandidateLens: timestamp of the candidate accepting the pre-interview
    # recording/privacy notice — gates camera access on the public page.
    "ALTER TABLE tiq_joblens_candidates ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMP",
]

async def run():
    # The real cost here isn't any one statement — it's that `--reload`
    # re-runs this ENTIRE ~65-statement pass on every single file save
    # during development, even when nothing schema-related changed at all.
    # We fingerprint the MIGRATIONS list itself; if it's identical to the
    # last successful run, skip straight past the whole thing (one fast
    # query) instead of re-checking every statement again.
    migrations_fingerprint = hashlib.sha256("\n".join(MIGRATIONS).encode()).hexdigest()

    async with engine.connect() as conn:
        autocommit_conn = await conn.execution_options(isolation_level="AUTOCOMMIT")

        await autocommit_conn.execute(text(
            "CREATE TABLE IF NOT EXISTS tiq_migration_state (id INTEGER PRIMARY KEY, fingerprint VARCHAR(64))"
        ))
        existing = (await autocommit_conn.execute(
            text("SELECT fingerprint FROM tiq_migration_state WHERE id = 1")
        )).scalar_one_or_none()

        if existing == migrations_fingerprint:
            print(f"  Migrations unchanged since last run ({len(MIGRATIONS)} statements) — skipping.")
            return

        for sql in MIGRATIONS:
            try:
                await autocommit_conn.execute(text(sql))
                print(f"  OK: {sql[:60]}")
            except Exception as e:
                err = str(e)
                if "does not exist" in err or "already exists" in err or "cannot alter" in err.lower():
                    print(f"  SKIP (already ok): {sql[:60]}")
                else:
                    print(f"  WARN: {err[:100]}")

        await autocommit_conn.execute(
            text("INSERT INTO tiq_migration_state (id, fingerprint) VALUES (1, :fp) "
                 "ON CONFLICT (id) DO UPDATE SET fingerprint = :fp"),
            {"fp": migrations_fingerprint},
        )
    print("  Migration complete.")

if __name__ == "__main__":
    asyncio.run(run())