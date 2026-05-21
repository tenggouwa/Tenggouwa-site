import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LabFrame from './LabFrame';

const COLS = 60;
const ROWS = 36;
const CELL = 14;

type Grid = Uint8Array;

function emptyGrid(): Grid {
  return new Uint8Array(COLS * ROWS);
}
function randomGrid(density = 0.3): Grid {
  const g = emptyGrid();
  for (let i = 0; i < g.length; i++) g[i] = Math.random() < density ? 1 : 0;
  return g;
}
function step(g: Grid): Grid {
  const n = emptyGrid();
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      let live = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = (x + dx + COLS) % COLS;
          const ny = (y + dy + ROWS) % ROWS;
          live += g[ny * COLS + nx];
        }
      }
      const i = y * COLS + x;
      n[i] = g[i] ? (live === 2 || live === 3 ? 1 : 0) : live === 3 ? 1 : 0;
    }
  }
  return n;
}

// 几个经典图案
const PRESETS: Record<string, [number, number][]> = {
  glider: [
    [1, 0],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ],
  pulsar: [
    // 简化版 pulsar，13x13
    [2, 0],
    [3, 0],
    [4, 0],
    [8, 0],
    [9, 0],
    [10, 0],
    [0, 2],
    [5, 2],
    [7, 2],
    [12, 2],
    [0, 3],
    [5, 3],
    [7, 3],
    [12, 3],
    [0, 4],
    [5, 4],
    [7, 4],
    [12, 4],
    [2, 5],
    [3, 5],
    [4, 5],
    [8, 5],
    [9, 5],
    [10, 5],
    [2, 7],
    [3, 7],
    [4, 7],
    [8, 7],
    [9, 7],
    [10, 7],
    [0, 8],
    [5, 8],
    [7, 8],
    [12, 8],
    [0, 9],
    [5, 9],
    [7, 9],
    [12, 9],
    [0, 10],
    [5, 10],
    [7, 10],
    [12, 10],
    [2, 12],
    [3, 12],
    [4, 12],
    [8, 12],
    [9, 12],
    [10, 12],
  ],
  gosper: [
    // 经典 gosper glider gun
    [24, 0],
    [22, 1],
    [24, 1],
    [12, 2],
    [13, 2],
    [20, 2],
    [21, 2],
    [34, 2],
    [35, 2],
    [11, 3],
    [15, 3],
    [20, 3],
    [21, 3],
    [34, 3],
    [35, 3],
    [0, 4],
    [1, 4],
    [10, 4],
    [16, 4],
    [20, 4],
    [21, 4],
    [0, 5],
    [1, 5],
    [10, 5],
    [14, 5],
    [16, 5],
    [17, 5],
    [22, 5],
    [24, 5],
    [10, 6],
    [16, 6],
    [24, 6],
    [11, 7],
    [15, 7],
    [12, 8],
    [13, 8],
  ],
};

export default function Life() {
  const [grid, setGrid] = useState<Grid>(() => randomGrid());
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(80);
  const [gen, setGen] = useState(0);
  const ref = useRef<HTMLCanvasElement>(null);

  const alive = useMemo(() => {
    let c = 0;
    for (let i = 0; i < grid.length; i++) c += grid[i];
    return c;
  }, [grid]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setGrid((g) => step(g));
      setGen((n) => n + 1);
    }, speed);
    return () => clearInterval(id);
  }, [running, speed]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = COLS * CELL * dpr;
    canvas.height = ROWS * CELL * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#0b0f10';
    ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);

    // 微弱栅格
    ctx.strokeStyle = 'rgba(31, 42, 48, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= COLS; x++) {
      ctx.moveTo(x * CELL + 0.5, 0);
      ctx.lineTo(x * CELL + 0.5, ROWS * CELL);
    }
    for (let y = 0; y <= ROWS; y++) {
      ctx.moveTo(0, y * CELL + 0.5);
      ctx.lineTo(COLS * CELL, y * CELL + 0.5);
    }
    ctx.stroke();

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (grid[y * COLS + x]) {
          ctx.fillStyle = '#5af78e';
          ctx.shadowColor = 'rgba(90, 247, 142, 0.7)';
          ctx.shadowBlur = 6;
          ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
        }
      }
    }
    ctx.shadowBlur = 0;
  }, [grid]);

  const toggle = useCallback((cx: number, cy: number) => {
    setGrid((g) => {
      const n = new Uint8Array(g);
      const i = cy * COLS + cx;
      n[i] = n[i] ? 0 : 1;
      return n;
    });
  }, []);

  const loadPreset = useCallback((name: keyof typeof PRESETS) => {
    setGrid(() => {
      const g = emptyGrid();
      const cells = PRESETS[name];
      const ox = Math.floor(COLS / 2 - 6);
      const oy = Math.floor(ROWS / 2 - 6);
      for (const [x, y] of cells) {
        const px = (x + ox + COLS) % COLS;
        const py = (y + oy + ROWS) % ROWS;
        g[py * COLS + px] = 1;
      }
      return g;
    });
    setGen(0);
  }, []);

  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = Math.floor(((e.clientX - rect.left) / rect.width) * COLS);
    const cy = Math.floor(((e.clientY - rect.top) / rect.height) * ROWS);
    if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) toggle(cx, cy);
  }

  return (
    <LabFrame
      slug="life"
      title="conway.life"
      desc="点格子加 / 删活细胞。规则: B3/S23。环面拓扑。"
      accent="yellow"
    >
      <div className="flex items-center gap-3 px-4 py-2 text-xs border-b border-terminal-line/60 flex-wrap">
        <span className="text-terminal-gray">
          <span className="text-terminal-pink">gen</span>={' '}
          <span className="text-terminal-yellow tabular-nums">{gen}</span>
        </span>
        <span className="text-terminal-gray">
          <span className="text-terminal-pink">alive</span>={' '}
          <span className="text-terminal-green tabular-nums">{alive}</span>
        </span>
        <label className="flex items-center gap-2 text-terminal-gray">
          <span className="text-terminal-yellow">--ms</span>
          <input
            type="range"
            min={30}
            max={400}
            step={10}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="accent-terminal-yellow"
          />
          <span className="w-10 text-right tabular-nums">{speed}</span>
        </label>
        <div className="flex gap-2 ml-auto flex-wrap">
          <Btn onClick={() => setRunning((v) => !v)}>{running ? 'pause' : 'play'}</Btn>
          <Btn
            onClick={() => {
              setGrid((g) => step(g));
              setGen((n) => n + 1);
            }}
          >
            step
          </Btn>
          <Btn
            onClick={() => {
              setGrid(randomGrid());
              setGen(0);
            }}
          >
            random
          </Btn>
          <Btn
            onClick={() => {
              setGrid(emptyGrid());
              setGen(0);
            }}
          >
            clear
          </Btn>
          <Btn onClick={() => loadPreset('glider')}>glider</Btn>
          <Btn onClick={() => loadPreset('pulsar')}>pulsar</Btn>
          <Btn onClick={() => loadPreset('gosper')}>gosper</Btn>
        </div>
      </div>
      <div className="p-4 bg-terminal-bg overflow-x-auto">
        <canvas
          ref={ref}
          onClick={onClick}
          style={{ width: COLS * CELL, height: ROWS * CELL }}
          className="cursor-crosshair block max-w-full"
        />
      </div>
    </LabFrame>
  );
}

function Btn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border border-terminal-line/70 rounded px-2 py-1 text-terminal-gray hover:border-terminal-yellow/60 hover:text-terminal-yellow transition-colors"
    >
      {children}
    </button>
  );
}
