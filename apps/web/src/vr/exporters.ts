// Conversions: scan data → formats other 3D / VR / medical tools understand.
//
//   GLB   glTF-binary mesh, metres, Y-up (Quest/Vision Pro viewers, Blender, web)
//   USDZ  Apple Quick Look / Vision Pro / iOS AR
//   STL   millimetres, patient (LPS) frame — 3D printing, CAD
//   NIfTI full-resolution voxel volume with a proper affine — 3D Slicer, ITK-SNAP, FSL

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import type { PreparedVolume } from './volumeData';

export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function exportMesh(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, color: number, name: string) {
  const g = geometry.clone();
  g.applyMatrix4(matrix);
  if (matrix.determinant() < 0) {
    // mirrored acquisition geometry → keep faces pointing outwards
    const idx = g.getIndex();
    if (idx) {
      for (let i = 0; i < idx.count; i += 3) {
        const b = idx.getX(i + 1);
        idx.setX(i + 1, idx.getX(i + 2));
        idx.setX(i + 2, b);
      }
    }
  }
  const coloured = !!g.getAttribute('color');
  const mesh = new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({
      color: coloured ? 0xffffff : color,
      vertexColors: coloured,
      roughness: 0.55,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  mesh.name = name;
  return mesh;
}

export async function exportGLB(
  geometry: THREE.BufferGeometry,
  mmToModelMatrix: THREE.Matrix4,
  color: number,
  baseName: string,
) {
  const mesh = exportMesh(geometry, mmToModelMatrix, color, baseName);
  const scene = new THREE.Scene();
  scene.add(mesh);
  const buf = await new Promise<ArrayBuffer>((resolve, reject) =>
    new GLTFExporter().parse(scene, (r) => resolve(r as ArrayBuffer), reject, { binary: true }),
  );
  download(`${baseName}.glb`, buf, 'model/gltf-binary');
  mesh.geometry.dispose();
}

export async function exportUSDZ(
  geometry: THREE.BufferGeometry,
  mmToModelMatrix: THREE.Matrix4,
  color: number,
  baseName: string,
) {
  const mesh = exportMesh(geometry, mmToModelMatrix, color, baseName);
  const scene = new THREE.Scene();
  scene.add(mesh);
  const bytes = await new USDZExporter().parseAsync(scene);
  download(`${baseName}.usdz`, bytes as unknown as BlobPart, 'model/vnd.usdz+zip');
  mesh.geometry.dispose();
}

/** STL in millimetres, patient (LPS) orientation. */
export function exportSTL(geometry: THREE.BufferGeometry, vol: PreparedVolume, baseName: string) {
  const d = vol.direction;
  const mdir = new THREE.Matrix4().set(
    d[0], d[3], d[6], vol.originEdge[0],
    d[1], d[4], d[7], vol.originEdge[1],
    d[2], d[5], d[8], vol.originEdge[2],
    0, 0, 0, 1,
  );
  const mesh = exportMesh(geometry, mdir, 0xffffff, baseName);
  const view = new STLExporter().parse(mesh, { binary: true }) as unknown as DataView;
  download(`${baseName}.stl`, view as unknown as BlobPart, 'model/stl');
  mesh.geometry.dispose();
}

/** Full-resolution NIfTI-1 (.nii). Affine is RAS+ as the format requires. */
export function exportNIfTI(vol: PreparedVolume, baseName: string) {
  const f = vol.full;
  const [nx, ny, nz] = f.dims;
  const n = nx * ny * nz;
  const src = f.data;

  let asInt16 = true;
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = src[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    if (asInt16 && (v !== (v | 0) || v < -32768 || v > 32767)) asInt16 = false;
  }
  const bytesPer = asInt16 ? 2 : 4;
  const buf = new ArrayBuffer(352 + n * bytesPer);
  const dv = new DataView(buf);
  const le = true;

  dv.setInt32(0, 348, le); // sizeof_hdr
  dv.setInt16(40, 3, le); // dim[0]
  dv.setInt16(42, nx, le);
  dv.setInt16(44, ny, le);
  dv.setInt16(46, nz, le);
  dv.setInt16(48, 1, le);
  dv.setInt16(50, 1, le);
  dv.setInt16(52, 1, le);
  dv.setInt16(54, 1, le);
  dv.setInt16(70, asInt16 ? 4 : 16, le); // datatype: int16 / float32
  dv.setInt16(72, asInt16 ? 16 : 32, le); // bitpix
  dv.setFloat32(76, 1, le); // pixdim[0] (qfac)
  dv.setFloat32(80, f.spacing[0], le);
  dv.setFloat32(84, f.spacing[1], le);
  dv.setFloat32(88, f.spacing[2], le);
  dv.setFloat32(108, 352, le); // vox_offset
  dv.setFloat32(112, 1, le); // scl_slope
  dv.setFloat32(116, 0, le); // scl_inter
  dv.setUint8(123, 2); // xyzt_units: mm
  dv.setFloat32(124, mx, le); // cal_max
  dv.setFloat32(128, mn, le); // cal_min
  const desc = `WeScan ${f.modality || ''}`.slice(0, 79);
  for (let i = 0; i < desc.length; i++) dv.setUint8(148 + i, desc.charCodeAt(i));
  dv.setInt16(252, 0, le); // qform_code
  dv.setInt16(254, 1, le); // sform_code = scanner anat

  // voxel → LPS(mm), then LPS → RAS (negate x,y)
  const d = f.direction;
  const row = (axis: number, trans: number) => [
    d[0 + axis] * f.spacing[0] * (axis < 2 ? -1 : 1),
    d[3 + axis] * f.spacing[1] * (axis < 2 ? -1 : 1),
    d[6 + axis] * f.spacing[2] * (axis < 2 ? -1 : 1),
    trans * (axis < 2 ? -1 : 1),
  ];
  const rows = [row(0, f.origin[0]), row(1, f.origin[1]), row(2, f.origin[2])];
  rows.forEach((r, ri) => r.forEach((v, ci) => dv.setFloat32(280 + ri * 16 + ci * 4, v, le)));
  // magic "n+1\0"
  dv.setUint8(344, 0x6e);
  dv.setUint8(345, 0x2b);
  dv.setUint8(346, 0x31);
  dv.setUint8(347, 0);

  if (asInt16) {
    const out = new Int16Array(buf, 352, n);
    for (let i = 0; i < n; i++) out[i] = src[i];
  } else {
    const out = new Float32Array(buf, 352, n);
    for (let i = 0; i < n; i++) out[i] = src[i];
  }
  download(`${baseName}.nii`, buf, 'application/octet-stream');
}
