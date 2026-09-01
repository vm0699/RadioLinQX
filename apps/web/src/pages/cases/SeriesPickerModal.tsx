import { useEffect, useState } from 'react';
import { Modal, Checkbox, Button, Spin, Empty } from 'antd';
import { api, type CaseView, type SeriesSummary } from '../../api/client';

export function SeriesPickerModal({
  theCase,
  onClose,
  onView,
}: {
  theCase: CaseView | null;
  onClose: () => void;
  onView: (seriesUids: string[]) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [series, setSeries] = useState<SeriesSummary[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!theCase?.studyInstanceUid) return;
    setLoading(true);
    setChecked(new Set());
    api
      .listSeriesFor(theCase.studyInstanceUid)
      .then((s) => {
        setSeries(s);
        setChecked(new Set(s.map((x) => x.seriesInstanceUid))); // preselect all
      })
      .finally(() => setLoading(false));
  }, [theCase]);

  const toggle = (uid: string) =>
    setChecked((prev) => {
      const n = new Set(prev);
      n.has(uid) ? n.delete(uid) : n.add(uid);
      return n;
    });

  return (
    <Modal
      title={`Series — ${theCase?.patientName ?? ''}`}
      open={!!theCase}
      onCancel={onClose}
      footer={null}
      width={560}
    >
      <Button
        type="primary"
        disabled={checked.size === 0}
        style={{ marginBottom: 12 }}
        onClick={() => onView([...checked])}
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
            <label key={s.seriesInstanceUid} className="series-row">
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
