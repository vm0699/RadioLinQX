import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, App as AntdApp } from 'antd';
import { App } from './App';
import './styles.css';

/** Shared design tokens. Dashboard = light (set here); the viewer wraps its
 *  own subtree in a dark ConfigProvider (see ViewerPage).
 *  Primary #2563EB · Secondary #0EA5A4 (see styles.css :root). */
const PRIMARY = '#2563EB';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: PRIMARY,
          colorInfo: PRIMARY,
          colorLink: PRIMARY,
          colorSuccess: '#16A34A',
          colorWarning: '#D97706',
          colorError: '#DC2626',
          borderRadius: 8,
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          colorBgLayout: '#F5F7FB',
        },
        components: {
          Table: { headerBg: '#F8FAFC', headerColor: '#475569', rowHoverBg: '#F5F8FF' },
          Segmented: { itemSelectedBg: PRIMARY, itemSelectedColor: '#fff' },
          Tabs: { inkBarColor: PRIMARY, itemSelectedColor: PRIMARY },
        },
      }}
    >
      <AntdApp>
        <App />
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
);
