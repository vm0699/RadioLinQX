import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Dropdown, Badge } from 'antd';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { NotificationsPanel } from './NotificationsPanel';

const NAV = [
  { key: '/', label: 'Cases' },
  { key: '/referring-doctors', label: 'Referring Doctors' },
  { key: '/settings', label: 'Settings' },
];

export function AppLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const active =
    NAV.slice()
      .reverse()
      .find((n) => (n.key === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.key)))
      ?.key ?? '/';

  const [notifOpen, setNotifOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let live = true;
    const tick = () =>
      api
        .notifUnread()
        .then((r) => live && setUnread(r.count))
        .catch(() => {});
    tick();
    const t = setInterval(tick, 20000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand" onClick={() => nav('/')}>
          <span className="brand-dot" />
          radiolinq
        </div>
        <nav className="topnav">
          {NAV.map((n) => (
            <button
              key={n.key}
              className={`topnav-item${active === n.key ? ' active' : ''}`}
              onClick={() => nav(n.key)}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <button className="icon-btn" title="Chats" onClick={() => nav('/chats')}>
            💬
          </button>
          <Dropdown
            open={notifOpen}
            onOpenChange={setNotifOpen}
            trigger={['click']}
            placement="bottomRight"
            dropdownRender={() => (
              <NotificationsPanel
                onNavigate={(caseId) => {
                  setNotifOpen(false);
                  nav(`/?case=${caseId}`);
                }}
                onChanged={() => api.notifUnread().then((r) => setUnread(r.count))}
              />
            )}
          >
            <button className="icon-btn" title="Notifications">
              <Badge count={unread} size="small" offset={[2, -2]}>
                <span>🔔</span>
              </Badge>
            </button>
          </Dropdown>
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                { key: 'center', label: 'Sunray Scans', disabled: true },
                { type: 'divider' },
                { key: 'settings', label: 'Settings' },
                { key: 'logout', label: 'Logout' },
              ],
              onClick: ({ key }) => {
                if (key === 'settings') nav('/settings');
              },
            }}
          >
            <button className="avatar" title="Account">
              SX
            </button>
          </Dropdown>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
