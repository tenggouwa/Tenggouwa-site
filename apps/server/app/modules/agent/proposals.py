"""agent 自提技能提案的存储：owner 维度的 增 / 列 / 删。不带向量，简单 CRUD + 上限淘汰。

提案不是运行时代码——只是「该有但没有的工具」的规格草图，交站主评审后**人工**实现。
"""

from db.models import AgentSkillProposalRow
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

MAX_PROPOSALS_PER_OWNER = 50


class ProposalStore:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add(self, owner: str, name: str, description: str, parameters: dict, rationale: str) -> str:
        name = (name or "").strip()[:64]
        description = (description or "").strip()
        if not name or not description:
            return "（技能提案要有名字和用途。）"
        self.session.add(
            AgentSkillProposalRow(
                owner=owner,
                name=name,
                description=description,
                parameters=parameters if isinstance(parameters, dict) else {},
                rationale=(rationale or "").strip(),
            )
        )
        await self.session.flush()
        await self._evict_over_cap(owner)
        return f"（已记下技能提案「{name}」，交站主评审——它不会自动生效，需要人工实现。）"

    async def list_all(self, owner: str) -> list[dict]:
        rows = (
            (
                await self.session.execute(
                    select(AgentSkillProposalRow)
                    .where(AgentSkillProposalRow.owner == owner)
                    .order_by(AgentSkillProposalRow.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        return [
            {
                "id": r.id,
                "name": r.name,
                "description": r.description,
                "parameters": r.parameters,
                "rationale": r.rationale,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ]

    async def delete_by_id(self, owner: str, pid: int) -> bool:
        res = await self.session.execute(
            delete(AgentSkillProposalRow).where(AgentSkillProposalRow.id == pid, AgentSkillProposalRow.owner == owner)
        )
        await self.session.flush()
        return (res.rowcount or 0) > 0

    async def _evict_over_cap(self, owner: str) -> None:
        n = (
            await self.session.execute(
                select(func.count(AgentSkillProposalRow.id)).where(AgentSkillProposalRow.owner == owner)
            )
        ).scalar() or 0
        if n <= MAX_PROPOSALS_PER_OWNER:
            return
        stale = (
            select(AgentSkillProposalRow.id)
            .where(AgentSkillProposalRow.owner == owner)
            .order_by(AgentSkillProposalRow.created_at)
            .limit(n - MAX_PROPOSALS_PER_OWNER)
        )
        await self.session.execute(delete(AgentSkillProposalRow).where(AgentSkillProposalRow.id.in_(stale)))
        await self.session.flush()
