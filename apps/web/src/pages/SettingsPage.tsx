import { useEffect, useState } from 'react';
import {
  Tabs, Form, Input, Button, Table, Select, Space, App as AntdApp, Typography,
  Tag, InputNumber,
} from 'antd';
import { api, type AppSettings } from '../api/client';

const { Title } = Typography;

export function SettingsPage() {
  const { message } = AntdApp.useApp();
  const [s, setS] = useState<AppSettings | null>(null);

  useEffect(() => {
    api.getSettings().then(setS).catch((e) => message.error(String(e)));
  }, [message]);

  const save = async (patch: Partial<AppSettings>) => {
    const next = await api.updateSettings(patch);
    setS(next);
    message.success('Settings saved');
  };

  if (!s) return <div className="page">Loading…</div>;

  return (
    <div className="page">
      <Title level={4}>Settings</Title>
      <Tabs
        items={[
          {
            key: 'center',
            label: 'Scan Center',
            children: (
              <Form
                layout="vertical"
                style={{ maxWidth: 480 }}
                initialValues={s.scanCenter}
                onFinish={(v) => save({ scanCenter: v })}
              >
                <Form.Item name="name" label="Name"><Input /></Form.Item>
                <Form.Item name="aet" label="DICOM AE Title"><Input /></Form.Item>
                <Form.Item name="contactEmail" label="Contact email"><Input /></Form.Item>
                <Form.Item name="contactPhone" label="Contact phone"><Input /></Form.Item>
                <Button type="primary" htmlType="submit">Save</Button>
              </Form>
            ),
          },
          {
            key: 'branches',
            label: 'Branches',
            children: (
              <EditableList
                items={s.branches.map((b) => `${b.name} (${b.code})`)}
                onChange={(list) =>
                  save({
                    branches: list.map((line, i) => {
                      const m = line.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
                      return {
                        id: s.branches[i]?.id ?? `br-${Date.now()}-${i}`,
                        name: (m?.[1] ?? line).trim(),
                        code: (m?.[2] ?? 'BR').trim(),
                      };
                    }),
                  })
                }
                hint='One per line, e.g. "Main Centre (MAIN)"'
              />
            ),
          },
          {
            key: 'refdata',
            label: 'Reference data',
            children: (
              <Space direction="vertical" size="large" style={{ width: '100%', maxWidth: 640 }}>
                <TagEditor label="Scan types" value={s.scanTypes} onSave={(v) => save({ scanTypes: v })} />
                <TagEditor label="Body parts" value={s.bodyParts} onSave={(v) => save({ bodyParts: v })} />
                <TagEditor label="Case tags" value={s.tags} onSave={(v) => save({ tags: v })} />
              </Space>
            ),
          },
          {
            key: 'rads',
            label: 'Radiologists',
            children: (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={s.radiologists}
                columns={[
                  { title: 'Name', dataIndex: 'name' },
                  { title: 'Email', dataIndex: 'email' },
                  {
                    title: 'Specialties',
                    dataIndex: 'specialties',
                    render: (v: string[]) => v.map((x) => <Tag key={x}>{x}</Tag>),
                  },
                  {
                    title: 'Active',
                    dataIndex: 'active',
                    width: 90,
                    render: (v: boolean, r) => (
                      <Select
                        size="small"
                        value={v ? 'yes' : 'no'}
                        style={{ width: 72 }}
                        onChange={(nv) =>
                          save({
                            radiologists: s.radiologists.map((x) =>
                              x.id === r.id ? { ...x, active: nv === 'yes' } : x,
                            ),
                          })
                        }
                        options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
                      />
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'tat',
            label: 'TAT / SLA',
            children: (
              <div style={{ maxWidth: 420 }}>
                <p className="dim">Turnaround target (hours) by scan type. "*" is the fallback.</p>
                {Object.entries(s.tat.targetHoursByScanType).map(([k, v]) => (
                  <Space key={k} style={{ display: 'flex', marginBottom: 8 }}>
                    <Tag style={{ width: 60, textAlign: 'center' }}>{k}</Tag>
                    <InputNumber
                      min={1}
                      max={240}
                      value={v}
                      onChange={(nv) =>
                        nv != null &&
                        save({
                          tat: {
                            ...s.tat,
                            targetHoursByScanType: { ...s.tat.targetHoursByScanType, [k]: nv },
                          },
                        })
                      }
                    />
                    <span className="dim">hours</span>
                  </Space>
                ))}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

function TagEditor({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string[];
  onSave: (v: string[]) => void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div>
      <label className="fld-label">{label}</label>
      <Select mode="tags" style={{ width: '100%' }} value={v} onChange={setV} open={false} />
      <Button size="small" style={{ marginTop: 8 }} onClick={() => onSave(v)}>Save {label.toLowerCase()}</Button>
    </div>
  );
}

function EditableList({
  items,
  onChange,
  hint,
}: {
  items: string[];
  onChange: (list: string[]) => void;
  hint?: string;
}) {
  const [text, setText] = useState(items.join('\n'));
  useEffect(() => setText(items.join('\n')), [items]);
  return (
    <div style={{ maxWidth: 480 }}>
      <Input.TextArea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
      {hint && <p className="dim">{hint}</p>}
      <Button
        size="small"
        onClick={() => onChange(text.split('\n').map((l) => l.trim()).filter(Boolean))}
      >
        Save
      </Button>
    </div>
  );
}
