import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ConfigProvider } from '@arco-design/web-react';
import Layout from './components/Layout';
import Home from './pages/Home';

// 首页随主 bundle 同步加载（首屏要立即出），其余路由按需切分。
const PostList = lazy(() => import('./pages/PostList'));
const PostDetail = lazy(() => import('./pages/PostDetail'));
const Inspirations = lazy(() => import('./pages/Inspirations'));
const Lab = lazy(() => import('./pages/Lab'));
const MatrixRain = lazy(() => import('./pages/lab/MatrixRain'));
const Flock = lazy(() => import('./pages/lab/Flock'));
const SnakeToy = lazy(() => import('./pages/lab/Snake'));
const Life = lazy(() => import('./pages/lab/Life'));
const Donut = lazy(() => import('./pages/lab/Donut'));
const Game2048 = lazy(() => import('./pages/lab/Game2048'));
const Rope = lazy(() => import('./pages/lab/Rope'));
const Wave = lazy(() => import('./pages/lab/Wave'));
const About = lazy(() => import('./pages/About'));
const Console = lazy(() => import('./pages/Console'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Search = lazy(() => import('./pages/Search'));
const Series = lazy(() => import('./pages/Series'));

// 全屏路由（console）的兜底：黑屏 + 终端 boot 提示。Layout 下的页面用 Layout
// 内层 Suspense 的骨架屏（header/footer 不闪），不走这个。
function BootFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-terminal-bg font-mono text-sm text-terminal-green/80">
      <span>
        <span className="text-terminal-pink">~$</span> booting console
        <span className="ml-0.5 inline-block h-[15px] w-[7px] translate-y-[2px] bg-terminal-green/80 animate-blink" />
      </span>
    </div>
  );
}

export default function App() {
  useEffect(() => {
    document.body.setAttribute('arco-theme', 'dark');
  }, []);

  return (
    <ConfigProvider>
      <Suspense fallback={<BootFallback />}>
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
            <Route path="series/:tag" element={<Series />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </ConfigProvider>
  );
}
