import { useEffect, useState } from 'react';
import { Timeline, Spin, Empty } from 'antd';
import { api, type CaseEvent } from '../../api/client';

const COLOR: Record<CaseEvent['type'], string> = {
  CREATED: 'blue',
  UPLOADED: 'blue',
  EDITED: 'gray',
  ASSIGNED: 'gold',
  STATUS: 'gray',
  REPORT_SAVED: 'gold',
  REPORT_SIGNED: 'green',
  TAG: 'gray',
  LINK: 'gray',
  ATTACHMENT: 'gray',
  DUPLICATED: 'blue',
};

export function CaseHistoryPopover({ caseId }: { caseId: string }) {
  const [events, setEvents] = useState<CaseEvent[] | null>(null);
  useEffect(() => {
    api.caseHistory(caseId).then(setEvents).catch(() => setEvents([]));
  }, [caseId]);

  return (
    <div style={{ width: 320, maxHeight: 320, overflowY: 'auto', paddingTop: 4 }}>
      {events == null ? (
        <Spin />
      ) : events.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No history" />
      ) : (
        <Timeline
          items={events.map((e) => ({
            color: COLOR[e.type] ?? 'gray',
            children: (
              <div>
                <div>{e.detail}</div>
                <div className="dim">
                  {e.by} · {new Date(e.at).toLocaleString()}
                </div>
              </div>
            ),
          }))}
        />
      )}
    </div>
  );
}
