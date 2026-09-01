import { Modal, Form, Input, InputNumber, Select, Row, Col } from 'antd';
import { useEffect } from 'react';
import { api, type AppSettings, type CaseView, type ReferringDoctor } from '../../api/client';

export function AddCaseModal({
  open,
  settings,
  referrers,
  onClose,
  onCreated,
}: {
  open: boolean;
  settings: AppSettings | null;
  referrers: ReferringDoctor[];
  onClose: () => void;
  onCreated: (c: CaseView) => void;
}) {
  const [form] = Form.useForm();

  useEffect(() => {
    if (open) form.resetFields();
  }, [open, form]);

  const submit = async () => {
    const v = await form.validateFields();
    const ref = referrers.find((d) => d.id === v.referringDoctorId);
    const c = await api.createCase({
      patientId: v.patientId,
      patientName: v.patientName,
      patientMobile: v.patientMobile,
      patientAge: v.patientAge,
      patientSex: v.patientSex,
      scanType: v.scanType,
      bodyParts: v.bodyParts ?? [],
      branchId: v.branchId,
      studyDescription: v.studyDescription,
      contrast: v.contrast,
      referringDoctorId: v.referringDoctorId,
      referringDoctorName: ref?.name ?? v.referringDoctorName,
      referringDoctorMobile: ref?.phone ?? v.referringDoctorMobile,
      patientHistory: v.patientHistory,
      remarks: v.remarks,
    });
    onCreated(c);
  };

  return (
    <Modal
      title="Add Case"
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="Add"
      width={640}
      destroyOnClose
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="patientId" label="Patient ID" rules={[{ required: true }]}>
              <Input placeholder="Enter Patient ID" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="patientName" label="Patient name" rules={[{ required: true }]}>
              <Input placeholder="Enter Patient name" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="patientMobile" label="Patient Mobile Number">
              <Input placeholder="Enter Patient Mobile Number" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="patientAge" label="Age">
              <InputNumber min={0} max={130} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="patientSex" label="Gender">
              <Select
                placeholder="Select"
                options={['M', 'F', 'O'].map((v) => ({ value: v, label: v }))}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="scanType" label="Scan Type" rules={[{ required: true }]}>
              <Select
                placeholder="Select Scan Type"
                options={(settings?.scanTypes ?? []).map((v) => ({ value: v, label: v }))}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="bodyParts" label="Body parts">
              <Select
                mode="multiple"
                placeholder="Select Body parts"
                options={(settings?.bodyParts ?? []).map((v) => ({ value: v, label: v }))}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="branchId" label="Scan Center Branch">
              <Select
                placeholder="Select Branch"
                options={(settings?.branches ?? []).map((b) => ({ value: b.id, label: b.name }))}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="contrast" label="Contrast" initialValue="No">
              <Select options={[{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }]} />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="studyDescription" label="Study Description">
              <Input placeholder="Enter Study description" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="referringDoctorId" label="Referring Doctor">
              <Select
                allowClear showSearch optionFilterProp="label"
                placeholder="Select referring doctor"
                options={referrers.map((d) => ({ value: d.id, label: d.name }))}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="referringDoctorMobile" label="Referring Doctor Mobile">
              <Input placeholder="Optional" />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="patientHistory" label="Patient History">
              <Input.TextArea rows={2} placeholder="Enter Patient History" />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="remarks" label="Remarks">
              <Input.TextArea rows={2} placeholder="Enter any remarks (optional)" />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
