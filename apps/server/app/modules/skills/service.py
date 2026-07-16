"""Skills 编排：列出 skill、给 agent 循环提供 tool schema 与 handler 调度。

原生 skill（registry）在前、顺序固定；MCP server 工具追加在后、已确定性排序——
合起来的 tools 前缀稳定（prompt cache）。MCP 未配置时 mcp_manager 为空，行为完全不变。
"""

from sqlalchemy.ext.asyncio import AsyncSession

from ..mcp.manager import mcp_manager
from .base import tool_schema
from .registry import REGISTRY
from .schema import SkillInfo

LOAD_TOOLS = "load_tools"  # 元工具：把 MCP 工具的完整 schema 按需拉进本轮 tools


def _load_tools_schema(catalog: list[dict]) -> dict:
    """按当前 MCP 目录动态生成 load_tools 的 schema。

    目录（名字 + 一句话）写进 description、名字塞进 enum——**模型看得见有什么、但看不见完整 schema**，
    这就是渐进披露：常驻的是目录，完整 schema 用到才拉。
    实测（mcp-server-time，2 个工具）：完整 schema 均摊 276 tok/个，目录项 ~97 tok/个 → **约 2.8 倍**。
    量级不大但随工具数线性放大：真接到 40 个工具就是常驻 ~11k vs ~3.9k token。
    enum 同时把「编个不存在的工具名」挡在门外。
    """
    listing = "\n".join(f"- {c['name']}：{c['description']}" for c in catalog)
    return {
        "type": "function",
        "function": {
            "name": LOAD_TOOLS,
            "description": (
                "加载外部（MCP）工具的完整定义，加载后本轮就能直接调用它们。\n"
                "下面这些工具**当前不可直接调用**，需要先用本工具加载：\n"
                f"{listing}\n"
                "只加载你确实要用的；加载后直接调用即可，不必再次加载。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "names": {
                        "type": "array",
                        "items": {"type": "string", "enum": [c["name"] for c in catalog]},
                        "description": "要加载的工具名（取自上面的清单）",
                    }
                },
                "required": ["names"],
            },
        },
    }


class SkillsService:
    def list_skills(self) -> list[SkillInfo]:
        """公开列出可用 skill：只列非 private 的（private 工具仅私有通道可见，别在公开页泄漏）。"""
        return [
            SkillInfo(name=s.name, description=s.description, parameters=s.parameters)
            for s in REGISTRY.values()
            if not s.private
        ]

    def tools(self, *, privileged: bool = False, loaded: set[str] | None = None) -> list[dict]:
        """function-calling 的 tools 列表（agent 传给 LLM）。

        公开通道（privileged=False）只暴露既 readonly 又非 private 的原生 skill；私有（鉴权）
        通道额外给 write / private 原生 skill + MCP 工具。这是唯一的能力暴露点——LLM 只能调用
        列表里的工具，所以公开端点天然拿不到高危 / 私有工具（invoke 再做一层纵深兜底）。

        **MCP 工具走渐进披露**（loaded=本轮已加载的名字）：默认只给一个 load_tools 元工具（它的
        description 带「名字 + 一句话」的轻目录），完整 schema 要模型 load_tools 之后才进来。
        为什么只对 MCP 这么做：原生 skill 就 13 个、全在缓存前缀里、真实成本≈0，拆开只会让发现更难；
        MCP 是别人写的、数量不可控、schema 可能很啰嗦，那才是渐进披露该管的地方。
        原生工具永远常驻 → **核心前缀不被打断**，只有真用到 MCP 的那一轮才破缓存。
        """
        native = [tool_schema(s) for s in REGISTRY.values() if privileged or (s.risk == "readonly" and not s.private)]
        if not privileged:
            return native
        catalog = mcp_manager.catalog()
        if not catalog:
            return native  # 没配 MCP → 完全 inert，连 load_tools 都不出现
        return native + [_load_tools_schema(catalog)] + mcp_manager.tools_by_names(sorted(loaded or set()))

    async def invoke(self, session: AsyncSession, name: str, args: dict, *, privileged: bool = False) -> str:
        """执行一个 skill / MCP 工具；未知 / 越权返回错误字符串（不抛，交给 agent 续答）。

        纵深防御：即便模型幻觉出一个公开通道不该有的高危工具名，这里也拒绝执行。
        """
        if mcp_manager.has(name):
            if not privileged:
                return f"（{name} 是外部 MCP 工具，仅在鉴权的私有通道可用，公开通道不执行。）"
            return await mcp_manager.invoke(name, args)
        skill = REGISTRY.get(name)
        if skill is None:
            return f"（未知 skill: {name}）"
        if not privileged and (skill.risk == "write" or skill.private):
            return f"（{name} 仅在鉴权的私有通道可用，公开通道不执行。）"
        return await skill.handler(session, args)


skills_service = SkillsService()
