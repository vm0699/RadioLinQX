// API client — DICOM (viewer) + dashboard (cases, directory, settings, notifs).

const API_BASE =
  typeof __API_BASE__ !== 'undefined' && __API_BASE__ ? __API_BASE__ : '';

export type BackendMode = 'orthanc' | 'local' | 'none';

// ---------- DICOM / viewer ----------
export interface StudySummary {
  studyInstanceUid: string;
  patientId?: string;
  patientName?: string;
  patientSex?: string;
  patientBirthDate?: string;
  studyDate?: string;
  accessionNumber?: string;
  studyDescription?: string;
  modalities?: string;
  referringPhysician?: string;
  seriesCount?: number;
  instanceCount?: number;
}
export interface SeriesSummary {
  seriesInstanceUid: string;
  seriesNumber?: number;
  modality?: string;
  seriesDescription?: string;
  bodyPart?: string;
  instanceCount?: number;
}
export interface LocalInstanceRef {
  sopInstanceUid: string;
  numberOfFrames: number;
}

// ---------- dashboard ----------
export type CaseStatus = 'UNREAD' | 'ASSIGNED' | 'DRAFT' | 'REPORTED';
export type TatStatus = 'ON_TIME' | 'DUE_SOON' | 'OVERDUE' | 'REPORTED';

export interface CaseReport {
  clinicalHistory: string;
  technique: string;
  findings: string;
  impression: string;
  updatedAt: string;
  signedBy?: string;
  signedAt?: string;
}
export interface CaseAttachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  uploadedAt: string;
  file: string;
}
export interface CaseEvent {
  id: string;
  at: string;
  by: string;
  type:
    | 'CREATED' | 'UPLOADED' | 'EDITED' | 'ASSIGNED' | 'STATUS'
    | 'REPORT_SAVED' | 'REPORT_SIGNED' | 'TAG' | 'LINK' | 'ATTACHMENT' | 'DUPLICATED';
  detail: string;
}
export interface CaseView {
  id: string;
  caseNumber: string;
  patientId: string;
  patientName: string;
  patientAge?: number;
  patientSex?: string;
  patientMobile?: string;
  scanType: string;
  bodyParts: string[];
  studyDescription?: string;
  contrast?: 'Yes' | 'No';
  branchId?: string;
  referringDoctorId?: string;
  referringDoctorName?: string;
  referringDoctorMobile?: string;
  patientHistory?: string;
  remarks?: string;
  tags: string[];
  status: CaseStatus;
  assignedRadiologistId?: string;
  assignedRadiologistName?: string;
  uploadedAt: string;
  dueAt: string;
  reportedAt?: string;
  uploadStatus: 'COMPLETE' | 'IN_PROGRESS' | 'PARTIAL';
  imageCount: number;
  seriesCount: number;
  hasImages: boolean;
  studyInstanceUid?: string;
  seriesInstanceUids?: string[];
  report?: CaseReport;
  linkedCaseIds?: string[];
  attachments?: CaseAttachment[];
  history?: CaseEvent[];
  tatStatus: TatStatus;
  timeElapsedMs: number;
  timeRemainingMs: number;
}
export interface CaseListResult {
  total: number;
  page: number;
  perPage: number;
  rows: CaseView[];
}
export interface FilterPreset {
  id: string;
  name: string;
  query: Record<string, string>;
  createdAt: string;
}
export interface Radiologist {
  id: string;
  name: string;
  email: string;
  specialties: string[];
  active: boolean;
}
export interface Branch {
  id: string;
  name: string;
  code: string;
  address?: string;
}
export interface AppSettings {
  id: 'app';
  scanCenter: { name: string; aet: string; contactEmail: string; contactPhone: string };
  branches: Branch[];
  scanTypes: string[];
  bodyParts: string[];
  tags: string[];
  radiologists: Radiologist[];
  tat: { targetHoursByScanType: Record<string, number>; statWindowHours: number };
}
export interface ReferringDoctor {
  id: string;
  name: string;
  phone: string;
  email?: string;
  hospital?: string;
  speciality?: string;
  casesReferred: number;
  createdAt: string;
}
export interface Notification {
  id: string;
  type: 'NEW_CASE' | 'ASSIGNED' | 'REPORT_READY' | 'OVERDUE' | 'CHAT';
  title: string;
  body: string;
  caseId?: string;
  at: string;
  read: boolean;
}
export interface ChatMessage {
  id: string;
  author: string;
  role: 'radiologist' | 'centre' | 'referrer' | 'system';
  text: string;
  at: string;
}
export interface ChatThread {
  id: string;
  caseId: string;
  patientName: string;
  messages: ChatMessage[];
  updatedAt: string;
}

// ---------- transport ----------
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} — ${path}${txt ? ` — ${txt.slice(0, 200)}` : ''}`);
  }
  return (res.status === 204 ? undefined : res.json()) as Promise<T>;
}
const get = <T>(p: string) => req<T>(p);
const post = <T>(p: string, body?: unknown) =>
  req<T>(p, { method: 'POST', body: body == null ? undefined : JSON.stringify(body) });
const patch = <T>(p: string, body: unknown) =>
  req<T>(p, { method: 'PATCH', body: JSON.stringify(body) });
const put = <T>(p: string, body: unknown) =>
  req<T>(p, { method: 'PUT', body: JSON.stringify(body) });
const del = <T>(p: string) => req<T>(p, { method: 'DELETE' });

let modePromise: Promise<BackendMode> | null = null;
export function getMode(): Promise<BackendMode> {
  if (!modePromise) {
    modePromise = get<{ mode: BackendMode }>('/api/mode')
      .then((r) => r.mode)
      .catch(() => 'none' as BackendMode);
  }
  return modePromise;
}

export const api = {
  getMode,
  health: () => get<{ status: string; orthanc: boolean }>('/api/health'),

  // viewer
  listSeriesFor: async (studyUid: string) => {
    const mode = await getMode();
    const base = mode === 'local' ? '/api/local' : '/api';
    return get<SeriesSummary[]>(`${base}/studies/${encodeURIComponent(studyUid)}/series`);
  },
  listLocalInstances: (studyUid: string, seriesUid: string) =>
    get<LocalInstanceRef[]>(
      `/api/local/studies/${encodeURIComponent(studyUid)}/series/${encodeURIComponent(seriesUid)}/instances`,
    ),

  // cases
  listCases: (q: Record<string, string> = {}) =>
    get<CaseListResult>(`/api/cases?${new URLSearchParams(q)}`),
  caseStats: (q: Record<string, string> = {}) =>
    get<{ all: number; reported: number; pending: number }>(
      `/api/cases/stats?${new URLSearchParams(q)}`,
    ),
  getCase: (id: string) => get<CaseView>(`/api/cases/${id}`),
  createCase: (body: Partial<CaseView>) => post<CaseView>('/api/cases', body),
  updateCase: (id: string, body: Partial<CaseView>) => patch<CaseView>(`/api/cases/${id}`, body),
  assignCase: (id: string, radiologistId: string) =>
    post<CaseView>(`/api/cases/${id}/assign`, { radiologistId }),
  saveReport: (id: string, report: Partial<CaseReport>, action: 'save' | 'sign') =>
    put<CaseView>(`/api/cases/${id}/report`, { report, action }),
  deleteCase: (id: string) => del<{ ok: boolean }>(`/api/cases/${id}`),
  duplicateCase: (id: string) => post<CaseView>(`/api/cases/${id}/duplicate`),
  /** absolute URL for the zip download (opened in a new tab) */
  caseDownloadUrl: (id: string) => `${API_BASE}/api/cases/${id}/download`,
  caseReportTxtUrl: (id: string) => `${API_BASE}/api/cases/${id}/report.txt`,
  linkCases: (id: string, otherId: string, unlink = false) =>
    post<CaseView>(`/api/cases/${id}/link`, { otherId, unlink }),
  caseHistory: (id: string) => get<CaseEvent[]>(`/api/cases/${id}/history`),
  addAttachments: async (id: string, files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f, f.name));
    const res = await fetch(`${API_BASE}/api/cases/${id}/attachments`, {
      method: 'POST',
      body: fd,
    });
    if (!res.ok) throw new Error((await res.text().catch(() => '')) || `${res.status}`);
    return res.json() as Promise<CaseView>;
  },
  attachmentUrl: (id: string, aid: string) =>
    `${API_BASE}/api/cases/${id}/attachments/${aid}`,

  // upload
  uploadStudy: async (files: File[], meta: Record<string, string> = {}) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f, f.name));
    Object.entries(meta).forEach(([k, v]) => v && fd.append(k, v));
    const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error((await res.text().catch(() => '')) || `upload ${res.status}`);
    return res.json() as Promise<{ created: CaseView[]; accepted: number; rejected: number }>;
  },

  // chat
  caseChat: (id: string) => get<ChatThread>(`/api/cases/${id}/chat`),
  postCaseChat: (id: string, text: string, author = 'You') =>
    post<ChatThread>(`/api/cases/${id}/chat`, { text, author }),
  chatThreads: () => get<ChatThread[]>('/api/chat/threads'),

  // presets
  listPresets: () => get<FilterPreset[]>('/api/cases/presets'),
  createPreset: (name: string, query: Record<string, string>) =>
    post<FilterPreset>('/api/cases/presets', { name, query }),
  deletePreset: (id: string) => del<{ ok: boolean }>(`/api/cases/presets/${id}`),

  // settings
  getSettings: () => get<AppSettings>('/api/settings'),
  updateSettings: (body: Partial<AppSettings>) => patch<AppSettings>('/api/settings', body),

  // referring doctors
  listReferrers: () => get<ReferringDoctor[]>('/api/referring-doctors'),
  createReferrer: (body: Partial<ReferringDoctor>) =>
    post<ReferringDoctor>('/api/referring-doctors', body),
  updateReferrer: (id: string, body: Partial<ReferringDoctor>) =>
    patch<ReferringDoctor>(`/api/referring-doctors/${id}`, body),
  deleteReferrer: (id: string) => del<{ ok: boolean }>(`/api/referring-doctors/${id}`),

  // notifications
  listNotifications: () => get<Notification[]>('/api/notifications'),
  notifUnread: () => get<{ count: number }>('/api/notifications/unread-count'),
  notifReadAll: () => post<{ ok: boolean }>('/api/notifications/read-all'),
  notifRead: (id: string) => post<{ ok: boolean }>(`/api/notifications/${id}/read`),
};

export { API_BASE };
