import { useEffect, useRef, useState } from 'react';
import { Input, Button, Spin, Empty } from 'antd';
import { api, type ChatThread } from '../../api/client';

function ago(iso: string) {
  const s = (Date.now() - +new Date(iso)) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function CaseChatPopover({
  caseId,
  onPosted,
}: {
  caseId: string;
  onPosted?: () => void;
}) {
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.caseChat(caseId).then(setThread).catch(() => setThread(null));
  }, [caseId]);

  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [thread]);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const t = await api.postCaseChat(caseId, text.trim());
      setThread(t);
      setText('');
      onPosted?.();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="case-chat">
      <div className="case-chat-list" ref={listRef}>
        {thread == null ? (
          <Spin />
        ) : thread.messages.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No messages" />
        ) : (
          thread.messages.map((m) => (
            <div key={m.id} className={`msg role-${m.role}`}>
              <div className="msg-head">
                <b>{m.author}</b> <span className="dim">· {ago(m.at)}</span>
              </div>
              <div>{m.text}</div>
            </div>
          ))
        )}
      </div>
      <div className="case-chat-input">
        <Input.TextArea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Message the radiologist…"
        />
        <Button type="primary" size="small" loading={sending} onClick={send}>
          Send
        </Button>
      </div>
    </div>
  );
}
