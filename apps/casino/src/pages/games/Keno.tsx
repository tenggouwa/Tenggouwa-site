import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import TitleBar from '../../components/TitleBar';
import Curve from '../../components/Curve';
import WinEffect from '../../components/WinEffect';
import GameGuide from '../../components/GameGuide';
import { fetchCurve, fetchWallet, play, setWallet } from '../../lib/casino';
import { ApiError } from '../../lib/api';
import type { CurvePoint, KenoRng, PlayResult } from '../../lib/types';

const CHIPS = [10, 50, 100, 500];
const NUMBERS = Array.from({ length: 80 }, (_, i) => i + 1);

export default function Keno() {
  const [picks, setPicks] = useState<Set<number>>(new Set());
  const [amount, setAmount] = useState(50);
  const [balance, setBalance] = useState<number | null>(null);
  const [draw, setDraw] = useState<number[]>([]);
  const [revealed, setRevealed] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [result, setResult] = useState<PlayResult | null>(null);
  const [dealKey, setDealKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<CurvePoint[]>([]);
  const pending = useRef<PlayResult | null>(null);

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
  }, []);

  // 逐个开奖 → 全部开完结算。draw 为空时不结算（否则 0>=0 会用旧结果提前收场）。
  useEffect(() => {
    if (!drawing || draw.length === 0) return;
    if (revealed >= draw.length) {
      const r = pending.current;
      if (!r) return;
      setResult(r);
      setBalance(r.balance_after);
      setDrawing(false);
      setPoints((prev) => [
        ...prev,
        {
          round_index: (prev[prev.length - 1]?.round_index ?? 0) + 1,
          balance_after: r.balance_after,
          net: r.net,
          game: 'keno',
          created_at: new Date().toISOString(),
        },
      ]);
      fetchWallet().then(setWallet).catch(() => {});
      return;
    }
    const id = window.setTimeout(() => setRevealed((n) => n + 1), 85);
    return () => window.clearTimeout(id);
  }, [drawing, revealed, draw]);

  const toggle = (n: number) => {
    if (drawing) return;
    setResult(null);
    setPicks((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else if (next.size < 10) next.add(n);
      return next;
    });
  };

  const canDraw = !drawing && balance != null && amount > 0 && amount <= balance && picks.size >= 1;

  const start = async () => {
    if (!canDraw) return;
    setError(null);
    setResult(null);
    setDrawing(true);
    setDraw([]);
    setRevealed(0);
    try {
      const r = await play('keno', amount, { picks: [...picks] });
      const rng = r.rng_detail as unknown as KenoRng;
      pending.current = r;
      setDealKey((k) => k + 1);
      setDraw(rng.draw);
      setRevealed(0);
    } catch (e) {
      setDrawing(false);
      setError(e instanceof ApiError ? e.message : '下注失败，后端没连上？');
    }
  };

  const drawnSet = useMemo(() => new Set(draw.slice(0, revealed)), [draw, revealed]);
  const rng = result?.rng_detail as unknown as KenoRng | undefined;
  const curvePoints = useMemo(() => points.slice(-120), [points]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-terminal-gray/70">
          <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">play</span> keno
          <span className="ml-2 text-terminal-gray/50">— 选 1–10 个号，机开 20 个对中</span>
        </h2>
        <Link to="/" className="text-xs text-terminal-cyan hover:text-terminal-green">
          ← 返回大厅
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="relative overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/40 p-3 shadow-glow">
          <TitleBar path="~/casino/keno" />
          <div className="mt-3 grid grid-cols-10 gap-1.5">
            {NUMBERS.map((n) => {
              const picked = picks.has(n);
              const drawn = drawnSet.has(n);
              const hit = picked && drawn;
              return (
                <button
                  key={n}
                  onClick={() => toggle(n)}
                  disabled={drawing}
                  className={
                    'aspect-square rounded text-xs transition disabled:cursor-default ' +
                    (hit
                      ? 'border border-terminal-green bg-terminal-green/30 text-terminal-green shadow-glow'
                      : drawn
                        ? 'border border-terminal-cyan/70 bg-terminal-cyan/15 text-terminal-cyan'
                        : picked
                          ? 'border border-terminal-green/70 text-terminal-green'
                          : 'border border-terminal-line/60 text-terminal-gray/70 hover:border-terminal-green/40')
                  }
                >
                  {n}
                </button>
              );
            })}
          </div>
          {result?.outcome === 'win' && <WinEffect key={dealKey} amount={result.net} big={result.net >= 1000} />}
        </div>

        <div className="flex flex-col gap-4 rounded-lg border border-terminal-line bg-terminal-panel/40 p-4">
          <div className="rounded border border-terminal-line/60 bg-terminal-bg/40 p-3 text-xs text-terminal-gray/75">
            已选 <span className="text-terminal-green">{picks.size}</span>/10
            {result && rng && (
              <span className="ml-2">
                · 命中 <span className="text-terminal-yellow">{rng.hits}</span> ·{' '}
                <span className={result.net >= 0 ? 'text-terminal-green' : 'text-terminal-red'}>
                  {result.net >= 0 ? `+${result.net}` : result.net}
                </span>
              </span>
            )}
            {drawing && <span className="ml-2 text-terminal-cyan">开奖中…{revealed}/20</span>}
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
                  disabled={drawing}
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

          <div className="flex gap-2">
            <button
              onClick={() => !drawing && setPicks(new Set())}
              disabled={drawing || picks.size === 0}
              className="rounded border border-terminal-line px-3 py-3 text-xs text-terminal-gray/70 transition hover:border-terminal-red/50 hover:text-terminal-red disabled:opacity-40"
            >
              清空
            </button>
            <button
              onClick={start}
              disabled={!canDraw}
              className="flex-1 rounded border border-terminal-pink/70 bg-terminal-pink/10 py-3 font-semibold text-terminal-pink shadow-glow-pink transition hover:bg-terminal-pink/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {drawing ? '开奖中…' : '开奖'}
            </button>
          </div>

          <div className="text-center text-xs text-terminal-gray/55">
            余额 <span className="text-terminal-yellow">{balance ?? '—'}</span> · 庄家优势{' '}
            <span className="text-terminal-red">~28%</span>（全场最坑）
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
        cmd="keno"
        how={[
          '从 1–80 里选 1–10 个号码，机器随机开出 20 个，按命中个数对照赔付表赔。',
          '选得越多、要求全中才赔大奖，概率极低；选少则赔率低。',
        ]}
        truth="基诺是赌场抽水最狠的游戏之一，庄家优势普遍 25–30%（远高于轮盘的 2.7%）。那些动辄上万倍的头奖，中奖概率低到几乎不可能——用大头奖掩盖极差的期望，正是它的套路。"
      />
    </div>
  );
}
