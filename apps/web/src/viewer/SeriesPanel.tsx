import { useViewer } from './store';

/** Left rail: the series that were opened, click/drag onto a viewport. */
export function SeriesPanel() {
  const { series, assignments, activeViewportIndex, assign } = useViewer();

  return (
    <div className="series-panel">
      {series.map((s, i) => {
        const inUse = assignments.includes(s.seriesInstanceUid);
        return (
          <div
            key={s.seriesInstanceUid}
            className={`series-tile${inUse ? ' in-use' : ''}`}
            draggable
            onDragStart={(e) =>
              e.dataTransfer.setData('text/series', s.seriesInstanceUid)
            }
            onClick={() => assign(activeViewportIndex, s.seriesInstanceUid)}
            title={s.seriesDescription ?? ''}
          >
            <div className="series-tile-thumb">
              <span>{s.modality ?? '—'}</span>
              <span className="series-tile-count">{s.imageIds.length}</span>
            </div>
            <div className="series-tile-label">
              {s.seriesDescription ?? `Series ${s.seriesNumber ?? i + 1}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}
