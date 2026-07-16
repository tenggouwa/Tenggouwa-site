"""概念图谱抽取：两趟（概念 → 关系）+ JSON 模式 + 清洗（脏边比没边更坏，这里是把关的地方）。"""

import json

import modules.kb.graph as g


def _payload(entities, relations):
    return {"entities": entities, "relations": relations}


def _scripted(*bodies):
    """按顺序返回若干次 complete 的 content；同时记录每次收到的 (system, user, kwargs)。"""
    calls: list[dict] = []

    async def fake_complete(messages, **kw):
        calls.append({"system": messages[0]["content"], "user": messages[-1]["content"], "kw": kw})
        i = min(len(calls) - 1, len(bodies) - 1)
        return {"content": bodies[i], "tool_calls": []}

    return fake_complete, calls


# ---------- 归一化 / 清洗 ----------


def test_norm_key_merges_variants():
    # 图谱能织成网全靠这个合并：同一概念在不同文章里必须落到同一个 key
    assert g.norm_key("Transformer") == g.norm_key(" transformer ") == g.norm_key("TRANSFORMER")
    assert g.norm_key("word 2 vec") == "word2vec"
    assert g.norm_key("cgroup。") == "cgroup"
    assert g.norm_key("   ") == ""


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
    # 模型编了个没抽的端点 / 自环 / 空类型 → 丢掉，别把脏边写进库
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


def test_parse_dedups_before_capping():
    """去重必须在截断之前：先截会把排在后面、却被关系引用的实体切掉，关系跟着一起没。"""
    dup = [{"name": "A", "type": "概念", "description": "d"}] * 20
    tail = [{"name": "Z", "type": "概念", "description": "d"}]
    ents, rels = g._parse(_payload(dup + tail, [{"source": "A", "target": "Z", "type": "用于", "description": "d"}]))
    assert [e["norm_key"] for e in ents] == ["a", "z"]
    assert len(rels) == 1


def test_parse_unknown_type_falls_back():
    ents, _ = g._parse(_payload([{"name": "X", "type": "外星类型", "description": "d"}], []))
    assert ents[0]["type"] == "概念"


def test_loads_merged_tolerates_concatenated_json():
    """容错网：provider 抽风把两份 JSON 拼一起时仍能吃下（tool_call 那条路实测出现过）。"""
    a = '{"entities": [{"name": "A"}], "relations": []}'
    b = '{"entities": [{"name": "B"}], "relations": [{"source": "A", "target": "B"}]}'
    merged = g._loads_merged(a + b)
    assert [e["name"] for e in merged["entities"]] == ["A", "B"]
    assert len(merged["relations"]) == 1
    assert g._loads_merged(a) == json.loads(a)
    assert g._loads_merged('{"entities": [{"name": "半截') is None  # 真截断判失败
    assert g._loads_merged("不是 JSON") is None
    assert g._loads_merged("[1,2]") is None  # 顶层非对象不收


# ---------- 两趟抽取 ----------


async def test_extract_two_passes_json_mode(monkeypatch):
    """核心：第一趟抽概念，第二趟把概念清单喂回去问关系；两趟都走 json 模式。"""
    ents_json = json.dumps(
        {
            "entities": [
                {"name": "Scaling Laws", "type": "概念", "description": "d"},
                {"name": "Chinchilla", "type": "概念", "description": "d"},
            ]
        }
    )
    rels_json = json.dumps(
        {"relations": [{"source": "Chinchilla", "target": "Scaling Laws", "type": "修正", "description": "d"}]}
    )
    fake, calls = _scripted(ents_json, rels_json)
    monkeypatch.setattr(g.chat_llm, "api_key", "test-key")
    monkeypatch.setattr(g.chat_llm, "complete", fake)

    ents, rels = await g.extract("Scaling Laws 与涌现", "正文" * 10)

    assert len(calls) == 2  # 确实跑了两趟
    assert all(c["kw"]["response_format"] == {"type": "json_object"} for c in calls)  # 都走 JSON 模式
    assert all("json" in c["system"].lower() for c in calls)  # DeepSeek JSON 模式要求 prompt 含 json
    assert "已抽出的概念清单" in calls[1]["user"] and "Chinchilla" in calls[1]["user"]  # 清单喂回去了
    assert [e["norm_key"] for e in ents] == ["scalinglaws", "chinchilla"]
    assert rels and rels[0]["type"] == "修正"


async def test_extract_skips_relation_pass_when_no_entities(monkeypatch):
    """第一趟没概念 → 不必再花一次调用问关系。"""
    fake, calls = _scripted(json.dumps({"entities": []}))
    monkeypatch.setattr(g.chat_llm, "api_key", "test-key")
    monkeypatch.setattr(g.chat_llm, "complete", fake)
    assert await g.extract("t", "b") == ([], [])
    assert len(calls) == 1  # 没有第二趟


async def test_extract_drops_relations_outside_entity_list(monkeypatch):
    """第二趟脑补出清单外的端点 → 照样丢（清单已给定，这里是最后一道闸）。"""
    ents_json = json.dumps({"entities": [{"name": "cgroup", "type": "技术", "description": "d"}]})
    rels_json = json.dumps(
        {"relations": [{"source": "cgroup", "target": "凭空捏造的东西", "type": "用于", "description": "d"}]}
    )
    fake, _calls = _scripted(ents_json, rels_json)
    monkeypatch.setattr(g.chat_llm, "api_key", "test-key")
    monkeypatch.setattr(g.chat_llm, "complete", fake)
    ents, rels = await g.extract("t", "b")
    assert len(ents) == 1 and rels == []


async def test_extract_tolerates_code_fence(monkeypatch):
    fake, _ = _scripted(
        f"```json{json.dumps({'entities': [{'name': 'POSIX', 'type': '标准', 'description': 'd'}]})}```", "{}"
    )
    monkeypatch.setattr(g.chat_llm, "api_key", "test-key")
    monkeypatch.setattr(g.chat_llm, "complete", fake)
    ents, _rels = await g.extract("t", "b")
    assert ents[0]["norm_key"] == "posix"


async def test_extract_returns_empty_when_unparsable(monkeypatch):
    fake, _ = _scripted("我不知道该抽什么")
    monkeypatch.setattr(g.chat_llm, "api_key", "test-key")
    monkeypatch.setattr(g.chat_llm, "complete", fake)
    assert await g.extract("t", "b") == ([], [])  # 不抛，让上层跳过这篇


async def test_extract_noop_without_key(monkeypatch):
    monkeypatch.setattr(g.chat_llm, "api_key", "")
    assert await g.extract("t", "b") == ([], [])


async def test_preview_reports_both_passes(monkeypatch):
    ents_json = json.dumps({"entities": [{"name": "cgroup", "type": "技术", "description": "d"}]})
    fake, _ = _scripted(ents_json, json.dumps({"relations": []}))
    monkeypatch.setattr(g.chat_llm, "api_key", "test-key")
    monkeypatch.setattr(g.chat_llm, "complete", fake)
    out = await g.preview("t", "b")
    assert out["counts"] == {"entities": 1, "relations": 0}
    assert "entities" in out["diag"] and "relations" in out["diag"]  # 两趟各自的诊断都在


async def test_preview_exposes_unparsable_tail(monkeypatch):
    """真截断（解不出 JSON）→ diag 里留尾巴，便于判断是截断还是模型没吐。"""
    fake, _ = _scripted('{"entities": [{"name": "半截')
    monkeypatch.setattr(g.chat_llm, "api_key", "test-key")
    monkeypatch.setattr(g.chat_llm, "complete", fake)
    out = await g.preview("t", "b")
    assert out["counts"]["entities"] == 0
    assert out["diag"]["entities"]["tail"].endswith("半截")
