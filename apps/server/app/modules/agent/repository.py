"""agent 会话持久化：append-only 消息 + 极简 compaction 状态。

见 docs/agent/agent-v2-design.md §3/§4。消息只插不改，load 时按 (session_id, seq) 升序取
summarized_upto_seq 之后的窗口，配合 sessions.summary 重建 LLM messages。
"""

import json
from uuid import uuid4

from db.models import AgentMessageRow, AgentSessionRow
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession


class AgentWindow:
    """一个会话当前该喂给 LLM 的上下文窗口。"""

    def __init__(self, summary: str | None, messages: list[dict], next_seq: int, summarized_upto_seq: int) -> None:
        self.summary = summary
        self.messages = messages  # 已按 seq 升序，OpenAI messages 形态
        self.next_seq = next_seq
        self.summarized_upto_seq = summarized_upto_seq


class AgentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_session(self, title: str, *, owner: str | None = None) -> str:
        sid = uuid4().hex
        self.session.add(AgentSessionRow(id=sid, title=title[:200], owner=owner))
        await self.session.flush()
        return sid

    async def get_session(self, sid: str) -> AgentSessionRow | None:
        return await self.session.get(AgentSessionRow, sid)

    async def touch(self, sid: str) -> None:
        """把会话 updated_at 顶到当前时间（新一轮开始时叫，让「最近会话」排序反映最后活跃）。"""
        row = await self.session.get(AgentSessionRow, sid)
        if row is not None:
            row.updated_at = func.now()
            await self.session.flush()

    async def list_sessions(self, owner: str, limit: int = 50) -> list[AgentSessionRow]:
        """按 owner 取会话列表（最近活跃在前）。owner 隔离：只返回该 owner 自己的会话。"""
        rows = (
            await self.session.execute(
                select(AgentSessionRow)
                .where(AgentSessionRow.owner == owner)
                .order_by(AgentSessionRow.updated_at.desc())
                .limit(limit)
            )
        ).scalars()
        return list(rows)

    async def transcript(self, sid: str) -> list[dict]:
        """把 append-only 消息重建成前端可渲染的轮次 [{q, tools:[{name,args}], answer}]。

        user 起一轮；assistant 的正文累进 answer、tool_calls 平铺进 tools；tool 结果不展开（保持轻量）。
        """
        rows = (
            (
                await self.session.execute(
                    select(AgentMessageRow).where(AgentMessageRow.session_id == sid).order_by(AgentMessageRow.seq.asc())
                )
            )
            .scalars()
            .all()
        )
        turns: list[dict] = []
        for r in rows:
            if r.role == "user":
                turns.append({"q": r.content, "tools": [], "answer": ""})
            elif r.role == "assistant" and turns:
                if r.content:
                    turns[-1]["answer"] += r.content
                for tc in r.tool_calls or []:
                    fn = tc.get("function", {}) if isinstance(tc, dict) else {}
                    try:
                        args = json.loads(fn.get("arguments") or "{}")
                    except (ValueError, TypeError):
                        args = {}
                    turns[-1]["tools"].append({"name": fn.get("name", ""), "args": args})
        return turns

    async def delete_session(self, sid: str) -> None:
        """删除会话及其消息（message 表有 ON DELETE CASCADE，删 session 即连带清）。"""
        await self.session.execute(delete(AgentSessionRow).where(AgentSessionRow.id == sid))
        await self.session.flush()

    async def load_window(self, sid: str) -> AgentWindow:
        """取 summarized_upto_seq 之后的消息 + summary，组装成 LLM messages。"""
        row = await self.session.get(AgentSessionRow, sid)
        if row is None:
            return AgentWindow(None, [], 1, 0)
        rows = (
            (
                await self.session.execute(
                    select(AgentMessageRow)
                    .where(AgentMessageRow.session_id == sid, AgentMessageRow.seq > row.summarized_upto_seq)
                    .order_by(AgentMessageRow.seq.asc())
                )
            )
            .scalars()
            .all()
        )
        max_seq = (
            await self.session.execute(select(func.max(AgentMessageRow.seq)).where(AgentMessageRow.session_id == sid))
        ).scalar()
        messages = [self._to_message(r) for r in rows]
        return AgentWindow(row.summary, messages, (max_seq or 0) + 1, row.summarized_upto_seq)

    @staticmethod
    def _to_message(r: AgentMessageRow) -> dict:
        if r.role == "assistant":
            msg: dict = {"role": "assistant", "content": r.content}
            if r.tool_calls:
                msg["tool_calls"] = r.tool_calls
            return msg
        if r.role == "tool":
            return {"role": "tool", "tool_call_id": r.tool_call_id, "content": r.content}
        return {"role": "user", "content": r.content}

    async def append(
        self,
        sid: str,
        seq: int,
        role: str,
        content: str,
        *,
        tool_calls: list | None = None,
        tool_call_id: str | None = None,
    ) -> None:
        self.session.add(
            AgentMessageRow(
                session_id=sid,
                seq=seq,
                role=role,
                content=content or "",
                tool_calls=tool_calls,
                tool_call_id=tool_call_id,
            )
        )
        await self.session.flush()

    async def rows_after(self, sid: str, seq_excl: int) -> list[AgentMessageRow]:
        """取 seq > seq_excl 的消息（升序）。compaction 找 user 轮边界用。"""
        return list(
            (
                await self.session.execute(
                    select(AgentMessageRow)
                    .where(AgentMessageRow.session_id == sid, AgentMessageRow.seq > seq_excl)
                    .order_by(AgentMessageRow.seq.asc())
                )
            )
            .scalars()
            .all()
        )

    async def save_summary(self, sid: str, summary: str, summarized_upto_seq: int) -> None:
        row = await self.session.get(AgentSessionRow, sid)
        if row is not None:
            row.summary = summary
            row.summarized_upto_seq = summarized_upto_seq
            await self.session.flush()

    async def set_pending(self, sid: str, pending: dict | None) -> None:
        """存/清 C2 待批工具（{content, tool_calls}）。None 表示清空。"""
        row = await self.session.get(AgentSessionRow, sid)
        if row is not None:
            row.pending = pending
            await self.session.flush()
