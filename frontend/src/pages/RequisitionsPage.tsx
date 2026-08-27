import { useEffect, useState } from "react";
import {
  ClipboardList, Plus, X, Check, Link2, ChevronRight,
  AlertTriangle, Copy, Upload, Trash2, Building2, UserPlus,
} from "lucide-react";
import { requisitionApi, candidateTrackApi, pipelineApi, acquisitionApi } from "../lib/api";
import { ResizableFilterHeader } from "../components/ResizableFilterHeader";
import CsvImportModal from "../components/candidatetrack/CsvImportModal";

const STATUS_FLOW = ["Draft", "Approved", "Open", "On Hold", "Filled", "Cancelled"];
const STATUS_TRANSITIONS: Record<string, string[]> = {
  Draft: ["Approved", "Cancelled"],
  Approved: ["Open", "Cancelled"],
  Open: ["On Hold", "Filled", "Cancelled"],
  "On Hold": ["Open", "Cancelled"],
  Filled: [],
  Cancelled: [],
};
const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  Draft: { fg: "#64748b", bg: "rgba(100,116,139,.12)" },
  Approved: { fg: "#0d9488", bg: "rgba(13,148,136,.12)" },
  Open: { fg: "#10b981", bg: "rgba(16,185,129,.12)" },
  "On Hold": { fg: "#f59e0b", bg: "rgba(245,158,11,.12)" },
  Filled: { fg: "#3b82f6", bg: "rgba(59,130,246,.12)" },
  Cancelled: { fg: "#ef4444", bg: "rgba(239,68,68,.12)" },
};
const PRIORITIES = ["Critical", "High", "Normal", "Low"];
const PRIORITY_COLORS: Record<string, string> = { Critical: "#ef4444", High: "#f59e0b", Normal: "#64748b", Low: "#94a3b8" };
const REASONS = ["New Position", "Replacement", "Backfill", "Growth"];
const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Temporary"];

// Default column widths (px) — resizable per-column via the drag handle
// in ResizableFilterHeader; these are just the starting point.
const DEFAULT_COL_WIDTHS: Record<string, number> = {
  sequence_number: 80, title: 190, client: 150, priority: 110, vacancy_count: 100, reason_for_hire: 150,
  employment_type: 150, location: 140, salary_range: 150, target_hire_date: 140,
  status: 130, checklist: 120, hiring_manager: 160, application_count: 200,
};

const emptyForm = {
  title: "", client_id: "" as string | number, jd_record_id: "" as string | number,
  priority: "Normal", vacancy_count: 1, reason_for_hire: "", employment_type: "",
  location: "", salary_min: "" as string | number, salary_max: "" as string | number,
  target_hire_date: "", hiring_manager_contact_id: "" as string | number,
  hiring_manager_name: "", hiring_manager_email: "", notes: "",
};

export default function RequisitionsPage() {
  const [requisitions, setRequisitions] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [jds, setJds] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // One filter value per column, keyed by column id — replaces the old
  // status-only server-side filter with the same client-side pattern
  // used for every other column now that they all filter the same way.
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const setColFilter = (key: string, value: string) => setColFilters((f) => ({ ...f, [key]: value }));
  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_COL_WIDTHS);
  const setColWidth = (key: string, w: number) => setColWidths((prev) => ({ ...prev, [key]: w }));

  // ── Applicants popup — who's actually applied to this role ─────────
  const [applicantsReqId, setApplicantsReqId] = useState<number | null>(null);
  const [applicants, setApplicants] = useState<any[] | null>(null);
  const [loadingApplicants, setLoadingApplicants] = useState(false);
  const openApplicants = async (reqId: number) => {
    setApplicantsReqId(reqId);
    setApplicants(null);
    setLoadingApplicants(true);
    try {
      const entries = await pipelineApi.listEntries({ requisition_id: reqId });
      const withCandidates = await Promise.all(
        entries.map(async (e: any) => {
          try {
            const c = await acquisitionApi.getCandidate(e.candidate_id);
            return { ...e, candidate: c };
          } catch {
            return { ...e, candidate: null };
          }
        })
      );
      setApplicants(withCandidates);
    } finally {
      setLoadingApplicants(false);
    }
  };

  // ── Match & Submit — one click per role instead of manually ticking
  // candidates in Talent Pool. "Suitable" is judged the same way a
  // recruiter would skim a candidate list: their tags include this
  // exact role title (candidates tagged that way when imported/added),
  // or their current title overlaps with the role title. Always shown
  // for review before anything is actually submitted — this suggests,
  // it doesn't silently auto-apply anyone.
  const [matchReqId, setMatchReqId] = useState<number | null>(null);
  const [matchCandidates, setMatchCandidates] = useState<any[] | null>(null);
  const [matchSelected, setMatchSelected] = useState<Set<number>>(new Set());
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [submittingMatches, setSubmittingMatches] = useState(false);
  const [matchResult, setMatchResult] = useState<{ submitted: number; alreadyIn: number; failed: number } | null>(null);

  const isSuitableMatch = (c: any, reqTitle: string) => {
    const title = (c.current_title || "").toLowerCase().trim();
    const reqT = reqTitle.toLowerCase().trim();
    const tagMatch = (c.tags || []).some((t: string) => t.toLowerCase().trim() === reqT);
    const titleMatch = !!title && (title.includes(reqT) || reqT.includes(title));
    return tagMatch || titleMatch;
  };

  const openMatchModal = async (reqId: number) => {
    setMatchReqId(reqId);
    setMatchCandidates(null);
    setMatchSelected(new Set());
    setMatchResult(null);
    setLoadingMatches(true);
    try {
      const req = requisitions.find((r) => r.id === reqId);
      const all = await acquisitionApi.listCandidates();
      const suitable = req ? all.filter((c: any) => isSuitableMatch(c, req.title)) : [];
      setMatchCandidates(suitable);
      setMatchSelected(new Set(suitable.map((c: any) => c.id))); // pre-check every suggested match; still reviewable/deselectable before submit
    } finally {
      setLoadingMatches(false);
    }
  };
  const toggleMatchSelect = (id: number) => {
    setMatchSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const submitMatches = async () => {
    if (!matchReqId || matchSelected.size === 0) return;
    setSubmittingMatches(true);
    const results = await Promise.allSettled(
      Array.from(matchSelected).map((candidateId) => pipelineApi.submit({ candidate_id: candidateId, requisition_id: matchReqId }))
    );
    const submitted = results.filter((r) => r.status === "fulfilled").length;
    const alreadyIn = results.filter((r) => r.status === "rejected" && (r as PromiseRejectedResult).reason?.response?.status === 409).length;
    const failed = results.length - submitted - alreadyIn;
    setMatchResult({ submitted, alreadyIn, failed });
    setSubmittingMatches(false);
    await load(); // refresh Applications counts on the table behind the modal
  };

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [detailId, setDetailId] = useState<number | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [hmLinkModal, setHmLinkModal] = useState<{ url: string; copyFailed: boolean } | null>(null);
  const [checklistPopoverId, setChecklistPopoverId] = useState<number | null>(null);

  const [showCsv, setShowCsv] = useState(false);
  const [showClientCsv, setShowClientCsv] = useState(false);
  const [showClientsTable, setShowClientsTable] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [selectedClients, setSelectedClients] = useState<Set<number>>(new Set());
  const [clientFormState, setClientFormState] = useState<null | { mode: "create" } | { mode: "edit"; client: any }>(null);
  const [clientForm, setClientForm] = useState({
    name: "", address: "", abn: "", area_of_work: "",
    contact_id: null as number | null, contact_name: "", contact_title: "", contact_email: "", contact_phone: "",
  });
  const [clientFormSaving, setClientFormSaving] = useState(false);
  const [clientFormError, setClientFormError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [reqs, cl, jdList, cts] = await Promise.all([
        requisitionApi.list(),
        candidateTrackApi.listClients(),
        candidateTrackApi.listJDs(),
        requisitionApi.listContacts(),
      ]);
      setRequisitions(reqs);
      setClients(cl);
      setJds(jdList);
      setContacts(cts);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => { setForm(emptyForm); setEditingId(null); setFormError(""); setShowForm(true); };
  const openEdit = (r: any) => {
    setForm({
      title: r.title, client_id: r.client_id ?? "", jd_record_id: r.jd_record_id ?? "",
      priority: r.priority, vacancy_count: r.vacancy_count, reason_for_hire: r.reason_for_hire,
      employment_type: r.employment_type, location: r.location,
      salary_min: r.salary_min ?? "", salary_max: r.salary_max ?? "",
      target_hire_date: r.target_hire_date ? r.target_hire_date.slice(0, 10) : "",
      hiring_manager_contact_id: r.hiring_manager_contact_id ?? "",
      hiring_manager_name: r.hiring_manager_name, hiring_manager_email: r.hiring_manager_email,
      notes: r.notes,
    });
    setEditingId(r.id);
    setFormError("");
    setShowForm(true);
  };

  const submitForm = async () => {
    if (!form.title.trim()) { setFormError("Title is required."); return; }
    setSaving(true);
    setFormError("");
    const payload = {
      ...form,
      client_id: form.client_id === "" ? null : Number(form.client_id),
      jd_record_id: form.jd_record_id === "" ? null : Number(form.jd_record_id),
      vacancy_count: Number(form.vacancy_count) || 1,
      salary_min: form.salary_min === "" ? null : Number(form.salary_min),
      salary_max: form.salary_max === "" ? null : Number(form.salary_max),
      target_hire_date: form.target_hire_date ? new Date(form.target_hire_date).toISOString() : null,
      hiring_manager_contact_id: form.hiring_manager_contact_id === "" ? null : Number(form.hiring_manager_contact_id),
    };
    try {
      const saved = editingId ? await requisitionApi.update(editingId, payload) : await requisitionApi.create(payload);
      // Optimistic: the PUT/POST response already IS the fully updated
      // record — drop it straight into local state and close immediately
      // instead of waiting on a full reload round-trip before the modal
      // closes. load() still runs after, in the background, to pick up
      // anything cross-cutting (e.g. a brand-new client appearing in the
      // Client dropdown) — but the table itself updates instantly.
      setRequisitions((prev) => {
        if (editingId) return prev.map((r) => (r.id === editingId ? saved : r));
        return [saved, ...prev];
      });
      setShowForm(false);
      load();
    } catch (e: any) {
      setFormError(e?.response?.data?.detail || "Could not save requisition.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this requisition? This cannot be undone.")) return;
    try {
      await requisitionApi.remove(id);
      if (detailId === id) setDetailId(null);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not delete this requisition. Please try again.");
    }
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    // Select-all applies to the currently-visible (filtered) rows, not
    // every requisition regardless of what the column filters are
    // hiding — matches normal table UX once filtering is per-column.
    if (selected.size === filteredRequisitions.length) setSelected(new Set());
    else setSelected(new Set(filteredRequisitions.map((r) => r.id)));
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected requisition(s)? This cannot be undone.`)) return;
    try {
      const res = await requisitionApi.bulkDelete(Array.from(selected));
      setSelected(new Set());
      await load();
      if (res?.skipped?.length > 0) {
        const lines = res.skipped.map((s: any) => `• ${s.title}: ${s.reason}`).join("\n");
        alert(`Deleted ${res.deleted ?? 0} requisition(s).\n\n${res.skipped.length} could not be deleted:\n${lines}`);
      }
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not delete the selected requisitions. Please try again.");
    }
  };

  const handleStatusChange = async (id: number, status: string) => {
    const prev = requisitions;
    setRequisitions((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
    try {
      const saved = await requisitionApi.changeStatus(id, status);
      setRequisitions((rs) => rs.map((r) => (r.id === id ? saved : r)));
    } catch (e: any) {
      setRequisitions(prev); // the transition was rejected (e.g. skipping a required step) — revert the dropdown
      alert(e?.response?.data?.detail || "Could not change status.");
    }
  };

  const handlePriorityChange = async (id: number, priority: string) => {
    const prev = requisitions;
    setRequisitions((rs) => rs.map((r) => (r.id === id ? { ...r, priority } : r)));
    try {
      const saved = await requisitionApi.update(id, { priority });
      setRequisitions((rs) => rs.map((r) => (r.id === id ? saved : r)));
    } catch (e: any) {
      setRequisitions(prev);
      alert(e?.response?.data?.detail || "Could not change priority.");
    }
  };

  const handleChecklistToggle = async (id: number, field: string, value: boolean) => {
    const prev = requisitions;
    // Optimistic: flip it immediately (and recompute checklist_complete
    // locally) so a checkbox visibly ticks the instant you click it,
    // rather than waiting on a round-trip before it appears checked.
    setRequisitions((rs) => rs.map((r) => {
      if (r.id !== id) return r;
      const next = { ...r, [field]: value };
      next.checklist_complete = ["salary_approved", "headcount_approved", "jd_approved", "location_confirmed"].every((f) => !!next[f]);
      return next;
    }));
    try {
      const saved = await requisitionApi.updateChecklist(id, { [field]: value });
      setRequisitions((rs) => rs.map((r) => (r.id === id ? saved : r)));
    } catch (e: any) {
      setRequisitions(prev);
      alert(e?.response?.data?.detail || "Could not update the checklist.");
    }
  };

  const copyHmLink = async (id: number) => {
    let url = "";
    try {
      const res = await requisitionApi.generateHmViewLink(id);
      url = `${window.location.origin}${res.view_url_path}`;
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not generate the hiring manager link.");
      return;
    }
    // Show the actual link on screen rather than trusting an invisible
    // clipboard write — some browsers silently refuse
    // navigator.clipboard.writeText() here because it's happening after
    // an awaited network call, outside the original click's user-gesture
    // window, which left the clipboard holding whatever was copied
    // earlier instead. This way the real link is always visible and
    // selectable even if the one-click copy itself fails.
    let copyFailed = false;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      copyFailed = true;
    }
    setHmLinkModal({ url, copyFailed });
  };

  const retryCopyHmLink = async () => {
    if (!hmLinkModal) return;
    try {
      await navigator.clipboard.writeText(hmLinkModal.url);
      setHmLinkModal({ ...hmLinkModal, copyFailed: false });
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setHmLinkModal({ ...hmLinkModal, copyFailed: true });
    }
  };

  // ── Clients table: edit / delete / bulk-select ──────────────────────
  // This table used to be read-only (name/address/ABN/area of work with
  // no actions at all) — everything below brings it in line with every
  // other table in the app (candidates, requisitions): row checkboxes,
  // select-all, per-row edit/delete, and bulk delete.
  const openAddClient = () => {
    setClientForm({ name: "", address: "", abn: "", area_of_work: "", contact_id: null, contact_name: "", contact_title: "", contact_email: "", contact_phone: "" });
    setClientFormState({ mode: "create" });
    setClientFormError("");
  };
  const openEditClient = (c: any) => {
    // Pre-fill the client's existing primary contact (if any) so editing a
    // client and managing its main contact person happen in the same
    // form — previously "Add Client" and "Add Client Contact" were two
    // separate buttons/modals for what's really one piece of information
    // a recruiter enters together when onboarding a client.
    const existingContact = contacts.find((ct: any) => ct.client_id === c.id && ct.is_primary)
      || contacts.find((ct: any) => ct.client_id === c.id);
    setClientForm({
      name: c.name || "", address: c.address || "", abn: c.abn || "", area_of_work: c.area_of_work || "",
      contact_id: existingContact?.id ?? null,
      contact_name: existingContact?.name || "", contact_title: existingContact?.title || "",
      contact_email: existingContact?.email || "", contact_phone: existingContact?.phone || "",
    });
    setClientFormState({ mode: "edit", client: c });
    setClientFormError("");
  };
  const submitClientForm = async () => {
    if (!clientForm.name.trim()) { setClientFormError("Client name is required."); return; }
    setClientFormSaving(true);
    setClientFormError("");
    try {
      const clientPayload = { name: clientForm.name, address: clientForm.address, abn: clientForm.abn, area_of_work: clientForm.area_of_work };
      const hasContactInput = clientForm.contact_name.trim() || clientForm.contact_email.trim() || clientForm.contact_phone.trim();
      let savedClient: any;

      if (clientFormState?.mode === "edit") {
        const clientId = clientFormState.client.id;
        // Editing: the client update and the contact update don't depend
        // on each other's result, so run them together instead of one
        // after another — this alone roughly halves the wait on an edit
        // that also touches the primary contact.
        const contactPayload = hasContactInput ? {
          client_id: clientId,
          name: clientForm.contact_name.trim() || clientForm.name.trim(),
          title: clientForm.contact_title, email: clientForm.contact_email, phone: clientForm.contact_phone,
          is_primary: true,
        } : null;
        const [c] = await Promise.all([
          candidateTrackApi.updateClient(clientId, clientPayload),
          contactPayload
            ? (clientForm.contact_id ? requisitionApi.updateContact(clientForm.contact_id, contactPayload) : requisitionApi.createContact(contactPayload))
            : Promise.resolve(null),
        ]);
        savedClient = c;
      } else {
        // Creating: the contact genuinely needs the new client's id first,
        // so this leg has to stay sequential.
        savedClient = await candidateTrackApi.createClient(clientPayload);
        if (hasContactInput) {
          await requisitionApi.createContact({
            client_id: savedClient.id,
            name: clientForm.contact_name.trim() || clientForm.name.trim(),
            title: clientForm.contact_title, email: clientForm.contact_email, phone: clientForm.contact_phone,
            is_primary: true,
          });
        }
      }

      // Optimistic: drop the saved client straight into local state and
      // close right away — contacts/counts refresh in the background via
      // load() rather than holding the modal open until every last
      // related list has re-fetched.
      setClients((prev) => {
        if (clientFormState?.mode === "edit") return prev.map((c: any) => (c.id === savedClient.id ? savedClient : c));
        return [...prev, savedClient];
      });
      setClientFormState(null);
      load();
    } catch (e: any) {
      setClientFormError(e?.response?.data?.detail || "Could not save client.");
    } finally {
      setClientFormSaving(false);
    }
  };
  const handleDeleteClient = async (c: any) => {
    if (!confirm(`Delete client "${c.name}"? This cannot be undone.`)) return;
    try {
      await candidateTrackApi.deleteClient(c.id);
      await load();
    } catch (e: any) {
      // Deleting a client with JDs/requisitions still attached is
      // rejected with a clear message rather than crashing outright —
      // surface it instead of failing silently.
      alert(e?.response?.data?.detail || "Could not delete this client.");
    }
  };
  const toggleSelectClient = (id: number) => {
    setSelectedClients((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleSelectAllClients = () => {
    if (selectedClients.size === clients.length) setSelectedClients(new Set());
    else setSelectedClients(new Set(clients.map((c: any) => c.id)));
  };
  const handleBulkDeleteClients = async () => {
    if (selectedClients.size === 0) return;
    if (!confirm(`Delete ${selectedClients.size} selected client(s)? This cannot be undone.`)) return;
    try {
      const res = await candidateTrackApi.bulkDeleteClients(Array.from(selectedClients));
      setSelectedClients(new Set());
      await load();
      // Bulk delete deletes what it safely can and reports the rest —
      // a client with JDs/requisitions attached is skipped, not silently
      // dropped or allowed to fail the whole batch.
      if (res?.skipped?.length > 0) {
        const lines = res.skipped.map((s: any) => `• ${s.name}: ${s.reason}`).join("\n");
        alert(`Deleted ${res.deleted?.length ?? 0} client(s).\n\n${res.skipped.length} could not be deleted:\n${lines}`);
      }
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Could not delete the selected clients.");
    }
  };

  const detail = requisitions.find((r) => r.id === detailId);

  // Every filterable column's display value, in one place — used both
  // to build each column's "options actually present" list and to
  // filter the table, so the two can never disagree with each other.
  const salaryRangeText = (r: any) => (r.salary_min || r.salary_max ? `${r.salary_min ? r.salary_min.toLocaleString() : "?"} – ${r.salary_max ? r.salary_max.toLocaleString() : "?"}` : "—");
  const targetDateText = (r: any) => (r.target_hire_date ? new Date(r.target_hire_date).toLocaleDateString() : "—");
  const getColValue = (r: any, key: string): string => {
    switch (key) {
      case "sequence_number": return String(r.sequence_number ?? "");
      case "title": return r.title;
      case "client": return r.client_name || "—";
      case "priority": return r.priority;
      case "vacancy_count": return String(r.vacancy_count);
      case "reason_for_hire": return r.reason_for_hire || "—";
      case "employment_type": return r.employment_type || "—";
      case "location": return r.location || "—";
      case "salary_range": return salaryRangeText(r);
      case "target_hire_date": return targetDateText(r);
      case "status": return r.status;
      case "checklist": return r.checklist_complete ? "Complete" : "Incomplete";
      case "hiring_manager": return r.hiring_manager_name || "—";
      case "application_count": return String(r.application_count);
      default: return "";
    }
  };
  const colOptions = (key: string) => Array.from(new Set(requisitions.map((r) => getColValue(r, key)))).sort();
  const filteredRequisitions = requisitions.filter((r) =>
    Object.entries(colFilters).every(([key, val]) => !val || getColValue(r, key) === val)
  );

  return (
    <div className="tiq-content">
      <div className="tiq-page-header">
        <div>
          <div className="tiq-page-title">Requisitions</div>
          <div className="tiq-page-sub">A job doesn't exist until it's a structured, approved, owned object.</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-start", marginTop: 12, marginBottom: 8 }}>
        <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setShowClientsTable((v) => !v)}>
          <Building2 size={14} /> {showClientsTable ? "Hide Clients" : "Show Clients"}
        </button>
        <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={openAddClient}>
          <Building2 size={14} /> Add Client
        </button>
        <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setShowClientCsv(true)}>
          <Upload size={14} /> Bulk Import Clients
        </button>
        <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => setShowCsv(true)}>
          <Upload size={14} /> Bulk Import Requisitions
        </button>
        <button className="tiq-btn tiq-btn-primary tiq-btn-sm" onClick={openAdd}>
          <Plus size={14} /> New Requisition
        </button>
      </div>

      {/* ── Clients table — shown above the Requisitions table so a
          recruiter can see/manage clients right where they're building
          requisitions, without leaving this page. ─────────────────────── */}
      {showClientsTable && (
        <div className="tiq-card" style={{ marginTop: 16, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
              <Building2 size={14} /> Clients ({clients.length})
            </div>
            {selectedClients.size > 0 && (
              <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ color: "#ef4444", borderColor: "#ef4444" }}
                      onClick={handleBulkDeleteClients}>
                <Trash2 size={13} /> Delete {selectedClients.size} selected
              </button>
            )}
          </div>
          {clients.length === 0 ? (
            <div className="tiq-empty" style={{ padding: 12 }}>No clients yet — use "Bulk Import Clients" or add one via a requisition's client dropdown.</div>
          ) : (
            <div className="tiq-table-wrap">
              <table className="tiq-table">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>
                      <input type="checkbox" checked={clients.length > 0 && selectedClients.size === clients.length}
                             onChange={toggleSelectAllClients} title="Select all" />
                    </th>
                    <th>Name</th>
                    <th>Address</th>
                    <th>ABN</th>
                    <th>Area of Work</th>
                    <th style={{ textAlign: "center" }}>Requisitions</th>
                    <th style={{ textAlign: "center" }}>Contacts</th>
                    <th style={{ width: 90 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((cl: any) => (
                    <tr key={cl.id}>
                      <td><input type="checkbox" checked={selectedClients.has(cl.id)} onChange={() => toggleSelectClient(cl.id)} /></td>
                      <td style={{ fontWeight: 600 }}>{cl.name}</td>
                      <td style={{ fontSize: 12 }}>{cl.address || "—"}</td>
                      <td style={{ fontSize: 12 }}>{cl.abn || "—"}</td>
                      <td style={{ fontSize: 12 }}>{cl.area_of_work || "—"}</td>
                      <td style={{ textAlign: "center" }}>{requisitions.filter((r) => r.client_id === cl.id).length}</td>
                      <td style={{ textAlign: "center" }}>{contacts.filter((ct: any) => ct.client_id === cl.id).length}</td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Edit" onClick={() => openEditClient(cl)}>Edit</button>
                          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" title="Delete" onClick={() => handleDeleteClient(cl)}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16, marginBottom: 8 }}>
          <button className="tiq-btn tiq-btn-outline tiq-btn-sm" style={{ color: "#ef4444", borderColor: "#ef4444" }}
                  onClick={handleBulkDelete}>
            <Trash2 size={13} /> Delete {selected.size} selected
          </button>
        </div>
      )}

      {loading ? (
        <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
      ) : requisitions.length === 0 ? (
        <div className="tiq-empty">No requisitions yet. Create one to get the intake workflow started.</div>
      ) : filteredRequisitions.length === 0 ? (
        <div className="tiq-empty">
          No requisitions match the current column filters.{" "}
          <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => setColFilters({})}>Clear filters</button>
        </div>
      ) : (
        <div className="tiq-table-wrap" style={{ marginTop: 16 }}>
          <table className="tiq-table" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input type="checkbox" checked={selected.size > 0 && selected.size === filteredRequisitions.length}
                         onChange={toggleSelectAll} />
                </th>
                <ResizableFilterHeader label="Req #" value={colFilters.sequence_number} options={colOptions("sequence_number")} onChange={(v) => setColFilter("sequence_number", v)} align="center" width={colWidths.sequence_number} onWidthChange={(w) => setColWidth("sequence_number", w)} />
                <ResizableFilterHeader label="Title" value={colFilters.title} options={colOptions("title")} onChange={(v) => setColFilter("title", v)} width={colWidths.title} onWidthChange={(w) => setColWidth("title", w)} />
                <ResizableFilterHeader label="Client" value={colFilters.client} options={colOptions("client")} onChange={(v) => setColFilter("client", v)} width={colWidths.client} onWidthChange={(w) => setColWidth("client", w)} />
                <ResizableFilterHeader label="Priority" value={colFilters.priority} options={colOptions("priority")} onChange={(v) => setColFilter("priority", v)} width={colWidths.priority} onWidthChange={(w) => setColWidth("priority", w)} />
                <ResizableFilterHeader label="Vacancies" value={colFilters.vacancy_count} options={colOptions("vacancy_count")} onChange={(v) => setColFilter("vacancy_count", v)} align="center" width={colWidths.vacancy_count} onWidthChange={(w) => setColWidth("vacancy_count", w)} />
                <ResizableFilterHeader label="Reason for Hire" value={colFilters.reason_for_hire} options={colOptions("reason_for_hire")} onChange={(v) => setColFilter("reason_for_hire", v)} width={colWidths.reason_for_hire} onWidthChange={(w) => setColWidth("reason_for_hire", w)} />
                <ResizableFilterHeader label="Employment Type" value={colFilters.employment_type} options={colOptions("employment_type")} onChange={(v) => setColFilter("employment_type", v)} width={colWidths.employment_type} onWidthChange={(w) => setColWidth("employment_type", w)} />
                <ResizableFilterHeader label="Location" value={colFilters.location} options={colOptions("location")} onChange={(v) => setColFilter("location", v)} width={colWidths.location} onWidthChange={(w) => setColWidth("location", w)} />
                <ResizableFilterHeader label="Salary Range" value={colFilters.salary_range} options={colOptions("salary_range")} onChange={(v) => setColFilter("salary_range", v)} width={colWidths.salary_range} onWidthChange={(w) => setColWidth("salary_range", w)} />
                <ResizableFilterHeader label="Target Hire Date" value={colFilters.target_hire_date} options={colOptions("target_hire_date")} onChange={(v) => setColFilter("target_hire_date", v)} width={colWidths.target_hire_date} onWidthChange={(w) => setColWidth("target_hire_date", w)} />
                <ResizableFilterHeader label="Status" value={colFilters.status} options={colOptions("status")} onChange={(v) => setColFilter("status", v)} width={colWidths.status} onWidthChange={(w) => setColWidth("status", w)} />
                <ResizableFilterHeader label="Checklist" value={colFilters.checklist} options={colOptions("checklist")} onChange={(v) => setColFilter("checklist", v)} width={colWidths.checklist} onWidthChange={(w) => setColWidth("checklist", w)} />
                <ResizableFilterHeader label="Hiring Manager" value={colFilters.hiring_manager} options={colOptions("hiring_manager")} onChange={(v) => setColFilter("hiring_manager", v)} width={colWidths.hiring_manager} onWidthChange={(w) => setColWidth("hiring_manager", w)} />
                <ResizableFilterHeader label="Applications" value={colFilters.application_count} options={colOptions("application_count")} onChange={(v) => setColFilter("application_count", v)} align="center" width={colWidths.application_count} onWidthChange={(w) => setColWidth("application_count", w)} />
                <th style={{ width: 90 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRequisitions.map((r) => {
                const client = clients.find((c: any) => c.id === r.client_id);
                return (
                <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => setDetailId(r.id)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                  </td>
                  <td style={{ textAlign: "center", color: "var(--text-muted)" }}>{r.sequence_number}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.title}</div>
                    {r.jd_title && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>JD: {r.jd_title}</div>}
                  </td>
                  <td style={{ fontSize: 12 }} onClick={(e) => e.stopPropagation()}>
                    {r.client_name ? (
                      <button
                        onClick={() => (client ? openEditClient(client) : setShowClientsTable(true))}
                        title="View client details"
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--violet-500)", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 2 }}
                      >
                        {r.client_name}
                      </button>
                    ) : "—"}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select
                      value={r.priority}
                      onChange={(e) => handlePriorityChange(r.id, e.target.value)}
                      style={{
                        fontSize: 11, fontWeight: 700, padding: "3px 20px 3px 8px", borderRadius: 999, border: "none",
                        background: `${PRIORITY_COLORS[r.priority]}20`, color: PRIORITY_COLORS[r.priority], appearance: "none", cursor: "pointer",
                      }}
                    >
                      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </td>
                  <td style={{ textAlign: "center" }}>{r.vacancy_count}</td>
                  <td style={{ fontSize: 12 }}>{r.reason_for_hire || "—"}</td>
                  <td style={{ fontSize: 12 }}>{r.employment_type || "—"}</td>
                  <td style={{ fontSize: 12 }}>{r.location || "—"}</td>
                  <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                    {r.salary_min || r.salary_max
                      ? `${r.salary_min ? r.salary_min.toLocaleString() : "?"} – ${r.salary_max ? r.salary_max.toLocaleString() : "?"}`
                      : "—"}
                  </td>
                  <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{r.target_hire_date ? new Date(r.target_hire_date).toLocaleDateString() : "—"}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ position: "relative", display: "inline-block" }}>
                      <select
                        value={r.status}
                        onChange={(e) => handleStatusChange(r.id, e.target.value)}
                        style={{
                          fontSize: 11, fontWeight: 700, padding: "3px 20px 3px 8px", borderRadius: 999, border: "none",
                          background: STATUS_COLORS[r.status]?.bg, color: STATUS_COLORS[r.status]?.fg, appearance: "none", cursor: "pointer",
                        }}
                      >
                        {STATUS_FLOW.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setChecklistPopoverId(r.id)}
                      style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", padding: 0, color: r.checklist_complete ? "#10b981" : "#f59e0b", fontSize: 11 }}
                    >
                      {r.checklist_complete ? <Check size={13} /> : <AlertTriangle size={13} />}
                      {r.checklist_complete ? "Complete" : "Incomplete"}
                    </button>
                    {checklistPopoverId === r.id && (
                      <>
                        <div style={{ position: "fixed", inset: 0, zIndex: 1000 }} onClick={() => setChecklistPopoverId(null)} />
                        <div style={{
                          position: "absolute", background: "#fff", color: "#111827", border: "1px solid var(--border)",
                          borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.16)", zIndex: 1001, padding: 14, minWidth: 220,
                        }}>
                          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
                            Intake Checklist {r.checklist_complete ? "— all done" : "— what's missing"}
                          </div>
                          {[
                            ["salary_approved", "Salary approved"],
                            ["headcount_approved", "Headcount approved"],
                            ["jd_approved", "JD approved"],
                            ["location_confirmed", "Location confirmed"],
                          ].map(([field, label]) => (
                            <label key={field} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer", padding: "4px 0" }}>
                              <input type="checkbox" checked={!!r[field]} onChange={(e) => handleChecklistToggle(r.id, field, e.target.checked)} />
                              {label}
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {r.hiring_manager_name || "—"}
                    {r.hiring_manager_email && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{r.hiring_manager_email}</div>}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                      <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={(e) => { e.stopPropagation(); openApplicants(r.id); }}>
                        {r.application_count}
                      </button>
                      <button className="tiq-btn tiq-btn-outline tiq-btn-sm" title="Find and submit suitable candidates from Talent Pool"
                              onClick={(e) => { e.stopPropagation(); openMatchModal(r.id); }}>
                        <UserPlus size={12} /> Match
                      </button>
                    </div>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => openEdit(r)}>Edit</button>
                      <button className="tiq-btn tiq-btn-ghost tiq-btn-sm" onClick={() => handleDelete(r.id)}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>

      )}

      {/* ── Detail / Workflow drawer ─────────────────────────────── */}
      {detail && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
             onClick={() => setDetailId(null)}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 640, width: "94%", maxHeight: "88vh", overflowY: "auto" }}
               onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{detail.title}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>#{detail.sequence_number} · {detail.client_name || "No client"}</div>
              </div>
              <button onClick={() => setDetailId(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div className="tiq-label" style={{ marginBottom: 8 }}>Status Workflow</div>
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                {STATUS_FLOW.map((s, i) => (
                  <div key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="tiq-badge" style={{
                      background: s === detail.status ? STATUS_COLORS[s].bg : "#f1f5f9",
                      color: s === detail.status ? STATUS_COLORS[s].fg : "#94a3b8",
                      fontWeight: s === detail.status ? 700 : 500,
                      border: s === detail.status ? `1.5px solid ${STATUS_COLORS[s].fg}` : "none",
                    }}>{s}</span>
                    {i < STATUS_FLOW.length - 1 && <ChevronRight size={12} color="#cbd5e1" />}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(STATUS_TRANSITIONS[detail.status] || []).map((next) => (
                  <button key={next} className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => handleStatusChange(detail.id, next)}>
                    Move to {next}
                  </button>
                ))}
                {(STATUS_TRANSITIONS[detail.status] || []).length === 0 && (
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Terminal status — no further transitions.</span>
                )}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div className="tiq-label" style={{ marginBottom: 8 }}>Intake Checklist</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  ["salary_approved", "Salary approved"],
                  ["headcount_approved", "Headcount approved"],
                  ["jd_approved", "JD approved"],
                  ["location_confirmed", "Location confirmed"],
                ].map(([field, label]) => (
                  <label key={field} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={!!detail[field]} onChange={(e) => handleChecklistToggle(detail.id, field, e.target.checked)} />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div className="tiq-grid-2" style={{ marginBottom: 20, fontSize: 13 }}>
              <div><span className="tiq-label">Priority</span><div>{detail.priority}</div></div>
              <div><span className="tiq-label">Vacancies</span><div>{detail.vacancy_count}</div></div>
              <div><span className="tiq-label">Employment Type</span><div>{detail.employment_type || "—"}</div></div>
              <div><span className="tiq-label">Location</span><div>{detail.location || "—"}</div></div>
              <div><span className="tiq-label">Salary Range</span><div>{detail.salary_min || detail.salary_max ? `${detail.salary_min ?? "?"} – ${detail.salary_max ?? "?"}` : "—"}</div></div>
              <div><span className="tiq-label">Target Hire Date</span><div>{detail.target_hire_date ? new Date(detail.target_hire_date).toLocaleDateString() : "—"}</div></div>
              <div><span className="tiq-label">Hiring Manager</span><div>{detail.hiring_manager_name || "—"} {detail.hiring_manager_email && `(${detail.hiring_manager_email})`}</div></div>
              <div><span className="tiq-label">Applications</span><div>
                <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => openApplicants(detail.id)}>{detail.application_count}</button>
              </div></div>
            </div>

            <div className="tiq-flex-end">
              <button className="tiq-btn tiq-btn-outline tiq-btn-sm" onClick={() => copyHmLink(detail.id)}>
                <Link2 size={13} /> Copy Hiring Manager Link
              </button>
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setDetailId(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Hiring manager link — shown visibly rather than trusted to an
          invisible clipboard write, which some browsers silently refuse
          this long after the click that triggered it. ────────────────── */}
      {hmLinkModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center" }}
             onClick={() => setHmLinkModal(null)}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 480, width: "94%" }}
               onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
                <Link2 size={16} /> Hiring Manager Link
              </div>
              <button onClick={() => setHmLinkModal(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            {hmLinkModal.copyFailed ? (
              <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 12, fontSize: 12 }}>
                Couldn't copy automatically — select the link below and copy it manually, or try the button again.
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#10b981", marginBottom: 12 }}>✓ Copied to your clipboard.</div>
            )}
            <input
              className="tiq-input" readOnly value={hmLinkModal.url}
              onFocus={(e) => e.target.select()}
              style={{ marginBottom: 12, fontSize: 12 }}
            />
            <div className="tiq-flex-end">
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setHmLinkModal(null)}>Close</button>
              <button className="tiq-btn tiq-btn-primary" onClick={retryCopyHmLink}>
                {linkCopied ? <Check size={13} /> : <Copy size={13} />} {linkCopied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Applicants Popup — who's actually applied to this role ──── */}
      {applicantsReqId && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
             onClick={() => setApplicantsReqId(null)}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 780, width: "94%", maxHeight: "86vh", overflowY: "auto" }}
               onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                Applicants — {requisitions.find((r) => r.id === applicantsReqId)?.title}
              </div>
              <button onClick={() => setApplicantsReqId(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            {loadingApplicants ? (
              <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
            ) : !applicants || applicants.length === 0 ? (
              <div className="tiq-empty">
                No applicants yet. Candidates are only linked to a requisition once they're submitted via the Pipeline
                module's "Add Candidate to Pipeline" — importing candidates into Talent Pool doesn't apply them to any role automatically.
              </div>
            ) : (
              <div className="tiq-table-wrap">
                <table className="tiq-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "center" }}>Candidate #</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Phone</th>
                      <th>Current Title</th>
                      <th>Stage</th>
                      <th>Applied</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applicants.map((a) => (
                      <tr key={a.id}>
                        <td style={{ textAlign: "center" }}>{a.candidate?.sequence_number ?? "—"}</td>
                        <td style={{ fontWeight: 600 }}>{a.candidate_name}</td>
                        <td style={{ fontSize: 12 }}>{a.candidate?.email || "—"}</td>
                        <td style={{ fontSize: 12 }}>{a.candidate?.phone || "—"}</td>
                        <td style={{ fontSize: 12 }}>{a.candidate?.current_title || "—"}</td>
                        <td><span className="tiq-badge tiq-badge-slate">{a.current_stage_name}</span></td>
                        <td style={{ fontSize: 12 }}>{a.created_at ? new Date(a.created_at).toLocaleDateString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Match & Submit Popup — suggests suitable Talent Pool
          candidates for this role in one click, reviewable before
          anything is actually submitted. ────────────────────────── */}
      {matchReqId && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
             onClick={() => setMatchReqId(null)}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 820, width: "94%", maxHeight: "86vh", overflowY: "auto" }}
               onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                Match Candidates — {requisitions.find((r) => r.id === matchReqId)?.title}
              </div>
              <button onClick={() => setMatchReqId(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              Suggested from Talent Pool by matching tag or current title against this role's title. All matches are
              pre-checked — review and untick anyone who isn't actually a fit, then submit.
            </div>

            {loadingMatches ? (
              <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>
            ) : matchResult ? (
              <div className="tiq-alert tiq-alert-success" style={{ marginBottom: 12, fontSize: 13 }}>
                Submitted {matchResult.submitted} candidate(s) to this requisition's pipeline
                {matchResult.alreadyIn > 0 && `, ${matchResult.alreadyIn} were already in it`}
                {matchResult.failed > 0 && `, ${matchResult.failed} failed`}.
                The Applications count behind this popup has been refreshed.
              </div>
            ) : !matchCandidates || matchCandidates.length === 0 ? (
              <div className="tiq-empty">
                No suitable candidates found in Talent Pool — no candidate's tag or current title matches
                "{requisitions.find((r) => r.id === matchReqId)?.title}". Add or import candidates with a matching
                title/tag, or use "Submit N selected to requisition…" from Talent Pool to add anyone manually.
              </div>
            ) : (
              <>
                <div className="tiq-table-wrap" style={{ marginBottom: 14 }}>
                  <table className="tiq-table">
                    <thead>
                      <tr>
                        <th style={{ width: 28 }}>
                          <input type="checkbox" checked={matchSelected.size === matchCandidates.length}
                                 onChange={() => setMatchSelected(matchSelected.size === matchCandidates.length ? new Set() : new Set(matchCandidates.map((c) => c.id)))} />
                        </th>
                        <th style={{ textAlign: "center" }}>Candidate #</th>
                        <th>Name</th>
                        <th>Current Title</th>
                        <th>Skills</th>
                        <th>Email</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matchCandidates.map((c) => (
                        <tr key={c.id}>
                          <td><input type="checkbox" checked={matchSelected.has(c.id)} onChange={() => toggleMatchSelect(c.id)} /></td>
                          <td style={{ textAlign: "center" }}>{c.sequence_number}</td>
                          <td style={{ fontWeight: 600 }}>{c.full_name}</td>
                          <td style={{ fontSize: 12 }}>{c.current_title}</td>
                          <td style={{ fontSize: 12 }}>{(c.skills || []).slice(0, 4).join(", ")}</td>
                          <td style={{ fontSize: 12 }}>{c.email}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="tiq-flex-end">
                  <button className="tiq-btn tiq-btn-ghost" onClick={() => setMatchReqId(null)}>Cancel</button>
                  <button className="tiq-btn tiq-btn-primary" disabled={matchSelected.size === 0 || submittingMatches} onClick={submitMatches}>
                    {submittingMatches ? "Submitting…" : `Submit ${matchSelected.size} Selected`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Add/Edit Requisition Modal ────────────────────────────── */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 640, width: "94%", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{editingId ? "Edit Requisition" : "New Requisition"}</div>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            {formError && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 12 }}>{formError}</div>}

            <div className="tiq-form-group"><label className="tiq-label">Title *</label>
              <input className="tiq-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>

            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Client</label>
                <select className="tiq-select" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value, hiring_manager_contact_id: "" })}>
                  <option value="">— None —</option>
                  {clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
              <div className="tiq-form-group"><label className="tiq-label">Linked JD</label>
                <select className="tiq-select" value={form.jd_record_id} onChange={(e) => setForm({ ...form, jd_record_id: e.target.value })}>
                  <option value="">— None —</option>
                  {jds.map((j: any) => <option key={j.id} value={j.id}>{j.jd_title}</option>)}
                </select></div>
              <div className="tiq-form-group"><label className="tiq-label">Priority</label>
                <select className="tiq-select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select></div>
              <div className="tiq-form-group"><label className="tiq-label">Vacancy Count</label>
                <input className="tiq-input" type="number" min={1} value={form.vacancy_count} onChange={(e) => setForm({ ...form, vacancy_count: Number(e.target.value) })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Reason for Hire</label>
                <select className="tiq-select" value={form.reason_for_hire} onChange={(e) => setForm({ ...form, reason_for_hire: e.target.value })}>
                  <option value="">— Select —</option>
                  {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select></div>
              <div className="tiq-form-group"><label className="tiq-label">Employment Type</label>
                <select className="tiq-select" value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value })}>
                  <option value="">— Select —</option>
                  {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select></div>
              <div className="tiq-form-group"><label className="tiq-label">Location</label>
                <input className="tiq-input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Target Hire Date</label>
                <input className="tiq-input" type="date" value={form.target_hire_date} onChange={(e) => setForm({ ...form, target_hire_date: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Salary Min</label>
                <input className="tiq-input" type="number" value={form.salary_min} onChange={(e) => setForm({ ...form, salary_min: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Salary Max</label>
                <input className="tiq-input" type="number" value={form.salary_max} onChange={(e) => setForm({ ...form, salary_max: e.target.value })} /></div>
            </div>

            <div className="tiq-form-group"><label className="tiq-label">Hiring Manager Contact (from Client)</label>
              <select className="tiq-select" value={form.hiring_manager_contact_id}
                      onChange={(e) => setForm({ ...form, hiring_manager_contact_id: e.target.value })}>
                <option value="">— None / use name+email below —</option>
                {contacts.filter((c: any) => !form.client_id || c.client_id === Number(form.client_id)).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}{c.title ? ` — ${c.title}` : ""}</option>
                ))}
              </select>
            </div>
            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Hiring Manager Name (fallback)</label>
                <input className="tiq-input" value={form.hiring_manager_name} onChange={(e) => setForm({ ...form, hiring_manager_name: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Hiring Manager Email (fallback)</label>
                <input className="tiq-input" value={form.hiring_manager_email} onChange={(e) => setForm({ ...form, hiring_manager_email: e.target.value })} /></div>
            </div>
            <div className="tiq-form-group"><label className="tiq-label">Notes</label>
              <textarea className="tiq-input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>

            <div className="tiq-flex-end" style={{ marginTop: 16 }}>
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" disabled={saving} onClick={submitForm}>{saving ? "Saving…" : "Save Requisition"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add/Edit Client Modal ─────────────────────────────────── */}
      {clientFormState && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 14, padding: 24, maxWidth: 480, width: "94%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{clientFormState.mode === "edit" ? "Edit Client" : "Add Client"}</div>
              <button onClick={() => setClientFormState(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            {clientFormError && <div className="tiq-alert tiq-alert-error" style={{ marginBottom: 12 }}>{clientFormError}</div>}
            <div className="tiq-form-group"><label className="tiq-label">Client / Company Name *</label>
              <input className="tiq-input" value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
                     placeholder="e.g. Commonwealth Bank of Australia" /></div>
            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Address</label>
                <input className="tiq-input" value={clientForm.address} onChange={(e) => setClientForm({ ...clientForm, address: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">ABN</label>
                <input className="tiq-input" value={clientForm.abn} onChange={(e) => setClientForm({ ...clientForm, abn: e.target.value })} /></div>
            </div>
            <div className="tiq-form-group"><label className="tiq-label">Area of Work</label>
              <input className="tiq-input" value={clientForm.area_of_work} onChange={(e) => setClientForm({ ...clientForm, area_of_work: e.target.value })}
                     placeholder="e.g. Banking, Insurance" /></div>

            <div style={{ borderTop: "1px solid var(--border)", margin: "16px 0 14px", paddingTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Primary Contact</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
                Optional — the main point of contact at this client (e.g. HR or hiring manager). Leave blank to skip.
              </div>
            </div>
            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Contact Name</label>
                <input className="tiq-input" value={clientForm.contact_name} onChange={(e) => setClientForm({ ...clientForm, contact_name: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Title</label>
                <input className="tiq-input" value={clientForm.contact_title} onChange={(e) => setClientForm({ ...clientForm, contact_title: e.target.value })} /></div>
            </div>
            <div className="tiq-grid-2">
              <div className="tiq-form-group"><label className="tiq-label">Contact Email</label>
                <input className="tiq-input" value={clientForm.contact_email} onChange={(e) => setClientForm({ ...clientForm, contact_email: e.target.value })} /></div>
              <div className="tiq-form-group"><label className="tiq-label">Contact Phone</label>
                <input className="tiq-input" value={clientForm.contact_phone} onChange={(e) => setClientForm({ ...clientForm, contact_phone: e.target.value })} /></div>
            </div>

            <div className="tiq-flex-end">
              <button className="tiq-btn tiq-btn-ghost" onClick={() => setClientFormState(null)}>Cancel</button>
              <button className="tiq-btn tiq-btn-primary" disabled={clientFormSaving} onClick={submitClientForm}>
                {clientFormSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Import Requisitions (CSV) ──────────────────────────── */}
      {showCsv && (
        <CsvImportModal
          title="Requisitions"
          columns={["title", "client_name", "priority", "vacancy_count", "reason_for_hire", "employment_type", "location", "salary_min", "salary_max", "target_hire_date", "hiring_manager_name", "hiring_manager_email", "notes"]}
          sampleRow={["Senior Data Engineer", "Northwind Group", "High", "2", "Growth", "Full-time", "Sydney NSW", "120000", "150000", "2026-11-01", "Priya Anand", "priya.anand@northwindgroup.example", "Urgent — client needs by Q4"]}
          onImport={(form) => requisitionApi.csvImport(form)}
          onClose={() => setShowCsv(false)}
          onDone={load}
        />
      )}

      {/* ── Bulk Import Clients (CSV) — kept here too, not just buried in
          CandidateLens → Management → Clients, since this is where a
          recruiter is actually working when they need to add clients
          before/while building requisitions. ─────────────────────────── */}
      {showClientCsv && (
        <CsvImportModal
          title="Clients"
          columns={["name", "address", "abn", "area_of_work", "contact_name", "contact_title", "contact_email", "contact_phone"]}
          sampleRow={["Northwind Group", "Sydney NSW", "51 824 753 556", "Financial Services", "Priya Anand", "Head of Talent", "priya.anand@northwindgroup.example", "0412 555 101"]}
          onImport={(form) => candidateTrackApi.importClientsCsv(form)}
          onClose={() => setShowClientCsv(false)}
          onDone={load}
        />
      )}
    </div>
  );
}
