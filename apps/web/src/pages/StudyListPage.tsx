import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Input, Button, Tag, Typography, App as AntdApp } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api, type StudySummary, type SeriesSummary } from '../api/client';
import { SeriesDialog } from '../viewer/SeriesDialog';

const { Title } = Typography;

function fmtDate(d?: string) {
  if (!d || d.length < 8) return d ?? '';
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

export function StudyListPage() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [rows, setRows] = useState<StudySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [dialogStudy, setDialogStudy] = useState<StudySummary | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .listStudies({ limit: '200' })
      .then(setRows)
      .catch((e) => message.error(String(e)))
      .finally(() => setLoading(false));
  }, [message]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        (r.patientName ?? '').toLowerCase().includes(s) ||
        (r.patientId ?? '').toLowerCase().includes(s) ||
        (r.studyDescription ?? '').toLowerCase().includes(s),
    );
  }, [rows, q]);

  const columns: ColumnsType<StudySummary> = [
    { title: 'Patient ID', dataIndex: 'patientId', width: 130 },
    { title: 'Patient name', dataIndex: 'patientName' },
    {
      title: 'Study',
      render: (_, r) =>
        `${r.modalities ?? ''}${r.studyDescription ? ` - ${r.studyDescription}` : ''}`,
    },
    { title: 'Date', render: (_, r) => fmtDate(r.studyDate), width: 120 },
    {
      title: 'Series / Images',
      width: 130,
      render: (_, r) => (
        <span className="dim">
          {r.seriesCount ?? '?'} / {r.instanceCount ?? '?'}
        </span>
      ),
    },
    {
      title: 'Modality',
      width: 110,
      render: (_, r) =>
        (r.modalities ?? '')
          .split('\\')
          .filter(Boolean)
          .map((m) => <Tag key={m}>{m}</Tag>),
    },
    {
      title: 'Actions',
      width: 130,
      render: (_, r) => (
        <Button size="small" onClick={() => setDialogStudy(r)}>
          View series
        </Button>
      ),
    },
  ];

  const onView = (study: StudySummary, series: SeriesSummary[]) => {
    const seriesParam = series.map((s) => s.seriesInstanceUid).join(',');
    navigate(
      `/viewer?study=${encodeURIComponent(study.studyInstanceUid)}&series=${encodeURIComponent(
        seriesParam,
      )}`,
    );
  };

  return (
    <div className="page">
      <div className="page-head">
        <Title level={4} style={{ margin: 0 }}>
          Studies
        </Title>
        <Input.Search
          placeholder="Patient name / ID / description"
          allowClear
          style={{ maxWidth: 340 }}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <Table
        rowKey="studyInstanceUid"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={filtered}
        pagination={{ pageSize: 15, showSizeChanger: true }}
      />

      <SeriesDialog
        study={dialogStudy}
        open={!!dialogStudy}
        onClose={() => setDialogStudy(null)}
        onView={onView}
      />
    </div>
  );
}
