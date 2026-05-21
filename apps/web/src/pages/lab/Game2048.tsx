import { useCallback, useEffect, useState } from 'react';
import LabFrame from './LabFrame';

type Board = number[][];

const SIZE = 4;

function emptyBoard(): Board {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function addRandom(b: Board): Board {
  const empty: [number, number][] = [];
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) if (b[y][x] === 0) empty.push([x, y]);
  if (!empty.length) return b;
  const [x, y] = empty[Math.floor(Math.random() * empty.length)];
  const n = b.map((row) => row.slice());
  n[y][x] = Math.random() < 0.9 ? 2 : 4;
  return n;
}

function rowLeft(row: number[]): { row: number[]; gained: number } {
  const f = row.filter((v) => v !== 0);
  const out: number[] = [];
  let gained = 0;
  for (let i = 0; i < f.length; i++) {
    if (f[i] === f[i + 1]) {
      const m = f[i] * 2;
      out.push(m);
      gained += m;
      i++;
    } else {
      out.push(f[i]);
    }
  }
  while (out.length < SIZE) out.push(0);
  return { row: out, gained };
}

function rotate(b: Board): Board {
  const n = emptyBoard();
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) n[x][SIZE - 1 - y] = b[y][x];
  return n;
}

type Dir = 'left' | 'right' | 'up' | 'down';

function move(b: Board, dir: Dir): { board: Board; gained: number; moved: boolean } {
  let work = b.map((r) => r.slice());
  const rotations = { left: 0, down: 1, right: 2, up: 3 }[dir];
  for (let i = 0; i < rotations; i++) work = rotate(work);
  let gained = 0;
  for (let y = 0; y < SIZE; y++) {
    const r = rowLeft(work[y]);
    work[y] = r.row;
    gained += r.gained;
  }
  for (let i = 0; i < (4 - rotations) % 4; i++) work = rotate(work);
  let moved = false;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (work[y][x] !== b[y][x]) moved = true;
  return { board: work, gained, moved };
}

function isDead(b: Board): boolean {
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      if (b[y][x] === 0) return false;
      if (x + 1 < SIZE && b[y][x] === b[y][x + 1]) return false;
      if (y + 1 < SIZE && b[y][x] === b[y + 1][x]) return false;
    }
  return true;
}

const TILE_COLORS: Record<number, string> = {
  0: 'bg-terminal-panel/30 text-transparent',
  2: 'bg-terminal-panel text-terminal-gray',
  4: 'bg-terminal-panel text-terminal-cyan',
  8: 'bg-terminal-cyan/15 text-terminal-cyan',
  16: 'bg-terminal-cyan/25 text-terminal-cyan',
  32: 'bg-terminal-green/15 text-terminal-green',
  64: 'bg-terminal-green/25 text-terminal-green',
  128: 'bg-terminal-yellow/15 text-terminal-yellow',
  256: 'bg-terminal-yellow/25 text-terminal-yellow',
  512: 'bg-terminal-pink/15 text-terminal-pink',
  1024: 'bg-terminal-pink/30 text-terminal-pink',
  2048: 'bg-terminal-pink/50 text-white',
};

function colorFor(v: number): string {
  return TILE_COLORS[v] ?? 'bg-terminal-pink/60 text-white';
}

function start(): Board {
  return addRandom(addRandom(emptyBoard()));
}

export default function Game2048() {
  const [board, setBoard] = useState<Board>(() => start());
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [dead, setDead] = useState(false);
  const [won, setWon] = useState(false);

  useEffect(() => {
    const s = localStorage.getItem('lab.2048.best');
    if (s) setBest(Number(s) || 0);
  }, []);

  const reset = useCallback(() => {
    setBoard(start());
    setScore(0);
    setDead(false);
    setWon(false);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (dead) return;
      const dir: Record<string, Dir> = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down',
        h: 'left',
        l: 'right',
        k: 'up',
        j: 'down',
        a: 'left',
        d: 'right',
        w: 'up',
        s: 'down',
      };
      const d = dir[e.key];
      if (!d) return;
      e.preventDefault();
      setBoard((cur) => {
        const r = move(cur, d);
        if (!r.moved) return cur;
        const nb = addRandom(r.board);
        if (r.gained > 0) {
          setScore((s) => {
            const ns = s + r.gained;
            setBest((b) => {
              if (ns > b) {
                localStorage.setItem('lab.2048.best', String(ns));
                return ns;
              }
              return b;
            });
            return ns;
          });
        }
        if (!won && nb.flat().includes(2048)) setWon(true);
        if (isDead(nb)) setDead(true);
        return nb;
      });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dead, won]);

  return (
    <LabFrame
      slug="2048"
      title="2048.exe"
      desc="↑↓←→ / WASD / hjkl 移动方块。merge same numbers."
      accent="yellow"
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
        <div className="ml-auto">
          <button
            type="button"
            onClick={reset}
            className="border border-terminal-line/70 rounded px-2 py-1 text-terminal-gray hover:border-terminal-yellow/60 hover:text-terminal-yellow transition-colors"
          >
            reset
          </button>
        </div>
      </div>
      <div className="p-6 bg-terminal-bg flex flex-col items-center">
        <div
          className="grid gap-2 p-2 rounded-lg bg-terminal-panel/40 border border-terminal-line/70"
          style={{ gridTemplateColumns: `repeat(${SIZE}, 4.5rem)` }}
        >
          {board.flatMap((row, y) =>
            row.map((v, x) => (
              <div
                key={`${x}-${y}-${v}`}
                className={`h-[4.5rem] w-[4.5rem] rounded-md flex items-center justify-center text-xl font-bold tabular-nums transition-colors ${colorFor(v)}`}
                style={{ fontFamily: 'JetBrains Mono, monospace' }}
              >
                {v || '·'}
              </div>
            )),
          )}
        </div>
        {won && !dead && (
          <p className="mt-4 text-sm text-terminal-pink">
            ✓ 2048 reached. 继续合成更高的方块。
          </p>
        )}
        {dead && (
          <p className="mt-4 text-sm text-terminal-pink">
            ☠ no more moves. score = {score}. reset 再来一局。
          </p>
        )}
      </div>
    </LabFrame>
  );
}
