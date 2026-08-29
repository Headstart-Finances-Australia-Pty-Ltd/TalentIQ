import { useEffect, useMemo, useRef, useState } from "react";
import {
  UserPlus, Upload, Search, Link2, Copy, Check, Tag, Trash2,
  Merge, ExternalLink, X, FileText, FileSignature, PenLine, FolderUp, Eye, Briefcase,
} from "lucide-react";
import { acquisitionApi, requisitionApi, pipelineApi, api } from "../lib/api";
import CsvImportModal from "../components/candidatetrack/CsvImportModal";
import { ResizableFilterHeader } from "../components/ResizableFilterHeader";

async function openBlobInNewTab(url: string) {
  try {
    const res = await api.get(url, { responseType: "blob" });
    const objectUrl = URL.createObjectURL(res.data);
    window.open(objectUrl, "_blank");
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch {
    alert("Could not load the file.");
  }
}

// A real popup window for success/failure feedback — replacing places
// that used to rely on the browser's own alert() (easy to miss, can't be
// dismissed except by reading it, and gives no visual distinction
// between success and failure) or an inline banner that could get lost
// among other page content. Always closable via the X, never
// auto-dismisses on its own.
function MessagePopup({ type, message, onClose }: { type: "success" | "error"; message: string; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
         onClick={onClose}>
      <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 22, maxWidth: 460, width: "94%" }}
           onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: type === "error" ? "#b91c1c" : "#0f766e", whiteSpace: "pre-line" }}>
            {message}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", flexShrink: 0, color: "var(--text-muted)" }}><X size={18} /></button>
        </div>
      </div>
    </div>
  );
}

const STATUS_OPTIONS = ["Active", "Do Not Contact", "Placed", "Archived"];
const SOURCE_LABELS: Record<string, string> = {
  career_page: "Career Page", manual: "Manual", referral: "Referral",
  linklens_linkedin: "LinkedIn (LinkLens)", jobhunt_import: "JobHunt", csv_import: "CSV Import",
  vendor: "Vendor", bulk_folder_import: "Bulk Folder Import",
};

// Every column shown in the table, in display order — used to build
// default widths and to drive the filter/resize header uniformly rather
// than hand-writing each <th> slightly differently.
const DEFAULT_COL_WIDTHS: Record<string, number> = {
  sequence_number: 90, full_name: 160, email: 200, phone: 130, location: 130,
  current_title: 160, current_employer: 160, linkedin_url: 100, total_experience_years: 110,
  skills: 200, education: 160, certifications: 180, work_rights: 150, salary_expectation: 140,
  notice_period_days: 120, preferred_locations: 150, preferred_employment_type: 150, availability: 140,
  source: 130, referral_source: 160, status: 120, applicant_for: 140, pools: 150, tags: 150, notes: 200, consent_given: 100,
  resume: 150, cover_letter: 150,
};
// Array-valued fields — filtering these means "does this candidate's
// list CONTAIN the selected value", not an exact match on the whole
// joined string (which would be different for almost every candidate
// and make the dropdown useless).
const ARRAY_COLS = new Set(["skills", "certifications", "preferred_locations", "pools", "tags", "applicant_for"]);

const emptyForm = {
  full_name: "", email: "", phone: "", location: "", linkedin_url: "", portfolio_url: "",
  current_employer: "", current_title: "", total_experience_years: "", skills: "" as string,
  work_rights: "", salary_expectation: "", notice_period_days: "", preferred_employment_type: "",
  availability: "", source: "manual", referral_source: "", tags: "" as string, notes: "",
  consent_given: false, status: "Active", cover_letter_text: "" as string,
};

export default function AcquisitionPage() {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [pools, setPools] = useState<any[]>([]);
  const [requisitions, setRequisitions] = useState<any[]>([]);
  const [org, setOrg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [unlinkedFilter, setUnlinkedFilter] = useState(false);
  const [poolFilter, setPoolFilter] = useState<number | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formResumeFile, setFormResumeFile] = useState<File | null>(null);
  const [formCoverLetterFile, setFormCoverLetterFile] = useState<File | null>(null);
  const [formExistingResume, setFormExistingResume] = useState<{ filename: string } | null>(null);
  const [formExistingCoverLetter, setFormExistingCoverLetter] = useState<{ filename: string } | null>(null);

  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkResult, setBulkResult] = useState<any>(null);
  const [bulkError, setBulkError] = useState("");

  const [showCsv, setShowCsv] = useState(false);
  const [showNewPool, setShowNewPool] = useState(false);
  const [newPoolName, setNewPoolName] = useState("");

  const [mergeTarget, setMergeTarget] = useState<any>(null); // candidate being checked for duplicates
  const [mergeDuplicate, setMergeDuplicate] = useState<any>(null);

  const [coverLetterTarget, setCoverLetterTarget] = useState<any>(null);
  const [coverLetterText, setCoverLetterText] = useState("");
  const [savingCoverLetter, setSavingCoverLetter] = useState(false);

  const [linkCopied, setLinkCopied] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const selectAllRef = useRef<HTMLInputElement>(null);

  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_COL_WIDTHS);
  const setColWidth = (key: string, w: number) => setColWidths((prev) => ({ ...prev, [key]: w }));
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const setColFilter = (key: string, value: string) => setColFilters((f) => ({ ...f, [key]: value }));

  // Column filters layer on top of the server-side search/status/pool/
  // has-files filters below — those narrow what gets fetched at all,
  // these narrow the currently-loaded page client-side, same pattern as
  // the Requisitions table.
  const getColArray = (c: any, key: string): string[] => {
    if (key === "pools") return c.pools || [];
    if (key === "applicant_for") return (c.applications || []).map((a: any) => String(a.sequence_number));
    return c[key] || [];
  };
  const getColValue = (c: any, key: string): string => {
    switch (key) {
      case "sequence_number": return String(c.sequence_number ?? "");
      case "full_name": return c.full_name || "";
      case "email": return c.email || "—";
      case "phone": return c.phone || "—";
      case "location": return c.location || "—";
      case "current_title": return c.current_title || "—";
      case "current_employer": return c.current_employer || "—";
      case "total_experience_years": return c.total_experience_years ? `${c.total_experience_years} yrs` : "—";
      case "skills": return (c.skills || []).join(", ") || "—";
      case "education": return c.education || "—";
      case "certifications": return (c.certifications || []).join(", ") || "—";
      case "work_rights": return c.work_rights || "—";
      case "salary_expectation": return c.salary_expectation || "—";
      case "notice_period_days": return (c.notice_period_days || c.notice_period_days === 0) ? `${c.notice_period_days} days` : "—";
      case "preferred_locations": return (c.preferred_locations || []).join(", ") || "—";
      case "preferred_employment_type": return c.preferred_employment_type || "—";
      case "availability": return c.availability || "—";
      case "source": return SOURCE_LABELS[c.source] || c.source || "—";
      case "referral_source": return c.referral_source || "—";
      case "status": return c.status || "—";
      case "applicant_for": return (c.applications || []).length > 0 ? (c.applications || []).map((a: any) => a.sequence_number).join(", ") : "—";
      case "pools": return (c.pools || []).join(", ") || "—";
      case "tags": return (c.tags || []).join(", ") || "—";
      case "notes": return c.notes || "—";
      case "consent_given": return c.consent_given ? "Given" : "Not given";
      case "resume": return c.has_resume ? "Has resume" : "No resume";
      case "cover_letter": return c.has_cover_letter ? "Has cover letter" : "No cover letter";
      default: return "";
    }
  };
  // Memoized: with ~27 columns each computing a sorted-unique list over
  // every candidate, recomputing this on EVERY render (e.g. every
  // keystroke in the search box, before its debounce even fires) was a
  // real, measurable chunk of why the table felt slow — none of this
  // actually depends on colFilters or search, only on the candidates
  // array itself, so it should only ever recompute when that changes.
  const optionsCache = useMemo(() => {
    const cache: Record<string, string[]> = {};
    const keys = [
      "sequence_number", "full_name", "email", "phone", "location", "current_title", "current_employer",
      "total_experience_years", "skills", "education", "certifications", "work_rights", "salary_expectation",
      "notice_period_days", "preferred_locations", "preferred_employment_type", "availability", "source",
      "referral_source", "status", "applicant_for", "pools", "tags", "notes", "consent_given",
    ];
    for (const key of keys) {
      cache[key] = ARRAY_COLS.has(key)
        ? Array.from(new Set(candidates.flatMap((c) => getColArray(c, key)))).sort()
        : Array.from(new Set(candidates.map((c) => getColValue(c, key)))).sort();
    }
    return cache;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates]);
  const colOptions = (key: string) => optionsCache[key] || [];

  const filteredCandidates = useMemo(() => candidates.filter((c) =>
    Object.entries(colFilters).every(([key, val]) => {
      if (!val) return true;
      return ARRAY_COLS.has(key) ? getColArray(c, key).includes(val) : getColValue(c, key) === val;
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [candidates, colFilters]);

  const allVisibleSelected = filteredCandidates.length > 0 && filteredCandidates.every((c) => selected.has(c.id));
  const someVisibleSelected = filteredCandidates.some((c) => selected.has(c.id));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [someVisibleSelected, allVisibleSelected]);

  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (allVisibleSelected) {
        // All currently-visible (filtered) rows are selected — deselect
        // just those, preserving any selection from a different
        // filter/page if present.
        const next = new Set(prev);
        filteredCandidates.forEach((c) => next.delete(c.id));
        return next;
      }
      // Not all visible rows selected yet — select every currently-visible
      // (searched + column-filtered) row. Bulk actions only ever act on
      // what's visible, same as the per-row checkboxes.
      const next = new Set(prev);
      filteredCandidates.forEach((c) => next.add(c.id));
      return next;
    });
  };

  // ── Data loading — split into "candidates" (depends on search/status/
  // pool/unlinked filters, refetched often) and "meta" (pools/org/
  // requisitions, rarely change) so that typing a search query doesn't
  // also re-run the Requisitions list fetch — which computes an
  // Applications count per row — on every keystroke. That combined
  // 4-endpoint-every-time load() was the real cause of "even search is
  // taking too long": three-quarters of that work had nothing to do with
  // the search box at all.
  const loadCandidates = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (poolFilter) params.pool_id = poolFilter;
      if (unlinkedFilter) params.unlinked_only = true;
      setCandidates(await acquisitionApi.listCandidates(params));
    } finally {
      setLoading(false);
    }
  };
  const loadPools = async () => setPools(await acquisitionApi.listPools());
  const loadMeta = async () => {
    const [o, r] = await Promise.all([acquisitionApi.getOrganisation(), requisitionApi.list()]);
    setOrg(o);
    setRequisitions(r);
  };
  // Kept for call sites that genuinely need everything refreshed at once
  // (e.g. after an action that could affect candidates, pools, AND
  // application counts all together) — but used sparingly, not as the
  // default for every action.
  const load = async () => { await Promise.all([loadCandidates(), loadPools(), loadMeta()]); };

  useEffect(() => { loadMeta(); loadPools(); }, []);
  useEffect(() => { loadCandidates(); }, [poolFilter, unlinkedFilter]);
  useEffect(() => {
    const t = setTimeout(loadCandidates, search || statusFilter ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  const openAdd = () => {
    setForm(emptyForm); setEditingId(null); setFormError(""); setShowForm(true);
    setFormResumeFile(null); setFormCoverLetterFile(null);
    setFormExistingResume(null); setFormExistingCoverLetter(null);
  };
  const openEdit = (c: any) => {
    setForm({
      full_name: c.full_name, email: c.email, phone: c.phone, location: c.location,
      linkedin_url: c.linkedin_url, portfolio_url: c.portfolio_url, current_employer: c.current_employer,
      current_title: c.current_title, total_experience_years: c.total_experience_years,
      skills: (c.skills || []).join(", "), work_rights: c.work_rights, salary_expectation: c.salary_expectation,
      notice_period_days: c.notice_period_days ?? "", preferred_employment_type: c.preferred_employment_type,
      availability: c.availability, source: c.source, referral_source: c.referral_source,
      tags: (c.tags || []).join(", "), notes: c.notes, consent_given: c.consent_given ?? false,
      status: c.status || "Active", cover_letter_text: c.cover_letter_text || "",
    });
    setEditingId(c.id);
    setFormError("");
    setFormResumeFile(null); setFormCoverLetterFile(null);
    setFormExistingResume(c.has_resume ? { filename: c.resume_filename } : null);
    setFormExistingCoverLetter(c.has_cover_letter && c.cover_letter_filename ? { filename: c.cover_letter_filename } : null);
    setShowForm(true);
  };

  const submitForm = async () => {
    if (!form.full_name.trim()) { setFormError("Full name is required."); return; }
    setSaving(true);
    setFormError("");
    const payload = {
      ...form,
      skills: form.skills.split(",").map((s) => s.trim()).filter(Boolean),
      tags: form.tags.split(",").map((s) => s.trim()).filter(Boolean),
      notice_period_days: form.notice_period_days === "" ? null : Number(form.notice_period_days),
    };
    try {
      let candidateId = editingId;
      if (editingId) {
        await acquisitionApi.updateCandidate(editingId, payload);
      } else {
        const created = await acquisitionApi.createCandidate(payload);
        candidateId = created.id;
      }
      // Resume/cover-letter auto-fill only backfills EMPTY fields (see
      // service.apply_parsed_resume_to_candidate), so uploading after the
      // typed fields are already saved never clobbers what was just entered.
      if (candidateId && formResumeFile) await acquisitionApi.uploadResume(candidateId, formResumeFile);
      if (candidateId && formCoverLetterFile) await acquisitionApi.uploadCoverLetter(candidateId, formCoverLetterFile);
      setShowForm(false);
      await load();
    } catch (e: any) {
      setFormError(e?.response?.data?.detail || "Could not save candidate.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this candidate? This cannot be undone.")) return;
    try {
      await acquisitionApi.deleteCandidate(id);
      await load();
    } catch (e: any) {
      // Previously uncaught — a failed delete (e.g. a backend error) threw,
      // skipped load() entirely, and left the row exactly where it was
      // with zero feedback. Looked identical to "delete does nothing."
      alert(e?.response?.data?.detail || "Could not delete this candidate. Please try again.");
    }
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected candidate(s)? This cannot be undone.`)) return;
    try {
      const res = await acquisitionApi.bulkDelete(Array.from(selected));
      setSelected(new Set());
      await load();
      // Bulk delete is partial-success by design: a candidate with
      // interviews/pipeline activity/offers/placements on record is
      // skipped rather than silently failing the whole batch or crashing
      // outright (see backend capabilities/acquisition/router.py
      // _blocking_hiring_activity_refs).
      if (res?.skipped?.length > 0) {
        const lines = res.skipped.map((s: any) => `• ${s.name}: ${s.reason}`).join("\n");
        alert(`Deleted ${res.deleted ?? 0} candidate(s).\n\n${res.skipped.length} could not be deleted:\n${lines}`);
      }
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not delete the selected candidates. Please try again.");
    }
  };

  const handleResumeUpload = async (id: number, file: File) => {
    await acquisitionApi.uploadResume(id, file);
    await load();
  };

  const handleCoverLetterFileUpload = async (id: number, file: File) => {
    if (!/\.(pdf|docx?|DOCX?|PDF)$/.test(file.name)) {
      alert("Cover letter must be a PDF or Word document (.pdf, .docx, .doc).");
      return;
    }
    await acquisitionApi.uploadCoverLetter(id, file);
    await load();
  };

  const openCoverLetterText = (c: any) => {
    setCoverLetterTarget(c);
    setCoverLetterText(c.cover_letter_text || "");
  };

  const saveCoverLetterText = async () => {
    if (!coverLetterTarget) return;
    setSavingCoverLetter(true);
    try {
      await acquisitionApi.setCoverLetterText(coverLetterTarget.id, coverLetterText);
      setCoverLetterTarget(null);
      await load();
    } finally {
      setSavingCoverLetter(false);
    }
  };

  const [messagePopup, setMessagePopup] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [applicantForPopup, setApplicantForPopup] = useState<any>(null);
  const [applicantForEntries, setApplicantForEntries] = useState<any[] | null>(null);
  const [loadingApplicantFor, setLoadingApplicantFor] = useState(false);
  const openApplicantForPopup = async (c: any) => {
    setApplicantForPopup(c);
    setApplicantForEntries(null);
    setLoadingApplicantFor(true);
    try {
      // The candidate's actual pipeline stage per application — Application.stage
      // is just a placeholder field (Pipeline owns the real stage), so this
      // is fetched the same way the Requisitions page's own Applicants
      // popup does it, just filtered by candidate instead of by role.
      setApplicantForEntries(await pipelineApi.listEntries({ candidate_id: c.id }));
    } finally {
      setLoadingApplicantFor(false);
    }
  };

  const checkDuplicate = async (c: any) => {
    const res = await acquisitionApi.findDuplicates(c.id);
    if (!res.duplicate) { setMessagePopup({ type: "success", message: `No likely duplicate found for ${c.full_name}.` }); return; }
    setMergeTarget(c);
    setMergeDuplicate(res.duplicate);
  };

  const confirmMerge = async (primaryId: number, mergedId: number) => {
    await acquisitionApi.mergeCandidates(primaryId, mergedId);
    setMergeTarget(null);
    setMergeDuplicate(null);
    await load();
  };

  const [creatingPool, setCreatingPool] = useState(false);
  const createPool = async () => {
    const name = newPoolName.trim();
    if (!name || creatingPool) return; // creatingPool guard: a slow request plus an impatient second click on
    // "Add" used to fire this twice, creating two pools with the same
    // name — this is what produced duplicate "Q4 Shortlist" entries.
    setCreatingPool(true);
    try {
      const pool = await acquisitionApi.createPool({ name });
      // The whole point of creating a pool from here (as opposed to some
      // separate "manage pools" screen) is to drop whatever's currently
      // selected straight into it — previously this created an empty
      // pool and left the selection ticked, so the "N selected to
      // pool…" step then had to be repeated separately, and a
      // slow/confusing response made it look like nothing had happened
      // at all (prompting retries that created duplicate empty pools).
      const memberCount = selected.size;
      if (memberCount > 0) {
        await acquisitionApi.addPoolMembers(pool.id, Array.from(selected));
      }
      setNewPoolName("");
      setShowNewPool(false);
      setSelected(new Set());
      setMessagePopup({
        type: "success",
        message: memberCount > 0
          ? `Created "${name}" with ${memberCount} candidate(s) added.`
          : `Created "${name}" — no candidates were selected, so it's empty for now.`,
      });
      await Promise.all([loadCandidates(), loadPools()]);
    } catch (e: any) {
      setMessagePopup({ type: "error", message: e?.response?.data?.detail || `Could not create the pool "${name}".` });
    } finally {
      setCreatingPool(false);
    }
  };

  const removePool = async (pool: any) => {
    if (!confirm(`Delete the pool "${pool.name}"? This only removes the pool, not the candidates in it.`)) return;
    try {
      await acquisitionApi.deletePool(pool.id);
      if (poolFilter === pool.id) setPoolFilter(null);
      await Promise.all([loadCandidates(), loadPools()]);
    } catch (e: any) {
      setMessagePopup({ type: "error", message: e?.response?.data?.detail || `Could not delete "${pool.name}".` });
    }
  };

  const [addingToPool, setAddingToPool] = useState(false);
  const addSelectedToPool = async (poolId: number) => {
    if (selected.size === 0 || addingToPool) return;
    setAddingToPool(true);
    try {
      await acquisitionApi.addPoolMembers(poolId, Array.from(selected));
      const poolName = pools.find((p) => p.id === poolId)?.name || "the pool";
      setMessagePopup({ type: "success", message: `Added ${selected.size} candidate(s) to ${poolName}.` });
      setSelected(new Set());
      await Promise.all([loadCandidates(), loadPools()]);
    } catch (e: any) {
      setMessagePopup({ type: "error", message: e?.response?.data?.detail || "Could not add the selected candidates to that pool." });
    } finally {
      setAddingToPool(false);
    }
  };

  // ── Bulk submit to a requisition — the actual, fast way to associate
  // many Talent Pool candidates with a role at once. Backend has no
  // bulk endpoint for this (pipeline/submit is one candidate at a
  // time), so this fires the calls in parallel and tolerates individual
  // failures (already-submitted 409s) rather than letting one bad
  // candidate abort the whole batch.
  const [submittingToReq, setSubmittingToReq] = useState(false);
  const submitSelectedToRequisition = async (requisitionId: number) => {
    if (selected.size === 0 || submittingToReq) return;
    setSubmittingToReq(true);
    const results = await Promise.allSettled(
      Array.from(selected).map((candidateId) => pipelineApi.submit({ candidate_id: candidateId, requisition_id: requisitionId }))
    );
    const submitted = results.filter((r) => r.status === "fulfilled").length;
    const alreadyIn = results.filter((r) => r.status === "rejected" && (r as PromiseRejectedResult).reason?.response?.status === 409).length;
    const failed = results.length - submitted - alreadyIn;
    setMessagePopup({
      type: failed > 0 ? "error" : "success",
      message: `Submitted ${submitted} candidate(s) to this requisition's pipeline`
        + (alreadyIn > 0 ? `, ${alreadyIn} were already in it` : "")
        + (failed > 0 ? `, ${failed} failed` : "") + ".",
    });
    setSubmittingToReq(false);
    setSelected(new Set());
    await loadCandidates(); // refresh so the new Applicant For numbers show up immediately
  };

  const copyApplyLink = () => {
    if (!org) return;
    const url = `${window.location.origin}${org.apply_url_path}`;
    navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBulkFileSelect = (files: FileList | null) => {
    if (!files) return;
    setBulkFiles(Array.from(files));
    setBulkResult(null);
    setBulkError("");
  };

  const submitBulkImport = async () => {
    if (bulkFiles.length === 0) return;
    setBulkUploading(true);
    setBulkError("");
    try {
      const form = new FormData();
      bulkFiles.forEach((f) => form.append("files", f));
      const res = await acquisitionApi.bulkFolderImport(form);
      setBulkResult(res);
      await load();
    } catch (e: any) {
      setBulkError(e?.response?.data?.detail || "Bulk import failed.");
    } finally {
      setBulkUploading(false);
    }
  };

  const closeBulkImport = () => {
    setShowBulkImport(false);
    setBulkFiles([]);
    setBulkResult(null);
    setBulkError("");
  };

  return (
    <div className="tiq-content">
      <div className="tiq-page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="tiq-page-title">Talent Acquisition &amp; Pool</div>
          <div className="tiq-page-sub">Every candidate, from every channel — one record, reusable across every future role.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={copyApplyLink} disabled={!org}>
            {linkCopied ? <Check size={14} /> : <Link2 size={14} />} {linkCopied ? "Copied!" : "Copy Careers Link"}
          </button>
          <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setShowCsv(true)}>
            <Upload size={14} /> Import Candidate CSV
          </button>
          <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setShowBulkImport(true)}>
            <FolderUp size={14} /> Bulk Import Resumes/Cover Letters
          </button>
          <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={openAdd}>
            <UserPlus size={14} /> Add Candidate
          </button>
        </div>
      </div>


      {/* ── Candidate list ─────────────────────────────────────── */}
      <div style={{ marginTop: 16 }}>
          {/* Everything the request calls out — All Candidates count,
              pool pills, +New Pool, Search, Status, Unlinked filter — on
              one row. Bulk-action controls (add to pool / submit to
              requisition / delete) only appear once something's
              selected, so they get their own row below rather than
              competing for space on the main filter line all the time. */}
          <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
            <button
              className={`tiq-nav-item${poolFilter === null ? " active" : ""}`}
              style={{ color: "var(--text-primary)", padding: "8px 12px", display: "inline-flex", gap: 6, whiteSpace: "nowrap" }}
              onClick={() => setPoolFilter(null)}
            >
              All Candidates <span>{candidates.length}</span>
            </button>
            {pools.map((p) => (
              <span key={p.id} style={{ position: "relative", display: "inline-flex" }}>
                <button
                  className={`tiq-nav-item${poolFilter === p.id ? " active" : ""}`}
                  style={{ color: "var(--text-primary)", padding: "8px 20px 8px 12px", display: "inline-flex", gap: 6, whiteSpace: "nowrap" }}
                  onClick={() => setPoolFilter(p.id)}
                  title={p.description}
                >
                  {p.name} <span>{p.member_count}</span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); removePool(p); }}
                  title={`Delete pool "${p.name}"`}
                  style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2, lineHeight: 0 }}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            {!showNewPool ? (
              <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => setShowNewPool(true)}>
                + New Pool
              </button>
            ) : (
              <div style={{ display: "flex", gap: 6 }}>
                <input className="tiq-input" placeholder="Pool name" value={newPoolName} autoFocus
                       onChange={(e) => setNewPoolName(e.target.value)} style={{ fontSize: 12, padding: "6px 8px" }}
                       onKeyDown={(e) => { if (e.key === "Enter") createPool(); if (e.key === "Escape") { setShowNewPool(false); setNewPoolName(""); } }} />
                <button className="tiq-btn tiq-btn-primary tiq-btn-sm" disabled={!newPoolName.trim() || creatingPool} onClick={createPool}>
                  {creatingPool ? "Adding…" : selected.size > 0 ? `Add (${selected.size} selected)` : "Add"}
                </button>
                <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => { setShowNewPool(false); setNewPoolName(""); }}>Cancel</button>
              </div>
            )}
            <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--text-muted)" }} />
              <input className="tiq-input" style={{ paddingLeft: 32 }} placeholder="Search by name or email…"
                     value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="tiq-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <label className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ cursor: "pointer", display: "inline-flex", gap: 6, whiteSpace: "nowrap" }}
                   title="Only candidates auto-created from an unmatched resume/cover-letter upload (Bulk Import) — not a real profile someone filled in, just a leftover file with nowhere else to go. Safe to review and clean up.">
              <input type="checkbox" checked={unlinkedFilter} onChange={(e) => setUnlinkedFilter(e.target.checked)} style={{ margin: 0 }} />
              Unlinked Resume/Cover Letter only
            </label>
          </div>

          {/* Bulk-action row — only present once something's selected */}
          {selected.size > 0 && (
            <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
              {pools.length > 0 && (
                <select className="tiq-select" style={{ fontSize: 12 }} disabled={addingToPool} value=""
                        onChange={(e) => { if (e.target.value) addSelectedToPool(Number(e.target.value)); }}>
                  <option value="">{addingToPool ? "Adding…" : `Add ${selected.size} selected to pool…`}</option>
                  {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              {requisitions.length > 0 && (
                <select className="tiq-select" style={{ fontSize: 12 }} disabled={submittingToReq} value=""
                        title="Adds each selected candidate to this requisition's pipeline — this is what makes them count as an Application on the Requisitions table"
                        onChange={(e) => { if (e.target.value) submitSelectedToRequisition(Number(e.target.value)); }}>
                  <option value="">{submittingToReq ? "Submitting…" : `Submit ${selected.size} selected to requisition…`}</option>
                  {requisitions.map((r: any) => <option key={r.id} value={r.id}>{r.title}{r.client_name ? ` — ${r.client_name}` : ""}</option>)}
                </select>
              )}
              <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ color: "#ef4444", borderColor: "#ef4444" }}
                      onClick={handleBulkDelete}>
                <Trash2 size={13} /> Delete {selected.size} selected
              </button>
            </div>
          )}

          {loading ? (
            <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
          ) : candidates.length === 0 ? (
            <div className="tiq-empty">No candidates yet. Add one, import a CSV, or share your careers link.</div>
          ) : filteredCandidates.length === 0 ? (
            <div className="tiq-empty">
              No candidates match the current column filters.{" "}
              <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => setColFilters({})}>Clear filters</button>
            </div>
          ) : (
            <div className="tiq-table-wrap">
              <table className="tiq-table" style={{ tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAll}
                        title={allVisibleSelected ? "Deselect all" : "Select all"}
                      />
                    </th>
                    <ResizableFilterHeader label="Candidate #" value={colFilters.sequence_number} options={colOptions("sequence_number")} onChange={(v) => setColFilter("sequence_number", v)} align="center" width={colWidths.sequence_number} onWidthChange={(w) => setColWidth("sequence_number", w)} />
                    <ResizableFilterHeader label="Full Name" value={colFilters.full_name} options={colOptions("full_name")} onChange={(v) => setColFilter("full_name", v)} width={colWidths.full_name} onWidthChange={(w) => setColWidth("full_name", w)} />
                    <ResizableFilterHeader label="Email" value={colFilters.email} options={colOptions("email")} onChange={(v) => setColFilter("email", v)} width={colWidths.email} onWidthChange={(w) => setColWidth("email", w)} />
                    <ResizableFilterHeader label="Phone" value={colFilters.phone} options={colOptions("phone")} onChange={(v) => setColFilter("phone", v)} width={colWidths.phone} onWidthChange={(w) => setColWidth("phone", w)} />
                    <ResizableFilterHeader label="Location" value={colFilters.location} options={colOptions("location")} onChange={(v) => setColFilter("location", v)} width={colWidths.location} onWidthChange={(w) => setColWidth("location", w)} />
                    <ResizableFilterHeader label="Current Title" value={colFilters.current_title} options={colOptions("current_title")} onChange={(v) => setColFilter("current_title", v)} width={colWidths.current_title} onWidthChange={(w) => setColWidth("current_title", w)} />
                    <ResizableFilterHeader label="Current Employer" value={colFilters.current_employer} options={colOptions("current_employer")} onChange={(v) => setColFilter("current_employer", v)} width={colWidths.current_employer} onWidthChange={(w) => setColWidth("current_employer", w)} />
                    <ResizableFilterHeader label="LinkedIn" filterable={false} width={colWidths.linkedin_url} onWidthChange={(w) => setColWidth("linkedin_url", w)} />
                    <ResizableFilterHeader label="Experience" value={colFilters.total_experience_years} options={colOptions("total_experience_years")} onChange={(v) => setColFilter("total_experience_years", v)} width={colWidths.total_experience_years} onWidthChange={(w) => setColWidth("total_experience_years", w)} />
                    <ResizableFilterHeader label="Skills" value={colFilters.skills} options={colOptions("skills")} onChange={(v) => setColFilter("skills", v)} width={colWidths.skills} onWidthChange={(w) => setColWidth("skills", w)} />
                    <ResizableFilterHeader label="Education" value={colFilters.education} options={colOptions("education")} onChange={(v) => setColFilter("education", v)} width={colWidths.education} onWidthChange={(w) => setColWidth("education", w)} />
                    <ResizableFilterHeader label="Certifications" value={colFilters.certifications} options={colOptions("certifications")} onChange={(v) => setColFilter("certifications", v)} width={colWidths.certifications} onWidthChange={(w) => setColWidth("certifications", w)} />
                    <ResizableFilterHeader label="Work Rights" value={colFilters.work_rights} options={colOptions("work_rights")} onChange={(v) => setColFilter("work_rights", v)} width={colWidths.work_rights} onWidthChange={(w) => setColWidth("work_rights", w)} />
                    <ResizableFilterHeader label="Salary Expectation" value={colFilters.salary_expectation} options={colOptions("salary_expectation")} onChange={(v) => setColFilter("salary_expectation", v)} width={colWidths.salary_expectation} onWidthChange={(w) => setColWidth("salary_expectation", w)} />
                    <ResizableFilterHeader label="Notice Period" value={colFilters.notice_period_days} options={colOptions("notice_period_days")} onChange={(v) => setColFilter("notice_period_days", v)} width={colWidths.notice_period_days} onWidthChange={(w) => setColWidth("notice_period_days", w)} />
                    <ResizableFilterHeader label="Preferred Locations" value={colFilters.preferred_locations} options={colOptions("preferred_locations")} onChange={(v) => setColFilter("preferred_locations", v)} width={colWidths.preferred_locations} onWidthChange={(w) => setColWidth("preferred_locations", w)} />
                    <ResizableFilterHeader label="Preferred Employment" value={colFilters.preferred_employment_type} options={colOptions("preferred_employment_type")} onChange={(v) => setColFilter("preferred_employment_type", v)} width={colWidths.preferred_employment_type} onWidthChange={(w) => setColWidth("preferred_employment_type", w)} />
                    <ResizableFilterHeader label="Availability" value={colFilters.availability} options={colOptions("availability")} onChange={(v) => setColFilter("availability", v)} width={colWidths.availability} onWidthChange={(w) => setColWidth("availability", w)} />
                    <ResizableFilterHeader label="Resume" filterable={false} width={colWidths.resume} onWidthChange={(w) => setColWidth("resume", w)} />
                    <ResizableFilterHeader label="Cover Letter" filterable={false} width={colWidths.cover_letter} onWidthChange={(w) => setColWidth("cover_letter", w)} />
                    <ResizableFilterHeader label="Source" value={colFilters.source} options={colOptions("source")} onChange={(v) => setColFilter("source", v)} width={colWidths.source} onWidthChange={(w) => setColWidth("source", w)} />
                    <ResizableFilterHeader label="Referral Source" value={colFilters.referral_source} options={colOptions("referral_source")} onChange={(v) => setColFilter("referral_source", v)} width={colWidths.referral_source} onWidthChange={(w) => setColWidth("referral_source", w)} />
                    <ResizableFilterHeader label="Status" value={colFilters.status} options={colOptions("status")} onChange={(v) => setColFilter("status", v)} width={colWidths.status} onWidthChange={(w) => setColWidth("status", w)} />
                    <ResizableFilterHeader label="Applicant For" value={colFilters.applicant_for} options={colOptions("applicant_for")} onChange={(v) => setColFilter("applicant_for", v)} align="center" width={colWidths.applicant_for} onWidthChange={(w) => setColWidth("applicant_for", w)} />
                    <ResizableFilterHeader label="Pools" value={colFilters.pools} options={colOptions("pools")} onChange={(v) => setColFilter("pools", v)} width={colWidths.pools} onWidthChange={(w) => setColWidth("pools", w)} />
                    <ResizableFilterHeader label="Tags" value={colFilters.tags} options={colOptions("tags")} onChange={(v) => setColFilter("tags", v)} width={colWidths.tags} onWidthChange={(w) => setColWidth("tags", w)} />
                    <ResizableFilterHeader label="Notes" value={colFilters.notes} options={colOptions("notes")} onChange={(v) => setColFilter("notes", v)} width={colWidths.notes} onWidthChange={(w) => setColWidth("notes", w)} />
                    <ResizableFilterHeader label="Consent" value={colFilters.consent_given} options={colOptions("consent_given")} onChange={(v) => setColFilter("consent_given", v)} align="center" width={colWidths.consent_given} onWidthChange={(w) => setColWidth("consent_given", w)} />
                    <th style={{ width: 110 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCandidates.map((c) => (
                    <tr key={c.id} onClick={() => openEdit(c)} style={{ cursor: "pointer" }}>
                      <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} /></td>
                      <td style={{ textAlign: "center", color: "var(--text-muted)" }}>{c.sequence_number}</td>
                      <td style={{ fontWeight: 600 }}>{c.full_name}</td>
                      <td style={{ fontSize: 12 }}>{c.email}</td>
                      <td style={{ fontSize: 12 }}>{c.phone}</td>
                      <td style={{ fontSize: 12 }}>{c.location}</td>
                      <td style={{ fontSize: 12 }}>{c.current_title}</td>
                      <td style={{ fontSize: 12 }}>{c.current_employer}</td>
                      <td style={{ fontSize: 12 }}>
                        {c.linkedin_url ? (
                          <a href={c.linkedin_url} target="_blank" rel="noreferrer"
                             style={{ color: "var(--brand-teal, #0d9488)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3 }}>
                            <ExternalLink size={11} /> Profile
                          </a>
                        ) : ""}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {c.total_experience_years ? `${c.total_experience_years} yrs` : ""}
                      </td>
                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {(c.skills || []).slice(0, 3).map((s: string) => (
                            <span key={s} className="tiq-badge tiq-badge-slate" style={{ fontSize: 10 }}>{s}</span>
                          ))}
                          {(c.skills?.length || 0) > 3 && (
                            <span style={{ fontSize: 10, color: "var(--text-muted)" }} title={c.skills.slice(3).join(", ")}>
                              +{c.skills.length - 3} more
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ fontSize: 12 }}>{c.education}</td>
                      <td style={{ fontSize: 12 }}>{(c.certifications || []).join(", ")}</td>
                      <td style={{ fontSize: 12 }}>{c.work_rights}</td>
                      <td style={{ fontSize: 12 }}>{c.salary_expectation}</td>
                      <td style={{ fontSize: 12 }}>
                        {c.notice_period_days || c.notice_period_days === 0 ? `${c.notice_period_days} days` : ""}
                      </td>
                      <td style={{ fontSize: 12 }}>{(c.preferred_locations || []).join(", ")}</td>
                      <td style={{ fontSize: 12 }}>{c.preferred_employment_type}</td>
                      <td style={{ fontSize: 12 }}>{c.availability}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {c.has_resume ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title={c.resume_filename}
                                    onClick={() => openBlobInNewTab(acquisitionApi.resumeDownloadUrl(c.id))}
                                    style={{ maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-flex", gap: 4 }}>
                              <Eye size={12} /> <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{c.resume_filename || "View"}</span>
                            </button>
                            <label className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Replace resume" style={{ cursor: "pointer" }}>
                              <Upload size={12} />
                              <input type="file" hidden accept=".pdf,.docx,.doc,.txt"
                                     onChange={(e) => e.target.files?.[0] && handleResumeUpload(c.id, e.target.files[0])} />
                            </label>
                          </div>
                        ) : (
                          <label className="tiq-btn tiq-btn-outline tiq-btn-sm" title="Upload resume (PDF/DOCX/DOC/TXT)" style={{ cursor: "pointer" }}>
                            <Upload size={12} /> Upload
                            <input type="file" hidden accept=".pdf,.docx,.doc,.txt"
                                   onChange={(e) => e.target.files?.[0] && handleResumeUpload(c.id, e.target.files[0])} />
                          </label>
                        )}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {c.has_cover_letter ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            {c.cover_letter_filename ? (
                              <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title={c.cover_letter_filename}
                                      onClick={() => openBlobInNewTab(acquisitionApi.coverLetterDownloadUrl(c.id))}
                                      style={{ maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-flex", gap: 4 }}>
                                <Eye size={12} /> <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{c.cover_letter_filename}</span>
                              </button>
                            ) : (
                              <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Typed cover letter — click to view/edit" onClick={() => openCoverLetterText(c)}>
                                <FileSignature size={12} /> Text
                              </button>
                            )}
                            <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Edit cover letter text" onClick={() => openCoverLetterText(c)}>
                              <PenLine size={12} />
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 4 }}>
                            <label className="tiq-btn tiq-btn-outline tiq-btn-sm" title="Upload cover letter (PDF/Word)" style={{ cursor: "pointer" }}>
                              <Upload size={12} /> Upload
                              <input type="file" hidden accept=".pdf,.docx,.doc"
                                     onChange={(e) => e.target.files?.[0] && handleCoverLetterFileUpload(c.id, e.target.files[0])} />
                            </label>
                            <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Write cover letter text" onClick={() => openCoverLetterText(c)}>
                              <PenLine size={12} />
                            </button>
                          </div>
                        )}
                      </td>
                      <td><span className="tiq-badge tiq-badge-slate">{SOURCE_LABELS[c.source] || c.source}</span></td>
                      <td style={{ fontSize: 12 }}>{c.referral_source}</td>
                      <td><span className={`tiq-badge ${c.status === "Active" ? "tiq-badge-teal" : "tiq-badge-slate"}`}>{c.status}</span></td>
                      <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                        {(c.applications || []).length > 0 ? (
                          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => openApplicantForPopup(c)}>
                            {c.applications.map((a: any) => a.sequence_number).join(", ")}
                          </button>
                        ) : <span style={{ color: "var(--text-muted)" }}>—</span>}
                      </td>
                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {c.pools?.map((p: string) => <span key={p} className="tiq-badge tiq-badge-violet">{p}</span>)}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {c.tags?.map((t: string) => <span key={t} className="tiq-badge tiq-badge-slate"><Tag size={9} style={{ marginRight: 2 }} />{t}</span>)}
                        </div>
                      </td>
                      <td style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.notes}>
                        {c.notes}
                      </td>
                      <td style={{ textAlign: "center" }} title={c.consent_given ? "Consent given" : "No consent on file"}>
                        {c.consent_given ? <Check size={14} color="#0d9488" /> : <span style={{ color: "var(--text-muted)" }}>—</span>}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Edit" onClick={() => openEdit(c)}>Edit</button>
                          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Check for duplicates" onClick={() => checkDuplicate(c)}><Merge size={13} /></button>
                          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Delete" onClick={() => handleDelete(c.id)}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>


      {/* ── Add/Edit Candidate Modal ──────────────────────────── */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 640, width: "94%", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{editingId ? "Edit Candidate" : "Add Candidate"}</div>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            {formError && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 12 }}>{formError}</div>}
            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Full Name *</label>
                <input className="tiq-input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Email</label>
                <input className="tiq-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Phone</label>
                <input className="tiq-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Location</label>
                <input className="tiq-input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Current Title</label>
                <input className="tiq-input" value={form.current_title} onChange={(e) => setForm({ ...form, current_title: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Current Employer</label>
                <input className="tiq-input" value={form.current_employer} onChange={(e) => setForm({ ...form, current_employer: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">LinkedIn URL</label>
                <input className="tiq-input" value={form.linkedin_url} onChange={(e) => setForm({ ...form, linkedin_url: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Total Experience (years)</label>
                <input className="tiq-input" value={form.total_experience_years} onChange={(e) => setForm({ ...form, total_experience_years: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Salary Expectation</label>
                <input className="tiq-input" value={form.salary_expectation} onChange={(e) => setForm({ ...form, salary_expectation: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Notice Period (days)</label>
                <input className="tiq-input" type="number" value={form.notice_period_days} onChange={(e) => setForm({ ...form, notice_period_days: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Source</label>
                <select className="tiq-select" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                  {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></div>
              <div className="tiq-form-group"><label className="tiq-label">Status</label>
                <select className="tiq-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select></div>
            </div>
            <div className="tiq-form-group"><label className="tiq-label">Skills (comma-separated)</label>
              <input className="tiq-input" value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} /></div>
            <div className="tiq-form-group"><label className="tiq-label">Tags (comma-separated)</label>
              <input className="tiq-input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></div>
            <div className="tiq-form-group"><label className="tiq-label">Notes</label>
              <textarea className="tiq-input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>

            <div className="tiq-grid-2">
              <div className="tiq-form-group">
                <label className="tiq-label">Resume (PDF or Word)</label>
                {formExistingResume && !formResumeFile && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>On file: {formExistingResume.filename}</div>
                )}
                <label className="tiq-btn tiq-btn-outline" style={{ cursor: "pointer", display: "inline-flex", width: "100%", justifyContent: "center" }}>
                  <Upload size={14} /> {formResumeFile ? formResumeFile.name : (formExistingResume ? "Replace resume" : "Upload resume")}
                  <input type="file" hidden accept=".pdf,.docx,.doc,.txt"
                         onChange={(e) => setFormResumeFile(e.target.files?.[0] || null)} />
                </label>
              </div>
              <div className="tiq-form-group">
                <label className="tiq-label">Cover Letter File (PDF or Word)</label>
                {formExistingCoverLetter && !formCoverLetterFile && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>On file: {formExistingCoverLetter.filename}</div>
                )}
                <label className="tiq-btn tiq-btn-outline" style={{ cursor: "pointer", display: "inline-flex", width: "100%", justifyContent: "center" }}>
                  <Upload size={14} /> {formCoverLetterFile ? formCoverLetterFile.name : (formExistingCoverLetter ? "Replace cover letter" : "Upload cover letter")}
                  <input type="file" hidden accept=".pdf,.docx,.doc"
                         onChange={(e) => setFormCoverLetterFile(e.target.files?.[0] || null)} />
                </label>
              </div>
            </div>

            <div className="tiq-form-group"><label className="tiq-label">Cover Letter (typed text — optional; either this or the file above works, or both)</label>
              <textarea className="tiq-input" rows={4} value={form.cover_letter_text} onChange={(e) => setForm({ ...form, cover_letter_text: e.target.value })}
                        placeholder="Dear Hiring Manager, ..." /></div>
            <div className="tiq-form-group" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={form.consent_given} onChange={(e) => setForm({ ...form, consent_given: e.target.checked })} />
              <label className="tiq-label" style={{ margin: 0 }}>Candidate has given consent to store their data</label>
            </div>
            <div className="tiq-flex-end" style={{ marginTop: 16 }}>
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" disabled={saving} onClick={submitForm}>{saving ? "Saving…" : "Save Candidate"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Merge Modal ────────────────────────────────────────── */}
      {mergeTarget && mergeDuplicate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 560, width: "94%" }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Possible Duplicate Found</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
              These look like the same person. Merging keeps one record and combines their history — the merged-away
              record is preserved for audit, not deleted.
            </div>
            <div className="tiq-grid-2" style={{ marginBottom: 16 }}>
              <div className="tiq-card"><b>{mergeTarget.full_name}</b><div style={{ fontSize: 12 }}>{mergeTarget.email}</div><div style={{ fontSize: 12 }}>{mergeTarget.phone}</div></div>
              <div className="tiq-card"><b>{mergeDuplicate.full_name}</b><div style={{ fontSize: 12 }}>{mergeDuplicate.email}</div><div style={{ fontSize: 12 }}>{mergeDuplicate.phone}</div></div>
            </div>
            <div className="tiq-flex-end">
              <button className="tiq-btn tiq-btn-ghost" onClick={() => { setMergeTarget(null); setMergeDuplicate(null); }}>Cancel</button>
              <button className="tiq-btn tiq-btn-outline" onClick={() => confirmMerge(mergeDuplicate.id, mergeTarget.id)}>
                Keep "{mergeDuplicate.full_name}" as primary
              </button>
              <button className="tiq-btn tiq-btn-primary" onClick={() => confirmMerge(mergeTarget.id, mergeDuplicate.id)}>
                Keep "{mergeTarget.full_name}" as primary
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cover Letter Text Modal ────────────────────────────── */}
      {coverLetterTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 620, width: "94%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Cover Letter — {coverLetterTarget.full_name}</div>
              <button onClick={() => setCoverLetterTarget(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              Type or paste a cover letter directly — this doesn't replace an uploaded file (if any); both can exist side by side.
            </div>
            <textarea className="tiq-input" rows={12} value={coverLetterText} onChange={(e) => setCoverLetterText(e.target.value)}
                      placeholder="Dear Hiring Manager, ..." />
            <div className="tiq-flex-end" style={{ marginTop: 16 }}>
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setCoverLetterTarget(null)}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" disabled={savingCoverLetter} onClick={saveCoverLetterText}>
                {savingCoverLetter ? "Saving…" : "Save Cover Letter"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CSV Import ─────────────────────────────────────────── */}
      {showCsv && (
        <CsvImportModal
          title="Candidates"
          columns={["full_name", "email", "phone", "location", "current_title", "current_employer", "skills"]}
          sampleRow={["Jane Doe", "jane@example.com", "0400111222", "Sydney", "Senior Accountant", "Acme Pty Ltd", "Excel;SAP;Reconciliation"]}
          onImport={(form) => acquisitionApi.csvImport(form)}
          onClose={() => setShowCsv(false)}
          onDone={load}
        />
      )}

      {/* ── Bulk Folder Import (resumes + cover letters) ─────────── */}
      {showBulkImport && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 620, width: "94%", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Bulk Import from a Folder</div>
              <button onClick={closeBulkImport} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
              Select a folder (or multiple files) of resumes and cover letters. Files are automatically paired by
              filename — e.g. <code>Jane_Doe_Resume.pdf</code> + <code>Jane_Doe_Cover_Letter.docx</code> become one
              candidate with both attached. A resume with no matching cover letter (or vice versa) still creates a
              candidate with whatever it has. Matches against an existing candidate (by email, phone, or exact
              name) get the file attached to their existing record instead of creating a duplicate — nothing
              already on file (role, experience, skills, tags, pools) gets touched or lost.
            </div>

            {!bulkResult && (
              <>
                <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                  <label className="tiq-btn tiq-btn-outline" style={{ cursor: "pointer", flex: 1, justifyContent: "center", display: "inline-flex" }}>
                    <FolderUp size={14} /> Choose Folder
                    <input type="file" hidden multiple
                           ref={(el) => { if (el) el.setAttribute("webkitdirectory", "true"); }}
                           onChange={(e) => handleBulkFileSelect(e.target.files)} />
                  </label>
                  <label className="tiq-btn tiq-btn-outline" style={{ cursor: "pointer", flex: 1, justifyContent: "center", display: "inline-flex" }}>
                    <Upload size={14} /> Choose Files
                    <input type="file" hidden multiple accept=".pdf,.docx,.doc,.txt"
                           onChange={(e) => handleBulkFileSelect(e.target.files)} />
                  </label>
                </div>

                {bulkFiles.length > 0 && (
                  <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{bulkFiles.length} file(s) selected</div>
                    {bulkFiles.map((f, i) => (
                      <div key={i} style={{ fontSize: 12, color: "var(--text-muted)", padding: "2px 0" }}>{f.name}</div>
                    ))}
                  </div>
                )}

                {bulkError && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 12 }}>{bulkError}</div>}

                <div className="tiq-flex-end">
                  <button className="tiq-btn tiq-btn-ghost" onClick={closeBulkImport}>Cancel</button>
                  <button className="tiq-btn tiq-btn-primary" disabled={bulkFiles.length === 0 || bulkUploading} onClick={submitBulkImport}>
                    {bulkUploading ? "Importing…" : `Import ${bulkFiles.length || ""} File(s)`}
                  </button>
                </div>
              </>
            )}

            {bulkResult && (
              <div>
                <div className="tiq-alert tiq-alert-success" style={{ marginBottom: 12 }}>
                  Created {bulkResult.created} candidate(s).
                </div>
                {bulkResult.candidates?.length > 0 && (
                  <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginBottom: 12 }}>
                    {bulkResult.candidates.map((c: any) => (
                      <div key={c.id} style={{ fontSize: 12, padding: "3px 0", display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontWeight: 600 }}>{c.name}</span>
                        {c.has_resume && <span className="tiq-badge tiq-badge-teal" style={{ fontSize: 9 }}>Resume</span>}
                        {c.has_cover_letter && <span className="tiq-badge tiq-badge-violet" style={{ fontSize: 9 }}>Cover Letter</span>}
                      </div>
                    ))}
                  </div>
                )}
                {bulkResult.skipped_duplicates > 0 && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
                    {bulkResult.duplicate_details?.filter((d: any) => d.attached_to_existing).length > 0 && (
                      <div>
                        Matched {bulkResult.duplicate_details.filter((d: any) => d.attached_to_existing).length} existing candidate(s) already in your organisation
                        — their resume/cover letter was attached to their existing record instead of creating a duplicate,
                        so current role, experience, skills, and pool/tag data already on file stays intact.
                      </div>
                    )}
                  </div>
                )}
                {bulkResult.cover_letter_only > 0 && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
                    {bulkResult.cover_letter_only} cover letter(s) had no matching resume — created with cover letter only: {bulkResult.cover_letter_only_files?.join(", ")}
                  </div>
                )}
                <div className="tiq-flex-end">
                  <button className="tiq-btn tiq-btn-primary" onClick={closeBulkImport}>Done</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {org && (
        <div style={{ marginTop: 20, fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
          <ExternalLink size={12} /> Public careers page: <code>{window.location.origin}{org.apply_url_path}</code>
        </div>
      )}

      {messagePopup && (
        <MessagePopup type={messagePopup.type} message={messagePopup.message} onClose={() => setMessagePopup(null)} />
      )}

      {/* ── Applicant For Popup — full details of every requisition this
          candidate has actually been submitted to, plus their own
          pipeline stage for each one, not just a bare list of numbers.
          ─────────────────────────────────────────────────────────── */}
      {applicantForPopup && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
             onClick={() => setApplicantForPopup(null)}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 22, maxWidth: 640, width: "94%", maxHeight: "80vh", overflowY: "auto" }}
               onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontWeight: 800, fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
                <Briefcase size={16} /> Applicant For — {applicantForPopup.full_name}
              </div>
              <button onClick={() => setApplicantForPopup(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              Requisitions this candidate has been formally submitted to via the Pipeline module.
            </div>

            {loadingApplicantFor ? (
              <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
            ) : (applicantForPopup.applications || []).length === 0 ? (
              <div className="tiq-empty">Not an applicant to any requisition yet.</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {(applicantForPopup.applications || []).map((a: any) => {
                  const req = requisitions.find((r: any) => r.id === a.requisition_id);
                  const entry = applicantForEntries?.find((e: any) => e.requisition_id === a.requisition_id);
                  const salaryRange = req && (req.salary_min || req.salary_max)
                    ? `${req.salary_min ? req.salary_min.toLocaleString() : "?"} – ${req.salary_max ? req.salary_max.toLocaleString() : "?"}`
                    : null;
                  return (
                    <div key={a.requisition_id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>
                            #{a.sequence_number} — {a.title}
                          </div>
                          {req?.client_name && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{req.client_name}</div>}
                        </div>
                        {req?.status && (
                          <span className="tiq-badge tiq-badge-slate" style={{ flexShrink: 0 }}>{req.status}</span>
                        )}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 12, color: "var(--text-secondary)" }}>
                        {entry?.current_stage_name && (
                          <div><span style={{ color: "var(--text-muted)" }}>This candidate's stage: </span><strong>{entry.current_stage_name}</strong></div>
                        )}
                        {req?.priority && <div><span style={{ color: "var(--text-muted)" }}>Priority: </span>{req.priority}</div>}
                        {req?.location && <div><span style={{ color: "var(--text-muted)" }}>Location: </span>{req.location}</div>}
                        {req?.employment_type && <div><span style={{ color: "var(--text-muted)" }}>Type: </span>{req.employment_type}</div>}
                        {salaryRange && <div><span style={{ color: "var(--text-muted)" }}>Salary: </span>{salaryRange}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
