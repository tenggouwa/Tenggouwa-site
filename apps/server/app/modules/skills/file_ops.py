"""文件工具（D1，现走 Pi 沙箱）：agent 在 Pi 的 jailed workspace 内 list / read / write 文件。

与 shell_exec 共用**同一个 Pi 沙箱工作区**（PI_AGENT_WORKSPACE），所以「写个脚本→再 shell 跑它」连贯。
- 路由：经 pi_exec.submit_file 把文件操作发到 Pi，Pi 侧在 workspace 内 realpath jail 执行（含符号链接/`..` 防越狱）。
- 未配 env AGENT_PI_SANDBOX → 整组拒用（off-by-default，同 shell_exec）。
- 全部 private=True（只在鉴权私有通道暴露）；file_write 另 risk=write（走 C2 审批）。
"""

import os

from sqlalchemy.ext.asyncio import AsyncSession

from ..pi.exec import SandboxBusy, pi_exec
from .base import Skill

_TIMEOUT = 15.0


def _enabled() -> bool:
    return os.environ.get("AGENT_PI_SANDBOX", "").strip().lower() in ("1", "true", "yes")


async def _file_op(op: str, args: dict, **extra) -> str:
    if not _enabled():
        return "（未启用 Pi 沙箱（设 AGENT_PI_SANDBOX=1 开启），文件工具不可用。）"
    path = str(args.get("path", ""))
    content = str(args.get("content", "")) if op == "write" else ""
    try:
        r = await pi_exec.submit_file(op, path, content, timeout=_TIMEOUT, **extra)
    except TimeoutError:
        return "（Pi 沙箱无响应——daemon 在线吗？）"
    except SandboxBusy:
        return "（沙箱积压已满，稍后再试。）"
    return r.get("output") or "（无输出）"


async def _list_handler(_session: AsyncSession, args: dict) -> str:
    return await _file_op("list", args)


async def _read_handler(_session: AsyncSession, args: dict) -> str:
    return await _file_op("read", args)


async def _write_handler(_session: AsyncSession, args: dict) -> str:
    return await _file_op("write", args)


async def _edit_handler(_session: AsyncSession, args: dict) -> str:
    return await _file_op(
        "edit",
        args,
        old_string=str(args.get("old_string", "")),
        new_string=str(args.get("new_string", "")),
        replace_all=bool(args.get("replace_all", False)),
    )


FILE_LIST = Skill(
    name="file_list",
    description="列出 owner 私有工作区（Pi 沙箱）内某目录下的文件与子目录。path 相对 workspace 根，默认根目录。",
    parameters={
        "type": "object",
        "properties": {"path": {"type": "string", "description": "workspace 内的相对目录路径，默认 '.'"}},
    },
    handler=_list_handler,
    risk="readonly",
    private=True,
)

FILE_READ = Skill(
    name="file_read",
    description="读取 owner 私有工作区（Pi 沙箱 workspace）内一个文本文件的内容。path 相对 workspace 根。",
    parameters={
        "type": "object",
        "properties": {"path": {"type": "string", "description": "workspace 内的相对文件路径"}},
        "required": ["path"],
    },
    handler=_read_handler,
    risk="readonly",
    private=True,
)

FILE_WRITE = Skill(
    name="file_write",
    description="把文本写入 owner 私有工作区（Pi 沙箱）内一个文件（覆盖），必要时创建父目录。有副作用，需批准。",
    parameters={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "workspace 内的相对文件路径"},
            "content": {"type": "string", "description": "要写入的完整文本内容"},
        },
        "required": ["path", "content"],
    },
    handler=_write_handler,
    risk="write",
    private=True,
)

FILE_EDIT = Skill(
    name="file_edit",
    description=(
        "精确编辑 owner 私有工作区（Pi 沙箱）内一个文本文件：把 old_string 替换为 new_string，"
        "不必重写整个文件（适合大文件的小改动）。old_string 须在文件中唯一匹配，否则拒改；"
        "要替换全部相同片段时置 replace_all=true。有副作用，需批准。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "workspace 内的相对文件路径"},
            "old_string": {"type": "string", "description": "要被替换的原文（须与文件内容精确匹配，含缩进/换行）"},
            "new_string": {"type": "string", "description": "替换后的新文本"},
            "replace_all": {"type": "boolean", "description": "true=替换所有匹配；默认 false，仅唯一匹配时才改"},
        },
        "required": ["path", "old_string", "new_string"],
    },
    handler=_edit_handler,
    risk="write",
    private=True,
)
