# 验证记录 · 2026-09-30

## 二次校验与修复

本轮额外复现并修复 3 个用户流程问题：

1. **验收项倒序勾选**：先勾第二项时，稀疏数组被 JSON 序列化成 `[null,true]`，旧校验器把它判成坏数据。改为完整布尔数组；读取旧数据时把 null 恢复为 false，保留原笔记和其他进度。
2. **多页面笔记覆盖**：每页写入整份旧快照，第二页保存会删除第一页的新记录。改为读取最新快照后按字段合并，并监听同源 storage 事件；有冲突的笔记保留两份文本。新增存储失败恢复、主动取消勾选等检查。
3. **“跳到正文”误跳路由**：普通 `#main` 锚点与 HashRouter 冲突。改为阻止路由变化，显式聚焦并滚动到正文；同时为进度条添加可访问名称。

修复前 3 项回归用例均失败，修复后通过。全量 **22 项测试通过（7.9s）**；TypeScript 类型检查、生产构建通过，单文件 HTML 已重新生成。Python 标准库的 3 组测试再次通过。

另对教学 Attention/KV 实现做了独立 PyTorch 向量化参考校验：3 个 seed × 3 组形状，共 9 组，最大绝对误差 `4.440892098500626e-16`，全部满足 `1e-12` 容差。不是两条路径共用同一函数的自比较。

本轮证据：`work/recheck-before.log`、`work/recheck-order-before.log`（复现失败），`work/recheck-after.log`（针对修复通过），`work/recheck-all.log`（全量 22 项通过），`work/recheck-build.log`。

## 首轮已通过

- Node 22.14.0 arm64 / pnpm 9.15.9：`pnpm lint`（TypeScript 类型检查）exit 0。
- `pnpm build` exit 0：单文件 `dist/index.html` 约 452 KiB（最终文件）；JS/CSS/课程/图标/下载文本均内嵌。
- `pnpm test`：15 passed，12.3s。包括课程数据完整性、公式数值、进度校验/合并/完成规则、18 课渲染、错题与通过反馈、笔记持久化、搜索筛选、六个交互实验、六个文件下载、无效导入、无损合并、损坏存储保护和键盘标签导航。
- 响应式检查：375 / 768 / 1024 / 1440px，首页、阅读、实验、笔记、资料页均无横向页面溢出；375px 导航可展开/关闭。
- 单 HTML 离线测试：新独立浏览器上下文、网络关闭、`file://` 打开，课程跳转、笔记写入与刷新恢复通过，无 pageerror。
- `pnpm test:labs`：3 组 unittest 通过，覆盖多 seed/shape 的 Attention 等价与 causal 边界、调度 token 守恒/延迟权衡、日志字段校验与空/失败/单 token/无效计时边界。
- 实际执行 `attention_reference.py`：16×8，seed=7，max_abs_error=0、causal_error=0，exit 0。
- 实际执行 `scheduler_reference.py`：chunk=128/512/2048；初次等待在内的最大 Decode 间隔分别约 3.96/11.64/42.36 模拟毫秒。均为逻辑时间教学模型，不是 GPU 实测。
- 实际执行 `analyze_benchmark.py --demo`：11 条合成请求，10 成功、1 失败，演示吞吐 200 token/s；仅用于验证计算口径。
- 实际执行 PyTorch CPU profiler：隔离环境 `work/lab-venv`，PyTorch 2.14.0，20 次未插桩 toy 计算平均约 0.393 ms。生成 `work/trace-cpu.json`，23,090 bytes、67 个 trace events，exit 0。这不是完整模型推理速度。
- 截图视觉检查：首页桌面、KV 课程阅读页、手机实验页检查了文字层级、内容布局、slider 和卡片，无遮挡。截图在 `work/`，最终浏览器截图脚本报告 `errors: []`。

## 环境修复

- 移除无意义 CSS data URL import，修复初次构建错误。
- Vite 升为 5.4.21，匹配 singlefile 插件 peer dependency。
- 本机 Node 21.4.0 为 x64，补齐双架构 Rollup/esbuild 可选包后构建通过；浏览器测试从 Rosetta 下的缓慢启动切换到原生 Node 22.14.0，`.nvmrc` 同步固定。
- Playwright 配置为使用已有系统 Chrome，避免依赖未安装的 headless shell revision。
- 实验源文件移至 `labs/`，修复 Vite dev 模式直接 raw-import public 文件的警告。单文件离线下载保持可用。

## 未验证与边界

- 本机无 NVIDIA CUDA：未运行 CUDA profiler 或 Triton kernel；教材下载脚本包含数值校验与 benchmark，但不能宣称已在 GPU 上通过。
- 未修改真实 vLLM/SGLang、未执行多卡 EP/MTP 测试、未进行生产部署。这些是后续学习项目的实践任务。
- 学习进度是用户确认的阅读/自测/实验自评，页面不验证外部 GPU 实验。
- 未承诺跨浏览器/跨 origin 自动同步；通过 JSON 导入导出迁移。

原始构建、浏览器测试和 Python 测试日志在 `work/build.log`、`work/browser-tests.log`、`work/python-tests.log`；CPU profiler 输出在 `work/profile-cpu.log`。`work/` 是可再生成的本地验证材料，不进入交付源码版本。


## 2026-09-30 教材正文扩写复验

- 18 篇 Markdown 正文接入，合计 49,351 字符（含代码与标记），每篇至少 8 小节；保留课程 ID、验收顺序和持久化格式。
- `pnpm lint`、`pnpm build` 成功；单文件离线产物约 478 kB。
- `pnpm test`：25 项通过，包括全部章节标题渲染、章节导航不改变路由、手机表格/代码无页面横向溢出，以及原有进度、备份和离线回归。
- `pnpm test:labs`：4 项通过；新增策略的自检覆盖 240 组有效预算组合，另测非法输入与默认兼容。
- 提取 tensor、attention、patch 正文的全部 Python 代码块，以隔离环境 CPU PyTorch 执行：4 个代码块通过。NumPy 未安装警告不影响这些不依赖 NumPy 的示例。
- 新增 `labs/prefill_budget.py` 随单文件嵌入，可从课程和实验室下载；此脚本为教学策略，不是实际引擎 patch。
- 本机未执行 NVIDIA CUDA/Triton 性能测试，不据此声明 GPU 提速；毕业课 A/B 数字明确为虚构示例。

## 2026-09-30 教学逻辑审校后复验

审校明细见 `CURRICULUM-REVIEW.md`。27 项浏览器/数据测试、4 项 Python 实验测试、lint 和离线构建通过；18 个自测反馈回到各自正文锚点均已验证。课程 ID、验收条目顺序和进度结构保留；既有自测通过记录不会被清除，更新后的题目可随时复习。正文约 50,986 字符。
