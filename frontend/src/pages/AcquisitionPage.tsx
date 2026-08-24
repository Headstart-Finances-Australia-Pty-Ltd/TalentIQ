import { useEffect, useRef, useState } from "react";
import {
  UserPlus, Upload, Search, Link2, Copy, Check, Tag, Trash2,
  Merge, ExternalLink, X, FileText, FileSignature, PenLine, FolderUp, Eye,
} from "lucide-react";
import { acquisitionApi, api } from "../lib/api";
import CsvImportModal from "../components/candidatetrack/CsvImportModal";

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

const STATUS_OPTIONS = ["Active", "Do Not Contact", "Placed", "Archived"];
const SOURCE_LABELS: Record<string, string> = {
  career_page: "Career Page", manual: "Manual", referral: "Referral",
  linklens_linkedin: "LinkedIn (LinkLens)", jobhunt_import: "JobHunt", csv_import: "CSV Import",
  vendor: "Vendor", bulk_folder_import: "Bulk Folder Import",
};

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
  const [org, setOrg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [hasFilesFilter, setHasFilesFilter] = useState(false);
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

  const allVisibleSelected = candidates.length > 0 && candidates.every((c) => selected.has(c.id));
  const someVisibleSelected = candidates.some((c) => selected.has(c.id));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [someVisibleSelected, allVisibleSelected]);

  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (allVisibleSelected) {
        // All currently-visible rows are selected — deselect just those,
        // preserving any selection from a different filter/page if present.
        const next = new Set(prev);
        candidates.forEach((c) => next.delete(c.id));
        return next;
      }
      // Not all visible rows selected yet — select every currently-visible
      // (filtered/searched) row. Bulk actions only ever act on what's
      // visible, same as the per-row checkboxes.
      const next = new Set(prev);
      candidates.forEach((c) => next.add(c.id));
      return next;
    });
  };

  const load = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (poolFilter) params.pool_id = poolFilter;
      if (hasFilesFilter) params.has_files = true;
      const [c, p, o] = await Promise.all([
        acquisitionApi.listCandidates(params),
        acquisitionApi.listPools(),
        acquisitionApi.getOrganisation(),
      ]);
      setCandidates(c);
      setPools(p);
      setOrg(o);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [poolFilter, hasFilesFilter]);
  useEffect(() => {
    const t = setTimeout(load, search || statusFilter ? 300 : 0);
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

  const checkDuplicate = async (c: any) => {
    const res = await acquisitionApi.findDuplicates(c.id);
    if (!res.duplicate) { alert(`No likely duplicate found for ${c.full_name}.`); return; }
    setMergeTarget(c);
    setMergeDuplicate(res.duplicate);
  };

  const confirmMerge = async (primaryId: number, mergedId: number) => {
    await acquisitionApi.mergeCandidates(primaryId, mergedId);
    setMergeTarget(null);
    setMergeDuplicate(null);
    await load();
  };

  const createPool = async () => {
    if (!newPoolName.trim()) return;
    await acquisitionApi.createPool({ name: newPoolName.trim() });
    setNewPoolName("");
    setShowNewPool(false);
    await load();
  };

  const addSelectedToPool = async (poolId: number) => {
    if (selected.size === 0) return;
    await acquisitionApi.addPoolMembers(poolId, Array.from(selected));
    setSelected(new Set());
    await load();
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
          <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
            {/* Pool selector — inline with search/filters, no separate card */}
            <button
              className={`tiq-nav-item${poolFilter === null ? " active" : ""}`}
              style={{ color: "var(--text-primary)", padding: "8px 12px", display: "inline-flex", gap: 6, whiteSpace: "nowrap" }}
              onClick={() => setPoolFilter(null)}
            >
              All Candidates <span>{candidates.length}</span>
            </button>
            {pools.map((p) => (
              <button
                key={p.id}
                className={`tiq-nav-item${poolFilter === p.id ? " active" : ""}`}
                style={{ color: "var(--text-primary)", padding: "8px 12px", display: "inline-flex", gap: 6, whiteSpace: "nowrap" }}
                onClick={() => setPoolFilter(p.id)}
                title={p.description}
              >
                {p.name} <span>{p.member_count}</span>
              </button>
            ))}
            {!showNewPool ? (
              <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => setShowNewPool(true)}>
                + New Pool
              </button>
            ) : (
              <div style={{ display: "flex", gap: 6 }}>
                <input className="tiq-input" placeholder="Pool name" value={newPoolName}
                       onChange={(e) => setNewPoolName(e.target.value)} style={{ fontSize: 12, padding: "6px 8px" }} />
                <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={createPool}>Add</button>
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
                   title="Show only candidates with a resume or cover letter attached — useful for reviewing/bulk-deleting leftover import fragments">
              <input type="checkbox" checked={hasFilesFilter} onChange={(e) => setHasFilesFilter(e.target.checked)} style={{ margin: 0 }} />
              Has Resume/Cover Letter only
            </label>
            {selected.size > 0 && pools.length > 0 && (
              <select className="tiq-select" style={{ fontSize: 12 }}
                      onChange={(e) => { if (e.target.value) addSelectedToPool(Number(e.target.value)); e.target.value = ""; }}>
                <option value="">Add {selected.size} selected to pool…</option>
                {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            {selected.size > 0 && (
              <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ color: "#ef4444", borderColor: "#ef4444" }}
                      onClick={handleBulkDelete}>
                <Trash2 size={13} /> Delete {selected.size} selected
              </button>
            )}
          </div>

          {loading ? (
            <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
          ) : candidates.length === 0 ? (
            <div className="tiq-empty">No candidates yet. Add one, import a CSV, or share your careers link.</div>
          ) : (
            <div className="tiq-table-wrap">
              <table className="tiq-table">
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
                    <th>Candidate</th>
                    <th>Contact</th>
                    <th>Current Role</th>
                    <th>LinkedIn</th>
                    <th>Experience</th>
                    <th>Salary Expectation</th>
                    <th>Notice Period</th>
                    <th>Skills</th>
                    <th>Resume</th>
                    <th>Cover Letter</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Pools / Tags</th>
                    <th>Notes</th>
                    <th style={{ textAlign: "center" }}>Consent</th>
                    <th style={{ width: 110 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr key={c.id}>
                      <td><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} /></td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{c.full_name} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>#{c.sequence_number}</span></div>
                        {c.location && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.location}</div>}
                      </td>
                      <td>
                        <div style={{ fontSize: 12 }}>{c.email}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.phone}</div>
                      </td>
                      <td>
                        <div style={{ fontSize: 12 }}>{c.current_title}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.current_employer}</div>
                      </td>
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
                      <td style={{ fontSize: 12 }}>{c.salary_expectation}</td>
                      <td style={{ fontSize: 12 }}>
                        {c.notice_period_days || c.notice_period_days === 0 ? `${c.notice_period_days} days` : ""}
                      </td>
                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 160 }}>
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
                      <td>
                        {c.has_resume ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title={c.resume_filename}
                                    onClick={() => openBlobInNewTab(acquisitionApi.resumeDownloadUrl(c.id))}
                                    style={{ maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-flex", gap: 4 }}>
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
                      <td>
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
                      <td><span className={`tiq-badge ${c.status === "Active" ? "tiq-badge-teal" : "tiq-badge-slate"}`}>{c.status}</span></td>
                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 180 }}>
                          {c.pools?.map((p: string) => <span key={p} className="tiq-badge tiq-badge-violet">{p}</span>)}
                          {c.tags?.map((t: string) => <span key={t} className="tiq-badge tiq-badge-slate"><Tag size={9} style={{ marginRight: 2 }} />{t}</span>)}
                        </div>
                      </td>
                      <td style={{ fontSize: 12, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.notes}>
                        {c.notes}
                      </td>
                      <td style={{ textAlign: "center" }} title={c.consent_given ? "Consent given" : "No consent on file"}>
                        {c.consent_given ? <Check size={14} color="#0d9488" /> : <span style={{ color: "var(--text-muted)" }}>—</span>}
                      </td>
                      <td>
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
    </div>
  );
}
