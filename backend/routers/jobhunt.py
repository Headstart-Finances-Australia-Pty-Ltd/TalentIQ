"""
TalentIQ – JobHunt Router
Endpoints: job search, resume upload, matching, cover letters, export
"""

import asyncio
import io
from typing import List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
import pandas as pd
import fitz  # PyMuPDF
import docx2txt

from db.database import get_db
from models.models import User, Resume, JobSearch, Job, JobMatch, UserAPIKey
from schemas.schemas import (
    JobSearchRequest, JobSearchOut, ResumeOut,
    MatchRequest, JobMatchOut, JobOut,
)
from utils.auth_utils import get_current_user
from utils.credentials import get_credential, get_groq_model, get_all_credentials, ollama_enabled
from utils.sequencing import next_sequence_number
from agents.jobhunt_agent import (
    scrape_jobs_apify_seek, scrape_jobs_apify_linkedin, scrape_jobs_linkedin,
    fetch_job_description, estimate_recency_rank, parse_resume_text,
    calculate_match, generate_cover_letter, extract_candidate_profile,
)

router = APIRouter()


async def _get_user_api_key(user_id: int, service: str, key_name: str, db: AsyncSession) -> str | None:
    # Delegates to the centralized, policy-enforcing lookup — Apify and
    # Groq (used below) are allowed to fall back to an admin-configured
    # global key; every other service never would.
    return await get_credential(db, user_id, service, key_name)


async def _extract_text_from_file(file: UploadFile) -> str:
    content = await file.read()
    filename = (file.filename or "").lower()
    if filename.endswith(".pdf"):
        try:
            doc = fitz.open(stream=content, filetype="pdf")
            return "\n".join(page.get_text() for page in doc)
        except Exception:
            import pypdf, io as _io
            r = pypdf.PdfReader(_io.BytesIO(content))
            return "\n".join(p.extract_text() or "" for p in r.pages)
    elif filename.endswith(".docx"):
        return docx2txt.process(io.BytesIO(content))
    elif filename.endswith(".doc"):
        # Old binary Word format — extract ASCII text stream
        import re as _re
        raw = content.decode("latin-1", errors="ignore")
        chunks = _re.findall(r"[\x20-\x7e\r\n\t]{3,}", raw)
        text = "\n".join(c.strip() for c in chunks if c.strip())
        text = _re.sub(r"bjbj[a-zA-Z0-9]+", "", text)
        text = _re.sub(r"WW8Num\w+", "", text)
        text = _re.sub(r'HYPERLINK\s+"[^"]+"', "", text)
        text = _re.sub(r"\s{4,}", "\n", text)
        return text.strip()
    elif filename.endswith(".txt"):
        return content.decode("utf-8", errors="ignore")
    else:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{filename.split('.')[-1]}'. Please upload PDF, DOCX, DOC, or TXT."
        )


# ─── UPLOAD RESUME ────────────────────────────

@router.post("/resume", response_model=ResumeOut, status_code=201)
async def upload_resume(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    raw_text = await _extract_text_from_file(file)
    parsed = parse_resume_text(raw_text)

    # If same filename already exists for this user, update it instead of duplicating
    existing = await db.execute(
        select(Resume).where(
            Resume.user_id == current_user.id,
            Resume.filename == file.filename,
        )
    )
    resume = existing.scalar_one_or_none()
    if resume:
        resume.raw_text = raw_text
        resume.applicant_name = parsed.get("applicant_name")
        resume.skills = parsed.get("skills", [])
        resume.experience_years = parsed.get("experience_years")
        resume.parsed_data = parsed
    else:
        resume = Resume(
            user_id=current_user.id,
            filename=file.filename,
            raw_text=raw_text,
            applicant_name=parsed.get("applicant_name"),
            skills=parsed.get("skills", []),
            experience_years=parsed.get("experience_years"),
            parsed_data=parsed,
        )
        db.add(resume)
    await db.commit()
    await db.refresh(resume)
    return ResumeOut.model_validate(resume)


@router.get("/resumes", response_model=List[ResumeOut])
async def list_resumes(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Resume).where(Resume.user_id == current_user.id)
        .order_by(Resume.uploaded_at.desc())
    )
    # Deduplicate by filename — keep most recent per filename
    seen = set()
    resumes = []
    for r in result.scalars().all():
        if r.filename not in seen:
            seen.add(r.filename)
            resumes.append(ResumeOut.model_validate(r))
    return resumes


# ─── JOB SEARCH ───────────────────────────────

@router.post("/search", response_model=JobSearchOut, status_code=201)
async def search_jobs(
    payload: JobSearchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Real sources only — LinkedIn's public guest job search needs no
    # credentials at all; Seek runs through the user's own (or an admin's
    # shared) Apify actor. "source" picks which to use; "both" (default)
    # merges them so one source's outage doesn't zero out the search.
    source = (payload.source or "both").strip().lower()
    if source not in ("both", "linkedin", "seek"):
        source = "both"

    raw_jobs: list = []
    source_errors: list[str] = []

    # Shared Apify credentials — used to upgrade LinkedIn to Apify's richer
    # actor below AND for Seek (which has no non-Apify path at all).
    apify_token = await _get_user_api_key(current_user.id, "apify", "api_token", db)
    apify_actor_id = await _get_user_api_key(current_user.id, "apify", "actor_id", db)

    max_results = payload.max_results or 25
    date_posted = (payload.date_posted or "").strip().lower()
    remote_type = (payload.remote_type or "").strip().lower()
    experience_level = (payload.experience_level or "").strip().lower()
    sort_by = (payload.sort_by or "relevance").strip().lower()

    def fetch_linkedin() -> tuple[list, str | None]:
        """Runs on a worker thread (see asyncio.to_thread below) — these
        are blocking `requests` calls, and with "both" sources selected
        we want LinkedIn and Seek in flight at the same time rather than
        one fully finishing before the other starts, which was the
        biggest reason searches felt slow."""
        li_jobs: list = []
        li_error = None
        # Automatic upgrade: if the user has Apify configured, prefer the
        # LinkedIn Jobs Scraper actor — same normalized shape, and (with
        # detail-page fetching off, see scrape_jobs_apify_linkedin) about
        # as fast as the free path while adding Apify's proxying/retry
        # handling in front of it. If it fails for any reason (no Apify
        # credits, actor unavailable, etc.) we fall back to the free
        # scraper instead of failing the whole LinkedIn source — a paid
        # option failing shouldn't be worse than not having it.
        if apify_token:
            li_jobs = scrape_jobs_apify_linkedin(
                role=payload.role, location=payload.location,
                job_type=payload.job_type or "All",
                apify_api_token=apify_token, actor_id=None,  # LinkedIn actor is separate from the Seek actor_id override
                max_results=max_results, date_posted=date_posted,
                remote_type=remote_type, experience_level=experience_level, sort_by=sort_by,
            )
            if li_jobs and len(li_jobs) == 1 and "error" in li_jobs[0]:
                li_error = li_jobs[0]["error"]
                li_jobs = []
        if not li_jobs:
            fallback_jobs = scrape_jobs_linkedin(
                role=payload.role, location=payload.location,
                job_type=payload.job_type or "All",
                max_results=max_results, date_posted=date_posted,
                remote_type=remote_type, experience_level=experience_level, sort_by=sort_by,
            )
            if fallback_jobs and len(fallback_jobs) == 1 and "error" in fallback_jobs[0]:
                combined = f"{li_error}; free fallback also failed: {fallback_jobs[0]['error']}" if li_error else fallback_jobs[0]["error"]
                return [], combined
            return fallback_jobs, None
        return li_jobs, None

    def fetch_seek() -> tuple[list, str | None]:
        seek_jobs = scrape_jobs_apify_seek(
            role=payload.role,
            location=payload.location,
            job_type=payload.job_type or "All",
            salary_min=payload.salary_min,
            salary_max=payload.salary_max,
            apify_api_token=apify_token,
            actor_id=apify_actor_id,
            max_results=max_results,
            date_posted=date_posted,
        )
        if seek_jobs and len(seek_jobs) == 1 and "error" in seek_jobs[0]:
            return [], seek_jobs[0]["error"]
        return seek_jobs, None

    tasks = []
    task_labels = []
    if source in ("both", "linkedin"):
        tasks.append(asyncio.to_thread(fetch_linkedin))
        task_labels.append("LinkedIn")
    if source in ("both", "seek"):
        tasks.append(asyncio.to_thread(fetch_seek))
        task_labels.append("Seek")

    results = await asyncio.gather(*tasks)
    for label, (jobs, error) in zip(task_labels, results):
        if error:
            source_errors.append(f"{label}: {error}")
        else:
            raw_jobs.extend(jobs)

    # Deduplicate across sources (e.g. the same role could plausibly be
    # cross-posted) using the same (title, company) key the individual
    # scrapers already dedupe against internally.
    seen_keys = set()
    deduped = []
    for j in raw_jobs:
        key = ((j.get("title") or "").lower(), (j.get("company") or "").lower())
        if key not in seen_keys:
            seen_keys.add(key)
            deduped.append(j)
    raw_jobs = deduped

    # "Most recent" merge-level sort — each source already asks for its
    # own newest-first order where supported (LinkedIn's sortBy=DD), but
    # merging two sources needs its own consistent ordering on top. Best
    # effort: only jobs with a parseable relative/ISO published_date
    # participate; anything unparseable stays in its original (already
    # roughly-relevant) position at the end rather than being dropped.
    # "relevance" (default) and "ats_score" (no match exists yet at
    # search time) are left in source order — see JobHuntPage.tsx for
    # the client-side ATS-score sort applied after matching completes.
    if sort_by == "recent" and raw_jobs:
        raw_jobs.sort(key=lambda j: estimate_recency_rank(j.get("published_date")))

    # Honest reporting, never fabricated data: if a source failed, say so
    # and show whatever real results the other source(s) found. Only when
    # EVERY requested source failed/returned nothing do we tell the user
    # there's simply nothing to show — no simulated/mock listings are
    # substituted in either case.
    notice = None
    if source_errors and raw_jobs:
        notice = "Partial results — " + "; ".join(source_errors)
    elif source_errors and not raw_jobs:
        notice = "No live results — " + "; ".join(source_errors)
    elif not raw_jobs:
        notice = "No jobs found for this search. Try a broader role or location."

    # Persist search
    seq_num = await next_sequence_number(db, JobSearch, current_user.id)
    search = JobSearch(
        user_id=current_user.id,
        sequence_number=seq_num,
        role=payload.role,
        location=payload.location,
        industry=payload.industry,
        job_type=payload.job_type,
        salary_min=payload.salary_min,
        salary_max=payload.salary_max,
        results_count=len(raw_jobs),
    )
    db.add(search)
    await db.flush()

    # Persist jobs — skip any error dicts
    job_objs = []
    for j in raw_jobs:
        if "error" in j:
            continue
        job = Job(
            search_id=search.id,
            title=j.get("title"),
            company=j.get("company"),
            location=j.get("location"),
            job_type=j.get("job_type"),
            description=j.get("description"),
            source=j.get("source"),
            apply_link=j.get("apply_link"),
            published_date=j.get("published_date"),
            source_site=j.get("source_site"),
            salary_min=j.get("salary_min"),
            salary_max=j.get("salary_max"),
        )
        db.add(job)
        job_objs.append(job)

    await db.flush()
    await db.commit()
    await db.refresh(search)

    return JobSearchOut(
        id=search.id,
        sequence_number=search.sequence_number or search.id,
        role=search.role,
        location=search.location,
        results_count=search.results_count,
        searched_at=search.searched_at,
        jobs=[JobOut.model_validate(j) for j in job_objs],
        notice=notice,
    )


@router.get("/searches", response_model=List[JobSearchOut])
async def list_searches(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(JobSearch).where(JobSearch.user_id == current_user.id)
        .order_by(JobSearch.searched_at.desc()).limit(20)
    )
    searches = result.scalars().all()
    out = []
    for s in searches:
        jobs_result = await db.execute(select(Job).where(Job.search_id == s.id))
        jobs = [JobOut.model_validate(j) for j in jobs_result.scalars().all()]
        out.append(JobSearchOut(
            id=s.id, sequence_number=s.sequence_number or s.id, role=s.role, location=s.location,
            results_count=s.results_count, searched_at=s.searched_at, jobs=jobs
        ))
    return out


# ─── MATCH RESUME TO JOBS ─────────────────────

@router.post("/match", response_model=List[JobMatchOut], status_code=201)
async def match_resume(
    payload: MatchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resume_result = await db.execute(
        select(Resume).where(Resume.id == payload.resume_id, Resume.user_id == current_user.id)
    )
    resume = resume_result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")

    jobs_result = await db.execute(
        select(Job).where(Job.search_id == payload.search_id)
    )
    jobs = jobs_result.scalars().all()
    if not jobs:
        raise HTTPException(status_code=404, detail="No jobs found for this search")

    from utils.groq_pool import resolve_groq_key
    key_resolution = await resolve_groq_key(db, current_user.id)
    groq_key = key_resolution["groq_key"]
    groq_model = await get_groq_model(db, current_user.id)
    ollama_creds = await get_all_credentials(db, current_user.id, "ollama") if ollama_enabled() else {}
    ollama_base_url = ollama_creds.get("base_url")
    ollama_model = ollama_creds.get("model")
    from utils.llm_extraction import get_taxonomy_hint
    known_terms = await get_taxonomy_hint(db)

    # Backfill missing descriptions BEFORE matching — LinkedIn search
    # results come back with an empty description (skipped at search
    # time purely for speed, see scrape_jobs_apify_linkedin /
    # scrape_jobs_linkedin). Without any JD text, requirement extraction
    # has nothing to read and short-circuits straight to the keyword
    # fallback WITHOUT ever calling Groq — which looks identical to "the
    # AI call failed" but is really "there was no JD to send it." Fetched
    # concurrently (off the event loop, since it's a blocking `requests`
    # call) so this doesn't serialize into one-request-per-job. Seek jobs
    # already have a description and are skipped here entirely.
    async def _ensure_description(job: Job) -> None:
        if not job.description and job.apply_link:
            desc = await asyncio.to_thread(fetch_job_description, job.apply_link)
            if desc:
                job.description = desc

    await asyncio.gather(*(_ensure_description(job) for job in jobs))

    # Extract the candidate's profile ONCE for this batch — reused across
    # every job below instead of re-extracting the same resume repeatedly.
    candidate_profile = await extract_candidate_profile(resume.raw_text or "", groq_key, groq_model)

    match_objs = []
    match_ai_powered_flags = []
    for job in jobs:
        job_dict = {
            "title": job.title,
            "company": job.company,
            "description": job.description or "",
            "apply_link": job.apply_link,
        }
        match_data = await calculate_match(
            resume.raw_text or "", job_dict, groq_key, candidate_profile, groq_model,
            ollama_base_url=ollama_base_url, ollama_model=ollama_model,
            known_terms_hint=known_terms, db=db, user_id=current_user.id,
        )
        match_ai_powered_flags.append(bool(match_data.get("ai_powered")))
        cover = generate_cover_letter(
            resume.raw_text or "", resume.parsed_data or {}, job_dict, groq_key, groq_model
        )

        match_obj = JobMatch(
            user_id=current_user.id,
            resume_id=resume.id,
            job_id=job.id,
            ats_score=match_data["ats_score"],
            strengths=match_data["strengths"],
            improvements=match_data["improvements"],
            summary=match_data["summary"],
            strengths_breakdown=match_data.get("strengths_breakdown", {}),
            jd_requirements=match_data.get("jd_requirements", {}),
            cover_letter=cover,
        )
        db.add(match_obj)
        match_objs.append((match_obj, job))

    await db.commit()

    if groq_key and key_resolution["source"] == "pool":
        from utils.groq_pool import record_key_outcome
        await record_key_outcome(db, key_resolution["pool_id"], success=any(match_ai_powered_flags) if match_ai_powered_flags else False)

    groq_configured = bool(groq_key)
    ollama_configured = bool(ollama_base_url)

    return [
        JobMatchOut(
            id=m.id,
            job_id=m.job_id,
            job_title=j.title or "",
            company=j.company or "",
            location=j.location,
            ats_score=m.ats_score,
            strengths=m.strengths,
            improvements=m.improvements,
            summary=m.summary,
            strengths_breakdown=m.strengths_breakdown,
            jd_requirements=m.jd_requirements,
            cover_letter=m.cover_letter,
            apply_link=j.apply_link,
            matched_at=m.matched_at,
            groq_configured=groq_configured,
            ollama_configured=ollama_configured,
        )
        for m, j in sorted(match_objs, key=lambda x: x[0].ats_score, reverse=True)
    ]


@router.get("/matches", response_model=List[JobMatchOut])
async def list_matches(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(JobMatch, Job)
        .join(Job, JobMatch.job_id == Job.id)
        .where(JobMatch.user_id == current_user.id)
        .order_by(JobMatch.ats_score.desc()).limit(50)
    )
    # Best-effort "is AI configured RIGHT NOW" hint for historical matches
    # too — reflects the CURRENT Settings, not necessarily what was
    # configured at the time each match ran, but that's the useful
    # question when a user is looking at a fallback-mode match and
    # wondering whether fixing Settings now would help going forward.
    from utils.groq_pool import resolve_groq_key
    key_resolution = await resolve_groq_key(db, current_user.id)
    groq_configured = bool(key_resolution["groq_key"])
    ollama_creds = await get_all_credentials(db, current_user.id, "ollama") if ollama_enabled() else {}
    ollama_configured = bool(ollama_creds.get("base_url"))

    return [
        JobMatchOut(
            id=m.id, job_id=m.job_id,
            job_title=j.title or "", company=j.company or "",
            location=j.location, ats_score=m.ats_score,
            strengths=m.strengths, improvements=m.improvements,
            summary=m.summary, strengths_breakdown=m.strengths_breakdown,
            jd_requirements=m.jd_requirements, cover_letter=m.cover_letter,
            apply_link=j.apply_link, matched_at=m.matched_at,
            groq_configured=groq_configured,
            ollama_configured=ollama_configured,
        )
        for m, j in result.all()
    ]


# ─── EXPORT TO EXCEL ──────────────────────────

@router.get("/export/{search_id}")
async def export_to_excel(
    search_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(JobMatch, Job)
        .join(Job, JobMatch.job_id == Job.id)
        .join(JobSearch, Job.search_id == JobSearch.id)
        .where(
            JobMatch.user_id == current_user.id,
            JobSearch.id == search_id,
        )
        .order_by(JobMatch.ats_score.desc())
    )
    rows = result.all()

    data = [
        {
            "Job Title": j.title,
            "Company": j.company,
            "Location": j.location,
            "ATS Score (%)": m.ats_score,
            "Key Strengths": "; ".join(m.strengths or []),
            "Improvement Areas": "; ".join(m.improvements or []),
            "Apply Link": j.apply_link,
            "Published": j.published_date,
            "Source": j.source,
            "Cover Letter": m.cover_letter,
        }
        for m, j in rows
    ]

    if not data:
        raise HTTPException(status_code=404, detail="No matched jobs to export")

    df = pd.DataFrame(data)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Job Matches")
    output.seek(0)

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=job_matches_{search_id}.xlsx"},
    )


# ─── DELETE SEARCH ─────────────────────────────

@router.delete("/searches/{search_id}")
async def delete_search(
    search_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a job search and all its jobs/matches."""
    from sqlalchemy import delete as sql_delete
    result = await db.execute(
        select(JobSearch).where(
            JobSearch.id == search_id,
            JobSearch.user_id == current_user.id,
        )
    )
    search = result.scalar_one_or_none()
    if not search:
        raise HTTPException(404, "Search not found")
    # Get job IDs
    job_ids_r = await db.execute(select(Job.id).where(Job.search_id == search_id))
    job_ids = [r[0] for r in job_ids_r.all()]
    if job_ids:
        await db.execute(sql_delete(JobMatch).where(JobMatch.job_id.in_(job_ids)))
        await db.execute(sql_delete(Job).where(Job.search_id == search_id))
    await db.delete(search)
    await db.commit()
    return {"message": "Deleted"}


@router.delete("/searches")
async def delete_all_searches(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete all job searches for the current user."""
    from sqlalchemy import delete as sql_delete
    searches_r = await db.execute(
        select(JobSearch.id).where(JobSearch.user_id == current_user.id)
    )
    search_ids = [r[0] for r in searches_r.all()]
    if search_ids:
        job_ids_r = await db.execute(select(Job.id).where(Job.search_id.in_(search_ids)))
        job_ids = [r[0] for r in job_ids_r.all()]
        if job_ids:
            await db.execute(sql_delete(JobMatch).where(JobMatch.job_id.in_(job_ids)))
        await db.execute(sql_delete(Job).where(Job.search_id.in_(search_ids)))
        await db.execute(sql_delete(JobSearch).where(JobSearch.user_id == current_user.id))
    await db.commit()
    return {"message": f"Deleted {len(search_ids)} searches"}