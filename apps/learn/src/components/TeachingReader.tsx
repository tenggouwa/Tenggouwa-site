import { useRef, useState } from 'react';
import {
  mathHelp,
  type TeachingPath,
  type TeachingStep,
} from '../data/teaching/types';

function SmallStep({ item }: { item: TeachingStep }) {
  const [visibleLines, setVisibleLines] = useState(1);
  const [answer, setAnswer] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const help = item.math ? mathHelp[item.math] : null;
  return (
    <>
      <p className="teaching-explain">{item.text}</p>
      <div className="worked-example" aria-label="一步步算">
        <span className="eyebrow">拿小例子走一遍</span>
        <ol>
          {item.lines.slice(0, visibleLines).map((line, i) => (
            <li key={line}>
              <span aria-hidden="true">{i + 1}</span>
              <p>{line}</p>
            </li>
          ))}
        </ol>
        {visibleLines < item.lines.length && (
          <button
            className="button secondary"
            onClick={() => setVisibleLines(visibleLines + 1)}
          >
            下一行怎么算？
          </button>
        )}
        <div className="sr-only" role="status">
          已展开 {visibleLines} / {item.lines.length} 行
        </div>
      </div>
      {help && (
        <details className="math-help">
          <summary>{help.title}</summary>
          {help.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </details>
      )}
      <p className="teaching-takeaway">{item.takeaway}</p>
      <fieldset className="micro-check">
        <legend>停一下，只判断这一点：{item.question}</legend>
        {item.options.map((option, i) => (
          <label key={option}>
            <input
              type="radio"
              name="micro-answer"
              checked={answer === i}
              onChange={() => {
                setAnswer(i);
                setChecked(false);
              }}
            />
            {option}
          </label>
        ))}
      </fieldset>
      <button
        className="button secondary"
        disabled={answer === null}
        onClick={() => setChecked(true)}
      >
        核对这一步
      </button>
      {checked && (
        <div className="micro-feedback" role="status">
          <strong>
            {answer === item.answer
              ? '对，接上了。'
              : '先别急着往后，这里再看一下。'}
          </strong>
          <p>{item.explanation}</p>
          <button
            className="text-button"
            onClick={() => {
              setVisibleLines(item.lines.length);
              setChecked(false);
              setAnswer(null);
            }}
          >
            展开计算，再试一次
          </button>
        </div>
      )}
    </>
  );
}

export function TeachingReader({
  path,
  index,
  onSelect,
  onDone,
}: {
  path: TeachingPath;
  index: number;
  onSelect: (index: number) => void;
  onDone: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const directory = useRef<HTMLDetailsElement>(null);
  const item = path.steps[index];
  const navigate = (next: number) => {
    onSelect(next);
    if (directory.current) directory.current.open = false;
    requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: 'start' });
    });
  };
  return (
    <div className="teaching-reader">
      <div className="teaching-position">
        <span>
          {index < 0
            ? '先搭一座桥'
            : `理解 ${index + 1} / ${path.steps.length}`}
        </span>
        <details ref={directory} className="step-directory">
          <summary>查看小步目录</summary>
          <button onClick={() => navigate(-1)}>从比方开始</button>
          {path.steps.map((s, i) => (
            <button
              key={s.title}
              aria-current={index === i ? 'step' : undefined}
              onClick={() => navigate(i)}
            >
              {i + 1}. {s.title}
            </button>
          ))}
        </details>
      </div>
      <h3 ref={heading} tabIndex={-1}>
        {index < 0 ? '先从熟悉的事情想起' : item.title}
      </h3>
      {index < 0 ? (
        <>
          <p className="teaching-bridge">{path.bridge}</p>
          <p className="teaching-analogy">{path.analogy}</p>
          <div className="analogy-map" aria-label="比方与概念的对应">
            {path.mapping.map(([familiar, concept]) => (
              <div key={familiar}>
                <span>{familiar}</span>
                <span aria-hidden="true">↓</span>
                <strong>{concept}</strong>
              </div>
            ))}
          </div>
          <p className="teaching-boundary">比方用到这里：{path.boundary}</p>
        </>
      ) : (
        <SmallStep key={index} item={item} />
      )}
      <div className="teaching-controls">
        <button
          className="button secondary"
          disabled={index < 0}
          onClick={() => navigate(index - 1)}
        >
          上一小步
        </button>
        {index < path.steps.length - 1 ? (
          <button
            className="button primary"
            onClick={() => navigate(index + 1)}
          >
            {index < 0 ? '开始拆开理解 →' : '再拆一步 →'}
          </button>
        ) : (
          <button className="button primary" onClick={onDone}>
            带着理解去操作 →
          </button>
        )}
      </div>
    </div>
  );
}
