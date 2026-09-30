import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Code2,
  Download,
  FileText,
  FlaskConical,
  Layers3,
  Menu,
  Network,
  NotebookPen,
  Search,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { glossary, LabKind, lessons, sources, stages } from '../../data/course';
import { Lab, labTitles } from '../../components/Lab';
import {
  blankEntry,
  complete,
  downloadFile,
  loadProgress,
  mergeProgress,
  reconcileProgress,
  Progress,
  RecordEntry,
  STORAGE_KEY,
  validateProgress,
} from '../../lib/progress';
const labFiles = import.meta.glob('../../../labs/*', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;
function downloadLab(name: string) {
  const file = labFiles[`../../../labs/${name}`];
  if (file) downloadFile(name, file);
}
type LearningProps = {
  progress: Progress;
  update: (id: string, change: Partial<RecordEntry>) => void;
  visit: (id: string) => void;
};
function Status({ id, progress }: { id: string; progress: Progress }) {
  return complete(id, progress) ? (
    <span className="status done">
      <Check size={13} />
      已验收
    </span>
  ) : progress.records[id]?.read ? (
    <span className="status ongoing">待练习</span>
  ) : (
    <span className="status">未开始</span>
  );
}
export default function App() {
  const [initial] = useState(loadProgress);
  const [progress, setProgress] = useState(initial.progress);
  const progressRef = useRef(initial.progress);
  const savedRef = useRef(initial.progress);
  const storageBlocked = useRef(!!initial.warning);
  const [warning, setWarning] = useState(initial.warning);
  const [message, setMessage] = useState('');
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const count = lessons.filter((l) => complete(l.id, progress)).length;
  useEffect(() => {
    setMenu(false);
    setSearch('');
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(t);
  }, [message]);
  function apply(next: Progress) {
    progressRef.current = next;
    setProgress(next);
  }
  function persist(next: Progress) {
    if (storageBlocked.current) {
      apply(next);
      return;
    }
    let merged = next;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const latest = raw ? validateProgress(JSON.parse(raw)) : savedRef.current;
      merged = reconcileProgress(savedRef.current, next, latest);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      savedRef.current = merged;
      setWarning('');
    } catch {
      setWarning(
        '本地保存或合并失败，当前进度仍在内存中。请立即导出学习备份。',
      );
    }
    apply(merged);
  }
  useEffect(() => {
    function receive(event: StorageEvent) {
      if (event.key !== STORAGE_KEY || storageBlocked.current) return;
      if (!event.newValue) {
        setWarning('另一页面清除了本地记录，当前内容仍保留。建议先导出备份。');
        return;
      }
      try {
        const remote = validateProgress(JSON.parse(event.newValue));
        const merged = reconcileProgress(
          savedRef.current,
          progressRef.current,
          remote,
        );
        savedRef.current = remote;
        apply(merged);
      } catch {
        storageBlocked.current = true;
        setWarning(
          '另一页面写入的记录无法读取，已暂停自动覆盖。请先导出当前学习备份。',
        );
      }
    }
    window.addEventListener('storage', receive);
    return () => window.removeEventListener('storage', receive);
  }, []);
  function update(id: string, change: Partial<RecordEntry>) {
    const current = progressRef.current;
    persist({
      ...current,
      lastLesson: id,
      records: {
        ...current.records,
        [id]: {
          ...(current.records[id] || blankEntry()),
          ...change,
          updated: new Date().toISOString(),
        },
      },
    });
  }
  function visit(id: string) {
    const current = progressRef.current;
    if (current.lastLesson !== id) persist({ ...current, lastLesson: id });
  }
  async function importBackup(file?: File) {
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error('备份超过 5 MB，无法导入。');
      const parsed = validateProgress(JSON.parse(await file.text()));
      const next = mergeProgress(progressRef.current, parsed);
      persist(next);
      setMessage('已合并备份，保留现有笔记和已完成进度。');
    } catch (e) {
      setMessage(`导入失败：${e instanceof Error ? e.message : '格式错误'}`);
    }
    if (fileRef.current) fileRef.current.value = '';
  }
  const activeTitle = location.pathname.startsWith('/lesson')
    ? '课程阅读'
    : location.pathname === '/labs'
      ? '交互实验室'
      : location.pathname === '/notebook'
        ? '学习笔记'
        : location.pathname === '/resources'
          ? '参考资料'
          : '学习路径';
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main')?.focus();
          document.getElementById('main')?.scrollIntoView({ block: 'start' });
        }}
      >
        跳到正文
      </a>
      {menu && (
        <button
          className="nav-shade"
          aria-label="关闭导航"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? 'is-open' : ''}`}>
        <Link to="/" className="brand">
          <span className="brand-mark">
            <Layers3 size={23} />
          </span>
          <span>
            Inference<span className="brand-light"> Lab</span>
            <small>推理系统学习手册</small>
          </span>
        </Link>
        <div className="nav-label">你的学习空间</div>
        <nav aria-label="主导航">
          <NavLink to="/" end>
            <BookOpen size={18} />
            学习路径
          </NavLink>
          <NavLink to="/labs">
            <FlaskConical size={18} />
            交互实验室<span className="nav-count">6</span>
          </NavLink>
          <NavLink to="/notebook">
            <NotebookPen size={18} />
            学习笔记
          </NavLink>
          <NavLink to="/resources">
            <FileText size={18} />
            术语与资料
          </NavLink>
        </nav>
        <div className="nav-label second">能力进阶</div>
        <div className="stage-nav">
          {stages.map((s, i) => (
            <Link key={s.title} to={`/lesson/${lessons[i * 3].id}`}>
              <span
                className={
                  lessons
                    .filter((l) => l.stage === i)
                    .every((l) => complete(l.id, progress))
                    ? 'stage-dot finished'
                    : 'stage-dot'
                }
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              {s.title}
            </Link>
          ))}
        </div>
        <div className="sidebar-bottom">
          {window.location.protocol !== 'file:' && (
            <a href="../" className="back-link">
              ← 返回 Tenggouwa
            </a>
          )}
          <div className="progress-caption">
            <strong>持续积累，逐步深入</strong>
            <span>{Math.round((count / lessons.length) * 100)}%</span>
          </div>
          <progress aria-label="课程完成进度" max={18} value={count} />
          <p>{count} / 18 节课程已自评验收</p>
          <div className="backup-actions">
            <button
              onClick={() => {
                downloadFile(
                  'inference-lab-backup.json',
                  JSON.stringify(progress, null, 2),
                  'application/json',
                );
                setMessage('学习备份已导出。');
              }}
            >
              <Download size={15} />
              导出备份
            </button>
            <button onClick={() => fileRef.current?.click()}>
              <Upload size={15} />
              导入
            </button>
          </div>
          <small>保存在当前浏览器 · 建议定期备份</small>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMenu(!menu)}
              aria-label="打开导航"
            >
              <Menu size={20} />
            </button>
            <span>学习空间</span>
            <ChevronRight size={14} />
            <strong>{activeTitle}</strong>
          </div>
          <div className="search-wrap">
            <Search size={16} />
            <input
              aria-label="搜索课程"
              placeholder="搜索知识点、课程…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="icon-button"
                aria-label="清空搜索"
                onClick={() => setSearch('')}
              >
                <X size={14} />
              </button>
            )}
            {search && (
              <div className="search-results">
                {lessons
                  .filter((l) =>
                    (l.title + l.subtitle + l.body)
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((l) => (
                    <Link key={l.id} to={`/lesson/${l.id}`}>
                      <span>0{l.stage + 1}</span>
                      {l.title}
                      <ArrowUpRight size={15} />
                    </Link>
                  ))}
                {!lessons.some((l) =>
                  (l.title + l.subtitle + l.body)
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                ) && <p>没有匹配课程，试试 KV、调度或量化。</p>}
              </div>
            )}
          </div>
          <span className="local-tag">
            <i />
            本地学习
          </span>
        </header>
        {warning && (
          <div role="alert" className="storage-warning">
            {warning}
          </div>
        )}
        <main id="main" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<Dashboard progress={progress} />} />
            <Route
              path="/lesson/:id"
              element={
                <LessonPage
                  key={location.pathname}
                  progress={progress}
                  update={update}
                  visit={visit}
                />
              }
            />
            <Route path="/labs" element={<Labs />} />
            <Route
              path="/notebook"
              element={<Notebook progress={progress} />}
            />
            <Route path="/resources" element={<Resources />} />
            <Route
              path="*"
              element={
                <div className="empty">
                  <h1>页面不存在</h1>
                  <Link to="/">返回学习路径</Link>
                </div>
              }
            />
          </Routes>
        </main>
        <footer className="footer">
          <span>
            INFERENCE LAB <span className="footer-dot">/</span>{' '}
            从理解原理，到改变系统。
          </span>
          <span>教材 v1.0 · 2026.09</span>
        </footer>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label="导入学习备份"
        onChange={(e) => void importBackup(e.target.files?.[0])}
      />
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </div>
  );
}
function Dashboard({ progress }: { progress: Progress }) {
  const [filter, setFilter] = useState('全部阶段');
  const count = lessons.filter((l) => complete(l.id, progress)).length;
  const next =
    lessons.find(
      (l) => l.id === progress.lastLesson && !complete(l.id, progress),
    ) ||
    lessons.find((l) => !complete(l.id, progress)) ||
    lessons[0];
  const started = Object.keys(progress.records).length > 0;
  return (
    <div className="dashboard page-width">
      <div className="eyebrow">
        <span className="tiny-line" /> YOUR INFERENCE JOURNEY
      </div>
      <div className="page-title">
        <div>
          <h1>从部署模型，到优化引擎。</h1>
          <p>读懂计算，找到瓶颈，亲手改变系统的运行方式。</p>
        </div>
        <span className="edition">一条路径 · 六个阶段</span>
      </div>
      <section className="hero">
        <div className="hero-content">
          <span className="hero-tag">
            <span />
            从这里，开始下一步
          </span>
          <h2>
            {started
              ? '继续积累你的系统直觉'
              : '把「会调参数」变成\n「理解为什么」'}
          </h2>
          <p>
            每一课都连接原理、实验和真实源码。
            <br />
            用可复现的证据，建立自己的推理系统知识体系。
          </p>
          <Link className="button cream" to={`/lesson/${next.id}`}>
            {started ? '继续学习' : '开始第一课'}
            <ArrowRight size={17} />
          </Link>
          <small>
            下一课 · {next.title} <span>约 {next.minutes} 分钟阅读与自测</span>
          </small>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="visual-grid" />
          <div className="visual-caption">THE INFERENCE STACK</div>
          <div className="stack-token">
            INPUT <b>token</b>
            <span>01 02 03</span>
          </div>
          <div className="stack-connector" />
          <div className="stack-layer">
            <span>01</span>MODEL<small>Attention · MLP</small>
          </div>
          <div className="stack-layer middle">
            <span>02</span>ENGINE<small>Scheduler · KV Cache</small>
          </div>
          <div className="stack-layer bottom">
            <span>03</span>HARDWARE<small>Compute · Memory</small>
          </div>
          <div className="visual-foot">
            <i />
            理解每一层，连接每一层。
          </div>
        </div>
      </section>
      <div className="overview">
        <div>
          <span className="metric-icon">
            <Layers3 />
          </span>
          <p>
            <strong>
              6 <small>个阶段</small>
            </strong>
            <span>从计算原理到工程交付</span>
          </p>
        </div>
        <div>
          <span className="metric-icon">
            <BookOpen />
          </span>
          <p>
            <strong>
              18 <small>节课程</small>
            </strong>
            <span>讲解、练习、验收逐步推进</span>
          </p>
        </div>
        <div>
          <span className="metric-icon">
            <FlaskConical />
          </span>
          <p>
            <strong>
              6 <small>个交互实验</small>
            </strong>
            <span>先预测，再动手验证</span>
          </p>
        </div>
        <div>
          <span className="metric-icon">
            <CheckCircle2 />
          </span>
          <p>
            <strong>
              {count}
              <small> / 18 已验收</small>
            </strong>
            <span>按学习证据确认进度</span>
          </p>
        </div>
      </div>
      <div className="section-heading">
        <div>
          <h2>
            你的学习路径 <span>THE ROADMAP</span>
          </h2>
          <p>
            建议顺序学习，也可以直接进入你想解决的问题。时间按每周 8–12
            小时估算。
          </p>
        </div>
        <label className="sr-only" htmlFor="stage-filter">
          阶段筛选
        </label>
        <select
          id="stage-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option>全部阶段</option>
          <option>尚未完成</option>
          <option>已完成</option>
        </select>
      </div>
      <div className="roadmap">
        {stages.map((s, i) => {
          const group = lessons.filter((l) => l.stage === i),
            n = group.filter((l) => complete(l.id, progress)).length;
          if (
            (filter === '已完成' && n < 3) ||
            (filter === '尚未完成' && n === 3)
          )
            return null;
          return (
            <section className="stage-card" key={s.title}>
              <div className="stage-head">
                <span
                  className="stage-number"
                  style={{ color: s.color, background: `${s.color}12` }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <span className="stage-en">{s.en}</span>
                  <h3>{s.title}</h3>
                </div>
                <span className="stage-progress">
                  {n}/3 <CheckCircle2 size={15} />
                </span>
              </div>
              <p className="stage-summary">{s.summary}</p>
              <div className="lesson-links">
                {group.map((l, index) => (
                  <Link to={`/lesson/${l.id}`} key={l.id}>
                    <span
                      className={`lesson-indicator ${complete(l.id, progress) ? 'checked' : ''}`}
                    >
                      {complete(l.id, progress) ? (
                        <Check size={12} />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span>{l.title}</span>
                    <ChevronRight size={14} />
                  </Link>
                ))}
              </div>
              <div className="stage-deliverable">
                <Code2 size={15} />
                <span>{s.deliverable}</span>
              </div>
              <div className="stage-bottom">
                <span>
                  <Clock3 size={13} />
                  {s.span}
                </span>
                <Link
                  to={`/lesson/${group.find((l) => !complete(l.id, progress))?.id || group[0].id}`}
                >
                  进入阶段
                  <ArrowRight size={14} />
                </Link>
              </div>
            </section>
          );
        })}
      </div>
      {filter === '已完成' &&
        !stages.some((_, i) =>
          lessons
            .filter((l) => l.stage === i)
            .every((l) => complete(l.id, progress)),
        ) && (
          <div className="empty">
            还没有完成的阶段。读完、自测通过并留下实验验收后，会出现在这里。
          </div>
        )}
      <section className="capstone-banner">
        <span className="capstone-icon">
          <Network size={29} />
        </span>
        <div>
          <span className="eyebrow">YOUR FINAL PROJECT</span>
          <h3>最后，交付属于你的第一个引擎优化。</h3>
          <p>一个真实瓶颈、一份可回退的 patch，以及经得起复现的证据。</p>
        </div>
        <Link className="button secondary" to="/lesson/capstone">
          查看毕业项目
          <ArrowUpRight size={16} />
        </Link>
      </section>
    </div>
  );
}
function LessonPage({ progress, update, visit }: LearningProps) {
  const { id } = useParams();
  const lesson = lessons.find((l) => l.id === id);
  const navigate = useNavigate();
  const [selected, setSelected] = useState<number | null>(null),
    [submitted, setSubmitted] = useState(false);
  const [tab, setTab] = useState('讲解与实验');
  const tabs = ['讲解与实验', '自测与验收', '本课笔记'];
  function moveTab(e: KeyboardEvent<HTMLButtonElement>, current: number) {
    const position =
      e.key === 'ArrowRight'
        ? (current + 1) % tabs.length
        : e.key === 'ArrowLeft'
          ? (current + tabs.length - 1) % tabs.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? tabs.length - 1
              : -1;
    if (position < 0) return;
    e.preventDefault();
    setTab(tabs[position]);
    document.getElementById(`tab-${tabs[position]}`)?.focus();
  }
  useEffect(() => {
    if (lesson) visit(lesson.id);
  }, [lesson?.id]);
  if (!lesson)
    return (
      <div className="empty">
        <h1>未找到课程</h1>
        <Link to="/">返回路径</Link>
      </div>
    );
  const entry = progress.records[lesson.id] || blankEntry(),
    index = lessons.indexOf(lesson),
    stage = stages[lesson.stage];
  const headings = Array.from(
    lesson.body.matchAll(/^### (.+)$/gm),
    (m) => m[1],
  );
  const prerequisites = lesson.prerequisites.map(
    (id) => lessons.find((l) => l.id === id)!,
  );
  return (
    <div className="reader page-width">
      <Link className="back-link" to="/">
        <ChevronLeft size={15} />
        返回学习路径
      </Link>
      <div className="reader-heading">
        <div className="eyebrow">
          STAGE 0{lesson.stage + 1} / {stage.en}
        </div>
        <h1>{lesson.title}</h1>
        <p>{lesson.subtitle}</p>
        <div className="reader-meta">
          <span>
            <Clock3 size={15} />
            阅读与自测约 {lesson.minutes} 分钟
          </span>
          <span>实验另留 1–4 小时；引擎项目可跨多天</span>
          <Status id={lesson.id} progress={progress} />
        </div>
      </div>
      <div className="reader-layout">
        <div className="reader-main">
          <div className="outcome">
            <span>本课结束后，你将能够</span>
            <strong>{lesson.outcome}</strong>
          </div>
          {prerequisites.length > 0 && (
            <p className="prerequisite">
              本课会用到：
              {prerequisites.map((item, i) => (
                <span key={item.id}>
                  {i > 0 && '、'}
                  <Link to={`/lesson/${item.id}`}>{item.title}</Link>
                </span>
              ))}
              。可先阅读，实验验收按实际完成情况填写。
            </p>
          )}
          <div className="tabs" role="tablist" aria-label="课程内容">
            {tabs.map((t, i) => (
              <button
                key={t}
                role="tab"
                tabIndex={tab === t ? 0 : -1}
                onKeyDown={(e) => moveTab(e, i)}
                aria-selected={tab === t}
                aria-controls="lesson-panel"
                id={`tab-${t}`}
                onClick={() => setTab(t)}
              >
                {t}
                {t === '自测与验收' && entry.quiz && <Check size={13} />}
              </button>
            ))}
          </div>
          <div id="lesson-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === '讲解与实验' && (
              <>
                <details className="reading-outline" key={lesson.id}>
                  <summary>本课阅读导航 · {headings.length} 节</summary>
                  <ol>
                    {headings.map((heading, i) => (
                      <li key={heading}>
                        <button
                          onClick={() => {
                            const target = document.getElementById(
                              `section-${lesson.id}-${i}`,
                            );
                            target?.focus({ preventScroll: true });
                            target?.scrollIntoView({
                              behavior: 'smooth',
                              block: 'start',
                            });
                          }}
                        >
                          {heading}
                        </button>
                      </li>
                    ))}
                  </ol>
                </details>
                <article className="prose">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h3: ({ children }) => (
                        <h3
                          id={`section-${lesson.id}-${headings.indexOf(String(children))}`}
                          tabIndex={-1}
                        >
                          {children}
                        </h3>
                      ),
                    }}
                  >
                    {lesson.body}
                  </ReactMarkdown>
                  {lesson.code && (
                    <>
                      <h3>动手起点</h3>
                      <pre>
                        <code>{lesson.code}</code>
                      </pre>
                    </>
                  )}
                </article>
                {lesson.lab && <Lab kind={lesson.lab} />}
                <section className="practice">
                  <div className="small-heading">
                    <FlaskConical size={18} />
                    <h2>动手练习</h2>
                  </div>
                  <ol>
                    {lesson.experiment.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ol>
                  {lesson.download && (
                    <button
                      className="button secondary"
                      onClick={() => downloadLab(lesson.download!)}
                    >
                      <Download size={16} />
                      下载 {lesson.download}
                    </button>
                  )}
                  <p className="muted">
                    Python 实验在终端运行；网页不会执行本机或远程命令。CPU
                    实验可先做，CUDA 实验需要兼容的 NVIDIA 环境。
                  </p>
                </section>
                <div className="reading-end">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={entry.read}
                      onChange={(e) =>
                        update(lesson.id, { read: e.target.checked })
                      }
                    />
                    我已阅读并理解本课讲解
                  </label>
                  <button
                    className="button primary"
                    onClick={() => setTab('自测与验收')}
                  >
                    进入自测
                    <ArrowRight size={16} />
                  </button>
                </div>
              </>
            )}
            {tab === '自测与验收' && (
              <>
                <section className="quiz">
                  <span className="eyebrow">CHECK YOUR UNDERSTANDING</span>
                  <h2>{lesson.quiz.question}</h2>
                  <fieldset>
                    <legend className="sr-only">选择答案</legend>
                    {lesson.quiz.options.map((o, i) => (
                      <label
                        key={o}
                        className={`quiz-option ${selected === i ? 'selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="answer"
                          checked={selected === i}
                          onChange={() => {
                            setSelected(i);
                            setSubmitted(false);
                          }}
                        />
                        <span>{String.fromCharCode(65 + i)}</span>
                        {o}
                      </label>
                    ))}
                  </fieldset>
                  <button
                    className="button primary"
                    disabled={selected === null}
                    onClick={() => {
                      setSubmitted(true);
                      if (selected === lesson.quiz.answer)
                        update(lesson.id, { quiz: true });
                    }}
                  >
                    检查答案
                  </button>
                  {submitted && (
                    <div
                      role="status"
                      className={`feedback ${selected === lesson.quiz.answer ? 'correct' : 'incorrect'}`}
                    >
                      <strong>
                        {selected === lesson.quiz.answer
                          ? '回答正确'
                          : '再想一想'}
                      </strong>
                      <p>{lesson.quiz.explanation}</p>
                      <button
                        className="text-button"
                        onClick={() => {
                          setTab('讲解与实验');
                          requestAnimationFrame(() => {
                            const target = document.getElementById(
                              `section-${lesson.id}-${headings.indexOf(lesson.quiz.section)}`,
                            );
                            target?.focus({ preventScroll: true });
                            target?.scrollIntoView({ block: 'start' });
                          });
                        }}
                      >
                        回看讲解：{lesson.quiz.section}
                      </button>
                    </div>
                  )}
                  {entry.quiz && !submitted && (
                    <p className="success-text">
                      <CheckCircle2 size={15} />
                      你已通过本课自测，可以随时复习。
                    </p>
                  )}
                </section>
                <section className="acceptance">
                  <h2>把理解变成证据</h2>
                  <p>
                    选择题只检查一个核心概念，不代表整课实验通过。以下为自评验收，不会自动验证结果；缺少
                    GPU
                    或引擎环境时可以继续阅读，将相应验收保留待完成。请记录命令、结果或证据路径后再勾选。
                  </p>
                  {lesson.acceptance.map((s, i) => (
                    <label className="check acceptance-item" key={s}>
                      <input
                        type="checkbox"
                        checked={!!entry.checks[i]}
                        onChange={(e) => {
                          const checks = lesson.acceptance.map((_, index) =>
                            index === i
                              ? e.target.checked
                              : !!entry.checks[index],
                          );
                          update(lesson.id, { checks });
                        }}
                      />
                      {s}
                    </label>
                  ))}
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={entry.read}
                      onChange={(e) =>
                        update(lesson.id, { read: e.target.checked })
                      }
                    />
                    我已阅读并理解本课讲解
                  </label>
                  <div className="completion">
                    <Status id={lesson.id} progress={progress} />
                    <span>
                      {complete(lesson.id, progress)
                        ? '本课已完成自评验收。继续下一步。'
                        : '阅读确认 + 自测通过 + 全部验收勾选后，计入完成进度。'}
                    </span>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => setTab('本课笔记')}
                  >
                    记录实验与证据
                    <NotebookPen size={16} />
                  </button>
                </section>
              </>
            )}
            {tab === '本课笔记' && (
              <section className="note-editor">
                <h2>给未来的自己留一份证据</h2>
                <p>
                  可以记录：我的理解 → 假设 → 命令与版本 → 结果 → 反例 →
                  下一步。不填写凭据或原始敏感数据。
                </p>
                <label htmlFor="lesson-notes">本课学习笔记</label>
                <textarea
                  id="lesson-notes"
                  maxLength={100000}
                  value={entry.notes}
                  onChange={(e) => update(lesson.id, { notes: e.target.value })}
                  placeholder="今天的问题是什么？\n我原来以为……\n实验条件和命令……\n实际观察到……\n证据文件路径……\n还有哪些未验证……"
                />
                <div className="note-toolbar">
                  <small>
                    自动保存在当前浏览器 · {entry.notes.length} 字符
                    {entry.updated &&
                      ` · 更新于 ${new Date(entry.updated).toLocaleString('zh-CN')}`}
                  </small>
                  <button
                    className="button secondary"
                    onClick={() =>
                      downloadFile(
                        `${lesson.id}-notes.md`,
                        `# ${lesson.title}\n\n${entry.notes}`,
                      )
                    }
                  >
                    <Download size={15} />
                    导出笔记
                  </button>
                </div>
              </section>
            )}
          </div>
          <div className="lesson-pagination">
            <button
              className="button secondary"
              disabled={index === 0}
              onClick={() => navigate(`/lesson/${lessons[index - 1].id}`)}
            >
              <ChevronLeft size={16} />
              上一课
            </button>
            <span>
              {index + 1} / {lessons.length}
            </span>
            {index < lessons.length - 1 ? (
              <button
                className="button primary"
                onClick={() => navigate(`/lesson/${lessons[index + 1].id}`)}
              >
                下一课
                <ChevronRight size={16} />
              </button>
            ) : (
              <Link className="button primary" to="/notebook">
                查看学习成果
                <ArrowRight size={16} />
              </Link>
            )}
          </div>
        </div>
        <aside className="reader-aside">
          <div className="aside-card">
            <span className="eyebrow">本阶段的三步</span>
            <h3>{stage.title}</h3>
            {lessons
              .filter((l) => l.stage === lesson.stage)
              .map((l, i) => (
                <Link
                  className={l.id === lesson.id ? 'current' : ''}
                  to={`/lesson/${l.id}`}
                  key={l.id}
                >
                  <span>
                    {complete(l.id, progress) ? <Check size={14} /> : i + 1}
                  </span>
                  {l.title}
                </Link>
              ))}
          </div>
          <div className="aside-card sources">
            <span className="eyebrow">继续深挖</span>
            <h3>原始资料</h3>
            {lesson.sources.map((s) => (
              <a key={s} href={sources[s].url} target="_blank" rel="noreferrer">
                {sources[s].title}
                <ArrowUpRight size={14} />
              </a>
            ))}
            <p>外部资料需联网。引擎 API 与路径请对照你的固定版本。</p>
          </div>
          <div className="study-hint">
            <Sparkles size={19} />
            <strong>带着问题读源码</strong>
            <p>每次只追踪一个机制。把猜测、模拟结果和实测证据分开记录。</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
function Labs() {
  const [kind, setKind] = useState<LabKind>('cache');
  return (
    <div className="page-width subpage">
      <div className="eyebrow">THINK → CHANGE → OBSERVE</div>
      <h1>交互实验室</h1>
      <p className="lead">先预测一个变化，再调节参数，观察你的直觉是否成立。</p>
      <div className="lab-selection">
        {(Object.keys(labTitles) as LabKind[]).map((k) => (
          <button
            className={kind === k ? 'active' : ''}
            onClick={() => setKind(k)}
            key={k}
          >
            {labTitles[k]}
          </button>
        ))}
      </div>
      <Lab key={kind} kind={kind} />
      <div className="section-heading">
        <div>
          <h2>把原理带回代码</h2>
          <p>
            这些文件已随教材打包。标准库实验不需要 GPU；PyTorch / Triton
            依赖按实验环境安装。
          </p>
        </div>
      </div>
      <div className="download-grid">
        {[
          [
            'attention_reference.py',
            '01 / CPU · 无依赖',
            '增量 Attention 等价性',
            '完整 causal attention 与逐 token KV 实现，对比误差。',
          ],
          [
            'scheduler_reference.py',
            '02 / CPU · 无依赖',
            '分块调度参考模型',
            '观察长 prompt 分块如何改变 decode 等待。',
          ],
          [
            'analyze_benchmark.py',
            '03 / CPU · 无依赖',
            '性能日志分析',
            '校验 JSONL 口径，统计 TTFT、TPOT、吞吐与失败率。',
          ],
          [
            'torch_profile.py',
            '04 / CPU 或 CUDA · PyTorch',
            '第一份执行 trace',
            '包含预热、边界同步与 trace 导出。',
          ],
          [
            'triton_softmax.py',
            '05 / NVIDIA CUDA · Triton',
            '融合 Softmax',
            '多 shape、dtype 数值校验与 kernel benchmark。',
          ],
          [
            'prefill_budget.py',
            '06 / CPU · 无依赖',
            '第一份调度策略',
            '保留默认行为，验证 decode 预留、预算上限与边界。',
          ],
          [
            'optimization-report.md',
            '07 / 毕业交付模板',
            '优化实验报告',
            '假设、反证、基线、A/B、正确性与回退。',
          ],
        ].map(([file, tag, title, desc]) => (
          <article className="download-card" key={file}>
            <span className="eyebrow">{tag}</span>
            <h3>{title}</h3>
            <p>{desc}</p>
            <button onClick={() => downloadLab(file)} className="text-button">
              <Download size={15} />
              {file}
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
function Notebook({ progress }: { progress: Progress }) {
  const notes = lessons.filter((l) => progress.records[l.id]?.notes);
  function exportAll() {
    downloadFile(
      'inference-learning-notes.md',
      `# 推理系统学习笔记\n\n导出于 ${new Date().toISOString()}\n\n` +
        lessons
          .map(
            (l) =>
              `## ${l.title}\n\n状态：${complete(l.id, progress) ? '已自评验收' : '学习中或未开始'}\n\n${progress.records[l.id]?.notes || '暂无笔记'}\n`,
          )
          .join('\n'),
    );
  }
  return (
    <div className="page-width subpage">
      <div className="eyebrow">YOUR EVIDENCE, YOUR KNOWLEDGE</div>
      <div className="page-title">
        <div>
          <h1>把经验，积累成自己的知识。</h1>
          <p>这里汇集你的理解、实验记录，以及仍然没有答案的问题。</p>
        </div>
        <button className="button secondary" onClick={exportAll}>
          <Download size={16} />
          导出全部笔记
        </button>
      </div>
      <div className="notebook-summary">
        <strong>
          {notes.length}
          <span>课留下笔记</span>
        </strong>
        <strong>
          {lessons.filter((l) => progress.records[l.id]?.quiz).length}
          <span>课通过自测</span>
        </strong>
        <strong>
          {lessons.filter((l) => complete(l.id, progress)).length}
          <span>课完成自评验收</span>
        </strong>
      </div>
      {notes.length === 0 ? (
        <div className="empty notebook-empty">
          <NotebookPen size={42} />
          <h2>第一份记录，从一个问题开始。</h2>
          <p>
            进入课程的「本课笔记」，写下你的预测、观察和证据路径。
            <br />
            这里会自动汇集；可导出 Markdown 或完整 JSON 备份。
          </p>
          <Link
            className="button primary"
            to={`/lesson/${progress.lastLesson}`}
          >
            去记录第一课
            <ArrowRight size={16} />
          </Link>
        </div>
      ) : (
        <div className="notes-list">
          {notes.map((l) => (
            <article key={l.id}>
              <div>
                <h2>
                  <Link to={`/lesson/${l.id}`}>{l.title}</Link>
                </h2>
                <Status id={l.id} progress={progress} />
              </div>
              <p className="note-preview">{progress.records[l.id].notes}</p>
              <Link className="text-button" to={`/lesson/${l.id}`}>
                回到课程编辑
                <ArrowUpRight size={14} />
              </Link>
            </article>
          ))}
        </div>
      )}
      <div className="notice">
        进度由你在课程内确认；教材不连接
        GPU，也不会把勾选验收当成自动运行成功。不同浏览器、端口或本地文件位置可能使用不同存储空间，迁移时请导出并导入备份。
      </div>
    </div>
  );
}
function Resources() {
  const [term, setTerm] = useState('');
  return (
    <div className="page-width subpage">
      <div className="eyebrow">REFERENCE DESK</div>
      <h1>术语与原始资料</h1>
      <p className="lead">先读懂当前问题所需要的概念，再沿原始资料往下钻。</p>
      <label className="resource-search">
        <Search size={17} />
        <input
          aria-label="搜索术语"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="查找 TTFT、KV Cache、EP…"
        />
      </label>
      <div className="glossary">
        {glossary
          .filter((g) => g.join(' ').toLowerCase().includes(term.toLowerCase()))
          .map(([t, d, id]) => (
            <div key={t}>
              <h3>{t}</h3>
              <p>{d}</p>
              <Link to={`/lesson/${id}`} aria-label={`学习 ${t}`}>
                <ArrowUpRight size={18} />
              </Link>
            </div>
          ))}
      </div>
      <div className="section-heading">
        <div>
          <h2>精选一手资料</h2>
          <p>
            课程以稳定原理组织；动态文档与 main
            分支不代表你正在使用的版本。资料整理于 2026-09-30。
          </p>
        </div>
      </div>
      <div className="resource-grid">
        {Object.values(sources).map((s) => (
          <a href={s.url} target="_blank" rel="noreferrer" key={s.url}>
            <h3>
              {s.title}
              <ArrowUpRight size={16} />
            </h3>
            <p>{s.note}</p>
            <small>{new URL(s.url).hostname}</small>
          </a>
        ))}
      </div>
    </div>
  );
}
