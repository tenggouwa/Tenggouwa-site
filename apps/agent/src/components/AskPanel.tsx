import { useState } from 'react';
import { renderInline } from '../lib/markdown';

export interface AskQuestion {
  header?: string;
  question: string;
  options: string[];
  multi?: boolean;
}

const OTHER = '__other__'; // 「其他…」选项的哨兵值，选中后展开输入框填自定义答案

// agent 抛的选择题：每题一组可点选项，选完组成一条回答作为下一轮发送。
// locked = 后面已有新回合，锁死本面板；submitted = 本面板已提交过。
export default function AskPanel({
  intro,
  questions,
  locked,
  onSubmit,
}: {
  intro?: string;
  questions: AskQuestion[];
  locked: boolean;
  onSubmit: (text: string) => void;
}) {
  const [sel, setSel] = useState<Record<number, string[]>>({});
  const [custom, setCustom] = useState<Record<number, string>>({}); // 「其他」自定义答案文本
  const [submitted, setSubmitted] = useState(false);
  const done = locked || submitted;

  function toggle(qi: number, opt: string, multi?: boolean) {
    if (done) return;
    setSel((s) => {
      const cur = s[qi] ?? [];
      if (multi) return { ...s, [qi]: cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt] };
      return { ...s, [qi]: cur.includes(opt) ? [] : [opt] };
    });
  }

  // 每题都答了；选了「其他」还需填了文本才算数
  const allAnswered = questions.every((_, qi) => {
    const s = sel[qi] ?? [];
    if (s.length === 0) return false;
    if (s.includes(OTHER) && !(custom[qi] ?? '').trim()) return false;
    return true;
  });

  function send() {
    if (done || !allAnswered) return;
    const text = questions
      .map((qq, qi) => {
        const chosen = (sel[qi] ?? []).map((o) => (o === OTHER ? (custom[qi] ?? '').trim() : o)).filter(Boolean);
        return `${qq.header || qq.question}：${chosen.join('、')}`;
      })
      .join('\n');
    setSubmitted(true);
    onSubmit(text);
  }

  return (
    <div className="my-1 rounded border border-terminal-cyan/30 bg-terminal-panel/30 p-3 space-y-3">
      {intro && <div className="text-sm text-terminal-gray/80 whitespace-pre-wrap">{renderInline(intro)}</div>}
      {questions.map((qq, qi) => {
        const otherOn = (sel[qi] ?? []).includes(OTHER);
        return (
          <div key={qi} className="space-y-1.5">
            <div className="text-sm text-terminal-gray">
              {qq.header && <span className="text-terminal-cyan mr-1.5">[{qq.header}]</span>}
              {qq.question}
            </div>
            <div className="flex flex-wrap gap-2">
              {[...qq.options, OTHER].map((opt) => {
                const active = (sel[qi] ?? []).includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    disabled={done}
                    onClick={() => toggle(qi, opt, qq.multi)}
                    className={
                      'px-2.5 py-1 rounded border text-xs transition-colors disabled:opacity-70 ' +
                      (active
                        ? 'border-terminal-green/70 bg-terminal-green/15 text-terminal-green'
                        : 'border-terminal-line/70 text-terminal-gray hover:border-terminal-green/50 hover:text-terminal-green')
                    }
                  >
                    {active ? '✓ ' : ''}
                    {opt === OTHER ? '其他…' : opt}
                  </button>
                );
              })}
            </div>
            {otherOn && (
              <input
                value={custom[qi] ?? ''}
                disabled={done}
                onChange={(e) => setCustom((c) => ({ ...c, [qi]: e.target.value }))}
                placeholder="输入你的答案…"
                className="w-full bg-terminal-bg/60 border border-terminal-line/70 rounded px-2 py-1 text-xs text-terminal-gray outline-none focus:border-terminal-green/60 placeholder:text-terminal-gray/40 disabled:opacity-70"
              />
            )}
          </div>
        );
      })}
      {!done && (
        <button
          type="button"
          disabled={!allAnswered}
          onClick={send}
          className="text-xs text-terminal-green border border-terminal-green/40 rounded px-3 py-1 hover:bg-terminal-green/10 disabled:opacity-40 transition-colors"
        >
          ↵ 发送选择
        </button>
      )}
      {submitted && <div className="text-xs text-terminal-gray/40">已提交</div>}
    </div>
  );
}
