import { useEffect, useState } from 'react';
import { Modal, Checkbox, Button, Spin, Empty } from 'antd';
import { api, type CaseView, type SeriesSummary } from '../../api/client';
import { isVolumetric, vrUrl } from '../../vr/xr';

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
      .then((list) => {
        // list the series in the case's preferred order (default 3D series first)
        const pref = theCase.seriesInstanceUids ?? [];
        const rank = (uid: string) => (pref.includes(uid) ? pref.indexOf(uid) : pref.length);
        const s = [...list].sort((a, b) => rank(a.seriesInstanceUid) - rank(b.seriesInstanceUid));
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
                  {s.seriesNumber != null && s.seriesDescription ? `#${s.seriesNumber} ` : ''}
                  {s.seriesDescription ?? `Series ${s.seriesNumber ?? '?'}`}
                </div>
                <div className="dim">
                  {s.instanceCount ?? '?'} image(s){isVolumetric(s) ? ' · 3D volume' : ''}
                </div>
              </div>
              {theCase?.studyInstanceUid && (
                <Button
                  size="small"
                  onClick={(e) => {
                    e.preventDefault();
                    window.open(vrUrl(theCase.id, theCase.studyInstanceUid!, s.seriesInstanceUid), '_blank');
                  }}
                >
                  {isVolumetric(s) ? '3D / VR' : 'VR screen'}
                </Button>
              )}
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}
