import { useEffect, useState } from 'react';
import { Typography, Empty, Spin } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api, type ChatThread } from '../api/client';
import { CaseChatPopover } from './cases/CaseChatPopover';

const { Title } = Typography;

function ago(iso: string) {
  const s = (Date.now() - +new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function ChatsPage() {
  const nav = useNavigate();
  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [active, setActive] = useState<string | null>(null);

  const load = () => api.chatThreads().then(setThreads).catch(() => setThreads([]));
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="page">
      <Title level={4}>Chats</Title>
      <p className="dim">
        Case discussion between the scan centre and radiologists. Each thread is
        tied to a case; open one from a case row's chat icon too.
      </p>

      <div className="chats-layout">
        <div className="chats-list">
          {threads == null ? (
            <Spin />
          ) : threads.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No conversations yet"
            />
          ) : (
            threads.map((t) => (
              <button
                key={t.id}
                className={`chats-item${active === t.id ? ' active' : ''}`}
                onClick={() => setActive(t.id)}
              >
                <div className="chats-item-top">
                  <b>{t.patientName || t.caseId}</b>
                  <span className="dim">{ago(t.updatedAt)}</span>
                </div>
                <div className="dim ellip">
                  {t.messages[t.messages.length - 1]?.text ?? 'No messages'}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="chats-thread">
          {active ? (
            <>
              <div className="chats-thread-head">
                <b>
                  {threads?.find((t) => t.id === active)?.patientName ?? active}
                </b>
                <a onClick={() => nav(`/?case=${active}`)}>open case →</a>
              </div>
              <CaseChatPopover caseId={active} onPosted={load} />
            </>
          ) : (
            <div className="dim" style={{ padding: 24 }}>
              Select a conversation
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
