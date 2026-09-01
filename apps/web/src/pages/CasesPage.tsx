import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Table, Tabs, Input, Select, DatePicker, Button, Tag, Dropdown, Popover,
  Space, App as AntdApp,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import {
  api, type CaseView, type AppSettings, type FilterPreset, type ReferringDoctor,
} from '../api/client';
import { AddCaseModal } from './cases/AddCaseModal';
import { CaseDrawer } from './cases/CaseDrawer';
import { SeriesPickerModal } from './cases/SeriesPickerModal';
import { StatusTag, TatCell } from './cases/cells';

type Filters = {
  patientId: string;
  patientName: string;
  range: [Dayjs, Dayjs] | null;
  scanType?: string;
  bodyPart?: string;
  tag?: string;
  tatStatus?: string;
  branchId?: string;
  referringDoctorId?: string;
  radiologistId?: string;
};

const EMPTY: Filters = { patientId: '', patientName: '', range: null };

function toQuery(f: Filters, tab: string, page: number, perPage: number): Record<string, string> {
  const q: Record<string, string> = { tab, page: String(page), perPage: String(perPage) };
  if (f.patientId) q.patientId = f.patientId;
  if (f.patientName) q.patientName = f.patientName;
  if (f.range) {
    q.fromDate = f.range[0].format('YYYY-MM-DD');
    q.toDate = f.range[1].format('YYYY-MM-DD');
  }
  for (const k of ['scanType', 'bodyPart', 'tag', 'tatStatus', 'branchId', 'referringDoctorId', 'radiologistId'] as const) {
    if (f[k]) q[k] = f[k] as string;
  }
  return q;
}

export function CasesPage() {
  const { message, modal } = AntdApp.useApp();
  const [sp, setSp] = useSearchParams();

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [referrers, setReferrers] = useState<ReferringDoctor[]>([]);
  const [presets, setPresets] = useState<FilterPreset[]>([]);

  const [tab, setTab] = useState<'all' | 'reported' | 'pending'>('all');
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(15);

  const [rows, setRows] = useState<CaseView[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ all: 0, reported: 0, pending: 0 });
  const [loading, setLoading] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(sp.get('case'));
  const [seriesPickCase, setSeriesPickCase] = useState<CaseView | null>(null);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
    api.listReferrers().then(setReferrers).catch(() => {});
    api.listPresets().then(setPresets).catch(() => {});
  }, []);

  const query = useMemo(() => toQuery(filters, tab, page, perPage), [filters, tab, page, perPage]);
  const statsQuery = useMemo(() => toQuery(filters, 'all', 1, 15), [filters]);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.listCases(query), api.caseStats(statsQuery)])
      .then(([res, st]) => {
        setRows(res.rows);
        setTotal(res.total);
        setStats(st);
      })
      .catch((e) => message.error(String(e)))
      .finally(() => setLoading(false));
  }, [query, statsQuery, message]);

  useEffect(() => {
    load();
  }, [load]);

  // keep ?case= in the URL synced with the drawer
  useEffect(() => {
    const cur = sp.get('case');
    if (drawerId && drawerId !== cur) {
      sp.set('case', drawerId);
      setSp(sp, { replace: true });
    } else if (!drawerId && cur) {
      sp.delete('case');
      setSp(sp, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerId]);

  const openViewer = (c: CaseView, seriesUids?: string[]) => {
    const series = (seriesUids ?? c.seriesInstanceUids ?? []).join(',');
    const url = `/viewer?case=${c.id}&study=${encodeURIComponent(
      c.studyInstanceUid ?? '',
    )}&series=${encodeURIComponent(series)}`;
    const w = window.open(url, '_blank');
    if (!w) window.location.assign(url); // popup blocked → same tab
  };

  const columns: ColumnsType<CaseView> = [
    {
      title: 'Tags',
      dataIndex: 'tags',
      width: 120,
      render: (t: string[]) =>
        t.length ? t.map((x) => <Tag key={x} color="geekblue">{x}</Tag>) : <span className="dim">—</span>,
    },
    { title: 'Patient ID', dataIndex: 'patientId', width: 110 },
    {
      title: 'Patient name',
      dataIndex: 'patientName',
      render: (v, r) => (
        <a onClick={() => setDrawerId(r.id)}>
          {v}
          {r.patientAge != null && <span className="dim"> · {r.patientAge}{r.patientSex}</span>}
        </a>
      ),
    },
    {
      title: 'Study',
      render: (_, r) => (
        <>
          <Tag>{r.scanType}</Tag> {r.studyDescription ?? r.bodyParts.join(', ')}
        </>
      ),
    },
    {
      title: 'Uploaded',
      dataIndex: 'uploadedAt',
      width: 150,
      sorter: true,
      render: (v: string) => dayjs(v).format('DD MMM YY, HH:mm'),
    },
    { title: 'TAT / Elapsed', width: 150, render: (_, r) => <TatCell c={r} /> },
    { title: 'Assigned', dataIndex: 'assignedRadiologistName', width: 150, render: (v) => v ?? <span className="dim">NA</span> },
    { title: 'Case Status', width: 130, render: (_, r) => <StatusTag status={r.status} /> },
    {
      title: 'Upload',
      dataIndex: 'uploadStatus',
      width: 110,
      render: (v: string) => (
        <Tag color={v === 'COMPLETE' ? 'green' : v === 'PARTIAL' ? 'orange' : 'blue'}>{v.toLowerCase()}</Tag>
      ),
    },
    {
      title: 'Actions',
      width: 170,
      render: (_, r) => (
        <Space size={4}>
          <Button
            size="small"
            type="link"
            disabled={!r.hasImages}
            onClick={() => setSeriesPickCase(r)}
          >
            View series
          </Button>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'open', label: 'Open case' },
                { key: 'assign', label: 'Assign radiologist' },
                r.status === 'REPORTED'
                  ? { key: 'reopen', label: 'Reopen (mark pending)' }
                  : { key: 'report', label: 'Open report editor' },
                { type: 'divider' },
                { key: 'delete', label: 'Delete', danger: true },
              ],
              onClick: async ({ key }) => {
                if (key === 'open' || key === 'report') setDrawerId(r.id);
                if (key === 'reopen') {
                  await api.updateCase(r.id, { status: 'ASSIGNED', reportedAt: undefined });
                  load();
                }
                if (key === 'assign') setDrawerId(r.id);
                if (key === 'delete') {
                  modal.confirm({
                    title: `Delete case ${r.caseNumber}?`,
                    onOk: async () => {
                      await api.deleteCase(r.id);
                      message.success('Deleted');
                      load();
                    },
                  });
                }
              },
            }}
          >
            <Button size="small" type="text">⋮</Button>
          </Dropdown>
        </Space>
      ),
    },
  ];

  const moreFilters = settings && (
    <div className="more-filters">
      <label>TAT status</label>
      <Select
        allowClear placeholder="Any" style={{ width: '100%' }}
        value={filters.tatStatus}
        onChange={(v) => setFilters((f) => ({ ...f, tatStatus: v }))}
        options={['ON_TIME', 'DUE_SOON', 'OVERDUE', 'REPORTED'].map((v) => ({ value: v, label: v }))}
      />
      <label>Branch</label>
      <Select
        allowClear placeholder="Any" style={{ width: '100%' }}
        value={filters.branchId}
        onChange={(v) => setFilters((f) => ({ ...f, branchId: v }))}
        options={settings.branches.map((b) => ({ value: b.id, label: b.name }))}
      />
      <label>Referring doctor</label>
      <Select
        allowClear showSearch optionFilterProp="label" placeholder="Any" style={{ width: '100%' }}
        value={filters.referringDoctorId}
        onChange={(v) => setFilters((f) => ({ ...f, referringDoctorId: v }))}
        options={referrers.map((d) => ({ value: d.id, label: d.name }))}
      />
      <label>Radiologist</label>
      <Select
        allowClear placeholder="Any" style={{ width: '100%' }}
        value={filters.radiologistId}
        onChange={(v) => setFilters((f) => ({ ...f, radiologistId: v }))}
        options={settings.radiologists.map((r) => ({ value: r.id, label: r.name }))}
      />
      <Button size="small" onClick={() => setFilters(EMPTY)} style={{ marginTop: 8 }}>
        Clear all filters
      </Button>
    </div>
  );

  return (
    <div className="page">
      <Tabs
        activeKey={tab}
        onChange={(k) => { setTab(k as typeof tab); setPage(1); }}
        items={[
          { key: 'all', label: `All (${stats.all})` },
          { key: 'reported', label: `Reported (${stats.reported})` },
          { key: 'pending', label: `Report Pending (${stats.pending})` },
        ]}
      />

      <div className="filter-bar">
        <Select
          size="small"
          style={{ width: 150 }}
          placeholder="Preset"
          value={undefined}
          onChange={(id) => {
            const p = presets.find((x) => x.id === id);
            if (!p) return;
            const q = p.query;
            setTab((q.tab as typeof tab) ?? 'all');
            setFilters({
              ...EMPTY,
              patientId: q.patientId ?? '',
              patientName: q.patientName ?? '',
              range: q.fromDate && q.toDate ? [dayjs(q.fromDate), dayjs(q.toDate)] : null,
              scanType: q.scanType, bodyPart: q.bodyPart, tag: q.tag,
              tatStatus: q.tatStatus, branchId: q.branchId,
              referringDoctorId: q.referringDoctorId, radiologistId: q.radiologistId,
            });
          }}
          options={presets.map((p) => ({ value: p.id, label: p.name }))}
        />
        <Button
          size="small"
          onClick={async () => {
            const name = window.prompt('Preset name');
            if (!name) return;
            const p = await api.createPreset(name, toQuery(filters, tab, 1, perPage));
            setPresets((x) => [...x, p]);
            message.success('Preset saved');
          }}
        >
          Save
        </Button>

        <Input
          size="small" allowClear placeholder="Patient ID" style={{ width: 130 }}
          value={filters.patientId}
          onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, patientId: e.target.value })); }}
        />
        <Input
          size="small" allowClear placeholder="Patient Name" style={{ width: 150 }}
          value={filters.patientName}
          onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, patientName: e.target.value })); }}
        />
        <DatePicker.RangePicker
          size="small"
          value={filters.range as any}
          onChange={(v) => { setPage(1); setFilters((f) => ({ ...f, range: v as any })); }}
        />
        <Select
          size="small" allowClear placeholder="Scan Type" style={{ width: 120 }}
          value={filters.scanType}
          onChange={(v) => { setPage(1); setFilters((f) => ({ ...f, scanType: v })); }}
          options={(settings?.scanTypes ?? []).map((v) => ({ value: v, label: v }))}
        />
        <Select
          size="small" allowClear showSearch placeholder="Body Part" style={{ width: 140 }}
          value={filters.bodyPart}
          onChange={(v) => { setPage(1); setFilters((f) => ({ ...f, bodyPart: v })); }}
          options={(settings?.bodyParts ?? []).map((v) => ({ value: v, label: v }))}
        />
        <Select
          size="small" allowClear placeholder="Tag" style={{ width: 130 }}
          value={filters.tag}
          onChange={(v) => { setPage(1); setFilters((f) => ({ ...f, tag: v })); }}
          options={(settings?.tags ?? []).map((v) => ({ value: v, label: v }))}
        />
        <Popover content={moreFilters} trigger="click" placement="bottomLeft" title="More filters">
          <Button size="small">More filters</Button>
        </Popover>

        <span style={{ flex: 1 }} />
        <Button type="primary" onClick={() => setAddOpen(true)}>+ Add Case</Button>
      </div>

      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        onChange={(_p, _f, sorter: any) => {
          if (sorter?.field) {
            // server sort hook (only uploadedAt wired)
          }
        }}
        pagination={{
          current: page,
          pageSize: perPage,
          total,
          showSizeChanger: true,
          pageSizeOptions: [10, 15, 25, 50],
          onChange: (p, ps) => { setPage(p); setPerPage(ps); },
          showTotal: (t) => `${t} cases`,
        }}
      />

      <AddCaseModal
        open={addOpen}
        settings={settings}
        referrers={referrers}
        onClose={() => setAddOpen(false)}
        onCreated={(c) => {
          setAddOpen(false);
          message.success(`Case ${c.caseNumber} created`);
          load();
          setDrawerId(c.id);
        }}
      />

      <CaseDrawer
        caseId={drawerId}
        settings={settings}
        referrers={referrers}
        onClose={() => setDrawerId(null)}
        onChanged={load}
        onOpenViewer={openViewer}
      />

      <SeriesPickerModal
        theCase={seriesPickCase}
        onClose={() => setSeriesPickCase(null)}
        onView={(uids) => {
          if (seriesPickCase) openViewer(seriesPickCase, uids);
          setSeriesPickCase(null);
        }}
      />
    </div>
  );
}
