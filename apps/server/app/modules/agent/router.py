import json
import logging

from db import get_session
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import AgentChatRequest
from .service import agent_service

logger = logging.getLogger(__name__)

public_router = APIRouter(prefix="/public/agent", tags=["public.agent"])


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@public_router.post("/chat")
async def chat(
    payload: AgentChatRequest,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    async def gen():
        try:
            async for ev in agent_service.answer_stream(session, payload.q, session_id=payload.session_id):
                yield _sse(ev["type"], ev)
        except Exception as e:  # noqa: BLE001 —— 流内异常转 SSE error 事件回前端
            logger.exception("agent chat failed")
            yield _sse("error", {"message": str(e)})

    return StreamingResponse(gen(), media_type="text/event-stream")
