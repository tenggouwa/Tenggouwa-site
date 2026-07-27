"""技能自提 propose_skill：owner 门控 / 免批但串行 / 注册 / 空名校验（不碰真 DB）。"""

from modules.agent.proposals import ProposalStore
from modules.memory.store import current_owner


async def test_add_rejects_empty_name():
    # 空名/空用途在写库前就挡下（session 用不到，传 None 也不炸）
    out = await ProposalStore(None).add("u", "", "有用途没名字", {}, "")
    assert "要有名字和用途" in out


async def test_skill_refuses_without_owner():
    from modules.skills.propose_skill import _handler

    token = current_owner.set(None)
    try:
        assert "私有通道" in await _handler(None, {"name": "x", "description": "y"})
    finally:
        current_owner.reset(token)


def test_permissions_propose_auto_but_serial():
    from modules.skills.permissions import is_parallel_safe, requires_approval

    assert requires_approval("propose_skill") is False  # 免批（写自己的提案、无外部副作用）
    assert is_parallel_safe("propose_skill") is False  # 但是 write，串行


def test_registered_private_write():
    from modules.skills.registry import REGISTRY

    s = REGISTRY["propose_skill"]
    assert s.private is True and s.risk == "write"
