import { Injectable } from '@nestjs/common';
import { JsonStore } from '../store/json-store';
import { SettingsService } from '../settings/settings.service';
import { ReferringDoctorsService } from '../directory/referring-doctors.service';
import { seedCases } from './cases.seed';
import type {
  CaseRecord,
  CaseView,
  FilterPreset,
  TatStatus,
} from './case.types';

export interface CaseQuery {
  q?: string;
  patientId?: string;
  patientName?: string;
  tab?: 'all' | 'reported' | 'pending';
  scanType?: string;
  bodyPart?: string;
  tag?: string;
  tatStatus?: TatStatus;
  branchId?: string;
  referringDoctorId?: string;
  radiologistId?: string;
  fromDate?: string; // yyyy-mm-dd
  toDate?: string;
  page?: string;
  perPage?: string;
  sort?: string; // e.g. "uploadedAt:desc"
}

const PENDING_STATUSES = new Set(['UNREAD', 'ASSIGNED', 'DRAFT']);

@Injectable()
export class CasesService {
  private store: JsonStore<CaseRecord>;
  private presets = new JsonStore<FilterPreset>('case-presets.json', () => [
    {
      id: 'preset-default',
      name: 'Default',
      query: { tab: 'all' },
      createdAt: new Date().toISOString(),
    },
  ]);

  constructor(
    private readonly settings: SettingsService,
    private readonly referrers: ReferringDoctorsService,
  ) {
    this.store = new JsonStore<CaseRecord>('cases.json', async () => {
      const s = await this.settings.get();
      const refs = await this.referrers.list();
      return seedCases(s, refs);
    });
  }

  // ---- derive ----
  private toView(c: CaseRecord): CaseView {
    const now = Date.now();
    const due = +new Date(c.dueAt);
    const uploaded = +new Date(c.uploadedAt);
    let tatStatus: TatStatus;
    if (c.status === 'REPORTED') tatStatus = 'REPORTED';
    else if (now > due) tatStatus = 'OVERDUE';
    else if (due - now < 2 * 3600_000) tatStatus = 'DUE_SOON';
    else tatStatus = 'ON_TIME';
    return {
      ...c,
      tatStatus,
      timeElapsedMs:
        (c.reportedAt ? +new Date(c.reportedAt) : now) - uploaded,
      timeRemainingMs: due - now,
    };
  }

  // ---- queries ----
  /** All rows matching the filter bar (no pagination, no tab). */
  private async filtered(query: CaseQuery): Promise<CaseView[]> {
    let rows = (await this.store.all()).map((c) => this.toView(c));

    const tab = query.tab ?? 'all';
    if (tab === 'reported') rows = rows.filter((c) => c.status === 'REPORTED');
    if (tab === 'pending')
      rows = rows.filter((c) => PENDING_STATUSES.has(c.status));

    const pid = (query.patientId ?? query.q ?? '').trim().toLowerCase();
    const pname = (query.patientName ?? query.q ?? '').trim().toLowerCase();
    if (query.patientId)
      rows = rows.filter((c) => c.patientId.toLowerCase().includes(pid));
    if (query.patientName)
      rows = rows.filter((c) => c.patientName.toLowerCase().includes(pname));
    if (query.q && !query.patientId && !query.patientName) {
      const q = query.q.trim().toLowerCase();
      rows = rows.filter(
        (c) =>
          c.patientId.toLowerCase().includes(q) ||
          c.patientName.toLowerCase().includes(q) ||
          (c.studyDescription ?? '').toLowerCase().includes(q) ||
          c.caseNumber.toLowerCase().includes(q),
      );
    }

    if (query.scanType)
      rows = rows.filter((c) => c.scanType === query.scanType);
    if (query.bodyPart)
      rows = rows.filter((c) => c.bodyParts.includes(query.bodyPart!));
    if (query.tag) rows = rows.filter((c) => c.tags.includes(query.tag!));
    if (query.tatStatus)
      rows = rows.filter((c) => c.tatStatus === query.tatStatus);
    if (query.branchId)
      rows = rows.filter((c) => c.branchId === query.branchId);
    if (query.referringDoctorId)
      rows = rows.filter((c) => c.referringDoctorId === query.referringDoctorId);
    if (query.radiologistId)
      rows = rows.filter((c) => c.assignedRadiologistId === query.radiologistId);

    if (query.fromDate) {
      const from = +new Date(query.fromDate + 'T00:00:00');
      rows = rows.filter((c) => +new Date(c.uploadedAt) >= from);
    }
    if (query.toDate) {
      const to = +new Date(query.toDate + 'T23:59:59');
      rows = rows.filter((c) => +new Date(c.uploadedAt) <= to);
    }

    const [sortKey, sortDir] = (query.sort ?? 'uploadedAt:desc').split(':');
    rows.sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      const cmp =
        typeof av === 'string' ? String(av).localeCompare(String(bv)) : av - bv;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }

  async list(query: CaseQuery): Promise<{
    total: number;
    page: number;
    perPage: number;
    rows: CaseView[];
  }> {
    const rows = await this.filtered(query);
    const total = rows.length;
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const perPage = Math.min(
      200,
      Math.max(1, parseInt(query.perPage ?? '15', 10) || 15),
    );
    const start = (page - 1) * perPage;
    return { total, page, perPage, rows: rows.slice(start, start + perPage) };
  }

  async stats(query: CaseQuery): Promise<{
    all: number;
    reported: number;
    pending: number;
  }> {
    // same filter bar, ignore the tab so each tab badge reflects the filters
    const rows = await this.filtered({ ...query, tab: 'all' });
    return {
      all: rows.length,
      reported: rows.filter((c) => c.status === 'REPORTED').length,
      pending: rows.filter((c) => PENDING_STATUSES.has(c.status)).length,
    };
  }

  async get(id: string): Promise<CaseView | undefined> {
    const c = await this.store.find(id);
    return c ? this.toView(c) : undefined;
  }

  // ---- mutations ----
  async create(input: Partial<CaseRecord>): Promise<CaseView> {
    const s = await this.settings.get();
    const now = new Date();
    const targetH =
      s.tat.targetHoursByScanType[input.scanType ?? ''] ??
      s.tat.targetHoursByScanType['*'] ??
      24;
    const all = await this.store.all();
    const n = all.length + 1;
    const rec: CaseRecord = {
      id: `case-${Date.now().toString(36)}`,
      caseNumber: `RLQ-${now.getFullYear()}-${String(n).padStart(5, '0')}`,
      patientId: input.patientId ?? String(n),
      patientName: input.patientName ?? 'Unknown',
      patientAge: input.patientAge,
      patientSex: input.patientSex,
      patientMobile: input.patientMobile,
      scanType: input.scanType ?? 'OT',
      bodyParts: input.bodyParts ?? [],
      studyDescription: input.studyDescription,
      contrast: input.contrast ?? 'No',
      branchId: input.branchId ?? s.branches[0]?.id,
      referringDoctorId: input.referringDoctorId,
      referringDoctorName: input.referringDoctorName,
      referringDoctorMobile: input.referringDoctorMobile,
      patientHistory: input.patientHistory,
      remarks: input.remarks,
      tags: input.tags ?? [],
      status: 'UNREAD',
      uploadedAt: now.toISOString(),
      dueAt: new Date(now.getTime() + targetH * 3600_000).toISOString(),
      uploadStatus: input.hasImages ? 'COMPLETE' : 'PARTIAL',
      imageCount: input.imageCount ?? 0,
      seriesCount: input.seriesCount ?? 0,
      hasImages: !!input.hasImages,
      studyInstanceUid: input.studyInstanceUid,
      seriesInstanceUids: input.seriesInstanceUids,
    };
    await this.store.insert(rec);
    return this.toView(rec);
  }

  async update(id: string, patch: Partial<CaseRecord>): Promise<CaseView | undefined> {
    const updated = await this.store.update(id, patch);
    return updated ? this.toView(updated) : undefined;
  }

  async assign(
    id: string,
    radiologistId: string,
  ): Promise<CaseView | undefined> {
    const s = await this.settings.get();
    const rad = s.radiologists.find((r) => r.id === radiologistId);
    if (!rad) return undefined;
    const cur = await this.store.find(id);
    return this.update(id, {
      assignedRadiologistId: rad.id,
      assignedRadiologistName: rad.name,
      status: cur?.status === 'REPORTED' ? 'REPORTED' : 'ASSIGNED',
    });
  }

  async saveReport(
    id: string,
    report: Partial<CaseRecord['report']>,
    action: 'save' | 'sign',
  ): Promise<CaseView | undefined> {
    const cur = await this.store.find(id);
    if (!cur) return undefined;
    const now = new Date().toISOString();
    const merged = {
      clinicalHistory: cur.report?.clinicalHistory ?? '',
      technique: cur.report?.technique ?? '',
      findings: cur.report?.findings ?? '',
      impression: cur.report?.impression ?? '',
      ...report,
      updatedAt: now,
      signedBy:
        action === 'sign'
          ? cur.assignedRadiologistName ?? 'Radiologist'
          : cur.report?.signedBy,
      signedAt: action === 'sign' ? now : cur.report?.signedAt,
    };
    return this.update(id, {
      report: merged,
      status: action === 'sign' ? 'REPORTED' : 'DRAFT',
      reportedAt: action === 'sign' ? now : cur.reportedAt,
    });
  }

  remove(id: string) {
    return this.store.remove(id);
  }

  /** Clone a case as a fresh unread study (keeps the image linkage). */
  async duplicate(id: string): Promise<CaseView | undefined> {
    const src = await this.store.find(id);
    if (!src) return undefined;
    const all = await this.store.all();
    const n = all.length + 1;
    const now = new Date();
    const s = await this.settings.get();
    const targetH =
      s.tat.targetHoursByScanType[src.scanType] ??
      s.tat.targetHoursByScanType['*'] ??
      24;
    const copy: CaseRecord = {
      ...src,
      id: `case-${Date.now().toString(36)}`,
      caseNumber: `RLQ-${now.getFullYear()}-${String(n).padStart(5, '0')}`,
      status: 'UNREAD',
      assignedRadiologistId: undefined,
      assignedRadiologistName: undefined,
      reportedAt: undefined,
      report: undefined,
      uploadedAt: now.toISOString(),
      dueAt: new Date(now.getTime() + targetH * 3600_000).toISOString(),
      remarks: src.remarks ? `${src.remarks} (copy of ${src.caseNumber})` : `Copy of ${src.caseNumber}`,
    };
    await this.store.insert(copy);
    return this.toView(copy);
  }

  // ---- presets ----
  listPresets() {
    return this.presets.all();
  }
  createPreset(name: string, query: Record<string, string>) {
    return this.presets.insert({
      id: `preset-${Date.now().toString(36)}`,
      name,
      query,
      createdAt: new Date().toISOString(),
    });
  }
  removePreset(id: string) {
    return this.presets.remove(id);
  }
}
