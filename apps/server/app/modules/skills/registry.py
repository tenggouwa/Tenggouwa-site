"""Skill 注册表。加新 skill 在这里登记一个即可。

注意：REGISTRY 的遍历顺序 = 传给 LLM 的 tools 顺序 = prompt cache 前缀的一部分。
不要随机化 / 动态重排（见 docs/agent/agent-v2-design.md §2，Codex 踩过 MCP list_changed 排序坑）。
"""

from .ask_user import ASK_USER
from .base import Skill
from .file_ops import FILE_EDIT, FILE_LIST, FILE_READ, FILE_WRITE
from .kb_search import KB_SEARCH
from .shell_exec import SHELL_EXEC
from .update_plan import UPDATE_PLAN
from .web_fetch import WEB_FETCH
from .web_search import WEB_SEARCH

# 顺序 = tools 顺序 = prompt cache 前缀，新 skill 一律追加到末尾（勿插中间/重排）。
REGISTRY: dict[str, Skill] = {
    KB_SEARCH.name: KB_SEARCH,
    UPDATE_PLAN.name: UPDATE_PLAN,
    WEB_FETCH.name: WEB_FETCH,
    ASK_USER.name: ASK_USER,
    # D1 文件工具（private=True，只在私有通道；file_write 另 risk=write 走 C2 审批）
    FILE_LIST.name: FILE_LIST,
    FILE_READ.name: FILE_READ,
    FILE_WRITE.name: FILE_WRITE,
    # D2 shell（private + write，走 Pi 沙箱；未配 AGENT_PI_SANDBOX 时拒用）
    SHELL_EXEC.name: SHELL_EXEC,
    # file_edit（private + write，精确 find/replace 编辑，走同一 Pi 沙箱）
    FILE_EDIT.name: FILE_EDIT,
    # web_search（readonly + 公开，DDG 找 URL，配 web_fetch 用）
    WEB_SEARCH.name: WEB_SEARCH,
}
