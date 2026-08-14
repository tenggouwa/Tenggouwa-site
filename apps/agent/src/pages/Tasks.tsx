import { FormEvent, useEffect, useRef, useState } from 'react';
import { API_BASE, createAgentTask, getAgentTask, type AgentTask } from '../lib/api';
import { parseSSEFrame } from '../lib/sse';

const TOK_KEY = 'agent_token';

export default function Tasks() {
  const [prompt, setPrompt] = useState('');
  const [task, setTask] = useState<AgentTask | null>(null);
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const cursor = useRef(0);

  useEffect(() => {
    if (!task || ['completed', 'failed', 'cancelled', 'waiting_approval'].includes(task.status)) return;
    const id = window.setInterval(async () => {
      const token = sessionStorage.getItem(TOK_KEY);
      if (!token) return;
      try { setTask(await getAgentTask(token, task.id)); } catch { /* token expiry is shown by the next action */ }
    }, 1000);
    return () => window.clearInterval(id);
  }, [task]);

  async function replay(taskId: string, token: string) {
    const response = await fetch(`${API_BASE}/api/agent/tasks/${taskId}/events?after=${cursor.current}`, {
      headers: { Authorization: `Bearer ${token}` }, credentials: 'include',
    });
    if (!response.ok || !response.body) throw new Error(`事件流不可用 (HTTP ${response.status})`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() || '';
      for (const frame of frames) {
        const event = parseSSEFrame(frame);
        if (!event) continue;
        let data: { event_id?: number; delta?: string; message?: string };
        try { data = JSON.parse(event.data) as typeof data; } catch { continue; }
        if (data.event_id) cursor.current = data.event_id;
        if (event.event === 'token' && data.delta) setOutput((v) => v + data.delta);
        if (event.event === 'status' && data.message) setOutput((v) => `${v}\n[${data.message}]\n`);
      }
      if (done) return;
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const token = sessionStorage.getItem(TOK_KEY);
    if (!token) { setError('请先在 ask 页面用 TOTP 解锁私有 Agent。'); return; }
    try {
      setError(''); setOutput(''); cursor.current = 0;
      const created = await createAgentTask(token, { q: prompt });
      setTask(created);
      void replay(created.id, token).catch((err: unknown) => setError(err instanceof Error ? err.message : '事件流断开'));
    } catch (err) { setError(err instanceof Error ? err.message : '创建任务失败'); }
  }

  return <section className="space-y-5 font-mono">
    <div><span className="text-terminal-pink">~$</span> <span className="text-terminal-green">agent-task</span><p className="text-sm text-terminal-gray/70 mt-2">私有持久任务：关闭或刷新页面后，任务仍继续；再次打开会从最后事件继续显示。</p></div>
    <form onSubmit={submit} className="border border-terminal-line p-4 space-y-3">
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} required maxLength={2000} placeholder="描述一个需要持续执行的任务…" className="w-full min-h-28 bg-terminal-bg border border-terminal-line p-3 text-terminal-gray outline-none focus:border-terminal-green" />
      <button className="border border-terminal-green px-3 py-1 text-terminal-green hover:bg-terminal-green/10">queue task</button>
    </form>
    {task && <div className="border border-terminal-line p-4 text-sm space-y-2"><p><span className="text-terminal-pink">$</span> task {task.id.slice(0, 8)} · <span className="text-terminal-green">{task.status}</span></p>{task.error && <p className="text-terminal-yellow">{task.error}</p>}<pre className="whitespace-pre-wrap text-terminal-gray/80">{output || '等待任务事件…'}</pre></div>}
    {error && <p className="text-terminal-yellow text-sm">{error}</p>}
  </section>;
}
