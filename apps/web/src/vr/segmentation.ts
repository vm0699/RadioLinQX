// Segmentation: a label volume (one id per voxel, on the same grid as the rendered
// volume) + the algorithms that fill it. Hiding a label hides its voxels in the
// volume, slice and surface views.

import type { PreparedVolume, Vec3 } from './volumeData';
import { paletteColor } from './segNames';

export const CARVE_ID = 254;

export type SegSource = 'auto' | 'region' | 'import' | 'carve';

export interface SegLabel {
  id: number;
  name: string;
  group: string;
  /** 0..1 */
  color: [number, number, number];
  visible: boolean;
  voxels: number;
  source: SegSource;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// label volume
// ---------------------------------------------------------------------------

export class Segmentation {
  readonly dims: Vec3;
  readonly spacing: Vec3;
  labels: Uint8Array;
  table = new Map<number, SegLabel>();
  selected: number | null = null;
  private undoStack: { labels: Uint8Array; table: SegLabel[]; selected: number | null }[] = [];
  private scratch: Uint8Array | null = null;

  constructor(dims: Vec3, spacing: Vec3) {
    this.dims = dims;
    this.spacing = spacing;
    this.labels = new Uint8Array(dims[0] * dims[1] * dims[2]);
  }

  get size(): number {
    return this.labels.length;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get list(): SegLabel[] {
    return [...this.table.values()].sort((a, b) => a.id - b.id);
  }
  get hasLabels(): boolean {
    return this.table.size > 0;
  }
  get hasHidden(): boolean {
    for (const l of this.table.values()) if (!l.visible && l.voxels > 0) return true;
    return false;
  }

  /** mL of a label */
  volumeMl(l: SegLabel): number {
    return (l.voxels * this.spacing[0] * this.spacing[1] * this.spacing[2]) / 1000;
  }

  clear() {
    this.labels.fill(0);
    this.table.clear();
    this.selected = null;
    this.undoStack = [];
  }

  snapshot() {
    this.undoStack.push({
      labels: this.labels.slice(),
      table: [...this.table.values()].map((l) => ({ ...l })),
      selected: this.selected,
    });
    if (this.undoStack.length > 4) this.undoStack.shift();
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.labels = prev.labels;
    this.table = new Map(prev.table.map((l) => [l.id, l]));
    this.selected = prev.selected;
    this.recount();
    return true;
  }

  recount() {
    const counts = new Uint32Array(256);
    const L = this.labels;
    for (let i = 0; i < L.length; i++) counts[L[i]]++;
    for (const l of this.table.values()) l.voxels = counts[l.id];
  }

  freeId(): number {
    for (let id = 1; id < CARVE_ID; id++) if (!this.table.has(id)) return id;
    return CARVE_ID - 1;
  }

  define(id: number, partial: Partial<SegLabel> & { name: string }): SegLabel {
    const prev = this.table.get(id);
    const l: SegLabel = {
      id,
      name: partial.name,
      group: partial.group ?? prev?.group ?? 'Segments',
      color: partial.color ?? prev?.color ?? paletteColor(id),
      visible: partial.visible ?? prev?.visible ?? true,
      voxels: partial.voxels ?? prev?.voxels ?? 0,
      source: partial.source ?? prev?.source ?? 'region',
    };
    this.table.set(id, l);
    return l;
  }

  /** assign a new label to the (still unlabeled) voxels of `mask` */
  addFromMask(
    mask: Uint8Array,
    name: string,
    opts: { source: SegSource; group?: string; visible?: boolean; /** label id whose voxels may be taken over */ steal?: number },
  ): SegLabel | null {
    const id = this.freeId();
    const steal = opts.steal ?? 0;
    let count = 0;
    const L = this.labels;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] && (L[i] === 0 || L[i] === steal)) {
        L[i] = id;
        count++;
      }
    }
    if (!count) return null;
    const label = this.define(id, { name, group: opts.group ?? 'Segments', source: opts.source, visible: opts.visible ?? true, voxels: count });
    this.recount();
    return label;
  }

  carveSphere(cx: number, cy: number, cz: number, r: number): number {
    const [nx, ny, nz] = this.dims;
    const [sx, sy, sz] = this.spacing;
    const i0 = Math.max(0, Math.floor((cx - r) / sx)), i1 = Math.min(nx - 1, Math.ceil((cx + r) / sx));
    const j0 = Math.max(0, Math.floor((cy - r) / sy)), j1 = Math.min(ny - 1, Math.ceil((cy + r) / sy));
    const k0 = Math.max(0, Math.floor((cz - r) / sz)), k1 = Math.min(nz - 1, Math.ceil((cz + r) / sz));
    const r2 = r * r;
    let changed = 0;
    const L = this.labels;
    for (let k = k0; k <= k1; k++) {
      const dz = (k + 0.5) * sz - cz;
      for (let j = j0; j <= j1; j++) {
        const dy = (j + 0.5) * sy - cy;
        const base = (k * ny + j) * nx;
        for (let i = i0; i <= i1; i++) {
          const dx = (i + 0.5) * sx - cx;
          if (dx * dx + dy * dy + dz * dz <= r2 && L[base + i] !== CARVE_ID) {
            L[base + i] = CARVE_ID;
            changed++;
          }
        }
      }
    }
    if (changed) {
      const prev = this.table.get(CARVE_ID);
      this.define(CARVE_ID, {
        name: 'Carved away',
        group: 'Edits',
        color: [0.6, 0.6, 0.65],
        visible: false,
        source: 'carve',
        voxels: (prev?.voxels ?? 0) + changed,
      });
    }
    return changed;
  }

  setVisible(id: number, v: boolean) {
    const l = this.table.get(id);
    if (l) l.visible = v;
  }

  groups(): { name: string; ids: number[]; shown: number; voxels: number }[] {
    const m = new Map<string, { name: string; ids: number[]; shown: number; voxels: number }>();
    for (const l of this.list) {
      let g = m.get(l.group);
      if (!g) m.set(l.group, (g = { name: l.group, ids: [], shown: 0, voxels: 0 }));
      g.ids.push(l.id);
      g.voxels += l.voxels;
      if (l.visible) g.shown++;
    }
    return [...m.values()];
  }

  setGroupVisible(name: string, v: boolean) {
    for (const l of this.table.values()) if (l.group === name) l.visible = v;
  }

  showAll() {
    for (const l of this.table.values()) l.visible = true;
  }

  isolate(id: number) {
    for (const l of this.table.values()) l.visible = l.id === id;
  }

  remove(id: number) {
    const L = this.labels;
    for (let i = 0; i < L.length; i++) if (L[i] === id) L[i] = 0;
    this.table.delete(id);
    if (this.selected === id) this.selected = null;
  }

  hiddenLut(): Uint8Array {
    const lut = new Uint8Array(256);
    for (const l of this.table.values()) if (!l.visible) lut[l.id] = 1;
    return lut;
  }

  /** label at a voxel (index space) */
  labelAtVoxel(i: number, j: number, k: number): number {
    const [nx, ny, nz] = this.dims;
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return 0;
    return this.labels[(k * ny + j) * nx + i];
  }

  /**
   * RG8 mask for the shader: R = hidden (0/255), G = highlighted (0/255).
   * `margin` also hides the single layer of *unlabeled* voxels touching a hidden
   * label (kills the partial-volume halo left behind by a tight segmentation).
   */
  buildMask(margin: boolean, out: Uint8Array): { hidden: boolean; highlight: boolean } {
    const [nx, ny, nz] = this.dims;
    const n = this.labels.length;
    const L = this.labels;
    const hid = this.hiddenLut();
    const sel = this.selected ?? -1;
    let anyHidden = false;
    let anySel = false;
    for (let i = 0; i < n; i++) {
      const l = L[i];
      const h = hid[l];
      out[2 * i] = h ? 255 : 0;
      const s = l === sel;
      out[2 * i + 1] = s ? 255 : 0;
      if (h) anyHidden = true;
      if (s) anySel = true;
    }
    if (margin && anyHidden) {
      if (!this.scratch || this.scratch.length !== n) this.scratch = new Uint8Array(n);
      const h = this.scratch;
      for (let i = 0; i < n; i++) h[i] = out[2 * i] ? 1 : 0;
      const nxy = nx * ny;
      for (let k = 0; k < nz; k++) {
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < nx; i++) {
            const idx = k * nxy + j * nx + i;
            if (h[idx] || L[idx] !== 0) continue;
            if (
              (i > 0 && h[idx - 1]) || (i < nx - 1 && h[idx + 1]) ||
              (j > 0 && h[idx - nx]) || (j < ny - 1 && h[idx + nx]) ||
              (k > 0 && h[idx - nxy]) || (k < nz - 1 && h[idx + nxy])
            ) {
              out[2 * idx] = 255;
            }
          }
        }
      }
    }
    return { hidden: anyHidden, highlight: anySel };
  }
}

// ---------------------------------------------------------------------------
// morphology / flood helpers (6-connectivity on a flat Uint8Array mask)
// ---------------------------------------------------------------------------

export function erode(mask: Uint8Array, dims: Vec3, outsideIs: 0 | 1): Uint8Array {
  const [nx, ny, nz] = dims;
  const nxy = nx * ny;
  const out = new Uint8Array(mask.length);
  const o = outsideIs;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = k * nxy + j * nx + i;
        if (!mask[idx]) continue;
        if (
          (i > 0 ? mask[idx - 1] : o) && (i < nx - 1 ? mask[idx + 1] : o) &&
          (j > 0 ? mask[idx - nx] : o) && (j < ny - 1 ? mask[idx + nx] : o) &&
          (k > 0 ? mask[idx - nxy] : o) && (k < nz - 1 ? mask[idx + nxy] : o)
        ) {
          out[idx] = 1;
        }
      }
    }
  }
  return out;
}

/** dilate `mask` by one voxel, but only into voxels where `limit` is set */
export function dilateWithin(mask: Uint8Array, dims: Vec3, limit: Uint8Array): Uint8Array {
  const [nx, ny, nz] = dims;
  const nxy = nx * ny;
  const out = mask.slice();
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = k * nxy + j * nx + i;
        if (mask[idx] || !limit[idx]) continue;
        if (
          (i > 0 && mask[idx - 1]) || (i < nx - 1 && mask[idx + 1]) ||
          (j > 0 && mask[idx - nx]) || (j < ny - 1 && mask[idx + nx]) ||
          (k > 0 && mask[idx - nxy]) || (k < nz - 1 && mask[idx + nxy])
        ) {
          out[idx] = 1;
        }
      }
    }
  }
  return out;
}

interface Components {
  queue: Int32Array;
  comps: { start: number; size: number }[];
}

export function components(mask: Uint8Array, dims: Vec3): Components {
  const [nx, ny, nz] = dims;
  const nxy = nx * ny;
  let fg = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) fg++;
  const queue = new Int32Array(fg);
  const vis = new Uint8Array(mask.length);
  const comps: { start: number; size: number }[] = [];
  let tail = 0;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || vis[s]) continue;
    const start = tail;
    vis[s] = 1;
    queue[tail++] = s;
    let head = start;
    while (head < tail) {
      const idx = queue[head++];
      const k = (idx / nxy) | 0;
      const rem = idx - k * nxy;
      const j = (rem / nx) | 0;
      const i = rem - j * nx;
      let m: number;
      if (i > 0 && mask[(m = idx - 1)] && !vis[m]) { vis[m] = 1; queue[tail++] = m; }
      if (i < nx - 1 && mask[(m = idx + 1)] && !vis[m]) { vis[m] = 1; queue[tail++] = m; }
      if (j > 0 && mask[(m = idx - nx)] && !vis[m]) { vis[m] = 1; queue[tail++] = m; }
      if (j < ny - 1 && mask[(m = idx + nx)] && !vis[m]) { vis[m] = 1; queue[tail++] = m; }
      if (k > 0 && mask[(m = idx - nxy)] && !vis[m]) { vis[m] = 1; queue[tail++] = m; }
      if (k < nz - 1 && mask[(m = idx + nxy)] && !vis[m]) { vis[m] = 1; queue[tail++] = m; }
    }
    comps.push({ start, size: tail - start });
  }
  return { queue, comps };
}

/** keep the `top` largest components that are at least `minVoxels` big */
export function keepLargest(mask: Uint8Array, dims: Vec3, top: number, minVoxels: number): Uint8Array {
  const { queue, comps } = components(mask, dims);
  const keep = [...comps].sort((a, b) => b.size - a.size).filter((c) => c.size >= minVoxels).slice(0, top);
  const out = new Uint8Array(mask.length);
  for (const c of keep) for (let q = c.start; q < c.start + c.size; q++) out[queue[q]] = 1;
  return out;
}

export function removeSmall(mask: Uint8Array, dims: Vec3, minVoxels: number): Uint8Array {
  const { queue, comps } = components(mask, dims);
  const out = new Uint8Array(mask.length);
  for (const c of comps) if (c.size >= minVoxels) for (let q = c.start; q < c.start + c.size; q++) out[queue[q]] = 1;
  return out;
}

// ---------------------------------------------------------------------------
// region growing (point at a structure → its connected, similar-intensity voxels)
// ---------------------------------------------------------------------------

export interface GrowResult {
  mask: Uint8Array;
  count: number;
  capped: boolean;
}

export function regionGrow(
  dims: Vec3,
  data: Float32Array,
  labels: Uint8Array,
  seed: number,
  lo: number,
  hi: number,
  maxVoxels: number,
  /** voxels carrying this label (besides unlabeled ones) may be traversed */
  passLabel = 0,
): GrowResult {
  const [nx, ny, nz] = dims;
  const nxy = nx * ny;
  const n = nxy * nz;
  const mask = new Uint8Array(n);
  const q = new Int32Array(Math.min(n, maxVoxels + 8));
  let head = 0;
  let tail = 0;
  let capped = false;
  const sv = data[seed];
  if ((labels[seed] !== 0 && labels[seed] !== passLabel) || sv < lo || sv > hi) return { mask, count: 0, capped };
  mask[seed] = 1;
  q[tail++] = seed;
  const tryAdd = (m: number) => {
    if (mask[m] || (labels[m] !== 0 && labels[m] !== passLabel)) return;
    const v = data[m];
    if (v < lo || v > hi) return;
    mask[m] = 1;
    if (tail < q.length) q[tail++] = m;
    else capped = true;
  };
  while (head < tail && !capped) {
    const idx = q[head++];
    const k = (idx / nxy) | 0;
    const rem = idx - k * nxy;
    const j = (rem / nx) | 0;
    const i = rem - j * nx;
    if (i > 0) tryAdd(idx - 1);
    if (i < nx - 1) tryAdd(idx + 1);
    if (j > 0) tryAdd(idx - nx);
    if (j < ny - 1) tryAdd(idx + nx);
    if (k > 0) tryAdd(idx - nxy);
    if (k < nz - 1) tryAdd(idx + nxy);
  }
  return { mask, count: tail, capped };
}

/**
 * Leak control by morphological opening: erode `radius` times, keep the piece that
 * contains (or is closest to) the seed, grow it back inside the original region.
 * Cuts thin bridges (vessels, partial-volume contacts) that region growing leaks through.
 */
export function openingAroundSeed(grown: GrowResult, dims: Vec3, seed: number, radius: number): GrowResult {
  if (radius <= 0 || grown.count === 0) return grown;
  let e = grown.mask;
  for (let r = 0; r < radius; r++) e = erode(e, dims, 0);
  const { queue, comps } = components(e, dims);
  if (!comps.length) return grown; // structure thinner than the opening → keep as is
  // the component containing the seed, else the largest
  let pick = comps.reduce((a, b) => (b.size > a.size ? b : a));
  for (const c of comps) {
    for (let q = c.start; q < c.start + c.size; q++) {
      if (queue[q] === seed) {
        pick = c;
        break;
      }
    }
  }
  let core: Uint8Array = new Uint8Array(grown.mask.length);
  for (let q = pick.start; q < pick.start + pick.size; q++) core[queue[q]] = 1;
  for (let r = 0; r < radius; r++) core = dilateWithin(core, dims, grown.mask);
  let count = 0;
  for (let i = 0; i < core.length; i++) if (core[i]) count++;
  return { mask: core, count, capped: grown.capped };
}

// ---------------------------------------------------------------------------
// automatic segmentation
// ---------------------------------------------------------------------------

function otsu(data: Float32Array, min: number, max: number): number {
  const BINS = 256;
  const hist = new Float64Array(BINS);
  const span = Math.max(1e-6, max - min);
  for (let i = 0; i < data.length; i += 3) {
    hist[Math.min(BINS - 1, Math.max(0, Math.floor(((data[i] - min) / span) * BINS)))]++;
  }
  let total = 0;
  let sumAll = 0;
  for (let b = 0; b < BINS; b++) {
    total += hist[b];
    sumAll += b * hist[b];
  }
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let thr = 0;
  for (let b = 0; b < BINS; b++) {
    wB += hist[b];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += b * hist[b];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = b;
    }
  }
  return min + ((thr + 1) / BINS) * span;
}

/** index of the volume axis that runs head↔feet (largest |z| component in LPS) */
function superiorAxis(direction: number[]): number {
  const z = [Math.abs(direction[2]), Math.abs(direction[5]), Math.abs(direction[8])];
  return z.indexOf(Math.max(...z));
}

/** air connected to the lateral faces of the volume (= the room, not the lungs) */
function outsideAir(air: Uint8Array, dims: Vec3, siAxis: number): Uint8Array {
  const [nx, ny, nz] = dims;
  const nxy = nx * ny;
  const out = new Uint8Array(air.length);
  const q = new Int32Array(air.length);
  let head = 0;
  let tail = 0;
  const seed = (idx: number) => {
    if (air[idx] && !out[idx]) {
      out[idx] = 1;
      q[tail++] = idx;
    }
  };
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const onI = siAxis !== 0 && (i === 0 || i === nx - 1);
        const onJ = siAxis !== 1 && (j === 0 || j === ny - 1);
        const onK = siAxis !== 2 && (k === 0 || k === nz - 1);
        if (onI || onJ || onK) seed(k * nxy + j * nx + i);
      }
    }
  }
  while (head < tail) {
    const idx = q[head++];
    const k = (idx / nxy) | 0;
    const rem = idx - k * nxy;
    const j = (rem / nx) | 0;
    const i = rem - j * nx;
    if (i > 0) seed(idx - 1);
    if (i < nx - 1) seed(idx + 1);
    if (j > 0) seed(idx - nx);
    if (j < ny - 1) seed(idx + nx);
    if (k > 0) seed(idx - nxy);
    if (k < nz - 1) seed(idx + nxy);
  }
  return out;
}

export interface AutoResult {
  kind: 'ct' | 'generic';
  labels: number;
}

/**
 * Classical, fully in-browser segmentation.
 *  CT  : skin & outer layer · fat · soft tissue/organs · lungs & airways · bone
 *  else: skin & outer layer · interior   (Otsu foreground)
 * Not organ-level — for named organs import a label map (TotalSegmentator, 3D Slicer…).
 */
export async function autoSegment(
  prep: PreparedVolume,
  seg: Segmentation,
  onProgress?: (f: number, label: string) => void,
): Promise<AutoResult> {
  const { dims, spacing, data } = prep.sampled;
  const n = data.length;
  const isCT = prep.isCT;
  seg.snapshot();
  seg.clear();
  const step = async (f: number, label: string) => {
    onProgress?.(f, label);
    await tick();
  };

  await step(0.05, 'Finding the body…');
  const thr = isCT ? -320 : otsu(data, prep.min, prep.p99);
  const air = new Uint8Array(n);
  for (let i = 0; i < n; i++) air[i] = data[i] < thr ? 1 : 0;
  const si = superiorAxis(prep.direction);
  const outside = outsideAir(air, dims, si);
  let body: Uint8Array = new Uint8Array(n);
  for (let i = 0; i < n; i++) body[i] = outside[i] ? 0 : 1;
  body = keepLargest(body, dims, 1, 100);
  let bodyCount = 0;
  for (let i = 0; i < n; i++) if (body[i]) bodyCount++;
  if (bodyCount < 1000) throw new Error('Could not find the body in this volume.');

  await step(0.35, 'Outer layer…');
  const minSp = Math.min(...spacing);
  const k = Math.max(1, Math.min(8, Math.round(6 / minSp)));
  let core: Uint8Array = body;
  for (let r = 0; r < k; r++) core = erode(core, dims, 1);

  const L = seg.labels;
  if (isCT) {
    await step(0.5, 'Lungs & airways…');
    const gas = new Uint8Array(n);
    for (let i = 0; i < n; i++) gas[i] = body[i] && air[i] ? 1 : 0;
    const lungs = keepLargest(gas, dims, 3, Math.max(2000, Math.round(bodyCount * 0.002)));

    await step(0.7, 'Bone…');
    const boneRaw = new Uint8Array(n);
    for (let i = 0; i < n; i++) boneRaw[i] = body[i] && data[i] >= 250 && !lungs[i] ? 1 : 0;
    const bone = removeSmall(boneRaw, dims, 200);

    for (let i = 0; i < n; i++) {
      if (!body[i]) continue;
      let l = 3;
      const v = data[i];
      if (v >= -190 && v <= -30) l = 2;
      if (!core[i]) l = 1;
      if (lungs[i]) l = 4;
      if (bone[i]) l = 5;
      L[i] = l;
    }
    seg.define(1, { name: 'Skin & outer layer', group: 'Body', color: [0.91, 0.71, 0.63], source: 'auto' });
    seg.define(2, { name: 'Fat', group: 'Body', color: [0.95, 0.82, 0.42], source: 'auto' });
    seg.define(3, { name: 'Soft tissue & organs', group: 'Body', color: [0.77, 0.42, 0.42], source: 'auto' });
    seg.define(4, { name: 'Lungs & airways', group: 'Body', color: [0.44, 0.66, 0.9], source: 'auto' });
    seg.define(5, { name: 'Bone', group: 'Body', color: [0.94, 0.91, 0.85], source: 'auto' });
  } else {
    await step(0.7, 'Labelling…');
    for (let i = 0; i < n; i++) {
      if (!body[i]) continue;
      L[i] = core[i] ? 2 : 1;
    }
    seg.define(1, { name: 'Skin & outer layer', group: 'Body', color: [0.91, 0.71, 0.63], source: 'auto' });
    seg.define(2, { name: 'Interior', group: 'Body', color: [0.77, 0.55, 0.55], source: 'auto' });
  }
  seg.recount();
  await step(1, 'Done');
  return { kind: isCT ? 'ct' : 'generic', labels: seg.table.size };
}
