// The VR / 3D scene: ray-marched volume + iso-surface + MPR slice, WebXR session
// handling, controller & hand interaction, in-headset panel, HU probe, ruler.
//
// One class drives both the desktop preview (orbit camera, mouse probe) and the
// immersive session, so everything can be developed and tested without a headset.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import {
  makeTexture,
  mmToModel,
  resampleSampled,
  sampleMm,
  type PreparedVolume,
  type SampledVolume,
} from './volumeData';
import {
  PRESETS,
  buildLut,
  defaultPreset,
  lutAlpha,
  presetIso,
  presetWindow,
  presetsFor,
  type TFPreset,
} from './transferFunction';
import { createVolumeMaterial } from './volumeShader';
import { extractSurface } from './marchingCubes';
import { exportGLB, exportNIfTI, exportSTL, exportUSDZ } from './exporters';
import { VRPanel } from './VRPanel';

export type RenderMode = 'volume' | 'surface' | 'slice';
export type Quality = 'low' | 'medium' | 'high';
export type Axis = 0 | 1 | 2;
export const AXIS_NAMES = ['X (sagittal)', 'Y (coronal)', 'Z (axial)'] as const;
// volume i/j/k axes ≈ patient L-R / A-P / S-I for the usual axial acquisition,
// but the labels follow the *volume* axes so they stay truthful for any orientation.
const AXIS_SHORT = ['I', 'J', 'K'] as const;

export interface VRState {
  mode: RenderMode;
  presetId: string;
  center: number;
  width: number;
  density: number;
  lighting: boolean;
  mip: boolean;
  quality: Quality;
  clipOn: boolean;
  clipAxis: Axis;
  clipPos: number;
  clipFlip: boolean;
  showSlice: boolean;
  sliceAxis: Axis;
  slicePos: number;
  iso: number;
  measure: boolean;
  panelHand: 'left' | 'right';
  panelPinned: boolean;
  panelVisible: boolean;
}

export interface Measurement {
  mm: number;
}

export interface VRInfo {
  busy: string | null;
  surface: { vertices: number; triangles: number } | null;
  probe: { value: number; x: number; y: number; z: number } | null;
  measurements: Measurement[];
  pendingPoint: boolean;
  xr: 'vr' | 'ar' | null;
  hands: boolean;
  controllers: number;
  error: string | null;
}

export interface VRSnapshot {
  state: VRState;
  info: VRInfo;
  v: number;
}

const STEP_FACTOR: Record<Quality, number> = { low: 2.0, medium: 1.2, high: 0.7 };
const MESH_MAX_DIM = 160;

interface Slot {
  i: number;
  ctrl: THREE.Group;
  grip: THREE.Group;
  hand: THREE.Group;
  ray: THREE.Mesh;
  src: any | null;
  handedness: 'left' | 'right' | 'none';
  isHand: boolean;
  selecting: boolean;
  squeezing: boolean;
  grabbing: boolean;
}

export interface VROptions {
  title: string;
  subtitle?: string;
  baseName: string;
}

export class VRScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.01, 30);
  private controls: OrbitControls;
  private host: HTMLElement;
  private ro: ResizeObserver;

  private vol: PreparedVolume;
  private opts: VROptions;
  private tex: THREE.Data3DTexture;
  private lut: THREE.DataTexture;
  private material: THREE.ShaderMaterial;
  private volumeMesh: THREE.Mesh;
  private surfaceMesh: THREE.Mesh;
  private surfaceMat: THREE.MeshStandardMaterial;
  private surfaceDirty = true;
  private surfaceTimer: number | undefined;
  private meshVol: SampledVolume | null = null;

  private model = new THREE.Group();
  private mmSpace = new THREE.Group();
  private measureGroup = new THREE.Group();
  private probeDot: THREE.Mesh;
  private floor: THREE.Group;
  private homePos = new THREE.Vector3();
  private homeQuat = new THREE.Quaternion();
  private homeScale = 1;
  private maxExtentMm: number;
  private mmToModelM: THREE.Matrix4;

  private panel: VRPanel;
  private slots: Slot[] = [];
  private grabbers: Slot[] = [];
  private oneHandOffset = new THREE.Matrix4();
  private two: { mid0: THREE.Vector3; dist0: number; dir0: THREE.Vector3; pos0: THREE.Vector3; quat0: THREE.Quaternion; scale0: number } | null = null;
  private prevButtons: Record<string, boolean[]> = { left: [], right: [] };
  private prevPointerSelect = false;
  private panelPlaced = false;
  private probeSig = '';
  private probeAt = 0;

  private measurements: { a: THREE.Vector3; b: THREE.Vector3; mm: number; group: THREE.Group }[] = [];
  private pending: THREE.Vector3 | null = null;
  private pendingDot: THREE.Mesh | null = null;

  private listeners = new Set<() => void>();
  private snap: VRSnapshot;
  private _state: VRState;
  private _info: VRInfo;
  private xrSession: any = null;
  private clock = new THREE.Clock();
  private disposed = false;
  private mouse = { x: 0, y: 0, moved: false, down: false, sx: 0, sy: 0 };
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpM = new THREE.Matrix4();
  private worldClip = new THREE.Plane();

  constructor(host: HTMLElement, vol: PreparedVolume, opts: VROptions) {
    this.host = host;
    this.vol = vol;
    this.opts = opts;

    // ---- renderer ---------------------------------------------------------
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.xr.enabled = true;
    this.renderer.localClippingEnabled = true;
    this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;outline:none';
    host.appendChild(this.renderer.domElement);

    // ---- volume + lut -------------------------------------------------------
    this.tex = makeTexture(vol);
    const preset = defaultPreset(vol.isCT);
    this.lut = buildLut(preset);
    this.material = createVolumeMaterial(this.tex, this.lut, vol);

    this.mmToModelM = mmToModel(vol);
    this.mmSpace.matrixAutoUpdate = false;
    this.mmSpace.matrix.copy(this.mmToModelM);
    this.mmSpace.matrixWorldNeedsUpdate = true;

    const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
    this.volumeMesh = new THREE.Mesh(boxGeo, this.material);
    this.volumeMesh.scale.set(...vol.sizeMm);
    this.volumeMesh.frustumCulled = false;
    this.volumeMesh.renderOrder = 1;
    this.mmSpace.add(this.volumeMesh);

    this.surfaceMat = new THREE.MeshStandardMaterial({
      color: preset.surfaceColor,
      roughness: 0.55,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });
    this.surfaceMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.surfaceMat);
    this.surfaceMesh.visible = false;
    this.surfaceMesh.frustumCulled = false;
    this.mmSpace.add(this.surfaceMesh);

    this.maxExtentMm = Math.max(...vol.sizeMm);
    const dotR = this.maxExtentMm * 0.007;
    this.probeDot = new THREE.Mesh(
      new THREE.SphereGeometry(dotR, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x2dd4bf, depthTest: false, transparent: true }),
    );
    this.probeDot.renderOrder = 30;
    this.probeDot.visible = false;
    this.mmSpace.add(this.probeDot);
    this.measureGroup.renderOrder = 30;
    this.mmSpace.add(this.measureGroup);

    this.model.add(this.mmSpace);
    const fit = 0.55 / (this.maxExtentMm * 0.001);
    this.homeScale = fit;
    this.model.scale.setScalar(fit);
    this.scene.add(this.model);

    // ---- lights + floor ----------------------------------------------------
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(1, 2, 2);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.8);
    fill.position.set(-2, 0.5, -1);
    this.scene.add(fill);

    this.floor = new THREE.Group();
    const grid = new THREE.GridHelper(8, 32, 0x2a4a7a, 0x14213a);
    this.floor.add(grid);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.58, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.6 }),
    );
    ring.position.y = 0.002;
    this.floor.add(ring);
    this.floor.visible = false;
    this.scene.add(this.floor);

    // ---- panel -------------------------------------------------------------
    this.panel = new VRPanel(0.4);
    this.panel.mesh.visible = false;
    this.scene.add(this.panel.mesh);

    // ---- state ---------------------------------------------------------------
    const w = presetWindow(preset, vol);
    this._state = {
      mode: 'volume',
      presetId: preset.id,
      center: w.center,
      width: w.width,
      density: 1,
      lighting: true,
      mip: false,
      quality: 'medium',
      clipOn: false,
      clipAxis: 2,
      clipPos: 0.5,
      clipFlip: false,
      showSlice: false,
      sliceAxis: 2,
      slicePos: 0.5,
      iso: presetIso(preset, vol),
      measure: false,
      panelHand: 'left',
      panelPinned: false,
      panelVisible: true,
    };
    this._info = {
      busy: null,
      surface: null,
      probe: null,
      measurements: [],
      pendingPoint: false,
      xr: null,
      hands: false,
      controllers: 0,
      error: null,
    };
    this.snap = { state: this._state, info: this._info, v: 0 };

    // ---- desktop camera / controls ----------------------------------------
    this.camera.position.set(0.35, 0.2, 1.05);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = 8;
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    this.setupXRInput();
    this.setupMouse();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();

    this.applyAll();
    this.rebuildPanel();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // =========================================================================
  // public state API (React + panel share it)
  // =========================================================================

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snap;

  get state(): VRState {
    return this._state;
  }
  get info(): VRInfo {
    return this._info;
  }
  get presets(): TFPreset[] {
    return presetsFor(this.vol.isCT);
  }
  get volume(): PreparedVolume {
    return this.vol;
  }
  /** native-unit slider range for window/level */
  get range(): { lo: number; hi: number } {
    return { lo: this.vol.lo, hi: this.vol.hi };
  }
  get unitLabel(): string {
    return this.vol.isCT ? 'HU' : 'val';
  }

  private emit() {
    this.snap = { state: { ...this._state }, info: { ...this._info }, v: this.snap.v + 1 };
    this.listeners.forEach((l) => l());
  }

  setState(patch: Partial<VRState>) {
    const prev = this._state;
    this._state = { ...prev, ...patch };
    if (patch.mode && patch.mode !== prev.mode && patch.mode === 'surface') void this.ensureSurface();
    if (patch.iso != null && patch.iso !== prev.iso) {
      this.surfaceDirty = true;
      if (this._state.mode === 'surface') {
        window.clearTimeout(this.surfaceTimer);
        this.surfaceTimer = window.setTimeout(() => void this.ensureSurface(), 450);
      }
    }
    if (patch.panelHand || patch.panelPinned != null) this.attachPanel();
    this.applyAll();
    this.rebuildPanel();
    this.emit();
  }

  setPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    buildLut(p, this.lut);
    this.surfaceMat.color.setHex(p.surfaceColor);
    const w = presetWindow(p, this.vol);
    this.surfaceDirty = true;
    this.setState({ presetId: id, center: w.center, width: w.width, iso: presetIso(p, this.vol) });
  }

  cyclePreset() {
    const list = this.presets;
    const i = list.findIndex((p) => p.id === this._state.presetId);
    this.setPreset(list[(i + 1) % list.length].id);
  }

  private currentPreset(): TFPreset {
    return PRESETS.find((p) => p.id === this._state.presetId) ?? this.presets[0];
  }

  // =========================================================================
  // uniforms / visibility
  // =========================================================================

  private applyAll() {
    const s = this._state;
    const u = this.material.uniforms;
    const span = this.vol.hi - this.vol.lo;
    const width = Math.max(1e-3, s.width);
    u.uWinMin.value = (s.center - width / 2 - this.vol.lo) / span;
    u.uWinInv.value = span / width;
    u.uDensity.value = s.mode === 'slice' ? 0 : s.density;
    u.uMip.value = s.mip && s.mode === 'volume' ? 1 : 0;
    u.uLighting.value = s.lighting ? 1 : 0;
    const sp = this.vol.sampled.spacing;
    u.uStepMm.value = Math.min(sp[0], sp[1], sp[2]) * STEP_FACTOR[s.quality];

    const mask = (a: Axis) => new THREE.Vector3(a === 0 ? 1 : 0, a === 1 ? 1 : 0, a === 2 ? 1 : 0);
    u.uClipOn.value = s.clipOn ? 1 : 0;
    u.uClipPos.value = s.clipPos;
    u.uClipDir.value = s.clipFlip ? -1 : 1;
    u.uClipMask.value.copy(mask(s.clipAxis));
    const sliceActive = s.mode === 'slice' || (s.mode === 'volume' && s.showSlice);
    u.uSliceOn.value = sliceActive ? 1 : 0;
    u.uSlicePos.value = s.slicePos;
    u.uSliceMask.value.copy(mask(s.sliceAxis));

    this.volumeMesh.visible = s.mode !== 'surface';
    this.surfaceMesh.visible = s.mode === 'surface' && !!this._info.surface;
  }

  /** world-space clip plane for the surface mesh (mm-space plane → world) */
  private updateSurfaceClip() {
    const s = this._state;
    if (!s.clipOn) {
      this.surfaceMat.clippingPlanes = null;
      return;
    }
    const dir = s.clipFlip ? -1 : 1;
    const n = new THREE.Vector3(s.clipAxis === 0 ? 1 : 0, s.clipAxis === 1 ? 1 : 0, s.clipAxis === 2 ? 1 : 0).multiplyScalar(dir);
    const posMm = s.clipPos * this.vol.sizeMm[s.clipAxis];
    this.worldClip.set(n, -dir * posMm).applyMatrix4(this.mmSpace.matrixWorld);
    this.surfaceMat.clippingPlanes = [this.worldClip];
  }

  // =========================================================================
  // surface mesh
  // =========================================================================

  async ensureSurface(): Promise<boolean> {
    if (this._info.surface && !this.surfaceDirty) {
      this.applyAll();
      return true;
    }
    if (this._info.busy) return false;
    try {
      this._info.busy = 'Building 3D surface…';
      this._info.error = null;
      this.emit();
      this.rebuildPanel();
      if (!this.meshVol) {
        const s = this.vol.sampled;
        this.meshVol = Math.max(...s.dims) <= MESH_MAX_DIM ? s : await resampleSampled(s, MESH_MAX_DIM);
      }
      const { geometry, stats } = await extractSurface(this.meshVol, this._state.iso, (f) => {
        this._info.busy = `Building 3D surface… ${Math.round(f * 100)}%`;
        this.emit();
      });
      if (stats.triangles === 0) throw new Error('No surface at this level — change the surface level.');
      this.surfaceMesh.geometry.dispose();
      this.surfaceMesh.geometry = geometry;
      this.surfaceDirty = false;
      this._info.surface = stats;
      return true;
    } catch (e) {
      this._info.error = (e as Error).message;
      return false;
    } finally {
      this._info.busy = null;
      this.applyAll();
      this.rebuildPanel();
      this.emit();
    }
  }

  // =========================================================================
  // exports
  // =========================================================================

  private async withBusy(label: string, fn: () => Promise<void> | void) {
    this._info.busy = label;
    this._info.error = null;
    this.emit();
    await new Promise((r) => setTimeout(r, 30));
    try {
      await fn();
    } catch (e) {
      this._info.error = (e as Error).message;
    } finally {
      this._info.busy = null;
      this.emit();
    }
  }

  async exportMesh(kind: 'glb' | 'usdz' | 'stl') {
    if (!(await this.ensureSurface())) return;
    const p = this.currentPreset();
    await this.withBusy(`Exporting ${kind.toUpperCase()}…`, async () => {
      const g = this.surfaceMesh.geometry;
      if (kind === 'glb') await exportGLB(g, this.mmToModelM, p.surfaceColor, `${this.opts.baseName}-surface`);
      else if (kind === 'usdz') await exportUSDZ(g, this.mmToModelM, p.surfaceColor, `${this.opts.baseName}-surface`);
      else exportSTL(g, this.vol, `${this.opts.baseName}-surface`);
    });
  }

  async exportVolume() {
    await this.withBusy('Writing NIfTI…', () => exportNIfTI(this.vol, `${this.opts.baseName}-volume`));
  }

  capturePNG(): string | null {
    if (this.renderer.xr.isPresenting) return null;
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  // =========================================================================
  // desktop interaction (mouse probe / ruler)
  // =========================================================================

  private setupMouse() {
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      this.mouse.moved = true;
    });
    el.addEventListener('pointerdown', (e) => {
      this.mouse.down = true;
      this.mouse.sx = e.clientX;
      this.mouse.sy = e.clientY;
    });
    el.addEventListener('pointerup', (e) => {
      const click = this.mouse.down && Math.hypot(e.clientX - this.mouse.sx, e.clientY - this.mouse.sy) < 5;
      this.mouse.down = false;
      if (click && e.button === 0 && this._state.measure && !this.renderer.xr.isPresenting) {
        const hit = this.pickFromMouse();
        if (hit) this.addMeasurePoint(hit.mm);
      }
    });
    el.addEventListener('pointerleave', () => {
      if (this._info.probe && !this.renderer.xr.isPresenting) {
        this._info.probe = null;
        this.probeDot.visible = false;
        this.emit();
      }
    });
  }

  private pickFromMouse() {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(this.mouse.x, this.mouse.y), this.camera);
    return this.pick(ray.ray.origin, ray.ray.direction);
  }

  // =========================================================================
  // CPU picking  (HU probe, ruler) — mirrors what the shader shows
  // =========================================================================

  pick(originW: THREE.Vector3, dirW: THREE.Vector3): { mm: THREE.Vector3; value: number; distance: number } | null {
    this.mmSpace.updateWorldMatrix(true, false);
    const inv = this.tmpM.copy(this.mmSpace.matrixWorld).invert();
    const o = originW.clone().applyMatrix4(inv);
    const d = originW.clone().add(dirW).applyMatrix4(inv).sub(o).normalize();
    const size = this.vol.sizeMm;
    const s = this._state;

    let t0 = 0;
    let t1 = Infinity;
    for (let a = 0; a < 3; a++) {
      const oa = a === 0 ? o.x : a === 1 ? o.y : o.z;
      const da = a === 0 ? d.x : a === 1 ? d.y : d.z;
      if (Math.abs(da) < 1e-9) {
        if (oa < 0 || oa > size[a]) return null;
        continue;
      }
      const ta = (0 - oa) / da;
      const tb = (size[a] - oa) / da;
      t0 = Math.max(t0, Math.min(ta, tb));
      t1 = Math.min(t1, Math.max(ta, tb));
    }
    if (t0 >= t1) return null;

    const comp = (v: THREE.Vector3, a: number) => (a === 0 ? v.x : a === 1 ? v.y : v.z);

    // clip half-space
    if (s.clipOn && s.mode !== 'slice') {
      const dir = s.clipFlip ? -1 : 1;
      const posMm = s.clipPos * size[s.clipAxis];
      const a0 = (comp(o, s.clipAxis) - posMm) * dir;
      const b = comp(d, s.clipAxis) * dir;
      if (Math.abs(b) < 1e-9) {
        if (a0 < 0) return null;
      } else {
        const tc = -a0 / b;
        if (b > 0) t0 = Math.max(t0, tc);
        else t1 = Math.min(t1, tc);
      }
      if (t0 >= t1) return null;
    }

    // slice plane crossing
    let tSlice = Infinity;
    if (s.mode === 'slice' || (s.mode === 'volume' && s.showSlice)) {
      const da = comp(d, s.sliceAxis);
      if (Math.abs(da) > 1e-9) {
        const ts = (s.slicePos * size[s.sliceAxis] - comp(o, s.sliceAxis)) / da;
        if (ts >= t0 && ts <= t1) tSlice = ts;
      }
    }

    const sp = this.vol.sampled.spacing;
    const step = Math.min(sp[0], sp[1], sp[2]) * 0.7;
    const tEnd = Math.min(t1, tSlice);
    const span = this.vol.hi - this.vol.lo;
    const width = Math.max(1e-3, s.width);
    const winMin = (s.center - width / 2 - this.vol.lo) / span;
    const winInv = span / width;
    const lutAt = (v: number) => lutAlpha(this.lut, ((v - this.vol.lo) / span - winMin) * winInv);

    if (s.mode !== 'slice') {
      let prevV: number | null = null;
      let prevT = t0;
      const maxSteps = 2500;
      let t = t0;
      for (let i = 0; i < maxSteps && t <= tEnd; i++, t += step) {
        const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
        const v = sampleMm(this.vol, x, y, z);
        if (v == null) continue;
        let hit = false;
        if (s.mode === 'surface') hit = v >= s.iso;
        else if (s.mip) hit = ((v - this.vol.lo) / span - winMin) * winInv > 0.35;
        else hit = lutAt(v) * s.density >= 0.12;
        if (hit) {
          let th = t;
          if (s.mode === 'surface' && prevV != null && prevV < s.iso && v !== prevV) {
            th = prevT + ((s.iso - prevV) / (v - prevV)) * (t - prevT);
          }
          const mm = new THREE.Vector3(o.x + d.x * th, o.y + d.y * th, o.z + d.z * th);
          const value = sampleMm(this.vol, mm.x, mm.y, mm.z) ?? v;
          return { mm, value, distance: this.worldDistance(o, mm, originW) };
        }
        prevV = v;
        prevT = t;
      }
    }
    if (tSlice !== Infinity) {
      const mm = new THREE.Vector3(o.x + d.x * tSlice, o.y + d.y * tSlice, o.z + d.z * tSlice);
      const value = sampleMm(this.vol, mm.x, mm.y, mm.z);
      if (value != null) return { mm, value, distance: this.worldDistance(o, mm, originW) };
    }
    return null;
  }

  private worldDistance(_o: THREE.Vector3, mm: THREE.Vector3, originW: THREE.Vector3): number {
    return this.tmpV2.copy(mm).applyMatrix4(this.mmSpace.matrixWorld).distanceTo(originW);
  }

  private setProbe(hit: { mm: THREE.Vector3; value: number } | null) {
    if (hit) {
      this.probeDot.position.copy(hit.mm);
      this.probeDot.visible = true;
      this._info.probe = { value: hit.value, x: hit.mm.x, y: hit.mm.y, z: hit.mm.z };
    } else {
      this.probeDot.visible = false;
      this._info.probe = null;
    }
  }

  // =========================================================================
  // ruler
  // =========================================================================

  private makeDot(p: THREE.Vector3, color: number) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(this.maxExtentMm * 0.007, 14, 10),
      new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }),
    );
    m.position.copy(p);
    m.renderOrder = 31;
    return m;
  }

  private makeLabel(text: string) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(10,16,30,0.9)';
    g.beginPath();
    if (g.roundRect) g.roundRect(4, 4, 504, 120, 28);
    else g.rect(4, 4, 504, 120);
    g.fill();
    g.strokeStyle = '#2dd4bf';
    g.lineWidth = 6;
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = '700 64px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 68);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    const h = this.maxExtentMm * 0.05;
    sp.scale.set(h * 4, h, 1);
    sp.renderOrder = 32;
    return sp;
  }

  addMeasurePoint(mm: THREE.Vector3) {
    if (!this.pending) {
      this.pending = mm.clone();
      this.pendingDot = this.makeDot(mm, 0xfacc15);
      this.mmSpace.add(this.pendingDot);
    } else {
      const a = this.pending;
      const b = mm.clone();
      this.mmSpace.remove(this.pendingDot!);
      this.pendingDot = null;
      this.pending = null;
      const len = a.distanceTo(b);
      const g = new THREE.Group();
      g.add(this.makeDot(a, 0xfacc15), this.makeDot(b, 0xfacc15));
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(this.maxExtentMm * 0.0025, this.maxExtentMm * 0.0025, 1, 8),
        new THREE.MeshBasicMaterial({ color: 0xfacc15, depthTest: false, transparent: true }),
      );
      seg.position.copy(a).add(b).multiplyScalar(0.5);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      seg.scale.y = len;
      seg.renderOrder = 31;
      g.add(seg);
      const label = this.makeLabel(`${len.toFixed(1)} mm`);
      label.position.copy(a).add(b).multiplyScalar(0.5);
      label.position.y += this.maxExtentMm * 0.04;
      g.add(label);
      this.measureGroup.add(g);
      this.measurements.push({ a, b, mm: len, group: g });
      this._info.measurements = this.measurements.map((m) => ({ mm: m.mm }));
    }
    this._info.pendingPoint = !!this.pending;
    this.rebuildPanel();
    this.emit();
  }

  clearMeasurements() {
    for (const m of this.measurements) {
      this.measureGroup.remove(m.group);
      m.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const mat = mesh.material as THREE.Material | undefined;
        (mat as THREE.SpriteMaterial | undefined)?.map?.dispose?.();
        mat?.dispose?.();
      });
    }
    this.measurements = [];
    if (this.pendingDot) {
      this.mmSpace.remove(this.pendingDot);
      this.pendingDot = null;
    }
    this.pending = null;
    this._info.measurements = [];
    this._info.pendingPoint = false;
    this.rebuildPanel();
    this.emit();
  }

  // =========================================================================
  // view
  // =========================================================================

  resetView() {
    if (this.renderer.xr.isPresenting) {
      this.model.position.copy(this.homePos);
      this.model.quaternion.copy(this.homeQuat);
      this.model.scale.setScalar(this.homeScale);
    } else {
      this.model.position.set(0, 0, 0);
      this.model.quaternion.identity();
      this.model.scale.setScalar(this.homeScale);
      this.camera.position.set(0.35, 0.2, 1.05);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
  }

  private resize() {
    if (this.renderer.xr.isPresenting) return;
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // =========================================================================
  // WebXR
  // =========================================================================

  async enterXR(kind: 'vr' | 'ar') {
    const xr = (navigator as any).xr;
    if (!xr) throw new Error('WebXR is not available in this browser.');
    const mode = kind === 'vr' ? 'immersive-vr' : 'immersive-ar';
    const session = await xr.requestSession(mode, {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
    });
    const floor = !session.enabledFeatures || session.enabledFeatures.includes('local-floor');
    this.renderer.xr.setReferenceSpaceType(floor ? 'local-floor' : 'local');
    this.renderer.xr.setFramebufferScaleFactor(0.8);
    await this.renderer.xr.setSession(session);
    this.xrSession = session;

    this.scene.background = kind === 'vr' ? new THREE.Color(0x05070d) : null;
    this.floor.visible = kind === 'vr' && floor;
    this.homePos.set(0, floor ? 1.25 : 0, -0.8);
    this.homeQuat.identity();
    this.model.position.copy(this.homePos);
    this.model.quaternion.copy(this.homeQuat);
    this.model.scale.setScalar(this.homeScale);
    this.controls.enabled = false;
    this._info.xr = kind;
    // headsets: start light; the user can raise quality from the panel
    this._state = { ...this._state, quality: 'low', panelVisible: true };
    this.applyAll();
    this.attachPanel();
    this.rebuildPanel();
    this.emit();

    session.addEventListener('end', () => this.onXREnd());
  }

  async exitXR() {
    try {
      await this.xrSession?.end();
    } catch {
      /* already ended */
    }
  }

  private onXREnd() {
    this.xrSession = null;
    this._info.xr = null;
    this._info.hands = false;
    this._info.controllers = 0;
    this.scene.background = null;
    this.floor.visible = false;
    this.panel.mesh.visible = false;
    this.controls.enabled = true;
    this.grabbers = [];
    this.two = null;
    this.slots.forEach((s) => {
      s.grabbing = false;
      s.selecting = false;
      s.squeezing = false;
    });
    this.resetView();
    this.resize();
    this.emit();
  }

  // ---- controllers / hands --------------------------------------------------

  private setupXRInput() {
    const modelFactory = new XRControllerModelFactory();
    const handFactory = new XRHandModelFactory();

    const rayGeo = new THREE.CylinderGeometry(0.0012, 0.0012, 1, 6).translate(0, 0.5, 0).rotateX(-Math.PI / 2);
    for (let i = 0; i < 2; i++) {
      const ctrl = this.renderer.xr.getController(i);
      const grip = this.renderer.xr.getControllerGrip(i);
      const hand = this.renderer.xr.getHand(i);
      try {
        grip.add(modelFactory.createControllerModel(grip));
        hand.add(handFactory.createHandModel(hand, 'mesh'));
      } catch {
        /* offline: input still works, just no 3D controller model */
      }
      const ray = new THREE.Mesh(rayGeo, new THREE.MeshBasicMaterial({ color: 0x66b2ff, transparent: true, opacity: 0.85, depthTest: false }));
      ray.renderOrder = 40;
      ray.scale.z = 0.4;
      ctrl.add(ray);
      this.scene.add(ctrl, grip, hand);

      const slot: Slot = { i, ctrl, grip, hand, ray, src: null, handedness: 'none', isHand: false, selecting: false, squeezing: false, grabbing: false };
      this.slots.push(slot);

      ctrl.addEventListener('connected', (e: any) => {
        slot.src = e.data;
        slot.handedness = e.data?.handedness ?? 'none';
        slot.isHand = !!e.data?.hand;
        ray.visible = true;
        this.afterInputChange();
      });
      ctrl.addEventListener('disconnected', () => {
        this.stopGrab(slot);
        slot.src = null;
        slot.handedness = 'none';
        slot.isHand = false;
        slot.selecting = false;
        slot.squeezing = false;
        ray.visible = false;
        this.afterInputChange();
      });
      ctrl.addEventListener('squeezestart', () => {
        slot.squeezing = true;
        if (!slot.isHand) this.startGrab(slot);
      });
      ctrl.addEventListener('squeezeend', () => {
        slot.squeezing = false;
        this.stopGrab(slot);
      });
      ctrl.addEventListener('selectstart', () => {
        slot.selecting = true;
        // hands pinch to grab (unless the ruler is active or the ray is on the panel)
        if (slot.isHand && !this._state.measure && !this.rayOnPanel(slot)) this.startGrab(slot);
      });
      ctrl.addEventListener('selectend', () => {
        slot.selecting = false;
        if (slot.isHand) this.stopGrab(slot);
      });
    }
  }

  private afterInputChange() {
    const live = this.slots.filter((s) => s.src);
    this._info.controllers = live.length;
    this._info.hands = live.some((s) => s.isHand);
    this.attachPanel();
    this.rebuildPanel();
    this.emit();
  }

  private panelHost(): Slot | null {
    const want = this._state.panelHand;
    return this.slots.find((s) => s.src && !s.isHand && s.handedness === want) ?? null;
  }

  private pointerSlot(): Slot | null {
    const host = this.panelHost();
    const live = this.slots.filter((s) => s.src);
    return live.find((s) => s !== host) ?? (host ? null : live[0] ?? null);
  }

  private attachPanel() {
    const mesh = this.panel.mesh;
    mesh.visible = !!this._info.xr && this._state.panelVisible;
    const host = this.panelHost();
    const wantWorld = this._state.panelPinned || !host;
    if (wantWorld) {
      if (mesh.parent && mesh.parent !== this.scene) {
        this.scene.attach(mesh); // keep where it is (pin / controller lost)
        this.panelPlaced = true;
      } else if (!this.panelPlaced) {
        // first placement: front-left of the user, tilted towards them
        mesh.position.set(-0.62, this.homePos.y - 0.12, -0.5);
        mesh.lookAt(0, this.homePos.y + 0.2, 0);
        this.panelPlaced = true;
      }
    } else if (host && mesh.parent !== host.grip) {
      host.grip.add(mesh);
      mesh.position.set(0, 0.2, -0.04);
      mesh.rotation.set(-Math.PI / 2.9, 0, 0);
      mesh.scale.setScalar(1);
    }
  }

  // ---- grab / scale ------------------------------------------------------------

  private startGrab(slot: Slot) {
    if (!this.renderer.xr.isPresenting || this.grabbers.includes(slot)) return;
    slot.grabbing = true;
    this.grabbers.push(slot);
    this.reinitGrab();
  }

  private stopGrab(slot: Slot) {
    const i = this.grabbers.indexOf(slot);
    if (i < 0) return;
    slot.grabbing = false;
    this.grabbers.splice(i, 1);
    this.reinitGrab();
  }

  private reinitGrab() {
    this.model.updateMatrixWorld(true);
    this.two = null;
    if (this.grabbers.length === 1) {
      const c = this.grabbers[0].ctrl;
      c.updateMatrixWorld(true);
      this.oneHandOffset.copy(c.matrixWorld).invert().multiply(this.model.matrixWorld);
    } else if (this.grabbers.length >= 2) {
      const a = this.grabbers[0].ctrl.getWorldPosition(new THREE.Vector3());
      const b = this.grabbers[1].ctrl.getWorldPosition(new THREE.Vector3());
      this.two = {
        mid0: a.clone().add(b).multiplyScalar(0.5),
        dist0: Math.max(0.02, a.distanceTo(b)),
        dir0: b.clone().sub(a).normalize(),
        pos0: this.model.position.clone(),
        quat0: this.model.quaternion.clone(),
        scale0: this.model.scale.x,
      };
    }
  }

  private updateGrab() {
    if (this.grabbers.length === 1) {
      const c = this.grabbers[0].ctrl;
      c.updateMatrixWorld(true);
      this.tmpM.copy(c.matrixWorld).multiply(this.oneHandOffset);
      this.tmpM.decompose(this.model.position, this.model.quaternion, this.tmpV);
      this.model.scale.setScalar(this.tmpV.x);
    } else if (this.grabbers.length >= 2 && this.two) {
      const a = this.grabbers[0].ctrl.getWorldPosition(new THREE.Vector3());
      const b = this.grabbers[1].ctrl.getWorldPosition(new THREE.Vector3());
      const t = this.two;
      const dist = Math.max(0.02, a.distanceTo(b));
      const ratio = THREE.MathUtils.clamp(dist / t.dist0, 0.05, 40);
      const dir = b.clone().sub(a).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(t.dir0, dir);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      this.model.quaternion.copy(q).multiply(t.quat0);
      this.model.position.copy(t.pos0).sub(t.mid0).multiplyScalar(ratio).applyQuaternion(q).add(mid);
      this.model.scale.setScalar(t.scale0 * ratio);
    }
  }

  // ---- pointer on panel / volume ------------------------------------------------

  private rayOf(slot: Slot) {
    slot.ctrl.updateMatrixWorld(true);
    const origin = new THREE.Vector3().setFromMatrixPosition(slot.ctrl.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(slot.ctrl.matrixWorld);
    return { origin, dir };
  }

  private panelHit(slot: Slot): { uv: THREE.Vector2; inside: boolean; distance: number } | null {
    const mesh = this.panel.mesh;
    if (!mesh.visible) return null;
    mesh.updateWorldMatrix(true, false);
    const { origin, dir } = this.rayOf(slot);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
    const center = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
    const denom = normal.dot(dir);
    if (Math.abs(denom) < 1e-5) return null;
    const t = normal.dot(center.clone().sub(origin)) / denom;
    if (t < 0 || t > 4) return null;
    const p = origin.clone().addScaledVector(dir, t);
    const local = mesh.worldToLocal(p.clone());
    const uv = new THREE.Vector2(local.x / this.panel.widthM + 0.5, local.y / this.panel.heightM + 0.5);
    const inside = Math.abs(local.x) <= this.panel.widthM / 2 + 0.01 && Math.abs(local.y) <= this.panel.heightM / 2 + 0.01;
    return { uv, inside, distance: t };
  }

  private rayOnPanel(slot: Slot): boolean {
    const h = this.panelHit(slot);
    return !!h && h.inside;
  }

  private haptic(slot: Slot | null) {
    try {
      slot?.src?.gamepad?.hapticActuators?.[0]?.pulse?.(0.35, 35);
    } catch {
      /* no haptics */
    }
  }

  private updatePointer() {
    const slot = this.pointerSlot();
    this.slots.forEach((s) => {
      s.ray.visible = s === slot;
    });
    if (!slot) {
      this.panel.update(null, false);
      return;
    }
    const hit = this.panelHit(slot);
    const onPanel = !!hit && hit.inside;
    const owns = onPanel || this.panel.dragging;
    this.panel.onFeedback = () => this.haptic(slot);
    this.panel.update(hit && owns ? hit.uv : null, slot.selecting && owns);

    let rayLen = 0.45;
    let probe: { mm: THREE.Vector3; value: number } | null = null;
    if (onPanel && hit) {
      rayLen = hit.distance;
    } else {
      const { origin, dir } = this.rayOf(slot);
      const pk = this.pick(origin, dir);
      probe = pk;
      if (pk) rayLen = Math.min(3, pk.distance);
      const rising = slot.selecting && !this.prevPointerSelect;
      if (rising && pk && this._state.measure && !this.panel.dragging) {
        this.addMeasurePoint(pk.mm);
        this.haptic(slot);
      }
    }
    this.setProbe(probe);
    this.prevPointerSelect = slot.selecting;
    slot.ray.scale.z = Math.max(0.05, rayLen);

    // keep the panel's probe read-out fresh (≈8 Hz)
    const sig = probe ? `${probe.value.toFixed(0)}|${probe.mm.x.toFixed(0)}|${probe.mm.y.toFixed(0)}|${probe.mm.z.toFixed(0)}` : '';
    const now = performance.now();
    if (sig !== this.probeSig && now - this.probeAt > 120) {
      this.probeSig = sig;
      this.probeAt = now;
      this.rebuildPanel();
      this.emit();
    }
  }

  // ---- gamepad sticks / buttons ---------------------------------------------------

  private pollGamepads(dt: number) {
    const session = this.renderer.xr.getSession() as any;
    if (!session) return;
    const dz = (v: number) => (Math.abs(v) < 0.2 ? 0 : v);
    let changed = false;
    for (const src of session.inputSources as any[]) {
      const gp = src.gamepad as Gamepad | undefined;
      if (!gp || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
      const ax = gp.axes;
      const sx = dz(ax.length >= 4 ? ax[2] : ax[0] ?? 0);
      const sy = dz(ax.length >= 4 ? ax[3] : ax[1] ?? 0);
      const s = this._state;
      if (src.handedness === 'left') {
        if (sy) {
          const k = THREE.MathUtils.clamp((s.mode === 'slice' || s.showSlice ? s.slicePos : s.clipPos) - sy * dt * 0.35, 0, 1);
          if (s.mode === 'slice' || s.showSlice) this._state = { ...s, slicePos: k };
          else this._state = { ...s, clipOn: true, clipPos: k };
          changed = true;
        }
        if (sx) {
          this._state = { ...this._state, density: THREE.MathUtils.clamp(this._state.density + sx * dt * 1.2, 0.1, 4) };
          changed = true;
        }
      } else {
        if (sx) {
          const w = THREE.MathUtils.clamp(s.width * Math.exp(sx * dt * 1.4), 1, this.vol.hi - this.vol.lo);
          this._state = { ...this._state, width: w };
          changed = true;
        }
        if (sy) {
          const c = THREE.MathUtils.clamp(s.center - sy * dt * s.width * 0.7, this.vol.lo, this.vol.hi);
          this._state = { ...this._state, center: c };
          changed = true;
        }
      }
      // face buttons (edge-triggered)
      const prev = this.prevButtons[src.handedness];
      const down = (i: number) => !!gp.buttons[i]?.pressed;
      const edge = (i: number) => down(i) && !prev[i];
      if (src.handedness === 'right') {
        if (edge(4)) this.setState({ panelVisible: !this._state.panelVisible });
        if (edge(5)) this.resetView();
      } else {
        if (edge(4)) this.setState({ measure: !this._state.measure });
        if (edge(5)) this.cyclePreset();
      }
      this.prevButtons[src.handedness] = gp.buttons.map((b) => b.pressed);
    }
    if (changed) {
      this.applyAll();
      this.rebuildPanel();
      this.emit();
    }
  }

  // =========================================================================
  // panel layout
  // =========================================================================

  private rebuildPanel() {
    const s = this._state;
    const p = this.panel;
    const u = this.unitLabel;
    const { lo, hi } = this.range;
    p.begin();
    p.title(this.opts.title, this._info.busy ?? 'RadBridge VR');

    p.column(0);
    p.header('Display');
    p.slider('Window', s.width, 1, hi - lo, (v) => `${Math.round(v)} ${u}`, (v) => this.patch({ width: v }));
    p.slider('Level', s.center, lo, hi, (v) => `${Math.round(v)} ${u}`, (v) => this.patch({ center: v }));
    p.slider('Density', s.density, 0.1, 4, (v) => v.toFixed(2), (v) => this.patch({ density: v }));
    p.slider(`Clip ${AXIS_SHORT[s.clipAxis]}${s.clipOn ? '' : ' (off)'}`, s.clipPos, 0, 1, (v) => `${Math.round(v * 100)}%`, (v) => this.patch({ clipPos: v, clipOn: true }));
    p.slider(`Slice ${AXIS_SHORT[s.sliceAxis]}`, s.slicePos, 0, 1, (v) => `${Math.round(v * 100)}%`, (v) => this.patch({ slicePos: v }));
    p.slider('Surface level', s.iso, lo, hi, (v) => `${Math.round(v)} ${u}`, (v) => this.patch({ iso: v }));
    const pr = this._info.probe;
    p.note(pr ? `Probe  ${pr.value.toFixed(this.vol.isCT ? 0 : 1)} ${u}   (${pr.x.toFixed(0)}, ${pr.y.toFixed(0)}, ${pr.z.toFixed(0)}) mm` : 'Probe  point the ray at the scan', pr ? '#2dd4bf' : '#8ea0bd');
    const ms = this._info.measurements;
    p.note(ms.length ? `Ruler  ${ms[ms.length - 1].mm.toFixed(1)} mm  (${ms.length} saved)` : this._info.pendingPoint ? 'Ruler  place the 2nd point' : s.measure ? 'Ruler  trigger to place point 1' : 'Ruler  off', '#facc15');
    p.note('Grip: grab/move · both grips: scale+rotate', '#8ea0bd', 23);
    p.note('R stick: window/level · L stick: clip/slice', '#8ea0bd', 23);
    p.note('A: panel · B: reset · X: ruler · Y: preset', '#8ea0bd', 23);

    p.column(1);
    p.header('Mode');
    p.buttons([
      { label: 'Volume', active: s.mode === 'volume', onClick: () => this.setState({ mode: 'volume' }) },
      { label: 'Surface', active: s.mode === 'surface', onClick: () => this.setState({ mode: 'surface' }) },
      { label: 'Slice', active: s.mode === 'slice', onClick: () => this.setState({ mode: 'slice' }) },
    ]);
    p.header('Preset');
    p.buttons(
      this.presets.map((pp) => ({ label: pp.label, active: pp.id === s.presetId, onClick: () => this.setPreset(pp.id) })),
      2,
    );
    p.header('Tools');
    p.buttons(
      [
        { label: 'Lighting', active: s.lighting, onClick: () => this.setState({ lighting: !s.lighting }) },
        { label: 'MIP', active: s.mip, onClick: () => this.setState({ mip: !s.mip }) },
        { label: 'Ruler', active: s.measure, onClick: () => this.setState({ measure: !s.measure }) },
        { label: s.clipOn ? `Clip ${AXIS_SHORT[s.clipAxis]}${s.clipFlip ? '−' : '+'}` : 'Clip off', active: s.clipOn, onClick: () => this.cycleClip() },
        { label: `Plane ${AXIS_SHORT[s.sliceAxis]}`, active: s.showSlice, onClick: () => this.cycleSlice() },
        { label: 'Clear ruler', onClick: () => this.clearMeasurements() },
      ],
      2,
    );
    p.header('Session');
    p.buttons(
      [
        { label: `Quality: ${s.quality}`, onClick: () => this.cycleQuality() },
        { label: 'Reset view', onClick: () => this.resetView() },
        { label: s.panelPinned ? 'Unpin panel' : 'Pin panel', active: s.panelPinned, onClick: () => this.setState({ panelPinned: !s.panelPinned }) },
        { label: 'Swap hands', onClick: () => this.setState({ panelHand: s.panelHand === 'left' ? 'right' : 'left' }) },
        { label: 'Exit VR', onClick: () => void this.exitXR() },
      ],
      2,
    );
    p.end();
  }

  /** slider drags update state without re-laying-out the panel mid-drag */
  private patch(partial: Partial<VRState>) {
    const prev = this._state;
    this._state = { ...prev, ...partial };
    if (partial.iso != null && partial.iso !== prev.iso) {
      this.surfaceDirty = true;
      if (this._state.mode === 'surface') {
        window.clearTimeout(this.surfaceTimer);
        this.surfaceTimer = window.setTimeout(() => void this.ensureSurface(), 450);
      }
    }
    this.applyAll();
    this.emit();
  }

  cycleClip() {
    const s = this._state;
    if (!s.clipOn) this.setState({ clipOn: true, clipAxis: 0, clipFlip: false });
    else if (!s.clipFlip) this.setState({ clipFlip: true });
    else if (s.clipAxis < 2) this.setState({ clipAxis: (s.clipAxis + 1) as Axis, clipFlip: false });
    else this.setState({ clipOn: false, clipAxis: 2, clipFlip: false });
  }

  cycleSlice() {
    const s = this._state;
    if (!s.showSlice) this.setState({ showSlice: true, sliceAxis: 0 });
    else if (s.sliceAxis < 2) this.setState({ sliceAxis: (s.sliceAxis + 1) as Axis });
    else this.setState({ showSlice: false, sliceAxis: 2 });
  }

  cycleQuality() {
    const order: Quality[] = ['low', 'medium', 'high'];
    this.setState({ quality: order[(order.indexOf(this._state.quality) + 1) % 3] });
  }

  // =========================================================================
  // frame loop
  // =========================================================================

  private frame() {
    if (this.disposed) return;
    const dt = Math.min(0.1, this.clock.getDelta());
    const presenting = this.renderer.xr.isPresenting;
    if (presenting) {
      this.pollGamepads(dt);
      this.updateGrab();
      this.model.updateMatrixWorld(true);
      this.updatePointer();
    } else {
      this.controls.update();
      if (this.mouse.moved && !this.mouse.down) {
        this.mouse.moved = false;
        const hit = this.pickFromMouse();
        const before = this._info.probe?.value;
        this.setProbe(hit);
        if (before !== this._info.probe?.value) this.emit();
      }
    }
    this.updateSurfaceClip();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    window.clearTimeout(this.surfaceTimer);
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    void this.exitXR();
    this.controls.dispose();
    this.clearMeasurements();
    this.panel.dispose();
    this.tex.dispose();
    this.lut.dispose();
    this.material.dispose();
    this.volumeMesh.geometry.dispose();
    this.surfaceMesh.geometry.dispose();
    this.surfaceMat.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.listeners.clear();
  }
}
