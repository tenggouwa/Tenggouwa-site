"""KB 持久化 + 检索。v0 检索走 pg_trgm word_similarity（对中文友好）。"""

from datetime import UTC, datetime

from db.models import KBChunkRow, KBDocumentRow, KBSourceRow
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .ingest import KBDoc


class KBRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_or_create_source(self, kind: str, name: str) -> KBSourceRow:
        row = (
            await self.session.execute(select(KBSourceRow).where(KBSourceRow.kind == kind, KBSourceRow.name == name))
        ).scalar_one_or_none()
        if row is None:
            row = KBSourceRow(kind=kind, name=name)
            self.session.add(row)
            await self.session.flush()
        return row

    async def upsert_document(self, source_id: int, doc: KBDoc, content_hash: str) -> tuple[KBDocumentRow, bool]:
        """返回 (row, changed)。changed=False 表示 content_hash 未变、可跳过重切块。"""
        row = (
            await self.session.execute(
                select(KBDocumentRow).where(
                    KBDocumentRow.source_id == source_id,
                    KBDocumentRow.external_id == doc["external_id"],
                )
            )
        ).scalar_one_or_none()
        if row is None:
            row = KBDocumentRow(
                source_id=source_id,
                external_id=doc["external_id"],
                title=doc["title"],
                url=doc["url"],
                raw_md=doc["raw_md"],
                content_hash=content_hash,
                meta=doc["meta"],
            )
            self.session.add(row)
            await self.session.flush()
            return row, True
        changed = row.content_hash != content_hash
        row.title = doc["title"]
        row.url = doc["url"]
        row.raw_md = doc["raw_md"]
        row.content_hash = content_hash
        row.meta = doc["meta"]
        await self.session.flush()
        return row, changed

    async def replace_chunks(self, document_id: int, chunks: list[str]) -> None:
        await self.session.execute(delete(KBChunkRow).where(KBChunkRow.document_id == document_id))
        for i, c in enumerate(chunks):
            self.session.add(KBChunkRow(document_id=document_id, ord=i, content=c))
        await self.session.flush()

    async def touch_source(self, source_id: int) -> None:
        row = await self.session.get(KBSourceRow, source_id)
        if row is not None:
            row.last_synced_at = datetime.now(UTC)

    async def search_chunks(self, q: str, *, limit: int, sources: list[str] | None) -> list[dict]:
        """按块与问题的 trigram word_similarity 排序取 top-k（语料小，全表扫描即可）。"""
        sql = text("""
            SELECT c.id, c.content, d.title, d.url, s.kind AS source_kind,
                   word_similarity(:q, c.content) AS score
            FROM kb_chunk c
            JOIN kb_document d ON d.id = c.document_id
            JOIN kb_source s ON s.id = d.source_id
            WHERE (:has_src IS FALSE OR s.kind = ANY(:sources))
            ORDER BY score DESC
            LIMIT :limit
        """)
        params = {
            "q": q,
            "limit": limit,
            "has_src": bool(sources),
            "sources": sources or [],
        }
        rows = (await self.session.execute(sql, params)).all()
        return [
            {
                "id": r.id,
                "content": r.content,
                "title": r.title,
                "url": r.url,
                "source_kind": r.source_kind,
                "score": float(r.score or 0),
            }
            for r in rows
        ]
