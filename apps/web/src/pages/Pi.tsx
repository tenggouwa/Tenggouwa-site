import { useEffect, useRef, useState } from 'react';
import { apiGet } from '../lib/api';
import type { PiArtifact, PiProbe, PiStatus } from '../lib/types';

const POLL_MS = 4000;

const PROBE_LABEL: Record<string, string> = { api: '后端 api', site: '站点', speed: '下行测速' };

function fmtUptime(s: number | undefined): string {
  if (s == null) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtAge(s: number | null): string {
  if (s == null) return '—';
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function tempColor(t: number | undefined): string {
  if (t == null) return 'text-terminal-gray';
  if (t >= 70) return 'text-red-400';
  if (t >= 55) return 'text-terminal-yellow';
  return 'text-terminal-green';
}

// 简易 SVG sparkline
function Sparkline({ points, className }: { points: number[]; className?: string }) {
  if (points.length < 2) return null;
  const w = 120;
  const h = 28;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / span) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} preserveAspectRatio="none" width="100%" height={h}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Bar({ ratio, color = 'bg-terminal-green' }: { ratio: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div className="h-1.5 w-full rounded bg-terminal-line/50 overflow-hidden">
      <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-terminal-line/60 bg-terminal-panel/30 p-4 space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-terminal-gray/55">{label}</div>
      {children}
    </div>
  );
}

export default function Pi() {
  const [status, setStatus] = useState<PiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<PiArtifact | null>(null);
  const [probes, setProbes] = useState<PiProbe[]>([]);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await apiGet<PiStatus>('/api/public/pi/status');
        if (alive) {
          setStatus(s);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
      try {
        const p = await apiGet<PiProbe[]>('/api/public/pi/probes');
        if (alive) setProbes(p);
      } catch {
        /* 探针拉取失败不影响其它面板 */
      }
    };
    tick();
    timer.current = window.setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      if (timer.current) window.clearInterval(timer.current);
    };
  }, []);

  // 每日产物（变化慢，拉一次即可）；没有就不显示，不报错
  useEffect(() => {
    apiGet<PiArtifact | null>('/api/public/pi/artifact')
      .then((a) => setArtifact(a))
      .catch(() => {});
  }, []);

  const m = status?.metrics ?? {};
  const online = status?.online ?? false;
  const tempHist = (status?.history ?? []).map((p) => p.cpu_temp_c).filter((v): v is number => v != null);
  const memRatio = m.mem_total_mb ? (m.mem_used_mb ?? 0) / m.mem_total_mb : 0;
  const diskRatio = m.disk_total_gb ? (m.disk_used_gb ?? 0) / m.disk_total_gb : 0;
  const loadRatio = m.cpu_count ? (m.load1 ?? 0) / m.cpu_count : 0;
  const host = status?.hostname ?? 'raspberrypi';
  const artMeta = (artifact?.meta ?? {}) as {
    aphorism?: string;
    render_ms?: number;
    host?: string;
    region?: string;
  };
  // 拉取失败(500/网络) 或 从没上报过，统一当"离线无信号"，绝不把原始报错摔给访客
  const hasData = status != null && status.last_seen != null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-terminal-green text-2xl">
          <span className="text-terminal-pink">$ </span>ssh ops@{status?.hostname ?? 'raspberrypi'}
        </h1>
        <p className="text-sm text-terminal-gray/65 mt-1">
          一台树莓派 4B 在我这儿喘气。偶尔开机——离线时这里是它最后留下的状态。
        </p>
      </div>

      {/* 终端风 panel：mac 三色点 + path */}
      <div className="rounded-lg border border-terminal-line overflow-hidden" style={{ boxShadow: '0 0 24px rgba(90,247,142,0.10)' }}>
        <div className="flex items-center gap-2 border-b border-terminal-line/60 bg-terminal-panel/50 px-3 py-2">
          <span className="h-3 w-3 rounded-full" style={{ background: '#ff5f57' }} />
          <span className="h-3 w-3 rounded-full" style={{ background: '#febc2e' }} />
          <span className="h-3 w-3 rounded-full" style={{ background: '#28c840' }} />
          <span className="ml-2 text-xs text-terminal-gray/60 font-mono">~/pi</span>
          <span className="ml-auto flex items-center gap-1.5 text-xs font-mono">
            <span
              className={`h-2 w-2 rounded-full ${online ? 'bg-terminal-green animate-pulse' : 'bg-terminal-gray/50'}`}
            />
            <span className={online ? 'text-terminal-green' : 'text-terminal-gray/60'}>
              {online ? 'online' : 'offline'}
            </span>
            {!online && status?.last_seen && (
              <span className="text-terminal-gray/50">· last seen {fmtAge(status.age_seconds)}</span>
            )}
          </span>
        </div>

        <div className="p-4 space-y-4 font-mono">
          {status == null && error == null ? (
            <div className="text-sm text-terminal-gray/50">
              <span className="text-terminal-pink">$ </span>connecting to pi...
            </div>
          ) : !hasData ? (
            <div className="space-y-1 text-sm leading-relaxed">
              <div>
                <span className="text-terminal-pink">$ </span>
                <span className="text-terminal-green">ssh ops@{host}</span>
              </div>
              <div className="text-terminal-gray/45">ssh: connect to host {host}: Connection timed out</div>
              <div className="pt-2 text-terminal-gray/45">
                <span className="text-terminal-pink">$ </span># 这台 pi 偶尔开机 —— 上线后这里会实时显示 温度 / 负载 / 内存 / uptime
                <span className="ml-0.5 inline-block h-[14px] w-[7px] translate-y-[2px] bg-terminal-green/70 animate-blink" />
              </div>
            </div>
          ) : (
            <div className={online ? '' : 'opacity-60'}>
              <div className="text-xs text-terminal-gray/55 mb-4">
                {status.model ?? 'Raspberry Pi'} · {m.cpu_count ?? '?'} cores
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <Card label="cpu temp">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-2xl ${tempColor(m.cpu_temp_c)}`}>
                      {m.cpu_temp_c != null ? m.cpu_temp_c.toFixed(1) : '—'}
                    </span>
                    <span className="text-terminal-gray/50 text-sm">°C</span>
                  </div>
                  <div className={tempColor(m.cpu_temp_c)}>
                    <Sparkline points={tempHist} className="opacity-80" />
                  </div>
                </Card>

                <Card label="load (1m / 5m / 15m)">
                  <div className="text-2xl text-terminal-cyan">
                    {(m.load1 ?? 0).toFixed(2)}
                    <span className="text-terminal-gray/45 text-sm ml-2">
                      {(m.load5 ?? 0).toFixed(2)} · {(m.load15 ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <Bar ratio={loadRatio} color={loadRatio > 0.9 ? 'bg-terminal-yellow' : 'bg-terminal-cyan'} />
                </Card>

                <Card label="uptime">
                  <div className="text-2xl text-terminal-green">{fmtUptime(m.uptime_s)}</div>
                </Card>

                <Card label="memory">
                  <div className="text-sm text-terminal-gray">
                    <span className="text-terminal-green">{((m.mem_used_mb ?? 0) / 1024).toFixed(2)}</span>
                    <span className="text-terminal-gray/50"> / {((m.mem_total_mb ?? 0) / 1024).toFixed(2)} GB</span>
                  </div>
                  <Bar ratio={memRatio} color={memRatio > 0.9 ? 'bg-terminal-yellow' : 'bg-terminal-green'} />
                </Card>

                <Card label="disk /">
                  <div className="text-sm text-terminal-gray">
                    <span className="text-terminal-green">{(m.disk_used_gb ?? 0).toFixed(1)}</span>
                    <span className="text-terminal-gray/50"> / {(m.disk_total_gb ?? 0).toFixed(1)} GB</span>
                  </div>
                  <Bar ratio={diskRatio} color={diskRatio > 0.9 ? 'bg-terminal-yellow' : 'bg-terminal-green'} />
                </Card>

                <Card label="host">
                  <div className="text-sm text-terminal-gray break-all">{status.hostname}</div>
                  <div className="text-xs text-terminal-gray/45">
                    {online ? 'reporting live' : `frozen · ${fmtAge(status.age_seconds)}`}
                  </div>
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 监控探针：Pi 从它的视角看你的服务 */}
      {probes.length > 0 && (
        <div className="rounded-lg border border-terminal-line overflow-hidden">
          <div className="flex items-center gap-2 border-b border-terminal-line/60 bg-terminal-panel/50 px-3 py-2">
            <span className="h-3 w-3 rounded-full" style={{ background: '#ff5f57' }} />
            <span className="h-3 w-3 rounded-full" style={{ background: '#febc2e' }} />
            <span className="h-3 w-3 rounded-full" style={{ background: '#28c840' }} />
            <span className="ml-2 text-xs text-terminal-gray/60 font-mono">~/pi/probes</span>
            <span className="ml-auto text-[11px] text-terminal-gray/45 font-mono">监控探针</span>
          </div>
          <div className="p-4 font-mono space-y-3">
            {probes.map((p) => {
              const hist = p.history.filter((v): v is number => v != null);
              return (
                <div key={p.name} className="flex items-center gap-3">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${p.ok ? 'bg-terminal-green' : 'bg-red-400'}`} />
                  <span className="w-20 text-sm text-terminal-gray shrink-0">{PROBE_LABEL[p.name] ?? p.name}</span>
                  <span
                    className={`w-24 text-sm shrink-0 tabular-nums ${p.ok ? 'text-terminal-cyan' : 'text-terminal-gray/45'}`}
                  >
                    {p.value != null ? `${p.value} ${p.unit}` : '—'}
                  </span>
                  <div className="flex-1 min-w-0 text-terminal-green/70">
                    <Sparkline points={hist} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 每日产物：Pi 自己算的 ASCII 曼德博集合 */}
      {artifact && (
        <div
          className="rounded-lg border border-terminal-line overflow-hidden"
          style={{ boxShadow: '0 0 24px rgba(90,247,142,0.08)' }}
        >
          <div className="flex items-center gap-2 border-b border-terminal-line/60 bg-terminal-panel/50 px-3 py-2">
            <span className="h-3 w-3 rounded-full" style={{ background: '#ff5f57' }} />
            <span className="h-3 w-3 rounded-full" style={{ background: '#febc2e' }} />
            <span className="h-3 w-3 rounded-full" style={{ background: '#28c840' }} />
            <span className="ml-2 text-xs text-terminal-gray/60 font-mono">~/pi/today</span>
            <span className="ml-auto text-[11px] text-terminal-gray/45 font-mono">每日产物</span>
          </div>
          <div className="p-4 space-y-3 font-mono">
            <div className="text-sm text-terminal-green">{artifact.title}</div>
            <pre className="overflow-x-auto text-[9px] leading-[1.05] text-terminal-green/85 sm:text-[11px]">
              {artifact.content}
            </pre>
            <div className="text-xs text-terminal-gray/55">
              🍓 由 {artMeta.host ?? 'pi'} 实时计算
              {artMeta.render_ms != null && ` · ${artMeta.render_ms}ms`}
              {artMeta.region && ` · ${artMeta.region}`}
            </div>
            {artMeta.aphorism && <div className="text-xs text-terminal-gray/45 italic">{artMeta.aphorism}</div>}
          </div>
        </div>
      )}

      <p className="text-xs text-terminal-gray/45">
        <span className="text-terminal-pink">$ </span># more coming — 这台 pi 的玩法还在往上叠（终端 / HID / lab 算力…）
      </p>
    </div>
  );
}
