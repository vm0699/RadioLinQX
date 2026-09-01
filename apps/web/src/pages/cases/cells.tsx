import { Tag, Tooltip } from 'antd';
import type { CaseView, CaseStatus } from '../../api/client';

const STATUS_META: Record<CaseStatus, { label: string; color: string }> = {
  UNREAD: { label: 'Report Pending', color: 'gold' },
  ASSIGNED: { label: 'Assigned', color: 'blue' },
  DRAFT: { label: 'Draft report', color: 'purple' },
  REPORTED: { label: 'Reported', color: 'green' },
};

export function StatusTag({ status }: { status: CaseStatus }) {
  const m = STATUS_META[status];
  return <Tag color={m.color}>{m.label}</Tag>;
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
    <span style={{ color: over ? '#ff4d4f' : soon ? '#faad14' : '#52c41a' }}>
      {over ? `overdue ${fmtDur(c.timeRemainingMs)}` : `${fmtDur(c.timeRemainingMs)} left`}
    </span>
  );
}
