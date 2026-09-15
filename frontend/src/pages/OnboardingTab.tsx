import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { onboardingApi, api } from "../lib/api";
import {
  CheckCircle2, Circle, Plus, Trash2, UserCheck, Users, ClipboardList,
  Upload, Download, X, Phone, Mail, Star, Pencil,
} from "lucide-react";

const CATEGORY_COLORS: Record<string, string> = {
  "Paperwork": "#3b82f6", "Compliance": "#f59e0b", "Training": "#ec4899",
  "IT & Equipment": "#8b5cf6", "Orientation": "#10b981", "General": "#64748b",
};
const CATEGORIES = ["Paperwork", "Compliance", "Training", "IT & Equipment", "Orientation", "General"];

// Same "open a blob through the authenticated api instance" pattern used
// elsewhere for stored files (resumes, cover letters, JD documents) —
// a plain <a href> wouldn't carry the Authorization header.
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

function TaskRow({ task, onRefresh }: { task: any; onRefresh: () => void }) {
  const toggleMut = useMutation({
    mutationFn: () => onboardingApi.updateTask(task.id, { completed: !task.completed }),
    onSuccess: onRefresh,
  });
  const deleteMut = useMutation({
    mutationFn: () => onboardingApi.deleteTask(task.id),
    onSuccess: onRefresh,
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderBottom: "1px solid var(--border)" }}>
      <button onClick={() => toggleMut.mutate()} disabled={toggleMut.isPending}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0 }}>
        {task.completed ? <CheckCircle2 size={18} color="#10b981" /> : <Circle size={18} color="var(--text-muted)" />}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, textDecoration: task.completed ? "line-through" : "none", color: task.completed ? "var(--text-muted)" : "var(--text-primary)" }}>
          {task.title}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 2 }}>
          <span className="tiq-badge" style={{ fontSize: 9.5, background: `${CATEGORY_COLORS[task.category] || "#64748b"}22`, color: CATEGORY_COLORS[task.category] || "#64748b" }}>
            {task.category}
          </span>
          {task.assigned_to && <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}><UserCheck size={10} style={{ display: "inline", marginRight: 2 }} />{task.assigned_to}</span>}
          {task.due_date && <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>Due {new Date(task.due_date).toLocaleDateString()}</span>}
        </div>
      </div>
      <button onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", flexShrink: 0 }}>
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function PlacementChecklist({ placement, onRefreshList, hideHeader }: { placement: any; onRefreshList: () => void; hideHeader?: boolean }) {
  const qc = useQueryClient();
  const { data: tasks = [], refetch } = useQuery({
    queryKey: ["onboarding-tasks", placement.id],
    queryFn: () => onboardingApi.listTasks(placement.id),
  });
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState("General");

  const refresh = () => { refetch(); onRefreshList(); qc.invalidateQueries({ queryKey: ["onboarding-placements"] }); };

  const addMut = useMutation({
    mutationFn: () => onboardingApi.createTask({ placement_id: placement.id, title: newTitle.trim(), category: newCategory }),
    onSuccess: () => { setNewTitle(""); refresh(); },
  });

  const completed = tasks.filter((t: any) => t.completed).length;

  return (
    <div className="tiq-card" style={{ marginBottom: 16 }}>
      {!hideHeader && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{placement.candidate_name}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {placement.requisition_title} · Starts {placement.start_date ? new Date(placement.start_date).toLocaleDateString() : "—"}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: completed === tasks.length && tasks.length > 0 ? "#10b981" : "var(--text-secondary)" }}>
              {completed} / {tasks.length} complete
            </div>
            <div style={{ width: 120, height: 6, background: "var(--slate-100)", borderRadius: 3, overflow: "hidden", marginTop: 4 }}>
              <div style={{ width: `${tasks.length ? (completed / tasks.length) * 100 : 0}%`, height: "100%", background: "#10b981" }} />
            </div>
          </div>
        </div>
      )}
      {hideHeader && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: completed === tasks.length && tasks.length > 0 ? "#10b981" : "var(--text-secondary)" }}>
              {completed} / {tasks.length} complete
            </div>
            <div style={{ width: 120, height: 6, background: "var(--slate-100)", borderRadius: 3, overflow: "hidden", marginTop: 4 }}>
              <div style={{ width: `${tasks.length ? (completed / tasks.length) * 100 : 0}%`, height: "100%", background: "#10b981" }} />
            </div>
          </div>
        </div>
      )}

      {tasks.map((t: any) => <TaskRow key={t.id} task={t} onRefresh={refresh} />)}
      {tasks.length === 0 && <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 4px" }}>No checklist items yet.</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input className="tiq-input" style={{ flex: 1, fontSize: 12 }} placeholder="Add a task…"
               value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter" && newTitle.trim()) addMut.mutate(); }} />
        <select className="tiq-select" style={{ fontSize: 12 }} value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="tiq-btn tiq-btn-outline tiq-btn-sm" disabled={!newTitle.trim() || addMut.isPending}
                onClick={() => addMut.mutate()}>
          <Plus size={13} /> Add
        </button>
      </div>
    </div>
  );
}

function ReferenceCheckForm({
  placementId, initial, options, onDone, onCancel,
}: {
  placementId: number; initial?: any; options: any; onDone: () => void; onCancel: () => void;
}) {
  const [form, setForm] = useState({
    referee_name: initial?.referee_name || "",
    referee_title: initial?.referee_title || "",
    referee_company: initial?.referee_company || "",
    relationship: initial?.relationship || "",
    referee_email: initial?.referee_email || "",
    referee_phone: initial?.referee_phone || "",
    mode: initial?.mode || "Online",
    status: initial?.status || "Pending",
    conducted_by: initial?.conducted_by || "",
    conducted_at: initial?.conducted_at ? initial.conducted_at.slice(0, 10) : "",
    recommendation: initial?.recommendation || "Not yet assessed",
    rating: initial?.rating ?? "",
    summary: initial?.summary || "",
  });
  const set = (field: string) => (e: any) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const saveMut = useMutation({
    mutationFn: () => {
      const payload: any = {
        ...form,
        rating: form.rating === "" ? null : Number(form.rating),
        conducted_at: form.conducted_at ? new Date(form.conducted_at).toISOString() : null,
      };
      return initial
        ? onboardingApi.updateReferenceCheck(initial.id, payload)
        : onboardingApi.createReferenceCheck({ placement_id: placementId, ...payload });
    },
    onSuccess: onDone,
  });

  const modes = options?.modes || ["Online", "Offline"];
  const statuses = options?.statuses || ["Pending", "Requested", "Completed", "Unable to Reach"];
  const recommendations = options?.recommendations || ["Positive", "Mixed", "Negative", "Not yet assessed"];

  return (
    <div className="tiq-card" style={{ marginBottom: 12, background: "var(--slate-50)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <input className="tiq-input" style={{ fontSize: 12 }} placeholder="Referee name *" value={form.referee_name} onChange={set("referee_name")} />
        <input className="tiq-input" style={{ fontSize: 12 }} placeholder="Relationship (e.g. Direct Manager)" value={form.relationship} onChange={set("relationship")} />
        <input className="tiq-input" style={{ fontSize: 12 }} placeholder="Referee title" value={form.referee_title} onChange={set("referee_title")} />
        <input className="tiq-input" style={{ fontSize: 12 }} placeholder="Referee company" value={form.referee_company} onChange={set("referee_company")} />
        <input className="tiq-input" style={{ fontSize: 12 }} placeholder="Email" value={form.referee_email} onChange={set("referee_email")} />
        <input className="tiq-input" style={{ fontSize: 12 }} placeholder="Phone" value={form.referee_phone} onChange={set("referee_phone")} />

        <select className="tiq-select" style={{ fontSize: 12 }} value={form.mode} onChange={set("mode")}>
          {modes.map((m: string) => <option key={m} value={m}>{m === "Online" ? "Online (submitted/logged directly)" : "Offline (paper/scanned form)"}</option>)}
        </select>
        <select className="tiq-select" style={{ fontSize: 12 }} value={form.status} onChange={set("status")}>
          {statuses.map((s: string) => <option key={s} value={s}>{s}</option>)}
        </select>

        <input className="tiq-input" style={{ fontSize: 12 }} placeholder="Conducted by (recruiter/HR)" value={form.conducted_by} onChange={set("conducted_by")} />
        <input className="tiq-input" style={{ fontSize: 12 }} type="date" value={form.conducted_at} onChange={set("conducted_at")} title="Date conducted" />

        <select className="tiq-select" style={{ fontSize: 12 }} value={form.recommendation} onChange={set("recommendation")}>
          {recommendations.map((r: string) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="tiq-select" style={{ fontSize: 12 }} value={form.rating} onChange={set("rating")}>
          <option value="">Rating (optional)</option>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}
        </select>
      </div>
      <textarea className="tiq-input" style={{ fontSize: 12, width: "100%", marginTop: 10, minHeight: 60, resize: "vertical" }}
                placeholder="Notes / write-up of the reference (what they said, concerns, would-rehire, etc.)"
                value={form.summary} onChange={set("summary")} />
      <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
        <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={onCancel}>Cancel</button>
        <button className="tiq-btn tiq-btn-primary tiq-btn-sm" disabled={!form.referee_name.trim() || saveMut.isPending}
                onClick={() => saveMut.mutate()}>
          {initial ? "Save changes" : "Add reference check"}
        </button>
      </div>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  "Pending": "#64748b", "Requested": "#f59e0b", "Completed": "#10b981", "Unable to Reach": "#ef4444",
};
const RECOMMENDATION_COLORS: Record<string, string> = {
  "Positive": "#10b981", "Mixed": "#f59e0b", "Negative": "#ef4444", "Not yet assessed": "#64748b",
};

function ReferenceCheckCard({ rc, options, onRefresh }: { rc: any; options: any; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false);

  const deleteMut = useMutation({ mutationFn: () => onboardingApi.deleteReferenceCheck(rc.id), onSuccess: onRefresh });
  const uploadMut = useMutation({
    mutationFn: (file: File) => onboardingApi.uploadReferenceCheckForm(rc.id, file),
    onSuccess: onRefresh,
  });
  const removeFormMut = useMutation({ mutationFn: () => onboardingApi.deleteReferenceCheckForm(rc.id), onSuccess: onRefresh });

  if (editing) {
    return <ReferenceCheckForm placementId={rc.placement_id} initial={rc} options={options}
                                onDone={() => { setEditing(false); onRefresh(); }} onCancel={() => setEditing(false)} />;
  }

  return (
    <div className="tiq-card" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {rc.referee_name}
            {rc.relationship && <span style={{ fontWeight: 400, fontSize: 12, color: "var(--text-muted)" }}>· {rc.relationship}</span>}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            {[rc.referee_title, rc.referee_company].filter(Boolean).join(" · ") || "—"}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap", fontSize: 11, color: "var(--text-muted)" }}>
            {rc.referee_email && <span><Mail size={10} style={{ display: "inline", marginRight: 3 }} />{rc.referee_email}</span>}
            {rc.referee_phone && <span><Phone size={10} style={{ display: "inline", marginRight: 3 }} />{rc.referee_phone}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Edit" onClick={() => setEditing(true)}><Pencil size={13} /></button>
          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Delete" disabled={deleteMut.isPending} onClick={() => { if (confirm(`Remove reference check for ${rc.referee_name}?`)) deleteMut.mutate(); }}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <span className="tiq-badge" style={{ fontSize: 9.5, background: rc.mode === "Online" ? "#3b82f622" : "#8b5cf622", color: rc.mode === "Online" ? "#3b82f6" : "#8b5cf6" }}>
          {rc.mode === "Online" ? "Online" : "Offline (form on file)"}
        </span>
        <span className="tiq-badge" style={{ fontSize: 9.5, background: `${STATUS_COLORS[rc.status] || "#64748b"}22`, color: STATUS_COLORS[rc.status] || "#64748b" }}>
          {rc.status}
        </span>
        <span className="tiq-badge" style={{ fontSize: 9.5, background: `${RECOMMENDATION_COLORS[rc.recommendation] || "#64748b"}22`, color: RECOMMENDATION_COLORS[rc.recommendation] || "#64748b" }}>
          {rc.recommendation}
        </span>
        {rc.rating != null && (
          <span className="tiq-badge" style={{ fontSize: 9.5, background: "#f59e0b22", color: "#f59e0b" }}>
            <Star size={9} style={{ display: "inline", marginRight: 2, position: "relative", top: -1 }} />{rc.rating}/5
          </span>
        )}
        {rc.conducted_at && (
          <span style={{ fontSize: 10.5, color: "var(--text-muted)", alignSelf: "center" }}>
            Conducted {new Date(rc.conducted_at).toLocaleDateString()}{rc.conducted_by ? ` by ${rc.conducted_by}` : ""}
          </span>
        )}
      </div>

      {rc.summary && (
        <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 10, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
          {rc.summary}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: "auto" }}>
          {rc.has_form ? `Stored form: ${rc.form_filename || "reference-check-form"}` : "No offline form uploaded"}
        </span>
        {rc.has_form && (
          <>
            <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => openBlobInNewTab(onboardingApi.referenceCheckFormUrl(rc.id))}>
              <Download size={12} /> View
            </button>
            <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Remove stored form" disabled={removeFormMut.isPending}
                    onClick={() => removeFormMut.mutate()}>
              <X size={12} />
            </button>
          </>
        )}
        <label className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ cursor: "pointer" }}>
          <Upload size={12} /> {rc.has_form ? "Replace form" : "Upload offline form"}
          <input type="file" hidden accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMut.mutate(f); e.target.value = ""; }} />
        </label>
      </div>
    </div>
  );
}

function ReferenceChecksPanel({ placement }: { placement: any }) {
  const { data: options } = useQuery({ queryKey: ["reference-check-options"], queryFn: onboardingApi.referenceCheckOptions });
  const { data: checks = [], refetch } = useQuery({
    queryKey: ["reference-checks", placement.id],
    queryFn: () => onboardingApi.listReferenceChecks(placement.id),
  });
  const [adding, setAdding] = useState(false);

  const completed = checks.filter((r: any) => r.status === "Completed").length;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {checks.length === 0 ? "No referees added yet." : `${completed} / ${checks.length} reference checks completed`}
          {" — "}record each referee here, whether the check was done online (a call or self-submitted form) or offline (a scanned/emailed paper form you upload below).
        </div>
        {!adding && (
          <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setAdding(true)}>
            <Plus size={13} /> Add referee
          </button>
        )}
      </div>

      {adding && (
        <ReferenceCheckForm placementId={placement.id} options={options}
                            onDone={() => { setAdding(false); refetch(); }} onCancel={() => setAdding(false)} />
      )}

      {checks.map((rc: any) => <ReferenceCheckCard key={rc.id} rc={rc} options={options} onRefresh={refetch} />)}
      {checks.length === 0 && !adding && (
        <div className="tiq-empty" style={{ padding: "24px 12px" }}>
          No reference checks recorded for this hire yet. Click "Add referee" to log one — online (typed up directly)
          or offline (upload the scanned/emailed form once you have it).
        </div>
      )}
    </div>
  );
}

export default function OnboardingTab() {
  const { data: placements = [], isLoading, refetch } = useQuery({
    queryKey: ["onboarding-placements"],
    queryFn: onboardingApi.listPlacements,
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [section, setSection] = useState<"checklist" | "references">("checklist");

  const selected = placements.find((p: any) => p.id === selectedId) || placements[0];

  if (isLoading) return <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>;

  if (placements.length === 0) {
    return (
      <div className="tiq-empty">
        No placements yet — an onboarding checklist appears automatically here the moment an offer is marked Accepted
        in the Pipeline & Offers tab.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 20 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
          New Hires ({placements.length})
        </div>
        {placements.map((p: any) => (
          <button key={p.id} onClick={() => setSelectedId(p.id)}
                  className={`tiq-nav-item${(selected && selected.id === p.id) ? " active" : ""}`}
                  style={{ width: "100%", textAlign: "left", color: "var(--text-primary)", padding: "10px 12px", marginBottom: 4, display: "block" }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{p.candidate_name}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {p.task_completed}/{p.task_total} tasks
              {p.refcheck_total > 0 && <> · {p.refcheck_completed}/{p.refcheck_total} refs</>}
            </div>
          </button>
        ))}
      </div>
      <div>
        {selected && (
          <>
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{selected.candidate_name}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {selected.requisition_title} · Starts {selected.start_date ? new Date(selected.start_date).toLocaleDateString() : "—"}
              </div>
            </div>
            <div className="tiq-tabs" style={{ margin: "14px 0 16px" }}>
              <button className={`tiq-tab${section === "checklist" ? " active" : ""}`} onClick={() => setSection("checklist")}>
                <ClipboardList size={12} style={{ display: "inline", marginRight: 6 }} /> Checklist
              </button>
              <button className={`tiq-tab${section === "references" ? " active" : ""}`} onClick={() => setSection("references")}>
                <Users size={12} style={{ display: "inline", marginRight: 6 }} /> Reference Checks
              </button>
            </div>
            {section === "checklist" && <PlacementChecklist placement={selected} onRefreshList={refetch} hideHeader />}
            {section === "references" && <ReferenceChecksPanel placement={selected} />}
          </>
        )}
      </div>
    </div>
  );
}
