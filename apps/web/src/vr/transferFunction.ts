// Transfer-function presets. Control points are expressed in *window space*
// (x = 0 … 1 across the preset's own default window) so the user's
// Window/Level controls simply slide/stretch the whole colour+opacity curve.

import * as THREE from 'three';
import type { PreparedVolume } from './volumeData';

export interface TFPoint {
  x: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface TFPreset {
  id: string;
  label: string;
  /** only offered for CT (Hounsfield-anchored) */
  ct?: boolean;
  /** only offered for non-CT (percentile-anchored) */
  nonCt?: boolean;
  /** default window (CT: HU). Non-CT presets use the series' 2nd–99th percentile. */
  center?: number;
  width?: number;
  /** iso-surface level for the mesh mode (CT: HU, non-CT: fraction of p2..p99) */
  iso: number;
  surfaceColor: number;
  points: TFPoint[];
}

const P = (x: number, r: number, g: number, b: number, a: number): TFPoint => ({ x, r, g, b, a });

export const PRESETS: TFPreset[] = [
  {
    id: 'ct-bone',
    label: 'Bone',
    ct: true,
    center: 700,
    width: 1400,
    iso: 280,
    surfaceColor: 0xe8dfd0,
    points: [
      P(0.0, 0.8, 0.72, 0.6, 0),
      P(0.2, 0.8, 0.72, 0.6, 0),
      P(0.3, 0.84, 0.76, 0.64, 0.12),
      P(0.55, 0.95, 0.9, 0.82, 0.55),
      P(1.0, 1.0, 1.0, 0.97, 0.95),
    ],
  },
  {
    id: 'ct-soft',
    label: 'Skin / soft tissue',
    ct: true,
    center: 0,
    width: 900,
    iso: -250,
    surfaceColor: 0xd9a38b,
    points: [
      P(0.0, 1, 0.9, 0.6, 0),
      P(0.34, 1, 0.9, 0.6, 0),
      P(0.4, 1.0, 0.88, 0.58, 0.04),
      P(0.5, 0.86, 0.46, 0.36, 0.1),
      P(0.6, 0.9, 0.55, 0.45, 0.28),
      P(0.75, 0.96, 0.9, 0.85, 0.62),
      P(1.0, 1, 1, 1, 0.95),
    ],
  },
  {
    id: 'ct-lung',
    label: 'Lung / airways',
    ct: true,
    center: -500,
    width: 1000,
    iso: -450,
    surfaceColor: 0xa9c2e8,
    points: [
      P(0.0, 0.4, 0.55, 0.9, 0),
      P(0.12, 0.4, 0.55, 0.9, 0),
      P(0.22, 0.45, 0.6, 0.92, 0.06),
      P(0.5, 0.9, 0.6, 0.5, 0.12),
      P(0.8, 1, 0.85, 0.75, 0.5),
      P(1.0, 1, 1, 1, 0.9),
    ],
  },
  {
    id: 'ct-vessel',
    label: 'Vessels (contrast)',
    ct: true,
    center: 300,
    width: 500,
    iso: 180,
    surfaceColor: 0xd6584f,
    points: [
      P(0.0, 0.9, 0.2, 0.2, 0),
      P(0.25, 0.9, 0.2, 0.2, 0),
      P(0.45, 0.92, 0.22, 0.2, 0.35),
      P(0.8, 1, 0.6, 0.5, 0.85),
      P(1.0, 1, 0.95, 0.9, 1),
    ],
  },
  {
    id: 'mr-warm',
    label: 'MR · tissue',
    nonCt: true,
    iso: 0.25,
    surfaceColor: 0xdcc3b0,
    points: [
      P(0.0, 0.5, 0.5, 0.55, 0),
      P(0.1, 0.5, 0.5, 0.55, 0),
      P(0.3, 0.7, 0.55, 0.5, 0.06),
      P(0.6, 0.9, 0.78, 0.7, 0.3),
      P(1.0, 1, 0.97, 0.94, 0.9),
    ],
  },
  {
    id: 'mr-cool',
    label: 'MR · cool',
    nonCt: true,
    iso: 0.3,
    surfaceColor: 0xb7c8e6,
    points: [
      P(0.0, 0.3, 0.4, 0.7, 0),
      P(0.12, 0.3, 0.4, 0.7, 0),
      P(0.35, 0.5, 0.65, 0.9, 0.08),
      P(0.7, 0.85, 0.92, 1, 0.4),
      P(1.0, 1, 1, 1, 0.92),
    ],
  },
  {
    id: 'gray',
    label: 'Grayscale',
    iso: 0.3,
    surfaceColor: 0xd8d8d8,
    points: [P(0.0, 0, 0, 0, 0), P(0.08, 0.05, 0.05, 0.05, 0), P(0.5, 0.55, 0.55, 0.55, 0.3), P(1.0, 1, 1, 1, 0.85)],
  },
];

export function presetsFor(isCT: boolean): TFPreset[] {
  return PRESETS.filter((p) => (isCT ? !p.nonCt : !p.ct));
}

export function defaultPreset(isCT: boolean): TFPreset {
  return presetsFor(isCT)[0];
}

/** default {center,width} in native units for a preset on this volume */
export function presetWindow(p: TFPreset, vol: PreparedVolume): { center: number; width: number } {
  if (vol.isCT && p.center != null && p.width != null) return { center: p.center, width: p.width };
  const lo = vol.p2;
  const hi = Math.max(vol.p99, lo + 1);
  return { center: (lo + hi) / 2, width: hi - lo };
}

/** iso level in native units */
export function presetIso(p: TFPreset, vol: PreparedVolume): number {
  if (vol.isCT) return p.iso;
  const lo = vol.p2;
  const hi = Math.max(vol.p99, lo + 1);
  return lo + (p.id === 'gray' ? 0.3 : p.iso) * (hi - lo);
}

/** 256×1 RGBA LUT texture from a preset curve */
export function buildLut(preset: TFPreset, tex?: THREE.DataTexture): THREE.DataTexture {
  const N = 256;
  const data = tex ? (tex.image.data as Uint8Array) : new Uint8Array(N * 4);
  const pts = preset.points;
  for (let i = 0; i < N; i++) {
    const x = i / (N - 1);
    let k = 0;
    while (k < pts.length - 2 && x > pts[k + 1].x) k++;
    const a = pts[k];
    const b = pts[Math.min(k + 1, pts.length - 1)];
    const t = b.x === a.x ? 0 : Math.max(0, Math.min(1, (x - a.x) / (b.x - a.x)));
    data[i * 4 + 0] = Math.round(255 * (a.r + (b.r - a.r) * t));
    data[i * 4 + 1] = Math.round(255 * (a.g + (b.g - a.g) * t));
    data[i * 4 + 2] = Math.round(255 * (a.b + (b.b - a.b) * t));
    data[i * 4 + 3] = Math.round(255 * (a.a + (b.a - a.a) * t));
  }
  if (tex) {
    tex.needsUpdate = true;
    return tex;
  }
  const t = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

/** CPU mirror of the shader's opacity lookup (used for picking). */
export function lutAlpha(lut: THREE.DataTexture, x: number): number {
  const d = lut.image.data as Uint8Array;
  const f = Math.max(0, Math.min(1, x)) * 255;
  const i = Math.floor(f);
  const j = Math.min(255, i + 1);
  const t = f - i;
  return (d[i * 4 + 3] * (1 - t) + d[j * 4 + 3] * t) / 255;
}
