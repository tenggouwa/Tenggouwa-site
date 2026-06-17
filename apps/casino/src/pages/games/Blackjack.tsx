import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import TitleBar from '../../components/TitleBar';
import Curve from '../../components/Curve';
import WinEffect from '../../components/WinEffect';
import GameGuide from '../../components/GameGuide';
import BlackjackScene from '../../three/BlackjackScene';
import { bjAction, bjDeal, fetchCurve, fetchWallet, setWallet } from '../../lib/casino';
import { ApiError } from '../../lib/api';
import type { BlackjackState, CurvePoint } from '../../lib/types';

const CHIPS = [10, 50, 100, 500];

const RESULT_LABEL: Record<string, string> = {
  player: '你赢了',
  dealer: '庄家赢',
  push: '平局 · 退本金',
  player_blackjack: 'BLACKJACK! 3:2',
};

export default function Blackjack() {
  const [amount, setAmount] = useState(50);
  const [balance, setBalance] = useState<number | null>(null);
  const [bj, setBj] = useState<BlackjackState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<CurvePoint[]>([]);
  const [handKey, setHandKey] = useState(0);

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

  const settle = (s: BlackjackState) => {
    setBalance(s.balance);
    if (s.status === 'done') {
      setPoints((prev) => [
        ...prev,
        {
          round_index: (prev[prev.length - 1]?.round_index ?? 0) + 1,
          balance_after: s.balance,
          net: s.net,
          game: 'blackjack',
          created_at: new Date().toISOString(),
        },
      ]);
      fetchWallet().then(setWallet).catch(() => {});
    }
  };

  const deal = async () => {
    if (busy || balance == null || amount <= 0 || amount > balance) return;
    setError(null);
    setBusy(true);
    try {
      const s = await bjDeal(amount);
      setHandKey((k) => k + 1);
      setBj(s);
      settle(s);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '开局失败，后端没连上？');
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: 'hit' | 'stand' | 'double') => {
    if (busy) return;
    setBusy(true);
    try {
      const s = await bjAction(action);
      setBj(s);
      settle(s);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const playing = bj?.status === 'player_turn';
  const done = bj?.status === 'done';
  const curvePoints = useMemo(() => points.slice(-120), [points]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-terminal-gray/70">
          <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">play</span> blackjack
          <span className="ml-2 text-terminal-gray/50">— 要牌/停牌/双倍，庄家要到 17 点</span>
        </h2>
        <Link to="/" className="text-xs text-terminal-cyan hover:text-terminal-green">
          ← 返回大厅
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/40 shadow-glow">
          <TitleBar path="~/casino/blackjack" />
          <div className="relative h-[380px] w-full sm:h-[440px]">
            <BlackjackScene
              player={bj?.player ?? []}
              dealer={bj?.dealer ?? []}
              holeHidden={bj?.status === 'player_turn'}
            />
            {done && bj?.outcome === 'win' && <WinEffect key={handKey} amount={bj.net} big={bj.net >= 1000} />}
            {bj && (
              <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                <div
                  className={
                    'rounded-full border px-4 py-1 text-xs font-semibold backdrop-blur ' +
                    (done
                      ? bj.outcome === 'win'
                        ? 'border-terminal-green/60 text-terminal-green'
                        : bj.outcome === 'push'
                          ? 'border-terminal-yellow/60 text-terminal-yellow'
                          : 'border-terminal-red/60 text-terminal-red'
                      : 'border-terminal-line text-terminal-gray/80')
                  }
                >
                  你 {bj.player_total}
                  {done ? ` · 庄 ${bj.dealer_total}` : ' · 庄 ?'}
                  {done && ` · ${RESULT_LABEL[bj.result ?? ''] ?? ''}`}
                  {done && (bj.net > 0 ? ` +${bj.net}` : bj.net < 0 ? ` ${bj.net}` : '')}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-lg border border-terminal-line bg-terminal-panel/40 p-4">
          {playing ? (
            <div className="space-y-2">
              <div className="text-xs text-terminal-gray/60">当前点数 {bj?.player_total}</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => act('hit')}
                  disabled={busy}
                  className="rounded border border-terminal-green/60 py-3 font-semibold text-terminal-green transition hover:bg-terminal-green/10 disabled:opacity-40"
                >
                  要牌 Hit
                </button>
                <button
                  onClick={() => act('stand')}
                  disabled={busy}
                  className="rounded border border-terminal-cyan/60 py-3 font-semibold text-terminal-cyan transition hover:bg-terminal-cyan/10 disabled:opacity-40"
                >
                  停牌 Stand
                </button>
              </div>
              <button
                onClick={() => act('double')}
                disabled={busy || !bj?.can_double}
                className="w-full rounded border border-terminal-pink/60 py-2.5 font-semibold text-terminal-pink transition hover:bg-terminal-pink/10 disabled:opacity-30"
              >
                双倍 Double（再押 {bj?.bet}）
              </button>
            </div>
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

          <div className="text-center text-xs text-terminal-gray/55">
            余额 <span className="text-terminal-yellow">{balance ?? '—'}</span> · 基本策略庄家优势仅{' '}
            <span className="text-terminal-red">~0.5%</span>，乱玩远不止
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
        cmd="blackjack"
        how={[
          '目标：手牌点数比庄家更接近 21，但不能超过(爆牌即输)。A 当 1 或 11，J/Q/K 算 10。',
          '发牌后可"要牌(Hit)"加牌、"停牌(Stand)"收手，或"双倍(Double)"再押一注但只能再拿一张。',
          '你停牌后庄家亮暗牌并要到 17 点。头两张就 21 点是 Blackjack，赔 3:2。',
        ]}
        truth="基本策略下庄家优势仅约 0.5%，是全场最低——但前提是每一手都按最优解打。一旦凭感觉乱要牌/乱停，优势会翻好几倍；而且你先要牌，先爆的那个先输，庄家就靠这个后手稳赢。"
      />
    </div>
  );
}
