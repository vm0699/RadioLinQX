import { useEffect, useState } from 'react';
import {
  Table, Button, Modal, Form, Input, Space, App as AntdApp, Typography, Popconfirm,
} from 'antd';
import { api, type ReferringDoctor } from '../api/client';

const { Title } = Typography;

export function ReferringDoctorsPage() {
  const { message } = AntdApp.useApp();
  const [rows, setRows] = useState<ReferringDoctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ReferringDoctor | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const load = () => {
    setLoading(true);
    api.listReferrers().then(setRows).catch((e) => message.error(String(e))).finally(() => setLoading(false));
  };
  useEffect(load, []); // eslint-disable-line

  const openModal = (d?: ReferringDoctor) => {
    setEditing(d ?? null);
    form.setFieldsValue(d ?? { name: '', phone: '', email: '', hospital: '', speciality: '' });
    setOpen(true);
  };

  const submit = async () => {
    const v = await form.validateFields();
    if (editing) await api.updateReferrer(editing.id, v);
    else await api.createReferrer(v);
    message.success('Saved');
    setOpen(false);
    load();
  };

  return (
    <div className="page">
      <div className="page-head">
        <Title level={4} style={{ margin: 0 }}>Referring Doctors</Title>
        <Button type="primary" onClick={() => openModal()}>+ Add Doctor</Button>
      </div>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 15 }}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Phone', dataIndex: 'phone', width: 160 },
          { title: 'Email', dataIndex: 'email' },
          { title: 'Hospital / Clinic', dataIndex: 'hospital' },
          { title: 'Speciality', dataIndex: 'speciality', width: 160 },
          { title: 'Cases', dataIndex: 'casesReferred', width: 80 },
          {
            title: '',
            width: 130,
            render: (_, d) => (
              <Space>
                <Button size="small" type="link" onClick={() => openModal(d)}>Edit</Button>
                <Popconfirm title="Delete this doctor?" onConfirm={async () => { await api.deleteReferrer(d.id); load(); }}>
                  <Button size="small" type="link" danger>Delete</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={editing ? 'Edit Doctor' : 'Add Doctor'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        destroyOnClose
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="Phone" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email"><Input /></Form.Item>
          <Form.Item name="hospital" label="Hospital / Clinic"><Input /></Form.Item>
          <Form.Item name="speciality" label="Speciality"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
