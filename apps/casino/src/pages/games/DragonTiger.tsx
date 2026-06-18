import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import TitleBar from '../../components/TitleBar';
import Curve from '../../components/Curve';
import WinEffect from '../../components/WinEffect';
import GameGuide from '../../components/GameGuide';
import DragonTigerScene from '../../three/DragonTigerScene';
import { fetchCurve, fetchWallet, play, setWallet } from '../../lib/casino';
import { ApiError } from '../../lib/api';
import type { CurvePoint, DragonTigerRng, PlayResult } from '../../lib/types';

type Side = 'dragon' | 'tiger' | 'tie';
const CHIPS = [10, 50, 100, 500];
const SIDES: { key: Side; label: string; pay: string; edge: string }[] = [
  { key: 'dragon', label: '龙 Dragon', pay: '1:1', edge: '3.85%' },
  { key: 'tie', label: '和 Tie', pay: '8:1', edge: '30%' },
  { key: 'tiger', label: '虎 Tiger', pay: '1:1', edge: '3.85%' },
];
const REVEAL_MS = 950;

export default function DragonTiger() {
  const [side, setSide] = useState<Side>('dragon');
  const [amount, setAmount] = useState(50);
  const [balance, setBalance] = useState<number | null>(null);
  const [cards, setCards] = useState<{ dragon: DragonTigerRng['dragon']; tiger: DragonTigerRng['tiger'] } | null>(null);
  const [dealKey, setDealKey] = useState(0);
  const [dealing, setDealing] = useState(false);
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

  const canDeal = !dealing && balance != null && amount > 0 && amount <= balance;

  const deal = async () => {
    if (!canDeal) return;
    setError(null);
    setResult(null);
    setDealing(true);
    try {
      const r = await play('dragon_tiger', amount, { type: side });
      const rng = r.rng_detail as unknown as DragonTigerRng;
      setCards({ dragon: rng.dragon, tiger: rng.tiger });
      setDealKey((k) => k + 1);
      timer.current = window.setTimeout(() => {
        setResult(r);
        setBalance(r.balance_after);
        setDealing(false);
        setPoints((prev) => [
          ...prev,
          {
            round_index: (prev[prev.length - 1]?.round_index ?? 0) + 1,
            balance_after: r.balance_after,
            net: r.net,
            game: 'dragon_tiger',
            created_at: new Date().toISOString(),
          },
        ]);
        fetchWallet().then(setWallet).catch(() => {});
      }, REVEAL_MS);
    } catch (e) {
      setDealing(false);
      setError(e instanceof ApiError ? e.message : '下注失败，后端没连上？');
    }
  };

  const rng = result?.rng_detail as unknown as DragonTigerRng | undefined;
  const curvePoints = useMemo(() => points.slice(-120), [points]);
  const label = (res: string) => (res === 'dragon' ? '龙' : res === 'tiger' ? '虎' : '和');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-terminal-gray/70">
          <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">play</span> dragon-tiger
          <span className="ml-2 text-terminal-gray/50">— 龙虎各一张，比大小</span>
        </h2>
        <Link to="/" className="text-xs text-terminal-cyan hover:text-terminal-green">
          ← 返回大厅
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/40 shadow-glow">
          <TitleBar path="~/casino/dragon-tiger" />
          <div className="relative h-[340px] w-full sm:h-[400px]">
            <DragonTigerScene dragon={cards?.dragon ?? null} tiger={cards?.tiger ?? null} dealKey={dealKey} />
            {result?.outcome === 'win' && <WinEffect key={dealKey} amount={result.net} big={result.net >= 1000} />}
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
                  龙 {rng.dragon.r} · 虎 {rng.tiger.r} · {label(rng.result)}赢 ·{' '}
                  {result.net > 0 ? `+${result.net}` : result.net === 0 ? '退一半' : `${result.net}`}
                </div>
              </div>
            )}
            {dealing && !result && (
              <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-terminal-gray/60">
                发牌中<span className="animate-blink">_</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-lg border border-terminal-line bg-terminal-panel/40 p-4">
          <div>
            <div className="mb-2 text-xs text-terminal-gray/60">押注方向</div>
            <div className="grid grid-cols-3 gap-2">
              {SIDES.map((sd) => (
                <button
                  key={sd.key}
                  onClick={() => setSide(sd.key)}
                  disabled={dealing}
                  className={
                    'rounded border py-3 text-center transition disabled:opacity-50 ' +
                    (side === sd.key
                      ? 'border-terminal-green text-terminal-green shadow-glow'
                      : 'border-terminal-line text-terminal-gray/80 hover:border-terminal-green/50')
                  }
                >
                  <div className="text-sm font-semibold">{sd.label}</div>
                  <div className="text-[10px] text-terminal-gray/50">{sd.pay}</div>
                  <div className="text-[10px] text-terminal-red">{sd.edge}</div>
                </button>
              ))}
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
                  disabled={dealing}
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
            onClick={deal}
            disabled={!canDeal}
            className="rounded border border-terminal-pink/70 bg-terminal-pink/10 py-3 font-semibold text-terminal-pink shadow-glow-pink transition hover:bg-terminal-pink/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {dealing ? '发牌中…' : '发牌'}
          </button>

          <div className="text-center text-xs text-terminal-gray/55">
            余额 <span className="text-terminal-yellow">{balance ?? '—'}</span> · 押和是 30% 优势的陷阱
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
        cmd="dragon-tiger"
        how={[
          '龙、虎各发一张牌，比单张大小(A 最小、K 最大)，押"龙"/"虎"/"和"。',
          '押中龙/虎 1:1；遇平局退一半；押"和" 8:1。',
        ]}
        truth="押龙/虎庄家优势约 3.85%(平局退一半就是抽水来源)。押和虽然标 8:1 看着诱人，真实庄家优势却高达约 30%——又一个高赔率陷阱。"
      />
    </div>
  );
}
