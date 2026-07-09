import json
import logging

from db import get_session
from dependencies.jwt_auth import current_admin
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import AgentChatRequest
from .service import agent_service

logger = logging.getLogger(__name__)

# 公开通道（免鉴权）：只暴露 readonly skill；私有通道（JWT）：额外给 write / MCP 高危工具。
public_router = APIRouter(prefix="/public/agent", tags=["public.agent"])
private_router = APIRouter(prefix="/agent", tags=["agent"], dependencies=[Depends(current_admin)])


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _chat_stream(session: AsyncSession, payload: AgentChatRequest, *, privileged: bool) -> StreamingResponse:
    async def gen():
        try:
            async for ev in agent_service.answer_stream(
                session,
                payload.q,
                session_id=payload.session_id,
                approvals=payload.approvals,
                privileged=privileged,
            ):
                yield _sse(ev["type"], ev)
        except Exception as e:  # noqa: BLE001 —— 流内异常转 SSE error 事件回前端
            logger.exception("agent chat failed")
            yield _sse("error", {"message": str(e)})

    return StreamingResponse(gen(), media_type="text/event-stream")


@public_router.post("/chat")
async def chat(
    payload: AgentChatRequest,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    return _chat_stream(session, payload, privileged=False)


@private_router.post("/chat")
async def chat_privileged(
    payload: AgentChatRequest,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    """owner-only 私有通道：可用 write / MCP 高危工具（仍走 C2 审批）。"""
    return _chat_stream(session, payload, privileged=True)
