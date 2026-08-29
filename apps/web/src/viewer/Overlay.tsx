import { useEffect, useState } from 'react';
import * as cornerstone from '@cornerstonejs/core';
import { useViewer } from './store';
import type { LoadedSeries } from './store';

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
    const { eventTarget, Enums, getRenderingEngine } = cornerstone;
    const handler = () => {
      const re = getRenderingEngine('RADIOLINQ_ENGINE');
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
    eventTarget.addEventListener(Enums.Events.IMAGE_RENDERED, handler);
    eventTarget.addEventListener(Enums.Events.CAMERA_MODIFIED, handler);
    eventTarget.addEventListener(Enums.Events.VOI_MODIFIED, handler);
    const t = setTimeout(handler, 300);
    return () => {
      clearTimeout(t);
      eventTarget.removeEventListener(Enums.Events.IMAGE_RENDERED, handler);
      eventTarget.removeEventListener(Enums.Events.CAMERA_MODIFIED, handler);
      eventTarget.removeEventListener(Enums.Events.VOI_MODIFIED, handler);
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
