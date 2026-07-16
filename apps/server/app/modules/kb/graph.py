"""概念图谱抽取：把一篇文章 → LLM → (实体, 关系)。

**为什么是概念级而不是文档级**：文档级语义相似度实测织不出网——57 篇的 top-3 近邻里 84% 落在系列内部、
ai 与 linux 之间 0 条边（两种度量都一样），图谱等于把目录重画一遍。只有把粒度降到**概念**、让同一概念
在不同文章间合并成一个节点，才有真正跨文档的边。

抽取纪律（决定成败，别放松）：
- 只要**有专名**的概念/技术/工具/人物/组织/标准；泛词（系统、数据、方法）一律不要——它们会把图连成毛球。
- 名字用**规范短名**（Transformer，不是「Transformer 架构」），否则同一概念裂成好几个节点，合并就失效了。
- 每篇限量，控噪音 + 控成本。
"""

import json
import logging
import re

from .provider import chat_llm

logger = logging.getLogger(__name__)

MAX_INPUT_CHARS = 12_000  # 单篇喂给 LLM 的正文上限（控成本；博客正文基本都在这以内）
# 输出上限：12 实体 + 10 关系带中文描述，2048 会把 tool_call 的 arguments 截断成半截 JSON →
# 解析失败 → 整篇抽不出东西（scaling-laws-and-emergence 就是这么挂的）。留足余量。
MAX_OUTPUT_TOKENS = 4096
MAX_ENTITIES = 12
MAX_RELATIONS = 10
_TYPES = ["概念", "技术", "工具", "人物", "组织", "标准"]

_SYSTEM = (
    "你从技术文章里抽取**概念图谱**，供跨文章检索与可视化用。\n"
    "只抽**有专名**的东西：概念/技术/工具/人物/组织/标准（如 Transformer、cgroup、word2vec、POSIX、"
    "Linus Torvalds）。\n"
    "**绝不要**泛化的普通名词（系统、数据、方法、性能、用户、文件），它们会把图连成一团毛球、毫无信息量。\n"
    "名字必须用**最短的规范名**：写 Transformer 而不是「Transformer 架构」，写 cgroup 而不是「cgroups 机制」——"
    "同一个概念在别的文章里也要能对上号，名字不统一就合并不了。\n"
    "关系的 type 用**短动词短语**（基于/前身/替代/属于/用于/对比/实现/依赖），别写整句。\n"
    "关系两端必须都出现在你抽的实体列表里。只抽文章**真正讲到**的关系，别脑补常识。\n"
    f"最多 {MAX_ENTITIES} 个实体、{MAX_RELATIONS} 条关系；宁缺毋滥。用简体中文写 description（一句话）。"
)

_TOOL = {
    "type": "function",
    "function": {
        "name": "emit_graph",
        "description": "提交从这篇文章抽取的概念与关系",
        "parameters": {
            "type": "object",
            "properties": {
                "entities": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string", "description": "规范短名"},
                            "type": {"type": "string", "enum": _TYPES},
                            "description": {"type": "string", "description": "一句话说明"},
                        },
                        "required": ["name", "type", "description"],
                    },
                },
                "relations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "source": {"type": "string", "description": "起点实体名（须在 entities 里）"},
                            "target": {"type": "string", "description": "终点实体名（须在 entities 里）"},
                            "type": {"type": "string", "description": "短动词短语，如 基于/前身/用于"},
                            "description": {"type": "string", "description": "一句话依据"},
                        },
                        "required": ["source", "target", "type", "description"],
                    },
                },
            },
            "required": ["entities", "relations"],
        },
    },
}


def _loads_merged(s: str) -> dict | None:
    """把字符串里连续的**多个** JSON 对象全解出来并合并成一份 {entities, relations}。

    DeepSeek 偶发把两份 JSON 直接拼在 tool_call 的 arguments 里（`{...}{...}`），json.loads 要求整串
    是单个 JSON → 报 "Extra data" → 整篇白抽。而且实测两份内容**不一样**：第一份可能只有实体、
    关系全在第二份里——所以只取第一份会把关系丢光，必须全解出来合并。
    解不出任何对象（真被 max_tokens 截断）→ None。
    """
    dec = json.JSONDecoder()
    s = s.strip()
    objs: list[dict] = []
    idx = 0
    while idx < len(s):
        try:
            obj, end = dec.raw_decode(s, idx)
        except (json.JSONDecodeError, ValueError):
            break  # 后面是半截/垃圾，前面解出来的照用
        if isinstance(obj, dict):
            objs.append(obj)
        idx = end
        while idx < len(s) and s[idx] in " \t\r\n,":  # 跳过对象之间的分隔
            idx += 1
    if not objs:
        return None
    merged: dict = {"entities": [], "relations": []}
    for o in objs:
        merged["entities"].extend(o.get("entities") or [])
        merged["relations"].extend(o.get("relations") or [])
    return merged


def norm_key(name: str) -> str:
    """归一化实体名 → 合并键。去空白 + 转小写 + 去首尾标点；中文不受 lower 影响但无妨。"""
    k = re.sub(r"\s+", "", str(name)).strip().lower()
    return k.strip("。，,.、;；:：!！?？\"'`（）()《》[]").strip()[:120]


def _parse(payload: dict) -> tuple[list[dict], list[dict]]:
    """把 LLM 返回的原始 dict 清洗成 (entities, relations)：丢掉空名/未知类型/悬空端点/自环。

    先按 norm_key 去重、再截上限（顺序不能反）：合并多份 JSON 后原始列表可能有重复，
    先截会把后面才出现、却被关系引用的实体切掉，关系跟着一起没。
    """
    ents: dict[str, dict] = {}
    for e in payload.get("entities") or []:
        name = str(e.get("name", "")).strip()
        key = norm_key(name)
        if not key:
            continue
        etype = str(e.get("type", "")).strip()
        ents[key] = {
            "norm_key": key,
            "name": name,
            "type": etype if etype in _TYPES else "概念",
            "description": str(e.get("description", "")).strip()[:500],
        }
    ents = dict(list(ents.items())[:MAX_ENTITIES])  # 去重之后再截上限
    rels: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    for r in payload.get("relations") or []:
        if len(rels) >= MAX_RELATIONS:
            break
        s, t = norm_key(r.get("source", "")), norm_key(r.get("target", ""))
        rtype = str(r.get("type", "")).strip()[:32]
        # 悬空端点（模型编了个没抽的实体）/ 自环 / 空类型 一律丢——脏边比没边更坏
        if not s or not t or s == t or s not in ents or t not in ents or not rtype:
            continue
        if (s, t, rtype) in seen:
            continue
        seen.add((s, t, rtype))
        rels.append(
            {"source": s, "target": t, "type": rtype, "description": str(r.get("description", "")).strip()[:500]}
        )
    return list(ents.values()), rels


async def _call(title: str, raw_md: str) -> tuple[dict | None, dict]:
    """调一次 LLM 拿原始 payload（未清洗）+ 诊断信息。拿不到结构化结果时 payload 为 None。

    诊断存在的理由：「模型没吐 tool_call」和「吐了但 arguments 解析不了（=被 max_tokens 截断，
    尾巴是半截 JSON）」症状一样、修法完全相反，光看失败计数分不清。
    """
    body = (raw_md or "")[:MAX_INPUT_CHARS]
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": f"文章标题：{title}\n\n正文：\n{body}"},
    ]
    r = await chat_llm.complete(
        messages,
        tools=[_TOOL],
        tool_choice={"type": "function", "function": {"name": "emit_graph"}},
        max_tokens=MAX_OUTPUT_TOKENS,
    )
    tcs = r.get("tool_calls") or []
    diag: dict = {"tool_calls": len(tcs), "content_head": (r.get("content") or "")[:200]}
    for tc in tcs:
        args = tc.get("function", {}).get("arguments") or ""
        diag["args_len"] = len(args)
        payload = _loads_merged(args)  # 容忍模型把两份 JSON 拼一起
        if payload is not None:
            return payload, diag
        diag["args_tail"] = args[-160:]  # 连第一份都解不出 → 大概率真被 max_tokens 截断了
    text = (r.get("content") or "").strip().removeprefix("```json").removeprefix("```").removesuffix("```")
    payload = _loads_merged(text)  # 兜底：模型没走 tool_call，试着从正文里抠 JSON
    if payload is not None:
        return payload, diag
    logger.warning("概念抽取未拿到结构化结果: %s（diag=%s）", title, diag)
    return None, diag


async def extract(title: str, raw_md: str) -> tuple[list[dict], list[dict]]:
    """抽一篇文章的概念与关系。LLM 不配 / 抽失败 → 返回空，调用方跳过（不该炸整个构建）。"""
    if not chat_llm.api_key:
        return [], []
    payload, _diag = await _call(title, raw_md)
    return _parse(payload or {})


async def preview(title: str, raw_md: str) -> dict:
    """dry-run：同样跑一次抽取，但**只回不写**，并带上诊断。

    调 prompt 时的眼睛：一眼分清「模型压根没吐」「吐了但被 max_tokens 截断」「吐了但被 _parse 丢光」——
    三种失败修法完全不同，靠 documents_failed 计数分不出来。
    """
    if not chat_llm.api_key:
        return {"error": "KB_LLM_API_KEY 未配置"}
    raw, diag = await _call(title, raw_md)
    if raw is None:
        return {"raw": None, "entities": [], "relations": [], "note": "模型没返回可解析的结构化结果", "diag": diag}
    ents, rels = _parse(raw)
    return {
        "raw_entities": len(raw.get("entities") or []),
        "raw_relations": len(raw.get("relations") or []),
        "entities": ents,
        "relations": rels,
        "dropped_entities": len(raw.get("entities") or []) - len(ents),
        "dropped_relations": len(raw.get("relations") or []) - len(rels),
        "diag": diag,
        "raw": raw,
    }
