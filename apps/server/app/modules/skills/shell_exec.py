"""shell_exec skill（D2）：在 owner 私有沙箱（树莓派）内跑一条非交互 shell 命令。

命令经 pi_exec 入队 → Pi 长轮询取走、bwrap 里执行、回传结果（见 docs/agent/agent-d2-sandbox-design.md）。
- risk="write" → 自动经 C1 分级 + C2 审批（每条命令你手批）。
- private=True → 只在 TOTP 私有通道暴露，公开端点/技能页不泄漏。
- 未配 env AGENT_PI_SANDBOX → 整组拒用（off-by-default，同 file 工具的 AGENT_WORKSPACE）。
"""

import os
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from ..pi.exec import SandboxBusy, pi_exec
from .base import Skill

_TIMEOUT = 30.0  # Pi 侧执行超时（秒）；服务器等待多留网络往返
SHELL_SKILL = "shell_exec"


def _enabled() -> bool:
    return os.environ.get("AGENT_PI_SANDBOX", "").strip().lower() in ("1", "true", "yes")


def _fmt(r: dict) -> str:
    flags = ("・超时" if r.get("timed_out") else "") + ("・已截断" if r.get("truncated") else "")
    return f"[rc={r.get('rc')}{flags}]\n" + (r.get("output") or "（无输出）")


async def _handler(_session: AsyncSession, args: dict) -> str:
    if not _enabled():
        return "（未启用 Pi 沙箱（设 AGENT_PI_SANDBOX=1 开启），shell_exec 不可用。）"
    cmd = str(args.get("cmd", "")).strip()
    if not cmd:
        return "（空命令。）"
    try:
        r = await pi_exec.submit(cmd, cwd="workspace", timeout=_TIMEOUT)
    except TimeoutError:
        return "（Pi 沙箱无响应——daemon 在线吗？命令可能超时。）"
    except SandboxBusy:
        return "（沙箱积压已满，稍后再试。）"
    return _fmt(r)


async def stream_exec(args: dict) -> AsyncIterator[dict]:
    """流式执行：yield {"chunk": str} 边跑边出，最后恰好一个 {"result": str}（喂回 LLM 的工具结果）。

    agent 循环对 shell_exec 特判走这条：chunk 实时发到前端做「终端实时输出」，result 落库回灌 LLM。
    """
    if not _enabled():
        yield {"result": "（未启用 Pi 沙箱（设 AGENT_PI_SANDBOX=1 开启），shell_exec 不可用。）"}
        return
    cmd = str(args.get("cmd", "")).strip()
    if not cmd:
        yield {"result": "（空命令。）"}
        return
    try:
        async for ev in pi_exec.submit_stream(cmd, cwd="workspace", timeout=_TIMEOUT):
            if "chunk" in ev:
                yield {"chunk": ev["chunk"]}
            else:
                yield {"result": _fmt(ev["result"])}
                return
    except TimeoutError:
        yield {"result": "（Pi 沙箱无响应——daemon 在线吗？命令可能超时。）"}
    except SandboxBusy:
        yield {"result": "（沙箱积压已满，稍后再试。）"}


SHELL_EXEC = Skill(
    name="shell_exec",
    description=(
        "在 owner 私有沙箱（树莓派，bwrap 隔离、默认无网）内跑一条非交互 shell 命令，"
        "返回退出码与合并输出。有副作用，需批准。"
    ),
    parameters={
        "type": "object",
        "properties": {"cmd": {"type": "string", "description": "要执行的 shell 命令（一条，非交互）"}},
        "required": ["cmd"],
    },
    handler=_handler,
    risk="write",
    private=True,
)
