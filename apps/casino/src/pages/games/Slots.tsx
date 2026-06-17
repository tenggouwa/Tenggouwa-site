import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import TitleBar from '../../components/TitleBar';
import Curve from '../../components/Curve';
import WinEffect from '../../components/WinEffect';
import GameGuide from '../../components/GameGuide';
import SlotsScene, { SLOTS_SPIN_MS } from '../../three/SlotsScene';
import { fetchCurve, fetchWallet, play, setWallet } from '../../lib/casino';
import { ApiError } from '../../lib/api';
import type { CurvePoint, PlayResult, SlotsRng } from '../../lib/types';

const CHIPS = [10, 50, 100, 500];
const SYM_LABEL: Record<string, string> = {
  seven: '7',
  cherry: '樱桃',
  bar: 'BAR',
  bell: '铃',
  diamond: '钻',
  blank: '空',
};

export default function Slots() {
  const [amount, setAmount] = useState(50);
  const [balance, setBalance] = useState<number | null>(null);
  const [reels, setReels] = useState<string[]>(['blank', 'blank', 'blank']);
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
      const r = await play('slots', amount, {});
      const rng = r.rng_detail as unknown as SlotsRng;
      setReels(rng.reels);
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
            game: 'slots',
            created_at: new Date().toISOString(),
          },
        ]);
        fetchWallet().then(setWallet).catch(() => {});
      }, SLOTS_SPIN_MS + 150);
    } catch (e) {
      setSpinning(false);
      setError(e instanceof ApiError ? e.message : '下注失败，后端没连上？');
    }
  };

  const rng = result?.rng_detail as unknown as SlotsRng | undefined;
  const curvePoints = useMemo(() => points.slice(-120), [points]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-terminal-gray/70">
          <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">play</span> slots
          <span className="ml-2 text-terminal-gray/50">— 看似随机，赔率早写死（RTP 93.96%）</span>
        </h2>
        <Link to="/" className="text-xs text-terminal-cyan hover:text-terminal-green">
          ← 返回大厅
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/40 shadow-glow">
          <TitleBar path="~/casino/slots" />
          <div className="relative h-[360px] w-full sm:h-[420px]">
            <SlotsScene reels={reels} rollKey={rollKey} />
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
                  {rng.reels.map((s) => SYM_LABEL[s] ?? s).join(' · ')} ·{' '}
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
          <div className="rounded border border-terminal-line/60 bg-terminal-bg/40 p-3 text-xs leading-relaxed text-terminal-gray/70">
            <div className="mb-1 text-terminal-gray/80">赔付表（三同 / 押注倍数）</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              <span>7 7 7</span>
              <span className="text-right text-terminal-yellow">×350</span>
              <span>钻 钻 钻</span>
              <span className="text-right text-terminal-yellow">×120</span>
              <span>铃 铃 铃</span>
              <span className="text-right text-terminal-yellow">×45</span>
              <span>BAR ×3</span>
              <span className="text-right text-terminal-yellow">×20</span>
              <span>樱桃 ×3</span>
              <span className="text-right text-terminal-yellow">×10</span>
              <span>樱桃 ×2</span>
              <span className="text-right text-terminal-yellow">×4</span>
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
            {spinning ? '转动中…' : '拉杆'}
          </button>

          <div className="text-center text-xs text-terminal-gray/55">
            余额 <span className="text-terminal-yellow">{balance ?? '—'}</span> · 庄家优势{' '}
            <span className="text-terminal-red">6.04%</span> · 命中率 ~11.6%
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
        cmd="slots"
        how={[
          '拉杆，三根卷轴各停一个符号。三个相同按赔付表赔：7×350 / 钻×120 / 铃×45 / BAR×20 / 樱桃×10。',
          '两个樱桃给安慰奖 ×4。每个符号出现的概率由卷轴权重写死。',
        ]}
        truth="看似随机，其实 RTP=93.96%(庄家优势 6.04%)是算好的，命中率仅约 11.6%——大多数拉杆都是亏。偶尔一次大奖让人上头，正是老虎机最赚钱的设计。"
      />
    </div>
  );
}
