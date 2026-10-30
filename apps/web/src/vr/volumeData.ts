// DICOM series → GPU/CPU-ready volume for the VR viewer.
//
// Pipeline:  DICOM images ──(Cornerstone streaming volume loader: all transfer
// syntaxes, sorting, HU rescale)──▶ full-res scalar volume
//            ──(box-filter resample, ≤ maxDim per axis)──▶ "sampled" volume (CPU copy
//            used for picking / HU probe / mesh extraction)
//            ──(normalise → float16)──▶ R16F 3D texture for the ray-marcher.

import * as THREE from 'three';
import * as cornerstone from '@cornerstonejs/core';
import { initCornerstone } from '../dicom/cornerstoneInit';
import { loadSeriesImageIds } from '../dicom/imageIds';
import { api } from '../api/client';

export type Vec3 = [number, number, number];
type NumArray = ArrayLike<number> & { length: number };

export interface FullVolume {
  dims: Vec3;
  spacing: Vec3;
  /** 9 numbers: i-axis, j-axis, k-axis direction cosines in LPS */
  direction: number[];
  /** LPS position (mm) of the centre of voxel (0,0,0) */
  origin: Vec3;
  data: NumArray;
  modality: string;
  invert: boolean;
  seriesDescription?: string;
  /** 'stack' = 2D images / cine shown as a virtual screen (not a real volume) */
  kind: 'volume' | 'stack';
  /** stack only: number of real frames (the volume may be padded to 2 layers) */
  frames: number;
  /** false when the series has no pixel spacing (units are then pixels) */
  calibrated: boolean;
}

export interface SampledVolume {
  dims: Vec3;
  /** mm per sampled voxel */
  spacing: Vec3;
  data: Float32Array;
}

export interface PreparedVolume {
  full: FullVolume;
  sampled: SampledVolume;
  direction: number[];
  /** LPS position (mm) of the outer corner of voxel (0,0,0) — mm-space origin */
  originEdge: Vec3;
  /** physical box size (mm) of the sampled volume along its own i/j/k axes */
  sizeMm: Vec3;
  lo: number;
  hi: number;
  /** robust display range (2nd / 99th percentile) */
  p2: number;
  p99: number;
  min: number;
  max: number;
  isCT: boolean;
  modality: string;
  seriesDescription?: string;
  /** normalised ((v-lo)/(hi-lo)) half-float voxels for the 3D texture */
  half: Uint16Array;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export type Progress = (fraction: number, label: string) => void;

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------

const inflight = new Map<string, { promise: Promise<FullVolume>; listeners: Set<Progress> }>();

/**
 * One load per series at a time (React StrictMode / double navigation must not
 * create two competing Cornerstone volumes for the same id).
 */
export interface LoadOptions {
  /** treat the series as 2D frames (virtual screen) instead of a 3D volume */
  stack?: boolean;
  modality?: string;
}

export function loadFullVolume(
  studyUid: string,
  seriesUid: string,
  onProgress?: Progress,
  opts: LoadOptions = {},
): Promise<FullVolume> {
  const key = `${studyUid}/${seriesUid}/${opts.stack ? 'stack' : 'vol'}`;
  let entry = inflight.get(key);
  if (!entry) {
    const listeners = new Set<Progress>();
    const emit: Progress = (f, l) => listeners.forEach((fn) => fn(f, l));
    const run = opts.stack
      ? loadStackOnce(studyUid, seriesUid, emit, opts.modality ?? '')
      : loadFullVolumeOnce(studyUid, seriesUid, emit);
    const promise = run.finally(() => inflight.delete(key));
    entry = { promise, listeners };
    inflight.set(key, entry);
  }
  if (onProgress) entry.listeners.add(onProgress);
  return entry.promise;
}

/**
 * 2D series (XA cine, ultrasound, X-ray, any non-volumetric stack) → a very thin
 * "volume" whose slice plane is the image, so the VR viewer can show it as a
 * virtual screen with scrolling / cine / window-level.
 */
async function loadStackOnce(
  studyUid: string,
  seriesUid: string,
  onProgress: Progress | undefined,
  modality: string,
): Promise<FullVolume> {
  await initCornerstone();
  const mode = await api.getMode();
  onProgress?.(0.02, 'Listing images…');
  const { imageIds } = await loadSeriesImageIds(mode, studyUid, seriesUid);
  if (!imageIds.length) throw new Error('This series has no images.');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const first: any = await cornerstone.imageLoader.loadAndCacheImage(imageIds[0]);
  const cols: number = first.columns;
  const rows: number = first.rows;
  const nImg = imageIds.length;
  const nz = Math.max(2, nImg);
  let step = 1;
  while ((cols / step) * (rows / step) * nz > 60_000_000) step++;
  const ox = Math.ceil(cols / step);
  const oy = Math.ceil(rows / step);
  const data = new Float32Array(ox * oy * nz);

  const psx = Number(first.columnPixelSpacing);
  const psy = Number(first.rowPixelSpacing);
  const calibrated = psx > 0 && psy > 0 && Number.isFinite(psx) && Number.isFinite(psy);
  const spx = calibrated ? psx : 1;
  const spy = calibrated ? psy : 1;

  let next = 0;
  let done = 0;
  const loadOne = async (k: number) => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const img: any = k === 0 ? first : await cornerstone.imageLoader.loadAndCacheImage(imageIds[k]);
        const pd: ArrayLike<number> = img.getPixelData();
        const px = cols * rows;
        const comps = Math.max(1, Math.round(pd.length / px));
        const slope = typeof img.slope === 'number' ? img.slope : 1;
        const icpt = typeof img.intercept === 'number' ? img.intercept : 0;
        const base = k * ox * oy;
        for (let y = 0; y < oy; y++) {
          for (let x = 0; x < ox; x++) {
            const p = (y * step) * cols + x * step;
            let v: number;
            if (comps >= 3) {
              const q = p * comps;
              v = 0.299 * pd[q] + 0.587 * pd[q + 1] + 0.114 * pd[q + 2]; // colour → luminance
            } else {
              v = pd[p] * slope + icpt;
            }
            data[base + y * ox + x] = v;
          }
        }
        return;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
    throw new Error(`Frame ${k + 1}/${nImg} failed to load: ${(lastErr as Error)?.message ?? lastErr}`);
  };
  const worker = async () => {
    while (next < nImg) {
      const k = next++;
      await loadOne(k);
      done++;
      onProgress?.(0.05 + 0.6 * (done / nImg), `Downloading ${done}/${nImg} frames…`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, nImg) }, worker));
  if (nImg === 1) data.copyWithin(ox * oy, 0, ox * oy); // pad the single image to 2 identical layers

  // thin slab: image plane = (i,j); frames stacked along k (kept ~0.5 % of the width thick)
  const width = ox * spx * step;
  const zsp = Math.max(1e-4, (0.005 * width) / nz);
  return {
    dims: [ox, oy, nz],
    spacing: [spx * step, spy * step, zsp],
    // i → patient-left (screen right), j → down, k → towards the viewer
    direction: [1, 0, 0, 0, 0, -1, 0, 1, 0],
    origin: [0, 0, 0],
    data,
    modality: (modality || String(first.metadata?.Modality ?? '')).toUpperCase(),
    invert: !!first.invert,
    seriesDescription: undefined,
    kind: 'stack',
    frames: nImg,
    calibrated,
  };
}

async function loadFullVolumeOnce(
  studyUid: string,
  seriesUid: string,
  onProgress?: Progress,
): Promise<FullVolume> {
  await initCornerstone();
  const mode = await api.getMode();
  onProgress?.(0.02, 'Listing images…');
  const { imageIds } = await loadSeriesImageIds(mode, studyUid, seriesUid);
  if (imageIds.length < 8) {
    throw new Error(`This series has only ${imageIds.length} image(s) — not enough for a 3D volume.`);
  }

  // Cornerstone's volume object is used for *geometry only* (slice sorting along the
  // scan axis, spacing, orientation, origin). It is never .load()ed: pixel data is
  // pulled slice-by-slice below, which is deterministic and reports real progress.
  const volumeId = `cornerstoneStreamingImageVolume:${seriesUid}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let volume: any = cornerstone.cache.getVolume(volumeId);
  if (!volume) {
    volume = await cornerstone.volumeLoader.createAndCacheVolume(volumeId, { imageIds });
  }
  const ids: string[] = volume.imageIds;
  const [nx, ny, nz] = volume.dimensions as Vec3;
  if (ids.length !== nz) throw new Error('Slice geometry mismatch — this series is not a regular volume.');

  // very large volumes are decimated in-plane so the Float32 copy stays < ~0.5 GB
  const step = nx * ny * nz > 130_000_000 ? 2 : 1;
  const ox = Math.ceil(nx / step);
  const oy = Math.ceil(ny / step);
  const data = new Float32Array(ox * oy * nz);

  let invert = false;
  let next = 0;
  let done = 0;
  const loadOne = async (k: number) => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const img: any = await cornerstone.imageLoader.loadAndCacheImage(ids[k]);
        if (img.color) throw new Error('Colour (RGB) series cannot be shown as a 3D volume.');
        const pd: ArrayLike<number> = img.getPixelData();
        if (pd.length < nx * ny) throw new Error(`Slice ${k + 1} has an unexpected size.`);
        if (k === 0) invert = !!img.invert;
        const slope = typeof img.slope === 'number' ? img.slope : 1;
        const icpt = typeof img.intercept === 'number' ? img.intercept : 0;
        const base = k * ox * oy;
        if (step === 1) {
          for (let p = 0; p < ox * oy; p++) data[base + p] = pd[p] * slope + icpt;
        } else {
          for (let y = 0; y < oy; y++) {
            for (let x = 0; x < ox; x++) data[base + y * ox + x] = pd[y * step * nx + x * step] * slope + icpt;
          }
        }
        return;
      } catch (e) {
        lastErr = e;
        if (String((e as Error).message).includes('Colour')) throw e;
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
    throw new Error(`Slice ${k + 1}/${nz} failed to load: ${(lastErr as Error)?.message ?? lastErr}`);
  };
  const worker = async () => {
    while (next < nz) {
      const k = next++;
      await loadOne(k);
      done++;
      onProgress?.(0.05 + 0.6 * (done / nz), `Downloading ${done}/${nz} slices…`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, nz) }, worker));

  const meta = volume.metadata ?? {};
  const sp = volume.spacing as Vec3;
  return {
    dims: [ox, oy, nz],
    spacing: [sp[0] * step, sp[1] * step, sp[2]],
    direction: [...volume.direction],
    origin: [...volume.origin] as Vec3,
    data,
    modality: String(meta.Modality ?? '').toUpperCase(),
    invert: invert || String(meta.PhotometricInterpretation ?? '') === 'MONOCHROME1',
    seriesDescription: meta.SeriesDescription,
    kind: 'volume',
    frames: nz,
    calibrated: true,
  };
}

// ---------------------------------------------------------------------------
// resample (box filter)
// ---------------------------------------------------------------------------

export async function resample(
  src: { dims: Vec3; spacing: Vec3; data: NumArray },
  maxDim: number,
  onTick?: (f: number) => void,
): Promise<SampledVolume> {
  const [nx, ny, nz] = src.dims;
  const fx = Math.max(1, Math.ceil(nx / maxDim));
  const fy = Math.max(1, Math.ceil(ny / maxDim));
  const fz = Math.max(1, Math.ceil(nz / maxDim));
  const ox = Math.ceil(nx / fx);
  const oy = Math.ceil(ny / fy);
  const oz = Math.ceil(nz / fz);
  const out = new Float32Array(ox * oy * oz);
  const d = src.data;
  const plane = nx * ny;

  for (let z = 0; z < oz; z++) {
    const z0 = z * fz;
    const z1 = Math.min(nz, z0 + fz);
    for (let y = 0; y < oy; y++) {
      const y0 = y * fy;
      const y1 = Math.min(ny, y0 + fy);
      for (let x = 0; x < ox; x++) {
        const x0 = x * fx;
        const x1 = Math.min(nx, x0 + fx);
        let sum = 0;
        let n = 0;
        for (let k = z0; k < z1; k++) {
          for (let j = y0; j < y1; j++) {
            const row = k * plane + j * nx;
            for (let i = x0; i < x1; i++) {
              sum += d[row + i];
              n++;
            }
          }
        }
        out[(z * oy + y) * ox + x] = sum / n;
      }
    }
    if (z % 6 === 0) {
      onTick?.(z / oz);
      await tick();
    }
  }
  return {
    dims: [ox, oy, oz],
    spacing: [src.spacing[0] * fx, src.spacing[1] * fy, src.spacing[2] * fz],
    data: out,
  };
}

/** Second-stage downsample of an already sampled volume (for mesh extraction). */
export function resampleSampled(v: SampledVolume, maxDim: number): Promise<SampledVolume> {
  return resample(v, maxDim);
}

// ---------------------------------------------------------------------------
// prepare
// ---------------------------------------------------------------------------

export async function prepareVolume(
  full: FullVolume,
  maxDim: number,
  onProgress?: Progress,
): Promise<PreparedVolume> {
  onProgress?.(0.7, 'Resampling volume…');
  const sampled = await resample(full, maxDim, (f) => onProgress?.(0.7 + 0.15 * f, 'Resampling volume…'));

  const data = sampled.data;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (full.invert) {
    const s = min + max;
    for (let i = 0; i < data.length; i++) data[i] = s - data[i];
  }

  // percentiles from a histogram
  const BINS = 2048;
  const hist = new Uint32Array(BINS);
  const span = Math.max(1e-6, max - min);
  for (let i = 0; i < data.length; i++) {
    hist[Math.min(BINS - 1, Math.floor(((data[i] - min) / span) * BINS))]++;
  }
  const pct = (q: number) => {
    const target = q * data.length;
    let acc = 0;
    for (let b = 0; b < BINS; b++) {
      acc += hist[b];
      if (acc >= target) return min + ((b + 0.5) / BINS) * span;
    }
    return max;
  };
  const p2 = pct(0.02);
  const p99 = pct(0.99);

  const isCT = full.modality === 'CT';
  const lo = isCT ? Math.min(-1024, min) : min;
  const hi = isCT ? Math.max(3071, Math.min(max, 6000)) : max;
  const inv = 1 / Math.max(1e-6, hi - lo);

  onProgress?.(0.88, 'Building GPU texture…');
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const u = (data[i] - lo) * inv;
    half[i] = THREE.DataUtils.toHalfFloat(u < 0 ? 0 : u > 1 ? 1 : u);
    if (i % 4_000_000 === 0) await tick();
  }

  const [sx, sy, sz] = full.spacing;
  const d = full.direction;
  const originEdge: Vec3 = [
    full.origin[0] - 0.5 * (d[0] * sx + d[3] * sy + d[6] * sz),
    full.origin[1] - 0.5 * (d[1] * sx + d[4] * sy + d[7] * sz),
    full.origin[2] - 0.5 * (d[2] * sx + d[5] * sy + d[8] * sz),
  ];

  return {
    full,
    sampled,
    direction: d,
    originEdge,
    sizeMm: [
      sampled.dims[0] * sampled.spacing[0],
      sampled.dims[1] * sampled.spacing[1],
      sampled.dims[2] * sampled.spacing[2],
    ],
    lo,
    hi,
    p2,
    p99,
    min,
    max,
    isCT,
    modality: full.modality,
    seriesDescription: full.seriesDescription,
    half,
  };
}

export function makeTexture(p: PreparedVolume): THREE.Data3DTexture {
  const [nx, ny, nz] = p.sampled.dims;
  const tex = new THREE.Data3DTexture(p.half, nx, ny, nz);
  tex.format = THREE.RedFormat;
  tex.type = THREE.HalfFloatType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * mm-space (axes of the volume's own i/j/k, origin at the volume's outer corner)
 * → model space (metres, three.js axes: +x patient-left, +y superior,
 * +z anterior = towards a viewer facing the patient, centred on the volume).
 */
export function mmToModel(p: PreparedVolume): THREE.Matrix4 {
  const d = p.direction;
  const mdir = new THREE.Matrix4().set(
    d[0], d[3], d[6], p.originEdge[0],
    d[1], d[4], d[7], p.originEdge[1],
    d[2], d[5], d[8], p.originEdge[2],
    0, 0, 0, 1,
  );
  // LPS (x,y,z) → three (x, z, -y), mm → m
  const l2t = new THREE.Matrix4().set(
    0.001, 0, 0, 0,
    0, 0, 0.001, 0,
    0, -0.001, 0, 0,
    0, 0, 0, 1,
  );
  const m = new THREE.Matrix4().multiplyMatrices(l2t, mdir);
  const c = new THREE.Vector3(p.sizeMm[0] / 2, p.sizeMm[1] / 2, p.sizeMm[2] / 2).applyMatrix4(m);
  m.premultiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  return m;
}

/** Trilinear sample of the CPU volume at an mm-space point (null if outside). */
export function sampleMm(p: PreparedVolume, x: number, y: number, z: number): number | null {
  const { dims, spacing, data } = p.sampled;
  const fx = x / spacing[0] - 0.5;
  const fy = y / spacing[1] - 0.5;
  const fz = z / spacing[2] - 0.5;
  if (fx < -0.5 || fy < -0.5 || fz < -0.5 || fx > dims[0] - 0.5 || fy > dims[1] - 0.5 || fz > dims[2] - 0.5) {
    return null;
  }
  const x0 = Math.max(0, Math.min(dims[0] - 2, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(dims[1] - 2, Math.floor(fy)));
  const z0 = Math.max(0, Math.min(dims[2] - 2, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const tz = Math.max(0, Math.min(1, fz - z0));
  const nx = dims[0];
  const nxy = dims[0] * dims[1];
  const i = z0 * nxy + y0 * nx + x0;
  const c000 = data[i], c100 = data[i + 1], c010 = data[i + nx], c110 = data[i + nx + 1];
  const c001 = data[i + nxy], c101 = data[i + nxy + 1], c011 = data[i + nxy + nx], c111 = data[i + nxy + nx + 1];
  const a = c000 + (c100 - c000) * tx;
  const b = c010 + (c110 - c010) * tx;
  const c = c001 + (c101 - c001) * tx;
  const d = c011 + (c111 - c011) * tx;
  const e = a + (b - a) * ty;
  const f = c + (d - c) * ty;
  return e + (f - e) * tz;
}
