import { useState } from 'react';
import { Input, Button, Space } from 'antd';
import { WhatsAppOutlined } from '@ant-design/icons';

/** Opens a prefilled WhatsApp compose window — the user still reviews and
 *  hits send themselves inside WhatsApp, this only builds the message. */
export function WhatsAppSharePopover({
  phoneDefault,
  text,
}: {
  phoneDefault?: string;
  text: string;
}) {
  const [phone, setPhone] = useState(phoneDefault ?? '');
  const [msg, setMsg] = useState(text);

  const send = () => {
    const digits = phone.replace(/[^\d+]/g, '').replace(/^\+/, '');
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div style={{ width: 300 }}>
      <div className="fld-label">WhatsApp number</div>
      <Input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="+91 98765 43210"
        style={{ marginBottom: 10 }}
      />
      <div className="fld-label">Message</div>
      <Input.TextArea
        rows={4}
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
        style={{ marginBottom: 10 }}
      />
      <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
        <Button
          type="primary"
          icon={<WhatsAppOutlined />}
          disabled={!phone.trim()}
          onClick={send}
        >
          Open WhatsApp
        </Button>
      </Space>
    </div>
  );
}
