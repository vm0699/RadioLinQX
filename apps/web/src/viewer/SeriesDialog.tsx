import { useEffect, useState } from 'react';
import { Modal, Checkbox, Button, Spin, Empty } from 'antd';
import { api, type SeriesSummary, type StudySummary } from '../api/client';

export function SeriesDialog({
  study,
  open,
  onClose,
  onView,
}: {
  study: StudySummary | null;
  open: boolean;
  onClose: () => void;
  onView: (study: StudySummary, series: SeriesSummary[]) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [series, setSeries] = useState<SeriesSummary[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || !study) return;
    setLoading(true);
    setChecked(new Set());
    api
      .listSeries(study.studyInstanceUid)
      .then((s) => setSeries(s))
      .finally(() => setLoading(false));
  }, [open, study]);

  const toggle = (uid: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });

  return (
    <Modal
      title={`Series — ${study?.patientName ?? ''}`}
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
    >
      <Button
        type="primary"
        disabled={checked.size === 0}
        style={{ marginBottom: 12 }}
        onClick={() => {
          if (!study) return;
          const chosen = series.filter((s) => checked.has(s.seriesInstanceUid));
          onView(study, chosen);
        }}
      >
        View Selected ({checked.size})
      </Button>

      {loading ? (
        <Spin />
      ) : series.length === 0 ? (
        <Empty description="No series" />
      ) : (
        <div className="series-list">
          {series.map((s) => (
            <label
              key={s.seriesInstanceUid}
              className="series-row"
              onClick={(e) => {
                // let the checkbox handle its own click
                if ((e.target as HTMLElement).tagName !== 'INPUT') {
                  toggle(s.seriesInstanceUid);
                }
              }}
            >
              <Checkbox
                checked={checked.has(s.seriesInstanceUid)}
                onChange={() => toggle(s.seriesInstanceUid)}
              />
              <div className="series-thumb">{s.modality ?? '—'}</div>
              <div className="series-meta">
                <div className="series-title">
                  {s.seriesDescription ?? `Series ${s.seriesNumber ?? '?'}`}
                </div>
                <div className="dim">{s.instanceCount ?? '?'} image(s)</div>
              </div>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}
