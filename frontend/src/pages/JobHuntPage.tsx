import { useNavigate } from "react-router-dom";
import { useState, useRef, useEffect, useMemo, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Search, Download, ExternalLink, ChevronDown, ChevronUp, FileText, AlertTriangle, Sparkles, X, Trash2, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { jobhuntApi, resumecraftApi, downloadBlob } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import { useLatestMutation } from "../hooks/useLatestMutation";

function scoreColor(score: number) {
  return score >= 70 ? "var(--teal-500)" : score >= 50 ? "#f59e0b" : "#f43f5e";
}

// Client-side mirror of agents/jobhunt_agent.py's estimate_recency_rank —
// used to sort the Results table by "Posted" since that field arrives as
// wildly different formats per source (LinkedIn's relative text like "3
// days ago" vs Seek's ISO date), and the Results table's own sort control
// needs to compare them client-side without a round trip to the backend.
// Lower = more recent; unparseable/missing sorts last.
function recencyRank(publishedDate?: string | null): number {
  if (!publishedDate) return 9999;
  const text = publishedDate.trim().toLowerCase();
  if (["just now", "just posted", "today", "new"].includes(text)) return 0;
  const relative = text.match(/^(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago$/);
  if (relative) {
    const amount = parseInt(relative[1], 10);
    const daysPerUnit: Record<string, number> = {
      second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24,
      day: 1, week: 7, month: 30, year: 365,
    };
    return amount * daysPerUnit[relative[2]];
  }
  const compact = text.match(/^(\d+)\s*(mo|w|d|h)$/);
  if (compact) {
    const amount = parseInt(compact[1], 10);
    const daysPerUnit: Record<string, number> = { h: 1 / 24, d: 1, w: 7, mo: 30 };
    return amount * daysPerUnit[compact[2]];
  }
  const iso = text.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const parsed = new Date(text.slice(0, 10));
    if (!isNaN(parsed.getTime())) {
      return Math.max(0, (Date.now() - parsed.getTime()) / 86400000);
    }
  }
  return 9999;
}

// Clickable column header for the Results table — click sorts by that
// column (toggling direction on repeated clicks), with an arrow showing
// the currently-active column and direction so it's clear at a glance
// what the table is sorted by, not just that it CAN be sorted.
function SortableTh({ label, sortKey, sort, onSort, width }: { label: string; sortKey: string; sort: { key: string; dir: "asc" | "desc" }; onSort: (key: any) => void; width?: string }) {
  const active = sort.key === sortKey;
  const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th style={{ width, cursor: "pointer", userSelect: "none" }} onClick={() => onSort(sortKey)}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {label} <Icon size={12} style={{ opacity: active ? 1 : 0.4 }} />
      </span>
    </th>
  );
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

export default function JobHuntPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"search" | "results">("search");
  const [expandedJob, setExpandedJob] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Resume
  const { data: resumes = [] } = useQuery({ queryKey: ["resumes"], queryFn: jobhuntApi.listResumes });
  const [selectedResumeId, setSelectedResumeId] = useState<number | null>(null);
    // Opens the "all extracted details" popup — see TC-JH-01. Deliberately
  // separate from selectedResumeId so opening/closing the popup never
  // touches which resume is actually selected for matching.
  const [showResumeDetails, setShowResumeDetails] = useState(false);

  // "Generate Tailored Resume" (JobHunt -> CVAnalysis -> ResumeCraft
  // bridge): analyzes the chosen resume against THIS job's description
  // (the same analysis CVAnalysis itself runs), then hands the resulting
  // record straight to ResumeCraft the same way CVAnalysis's own
  // "Create Tailored Resume & Cover Letter" link does.
  const [craftingJobId, setCraftingJobId] = useState<number | null>(null);
  const craftMut = useMutation({
    mutationFn: ({ resumeId, jobId }: { resumeId: number; jobId: number }) =>
      resumecraftApi.analyzeJob(resumeId, jobId),
    onMutate: ({ jobId }) => setCraftingJobId(jobId),
    onSuccess: (data: any) => {
      const params = new URLSearchParams({ cvId: String(data.cvAnalysisRecordId) });
      if (data.jobTitle) params.set("jobTitle", data.jobTitle);
      if (data.company) params.set("company", data.company);
      if (data.jobId) params.set("jobId", String(data.jobId));
      if (data.applyLink) params.set("applyLink", data.applyLink);
      navigate(`/app/resumecraft?${params.toString()}`);
    },
    onSettled: () => setCraftingJobId(null),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => jobhuntApi.uploadResume(file),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["resumes"] });
      setSelectedResumeId(data.id);
    },
  });

  // Lets a mis-uploaded or outdated resume be removed from the dropdown
  // (previously there was no way to delete one — upload/list only).
  const deleteResumeMutation = useMutation({
    mutationFn: (id: number) => jobhuntApi.deleteResume(id),
    onSuccess: (_data, deletedId) => {
      qc.invalidateQueries({ queryKey: ["resumes"] });
      // The backend also deletes every search/match tied to this resume
      // (see delete_resume) — invalidate both so the Results tab doesn't
      // keep showing stale, now-deleted searches/matches for it.
      qc.invalidateQueries({ queryKey: ["searches"] });
      qc.invalidateQueries({ queryKey: ["matches"] });
      // If the deleted resume was the selected one, clear the selection
      // (and close its details popup, if open) so nothing stale lingers.
      setSelectedResumeId((cur) => {
        if (cur === deletedId) {
          setShowResumeDetails(false);
          return null;
        }
        return cur;
      });
    },
  });

  // Job search form
  const [searchForm, setSearchForm] = useState({
    role: "", location: "", job_type: "All",
    salary_min: "", salary_max: "", industry: "", source: "both",
    date_posted: "", remote_type: "", experience_level: "",
    sort_by: "relevance", max_results: "25", strict_title_match: false,
  });
  const searchMutation = useMutation({
    mutationKey: ["jobhunt-search"],
    mutationFn: () => jobhuntApi.searchJobs({
      ...searchForm,
      resume_id: selectedResumeId,
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
  const rawCurrentSearch = searchState.status === "success" ? searchState.data ?? null : null;
  // Only trust the live in-session search if it was actually run against
  // the resume that's CURRENTLY selected. Without this check, switching
  // the resume dropdown after running a search kept showing that old
  // search's jobs/notice under the new resume, since rawCurrentSearch
  // just sits in mutation cache regardless of what's selected now.
  const currentSearch = rawCurrentSearch && rawCurrentSearch.resume_id === selectedResumeId ? rawCurrentSearch : null;

  // Persisted searches (unlike currentSearch above, this survives a page
  // reload/navigation — it's a real GET, not in-memory mutation state).
  // Needed because currentSearch resets to null on reload even though the
  // search and its jobs are still sitting in the database.
  //
  // Scoped to the selected resume (?resume_id=) — and refetched whenever
  // that selection changes, via selectedResumeId in the query key — so
  // the Results tab only ever shows the searches/jobs that were run under
  // THIS resume, not every resume's history mixed together. With no
  // resume selected there's nothing resume-specific to show yet.
  const { data: persistedSearches = [] } = useQuery({
    queryKey: ["searches", selectedResumeId],
    queryFn: () => jobhuntApi.listSearches(selectedResumeId),
    enabled: !!selectedResumeId,
  });

  // Wipes this resume's search/match history only — scoped by passing
  // selectedResumeId through to the backend, so clearing history for one
  // resume never touches another resume's searches or matches.
  const deleteAllMutation = useMutation({
    mutationFn: () => jobhuntApi.deleteAllSearches(selectedResumeId),
    onSuccess: () => {
      // Both query keys — the previous version only invalidated
      // "searches", so the Results tab kept showing already-deleted
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

  // Opens the Results tab the moment a search finishes — the job list
  // used to render inline at the bottom of THIS tab (Search & Match),
  // which meant results and the search form that produced them were
  // stacked in the same place and easy to miss after scrolling past the
  // form. Switching immediately on search success (rather than waiting
  // for matching too, which can take a few seconds per job) means the
  // person lands on Results right away and watches match scores fill in
  // there, instead of staring at an unchanged form.
  const lastAutoTabSwitchAt = useRef<number | null>(null);
  useEffect(() => {
    if (
      searchState.status === "success" &&
      searchState.submittedAt &&
      searchState.submittedAt !== lastAutoTabSwitchAt.current
    ) {
      lastAutoTabSwitchAt.current = searchState.submittedAt;
      setTab("results");
    }
  }, [searchState.status, searchState.submittedAt]);

  // Scoped to the selected resume for the same reason as persistedSearches
  // above — otherwise "All-time top matches" mixed every resume's matches
  // together and switching resumes in the dropdown never changed what
  // showed up here.
  const { data: matches = [] } = useQuery({
    queryKey: ["matches", selectedResumeId],
    queryFn: () => jobhuntApi.listMatches(selectedResumeId),
    enabled: !!selectedResumeId,
  });

  // Matches for the CURRENT search (matchMutation's own response) take
  // priority — they're the freshest and cover every job in this search
  // regardless of score. The resume-scoped `matches` list is layered
  // underneath as a fallback ONLY so scores survive a reload: it's capped
  // at the top 50 by score for this resume, so a job whose match exists
  // in the database but didn't make that top-50 cut still won't show a
  // score here after a refresh — a real, if narrower, gap than the
  // "no results at all" bug this was added to fix.
  const currentMatches: any[] = matchState.status === "success" ? matchState.data ?? [] : [];
  const matchesByJobId: Record<number, any> = {
    ...Object.fromEntries(matches.map((m: any) => [m.job_id, m])),
    ...Object.fromEntries(currentMatches.map((m: any) => [m.job_id, m])),
  };

  const exportMutation = useMutation({
    mutationFn: (searchId: number) => jobhuntApi.exportExcel(searchId),
    onSuccess: (blob, searchId) => downloadBlob(blob, `job_matches_${searchId}.xlsx`),
  });

  // ONE merged list of every job from every search run under this resume
  // — replaces the old split of "latest search's jobs" (a table) plus a
  // separately-fetched "top matches" list (a different card layout) that
  // mostly just repeated the same jobs/scores in a second shape. Deduped
  // by job id; currentSearch (the just-completed in-session one, if it
  // matches the currently selected resume) is merged in too so a fresh
  // search's jobs appear immediately, even before the "searches" query
  // has re-fetched to include it.
  const allSearchesForResume = useMemo(() => {
    const bySearchId = new Map<number, any>();
    for (const s of persistedSearches) bySearchId.set(s.id, s);
    if (currentSearch) bySearchId.set(currentSearch.id, currentSearch);
    return Array.from(bySearchId.values());
  }, [persistedSearches, currentSearch]);

  const rawJobs = useMemo(() => {
    const seenJobIds = new Set<number>();
    const merged: any[] = [];
    for (const s of allSearchesForResume) {
      for (const j of s.jobs || []) {
        if (seenJobIds.has(j.id)) continue;
        seenJobIds.add(j.id);
        merged.push(j);
      }
    }
    return merged;
  }, [allSearchesForResume]);

  // Distinct roles searched for this resume — used in the results
  // header ("... found for X") now that it can span more than one search.
  const searchedRoles = useMemo(
    () => Array.from(new Set(allSearchesForResume.map((s) => s.role).filter(Boolean))),
    [allSearchesForResume]
  );

  // The single most recent search — still needed for the "just finished"
  // notice banner (stale/misleading on an older search) and for Export
  // Excel, which is per-search on the backend.
  const mostRecentSearch = currentSearch || persistedSearches[0] || null;

  const setF = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setSearchForm((f) => ({ ...f, [k]: e.target.value }));

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

  // Sorting for the Results tab's table — separate from searchForm.sort_by
  // above, which only controls the order each SOURCE is asked to return
  // results in (and the one-time "ats_score" client sort right after a
  // search). This is a live, column-click-driven re-sort of whatever's
  // currently displayed, so clicking a different column header rearranges
  // the table immediately without re-running the search.
  type ResultsSortKey = "match" | "title" | "company" | "location" | "posted" | "salary";
  const [resultsSort, setResultsSort] = useState<{ key: ResultsSortKey; dir: "asc" | "desc" }>({ key: "match", dir: "desc" });
  const toggleResultsSort = (key: ResultsSortKey) =>
    setResultsSort((cur) => cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "title" || key === "company" || key === "location" ? "asc" : "desc" });

  const sortedJobs = useMemo(() => {
    const arr = [...jobs];
    const { key, dir } = resultsSort;
    const mul = dir === "asc" ? 1 : -1;
    arr.sort((a: any, b: any) => {
      switch (key) {
        case "match": {
          const sa = matchesByJobId[a.id]?.ats_score ?? -1;
          const sb = matchesByJobId[b.id]?.ats_score ?? -1;
          return (sa - sb) * mul;
        }
        case "title":
          return (a.title || "").localeCompare(b.title || "") * mul;
        case "company":
          return (a.company || "").localeCompare(b.company || "") * mul;
        case "location":
          return (a.location || "").localeCompare(b.location || "") * mul;
        case "posted":
          // recencyRank is "lower = more recent", so "desc" (newest first,
          // the sensible default direction for a date column) needs the
          // comparison INVERTED relative to every other numeric column.
          return (recencyRank(a.published_date) - recencyRank(b.published_date)) * -mul;
        case "salary": {
          const sa = a.salary_max ?? a.salary_min ?? -1;
          const sb = b.salary_max ?? b.salary_min ?? -1;
          return (sa - sb) * mul;
        }
        default:
          return 0;
      }
    });
    return arr;
  }, [jobs, resultsSort, matchesByJobId]);

  return (
    <div>
      <div className="tiq-page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <h1 className="tiq-page-title">JobHunt Agent</h1>
        <p className="tiq-page-sub">Search live jobs — matched against your resume automatically</p>
      </div>

      {craftMut.isError && (
        <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 16 }}>
          Couldn't analyze this job: {(craftMut.error as any)?.response?.data?.detail || "Please try again."}
        </div>
      )}

      {/* TABS */}
      <div className="tiq-tabs">
        <button className={`tiq-tab${tab === "search" ? " active" : ""}`} onClick={() => setTab("search")}>
          Search & Match
        </button>
        <button className={`tiq-tab${tab === "results" ? " active" : ""}`} onClick={() => setTab("results")}>
          Results ({jobs.length > 0 ? jobs.length : matches.length})
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
              {selectedResumeId && (
                <button
                  className="tiq-btn tiq-btn-outline"
                  title="Delete this resume"
                  onClick={() => {
                    if (window.confirm("Delete this resume? This can't be undone.")) {
                      deleteResumeMutation.mutate(selectedResumeId);
                    }
                  }}
                  disabled={deleteResumeMutation.isPending}
                  style={{ color: "#ef4444", borderColor: "rgba(239,68,68,.4)", marginLeft: "auto" }}
                >
                  <Trash2 size={14} />
                  {deleteResumeMutation.isPending ? "Deleting…" : "Delete"}
                </button>
              )}
            </div>
            {deleteResumeMutation.isError && (
              <div className="tiq-alert tiq-alert-error" style={{ marginTop: 12 }}>
                Couldn't delete resume: {(deleteResumeMutation.error as any)?.response?.data?.detail || "Please try again."}
              </div>
            )}
            
            {selectedResumeId && resumes.find((r: any) => r.id === selectedResumeId) && (
              <div
                onClick={() => setShowResumeDetails(true)}
                title="Click to view all extracted details"
                style={{ marginTop: 12, padding: "10px 14px", background: "var(--slate-100)", borderRadius: 8, fontSize: 13, cursor: "pointer" }}
              >
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
                <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={searchForm.strict_title_match}
                    onChange={(e) => setSearchForm((f) => ({ ...f, strict_title_match: e.target.checked }))}
                  />
                  Strict title match
                </label>
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
              Strict title match keeps only jobs whose title actually contains your keyword (e.g. excludes "Business Analyst" or "Master Data Specialist" from a "Data Analyst" search) — LinkedIn/Seek's own search normally also matches skills and description text, not just the title.
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
            </div>
            {searchState.status === "pending" && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                This keeps running even if you switch to another page.
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
        </div>
      )}

      {tab === "results" && (
        <div>
          {/* Resume-scoped header: which resume's history is showing, and
              a "Clear history" button for THAT resume's searches/matches
              — moved up here (out from under "All-time top matches" below)
              so it's visible on the Results tab regardless of whether any
              matches have come back yet, and so it's unambiguous which
              resume's history it clears. */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
              {selectedResumeId ? (
                <>Showing results for <strong style={{ color: "var(--text-secondary)" }}>
                  {resumes.find((r: any) => r.id === selectedResumeId)?.filename || "selected resume"}
                </strong></>
              ) : (
                "Select a resume on Search & Match to see its results here."
              )}
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              {deleteAllMutation.isError && (
                <span style={{ fontSize: 12, color: "#ef4444" }}>
                  Couldn't clear history: {(deleteAllMutation.error as any)?.response?.data?.detail || (deleteAllMutation.error as any)?.message || "Please try again."}
                </span>
              )}
              {selectedResumeId && allSearchesForResume.length > 0 && (
                <button
                  className="tiq-btn tiq-btn-ghost tiq-btn-sm"
                  onClick={() => {
                    if (window.confirm("Clear this resume's search & match history? This cannot be undone.")) {
                      deleteAllMutation.mutate();
                    }
                  }}
                  disabled={deleteAllMutation.isPending}
                >
                  <Trash2 size={12} /> {deleteAllMutation.isPending ? "Clearing…" : "Clear history"}
                </button>
              )}
            </div>
          </div>

          {currentSearch?.notice && (
            <div className="tiq-alert tiq-alert-warning" style={{ marginBottom: 12 }}>
              {currentSearch.notice}
            </div>
          )}
          {matchState.status === "pending" && (
            <div className="tiq-card tiq-mb-6" style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Matching your resume against {jobs.length} job{jobs.length === 1 ? "" : "s"}…
            </div>
          )}
          {matchState.status === "error" && (
            <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 12 }}>
              Matching failed: {(matchState.error as any)?.response?.data?.detail || (matchState.error as any)?.message || "Unknown error."}
            </div>
          )}

          {/* ONE results table for this resume — every job from every
              search run under it, merged (see rawJobs above), sorted, and
              carrying its match score if one exists. This used to be two
              separate sections (this table showing only the latest
              search's jobs, plus a whole separate "top matches" list
              below reshowing much of the same data in a different
              layout) — merged into one so there's a single place to look
              and a single empty state instead of two that could disagree
              with each other. */}
          {jobs.length > 0 ? (
            <div className="tiq-card tiq-mb-6">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                <div className="tiq-card-title" style={{ marginBottom: 0 }}>
                  {jobs.length} job{jobs.length === 1 ? "" : "s"} found
                  {searchedRoles.length > 0 && (
                    <> for {searchedRoles.map((r) => `"${r}"`).join(", ")}</>
                  )}
                </div>
                {mostRecentSearch && (
                  <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => exportMutation.mutate(mostRecentSearch.id)} disabled={exportMutation.isPending}
                    title="Exports the most recent search's results">
                    <Download size={14} /> Export Excel
                  </button>
                )}
              </div>
              <div className="tiq-table-wrap">
                <table className="tiq-table" style={{ tableLayout: "fixed" }}>
                  <thead>
                    <tr>
                      <SortableTh label="Title" sortKey="title" sort={resultsSort} onSort={toggleResultsSort} width="24%" />
                      <SortableTh label="Company" sortKey="company" sort={resultsSort} onSort={toggleResultsSort} width="16%" />
                      <SortableTh label="Location" sortKey="location" sort={resultsSort} onSort={toggleResultsSort} width="14%" />
                      <SortableTh label="Posted" sortKey="posted" sort={resultsSort} onSort={toggleResultsSort} width="11%" />
                      <SortableTh label="Match" sortKey="match" sort={resultsSort} onSort={toggleResultsSort} width="9%" />
                      <th style={{ width: "26%" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedJobs.map((job: any) => {
                      const match = matchesByJobId[job.id];
                      const expanded = expandedJob === job.id;
                      return (
                        <Fragment key={job.id}>
                          <tr style={{ cursor: "pointer" }} onClick={() => setExpandedJob(expanded ? null : job.id)}>
                            <td style={{ fontSize: 13, fontWeight: 700 }}>{job.title}</td>
                            <td style={{ fontSize: 12.5 }}>{job.company}</td>
                            <td style={{ fontSize: 12.5 }}>{job.location}</td>
                            <td style={{ fontSize: 12.5 }}>{job.published_date || "—"}</td>
                            <td>
                              {match ? (
                                <span className="tiq-badge" style={{ background: `${scoreColor(match.ats_score)}20`, color: scoreColor(match.ats_score), fontWeight: 700 }}>
                                  {match.ats_score}%
                                </span>
                              ) : "—"}
                            </td>
                            <td onClick={(e) => e.stopPropagation()}>
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                {job.apply_link && (
                                  <a href={job.apply_link} target="_blank" rel="noopener noreferrer"
                                    className="tiq-btn tiq-btn-primary tiq-btn-sm">
                                    <ExternalLink size={12} /> Apply
                                  </a>
                                )}
                                {selectedResumeId && (
                                  <button
                                    className="tiq-btn tiq-btn-outline tiq-btn-sm"
                                    disabled={craftMut.isPending && craftingJobId === job.id}
                                    onClick={() => craftMut.mutate({ resumeId: selectedResumeId, jobId: job.id })}
                                    title="Analyze your resume against this job, then generate a tailored resume & cover letter"
                                  >
                                    <Sparkles size={12} /> {craftMut.isPending && craftingJobId === job.id ? "Analyzing…" : "Tailor"}
                                  </button>
                                )}
                                <button className="tiq-btn tiq-btn-ghost tiq-btn-sm"
                                  onClick={() => setExpandedJob(expanded ? null : job.id)}>
                                  {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                </button>
                              </div>
                            </td>
                          </tr>
                          {expanded && (
                            <tr>
                              <td colSpan={6} style={{ background: "var(--slate-100)" }}>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: job.description ? 10 : 0 }}>
                                  <span className="tiq-badge tiq-badge-slate">{job.source}</span>
                                  <span className="tiq-badge tiq-badge-slate">{job.job_type}</span>
                                </div>
                                {job.description && (
                                  <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: match ? 12 : 0 }}>
                                    {job.description.slice(0, 600)}
                                    {job.description.length > 600 && "…"}
                                  </div>
                                )}
                                {match ? (
                                  <MatchDetailsPanel match={match} isAdmin={isAdmin} />
                                ) : selectedResumeId ? (
                                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No match score for this job yet.</div>
                                ) : (
                                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Select a resume on Search & Match to see a match score here.</div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="tiq-empty tiq-mb-6">
              <Search size={40} />
              <div className="tiq-empty-title">
                {selectedResumeId ? "No results yet for this resume" : "No results yet"}
              </div>
              <div>
                {selectedResumeId
                  ? "Run a search on the Search & Match tab with this resume selected — matching runs automatically and results show up here"
                  : "Select a resume, then run a search on the Search & Match tab — matching runs automatically and results show up here"}
              </div>
            </div>
          )}
        </div>
      )}

      {showResumeDetails && selectedResumeId && (
        <ResumeDetailsModal
          resume={resumes.find((r: any) => r.id === selectedResumeId)}
          onClose={() => setShowResumeDetails(false)}
        />
      )}
    </div>
  );
}

// Popup triggered by clicking the "Skills detected" bar — shows every
// field extracted from the resume: contact details, experience,
// education, and (when AI-powered — see upload_resume's
// extract_resume_facts call, the SAME extraction module/function
// CVAnalysis uses) the full categorized breakdown of technical skills,
// business skills, soft skills, significant experience and
// certifications/degrees, not just a flat skill list. Falls back to the
// flat `skills` array when ai_powered is false (no Groq/Ollama
// configured, so only the old keyword heuristic ran). Deliberately a
// separate component/overlay rather than changing the existing bar's
// own layout — the bar itself is unchanged aside from becoming clickable.
function ResumeDetailsModal({ resume, onClose }: { resume: any; onClose: () => void }) {
  if (!resume) return null;
  const Row = ({ label, value }: { label: string; value: any }) =>
    value ? (
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 3 }}>
          {label}
        </div>
        <div style={{ fontSize: 13.5, color: "#111827" }}>{value}</div>
      </div>
    ) : null;

  const SkillGroup = ({ label, items, color }: { label: string; items?: string[]; color: string }) =>
    items && items.length > 0 ? (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>
          {label} ({items.length})
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {items.map((s, i) => (
            <span key={i} className="tiq-badge" style={{ fontSize: 11.5, background: `${color}1a`, color }}>{s}</span>
          ))}
        </div>
      </div>
    ) : null;

  const ListGroup = ({ label, items }: { label: string; items?: string[] }) =>
    items && items.length > 0 ? (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>
          {label}
        </div>
        {items.map((s, i) => (
          <div key={i} style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 4, display: "flex", gap: 6, alignItems: "flex-start" }}>
            <span style={{ color: "var(--teal-500)", flexShrink: 0 }}>•</span> {s}
          </div>
        ))}
      </div>
    ) : null;

  const hasCategorized =
    resume.ai_powered &&
    ((resume.technical_skills?.length || 0) + (resume.business_skills?.length || 0) + (resume.soft_skills?.length || 0) > 0);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1300, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "#fff", borderRadius: 14, padding: 24, maxWidth: 520, width: "100%", maxHeight: "82vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,.4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 17, color: "#111827" }}>Extracted Resume Details</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280" }}>
            <X size={18} />
          </button>
        </div>

        <Row label="Applicant Name" value={resume.applicant_name} />
        <Row label="Email" value={resume.email} />
        <Row label="Phone" value={resume.phone} />
        <Row label="Experience" value={resume.experience_years ? `${resume.experience_years}+ years` : null} />
        <Row label="Education" value={resume.education} />

        {hasCategorized ? (
          <>
            <SkillGroup label="Technical Skills" items={resume.technical_skills} color="#00c7b7" />
            <SkillGroup label="Business Skills" items={resume.business_skills} color="#6366f1" />
            <SkillGroup label="Soft Skills" items={resume.soft_skills} color="#f59e0b" />
            <ListGroup label="Significant Experience" items={resume.significant_experience} />
            <ListGroup label="Certifications & Degrees" items={resume.certifications_degrees} />
          </>
        ) : (
          resume.skills?.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>
                All Skills Detected ({resume.skills.length})
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {resume.skills.map((s: string, i: number) => (
                  <span key={i} className="tiq-badge tiq-badge-teal" style={{ fontSize: 11.5 }}>{s}</span>
                ))}
              </div>
            </div>
          )
        )}

        {!resume.ai_powered && (
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4, marginBottom: 8 }}>
            AI-powered extraction isn't configured — showing basic keyword-detected skills only. Add a Groq API key in Settings → API Keys for the full categorized breakdown (technical, business, soft skills, experience, certifications) CVAnalysis also uses.
          </div>
        )}

        {!resume.email && !resume.phone && !resume.education && !resume.experience_years && !hasCategorized && !(resume.skills?.length > 0) && (
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 8 }}>
            No additional details could be extracted from this file.
          </div>
        )}
      </div>
    </div>
  );
}
