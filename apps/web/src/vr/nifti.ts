// Minimal NIfTI-1 reader/writer for label maps (.nii / .nii.gz), geometry-aware:
// a label map made at any resolution / orientation (TotalSegmentator, 3D Slicer,
// ITK-SNAP …) is resampled onto the volume's rendered grid through the affines.

import * as THREE from 'three';
import type { PreparedVolume, Vec3 } from './volumeData';
import { Segmentation } from './segmentation';
import { looksLikeTotalSeg, nameFor, paletteColor, type NameScheme } from './segNames';

export interface NiftiImage {
  dims: Vec3;
  pixdim: Vec3;
  data: ArrayLike<number>;
  /** voxel (i,j,k) → RAS mm, row-major 4×4 */
  toRAS: number[];
}

async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .nii.gz — unzip the file first.');
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') return bytes;
  const out = await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  return new Uint8Array(out);
}

export async function readNifti(input: ArrayBuffer): Promise<NiftiImage> {
  let buf = input;
  const head = new Uint8Array(buf, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) buf = await gunzip(buf);
  const dv = new DataView(buf);
  if (dv.getInt32(0, true) !== 348) {
    if (dv.getInt32(0, false) === 348) throw new Error('Big-endian NIfTI files are not supported.');
    throw new Error('Not a NIfTI-1 file (.nii / .nii.gz).');
  }
  const le = true;
  const nx = dv.getInt16(42, le);
  const ny = dv.getInt16(44, le);
  const nz = Math.max(1, dv.getInt16(46, le));
  const datatype = dv.getInt16(70, le);
  const dx = dv.getFloat32(80, le);
  const dy = dv.getFloat32(84, le);
  const dz = dv.getFloat32(88, le);
  const pix0 = dv.getFloat32(76, le);
  const voxOffset = dv.getFloat32(108, le) || 352;
  const qcode = dv.getInt16(252, le);
  const scode = dv.getInt16(254, le);

  const n = nx * ny * nz;
  const bytes: Record<number, number> = { 2: 1, 4: 2, 8: 4, 16: 4, 64: 8, 256: 1, 512: 2, 768: 4 };
  const bpp = bytes[datatype];
  if (!bpp) throw new Error(`Unsupported NIfTI data type ${datatype}.`);
  const raw = buf.slice(voxOffset, voxOffset + n * bpp);
  if (raw.byteLength < n * bpp) throw new Error('NIfTI file is truncated.');
  let data: ArrayLike<number>;
  switch (datatype) {
    case 2: data = new Uint8Array(raw); break;
    case 256: data = new Int8Array(raw); break;
    case 4: data = new Int16Array(raw); break;
    case 512: data = new Uint16Array(raw); break;
    case 8: data = new Int32Array(raw); break;
    case 768: data = new Uint32Array(raw); break;
    case 16: data = new Float32Array(raw); break;
    default: data = new Float64Array(raw);
  }

  let A: number[];
  if (scode > 0) {
    const row = (o: number) => [0, 4, 8, 12].map((k) => dv.getFloat32(o + k, le));
    A = [...row(280), ...row(296), ...row(312), 0, 0, 0, 1];
  } else if (qcode > 0) {
    const b = dv.getFloat32(256, le);
    const c = dv.getFloat32(260, le);
    const d = dv.getFloat32(264, le);
    const a = Math.sqrt(Math.max(0, 1 - b * b - c * c - d * d));
    const qf = pix0 < 0 ? -1 : 1;
    const R = [
      [a * a + b * b - c * c - d * d, 2 * (b * c - a * d), 2 * (b * d + a * c)],
      [2 * (b * c + a * d), a * a + c * c - b * b - d * d, 2 * (c * d - a * b)],
      [2 * (b * d - a * c), 2 * (c * d + a * b), a * a + d * d - b * b - c * c],
    ];
    const q = [dv.getFloat32(268, le), dv.getFloat32(272, le), dv.getFloat32(276, le)];
    A = [
      R[0][0] * dx, R[0][1] * dy, R[0][2] * dz * qf, q[0],
      R[1][0] * dx, R[1][1] * dy, R[1][2] * dz * qf, q[1],
      R[2][0] * dx, R[2][1] * dy, R[2][2] * dz * qf, q[2],
      0, 0, 0, 1,
    ];
  } else {
    A = [dx, 0, 0, 0, 0, dy, 0, 0, 0, 0, dz, 0, 0, 0, 0, 1];
  }
  return { dims: [nx, ny, nz], pixdim: [dx, dy, dz], data, toRAS: A };
}

const seen = new Uint8Array(256);

export interface ImportInfo {
  ids: number;
  scheme: 'generic' | 'totalseg';
  overflow: number;
  coverage: number;
}

/** Resample a label map onto the rendered grid (nearest neighbour) and fill `seg`. */
export function importLabels(
  seg: Segmentation,
  prep: PreparedVolume,
  nii: NiftiImage,
  scheme: NameScheme | 'auto',
): ImportInfo {
  const [nx, ny, nz] = prep.sampled.dims;
  const [sx, sy, sz] = prep.sampled.spacing;
  const d = prep.direction;
  const o = prep.originEdge;

  // mm-index → LPS
  const mm2lps = new THREE.Matrix4().set(
    d[0], d[3], d[6], o[0],
    d[1], d[4], d[7], o[1],
    d[2], d[5], d[8], o[2],
    0, 0, 0, 1,
  );
  const ras = new THREE.Matrix4().set(...(nii.toRAS as Parameters<THREE.Matrix4['set']>));
  const flip = new THREE.Matrix4().makeScale(-1, -1, 1); // RAS ↔ LPS
  const toLps = new THREE.Matrix4().multiplyMatrices(flip, ras);
  const comb = new THREE.Matrix4().multiplyMatrices(toLps.clone().invert(), mm2lps).elements; // column-major

  const [vx, vy, vz] = nii.dims;
  const src = nii.data;
  const L = seg.labels;
  seen.fill(0);
  let overflow = 0;
  let inside = 0;
  for (let k = 0; k < nz; k++) {
    const mz = (k + 0.5) * sz;
    for (let j = 0; j < ny; j++) {
      const my = (j + 0.5) * sy;
      for (let i = 0; i < nx; i++) {
        const mx = (i + 0.5) * sx;
        const u = comb[0] * mx + comb[4] * my + comb[8] * mz + comb[12];
        const v = comb[1] * mx + comb[5] * my + comb[9] * mz + comb[13];
        const w = comb[2] * mx + comb[6] * my + comb[10] * mz + comb[14];
        const ui = Math.round(u);
        const vi = Math.round(v);
        const wi = Math.round(w);
        if (ui < 0 || vi < 0 || wi < 0 || ui >= vx || vi >= vy || wi >= vz) continue;
        inside++;
        const val = Math.round(src[(wi * vy + vi) * vx + ui]);
        if (val <= 0) continue;
        if (val > 254) {
          overflow++;
          continue;
        }
        L[(k * ny + j) * nx + i] = val;
        seen[val] = 1;
      }
    }
  }

  const ids: number[] = [];
  for (let id = 1; id <= 254; id++) if (seen[id]) ids.push(id);
  const useScheme: NameScheme = scheme === 'auto' ? (looksLikeTotalSeg(ids) ? 'totalseg' : 'generic') : scheme;
  for (const id of ids) {
    const nm = nameFor(id, useScheme);
    seg.define(id, { name: nm.name, group: nm.group, color: paletteColor(id), visible: true, source: 'import' });
  }
  seg.recount();
  return { ids: ids.length, scheme: useScheme, overflow, coverage: inside / (nx * ny * nz) };
}


/** write the segmentation as a gzipped uint8 NIfTI-1 on the rendered grid (RAS affine) */
export async function writeLabelNifti(seg: Segmentation, prep: PreparedVolume): Promise<Uint8Array> {
  const [nx, ny, nz] = seg.dims;
  const [sx, sy, sz] = seg.spacing;
  const n = nx * ny * nz;
  const buf = new ArrayBuffer(352 + n);
  const dv = new DataView(buf);
  const le = true;
  dv.setInt32(0, 348, le);
  dv.setInt16(40, 3, le);
  dv.setInt16(42, nx, le);
  dv.setInt16(44, ny, le);
  dv.setInt16(46, nz, le);
  dv.setInt16(48, 1, le);
  dv.setInt16(50, 1, le);
  dv.setInt16(52, 1, le);
  dv.setInt16(54, 1, le);
  dv.setInt16(70, 2, le); // uint8
  dv.setInt16(72, 8, le);
  dv.setFloat32(76, 1, le);
  dv.setFloat32(80, sx, le);
  dv.setFloat32(84, sy, le);
  dv.setFloat32(88, sz, le);
  dv.setFloat32(108, 352, le);
  dv.setFloat32(112, 1, le);
  dv.setUint8(123, 2);
  const desc = 'WeScan labels';
  for (let i = 0; i < desc.length; i++) dv.setUint8(148 + i, desc.charCodeAt(i));
  dv.setInt16(254, 1, le);

  const d = prep.direction;
  const o = prep.originEdge;
  // voxel centre (i+.5,…) → LPS; then LPS → RAS (negate x,y)
  const ci = [d[0] * sx, d[1] * sx, d[2] * sx];
  const cj = [d[3] * sy, d[4] * sy, d[5] * sy];
  const ck = [d[6] * sz, d[7] * sz, d[8] * sz];
  const t = [0, 1, 2].map((a) => o[a] + 0.5 * (ci[a] + cj[a] + ck[a]));
  const sgn = [-1, -1, 1];
  [0, 1, 2].forEach((a) => {
    const row = [ci[a] * sgn[a], cj[a] * sgn[a], ck[a] * sgn[a], t[a] * sgn[a]];
    row.forEach((v, c) => dv.setFloat32(280 + a * 16 + c * 4, v, le));
  });
  dv.setUint8(344, 0x6e);
  dv.setUint8(345, 0x2b);
  dv.setUint8(346, 0x31);
  new Uint8Array(buf, 352, n).set(seg.labels);
  return gzip(new Uint8Array(buf));
}

export { gzip, gunzip };
