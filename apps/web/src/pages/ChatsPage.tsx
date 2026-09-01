import { useState } from 'react';
import { Input, Button, Typography } from 'antd';

const { Title } = Typography;

// Lightweight stand-in for RadioLinQ's referrer↔radiologist chat. Local only.
const SEED = [
  { from: 'Dr. Ramesh Gupta (Referrer)', text: 'Any update on the CT brain for patient 100647?', me: false },
  { from: 'Dr. Anitha Rao (Radiologist)', text: 'Reviewing now — will sign within the hour.', me: true },
];

export function ChatsPage() {
  const [msgs, setMsgs] = useState(SEED);
  const [draft, setDraft] = useState('');
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <Title level={4}>Chats</Title>
      <p className="dim">
        Case discussion between referring physicians and radiologists. This is a
        local placeholder — messages are not sent anywhere.
      </p>
      <div className="chat-thread">
        {msgs.map((m, i) => (
          <div key={i} className={`chat-msg${m.me ? ' me' : ''}`}>
            <div className="chat-from">{m.from}</div>
            <div className="chat-bubble">{m.text}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={() => {
            if (!draft.trim()) return;
            setMsgs((m) => [...m, { from: 'You', text: draft, me: true }]);
            setDraft('');
          }}
          placeholder="Type a message…"
        />
        <Button
          type="primary"
          onClick={() => {
            if (!draft.trim()) return;
            setMsgs((m) => [...m, { from: 'You', text: draft, me: true }]);
            setDraft('');
          }}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
