import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import TitleBar from '../../components/TitleBar';
import Curve from '../../components/Curve';
import WinEffect from '../../components/WinEffect';
import GameGuide from '../../components/GameGuide';
import RouletteScene, { ROULETTE_SPIN_MS } from '../../three/RouletteScene';
import { fetchCurve, fetchWallet, play, setWallet } from '../../lib/casino';
import { ApiError } from '../../lib/api';
import type { CurvePoint, PlayResult, RouletteRng } from '../../lib/types';

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const CHIPS = [10, 50, 100, 500];

// 标准欧式桌面：3 行 × 12 列，行从上到下分别是 3n / 3n-1 / 3n-2。
const GRID_ROWS = [
  Array.from({ length: 12 }, (_, c) => 3 * (c + 1)),
  Array.from({ length: 12 }, (_, c) => 3 * (c + 1) - 1),
  Array.from({ length: 12 }, (_, c) => 3 * (c + 1) - 2),
];

interface Bet {
  type: 'number' | 'color' | 'parity' | 'range';
  value: string | number;
  label: string;
}

function betKey(b: Bet): string {
  return `${b.type}:${b.value}`;
}

export default function Roulette() {
  const [bet, setBet] = useState<Bet>({ type: 'color', value: 'red', label: '红' });
  const [amount, setAmount] = useState(50);
  const [balance, setBalance] = useState<number | null>(null);
  const [number, setNumber] = useState(0);
  const [rollKey, setRollKey] = useState(0);
  const [spinning, setSpinning] = useState(false);
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

  const canSpin = !spinning && balance != null && amount > 0 && amount <= balance;
  const curKey = betKey(bet);

  const spin = async () => {
    if (!canSpin) return;
    setError(null);
    setResult(null);
    setSpinning(true);
    try {
      const r = await play('roulette', amount, { type: bet.type, value: bet.value });
      const rng = r.rng_detail as unknown as RouletteRng;
      setNumber(rng.number);
      setRollKey((k) => k + 1);
      timer.current = window.setTimeout(() => {
        setResult(r);
        setBalance(r.balance_after);
        setSpinning(false);
        setPoints((prev) => [
          ...prev,
          {
            round_index: (prev[prev.length - 1]?.round_index ?? 0) + 1,
            balance_after: r.balance_after,
            net: r.net,
            game: 'roulette',
            created_at: new Date().toISOString(),
          },
        ]);
        fetchWallet().then(setWallet).catch(() => {});
      }, ROULETTE_SPIN_MS + 150);
    } catch (e) {
      setSpinning(false);
      setError(e instanceof ApiError ? e.message : '下注失败，后端没连上？');
    }
  };

  const rng = result?.rng_detail as unknown as RouletteRng | undefined;
  const curvePoints = useMemo(() => points.slice(-120), [points]);

  const numCell = (n: number) => {
    const active = bet.type === 'number' && bet.value === n;
    const bg = n === 0 ? 'bg-[#1f9d55]/30' : RED.has(n) ? 'bg-[#cf2b2b]/30' : 'bg-black/40';
    return (
      <button
        key={n}
        onClick={() => setBet({ type: 'number', value: n, label: `号码 ${n}` })}
        disabled={spinning}
        className={
          'flex h-7 items-center justify-center rounded-sm border text-xs transition disabled:opacity-50 ' +
          bg +
          (active ? ' border-terminal-green text-terminal-green shadow-glow' : ' border-terminal-line/60 text-terminal-gray/85 hover:border-terminal-green/50')
        }
      >
        {n}
      </button>
    );
  };

  const outside = (b: Bet) => {
    const active = curKey === betKey(b);
    return (
      <button
        key={betKey(b)}
        onClick={() => setBet(b)}
        disabled={spinning}
        className={
          'rounded border py-2 text-xs transition disabled:opacity-50 ' +
          (active
            ? 'border-terminal-green text-terminal-green shadow-glow'
            : 'border-terminal-line text-terminal-gray/80 hover:border-terminal-green/50')
        }
      >
        {b.label}
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-terminal-gray/70">
          <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">play</span> roulette
          <span className="ml-2 text-terminal-gray/50">— 欧式单零轮盘，那个 0 就是庄家优势</span>
        </h2>
        <Link to="/" className="text-xs text-terminal-cyan hover:text-terminal-green">
          ← 返回大厅
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/40 shadow-glow">
          <TitleBar path="~/casino/roulette" />
          <div className="relative h-[360px] w-full sm:h-[420px]">
            <RouletteScene number={number} rollKey={rollKey} />
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
                  落 {rng.number}（{rng.color === 'red' ? '红' : rng.color === 'black' ? '黑' : '绿'}）·{' '}
                  {result.outcome === 'win' ? `+${result.net}` : `${result.net}`}
                </div>
              </div>
            )}
            {spinning && !result && (
              <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-terminal-gray/60">
                转动中<span className="animate-blink">_</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-lg border border-terminal-line bg-terminal-panel/40 p-4">
          <div>
            <div className="mb-2 text-xs text-terminal-gray/60">押号码（35:1）</div>
            <div className="flex gap-1">
              <button
                onClick={() => setBet({ type: 'number', value: 0, label: '号码 0' })}
                disabled={spinning}
                className={
                  'flex w-7 items-center justify-center rounded-sm border bg-[#1f9d55]/30 text-xs transition disabled:opacity-50 ' +
                  (bet.type === 'number' && bet.value === 0
                    ? 'border-terminal-green text-terminal-green'
                    : 'border-terminal-line/60 text-terminal-gray/85 hover:border-terminal-green/50')
                }
              >
                0
              </button>
              <div className="grid flex-1 grid-cols-12 gap-1">{GRID_ROWS.flat().map(numCell)}</div>
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs text-terminal-gray/60">押边注（1:1）</div>
            <div className="grid grid-cols-2 gap-2">
              {outside({ type: 'color', value: 'red', label: '红' })}
              {outside({ type: 'color', value: 'black', label: '黑' })}
              {outside({ type: 'parity', value: 'odd', label: '单' })}
              {outside({ type: 'parity', value: 'even', label: '双' })}
              {outside({ type: 'range', value: 'low', label: '小 1–18' })}
              {outside({ type: 'range', value: 'high', label: '大 19–36' })}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between text-xs text-terminal-gray/60">
              <span>下注积分 · 当前押「{bet.label}」</span>
              <span className={balance != null && amount > balance ? 'text-terminal-red' : 'text-terminal-yellow'}>
                {amount}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {CHIPS.map((c) => (
                <button
                  key={c}
                  onClick={() => setAmount(c)}
                  disabled={spinning}
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
            onClick={spin}
            disabled={!canSpin}
            className="rounded border border-terminal-pink/70 bg-terminal-pink/10 py-3 font-semibold text-terminal-pink shadow-glow-pink transition hover:bg-terminal-pink/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {spinning ? '转动中…' : '转轮盘'}
          </button>

          <div className="text-center text-xs text-terminal-gray/55">
            余额 <span className="text-terminal-yellow">{balance ?? '—'}</span> · 庄家优势{' '}
            <span className="text-terminal-red">2.70%</span>
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
        cmd="roulette"
        how={[
          '欧式单零轮盘，37 格(0–36)。下注后转盘旋转，球落哪格定输赢。',
          '边注 1:1：红/黑、单/双、小(1–18)/大(19–36)；押单个号码 35:1。',
        ]}
        truth="那个 0 既不算红黑、也不算单双——所有投注的真实胜率都被它拖成 1/37，庄家优势恒为 2.70%。连 35:1 的单号也是同一个 2.70%，高赔率只是把波动放大，期望照样为负。"
      />
    </div>
  );
}
