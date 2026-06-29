import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import TitleBar from '../../components/TitleBar';
import Curve from '../../components/Curve';
import WinEffect from '../../components/WinEffect';
import GameGuide from '../../components/GameGuide';
import { fetchCurve, fetchWallet, play, setWallet } from '../../lib/casino';
import { ApiError } from '../../lib/api';
import type { CurvePoint, PlayResult, ScratchRng } from '../../lib/types';

const CHIPS = [10, 50, 100, 500];

// 6 个奖级符号：inline SVG 线条图（不用 emoji），各配一个 terminal 强调色。
const SYMBOLS: Record<string, { color: string; mult: number; svg: React.ReactNode }> = {
  clover: {
    color: 'text-terminal-green',
    mult: 2,
    svg: (
      <>
        <circle cx="9" cy="9" r="3.2" />
        <circle cx="15" cy="9" r="3.2" />
        <circle cx="12" cy="14" r="3.2" />
        <path d="M12 16 L12.6 21" />
      </>
    ),
  },
  bell: {
    color: 'text-terminal-yellow',
    mult: 3,
    svg: (
      <>
        <path d="M12 3 v2" />
        <path d="M8 18 v-5 a4 4 0 0 1 8 0 v5" />
        <path d="M6 18 h12" />
        <path d="M10.5 20.5 a1.5 1.5 0 0 0 3 0" />
      </>
    ),
  },
  bar: {
    color: 'text-terminal-cyan',
    mult: 5,
    svg: (
      <>
        <rect x="3.5" y="9" width="17" height="6" rx="1.5" />
        <text x="12" y="13.7" fontSize="4.4" textAnchor="middle" fill="currentColor" stroke="none">
          BAR
        </text>
      </>
    ),
  },
  seven: {
    color: 'text-terminal-pink',
    mult: 10,
    svg: <path d="M7 6 H17 L11 19" />,
  },
  star: {
    color: 'text-terminal-yellow',
    mult: 50,
    svg: <path d="M12 3 l2.6 5.9 6.4 .6 -4.9 4.2 1.5 6.3 -5.6 -3.4 -5.6 3.4 1.5 -6.3 -4.9 -4.2 6.4 -.6z" />,
  },
  gem: {
    color: 'text-terminal-cyan',
    mult: 500,
    svg: (
      <>
        <path d="M5 9 h14 l-7 11 z" />
        <path d="M5 9 l2.5 -4 h9 l2.5 4" />
        <path d="M9 9 l3 11 3 -11" />
      </>
    ),
  },
};

function SymbolIcon({ name }: { name: string }) {
  const s = SYMBOLS[name];
  if (!s) return null;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className={'h-3/5 w-3/5 ' + s.color}>
      {s.svg}
    </svg>
  );
}

// 涂层刮开卡：3×3 符号在下，canvas 灰涂层在上，拖动刮开；刮到 ~50% 或一键刮开即回调。
function ScratchCard({
  grid,
  ticketKey,
  forceReveal,
  winningSymbol,
  done,
  onReveal,
}: {
  grid: string[];
  ticketKey: number;
  forceReveal: boolean;
  winningSymbol: string | null;
  done: boolean;
  onReveal: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const revealed = useRef(false);
  const moves = useRef(0);

  const coat = () => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    cv.width = wrap.clientWidth;
    cv.height = wrap.clientHeight;
    const ctx = cv.getContext('2d')!;
    ctx.globalCompositeOperation = 'source-over';
    const g = ctx.createLinearGradient(0, 0, cv.width, cv.height);
    g.addColorStop(0, '#3a4048');
    g.addColorStop(0.5, '#565d66');
    g.addColorStop(1, '#3a4048');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = 'rgba(180,190,200,0.5)';
    ctx.font = 'bold 22px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('刮 开 ↯', cv.width / 2, cv.height / 2);
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.fillText('SCRATCH HERE', cv.width / 2, cv.height / 2 + 22);
  };

  const doReveal = () => {
    if (revealed.current) return;
    revealed.current = true;
    const cv = canvasRef.current;
    if (cv) cv.getContext('2d')!.clearRect(0, 0, cv.width, cv.height);
    onReveal();
  };

  // 新票：重涂、复位。
  useEffect(() => {
    revealed.current = false;
    moves.current = 0;
    coat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketKey]);

  useEffect(() => {
    if (forceReveal) doReveal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceReveal]);

  const erase = (e: React.PointerEvent) => {
    if (revealed.current || done) return;
    if (e.buttons === 0 && e.type === 'pointermove') return;
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * cv.width;
    const y = ((e.clientY - rect.top) / rect.height) * cv.height;
    const ctx = cv.getContext('2d')!;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fill();
    moves.current += 1;
    if (moves.current % 8 === 0) measure();
  };

  const measure = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const data = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
    let clear = 0;
    let total = 0;
    for (let i = 3; i < data.length; i += 16) {
      total += 1;
      if (data[i] === 0) clear += 1;
    }
    if (total && clear / total > 0.5) doReveal();
  };

  return (
    <div ref={wrapRef} className="relative mx-auto aspect-square w-full max-w-[360px] select-none">
      <div className="grid h-full w-full grid-cols-3 grid-rows-3 gap-2">
        {grid.map((name, i) => {
          const isWin = done && winningSymbol != null && name === winningSymbol;
          return (
            <div
              key={i}
              className={
                'flex items-center justify-center rounded-md border bg-terminal-bg/60 ' +
                (isWin ? 'border-terminal-green shadow-glow' : 'border-terminal-line/60')
              }
            >
              <SymbolIcon name={name} />
            </div>
          );
        })}
      </div>
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          erase(e);
        }}
        onPointerMove={erase}
        className={'absolute inset-0 h-full w-full rounded-lg ' + (done ? 'pointer-events-none' : 'cursor-pointer')}
      />
    </div>
  );
}

export default function Scratch() {
  const [amount, setAmount] = useState(50);
  const [balance, setBalance] = useState<number | null>(null);
  const [grid, setGrid] = useState<string[]>(Array(9).fill('clover'));
  const [ticketKey, setTicketKey] = useState(0);
  const [forceReveal, setForceReveal] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'scratching' | 'done'>('idle');
  const [result, setResult] = useState<PlayResult | null>(null);
  const [busy, setBusy] = useState(false);
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

  const canBuy = !busy && phase !== 'scratching' && balance != null && amount > 0 && amount <= balance;

  const buy = async () => {
    if (!canBuy) return;
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const r = await play('scratch', amount, {});
      const rng = r.rng_detail as unknown as ScratchRng;
      pending.current = r;
      setGrid(rng.grid);
      setForceReveal(false);
      setTicketKey((k) => k + 1);
      setPhase('scratching');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '买票失败，后端没连上？');
    } finally {
      setBusy(false);
    }
  };

  const onReveal = () => {
    const r = pending.current;
    if (!r) return;
    setResult(r);
    setBalance(r.balance_after);
    setPhase('done');
    setPoints((prev) => [
      ...prev,
      {
        round_index: (prev[prev.length - 1]?.round_index ?? 0) + 1,
        balance_after: r.balance_after,
        net: r.net,
        game: 'scratch',
        created_at: new Date().toISOString(),
      },
    ]);
    fetchWallet().then(setWallet).catch(() => {});
  };

  const rng = result?.rng_detail as unknown as ScratchRng | undefined;
  const curvePoints = useMemo(() => points.slice(-120), [points]);
  const scratching = phase === 'scratching';
  const done = phase === 'done';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-terminal-gray/70">
          <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">play</span> scratch
          <span className="ml-2 text-terminal-gray/50">— 即开彩票，刮 9 格，三连中奖</span>
        </h2>
        <Link to="/" className="text-xs text-terminal-cyan hover:text-terminal-green">
          ← 返回大厅
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/40 shadow-glow">
          <TitleBar path="~/casino/scratch" />
          <div className="relative flex min-h-[380px] items-center justify-center p-5 sm:min-h-[440px]">
            <ScratchCard
              grid={grid}
              ticketKey={ticketKey}
              forceReveal={forceReveal}
              winningSymbol={rng?.symbol ?? null}
              done={done}
              onReveal={onReveal}
            />
            {done && result?.outcome === 'win' && (
              <WinEffect key={ticketKey} amount={result.net} big={result.net >= 1000} />
            )}
            {(done || scratching) && (
              <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                <div
                  className={
                    'rounded-full border px-4 py-1 text-xs font-semibold backdrop-blur ' +
                    (done
                      ? result?.outcome === 'win'
                        ? 'border-terminal-green/60 text-terminal-green'
                        : 'border-terminal-red/60 text-terminal-red'
                      : 'border-terminal-line text-terminal-gray/80')
                  }
                >
                  {done
                    ? result?.outcome === 'win'
                      ? `三连 ${rng?.mult}× · +${result?.net}`
                      : '未中 · 谢谢惠顾'
                    : '拖动刮开涂层…'}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-lg border border-terminal-line bg-terminal-panel/40 p-4">
          {scratching ? (
            <button
              onClick={() => setForceReveal(true)}
              className="rounded border border-terminal-cyan/70 bg-terminal-cyan/10 py-3 font-semibold text-terminal-cyan transition hover:bg-terminal-cyan/20"
            >
              一键刮开
            </button>
          ) : (
            <>
              <div>
                <div className="mb-2 flex items-center justify-between text-xs text-terminal-gray/60">
                  <span>票价积分</span>
                  <span className={balance != null && amount > balance ? 'text-terminal-red' : 'text-terminal-yellow'}>
                    {amount}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {CHIPS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setAmount(c)}
                      disabled={busy}
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
                onClick={buy}
                disabled={!canBuy}
                className="rounded border border-terminal-pink/70 bg-terminal-pink/10 py-3 font-semibold text-terminal-pink shadow-glow-pink transition hover:bg-terminal-pink/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? '出票中…' : done ? '再买一张' : '买一张'}
              </button>
            </>
          )}

          <div className="rounded border border-terminal-line/60 p-2 text-[11px]">
            <div className="mb-1 text-terminal-gray/50">奖表（三连 · 含本金）</div>
            <div className="grid grid-cols-3 gap-x-2 gap-y-1">
              {Object.entries(SYMBOLS).map(([name, s]) => (
                <div key={name} className="flex items-center gap-1">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={'h-4 w-4 ' + s.color}>
                    {s.svg}
                  </svg>
                  <span className="text-terminal-gray/65">{s.mult}×</span>
                </div>
              ))}
            </div>
          </div>

          <div className="text-center text-xs text-terminal-gray/55">
            余额 <span className="text-terminal-yellow">{balance ?? '—'}</span> · 庄家优势高达{' '}
            <span className="text-terminal-red">~43%</span>，回报率全场最低
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
        cmd="scratch"
        how={[
          '买一张票，刮开 9 格涂层。任意一种符号出现 3 个(三连)即中对应奖，按倍率赔付(含本金)。',
          '倍率：三叶草 2× / 铃铛 3× / BAR 5× / 七 10× / 星 50× / 宝石 500×。最大奖宝石 500 倍但概率约二万五千分之一。',
          '拖动鼠标或手指刮开涂层，刮到一半自动揭晓；也可点"一键刮开"。',
        ]}
        truth="即开彩票是回报率最低的一类博彩：这张票奖表的 RTP 只有约 56.5%，庄家优势高达 43.5%——你每花 100 分，长期平均只拿回 56 分。中奖率约 1/5 看似不低，但绝大多数中奖只是 2× 拿回个零头；那个 500 倍大奖概率约二万五千分之一，正是用它撑起整张票的诱惑。彩票把最坑的期望，包装成最便宜、最容易上头的形式。"
      />
    </div>
  );
}
