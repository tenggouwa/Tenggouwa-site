import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import TitleBar from '../../components/TitleBar';
import Curve from '../../components/Curve';
import WinEffect from '../../components/WinEffect';
import GameGuide from '../../components/GameGuide';
import VideoPokerScene from '../../three/VideoPokerScene';
import { fetchCurve, fetchWallet, setWallet, vpDeal, vpDraw } from '../../lib/casino';
import { ApiError } from '../../lib/api';
import type { CurvePoint, VideoPokerState } from '../../lib/types';

const CHIPS = [10, 50, 100, 500];
const SUIT_CHAR: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

// 9/6 Jacks or Better 赔付表（含本金返还倍率）。
const PAYTABLE: { key: string; name: string; mult: number }[] = [
  { key: 'royal_flush', name: '皇家同花顺', mult: 250 },
  { key: 'straight_flush', name: '同花顺', mult: 50 },
  { key: 'four_kind', name: '四条', mult: 25 },
  { key: 'full_house', name: '葫芦', mult: 9 },
  { key: 'flush', name: '同花', mult: 6 },
  { key: 'straight', name: '顺子', mult: 4 },
  { key: 'three_kind', name: '三条', mult: 3 },
  { key: 'two_pair', name: '两对', mult: 2 },
  { key: 'jacks_or_better', name: '一对 J 以上', mult: 1 },
];

export default function VideoPoker() {
  const [amount, setAmount] = useState(50);
  const [balance, setBalance] = useState<number | null>(null);
  const [vp, setVp] = useState<VideoPokerState | null>(null);
  const [holds, setHolds] = useState<boolean[]>([false, false, false, false, false]);
  const [dealKey, setDealKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<CurvePoint[]>([]);

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

  const deal = async () => {
    if (busy || balance == null || amount <= 0 || amount > balance) return;
    setError(null);
    setBusy(true);
    try {
      const s = await vpDeal(amount);
      setHolds([false, false, false, false, false]);
      setDealKey((k) => k + 1);
      setVp(s);
      setBalance(s.balance);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '开局失败，后端没连上？');
    } finally {
      setBusy(false);
    }
  };

  const draw = async () => {
    if (busy || vp?.status !== 'dealt') return;
    setBusy(true);
    try {
      const keep = holds.map((h, i) => (h ? i : -1)).filter((i) => i >= 0);
      const s = await vpDraw(keep);
      setVp(s);
      setBalance(s.balance);
      setPoints((prev) => [
        ...prev,
        {
          round_index: (prev[prev.length - 1]?.round_index ?? 0) + 1,
          balance_after: s.balance,
          net: s.net,
          game: 'videopoker',
          created_at: new Date().toISOString(),
        },
      ]);
      fetchWallet().then(setWallet).catch(() => {});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '换牌失败');
    } finally {
      setBusy(false);
    }
  };

  const toggleHold = (i: number) => {
    if (vp?.status !== 'dealt' || busy) return;
    setHolds((prev) => prev.map((h, k) => (k === i ? !h : h)));
  };

  const dealt = vp?.status === 'dealt';
  const done = vp?.status === 'done';
  const hand = vp?.hand ?? [];
  const curvePoints = useMemo(() => points.slice(-120), [points]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-terminal-gray/70">
          <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">play</span> videopoker
          <span className="ml-2 text-terminal-gray/50">— 发 5 张，留牌换牌，按牌型赔付</span>
        </h2>
        <Link to="/" className="text-xs text-terminal-cyan hover:text-terminal-green">
          ← 返回大厅
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/40 shadow-glow">
          <TitleBar path="~/casino/videopoker" />
          <div className="relative h-[300px] w-full sm:h-[340px]">
            <VideoPokerScene hand={hand} holds={holds} dealKey={dealKey} />
            {done && vp?.outcome === 'win' && <WinEffect key={dealKey} amount={vp.net} big={vp.net >= 1000} />}
            {vp && (
              <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                <div
                  className={
                    'rounded-full border px-4 py-1 text-xs font-semibold backdrop-blur ' +
                    (done
                      ? vp.outcome === 'win'
                        ? 'border-terminal-green/60 text-terminal-green'
                        : vp.outcome === 'push'
                          ? 'border-terminal-yellow/60 text-terminal-yellow'
                          : 'border-terminal-red/60 text-terminal-red'
                      : 'border-terminal-line text-terminal-gray/80')
                  }
                >
                  {done
                    ? `${vp.category_name} · ${vp.multiplier > 0 ? `${vp.multiplier}倍` : '未成牌'}${
                        vp.net > 0 ? ` +${vp.net}` : vp.net === 0 ? ' 退本金' : ` ${vp.net}`
                      }`
                    : '选要留下的牌，再换牌'}
                </div>
              </div>
            )}
          </div>
          {/* 留牌切换：发牌后每张一个 HOLD 钮 */}
          {(dealt || done) && (
            <div className="grid grid-cols-5 gap-2 border-t border-terminal-line/50 p-3">
              {hand.map((c, i) => {
                const red = c.s === 'h' || c.s === 'd';
                return (
                  <button
                    key={i}
                    onClick={() => toggleHold(i)}
                    disabled={!dealt || busy}
                    className={
                      'flex flex-col items-center gap-1 rounded border py-2 text-xs transition disabled:cursor-default ' +
                      (holds[i]
                        ? 'border-terminal-green text-terminal-green shadow-glow'
                        : 'border-terminal-line text-terminal-gray/70 enabled:hover:border-terminal-green/50')
                    }
                  >
                    <span className={red ? 'text-terminal-red' : 'text-terminal-gray/90'}>
                      {c.r}
                      {SUIT_CHAR[c.s]}
                    </span>
                    <span className="text-[10px]">{holds[i] ? 'HOLD' : '换'}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 rounded-lg border border-terminal-line bg-terminal-panel/40 p-4">
          {dealt ? (
            <button
              onClick={draw}
              disabled={busy}
              className="rounded border border-terminal-green/70 bg-terminal-green/10 py-3 font-semibold text-terminal-green shadow-glow transition hover:bg-terminal-green/20 disabled:opacity-40"
            >
              {busy ? '换牌中…' : `换牌 Draw（留 ${holds.filter(Boolean).length} 张）`}
            </button>
          ) : (
            <>
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
                onClick={deal}
                disabled={busy || balance == null || amount > balance}
                className="rounded border border-terminal-pink/70 bg-terminal-pink/10 py-3 font-semibold text-terminal-pink shadow-glow-pink transition hover:bg-terminal-pink/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? '发牌中…' : done ? '再来一局' : '发牌'}
              </button>
            </>
          )}

          <div className="rounded border border-terminal-line/60 p-2 text-[11px]">
            <div className="mb-1 text-terminal-gray/50">赔付表（含本金）</div>
            <div className="space-y-0.5">
              {PAYTABLE.map((p) => (
                <div
                  key={p.key}
                  className={
                    'flex justify-between ' +
                    (done && vp?.category === p.key ? 'text-terminal-green' : 'text-terminal-gray/65')
                  }
                >
                  <span>{p.name}</span>
                  <span>{p.mult}×</span>
                </div>
              ))}
            </div>
          </div>

          <div className="text-center text-xs text-terminal-gray/55">
            余额 <span className="text-terminal-yellow">{balance ?? '—'}</span> · 最优留牌 RTP≈
            <span className="text-terminal-red">99.5%</span>，仍是负期望
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
        cmd="videopoker"
        how={[
          '发 5 张牌，你选择留下哪几张(HOLD)，其余的换成新牌——换上来的牌在发牌时就已定好，你改不了。',
          '按换牌后的最终牌型查赔付表结算：一对 J 以上才回本(1×)，越大的牌型赔得越多，最高皇家同花顺 250×。',
          '点 HOLD 切换每张牌的去留，再点"换牌"。',
        ]}
        truth="9/6 全赔表 + 每手最优留牌，RTP 能到 99.5%，是赌场返还率最高的机器——但它仍然小于 100%，长期照样是负期望，玩越久输越多。而且 99.5% 是数学最优解的前提；绝大多数人留牌全凭感觉(留错牌、为凑同花顺丢掉到手的对子)，实际 RTP 常掉到 96% 以下。它用「看似有技巧、偶尔爆一个大奖」的设计，让你误以为能赢。"
      />
    </div>
  );
}
