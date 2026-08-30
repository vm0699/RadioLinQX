// Thin client for the NestJS API. Works against either backend:
//  - 'orthanc' → /api/studies (QIDO proxy), wadors: imageIds
//  - 'local'   → /api/local/studies (sample-data files), wadouri: imageIds

const API_BASE =
  typeof __API_BASE__ !== 'undefined' && __API_BASE__ ? __API_BASE__ : '';

export type BackendMode = 'orthanc' | 'local' | 'none';

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

export interface LocalInstanceRef {
  sopInstanceUid: string;
  numberOfFrames: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.json() as Promise<T>;
}

let modePromise: Promise<BackendMode> | null = null;
export function getMode(): Promise<BackendMode> {
  if (!modePromise) {
    modePromise = get<{ mode: BackendMode }>('/api/mode')
      .then((r) => r.mode)
      .catch(() => 'none' as BackendMode);
  }
  return modePromise;
}

const base = (mode: BackendMode) => (mode === 'local' ? '/api/local' : '/api');

export const api = {
  getMode,

  listStudies: async (params: Record<string, string> = {}) => {
    const mode = await getMode();
    const qs = new URLSearchParams(params).toString();
    return get<StudySummary[]>(
      `${base(mode)}/studies${mode === 'local' ? '' : qs ? `?${qs}` : ''}`,
    );
  },

  listSeries: async (studyUid: string) => {
    const mode = await getMode();
    return get<SeriesSummary[]>(
      `${base(mode)}/studies/${encodeURIComponent(studyUid)}/series`,
    );
  },

  /** local mode only: ordered instance refs for a series */
  listLocalInstances: (studyUid: string, seriesUid: string) =>
    get<LocalInstanceRef[]>(
      `/api/local/studies/${encodeURIComponent(studyUid)}/series/${encodeURIComponent(
        seriesUid,
      )}/instances`,
    ),

  health: () => get<{ status: string; orthanc: boolean }>(`/api/health`),
};

export { API_BASE };
