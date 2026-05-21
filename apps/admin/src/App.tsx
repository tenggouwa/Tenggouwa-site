import { Navigate, Route, Routes } from 'react-router-dom';
import { ConfigProvider } from '@arco-design/web-react';
import Login from './pages/Login';
import Shell from './components/Shell';
import RequireAuth from './components/RequireAuth';
import PostsPage from './pages/PostsPage';
import InspirationsPage from './pages/InspirationsPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <ConfigProvider>
      <Routes>
        <Route path="login" element={<Login />} />
        <Route
          element={
            <RequireAuth>
              <Shell />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="posts" replace />} />
          <Route path="posts" element={<PostsPage />} />
          <Route path="inspirations" element={<InspirationsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ConfigProvider>
  );
}
