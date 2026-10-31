import { create } from 'zustand';
import type { SeriesSummary } from '../api/client';
import { isVolumetric } from '../vr/xr';

export type ProjectionMode = 'none' | 'mip' | 'minip' | 'average';
export type PrimaryToolKey =
  | 'WindowLevel'
  | 'Pan'
  | 'Zoom'
  | 'Magnify'
  | 'Length'
  | 'Angle'
  | 'CobbAngle'
  | 'RectangleROI'
  | 'EllipticalROI'
  | 'PlanarFreehandROI'
  | 'SplineROI'
  | 'ArrowAnnotate'
  | 'Probe'
  | 'Label';

/** most series shown side by side in 3D compare */
export const MAX_VRT = 4;

export interface LoadedSeries extends SeriesSummary {
  studyInstanceUid: string;
  imageIds: string[];
}

export interface ViewerState {
  studyInstanceUid: string | null;
  patient: {
    name?: string;
    id?: string;
    sex?: string;
    birthDate?: string;
    studyDescription?: string;
    studyDate?: string;
  };
  /** series chosen in the "View Selected" dialog, in display order */
  series: LoadedSeries[];

  layout: { rows: number; cols: number };
  /** seriesInstanceUid per viewport index (row-major); undefined = empty */
  assignments: (string | undefined)[];
  activeViewportIndex: number;

  primaryTool: PrimaryToolKey;
  mpr: boolean;
  /** 3D volume rendering (VRT) — mutually exclusive with mpr */
  vrt: boolean;
  vrtPreset: string;
  /** series shown in 3D (1–4, several = side-by-side compare); empty = the active viewport's series */
  vrtSeries: string[];
  /** rotating one 3D view rotates all of them */
  vrtLink: boolean;
  /** turntable auto-rotation */
  vrtSpin: boolean;
  projection: ProjectionMode;
  slabThicknessMm: number;
  referenceLines: boolean;
  crosshairs: boolean;

  cinePlaying: boolean;
  cineFps: number;

  invert: boolean;
  showOverlay: boolean;
  /** link scroll + W/L + zoom-pan across viewports (Compare layouts) */
  sync: boolean;
  topBarHidden: boolean;

  set: <K extends keyof ViewerState>(k: K, v: ViewerState[K]) => void;
  setLayout: (rows: number, cols: number) => void;
  assign: (viewportIndex: number, seriesUid: string) => void;
  reset: () => void;
}

const initial = {
  studyInstanceUid: null as string | null,
  patient: {},
  series: [] as LoadedSeries[],
  layout: { rows: 1, cols: 1 },
  assignments: [undefined] as (string | undefined)[],
  activeViewportIndex: 0,
  primaryTool: 'WindowLevel' as PrimaryToolKey,
  mpr: false,
  vrt: false,
  vrtPreset: 'CT-Bone',
  vrtSeries: [] as string[],
  vrtLink: true,
  vrtSpin: false,
  projection: 'none' as ProjectionMode,
  slabThicknessMm: 0.5,
  referenceLines: false,
  crosshairs: false,
  cinePlaying: false,
  cineFps: 24,
  invert: false,
  showOverlay: true,
  sync: false,
  topBarHidden: false,
};

export const useViewer = create<ViewerState>((set) => ({
  ...initial,
  set: (k, v) => set({ [k]: v } as Partial<ViewerState>),
  setLayout: (rows, cols) =>
    set((s) => {
      const count = rows * cols;
      const assignments = Array.from({ length: count }, (_, i) => s.assignments[i]);
      // auto-fill empty viewports with the loaded series in order
      let cursor = 0;
      for (let i = 0; i < count; i++) {
        if (!assignments[i] && s.series[cursor]) {
          assignments[i] = s.series[cursor].seriesInstanceUid;
        }
        if (assignments[i]) cursor++;
      }
      return {
        layout: { rows, cols },
        assignments,
        activeViewportIndex: Math.min(s.activeViewportIndex, count - 1),
      };
    }),
  assign: (viewportIndex, seriesUid) =>
    set((s) => {
      const assignments = [...s.assignments];
      assignments[viewportIndex] = seriesUid;
      return { assignments };
    }),
  reset: () => set({ ...initial }),
}));

export type VrtSelectionState = Pick<ViewerState, 'series' | 'assignments' | 'activeViewportIndex' | 'vrtSeries'>;

/** Series that can be volume-rendered (multi-slice CT / MR / PET). */
export const canRenderVolume = (s: LoadedSeries): boolean =>
  isVolumetric({ modality: s.modality, instanceCount: s.imageIds?.length ?? s.instanceCount });

/** Series rendered in 3D: the explicit selection, else the active viewport's series. */
export function shownVrtUids(st: VrtSelectionState): string[] {
  const volumetric = new Set(st.series.filter(canRenderVolume).map((x) => x.seriesInstanceUid));
  const picked = st.vrtSeries.filter((u) => volumetric.has(u));
  if (picked.length) return picked.slice(0, MAX_VRT);
  const active = st.assignments[st.activeViewportIndex] ?? st.series[0]?.seriesInstanceUid;
  return active && volumetric.has(active) ? [active] : [];
}
