import { Injectable } from '@nestjs/common';
import { JsonStore } from '../store/json-store';
import { CasesService } from '../cases/cases.service';

export interface Notification {
  id: string;
  type: 'NEW_CASE' | 'ASSIGNED' | 'REPORT_READY' | 'OVERDUE' | 'CHAT';
  title: string;
  body: string;
  caseId?: string;
  at: string;
  read: boolean;
}

interface ReadState {
  id: 'read';
  ids: string[];
}

@Injectable()
export class NotificationsService {
  private readState = new JsonStore<ReadState>('notif-read.json', () => [
    { id: 'read', ids: [] },
  ]);

  constructor(private readonly cases: CasesService) {}

  private async computed(): Promise<Notification[]> {
    const { rows } = await this.cases.list({ page: '1', perPage: '200', tab: 'all' });
    const out: Notification[] = [];
    for (const c of rows) {
      if (c.tatStatus === 'OVERDUE' && c.status !== 'REPORTED') {
        out.push({
          id: `n-overdue-${c.id}`,
          type: 'OVERDUE',
          title: 'TAT breached',
          body: `${c.patientName} · ${c.scanType} ${c.studyDescription ?? ''} is overdue`,
          caseId: c.id,
          at: c.dueAt,
          read: false,
        });
      }
      if (c.status === 'REPORTED' && c.reportedAt) {
        out.push({
          id: `n-report-${c.id}`,
          type: 'REPORT_READY',
          title: 'Report signed',
          body: `${c.assignedRadiologistName ?? 'Radiologist'} signed the report for ${c.patientName}`,
          caseId: c.id,
          at: c.reportedAt,
          read: false,
        });
      }
      if (c.status === 'UNREAD') {
        out.push({
          id: `n-new-${c.id}`,
          type: 'NEW_CASE',
          title: 'New case in queue',
          body: `${c.patientName} · ${c.scanType} — awaiting assignment`,
          caseId: c.id,
          at: c.uploadedAt,
          read: false,
        });
      }
    }
    return out
      .sort((a, b) => +new Date(b.at) - +new Date(a.at))
      .slice(0, 40);
  }

  async list(): Promise<Notification[]> {
    const read = new Set((await this.readState.all())[0]?.ids ?? []);
    return (await this.computed()).map((n) => ({ ...n, read: read.has(n.id) }));
  }

  async unreadCount(): Promise<number> {
    return (await this.list()).filter((n) => !n.read).length;
  }

  async markAllRead(): Promise<void> {
    const all = await this.computed();
    await this.readState.replaceAll([{ id: 'read', ids: all.map((n) => n.id) }]);
  }

  async markRead(id: string): Promise<void> {
    const cur = (await this.readState.all())[0]?.ids ?? [];
    if (!cur.includes(id)) {
      await this.readState.replaceAll([{ id: 'read', ids: [...cur, id] }]);
    }
  }
}
