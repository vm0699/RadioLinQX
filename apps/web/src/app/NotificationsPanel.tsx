import { useEffect, useState } from 'react';
import { Button, Empty, Spin } from 'antd';
import { api, type Notification } from '../api/client';

const ICON: Record<Notification['type'], string> = {
  NEW_CASE: 'NEW',
  ASSIGNED: 'ASG',
  REPORT_READY: 'RPT',
  OVERDUE: 'TAT',
  CHAT: 'MSG',
};

function ago(iso: string) {
  const s = (Date.now() - +new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function NotificationsPanel({
  onNavigate,
  onChanged,
}: {
  onNavigate: (caseId: string) => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Notification[] | null>(null);

  const load = () => api.listNotifications().then(setItems).catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="notif-panel">
      <div className="notif-head">
        <b>Notifications</b>
        <Button
          type="link"
          size="small"
          onClick={async () => {
            await api.notifReadAll();
            await load();
            onChanged();
          }}
        >
          Mark all read
        </Button>
      </div>
      <div className="notif-list">
        {items == null ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : items.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="All caught up" />
        ) : (
          items.map((n) => (
            <button
              key={n.id}
              className={`notif-item${n.read ? ' read' : ''}`}
              onClick={async () => {
                await api.notifRead(n.id);
                onChanged();
                if (n.caseId) onNavigate(n.caseId);
              }}
            >
              <span className="notif-icon">{ICON[n.type] ?? '•'}</span>
              <span className="notif-body">
                <span className="notif-title">{n.title}</span>
                <span className="notif-text">{n.body}</span>
                <span className="dim">{ago(n.at)}</span>
              </span>
              {!n.read && <span className="notif-dot" />}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
