import { Link } from 'react-router-dom';

interface Toy {
  slug: string;
  title: string;
  desc: string;
  tag: string;
  accent: 'green' | 'cyan' | 'pink' | 'yellow';
}

const TOYS: Toy[] = [
  {
    slug: 'matrix',
    title: 'matrix-rain',
    desc: '经典数字雨。半角假名 + ASCII，自带 bloom。',
    tag: 'shader',
    accent: 'green',
  },
  {
    slug: 'flock',
    title: 'flock.boids',
    desc: 'Boids 鸟群算法。鼠标当吸引子，发光拖尾。',
    tag: 'simulation',
    accent: 'cyan',
  },
  {
    slug: 'donut',
    title: 'donut.c',
    desc: '致敬 a1k0n。3D torus 投影到 ASCII 字符。',
    tag: 'render',
    accent: 'cyan',
  },
  {
    slug: 'wave',
    title: 'wave.field',
    desc: '2D 波动方程 + 阻尼。点 / 拖产生字符涟漪。',
    tag: 'simulation',
    accent: 'cyan',
  },
  {
    slug: 'rope',
    title: 'rope.verlet',
    desc: 'Verlet 物理绳。鼠标拖任意节点，gravity 可调。',
    tag: 'physics',
    accent: 'pink',
  },
  {
    slug: 'snake',
    title: 'snake.sh',
    desc: '终端栅格贪吃蛇。方向键 / hjkl 操作。',
    tag: 'game',
    accent: 'pink',
  },
  {
    slug: '2048',
    title: '2048.exe',
    desc: '经典数字消除。↑↓←→ 移动方块，merge same number。',
    tag: 'game',
    accent: 'yellow',
  },
  {
    slug: 'life',
    title: 'conway.life',
    desc: '生命游戏。点格子编辑，可播放 / 步进 / 随机化。',
    tag: 'automaton',
    accent: 'yellow',
  },
  {
    slug: 'mandelbrot',
    title: 'mandelbrot.ascii',
    desc: '逃逸时间分形，按字符密度渲染。点击放大、拖动平移、无限下钻。',
    tag: 'fractal',
    accent: 'green',
  },
];

const ACCENT_TEXT: Record<Toy['accent'], string> = {
  green: 'text-terminal-green',
  cyan: 'text-terminal-cyan',
  pink: 'text-terminal-pink',
  yellow: 'text-terminal-yellow',
};

const ACCENT_HOVER: Record<Toy['accent'], string> = {
  green: 'hover:border-terminal-green/60',
  cyan: 'hover:border-terminal-cyan/60',
  pink: 'hover:border-terminal-pink/60',
  yellow: 'hover:border-terminal-yellow/60',
};

export default function Lab() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-terminal-pink text-2xl">
          <span className="text-terminal-pink">$ </span>ls ./lab
        </h1>
        <p className="text-sm text-terminal-gray">
          前端实验室。一些跑在浏览器里的小玩具，点进去看。
        </p>
      </div>

      <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TOYS.map((toy) => (
          <Link
            key={toy.slug}
            to={`/lab/${toy.slug}`}
            className={`group block border border-terminal-line/70 bg-terminal-panel/40 rounded-lg p-5 transition-colors ${ACCENT_HOVER[toy.accent]}`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className={`text-lg font-semibold ${ACCENT_TEXT[toy.accent]}`}>
                {toy.title}
              </div>
              <span className="text-[10px] text-terminal-gray/70 border border-terminal-line/70 rounded px-2 py-0.5">
                {toy.tag}
              </span>
            </div>
            <div className="text-sm text-terminal-gray">{toy.desc}</div>
            <div className="mt-4 text-xs text-terminal-gray/70 group-hover:text-terminal-green transition-colors">
              ./{toy.slug} <span className="opacity-60">↵</span>
            </div>
          </Link>
        ))}
      </section>

      <p className="text-xs text-terminal-gray/60">
        # 还会陆续加。想看什么 toy？给我提 issue 或在 about 页面找联系方式。
      </p>
    </div>
  );
}
