// Imperative wrapper around a single Cornerstone3D RenderingEngine.
// React components hand it DOM elements + desired state; it reconciles.

import * as cornerstone from '@cornerstonejs/core';
import * as csTools from '@cornerstonejs/tools';
import { ensureToolGroup, resolveToolName, releasePrimaryButton, claimPrimaryButton, TOOL_GROUP_ID } from './tools';
import type { LoadedSeries, ProjectionMode } from './store';

const { RenderingEngine, Enums, volumeLoader, setVolumesForViewports, getRenderingEngine } =
  cornerstone;
const { ViewportType, OrientationAxis, BlendModes } = Enums;
const { ToolGroupManager } = csTools;
const cine = (csTools.utilities as any).cine as {
  playClip: (el: HTMLElement, opts: { framesPerSecond: number }) => void;
  stopClip: (el: HTMLElement) => void;
};

export const ENGINE_ID = 'WESCAN_ENGINE';
export const MPR_VIEWPORTS = ['MPR_AXIAL', 'MPR_SAGITTAL', 'MPR_CORONAL'] as const;

const ORIENTATION: Record<(typeof MPR_VIEWPORTS)[number], unknown> = {
  MPR_AXIAL: OrientationAxis.AXIAL,
  MPR_SAGITTAL: OrientationAxis.SAGITTAL,
  MPR_CORONAL: OrientationAxis.CORONAL,
};

const BLEND: Record<ProjectionMode, unknown> = {
  none: BlendModes.COMPOSITE,
  mip: BlendModes.MAXIMUM_INTENSITY_BLEND,
  minip: BlendModes.MINIMUM_INTENSITY_BLEND,
  average: (BlendModes as any).AVERAGE_INTENSITY_BLEND ?? BlendModes.COMPOSITE,
};

function engine(): cornerstone.RenderingEngine {
  return (
    (getRenderingEngine(ENGINE_ID) as cornerstone.RenderingEngine | undefined) ??
    new RenderingEngine(ENGINE_ID)
  );
}

// DEV only: lets the console inspect the live engine (like window.__vr on the VR page)
if (import.meta.env.DEV) (window as unknown as { __cs: unknown }).__cs = {
    engine: () => getRenderingEngine(ENGINE_ID),
    group: () => ToolGroupManager.getToolGroup(TOOL_GROUP_ID),
  };

export function stackViewportId(index: number): string {
  return `STACK_${index}`;
}

/** volumeId for a series (streaming loader scheme). */
function volumeIdFor(seriesUid: string): string {
  return `cornerstoneStreamingImageVolume:${seriesUid}`;
}

// --- Stack (2D) grid --------------------------------------------------------

export interface StackCell {
  index: number;
  element: HTMLDivElement;
  series?: LoadedSeries;
}

export async function renderStackGrid(cells: StackCell[]): Promise<void> {
  const re = engine();
  const group = ensureToolGroup();

  // Tear down MPR viewports if present.
  for (const id of MPR_VIEWPORTS) {
    try {
      group.removeViewports(ENGINE_ID, id);
      re.disableElement(id);
    } catch {
      /* not enabled */
    }
  }

  const viewportInput = cells.map((c) => ({
    viewportId: stackViewportId(c.index),
    type: ViewportType.STACK,
    element: c.element,
    defaultOptions: { background: [0, 0, 0] as [number, number, number] },
  }));

  re.setViewports(viewportInput);

  for (const c of cells) {
    const vpId = stackViewportId(c.index);
    group.addViewport(vpId, ENGINE_ID);
    const vp = re.getViewport(vpId) as cornerstone.Types.IStackViewport;
    if (c.series?.imageIds.length) {
      await vp.setStack(c.series.imageIds, 0);
      try {
        (vp as any).resetCamera?.();
      } catch {
        /* ignore */
      }
      vp.render();
    }
  }
  re.render();
  // canvas often isn't at its final size on the first paint
  setTimeout(() => resizeEngine(), 50);
}

// --- MPR ------------------------------------------------------------------

export async function enterMpr(series: LoadedSeries, elements: {
  axial: HTMLDivElement;
  sagittal: HTMLDivElement;
  coronal: HTMLDivElement;
}): Promise<void> {
  const re = engine();
  const group = ensureToolGroup();

  // Disable any stack viewports.
  for (const vp of re.getViewports()) {
    if (vp.id.startsWith('STACK_')) {
      try {
        group.removeViewports(ENGINE_ID, vp.id);
        re.disableElement(vp.id);
      } catch {
        /* ignore */
      }
    }
  }

  const elMap: Record<(typeof MPR_VIEWPORTS)[number], HTMLDivElement> = {
    MPR_AXIAL: elements.axial,
    MPR_SAGITTAL: elements.sagittal,
    MPR_CORONAL: elements.coronal,
  };

  re.setViewports(
    MPR_VIEWPORTS.map((id) => ({
      viewportId: id,
      type: ViewportType.ORTHOGRAPHIC,
      element: elMap[id],
      defaultOptions: {
        orientation: ORIENTATION[id] as never,
        background: [0, 0, 0] as [number, number, number],
      },
    })) as never,
  );

  const volumeId = volumeIdFor(series.seriesInstanceUid);
  let volume = cornerstone.cache.getVolume(volumeId);
  if (!volume) {
    volume = await volumeLoader.createAndCacheVolume(volumeId, {
      imageIds: series.imageIds,
    });
  }
  (volume as { load: () => void }).load();

  await setVolumesForViewports(re, [{ volumeId }], [...MPR_VIEWPORTS]);

  for (const id of MPR_VIEWPORTS) {
    group.addViewport(id, ENGINE_ID);
  }

  // Crosshairs on primary in MPR.
  const crosshairs = resolveToolName('Crosshairs');
  if (crosshairs) {
    try {
      group.setToolActive(crosshairs, {
        bindings: [{ mouseButton: csTools.Enums.MouseBindings.Primary }],
      });
    } catch {
      /* ignore */
    }
  }

  re.renderViewports([...MPR_VIEWPORTS]);
}

export function exitMpr(): void {
  const re = getRenderingEngine(ENGINE_ID) as cornerstone.RenderingEngine | undefined;
  if (!re) return;
  const group = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
  for (const id of MPR_VIEWPORTS) {
    try {
      group?.removeViewports(ENGINE_ID, id);
      re.disableElement(id);
    } catch {
      /* ignore */
    }
  }
  const crosshairs = resolveToolName('Crosshairs');
  if (crosshairs && group) {
    try {
      group.setToolPassive(crosshairs);
    } catch {
      /* ignore */
    }
  }
}

// --- VRT (3D volume rendering) -----------------------------------------

/** First 3D viewport; further ones (compare mode) are VRT_3D_1 … */
export const VRT_VIEWPORT = 'VRT_3D';

export const vrtViewportId = (i: number): string => (i === 0 ? VRT_VIEWPORT : `${VRT_VIEWPORT}_${i}`);
const isVrtId = (id: string): boolean => id === VRT_VIEWPORT || id.startsWith(`${VRT_VIEWPORT}_`);
const vrtIds = (re: cornerstone.RenderingEngine): string[] =>
  re.getViewports().map((v) => v.id).filter(isVrtId);

export interface VrtCell {
  element: HTMLDivElement;
  series: LoadedSeries;
}

/** CT presets make an MR scan an opaque red blob — MR series fall back to an MR preset. */
export function vrtPresetFor(series: { modality?: string }, preset: string): string {
  return (series.modality ?? '').toUpperCase() === 'MR' && preset.startsWith('CT-') ? 'MR-Default' : preset;
}

type Vec3 = [number, number, number];
const sub3 = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

interface VrtView {
  /** unit vector focal point → camera */
  dir: Vec3;
  up: Vec3;
}

function readVrtView(vp: any): VrtView | null {
  try {
    const cam = vp.getCamera();
    const d = sub3(cam.position, cam.focalPoint);
    const l = len3(d);
    if (!l) return null;
    return { dir: [d[0] / l, d[1] / l, d[2] / l], up: [...cam.viewUp] as Vec3 };
  } catch {
    return null;
  }
}

/** Point `vp` along `view`, keeping its own focal point, distance (framing) and zoom. */
function applyVrtView(vp: any, view: VrtView): void {
  const cam = vp.getCamera();
  const dist = len3(sub3(cam.position, cam.focalPoint)) || 1;
  vp.setCamera({
    position: [
      cam.focalPoint[0] + view.dir[0] * dist,
      cam.focalPoint[1] + view.dir[1] * dist,
      cam.focalPoint[2] + view.dir[2] * dist,
    ],
    viewUp: view.up,
  });
}

/**
 * Zoom so the whole volume fits its cell. Cornerstone's own reset assumes a roughly square
 * viewport, which crops the volume in the wide cells of a 2×2 compare grid.
 */
function fitVrt(vp: any): void {
  try {
    const cam = vp.getCamera();
    const b = vp.getBounds?.() as number[] | undefined;
    const canvas = vp.getCanvas?.() as HTMLCanvasElement | undefined;
    if (!b || !canvas || !canvas.clientWidth || !canvas.clientHeight) return;
    const n = sub3(cam.position, cam.focalPoint);
    const ln = len3(n);
    if (!ln) return;
    const nn: Vec3 = [n[0] / ln, n[1] / ln, n[2] / ln];
    const u: Vec3 = cam.viewUp;
    const r: Vec3 = [u[1] * nn[2] - u[2] * nn[1], u[2] * nn[0] - u[0] * nn[2], u[0] * nn[1] - u[1] * nn[0]];
    // corners of the volume's own (possibly oblique) box; the axis-aligned bounds are looser
    const corners: Vec3[] = [];
    const series = vrtSeriesById.get(vp.id);
    const vol = series ? (cornerstone.cache.getVolume(volumeIdFor(series.seriesInstanceUid)) as any) : null;
    if (vol?.origin && vol.dimensions && vol.spacing && vol.direction) {
      const { origin: o, dimensions: dim, spacing: sp, direction: d } = vol;
      for (const i of [0, 1]) {
        for (const j of [0, 1]) {
          for (const k of [0, 1]) {
            const a = i * (dim[0] - 1) * sp[0];
            const c = j * (dim[1] - 1) * sp[1];
            const e = k * (dim[2] - 1) * sp[2];
            corners.push([
              o[0] + a * d[0] + c * d[3] + e * d[6],
              o[1] + a * d[1] + c * d[4] + e * d[7],
              o[2] + a * d[2] + c * d[5] + e * d[8],
            ]);
          }
        }
      }
    } else {
      for (const x of [b[0], b[1]]) for (const y of [b[2], b[3]]) for (const z of [b[4], b[5]]) corners.push([x, y, z]);
    }
    // project around the volume's centre (what the camera looks at)
    const centre: Vec3 = [0, 1, 2].map((a) => corners.reduce((t, c) => t + c[a], 0) / corners.length) as Vec3;
    let halfW = 0;
    let halfH = 0;
    for (const c of corners) {
      const d = sub3(c, centre);
      halfW = Math.max(halfW, Math.abs(d[0] * r[0] + d[1] * r[1] + d[2] * r[2]));
      halfH = Math.max(halfH, Math.abs(d[0] * u[0] + d[1] * u[1] + d[2] * u[2]));
    }
    const aspect = canvas.clientWidth / canvas.clientHeight;
    vp.setCamera({ parallelScale: Math.max(halfH, halfW / aspect) * 1.12 });
  } catch {
    /* viewport not ready */
  }
}

/** Camera sits on the named side of the patient (LPS world: +X left, +Y posterior, +Z superior). */
export type VrtViewName = 'anterior' | 'posterior' | 'left' | 'right' | 'superior' | 'inferior' | 'native';
export const VRT_VIEWS: Record<Exclude<VrtViewName, 'native'>, VrtView> = {
  anterior: { dir: [0, -1, 0], up: [0, 0, 1] },
  posterior: { dir: [0, 1, 0], up: [0, 0, 1] },
  left: { dir: [1, 0, 0], up: [0, 0, 1] },
  right: { dir: [-1, 0, 0], up: [0, 0, 1] },
  superior: { dir: [0, 0, 1], up: [0, -1, 0] },
  inferior: { dir: [0, 0, -1], up: [0, -1, 0] },
};

/**
 * The scan's own acquisition plane, as the 2D viewer shows it (rows → right, columns → down).
 * Oblique acquisitions (common for coronal MR) are shown face-on instead of as a tilted slab.
 */
function nativeVrtView(series: LoadedSeries | undefined): VrtView | null {
  const volume = series ? (cornerstone.cache.getVolume(volumeIdFor(series.seriesInstanceUid)) as any) : null;
  const d = volume?.direction as ArrayLike<number> | undefined;
  if (!d || d.length < 9) return null;
  let dir: Vec3 = [-d[6], -d[7], -d[8]];
  const up: Vec3 = [-d[3], -d[4], -d[5]];
  // look at the patient from the front for coronal-type planes
  if (Math.abs(d[7]) > 0.5 && dir[1] > 0) dir = [-dir[0], -dir[1], -dir[2]];
  return { dir, up };
}

/** Coronal-type acquisitions open face-on; everything else opens from the front. */
function defaultVrtView(series: LoadedSeries | undefined): VrtView {
  const native = nativeVrtView(series);
  const volume = series ? (cornerstone.cache.getVolume(volumeIdFor(series.seriesInstanceUid)) as any) : null;
  const coronalish = volume?.direction && Math.abs(volume.direction[7]) > 0.5;
  return coronalish && native ? native : VRT_VIEWS.anterior;
}

/** Re-aim every 3D view (keeps zoom; refits so oblique volumes stay in frame). */
export function setVrtOrientation(name: VrtViewName): void {
  const re = getRenderingEngine(ENGINE_ID) as cornerstone.RenderingEngine | undefined;
  if (!re) return;
  const first = vrtSeriesById.get(VRT_VIEWPORT);
  const view: VrtView | null = name === 'native' ? nativeVrtView(first) : VRT_VIEWS[name];
  if (!view) return;
  for (const id of vrtIds(re)) {
    const vp = re.getViewport(id) as any;
    try {
      applyVrtView(vp, view);
      vp.resetCamera?.();
      applyVrtView(vp, view);
      fitVrt(vp);
      vp.render();
    } catch {
      /* ignore */
    }
  }
}

let vrtToken = 0;
/** the current 3D views are fully set up (volumes attached, view applied) */
let vrtReady = false;
const vrtSeriesById = new Map<string, LoadedSeries>();

/**
 * Show 1–4 series as 3D volume renderings. Switching the series list keeps the current
 * viewing angle, so flipping between e.g. pre- and post-contrast phases compares like with like.
 */
export async function enterVrt(cells: VrtCell[], preset = 'CT-Bone'): Promise<void> {
  const token = ++vrtToken;
  const re = engine();
  const group = ensureToolGroup();

  // carry the viewing angle over — but only from a view that finished loading (an unfinished one still has the default camera)
  const prev = vrtReady ? re.getViewport(VRT_VIEWPORT) : undefined;
  const keep = prev ? readVrtView(prev) : null;
  vrtReady = false;

  for (const vp of re.getViewports()) {
    if (vp.id.startsWith('STACK_') || (MPR_VIEWPORTS as readonly string[]).includes(vp.id) || isVrtId(vp.id)) {
      try {
        group.removeViewports(ENGINE_ID, vp.id);
        re.disableElement(vp.id);
      } catch {
        /* ignore */
      }
    }
  }
  vrtSeriesById.clear();

  re.setViewports(
    cells.map((c, i) => ({
      viewportId: vrtViewportId(i),
      type: (ViewportType as any).VOLUME_3D,
      element: c.element,
      defaultOptions: { background: [0, 0, 0] as [number, number, number] },
    })) as never,
  );

  for (let i = 0; i < cells.length; i++) {
    const id = vrtViewportId(i);
    const { series } = cells[i];
    const volumeId = volumeIdFor(series.seriesInstanceUid);
    let volume = cornerstone.cache.getVolume(volumeId);
    if (!volume) {
      volume = await volumeLoader.createAndCacheVolume(volumeId, { imageIds: series.imageIds });
    }
    (volume as { load: () => void }).load();
    await setVolumesForViewports(re, [{ volumeId }], [id]);
    if (token !== vrtToken) return; // superseded by a newer selection

    vrtSeriesById.set(id, series);
    const vp = re.getViewport(id) as any;
    try {
      vp.setProperties({ preset: vrtPresetFor(series, preset) });
    } catch {
      /* preset name unknown for this modality — leave default */
    }
    group.addViewport(id, ENGINE_ID);
  }

  // rotate with the primary button + wheel in 3D (W/L or a measure tool must not share the button)
  releasePrimaryButton();
  for (const key of ['TrackballRotate', 'VolumeRotate']) {
    const name = resolveToolName(key);
    if (!name) continue;
    try {
      group.setToolActive(name, {
        bindings:
          key === 'TrackballRotate'
            ? [{ mouseButton: csTools.Enums.MouseBindings.Primary }]
            : [{ mouseButton: csTools.Enums.MouseBindings.Wheel }],
      });
    } catch {
      /* ignore */
    }
  }

  const view = keep ?? defaultVrtView(cells[0]?.series);
  for (const id of vrtIds(re)) {
    const vp = re.getViewport(id) as any;
    // turn to the previous angle (or the default view), then refit the framing along that direction
    vp.resetCamera?.();
    applyVrtView(vp, view);
    vp.resetCamera?.();
    fitVrt(vp);
    vp.render();
  }
  vrtReady = true;
}

export function setVrtPreset(preset: string): void {
  const re = getRenderingEngine(ENGINE_ID) as cornerstone.RenderingEngine | undefined;
  if (!re) return;
  for (const id of vrtIds(re)) {
    const vp = re.getViewport(id) as any;
    const series = vrtSeriesById.get(id);
    try {
      vp.setProperties({ preset: series ? vrtPresetFor(series, preset) : preset });
      vp.render();
    } catch {
      /* ignore */
    }
  }
}

let unlinkVrt: (() => void) | null = null;

/** Rotating one 3D view rotates all of them (each keeps its own zoom / framing). */
export function linkVrtCameras(on: boolean): void {
  unlinkVrt?.();
  unlinkVrt = null;
  const re = getRenderingEngine(ENGINE_ID) as cornerstone.RenderingEngine | undefined;
  if (!on || !re) return;
  const ids = vrtIds(re);
  if (ids.length < 2) return;

  let busy = false;
  const offs = ids.map((id) => {
    const vp = re.getViewport(id) as any;
    const el = vp.element as HTMLElement;
    const handler = () => {
      if (busy) return;
      const view = readVrtView(vp);
      if (!view) return;
      busy = true;
      try {
        for (const other of ids) {
          if (other === id) continue;
          const o = re.getViewport(other) as any;
          if (!o) continue;
          applyVrtView(o, view);
          o.render();
        }
      } finally {
        busy = false;
      }
    };
    el.addEventListener(Enums.Events.CAMERA_MODIFIED, handler);
    return () => el.removeEventListener(Enums.Events.CAMERA_MODIFIED, handler);
  });
  unlinkVrt = () => offs.forEach((off) => off());
}

let spinRaf = 0;

/** Turntable: slowly orbit every 3D view about the vertical axis. */
export function setVrtSpin(on: boolean, degPerSec = 28): void {
  cancelAnimationFrame(spinRaf);
  spinRaf = 0;
  if (!on) return;
  let last = performance.now();
  const tick = (now: number) => {
    const re = getRenderingEngine(ENGINE_ID) as cornerstone.RenderingEngine | undefined;
    if (!re) return;
    const dt = Math.min(0.5, (now - last) / 1000); // time-based, so a slow frame rate still turns at the same speed
    last = now;
    for (const id of vrtIds(re)) {
      const vp = re.getViewport(id) as any;
      try {
        const cam = vp.getVtkActiveCamera();
        cam.azimuth(degPerSec * dt);
        cam.orthogonalizeViewUp?.();
        vp.getRenderer?.()?.resetCameraClippingRange?.();
        vp.render();
      } catch {
        /* viewport gone */
      }
    }
    spinRaf = requestAnimationFrame(tick);
  };
  spinRaf = requestAnimationFrame(tick);
}

/** `restoreTool`: the left-button tool to hand back after 3D (the user's current primary tool). */
export function exitVrt(restoreTool?: string): void {
  vrtToken++; // cancel any enterVrt still loading
  vrtReady = false;
  setVrtSpin(false);
  linkVrtCameras(false);
  vrtSeriesById.clear();
  const re = getRenderingEngine(ENGINE_ID) as cornerstone.RenderingEngine | undefined;
  if (!re) return;
  const group = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
  for (const id of vrtIds(re)) {
    try {
      group?.removeViewports(ENGINE_ID, id);
      re.disableElement(id);
    } catch {
      /* ignore */
    }
  }
  for (const key of ['TrackballRotate', 'VolumeRotate']) {
    const name = resolveToolName(key);
    if (name && group) {
      try {
        group.setToolPassive(name);
      } catch {
        /* ignore */
      }
    }
  }
  if (restoreTool) claimPrimaryButton(restoreTool);
}

export function applySlab(projection: ProjectionMode, slabMm: number): void {
  const re = getRenderingEngine(ENGINE_ID) as cornerstone.RenderingEngine | undefined;
  if (!re) return;
  for (const id of MPR_VIEWPORTS) {
    const vp = re.getViewport(id) as cornerstone.Types.IVolumeViewport | undefined;
    if (!vp) continue;
    try {
      (vp as any).setBlendMode(BLEND[projection]);
      (vp as any).setSlabThickness(projection === 'none' ? 0.1 : Math.max(slabMm, 0.1));
      vp.render();
    } catch {
      /* ignore */
    }
  }
}

// --- Shared viewport ops -------------------------------------------------

export function setInvert(invert: boolean): void {
  const re = getRenderingEngine(ENGINE_ID) as cornerstone.RenderingEngine | undefined;
  re?.getViewports().forEach((vp) => {
    try {
      (vp as any).setProperties({ invert });
      vp.render();
    } catch {
      /* ignore */
    }
  });
}

export function rotate(deg: number): void {
  const re = getRenderingEngine(ENGINE_ID) as cornerstone.RenderingEngine | undefined;
  const vp = re?.getViewports().find((v) => v.id.startsWith('STACK_')) as
    | cornerstone.Types.IStackViewport
    | undefined;
  if (!vp) return;
  const cur = (vp.getViewPresentation?.() as any)?.rotation ?? 0;
  (vp as any).setViewPresentation?.({ rotation: (cur + deg) % 360 });
  vp.render();
}

export function resetActive(viewportId: string): void {
  const re = getRenderingEngine(ENGINE_ID) as cornerstone.RenderingEngine | undefined;
  const vp = re?.getViewport(viewportId);
  (vp as any)?.resetCamera?.();
  (vp as any)?.resetProperties?.();
  vp?.render();
}

// --- viewport sync (Compare layouts) ---------------------------------

const SYNC_IDS = {
  stack: 'RLQ_SYNC_STACK',
  voi: 'RLQ_SYNC_VOI',
  zoompan: 'RLQ_SYNC_ZOOMPAN',
} as const;

export function applySync(on: boolean): void {
  const re = getRenderingEngine(ENGINE_ID) as cornerstone.RenderingEngine | undefined;
  const sm = (csTools as any).SynchronizerManager;
  const sync = (csTools as any).synchronizers;
  if (!re || !sm || !sync) return;

  const stackVps = re.getViewports().filter((v) => v.id.startsWith('STACK_'));

  const destroy = () => {
    for (const id of Object.values(SYNC_IDS)) {
      try {
        sm.destroySynchronizer(id);
      } catch {
        /* not created */
      }
    }
  };
  destroy();
  if (!on || stackVps.length < 2) return;

  try {
    const s1 = sync.createStackImageSynchronizer(SYNC_IDS.stack);
    const s2 = sync.createVOISynchronizer(SYNC_IDS.voi, { syncInvertState: false });
    const s3 = sync.createZoomPanSynchronizer(SYNC_IDS.zoompan);
    for (const vp of stackVps) {
      s1?.add({ renderingEngineId: ENGINE_ID, viewportId: vp.id });
      s2?.add({ renderingEngineId: ENGINE_ID, viewportId: vp.id });
      s3?.add({ renderingEngineId: ENGINE_ID, viewportId: vp.id });
    }
  } catch {
    /* ignore */
  }
}

/** Reset zoom / pan / W-L on every live viewport. */
export function resetAll(): void {
  const re = getRenderingEngine(ENGINE_ID) as cornerstone.RenderingEngine | undefined;
  re?.getViewports().forEach((vp) => {
    try {
      (vp as any).resetCamera?.();
      (vp as any).resetProperties?.();
      vp.render();
    } catch {
      /* ignore */
    }
  });
}

export function playCine(viewportId: string, fps: number): void {
  const re = getRenderingEngine(ENGINE_ID) as cornerstone.RenderingEngine | undefined;
  const el = re?.getViewport(viewportId)?.element;
  if (el) cine.playClip(el, { framesPerSecond: fps });
}

export function stopCine(viewportId: string): void {
  const re = getRenderingEngine(ENGINE_ID) as cornerstone.RenderingEngine | undefined;
  const el = re?.getViewport(viewportId)?.element;
  if (el) cine.stopClip(el);
}

export function captureViewportPng(viewportId: string): string | null {
  const re = getRenderingEngine(ENGINE_ID) as cornerstone.RenderingEngine | undefined;
  const vp = re?.getViewport(viewportId);
  const canvas = (vp as any)?.getCanvas?.() as HTMLCanvasElement | undefined;
  return canvas ? canvas.toDataURL('image/png') : null;
}

export function getViewportCanvas(viewportId: string): HTMLCanvasElement | null {
  const re = getRenderingEngine(ENGINE_ID) as cornerstone.RenderingEngine | undefined;
  const vp = re?.getViewport(viewportId);
  return ((vp as any)?.getCanvas?.() as HTMLCanvasElement) ?? null;
}

export function resizeEngine(keepCamera = false): void {
  const re = getRenderingEngine(ENGINE_ID) as cornerstone.RenderingEngine | undefined;
  if (!re) return;
  try {
    (re as any).resize?.(true, keepCamera);
    if (!keepCamera) {
      for (const vp of re.getViewports()) {
        try {
          (vp as any).resetCamera?.();
          if (isVrtId(vp.id)) fitVrt(vp);
        } catch {
          /* ignore */
        }
      }
      re.render();
    }
  } catch {
    /* ignore */
  }
}

export function destroyEngine(): void {
  const re = getRenderingEngine(ENGINE_ID) as cornerstone.RenderingEngine | undefined;
  re?.destroy();
}
