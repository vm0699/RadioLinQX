import { useEffect, useState } from 'react';
import {
  Drawer, Descriptions, Tag, Select, Button, Input, Space, Divider, App as AntdApp,
  Segmented, Spin,
} from 'antd';
import dayjs from 'dayjs';
import {
  api, type AppSettings, type CaseView, type CaseReport, type ReferringDoctor,
} from '../../api/client';
import { StatusTag } from './cells';

const BLANK: CaseReport = {
  clinicalHistory: '', technique: '', findings: '', impression: '', updatedAt: '',
};

export function CaseDrawer({
  caseId,
  settings,
  onClose,
  onChanged,
  onOpenViewer,
}: {
  caseId: string | null;
  settings: AppSettings | null;
  referrers: ReferringDoctor[];
  onClose: () => void;
  onChanged: () => void;
  onOpenViewer: (c: CaseView) => void;
}) {
  const { message } = AntdApp.useApp();
  const [c, setC] = useState<CaseView | null>(null);
  const [loading, setLoading] = useState(false);
  const [pane, setPane] = useState<'details' | 'report'>('details');
  const [report, setReport] = useState<CaseReport>(BLANK);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!caseId) {
      setC(null);
      return;
    }
    setLoading(true);
    api
      .getCase(caseId)
      .then((x) => {
        setC(x);
        setReport(x.report ?? BLANK);
        setPane(x.status === 'REPORTED' || x.status === 'DRAFT' ? 'report' : 'details');
      })
      .catch((e) => message.error(String(e)))
      .finally(() => setLoading(false));
  }, [caseId, message]);

  const refresh = async () => {
    if (!caseId) return;
    const x = await api.getCase(caseId);
    setC(x);
    onChanged();
  };

  const assign = async (radId: string) => {
    if (!c) return;
    await api.assignCase(c.id, radId);
    message.success('Assigned');
    refresh();
  };

  const saveReport = async (action: 'save' | 'sign') => {
    if (!c) return;
    setSaving(true);
    try {
      await api.saveReport(c.id, report, action);
      message.success(action === 'sign' ? 'Report signed' : 'Draft saved');
      refresh();
    } catch (e) {
      message.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      width={620}
      open={!!caseId}
      onClose={onClose}
      title={c ? `${c.patientName} · ${c.caseNumber}` : 'Case'}
      extra={
        c && (
          <Space>
            {c.hasImages && (
              <Button type="primary" onClick={() => onOpenViewer(c)}>
                Open viewer
              </Button>
            )}
          </Space>
        )
      }
    >
      {loading || !c ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : (
        <>
          <Space wrap style={{ marginBottom: 12 }}>
            <StatusTag status={c.status} />
            <Tag>{c.scanType}</Tag>
            {c.contrast === 'Yes' && <Tag color="volcano">Contrast</Tag>}
            {c.tags.map((t) => <Tag key={t} color="geekblue">{t}</Tag>)}
          </Space>

          <Segmented
            block
            value={pane}
            onChange={(v) => setPane(v as typeof pane)}
            options={[
              { label: 'Details', value: 'details' },
              { label: 'Report', value: 'report' },
            ]}
            style={{ marginBottom: 16 }}
          />

          {pane === 'details' ? (
            <>
              <Descriptions column={2} size="small" bordered>
                <Descriptions.Item label="Patient ID">{c.patientId}</Descriptions.Item>
                <Descriptions.Item label="Age / Sex">
                  {c.patientAge ?? '—'} / {c.patientSex ?? '—'}
                </Descriptions.Item>
                <Descriptions.Item label="Mobile">{c.patientMobile ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="Study">
                  {c.studyDescription ?? (c.bodyParts.join(', ') || '—')}
                </Descriptions.Item>
                <Descriptions.Item label="Body parts" span={2}>
                  {c.bodyParts.join(', ') || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="Referring Dr" span={2}>
                  {c.referringDoctorName ?? '—'}
                  {c.referringDoctorMobile ? ` · ${c.referringDoctorMobile}` : ''}
                </Descriptions.Item>
                <Descriptions.Item label="Uploaded">
                  {dayjs(c.uploadedAt).format('DD MMM YY, HH:mm')}
                </Descriptions.Item>
                <Descriptions.Item label="Due">
                  {dayjs(c.dueAt).format('DD MMM YY, HH:mm')}
                </Descriptions.Item>
                <Descriptions.Item label="Images">
                  {c.hasImages ? `${c.imageCount} img · ${c.seriesCount} series` : 'No images'}
                </Descriptions.Item>
                <Descriptions.Item label="Upload status">{c.uploadStatus}</Descriptions.Item>
                <Descriptions.Item label="Patient history" span={2}>
                  {c.patientHistory || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="Remarks" span={2}>{c.remarks || '—'}</Descriptions.Item>
              </Descriptions>

              <Divider />
              <label className="fld-label">Assign radiologist</label>
              <Select
                style={{ width: '100%' }}
                placeholder="Select radiologist"
                value={c.assignedRadiologistId}
                onChange={assign}
                options={(settings?.radiologists ?? [])
                  .filter((r) => r.active)
                  .map((r) => ({ value: r.id, label: `${r.name} · ${r.specialties.join('/')}` }))}
              />

              <label className="fld-label" style={{ marginTop: 12 }}>Tags</label>
              <Select
                mode="tags" style={{ width: '100%' }}
                value={c.tags}
                onChange={async (tags) => { await api.updateCase(c.id, { tags }); refresh(); }}
                options={(settings?.tags ?? []).map((t) => ({ value: t, label: t }))}
              />
            </>
          ) : (
            <>
              {['clinicalHistory', 'technique', 'findings', 'impression'].map((k) => (
                <div key={k} style={{ marginBottom: 12 }}>
                  <label className="fld-label" style={{ textTransform: 'capitalize' }}>
                    {k.replace(/([A-Z])/g, ' $1')}
                  </label>
                  <Input.TextArea
                    rows={k === 'findings' ? 6 : 3}
                    value={(report as any)[k]}
                    disabled={c.status === 'REPORTED'}
                    onChange={(e) => setReport((r) => ({ ...r, [k]: e.target.value }))}
                  />
                </div>
              ))}
              {c.report?.signedBy && (
                <p className="dim">
                  Signed by {c.report.signedBy} on{' '}
                  {dayjs(c.report.signedAt).format('DD MMM YY, HH:mm')}
                </p>
              )}
              <Space>
                {c.status === 'REPORTED' ? (
                  <Button
                    onClick={async () => {
                      await api.updateCase(c.id, { status: 'DRAFT', reportedAt: undefined });
                      refresh();
                    }}
                  >
                    Reopen for editing
                  </Button>
                ) : (
                  <>
                    <Button loading={saving} onClick={() => saveReport('save')}>
                      Save draft
                    </Button>
                    <Button type="primary" loading={saving} onClick={() => saveReport('sign')}>
                      Sign &amp; finalise
                    </Button>
                  </>
                )}
              </Space>
            </>
          )}
        </>
      )}
    </Drawer>
  );
}
