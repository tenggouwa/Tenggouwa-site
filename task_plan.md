# Task Plan: 全项目文档同步

## Goal
以当前代码、配置和已合并 PR 为事实源，更新项目级与子系统文档，使架构、能力、运行方式、部署方式和 roadmap 与 2026-07-20 的实际状态一致。

## Current Phase
Complete

## Phases

### Phase 1: 文档与代码事实审计
- [ ] 盘点全部 Markdown 文档及其覆盖范围
- [ ] 核对 workspace、应用入口、后端模块、环境变量和部署配置
- [ ] 记录过期、冲突和缺失内容
- **Status:** complete

### Phase 2: 设计文档信息架构
- [ ] 决定各文档的职责与互相链接
- [ ] 确定需要更新、新增或保留为历史记录的文件
- **Status:** complete

### Phase 3: 更新项目级与应用文档
- [ ] 更新 README 与顶层路线图信息
- [ ] 更新 Agent、KB、部署和应用说明
- [ ] 避免改写仍有价值的历史设计记录
- **Status:** complete

### Phase 4: 一致性验证
- [ ] 检查链接、命令、文件路径和配置名
- [ ] 运行 Markdown lint 或等价检查
- [ ] 审阅 git diff，排除代码和用户文件误改
- **Status:** complete

### Phase 5: 交付审阅
- [ ] 汇总修改文件、关键决策和遗留问题
- [ ] 给用户查看 diff，等待是否进入分支/PR 流程
- **Status:** complete

## Key Questions
1. 哪些文档是现状说明，哪些是不可重写的历史设计记录？
2. README 应如何表达已经成为主线的 apps/agent 与 apps/pi-agent？
3. 旧 roadmap 中哪些项目已完成、取消或被后续方案替代？
4. 运行和部署命令是否仍与 package scripts、workflow、compose 一致？

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 代码、配置、迁移与合并历史优先于旧文档 | 防止把过期 roadmap 继续包装成现状 |
| 历史研究/设计文档保留决策时间语境 | 避免用当前实现覆盖当时的推理过程 |
| 所有文档修改先留在工作区 | 遵守仓库先看 diff、用户确认后再建分支/commit 的流程 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| CLAUDE/docs 批量 patch 上下文不匹配，整批未应用 | 2 | 使用实际原文拆分到单文件 patch |
| 最终状态出现并行的后端代码/migration 改动 | 1 | 识别为本任务外改动，不查看、不覆盖、不纳入文档交付 |

## Notes
- `.codex/` 是进入任务前已有的未跟踪目录，不修改、不纳入交付。
- `AGENTS.md` 进入任务前已未跟踪；为避免与 tracked `CLAUDE.md` 的项目事实冲突，仅同步了同一组文档信息。
- `task_plan.md`、`findings.md`、`progress.md` 为本次任务工作记录，不属于正式项目文档。
- 最终交付不包含 `apps/server/app/**/*.py` 和新 Alembic migration；它们由其它并行工作产生。
