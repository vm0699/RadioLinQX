import { create } from 'zustand';
import type { SeriesSummary } from '../api/client';

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
