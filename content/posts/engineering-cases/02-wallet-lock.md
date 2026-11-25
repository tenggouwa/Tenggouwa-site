---
slug: wallet-row-lock-and-history-scan
title: 一条慢查询怎样拖住并发请求：钱包预占的行锁排障
summary: 连接池没有耗尽，请求却在准入阶段超时。沿着客户行锁和历史扫描定位瓶颈，并在十万级数据下将核心查询从约 660ms 优化至 37ms。
tags: [engineering-cases, PostgreSQL, 性能优化, 故障排查]
published_at: 2026-11-25T09:01:00+09:00
---

一次模型服务故障里，请求在真正调用模型之前就失败了。现象像数据库连接不足；排查时的连接快照尚未达到总上限，但它不能证明故障时没有连接压力。继续沿请求路径查，才发现同一客户的钱包预占正在等待行锁，而持锁事务还要汇总大量历史记录。

我参与推动这次定位、查询优化和后续准入链路修复。在隔离环境的十万级历史数据下，核心查询从约 660ms 降至 37ms，金额结果一致。这个数字有用，但更值得解释的是：为什么几百毫秒会被放大成客户可见的超时。

> 本文已去除组织、客户、表名、地址和原始 SQL。图中时间线是机制示意，不是生产请求回放；代码为教学伪代码。查询数字来自历史隔离验证，不代表当前线上接口延迟。

## 1. 先确定时间花在请求的哪一段

在多模型平台中，请求通常经过鉴权、额度预占、并发准入、路由、上游连接和生成。客户只看到“请求失败”，但每一段都有不同的修复方法。

最初我需要区分三种假设：

| 假设 | 支持它需要什么证据 | 不能凭什么下结论 |
| --- | --- | --- |
| 连接池耗尽 | 获取连接的等待、池状态和数据库连接观测 | 看到数据库相关异常 |
| 数据库锁竞争 | 等待事件、阻塞关系与持锁事务 SQL | 看到一条慢 SQL |
| 上游模型慢 | 已进入供应商调用及对应时间证据 | 客户总耗时很长 |

排查快照中的连接数未满，不能反推故障时刻的精确水位，也不能排除应用局部连接池等待。后续更直接的证据指向同一客户行锁，以及锁内的历史汇总查询。这才让优化方向收敛。

## 2. 资金正确性为什么需要串行检查

如果两个并发请求都读取到足够余额，然后分别预占，就可能共同透支。一个直观办法是锁住客户的钱包记录，在事务中核验余额并创建预占。

```python
# 教学伪代码：具体隔离级别、金额口径与幂等规则需单独设计
with transaction():
    wallet = lock_wallet(account)
    available = calculate_available_amount(account)
    ensure_enough(available, reservation_amount)
    create_reservation_once(request_key, reservation_amount)
# 提交以后再进行模型网络调用
```

问题出在 `calculate_available_amount`。若它每次都要扫描历史预占、结算和调整记录，事务会随着历史增长而变长。同一客户的新请求共享这把锁，于是一个查询的耗时会变成一串请求的等待。

![同一客户的请求如何在行锁后排队](https://tenggouwa.com/images/engineering-cases/wallet-lock-timeline.svg)

在只考虑相同串行临界区、忽略其他因素的理想模型里，临界区为 T，连续 N 个请求到来，最后一个可能等待接近 `(N - 1) × T`。这不是现场吞吐预测，却能解释为什么单次几百毫秒在突发并发下很危险。

## 3. 真正的慢点：聚合 FILTER 中的相关子查询

从行锁继续向下定位，关键要看锁内究竟执行了什么。历史版本需要从未结算的预占里排除已经有零结算决定的请求。原 SQL 的关键形态如下，表名与业务状态均已改写：

```sql
-- 旧逻辑的脱敏等价片段
SELECT
    coalesce(sum(h.actual), 0) AS spent,
    coalesce(sum(h.reserved) FILTER (
        WHERE h.actual IS NULL
          AND h.outcome <> 'awaiting_confirmation'
          AND NOT EXISTS (
              SELECT 1 FROM zero_decision z
              WHERE z.call_id = h.id
          )
    ), 0) AS held
FROM budget_hold h
WHERE h.account_ref = :account_ref
  AND h.wallet_enabled;
```

它的业务意思没有错，但在那次执行计划里，`NOT EXISTS` 保留成了相关 `SubPlan`。外层符合条件的记录越多，内层检查执行得越多。这不是“所有 NOT EXISTS 都慢”的结论，问题是这一个查询形态在当时的数据和计划下产生了重复工作。

生产只读诊断使用普通 `EXPLAIN`，没有在资金热路径上执行 `ANALYZE`。实际运行耗时来自隔离数据库，二者不能混称。

隔离结果去掉关系名和账号后，保留下列机制证据：

```text
约 16 万条历史档位，旧计划摘要
Aggregate
  outer scan: actual rows ≈ 128000
  correlated SubPlan
    actual loops = 64000
    rows removed by filter ≈ 161 / loop
Execution Time ≈ 659.848 ms
Shared Hit Blocks = 194619
```

`actual loops = 64000` 是比“看起来在扫历史”更直接的证据。这里的 shared hit 是 buffer 访问计数，不是磁盘读取次数，也不是去重后的物理页数。这个样本不能用来宣称磁盘 I/O 降低了相同比例。

## 4. 用唯一键关联保留语义，减少重复检查

当时修复将上述存在性判断改为连接，关键片段如下：

```sql
-- 当时修复的脱敏等价片段；其他金额分量省略
SELECT
    coalesce(sum(h.actual), 0) AS spent,
    coalesce(sum(h.reserved) FILTER (
        WHERE h.actual IS NULL
          AND h.outcome <> 'awaiting_confirmation'
          AND z.call_id IS NULL
    ), 0) AS held
FROM budget_hold h
LEFT JOIN zero_decision z ON z.call_id = h.id
WHERE h.account_ref = :account_ref
  AND h.wallet_enabled;
```

能这样写有一个重要前提：`zero_decision.call_id` 唯一。否则一条预占匹配多条记录，`spent` 和 `held` 都可能因为连接扩行而重复累加。**唯一性约束是金额正确性的条件，不是可有可无的性能附件。**

新计划使用 Hash Join，零结算集合不再为每条候选记录单独扫描。在 16 万档位还出现了并行聚合，新的 shared hit 总数约为 2869。这里观察到的总耗时改善同时包含关联方式和实际计划选择的效果，不能把它说成单一算子的独立因果实验。

| 隔离档位 | 旧查询 | 新查询 | 主要计划差别 |
| --- | ---: | ---: | --- |
| 约 4 万条历史 | 38.318ms | 11.286ms | 相关检查变为集合关联 |
| 约 16 万条历史 | 659.848ms | 36.717ms | 消除相关 SubPlan，集合关联与并行聚合 |

这次修复本身没有新增索引、余额缓存或汇总表，也没有调整连接数与超时。后续活动索引、清理策略和锁内重复查询优化是其他轮次的工作，不能把它们全都塞进这组 660ms → 37ms 的归因里。

当前代码后来又演进过，不能拿今天的实现文件去解释当时的全部实验细节。复盘应对应同一版查询、测试和回执。

## 5. 缩短临界区，不能削弱资金语义

最容易产生“巨大提速”的错误，是把余额检查搬到锁外，或者只缓存一个余额后不处理并发更新。这样测出来会快，但可能不再正确。

我更关心四个不变量：同一请求不会重复预占；并发请求不会超出可用预算；成功或失败都有可追踪的处理结果；重试与清理不会重复释放金额。

因此优化需要同时验证查询结果和并发行为。金额应使用适合资金计算的精确表示；不能为了快而改成浮点近似。涉及历史账务时，还要保留原有边界：本次性能修复并不自动授权回刷历史状态或修改客户余额。

## 6. 保证金额一致，需要专门构造混合状态

只给测试库塞 16 万条“已成功”记录，可能覆盖不到真正决定 `held` 的条件。隔离用例混合了已结算、待确认、未知和预占等状态，也加入其他客户的数据，检查客户隔离与零结算优先级。

可以把金额断言写成以下形式。它表达测试原则，不是生产表结构：

```python
legacy = run_legacy_aggregation(account)
candidate = run_candidate_aggregation(account)
assert legacy.spent == candidate.spent
assert legacy.held == candidate.held
assert legacy.credit == candidate.credit

before = available(account)
ids = reserve_concurrently(account, count=8, workers=4)
committed = read_holds(ids)
assert len(committed) == 8
assert available(account) == before - sum(h.reserved for h in committed)
```

当时 4 个工作线程提交 8 笔预占事务，完整耗时约 0.464 秒，金额精确一致，未突破原有锁等待预算。这是有限规模的并发验证，不是峰值容量压测。

还应检查几个边界：实际金额为零与 `NULL` 不同；未知费用不能直接释放；其他客户的记录不能被聚合；零结算决定不能导致已确认实际消费被错误抵消。

## 7. 先修查询工作量，再考虑增加资源

本轮核心查询通过更高效的关联方式减少历史处理成本。后续继续检查时，还发现并发统计、排空统计和过期租约清理也有历史扫描或争锁风险，于是补充活动记录查询、相关索引和限量清理。

这里有两个不同的集合：所有历史记录，以及此刻仍影响准入的活动记录。在线判断“是否还有并发名额”，通常只需要后者。让这类判断反复遍历已完成历史，相当于让过去的业务量不断进入今天的请求成本。

下面只是活动索引的结构示意，不能直接复制到生产：

```sql
-- 教学示例，表名与状态均为虚构
CREATE INDEX active_hold_lookup
ON budget_hold (account_id, expires_at)
WHERE state = 'active';
```

索引列与过滤条件必须由实际查询决定。需要用执行计划确认扫描范围确实缩小，同时评估索引写入成本，不能只看到“走索引”就宣布问题解决。

## 8. 清理任务也会与前台请求争用

过期租约需要回收，但一次清理太多，或者等待其他事务锁住的记录，也会干扰前台。

对允许稍后再清理的独立记录，可以考虑短事务、限量批次和 `SKIP LOCKED`：本轮跳过争用记录，后续再处理。这种方式适合可重试的维护工作，不适合直接跳过必须处理的资金校验。

```sql
-- 教学示例：独立维护任务，不是扣费逻辑
SELECT id
FROM budget_hold
WHERE state = 'active' AND expires_at < CURRENT_TIMESTAMP
ORDER BY expires_at
FOR UPDATE SKIP LOCKED
LIMIT 100;
```

还需要防止长期跳过造成饥饿，监控最老待清理记录的年龄。降低锁竞争不能以永久漏处理为代价。

## 9. 查询超时必须受请求总预算约束

即使查询已经优化，数据库仍可能发生抖动。准入排队、获取连接、锁等待、SQL 执行和上游调用，需要共享一个总 deadline。

如果每一层都各自拥有完整超时，客户最终等待时间会超过入口承诺。比较稳妥的思路是传递剩余预算，分别记录超时阶段，并确保退出后释放已获取的资源。

错误分类也必须保留：余额不足、容量拒绝、锁等待超时和供应商超时，不应都被折叠成同一种“模型错误”。只有分类正确，运营才知道该扩容、调查询还是联系供应商。

## 10. 现场诊断要保留顺序，避免错误操作扩大故障

以下 SQL 仅用于解释 PostgreSQL 的诊断方法，输出只保留等待类型，不展示客户参数：

```sql
SELECT pid, state, wait_event_type, wait_event,
       pg_blocking_pids(pid) AS blocking_pids,
       clock_timestamp() - xact_start AS transaction_age
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid();
```

先沿阻塞关系定位持锁者，再查它在做什么；不要看到长事务就先终止进程。对余额预占而言，客户端超时、SQL 取消与事务提交可能处于不同阶段。提交结果不明确时，重试之前需要按请求标识查证，不能把“没收到回执”当作“没有写入”。

超时设置也应限于事务。例如 `SET LOCAL lock_timeout` 随提交或回滚恢复，避免连接归还池后把本次限制带给对账、结算等后续操作。若为剩余预算添加 SQLAlchemy 监听器，退出路径必须移除监听器，异常路径也一样。

这些诊断与实现细节，共同解释了为什么本轮选择保留资金锁、改查询工作量，而没有通过放宽一致性或增加等待时间掩盖问题。

## 11. 怎样验证这次优化

![核心查询隔离验证的前后对比](https://tenggouwa.com/images/engineering-cases/wallet-query-results.svg)

历史隔离验证在约 16 万条记录下得到：核心查询约 660ms 降至 37ms，耗时下降约 94%，结果金额一致。这是相同验证环境中的查询对照，不是整个接口的 17.8 倍加速。

相关修复发布后，一次双节点短时采样中，744 条新版本请求没有出现 5xx 或准入错误，准入平均等待低于 0.11ms。它能说明那段观察窗口的恢复情况，不能证明长期峰值、P99 或月度 SLA。

完整验收还应覆盖同客户并发、多个客户相互隔离、超时回收、重复提交、结算与预占并发，以及历史量级增长。性能和金额正确性必须放在同一次评审里。

## 12. 这次排障改变了我的检查方式

之后再遇到“请求越来越慢”，我会主动问：关键路径中是否存在与全部历史量成正比的操作？它是否还在锁内？后台维护是否在争用同一批资源？

数据库能承受某条 SQL，不等于业务能承受它进入串行临界区。这个案例真正解决的，是让在线准入尽量围绕当前状态工作，同时守住原有资金语义。

## 系列阅读

- [从模型 API 到可运营的 MaaS](/posts/maas-platform-from-api-to-business)
- [让客服 Agent 记住已经知道的事](/posts/support-agent-context-quality)
- [推理容量从 104 到 170](/posts/inference-warm-capacity-104-to-170)
