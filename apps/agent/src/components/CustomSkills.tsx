import { useEffect, useState } from 'react';
import { deleteCustomSkill, listCustomSkills, upsertCustomSkill, type CustomSkill } from '../lib/api';

// skills 页的「自定义 skill」区块：页面上加 skill，agent 私有通道直接调。两种执行体：
// - prompt：填一段带 {参数} 的提示词，调用时跑 LLM 返文本（免审批）。
// - http：填 URL(+方法/头/body，可带 {参数})，调用时后端请求它、响应返 agent（SSRF 守卫 + 走审批）。
// 参数用「逗号分隔的名字」声明（都当 string），够日常用；模板/URL 里用 {名字} 引用。

const EMPTY = { name: '', description: '', kind: 'prompt' as 'prompt' | 'http', params: '', template: '', url: '', method: 'GET', headers: '', body: '' };

function buildParams(csv: string): Record<string, unknown> {
  const names = csv
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) return { type: 'object', properties: {} };
  return {
    type: 'object',
    properties: Object.fromEntries(names.map((n) => [n, { type: 'string' }])),
    required: names,
  };
}

function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export default function CustomSkills({ token }: { token: string }) {
  const [items, setItems] = useState<CustomSkill[] | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [msg, setMsg] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const refresh = () =>
    listCustomSkills(token)
      .then(setItems)
      .catch(() => setItems([]));
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function submit() {
    setBusy(true);
    setMsg(undefined);
    const config =
      form.kind === 'prompt'
        ? { template: form.template }
        : { url: form.url, method: form.method, headers: parseHeaders(form.headers), body: form.body };
    try {
      const r = await upsertCustomSkill(token, {
        name: form.name,
        description: form.description,
        parameters: buildParams(form.params),
        kind: form.kind,
        config,
      });
      setMsg(r.message);
      if (r.ok) {
        setForm({ ...EMPTY });
        refresh();
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '提交失败');
    } finally {
      setBusy(false);
    }
  }

  async function del(id: number) {
    setItems((xs) => xs?.filter((x) => x.id !== id) ?? xs);
    try {
      await deleteCustomSkill(token, id);
    } catch {
      refresh();
    }
  }

  const inputCls =
    'w-full bg-terminal-bg border border-terminal-line/60 rounded px-2 py-1 text-xs text-terminal-gray outline-none focus:border-terminal-green/50';

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-terminal-green text-lg">
          <span className="text-terminal-pink">$ </span>自定义 skill
        </h2>
        <p className="text-xs text-terminal-gray/60">
          自己加工具，agent 立刻能调。<span className="text-terminal-cyan">prompt</span> 型=跑提示词模板（免审批）；
          <span className="text-terminal-cyan">http</span> 型=调一个公网 URL（走审批 + 只准公网）。模板/URL 里用{' '}
          <code className="text-terminal-yellow">{'{参数名}'}</code> 引用参数。
        </p>
      </div>

      {items && items.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3">
          {items.map((s) => (
            <div key={s.id} className="group rounded-lg border border-terminal-cyan/30 bg-terminal-panel/30 p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <code className="text-terminal-cyan">{s.name}</code>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-terminal-line/60 text-terminal-gray/60">
                    {s.kind}
                  </span>
                  <button
                    type="button"
                    onClick={() => del(s.id)}
                    title="删除"
                    className="text-terminal-gray/30 hover:text-terminal-red opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <p className="text-xs text-terminal-gray/70">{s.description}</p>
            </div>
          ))}
        </div>
      )}

      {/* 建 / 改表单（同名 = 覆盖更新） */}
      <div className="rounded-lg border border-terminal-line/60 bg-terminal-bg/60 p-3 space-y-2">
        <div className="grid sm:grid-cols-2 gap-2">
          <input className={inputCls} placeholder="name（如 send_email）" value={form.name} onChange={(e) => set('name', e.target.value)} />
          <select className={inputCls} value={form.kind} onChange={(e) => set('kind', e.target.value)}>
            <option value="prompt">prompt（跑提示词）</option>
            <option value="http">http（调 URL）</option>
          </select>
        </div>
        <input className={inputCls} placeholder="description（agent 靠它决定何时调）" value={form.description} onChange={(e) => set('description', e.target.value)} />
        <input className={inputCls} placeholder="参数名，逗号分隔（如 text, lang）" value={form.params} onChange={(e) => set('params', e.target.value)} />

        {form.kind === 'prompt' ? (
          <textarea
            className={inputCls + ' font-mono'}
            rows={3}
            placeholder="提示词模板，用 {参数名} 占位。如：把 {text} 翻译成 {lang}"
            value={form.template}
            onChange={(e) => set('template', e.target.value)}
          />
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input className={inputCls} placeholder="https://…（可含 {参数}）" value={form.url} onChange={(e) => set('url', e.target.value)} />
              <select className={inputCls} value={form.method} onChange={(e) => set('method', e.target.value)}>
                {['GET', 'POST', 'PUT', 'DELETE'].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <textarea className={inputCls + ' font-mono'} rows={2} placeholder="请求头，每行 K: V（可选）" value={form.headers} onChange={(e) => set('headers', e.target.value)} />
            {(form.method === 'POST' || form.method === 'PUT') && (
              <textarea className={inputCls + ' font-mono'} rows={2} placeholder="请求 body（可含 {参数}，可选）" value={form.body} onChange={(e) => set('body', e.target.value)} />
            )}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={busy || !form.name.trim() || !form.description.trim()}
            className="text-xs px-3 py-1 rounded border border-terminal-green/50 text-terminal-green hover:bg-terminal-green/10 disabled:opacity-40"
          >
            {busy ? '提交中…' : '+ 加 / 更新'}
          </button>
          {msg && <span className="text-xs text-terminal-gray/70">{msg}</span>}
        </div>
      </div>
    </div>
  );
}
