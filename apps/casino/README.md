# @tenggouwa/casino

部署在 `/casino/` 的概率与赌场游戏实验场。前端使用 React、Three.js、React Three Fiber 和
terminal/CRT 视觉；服务端负责需要权威状态的钱包和部分游戏流程。

## 页面

- 大厅与概率真相页。
- Dice、Roulette、Slots、Baccarat、Blackjack、Dragon Tiger、Keno、Crash、Money Wheel、
  Plinko、Sic Bo、炸金花、Mines、牛牛、Video Poker、Scratch。
- `scripts/prerender-casino.mjs` 为各游戏生成可索引静态壳、Game/FAQ schema，并写入 sitemap。

## 本地运行

```bash
pnpm --filter @tenggouwa/casino dev
pnpm --filter @tenggouwa/casino build
```

API 地址使用 `VITE_API_BASE`，部署 base 使用 `VITE_BASE`。路由和资源不能硬编码根路径，以免
GitHub Pages 的 `/Tenggouwa-site/casino/` 镜像失效。

## 数据边界

纯展示/动画可在浏览器完成；钱包余额、claim 和需要防客户端篡改的游戏状态走
`apps/server/app/modules/casino`。该应用不处理真实货币。
