import { useEffect, useMemo, useState } from 'react';
import { Select, Tag, Empty, Spin } from 'antd';
import { api, type CaseView } from '../../api/client';

/**
 * Link this case to prior / related studies (comparison). Mirrors RadioLinQ's
 * "Link related cases" row action.
 */
export function LinkCasesPopover({
  theCase,
  onChanged,
}: {
  theCase: CaseView;
  onChanged: () => void;
}) {
  const [all, setAll] = useState<CaseView[] | null>(null);
  const [linked, setLinked] = useState<string[]>(theCase.linkedCaseIds ?? []);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      // same patient first, then anyone — quick heuristic
      .listCases({ patientId: theCase.patientId, perPage: '50' })
      .then((r) => setAll(r.rows.filter((c) => c.id !== theCase.id)))
      .catch(() => setAll([]));
  }, [theCase.id, theCase.patientId]);

  const byId = useMemo(
    () => Object.fromEntries((all ?? []).map((c) => [c.id, c])),
    [all],
  );

  const toggle = async (id: string, add: boolean) => {
    setBusy(true);
    try {
      const updated = await api.linkCases(theCase.id, id, !add);
      setLinked(updated.linkedCaseIds ?? []);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ width: 320 }}>
      <div className="fld-label">Related to this study</div>
      {linked.length === 0 ? (
        <div className="dim" style={{ marginBottom: 8 }}>Nothing linked yet.</div>
      ) : (
        <div style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {linked.map((id) => (
            <Tag key={id} closable onClose={() => toggle(id, false)}>
              {byId[id]?.caseNumber ?? id}
              {byId[id] ? ` · ${byId[id].scanType}` : ''}
            </Tag>
          ))}
        </div>
      )}

      <div className="fld-label">Add a case</div>
      {all == null ? (
        <Spin />
      ) : all.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No other cases for this patient" />
      ) : (
        <Select
          style={{ width: '100%' }}
          placeholder="Pick a prior / related case"
          loading={busy}
          showSearch
          optionFilterProp="label"
          value={null}
          onChange={(id: string) => toggle(id, true)}
          options={all
            .filter((c) => !linked.includes(c.id))
            .map((c) => ({
              value: c.id,
              label: `${c.caseNumber} · ${c.scanType} ${c.studyDescription ?? ''} · ${new Date(c.uploadedAt).toLocaleDateString()}`,
            }))}
        />
      )}
    </div>
  );
}
