import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import TitleBar from '../../components/TitleBar';
import Curve from '../../components/Curve';
import WinEffect from '../../components/WinEffect';
import GameGuide from '../../components/GameGuide';
import { fetchCurve, fetchWallet, minesCashout, minesReveal, minesStart, setWallet } from '../../lib/casino';
import { ApiError } from '../../lib/api';
import type { CurvePoint, MinesState } from '../../lib/types';

const CHIPS = [10, 50, 100, 500];
const MINE_OPTIONS = [1, 3, 5, 10];
const CELLS = Array.from({ length: 25 }, (_, i) => i);

export default function Mines() {
  const [amount, setAmount] = useState(50);
  const [mines, setMines] = useState(3);
  const [balance, setBalance] = useState<number | null>(null);
  const [state, setState] = useState<MinesState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<CurvePoint[]>([]);
  const [roundKey, setRoundKey] = useState(0);

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

  const active = state?.status === 'active';
  const done = state?.status === 'done';

  const settle = (s: MinesState) => {
    setBalance(s.balance);
    if (s.status === 'done') {
      setPoints((prev) => [
        ...prev,
        {
          round_index: (prev[prev.length - 1]?.round_index ?? 0) + 1,
          balance_after: s.balance,
          net: s.net,
          game: 'mines',
          created_at: new Date().toISOString(),
        },
      ]);
      fetchWallet().then(setWallet).catch(() => {});
    }
  };

  const start = async () => {
    if (busy || balance == null || amount <= 0 || amount > balance) return;
    setError(null);
    setBusy(true);
    try {
      const s = await minesStart(amount, mines);
      setRoundKey((k) => k + 1);
      setState(s);
      setBalance(s.balance);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '开局失败，后端没连上？');
    } finally {
      setBusy(false);
    }
  };

  const reveal = async (tile: number) => {
    if (busy || !active || state?.revealed.includes(tile)) return;
    setBusy(true);
    try {
      const s = await minesReveal(tile);
      setState(s);
      settle(s);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '翻格失败');
    } finally {
      setBusy(false);
    }
  };

  const cashout = async () => {
    if (busy || !active || !state?.can_cashout) return;
    setBusy(true);
    try {
      const s = await minesCashout();
      setState(s);
      settle(s);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '兑现失败');
    } finally {
      setBusy(false);
    }
  };

  const curvePoints = useMemo(() => points.slice(-120), [points]);
  const revealedSet = useMemo(() => new Set(state?.revealed ?? []), [state]);
  const mineSet = useMemo(() => new Set(state?.mine_positions ?? []), [state]);

  const cellClass = (i: number) => {
    const gem = revealedSet.has(i);
    const mine = done && mineSet.has(i);
    if (mine) return 'border-terminal-red bg-terminal-red/25 text-terminal-red';
    if (gem) return 'border-terminal-green/70 bg-terminal-green/20 text-terminal-green shadow-glow';
    if (done) return 'border-terminal-line/40 text-terminal-gray/30';
    return 'border-terminal-line/70 text-terminal-gray/40 hover:border-terminal-cyan/60 hover:bg-terminal-cyan/5';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-terminal-gray/70">
          <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">play</span> mines
          <span className="ml-2 text-terminal-gray/50">— 翻格避雷，随时兑现，踩雷归零</span>
        </h2>
        <Link to="/" className="text-xs text-terminal-cyan hover:text-terminal-green">
          ← 返回大厅
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="relative overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/40 p-3 shadow-glow">
          <TitleBar path="~/casino/mines" />
          <div className="mx-auto mt-3 grid max-w-[420px] grid-cols-5 gap-2">
            {CELLS.map((i) => {
              const gem = revealedSet.has(i);
              const mine = done && mineSet.has(i);
              return (
                <button
                  key={i}
                  onClick={() => reveal(i)}
                  disabled={busy || !active || revealedSet.has(i)}
                  className={'flex aspect-square items-center justify-center rounded border text-xl transition ' + cellClass(i)}
                >
                  {mine ? '✕' : gem ? '◆' : ''}
                </button>
              );
            })}
          </div>
          {done && !state?.busted && state && state.net > 0 && (
            <WinEffect key={roundKey} amount={state.net} big={state.net >= 1000} />
          )}
        </div>

        <div className="flex flex-col gap-4 rounded-lg border border-terminal-line bg-terminal-panel/40 p-4">
          {active ? (
            <>
              <div className="rounded border border-terminal-line/60 bg-terminal-bg/40 p-3 text-center text-xs text-terminal-gray/75">
                已翻 <span className="text-terminal-green">{state.revealed.length}</span> 格 · 当前{' '}
                <span className="text-terminal-yellow">×{state.current_mult.toFixed(2)}</span>
                <div className="mt-1 text-terminal-gray/50">
                  再翻对一格 → ×{state.next_mult.toFixed(2)}（{mines} 颗雷）
                </div>
              </div>
              <button
                onClick={cashout}
                disabled={busy || !state.can_cashout}
                className="rounded border border-terminal-green/70 bg-terminal-green/10 py-3 font-semibold text-terminal-green shadow-glow transition hover:bg-terminal-green/20 disabled:opacity-40"
              >
                兑现 {state.can_cashout ? `+${Math.floor(state.bet * state.current_mult) - state.bet}` : '（先翻一格）'}
              </button>
              <div className="text-center text-xs text-terminal-gray/50">点格子翻开；踩雷则本金归零</div>
            </>
          ) : (
            <>
              <div>
                <div className="mb-2 text-xs text-terminal-gray/60">地雷数（越多倍率涨越快，也越易炸）</div>
                <div className="grid grid-cols-4 gap-2">
                  {MINE_OPTIONS.map((m) => (
                    <button
                      key={m}
                      onClick={() => setMines(m)}
                      disabled={busy}
                      className={
                        'rounded border py-2 text-xs transition disabled:opacity-50 ' +
                        (mines === m
                          ? 'border-terminal-green text-terminal-green shadow-glow'
                          : 'border-terminal-line text-terminal-gray/80 hover:border-terminal-green/50')
                      }
                    >
                      {m} 雷
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
              {done && state && (
                <div
                  className={
                    'rounded border px-3 py-2 text-center text-xs ' +
                    (state.busted
                      ? 'border-terminal-red/60 text-terminal-red'
                      : 'border-terminal-green/60 text-terminal-green')
                  }
                >
                  {state.busted ? `踩雷归零 ${state.net}` : `兑现 ×${state.current_mult.toFixed(2)} · +${state.net}`}
                </div>
              )}
              <button
                onClick={start}
                disabled={busy || balance == null || amount > balance}
                className="rounded border border-terminal-pink/70 bg-terminal-pink/10 py-3 font-semibold text-terminal-pink shadow-glow-pink transition hover:bg-terminal-pink/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? '处理中…' : done ? '再来一局' : '开始'}
              </button>
            </>
          )}

          <div className="text-center text-xs text-terminal-gray/55">
            余额 <span className="text-terminal-yellow">{balance ?? '—'}</span> · 庄家优势{' '}
            <span className="text-terminal-red">2%</span>
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
        cmd="mines"
        how={[
          '5×5 共 25 格，开局前选地雷数。每翻开一个安全格，兑现倍率上涨；随时可兑现落袋。',
          '一旦翻到地雷，本金全部归零。',
        ]}
        truth="倍率里藏着 (1-2%) 的因子，使得无论你翻几格、几时收手，长期 RTP 恒为 98%。『再翻一个就收』的侥幸心理，正是它和崩盘一样让人停不下来的设计——多翻一格的诱惑永远在，期望却一直是负的。"
      />
    </div>
  );
}
