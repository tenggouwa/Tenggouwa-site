"""agent 编排：多轮 tool-calling 循环 + 会话记忆 + 极简 compaction。

流程（见 docs/agent/agent-v2-design.md）：
- 载入会话历史（summary + 近若干轮）→ 拼成 messages；
- LLM(带 tools) 决定是否调 skill → 执行、把结果回填 → 循环直到不再调工具；
- 再流式生成最终答案；全程 append-only 落库，供多轮 resume。

消息装配铁律（§2 prompt cache）：system + tools 恒定在前、变动在后，保住前缀缓存。
终止 = 模型不再 tool_call（§5），MAX_STEPS / 预算只是兜底防死循环。
"""

import json
import logging
from collections.abc import AsyncIterator

from db.models import AgentMessageRow
from sqlalchemy.ext.asyncio import AsyncSession

from ..kb.provider import chat_llm
from ..skills.permissions import requires_approval
from ..skills.service import skills_service
from ..skills.shell_exec import SHELL_SKILL, stream_exec
from .repository import AgentRepository

logger = logging.getLogger(__name__)

SYSTEM = (
    "你是 tenggouwa 个人站点的 AI 助手，同时也是一个通用智能助手。\n"
    "- 涉及本站内容、作者本人、站内文章或项目时，先用 kb_search 查知识库、依据检索结果作答；用到某条资料就把它的"
    "来源用 kb_search 给出的 markdown 链接（[《标题》](链接)）在正文里回引出来，方便用户点回原文。\n"
    "- 知识库没有相关内容时，不要拒答——改用你自己的通用知识正常回答（必要时说明这不是来自本站资料）。\n"
    "- 需要外部实时信息用 web_fetch；需要用户在若干选项间做选择或澄清关键信息时用 ask_user 抛带选项的问题让其点选"
    "（别用一长串文字罗列问题）；确实需要多步的任务先用 update_plan 列步骤。\n"
    "- 确实不知道再说不知道，不编造。用简体中文、简洁作答。"
)

# 私有模式（TOTP 解锁）追加的「做事」引导：作为**独立第二条 system 消息**追加，让上面的 SYSTEM
# 保持逐字不变——公开/私有共享同一段首块 prompt cache 前缀（§2）。私有会话恒带此块、公开恒不带，各自稳定。
PRIVATE_SYSTEM = (
    "【私有模式·已授权动手】你有一个 Linux 沙箱工作区（隔离、可写、断网），是个能真正干活的 agent，不是只会答话：\n"
    "- 文件：file_list 看目录、file_read 读、file_write 写整份、file_edit 按精确匹配改局部（大文件小改动优先 edit）。\n"
    "- 命令：shell_exec 在沙箱里跑 shell（装依赖、编译、跑脚本、git 等）。\n"
    "- 需要多步就自己拆解、动手做到底再汇报结果，别把该做的事只列成建议丢回给用户。\n"
    "- 写类操作（file_write/edit、shell_exec）有副作用，会走审批或在自动模式下直接执行；失败了看报错自行修正重试。"
)

MAX_STEPS = 16  # 兜底防死循环，非常规上限（对齐 Codex/Claude「没有小硬上限」）
STEP_TOKEN_BUDGET = 40_000  # 本轮工具往返累计 token 预算，超了强制收尾
COMPACT_TOKENS = 24_000  # 载入历史超此阈值触发 compaction（deepseek-chat 64K 上下文，留足输出）
KEEP_TURNS = 3  # compaction 至少保留最近 N 个 user 轮原文（在其之前才摘要）
MAX_TOOL_RESULT_CHARS = 8_000  # 单个 tool 结果上限（对齐 Codex exec_command 截断）；超出尾部替换成提示

PLAN_SKILL = "update_plan"
ASK_SKILL = "ask_user"  # 抛选择题给用户，触发后结束本轮、等用户点选下一轮续上

LEAK_TOKEN = "｜"  # ｜ DeepSeek tool-call 特殊 token 分隔符；正常文本/代码不会出现，用作泄漏起点


def _est_tokens(text: str) -> int:
    """粗估 token：中英文混排按 ~2 char/token（够 compaction 触发判断用，不求精确）。"""
    return len(text) // 2


def _truncate_tool_result(text: str) -> str:
    """截断过大的 tool 结果，防单个工具输出撑爆上下文。web_fetch 已自截，此为所有 skill 的兜底。"""
    if len(text) <= MAX_TOOL_RESULT_CHARS:
        return text
    return text[:MAX_TOOL_RESULT_CHARS] + f"\n…[输出过长，已截断，共 {len(text)} 字]"


_USAGE_KEYS = (
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "prompt_cache_hit_tokens",
    "prompt_cache_miss_tokens",
)


def _accumulate_usage(total: dict, u: dict) -> None:
    """把一次 stream_step 的 usage 累加进 total（一轮可能多次 LLM 调用）。"""
    for k in _USAGE_KEYS:
        if u.get(k) is not None:
            total[k] = total.get(k, 0) + u[k]


def _tc_name(tc: dict) -> str:
    return tc.get("function", {}).get("name", "")


def _tc_args(tc: dict) -> dict:
    try:
        return json.loads(tc.get("function", {}).get("arguments") or "{}")
    except json.JSONDecodeError:
        return {}


def _strip_leak(text: str) -> str:
    """砍掉 DeepSeek 泄漏的 tool-call 文本：首个 ｜ 及之后全丢，并去掉悬空的 '<'。

    统一流式循环里 tools 一直带着、走结构化 tool_calls，正常不会泄漏；此函数作为防御兜底。
    """
    idx = text.find(LEAK_TOKEN)
    if idx == -1:
        return text
    return text[:idx].rstrip("<").rstrip()


class AgentService:
    async def answer_stream(
        self,
        session: AsyncSession,
        q: str,
        *,
        session_id: str | None = None,
        approvals: dict | None = None,
        privileged: bool = False,
        auto_approve: bool = False,
        owner: str | None = None,
    ) -> AsyncIterator[dict]:
        repo = AgentRepository(session)
        existing = await repo.get_session(session_id) if session_id else None
        # owner 隔离：只续自己名下的会话；owner 不匹配（公开想读私有 / 跨 owner / 陈旧 id）→ 当作新会话，绝不泄漏历史。
        if existing is not None and existing.owner != owner:
            existing = None
        sid = existing.id if existing else await repo.create_session(q or "（审批）", owner=owner)
        yield {"type": "session", "session_id": sid}

        usage_total: dict = {}  # 累计本轮 token 用量，收尾发 event: usage

        # 组装初始 messages + seq：C2 审批续跑（消费 pending、按 approvals 执行）vs 正常提问
        resume_asked = False  # 续跑批里若含 ask_user，执行完也要停（等用户点选），别继续生成
        if approvals is not None:
            if existing is None or not existing.pending:
                # 审批续跑但 pending 已消费/过期（重复提交、会话丢失）→ 不伪造空 user 轮，直接收尾
                yield {"type": "done"}
                return
            window = await repo.load_window(sid)
            seq = window.next_seq
            messages = self._seed(window, privileged)  # system + summary + 历史
            pending = existing.pending
            content, tool_calls = pending.get("content", ""), pending.get("tool_calls", [])
            messages.append({"role": "assistant", "content": content, "tool_calls": tool_calls})
            await repo.append(sid, seq, "assistant", content, tool_calls=tool_calls)
            seq += 1
            async for ev in self._execute_batch(
                session, repo, sid, seq, content, tool_calls, messages, approvals, privileged
            ):
                yield ev
            seq += len(tool_calls)
            await repo.set_pending(sid, None)  # 消费完清 pending
            resume_asked = any(_tc_name(tc) == ASK_SKILL for tc in tool_calls)
        else:
            if not q.strip():
                yield {"type": "done"}  # 正常请求但 q 空 → 无可答，直接收尾（不落空 user 轮）
                return
            if existing is not None and existing.pending:
                await repo.set_pending(sid, None)  # 用户改问了别的 → 放弃上次待批
            await self._maybe_compact(repo, sid)
            await repo.touch(sid)  # 顶 updated_at → 「最近会话」列表按最后活跃排序
            window = await repo.load_window(sid)
            seq = window.next_seq
            await repo.append(sid, seq, "user", q)
            seq += 1
            messages = self._seed(window, privileged)
            messages.append({"role": "user", "content": q})

        # 统一流式循环：每轮都带 tools 流式跑——正文实时显示、tool_calls 从结构化 delta 解析执行。
        tools = skills_service.tools(privileged=privileged)
        budget_warned = False  # 预算提示只发一次，别每轮重复 append
        answered = resume_asked  # 本轮是否已产出最终答案（无 tool_calls）/ 以 ask_user 收尾 / 以审批收尾
        for _ in range(MAX_STEPS):
            if answered:  # resume 批已以 ask_user 收尾 → 跳过主循环，也别触发 M2 强制作答
                break
            content, tool_calls = "", []
            leaked = False  # 防御：见到 ｜ 泄漏 token 后，本轮后续 content 全部丢弃
            async for ev in chat_llm.stream_step(messages, tools=tools):
                if ev["type"] == "content":
                    if leaked:
                        continue
                    piece = ev["delta"]
                    if LEAK_TOKEN in piece:  # 单 codepoint、不跨 delta，扫本段即可
                        piece = _strip_leak(piece)
                        leaked = True
                    if piece:
                        content += piece
                        yield {"type": "token", "delta": piece}
                elif ev["type"] == "tool_calls":
                    tool_calls = ev["tool_calls"]
                elif ev["type"] == "usage":
                    _accumulate_usage(usage_total, ev["usage"])

            if not tool_calls:
                # 无工具调用：本轮正文即最终答案（已流式发出），落库收尾
                await repo.append(sid, seq, "assistant", content)
                seq += 1
                answered = True
                break

            # C2 权限闸（仅私有通道、非 auto 模式）：这批含需批准的工具（write 原生 / 非 auto MCP）→ 暂停，
            # 存 pending（不落 assistant 以免孤儿 tool_call），发 approval 事件收尾，等用户批/拒后带 approvals 续跑。
            # auto 模式：用户在沙箱里选了自动执行 → 不暂停、直接跑（沙箱 bwrap 是安全边界）。
            # 公开通道压根不暴露高危工具，审批是私有通道概念；即便模型幻觉出高危名，invoke 也会拒执行。
            gate = privileged and not auto_approve
            need = [tc for tc in tool_calls if requires_approval(_tc_name(tc))] if gate else []
            if need:
                await repo.set_pending(sid, {"content": content, "tool_calls": tool_calls})
                yield {
                    "type": "approval",
                    "requests": [{"id": tc.get("id"), "name": _tc_name(tc), "args": _tc_args(tc)} for tc in need],
                }
                answered = True
                break

            # 全部无需批准 → 落 assistant + 执行这批
            messages.append({"role": "assistant", "content": content, "tool_calls": tool_calls})
            await repo.append(sid, seq, "assistant", content, tool_calls=tool_calls)
            seq += 1
            asked = any(_tc_name(tc) == ASK_SKILL for tc in tool_calls)
            async for ev in self._execute_batch(
                session, repo, sid, seq, content, tool_calls, messages, None, privileged
            ):
                yield ev
            seq += len(tool_calls)

            if asked:  # 抛完选择题即停，等用户点选（此前已把所有 tool_call 配上结果）
                answered = True
                break
            if not budget_warned and sum(_est_tokens(m.get("content") or "") for m in messages) > STEP_TOKEN_BUDGET:
                messages.append({"role": "system", "content": "预算已尽，请基于现有信息直接作答，不要再调用工具。"})
                budget_warned = True

        # M2：MAX_STEPS 耗尽仍在调工具、始终没产出最终答案 —— 强制一次不带 tools 的收尾作答
        if not answered:
            final, leaked = "", False
            async for ev in chat_llm.stream_step(messages, tools=None):
                if ev["type"] == "content" and not leaked:
                    piece = ev["delta"]
                    if LEAK_TOKEN in piece:
                        piece = _strip_leak(piece)
                        leaked = True
                    if piece:
                        final += piece
                        yield {"type": "token", "delta": piece}
                elif ev["type"] == "usage":
                    _accumulate_usage(usage_total, ev["usage"])
            await repo.append(sid, seq, "assistant", final)
            seq += 1

        if usage_total:
            yield {"type": "usage", **usage_total}
        yield {"type": "done"}

    @staticmethod
    def _seed(window, privileged: bool = False) -> list[dict]:
        """初始 messages：system(+私有做事引导) + 早前摘要 + 历史窗口。"""
        messages: list[dict] = [{"role": "system", "content": SYSTEM}]
        if privileged:  # 私有通道追加做事引导（独立第二条，保 SYSTEM 首块缓存前缀不变）
            messages.append({"role": "system", "content": PRIVATE_SYSTEM})
        if window.summary:
            messages.append({"role": "system", "content": f"[早前对话摘要]\n{window.summary}"})
        messages.extend(window.messages)
        return messages

    async def _execute_batch(self, session, repo, sid, start_seq, content, tool_calls, messages, approvals, privileged):
        """执行一批 tool_calls：发 plan/ask/tool 事件、按 approvals 决定执行/拒绝、落库、回填 messages。

        approvals=None：这批全部无需审批（pause 已在上游拦过），全执行。
        approvals=dict：resume 路径，被拒的需批准工具回"用户拒绝"，其余执行。
        privileged：透传给 skills_service.invoke，公开通道拒执行 write/MCP 工具（纵深兜底）。
        每个 tool_call → 恰好一条 tool 结果（保 H1 配对）；seq 由上层按 len(tool_calls) 推进。
        """
        for i, tc in enumerate(tool_calls):
            seq = start_seq + i
            name, args, tid = _tc_name(tc), _tc_args(tc), tc.get("id")
            if name == PLAN_SKILL:
                yield {"type": "plan", "plan": args.get("plan", [])}
            elif name == ASK_SKILL:
                yield {"type": "ask", "intro": content, "questions": args.get("questions", [])}
            else:
                yield {"type": "tool", "name": name, "args": args, "id": tid}
            if approvals is not None and requires_approval(name) and not approvals.get(tid, False):
                result = "（用户拒绝执行此操作。）"
            elif name == SHELL_SKILL and privileged:
                # shell 输出流式：chunk 实时发前端做终端实时输出，final 作工具结果回灌 LLM
                result = "（无输出）"
                try:
                    async for ev in stream_exec(args):
                        if "chunk" in ev:
                            yield {"type": "tool_output", "id": tid, "name": name, "delta": ev["chunk"]}
                        else:
                            result = ev["result"]
                except Exception as e:  # noqa: BLE001 —— skill 失败不该毒化会话
                    logger.exception("shell_exec stream failed")
                    result = f"（shell_exec 执行失败：{e}）"
            else:
                try:
                    result = await skills_service.invoke(session, name, args, privileged=privileged)
                except Exception as e:  # noqa: BLE001 —— skill 失败不该毒化会话
                    logger.exception("skill %s failed", name)
                    result = f"（skill {name} 执行失败：{e}）"
            result = _truncate_tool_result(result)
            messages.append({"role": "tool", "tool_call_id": tid, "content": result})
            await repo.append(sid, seq, "tool", result, tool_call_id=tid)

    async def _maybe_compact(self, repo: AgentRepository, sid: str) -> None:
        """历史超阈值时，把最近 KEEP_TURNS 个 user 轮之前的消息摘要成一条 note（§4）。

        只做 Claude 五层 compaction 的最顶层：不做 budget/snip/microcompact/collapse。
        边界钉在 user 消息上，保证 reload 窗口不以孤儿 tool 消息开头（否则 API 报错）。
        """
        row = await repo.get_session(sid)
        if row is None:
            return
        rows = await repo.rows_after(sid, row.summarized_upto_seq)
        if sum(_est_tokens(r.content) for r in rows) <= COMPACT_TOKENS:
            return
        user_seqs = [r.seq for r in rows if r.role == "user"]
        if len(user_seqs) <= KEEP_TURNS:
            return  # 轮数太少，切了不安全，跳过
        boundary = user_seqs[-KEEP_TURNS]  # 保留从这个 user 轮起的原文
        drop = [r for r in rows if r.seq < boundary]
        if not drop:
            return
        summary = await self._summarize(row.summary, drop)
        await repo.save_summary(sid, summary, boundary - 1)
        logger.info("agent compact %s: 摘要掉 %d 条，边界 seq=%d", sid, len(drop), boundary)

    @staticmethod
    async def _summarize(prev_summary: str | None, rows: list[AgentMessageRow]) -> str:
        transcript = "\n".join(f"{r.role}: {r.content}" for r in rows if r.content)
        head = f"[已有摘要]\n{prev_summary}\n\n" if prev_summary else ""
        prompt = (
            "把以下对话浓缩成不超过 500 字的要点，保留用户关注的实体、结论、待办；"
            f"若已有摘要，合并去重。\n\n{head}[新对话]\n{transcript}"
        )
        msg = await chat_llm.complete([{"role": "user", "content": prompt}], max_tokens=600, temperature=0.2)
        return (msg.get("content") or prev_summary or "").strip()


agent_service = AgentService()
