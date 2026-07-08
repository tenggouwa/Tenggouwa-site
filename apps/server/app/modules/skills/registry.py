"""Skill 注册表。加新 skill 在这里登记一个即可。

注意：REGISTRY 的遍历顺序 = 传给 LLM 的 tools 顺序 = prompt cache 前缀的一部分。
不要随机化 / 动态重排（见 docs/agent-v2-design.md §2，Codex 踩过 MCP list_changed 排序坑）。
"""

from .base import Skill
from .kb_search import KB_SEARCH
from .update_plan import UPDATE_PLAN
from .web_fetch import WEB_FETCH

REGISTRY: dict[str, Skill] = {
    KB_SEARCH.name: KB_SEARCH,
    UPDATE_PLAN.name: UPDATE_PLAN,
    WEB_FETCH.name: WEB_FETCH,
}
