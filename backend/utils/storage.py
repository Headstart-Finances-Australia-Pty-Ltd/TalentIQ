"""
TalentIQ - Object storage (S3-compatible) helper.

Reads bucket credentials from the platform-wide "s3" global credential
set (see utils/credentials.py + Admin Console > API Keys) rather than
hardcoded env vars, so an admin can configure/rotate the bucket entirely
from the UI. Works against AWS S3, Cloudflare R2, Backblaze B2, or any
other S3-compatible endpoint — set endpoint_url for anything that isn't
real AWS S3 (R2/B2 etc. require it; AWS S3 should leave it blank).

Expected key_name fields under service="s3" (all set as global/admin
keys, e.g. via the existing POST /api/auth/api-keys with is_global=true):
    access_key_id       - required
    secret_access_key   - required
    bucket_name          - required
    region                - optional, defaults to "auto" (R2's convention;
                            harmless for AWS S3 too as long as endpoint_url
                            is also set correctly)
    endpoint_url          - required for R2/B2/other S3-compatible; leave
                            unset for real AWS S3 (boto3 resolves the
                            regional endpoint itself in that case)

Interview videos (JobLensCandidate.video_key in models/models.py) are
wired to this module: routers/joblens.py's upload endpoints transcode
+ upload here and store the resulting object key; the serve/stream
endpoints fetch a presigned URL or the raw bytes from here. video_blob
(the old direct-to-Postgres column) is kept only as a legacy fallback
for rows stored before S3 was configured, or for deployments that
haven't configured object storage at all — see upload_video_and_get_key
and get_video_bytes below, both of which are None-safe if S3 isn't
configured, so the app keeps working (just storing in Postgres again)
until an admin sets up the bucket in Admin Console > API Keys.
"""
import asyncio
import re
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Optional, TypedDict
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from utils.credentials import get_global_credentials

REQUIRED_S3_FIELDS = ("access_key_id", "secret_access_key", "bucket_name")


class S3Config(TypedDict, total=False):
    access_key_id: str
    secret_access_key: str
    bucket_name: str
    region: str
    endpoint_url: str


async def get_s3_config(db: AsyncSession) -> Optional[S3Config]:
    """The currently-saved global S3 config, or None if not (yet) fully
    configured — missing any required field is treated as unconfigured
    rather than a partial/broken config, since a half-entered form (e.g.
    saved mid-typing) shouldn't be attempted against the real bucket.

    `db` is accepted for backward compatibility but deliberately NOT used
    for the actual query below — see _account_folder's docstring for why.
    Storage helpers are routinely called from CONCURRENT candidate/JD
    processing (CandidateLens/JobLens scoring several resumes at once via
    asyncio.gather), all sharing the caller's single AsyncSession. Reading
    credentials through that shared session from multiple coroutines at
    once is exactly the "session is provisioning a new connection;
    concurrent operations are not permitted" IllegalStateChangeError this
    used to throw. An independent, short-lived session sidesteps that
    entirely, the same fix already applied to ExtractionCache lookups."""
    from db.database import AsyncSessionLocal
    async with AsyncSessionLocal() as cfg_db:
        creds = await get_global_credentials(cfg_db, "s3")
    if not all(creds.get(f) for f in REQUIRED_S3_FIELDS):
        return None
    return {
        "access_key_id": creds["access_key_id"],
        "secret_access_key": creds["secret_access_key"],
        "bucket_name": creds["bucket_name"],
        "region": creds.get("region") or "auto",
        "endpoint_url": creds.get("endpoint_url") or "",
    }


def _build_client(cfg: S3Config):
    """Builds a boto3 S3 client from a config dict. Import of boto3 is
    deferred to here (rather than module top-level) so the rest of the
    app doesn't hard-fail on import if boto3 isn't installed yet in an
    environment that hasn't opted into object storage at all."""
    import boto3
    from botocore.config import Config as BotoConfig

    kwargs = dict(
        aws_access_key_id=cfg["access_key_id"],
        aws_secret_access_key=cfg["secret_access_key"],
        region_name=cfg.get("region") or "auto",
        config=BotoConfig(signature_version="s3v4"),
    )
    if cfg.get("endpoint_url"):
        kwargs["endpoint_url"] = cfg["endpoint_url"]
    return boto3.client("s3", **kwargs)


async def get_s3_client(db: AsyncSession):
    """Returns (client, bucket_name), or (None, None) if not configured.
    A fresh client is built per call rather than cached — config changes
    (e.g. an admin rotating the secret key) take effect on the very next
    call with no restart or manual cache invalidation needed. Bucket
    operations are infrequent enough (video upload/download, not a hot
    per-request path) that this is not a meaningful perf cost."""
    cfg = await get_s3_config(db)
    if not cfg:
        return None, None
    return _build_client(cfg), cfg["bucket_name"]


def test_s3_config(cfg: S3Config) -> dict:
    """Validates a config WITHOUT persisting anything — used by the Test
    Connection button in Admin Console > API Keys so an admin can catch
    a typo'd key or wrong bucket name before saving it. Runs a HEAD on
    the bucket, which succeeds only if the credentials are valid AND
    have at least read access to that specific bucket."""
    try:
        client = _build_client(cfg)
        client.head_bucket(Bucket=cfg["bucket_name"])
        return {"ok": True, "message": f"Connected — bucket \"{cfg['bucket_name']}\" is reachable and accessible."}
    except ImportError:
        return {"ok": False, "message": "boto3 is not installed on the server yet. Add boto3 to requirements.txt and redeploy, then try again."}
    except Exception as e:
        from botocore.exceptions import ClientError, EndpointConnectionError, NoCredentialsError  # type: ignore
        if isinstance(e, NoCredentialsError):
            return {"ok": False, "message": "Access key / secret key were rejected."}
        if isinstance(e, EndpointConnectionError):
            return {"ok": False, "message": f"Could not reach the endpoint URL — check it's correct and includes https://."}
        if isinstance(e, ClientError):
            code = e.response.get("Error", {}).get("Code", "")
            status = e.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if status == 403 or code in ("403", "AccessDenied"):
                return {"ok": False, "message": "Credentials were accepted but don't have access to this bucket — check the bucket name and the key's permissions."}
            if status == 404 or code in ("404", "NoSuchBucket"):
                return {"ok": False, "message": f"Bucket \"{cfg['bucket_name']}\" was not found at this endpoint/region."}
            return {"ok": False, "message": f"Rejected by the storage provider: {code or str(e)}"}
        return {"ok": False, "message": f"Could not verify the connection: {type(e).__name__}: {e}"}


# ── Generic file storage helpers ────────────────────────────────────────
# Used for every blob type this app stores: interview videos, resumes,
# JD documents, cover letters. Every key is prefixed by the OWNING
# account's folder FIRST, then file-type (resume/jd/video/cover-letter)
# as a subfolder, so:
#   1. Opening the bucket, you see one folder per TalentIQ account
#      (e.g. "Admin-1", "Pramod_Singh-2") with all of that account's
#      files underneath — nothing from one account ever lands inside
#      another account's folder, by construction (the prefix IS the
#      account boundary).
#   2. The account folder name is human-readable (derived from the
#      user's name, falling back to their email) but still guaranteed
#      unique and STABLE even if they later rename their profile — it's
#      suffixed with their numeric User.id, which never changes, so a
#      display-name edit doesn't split one account's files across two
#      folders or collide with another account that happens to share a
#      name.
#   3. This is folder-level hygiene for browsability, not the actual
#      access-control mechanism — that's still the router-level
#      session.user_id / current_user.id ownership checks, same as
#      before. Presigned URLs are short-lived and callers still go
#      through those checks to obtain one; the folder layout just makes
#      "whose data is this" obvious to a human browsing the bucket too.
# All of it is None-safe: if S3 isn't configured, these return None (or
# leave data as-is) rather than raising, so every caller falls back to
# its legacy *_blob-in-Postgres column instead.

_ACCOUNT_FOLDER_RE = re.compile(r"[^A-Za-z0-9]+")


async def _account_folder(db: AsyncSession, account_id: int) -> str:
    """Resolves a User.id to a human-readable, collision-proof bucket
    folder name, e.g. 5 -> "Admin-5". Falls back to the email's local
    part if the user has no display name set, and to a bare "user-{id}"
    if the account can't be found at all (shouldn't normally happen,
    but a storage helper failing an upload because a name lookup came
    back empty would be a worse outcome than a slightly generic folder
    name).

    Deliberately opens its OWN short-lived session instead of reusing the
    caller's `db` (kept as a param only for a stable call signature).
    upload_file()/get_file_bytes()/etc. are called from inside
    _score_and_build_candidate in routers/joblens.py, which runs
    CONCURRENTLY across several candidates in one CandidateLens batch
    (bounded by _score_semaphore) all sharing one AsyncSession —
    SQLAlchemy's AsyncSession isn't safe for genuinely concurrent
    `db.execute()` calls from multiple coroutines, which is what was
    surfacing as "This session is provisioning a new connection;
    concurrent operations are not permitted" and silently dropping
    whichever candidates lost that race. An isolated session here makes
    every storage helper safe to call from any concurrency pattern the
    callers use, present or future — same fix as ExtractionCache's own
    lookup/write helpers."""
    from db.database import AsyncSessionLocal
    async with AsyncSessionLocal() as folder_db:
        row = (await folder_db.execute(
            text("SELECT name, email FROM tiq_users WHERE id = :uid"), {"uid": account_id}
        )).first()
    if not row:
        return f"user-{account_id}"
    name, email = row
    label = name or (email.split("@")[0] if email else None) or f"user-{account_id}"
    safe = _ACCOUNT_FOLDER_RE.sub("_", label).strip("_") or "user"
    return f"{safe}-{account_id}"


async def _object_key(db: AsyncSession, kind: str, account_id: int, sub_id: int, ext: str) -> str:
    """kind: 'videos' | 'resumes' | 'jds' | 'cover-letters' (subfolder
    under the account's own folder). sub_id: candidate/JD/tracked-
    candidate id, purely for human-readability when browsing the bucket."""
    account_folder = await _account_folder(db, account_id)
    return f"{account_folder}/{kind}/{sub_id}/{uuid.uuid4().hex}.{ext}"


async def upload_file(
    db: AsyncSession, kind: str, account_id: int, sub_id: int,
    content: bytes, content_type: str, ext: str,
) -> Optional[dict]:
    """Uploads any non-video file (resume, JD, cover letter) as-is — no
    transcoding step, unlike video. Returns {"key", "size_bytes",
    "mimetype"} on success, or None if S3 isn't configured."""
    client, bucket = await get_s3_client(db)
    if not client:
        return None
    key = await _object_key(db, kind, account_id, sub_id, ext)
    mimetype = content_type or "application/octet-stream"
    await asyncio.to_thread(
        client.put_object, Bucket=bucket, Key=key, Body=content, ContentType=mimetype
    )
    return {"key": key, "size_bytes": len(content), "mimetype": mimetype}


async def get_file_bytes(db: AsyncSession, key: str) -> Optional[bytes]:
    """Downloads any object's full bytes from S3 — file-type-agnostic.
    Returns None if S3 isn't configured or the object can't be fetched."""
    client, bucket = await get_s3_client(db)
    if not client:
        return None
    try:
        def _fetch():
            obj = client.get_object(Bucket=bucket, Key=key)
            return obj["Body"].read()
        return await asyncio.to_thread(_fetch)
    except Exception:
        return None


async def get_presigned_url(db: AsyncSession, key: str, expires_in: int = 300) -> Optional[str]:
    """Short-lived presigned GET URL for any object. Returns None if S3
    isn't configured."""
    client, bucket = await get_s3_client(db)
    if not client:
        return None
    try:
        return client.generate_presigned_url(
            "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=expires_in,
        )
    except Exception:
        return None


async def delete_file(db: AsyncSession, key: str) -> bool:
    """Deletes any object from the bucket. Returns False (not an
    exception) on any failure — a failed cleanup shouldn't block
    whatever the caller was actually trying to do."""
    client, bucket = await get_s3_client(db)
    if not client:
        return False
    try:
        await asyncio.to_thread(client.delete_object, Bucket=bucket, Key=key)
        return True
    except Exception:
        return False


# ── Video-specific helpers ──────────────────────────────────────────────
# Thin wrappers over the generic helpers above, plus the ffmpeg transcode
# step that only applies to video. Kept as their own named functions
# (rather than making every caller pass kind="videos" + handle transcode
# inline) since routers/joblens.py already imports these names directly.

def transcode_to_mp4(input_bytes: bytes, timeout_seconds: int = 300) -> bytes:
    """Re-encodes arbitrary input video (typically browser-recorded .webm)
    to H.264/AAC .mp4 with a moderate CRF — this is the actual "compress
    without visibly hurting quality" step. faststart moves the moov atom
    to the front of the file so playback can begin before the whole file
    downloads (matters once this is served from S3/R2 instead of a local
    disk). Raises on failure (missing ffmpeg binary, corrupt input, or
    timeout) — callers should catch this and fall back to storing the
    original bytes untranscoded rather than losing the upload entirely.
    """
    with tempfile.TemporaryDirectory() as tmp:
        in_path = Path(tmp) / "in.webm"
        out_path = Path(tmp) / "out.mp4"
        in_path.write_bytes(input_bytes)
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(in_path),
                "-c:v", "libx264", "-preset", "medium", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart",
                str(out_path),
            ],
            capture_output=True, timeout=timeout_seconds,
        )
        if result.returncode != 0 or not out_path.exists():
            raise RuntimeError(
                f"ffmpeg transcode failed (exit {result.returncode}): "
                f"{result.stderr.decode(errors='replace')[-500:]}"
            )
        return out_path.read_bytes()


async def upload_video_and_get_key(
    db: AsyncSession, account_id: int, candidate_id: int, content: bytes, content_type: str,
) -> Optional[dict]:
    """Transcodes + uploads an interview video for one candidate, under
    videos/account-{account_id}/{candidate_id}/. Returns {"key",
    "size_bytes", "mimetype"} on success, or None if S3 isn't configured
    (caller should fall back to video_blob). Transcode failure does NOT
    abort the upload — it falls back to uploading the original bytes
    as-is, so a single malformed clip can't block an interview
    submission; it just won't be compressed.
    """
    client, bucket = await get_s3_client(db)
    if not client:
        return None

    try:
        # transcode_to_mp4 shells out to ffmpeg and blocks until it
        # exits — offload to a thread for the same reason as put_object
        # above (don't stall the event loop for other requests).
        data = await asyncio.to_thread(transcode_to_mp4, content)
        mimetype = "video/mp4"
        ext = "mp4"
    except Exception:
        data = content
        mimetype = content_type or "video/webm"
        ext = "webm"

    key = await _object_key(db, "videos", account_id, candidate_id, ext)
    await asyncio.to_thread(
        client.put_object, Bucket=bucket, Key=key, Body=data, ContentType=mimetype
    )
    return {"key": key, "size_bytes": len(data), "mimetype": mimetype}


async def get_video_bytes(db: AsyncSession, key: str) -> Optional[bytes]:
    """Downloads a video's full bytes from S3 — used by the transcription
    step (Groq's Whisper endpoint needs the actual file, not a URL)."""
    return await get_file_bytes(db, key)


async def get_video_presigned_url(db: AsyncSession, key: str, expires_in: int = 300) -> Optional[str]:
    """Short-lived (default 5 min) presigned GET URL — this is what the
    browser's <video> element streams directly from, so Range requests
    and seeking are handled natively by S3/R2 rather than proxied
    through our own server."""
    return await get_presigned_url(db, key, expires_in)


async def delete_video(db: AsyncSession, key: str) -> bool:
    """Deletes a video object from the bucket."""
    return await delete_file(db, key)
