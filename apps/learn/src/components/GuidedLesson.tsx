import { useRef, useState } from 'react';
import type { Lesson } from '../data/course';
import { ConceptVisual } from './ConceptVisual';
import { guides } from '../data/guides';
import { teachingPaths, quizStep } from '../data/teaching';
import { TeachingReader } from './TeachingReader';

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
  const path = teachingPaths[lesson.id];
  const [introIndex, setIntroIndex] = useState(-1);
  const [step, setStep] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const names = ['逐步理解', '动手观察', '换例推演', '检查理解'];
  function move(next: number) {
    setStep(next);
    requestAnimationFrame(() => heading.current?.focus());
  }
  return (
    <section className="guided-lesson" aria-label="分步学习">
      <div className="guided-top">
        <span className="eyebrow">一次理解一小步</span>
        <span>{step + 1} / 4 环节</span>
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
        {step <= 1
          ? guide.question
          : step === 2
            ? guide.prediction
            : lesson.quiz.question}
      </h2>
      {step === 0 && (
        <TeachingReader
          path={path}
          index={introIndex}
          onSelect={setIntroIndex}
          onDone={() => move(1)}
        />
      )}
      {step === 1 && (
        <>
          <p className="visual-task">{path.tryThis}</p>
          <ConceptVisual id={lesson.id} />
          <details className="visual-explanation">
            <summary>需要一句解释？</summary>
            <p>{guide.scene}</p>
            <p>{guide.takeaway}</p>
          </details>
        </>
      )}
      {step === 2 && (
        <>
          <p className="guided-hint">
            沿用刚才学过的方法，换一组条件。先预测，再看结果。
          </p>
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
      {step === 3 && (
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
              <button
                className="button secondary"
                onClick={() => {
                  setIntroIndex(quizStep[lesson.id]);
                  move(0);
                }}
              >
                回到这道题的推导
              </button>
              <button className="text-button" onClick={onReview}>
                回到对应原理
              </button>
            </div>
          )}
          <p className="guided-hint">
            这是热身，不会自动勾选课程完成。完成实验后再填写正式验收。
          </p>
        </>
      )}

      {step > 0 && (
        <div className="guided-controls">
          <button
            className="button secondary"
            disabled={step === 0}
            onClick={() => move(step - 1)}
          >
            上一步
          </button>
          {step < 3 ? (
            <button className="button primary" onClick={() => move(step + 1)}>
              {step === 1 ? '用例子想一遍 →' : '试着判断 →'}
            </button>
          ) : (
            <button className="button primary" onClick={onPractice}>
              去自测与验收 →
            </button>
          )}
        </div>
      )}
      {step === 3 && <p className="teaching-next">接下来：{path.next}</p>}
    </section>
  );
}
