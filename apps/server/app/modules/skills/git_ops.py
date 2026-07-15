"""git skill：在 owner 私有沙箱工作区里跑 git（status/diff/log/add/commit/branch…）。

和 shell_exec 一样经 Pi 沙箱执行（bwrap 隔离、默认无网），只是把命令限定成 `git <args>`——给模型一个
更聚焦、可发现的 git 接口（shell_exec 也能跑 git，这个是便利层，不是安全边界）。
- 首个 token 须是白名单里的 git 子命令，否则拒（保证这是个 git 工具，不是变相 shell）。
- risk="write"（能 commit/checkout）→ C2 审批 / auto 模式沙箱直跑；private=True 只在私有通道。
- 沙箱默认无网：clone/pull/fetch/push 需 Pi 侧开 PI_AGENT_EXEC_ALLOW_NET，否则会因无网失败。
"""

import os

from sqlalchemy.ext.asyncio import AsyncSession

from ..pi.exec import SandboxBusy, pi_exec
from .base import Skill

_TIMEOUT = 30.0
GIT_SKILL = "git"
_ALLOWED = {
    "status",
    "diff",
    "log",
    "show",
    "add",
    "commit",
    "restore",
    "checkout",
    "switch",
    "branch",
    "tag",
    "stash",
    "init",
    "clone",
    "pull",
    "fetch",
    "push",
    "remote",
    "rev-parse",
    "ls-files",
    "config",
    "reset",
    "merge",
    "rebase",
    "mv",
    "rm",
    "blame",
    "shortlog",
    "describe",
    "cherry-pick",
    "revert",
    "clean",
}


def _enabled() -> bool:
    return os.environ.get("AGENT_PI_SANDBOX", "").strip().lower() in ("1", "true", "yes")


def _fmt(r: dict) -> str:
    flags = ("・超时" if r.get("timed_out") else "") + ("・已截断" if r.get("truncated") else "")
    return f"[rc={r.get('rc')}{flags}]\n" + (r.get("output") or "（无输出）")


async def _handler(_session: AsyncSession, args: dict) -> str:
    if not _enabled():
        return "（未启用 Pi 沙箱（设 AGENT_PI_SANDBOX=1 开启），git 不可用。）"
    argstr = str(args.get("args", "")).strip()
    if not argstr:
        return "（未提供 git 参数，如 'status' / 'log --oneline -10' / 'commit -m \"msg\"'。）"
    sub = argstr.split()[0]
    if sub not in _ALLOWED:
        return f"（不支持的 git 子命令：{sub}。允许：{', '.join(sorted(_ALLOWED))}）"
    try:
        r = await pi_exec.submit(f"git {argstr}", cwd="workspace", timeout=_TIMEOUT)
    except TimeoutError:
        return "（Pi 沙箱无响应——daemon 在线吗？命令可能超时。）"
    except SandboxBusy:
        return "（沙箱积压已满，稍后再试。）"
    return _fmt(r)


GIT = Skill(
    name=GIT_SKILL,
    description=(
        "在 owner 私有沙箱工作区里跑 git（status/diff/log/show/add/commit/branch/checkout/stash/init 等）。"
        "args 填 git 后面的完整参数，如 'status'、'log --oneline -10'、'commit -m \"fix bug\"'。"
        "沙箱默认无网，clone/pull/push 需开网。有副作用，需批准。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "args": {"type": "string", "description": "git 子命令及其参数（不含开头的 'git'），如 'log --oneline -5'"},
        },
        "required": ["args"],
    },
    handler=_handler,
    risk="write",
    private=True,
)
