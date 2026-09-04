import { useRef, useState } from 'react';
import { Modal, Upload, Select, Input, Progress, Alert, Typography } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { api, type AppSettings, type CaseView, type ReferringDoctor } from '../../api/client';

const { Dragger } = Upload;
const { Text } = Typography;

/**
 * Upload a scanned study: the tech drops the DICOM folder (a CT/MR series is a
 * stack of .dcm slices — that stack *is* the 3D data). The API parses them,
 * groups by StudyInstanceUID and creates a case linked to the images.
 */
export function UploadStudyModal({
  open,
  settings,
  referrers,
  onClose,
  onDone,
}: {
  open: boolean;
  settings: AppSettings | null;
  referrers: ReferringDoctor[];
  onClose: () => void;
  onDone: (created: CaseView[]) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [branchId, setBranchId] = useState<string>();
  const [referrer, setReferrer] = useState<string>();
  const [history, setHistory] = useState('');
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFiles([]); setBranchId(undefined); setReferrer(undefined);
    setHistory(''); setBusy(false); setPct(0); setErr(null);
  };

  const submit = async () => {
    if (!files.length) return;
    setBusy(true); setErr(null); setPct(8);
    const timer = setInterval(() => setPct((p) => Math.min(p + 4, 92)), 400);
    try {
      const ref = referrers.find((d) => d.id === referrer);
      const res = await api.uploadStudy(files, {
        branchId: branchId ?? '',
        referringDoctorName: ref?.name ?? '',
        referringDoctorMobile: ref?.phone ?? '',
        patientHistory: history,
      });
      clearInterval(timer); setPct(100);
      onDone(res.created);
      reset();
    } catch (e) {
      clearInterval(timer);
      setErr(String((e as Error).message || e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Upload study (DICOM)"
      open={open}
      onCancel={() => { if (!busy) { reset(); onClose(); } }}
      onOk={submit}
      okText={busy ? 'Uploading…' : `Upload ${files.length || ''} file(s)`}
      okButtonProps={{ disabled: !files.length || busy, loading: busy }}
      width={560}
      maskClosable={!busy}
    >
      <Dragger
        multiple
        beforeUpload={(f) => { setFiles((prev) => [...prev, f as unknown as File]); return false; }}
        fileList={[]}
        showUploadList={false}
        disabled={busy}
        style={{ padding: 8 }}
      >
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">Drop DICOM files here, or click to pick</p>
        <p className="ant-upload-hint" style={{ fontSize: 12 }}>
          A whole series folder is fine (100s of .dcm files). Non-DICOM files are ignored.
        </p>
      </Dragger>

      <button
        type="button"
        className="linklike"
        style={{ marginTop: 6 }}
        onClick={() => folderRef.current?.click()}
        disabled={busy}
      >
        …or select an entire folder
      </button>
      <input
        ref={folderRef}
        type="file"
        multiple
        // @ts-expect-error non-standard but widely supported
        webkitdirectory=""
        directory=""
        style={{ display: 'none' }}
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
      />

      {files.length > 0 && (
        <Text type="secondary" style={{ display: 'block', margin: '8px 0' }}>
          {files.length} file(s) queued
          {' · '}
          {(files.reduce((n, f) => n + f.size, 0) / 1e6).toFixed(1)} MB
          {' · '}
          <a onClick={() => setFiles([])}>clear</a>
        </Text>
      )}

      <div className="upload-meta">
        <label>Scan Center Branch</label>
        <Select
          allowClear placeholder="Optional" style={{ width: '100%' }}
          value={branchId} onChange={setBranchId} disabled={busy}
          options={(settings?.branches ?? []).map((b) => ({ value: b.id, label: b.name }))}
        />
        <label>Referring Doctor</label>
        <Select
          allowClear showSearch optionFilterProp="label" placeholder="Optional"
          style={{ width: '100%' }} value={referrer} onChange={setReferrer} disabled={busy}
          options={referrers.map((d) => ({ value: d.id, label: d.name }))}
        />
        <label>Patient History</label>
        <Input.TextArea
          rows={2} value={history} onChange={(e) => setHistory(e.target.value)}
          disabled={busy} placeholder="Optional"
        />
      </div>

      {busy && <Progress percent={pct} size="small" style={{ marginTop: 12 }} />}
      {err && <Alert type="error" showIcon style={{ marginTop: 12 }} message={err} />}
    </Modal>
  );
}
