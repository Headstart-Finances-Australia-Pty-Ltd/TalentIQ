import axios from "axios";

// Use relative /api — Vite proxies to http://localhost:8000, bypassing CORS
export const api = axios.create({
  baseURL: "",
  timeout: 60_000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("talentiq_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("talentiq_token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

// ── Capability: Talent Pool (Phase 0 + Phase 1) ──
export const acquisitionApi = {
  getOrganisation: () => api.get("/api/acquisition/organisation").then((r) => r.data),

  listCandidates: (params?: { search?: string; status?: string; source?: string; pool_id?: number; tag?: string; has_files?: boolean; unlinked_only?: boolean }) =>
    api.get("/api/acquisition/candidates", { params }).then((r) => r.data),
  getCandidate: (id: number) => api.get(`/api/acquisition/candidates/${id}`).then((r) => r.data),
  createCandidate: (data: any) => api.post("/api/acquisition/candidates", data).then((r) => r.data),
  updateCandidate: (id: number, data: any) => api.put(`/api/acquisition/candidates/${id}`, data).then((r) => r.data),
  deleteCandidate: (id: number) => api.delete(`/api/acquisition/candidates/${id}`).then((r) => r.data),
  bulkDelete: (ids: number[]) => api.post("/api/acquisition/candidates/bulk-delete", { ids }).then((r) => r.data),

  uploadResume: (id: number, file: File, overwriteFields = false) => {
    const form = new FormData();
    form.append("file", file);
    form.append("overwrite_fields", String(overwriteFields));
    return api.post(`/api/acquisition/candidates/${id}/resume`, form).then((r) => r.data);
  },
  resumeDownloadUrl: (id: number) => `/api/acquisition/candidates/${id}/resume`,

  uploadCoverLetter: (id: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post(`/api/acquisition/candidates/${id}/cover-letter`, form).then((r) => r.data);
  },
  setCoverLetterText: (id: number, text: string) =>
    api.put(`/api/acquisition/candidates/${id}/cover-letter/text`, { text }).then((r) => r.data),
  coverLetterDownloadUrl: (id: number) => `/api/acquisition/candidates/${id}/cover-letter`,

  // Bulk operations get a much longer timeout than the 60s default —
  // extracting text from 100+ resumes/cover letters is real CPU work, and
  // the N+1-query bug that caused this to time out even faster is fixed
  // in the backend, but a generous ceiling here is still the right safety
  // net rather than assuming any given batch size finishes instantly.
  csvImport: (form: FormData) =>
    api.post("/api/acquisition/candidates/csv-import", form, { timeout: 300_000 }).then((r) => {
      const d = r.data;
      return { created: d.created, skipped: d.skipped_duplicates + d.skipped_invalid, errors: (d.duplicate_details || []).map((x: any) => `Duplicate: ${x.row?.full_name || x.row?.name || "row"} matches existing candidate #${x.existing_candidate_id}`) };
    }),

  bulkFolderImport: (form: FormData) => api.post("/api/acquisition/candidates/bulk-folder-import", form, { timeout: 300_000 }).then((r) => r.data),

  findDuplicates: (id: number) => api.get(`/api/acquisition/candidates/${id}/duplicates`).then((r) => r.data),
  mergeCandidates: (primary_candidate_id: number, merged_candidate_id: number) =>
    api.post("/api/acquisition/candidates/merge", { primary_candidate_id, merged_candidate_id }).then((r) => r.data),

  listPools: () => api.get("/api/acquisition/pools").then((r) => r.data),
  createPool: (data: { name: string; description?: string }) => api.post("/api/acquisition/pools", data).then((r) => r.data),
  deletePool: (id: number) => api.delete(`/api/acquisition/pools/${id}`).then((r) => r.data),
  addPoolMembers: (poolId: number, candidate_ids: number[]) =>
    api.post(`/api/acquisition/pools/${poolId}/members`, { candidate_ids }).then((r) => r.data),
  removePoolMember: (poolId: number, candidateId: number) =>
    api.delete(`/api/acquisition/pools/${poolId}/members/${candidateId}`).then((r) => r.data),

  generatePortalLink: (id: number) => api.post(`/api/acquisition/candidates/${id}/portal-link`).then((r) => r.data),
};

// ── Public (unauthenticated) — Career page + Candidate self-service portal ──
export const publicAcquisitionApi = {
  getCareerPage: (slug: string) => api.get(`/api/public/acquisition/careers/${slug}`).then((r) => r.data),
  apply: (slug: string, form: FormData) => api.post(`/api/public/acquisition/careers/${slug}/apply`, form).then((r) => r.data),

  getProfile: (token: string) => api.get(`/api/public/acquisition/my-profile/${token}`).then((r) => r.data),
  updateProfile: (token: string, form: FormData) => api.put(`/api/public/acquisition/my-profile/${token}`, form).then((r) => r.data),
  updateResume: (token: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post(`/api/public/acquisition/my-profile/${token}/resume`, form).then((r) => r.data);
  },
  updateCoverLetterFile: (token: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post(`/api/public/acquisition/my-profile/${token}/cover-letter`, form).then((r) => r.data);
  },
  updateCoverLetterText: (token: string, text: string) => {
    const form = new FormData();
    form.append("text", text);
    return api.put(`/api/public/acquisition/my-profile/${token}/cover-letter/text`, form).then((r) => r.data);
  },
};

// ── Capability: Requisitions (Phase 2) ──────────────────────────────────
export const requisitionApi = {
  csvImport: (form: FormData) => api.post("/api/requisitions/requisitions/csv-import", form, { timeout: 300_000 }).then((r) => r.data),
  list: (params?: { status?: string; priority?: string; client_id?: number }) =>
    api.get("/api/requisitions/requisitions", { params }).then((r) => r.data),
  get: (id: number) => api.get(`/api/requisitions/requisitions/${id}`).then((r) => r.data),
  create: (data: any) => api.post("/api/requisitions/requisitions", data).then((r) => r.data),
  update: (id: number, data: any) => api.put(`/api/requisitions/requisitions/${id}`, data).then((r) => r.data),
  remove: (id: number) => api.delete(`/api/requisitions/requisitions/${id}`).then((r) => r.data),
  bulkDelete: (ids: number[]) => api.post("/api/requisitions/requisitions/bulk-delete", { ids }).then((r) => r.data),
  changeStatus: (id: number, status: string) =>
    api.post(`/api/requisitions/requisitions/${id}/status`, { status }).then((r) => r.data),
  updateChecklist: (id: number, data: { salary_approved?: boolean; headcount_approved?: boolean; jd_approved?: boolean; location_confirmed?: boolean }) =>
    api.put(`/api/requisitions/requisitions/${id}/checklist`, data).then((r) => r.data),
  generateHmViewLink: (id: number) => api.post(`/api/requisitions/requisitions/${id}/hm-view-link`).then((r) => r.data),

  uploadJdFile: (id: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post(`/api/requisitions/requisitions/${id}/jd-file`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
  },
  jdFileUrl: (id: number) => `/api/requisitions/requisitions/${id}/jd-file`,
  deleteJdFile: (id: number) => api.delete(`/api/requisitions/requisitions/${id}/jd-file`).then((r) => r.data),
  bulkUploadJdFiles: (files: File[], overrides?: Record<string, number>) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    if (overrides && Object.keys(overrides).length) form.append("overrides", JSON.stringify(overrides));
    return api.post("/api/requisitions/requisitions/jd-files/bulk", form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 120_000,
    }).then((r) => r.data);
  },

  listContacts: (client_id?: number) =>
    api.get("/api/requisitions/client-contacts", { params: client_id ? { client_id } : {} }).then((r) => r.data),
  createContact: (data: any) => api.post("/api/requisitions/client-contacts", data).then((r) => r.data),
  updateContact: (id: number, data: any) => api.put(`/api/requisitions/client-contacts/${id}`, data).then((r) => r.data),
  deleteContact: (id: number) => api.delete(`/api/requisitions/client-contacts/${id}`).then((r) => r.data),
};

export const publicRequisitionApi = {
  hmView: (token: string) => api.get(`/api/public/requisitions/hm-view/${token}`).then((r) => r.data),
};

// ── Capability: Interviews (Phase 4) ──
// ── CandidateLens interview settings (Admin Console) — answer time per
// question + TTS voice, shared platform-wide. Kept separate from
// interviewApi above (that's the unrelated Interview Scheduling capability).
export const candidateLensSettingsApi = {
  get: () => api.get("/api/joblens/interview-settings").then((r) => r.data),
};

export const interviewApi = {
  list: (params?: { candidate_id?: number; requisition_id?: number; status?: string; upcoming_only?: boolean }) =>
    api.get("/api/interviews/interviews", { params }).then((r) => r.data),
  get: (id: number) => api.get(`/api/interviews/interviews/${id}`).then((r) => r.data),
  create: (data: any) => api.post("/api/interviews/interviews", data).then((r) => r.data),
  update: (id: number, data: any) => api.put(`/api/interviews/interviews/${id}`, data).then((r) => r.data),
  remove: (id: number) => api.delete(`/api/interviews/interviews/${id}`).then((r) => r.data),
  bulkDelete: (ids: number[]) => api.post("/api/interviews/interviews/bulk-delete", { ids }).then((r) => r.data),
  changeStatus: (id: number, status: string, cancellation_reason = "") =>
    api.post(`/api/interviews/interviews/${id}/status`, { status, cancellation_reason }).then((r) => r.data),
  createSelfScheduleLink: (id: number, proposed_slots: string[]) =>
    api.post(`/api/interviews/interviews/${id}/self-schedule-link`, { proposed_slots }).then((r) => r.data),
  createCalendlyLink: (id: number) => api.post(`/api/interviews/interviews/${id}/calendly-link`).then((r) => r.data),
  calendlyStatus: () => api.get("/api/interviews/calendly/status").then((r) => r.data),
  calendlyEventTypes: () => api.get("/api/interviews/calendly/event-types").then((r) => r.data),

  listScorecards: (interviewId: number) => api.get(`/api/interviews/interviews/${interviewId}/scorecards`).then((r) => r.data),
  createScorecard: (interviewId: number, data: any) =>
    api.post(`/api/interviews/interviews/${interviewId}/scorecards`, data).then((r) => r.data),
  updateScorecard: (scorecardId: number, data: any) =>
    api.put(`/api/interviews/scorecards/${scorecardId}`, data).then((r) => r.data),
  deleteScorecard: (scorecardId: number) =>
    api.delete(`/api/interviews/scorecards/${scorecardId}`).then((r) => r.data),

  // Round decision — manual override for 0-1 interviewer rounds (e.g. Resume Screening)
  setDecision: (id: number, decision: string) =>
    api.post(`/api/interviews/interviews/${id}/decision`, { decision }).then((r) => r.data),

  // Scheduling approval — a designated authority (internal or external)
  regenerateApprovalLink: (id: number) =>
    api.post(`/api/interviews/interviews/${id}/approval/regenerate-link`).then((r) => r.data),
  approveInApp: (id: number) =>
    api.post(`/api/interviews/interviews/${id}/approval/approve`).then((r) => r.data),
};

// ── Public: interview scheduling approval (designated authority, no login) ──
export const publicInterviewApprovalApi = {
  get: (token: string) => api.get(`/api/public/interviews/approval/${token}`).then((r) => r.data),
  approve: (token: string) => api.post(`/api/public/interviews/approval/${token}/approve`).then((r) => r.data),
  cancel: (token: string, reason: string) =>
    api.post(`/api/public/interviews/approval/${token}/cancel`, { reason }).then((r) => r.data),
};

// ── Public: panel feedback (internal or external interviewer, no login) ──
export const publicInterviewFeedbackApi = {
  get: (token: string) => api.get(`/api/public/interviews/feedback/${token}`).then((r) => r.data),
  submit: (token: string, data: any) => api.post(`/api/public/interviews/feedback/${token}`, data).then((r) => r.data),
};

// ── AI Avatar Interviews (extends Interviews + CandidateLens) ──
export const avatarInterviewApi = {
  create: (interview_id: number, joblens_candidate_id?: number, question_count = 5) =>
    api.post("/api/avatar-interviews/sessions", { interview_id, joblens_candidate_id, question_count }).then((r) => r.data),
  listByInterview: (interviewId: number) => api.get("/api/avatar-interviews/sessions", { params: { interview_id: interviewId } }).then((r) => r.data),
  get: (sessionId: number) => api.get(`/api/avatar-interviews/sessions/${sessionId}`).then((r) => r.data),
  refreshStatus: (sessionId: number) => api.post(`/api/avatar-interviews/sessions/${sessionId}/refresh-status`).then((r) => r.data),
};

export const publicInterviewScheduleApi = {
  get: (token: string) => api.get(`/api/public/interviews/${token}`).then((r) => r.data),
  confirm: (token: string, selected_slot: string) =>
    api.post(`/api/public/interviews/${token}/confirm`, { selected_slot }).then((r) => r.data),
};

// ── Capability: Placements (Phase 5) ──
export const pipelineApi = {
  listStages: (requisitionId?: number) =>
    api.get("/api/pipeline/stages", { params: requisitionId ? { requisition_id: requisitionId } : {} }).then((r) => r.data),
  createStage: (data: any) => api.post("/api/pipeline/stages", data).then((r) => r.data),
  updateStage: (id: number, data: any) => api.put(`/api/pipeline/stages/${id}`, data).then((r) => r.data),
  deleteStage: (id: number) => api.delete(`/api/pipeline/stages/${id}`).then((r) => r.data),

  submit: (data: { candidate_id: number; requisition_id: number; owner_user_id?: number; notes?: string }) =>
    api.post("/api/pipeline/submit", data).then((r) => r.data),
  getBoard: (requisitionId: number) => api.get("/api/pipeline/board", { params: { requisition_id: requisitionId } }).then((r) => r.data),
  listEntries: (params?: { requisition_id?: number; candidate_id?: number }) =>
    api.get("/api/pipeline/entries", { params }).then((r) => r.data),
  getEntry: (id: number) => api.get(`/api/pipeline/entries/${id}`).then((r) => r.data),
  updateEntry: (id: number, data: any) => api.put(`/api/pipeline/entries/${id}`, data).then((r) => r.data),
  moveStage: (id: number, stage_id: number, notes = "") =>
    api.post(`/api/pipeline/entries/${id}/move-stage`, { stage_id, notes }).then((r) => r.data),
  getStageHistory: (id: number) => api.get(`/api/pipeline/entries/${id}/history`).then((r) => r.data),
  deleteEntry: (id: number) => api.delete(`/api/pipeline/entries/${id}`).then((r) => r.data),
  bulkDeleteEntries: (ids: number[]) => api.post("/api/pipeline/entries/bulk-delete", { ids }).then((r) => r.data),

  createOffer: (entryId: number, data: any) => api.post(`/api/pipeline/entries/${entryId}/offers`, data).then((r) => r.data),
  listOffers: (status?: string) => api.get("/api/pipeline/offers", { params: status ? { status } : {} }).then((r) => r.data),
  updateOffer: (id: number, data: any) => api.put(`/api/pipeline/offers/${id}`, data).then((r) => r.data),
  changeOfferStatus: (id: number, status: string) => api.post(`/api/pipeline/offers/${id}/status`, { status }).then((r) => r.data),
  deleteOffer: (id: number) => api.delete(`/api/pipeline/offers/${id}`).then((r) => r.data),

  listPlacements: (status?: string) => api.get("/api/pipeline/placements", { params: status ? { status } : {} }).then((r) => r.data),
  updatePlacement: (id: number, data: any) => api.put(`/api/pipeline/placements/${id}`, data).then((r) => r.data),
  changePlacementStatus: (id: number, status: string, fell_through_reason = "") =>
    api.post(`/api/pipeline/placements/${id}/status`, { status, fell_through_reason }).then((r) => r.data),
  deletePlacement: (id: number) => api.delete(`/api/pipeline/placements/${id}`).then((r) => r.data),
};

// ── Capability: Onboarding (Phase 5, alongside Pipeline & Offers) ──
export const onboardingApi = {
  listPlacements: () => api.get("/api/onboarding/placements").then((r) => r.data),
  listTasks: (placementId: number) => api.get("/api/onboarding/tasks", { params: { placement_id: placementId } }).then((r) => r.data),
  createTask: (data: { placement_id: number; title: string; category?: string; due_date?: string; assigned_to?: string; notes?: string }) =>
    api.post("/api/onboarding/tasks", data).then((r) => r.data),
  updateTask: (id: number, data: any) => api.put(`/api/onboarding/tasks/${id}`, data).then((r) => r.data),
  deleteTask: (id: number) => api.delete(`/api/onboarding/tasks/${id}`).then((r) => r.data),

  // Reference Checks — one row per referee, per placement. mode is
  // "Online" (typed up directly / referee self-submitted) or "Offline"
  // (a scanned/emailed paper form, stored via uploadReferenceCheckForm).
  referenceCheckOptions: () => api.get("/api/onboarding/reference-check-options").then((r) => r.data),
  listReferenceChecks: (placementId: number) => api.get("/api/onboarding/reference-checks", { params: { placement_id: placementId } }).then((r) => r.data),
  createReferenceCheck: (data: any) => api.post("/api/onboarding/reference-checks", data).then((r) => r.data),
  updateReferenceCheck: (id: number, data: any) => api.put(`/api/onboarding/reference-checks/${id}`, data).then((r) => r.data),
  deleteReferenceCheck: (id: number) => api.delete(`/api/onboarding/reference-checks/${id}`).then((r) => r.data),
  uploadReferenceCheckForm: (id: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post(`/api/onboarding/reference-checks/${id}/form`, form, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
  },
  referenceCheckFormUrl: (id: number) => `/api/onboarding/reference-checks/${id}/form`,
  deleteReferenceCheckForm: (id: number) => api.delete(`/api/onboarding/reference-checks/${id}/form`).then((r) => r.data),
};

// ── Capability: Partners (Phase 6) ──
export const portalApi = {
  getClientToken: (clientId: number) => api.get(`/api/portal/clients/${clientId}/token`).then((r) => r.data),
  createClientToken: (clientId: number) => api.post(`/api/portal/clients/${clientId}/token`).then((r) => r.data),
  revokeClientToken: (clientId: number) => api.post(`/api/portal/clients/${clientId}/token/revoke`).then((r) => r.data),

  getVendorToken: (vendorId: number) => api.get(`/api/portal/vendors/${vendorId}/token`).then((r) => r.data),
  createVendorToken: (vendorId: number) => api.post(`/api/portal/vendors/${vendorId}/token`).then((r) => r.data),
  revokeVendorToken: (vendorId: number) => api.post(`/api/portal/vendors/${vendorId}/token/revoke`).then((r) => r.data),

  assignVendor: (vendor_id: number, requisition_id: number) =>
    api.post("/api/portal/vendor-assignments", { vendor_id, requisition_id }).then((r) => r.data),
  listVendorAssignments: (params?: { vendor_id?: number; requisition_id?: number }) =>
    api.get("/api/portal/vendor-assignments", { params }).then((r) => r.data),
  removeVendorAssignment: (id: number) => api.delete(`/api/portal/vendor-assignments/${id}`).then((r) => r.data),

  listVendorSubmissions: (status?: string) => api.get("/api/portal/vendor-submissions", { params: status ? { status } : {} }).then((r) => r.data),
  reviewVendorSubmission: (id: number, action: "accept" | "reject", rejection_reason = "") =>
    api.post(`/api/portal/vendor-submissions/${id}/review`, { action, rejection_reason }).then((r) => r.data),
  submissionResumeUrl: (id: number) => `/api/portal/vendor-submissions/${id}/resume`,

  listClientFeedback: (acknowledged?: boolean) => api.get("/api/portal/client-feedback", { params: acknowledged !== undefined ? { acknowledged } : {} }).then((r) => r.data),
  acknowledgeFeedback: (id: number) => api.post(`/api/portal/client-feedback/${id}/acknowledge`).then((r) => r.data),
};

export const publicPortalApi = {
  getClientPortal: (token: string) => api.get(`/api/public/portal/client/${token}`).then((r) => r.data),
  clientResumeUrl: (token: string, pipelineEntryId: number) => `/api/public/portal/client/${token}/resume/${pipelineEntryId}`,
  submitClientFeedback: (token: string, data: { pipeline_entry_id: number; contact_name: string; decision: string; comments?: string }) =>
    api.post(`/api/public/portal/client/${token}/feedback`, data).then((r) => r.data),

  getVendorPortal: (token: string) => api.get(`/api/public/portal/vendor/${token}`).then((r) => r.data),
  submitVendorCandidate: (token: string, form: FormData) =>
    api.post(`/api/public/portal/vendor/${token}/submit`, form).then((r) => r.data),
};

// ── Capability: Comms (Phase 7) ──
export const communicationApi = {
  listTemplates: (category?: string) => api.get("/api/communication/templates", { params: category ? { category } : {} }).then((r) => r.data),
  createTemplate: (data: any) => api.post("/api/communication/templates", data).then((r) => r.data),
  updateTemplate: (id: number, data: any) => api.put(`/api/communication/templates/${id}`, data).then((r) => r.data),
  deleteTemplate: (id: number) => api.delete(`/api/communication/templates/${id}`).then((r) => r.data),

  getTimeline: (params: { candidate_id?: number; client_id?: number; vendor_id?: number; requisition_id?: number }) =>
    api.get("/api/communication/timeline", { params }).then((r) => r.data),
  logEntry: (data: any) => api.post("/api/communication/log", data).then((r) => r.data),
  sendEmail: (data: any) => api.post("/api/communication/send-email", data).then((r) => r.data),

  listAutomationRules: () => api.get("/api/communication/automation-rules").then((r) => r.data),
  createAutomationRule: (data: any) => api.post("/api/communication/automation-rules", data).then((r) => r.data),
  updateAutomationRule: (id: number, data: any) => api.put(`/api/communication/automation-rules/${id}`, data).then((r) => r.data),
  deleteAutomationRule: (id: number) => api.delete(`/api/communication/automation-rules/${id}`).then((r) => r.data),
  getAutomationLog: () => api.get("/api/communication/automation-log").then((r) => r.data),

  getWorkbench: () => api.get("/api/communication/workbench").then((r) => r.data),
};

// ── Capability: Commercials (Phase 8) ──
export const commercialApi = {
  createInvoice: (data: any) => api.post("/api/commercials/invoices", data).then((r) => r.data),
  listInvoices: (params?: { status?: string; client_id?: number }) => api.get("/api/commercials/invoices", { params }).then((r) => r.data),
  updateInvoice: (id: number, data: any) => api.put(`/api/commercials/invoices/${id}`, data).then((r) => r.data),
  changeInvoiceStatus: (id: number, status: string) => api.post(`/api/commercials/invoices/${id}/status`, { status }).then((r) => r.data),
  deleteInvoice: (id: number) => api.delete(`/api/commercials/invoices/${id}`).then((r) => r.data),

  getGuaranteeAlerts: (days = 14) => api.get("/api/commercials/guarantee-alerts", { params: { days } }).then((r) => r.data),
  getRevenueReport: () => api.get("/api/commercials/revenue").then((r) => r.data),

  createTimesheet: (data: any) => api.post("/api/commercials/timesheets", data).then((r) => r.data),
  listTimesheets: (params?: { placement_id?: number; status?: string }) => api.get("/api/commercials/timesheets", { params }).then((r) => r.data),
  updateTimesheet: (id: number, data: any) => api.put(`/api/commercials/timesheets/${id}`, data).then((r) => r.data),
  approveTimesheet: (id: number) => api.post(`/api/commercials/timesheets/${id}/approve`).then((r) => r.data),
  deleteTimesheet: (id: number) => api.delete(`/api/commercials/timesheets/${id}`).then((r) => r.data),
  timesheetsToInvoice: (timesheet_ids: number[], description = "") =>
    api.post("/api/commercials/timesheets/to-invoice", { timesheet_ids, description }).then((r) => r.data),
};

// ── Capability: Governance (Phase 9) ──
export const governanceApi = {
  getMyRole: (orgId?: number) => api.get("/api/governance/me", { params: orgId ? { org_id: orgId } : {} }).then((r) => r.data),
  listMyOrganisations: () => api.get("/api/governance/organisations").then((r) => r.data),
  listTeam: (orgId?: number) => api.get("/api/governance/team", { params: orgId ? { org_id: orgId } : {} }).then((r) => r.data),
  inviteMember: (email: string, role: string, orgId?: number) =>
    api.post("/api/governance/team/invite", { email, role }, { params: orgId ? { org_id: orgId } : {} }).then((r) => r.data),
  changeMemberRole: (membershipId: number, role: string, orgId?: number) =>
    api.put(`/api/governance/team/${membershipId}`, { role }, { params: orgId ? { org_id: orgId } : {} }).then((r) => r.data),
  removeMember: (membershipId: number, orgId?: number) =>
    api.delete(`/api/governance/team/${membershipId}`, { params: orgId ? { org_id: orgId } : {} }).then((r) => r.data),

  getTimeToFill: (orgId?: number) => api.get("/api/governance/metrics/time-to-fill", { params: orgId ? { org_id: orgId } : {} }).then((r) => r.data),
  getFunnel: (orgId?: number) => api.get("/api/governance/metrics/funnel", { params: orgId ? { org_id: orgId } : {} }).then((r) => r.data),
  getSourceOfHire: (orgId?: number) => api.get("/api/governance/metrics/source-of-hire", { params: orgId ? { org_id: orgId } : {} }).then((r) => r.data),
  getRecruiterPerformance: (orgId?: number) => api.get("/api/governance/metrics/recruiter-performance", { params: orgId ? { org_id: orgId } : {} }).then((r) => r.data),
  getVendorPerformance: (orgId?: number) => api.get("/api/governance/metrics/vendor-performance", { params: orgId ? { org_id: orgId } : {} }).then((r) => r.data),
  getRequisitionsOverview: (orgId?: number) => api.get("/api/governance/metrics/requisitions-overview", { params: orgId ? { org_id: orgId } : {} }).then((r) => r.data),
};

export const authApi = {
  register: (data: any) => api.post("/api/auth/register", data).then((r) => r.data),
  login: (data: any) => api.post("/api/auth/login", data).then((r) => r.data),
  me: () => api.get("/api/auth/me").then((r) => r.data),
  updateProfile: (data: any) => api.put("/api/auth/me", data).then((r) => r.data),
  changePassword: (old_pw: string, new_pw: string) =>
    api.post(`/api/auth/change-password?old_password=${encodeURIComponent(old_pw)}&new_password=${encodeURIComponent(new_pw)}`).then((r) => r.data),
  listApiKeys: () => api.get("/api/auth/api-keys").then((r) => r.data),
  listGlobalKeys: () => api.get("/api/auth/global-keys").then((r) => r.data),
  saveApiKey: (data: any) => api.post("/api/auth/api-keys", data).then((r) => r.data),
  deleteApiKey: (id: number) => api.delete(`/api/auth/api-keys/${id}`).then((r) => r.data),
  listUsers: () => api.get("/api/auth/users").then((r) => r.data),
  deactivateUser: (id: number) => api.put(`/api/auth/users/${id}/deactivate`).then((r) => r.data),
};

export const groqPoolApi = {
  list: () => api.get("/api/admin/groq-pool").then((r) => r.data),
  add: (data: { key_value: string; model?: string }) => api.post("/api/admin/groq-pool", data).then((r) => r.data),
  update: (id: number, data: { is_active?: boolean; model?: string; key_value?: string }) => api.patch(`/api/admin/groq-pool/${id}`, data).then((r) => r.data),
  remove: (id: number) => api.delete(`/api/admin/groq-pool/${id}`).then((r) => r.data),
  listModels: (key_value: string) => api.post("/api/admin/groq-pool/models", { key_value }).then((r) => r.data),
  listModelsForExisting: (id: number) => api.post(`/api/admin/groq-pool/${id}/models`).then((r) => r.data),
};

export const jobhuntApi = {
  uploadResume: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post("/api/jobhunt/resume", form).then((r) => r.data);
  },
  listResumes: () => api.get("/api/jobhunt/resumes").then((r) => r.data),
  searchJobs: (data: any) => api.post("/api/jobhunt/search", data, { timeout: 120_000 }).then((r) => r.data),
  listSearches: () => api.get("/api/jobhunt/searches").then((r) => r.data),
  deleteSearch: (id: number) => api.delete(`/api/jobhunt/searches/${id}`).then((r) => r.data),
  deleteAllSearches: () => api.delete("/api/jobhunt/searches").then((r) => r.data),
  matchResume: (data: any) => api.post("/api/jobhunt/match", data, { timeout: 180_000 }).then((r) => r.data),
  listMatches: () => api.get("/api/jobhunt/matches").then((r) => r.data),
  exportExcel: (searchId: number) =>
    api.get(`/api/jobhunt/export/${searchId}`, { responseType: "blob" }).then((r) => r.data),
};

export const jobintelApi = {
  runAnalysis: (data: any) => api.post("/api/jobintel/run", data).then((r) => r.data),
  listRuns: () => api.get("/api/jobintel/runs").then((r) => r.data),
  getRun: (id: number) => api.get(`/api/jobintel/runs/${id}`).then((r) => r.data),
  getRunRecords: (id: number) => api.get(`/api/jobintel/runs/${id}/records`).then((r) => r.data),
  deleteRun: (id: number) => api.delete(`/api/jobintel/runs/${id}`).then((r) => r.data),
  deleteAllRuns: () => api.delete("/api/jobintel/runs").then((r) => r.data),
};

export const linklensApi = {
  startSearch: (data: any) => api.post("/api/linklens/search", data).then((r) => r.data),
  listSearches: () => api.get("/api/linklens/searches").then((r) => r.data),
  getSearch: (id: number) => api.get(`/api/linklens/searches/${id}`).then((r) => r.data),
  deleteSearch: (id: number) => api.delete(`/api/linklens/searches/${id}`).then((r) => r.data),
  deleteAllSearches: () => api.delete("/api/linklens/searches").then(r => r.data),
  exportProfiles: (id: number) =>
    api.get(`/api/linklens/searches/${id}/export`, { responseType: "blob" }).then((r) => r.data),
};

export const dashboardApi = {
  getStats: () => api.get("/api/dashboard/stats").then((r) => r.data),
  jobHunterSummary: () => api.get("/api/dashboard/jobhunter-summary").then((r) => r.data),
  marketIntelSummary: () => api.get("/api/dashboard/marketintel-summary").then((r) => r.data),
  linkExploreSummary: () => api.get("/api/dashboard/linkexplore-summary").then((r) => r.data),
};

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const joblensApi = {
  deleteSession: (id: number) => api.delete(`/api/joblens/sessions/${id}`).then(r => r.data),
  deleteAllSessions: () => api.delete("/api/joblens/sessions").then(r => r.data),
};

export const jdcreatorApi = {
  generate: (data: any) => api.post("/api/jdcreator/generate", data, { timeout: 120_000 }).then(r => r.data),
  listDocuments: () => api.get("/api/jdcreator/documents").then(r => r.data),
  getDocument: (id: number) => api.get(`/api/jdcreator/documents/${id}`).then(r => r.data),
  deleteDocument: (id: number) => api.delete(`/api/jdcreator/documents/${id}`).then(r => r.data),
  download: (id: number) =>
    api.get(`/api/jdcreator/documents/${id}/download`, { responseType: "blob" }).then(r => r.data),
};

export const cvintelApi = {
  saveHistory: (data: any) => api.post("/api/cvintel/history", data).then(r => r.data),
  listHistory: () => api.get("/api/cvintel/history").then(r => r.data),
  deleteHistoryItem: (id: number) => api.delete(`/api/cvintel/history/${id}`).then(r => r.data),
  deleteAllHistory: () => api.delete("/api/cvintel/history").then(r => r.data),
};

export const candidateTrackApi = {
  meta: () => api.get("/api/candidatetrack/meta").then(r => r.data),

  listClients: () => api.get("/api/candidatetrack/clients").then(r => r.data),
  createClient: (data: any) => api.post("/api/candidatetrack/clients", data).then(r => r.data),
  updateClient: (id: number, data: any) => api.put(`/api/candidatetrack/clients/${id}`, data).then(r => r.data),
  deleteClient: (id: number) => api.delete(`/api/candidatetrack/clients/${id}`).then(r => r.data),
  bulkDeleteClients: (ids: number[]) => api.delete("/api/candidatetrack/clients", { data: { ids } }).then(r => r.data),
  importClientsCsv: (form: FormData) => api.post("/api/candidatetrack/clients/import-csv", form, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data),

  listJDs: () => api.get("/api/candidatetrack/jds").then(r => r.data),
  jdStats: () => api.get("/api/candidatetrack/jds/stats").then(r => r.data),
  jdDashboardSummary: () => api.get("/api/candidatetrack/dashboard/jd-summary").then(r => r.data),
  vendorDashboardSummary: () => api.get("/api/candidatetrack/dashboard/vendor-summary").then(r => r.data),
  createJD: (data: any) => api.post("/api/candidatetrack/jds", data).then(r => r.data),
  updateJD: (id: number, data: any) => api.put(`/api/candidatetrack/jds/${id}`, data).then(r => r.data),
  deleteJD: (id: number) => api.delete(`/api/candidatetrack/jds/${id}`).then(r => r.data),
  bulkDeleteJDs: (ids: number[]) => api.delete("/api/candidatetrack/jds", { data: { ids } }).then(r => r.data),
  importJDsCsv: (form: FormData) => api.post("/api/candidatetrack/jds/import-csv", form, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data),
  uploadJDFile: (jdId: number, form: FormData) => api.post(`/api/candidatetrack/jds/${jdId}/file`, form, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data),

  listVendors: () => api.get("/api/candidatetrack/vendors").then(r => r.data),
  createVendor: (data: any) => api.post("/api/candidatetrack/vendors", data).then(r => r.data),
  updateVendor: (id: number, data: any) => api.put(`/api/candidatetrack/vendors/${id}`, data).then(r => r.data),
  deleteVendor: (id: number) => api.delete(`/api/candidatetrack/vendors/${id}`).then(r => r.data),
  bulkDeleteVendors: (ids: number[]) => api.delete("/api/candidatetrack/vendors", { data: { ids } }).then(r => r.data),
  importVendorsCsv: (form: FormData) => api.post("/api/candidatetrack/vendors/import-csv", form, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data),

  listCandidates: () => api.get("/api/candidatetrack/candidates").then(r => r.data),
  createCandidate: (form: FormData) =>
    api.post("/api/candidatetrack/candidates", form, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data),
  bulkUploadCandidates: (form: FormData) =>
    api.post("/api/candidatetrack/candidates/bulk-upload", form, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data),
  updateCandidate: (id: number, data: any) => api.put(`/api/candidatetrack/candidates/${id}`, data).then(r => r.data),
  deleteCandidate: (id: number) => api.delete(`/api/candidatetrack/candidates/${id}`).then(r => r.data),
  bulkDeleteCandidates: (ids: number[]) => api.delete("/api/candidatetrack/candidates", { data: { ids } }).then(r => r.data),
  candidateStatusLog: (id: number) => api.get(`/api/candidatetrack/candidates/${id}/status-log`).then(r => r.data),
  uploadCoverLetter: (id: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post(`/api/candidatetrack/candidates/${id}/cover-letter`, form, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data);
  },
};