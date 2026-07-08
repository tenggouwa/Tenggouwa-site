"""agent 编排：多轮 tool-calling 循环 + 会话记忆 + 极简 compaction。

流程（见 docs/agent-v2-design.md）：
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
from ..skills.service import skills_service
from .repository import AgentRepository

logger = logging.getLogger(__name__)

SYSTEM = (
    "你是 tenggouwa 个人站点的 AI 助手，同时也是一个通用智能助手。\n"
    "- 涉及本站内容、作者本人、站内文章或项目时，先用 kb_search 查知识库，依据检索结果作答，可点明来源。\n"
    "- 知识库没有相关内容时，不要拒答——改用你自己的通用知识正常回答（必要时说明这不是来自本站资料）。\n"
    "- 需要外部实时信息用 web_fetch；需要用户在若干选项间做选择或澄清关键信息时用 ask_user 抛带选项的问题让其点选"
    "（别用一长串文字罗列问题）；确实需要多步的任务先用 update_plan 列步骤。\n"
    "- 确实不知道再说不知道，不编造。用简体中文、简洁作答。"
)

MAX_STEPS = 16  # 兜底防死循环，非常规上限（对齐 Codex/Claude「没有小硬上限」）
STEP_TOKEN_BUDGET = 40_000  # 本轮工具往返累计 token 预算，超了强制收尾
COMPACT_TOKENS = 24_000  # 载入历史超此阈值触发 compaction（deepseek-chat 64K 上下文，留足输出）
KEEP_TURNS = 3  # compaction 至少保留最近 N 个 user 轮原文（在其之前才摘要）

PLAN_SKILL = "update_plan"
ASK_SKILL = "ask_user"  # 抛选择题给用户，触发后结束本轮、等用户点选下一轮续上

LEAK_TOKEN = "｜"  # ｜ DeepSeek tool-call 特殊 token 分隔符；正常文本/代码不会出现，用作泄漏起点
LEAK_HOLD = 2  # 流式发送时保留的尾部字符数，防 "<｜" 跨 delta 被切开漏检


def _est_tokens(text: str) -> int:
    """粗估 token：中英文混排按 ~2 char/token（够 compaction 触发判断用，不求精确）。"""
    return len(text) // 2


def _strip_leak(text: str) -> str:
    """砍掉 DeepSeek 泄漏的 tool-call 文本：首个 ｜ 及之后全丢，并去掉悬空的 '<'。"""
    idx = text.find(LEAK_TOKEN)
    if idx == -1:
        return text
    return text[:idx].rstrip("<").rstrip()


async def _filter_leaked_stream(raw: AsyncIterator[str]) -> AsyncIterator[str]:
    """过滤 DeepSeek 把 tool-call 当文本吐出来的泄漏（<｜｜DSML｜｜tool_calls>...）。

    ｜(U+FF5C) 是其特殊 token 分隔符，正常中英文/代码绝不出现——一见到就把它及之后全丢、停流。
    发送时保留尾部 LEAK_HOLD 字符不发，防 "<｜" 跨 delta 被切开（先漏发 '<' 再才发现 ｜）。
    逐段 yield 干净文本增量；累加即最终干净答案。
    """
    buf = ""
    emitted = 0
    async for delta in raw:
        buf += delta
        if LEAK_TOKEN in buf:
            clean = _strip_leak(buf)
            if len(clean) > emitted:
                yield clean[emitted:]
            return
        safe = len(buf) - LEAK_HOLD
        if safe > emitted:
            yield buf[emitted:safe]
            emitted = safe
    if len(buf) > emitted:
        yield buf[emitted:]


class AgentService:
    async def answer_stream(
        self, session: AsyncSession, q: str, *, session_id: str | None = None
    ) -> AsyncIterator[dict]:
        repo = AgentRepository(session)
        existing = await repo.get_session(session_id) if session_id else None
        sid = existing.id if existing else await repo.create_session(q)
        yield {"type": "session", "session_id": sid}

        await self._maybe_compact(repo, sid)

        window = await repo.load_window(sid)
        seq = window.next_seq
        await repo.append(sid, seq, "user", q)
        seq += 1

        messages: list[dict] = [{"role": "system", "content": SYSTEM}]
        if window.summary:
            messages.append({"role": "system", "content": f"[早前对话摘要]\n{window.summary}"})
        messages.extend(window.messages)
        messages.append({"role": "user", "content": q})

        tools = skills_service.tools()
        asked = False  # 调了 ask_user：本轮以选择题收尾，不再流式作答
        for _ in range(MAX_STEPS):
            msg = await chat_llm.complete(messages, tools=tools)
            tool_calls = msg.get("tool_calls") or []
            if not tool_calls:
                break
            content = msg.get("content") or ""
            messages.append({"role": "assistant", "content": content, "tool_calls": tool_calls})
            await repo.append(sid, seq, "assistant", content, tool_calls=tool_calls)
            seq += 1
            for tc in tool_calls:
                fn = tc.get("function", {})
                name = fn.get("name", "")
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                if name == PLAN_SKILL:
                    yield {"type": "plan", "plan": args.get("plan", [])}
                elif name == ASK_SKILL:
                    yield {"type": "ask", "intro": content, "questions": args.get("questions", [])}
                else:
                    yield {"type": "tool", "name": name, "args": args}
                result = await skills_service.invoke(session, name, args)
                messages.append({"role": "tool", "tool_call_id": tc.get("id"), "content": result})
                await repo.append(sid, seq, "tool", result, tool_call_id=tc.get("id"))
                seq += 1
                if name == ASK_SKILL:
                    asked = True
                    break  # 抛完选择题即停，等用户点选
            if asked:
                break
            if sum(_est_tokens(m.get("content") or "") for m in messages) > STEP_TOKEN_BUDGET:
                messages.append({"role": "system", "content": "预算已尽，请基于现有信息直接作答。"})
                break

        if asked:
            yield {"type": "done"}
            return

        # max_tokens=4096：默认 1024 会截断长代码答案。过滤逻辑见 _filter_leaked_stream。
        parts: list[str] = []
        async for piece in _filter_leaked_stream(chat_llm.stream(messages, max_tokens=4096)):
            parts.append(piece)
            yield {"type": "token", "delta": piece}
        await repo.append(sid, seq, "assistant", "".join(parts))
        yield {"type": "done"}

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
