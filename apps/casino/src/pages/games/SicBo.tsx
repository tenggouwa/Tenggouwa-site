import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import TitleBar from '../../components/TitleBar';
import Curve from '../../components/Curve';
import WinEffect from '../../components/WinEffect';
import GameGuide from '../../components/GameGuide';
import DiceScene, { DICE_ROLL_MS } from '../../three/DiceScene';
import { fetchCurve, fetchWallet, play, setWallet } from '../../lib/casino';
import { ApiError } from '../../lib/api';
import type { CurvePoint, PlayResult, SicBoRng } from '../../lib/types';

const CHIPS = [10, 50, 100, 500];

interface Bet {
  type: string;
  value?: number;
  label: string;
  edge: string;
}

const NUMS = [1, 2, 3, 4, 5, 6];
const TOTALS = Array.from({ length: 14 }, (_, i) => i + 4); // 4..17

function betKey(b: Bet): string {
  return `${b.type}:${b.value ?? ''}`;
}

export default function SicBo() {
  const [bet, setBet] = useState<Bet>({ type: 'big', label: '大', edge: '2.78%' });
  const [amount, setAmount] = useState(50);
  const [balance, setBalance] = useState<number | null>(null);
  const [values, setValues] = useState<[number, number, number]>([1, 2, 3]);
  const [rollKey, setRollKey] = useState(0);
  const [rolling, setRolling] = useState(false);
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

  const canRoll = !rolling && balance != null && amount > 0 && amount <= balance;
  const curKey = betKey(bet);

  const roll = async () => {
    if (!canRoll) return;
    setError(null);
    setResult(null);
    setRolling(true);
    try {
      const r = await play('sicbo', amount, { type: bet.type, value: bet.value });
      const rng = r.rng_detail as unknown as SicBoRng;
      setValues(rng.dice);
      setRollKey((k) => k + 1);
      timer.current = window.setTimeout(() => {
        setResult(r);
        setBalance(r.balance_after);
        setRolling(false);
        setPoints((prev) => [
          ...prev,
          {
            round_index: (prev[prev.length - 1]?.round_index ?? 0) + 1,
            balance_after: r.balance_after,
            net: r.net,
            game: 'sicbo',
            created_at: new Date().toISOString(),
          },
        ]);
        fetchWallet().then(setWallet).catch(() => {});
      }, DICE_ROLL_MS + 120);
    } catch (e) {
      setRolling(false);
      setError(e instanceof ApiError ? e.message : '下注失败，后端没连上？');
    }
  };

  const rng = result?.rng_detail as unknown as SicBoRng | undefined;
  const curvePoints = useMemo(() => points.slice(-120), [points]);

  const chipBtn = (b: Bet, extra = '') => {
    const active = curKey === betKey(b);
    return (
      <button
        key={betKey(b)}
        onClick={() => setBet(b)}
        disabled={rolling}
        className={
          'rounded border py-2 text-xs transition disabled:opacity-50 ' +
          extra +
          (active
            ? ' border-terminal-green text-terminal-green shadow-glow'
            : ' border-terminal-line text-terminal-gray/80 hover:border-terminal-green/50')
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
          <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">play</span> sicbo
          <span className="ml-2 text-terminal-gray/50">— 完整骰宝：大小/单点/总和/豹子</span>
        </h2>
        <Link to="/" className="text-xs text-terminal-cyan hover:text-terminal-green">
          ← 返回大厅
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/40 shadow-glow">
          <TitleBar path="~/casino/sicbo" />
          <div className="relative h-[340px] w-full sm:h-[400px]">
            <DiceScene values={values} rollKey={rollKey} />
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
                  {rng.dice.join(' + ')} = {rng.total}
                  {rng.triple ? ' 豹子' : ''} · {result.net > 0 ? `+${result.net}` : result.net}
                </div>
              </div>
            )}
            {rolling && !result && (
              <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-terminal-gray/60">
                掷骰中<span className="animate-blink">_</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-terminal-line bg-terminal-panel/40 p-4">
          <div className="text-xs text-terminal-gray/60">押「{bet.label}」· 庄家优势 {bet.edge}</div>

          <div className="grid grid-cols-2 gap-2">
            {chipBtn({ type: 'small', label: '小 4–10', edge: '2.78%' })}
            {chipBtn({ type: 'big', label: '大 11–17', edge: '2.78%' })}
          </div>

          <div>
            <div className="mb-1 text-[10px] text-terminal-gray/50">单点（出 n 颗赔 n:1）</div>
            <div className="grid grid-cols-6 gap-1.5">
              {NUMS.map((n) => chipBtn({ type: 'number', value: n, label: String(n), edge: '7.9%' }))}
            </div>
          </div>

          <div>
            <div className="mb-1 text-[10px] text-terminal-gray/50">总和（4–17，赔率各异）</div>
            <div className="grid grid-cols-7 gap-1">
              {TOTALS.map((t) => chipBtn({ type: 'total', value: t, label: String(t), edge: '12–30%' }))}
            </div>
          </div>

          <div>
            <div className="mb-1 text-[10px] text-terminal-gray/50">豹子 / 对子</div>
            <div className="grid grid-cols-3 gap-1.5">
              {chipBtn({ type: 'any_triple', label: '任意豹子 30:1', edge: '13.9%' })}
              {chipBtn({ type: 'triple', value: 1, label: '豹1 150:1', edge: '30%' })}
              {chipBtn({ type: 'double', value: 1, label: '对1 10:1', edge: '18.5%' })}
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
                  disabled={rolling}
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
            onClick={roll}
            disabled={!canRoll}
            className="rounded border border-terminal-pink/70 bg-terminal-pink/10 py-3 font-semibold text-terminal-pink shadow-glow-pink transition hover:bg-terminal-pink/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {rolling ? '掷骰中…' : '掷骰子'}
          </button>

          <div className="text-center text-xs text-terminal-gray/55">
            余额 <span className="text-terminal-yellow">{balance ?? '—'}</span>
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
        cmd="sicbo"
        how={[
          '三颗骰子。押大(11–17)/小(4–10) 1:1，豹子(三同号)通杀。',
          '押单点 1–6：出现 1/2/3 颗分别赔 1:1 / 2:1 / 3:1。',
          '押总和 4–17、任意豹子 30:1、指定豹子 150:1、指定对子 10:1。',
        ]}
        truth="大/小庄家优势最低(2.78%)，但那些诱人的高赔率项坑得多：指定豹子 150:1 的真实优势约 30%、总和 4/17 约 29%。赔率越炫，期望越差——这是骰宝最大的套路。"
      />
    </div>
  );
}
