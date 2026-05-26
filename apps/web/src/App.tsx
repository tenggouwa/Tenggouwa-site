import { lazy, Suspense, useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ConfigProvider } from '@arco-design/web-react';
import Layout from './components/Layout';
import Home from './pages/Home';
import BootScreen from './components/BootScreen';

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
const MatrixCanvas = lazy(() => import('./components/MatrixCanvas'));

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

const KONAMI = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a',
];

export default function App() {
  const [booted, setBooted] = useState(
    () => typeof window !== 'undefined' && window.sessionStorage.getItem('booted') === '1',
  );
  const [matrix, setMatrix] = useState(false);

  useEffect(() => {
    document.body.setAttribute('arco-theme', 'dark');
  }, []);

  // Konami code（↑↑↓↓←→←→BA）→ 全屏矩阵雨彩蛋
  useEffect(() => {
    let pos = 0;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === KONAMI[pos]) {
        pos += 1;
        if (pos === KONAMI.length) {
          pos = 0;
          setMatrix(true);
        }
      } else {
        pos = k === KONAMI[0] ? 1 : 0;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 彩蛋开启时 Esc 关闭
  useEffect(() => {
    if (!matrix) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMatrix(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [matrix]);

  const finishBoot = () => {
    window.sessionStorage.setItem('booted', '1');
    setBooted(true);
  };

  return (
    <ConfigProvider>
      {!booted && <BootScreen onDone={finishBoot} />}
      {matrix && (
        <div className="fixed inset-0 z-[200] bg-black">
          <Suspense fallback={null}>
            <MatrixCanvas className="block h-full w-full bg-terminal-bg" />
          </Suspense>
          <button
            type="button"
            onClick={() => setMatrix(false)}
            className="absolute right-4 top-4 rounded border border-terminal-green/50 bg-terminal-bg/70 px-2 py-1 font-mono text-xs text-terminal-green transition-colors hover:bg-terminal-green/10"
          >
            esc
          </button>
        </div>
      )}
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
