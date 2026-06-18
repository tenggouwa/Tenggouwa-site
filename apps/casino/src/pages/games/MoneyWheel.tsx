import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import TitleBar from '../../components/TitleBar';
import Curve from '../../components/Curve';
import WinEffect from '../../components/WinEffect';
import GameGuide from '../../components/GameGuide';
import MoneyWheelScene, { WHEEL_SPIN_MS } from '../../three/MoneyWheelScene';
import { fetchCurve, fetchWallet, play, setWallet } from '../../lib/casino';
import { ApiError } from '../../lib/api';
import type { CurvePoint, MoneyWheelRng, PlayResult } from '../../lib/types';

const CHIPS = [10, 50, 100, 500];
// 押注符号 + 赔率(X:1) + 庄家优势。
const BETS: { sym: string; label: string; pay: string; edge: string }[] = [
  { sym: '1', label: '1', pay: '1:1', edge: '11.1%' },
  { sym: '2', label: '2', pay: '2:1', edge: '16.7%' },
  { sym: '5', label: '5', pay: '5:1', edge: '22.2%' },
  { sym: '10', label: '10', pay: '10:1', edge: '18.5%' },
  { sym: '20', label: '20', pay: '20:1', edge: '22.2%' },
  { sym: '40', label: '40', pay: '40:1', edge: '24.1%' },
  { sym: 'joker', label: '★', pay: '45:1', edge: '14.8%' },
];

export default function MoneyWheel() {
  const [pick, setPick] = useState('1');
  const [amount, setAmount] = useState(50);
  const [balance, setBalance] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
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

  const spin = async () => {
    if (!canSpin) return;
    setError(null);
    setResult(null);
    setSpinning(true);
    try {
      const r = await play('money_wheel', amount, { bet: pick });
      const rng = r.rng_detail as unknown as MoneyWheelRng;
      setIndex(rng.index);
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
            game: 'money_wheel',
            created_at: new Date().toISOString(),
          },
        ]);
        fetchWallet().then(setWallet).catch(() => {});
      }, WHEEL_SPIN_MS + 150);
    } catch (e) {
      setSpinning(false);
      setError(e instanceof ApiError ? e.message : '下注失败，后端没连上？');
    }
  };

  const rng = result?.rng_detail as unknown as MoneyWheelRng | undefined;
  const curvePoints = useMemo(() => points.slice(-120), [points]);
  const segLabel = (s: string) => (s === 'joker' ? '★' : s);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-terminal-gray/70">
          <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">play</span> money-wheel
          <span className="ml-2 text-terminal-gray/50">— 押符号，转盘停在哪格定输赢</span>
        </h2>
        <Link to="/" className="text-xs text-terminal-cyan hover:text-terminal-green">
          ← 返回大厅
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/40 shadow-glow">
          <TitleBar path="~/casino/money-wheel" />
          <div className="relative h-[360px] w-full sm:h-[420px]">
            <MoneyWheelScene index={index} rollKey={rollKey} />
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
                  停 {segLabel(rng.segment)} · {result.net > 0 ? `+${result.net}` : result.net}
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
            <div className="mb-2 text-xs text-terminal-gray/60">押哪个符号</div>
            <div className="grid grid-cols-4 gap-2">
              {BETS.map((b) => (
                <button
                  key={b.sym}
                  onClick={() => setPick(b.sym)}
                  disabled={spinning}
                  className={
                    'rounded border py-2 text-center transition disabled:opacity-50 ' +
                    (pick === b.sym
                      ? 'border-terminal-green text-terminal-green shadow-glow'
                      : 'border-terminal-line text-terminal-gray/80 hover:border-terminal-green/50')
                  }
                >
                  <div className="text-sm font-semibold">{b.label}</div>
                  <div className="text-[10px] text-terminal-gray/50">{b.pay}</div>
                </button>
              ))}
            </div>
            <div className="mt-1 text-[10px] text-terminal-red">
              当前「{pick === 'joker' ? '★' : pick}」庄家优势 {BETS.find((b) => b.sym === pick)?.edge}
            </div>
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
            {spinning ? '转动中…' : '转大转盘'}
          </button>

          <div className="text-center text-xs text-terminal-gray/55">
            余额 <span className="text-terminal-yellow">{balance ?? '—'}</span> · 全场优势 11–24%
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
        cmd="money-wheel"
        how={[
          '54 格的钱轮，格上是 1/2/5/10/20/40/★。押某个符号，转盘停在该符号就按其赔率赔。',
          '赔率 = 数字:1（押 5 中了赔 5:1），★(joker) 赔 45:1。',
        ]}
        truth="这是赌场抽水最狠的游戏之一：押最小的 1 已是 11.1% 优势，押越大的格优势越高(押 40 高达 24%)。格子上的大数字看着诱人，其实概率低到期望最差——高赔率永远对应高抽水。"
      />
    </div>
  );
}
