import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { AppLayout } from './app/AppLayout';
import { CasesPage } from './pages/CasesPage';
import { ReferringDoctorsPage } from './pages/ReferringDoctorsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ChatsPage } from './pages/ChatsPage';
import { ViewerPage } from './pages/ViewerPage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <CasesPage /> },
      { path: 'referring-doctors', element: <ReferringDoctorsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'chats', element: <ChatsPage /> },
    ],
  },
  // viewer is full-screen, outside the dashboard chrome
  { path: '/viewer', element: <ViewerPage /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
