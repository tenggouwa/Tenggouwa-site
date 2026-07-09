"""工具权限判定（C1）：哪些工具调用需人工批准。

- 控制流（update_plan / ask_user）、readonly 原生 skill、auto 信任的 MCP server 工具 → 自动放行。
- write 原生 skill、非 auto 的 MCP 工具 → 需批准。
C1 先「拦截不执行」（回一条"需批准"结果）；C2 再把拦截换成交互审批弹窗。
当前 prod 无 write 工具、MCP 未配置 → requires_approval 恒 False、零行为变化。
"""

from ..mcp.manager import mcp_manager
from .registry import REGISTRY

_CONTROL = {"update_plan", "ask_user"}  # 控制流，无外部副作用


def requires_approval(name: str) -> bool:
    # 顺序（先原生后 MCP）与 skills_service.invoke（先 MCP）相反，但不冲突：MCP 工具名恒含 `__`
    # （<server>__<tool>），原生名均无 `__`，两集合不相交。将来若加含 `__` 的原生名需对齐两处。
    if name in _CONTROL:
        return False
    skill = REGISTRY.get(name)
    if skill is not None:
        return skill.risk != "readonly"  # 原生：write 需批准
    if mcp_manager.has(name):
        return not mcp_manager.is_auto(name)  # MCP：非 auto 信任的 server 需批准
    return False  # 未知工具交给上层报错，不在此拦
