import { Link } from 'react-router-dom';
import TitleBar from '../components/TitleBar';

interface GameCard {
  key: string;
  name: string;
  cmd: string;
  edge: string;
  desc: string;
  to?: string;
  accent: string;
}

const GAMES: GameCard[] = [
  {
    key: 'dice',
    name: '骰子 · 大小',
    cmd: 'play dice',
    edge: '2.78%',
    desc: '三颗骰子押大小，豹子通杀。最简单的概率游戏，最直接的庄家优势。',
    to: '/games/dice',
    accent: 'green',
  },
  {
    key: 'roulette',
    name: '轮盘 · Roulette',
    cmd: 'play roulette',
    edge: '2.70%',
    desc: '欧式单零轮盘，37 格。押红黑/单双/大小或单个号码，那个 0 让你永远差一口气。',
    to: '/games/roulette',
    accent: 'cyan',
  },
  {
    key: 'slots',
    name: '老虎机 · Slots',
    cmd: 'play slots',
    edge: '6.04%',
    desc: '三轴卷轴，看似随机，赔率早已写死。RTP 93.96%，命中率约 11.6%——大多数拉杆就是亏。',
    to: '/games/slots',
    accent: 'pink',
  },
  {
    key: 'baccarat',
    name: '百家乐 · Baccarat',
    cmd: 'play baccarat',
    edge: '1.06%',
    desc: '押庄 / 闲 / 和，标准补牌规则。押庄优势最低 1.06%，但押"和"是 14.4% 的陷阱。',
    to: '/games/baccarat',
    accent: 'yellow',
  },
  {
    key: 'blackjack',
    name: '21点 · Blackjack',
    cmd: 'play blackjack',
    edge: '~0.5%',
    desc: '要牌/停牌/双倍，最讲策略的牌局。基本策略庄家优势仅 0.5%，但乱玩照样把你磨光。',
    to: '/games/blackjack',
    accent: 'cyan',
  },
  {
    key: 'dragon_tiger',
    name: '龙虎斗 · Dragon Tiger',
    cmd: 'play dragon-tiger',
    edge: '3.85%',
    desc: '龙虎各一张比大小，押龙/虎/和。一秒一局，押"和"是 30% 优势的陷阱。',
    to: '/games/dragon-tiger',
    accent: 'pink',
  },
  {
    key: 'keno',
    name: '基诺 · Keno',
    cmd: 'play keno',
    edge: '~28%',
    desc: '从 80 个号选 1–10 个，机开 20 个对中。庄家优势全场最高，用大头奖掩盖极差期望。',
    to: '/games/keno',
    accent: 'yellow',
  },
  {
    key: 'crash',
    name: '崩盘 · Crash',
    cmd: 'play crash',
    edge: '4.00%',
    desc: '倍率不断上涨，到目标自动兑现，崩了归零。越贪越易崩——现代网赌的成瘾钩子。',
    to: '/games/crash',
    accent: 'green',
  },
  {
    key: 'money_wheel',
    name: '幸运大转盘 · Money Wheel',
    cmd: 'play money-wheel',
    edge: '11–24%',
    desc: '54 格钱轮，押 1/2/5/10/20/40/★。格上数字越大赔率越高、抽水也越狠。',
    to: '/games/money-wheel',
    accent: 'yellow',
  },
  {
    key: 'plinko',
    name: 'Plinko · 落球',
    cmd: 'play plinko',
    edge: '4.00%',
    desc: '小球穿 12 排钉落进倍率格。中间 ×0.25 概率最高，边缘 ×50 几乎不可能。',
    to: '/games/plinko',
    accent: 'cyan',
  },
  {
    key: 'sicbo',
    name: '骰宝 · Sic Bo',
    cmd: 'play sicbo',
    edge: '2.78%',
    desc: '完整三骰：大小/单点/总和/豹子。大小优势最低，高赔率项个个是坑。',
    to: '/games/sicbo',
    accent: 'green',
  },
  {
    key: 'zhajinhua',
    name: '炸金花 · 赢三张',
    cmd: 'play zhajinhua',
    edge: '2.5%',
    desc: '华人最火的牌局：闲庄各 3 张比牌型，豹子最大。看着公平，水钱照样磨光你。',
    to: '/games/zhajinhua',
    accent: 'pink',
  },
  {
    key: 'mines',
    name: 'Mines · 扫雷',
    cmd: 'play mines',
    edge: '2.00%',
    desc: '翻格避雷，倍率随翻随涨，随时兑现，踩雷归零。"再翻一个"的侥幸最致命。',
    to: '/games/mines',
    accent: 'cyan',
  },
  {
    key: 'niuniu',
    name: '牛牛 · 斗牛',
    cmd: 'play niuniu',
    edge: '2.46%',
    desc: '闲庄各 5 张比牛，牛大者赢。牌对半开，赢了就抽 5% 水——公平外壳下的稳定刮刀。',
    to: '/games/niuniu',
    accent: 'pink',
  },
  {
    key: 'videopoker',
    name: '视频扑克 · Video Poker',
    cmd: 'play videopoker',
    edge: '~0.5%',
    desc: '发 5 张留牌换牌，按牌型赔付。返还率最高的机器，但最优解仍是负期望，乱留更亏。',
    to: '/games/videopoker',
    accent: 'green',
  },
];

const ACCENT: Record<string, string> = {
  green: 'text-terminal-green',
  cyan: 'text-terminal-cyan',
  pink: 'text-terminal-pink',
  yellow: 'text-terminal-yellow',
};

export default function Lobby() {
  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-lg border border-terminal-line bg-terminal-panel/40 shadow-glow">
        <TitleBar path="~/casino" />
        <div className="space-y-3 px-5 py-6">
          <h1 className="text-xl font-semibold text-terminal-green sm:text-2xl">
            用假积分，跑真赔率
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-terminal-gray/85">
            这里没有充值、没有提现。进来发 <span className="text-terminal-yellow">1000</span> 积分，输光了可以重领。
            但每一局都会被记录——你的输赢曲线，和所有人加起来的真实概率。玩够多就会发现：
            <span className="text-terminal-pink"> 庄家从不靠运气，靠的是数学。</span>
          </p>
          <Link
            to="/truth"
            className="inline-block text-sm text-terminal-cyan underline decoration-terminal-cyan/30 underline-offset-4 transition hover:text-terminal-green"
          >
            → 先看看大家输成什么样了
          </Link>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm text-terminal-gray/70">
          <span className="text-terminal-pink">~$</span> <span className="text-terminal-green">ls</span> games/
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GAMES.map((g) => {
            const inner = (
              <div
                className={
                  'flex h-full flex-col gap-3 rounded-lg border bg-terminal-panel/40 p-4 transition ' +
                  (g.to
                    ? 'border-terminal-line hover:border-terminal-green/60 hover:shadow-glow'
                    : 'border-terminal-line/50 opacity-60')
                }
              >
                <div className="flex items-center justify-between">
                  <span className={'font-semibold ' + ACCENT[g.accent]}>{g.name}</span>
                  {!g.to && <span className="text-[10px] text-terminal-gray/50">即将上线</span>}
                </div>
                <p className="flex-1 text-xs leading-relaxed text-terminal-gray/75">{g.desc}</p>
                <div className="flex items-center justify-between border-t border-terminal-line/50 pt-2 text-xs">
                  <code className="text-terminal-gray/60">$ {g.cmd}</code>
                  <span className="text-terminal-gray/60">
                    庄家优势 <span className="text-terminal-red">{g.edge}</span>
                  </span>
                </div>
              </div>
            );
            return g.to ? (
              <Link key={g.key} to={g.to}>
                {inner}
              </Link>
            ) : (
              <div key={g.key}>{inner}</div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
