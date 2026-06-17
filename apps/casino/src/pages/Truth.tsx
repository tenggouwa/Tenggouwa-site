import { useEffect, useState } from 'react';
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
};

function pct(x: number | null): string {
  return x == null ? '—' : `${(x * 100).toFixed(2)}%`;
}

export default function Truth() {
  const [curve, setCurve] = useState<CurveResponse | null>(null);
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCurve().then(setCurve).catch((e) => setError(e instanceof Error ? e.message : '加载失败'));
    fetchStats().then(setStats).catch(() => {});
  }, []);

  const w = curve?.wallet;

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

      {/* 个人输赢曲线 */}
      <section className="overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/40 shadow-glow">
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
                    {w.net}
                  </span>
                </span>
                <span>玩了 {w.rounds_played} 局</span>
                <span>重置 {w.reclaim_count} 次</span>
              </div>
            )}
          </div>
          <Curve points={curve?.points ?? []} height={200} />
          {error && <div className="text-xs text-terminal-red">{error}</div>}
          {w && w.net < 0 && (
            <p className="text-xs text-terminal-gray/70">
              你已经净输 <span className="text-terminal-red">{-w.net}</span> 积分
              {w.reclaim_count > 0 && <> ，还重置过 {w.reclaim_count} 次</>}。这还只是假积分。
            </p>
          )}
        </div>
      </section>

      {/* 全站真实赔率 */}
      <section className="overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/40">
        <TitleBar path="~/truth/all" />
        <div className="space-y-4 p-5">
          <h3 className="text-terminal-green">全站真实赔率</h3>
          <p className="text-xs leading-relaxed text-terminal-gray/70">
            把所有人的每一局加起来算"实测庄家优势"。玩的局数越多，它就越逼近理论值——
            这就是赌场永远赢的数学原理：<span className="text-terminal-pink">大数定律</span>。
          </p>

          {stats && stats.games.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-terminal-green/40 text-terminal-green">
                  <tr>
                    <th className="py-2 pr-3">游戏</th>
                    <th className="py-2 pr-3">局数</th>
                    <th className="py-2 pr-3">实测庄家优势</th>
                    <th className="py-2 pr-3">理论值</th>
                    <th className="py-2">玩家总净值</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.games.map((g) => {
                    const playerNet = g.total_payout - g.total_wagered;
                    return (
                      <tr key={g.game} className="border-b border-terminal-line/40">
                        <td className="py-2 pr-3 text-terminal-gray/90">{GAME_LABEL[g.game] ?? g.game}</td>
                        <td className="py-2 pr-3 text-terminal-gray/70">{g.rounds}</td>
                        <td className="py-2 pr-3 text-terminal-yellow">{pct(g.observed_house_edge)}</td>
                        <td className="py-2 pr-3 text-terminal-gray/60">{pct(g.theoretical_house_edge)}</td>
                        <td className={'py-2 ' + (playerNet < 0 ? 'text-terminal-red' : 'text-terminal-green')}>
                          {playerNet >= 0 ? '+' : ''}
                          {playerNet}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="mt-3 text-xs text-terminal-gray/55">
                全站 {stats.total_players} 名玩家 · 共 {stats.total_rounds} 局 · 玩家累计净值{' '}
                <span className={stats.total_payout - stats.total_wagered < 0 ? 'text-terminal-red' : 'text-terminal-green'}>
                  {stats.total_payout - stats.total_wagered}
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded border border-terminal-line/60 bg-terminal-bg/40 py-8 text-center text-xs text-terminal-gray/50">
              还没有足够数据，去玩两局让数字开始说话
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
