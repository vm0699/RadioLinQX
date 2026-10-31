import { useViewer, shownVrtUids, canRenderVolume, MAX_VRT } from './store';

/**
 * Left rail: the series that were opened, click/drag onto a viewport.
 * In 3D, click switches the rendered series (view angle is kept); Shift/Ctrl-click adds it
 * to a side-by-side compare.
 */
export function SeriesPanel() {
  const st = useViewer();
  const { series, assignments, activeViewportIndex, assign, vrt, set } = st;
  const shown = vrt ? shownVrtUids(st) : [];

  const onPick = (uid: string, additive: boolean) => {
    if (!vrt) return assign(activeViewportIndex, uid);
    const s = series.find((x) => x.seriesInstanceUid === uid);
    if (!s || !canRenderVolume(s)) return;
    if (additive) {
      const next = shown.includes(uid)
        ? shown.filter((u) => u !== uid)
        : [...shown, uid].slice(-MAX_VRT);
      if (next.length) set('vrtSeries', next);
    } else {
      set('vrtSeries', [uid]);
      assign(activeViewportIndex, uid);
    }
  };

  return (
    <div className="series-panel">
      {series.map((s, i) => {
        const inUse = vrt ? shown.includes(s.seriesInstanceUid) : assignments.includes(s.seriesInstanceUid);
        const disabled = vrt && !canRenderVolume(s);
        return (
          <div
            key={s.seriesInstanceUid}
            className={`series-tile${inUse ? ' in-use' : ''}${disabled ? ' disabled' : ''}`}
            draggable
            onDragStart={(e) =>
              e.dataTransfer.setData('text/series', s.seriesInstanceUid)
            }
            onClick={(e) => onPick(s.seriesInstanceUid, e.shiftKey || e.ctrlKey || e.metaKey)}
            title={
              (s.seriesDescription ?? '') +
              (vrt ? (disabled ? ' — 2D series, not available in 3D' : ' — Shift/Ctrl-click to compare') : '')
            }
          >
            <div className="series-tile-thumb">
              <span>{s.modality ?? '—'}</span>
              <span className="series-tile-count">{s.imageIds.length}</span>
            </div>
            <div className="series-tile-label">
              {s.seriesNumber != null && s.seriesDescription ? `#${s.seriesNumber} ` : ''}
              {s.seriesDescription ?? `Series ${s.seriesNumber ?? i + 1}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}
