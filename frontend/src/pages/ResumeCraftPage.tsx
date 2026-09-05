import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Wrench, Sparkles, Download, Trash2, Plus, X, Save, FileEdit,
  Briefcase, GraduationCap, Award, FolderKanban, User as UserIcon,
  Mail, Phone, MapPin, Link2, AlertTriangle, CheckCircle, PenLine,
} from "lucide-react";
import { resumecraftApi, cvintelApi, downloadBlob } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import HistoryDropdown from "../components/HistoryDropdown";

// ── Types ────────────────────────────────────────────────────────────────

interface ExperienceEntry {
  job_title: string; company: string; location: string;
  start_date: string; end_date: string; bullets: string[];
}
interface EducationEntry {
  degree: string; institution: string; location: string; year: string; details: string;
}
interface ProjectEntry { name: string; description: string; }

interface ResumeData {
  full_name: string; headline: string; email: string; phone: string; location: string;
  linkedin: string; portfolio: string; summary: string;
  core_skills: string[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  certifications: string[];
  projects: ProjectEntry[];
  gap_fixes: string[];
}

const EMPTY_RESUME: ResumeData = {
  full_name: "", headline: "", email: "", phone: "", location: "",
  linkedin: "", portfolio: "", summary: "", core_skills: [],
  experience: [], education: [], certifications: [], projects: [],
  gap_fixes: [],
};

function normalizeResumeData(d: any): ResumeData {
  return { ...EMPTY_RESUME, ...(d || {}) };
}

// ── Small reusable bits ─────────────────────────────────────────────────

function ChipInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [input, setInput] = useState("");
  const add = () => {
    const v = input.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setInput("");
  };
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {values.map((v, i) => (
          <span key={i} className="tiq-badge tiq-badge-teal" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {v}
            <X size={11} style={{ cursor: "pointer" }} onClick={() => onChange(values.filter((_, idx) => idx !== i))} />
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="tiq-input" placeholder={placeholder} value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <button type="button" className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={add}><Plus size={14} /></button>
      </div>
    </div>
  );
}

function SectionCard({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="tiq-card" style={{ marginBottom: 16 }}>
      <div className="tiq-card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon size={16} color="var(--teal-500)" /> {title}
      </div>
      {children}
    </div>
  );
}

// ── The full resume.io-style builder form ────────────────────────────────

function ResumeBuilderForm({ data, onChange }: { data: ResumeData; onChange: (d: ResumeData) => void }) {
  const set = (patch: Partial<ResumeData>) => onChange({ ...data, ...patch });

  const updateExperience = (i: number, patch: Partial<ExperienceEntry>) => {
    const next = [...data.experience];
    next[i] = { ...next[i], ...patch };
    set({ experience: next });
  };
  const updateEducation = (i: number, patch: Partial<EducationEntry>) => {
    const next = [...data.education];
    next[i] = { ...next[i], ...patch };
    set({ education: next });
  };
  const updateProject = (i: number, patch: Partial<ProjectEntry>) => {
    const next = [...data.projects];
    next[i] = { ...next[i], ...patch };
    set({ projects: next });
  };

  return (
    <>
      <SectionCard icon={UserIcon} title="Personal Details">
        <div className="tiq-grid-2">
          <div className="tiq-form-group">
            <label className="tiq-label">Full Name</label>
            <input className="tiq-input" value={data.full_name} onChange={e => set({ full_name: e.target.value })} placeholder="Jane Doe" />
          </div>
          <div className="tiq-form-group">
            <label className="tiq-label">Headline / Target Title</label>
            <input className="tiq-input" value={data.headline} onChange={e => set({ headline: e.target.value })} placeholder="Senior Product Manager" />
          </div>
          <div className="tiq-form-group">
            <label className="tiq-label"><Mail size={12} style={{ display: "inline", marginRight: 4 }} />Email</label>
            <input className="tiq-input" value={data.email} onChange={e => set({ email: e.target.value })} placeholder="jane@example.com" />
          </div>
          <div className="tiq-form-group">
            <label className="tiq-label"><Phone size={12} style={{ display: "inline", marginRight: 4 }} />Phone</label>
            <input className="tiq-input" value={data.phone} onChange={e => set({ phone: e.target.value })} placeholder="+61 400 000 000" />
          </div>
          <div className="tiq-form-group">
            <label className="tiq-label"><MapPin size={12} style={{ display: "inline", marginRight: 4 }} />Location</label>
            <input className="tiq-input" value={data.location} onChange={e => set({ location: e.target.value })} placeholder="Sydney, NSW" />
          </div>
          <div className="tiq-form-group">
            <label className="tiq-label"><Link2 size={12} style={{ display: "inline", marginRight: 4 }} />LinkedIn</label>
            <input className="tiq-input" value={data.linkedin} onChange={e => set({ linkedin: e.target.value })} placeholder="linkedin.com/in/janedoe" />
          </div>
        </div>
        <div className="tiq-form-group">
          <label className="tiq-label">Portfolio / Website</label>
          <input className="tiq-input" value={data.portfolio} onChange={e => set({ portfolio: e.target.value })} placeholder="janedoe.com" />
        </div>
      </SectionCard>

      <SectionCard icon={FileEdit} title="Professional Summary">
        <textarea
          className="tiq-input" rows={4} value={data.summary}
          onChange={e => set({ summary: e.target.value })}
          placeholder="2-4 sentences summarising your experience and what you bring to the target role."
        />
      </SectionCard>

      <SectionCard icon={Award} title="Core Skills">
        <ChipInput values={data.core_skills} onChange={v => set({ core_skills: v })} placeholder="Type a skill and press Enter" />
      </SectionCard>

      <SectionCard icon={Briefcase} title="Experience">
        {data.experience.map((job, i) => (
          <div key={i} className="tiq-card" style={{ background: "var(--slate-50, #f8fafc)", marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Trash2 size={15} style={{ cursor: "pointer" }} color="var(--rose-500, #e11d48)"
                onClick={() => set({ experience: data.experience.filter((_, idx) => idx !== i) })} />
            </div>
            <div className="tiq-grid-2">
              <div className="tiq-form-group">
                <label className="tiq-label">Job Title</label>
                <input className="tiq-input" value={job.job_title} onChange={e => updateExperience(i, { job_title: e.target.value })} />
              </div>
              <div className="tiq-form-group">
                <label className="tiq-label">Company</label>
                <input className="tiq-input" value={job.company} onChange={e => updateExperience(i, { company: e.target.value })} />
              </div>
              <div className="tiq-form-group">
                <label className="tiq-label">Location</label>
                <input className="tiq-input" value={job.location} onChange={e => updateExperience(i, { location: e.target.value })} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div className="tiq-form-group" style={{ flex: 1 }}>
                  <label className="tiq-label">Start</label>
                  <input className="tiq-input" value={job.start_date} onChange={e => updateExperience(i, { start_date: e.target.value })} placeholder="Jan 2022" />
                </div>
                <div className="tiq-form-group" style={{ flex: 1 }}>
                  <label className="tiq-label">End</label>
                  <input className="tiq-input" value={job.end_date} onChange={e => updateExperience(i, { end_date: e.target.value })} placeholder="Present" />
                </div>
              </div>
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">Achievements (one per line)</label>
              <textarea
                className="tiq-input" rows={4}
                value={job.bullets.join("\n")}
                onChange={e => updateExperience(i, { bullets: e.target.value.split("\n") })}
                placeholder={"Led a team of 5 engineers to ship X, reducing Y by 30%\nOwned end-to-end delivery of Z"}
              />
            </div>
          </div>
        ))}
        <button type="button" className="tiq-btn tiq-btn-outline tiq-btn-sm"
          onClick={() => set({ experience: [...data.experience, { job_title: "", company: "", location: "", start_date: "", end_date: "", bullets: [] }] })}>
          <Plus size={14} /> Add Experience
        </button>
      </SectionCard>

      <SectionCard icon={GraduationCap} title="Education">
        {data.education.map((edu, i) => (
          <div key={i} className="tiq-card" style={{ background: "var(--slate-50, #f8fafc)", marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Trash2 size={15} style={{ cursor: "pointer" }} color="var(--rose-500, #e11d48)"
                onClick={() => set({ education: data.education.filter((_, idx) => idx !== i) })} />
            </div>
            <div className="tiq-grid-2">
              <div className="tiq-form-group">
                <label className="tiq-label">Degree</label>
                <input className="tiq-input" value={edu.degree} onChange={e => updateEducation(i, { degree: e.target.value })} />
              </div>
              <div className="tiq-form-group">
                <label className="tiq-label">Institution</label>
                <input className="tiq-input" value={edu.institution} onChange={e => updateEducation(i, { institution: e.target.value })} />
              </div>
              <div className="tiq-form-group">
                <label className="tiq-label">Location</label>
                <input className="tiq-input" value={edu.location} onChange={e => updateEducation(i, { location: e.target.value })} />
              </div>
              <div className="tiq-form-group">
                <label className="tiq-label">Year</label>
                <input className="tiq-input" value={edu.year} onChange={e => updateEducation(i, { year: e.target.value })} placeholder="2021" />
              </div>
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">Details (optional)</label>
              <input className="tiq-input" value={edu.details} onChange={e => updateEducation(i, { details: e.target.value })} placeholder="Honours, GPA, relevant coursework..." />
            </div>
          </div>
        ))}
        <button type="button" className="tiq-btn tiq-btn-outline tiq-btn-sm"
          onClick={() => set({ education: [...data.education, { degree: "", institution: "", location: "", year: "", details: "" }] })}>
          <Plus size={14} /> Add Education
        </button>
      </SectionCard>

      <SectionCard icon={Award} title="Certifications">
        <ChipInput values={data.certifications} onChange={v => set({ certifications: v })} placeholder="Type a certification and press Enter" />
      </SectionCard>

      <SectionCard icon={FolderKanban} title="Projects">
        {data.projects.map((proj, i) => (
          <div key={i} className="tiq-card" style={{ background: "var(--slate-50, #f8fafc)", marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Trash2 size={15} style={{ cursor: "pointer" }} color="var(--rose-500, #e11d48)"
                onClick={() => set({ projects: data.projects.filter((_, idx) => idx !== i) })} />
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">Project Name</label>
              <input className="tiq-input" value={proj.name} onChange={e => updateProject(i, { name: e.target.value })} />
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">Description</label>
              <textarea className="tiq-input" rows={2} value={proj.description} onChange={e => updateProject(i, { description: e.target.value })} />
            </div>
          </div>
        ))}
        <button type="button" className="tiq-btn tiq-btn-outline tiq-btn-sm"
          onClick={() => set({ projects: [...data.projects, { name: "", description: "" }] })}>
          <Plus size={14} /> Add Project
        </button>
      </SectionCard>
    </>
  );
}

// ── Live preview (mirrors the .docx export layout) ───────────────────────

function ResumePreview({ data }: { data: ResumeData }) {
  return (
    <div className="tiq-card" style={{ fontSize: 13, lineHeight: 1.5, position: "sticky", top: 16 }}>
      <div style={{ textAlign: "center", marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 19, color: "#1f2937" }}>{data.full_name || "Your Name"}</div>
        {data.headline && <div style={{ color: "var(--teal-500)", fontSize: 13, marginTop: 2 }}>{data.headline}</div>}
        <div style={{ color: "#6b7280", fontSize: 11, marginTop: 4 }}>
          {[data.email, data.phone, data.location, data.linkedin, data.portfolio].filter(Boolean).join("  |  ")}
        </div>
      </div>
      {data.summary && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 700, color: "var(--teal-500)", fontSize: 11, textTransform: "uppercase", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>Summary</div>
          <div>{data.summary}</div>
        </div>
      )}
      {data.core_skills.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 700, color: "var(--teal-500)", fontSize: 11, textTransform: "uppercase", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>Core Skills</div>
          <div>{data.core_skills.join(" • ")}</div>
        </div>
      )}
      {data.experience.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 700, color: "var(--teal-500)", fontSize: 11, textTransform: "uppercase", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>Experience</div>
          {data.experience.map((job, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div><strong>{job.job_title || "Job Title"}</strong> — {job.company || "Company"}</div>
              <div style={{ fontStyle: "italic", color: "#6b7280", fontSize: 11 }}>
                {[job.location, [job.start_date, job.end_date].filter(Boolean).join(" - ")].filter(Boolean).join("  |  ")}
              </div>
              <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
                {job.bullets.filter(Boolean).map((b, bi) => <li key={bi}>{b}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
      {data.education.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 700, color: "var(--teal-500)", fontSize: 11, textTransform: "uppercase", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>Education</div>
          {data.education.map((edu, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <div><strong>{edu.degree || "Degree"}</strong> — {edu.institution || "Institution"}</div>
              <div style={{ fontStyle: "italic", color: "#6b7280", fontSize: 11 }}>{[edu.location, edu.year].filter(Boolean).join("  |  ")}</div>
              {edu.details && <div>{edu.details}</div>}
            </div>
          ))}
        </div>
      )}
      {data.certifications.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 700, color: "var(--teal-500)", fontSize: 11, textTransform: "uppercase", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>Certifications</div>
          <div>{data.certifications.join(" • ")}</div>
        </div>
      )}
      {data.projects.length > 0 && (
        <div>
          <div style={{ fontWeight: 700, color: "var(--teal-500)", fontSize: 11, textTransform: "uppercase", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>Projects</div>
          {data.projects.map((p, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <strong>{p.name}</strong>{p.description && <div>{p.description}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function ResumeCraftPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<"generate" | "build" | "history">("generate");

  // Shared editor state — populated by Generate (AI), by "Build from
  // Scratch" (blank), or by opening an item from History.
  const [activeDocId, setActiveDocId] = useState<number | null>(null);
  const [viewDoc, setViewDoc] = useState<any | null>(null);
  const [jobTitle, setJobTitle] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [resumeData, setResumeData] = useState<ResumeData>(EMPTY_RESUME);
  const [coverLetterText, setCoverLetterText] = useState("");
  const [warnings, setWarnings] = useState<{ resume?: string; coverLetter?: string }>({});
  const [showEditor, setShowEditor] = useState(false);

  // Generate-tab-only state
  const [selectedCvId, setSelectedCvId] = useState<number | string | null>(null);
  const [useFreshInput, setUseFreshInput] = useState(false);
  const [freshResumeText, setFreshResumeText] = useState("");
  const [freshJdText, setFreshJdText] = useState("");

  const { data: cvHistory = [] } = useQuery({ queryKey: ["cvintel-history"], queryFn: cvintelApi.listHistory });
  const { data: documents = [] } = useQuery({ queryKey: ["resumecraft-documents"], queryFn: resumecraftApi.list });

  // Arrived here via CVAnalysis's "Create Resume & Cover Letter" link
  // (?cvId=&jobTitle=&company=) — pre-fill the Generate tab with that
  // specific analysis pre-selected rather than making the person hunt
  // for it in the dropdown again. Consumed once and stripped from the
  // URL so it doesn't re-apply if they navigate away and back.
  useEffect(() => {
    const cvId = searchParams.get("cvId");
    if (!cvId) return;
    setSelectedCvId(Number(cvId));
    setUseFreshInput(false);
    setJobTitle(searchParams.get("jobTitle") || "");
    setCompanyName(searchParams.get("company") || "");
    setTab("generate");
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadIntoEditor = (doc: any) => {
    setActiveDocId(doc.id);
    setJobTitle(doc.jobTitle || "");
    setCompanyName(doc.companyName || "");
    setResumeData(normalizeResumeData(doc.resumeData));
    setCoverLetterText(doc.coverLetterText || "");
    setWarnings({ resume: doc.resumeWarning, coverLetter: doc.coverLetterWarning });
    setShowEditor(true);
  };

  const generateMut = useMutation({
    mutationFn: () => resumecraftApi.generate({
      job_title: jobTitle,
      company_name: companyName,
      cvanalysis_record_id: useFreshInput ? null : (selectedCvId || null),
      resume_text: useFreshInput ? freshResumeText : undefined,
      jd_text: useFreshInput ? freshJdText : undefined,
    }),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ["resumecraft-documents"] });
      qc.invalidateQueries({ queryKey: ["cvintel-history"] });
      loadIntoEditor(doc);
    },
  });

  const createManualMut = useMutation({
    mutationFn: () => resumecraftApi.createManual({
      job_title: jobTitle, company_name: companyName,
      resume_data: resumeData, cover_letter_text: coverLetterText,
    }),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ["resumecraft-documents"] });
      loadIntoEditor(doc);
    },
  });

  const updateMut = useMutation({
    mutationFn: () => resumecraftApi.update(activeDocId as number, {
      job_title: jobTitle, company_name: companyName,
      resume_data: resumeData, cover_letter_text: coverLetterText,
    }),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ["resumecraft-documents"] });
      loadIntoEditor(doc);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => resumecraftApi.delete(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["resumecraft-documents"] });
      if (activeDocId === id) { setShowEditor(false); setActiveDocId(null); }
      if (viewDoc?.id === id) setViewDoc(null);
    },
  });

  const downloadResume = async (id: number, name: string) => {
    const blob = await resumecraftApi.downloadResume(id);
    downloadBlob(blob, `Resume_${name || id}.docx`);
  };
  const downloadCoverLetter = async (id: number, name: string) => {
    const blob = await resumecraftApi.downloadCoverLetter(id);
    downloadBlob(blob, `CoverLetter_${name || id}.docx`);
  };

  const startBuildFromScratch = () => {
    setActiveDocId(null);
    setJobTitle(""); setCompanyName("");
    setResumeData({ ...EMPTY_RESUME, full_name: user?.name || "", email: user?.email || "" });
    setCoverLetterText("");
    setWarnings({});
    setShowEditor(true);
    setTab("build");
  };

  const cvOptions = cvHistory.map((h: any) => ({
    id: h.id,
    label: `${h.sourceName || "Resume"} — ${h.jdInfo?.rawText ? (h.jdInfo.rawText.slice(0, 40) + "...") : "JD"} (${Math.round(h.overallScore || 0)}%)`,
  }));

  const isSaving = generateMut.isPending || createManualMut.isPending || updateMut.isPending;
  const isExistingDoc = activeDocId !== null;

  return (
    <div>
      <div className="tiq-page-header">
        <h1 className="tiq-page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Wrench size={22} color="var(--teal-500)" /> ResumeCraft
        </h1>
        <p className="tiq-page-sub">
          Generate a tailored resume &amp; cover letter for one job — using CVAnalysis's matched skills, gaps and
          requirements — or build both from scratch.
        </p>
      </div>

      {!showEditor && (
        <div className="tiq-tabs" style={{ marginBottom: 20 }}>
          <button className={`tiq-tab${tab === "generate" ? " active" : ""}`} onClick={() => setTab("generate")}>
            <Sparkles size={12} style={{ display: "inline", marginRight: 6 }} /> Generate from CVAnalysis
          </button>
          <button className={`tiq-tab${tab === "build" ? " active" : ""}`} onClick={startBuildFromScratch}>
            <PenLine size={12} style={{ display: "inline", marginRight: 6 }} /> Build from Scratch
          </button>
          <button className={`tiq-tab${tab === "history" ? " active" : ""}`} onClick={() => setTab("history")}>
            <FileEdit size={12} style={{ display: "inline", marginRight: 6 }} /> History
            {documents.length > 0 && <span className="tiq-badge tiq-badge-slate" style={{ marginLeft: 8, fontSize: 10 }}>{documents.length}</span>}
          </button>
        </div>
      )}

      {!showEditor && tab === "generate" && (
        <div className="tiq-card">
          <div className="tiq-grid-2">
            <div className="tiq-form-group">
              <label className="tiq-label">Job Title</label>
              <input className="tiq-input" value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="Senior Backend Engineer" />
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">Company</label>
              <input className="tiq-input" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Acme Corp" />
            </div>
          </div>

          <div className="tiq-form-group">
            <label className="tiq-label">
              Source: existing CVAnalysis analysis
              <span style={{ fontWeight: 400, color: "#6b7280" }}> — its matched skills, gaps and requirements feed the AI</span>
            </label>
            {!useFreshInput && (
              cvOptions.length > 0 ? (
                <HistoryDropdown
                  value={selectedCvId} onChange={setSelectedCvId} options={cvOptions}
                  onDelete={() => { }}
                  placeholder="Select a CVAnalysis analysis…"
                />
              ) : (
                <div className="tiq-alert tiq-alert-info">
                  No saved CVAnalysis analyses yet. Run one in <strong>CVAnalysis</strong> first, or paste a resume + JD below instead.
                </div>
              )
            )}
            <button type="button" className="tiq-btn tiq-btn-ghost tiq-btn-sm" style={{ marginTop: 8 }}
              onClick={() => setUseFreshInput(v => !v)}>
              {useFreshInput ? "Use a saved CVAnalysis analysis instead" : "Paste resume + JD text instead"}
            </button>
          </div>

          {useFreshInput && (
            <div className="tiq-grid-2">
              <div className="tiq-form-group">
                <label className="tiq-label">Resume text</label>
                <textarea className="tiq-input" rows={8} value={freshResumeText} onChange={e => setFreshResumeText(e.target.value)} placeholder="Paste resume text…" />
              </div>
              <div className="tiq-form-group">
                <label className="tiq-label">Job description text</label>
                <textarea className="tiq-input" rows={8} value={freshJdText} onChange={e => setFreshJdText(e.target.value)} placeholder="Paste job description…" />
              </div>
            </div>
          )}

          {generateMut.isError && (
            <div className="tiq-alert tiq-alert-error">
              <AlertTriangle size={14} style={{ display: "inline", marginRight: 6 }} />
              {(generateMut.error as any)?.response?.data?.detail || "Generation failed. Please try again."}
            </div>
          )}

          <div className="tiq-flex-end">
            <button
              className="tiq-btn tiq-btn-primary"
              disabled={generateMut.isPending || !jobTitle.trim() || (!useFreshInput && !selectedCvId) || (useFreshInput && (!freshResumeText.trim() || !freshJdText.trim()))}
              onClick={() => generateMut.mutate()}
            >
              <Sparkles size={14} /> {generateMut.isPending ? "Generating…" : "Generate with AI"}
            </button>
          </div>
        </div>
      )}

      {!showEditor && tab === "history" && (
        <div className="tiq-table-wrap">
          <table className="tiq-table">
            <thead>
              <tr><th>Job Title</th><th>Company</th><th>Created</th><th>Source</th><th></th></tr>
            </thead>
            <tbody>
              {documents.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: "center", color: "#6b7280", padding: 24 }}>No saved documents yet.</td></tr>
              )}
              {documents.map((doc: any) => (
                <tr key={doc.id} style={{ cursor: "pointer" }} onClick={() => setViewDoc(doc)}>
                  <td>{doc.jobTitle || "—"}</td>
                  <td>{doc.companyName || "—"}</td>
                  <td>{doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : "—"}</td>
                  <td>
                    {doc.aiPowered
                      ? <span className="tiq-badge tiq-badge-violet"><Sparkles size={10} style={{ display: "inline", marginRight: 4 }} />AI</span>
                      : <span className="tiq-badge tiq-badge-slate">Manual</span>}
                  </td>
                  <td style={{ display: "flex", gap: 10, justifyContent: "flex-end" }} onClick={e => e.stopPropagation()}>
                    <span title="Edit"><PenLine size={15} style={{ cursor: "pointer" }} onClick={() => loadIntoEditor(doc)} /></span>
                    <span title="Download resume"><Download size={15} style={{ cursor: "pointer" }} onClick={() => downloadResume(doc.id, doc.resumeData?.full_name)} /></span>
                    <span title="Download cover letter"><Download size={15} style={{ cursor: "pointer" }} color="var(--teal-500)" onClick={() => downloadCoverLetter(doc.id, doc.companyName)} /></span>
                    <span title="Delete"><Trash2 size={15} style={{ cursor: "pointer" }} color="var(--rose-500, #e11d48)" onClick={() => { if (confirm("Delete this document?")) deleteMut.mutate(doc.id); }} /></span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showEditor && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
            <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => { setShowEditor(false); setTab("history"); }}>← Back</button>
            <div style={{ display: "flex", gap: 8 }}>
              {isExistingDoc && (
                <>
                  <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => downloadResume(activeDocId as number, resumeData.full_name)}>
                    <Download size={14} /> Resume .docx
                  </button>
                  <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => downloadCoverLetter(activeDocId as number, companyName)}>
                    <Download size={14} /> Cover Letter .docx
                  </button>
                </>
              )}
              <button
                className="tiq-btn tiq-btn-primary tiq-btn-sm"
                disabled={isSaving}
                onClick={() => isExistingDoc ? updateMut.mutate() : createManualMut.mutate()}
              >
                <Save size={14} /> {isSaving ? "Saving…" : isExistingDoc ? "Save Changes" : "Save Documents"}
              </button>
            </div>
          </div>

          {(warnings.resume || warnings.coverLetter) && (
            <div className="tiq-alert tiq-alert-info" style={{ marginBottom: 16 }}>
              <AlertTriangle size={14} style={{ display: "inline", marginRight: 6 }} />
              {warnings.resume || warnings.coverLetter}
            </div>
          )}
          {resumeData.gap_fixes && resumeData.gap_fixes.length > 0 && (
            <div className="tiq-alert tiq-alert-success" style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, marginBottom: 6 }}>
                <CheckCircle size={14} /> Gaps addressed from your CVAnalysis
              </div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {resumeData.gap_fixes.map((fix, i) => <li key={i} style={{ marginBottom: 2 }}>{fix}</li>)}
              </ul>
            </div>
          )}
          {isExistingDoc && (updateMut.isSuccess || generateMut.isSuccess || createManualMut.isSuccess) && (
            <div className="tiq-alert tiq-alert-success" style={{ marginBottom: 16 }}>
              <CheckCircle size={14} style={{ display: "inline", marginRight: 6 }} /> Saved.
            </div>
          )}

          <div className="tiq-grid-2" style={{ marginBottom: 16 }}>
            <div className="tiq-form-group">
              <label className="tiq-label">Job Title</label>
              <input className="tiq-input" value={jobTitle} onChange={e => setJobTitle(e.target.value)} />
            </div>
            <div className="tiq-form-group">
              <label className="tiq-label">Company</label>
              <input className="tiq-input" value={companyName} onChange={e => setCompanyName(e.target.value)} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 20, alignItems: "start" }}>
            <div>
              <ResumeBuilderForm data={resumeData} onChange={setResumeData} />
              <SectionCard icon={Mail} title="Cover Letter">
                <textarea
                  className="tiq-input" rows={14} value={coverLetterText}
                  onChange={e => setCoverLetterText(e.target.value)}
                  placeholder="Dear Hiring Manager,..."
                />
              </SectionCard>
            </div>
            <ResumePreview data={resumeData} />
          </div>
        </div>
      )}

      {viewDoc && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setViewDoc(null)}
        >
          <div
            className="tiq-card"
            style={{ background: "#fff", maxWidth: 460, width: "92%", boxShadow: "0 25px 60px rgba(0,0,0,.4)" }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{viewDoc.jobTitle || "Untitled role"}</div>
                <div style={{ fontSize: 13, color: "#6b7280" }}>{viewDoc.companyName || "—"}</div>
              </div>
              <X size={18} style={{ cursor: "pointer", color: "#6b7280" }} onClick={() => setViewDoc(null)} />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0 18px" }}>
              {viewDoc.aiPowered
                ? <span className="tiq-badge tiq-badge-violet"><Sparkles size={10} style={{ display: "inline", marginRight: 4 }} />AI-generated</span>
                : <span className="tiq-badge tiq-badge-slate">Manually built</span>}
              <span style={{ fontSize: 12, color: "#6b7280" }}>
                {viewDoc.createdAt ? `Created ${new Date(viewDoc.createdAt).toLocaleString()}` : ""}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
              <button
                className="tiq-btn tiq-btn-primary"
                onClick={() => downloadResume(viewDoc.id, viewDoc.resumeData?.full_name)}
              >
                <Download size={14} /> Download Resume (.docx)
              </button>
              <button
                className="tiq-btn tiq-btn-outline"
                onClick={() => downloadCoverLetter(viewDoc.id, viewDoc.companyName)}
              >
                <Download size={14} /> Download Cover Letter (.docx)
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <button
                className="tiq-btn tiq-btn-ghost tiq-btn-sm"
                style={{ color: "var(--rose-500, #e11d48)" }}
                onClick={() => { if (confirm("Delete this document?")) { deleteMut.mutate(viewDoc.id); } }}
              >
                <Trash2 size={13} /> Delete
              </button>
              <button
                className="tiq-btn tiq-btn-outline tiq-btn-sm"
                onClick={() => { const d = viewDoc; setViewDoc(null); loadIntoEditor(d); }}
              >
                <PenLine size={13} /> Edit Full Document
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
