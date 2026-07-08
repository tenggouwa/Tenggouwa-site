"""Skill 注册表。加新 skill 在这里登记一个即可（未来 kb_reindex / web_fetch ...）。"""

from .base import Skill
from .kb_search import KB_SEARCH

REGISTRY: dict[str, Skill] = {
    KB_SEARCH.name: KB_SEARCH,
}
