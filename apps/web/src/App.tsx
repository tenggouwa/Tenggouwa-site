import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ConfigProvider } from '@arco-design/web-react';
import Layout from './components/Layout';
import Home from './pages/Home';
import PostList from './pages/PostList';
import PostDetail from './pages/PostDetail';
import Inspirations from './pages/Inspirations';
import Lab from './pages/Lab';
import About from './pages/About';
import NotFound from './pages/NotFound';

export default function App() {
  useEffect(() => {
    document.body.setAttribute('arco-theme', 'dark');
  }, []);

  return (
    <ConfigProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="posts" element={<PostList />} />
          <Route path="posts/:slug" element={<PostDetail />} />
          <Route path="inspirations" element={<Inspirations />} />
          <Route path="lab" element={<Lab />} />
          <Route path="about" element={<About />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ConfigProvider>
  );
}
