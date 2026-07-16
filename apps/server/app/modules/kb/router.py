import json
import logging

from db import get_session
from dependencies import current_admin
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..common_schema import ResponseModel
from .provider import chat_llm
from .schema import AskRequest, GraphBuildResult, KBDocumentPage, KBSourceOverview, ReindexResult
from .service import kb_service

logger = logging.getLogger(__name__)


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


public_router = APIRouter(prefix="/public/kb", tags=["public.kb"])


@public_router.get("/graph/hubs", response_model=ResponseModel[dict])
async def graph_hubs(
    limit: int = Query(default=40, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[dict]:
    """概念图谱着陆数据（公开只读）：{hubs, stats}——枢纽入口 + 覆盖度统计。"""
    return ResponseModel(data=await kb_service.graph_hubs(session, limit=limit))


@public_router.get("/graph/full", response_model=ResponseModel[dict])
async def graph_full(
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[dict]:
    """全图 dump（公开只读）：{nodes, edges, stats}——力导向图一次拉全。"""
    return ResponseModel(data=await kb_service.graph_full(session))


@public_router.get("/graph/entity/{entity_id}", response_model=ResponseModel[dict])
async def graph_neighborhood(
    entity_id: int,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[dict]:
    """一个概念的邻域（公开只读）：点节点展开时拉这个。"""
    try:
        return ResponseModel(data=await kb_service.graph_neighborhood(session, entity_id))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@public_router.post("/ask")
async def ask(
    payload: AskRequest,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    # DB 检索在 session 打开时先做完；生成阶段只调 LLM（不再碰 DB）。
    hits = await kb_service.retrieve(session, payload.q, payload.sources)
    messages = kb_service.build_messages(payload.q, hits)
    citations = [c.model_dump() for c in kb_service.citations(hits)]

    async def gen():
        try:
            async for delta in chat_llm.stream(messages):
                yield _sse("token", {"delta": delta})
        except Exception as e:  # noqa: BLE001 —— 流内异常要转成 SSE error 事件回给前端
            logger.exception("kb ask stream failed")
            yield _sse("error", {"message": str(e)})
        yield _sse("done", {"citations": citations})

    return StreamingResponse(gen(), media_type="text/event-stream")


@public_router.get("/overview", response_model=ResponseModel[list[KBSourceOverview]])
async def overview(session: AsyncSession = Depends(get_session)) -> ResponseModel[list[KBSourceOverview]]:
    return ResponseModel(data=await kb_service.overview(session))


@public_router.get("/documents", response_model=ResponseModel[KBDocumentPage])
async def documents(
    source: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[KBDocumentPage]:
    return ResponseModel(data=await kb_service.list_documents(session, source, limit=limit, offset=offset))


admin_router = APIRouter(
    prefix="/admin/kb",
    tags=["admin.kb"],
    dependencies=[Depends(current_admin)],
)


@admin_router.post("/reindex", response_model=ResponseModel[ReindexResult])
async def reindex(
    source: str = Query(default="blog"),
    force: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[ReindexResult]:
    result = await kb_service.reindex(session, source, force=force)
    return ResponseModel(data=result)


@admin_router.get("/graph/preview", response_model=ResponseModel[dict])
async def preview_graph(
    external_id: str = Query(description="文档 slug，如 scaling-laws-and-emergence"),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[dict]:
    """dry-run 抽取某篇文章（只回不写）：看模型原始输出 + 清洗后结果，用来调 prompt。"""
    return ResponseModel(data=await kb_service.preview_graph(session, external_id))


@admin_router.post("/graph/build", response_model=ResponseModel[GraphBuildResult])
async def build_graph(
    force: bool = Query(default=False, description="忽略 graph_hash，全量重抽（会重新烧 LLM）"),
    limit: int | None = Query(default=None, ge=1, description="本次最多抽几篇；先小批试跑看质量"),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[GraphBuildResult]:
    """抽概念图谱（LLM，按 graph_hash 增量）。耗时随篇数线性增长，建议先 limit=3 试跑。"""
    result = await kb_service.build_graph(session, force=force, limit=limit)
    return ResponseModel(data=result)
