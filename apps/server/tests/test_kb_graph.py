"""概念图谱抽取：归一化 + 清洗（脏边比没边更坏，这里是把关的地方）。"""

import json

import modules.kb.graph as g


def test_norm_key_merges_variants():
    # 图谱能织成网全靠这个合并：同一概念在不同文章里必须落到同一个 key
    assert g.norm_key("Transformer") == g.norm_key(" transformer ") == g.norm_key("TRANSFORMER")
    assert g.norm_key("word 2 vec") == "word2vec"
    assert g.norm_key("cgroup。") == "cgroup"
    assert g.norm_key("   ") == ""


def _payload(entities, relations):
    return {"entities": entities, "relations": relations}


def test_parse_keeps_good_graph():
    ents, rels = g._parse(
        _payload(
            [
                {"name": "Transformer", "type": "技术", "description": "并行处理序列的架构"},
                {"name": "Attention", "type": "概念", "description": "注意力机制"},
            ],
            [{"source": "Transformer", "target": "Attention", "type": "基于", "description": "靠自注意力"}],
        )
    )
    assert [e["norm_key"] for e in ents] == ["transformer", "attention"]
    assert rels == [{"source": "transformer", "target": "attention", "type": "基于", "description": "靠自注意力"}]


def test_parse_drops_dangling_and_selfloop():
    # 模型编了个没抽的端点 / 自环 → 丢掉，别把脏边写进库
    _ents, rels = g._parse(
        _payload(
            [{"name": "Transformer", "type": "技术", "description": "x"}],
            [
                {"source": "Transformer", "target": "不存在的东西", "type": "基于", "description": "d"},
                {"source": "Transformer", "target": "Transformer", "type": "基于", "description": "自环"},
                {"source": "Transformer", "target": "Transformer", "type": "", "description": "空类型"},
            ],
        )
    )
    assert rels == []


def test_parse_dedups_and_caps():
    ents, rels = g._parse(
        _payload(
            [{"name": f"E{i}", "type": "概念", "description": "d"} for i in range(30)],
            [{"source": "E0", "target": "E1", "type": "用于", "description": "d"}] * 5,
        )
    )
    assert len(ents) == g.MAX_ENTITIES  # 限量控噪音
    assert len(rels) == 1  # 同一三元组去重


def test_parse_unknown_type_falls_back():
    ents, _ = g._parse(_payload([{"name": "X", "type": "外星类型", "description": "d"}], []))
    assert ents[0]["type"] == "概念"


async def test_extract_uses_tool_call(monkeypatch):
    captured = {}

    async def fake_complete(messages, **kw):
        captured["tool_choice"] = kw.get("tool_choice")
        captured["prompt"] = messages[-1]["content"]
        args = json.dumps(
            {
                "entities": [{"name": "cgroup", "type": "技术", "description": "资源隔离"}],
                "relations": [],
            }
        )
        return {"content": "", "tool_calls": [{"function": {"name": "emit_graph", "arguments": args}}]}

    monkeypatch.setattr(g.chat_llm, "api_key", "test-key")
    monkeypatch.setattr(g.chat_llm, "complete", fake_complete)
    ents, _rels = await g.extract("容器是什么", "正文" * 10)
    assert ents[0]["norm_key"] == "cgroup"
    assert captured["tool_choice"]["function"]["name"] == "emit_graph"  # 强制结构化输出
    assert "容器是什么" in captured["prompt"]


async def test_extract_falls_back_to_json_content(monkeypatch):
    # 模型没走 tool_call 时，从正文抠 JSON（带 ``` 围栏也能吃）
    async def fake_complete(_messages, **_kw):
        body = json.dumps({"entities": [{"name": "POSIX", "type": "标准", "description": "d"}], "relations": []})
        return {"content": f"```json{body}```", "tool_calls": []}

    monkeypatch.setattr(g.chat_llm, "api_key", "test-key")
    monkeypatch.setattr(g.chat_llm, "complete", fake_complete)
    ents, _ = await g.extract("t", "b")
    assert ents[0]["norm_key"] == "posix"


async def test_extract_returns_empty_when_unparsable(monkeypatch):
    async def fake_complete(_messages, **_kw):
        return {"content": "我不知道该抽什么", "tool_calls": []}

    monkeypatch.setattr(g.chat_llm, "api_key", "test-key")
    monkeypatch.setattr(g.chat_llm, "complete", fake_complete)
    assert await g.extract("t", "b") == ([], [])  # 不抛，让上层跳过这篇


async def test_extract_noop_without_key(monkeypatch):
    monkeypatch.setattr(g.chat_llm, "api_key", "")
    assert await g.extract("t", "b") == ([], [])


async def test_preview_separates_model_silence_from_parse_drops(monkeypatch):
    """preview 的意义：分清「模型没吐」和「吐了但被清洗丢光」——两种失败修法相反。"""

    async def fake_complete(_messages, **_kw):
        # 模型吐了 2 个实体 + 1 条悬空关系（端点不在实体里）→ 关系该被 _parse 丢掉
        args = json.dumps(
            {
                "entities": [
                    {"name": "Scaling Laws", "type": "概念", "description": "d"},
                    {"name": "涌现", "type": "概念", "description": "d"},
                ],
                "relations": [{"source": "Scaling Laws", "target": "查无此物", "type": "导致", "description": "d"}],
            }
        )
        return {"content": "", "tool_calls": [{"function": {"arguments": args}}]}

    monkeypatch.setattr(g.chat_llm, "api_key", "test-key")
    monkeypatch.setattr(g.chat_llm, "complete", fake_complete)
    out = await g.preview("t", "b")
    assert out["raw_entities"] == 2 and len(out["entities"]) == 2
    assert out["raw_relations"] == 1 and out["dropped_relations"] == 1  # 吐了但被丢 → 一眼看出


async def test_preview_exposes_truncated_tool_call(monkeypatch):
    """被 max_tokens 截断的指纹：有 tool_call、但 arguments 是半截 JSON。这跟「模型没吐」修法完全不同。"""

    async def fake_complete(_messages, **_kw):
        half = '{"entities": [{"name": "Scaling Laws", "type": "概念", "desc'  # 截断
        return {"content": "", "tool_calls": [{"function": {"arguments": half}}]}

    monkeypatch.setattr(g.chat_llm, "api_key", "test-key")
    monkeypatch.setattr(g.chat_llm, "complete", fake_complete)
    out = await g.preview("t", "b")
    assert out["raw"] is None  # 解析不出来
    assert out["diag"]["tool_calls"] == 1  # 但模型确实吐了 → 不是「沉默」
    assert "args_error" in out["diag"] and out["diag"]["args_tail"].endswith("desc")  # 半截 JSON


async def test_preview_reports_model_silence(monkeypatch):
    async def fake_complete(_messages, **_kw):
        return {"content": "抽不出来", "tool_calls": []}

    monkeypatch.setattr(g.chat_llm, "api_key", "test-key")
    monkeypatch.setattr(g.chat_llm, "complete", fake_complete)
    out = await g.preview("t", "b")
    assert out["raw"] is None and "没返回" in out["note"]
