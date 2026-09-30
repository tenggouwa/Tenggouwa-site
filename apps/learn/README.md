# Inference Lab · 推理系统学习手册

18 课中文交互教材，6 个阶段，从模型部署调参走到推理引擎定制优化。独立子应用部署于 `/learn/`；GitHub Pages 镜像为 `/Tenggouwa-site/learn/`。主站导航 `learn` 与实验室提供入口，课程侧栏可返回主站。

## 开发与验证

在 monorepo 根目录运行：

```bash
pnpm install --frozen-lockfile
pnpm dev:learn                 # http://127.0.0.1:5178
pnpm --filter @tenggouwa/learn lint
pnpm --filter @tenggouwa/learn test  # 构建、浏览器回归、Python 标准库实验
pnpm build:learn
```

本地浏览器测试使用 Chrome；CI 使用 Playwright Chromium，先运行 `pnpm --filter @tenggouwa/learn exec playwright install --with-deps chromium`。Python 实验需要 Python 3。

正文在 `src/content/chapters/*.md`，修改后运行 `pnpm --filter @tenggouwa/learn textbook`，热更新会加载生成内容。dev/build 也会先生成。元数据、题目与前置关系在 `src/data/course.ts`。以本目录作为站点课程的维护源；原独立学习项目作为迁入时的历史副本，不自动双向同步。

## 课程与实验

按“阅读 → 手算/自测 → 实验 → 记录证据”推进。无 GPU 时先完成阅读和 CPU 实验，GPU/引擎验收保留待完成。浏览器图表是教学模拟，不是硬件 benchmark。

在本目录运行：

```bash
python3 labs/attention_reference.py --tokens 32 --dim 16 --seed 42
python3 labs/scheduler_reference.py --chunk 128 512 2048
python3 labs/analyze_benchmark.py --demo
python3 labs/prefill_budget.py
python3 -m venv work/lab-venv
work/lab-venv/bin/python -m pip install torch
work/lab-venv/bin/python labs/torch_profile.py --device cpu
```

Triton Softmax 需独立 NVIDIA CUDA 环境与兼容的 PyTorch/Triton。真实引擎实验在独立固定 commit 的 checkout 中执行。

## 发布与离线

`pnpm build:cf`、`pnpm build:pages` 会构建并组装课程，合并后的发布工作流包含 `apps/learn/**`。课程用 HashRouter，章节链接如 `/learn/#/lesson/tensor`；无需为每个章节配置服务器路由。构建产物 `dist/index.html` 内嵌正文、实验代码、JS/CSS，可下载后离线使用。

课程保留已验收的阅读样式，主站入口遵守终端视觉。应用不连接后端，不共享网站登录，也不上传笔记。

## 学习进度迁移

localStorage 按浏览器 origin 保存。原 `127.0.0.1:3333`、开发 `5178`、线上站点和离线文件之间不会自动同步。在旧课程“导出备份”，再到新课程“导入”；课程 ID、备份版本及验收顺序保持兼容。导入合并而非清空当前内容，跨设备同样需要备份迁移。
