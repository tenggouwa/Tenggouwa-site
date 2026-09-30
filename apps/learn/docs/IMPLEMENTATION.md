# 实现与维护

## 脚手架来源

本项目基于 `/Users/tenghuawei/HHO/Project/independent-cli` 的 React 18 + TypeScript + Vite 结构，保留 `index.html → src/app.tsx → src/pages/home/index.tsx` 入口方式、TypeScript 配置和 `@` 路径别名，使用 pnpm 与 nvm。源脚手架未修改。

教材不需要源项目的商城页面、API、认证、云发布与 CDN 脚本，因此只迁入相关结构和 MIT LICENSE，没有复制生产配置。Vite 从原脚手架 4 升为 5.4.21，以满足单文件构建插件的 peer dependency。源脚手架建议 Node 21；本机该版本为 x64，浏览器测试在 Rosetta 下启动明显缓慢。因此本项目 `.nvmrc` 固定为本机原生 arm64 Node 22.14.0。pnpm 同时保留 arm64/x64 可选构建依赖；Node 21 已通过构建，但开发和测试统一使用 Node 22。今后升级 runtime 时需同时验证 build/test。

## 站点迁入

迁入 Tenggouwa-site 后，依赖与主站统一为 React 19、React Router 7、TypeScript 5.9；课程独立构建到 `/learn/`，仍使用 HashRouter 与单文件输出。上方记录的是原教材脚手架来源。运行和维护以 `apps/learn/README.md` 为准，不依赖原机器的教材目录或 Node 21。

## 设计

使用 ui-ux-pro-max 的教育产品交互与可访问性建议，采用成人技术教材的留白、灰白纸面、深绿主色、低饱和阶段标记和系统中文字体。不使用外部字体或 CDN。首页呈现路径与阶段成果；阅读页集中显示正文；原理实验明确标注假设。移动端抽屉导航，375/768/1024/1440px 检查溢出。

## 文件结构

- `src/data/course.ts`：6 阶段、18 课的元数据、练习、验收、自测、资料、术语。
- `src/content/chapters/*.md`：18 篇教材正文；`pnpm textbook` 生成 `src/data/chapters.generated.ts`。dev/build 启动前自动生成；开发时修改正文后再运行生成命令，页面会热更新。lint 检查生成文件未过期。
- `src/components/Lab.tsx`：6 个交互实验。
- `src/lib/math.ts`：独立、可测试的计算模型。
- `src/lib/progress.ts`：备份校验、非破坏合并、完成标准。
- `src/pages/home/index.tsx`：学习路径、课程阅读、实验室、笔记和资料页。
- `labs/`：可下载的 Python 实验与 Markdown 毕业报告模板；构建时同时内嵌为文本，保证离线下载。
- `tests/`：浏览器交互、响应式、离线、进度/数值语义和 Python 实验测试。

## 增加一课

在 `course.ts` 添加唯一 id、stage、练习、验收、自测与资料，并在 `src/content/chapters/` 添加对应正文；更新 `scripts/build-textbook.mjs` 的课程数量检查并重新生成；现有 18 课是 v1 固定课程，增加数量时需同步首页数量、进度分母、阶段布局与测试。课程 id 是持久化记录的主键，避免重命名；修改验收条目顺序时，应增加数据迁移或版本号，不要静默改变旧勾选含义。

## 状态与隐私

`localStorage['inference-lab-progress-v1']` 保存笔记、读完状态、自测历史通过状态、自评验收与最近课程。用户可随时取消验收勾选；自测通过记录保留用于复习。完成定义为阅读确认、自测通过和全部自评验收，不自动验证外部实验。

JSON 导入限制大小并按已知课程校验字段，未知课程不落入状态；合并保留两份笔记及已有完成标记。导出/下载不发送网络请求。页面用 React 文本节点显示用户笔记，不执行 HTML。

同一 origin 的多页面使用 storage 事件同步；写入前按字段将当前修改合并到最新存储快照，避免不同课程互相覆盖。笔记冲突保留两份文本，主动取消勾选仍然生效。写入失败时保留内存版本，恢复写入后一起保存。旧版本倒序勾选产生的 null 验收项会恢复为 false，不丢弃已有笔记。

历史数据损坏时保留原 localStorage，不自动覆盖；本次变更只留内存并显示警告，可导出备份后再手动清理/恢复。正常存储写失败同样显示警告。不同源、浏览器或本地文件位置的存储不能假定共享，应使用备份迁移。

## 离线方式

HashRouter 允许 `file://` 和任意子目录；vite-plugin-singlefile 将 JS/CSS 内嵌进 `dist/index.html`。所有课程、下载文件和 SVG 图标均本地可用，只有主动打开原始资料链接需要联网。不使用 service worker，避免本地课程更新被旧缓存覆盖。

## 内容边界

这是第一版完整学习路径与教材。前期 CPU 实验可以运行；进阶步骤需要读者在固定版本的引擎 checkout 与 NVIDIA 实验机上完成。页面没有远程执行或自动评分服务，不将点击进度当作掌握证明。KV 计算器仅标准 MHA/GQA；Roofline 和调度为教学模型；MTP 期望模型假定固定条件接受概率和每轮额外 token。每个实验内均显示适用范围。
