// Iso-surface extraction (marching cubes) — turns a scan into a polygon mesh
// that any 3D / VR / AR tool understands (and that standalone headsets render
// far faster than a ray-marched volume).
//
// * indexed vertices (shared along cell edges) → ~5× smaller than a triangle soup
// * smooth per-vertex normals from the volume gradient (no mesh post-processing)
// * triangle winding is forced to agree with the gradient so faces point outwards
//   regardless of the lookup-table's own convention.

import * as THREE from 'three';
import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js';
import type { SampledVolume } from './volumeData';

const CORNER = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const EDGE_CORNERS = [
  [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7],
];
// [dx,dy,dz,axis] of the edge's lower grid point → unique key for vertex sharing
const EDGE_KEY = [
  [0, 0, 0, 0], [1, 0, 0, 1], [0, 1, 0, 0], [0, 0, 0, 1],
  [0, 0, 1, 0], [1, 0, 1, 1], [0, 1, 1, 0], [0, 0, 1, 1],
  [0, 0, 0, 2], [1, 0, 0, 2], [1, 1, 0, 2], [0, 1, 0, 2],
];

class FloatBuf {
  a = new Float32Array(1 << 18);
  n = 0;
  push(x: number, y: number, z: number) {
    if (this.n + 3 > this.a.length) {
      const b = new Float32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = x;
    this.a[this.n++] = y;
    this.a[this.n++] = z;
  }
  done() { return this.a.slice(0, this.n); }
}

class IndexBuf {
  a = new Uint32Array(1 << 18);
  n = 0;
  push(x: number, y: number, z: number) {
    if (this.n + 3 > this.a.length) {
      const b = new Uint32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = x;
    this.a[this.n++] = y;
    this.a[this.n++] = z;
  }
  done() { return this.a.slice(0, this.n); }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export interface SurfaceStats {
  vertices: number;
  triangles: number;
}

/**
 * @returns geometry in *mm space* (axes of the volume's own i/j/k, origin at the
 *          volume's outer corner) — place it under the same `mmSpace` transform
 *          as the volume box.
 */
export interface SurfaceColors {
  /** label id per voxel on the same grid as `vol` */
  labels: Uint8Array;
  /** rgb (0..1) × 256 */
  palette: Float32Array;
  /** colour for unlabeled voxels */
  fallback: [number, number, number];
}

export async function extractSurface(
  vol: SampledVolume,
  iso: number,
  onProgress?: (f: number) => void,
  colors?: SurfaceColors,
): Promise<{ geometry: THREE.BufferGeometry; stats: SurfaceStats }> {
  const [nx, ny, nz] = vol.dims;
  const [sx, sy, sz] = vol.spacing;
  const d = vol.data;
  const nxy = nx * ny;

  const edgeVert = new Int32Array(nx * ny * nz * 3).fill(-1);
  const pos = new FloatBuf();
  const nor = new FloatBuf();
  const col = colors ? new FloatBuf() : null;
  const idx = new IndexBuf();
  let vcount = 0;

  const gradAt = (i: number, j: number, k: number, out: Float64Array) => {
    const i0 = i > 0 ? i - 1 : i, i1 = i < nx - 1 ? i + 1 : i;
    const j0 = j > 0 ? j - 1 : j, j1 = j < ny - 1 ? j + 1 : j;
    const k0 = k > 0 ? k - 1 : k, k1 = k < nz - 1 ? k + 1 : k;
    const base = k * nxy + j * nx;
    out[0] = (d[base + i1] - d[base + i0]) / (Math.max(1, i1 - i0) * sx);
    out[1] = (d[k * nxy + j1 * nx + i] - d[k * nxy + j0 * nx + i]) / (Math.max(1, j1 - j0) * sy);
    out[2] = (d[k1 * nxy + j * nx + i] - d[k0 * nxy + j * nx + i]) / (Math.max(1, k1 - k0) * sz);
  };

  const g0 = new Float64Array(3);
  const g1 = new Float64Array(3);
  const vals = new Float64Array(8);

  const makeVertex = (cx: number, cy: number, cz: number, e: number): number => {
    const key = EDGE_KEY[e];
    const slot = (((cz + key[2]) * ny + (cy + key[1])) * nx + (cx + key[0])) * 3 + key[3];
    const cached = edgeVert[slot];
    if (cached >= 0) return cached;

    const [a, b] = EDGE_CORNERS[e];
    const ax = cx + CORNER[a][0], ay = cy + CORNER[a][1], az = cz + CORNER[a][2];
    const bx = cx + CORNER[b][0], by = cy + CORNER[b][1], bz = cz + CORNER[b][2];
    const va = vals[a], vb = vals[b];
    const t = Math.abs(vb - va) < 1e-12 ? 0.5 : (iso - va) / (vb - va);
    const px = (ax + (bx - ax) * t + 0.5) * sx;
    const py = (ay + (by - ay) * t + 0.5) * sy;
    const pz = (az + (bz - az) * t + 0.5) * sz;
    pos.push(px, py, pz);

    gradAt(ax, ay, az, g0);
    gradAt(bx, by, bz, g1);
    let nxv = -(g0[0] + (g1[0] - g0[0]) * t);
    let nyv = -(g0[1] + (g1[1] - g0[1]) * t);
    let nzv = -(g0[2] + (g1[2] - g0[2]) * t);
    const len = Math.hypot(nxv, nyv, nzv) || 1;
    nxv /= len; nyv /= len; nzv /= len;
    nor.push(nxv, nyv, nzv);

    if (col && colors) {
      // colour of the corner that lies inside the surface (value >= iso)
      const inA = va >= iso;
      const idxIn = inA ? (az * ny + ay) * nx + ax : (bz * ny + by) * nx + bx;
      const lab = colors.labels[idxIn];
      if (lab) col.push(colors.palette[lab * 3], colors.palette[lab * 3 + 1], colors.palette[lab * 3 + 2]);
      else col.push(colors.fallback[0], colors.fallback[1], colors.fallback[2]);
    }

    edgeVert[slot] = vcount;
    return vcount++;
  };

  const MAX_VERTS = 6_000_000;

  for (let cz = 0; cz < nz - 1; cz++) {
    for (let cy = 0; cy < ny - 1; cy++) {
      for (let cx = 0; cx < nx - 1; cx++) {
        const i = cz * nxy + cy * nx + cx;
        vals[0] = d[i];
        vals[1] = d[i + 1];
        vals[2] = d[i + nx + 1];
        vals[3] = d[i + nx];
        vals[4] = d[i + nxy];
        vals[5] = d[i + nxy + 1];
        vals[6] = d[i + nxy + nx + 1];
        vals[7] = d[i + nxy + nx];

        let cube = 0;
        for (let c = 0; c < 8; c++) if (vals[c] < iso) cube |= 1 << c;
        if (cube === 0 || cube === 255 || edgeTable[cube] === 0) continue;

        const base = cube * 16;
        for (let t = 0; triTable[base + t] !== -1; t += 3) {
          const v0 = makeVertex(cx, cy, cz, triTable[base + t]);
          const v1 = makeVertex(cx, cy, cz, triTable[base + t + 1]);
          const v2 = makeVertex(cx, cy, cz, triTable[base + t + 2]);
          if (v0 === v1 || v1 === v2 || v0 === v2) continue;

          // winding vs gradient normal
          const p = pos.a, n = nor.a;
          const ux = p[v1 * 3] - p[v0 * 3], uy = p[v1 * 3 + 1] - p[v0 * 3 + 1], uz = p[v1 * 3 + 2] - p[v0 * 3 + 2];
          const wx = p[v2 * 3] - p[v0 * 3], wy = p[v2 * 3 + 1] - p[v0 * 3 + 1], wz = p[v2 * 3 + 2] - p[v0 * 3 + 2];
          const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
          const dot =
            fx * (n[v0 * 3] + n[v1 * 3] + n[v2 * 3]) +
            fy * (n[v0 * 3 + 1] + n[v1 * 3 + 1] + n[v2 * 3 + 1]) +
            fz * (n[v0 * 3 + 2] + n[v1 * 3 + 2] + n[v2 * 3 + 2]);
          if (dot >= 0) idx.push(v0, v1, v2);
          else idx.push(v0, v2, v1);
        }
      }
    }
    if (vcount > MAX_VERTS) {
      throw new Error('Surface too dense — raise the iso level or lower the mesh resolution.');
    }
    if (cz % 6 === 0) {
      onProgress?.(cz / (nz - 1));
      await tick();
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos.done(), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor.done(), 3));
  if (col) geometry.setAttribute('color', new THREE.BufferAttribute(col.done(), 3));
  geometry.setIndex(new THREE.BufferAttribute(idx.done(), 1));
  geometry.computeBoundingSphere();
  return { geometry, stats: { vertices: vcount, triangles: idx.n / 3 } };
}
