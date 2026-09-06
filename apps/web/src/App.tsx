import { createBrowserRouter, RouterProvider, Navigate, useRouteError } from 'react-router-dom';
import { Button, Result } from 'antd';
import { AppLayout } from './app/AppLayout';
import { CasesPage } from './pages/CasesPage';
import { ReferringDoctorsPage } from './pages/ReferringDoctorsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ChatsPage } from './pages/ChatsPage';
import { ViewerPage } from './pages/ViewerPage';

function RouteErrorFallback() {
  const err = useRouteError() as any;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#F5F7FB',
      }}
    >
      <Result
        status="warning"
        title="RadioLinQ could not load"
        subTitle={
          err?.message ||
          (typeof err === 'string'
            ? err
            : 'Connecting to API... If the server was sleeping, please wait a moment and reload.')
        }
        extra={[
          <Button type="primary" key="reload" onClick={() => window.location.reload()}>
            Reload Page
          </Button>,
          <Button key="home" onClick={() => (window.location.href = '/')}>
            Go to Dashboard
          </Button>,
        ]}
      />
    </div>
  );
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <RouteErrorFallback />,
    children: [
      { index: true, element: <CasesPage /> },
      { path: 'referring-doctors', element: <ReferringDoctorsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'chats', element: <ChatsPage /> },
    ],
  },
  // viewer is full-screen, outside the dashboard chrome
  { path: '/viewer', element: <ViewerPage />, errorElement: <RouteErrorFallback /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
