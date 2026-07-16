"""kb_graph：概念图谱检索的组装 + 回引用（与 kb_search 的块检索互补）。"""

import modules.skills.kb_graph as kg
from modules.kb.service import kb_service


class _FakeRepo:
    def __init__(self, ents, rels, docs):
        self._e, self._r, self._d = ents, rels, docs

    async def search_entities(self, _q, *, limit=4):
        return self._e[:limit]

    async def entity_relations(self, _ids, *, limit=30):
        return self._r

    async def entity_docs(self, _ids, *, limit=30):
        return self._d


def _patch(monkeypatch, ents, rels, docs):
    import modules.kb.service as svc

    monkeypatch.setattr(svc, "KBRepository", lambda _s: _FakeRepo(ents, rels, docs))


async def test_graph_search_assembles_relations_and_citations(monkeypatch):
    _patch(
        monkeypatch,
        ents=[{"id": 1, "name": "Chinchilla", "type": "概念", "description": "算力最优配比", "score": 1.0}],
        rels=[
            {"source": "Chinchilla", "target": "Kaplan 论文", "type": "修正", "description": "重做了实验"},
            {"source": "LLaMA", "target": "Chinchilla", "type": "基于", "description": "遵循其配比"},  # 入边也要
        ],
        docs=[{"entity_id": 1, "title": "Scaling Laws", "url": "/posts/scaling/"}],
    )
    out = await kb_service.graph_search(None, "Chinchilla")
    assert "【Chinchilla】（概念）算力最优配比" in out
    assert "Chinchilla —修正→ Kaplan 论文" in out
    assert "LLaMA —基于→ Chinchilla" in out  # 入边（谁基于我）同样有信息量
    assert "[《Scaling Laws》](/posts/scaling/)" in out  # 回引用给成 markdown 链接


async def test_graph_search_only_shows_own_relations(monkeypatch):
    """多个命中概念时，各自只挂自己的边，别把别人的边算到头上。"""
    _patch(
        monkeypatch,
        ents=[
            {"id": 1, "name": "A", "type": "概念", "description": "da", "score": 1.0},
            {"id": 2, "name": "B", "type": "概念", "description": "db", "score": 0.9},
        ],
        rels=[{"source": "A", "target": "Z", "type": "用于", "description": "dz"}],
        docs=[],
    )
    out = await kb_service.graph_search(None, "q")
    a_block, b_block = out.split("\n\n")
    assert "A —用于→ Z" in a_block
    assert "关系：" not in b_block  # B 没有边，就别硬编


async def test_graph_search_handles_missing_url(monkeypatch):
    _patch(
        monkeypatch,
        ents=[{"id": 1, "name": "X", "type": "概念", "description": "d", "score": 1.0}],
        rels=[],
        docs=[{"entity_id": 1, "title": "无链接文档", "url": None}],
    )
    out = await kb_service.graph_search(None, "X")
    assert "《无链接文档》" in out and "](" not in out  # 没 url 就别造链接


async def test_graph_search_no_match(monkeypatch):
    _patch(monkeypatch, ents=[], rels=[], docs=[])
    assert "没匹配到" in await kb_service.graph_search(None, "查无此物")


async def test_skill_empty_query():
    assert "未提供查询" in await kg._handler(None, {"query": "  "})


def test_registered_public_readonly():
    from modules.skills.registry import REGISTRY

    s = REGISTRY["kb_graph"]
    assert s.risk == "readonly" and not s.private  # 公开可用、无副作用
