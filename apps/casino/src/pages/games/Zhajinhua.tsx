import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import TitleBar from '../../components/TitleBar';
import Curve from '../../components/Curve';
import WinEffect from '../../components/WinEffect';
import GameGuide from '../../components/GameGuide';
import ZhajinhuaScene from '../../three/ZhajinhuaScene';
import { fetchCurve, fetchWallet, setWallet, zjhAction, zjhStart } from '../../lib/casino';
import { ApiError } from '../../lib/api';
import type { CurvePoint, ZhajinhuaState } from '../../lib/types';

const CHIPS = [10, 50, 100, 500];
const DEALER_ACT: Record<string, string> = { call: '庄家跟注', raise: '庄家加注', fold: '庄家弃牌', compare: '庄家比牌' };

export default function Zhajinhua() {
  const [ante, setAnte] = useState(50);
  const [balance, setBalance] = useState<number | null>(null);
  const [zjh, setZjh] = useState<ZhajinhuaState | null>(null);
  const [busy, setBusy] = useState(false);
  const [handKey, setHandKey] = useState(0);
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

  const active = zjh?.status === 'active';
  const done = zjh?.status === 'done';

  const apply = (s: ZhajinhuaState) => {
    setZjh(s);
    setBalance(s.balance);
    if (s.status === 'done') {
      setPoints((prev) => [
        ...prev,
        {
          round_index: (prev[prev.length - 1]?.round_index ?? 0) + 1,
          balance_after: s.balance,
          net: s.net,
          game: 'zhajinhua',
          created_at: new Date().toISOString(),
        },
      ]);
      fetchWallet().then(setWallet).catch(() => {});
    }
  };

  const start = async () => {
    if (busy || balance == null || ante <= 0 || ante > balance) return;
    setError(null);
    setBusy(true);
    try {
      const s = await zjhStart(ante);
      setHandKey((k) => k + 1);
      apply(s);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '开局失败，后端没连上？');
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: 'look' | 'call' | 'raise' | 'fold' | 'compare') => {
    if (busy || !active) return;
    setBusy(true);
    try {
      apply(await zjhAction(action));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const curvePoints = useMemo(() => points.slice(-120), [points]);
  const label = (r: string | null) => (r === 'player' ? '你赢' : r === 'tie' ? '平局(庄通吃)' : '庄家赢');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-terminal-gray/70">
          <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">play</span> zhajinhua
          <span className="ml-2 text-terminal-gray/50">— 炸金花：闷/看 + 跟/加/弃/比，对庄博弈</span>
        </h2>
        <Link to="/" className="text-xs text-terminal-cyan hover:text-terminal-green">
          ← 返回大厅
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/40 shadow-glow">
          <TitleBar path="~/casino/zhajinhua" />
          <div className="relative h-[340px] w-full sm:h-[400px]">
            <ZhajinhuaScene
              player={zjh?.player ?? []}
              dealer={zjh?.dealer ?? []}
              playerFaceUp={!!(zjh?.looked || done)}
              dealerFaceUp={!!done}
              dealKey={handKey}
            />
            {done && zjh?.outcome === 'win' && <WinEffect key={handKey} amount={zjh.net} big={zjh.net >= 1000} />}
            {zjh && (
              <div className="pointer-events-none absolute inset-x-0 top-3 flex flex-col items-center gap-1">
                <div className="rounded-full border border-terminal-line/70 bg-terminal-bg/50 px-3 py-1 text-xs text-terminal-gray/80 backdrop-blur">
                  底池 <span className="text-terminal-yellow">{zjh.pot}</span> · 第 {zjh.round} 轮
                  {zjh.looked ? '' : ' · 闷牌中'}
                  {zjh.last_dealer_action && active ? ` · ${DEALER_ACT[zjh.last_dealer_action] ?? ''}` : ''}
                </div>
                {done && (
                  <div
                    className={
                      'rounded-full border px-4 py-1 text-sm font-semibold backdrop-blur ' +
                      (zjh.outcome === 'win'
                        ? 'border-terminal-green/60 text-terminal-green'
                        : 'border-terminal-red/60 text-terminal-red')
                    }
                  >
                    闲 {zjh.player_rank} · 庄 {zjh.dealer_rank} · {label(zjh.result)} ·{' '}
                    {zjh.net > 0 ? `+${zjh.net}` : zjh.net}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-lg border border-terminal-line bg-terminal-panel/40 p-4">
          {active ? (
            <div className="space-y-3">
              <div className="rounded border border-terminal-line/60 bg-terminal-bg/40 p-3 text-center text-xs text-terminal-gray/75">
                {zjh.looked ? '已看牌' : '闷牌中（跟注半价）'} · 跟注花费{' '}
                <span className="text-terminal-yellow">{zjh.call_cost}</span>
              </div>
              {!zjh.looked && (
                <button
                  onClick={() => act('look')}
                  disabled={busy}
                  className="w-full rounded border border-terminal-cyan/60 py-2.5 font-semibold text-terminal-cyan transition hover:bg-terminal-cyan/10 disabled:opacity-40"
                >
                  看牌（之后跟注翻倍）
                </button>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => act('call')}
                  disabled={busy}
                  className="rounded border border-terminal-green/60 py-3 font-semibold text-terminal-green transition hover:bg-terminal-green/10 disabled:opacity-40"
                >
                  跟注 {zjh.call_cost}
                </button>
                <button
                  onClick={() => act('raise')}
                  disabled={busy}
                  className="rounded border border-terminal-yellow/60 py-3 font-semibold text-terminal-yellow transition hover:bg-terminal-yellow/10 disabled:opacity-40"
                >
                  加注
                </button>
                <button
                  onClick={() => act('compare')}
                  disabled={busy}
                  className="rounded border border-terminal-pink/60 py-3 font-semibold text-terminal-pink transition hover:bg-terminal-pink/10 disabled:opacity-40"
                >
                  比牌 {zjh.call_cost}
                </button>
                <button
                  onClick={() => act('fold')}
                  disabled={busy}
                  className="rounded border border-terminal-red/50 py-3 font-semibold text-terminal-red/90 transition hover:bg-terminal-red/10 disabled:opacity-40"
                >
                  弃牌
                </button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <div className="mb-2 flex items-center justify-between text-xs text-terminal-gray/60">
                  <span>底注</span>
                  <span className={balance != null && ante > balance ? 'text-terminal-red' : 'text-terminal-yellow'}>
                    {ante}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {CHIPS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setAnte(c)}
                      disabled={busy}
                      className={
                        'rounded border py-1.5 text-xs transition disabled:opacity-50 ' +
                        (ante === c
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
                onClick={start}
                disabled={busy || balance == null || ante > balance}
                className="rounded border border-terminal-pink/70 bg-terminal-pink/10 py-3 font-semibold text-terminal-pink shadow-glow-pink transition hover:bg-terminal-pink/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? '发牌中…' : done ? '再来一局' : '发牌'}
              </button>
            </>
          )}

          <div className="text-center text-xs text-terminal-gray/55">
            余额 <span className="text-terminal-yellow">{balance ?? '—'}</span> · 闲赢抽 5% 水
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
        cmd="zhajinhua"
        how={[
          '闲(你)和庄各 3 张。开局闷牌——你自己也看不到牌；可随时"看牌"，但看牌后跟注/比牌花费翻倍。',
          '每轮可：跟注 / 加注 / 弃牌(认输) / 比牌(摊牌定胜负)。每次操作后庄家会跟/加/比/弃。',
          '牌型：豹子>顺金>金花>顺子>对子>散牌。比牌时牌大者赢整个底池。',
        ]}
        truth="看着是斗智斗勇，但庄家在每个赢得的底池抽 5% 水——这就是它稳定盈利的来源。闷牌省一半、博加注、赌运气都改变不了：抽水之下长期期望为负。"
      />
    </div>
  );
}
