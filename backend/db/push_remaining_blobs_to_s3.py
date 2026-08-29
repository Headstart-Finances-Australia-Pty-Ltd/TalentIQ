"""
Pushes every remaining *_blob row (video, resume, JD, cover letter)
still sitting in Postgres out to S3/R2, then clears the blob column —
finishing the migration for anything uploaded before S3 was configured
(or during a window where it was misconfigured and silently fell back).

Run GET /api/admin/storage/blob-audit first (Admin Console, or via
/api/docs) to see counts before running this — this script processes
exactly what that audit reports.

Requires S3 to already be configured and working in Admin Console >
API Keys > S3 (this script uses the exact same saved credentials the
app itself uses — it does not take separate S3 args).

USAGE:
    python db\\push_remaining_blobs_to_s3.py

Safe to re-run: only rows where the *_key column is still empty AND
the *_blob column has data get processed; anything already migrated
(this run or a previous one) is skipped.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from sqlalchemy import select, text

from db.database import AsyncSessionLocal, engine
from utils.storage import upload_file, upload_video_and_get_key, get_s3_client


async def run():
    async with AsyncSessionLocal() as db:
        client, bucket = await get_s3_client(db)
        if not client:
            print("S3 isn't configured (or the saved credentials don't work) — "
                  "set it up and confirm Test Connection succeeds in Admin Console > "
                  "API Keys first, then re-run this script.")
            return

        total_migrated = 0
        total_failed = 0

        # ── JobLensCandidate: video + resume ────────────────────────────
        rows = (await db.execute(text(
            "SELECT c.id, c.video_blob, c.video_mimetype, s.user_id "
            "FROM tiq_joblens_candidates c JOIN tiq_joblens_sessions s ON c.session_id = s.id "
            "WHERE c.video_blob IS NOT NULL AND (c.video_key IS NULL OR c.video_key = '')"
        ))).all()
        print(f"\n  CandidateLens videos still in Postgres: {len(rows)}")
        for cid, blob, mimetype, user_id in rows:
            uploaded = await upload_video_and_get_key(db, user_id, cid, blob, mimetype or "video/webm")
            if uploaded:
                await db.execute(text(
                    "UPDATE tiq_joblens_candidates SET video_key = :k, video_size_bytes = :sz, video_blob = NULL WHERE id = :id"
                ), {"k": uploaded["key"], "sz": uploaded["size_bytes"], "id": cid})
                await db.commit()
                total_migrated += 1
                print(f"    candidate {cid}: migrated ({uploaded['size_bytes']} bytes) -> {uploaded['key']}")
            else:
                total_failed += 1
                print(f"    candidate {cid}: upload failed, left as-is")

        rows = (await db.execute(text(
            "SELECT c.id, c.resume_file_blob, c.resume_file_mimetype, c.filename, s.user_id "
            "FROM tiq_joblens_candidates c JOIN tiq_joblens_sessions s ON c.session_id = s.id "
            "WHERE c.resume_file_blob IS NOT NULL AND (c.resume_key IS NULL OR c.resume_key = '')"
        ))).all()
        print(f"\n  CandidateLens resumes still in Postgres: {len(rows)}")
        for cid, blob, mimetype, filename, user_id in rows:
            ext = (filename or "").rsplit(".", 1)[-1].lower() if filename and "." in filename else "bin"
            uploaded = await upload_file(db, "resumes", user_id, cid, blob, mimetype or "application/octet-stream", ext)
            if uploaded:
                await db.execute(text(
                    "UPDATE tiq_joblens_candidates SET resume_key = :k, resume_size_bytes = :sz, resume_file_blob = NULL WHERE id = :id"
                ), {"k": uploaded["key"], "sz": uploaded["size_bytes"], "id": cid})
                await db.commit()
                total_migrated += 1
                print(f"    candidate {cid}: migrated ({uploaded['size_bytes']} bytes) -> {uploaded['key']}")
            else:
                total_failed += 1
                print(f"    candidate {cid}: upload failed, left as-is")

        # ── JDRecord (JD Management) ─────────────────────────────────────
        rows = (await db.execute(text(
            "SELECT id, jd_file_blob, jd_file_mimetype, jd_file_filename, user_id "
            "FROM tiq_jd_records WHERE jd_file_blob IS NOT NULL AND (jd_file_key IS NULL OR jd_file_key = '')"
        ))).all()
        print(f"\n  JD Management files still in Postgres: {len(rows)}")
        for jid, blob, mimetype, filename, user_id in rows:
            ext = (filename or "").rsplit(".", 1)[-1].lower() if filename and "." in filename else "bin"
            uploaded = await upload_file(db, "jds", user_id, jid, blob, mimetype or "application/octet-stream", ext)
            if uploaded:
                await db.execute(text(
                    "UPDATE tiq_jd_records SET jd_file_key = :k, jd_file_size_bytes = :sz, jd_file_blob = NULL WHERE id = :id"
                ), {"k": uploaded["key"], "sz": uploaded["size_bytes"], "id": jid})
                await db.commit()
                total_migrated += 1
                print(f"    JD {jid}: migrated ({uploaded['size_bytes']} bytes) -> {uploaded['key']}")
            else:
                total_failed += 1
                print(f"    JD {jid}: upload failed, left as-is")

        # ── Requisition JD file ───────────────────────────────────────────
        rows = (await db.execute(text(
            "SELECT r.id, r.jd_file_blob, r.jd_file_mimetype, r.jd_file_filename, o.owner_user_id "
            "FROM tiq_requisitions r JOIN tiq_organisations o ON r.organisation_id = o.id "
            "WHERE r.jd_file_blob IS NOT NULL AND (r.jd_file_key IS NULL OR r.jd_file_key = '')"
        ))).all()
        print(f"\n  Requisition JD files still in Postgres: {len(rows)}")
        for rid, blob, mimetype, filename, user_id in rows:
            ext = (filename or "").rsplit(".", 1)[-1].lower() if filename and "." in filename else "bin"
            uploaded = await upload_file(db, "jds", user_id, rid, blob, mimetype or "application/octet-stream", ext)
            if uploaded:
                await db.execute(text(
                    "UPDATE tiq_requisitions SET jd_file_key = :k, jd_file_size_bytes = :sz, jd_file_blob = NULL WHERE id = :id"
                ), {"k": uploaded["key"], "sz": uploaded["size_bytes"], "id": rid})
                await db.commit()
                total_migrated += 1
                print(f"    requisition {rid}: migrated ({uploaded['size_bytes']} bytes) -> {uploaded['key']}")
            else:
                total_failed += 1
                print(f"    requisition {rid}: upload failed, left as-is")

        # ── TrackedCandidate: resume + cover letter ──────────────────────
        rows = (await db.execute(text(
            "SELECT id, resume_blob, resume_mimetype, resume_filename, user_id "
            "FROM tiq_tracked_candidates WHERE resume_blob IS NOT NULL AND (resume_key IS NULL OR resume_key = '')"
        ))).all()
        print(f"\n  Vendor Management resumes still in Postgres: {len(rows)}")
        for tid, blob, mimetype, filename, user_id in rows:
            ext = (filename or "").rsplit(".", 1)[-1].lower() if filename and "." in filename else "bin"
            uploaded = await upload_file(db, "resumes", user_id, tid, blob, mimetype or "application/octet-stream", ext)
            if uploaded:
                await db.execute(text(
                    "UPDATE tiq_tracked_candidates SET resume_key = :k, resume_size_bytes = :sz, resume_blob = NULL WHERE id = :id"
                ), {"k": uploaded["key"], "sz": uploaded["size_bytes"], "id": tid})
                await db.commit()
                total_migrated += 1
                print(f"    tracked candidate {tid}: migrated ({uploaded['size_bytes']} bytes) -> {uploaded['key']}")
            else:
                total_failed += 1
                print(f"    tracked candidate {tid}: upload failed, left as-is")

        rows = (await db.execute(text(
            "SELECT id, cover_letter_blob, cover_letter_mimetype, cover_letter_filename, user_id "
            "FROM tiq_tracked_candidates WHERE cover_letter_blob IS NOT NULL AND (cover_letter_key IS NULL OR cover_letter_key = '')"
        ))).all()
        print(f"\n  Vendor Management cover letters still in Postgres: {len(rows)}")
        for tid, blob, mimetype, filename, user_id in rows:
            ext = (filename or "").rsplit(".", 1)[-1].lower() if filename and "." in filename else "bin"
            uploaded = await upload_file(db, "cover-letters", user_id, tid, blob, mimetype or "application/octet-stream", ext)
            if uploaded:
                await db.execute(text(
                    "UPDATE tiq_tracked_candidates SET cover_letter_key = :k, cover_letter_size_bytes = :sz, cover_letter_blob = NULL WHERE id = :id"
                ), {"k": uploaded["key"], "sz": uploaded["size_bytes"], "id": tid})
                await db.commit()
                total_migrated += 1
                print(f"    tracked candidate {tid}: migrated cover letter ({uploaded['size_bytes']} bytes) -> {uploaded['key']}")
            else:
                total_failed += 1
                print(f"    tracked candidate {tid}: upload failed, left as-is")

        print(f"\n  Done. {total_migrated} file(s) migrated to S3, {total_failed} failed (left in Postgres, safe to re-run).")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run())
