import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Message,
  Modal,
  Popconfirm,
  Space,
  Tag,
} from '@arco-design/web-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { http } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { AgentInfo, AgentIssueResp } from '../lib/types';

const LAST_AGENT_KEY = 'tg_admin_last_agent_id';

// ---------------------------------------------------------------------------
// helpers


function wsUrlFromApi(path: string): string {
  const base = (import.meta.env.VITE_API_BASE ?? window.location.origin).replace(/\/$/, '');
  const u = new URL(base);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString().replace(/\/$/, '') + path;
}


// ---------------------------------------------------------------------------
// page


export default function TerminalPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selected, setSelected] = useState<AgentInfo | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const restoredRef = useRef(false);

  async function refresh() {
    const list = (await http.get('/api/admin/terminal/agents')) as unknown as AgentInfo[];
    setAgents(list);
    if (!restoredRef.current) {
      restoredRef.current = true;
      const lastId = Number(localStorage.getItem(LAST_AGENT_KEY) || 0);
      if (lastId) {
        const found = list.find((a) => a.id === lastId && !a.revoked_at);
        if (found) setSelected(found);
      }
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  function openAgent(a: AgentInfo) {
    setSelected(a);
    localStorage.setItem(LAST_AGENT_KEY, String(a.id));
  }

  function closeAgent() {
    setSelected(null);
    localStorage.removeItem(LAST_AGENT_KEY);
    refresh();
  }

  if (selected) {
    return <TerminalSession agent={selected} onClose={closeAgent} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold">终端</h2>
        <Button type="primary" onClick={() => setIssueOpen(true)}>
          新建 agent
        </Button>
      </div>

      {agents.length === 0 && (
        <Empty description="还没有 agent。点右上「新建 agent」拿到 token，然后在 Mac 上跑 apps/mac-agent/install.sh。" />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agents.map((a) => (
          <AgentCard
            key={a.id}
            agent={a}
            onOpen={() => openAgent(a)}
            onRevoked={refresh}
          />
        ))}
      </div>

      <IssueAgentModal
        open={issueOpen}
        onClose={() => {
          setIssueOpen(false);
          refresh();
        }}
      />
    </div>
  );
}


// ---------------------------------------------------------------------------
// agent card


function AgentCard({
  agent,
  onOpen,
  onRevoked,
}: {
  agent: AgentInfo;
  onOpen: () => void;
  onRevoked: () => void;
}) {
  async function revoke() {
    await http.post(`/api/admin/terminal/agent/${agent.id}/revoke`);
    Message.success('已撤销');
    onRevoked();
  }

  const isRevoked = !!agent.revoked_at;
  return (
    <Card
      title={
        <div className="flex items-center gap-2">
          <span>{agent.name}</span>
          {isRevoked ? (
            <Tag color="red" size="small">已撤销</Tag>
          ) : agent.online ? (
            <Tag color="green" size="small">在线</Tag>
          ) : (
            <Tag color="gray" size="small">离线</Tag>
          )}
        </div>
      }
      extra={<span className="text-xs text-gray-400">#{agent.id}</span>}
    >
      <div className="text-xs text-gray-500 mb-3">
        创建：{agent.created_at.slice(0, 16).replace('T', ' ')}
        <br />
        最近：{agent.last_seen_at ? agent.last_seen_at.slice(0, 16).replace('T', ' ') : '从未连接'}
      </div>
      <Space>
        <Button
          type="primary"
          size="small"
          disabled={!agent.online || isRevoked}
          onClick={onOpen}
        >
          打开终端
        </Button>
        {!isRevoked && (
          <Popconfirm title="撤销后旧 token 立即失效，确认？" onOk={revoke}>
            <Button size="small" status="danger">撤销</Button>
          </Popconfirm>
        )}
      </Space>
    </Card>
  );
}


// ---------------------------------------------------------------------------
// issue modal


function IssueAgentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('my-mac');
  const [issued, setIssued] = useState<AgentIssueResp | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    try {
      const data = (await http.post('/api/admin/terminal/agent/issue', {
        name,
      })) as unknown as AgentIssueResp;
      setIssued(data);
    } finally {
      setLoading(false);
    }
  }

  function close() {
    setIssued(null);
    setName('my-mac');
    onClose();
  }

  return (
    <Modal
      title={issued ? 'agent 已创建' : '新建 agent'}
      visible={open}
      onCancel={close}
      footer={null}
      style={{ width: 'min(640px, 95vw)' }}
    >
      {!issued && (
        <div className="space-y-3">
          <div className="text-sm text-gray-500">给这台机器起个名字（自用，可任改）：</div>
          <Input value={name} onChange={setName} placeholder="my-mac" />
          <Button type="primary" onClick={submit} loading={loading} long>
            生成 token
          </Button>
        </div>
      )}
      {issued && (
        <div className="space-y-3">
          <Alert
            type="warning"
            content="下面这串 token 只显示这一次。复制到 Mac 上 install.sh 提示框里。关掉就找不回，只能撤销重发。"
          />
          <Card title="agent_token（一次性）">
            <code className="break-all select-all text-sm">{issued.token}</code>
          </Card>
          <Card title="server_url">
            <code className="break-all select-all text-sm">{issued.base_url}</code>
          </Card>
          <Alert
            type="info"
            content={
              <div className="text-xs">
                在 Mac 上：
                <pre className="bg-gray-100 p-2 rounded mt-1">{`cd apps/mac-agent
./install.sh`}</pre>
              </div>
            }
          />
          <Button long onClick={close}>完成</Button>
        </div>
      )}
    </Modal>
  );
}


// ---------------------------------------------------------------------------
// terminal session


type Stage = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'gave_up';

// 重连间隔：先 2s 起，逐渐拉长。不要密集试，避免：
//   - 移动端弱网下持续打无谓握手
//   - 服务端 broker 状态没准备好时一直撞 4503
const BACKOFFS_MS = [2_000, 5_000, 10_000, 20_000, 30_000, 60_000];
const MAX_ATTEMPTS = BACKOFFS_MS.length;
const PING_MS = 25_000;

function TerminalSession({ agent, onClose }: { agent: AgentInfo; onClose: () => void }) {
  const [stage, setStage] = useState<Stage>('connecting');
  const [retryIn, setRetryIn] = useState(0);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [resumedHint, setResumedHint] = useState(false);
  const termRef = useRef<HTMLDivElement | null>(null);
  const reconnectFnRef = useRef<(() => void) | null>(null);
  const sendInputRef = useRef<((data: string) => void) | null>(null);
  const sessionToken = useAuth((s) => s.token);

  useEffect(() => {
    // 每次 effect 拿自己的 active 闭包，避免 React StrictMode 下
    // "旧 WS onclose 还在 inflight，但 alive 标志被新 effect 重置回 true"
    // 这种竞争状态把双向连接打回 4003 → reconnect 死循环
    let active = true;
    let attempt = 0;
    let ws: WebSocket | null = null;
    let pingTimer: number | null = null;
    let reconnectTimer: number | null = null;

    const term = new Terminal({
      fontFamily: 'JetBrains Mono, SF Mono, Menlo, monospace',
      fontSize: 13,
      theme: { background: '#0b0f10', foreground: '#d4dadf', cursor: '#5af78e' },
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
      if (!sessionToken) {
        setErrMsg('未登录');
        return;
      }
      setErrMsg(null);
      setStage(attempt === 0 ? 'connecting' : 'reconnecting');

      const url = wsUrlFromApi(
        `/api/admin/terminal/ws?token=${encodeURIComponent(sessionToken)}&agent_id=${agent.id}`,
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
        if (typeof ev.data === 'string') {
          try {
            const obj = JSON.parse(ev.data);
            if (obj.t === 'paired') {
              setResumedHint(!!obj.resumed);
            }
          } catch {
            // ignore
          }
          return;
        }
        term.write(new Uint8Array(ev.data as ArrayBuffer));
      };
      sock.onclose = (ev) => {
        if (pingTimer) {
          window.clearInterval(pingTimer);
          pingTimer = null;
        }
        // 旧 socket 的 close 不触发任何重连
        if (!active || ws !== sock) return;
        // 这些 code 都不该自动重连：
        //   1000 正常关 / 4401 鉴权失效 / 4404 agent 不存在 / 4003 别处接管
        if (ev.code === 1000 || ev.code === 4401 || ev.code === 4404 || ev.code === 4003) {
          setStage('closed');
          if (ev.code === 4003) {
            setErrMsg('此终端已在另一个窗口打开');
          } else if (ev.code === 4404) {
            setErrMsg('agent 不存在或已撤销');
          }
          return;
        }
        // 多次失败后停止自动重连，避免无限拨号
        if (attempt >= MAX_ATTEMPTS) {
          setStage('gave_up');
          setErrMsg(
            `连续 ${MAX_ATTEMPTS} 次重连失败（最近一次 ${ev.code} ${ev.reason || ''}），请检查网络 / agent 状态后手动「立即重连」`,
          );
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

    // 给 QuickKeys 用：直接把字符串当 stdin 灌进 pty
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

  function manualReconnect() {
    reconnectFnRef.current?.();
  }

  const stageLabel: Record<Stage, string> = {
    connecting: '连接中',
    open: '已连接',
    reconnecting: `重连中 (${Math.ceil(retryIn / 1000)}s)`,
    closed: '已断开',
    gave_up: '已放弃',
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 头部：移动端两行（标题/状态 + 动作），桌面一行 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base sm:text-lg font-bold leading-none">
            {agent.name}
          </h2>
          <Tag color={agent.online ? 'green' : 'gray'} size="small">
            {agent.online ? '在线' : '离线'}
          </Tag>
          <Tag
            color={
              stage === 'open'
                ? 'blue'
                : stage === 'closed' || stage === 'gave_up'
                  ? 'red'
                  : 'orange'
            }
            size="small"
          >
            {stageLabel[stage]}
          </Tag>
        </div>
        <div className="flex gap-2">
          {stage !== 'open' && (
            <Button size="mini" type="outline" onClick={manualReconnect}>
              立即重连
            </Button>
          )}
          <Button size="mini" onClick={onClose}>
            ← 返回
          </Button>
        </div>
      </div>

      {errMsg && <Alert type="error" content={errMsg} closable />}
      {resumedHint && stage === 'open' && (
        <Alert
          type="success"
          content="已复用之前的 pty 会话（命令历史 / 当前目录都在）"
          closable
          onClose={() => setResumedHint(false)}
        />
      )}

      <QuickKeys
        disabled={stage !== 'open'}
        send={(s) => sendInputRef.current?.(s)}
      />

      <div
        ref={termRef}
        className="rounded-lg overflow-hidden w-full"
        style={{
          // 移动端跟随视口；桌面给到 520px 上限
          height: 'min(calc(100dvh - 280px), 520px)',
          minHeight: 280,
          background: '#0b0f10',
          padding: 6,
        }}
      />
      <div className="text-[11px] text-gray-400 hidden sm:block">
        断网 30 秒内重新连接，pty 仍然保留（命令历史 / 当前目录都在）；超过 30 秒会清掉。
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// quick keys — 给移动端补回触屏键盘缺的那些常用键 / 命令


interface KeyDef {
  label: string;
  send: string;
  /** small: 灰按钮（控制键 / 符号）；cmd: 蓝按钮（整条命令带回车）*/
  kind: 'small' | 'cmd';
}

// 控制键 + 符号：单字符 / 转义序列
const CONTROL_KEYS: KeyDef[] = [
  { label: 'Tab', send: '\t', kind: 'small' },
  { label: 'Esc', send: '\x1b', kind: 'small' },
  { label: '↑', send: '\x1b[A', kind: 'small' },
  { label: '↓', send: '\x1b[B', kind: 'small' },
  { label: '←', send: '\x1b[D', kind: 'small' },
  { label: '→', send: '\x1b[C', kind: 'small' },
  { label: '^C', send: '\x03', kind: 'small' },
  { label: '^D', send: '\x04', kind: 'small' },
  { label: '^L', send: '\x0c', kind: 'small' },     // clear screen
  { label: '^Z', send: '\x1a', kind: 'small' },     // suspend
  { label: '~', send: '~', kind: 'small' },
  { label: '/', send: '/', kind: 'small' },
  { label: '-', send: '-', kind: 'small' },
  { label: '|', send: '|', kind: 'small' },
  { label: '>', send: '>', kind: 'small' },
  { label: '&&', send: '&&', kind: 'small' },
];

// 常用命令：按一下回车自动发出
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

function QuickKeys({
  disabled,
  send,
}: {
  disabled: boolean;
  send: (data: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {/* 控制键：横向可滚动，移动端窄屏不换行折损视觉密度 */}
      <KeyRow keys={CONTROL_KEYS} disabled={disabled} send={send} />
      <KeyRow keys={COMMAND_KEYS} disabled={disabled} send={send} />
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
      className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1 scrollbar-none"
      style={{ scrollbarWidth: 'none' }}
    >
      {keys.map((k) => (
        <KeyBtn key={k.label} k={k} disabled={disabled} send={send} />
      ))}
    </div>
  );
}


function KeyBtn({
  k,
  disabled,
  send,
}: {
  k: KeyDef;
  disabled: boolean;
  send: (data: string) => void;
}) {
  const base =
    'shrink-0 px-2 py-1 rounded-md text-[12px] font-mono select-none transition-colors ' +
    'active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed';
  const style =
    k.kind === 'cmd'
      ? 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
      : 'bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200';
  return (
    <button
      type="button"
      className={`${base} ${style}`}
      disabled={disabled}
      onClick={() => send(k.send)}
    >
      {k.label}
    </button>
  );
}
