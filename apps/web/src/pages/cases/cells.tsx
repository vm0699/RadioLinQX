import { Tooltip } from 'antd';
import type { CaseView, CaseStatus } from '../../api/client';

const STATUS_META: Record<
  CaseStatus,
  { label: string; fg: string; bg: string; dot: string }
> = {
  UNREAD: { label: 'Report Pending', fg: '#92400e', bg: '#fef3c7', dot: '#d97706' },
  ASSIGNED: { label: 'Assigned', fg: '#1e40af', bg: '#dbeafe', dot: '#2563eb' },
  DRAFT: { label: 'Draft report', fg: '#6b21a8', bg: '#f3e8ff', dot: '#9333ea' },
  REPORTED: { label: 'Reported', fg: '#166534', bg: '#dcfce7', dot: '#16a34a' },
};

export function StatusTag({ status }: { status: CaseStatus }) {
  const m = STATUS_META[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 10px 2px 8px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: m.fg,
        background: m.bg,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{ width: 6, height: 6, borderRadius: 999, background: m.dot }}
      />
      {m.label}
    </span>
  );
}

function fmtDur(ms: number) {
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3600_000);
  const m = Math.floor((abs % 3600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function TatCell({ c }: { c: CaseView }) {
  if (c.status === 'REPORTED') {
    return (
      <Tooltip title={`Reported ${new Date(c.reportedAt ?? '').toLocaleString()}`}>
        <span className="dim">done in {fmtDur(c.timeElapsedMs)}</span>
      </Tooltip>
    );
  }
  const over = c.timeRemainingMs < 0;
  const soon = !over && c.timeRemainingMs < 2 * 3600_000;
  return (
    <span
      style={{
        fontWeight: 600,
        fontSize: 12.5,
        color: over ? '#dc2626' : soon ? '#d97706' : '#16a34a',
      }}
    >
      {over ? `overdue ${fmtDur(c.timeRemainingMs)}` : `${fmtDur(c.timeRemainingMs)} left`}
    </span>
  );
}
