import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import TitleBar from '../../components/TitleBar';
import Curve from '../../components/Curve';
import WinEffect from '../../components/WinEffect';
import GameGuide from '../../components/GameGuide';
import NiuNiuScene, { dealDurationMs, type NiuNiuHand } from '../../three/NiuNiuScene';
import { fetchCurve, fetchWallet, play, setWallet } from '../../lib/casino';
import { ApiError } from '../../lib/api';
import type { CurvePoint, NiuNiuRng, PlayResult } from '../../lib/types';

const CHIPS = [10, 50, 100, 500];
const EMPTY: NiuNiuHand = { player: [], banker: [] };

function niuName(n: number): string {
  if (n === 0) return '无牛';
  if (n === 10) return '牛牛';
  return `牛${n}`;
}

export default function NiuNiu() {
  const [amount, setAmount] = useState(50);
  const [balance, setBalance] = useState<number | null>(null);
  const [hand, setHand] = useState<NiuNiuHand>(EMPTY);
  const [rollKey, setRollKey] = useState(0);
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
      const r = await play('niuniu', amount, {});
      const rng = r.rng_detail as unknown as NiuNiuRng;
      setHand({ player: rng.player, banker: rng.banker });
      setRollKey((k) => k + 1);
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
            game: 'niuniu',
            created_at: new Date().toISOString(),
          },
        ]);
        fetchWallet().then(setWallet).catch(() => {});
      }, dealDurationMs(10) + 150);
    } catch (e) {
      setDealing(false);
      setError(e instanceof ApiError ? e.message : '下注失败，后端没连上？');
    }
  };

  const rng = result?.rng_detail as unknown as NiuNiuRng | undefined;
  const curvePoints = useMemo(() => points.slice(-120), [points]);
  const resultLabel = (res: string) => (res === 'player' ? '你赢了' : res === 'banker' ? '庄家赢' : '平牌 · 退本金');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-terminal-gray/70">
          <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">play</span> niuniu
          <span className="ml-2 text-terminal-gray/50">— 闲庄各 5 张比牛，牛大者赢</span>
        </h2>
        <Link to="/" className="text-xs text-terminal-cyan hover:text-terminal-green">
          ← 返回大厅
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/40 shadow-glow">
          <TitleBar path="~/casino/niuniu" />
          <div className="relative h-[380px] w-full sm:h-[440px]">
            <NiuNiuScene hand={hand} rollKey={rollKey} />
            {result?.outcome === 'win' && <WinEffect key={rollKey} amount={result.net} big={result.net >= 1000} />}
            {result && rng && (
              <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                <div
                  className={
                    'rounded-full border px-4 py-1 text-sm font-semibold backdrop-blur ' +
                    (result.outcome === 'win'
                      ? 'border-terminal-green/60 text-terminal-green'
                      : rng.result === 'tie'
                        ? 'border-terminal-yellow/60 text-terminal-yellow'
                        : 'border-terminal-red/60 text-terminal-red')
                  }
                >
                  你 {niuName(rng.player_niu)} · 庄 {niuName(rng.banker_niu)} · {resultLabel(rng.result)}
                  {result.net > 0 ? ` +${result.net}` : result.net === 0 ? '' : ` ${result.net}`}
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
            <div className="mb-2 flex items-center justify-between text-xs text-terminal-gray/60">
              <span>下注积分（押"闲"赢庄）</span>
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

          <div className="rounded border border-terminal-line/60 p-2 text-[11px] leading-relaxed text-terminal-gray/55">
            牛型：无牛 &lt; 牛1…牛9 &lt; 牛牛。本局均注 1:1，赢了抽 5% 水，平牌退本金——牛型只决定胜负。
          </div>

          <div className="text-center text-xs text-terminal-gray/55">
            余额 <span className="text-terminal-yellow">{balance ?? '—'}</span> · 看着对半开，抽水让庄家优势{' '}
            <span className="text-terminal-red">~2.46%</span>
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
        cmd="niuniu"
        how={[
          '闲(你)和庄各发 5 张。从 5 张里找任意 3 张点数和为 10 的倍数，余下 2 张之和的个位就是"牛几"。',
          '余 2 张个位为 0 是"牛牛"(最大)；凑不出任何 3 张为 10 的倍数是"无牛"(最小)。点数 A=1，2-10 按面值，J/Q/K=10。',
          '牛大的一方赢。本模拟为均注 1:1：赢抽 5% 水，平牌退本金。',
        ]}
        truth="牌是对半开的——你和庄赢面几乎一样。但只要你赢就被抽 5% 水，长期庄家优势约 2.46%。这正是赌场的核心戏法：给你一个看似公平的对局，靠每次结算悄悄刮一刀，时间一长稳赢的永远是庄家。"
      />
    </div>
  );
}
