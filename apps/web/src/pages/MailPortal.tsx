import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ApiError, apiGet, apiPost } from '../lib/api';
import type { Schemas } from '../lib/apiTypes';

type Inbox = Schemas['MailInboxItem'];
type Mail = Schemas['MailMessageItem'];
type Code = Schemas['LatestCodeResult'];
const button = 'rounded border border-terminal-line px-3 py-2 text-sm hover:border-terminal-green hover:text-terminal-green disabled:opacity-40 disabled:cursor-not-allowed';
const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });

function Panel({ path, children }: { path: string; children: ReactNode }) {
  return <section className="overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/50">
    <div className="flex items-center gap-2 border-b border-terminal-line/60 px-4 py-3 text-xs text-terminal-gray/70">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
      <span className="ml-2">{path}</span>
    </div>
    <div className="p-4 sm:p-6">{children}</div>
  </section>;
}

export default function MailPortal() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [mailbox, setMailbox] = useState('');
  const [messages, setMessages] = useState<Mail[]>([]);
  const [latest, setLatest] = useState<Code | null>(null);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);

  function clearSession() {
    setAuthenticated(false);
    setInboxes([]);
    setMessages([]);
    setMailbox('');
    setLatest(null);
    setPassword('');
  }

  async function run(action: (signal: AbortSignal) => Promise<void>, restoring = false) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setNotice('');
    const timeout = window.setTimeout(() => current.abort('timeout'), 35_000);
    try {
      await action(current.signal);
    } catch (error) {
      if (current.signal.aborted) {
        if (current.signal.reason === 'timeout') setNotice('请求超时，请重试');
      } else if (error instanceof ApiError && error.status === 401) {
        clearSession();
        if (!restoring) setNotice(error.message);
      } else {
        setNotice(error instanceof Error ? error.message : '请求失败，请重试');
      }
    } finally {
      window.clearTimeout(timeout);
      if (controller.current === current) {
        setBusy(false);
        setWaiting(false);
      }
    }
  }

  async function refresh(signal: AbortSignal) {
    const data = await apiGet<Inbox[]>('/api/mail/inboxes', { signal, cache: 'no-store' });
    if (signal.aborted) return;
    setInboxes(data);
    setAuthenticated(true);
  }

  useEffect(() => {
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
    document.head.appendChild(robots);
    const title = document.title;
    document.title = '接码收件箱';
    void run(refresh, true);
    return () => {
      controller.current?.abort();
      robots.remove();
      document.title = title;
    };
    // Initial session restoration only; requests are cancelled on unmount.
  }, []);

  function login(event: FormEvent) {
    event.preventDefault();
    void run(async (signal) => {
      await apiPost<boolean>('/api/mail/login', { password }, { signal, headers: { 'X-Mail-Portal': '1' } });
      setPassword('');
      await refresh(signal);
    });
  }

  async function load(box: string, pageOffset: number, signal: AbortSignal) {
    const rows = await apiGet<Mail[]>(`/api/mail/${encodeURIComponent(box)}/messages?limit=50&offset=${pageOffset}`, { signal, cache: 'no-store' });
    if (signal.aborted) return;
    setMessages(rows);
    setOffset(pageOffset);
    const code = rows.find((row) => row.code);
    setLatest(code ? { code: code.code, subject: code.subject, received_at: code.received_at } : null);
  }

  function select(box: string) {
    setMailbox(box);
    setMessages([]);
    setLatest(null);
    setOffset(0);
    void run((signal) => load(box, 0, signal));
  }

  function waitForCode() {
    setWaiting(true);
    void run(async (signal) => {
      const since = encodeURIComponent(new Date().toISOString());
      const code = await apiGet<Code>(`/api/mail/${encodeURIComponent(mailbox)}/latest-code?wait=25&since=${since}`, { signal, cache: 'no-store' });
      if (signal.aborted) return;
      if (code.code) {
        await load(mailbox, 0, signal);
        await refresh(signal);
        if (!signal.aborted) setNotice('收到新验证码');
      } else {
        setNotice('25 秒内没有收到新验证码，可以再试一次');
      }
    });
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice('已复制');
    } catch {
      setNotice('复制失败，请手动选中复制');
    }
  }

  return <main className="mail-portal min-h-screen bg-terminal-bg px-4 py-10 font-mono text-terminal-gray sm:px-8">
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-terminal-green"><span className="text-terminal-pink">~$</span> cat mail/inbox</h1>
          <p className="mt-2 text-sm text-terminal-gray/70">接码收件箱 · 共享访问</p>
        </div>
        {authenticated && <button className={button} onClick={() => {
          void run(async (signal) => {
            await apiPost('/api/mail/logout', undefined, { signal, headers: { 'X-Mail-Portal': '1' } });
            clearSession();
          });
        }}>退出登录</button>}
      </header>
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-terminal-yellow">{notice || (busy ? (waiting ? '等待新验证码…' : '正在读取…') : '')}</p>
      {!authenticated ? <div className="mx-auto max-w-md pt-8">
        <Panel path="~/mail/login">
          <form onSubmit={login} className="space-y-5">
            <p className="text-sm text-terminal-gray/70">输入访问密码，查看共享收件箱。</p>
            <label className="block text-sm">访问密码
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required maxLength={72} className="mt-2 w-full rounded border border-terminal-line bg-terminal-bg px-3 py-3 outline-none focus:border-terminal-green" />
            </label>
            <button type="submit" disabled={busy || !password} className={`${button} w-full text-terminal-green`}>登录</button>
          </form>
        </Panel>
      </div> : <>
        <Panel path="~/mail/inboxes">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-terminal-green"><span className="text-terminal-pink">$</span> ls inboxes/</h2>
            <button disabled={busy} className={button} onClick={() => void run(refresh)}>刷新收件箱</button>
          </div>
          <p className="mb-4 text-xs text-terminal-gray/70">所有持有访问密码的人均可查看。仅显示未过期邮件。</p>
          {inboxes.length === 0 ? <p className="py-6 text-sm text-terminal-gray/70">暂无收件箱，收到新邮件后刷新查看。</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {inboxes.map((box) => <button key={box.mailbox} disabled={busy} onClick={() => select(box.mailbox)} className={`rounded border p-4 text-left transition-colors hover:border-terminal-green disabled:opacity-50 ${mailbox === box.mailbox ? 'border-terminal-green bg-terminal-green/5' : 'border-terminal-line'}`}>
              <div className="break-all text-sm text-terminal-cyan">{box.mailbox}@tenggouwa.com</div>
              <div className="mt-3 text-xs text-terminal-gray/70">{box.total} 封邮件 · {box.with_code} 封含验证码</div>
              <div className="mt-1 text-xs text-terminal-gray/70">{formatTime(box.latest_at)}</div>
            </button>)}
          </div>}
        </Panel>
        <Panel path={`~/mail/${mailbox || 'select-inbox'}`}>
          <form className="mb-5 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); if (mailbox.trim()) select(mailbox.trim().toLowerCase()); }}>
            <label className="flex min-w-0 basis-full sm:basis-auto flex-1 items-center gap-2 text-sm">
              <span className="sr-only">收件箱名</span>
              <input value={mailbox} disabled={busy} onChange={(event) => { setMailbox(event.target.value); setMessages([]); setLatest(null); setOffset(0); }} placeholder="收件箱名" className="w-full min-w-0 rounded border border-terminal-line bg-terminal-bg px-3 py-2 outline-none focus:border-terminal-green" />
              <span className="text-terminal-gray/70">@tenggouwa.com</span>
            </label>
            <button className={button} disabled={busy || !mailbox.trim()}>查收件箱</button>
            <button type="button" className={button} disabled={busy || !mailbox.trim()} onClick={waitForCode}>等新码 · 25s</button>
            {waiting && <button type="button" className={button} onClick={() => controller.current?.abort()}>取消等待</button>}
          </form>
          {latest?.code && <div className="mb-5 rounded border border-terminal-green/40 bg-terminal-green/5 p-4">
            <p className="text-xs text-terminal-gray/70">本页最近验证码</p>
            <div className="mt-2 flex flex-wrap items-center gap-4"><strong className="select-all text-3xl tracking-widest text-terminal-green">{latest.code}</strong><button className={button} onClick={() => void copy(latest.code!)}>复制验证码</button></div>
            <p className="mt-2 break-words text-xs text-terminal-gray/70">{latest.subject} · {latest.received_at && formatTime(latest.received_at)}</p>
          </div>}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-terminal-line text-terminal-gray/70"><tr>{['时间', '发件人 / 主题', '验证码'].map((title) => <th key={title} className="px-2 py-3 font-normal">{title}</th>)}</tr></thead>
              <tbody>{messages.map((mail) => <tr key={mail.id} className="border-b border-terminal-line/60">
                <td className="whitespace-nowrap px-2 py-4 text-xs text-terminal-gray/70">{formatTime(mail.received_at)}</td>
                <td className="max-w-xs break-words px-2 py-4"><div>{mail.subject || '无主题'}</div><div className="mt-1 text-xs text-terminal-gray/70">{mail.from_address || '-'}</div></td>
                <td className="px-2 py-4">{mail.code ? <button title="复制验证码" className="text-terminal-cyan hover:text-terminal-green" onClick={() => void copy(mail.code!)}>{mail.code}</button> : '-'}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {!messages.length && <p className="py-8 text-center text-sm text-terminal-gray/70">{mailbox ? '暂无未过期邮件' : '选择或输入收件箱名开始查看'}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button className={button} disabled={busy || offset === 0} onClick={() => void run((signal) => load(mailbox, offset - 50, signal))}>上一页</button>
            <button className={button} disabled={busy || messages.length < 50} onClick={() => void run((signal) => load(mailbox, offset + 50, signal))}>下一页</button>
          </div>
        </Panel>
      </>}
    </div>
  </main>;
}
