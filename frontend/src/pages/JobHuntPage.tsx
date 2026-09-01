import { } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Search, Target, Download, ExternalLink, ChevronDown, ChevronUp, FileText, AlertTriangle } from "lucide-react";
import { jobhuntApi, downloadBlob } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import { useLatestMutation } from "../hooks/useLatestMutation";

function scoreColor(score: number) {
  return score >= 70 ? "var(--teal-500)" : score >= 50 ? "#f59e0b" : "#f43f5e";
}

// Distinguishes "nothing configured" from "something's configured but the
// AI call itself failed" — a genuinely different, more actionable message
// than a single generic "check your settings" line either way.
function FallbackBanner({ match }: { match: any }) {
  if (!match?.strengths_breakdown || match.strengths_breakdown.ai_powered) return null;
  const hasAnyAiConfigured = match.groq_configured || match.ollama_configured;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11, color: "#ef4444", background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 6, padding: "6px 10px", marginTop: 8 }}>
      <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
      {hasAnyAiConfigured
        ? "Fallback mode — a Groq/Ollama key is configured, but this match's AI call still failed (temporary rate limit, or an invalid/expired key). Basic keyword matching was used instead. Check the backend logs for the exact error, or verify your key at console.groq.com."
        : "Fallback mode — no Groq or Ollama configured, so this match used basic keyword matching only. Add a Groq API key in Settings → API Keys for AI-powered matching."}
    </div>
  );
}

// Shared score/strengths/gaps/breakdown/cover-letter panel — used both for
// a job row's inline expand (Search tab, auto-matched) and for the Match
// History tab, so the two never drift into two different designs.
function MatchDetailsPanel({ match, isAdmin }: { match: any; isAdmin: boolean }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "var(--font-display)", color: scoreColor(match.ats_score) }}>
          {match.ats_score}%
        </div>
        <div className="tiq-score-bar" style={{ flex: 1 }}>
          <div className="tiq-score-bar-fill" style={{ width: `${match.ats_score}%`,
            background: match.ats_score >= 70 ? "linear-gradient(90deg, #00c7b7, #5ee8db)" :
              match.ats_score >= 50 ? "linear-gradient(90deg, #f59e0b, #fcd34d)" : "linear-gradient(90deg, #f43f5e, #fb7185)" }} />
        </div>
      </div>

      <div className="tiq-grid-2" style={{ gap: 16, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6 }}>
            Strengths
          </div>
          {match.strengths?.slice(0, 4).map((s: string, i: number) => (
            <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4, display: "flex", gap: 6, alignItems: "flex-start" }}>
              <span style={{ color: "var(--teal-500)", flexShrink: 0 }}>✓</span> {s}
            </div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6 }}>
            Gaps to address
          </div>
          {match.improvements?.slice(0, 3).map((s: string, i: number) => (
            <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4, display: "flex", gap: 6, alignItems: "flex-start" }}>
              <span style={{ color: "#f59e0b", flexShrink: 0 }}>△</span> {s}
            </div>
          ))}
        </div>
      </div>

      {isAdmin && <FallbackBanner match={match} />}

      {match.strengths_breakdown && (
        <details style={{ marginTop: 8, marginBottom: 8 }}>
          <summary style={{ fontSize: 12.5, fontWeight: 600, cursor: "pointer", color: "var(--teal-500)", marginBottom: 8 }}>
            View full strengths & requirements breakdown
          </summary>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 10 }}>
            <div>
              {(match.strengths_breakdown.years_experience > 0 || match.strengths_breakdown.education) && (
                <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-secondary)", marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
                  {match.strengths_breakdown.years_experience > 0 && (
                    <span><strong>Experience:</strong> {match.strengths_breakdown.years_experience}+ years</span>
                  )}
                  {match.strengths_breakdown.education && (
                    <span><strong>Education:</strong> {match.strengths_breakdown.education}</span>
                  )}
                </div>
              )}
              {[
                ["Essential Matched", match.strengths_breakdown.essential_matched, "#10b981"],
                ["Technical Skills", match.strengths_breakdown.technical_skills, "#3b82f6"],
                ["Business Skills", match.strengths_breakdown.business_skills, "#8b5cf6"],
                ["Soft Skills", match.strengths_breakdown.soft_skills, "#ec4899"],
                ["Significant Experience", match.strengths_breakdown.significant_experience, "#f59e0b"],
                ["Certifications & Degrees", match.strengths_breakdown.certifications_degrees, "#06b6d4"],
              ].map(([label, items, color]: any) => items?.length > 0 && (
                <div key={label} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color, marginBottom: 4 }}>{label}</div>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {items.map((s: string, i: number) => (
                      <li key={i} style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 3 }}>• {s}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            {match.jd_requirements && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>
                  JD Requirements
                </div>
                {(match.jd_requirements.min_years_experience > 0 || match.jd_requirements.education_requirement) && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11, color: "var(--text-secondary)", marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
                    {match.jd_requirements.min_years_experience > 0 && (
                      <span><strong>Experience Required:</strong> {match.jd_requirements.min_years_experience}+ years</span>
                    )}
                    {match.jd_requirements.education_requirement && (
                      <span><strong>Education Required:</strong> {match.jd_requirements.education_requirement}</span>
                    )}
                  </div>
                )}
                {[
                  ["Essential", match.jd_requirements.essential, "#ef4444"],
                  ["Good to Have", match.jd_requirements.good_to_have, "#f59e0b"],
                  ["Optional", match.jd_requirements.optional, "var(--text-muted)"],
                ].map(([label, items, color]: any) => items?.length > 0 && (
                  <div key={label} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color, marginBottom: 4 }}>{label}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {items.map((s: string) => (
                        <span key={s} className="tiq-badge" style={{ fontSize: 10, background: `${color}20`, color }}>{s}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      )}

      {match.cover_letter && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 12.5, fontWeight: 600, cursor: "pointer", color: "var(--teal-500)", marginBottom: 8 }}>
            View cover letter
          </summary>
          <div className="tiq-cover-letter">{match.cover_letter}</div>
        </details>
      )}
    </div>
  );
}

export default function JobHunterPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const qc = useQueryClient();
  const [tab, setTab] = useState<"search" | "matches">("search");
  const [expandedJob, setExpandedJob] = useState<number | null>(null);
  const [expandedMatchId, setExpandedMatchId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Resume
  const { data: resumes = [] } = useQuery({ queryKey: ["resumes"], queryFn: jobhuntApi.listResumes });
  const [selectedResumeId, setSelectedResumeId] = useState<number | null>(null);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => jobhuntApi.uploadResume(file),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["resumes"] });
      setSelectedResumeId(data.id);
    },
  });

  // Job search form
  const [searchForm, setSearchForm] = useState({
    role: "", location: "", job_type: "All",
    salary_min: "", salary_max: "", industry: "", source: "both",
    date_posted: "", remote_type: "", experience_level: "",
    sort_by: "relevance", max_results: "25",
  });
  const searchMutation = useMutation({
    mutationKey: ["jobhunt-search"],
    mutationFn: () => jobhuntApi.searchJobs({
      ...searchForm,
      salary_min: searchForm.salary_min ? parseInt(searchForm.salary_min) : null,
      salary_max: searchForm.salary_max ? parseInt(searchForm.salary_max) : null,
      max_results: searchForm.max_results ? parseInt(searchForm.max_results) : 25,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["searches"] });
    },
  });

  // Shared-cache view of the same mutation — lets the search survive the
  // user switching to another agent page while jobs are still being
  // scraped, and shows the result here again whenever they come back,
  // regardless of which mount originally triggered it.
  const searchState = useLatestMutation<any>(["jobhunt-search"]);
  const currentSearch = searchState.status === "success" ? searchState.data ?? null : null;

  const deleteAllMutation = useMutation({
    mutationFn: () => jobhuntApi.deleteAllSearches(),
    onSuccess: () => {
      // Both query keys — the previous version only invalidated
      // "searches", so the Match History tab kept showing already-deleted
      // matches until something else happened to invalidate "matches"
      // (e.g. a fresh match run). That's why "Clear history" looked like
      // it wasn't doing anything even though the backend deletion itself
      // was working correctly.
      qc.invalidateQueries({ queryKey: ["searches"] });
      qc.invalidateQueries({ queryKey: ["matches"] });
    },
  });

  const matchMutation = useMutation({
    mutationKey: ["jobhunt-match"],
    mutationFn: () => jobhuntApi.matchResume({ resume_id: selectedResumeId!, search_id: currentSearch!.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["matches"] });
    },
  });
  const matchState = useLatestMutation<any>(["jobhunt-match"]);

  // Matching now runs automatically the instant a search completes (no
  // button to press) — as long as a resume was already selected, so
  // scores are attached to results without a separate manual step. If no
  // resume is selected yet, the job list below just shows plain listings
  // with no scores, exactly as if matching hadn't run.
  const lastAutoMatchedAt = useRef<number | null>(null);
  useEffect(() => {
    if (
      searchState.status === "success" &&
      searchState.submittedAt &&
      searchState.submittedAt !== lastAutoMatchedAt.current &&
      selectedResumeId &&
      (searchState.data?.jobs?.length || 0) > 0
    ) {
      lastAutoMatchedAt.current = searchState.submittedAt;
      matchMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchState.status, searchState.submittedAt, selectedResumeId]);

  // Matches for the CURRENT search only (matchMutation's own response) —
  // deliberately not the global `matches` list below, which is capped at
  // the top 50 by score across ALL history and could cut off a fresh,
  // lower-scoring batch entirely.
  const currentMatches: any[] = matchState.status === "success" ? matchState.data ?? [] : [];
  const matchesByJobId: Record<number, any> = Object.fromEntries(currentMatches.map((m: any) => [m.job_id, m]));

  const { data: matches = [], isLoading: matchLoading } = useQuery({
    queryKey: ["matches"],
    queryFn: jobhuntApi.listMatches,
  });

  const exportMutation = useMutation({
    mutationFn: (searchId: number) => jobhuntApi.exportExcel(searchId),
    onSuccess: (blob, searchId) => downloadBlob(blob, `job_matches_${searchId}.xlsx`),
  });

  const setF = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setSearchForm((f) => ({ ...f, [k]: e.target.value }));

  const rawJobs = currentSearch?.jobs || [];
  // "ats_score" sort has to happen client-side: no match exists yet at
  // search time (matching runs automatically right after, see the effect
  // above), so this re-sorts once scores start coming in. Jobs without a
  // score yet (still matching, or no resume selected) sort to the end
  // rather than jumping around as scores arrive one at a time.
  const jobs = searchForm.sort_by === "ats_score"
    ? [...rawJobs].sort((a: any, b: any) => {
        const sa = matchesByJobId[a.id]?.ats_score ?? -1;
        const sb = matchesByJobId[b.id]?.ats_score ?? -1;
        return sb - sa;
      })
    : rawJobs;

  return (
    <div>
      <div className="tiq-page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <h1 className="tiq-page-title">JobHunter Agent</h1>
        <p className="tiq-page-sub">Search live jobs — matched against your resume automatically</p>
      </div>

      {/* TABS */}
      <div className="tiq-tabs">
        <button className={`tiq-tab${tab === "search" ? " active" : ""}`} onClick={() => setTab("search")}>
          Search & Match
        </button>
        <button className={`tiq-tab${tab === "matches" ? " active" : ""}`} onClick={() => setTab("matches")}>
          Match History ({matches.length})
        </button>
      </div>

      {tab === "search" && (
        <div>
          {/* RESUME UPLOAD */}
          <div className="tiq-card tiq-mb-6">
            <div className="tiq-card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <FileText size={16} /> Resume
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              {resumes.length > 0 && (
                <select
                  className="tiq-input tiq-select"
                  style={{ maxWidth: 260 }}
                  value={selectedResumeId || ""}
                  onChange={(e) => setSelectedResumeId(Number(e.target.value))}
                >
                  <option value="">Select a resume</option>
                  {resumes.map((r: any) => (
                    <option key={r.id} value={r.id}>
                      {r.filename}
                    </option>
                  ))}
                </select>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.txt"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadMutation.mutate(f);
                }}
              />
              <button className="tiq-btn tiq-btn-outline" onClick={() => fileRef.current?.click()}
                disabled={uploadMutation.isPending}>
                <Upload size={14} />
                {uploadMutation.isPending ? "Uploading…" : "Upload resume"}
              </button>
              {uploadMutation.isSuccess && (
                <span className="tiq-badge tiq-badge-teal">✓ Uploaded</span>
              )}
            </div>
            {selectedResumeId && resumes.find((r: any) => r.id === selectedResumeId) && (
              <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--slate-100)", borderRadius: 8, fontSize: 13 }}>
                <strong>Skills detected:</strong>{" "}
                {resumes.find((r: any) => r.id === selectedResumeId)?.skills?.slice(0, 8).join(", ") || "—"}
              </div>
            )}
            {!selectedResumeId && (
              <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>
                Select or upload a resume to have match scores attached to your search results automatically.
              </div>
            )}
          </div>

          {/* SEARCH FORM */}
          <div className="tiq-card tiq-mb-6">
            <div className="tiq-card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Search size={16} /> Search jobs
            </div>
            <div className="tiq-grid-3" style={{ marginBottom: 16 }}>
              <div className="tiq-form-group">
                <label className="tiq-label">Keyword *</label>
                <input className="tiq-input" value={searchForm.role} onChange={setF("role")} placeholder="e.g. Data Analyst" />
              </div>
              <div className="tiq-form-group">
                <label className="tiq-label">Location</label>
                <input className="tiq-input" value={searchForm.location} onChange={setF("location")} placeholder="e.g. Sydney" />
              </div>
              <div className="tiq-form-group">
                <label className="tiq-label">Date posted</label>
                <select className="tiq-input tiq-select" value={searchForm.date_posted} onChange={setF("date_posted")}>
                  <option value="">Any time</option>
                  <option value="24h">Past 24 hours</option>
                  <option value="week">Past week</option>
                  <option value="month">Past month</option>
                </select>
              </div>
              <div className="tiq-form-group">
                <label className="tiq-label">Job type</label>
                <select className="tiq-input tiq-select" value={searchForm.job_type} onChange={setF("job_type")}>
                  <option value="All">Any</option>
                  <option value="full-time">Full-time</option>
                  <option value="part-time">Part-time</option>
                  <option value="contract">Contract</option>
                  <option value="temporary">Temporary</option>
                  <option value="volunteer">Volunteer</option>
                  <option value="internship">Internship</option>
                </select>
              </div>
              <div className="tiq-form-group">
                <label className="tiq-label">Remote</label>
                <select className="tiq-input tiq-select" value={searchForm.remote_type} onChange={setF("remote_type")}>
                  <option value="">Any</option>
                  <option value="onsite">On-site</option>
                  <option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </div>
              <div className="tiq-form-group">
                <label className="tiq-label">Experience</label>
                <select className="tiq-input tiq-select" value={searchForm.experience_level} onChange={setF("experience_level")}>
                  <option value="">Any</option>
                  <option value="internship">Internship</option>
                  <option value="entry">Entry level</option>
                  <option value="associate">Associate</option>
                  <option value="senior">Senior</option>
                  <option value="director">Director</option>
                  <option value="executive">Executive</option>
                </select>
              </div>
              <div className="tiq-form-group">
                <label className="tiq-label">Sort by</label>
                <select className="tiq-input tiq-select" value={searchForm.sort_by} onChange={setF("sort_by")}>
                  <option value="relevance">Most relevant</option>
                  <option value="recent">Most recent</option>
                  <option value="ats_score">ATS score (once matched)</option>
                </select>
              </div>
              <div className="tiq-form-group">
                <label className="tiq-label">Limit</label>
                <input className="tiq-input" type="number" min={5} max={100} value={searchForm.max_results} onChange={setF("max_results")} placeholder="25" />
              </div>
              <div className="tiq-form-group">
                <label className="tiq-label">Source</label>
                <select className="tiq-input tiq-select" value={searchForm.source} onChange={setF("source")}>
                  <option value="both">LinkedIn + Seek</option>
                  <option value="linkedin">LinkedIn only (free, richer with Apify configured)</option>
                  <option value="seek">Seek only (requires Apify)</option>
                </select>
              </div>
              <div className="tiq-form-group">
                <label className="tiq-label">Min Salary ($)</label>
                <input className="tiq-input" type="number" value={searchForm.salary_min} onChange={setF("salary_min")} placeholder="e.g. 80000" />
              </div>
              <div className="tiq-form-group">
                <label className="tiq-label">Max Salary ($)</label>
                <input className="tiq-input" type="number" value={searchForm.salary_max} onChange={setF("salary_max")} placeholder="e.g. 140000" />
              </div>
              <div className="tiq-form-group">
                <label className="tiq-label">Industry</label>
                <input className="tiq-input" value={searchForm.industry} onChange={setF("industry")} placeholder="e.g. Technology" />
              </div>
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: -8, marginBottom: 16 }}>
              Remote and Experience filters apply to LinkedIn results only — Seek's actor has no equivalent filters.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                className="tiq-btn tiq-btn-primary"
                onClick={() => searchMutation.mutate()}
                disabled={!searchForm.role || searchState.status === "pending"}
              >
                <Search size={14} />
                {searchState.status === "pending" ? "Searching…" : "Search jobs"}
              </button>
              {currentSearch && (
                <button
                  className="tiq-btn tiq-btn-ghost"
                  onClick={() => exportMutation.mutate(currentSearch.id)}
                  disabled={exportMutation.isPending}
                >
                  <Download size={14} />
                  Export Excel
                </button>
              )}
            </div>
            {searchState.status === "pending" && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                This keeps running even if you switch to another page.
              </div>
            )}
            {matchState.status === "pending" && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                Matching your resume against {jobs.length} job{jobs.length === 1 ? "" : "s"}…
              </div>
            )}
            {matchState.status === "error" && (
              <div className="tiq-alert tiq-alert-error" style={{ marginTop: 12 }}>
                Matching failed: {(matchState.error as any)?.response?.data?.detail || (matchState.error as any)?.message || "Unknown error."}
              </div>
            )}
            {searchState.status === "error" && (
              <div className="tiq-alert tiq-alert-error" style={{ marginTop: 12 }}>
                Search failed: {(searchState.error as any)?.response?.data?.detail || (searchState.error as any)?.message || "Unknown error. Check the backend logs."}
              </div>
            )}
            {uploadMutation.isError && (
              <div className="tiq-alert tiq-alert-error" style={{ marginTop: 12 }}>
                Resume upload failed: {(uploadMutation.error as any)?.response?.data?.detail || (uploadMutation.error as any)?.message || "Unsupported file type or server error."}
              </div>
            )}
          </div>

          {/* JOB RESULTS — compact, collapsed rows; match score (if a
              resume was selected) sits right in the row header, full
              breakdown/cover letter only shown once expanded. */}
          {currentSearch?.notice && (
            <div className="tiq-alert tiq-alert-warning" style={{ marginBottom: 12 }}>
              {currentSearch.notice}
            </div>
          )}
          {jobs.length > 0 && (
            <div className="tiq-card">
              <div className="tiq-card-title">
                {jobs.length} jobs found for "{currentSearch?.role}"
              </div>
              {jobs.map((job: any) => {
                const match = matchesByJobId[job.id];
                const expanded = expandedJob === job.id;
                return (
                  <div key={job.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, cursor: "pointer" }}
                      onClick={() => setExpandedJob(expanded ? null : job.id)}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
                          {job.title}
                        </div>
                        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 3 }}>
                          {job.company} · {job.location} · {job.job_type}
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <span className="tiq-badge tiq-badge-slate">{job.source}</span>
                          {job.published_date && <span className="tiq-badge tiq-badge-slate">{job.published_date}</span>}
                          {match && (
                            <span className="tiq-badge" style={{ background: `${scoreColor(match.ats_score)}20`, color: scoreColor(match.ats_score), fontWeight: 700 }}>
                              {match.ats_score}% match
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                        {job.apply_link && (
                          <a href={job.apply_link} target="_blank" rel="noopener noreferrer"
                            className="tiq-btn tiq-btn-primary tiq-btn-sm">
                            <ExternalLink size={12} /> Apply
                          </a>
                        )}
                        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm"
                          onClick={() => setExpandedJob(expanded ? null : job.id)}>
                          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </div>
                    </div>
                    {expanded && (
                      <div style={{ marginTop: 12 }}>
                        {job.description && (
                          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7,
                            background: "var(--slate-100)", padding: "12px 14px", borderRadius: 8, marginBottom: match ? 12 : 0 }}>
                            {job.description.slice(0, 600)}
                            {job.description.length > 600 && "…"}
                          </div>
                        )}
                        {match ? (
                          <MatchDetailsPanel match={match} isAdmin={isAdmin} />
                        ) : selectedResumeId ? (
                          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No match score for this job yet.</div>
                        ) : (
                          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Select a resume above to see a match score here.</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "matches" && (
        <div>
          {matchLoading ? (
            <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
          ) : matches.length === 0 ? (
            <div className="tiq-empty">
              <Target size={40} />
              <div className="tiq-empty-title">No matches yet</div>
              <div>Select a resume, then search for jobs — matching runs automatically and shows up here too</div>
            </div>
          ) : (
            <div className="tiq-card">
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                <button className="tiq-btn tiq-btn-ghost tiq-btn-sm"
                  onClick={() => {
                    if (window.confirm(`Clear all ${matches.length} match${matches.length === 1 ? "" : "es"} and their searches? This cannot be undone.`)) {
                      deleteAllMutation.mutate();
                    }
                  }}
                  disabled={deleteAllMutation.isPending}>
                  {deleteAllMutation.isPending ? "Clearing…" : "Clear history"}
                </button>
              </div>
              {matches.map((m: any, i: number) => {
                const expanded = expandedMatchId === m.id;
                return (
                  <div key={m.id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)", paddingTop: i === 0 ? 0 : 16, marginTop: i === 0 ? 0 : 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, cursor: "pointer" }}
                      onClick={() => setExpandedMatchId(expanded ? null : m.id)}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "var(--font-display)" }}>
                          {m.job_title}
                        </div>
                        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 3 }}>
                          {m.company} · {m.location}
                        </div>
                        <div style={{ marginTop: 8 }}>
                          <span className="tiq-badge" style={{ background: `${scoreColor(m.ats_score)}20`, color: scoreColor(m.ats_score), fontWeight: 700 }}>
                            {m.ats_score}% match
                          </span>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                        {m.apply_link && (
                          <a href={m.apply_link} target="_blank" rel="noopener noreferrer"
                            className="tiq-btn tiq-btn-primary tiq-btn-sm">
                            <ExternalLink size={12} /> Apply
                          </a>
                        )}
                        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm"
                          onClick={() => setExpandedMatchId(expanded ? null : m.id)}>
                          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </div>
                    </div>
                    {expanded && <MatchDetailsPanel match={m} isAdmin={isAdmin} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
