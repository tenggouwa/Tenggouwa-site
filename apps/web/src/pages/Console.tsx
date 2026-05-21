import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { apiGet, apiPost } from '../lib/api';

// ---------------------------------------------------------------------------
// types

interface AgentLite {
  id: number;
  name: string;
  online: boolean;
}

interface UnlockResp {
  term_token: string;
  ttl_seconds: number;
  agents: AgentLite[];
  phrase: string;
}

type Stage = 'unlock' | 'pick' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'gave_up';

const BACKOFFS_MS = [2_000, 5_000, 10_000, 20_000, 30_000, 60_000];
const MAX_ATTEMPTS = BACKOFFS_MS.length;
const PING_MS = 25_000;
const PHRASE_DEFAULT = '芝麻开门';

// ---------------------------------------------------------------------------
// page


export default function Console() {
  const [stage, setStage] = useState<Stage>('unlock');
  const [termToken, setTermToken] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentLite[]>([]);
  const [phrase, setPhrase] = useState(PHRASE_DEFAULT);
  const [picked, setPicked] = useState<AgentLite | null>(null);

  function onUnlocked(data: UnlockResp) {
    setTermToken(data.term_token);
    setAgents(data.agents);
    setPhrase(data.phrase);
    setStage('pick');
  }

  function onPickAgent(a: AgentLite) {
    setPicked(a);
    setStage('connecting');
  }

  return (
    <div className="fixed inset-0 bg-terminal-bg text-terminal-gray font-mono flex flex-col">
      {stage === 'unlock' && <UnlockScreen onUnlocked={onUnlocked} />}
      {stage === 'pick' && (
        <PickAgentScreen agents={agents} phrase={phrase} onPick={onPickAgent} />
      )}
      {(stage === 'connecting' || stage === 'open' || stage === 'reconnecting' ||
        stage === 'closed' || stage === 'gave_up') &&
        termToken && picked && (
          <TerminalScreen
            termToken={termToken}
            agent={picked}
            stage={stage}
            setStage={setStage}
          />
        )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// unlock screen


function UnlockScreen({ onUnlocked }: { onUnlocked: (resp: UnlockResp) => void }) {
  const [mode, setMode] = useState<'voice' | 'totp'>(() =>
    typeof window !== 'undefined' && getSpeechCtor() ? 'voice' : 'totp',
  );
  const [transcript, setTranscript] = useState('');
  const [recording, setRecording] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [phrase, setPhrase] = useState(PHRASE_DEFAULT);
  const speechCtor = getSpeechCtor();

  useEffect(() => {
    apiGet<{ phrase: string }>('/api/console/phrase')
      .then((d) => setPhrase(d.phrase))
      .catch(() => {});
  }, []);

  async function submit(method: 'voice' | 'totp', body: object) {
    setBusy(true);
    setErr(null);
    try {
      const data = await apiPost<UnlockResp>('/api/console/unlock', { method, ...body });
      onUnlocked(data);
    } catch (e) {
      setErr((e as Error).message || '解锁失败');
    } finally {
      setBusy(false);
    }
  }

  function startRec() {
    if (!speechCtor) {
      setMode('totp');
      return;
    }
    const rec = new speechCtor();
    rec.lang = 'zh-CN';
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (ev) => {
      const text = Array.from(ev.results).map((r) => r[0].transcript).join('');
      setTranscript(text);
      setRecording(false);
      submit('voice', { voice_transcript: text });
    };
    rec.onerror = () => {
      setRecording(false);
      setErr('语音识别出错，换 TOTP');
      setMode('totp');
    };
    rec.onend = () => setRecording(false);
    setRecording(true);
    setTranscript('');
    rec.start();
  }

  function submitTotp() {
    if (code.length !== 6) return;
    submit('totp', { code });
  }

  return (
    <div className="flex-1 flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        {/* ASCII 横幅 */}
        <pre className="text-terminal-green text-[10px] leading-tight mb-6 select-none">
{`╔════════════════════════════════════════════╗
║       ~ tenggouwa.console ~                ║
║       authenticated remote shell           ║
╚════════════════════════════════════════════╝`}
        </pre>

        {/* 模式切换 */}
        <div className="flex gap-1 mb-4 text-xs">
          <ModeBtn active={mode === 'voice'} onClick={() => setMode('voice')} disabled={!speechCtor}>
            voice
          </ModeBtn>
          <ModeBtn active={mode === 'totp'} onClick={() => setMode('totp')}>
            totp
          </ModeBtn>
          <div className="flex-1" />
          <Link
            to="/"
            className="text-terminal-gray/60 hover:text-terminal-green transition-colors px-2"
          >
            ← cd ~
          </Link>
        </div>

        {mode === 'voice' && (
          <div className="space-y-3">
            <div className="text-sm">
              <span className="text-terminal-pink">$</span> say{' '}
              <span className="text-terminal-yellow">"{phrase}"</span>
            </div>
            <button
              type="button"
              onClick={startRec}
              disabled={busy || recording || !speechCtor}
              className="w-full px-4 py-3 rounded-md border border-terminal-green/60 bg-terminal-green/5 hover:bg-terminal-green/10 text-terminal-green font-mono text-sm transition-colors disabled:opacity-40 active:scale-[0.98] shadow-glow"
            >
              {recording ? '◉ listening...' : busy ? '... verifying' : '🎤  按下说出口令'}
            </button>
            {transcript && (
              <div className="text-xs text-terminal-gray/70">
                heard: <code className="text-terminal-cyan">{transcript}</code>
              </div>
            )}
            <div className="text-[11px] text-terminal-gray/50 leading-relaxed">
              语音在浏览器本地转写（Web Speech API）。需要本设备 7d 内做过 TOTP；不行就切右边 totp。
            </div>
          </div>
        )}

        {mode === 'totp' && (
          <div className="space-y-3">
            <div className="text-sm">
              <span className="text-terminal-pink">$</span> enter{' '}
              <span className="text-terminal-yellow">6-digit code</span> from Google Authenticator
            </div>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && submitTotp()}
              className="w-full box-border bg-terminal-panel/60 border border-terminal-line/70 focus:border-terminal-green/60 outline-none rounded-md px-4 py-3 text-center text-2xl tracking-[0.5em] font-mono text-terminal-green caret-terminal-green"
            />
            <button
              type="button"
              onClick={submitTotp}
              disabled={busy || code.length !== 6}
              className="w-full px-4 py-3 rounded-md border border-terminal-cyan/60 bg-terminal-cyan/5 hover:bg-terminal-cyan/10 text-terminal-cyan font-mono text-sm transition-colors disabled:opacity-40 active:scale-[0.98]"
            >
              {busy ? '... verifying' : '🔓  解锁'}
            </button>
          </div>
        )}

        {err && (
          <div className="mt-4 text-xs text-red-400 font-mono">
            <span className="text-terminal-pink">err:</span> {err}
          </div>
        )}
      </div>
    </div>
  );
}


function ModeBtn({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1 rounded border text-xs font-mono transition-colors disabled:opacity-30 ${
        active
          ? 'border-terminal-green/60 bg-terminal-green/10 text-terminal-green'
          : 'border-terminal-line/70 text-terminal-gray/70 hover:border-terminal-gray/50'
      }`}
    >
      {children}
    </button>
  );
}


// ---------------------------------------------------------------------------
// pick agent screen


function PickAgentScreen({
  agents,
  phrase,
  onPick,
}: {
  agents: AgentLite[];
  phrase: string;
  onPick: (a: AgentLite) => void;
}) {
  if (agents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center space-y-3 max-w-md">
          <div className="text-terminal-pink">no agents available</div>
          <div className="text-xs text-terminal-gray/70">
            还没有 agent。在 admin 后台「终端 → 新建 agent」拿 token，再到 Mac 跑 install.sh。
          </div>
          <Link to="/" className="inline-block text-terminal-cyan text-sm hover:underline mt-3">
            ← cd ~
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="flex-1 flex items-center justify-center px-6">
      <div className="w-full max-w-md space-y-3">
        <div className="text-sm text-terminal-gray">
          <span className="text-terminal-pink">$</span> ls ./agents{' '}
          <span className="text-terminal-gray/50">— passphrase: "{phrase}"</span>
        </div>
        <div className="space-y-2">
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onPick(a)}
              disabled={!a.online}
              className="w-full flex items-center justify-between px-4 py-3 rounded-md border border-terminal-line/70 hover:border-terminal-green/60 bg-terminal-panel/40 hover:bg-terminal-panel/70 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-left"
            >
              <div>
                <div className="text-terminal-green font-mono">{a.name}</div>
                <div className="text-[11px] text-terminal-gray/60">#{a.id}</div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    a.online ? 'bg-terminal-green animate-pulse' : 'bg-terminal-gray/40'
                  }`}
                />
                <span className={a.online ? 'text-terminal-green' : 'text-terminal-gray/50'}>
                  {a.online ? 'online' : 'offline'}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// terminal screen


interface KeyDef {
  label: string;
  send: string;
  kind: 'small' | 'cmd';
}

const CONTROL_KEYS: KeyDef[] = [
  { label: 'Tab', send: '\t', kind: 'small' },
  { label: 'Esc', send: '\x1b', kind: 'small' },
  { label: '↑', send: '\x1b[A', kind: 'small' },
  { label: '↓', send: '\x1b[B', kind: 'small' },
  { label: '←', send: '\x1b[D', kind: 'small' },
  { label: '→', send: '\x1b[C', kind: 'small' },
  { label: '^C', send: '\x03', kind: 'small' },
  { label: '^D', send: '\x04', kind: 'small' },
  { label: '^L', send: '\x0c', kind: 'small' },
  { label: '^Z', send: '\x1a', kind: 'small' },
  { label: '~', send: '~', kind: 'small' },
  { label: '/', send: '/', kind: 'small' },
  { label: '-', send: '-', kind: 'small' },
  { label: '|', send: '|', kind: 'small' },
  { label: '>', send: '>', kind: 'small' },
  { label: '&&', send: '&&', kind: 'small' },
];

const COMMAND_KEYS: KeyDef[] = [
  { label: 'pwd', send: 'pwd\r', kind: 'cmd' },
  { label: 'ls', send: 'ls\r', kind: 'cmd' },
  { label: 'ls -la', send: 'ls -la\r', kind: 'cmd' },
  { label: 'cd ~', send: 'cd ~\r', kind: 'cmd' },
  { label: 'cd -', send: 'cd -\r', kind: 'cmd' },
  { label: 'clear', send: 'clear\r', kind: 'cmd' },
  { label: 'git st', send: 'git status\r', kind: 'cmd' },
  { label: 'git log', send: 'git log --oneline -10\r', kind: 'cmd' },
  { label: 'nvm use 21', send: 'nvm use 21\r', kind: 'cmd' },
  { label: 'claude', send: 'claude\r', kind: 'cmd' },
];


function TerminalScreen({
  termToken,
  agent,
  stage,
  setStage,
}: {
  termToken: string;
  agent: AgentLite;
  stage: Stage;
  setStage: (s: Stage) => void;
}) {
  const [retryIn, setRetryIn] = useState(0);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const termRef = useRef<HTMLDivElement | null>(null);
  const reconnectFnRef = useRef<(() => void) | null>(null);
  const sendInputRef = useRef<((data: string) => void) | null>(null);

  useEffect(() => {
    let active = true;
    let attempt = 0;
    let ws: WebSocket | null = null;
    let pingTimer: number | null = null;
    let reconnectTimer: number | null = null;

    const term = new Terminal({
      fontFamily: 'JetBrains Mono, SF Mono, Menlo, monospace',
      fontSize: 13,
      theme: {
        background: '#0b0f10',
        foreground: '#d4dadf',
        cursor: '#5af78e',
        cursorAccent: '#0b0f10',
        green: '#5af78e',
        cyan: '#57c7ff',
        yellow: '#f3f99d',
        magenta: '#ff6ac1',
      },
      cursorBlink: true,
      convertEol: true,
      allowProposedApi: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);

    setTimeout(() => {
      if (!active || !termRef.current) return;
      term.open(termRef.current);
      fit.fit();
    }, 30);

    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data));
      }
    });

    const onWinResize = () => {
      try {
        fit.fit();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: 'r', c: term.cols, l: term.rows }));
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener('resize', onWinResize);

    const connect = () => {
      if (!active) return;
      setErrMsg(null);
      setStage(attempt === 0 ? 'connecting' : 'reconnecting');

      const url = wsUrlFromApi(
        `/api/console/ws?token=${encodeURIComponent(termToken)}&agent_id=${agent.id}`,
      );
      const sock = new WebSocket(url);
      sock.binaryType = 'arraybuffer';
      ws = sock;

      sock.onopen = () => {
        if (!active || ws !== sock) return;
        setStage('open');
        attempt = 0;
        setTimeout(() => {
          if (sock.readyState === WebSocket.OPEN) {
            sock.send(JSON.stringify({ t: 'r', c: term.cols, l: term.rows }));
          }
        }, 50);
        if (pingTimer) window.clearInterval(pingTimer);
        pingTimer = window.setInterval(() => {
          if (sock.readyState === WebSocket.OPEN) {
            sock.send(JSON.stringify({ t: 'ping' }));
          }
        }, PING_MS);
      };
      sock.onmessage = (ev) => {
        if (!active || ws !== sock) return;
        if (typeof ev.data === 'string') return;
        term.write(new Uint8Array(ev.data as ArrayBuffer));
      };
      sock.onclose = (ev) => {
        if (pingTimer) {
          window.clearInterval(pingTimer);
          pingTimer = null;
        }
        if (!active || ws !== sock) return;
        if (ev.code === 1000 || ev.code === 4401 || ev.code === 4404 || ev.code === 4003) {
          setStage('closed');
          if (ev.code === 4003) setErrMsg('此终端已在另一个窗口打开');
          else if (ev.code === 4404) setErrMsg('agent 不存在或已撤销');
          else if (ev.code === 4401) setErrMsg('term_token 已过期，请回去重新解锁');
          return;
        }
        if (attempt >= MAX_ATTEMPTS) {
          setStage('gave_up');
          setErrMsg(`连续 ${MAX_ATTEMPTS} 次重连失败（最近 ${ev.code} ${ev.reason || ''}）`);
          return;
        }
        const delay = BACKOFFS_MS[Math.min(attempt, BACKOFFS_MS.length - 1)];
        attempt += 1;
        setStage('reconnecting');
        setRetryIn(delay);
        reconnectTimer = window.setTimeout(() => {
          if (active) connect();
        }, delay);
      };
      sock.onerror = () => {
        if (active && ws === sock) setErrMsg('WebSocket 错误');
      };
    };

    reconnectFnRef.current = () => {
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      attempt = 0;
      connect();
    };
    sendInputRef.current = (data: string) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data));
      }
    };

    connect();

    return () => {
      active = false;
      window.removeEventListener('resize', onWinResize);
      if (pingTimer) window.clearInterval(pingTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
        ws = null;
      }
      term.dispose();
      reconnectFnRef.current = null;
      sendInputRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  const stageLabel: Record<Stage, string> = {
    unlock: '',
    pick: '',
    connecting: 'connecting',
    open: 'connected',
    reconnecting: `reconnect ${Math.ceil(retryIn / 1000)}s`,
    closed: 'closed',
    gave_up: 'gave up',
  };
  const stageColor =
    stage === 'open'
      ? 'text-terminal-green'
      : stage === 'closed' || stage === 'gave_up'
        ? 'text-red-400'
        : 'text-terminal-yellow';

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 顶部 bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-terminal-line/60 bg-terminal-panel/30 backdrop-blur shrink-0">
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-terminal-pink">~$</span>
          <span className="text-terminal-green">{agent.name}</span>
          <span className={stageColor}>· {stageLabel[stage]}</span>
        </div>
        <div className="flex gap-1.5">
          {stage !== 'open' && stage !== 'connecting' && (
            <button
              type="button"
              onClick={() => reconnectFnRef.current?.()}
              className="px-2 py-1 rounded text-[11px] border border-terminal-cyan/60 text-terminal-cyan hover:bg-terminal-cyan/10"
            >
              立即重连
            </button>
          )}
          <Link
            to="/"
            className="px-2 py-1 rounded text-[11px] border border-terminal-line/70 text-terminal-gray/80 hover:border-terminal-gray hover:text-terminal-gray"
          >
            退出 ↩
          </Link>
        </div>
      </div>

      {errMsg && (
        <div className="px-3 py-1.5 text-[11px] text-red-300 bg-red-500/10 border-b border-red-500/20 shrink-0">
          {errMsg}
        </div>
      )}

      {/* xterm 占满剩余 */}
      <div ref={termRef} className="flex-1 min-h-0 p-2" style={{ background: '#0b0f10' }} />

      {/* QuickKeys 钉在底部 */}
      <div className="border-t border-terminal-line/60 bg-terminal-panel/30 backdrop-blur shrink-0 p-2 space-y-1.5">
        <KeyRow keys={CONTROL_KEYS} disabled={stage !== 'open'} send={(s) => sendInputRef.current?.(s)} />
        <KeyRow keys={COMMAND_KEYS} disabled={stage !== 'open'} send={(s) => sendInputRef.current?.(s)} />
      </div>
    </div>
  );
}


function KeyRow({
  keys,
  disabled,
  send,
}: {
  keys: KeyDef[];
  disabled: boolean;
  send: (data: string) => void;
}) {
  return (
    <div
      className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1"
      style={{ scrollbarWidth: 'none' }}
    >
      {keys.map((k) => (
        <button
          key={k.label}
          type="button"
          disabled={disabled}
          onClick={() => send(k.send)}
          className={`shrink-0 px-2 py-1 rounded-md text-[12px] font-mono select-none transition-colors active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed border ${
            k.kind === 'cmd'
              ? 'border-terminal-cyan/50 bg-terminal-cyan/5 text-terminal-cyan hover:bg-terminal-cyan/15'
              : 'border-terminal-line/70 bg-terminal-panel/40 text-terminal-gray hover:bg-terminal-panel/70 hover:text-terminal-gray'
          }`}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}


// ---------------------------------------------------------------------------
// helpers


function wsUrlFromApi(path: string): string {
  const base = (import.meta.env.VITE_API_BASE ?? window.location.origin).replace(/\/$/, '');
  const u = new URL(base);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString().replace(/\/$/, '') + path;
}


type SpeechCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechCtor(): SpeechCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechCtor;
    webkitSpeechRecognition?: SpeechCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
