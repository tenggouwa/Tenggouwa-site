import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import TitleBar from '../../components/TitleBar';
import Curve from '../../components/Curve';
import WinEffect from '../../components/WinEffect';
import GameGuide from '../../components/GameGuide';
import PlinkoScene, { PLINKO_DROP_MS } from '../../three/PlinkoScene';
import { fetchCurve, fetchWallet, play, setWallet } from '../../lib/casino';
import { ApiError } from '../../lib/api';
import type { CurvePoint, PlayResult, PlinkoRng } from '../../lib/types';

const CHIPS = [10, 50, 100, 500];

export default function Plinko() {
  const [amount, setAmount] = useState(50);
  const [balance, setBalance] = useState<number | null>(null);
  const [path, setPath] = useState<('L' | 'R')[]>([]);
  const [slot, setSlot] = useState(6);
  const [rollKey, setRollKey] = useState(0);
  const [dropping, setDropping] = useState(false);
  const [result, setResult] = useState<PlayResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<CurvePoint[]>([]);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    fetchWallet()
      .then((w) => {
        setWallet(w);
        setBalance(w.balance);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载钱包失败'));
    fetchCurve()
      .then((c) => setPoints(c.points))
      .catch(() => {});
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const canDrop = !dropping && balance != null && amount > 0 && amount <= balance;

  const drop = async () => {
    if (!canDrop) return;
    setError(null);
    setResult(null);
    setDropping(true);
    try {
      const r = await play('plinko', amount, {});
      const rng = r.rng_detail as unknown as PlinkoRng;
      setPath(rng.path);
      setSlot(rng.slot);
      setRollKey((k) => k + 1);
      timer.current = window.setTimeout(() => {
        setResult(r);
        setBalance(r.balance_after);
        setDropping(false);
        setPoints((prev) => [
          ...prev,
          {
            round_index: (prev[prev.length - 1]?.round_index ?? 0) + 1,
            balance_after: r.balance_after,
            net: r.net,
            game: 'plinko',
            created_at: new Date().toISOString(),
          },
        ]);
        fetchWallet().then(setWallet).catch(() => {});
      }, PLINKO_DROP_MS + 120);
    } catch (e) {
      setDropping(false);
      setError(e instanceof ApiError ? e.message : '下注失败，后端没连上？');
    }
  };

  const rng = result?.rng_detail as unknown as PlinkoRng | undefined;
  const curvePoints = useMemo(() => points.slice(-120), [points]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-terminal-gray/70">
          <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">play</span> plinko
          <span className="ml-2 text-terminal-gray/50">— 小球穿钉，落进倍率格</span>
        </h2>
        <Link to="/" className="text-xs text-terminal-cyan hover:text-terminal-green">
          ← 返回大厅
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/40 shadow-glow">
          <TitleBar path="~/casino/plinko" />
          <div className="relative h-[380px] w-full sm:h-[440px]">
            <PlinkoScene path={path} slot={slot} rollKey={rollKey} settled={!!result} />
            {result?.outcome === 'win' && <WinEffect key={rollKey} amount={result.net} big={result.net >= 1000} />}
            {result && rng && (
              <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                <div
                  className={
                    'rounded-full border px-4 py-1 text-sm font-semibold backdrop-blur ' +
                    (result.outcome === 'win'
                      ? 'border-terminal-green/60 text-terminal-green'
                      : 'border-terminal-red/60 text-terminal-red')
                  }
                >
                  ×{rng.mult} · {result.net > 0 ? `+${result.net}` : result.net}
                </div>
              </div>
            )}
            {dropping && !result && (
              <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-terminal-gray/60">
                下落中<span className="animate-blink">_</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-lg border border-terminal-line bg-terminal-panel/40 p-4">
          <div className="rounded border border-terminal-line/60 bg-terminal-bg/40 p-3 text-xs leading-relaxed text-terminal-gray/70">
            12 排钉，落入 13 个格。边缘 <span className="text-terminal-red">×50</span> 极罕见，
            中间多是 <span className="text-terminal-gray/80">×0.25–1</span>——掉中间就是亏。
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between text-xs text-terminal-gray/60">
              <span>下注积分</span>
              <span className={balance != null && amount > balance ? 'text-terminal-red' : 'text-terminal-yellow'}>
                {amount}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {CHIPS.map((c) => (
                <button
                  key={c}
                  onClick={() => setAmount(c)}
                  disabled={dropping}
                  className={
                    'rounded border py-1.5 text-xs transition disabled:opacity-50 ' +
                    (amount === c
                      ? 'border-terminal-cyan text-terminal-cyan'
                      : 'border-terminal-line text-terminal-gray/70 hover:border-terminal-cyan/50')
                  }
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={drop}
            disabled={!canDrop}
            className="rounded border border-terminal-pink/70 bg-terminal-pink/10 py-3 font-semibold text-terminal-pink shadow-glow-pink transition hover:bg-terminal-pink/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {dropping ? '下落中…' : '投球'}
          </button>

          <div className="text-center text-xs text-terminal-gray/55">
            余额 <span className="text-terminal-yellow">{balance ?? '—'}</span> · 庄家优势{' '}
            <span className="text-terminal-red">~4%</span>
          </div>
          {error && <div className="text-center text-xs text-terminal-red">{error}</div>}
        </div>
      </div>

      <div className="rounded-lg border border-terminal-line bg-terminal-panel/40 p-4">
        <div className="mb-2 flex items-center justify-between text-xs text-terminal-gray/60">
          <span>
            <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">cat</span> 我的输赢曲线
          </span>
          <Link to="/truth" className="text-terminal-cyan hover:text-terminal-green">
            全站真相 →
          </Link>
        </div>
        <Curve points={curvePoints} height={150} />
      </div>

      <GameGuide
        cmd="plinko"
        how={[
          '投下小球，它在 12 排钉间每碰一颗就 50/50 向左或向右，最后落进底部 13 个倍率格之一。',
          '落点服从二项分布：极度集中在中间，边缘的 ×50 大奖概率不到万分之三。',
        ]}
        truth="看着是纯运气的小球，倍率表其实精心设计成 RTP≈96%(庄家优势 4%)。中间那些 ×0.25/×0.5 的格子概率最高(掉进去就是亏本金)，两端 ×50 诱你以为能暴富，期望早被算死。"
      />
    </div>
  );
}
