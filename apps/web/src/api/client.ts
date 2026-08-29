// Thin client for the NestJS API (flattened study/series lists).

const API_BASE =
  typeof __API_BASE__ !== 'undefined' && __API_BASE__ ? __API_BASE__ : '';

export interface StudySummary {
  studyInstanceUid: string;
  patientId?: string;
  patientName?: string;
  patientSex?: string;
  patientBirthDate?: string;
  studyDate?: string;
  studyTime?: string;
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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.json() as Promise<T>;
}

export const api = {
  listStudies: (params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return get<StudySummary[]>(`/api/studies${qs ? `?${qs}` : ''}`);
  },
  listSeries: (studyUid: string) =>
    get<SeriesSummary[]>(`/api/studies/${encodeURIComponent(studyUid)}/series`),
  health: () => get<{ status: string; orthanc: boolean }>(`/api/health`),
};
