import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import TitleBar from '../components/TitleBar';
import Curve from '../components/Curve';
import { fetchCurve, fetchStats } from '../lib/casino';
import type { CurveResponse, StatsSummary } from '../lib/types';

const GAME_LABEL: Record<string, string> = {
  dice: '骰子大小',
  roulette: '轮盘',
  slots: '老虎机',
  baccarat: '百家乐',
  blackjack: '21点',
  dragon_tiger: '龙虎斗',
  keno: '基诺',
  crash: '崩盘',
  money_wheel: '幸运大转盘',
  plinko: 'Plinko',
  sicbo: '骰宝',
  zhajinhua: '炸金花',
  mines: '扫雷 Mines',
  niuniu: '牛牛',
  videopoker: '视频扑克',
  scratch: '刮刮乐',
};

// 实测庄家优势低于这个局数不可信，标"样本不足"。
const MIN_SAMPLE = 50;

function pct(x: number | null, digits = 2): string {
  return x == null ? '—' : `${(x * 100).toFixed(digits)}%`;
}

function n(x: number): string {
  return x.toLocaleString('en-US');
}

// 庄家优势越高越红，越低越绿——一眼看出哪个最坑。
function edgeBg(edge: number): string {
  if (edge >= 0.2) return 'bg-terminal-red';
  if (edge >= 0.08) return 'bg-terminal-pink';
  if (edge >= 0.03) return 'bg-terminal-yellow';
  return 'bg-terminal-green';
}
function edgeFg(edge: number): string {
  if (edge >= 0.2) return 'text-terminal-red';
  if (edge >= 0.08) return 'text-terminal-pink';
  if (edge >= 0.03) return 'text-terminal-yellow';
  return 'text-terminal-green';
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded border border-terminal-line/60 bg-terminal-bg/40 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-terminal-gray/45">{label}</div>
      <div className={'mt-0.5 text-base font-semibold ' + accent}>{value}</div>
    </div>
  );
}

export default function Truth() {
  const [curve, setCurve] = useState<CurveResponse | null>(null);
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCurve()
      .then(setCurve)
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'));
    fetchStats().then(setStats).catch(() => {});
  }, []);

  const w = curve?.wallet;
  const worst = useMemo(
    () => (curve && curve.points.length ? Math.min(...curve.points.map((p) => p.net)) : null),
    [curve],
  );
  const myRtp = w && w.total_wagered > 0 ? w.total_payout / w.total_wagered : null;

  // 全站：按理论庄家优势从高到低排行。
  const ranked = useMemo(
    () => (stats ? [...stats.games].sort((a, b) => b.theoretical_house_edge - a.theoretical_house_edge) : []),
    [stats],
  );
  const maxEdge = ranked.length ? Math.max(...ranked.map((g) => g.theoretical_house_edge)) : 1;
  const siteWagered = stats?.total_wagered ?? 0;
  const sitePayout = stats?.total_payout ?? 0;
  const siteNet = sitePayout - siteWagered;
  const houseTake = siteWagered > 0 ? (siteWagered - sitePayout) / siteWagered : null;
  const siteRtp = siteWagered > 0 ? sitePayout / siteWagered : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-terminal-gray/70">
          <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">grep</span> -r 真相 .
        </h2>
        <Link to="/" className="text-xs text-terminal-cyan hover:text-terminal-green">
          ← 返回大厅
        </Link>
      </div>

      {/* 全站 KPI 横幅 */}
      <section className="overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/40 shadow-glow">
        <TitleBar path="~/truth/house" />
        <div className="space-y-3 p-5">
          <h3 className="text-terminal-green">庄家的账本</h3>
          {stats && stats.total_rounds > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Kpi label="玩家人数" value={n(stats.total_players)} accent="text-terminal-cyan" />
                <Kpi label="累计下注" value={n(siteWagered)} accent="text-terminal-gray/90" />
                <Kpi
                  label="玩家净亏 / 净赢"
                  value={`${siteNet >= 0 ? '+' : ''}${n(siteNet)}`}
                  accent={siteNet < 0 ? 'text-terminal-red' : 'text-terminal-green'}
                />
                <Kpi label="庄家抽成率" value={pct(houseTake)} accent="text-terminal-pink" />
              </div>
              <p className="text-xs leading-relaxed text-terminal-gray/70">
                所有人下注共 <span className="text-terminal-yellow">{n(siteWagered)}</span> 分，拿回{' '}
                <span className="text-terminal-yellow">{n(sitePayout)}</span> 分——
                {siteNet < 0 ? (
                  <>
                    净送给庄家 <span className="text-terminal-red">{n(-siteNet)}</span> 分。整体返还率仅{' '}
                    <span className="text-terminal-pink">{pct(siteRtp)}</span>。
                  </>
                ) : (
                  <>暂时还是玩家赢着——但样本越大，这个数字越会被拉回庄家那边。</>
                )}
              </p>
            </>
          ) : (
            <div className="rounded border border-terminal-line/60 bg-terminal-bg/40 py-8 text-center text-xs text-terminal-gray/50">
              还没有足够数据，去玩两局让数字开始说话
            </div>
          )}
        </div>
      </section>

      {/* 个人输赢曲线 + 深化 */}
      <section className="overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/40">
        <TitleBar path="~/truth/me" />
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-terminal-green">我的输赢曲线</h3>
            {w && (
              <div className="flex gap-4 text-xs text-terminal-gray/70">
                <span>
                  净值{' '}
                  <span className={w.net < 0 ? 'text-terminal-red' : 'text-terminal-green'}>
                    {w.net >= 0 ? '+' : ''}
                    {n(w.net)}
                  </span>
                </span>
                <span>玩了 {n(w.rounds_played)} 局</span>
                <span>重置 {w.reclaim_count} 次</span>
              </div>
            )}
          </div>
          <Curve points={curve?.points ?? []} height={200} />
          {error && <div className="text-xs text-terminal-red">{error}</div>}

          {w && w.rounds_played > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi
                label={w.net < 0 ? '你喂给庄家' : '你暂时领先'}
                value={`${w.net < 0 ? '' : '+'}${n(Math.abs(w.net))}`}
                accent={w.net < 0 ? 'text-terminal-red' : 'text-terminal-green'}
              />
              <Kpi
                label="最惨一局"
                value={worst != null ? n(worst) : '—'}
                accent={worst != null && worst < 0 ? 'text-terminal-red' : 'text-terminal-gray/90'}
              />
              <Kpi label="你的返还率" value={pct(myRtp)} accent="text-terminal-yellow" />
              <Kpi
                label="折合真钱 (1分=1元)"
                value={w.net < 0 ? `¥${n(-w.net)}` : '—'}
                accent="text-terminal-pink"
              />
            </div>
          )}

          {w && myRtp != null && siteRtp != null && (
            <p className="text-xs leading-relaxed text-terminal-gray/70">
              你的返还率 <span className="text-terminal-yellow">{pct(myRtp)}</span> · 全站{' '}
              <span className="text-terminal-yellow">{pct(siteRtp)}</span>
              {w.net < 0 && (
                <>
                  。你已经净输 <span className="text-terminal-red">{n(-w.net)}</span> 分
                  {w.reclaim_count > 0 && <>、还重置过 {w.reclaim_count} 次</>}——这还只是假积分。
                </>
              )}
            </p>
          )}
        </div>
      </section>

      {/* 全站庄家优势排行榜 */}
      <section className="overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/40">
        <TitleBar path="~/truth/ranking" />
        <div className="space-y-4 p-5">
          <h3 className="text-terminal-green">庄家优势排行榜</h3>
          <p className="text-xs leading-relaxed text-terminal-gray/70">
            条越长越红 = 庄家优势越高、越坑。叠在上面的{' '}
            <span className="text-terminal-cyan">青色竖标</span> 是全站实测值；玩的局数越多，实测越向理论靠拢——
            这就是赌场永远赢的数学：<span className="text-terminal-pink">大数定律</span>。
          </p>

          {ranked.length > 0 ? (
            <>
              <div className="space-y-3">
                {ranked.map((g) => {
                  const t = g.theoretical_house_edge;
                  const enough = g.rounds >= MIN_SAMPLE && g.observed_house_edge != null;
                  const obs = g.observed_house_edge ?? 0;
                  const playerNet = g.total_payout - g.total_wagered;
                  return (
                    <div key={g.game} className="space-y-1">
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="text-terminal-gray/90">{GAME_LABEL[g.game] ?? g.game}</span>
                        <span className={edgeFg(t)}>{pct(t)}</span>
                      </div>
                      <div className="relative h-3 rounded bg-terminal-bg/60">
                        <div
                          className={'h-full rounded ' + edgeBg(t)}
                          style={{ width: `${Math.max(1.5, (t / maxEdge) * 100)}%` }}
                        />
                        {enough && (
                          <div
                            className="absolute -top-0.5 h-4 w-0.5 bg-terminal-cyan"
                            style={{ left: `calc(${Math.min(100, (obs / maxEdge) * 100)}% - 1px)` }}
                            title={`实测 ${pct(obs)}`}
                          />
                        )}
                      </div>
                      <div className="flex justify-between text-[10px] text-terminal-gray/50">
                        <span>
                          {enough ? (
                            <>
                              实测 <span className="text-terminal-cyan">{pct(g.observed_house_edge)}</span> · {n(g.rounds)}{' '}
                              局
                            </>
                          ) : (
                            <>{n(g.rounds)} 局 · 样本不足</>
                          )}
                        </span>
                        <span className={playerNet < 0 ? 'text-terminal-red' : 'text-terminal-green'}>
                          玩家净值 {playerNet >= 0 ? '+' : ''}
                          {n(playerNet)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-terminal-line/40 pt-3 text-xs text-terminal-gray/55">
                全站 {n(stats?.total_players ?? 0)} 名玩家 · 共 {n(stats?.total_rounds ?? 0)} 局 ·
                最坑的 <span className={edgeFg(maxEdge)}>{GAME_LABEL[ranked[0].game] ?? ranked[0].game}</span> 庄家优势{' '}
                <span className={edgeFg(maxEdge)}>{pct(maxEdge)}</span>，是最良心的{' '}
                {GAME_LABEL[ranked[ranked.length - 1].game] ?? ranked[ranked.length - 1].game} 的{' '}
                {(maxEdge / Math.max(0.0001, ranked[ranked.length - 1].theoretical_house_edge)).toFixed(0)} 倍。
              </div>
            </>
          ) : (
            <div className="rounded border border-terminal-line/60 bg-terminal-bg/40 py-8 text-center text-xs text-terminal-gray/50">
              还没有数据。每个游戏页底部都标了理论庄家优势，去玩玩看实测怎么收敛。
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
