import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import TitleBar from '../../components/TitleBar';
import Curve from '../../components/Curve';
import WinEffect from '../../components/WinEffect';
import GameGuide from '../../components/GameGuide';
import { fetchCurve, fetchWallet, play, setWallet } from '../../lib/casino';
import { ApiError } from '../../lib/api';
import type { CrashRng, CurvePoint, PlayResult } from '../../lib/types';

const CHIPS = [10, 50, 100, 500];
const TARGETS = [1.5, 2, 3, 5, 10];

export default function Crash() {
  const [target, setTarget] = useState(2);
  const [amount, setAmount] = useState(50);
  const [balance, setBalance] = useState<number | null>(null);
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [mult, setMult] = useState(1);
  const [result, setResult] = useState<PlayResult | null>(null);
  const [dealKey, setDealKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<CurvePoint[]>([]);
  const raf = useRef<number | null>(null);

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
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  const canLaunch = phase !== 'running' && balance != null && amount > 0 && amount <= balance;

  const launch = async () => {
    if (!canLaunch) return;
    setError(null);
    setResult(null);
    setPhase('running');
    setMult(1);
    try {
      const r = await play('crash', amount, { target });
      const rng = r.rng_detail as unknown as CrashRng;
      setDealKey((k) => k + 1);
      const endPoint = rng.cashed ? rng.target : rng.crash; // 演到：兑现停在目标，否则崩在 crash
      const dur = Math.min(6000, 1400 + 520 * Math.log2(Math.max(2, endPoint)));
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / dur);
        setMult(Math.pow(endPoint, p)); // 指数上涨，越后越快
        if (p < 1) {
          raf.current = requestAnimationFrame(tick);
          return;
        }
        // 落定
        setMult(endPoint);
        setPhase('done');
        setResult(r);
        setBalance(r.balance_after);
        setPoints((prev) => [
          ...prev,
          {
            round_index: (prev[prev.length - 1]?.round_index ?? 0) + 1,
            balance_after: r.balance_after,
            net: r.net,
            game: 'crash',
            created_at: new Date().toISOString(),
          },
        ]);
        fetchWallet().then(setWallet).catch(() => {});
      };
      raf.current = requestAnimationFrame(tick);
    } catch (e) {
      setPhase('idle');
      setError(e instanceof ApiError ? e.message : '下注失败，后端没连上？');
    }
  };

  const rng = result?.rng_detail as unknown as CrashRng | undefined;
  const cashed = rng?.cashed ?? false;
  const curvePoints = useMemo(() => points.slice(-120), [points]);

  // 曲线：x=进度，y=log(倍率)。把当前 mult 画成一条上升线。
  const yMax = Math.max(target * 1.2, mult * 1.1, 2);
  const W = 320;
  const H = 200;
  const path = useMemo(() => {
    const n = 36;
    const pts: string[] = [];
    for (let i = 0; i <= n; i++) {
      const p = (i / n) * 1; // 0..1 当前进度比例（mult = end^p 的反推用 mult 直接铺）
      const m = Math.pow(mult, p); // 0..mult
      const x = (i / n) * W;
      const y = H - (Math.log(m) / Math.log(yMax)) * H;
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return pts.join(' ');
  }, [mult, yMax]);

  const tipColor = phase === 'done' ? (cashed ? '#5af78e' : '#ff5f57') : '#57c7ff';
  const tipY = H - (Math.log(Math.max(1, mult)) / Math.log(yMax)) * H;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-terminal-gray/70">
          <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">play</span> crash
          <span className="ml-2 text-terminal-gray/50">— 倍率上涨，到目标自动兑现；崩了归零</span>
        </h2>
        <Link to="/" className="text-xs text-terminal-cyan hover:text-terminal-green">
          ← 返回大厅
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="relative overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/40 shadow-glow">
          <TitleBar path="~/casino/crash" />
          <div className="relative h-[340px] w-full p-4 sm:h-[400px]">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full p-4">
              <polyline points={path} fill="none" stroke={tipColor} strokeWidth="2.5" strokeLinejoin="round" />
              <circle cx={W} cy={tipY} r="4" fill={tipColor} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div
                className="text-5xl font-bold tabular-nums sm:text-6xl"
                style={{ color: tipColor, textShadow: `0 0 24px ${tipColor}66` }}
              >
                {mult.toFixed(2)}×
              </div>
              {phase === 'done' && rng && (
                <div className={'mt-2 text-sm font-semibold ' + (cashed ? 'text-terminal-green' : 'text-terminal-red')}>
                  {cashed
                    ? `@${rng.target}× 兑现 +${result?.net}`
                    : `崩盘 @${rng.crash}× · 归零 ${result?.net}`}
                </div>
              )}
              {phase === 'idle' && (
                <div className="mt-2 text-xs text-terminal-gray/50">目标 {target}× · 到点自动兑现</div>
              )}
            </div>
            {phase === 'done' && cashed && result && (
              <WinEffect key={dealKey} amount={result.net} big={result.net >= 1000} />
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-lg border border-terminal-line bg-terminal-panel/40 p-4">
          <div>
            <div className="mb-2 text-xs text-terminal-gray/60">目标倍率（越贪越易崩）</div>
            <div className="grid grid-cols-5 gap-2">
              {TARGETS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTarget(t)}
                  disabled={phase === 'running'}
                  className={
                    'rounded border py-2 text-xs transition disabled:opacity-50 ' +
                    (target === t
                      ? 'border-terminal-green text-terminal-green shadow-glow'
                      : 'border-terminal-line text-terminal-gray/80 hover:border-terminal-green/50')
                  }
                >
                  {t}×
                </button>
              ))}
            </div>
            <div className="mt-1 text-[10px] text-terminal-gray/45">
              兑现概率 ≈ {((0.96 / target) * 100).toFixed(0)}%
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
                  disabled={phase === 'running'}
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
            onClick={launch}
            disabled={!canLaunch}
            className="rounded border border-terminal-pink/70 bg-terminal-pink/10 py-3 font-semibold text-terminal-pink shadow-glow-pink transition hover:bg-terminal-pink/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {phase === 'running' ? '上涨中…' : '发射'}
          </button>

          <div className="text-center text-xs text-terminal-gray/55">
            余额 <span className="text-terminal-yellow">{balance ?? '—'}</span> · 庄家优势恒{' '}
            <span className="text-terminal-red">4%</span>
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
        cmd="crash"
        how={[
          '设一个目标倍率后发射，倍率从 1.00× 不断上涨，到达目标自动兑现，赢 下注×目标。',
          '若在到达目标前崩盘，本金全部归零。',
        ]}
        truth="崩盘点满足「P(倍率≥m)=0.96/m」，于是不管你定多高的目标，长期 RTP 都恒为 96%（庄家优势 4%）。提高目标 = 赔率更高但兑现概率成比例下降，期望一分不变——『差一点就到了』的快感，正是这类游戏让人停不下来的钩子。"
      />
    </div>
  );
}
