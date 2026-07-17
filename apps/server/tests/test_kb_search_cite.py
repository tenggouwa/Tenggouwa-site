"""kb_search 回引用：结果里带可直接粘贴的 markdown 来源链接（有 url 才成链接）。"""

import modules.skills.kb_search as ks


async def test_kb_search_emits_markdown_citation(monkeypatch):
    async def fake_retrieve(_session, _q, _sources, **_kw):
        return [
            {"title": "VPS 调优", "url": "/posts/vps/", "content": "正文一"},
            {"title": "无链接文档", "url": None, "content": "正文二"},
        ]

    monkeypatch.setattr(ks.kb_service, "retrieve", fake_retrieve)
    out = await ks._handler(None, {"query": "怎么调 vps"})
    assert "[1] 来源：[《VPS 调优》](/posts/vps/)" in out  # 有 url → markdown 链接
    assert "[2] 来源：《无链接文档》" in out  # 无 url → 纯标题不成链接
    assert "正文一" in out and "正文二" in out


async def test_kb_search_empty(monkeypatch):
    async def fake_retrieve(_session, _q, _sources, **_kw):
        return []

    monkeypatch.setattr(ks.kb_service, "retrieve", fake_retrieve)
    out = await ks._handler(None, {"query": "x"})
    assert "没有相关内容" in out
    assert out.startswith("[无结果]")  # 空结果打标签，模型别当「该重试」反复换措辞搜
