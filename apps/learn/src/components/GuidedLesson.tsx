import { useRef, useState } from 'react';
import type { Lesson } from '../data/course';
import { ConceptVisual } from './ConceptVisual';
import { guides } from '../data/guides';

export function GuidedLesson({
  lesson,
  onReview,
  onPractice,
}: {
  lesson: Lesson;
  onReview: () => void;
  onPractice: () => void;
}) {
  const guide = guides[lesson.id];
  const [step, setStep] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const names = ['操作看变化', '推演一个例子', '试着判断'];
  function move(next: number) {
    setStep(next);
    requestAnimationFrame(() => heading.current?.focus());
  }
  return (
    <section className="guided-lesson" aria-label="分步学习">
      <div className="guided-top">
        <span className="eyebrow">先学一个核心概念</span>
        <span>{step + 1} / 3 步</span>
      </div>
      <nav className="guided-steps" aria-label="学习步骤">
        {names.map((name, i) => (
          <button
            key={name}
            aria-current={step === i ? 'step' : undefined}
            onClick={() => move(i)}
          >
            <span>{i + 1}</span>
            {name}
          </button>
        ))}
      </nav>
      <h2 ref={heading} tabIndex={-1}>
        {step === 0
          ? guide.question
          : step === 1
            ? guide.prediction
            : lesson.quiz.question}
      </h2>
      {step === 0 && (
        <>
          <ConceptVisual id={lesson.id} />
          <details className="visual-explanation">
            <summary>需要一句解释？</summary>
            <p>{guide.scene}</p>
            <p>{guide.takeaway}</p>
          </details>
        </>
      )}
      {step === 1 && (
        <>
          <p className="guided-hint">先预测，再看结果。</p>
          <div className="guided-comparison">
            <div>
              <span>已知条件</span>
              <strong>{guide.before}</strong>
            </div>
            <div>
              <span>推演结果</span>
              {revealed ? (
                <strong>{guide.after}</strong>
              ) : (
                <button
                  className="button secondary"
                  onClick={() => setRevealed(true)}
                >
                  我想好了，看结果
                </button>
              )}
            </div>
          </div>
          {revealed && (
            <p className="guided-node-detail" role="status">
              {guide.why}
            </p>
          )}
        </>
      )}
      {step === 2 && (
        <>
          <fieldset className="guided-options">
            <legend className="sr-only">本步判断题</legend>
            {lesson.quiz.options.map((option, i) => (
              <label key={option}>
                <input
                  type="radio"
                  name={`guided-${lesson.id}`}
                  checked={answer === i}
                  onChange={() => {
                    setAnswer(i);
                    setChecked(false);
                  }}
                />
                <span>{option}</span>
              </label>
            ))}
          </fieldset>
          <button
            className="button primary"
            disabled={answer === null}
            onClick={() => setChecked(true)}
          >
            看看我的判断
          </button>
          {checked && (
            <div className="guided-answer" role="status">
              <strong>
                {answer === lesson.quiz.answer
                  ? '这一步理解对了'
                  : '看看是哪一步想偏了'}
              </strong>
              <p>{lesson.quiz.explanation}</p>
              <button className="text-button" onClick={onReview}>
                回到对应原理
              </button>
            </div>
          )}
          <p className="guided-hint">
            这是热身，不会自动勾选课程完成。实验与正式自测可以稍后做。
          </p>
        </>
      )}

      <div className="guided-controls">
        <button
          className="button secondary"
          disabled={step === 0}
          onClick={() => move(step - 1)}
        >
          上一步
        </button>
        {step < 2 ? (
          <button className="button primary" onClick={() => move(step + 1)}>
            {step === 0 ? '用例子想一遍 →' : '试着判断 →'}
          </button>
        ) : (
          <button className="button primary" onClick={onPractice}>
            去自测与验收 →
          </button>
        )}
      </div>
    </section>
  );
}
