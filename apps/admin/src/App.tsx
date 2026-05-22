import { Navigate, Route, Routes } from 'react-router-dom';
import { ConfigProvider } from '@arco-design/web-react';
import Login from './pages/Login';
import Shell from './components/Shell';
import RequireAuth from './components/RequireAuth';
import AnalyticsPage from './pages/AnalyticsPage';
import PostsPage from './pages/PostsPage';
import InspirationsPage from './pages/InspirationsPage';
import SeoPage from './pages/SeoPage';
import SettingsPage from './pages/SettingsPage';
import TerminalPage from './pages/TerminalPage';

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
          <Route index element={<Navigate to="analytics" replace />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="seo" element={<SeoPage />} />
          <Route path="posts" element={<PostsPage />} />
          <Route path="inspirations" element={<InspirationsPage />} />
          <Route path="terminal" element={<TerminalPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ConfigProvider>
  );
}
