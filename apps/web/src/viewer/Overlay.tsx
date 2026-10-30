import { useEffect, useState } from 'react';
import * as cornerstone from '@cornerstonejs/core';
import { useViewer } from './store';
import type { LoadedSeries } from './store';
import { ENGINE_ID } from './renderingManager';

interface Corner {
  dimensions?: string;
  sliceThickness?: string;
  instance?: string;
  seriesNumber?: string;
  zoom?: string;
  wl?: string;
}

/**
 * Corner + centre overlay for a viewport. Patient/study block from the store;
 * dynamic corner readouts from Cornerstone events.
 */
export function ViewportOverlay({
  viewportId,
  series,
}: {
  viewportId: string;
  series: LoadedSeries;
}) {
  const patient = useViewer((s) => s.patient);
  const [corner, setCorner] = useState<Corner>({});
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const { Enums, getRenderingEngine } = cornerstone;
    const handler = () => {
      const re = getRenderingEngine(ENGINE_ID);
      const vp = re?.getViewport(viewportId) as
        | cornerstone.Types.IStackViewport
        | undefined;
      if (!vp) return;
      try {
        const imageId = vp.getCurrentImageId?.();
        const idx = (vp.getCurrentImageIdIndex?.() ?? 0) + 1;
        const total = vp.getImageIds?.().length ?? series.imageIds.length;
        const props = vp.getProperties?.() as any;
        const voi = props?.voiRange;
        const cam = vp.getCamera?.() as any;
        const md = imageId
          ? (cornerstone.metaData.get('imagePlaneModule', imageId) as any)
          : undefined;
        const gen = imageId
          ? (cornerstone.metaData.get('generalImageModule', imageId) as any)
          : undefined;
        const px = imageId
          ? (cornerstone.metaData.get('imagePixelModule', imageId) as any)
          : undefined;
        setCorner({
          dimensions:
            px?.columns && px?.rows ? `${px.columns} x ${px.rows}` : undefined,
          sliceThickness: md?.sliceThickness
            ? `${Number(md.sliceThickness).toFixed(2)} mm`
            : undefined,
          instance: `Img ${idx}/${total}`,
          seriesNumber:
            series.seriesNumber != null ? `Ser ${series.seriesNumber}` : undefined,
          zoom: cam?.parallelScale
            ? `Zoom ${(1 / cam.parallelScale * 100).toFixed(0)}`
            : undefined,
          wl: voi
            ? `W ${Math.round(voi.upper - voi.lower)} L ${Math.round(
                (voi.upper + voi.lower) / 2,
              )}`
            : gen
              ? undefined
              : undefined,
        });
      } catch {
        /* ignore */
      }
    };
    // Cornerstone fires these on the viewport *element* (not the global event target),
    // so attach there — retrying until the viewport has been created.
    const evs = [
      Enums.Events.IMAGE_RENDERED,
      Enums.Events.CAMERA_MODIFIED,
      Enums.Events.VOI_MODIFIED,
      Enums.Events.STACK_NEW_IMAGE,
    ];
    let el: HTMLElement | null = null;
    const attach = () => {
      const vp = getRenderingEngine(ENGINE_ID)?.getViewport(viewportId);
      const found = (vp as { element?: HTMLElement } | undefined)?.element ?? null;
      if (!found) return false;
      el = found;
      evs.forEach((e) => el!.addEventListener(e, handler));
      handler();
      return true;
    };
    let timer: ReturnType<typeof setInterval> | undefined;
    if (!attach()) {
      timer = setInterval(() => {
        if (attach() && timer) clearInterval(timer);
      }, 250);
    }
    return () => {
      if (timer) clearInterval(timer);
      if (el) evs.forEach((e) => el!.removeEventListener(e, handler));
    };
  }, [viewportId, series]);

  return (
    <>
      <div className={`ov ov-tl${collapsed ? ' collapsed' : ''}`}>
        <button className="ov-collapse" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? '›' : '‹'}
        </button>
        {!collapsed && (
          <>
            <div>{patient.name ?? '—'}</div>
            <div>ID: {patient.id ?? '—'}</div>
            <div>
              {patient.sex ?? '—'} {patient.birthDate ? `· ${patient.birthDate}` : ''}
            </div>
            <div>{patient.studyDescription ?? series.seriesDescription ?? ''}</div>
            <div className="dim">Series: {series.seriesDescription ?? series.seriesInstanceUid}</div>
          </>
        )}
      </div>

      <div className="ov ov-bl">
        {corner.dimensions && <div>{corner.dimensions}</div>}
        {corner.sliceThickness && <div>Slice: {corner.sliceThickness}</div>}
        {corner.instance && <div>{corner.instance}</div>}
        {corner.seriesNumber && <div>{corner.seriesNumber}</div>}
      </div>

      <div className="ov ov-br">
        {corner.zoom && <div>{corner.zoom}</div>}
        {corner.wl && <div>{corner.wl}</div>}
      </div>

      <div className="ov marker marker-top">A</div>
      <div className="ov marker marker-bottom">P</div>
      <div className="ov marker marker-left">R</div>
      <div className="ov marker marker-right">L</div>
    </>
  );
}
