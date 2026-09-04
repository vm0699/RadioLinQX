// Imperative wrapper around a single Cornerstone3D RenderingEngine.
// React components hand it DOM elements + desired state; it reconciles.

import * as cornerstone from '@cornerstonejs/core';
import * as csTools from '@cornerstonejs/tools';
import { ensureToolGroup, resolveToolName, TOOL_GROUP_ID } from './tools';
import type { LoadedSeries, ProjectionMode } from './store';

const { RenderingEngine, Enums, volumeLoader, setVolumesForViewports, getRenderingEngine } =
  cornerstone;
const { ViewportType, OrientationAxis, BlendModes } = Enums;
const { ToolGroupManager } = csTools;
const cine = (csTools.utilities as any).cine as {
  playClip: (el: HTMLElement, opts: { framesPerSecond: number }) => void;
  stopClip: (el: HTMLElement) => void;
};

export const ENGINE_ID = 'RADIOLINQ_ENGINE';
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

export const VRT_VIEWPORT = 'VRT_3D';

export async function enterVrt(
  series: LoadedSeries,
  element: HTMLDivElement,
  preset = 'CT-Bone',
): Promise<void> {
  const re = engine();
  const group = ensureToolGroup();

  for (const vp of re.getViewports()) {
    if (vp.id.startsWith('STACK_') || (MPR_VIEWPORTS as readonly string[]).includes(vp.id)) {
      try {
        group.removeViewports(ENGINE_ID, vp.id);
        re.disableElement(vp.id);
      } catch {
        /* ignore */
      }
    }
  }

  re.setViewports([
    {
      viewportId: VRT_VIEWPORT,
      type: (ViewportType as any).VOLUME_3D,
      element,
      defaultOptions: { background: [0, 0, 0] as [number, number, number] },
    },
  ] as never);

  const volumeId = volumeIdFor(series.seriesInstanceUid);
  let volume = cornerstone.cache.getVolume(volumeId);
  if (!volume) {
    volume = await volumeLoader.createAndCacheVolume(volumeId, {
      imageIds: series.imageIds,
    });
  }
  (volume as { load: () => void }).load();

  await setVolumesForViewports(re, [{ volumeId }], [VRT_VIEWPORT]);

  const vp = re.getViewport(VRT_VIEWPORT) as any;
  try {
    vp.setProperties({ preset });
  } catch {
    /* preset name unknown for this modality — leave default */
  }
  group.addViewport(VRT_VIEWPORT, ENGINE_ID);

  // rotate with the primary button + wheel in 3D
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

  vp.resetCamera?.();
  vp.render();
}

export function setVrtPreset(preset: string): void {
  const re = getRenderingEngine(ENGINE_ID) as cornerstone.RenderingEngine | undefined;
  const vp = re?.getViewport(VRT_VIEWPORT) as any;
  if (!vp) return;
  try {
    vp.setProperties({ preset });
    vp.render();
  } catch {
    /* ignore */
  }
}

export function exitVrt(): void {
  const re = getRenderingEngine(ENGINE_ID) as cornerstone.RenderingEngine | undefined;
  if (!re) return;
  const group = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
  try {
    group?.removeViewports(ENGINE_ID, VRT_VIEWPORT);
    re.disableElement(VRT_VIEWPORT);
  } catch {
    /* ignore */
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
