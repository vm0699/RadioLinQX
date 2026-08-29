import { useEffect, useRef } from 'react';
import { useViewer } from './store';
import {
  renderStackGrid,
  enterMpr,
  exitMpr,
  applySlab,
  setInvert,
  stackViewportId,
  MPR_VIEWPORTS,
  type StackCell,
} from './renderingManager';
import { ViewportOverlay } from './Overlay';

/**
 * Owns the viewport <div> elements and keeps Cornerstone in sync with the
 * zustand store. All the imperative cornerstone calls live in renderingManager.
 */
export function ViewerGrid() {
  const {
    layout,
    assignments,
    series,
    mpr,
    projection,
    slabThicknessMm,
    invert,
    activeViewportIndex,
    set,
  } = useViewer();

  const stackRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const mprRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // --- Stack grid reconciliation ---
  useEffect(() => {
    if (mpr) return;
    const count = layout.rows * layout.cols;
    const cells: StackCell[] = [];
    for (let i = 0; i < count; i++) {
      const el = stackRefs.current[i];
      if (!el) continue;
      const uid = assignments[i];
      cells.push({
        index: i,
        element: el,
        series: series.find((s) => s.seriesInstanceUid === uid),
      });
    }
    if (cells.length) void renderStackGrid(cells);
  }, [mpr, layout.rows, layout.cols, assignments, series]);

  // --- MPR enter/exit ---
  useEffect(() => {
    if (!mpr) {
      exitMpr();
      return;
    }
    const activeUid = assignments[activeViewportIndex] ?? series[0]?.seriesInstanceUid;
    const activeSeries = series.find((s) => s.seriesInstanceUid === activeUid) ?? series[0];
    const els = {
      axial: mprRefs.current['MPR_AXIAL'],
      sagittal: mprRefs.current['MPR_SAGITTAL'],
      coronal: mprRefs.current['MPR_CORONAL'],
    };
    if (activeSeries && els.axial && els.sagittal && els.coronal) {
      void enterMpr(activeSeries, {
        axial: els.axial,
        sagittal: els.sagittal,
        coronal: els.coronal,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mpr]);

  // --- Slab / projection ---
  useEffect(() => {
    if (mpr) applySlab(projection, slabThicknessMm);
  }, [mpr, projection, slabThicknessMm]);

  // --- Invert ---
  useEffect(() => {
    setInvert(invert);
  }, [invert]);

  if (mpr) {
    const labels: Record<string, string> = {
      MPR_AXIAL: 'AXIAL',
      MPR_SAGITTAL: 'SAGITTAL',
      MPR_CORONAL: 'CORONAL',
    };
    return (
      <div className="viewer-grid mpr">
        {MPR_VIEWPORTS.map((id) => (
          <div key={id} className="viewport-cell">
            <div className="viewport-label">{labels[id]}</div>
            <div
              className="cs-viewport"
              ref={(el) => (mprRefs.current[id] = el)}
              onContextMenu={(e) => e.preventDefault()}
            />
          </div>
        ))}
      </div>
    );
  }

  const count = layout.rows * layout.cols;
  return (
    <div
      className="viewer-grid"
      style={{
        gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
        gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
      }}
    >
      {Array.from({ length: count }, (_, i) => {
        const uid = assignments[i];
        const s = series.find((x) => x.seriesInstanceUid === uid);
        return (
          <div
            key={i}
            className={`viewport-cell${i === activeViewportIndex ? ' active' : ''}`}
            onMouseDown={() => set('activeViewportIndex', i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const dropUid = e.dataTransfer.getData('text/series');
              if (dropUid) useViewer.getState().assign(i, dropUid);
            }}
          >
            <div
              className="cs-viewport"
              ref={(el) => (stackRefs.current[i] = el)}
              onContextMenu={(e) => e.preventDefault()}
            />
            {s && (
              <ViewportOverlay viewportId={stackViewportId(i)} series={s} />
            )}
          </div>
        );
      })}
    </div>
  );
}
