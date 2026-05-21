import { useCallback, useEffect, useRef, useState } from 'react';
import LabFrame from './LabFrame';

const COLS = 28;
const ROWS = 20;
const TICK_MS = 110;

type Dir = 'up' | 'down' | 'left' | 'right';
type Cell = { x: number; y: number };

function randFood(snake: Cell[]): Cell {
  while (true) {
    const f = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    if (!snake.some((s) => s.x === f.x && s.y === f.y)) return f;
  }
}

function newSnake(): Cell[] {
  const cx = Math.floor(COLS / 2);
  const cy = Math.floor(ROWS / 2);
  return [
    { x: cx, y: cy },
    { x: cx - 1, y: cy },
    { x: cx - 2, y: cy },
  ];
}

export default function Snake() {
  const [snake, setSnake] = useState<Cell[]>(() => newSnake());
  const [food, setFood] = useState<Cell>(() => randFood(newSnake()));
  const [dir, setDir] = useState<Dir>('right');
  const [running, setRunning] = useState(false);
  const [dead, setDead] = useState(false);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const dirRef = useRef<Dir>('right');
  const queuedDir = useRef<Dir | null>(null);

  useEffect(() => {
    const s = localStorage.getItem('lab.snake.best');
    if (s) setBest(Number(s) || 0);
  }, []);

  const reset = useCallback(() => {
    const s = newSnake();
    setSnake(s);
    setFood(randFood(s));
    setDir('right');
    dirRef.current = 'right';
    queuedDir.current = null;
    setDead(false);
    setScore(0);
    setRunning(true);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const map: Record<string, Dir> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        w: 'up',
        s: 'down',
        a: 'left',
        d: 'right',
        k: 'up',
        j: 'down',
        h: 'left',
        l: 'right',
      };
      const n = map[e.key];
      if (n) {
        const cur = dirRef.current;
        const opp: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };
        if (opp[cur] !== n) queuedDir.current = n;
        e.preventDefault();
      } else if (e.key === ' ') {
        setRunning((v) => !v);
        e.preventDefault();
      } else if (e.key === 'r' || e.key === 'R') {
        reset();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reset]);

  useEffect(() => {
    if (!running || dead) return;
    const id = setInterval(() => {
      setSnake((cur) => {
        const d = queuedDir.current ?? dirRef.current;
        dirRef.current = d;
        queuedDir.current = null;
        if (d !== dir) setDir(d);

        const head = cur[0];
        const next: Cell = {
          x: head.x + (d === 'left' ? -1 : d === 'right' ? 1 : 0),
          y: head.y + (d === 'up' ? -1 : d === 'down' ? 1 : 0),
        };

        // 撞墙
        if (next.x < 0 || next.x >= COLS || next.y < 0 || next.y >= ROWS) {
          setDead(true);
          setRunning(false);
          return cur;
        }
        // 撞自己
        if (cur.some((s) => s.x === next.x && s.y === next.y)) {
          setDead(true);
          setRunning(false);
          return cur;
        }

        const ate = next.x === food.x && next.y === food.y;
        const grown = [next, ...cur];
        if (!ate) grown.pop();
        else {
          setFood(randFood(grown));
          setScore((s) => {
            const ns = s + 1;
            setBest((b) => {
              if (ns > b) {
                localStorage.setItem('lab.snake.best', String(ns));
                return ns;
              }
              return b;
            });
            return ns;
          });
        }
        return grown;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running, dead, dir, food]);

  return (
    <LabFrame
      slug="snake"
      title="snake.sh"
      desc="↑↓←→ / WASD / hjkl 移动 · space 暂停 · r 重开。"
      accent="pink"
    >
      <div className="flex items-center gap-4 px-4 py-2 text-xs border-b border-terminal-line/60 flex-wrap">
        <span className="text-terminal-gray">
          <span className="text-terminal-pink">score</span>={' '}
          <span className="text-terminal-green tabular-nums">{score}</span>
        </span>
        <span className="text-terminal-gray">
          <span className="text-terminal-pink">best</span>={' '}
          <span className="text-terminal-yellow tabular-nums">{best}</span>
        </span>
        <span className="text-terminal-gray">
          <span className="text-terminal-pink">len</span>={' '}
          <span className="text-terminal-cyan tabular-nums">{snake.length}</span>
        </span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => setRunning((v) => !v)}
            disabled={dead}
            className="border border-terminal-line/70 rounded px-2 py-1 text-terminal-gray hover:border-terminal-pink/60 transition-colors disabled:opacity-40"
          >
            {running ? 'pause' : 'play'}
          </button>
          <button
            type="button"
            onClick={reset}
            className="border border-terminal-line/70 rounded px-2 py-1 text-terminal-gray hover:border-terminal-pink/60 transition-colors"
          >
            reset
          </button>
        </div>
      </div>

      <div className="p-4 bg-terminal-bg">
        <Board snake={snake} food={food} dead={dead} />
        {!running && !dead && score === 0 && (
          <p className="mt-3 text-xs text-terminal-gray/70">
            按 <span className="text-terminal-pink">space</span> 或 click play 开始。
          </p>
        )}
        {dead && (
          <p className="mt-3 text-sm text-terminal-pink">
            ☠ game over — segfault. score = {score}. 按 r / reset 再来。
          </p>
        )}
      </div>
    </LabFrame>
  );
}

function Board({ snake, food, dead }: { snake: Cell[]; food: Cell; dead: boolean }) {
  const headKey = `${snake[0].x},${snake[0].y}`;
  const bodyKeys = new Set(snake.slice(1).map((s) => `${s.x},${s.y}`));
  const foodKey = `${food.x},${food.y}`;
  const cells = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const k = `${x},${y}`;
      let ch = '·';
      let cls = 'text-terminal-gray/30';
      if (k === foodKey) {
        ch = '*';
        cls = 'text-terminal-yellow drop-shadow-[0_0_6px_rgba(243,249,157,0.9)]';
      } else if (k === headKey) {
        ch = dead ? 'x' : '@';
        cls = dead
          ? 'text-terminal-pink drop-shadow-[0_0_6px_rgba(255,106,193,0.9)]'
          : 'text-terminal-green drop-shadow-[0_0_8px_rgba(90,247,142,0.9)]';
      } else if (bodyKeys.has(k)) {
        ch = '#';
        cls = dead ? 'text-terminal-pink/70' : 'text-terminal-green/80';
      }
      cells.push(
        <span key={k} className={cls} style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          {ch}
        </span>,
      );
    }
  }
  return (
    <div
      className="inline-grid select-none text-[18px] leading-[18px]"
      style={{
        gridTemplateColumns: `repeat(${COLS}, 1.1ch)`,
        gridAutoRows: '1.1em',
      }}
    >
      {cells}
    </div>
  );
}
