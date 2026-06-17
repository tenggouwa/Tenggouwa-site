import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import TitleBar from '../../components/TitleBar';
import Curve from '../../components/Curve';
import WinEffect from '../../components/WinEffect';
import GameGuide from '../../components/GameGuide';
import DiceScene, { DICE_ROLL_MS } from '../../three/DiceScene';
import { fetchCurve, fetchWallet, play, setWallet } from '../../lib/casino';
import { ApiError } from '../../lib/api';
import type { CurvePoint, DiceRng, PlayResult } from '../../lib/types';

type Side = 'big' | 'small';
const CHIPS = [10, 50, 100, 500];

export default function Dice() {
  const [side, setSide] = useState<Side>('big');
  const [bet, setBet] = useState(50);
  const [balance, setBalance] = useState<number | null>(null);
  const [values, setValues] = useState<[number, number, number]>([1, 2, 3]);
  const [rollKey, setRollKey] = useState(0);
  const [rolling, setRolling] = useState(false);
  const [result, setResult] = useState<PlayResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<CurvePoint[]>([]);
  const revealTimer = useRef<number | null>(null);

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
      if (revealTimer.current) window.clearTimeout(revealTimer.current);
    };
  }, []);

  const canRoll = !rolling && balance != null && bet > 0 && bet <= balance;

  const roll = async () => {
    if (!canRoll) return;
    setError(null);
    setResult(null);
    setRolling(true);
    try {
      const r = await play('dice', bet, { bet: side });
      const rng = r.rng_detail as unknown as DiceRng;
      setValues(rng.dice);
      setRollKey((k) => k + 1);
      // 等动画把骰子"演到"后端点数，再揭晓输赢 + 刷新余额/曲线。
      revealTimer.current = window.setTimeout(() => {
        setResult(r);
        setBalance(r.balance_after);
        setRolling(false);
        setPoints((prev) => [
          ...prev,
          {
            round_index: (prev[prev.length - 1]?.round_index ?? 0) + 1,
            balance_after: r.balance_after,
            net: r.net,
            game: 'dice',
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

  const lastRng = result?.rng_detail as unknown as DiceRng | undefined;
  const curvePoints = useMemo(() => points.slice(-120), [points]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-terminal-gray/70">
          <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">play</span> dice
          <span className="ml-2 text-terminal-gray/50">— 三颗骰子押大小，豹子通杀</span>
        </h2>
        <Link to="/" className="text-xs text-terminal-cyan hover:text-terminal-green">
          ← 返回大厅
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* 3D 牌桌 */}
        <div className="overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/40 shadow-glow">
          <TitleBar path="~/casino/dice" />
          <div className="relative h-[340px] w-full sm:h-[400px]">
            <DiceScene values={values} rollKey={rollKey} />
            {result?.outcome === 'win' && <WinEffect key={rollKey} amount={result.net} big={result.net >= 1000} />}
            {/* 结果浮层 */}
            {result && lastRng && (
              <div className="pointer-events-none absolute inset-x-0 top-3 flex flex-col items-center gap-1">
                <div
                  className={
                    'rounded-full border px-4 py-1 text-sm font-semibold backdrop-blur ' +
                    (result.outcome === 'win'
                      ? 'border-terminal-green/60 text-terminal-green'
                      : 'border-terminal-red/60 text-terminal-red')
                  }
                >
                  {lastRng.triple
                    ? `豹子 ${lastRng.dice.join('-')} · 通杀`
                    : `${lastRng.dice.join(' + ')} = ${lastRng.total} · ${lastRng.result === 'big' ? '大' : '小'}`}
                  {' · '}
                  {result.outcome === 'win' ? `+${result.net}` : `${result.net}`}
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

        {/* 下注面板 */}
        <div className="flex flex-col gap-4 rounded-lg border border-terminal-line bg-terminal-panel/40 p-4">
          <div>
            <div className="mb-2 text-xs text-terminal-gray/60">押注方向</div>
            <div className="grid grid-cols-2 gap-2">
              {(['small', 'big'] as Side[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  disabled={rolling}
                  className={
                    'rounded border py-3 text-center transition disabled:opacity-50 ' +
                    (side === s
                      ? 'border-terminal-green text-terminal-green shadow-glow'
                      : 'border-terminal-line text-terminal-gray/80 hover:border-terminal-green/50')
                  }
                >
                  <div className="text-lg font-semibold">{s === 'big' ? '大' : '小'}</div>
                  <div className="text-[10px] text-terminal-gray/50">{s === 'big' ? '11–17' : '4–10'} · 1:1</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between text-xs text-terminal-gray/60">
              <span>下注积分</span>
              <span className={balance != null && bet > balance ? 'text-terminal-red' : 'text-terminal-yellow'}>
                {bet}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {CHIPS.map((c) => (
                <button
                  key={c}
                  onClick={() => setBet(c)}
                  disabled={rolling}
                  className={
                    'rounded border py-1.5 text-xs transition disabled:opacity-50 ' +
                    (bet === c
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
            余额 <span className="text-terminal-yellow">{balance ?? '—'}</span> · 庄家优势{' '}
            <span className="text-terminal-red">2.78%</span>
          </div>
          {error && <div className="text-center text-xs text-terminal-red">{error}</div>}
        </div>
      </div>

      {/* 本局玩家曲线 */}
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
        cmd="dice"
        how={[
          '三颗骰子，押"大"(总和 11–17)或"小"(4–10)，猜中 1:1（赢回等额）。',
          '任意"豹子"(三颗同号，如 5-5-5)庄家通杀——押大押小都输。',
        ]}
        truth="赢面 105/216、输面 111/216，那一手豹子就是 2.78% 的庄家优势。单把看运气，玩越多越逼近这个抽水，长期必输。"
      />
    </div>
  );
}
