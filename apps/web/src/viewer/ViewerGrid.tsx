import { useEffect, useRef } from 'react';
import { message } from 'antd';
import { useViewer, shownVrtUids } from './store';
import {
  renderStackGrid,
  enterMpr,
  exitMpr,
  enterVrt,
  exitVrt,
  setVrtPreset,
  setVrtSpin,
  linkVrtCameras,
  vrtPresetFor,
  applySlab,
  applySync,
  setInvert,
  resizeEngine,
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
    vrt,
    vrtPreset,
    vrtSeries,
    vrtLink,
    vrtSpin,
    projection,
    slabThicknessMm,
    invert,
    showOverlay,
    sync,
    activeViewportIndex,
    set,
  } = useViewer();

  const mode = vrt ? 'vrt' : mpr ? 'mpr' : 'stack';

  const stackRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const mprRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const vrtRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const gridRef = useRef<HTMLDivElement | null>(null);

  const activeSeries = () => {
    const uid = assignments[activeViewportIndex] ?? series[0]?.seriesInstanceUid;
    return series.find((s) => s.seriesInstanceUid === uid) ?? series[0];
  };

  // --- Stack grid reconciliation ---
  useEffect(() => {
    if (mode !== 'stack') return;
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
  }, [mode, layout.rows, layout.cols, assignments, series]);

  // --- keep Cornerstone canvases matched to the container size ---
  useEffect(() => {
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => resizeEngine());
    });
    ro.observe(el);
    const t1 = setTimeout(resizeEngine, 100);
    const t2 = setTimeout(resizeEngine, 600);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [mode]);

  // --- MPR enter/exit ---
  useEffect(() => {
    if (mode !== 'mpr') {
      exitMpr();
      return;
    }
    const s = activeSeries();
    const els = {
      axial: mprRefs.current['MPR_AXIAL'],
      sagittal: mprRefs.current['MPR_SAGITTAL'],
      coronal: mprRefs.current['MPR_CORONAL'],
    };
    if (s && els.axial && els.sagittal && els.coronal) {
      enterMpr(s, { axial: els.axial, sagittal: els.sagittal, coronal: els.coronal }).catch((e) => {
        console.warn('MPR failed', e);
        message.warning('MPR needs a multi-slice CT / MR / PET series — this series is 2D. Back to the image stack.');
        set('mpr', false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // --- VRT enter/exit (1–4 series, re-entered when the selection changes) ---
  const vrtUids = mode === 'vrt' ? shownVrtUids({ series, assignments, activeViewportIndex, vrtSeries }) : [];
  const vrtKey = vrtUids.join(',');

  useEffect(() => {
    if (mode !== 'vrt') {
      exitVrt(useViewer.getState().primaryTool);
      return;
    }
    const cells = vrtUids
      .map((uid, i) => ({ element: vrtRefs.current[i], series: series.find((x) => x.seriesInstanceUid === uid) }))
      .filter((c): c is { element: HTMLDivElement; series: NonNullable<typeof c.series> } => !!c.element && !!c.series);
    if (!cells.length) return;
    const preset = vrtPresetFor(cells[0].series, vrtPreset);
    if (preset !== vrtPreset) set('vrtPreset', preset);
    enterVrt(cells, preset)
      .then(() => {
        linkVrtCameras(useViewer.getState().vrtLink);
        setVrtSpin(useViewer.getState().vrtSpin);
      })
      .catch((e) => {
        console.warn('VRT failed', e);
        message.warning('3D (VRT) needs a multi-slice CT / MR / PET series — this series is 2D. Back to the image stack.');
        set('vrt', false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, vrtKey]);

  useEffect(() => {
    if (mode === 'vrt') setVrtPreset(vrtPreset);
  }, [mode, vrtPreset]);

  useEffect(() => {
    if (mode === 'vrt') linkVrtCameras(vrtLink);
  }, [mode, vrtLink]);

  useEffect(() => {
    if (mode === 'vrt') setVrtSpin(vrtSpin);
  }, [mode, vrtSpin]);

  // --- Slab / projection ---
  useEffect(() => {
    if (mode === 'mpr') applySlab(projection, slabThicknessMm);
  }, [mode, projection, slabThicknessMm]);

  // --- Invert ---
  useEffect(() => {
    setInvert(invert);
  }, [invert]);

  // --- viewport sync (Compare) ---
  useEffect(() => {
    if (mode === 'stack') {
      const t = setTimeout(() => applySync(sync), 150);
      return () => clearTimeout(t);
    }
    applySync(false);
  }, [mode, sync, layout.rows, layout.cols, assignments]);

  if (mode === 'vrt') {
    const n = Math.max(1, vrtUids.length);
    return (
      <div
        className="viewer-grid"
        ref={gridRef}
        style={{
          gridTemplateColumns: n === 1 ? '1fr' : '1fr 1fr',
          gridTemplateRows: n > 2 ? '1fr 1fr' : '1fr',
        }}
      >
        {Array.from({ length: n }, (_, i) => {
          const s = series.find((x) => x.seriesInstanceUid === vrtUids[i]);
          return (
            <div
              key={`${i}-${vrtUids[i] ?? ''}`}
              className="viewport-cell"
              style={n === 3 && i === 2 ? { gridColumn: '1 / -1' } : undefined}
            >
              <div className="viewport-label">
                3D · {s ? vrtLabel(s) : ''} · {s ? vrtPresetFor(s, vrtPreset) : vrtPreset}
                {vrtUids.length > 1 && vrtLink ? ' · linked' : ''}
              </div>
              <div
                className="cs-viewport"
                ref={(el) => (vrtRefs.current[i] = el)}
                onContextMenu={(e) => e.preventDefault()}
              />
            </div>
          );
        })}
      </div>
    );
  }

  if (mode === 'mpr') {
    const labels: Record<string, string> = {
      MPR_AXIAL: 'AXIAL',
      MPR_SAGITTAL: 'SAGITTAL',
      MPR_CORONAL: 'CORONAL',
    };
    return (
      <div className="viewer-grid mpr" ref={gridRef}>
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
      ref={gridRef}
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
            {s && showOverlay && (
              <ViewportOverlay viewportId={stackViewportId(i)} series={s} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function vrtLabel(s: { seriesDescription?: string; modality?: string; seriesNumber?: number }): string {
  const name = s.seriesDescription?.trim() || `${s.modality ?? ''} series`.trim();
  return s.seriesNumber != null ? `#${s.seriesNumber} ${name}` : name;
}
