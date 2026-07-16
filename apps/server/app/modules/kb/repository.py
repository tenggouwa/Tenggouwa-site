"""KB 持久化 + 检索。v0 检索走 pg_trgm word_similarity（对中文友好）。"""

from datetime import UTC, datetime

from db.models import (
    KBChunkRow,
    KBDocumentRow,
    KBEntityDocRow,
    KBEntityRow,
    KBRelationDocRow,
    KBRelationRow,
    KBSourceRow,
)
from sqlalchemy import delete, func, or_, select, text
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

    async def replace_chunks(
        self, document_id: int, chunks: list[str], embeddings: list[list[float]] | None = None
    ) -> None:
        await self.session.execute(delete(KBChunkRow).where(KBChunkRow.document_id == document_id))
        for i, c in enumerate(chunks):
            emb = embeddings[i] if embeddings is not None and i < len(embeddings) else None
            self.session.add(KBChunkRow(document_id=document_id, ord=i, content=c, embedding=emb))
        await self.session.flush()

    async def touch_source(self, source_id: int) -> None:
        row = await self.session.get(KBSourceRow, source_id)
        if row is not None:
            row.last_synced_at = datetime.now(UTC)

    # ---------- 概念图谱 ----------

    async def docs_needing_graph(self, *, force: bool = False) -> list[KBDocumentRow]:
        """待抽取的文档：从没抽过（graph_hash 为空）或正文变了（graph_hash != content_hash）。force 则全量。"""
        q = select(KBDocumentRow).order_by(KBDocumentRow.id)
        if not force:
            q = q.where(or_(KBDocumentRow.graph_hash.is_(None), KBDocumentRow.graph_hash != KBDocumentRow.content_hash))
        return list((await self.session.execute(q)).scalars().all())

    async def get_doc_by_external_id(self, external_id: str) -> KBDocumentRow | None:
        return (
            (await self.session.execute(select(KBDocumentRow).where(KBDocumentRow.external_id == external_id)))
            .scalars()
            .first()
        )

    async def _upsert_entity(self, e: dict) -> int:
        """按 norm_key 合并——这是图谱能织成网的关键：同一概念在不同文章里落到同一个节点。"""
        row = (
            await self.session.execute(select(KBEntityRow).where(KBEntityRow.norm_key == e["norm_key"]))
        ).scalar_one_or_none()
        if row is None:
            row = KBEntityRow(norm_key=e["norm_key"], name=e["name"], type=e["type"], description=e["description"])
            self.session.add(row)
            await self.session.flush()
        elif not row.description and e["description"]:  # 先到先得，只补空描述，别让后来的覆盖已有的
            row.description = e["description"]
        return row.id

    async def _upsert_relation(self, source_id: int, target_id: int, r: dict) -> int:
        row = (
            await self.session.execute(
                select(KBRelationRow).where(
                    KBRelationRow.source_id == source_id,
                    KBRelationRow.target_id == target_id,
                    KBRelationRow.type == r["type"],
                )
            )
        ).scalar_one_or_none()
        if row is None:
            row = KBRelationRow(source_id=source_id, target_id=target_id, type=r["type"], description=r["description"])
            self.session.add(row)
            await self.session.flush()
        return row.id

    async def replace_doc_graph(self, doc: KBDocumentRow, entities: list[dict], relations: list[dict]) -> None:
        """用新抽取结果替换这篇文档的图谱贡献，并把 graph_hash 推到当前 content_hash。

        只删「本文档的链接」，不删实体/关系本身——它们可能还被别的文档引用着。孤儿由 prune_orphans 收。
        """
        await self.session.execute(delete(KBEntityDocRow).where(KBEntityDocRow.document_id == doc.id))
        await self.session.execute(delete(KBRelationDocRow).where(KBRelationDocRow.document_id == doc.id))
        key_to_id: dict[str, int] = {}
        for e in entities:
            eid = await self._upsert_entity(e)
            key_to_id[e["norm_key"]] = eid
            self.session.add(KBEntityDocRow(entity_id=eid, document_id=doc.id))
        for r in relations:
            sid, tid = key_to_id.get(r["source"]), key_to_id.get(r["target"])
            if sid is None or tid is None:  # 端点不在本次实体里（_parse 已挡，双保险）
                continue
            rid = await self._upsert_relation(sid, tid, r)
            self.session.add(KBRelationDocRow(relation_id=rid, document_id=doc.id))
        doc.graph_hash = doc.content_hash
        await self.session.flush()

    async def prune_orphans(self) -> int:
        """删掉没有任何文档佐证的实体/关系（文章改了、原来的概念没了）。先删关系再删实体。"""
        rel_orphan = (
            select(KBRelationRow.id)
            .outerjoin(KBRelationDocRow, KBRelationDocRow.relation_id == KBRelationRow.id)
            .where(KBRelationDocRow.relation_id.is_(None))
        )
        n1 = (await self.session.execute(delete(KBRelationRow).where(KBRelationRow.id.in_(rel_orphan)))).rowcount or 0
        ent_orphan = (
            select(KBEntityRow.id)
            .outerjoin(KBEntityDocRow, KBEntityDocRow.entity_id == KBEntityRow.id)
            .where(KBEntityDocRow.entity_id.is_(None))
        )
        n2 = (await self.session.execute(delete(KBEntityRow).where(KBEntityRow.id.in_(ent_orphan)))).rowcount or 0
        await self.session.flush()
        return n1 + n2

    async def search_entities(self, q: str, *, limit: int = 4) -> list[dict]:
        """按名字找概念：查询里**直接出现**该名字算满分，否则退到 trigram 模糊匹配。

        实体名很短（Transformer / cgroup），所以 word_similarity(name, q) 量的是「名字能否对上 q 的某一段」，
        正好适合「什么是 Transformer」这种问法。同分优先长名（更具体，别让 "AI" 压过 "Constitutional AI"）。
        """
        sql = text("""
            SELECT e.id, e.name, e.type, e.description,
                   GREATEST(
                     word_similarity(e.name, :q),
                     CASE WHEN :q ILIKE '%' || e.name || '%' THEN 1.0 ELSE 0.0 END
                   ) AS score
            FROM kb_entity e
            WHERE e.name % :q OR :q ILIKE '%' || e.name || '%'
            ORDER BY score DESC, length(e.name) DESC
            LIMIT :limit
        """)
        rows = (await self.session.execute(sql, {"q": q, "limit": limit})).all()
        return [
            {"id": r.id, "name": r.name, "type": r.type, "description": r.description, "score": float(r.score or 0)}
            for r in rows
        ]

    async def entity_relations(self, ids: list[int], *, limit: int = 30) -> list[dict]:
        """取这些概念的关系（出边 + 入边都要——「谁基于我」和「我基于谁」一样有信息量）。"""
        if not ids:
            return []
        sql = text("""
            SELECT r.type, r.description, es.name AS source, et.name AS target
            FROM kb_relation r
            JOIN kb_entity es ON es.id = r.source_id
            JOIN kb_entity et ON et.id = r.target_id
            WHERE r.source_id = ANY(:ids) OR r.target_id = ANY(:ids)
            LIMIT :limit
        """)
        rows = (await self.session.execute(sql, {"ids": ids, "limit": limit})).all()
        return [{"source": r.source, "target": r.target, "type": r.type, "description": r.description} for r in rows]

    async def entity_docs(self, ids: list[int], *, limit: int = 30) -> list[dict]:
        """取佐证这些概念的文章（provenance）——回引用要用。"""
        if not ids:
            return []
        sql = text("""
            SELECT ed.entity_id, d.title, d.url
            FROM kb_entity_doc ed
            JOIN kb_document d ON d.id = ed.document_id
            WHERE ed.entity_id = ANY(:ids)
            ORDER BY d.title
            LIMIT :limit
        """)
        rows = (await self.session.execute(sql, {"ids": ids, "limit": limit})).all()
        return [{"entity_id": r.entity_id, "title": r.title, "url": r.url} for r in rows]

    async def graph_stats(self) -> dict:
        entities = (await self.session.execute(select(func.count(KBEntityRow.id)))).scalar() or 0
        relations = (await self.session.execute(select(func.count(KBRelationRow.id)))).scalar() or 0
        return {"entities": entities, "relations": relations}

    @staticmethod
    def _rows_to_hits(rows) -> list[dict]:
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

    async def search_chunks(
        self, q: str, qvec: list[float] | None, *, limit: int, sources: list[str] | None
    ) -> list[dict]:
        """有 qvec 走向量 + trigram 双路 RRF 融合；无 qvec（未配嵌入）降级为纯 trigram。"""
        base = {"q": q, "limit": limit, "has_src": bool(sources), "sources": sources or []}
        if not qvec:
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
            rows = (await self.session.execute(sql, base)).all()
            return self._rows_to_hits(rows)

        # 混合检索：两路各取 pool 条，RRF(k) 融合。qvec 以字符串字面量 cast ::vector。
        vec_literal = "[" + ",".join(f"{x:.6f}" for x in qvec) + "]"
        sql = text("""
            WITH q AS (SELECT CAST(:qvec AS vector) AS v),
            vec AS (
                SELECT c.id, ROW_NUMBER() OVER (ORDER BY c.embedding <=> (SELECT v FROM q)) AS rank
                FROM kb_chunk c
                JOIN kb_document d ON d.id = c.document_id
                JOIN kb_source s ON s.id = d.source_id
                WHERE c.embedding IS NOT NULL AND (:has_src IS FALSE OR s.kind = ANY(:sources))
                ORDER BY c.embedding <=> (SELECT v FROM q)
                LIMIT :pool
            ),
            fts AS (
                SELECT c.id, ROW_NUMBER() OVER (ORDER BY word_similarity(:q, c.content) DESC) AS rank
                FROM kb_chunk c
                JOIN kb_document d ON d.id = c.document_id
                JOIN kb_source s ON s.id = d.source_id
                WHERE (:has_src IS FALSE OR s.kind = ANY(:sources))
                ORDER BY word_similarity(:q, c.content) DESC
                LIMIT :pool
            ),
            fused AS (
                SELECT id, SUM(score) AS rrf FROM (
                    SELECT id, 1.0 / (:k + rank) AS score FROM vec
                    UNION ALL
                    SELECT id, 1.0 / (:k + rank) AS score FROM fts
                ) u GROUP BY id
            )
            SELECT c.id, c.content, d.title, d.url, s.kind AS source_kind, f.rrf AS score
            FROM fused f
            JOIN kb_chunk c ON c.id = f.id
            JOIN kb_document d ON d.id = c.document_id
            JOIN kb_source s ON s.id = d.source_id
            ORDER BY f.rrf DESC
            LIMIT :limit
        """)
        params = {**base, "qvec": vec_literal, "pool": 40, "k": 60}
        rows = (await self.session.execute(sql, params)).all()
        return self._rows_to_hits(rows)

    async def overview(self) -> list[dict]:
        """每个源的文档数 / 块数 / 已嵌入块数 / 最近同步时间。"""
        sql = text("""
            SELECT s.kind, s.name, s.last_synced_at,
                   count(DISTINCT d.id) AS documents,
                   count(c.id) AS chunks,
                   count(c.embedding) AS embedded
            FROM kb_source s
            LEFT JOIN kb_document d ON d.source_id = s.id
            LEFT JOIN kb_chunk c ON c.document_id = d.id
            GROUP BY s.id, s.kind, s.name, s.last_synced_at
            ORDER BY s.kind
        """)
        rows = (await self.session.execute(sql)).all()
        return [
            {
                "kind": r.kind,
                "name": r.name,
                "last_synced_at": r.last_synced_at,
                "documents": r.documents,
                "chunks": r.chunks,
                "embedded": r.embedded,
            }
            for r in rows
        ]

    async def list_documents(self, source_kind: str | None, *, limit: int, offset: int) -> tuple[list[dict], int]:
        where = "WHERE s.kind = :kind" if source_kind else ""
        cparams = {"kind": source_kind} if source_kind else {}
        sql = text(f"""
            SELECT d.id, d.title, d.url, d.updated_at, count(c.id) AS chunks
            FROM kb_document d
            JOIN kb_source s ON s.id = d.source_id
            LEFT JOIN kb_chunk c ON c.document_id = d.id
            {where}
            GROUP BY d.id, d.title, d.url, d.updated_at
            ORDER BY d.updated_at DESC
            LIMIT :limit OFFSET :offset
        """)
        count_sql = text(f"SELECT count(*) FROM kb_document d JOIN kb_source s ON s.id = d.source_id {where}")
        rows = (await self.session.execute(sql, {**cparams, "limit": limit, "offset": offset})).all()
        total = (await self.session.execute(count_sql, cparams)).scalar_one()
        items = [
            {"id": r.id, "title": r.title, "url": r.url, "updated_at": r.updated_at, "chunks": r.chunks} for r in rows
        ]
        return items, total
