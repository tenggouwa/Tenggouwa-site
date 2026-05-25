import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ConfigProvider } from '@arco-design/web-react';
import Layout from './components/Layout';
import Home from './pages/Home';
import PostList from './pages/PostList';
import PostDetail from './pages/PostDetail';
import Inspirations from './pages/Inspirations';
import Lab from './pages/Lab';
import MatrixRain from './pages/lab/MatrixRain';
import Flock from './pages/lab/Flock';
import SnakeToy from './pages/lab/Snake';
import Life from './pages/lab/Life';
import Donut from './pages/lab/Donut';
import Game2048 from './pages/lab/Game2048';
import Rope from './pages/lab/Rope';
import Wave from './pages/lab/Wave';
import About from './pages/About';
import Console from './pages/Console';
import NotFound from './pages/NotFound';
import Search from './pages/Search';

export default function App() {
  useEffect(() => {
    document.body.setAttribute('arco-theme', 'dark');
  }, []);

  return (
    <ConfigProvider>
      <Routes>
        {/* 全屏路由（不套 Layout，没有 header/footer）*/}
        <Route path="console" element={<Console />} />

        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="posts" element={<PostList />} />
          <Route path="posts/:slug" element={<PostDetail />} />
          <Route path="inspirations" element={<Inspirations />} />
          <Route path="lab" element={<Lab />} />
          <Route path="lab/matrix" element={<MatrixRain />} />
          <Route path="lab/flock" element={<Flock />} />
          <Route path="lab/donut" element={<Donut />} />
          <Route path="lab/wave" element={<Wave />} />
          <Route path="lab/rope" element={<Rope />} />
          <Route path="lab/snake" element={<SnakeToy />} />
          <Route path="lab/2048" element={<Game2048 />} />
          <Route path="lab/life" element={<Life />} />
          <Route path="about" element={<About />} />
          <Route path="search" element={<Search />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ConfigProvider>
  );
}
