"""agent 长期记忆：store 分支逻辑（假 session，不碰真 DB）+ 权限/注册/owner 门控。

向量 SQL 本身要真 pgvector（CI 无 DB），故这里只测能脱离 DB 的判定分支：去重阈值、召回阈值过滤、
owner 门控、免批但串行、注册。真检索质量部署后在生产验。
"""

from types import SimpleNamespace

import pytest
from modules.memory import store
from modules.memory.store import DEDUP_DISTANCE, RECALL_MAX_DISTANCE, MemoryStore, current_owner


class _Row:
    def __init__(self, seq=(), **attrs):
        self._seq = seq
        self.__dict__.update(attrs)

    def __getitem__(self, i):
        return self._seq[i]


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def first(self):
        return self._rows[0] if self._rows else None

    def all(self):
        return self._rows

    def scalar(self):
        return self._rows[0] if self._rows else 0


class _Session:
    def __init__(self, results):
        self._results = list(results)
        self.added: list = []

    async def execute(self, *_a, **_k):
        return self._results.pop(0)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass


class _Embedder:
    configured = True

    async def embed_one(self, _text):
        return [0.1] * 1024


@pytest.fixture(autouse=True)
def _fake_embedder(monkeypatch):
    monkeypatch.setattr(store, "embedder", _Embedder())


async def test_remember_dedups_near_duplicate():
    """新记忆和最近一条太近（< 去重阈值）→ 更新那条，不新插。"""
    existing = SimpleNamespace(content="旧", embedding=None)
    near = _Row(seq=(existing,), dist=DEDUP_DISTANCE - 0.01)
    sess = _Session([_Result([near])])
    out = await MemoryStore(sess).remember("u", "用户偏好暗色")
    assert sess.added == []  # 没新插
    assert existing.content == "用户偏好暗色"  # 更新了旧条
    assert "更新" in out


async def test_remember_inserts_when_distinct():
    """够远 → 新插一条（随后 count 查询走淘汰检查）。"""
    near = _Row(seq=(SimpleNamespace(content="旧", embedding=None),), dist=0.5)
    sess = _Session([_Result([near]), _Result([1])])  # near 查询 + count(=1) 不触发淘汰
    out = await MemoryStore(sess).remember("u", "全新的事实")
    assert len(sess.added) == 1
    assert "已记住" in out


async def test_recall_filters_by_distance():
    """召回只保留距离 < 阈值的条，太远的当噪声丢掉。"""
    rows = [
        _Row(content="相关", dist=RECALL_MAX_DISTANCE - 0.1),
        _Row(content="不相关", dist=RECALL_MAX_DISTANCE + 0.1),
    ]
    sess = _Session([_Result(rows)])
    mems = await MemoryStore(sess).recall("u", "问题")
    assert mems == ["相关"]


async def test_skill_refuses_without_owner():
    """公开通道无 owner → remember/forget 拒绝（不写别人的记忆）。"""
    from modules.skills.memory_skill import _forget, _remember

    token = current_owner.set(None)
    try:
        assert "私有通道" in await _remember(None, {"content": "x"})
        assert "私有通道" in await _forget(None, {"query": "x"})
    finally:
        current_owner.reset(token)


def test_permissions_memory_auto_but_serial():
    """记忆写：免批（不弹审批）但不 parallel-safe（dedup 读改写要串行）。"""
    from modules.skills.permissions import is_parallel_safe, requires_approval

    for name in ("remember", "forget"):
        assert requires_approval(name) is False  # 免批
        assert is_parallel_safe(name) is False  # 但串行


def test_registered_private_write():
    from modules.skills.registry import REGISTRY

    for name in ("remember", "forget"):
        s = REGISTRY[name]
        assert s.private is True and s.risk == "write"
