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

    async def graph_hubs(self, *, limit: int = 40) -> list[dict]:
        """枢纽概念：按「出现文章数」降序（连接越多篇=越是入口）。图谱页的着陆入口。"""
        sql = text("""
            SELECT e.id, e.name, e.type,
                   count(DISTINCT ed.document_id) AS docs,
                   count(DISTINCT r.id) AS rels
            FROM kb_entity e
            JOIN kb_entity_doc ed ON ed.entity_id = e.id
            LEFT JOIN kb_relation r ON r.source_id = e.id OR r.target_id = e.id
            GROUP BY e.id, e.name, e.type
            HAVING count(DISTINCT r.id) > 0
            ORDER BY docs DESC, rels DESC, length(e.name)
            LIMIT :limit
        """)
        rows = (await self.session.execute(sql, {"limit": limit})).all()
        return [{"id": r.id, "name": r.name, "type": r.type, "docs": r.docs, "rels": r.rels} for r in rows]

    async def graph_neighborhood(self, entity_id: int) -> dict | None:
        """一个概念的邻域：中心 + 直接邻居 + 边 + 佐证文章（含系列标签，前端着色用）。

        节点携带 series（ai/linux/other，取自佐证文章 tags 的众数）——这就是「两个星系」的颜色来源。
        """
        center = await self.session.get(KBEntityRow, entity_id)
        if center is None:
            return None
        rel_sql = text("""
            SELECT r.id, r.type, r.description, r.source_id, r.target_id,
                   es.name AS source, es.type AS s_type, et.name AS target, et.type AS t_type
            FROM kb_relation r
            JOIN kb_entity es ON es.id = r.source_id
            JOIN kb_entity et ON et.id = r.target_id
            WHERE r.source_id = :id OR r.target_id = :id
        """)
        rels = (await self.session.execute(rel_sql, {"id": entity_id})).all()
        node_ids = {entity_id}
        for r in rels:
            node_ids.update((r.source_id, r.target_id))
        series = await self._series_of(list(node_ids))
        names = {
            entity_id: center.name,
            **{r.source_id: r.source for r in rels},
            **{r.target_id: r.target for r in rels},
        }
        types = {
            entity_id: center.type,
            **{r.source_id: r.s_type for r in rels},
            **{r.target_id: r.t_type for r in rels},
        }
        nodes = [
            {"id": nid, "name": names[nid], "type": types[nid], "series": series.get(nid, "other")} for nid in node_ids
        ]
        docs = await self.entity_docs([entity_id])
        return {
            "center": entity_id,
            "nodes": nodes,
            "edges": [
                {"source": r.source_id, "target": r.target_id, "type": r.type, "description": r.description}
                for r in rels
            ],
            "docs": docs,
        }

    async def _series_of(self, node_ids: list[int]) -> dict[int, str]:
        """每个实体的系列（ai/linux/other）：取佐证文章 tags 的众数。两个星系的颜色来源。"""
        if not node_ids:
            return {}
        sql = text("""
            SELECT ed.entity_id,
                   CASE WHEN d.meta->>'tags' LIKE '%ai-series%' THEN 'ai'
                        WHEN d.meta->>'tags' LIKE '%linux-series%' THEN 'linux'
                        ELSE 'other' END AS series,
                   count(*) AS c
            FROM kb_entity_doc ed JOIN kb_document d ON d.id = ed.document_id
            WHERE ed.entity_id = ANY(:ids)
            GROUP BY 1, 2
        """)
        best: dict[int, tuple[str, int]] = {}
        for row in (await self.session.execute(sql, {"ids": node_ids})).all():
            cur = best.get(row.entity_id)
            if cur is None or row.c > cur[1]:
                best[row.entity_id] = (row.series, row.c)
        return {eid: v[0] for eid, v in best.items()}

    async def graph_full(self) -> dict:
        """全图 dump：所有有关系的实体 + 全部关系，带系列着色 + 度数（前端力导向渲染）。

        529 实体 / 499 关系量级，一次全给。孤立实体（0 关系）不给——力导向里就是一堆散点，
        逛不到也点不亮，只添乱。度数 deg 给前端定节点大小（枢纽大、长尾小）。
        """
        node_sql = text("""
            SELECT e.id, e.name, e.type,
                   count(DISTINCT ed.document_id) AS docs,
                   count(DISTINCT r.id) AS deg
            FROM kb_entity e
            JOIN kb_relation r ON r.source_id = e.id OR r.target_id = e.id
            LEFT JOIN kb_entity_doc ed ON ed.entity_id = e.id
            GROUP BY e.id, e.name, e.type
        """)
        nrows = (await self.session.execute(node_sql)).all()
        series = await self._series_of([r.id for r in nrows])
        nodes = [
            {
                "id": r.id,
                "name": r.name,
                "type": r.type,
                "docs": r.docs,
                "deg": r.deg,
                "series": series.get(r.id, "other"),
            }
            for r in nrows
        ]
        erows = (await self.session.execute(text("SELECT source_id, target_id, type FROM kb_relation"))).all()
        edges = [{"source": r.source_id, "target": r.target_id, "type": r.type} for r in erows]
        return {"nodes": nodes, "edges": edges}

    async def graph_stats(self) -> dict:
        entities = (await self.session.execute(select(func.count(KBEntityRow.id)))).scalar() or 0
        relations = (await self.session.execute(select(func.count(KBRelationRow.id)))).scalar() or 0
        return {"entities": entities, "relations": relations}

    async def graph_coverage(self) -> dict:
        """图谱覆盖度：实体/关系总数 + 已抽文档 / 总文档（顶部小字用，也是抽取健康的唯一可见处）。"""
        stats = await self.graph_stats()
        docs_total = (await self.session.execute(select(func.count(KBDocumentRow.id)))).scalar() or 0
        docs_graphed = (
            await self.session.execute(select(func.count(KBDocumentRow.id)).where(KBDocumentRow.graph_hash.isnot(None)))
        ).scalar() or 0
        return {**stats, "docs_total": docs_total, "docs_graphed": docs_graphed}

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
                    SELECT id, :w_vec * 1.0 / (:k + rank) AS score FROM vec
                    UNION ALL
                    SELECT id, :w_fts * 1.0 / (:k + rank) AS score FROM fts
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
        # RRF 融合权重：向量 2×、trigram 1×。诊断（2026-07-18，生产 57 篇实测）：中文口语 query
        # 走 trigram 只命中「大模型/模型」这类公共词、拿 0.333 噪声分，等权融合会让泛文两票相加
        # 反超「只有向量一票」的正确文档（如问「大模型怎么省显存」压根捞不到 FP4/vLLM 那几篇）。
        # 实测 2:1 是甜点：向量托起纯语义命中，trigram 仍够加固同域词（容器/iptables 不被跨域噪声污染）；
        # 再重（4:1）或给 trigram 加阈值静音，反而让向量的跨域长尾漏进来。别退回等权。
        params = {**base, "qvec": vec_literal, "pool": 40, "k": 60, "w_vec": 2.0, "w_fts": 1.0}
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
