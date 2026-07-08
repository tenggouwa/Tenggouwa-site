"""agent 会话持久化：append-only 消息 + 极简 compaction 状态。

见 docs/agent/agent-v2-design.md §3/§4。消息只插不改，load 时按 (session_id, seq) 升序取
summarized_upto_seq 之后的窗口，配合 sessions.summary 重建 LLM messages。
"""

from uuid import uuid4

from db.models import AgentMessageRow, AgentSessionRow
from sqlalchemy import func, select
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

    async def create_session(self, title: str) -> str:
        sid = uuid4().hex
        self.session.add(AgentSessionRow(id=sid, title=title[:200]))
        await self.session.flush()
        return sid

    async def get_session(self, sid: str) -> AgentSessionRow | None:
        return await self.session.get(AgentSessionRow, sid)

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
