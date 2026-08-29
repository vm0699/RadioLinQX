import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { StudyListPage } from './pages/StudyListPage';
import { ViewerPage } from './pages/ViewerPage';

const router = createBrowserRouter([
  { path: '/', element: <StudyListPage /> },
  { path: '/viewer', element: <ViewerPage /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
