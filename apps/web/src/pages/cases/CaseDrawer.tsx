import { useEffect, useRef, useState } from 'react';
import {
  Drawer, Descriptions, Tag, Select, Button, Input, Space, Divider, App as AntdApp,
  Segmented, Spin, List, Popover, Alert,
} from 'antd';
import {
  PaperClipOutlined, DownloadOutlined, FileWordOutlined, UploadOutlined, WhatsAppOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  api, type AppSettings, type CaseView, type CaseReport, type ReferringDoctor,
} from '../../api/client';
import { StatusTag } from './cells';
import { CaseHistoryPopover } from './CaseHistoryPopover';
import { WhatsAppSharePopover } from './WhatsAppSharePopover';

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
  const [pane, setPane] = useState<'details' | 'report' | 'files'>('details');
  const [report, setReport] = useState<CaseReport>(BLANK);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importingDocx, setImportingDocx] = useState(false);
  const [openingWord, setOpeningWord] = useState(false);
  const [wordSessionActive, setWordSessionActive] = useState(false);
  const [lastWordSyncAt, setLastWordSyncAt] = useState<string | null>(null);
  const saveReportRef = useRef<((action: 'save' | 'sign') => void) | null>(null);
  const attInput = useRef<HTMLInputElement>(null);
  const reportFileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!caseId) {
      setC(null);
      setWordSessionActive(false);
      setLastWordSyncAt(null);
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

  // Keep a ref to the latest saveReport so Ctrl+S handler never captures stale closures
  useEffect(() => {
    saveReportRef.current = saveReport;
  });

  // 1-Click Keyboard Shortcut: Ctrl+S / Cmd+S saves report draft immediately
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveReportRef.current?.('save');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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

  const importReportDocx = async (file: File) => {
    if (!c) return;
    setImportingDocx(true);
    try {
      const updated = await api.importReportDocx(c.id, file);
      setC(updated);
      setReport(updated.report ?? BLANK);
      onChanged();
      message.success('Report updated from the uploaded Word document');
    } catch (e) {
      message.error(String((e as Error).message || e));
    } finally {
      setImportingDocx(false);
      if (reportFileInput.current) reportFileInput.current.value = '';
    }
  };

  const openInWord = async () => {
    if (!c) return;
    setOpeningWord(true);
    try {
      // Check if the local sync agent is running on port 4820
      let agentRunning = false;
      try {
        const probe = await fetch('http://127.0.0.1:4820/health', { signal: AbortSignal.timeout(1500) });
        agentRunning = probe.ok;
      } catch {
        agentRunning = false;
      }

      if (!agentRunning) {
        message.error({
          content: (
            <span>
              <b>Word Sync Agent is not running.</b><br />
              Double-click <b>start-word-sync.bat</b> in the project folder, then try again.<br />
              <span style={{ color: '#888', fontSize: 12 }}>
                (Lets Ctrl+S in Word save directly to RadioLinQ — no Save As dialog)
              </span>
            </span>
          ),
          duration: 8,
        });
        return;
      }

      // Ask agent to download docx locally and open Word with local file path
      const resp = await fetch(`http://127.0.0.1:4820/open/${c.id}`);
      if (!resp.ok) throw new Error('Agent returned ' + resp.status);
      setWordSessionActive(true);
      message.success({
        content: (
          <span>
            <b>Word is opening!</b> Press <b>Ctrl+S</b> inside Word to save directly to RadioLinQ — no Save As dialog.
          </span>
        ),
        duration: 6,
      });
    } catch (e: any) {
      message.error(`Failed to open Word: ${e.message || e}`);
    } finally {
      setOpeningWord(false);
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
              { label: 'Files & history', value: 'files' },
            ]}
            style={{ marginBottom: 16 }}
          />

          {pane === 'details' && (
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
          )}

          {pane === 'report' && (
            <>
              <div className="letterhead">
                <div className="letterhead-name">{settings?.scanCenter.name ?? 'Scan Centre'}</div>
                <div className="letterhead-meta">
                  {[settings?.scanCenter.contactEmail, settings?.scanCenter.contactPhone]
                    .filter(Boolean)
                    .join('  ·  ')}
                </div>
                <div className="letterhead-hr" />
                <div className="letterhead-facts">
                  <span><b>Patient:</b> {c.patientName} ({c.patientId})</span>
                  <span><b>Age/Sex:</b> {c.patientAge ?? '—'}/{c.patientSex ?? '—'}</span>
                  <span><b>Case No.:</b> {c.caseNumber}</span>
                  <span><b>Study:</b> {c.scanType} — {c.studyDescription ?? (c.bodyParts.join(', ') || '—')}</span>
                </div>
                {['clinicalHistory', 'technique', 'findings', 'impression'].map((k) => (
                  <div className="letterhead-section" key={k}>
                    <div className="letterhead-title">{k.replace(/([A-Z])/g, ' $1')}</div>
                    <div className="letterhead-body">{(report as any)[k] || '—'}</div>
                  </div>
                ))}
                {c.report?.signedBy && (
                  <p className="dim" style={{ marginTop: 10, fontStyle: 'italic' }}>
                    Electronically signed by {c.report.signedBy} on{' '}
                    {dayjs(c.report.signedAt).format('DD MMM YY, HH:mm')}
                  </p>
                )}
              </div>

              <div style={{
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: 8,
                padding: '12px 14px',
                margin: '16px 0 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8
              }}>
                <Space wrap>
                  <Button
                    type="primary"
                    size="middle"
                    loading={saving}
                    disabled={c.status === 'REPORTED'}
                    onClick={() => saveReport('save')}
                    style={{ background: '#10B981', borderColor: '#10B981', fontWeight: 600 }}
                  >
                    💾 Save Draft (1-Click / Ctrl+S)
                  </Button>
                  <Button
                    type="primary"
                    size="middle"
                    loading={saving}
                    disabled={c.status === 'REPORTED'}
                    onClick={() => saveReport('sign')}
                    style={{ background: '#2563EB', fontWeight: 600 }}
                  >
                    ✍️ Sign &amp; Finalise
                  </Button>
                  {c.status === 'REPORTED' && (
                    <Button
                      onClick={async () => {
                        await api.updateCase(c.id, { status: 'DRAFT', reportedAt: undefined });
                        refresh();
                      }}
                    >
                      Reopen for editing
                    </Button>
                  )}
                </Space>

                <Space wrap>
                  <Button
                    icon={<UploadOutlined style={{ color: '#2563EB' }} />}
                    loading={importingDocx}
                    onClick={() => reportFileInput.current?.click()}
                    style={{ fontWeight: 500 }}
                  >
                    1-Click Import Word (.docx)
                  </Button>
                  <Button
                    icon={<DownloadOutlined />}
                    href={api.caseReportDocxUrl(c.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download .docx
                  </Button>
                  <Button
                    icon={<FileWordOutlined style={{ color: '#2563EB' }} />}
                    loading={openingWord}
                    onClick={openInWord}
                  >
                    Open in Word
                  </Button>
                </Space>
              </div>

              {(wordSessionActive || lastWordSyncAt) && (
                <Alert
                  style={{ marginBottom: 12 }}
                  type="info"
                  showIcon
                  icon={<SyncOutlined spin={wordSessionActive} />}
                  message={
                    <Space wrap>
                      <span>
                        <strong>Word Document:</strong> Once you edit in Word, drop the file below or click <b>"1-Click Import Word (.docx)"</b> to save into the site immediately.
                      </span>
                      {lastWordSyncAt && (
                        <Tag color="green">
                          Last synced: {dayjs(lastWordSyncAt).format('HH:mm:ss')}
                        </Tag>
                      )}
                    </Space>
                  }
                />
              )}

              <div
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const f = e.dataTransfer.files?.[0];
                  if (f && f.name.endsWith('.docx')) {
                    importReportDocx(f);
                  } else {
                    message.warning('Please drop a valid .docx file');
                  }
                }}
                onClick={() => reportFileInput.current?.click()}
                style={{
                  border: '1.5px dashed #3B82F6',
                  borderRadius: 8,
                  padding: '10px 14px',
                  background: '#EFF6FF',
                  cursor: 'pointer',
                  textAlign: 'center',
                  marginBottom: 14,
                  transition: 'all 0.2s',
                }}
              >
                <Space size={8}>
                  <UploadOutlined style={{ color: '#2563EB', fontSize: 16 }} />
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#1E40AF' }}>
                    {importingDocx ? 'Saving report into site in 1 click...' : 'Drop saved Word document (.docx) here to save into site in 1 click'}
                  </span>
                </Space>
              </div>

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

              <Space wrap style={{ marginBottom: 14 }}>
                <Button
                  icon={<FileWordOutlined />}
                  href={api.caseReportDocxUrl(c.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download Word (.docx)
                </Button>
                <input
                  ref={reportFileInput}
                  type="file"
                  accept=".docx"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importReportDocx(f);
                  }}
                />
                <Button
                  icon={<UploadOutlined />}
                  loading={importingDocx}
                  onClick={() => reportFileInput.current?.click()}
                >
                  Upload edited Word doc
                </Button>
                <Popover
                  trigger="click"
                  placement="bottomLeft"
                  title="Share report on WhatsApp"
                  content={
                    <WhatsAppSharePopover
                      phoneDefault={c.referringDoctorMobile || c.patientMobile}
                      text={`${c.caseNumber} — ${c.patientName}: radiology report.\nDownload: ${api.caseReportDocxUrl(c.id)}`}
                    />
                  }
                >
                  <Button icon={<WhatsAppOutlined />}>Share via WhatsApp</Button>
                </Popover>
              </Space>

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

          {pane === 'files' && (
            <>
              <label className="fld-label">Case attachments</label>
              <p className="dim" style={{ marginTop: 2 }}>
                Prior reports, lab results, consent forms, key screenshots.
              </p>
              <input
                ref={attInput}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (!files.length) return;
                  setUploading(true);
                  try {
                    const updated = await api.addAttachments(c.id, files);
                    setC(updated);
                    onChanged();
                    message.success(`Attached ${files.length} file(s)`);
                  } catch (err) {
                    message.error(String((err as Error).message || err));
                  } finally {
                    setUploading(false);
                    if (attInput.current) attInput.current.value = '';
                  }
                }}
              />
              <Button
                icon={<PaperClipOutlined />}
                loading={uploading}
                onClick={() => attInput.current?.click()}
              >
                Add attachment
              </Button>

              <List
                size="small"
                style={{ marginTop: 10 }}
                locale={{ emptyText: 'No attachments' }}
                dataSource={c.attachments ?? []}
                renderItem={(a) => (
                  <List.Item
                    actions={[
                      <a
                        key="dl"
                        href={api.attachmentUrl(c.id, a.id)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <DownloadOutlined />
                      </a>,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={<PaperClipOutlined />}
                      title={a.name}
                      description={
                        <span className="dim">
                          {(a.size / 1024).toFixed(0)} KB ·{' '}
                          {dayjs(a.uploadedAt).format('DD MMM YY, HH:mm')}
                        </span>
                      }
                    />
                  </List.Item>
                )}
              />

              <Divider />
              <label className="fld-label">History</label>
              <CaseHistoryPopover caseId={c.id} />
            </>
          )}
        </>
      )}
    </Drawer>
  );
}
