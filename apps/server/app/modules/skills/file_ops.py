"""文件工具（D1）：让 agent 在一个 jailed workspace 目录内 list / read / write 文件。

安全红线（比照 web_fetch 的 SSRF 守卫思路）：
- 只在 `AGENT_WORKSPACE` 指定的目录内操作；未配置则整组不可用（off-by-default）。
- 路径越狱防护：把请求路径并入 workspace 后 realpath 解析（含符号链接、`..`），
  解析结果必须仍落在 workspace 内，否则拒绝。绝对路径也强制并入 workspace。
- read 有大小截断；write 有内容上限；list 有条数上限。
- 全部标 private=True（只在鉴权私有通道暴露，公开端点看不到）；write 另标 risk=write（走 C2 审批）。
"""

import os
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from .base import Skill

_MAX_READ_CHARS = 8_000  # 回给 LLM 的正文上限（对齐 web_fetch / 工具输出截断）
_MAX_READ_BYTES = 200_000  # 读盘上限，超出截断
_MAX_WRITE_BYTES = 100_000  # 单次写入内容上限
_MAX_ENTRIES = 200  # 目录列举条数上限

_NO_WORKSPACE = "（未配置 AGENT_WORKSPACE，文件工具不可用。）"
_ESCAPE = "（拒绝：路径越出 workspace。）"


def _workspace() -> Path | None:
    """workspace 根目录（realpath）；未配置返回 None。每次调用即时读，便于测试注入。"""
    root = os.environ.get("AGENT_WORKSPACE", "").strip()
    if not root:
        return None
    return Path(root).resolve()


def _resolve(root: Path, rel: str) -> Path | None:
    """把 rel 当作 workspace 相对路径解析；越狱（含符号链接 / `..`）返回 None。"""
    target = (root / (rel or ".").lstrip("/")).resolve()
    return target if target == root or target.is_relative_to(root) else None


async def _list_handler(_session: AsyncSession, args: dict) -> str:
    root = _workspace()
    if root is None:
        return _NO_WORKSPACE
    rel = str(args.get("path", "."))
    target = _resolve(root, rel)
    if target is None:
        return _ESCAPE
    if not target.exists():
        return f"（不存在：{rel}）"
    if not target.is_dir():
        return f"（不是目录：{rel}）"
    lines = []
    for i, p in enumerate(sorted(target.iterdir())):
        if i >= _MAX_ENTRIES:
            lines.append(f"…（还有更多，已截断到 {_MAX_ENTRIES} 项）")
            break
        kind = "dir " if p.is_dir() else "file"
        size = p.stat().st_size if p.is_file() else "-"
        lines.append(f"{kind}\t{size}\t{p.name}")
    header = "./" if target == root else f"{target.relative_to(root)}/"
    return header + "\n" + ("\n".join(lines) if lines else "（空目录）")


async def _read_handler(_session: AsyncSession, args: dict) -> str:
    root = _workspace()
    if root is None:
        return _NO_WORKSPACE
    rel = str(args.get("path", ""))
    target = _resolve(root, rel)
    if target is None:
        return _ESCAPE
    if not target.is_file():
        return f"（不存在或不是文件：{rel}）"
    try:
        data = target.read_bytes()[:_MAX_READ_BYTES]
    except OSError as e:
        return f"（读取 {rel} 失败：{e.strerror or '读取错误'}）"  # 只回 errno 文案，不泄漏宿主绝对路径
    text = data.decode("utf-8", errors="replace")
    if len(text) > _MAX_READ_CHARS:
        return text[:_MAX_READ_CHARS] + "\n…[已截断，文件更大]"
    return text or "（空文件）"


async def _write_handler(_session: AsyncSession, args: dict) -> str:
    root = _workspace()
    if root is None:
        return _NO_WORKSPACE
    rel = str(args.get("path", ""))
    target = _resolve(root, rel)
    if target is None:
        return _ESCAPE
    if target == root or target.is_dir():
        return f"（目标是目录，不能写：{rel}）"
    content = str(args.get("content", ""))
    if len(content.encode("utf-8")) > _MAX_WRITE_BYTES:
        return f"（内容过大，上限 {_MAX_WRITE_BYTES} 字节。）"
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    except OSError as e:
        return f"（写入 {rel} 失败：{e.strerror or '写入错误'}）"  # 只回 errno 文案，不泄漏宿主绝对路径
    return f"（已写入 {target.relative_to(root)}，{len(content)} 字。）"


FILE_LIST = Skill(
    name="file_list",
    description="列出 owner 私有工作区（workspace）内某个目录下的文件与子目录。path 相对 workspace 根，默认根目录。",
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
    description="读取 owner 私有工作区（workspace）内一个文本文件的内容。path 相对 workspace 根。",
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
    description="把文本写入 owner 私有工作区（workspace）内一个文件（覆盖），必要时创建父目录。有副作用，需批准。",
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
