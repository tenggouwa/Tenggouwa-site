"""NotesIngester：受控目录中的 Markdown/Obsidian 笔记。"""

import os
import re
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from .base import KBDoc

_TITLE = re.compile(r"^title:\s*[\"']?(.+?)[\"']?\s*$", re.MULTILINE)


class NotesIngester:
    """Only reads an explicit local directory; an unset path intentionally produces no documents."""

    kind = "notes"
    name = "notes"

    def _root(self) -> Path | None:
        raw = os.environ.get("KB_NOTES_DIR")
        if not raw:
            return None
        root = Path(raw).expanduser().resolve()
        return root if root.is_dir() else None

    async def fetch(self, _session: AsyncSession) -> list[KBDoc]:
        root = self._root()
        if root is None:
            return []
        docs: list[KBDoc] = []
        for path in sorted(root.rglob("*.md")):
            if not path.is_file() or path.is_symlink():
                continue
            relative = path.relative_to(root)
            raw_md = path.read_text(encoding="utf-8")
            match = _TITLE.search(raw_md)
            title = match.group(1).strip() if match else relative.stem
            docs.append(
                KBDoc(
                    external_id=relative.with_suffix("").as_posix(),
                    title=title,
                    url=None,
                    raw_md=raw_md,
                    meta={"path": relative.as_posix()},
                )
            )
        return docs
