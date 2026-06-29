import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Lobby from './pages/Lobby';

// 3D 场景包大，按页懒加载，避免大厅 / 真相页白等 three 下载。
const Dice = lazy(() => import('./pages/games/Dice'));
const Roulette = lazy(() => import('./pages/games/Roulette'));
const Slots = lazy(() => import('./pages/games/Slots'));
const Baccarat = lazy(() => import('./pages/games/Baccarat'));
const Blackjack = lazy(() => import('./pages/games/Blackjack'));
const DragonTiger = lazy(() => import('./pages/games/DragonTiger'));
const Keno = lazy(() => import('./pages/games/Keno'));
const Crash = lazy(() => import('./pages/games/Crash'));
const MoneyWheel = lazy(() => import('./pages/games/MoneyWheel'));
const Plinko = lazy(() => import('./pages/games/Plinko'));
const SicBo = lazy(() => import('./pages/games/SicBo'));
const Zhajinhua = lazy(() => import('./pages/games/Zhajinhua'));
const Mines = lazy(() => import('./pages/games/Mines'));
const NiuNiu = lazy(() => import('./pages/games/NiuNiu'));
const VideoPoker = lazy(() => import('./pages/games/VideoPoker'));
const Scratch = lazy(() => import('./pages/games/Scratch'));
const Truth = lazy(() => import('./pages/Truth'));

function Loading() {
  return (
    <div className="py-24 text-center text-sm text-terminal-gray/60">
      <span className="text-terminal-green">loading</span>
      <span className="animate-blink">_</span>
    </div>
  );
}

export default function App() {
  return (
    <Layout>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Lobby />} />
          <Route path="/games/dice" element={<Dice />} />
          <Route path="/games/roulette" element={<Roulette />} />
          <Route path="/games/slots" element={<Slots />} />
          <Route path="/games/baccarat" element={<Baccarat />} />
          <Route path="/games/blackjack" element={<Blackjack />} />
          <Route path="/games/dragon-tiger" element={<DragonTiger />} />
          <Route path="/games/keno" element={<Keno />} />
          <Route path="/games/crash" element={<Crash />} />
          <Route path="/games/money-wheel" element={<MoneyWheel />} />
          <Route path="/games/plinko" element={<Plinko />} />
          <Route path="/games/sicbo" element={<SicBo />} />
          <Route path="/games/zhajinhua" element={<Zhajinhua />} />
          <Route path="/games/mines" element={<Mines />} />
          <Route path="/games/niuniu" element={<NiuNiu />} />
          <Route path="/games/videopoker" element={<VideoPoker />} />
          <Route path="/games/scratch" element={<Scratch />} />
          <Route path="/truth" element={<Truth />} />
          <Route path="*" element={<Lobby />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
