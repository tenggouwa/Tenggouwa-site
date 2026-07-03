"""源无关的 ingest 基础：Ingester 协议 + markdown 分块 + content hash。"""

import hashlib
from typing import Protocol, TypedDict

from sqlalchemy.ext.asyncio import AsyncSession


class KBDoc(TypedDict):
    external_id: str  # 源内唯一：post.slug / 文件路径 …
    title: str
    url: str | None  # 引用回链
    raw_md: str
    meta: dict


class Ingester(Protocol):
    kind: str
    name: str

    async def fetch(self, session: AsyncSession) -> list[KBDoc]: ...


def content_hash(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _split_blocks(md: str) -> list[str]:
    """按空行切块，保持 ``` 围栏代码块整体不被切断。"""
    blocks: list[str] = []
    buf: list[str] = []
    in_code = False
    for ln in md.split("\n"):
        if ln.lstrip().startswith("```"):
            in_code = not in_code
            buf.append(ln)
            continue
        if not in_code and ln.strip() == "":
            if buf:
                blocks.append("\n".join(buf))
                buf = []
        else:
            buf.append(ln)
    if buf:
        blocks.append("\n".join(buf))
    return [b for b in blocks if b.strip()]


def chunk_markdown(md: str, *, target: int = 800, overlap_blocks: int = 1) -> list[str]:
    """结构感知分块：按段落/代码块贪心打包到 ~target 字符，块间保留少量重叠。

    中文按字符数≈token 数粗算。语料小，规则分块即可，不引第三方库。
    """
    blocks = _split_blocks(md)
    if not blocks:
        return [md.strip()] if md.strip() else []
    chunks: list[str] = []
    cur: list[str] = []
    size = 0
    for b in blocks:
        if size and size + len(b) > target:
            chunks.append("\n\n".join(cur))
            cur = cur[-overlap_blocks:] if overlap_blocks else []
            size = sum(len(x) for x in cur)
        cur.append(b)
        size += len(b)
    if cur:
        chunks.append("\n\n".join(cur))
    return chunks
