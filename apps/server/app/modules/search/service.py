"""搜索业务逻辑：跑后端 SQL，合并多类型结果，做 snippet 高亮。"""

import logging
import re
import time

from sqlalchemy.ext.asyncio import AsyncSession

from .repository import SearchRepository

logger = logging.getLogger(__name__)

SNIPPET_RADIUS = 60  # 关键词前后各取多少字符
SNIPPET_MAX = 180  # snippet 整体最大长度


class SearchService:
    async def search(self, session: AsyncSession, q: str, limit: int) -> dict:
        started = time.perf_counter()
        q = q.strip()
        if not q:
            return {"query": "", "took_ms": 0, "total": 0, "hits": []}

        # 防御：太短的 query 会让 trigram 命中爆炸。1 字符也允许（中文单字常见），
        # 但用 prefix 匹配限速；2+ 字符走完整 word_similarity。
        if len(q) > 100:
            q = q[:100]

        repo = SearchRepository(session)
        per_type = max(5, limit // 2)
        post_rows, ins_rows = await self._gather(repo, q, per_type)

        hits = []
        for p in post_rows:
            snippet_src = self._pick_snippet_source(q, p["title"], p["summary"], p["content"])
            hits.append(
                {
                    "type": "post",
                    "id": p["id"],
                    "title": p["title"],
                    "url": f"/posts/{p['slug']}",
                    "snippet": _highlight(snippet_src, q),
                    "score": p["score"],
                    "tags": p["tags"],
                    "timestamp": p["published_at"],
                }
            )
        for i in ins_rows:
            title = _truncate(i["content"], 40)
            hits.append(
                {
                    "type": "inspiration",
                    "id": i["id"],
                    "title": title,
                    "url": f"/inspirations#i{i['id']}",
                    "snippet": _highlight(i["content"], q),
                    "score": i["score"] * 0.6,  # inspiration 整体降权，post 更主要
                    "tags": [],
                    "timestamp": i["created_at"],
                }
            )

        hits.sort(key=lambda h: h["score"], reverse=True)
        hits = hits[:limit]

        took_ms = int((time.perf_counter() - started) * 1000)
        return {"query": q, "took_ms": took_ms, "total": len(hits), "hits": hits}

    @staticmethod
    async def _gather(repo: SearchRepository, q: str, per_type: int):
        # 简化：顺序跑，post → inspiration。要并发可用 asyncio.gather，
        # 但都走同一个 session，并发不安全。
        post_rows = await repo.search_posts(q, per_type)
        ins_rows = await repo.search_inspirations(q, per_type)
        return post_rows, ins_rows

    @staticmethod
    def _pick_snippet_source(q: str, title: str, summary: str, content: str) -> str:
        """优先返回含关键词的字段（summary > content > title）。"""
        ql = q.lower()
        for candidate in (summary, content, title):
            if candidate and ql in candidate.lower():
                return candidate
        return summary or content or title


def _truncate(s: str, n: int) -> str:
    s = (s or "").strip().replace("\n", " ")
    return s if len(s) <= n else s[: n - 1] + "…"


def _highlight(text: str, q: str) -> str:
    """围绕第一次命中位置截取窗口，<mark> 包裹关键词。"""
    if not text:
        return ""
    raw = text.replace("\n", " ").strip()
    ql = q.lower()
    rl = raw.lower()
    idx = rl.find(ql)
    if idx < 0:
        # 没命中（trigram 命中但子串没出现）— 直接 truncate 头部
        return _truncate(raw, SNIPPET_MAX)
    start = max(0, idx - SNIPPET_RADIUS)
    end = min(len(raw), idx + len(q) + SNIPPET_RADIUS)
    snippet = raw[start:end]
    if start > 0:
        snippet = "…" + snippet
    if end < len(raw):
        snippet = snippet + "…"
    # 不区分大小写包裹 <mark>
    pattern = re.compile(re.escape(q), re.IGNORECASE)
    return pattern.sub(lambda m: f"<mark>{m.group(0)}</mark>", snippet)[: SNIPPET_MAX + 14]
    # +14 给 <mark></mark> 标签预算


search_service = SearchService()
