import json
import logging

from common.rate_limit import client_ip, unlock_limiter
from db import get_session
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..common_schema import ResponseModel
from ..terminal.service import terminal_service
from ..totp.repository import AdminTotpRepository
from .auth import current_agent_owner, make_agent_token
from .schema import AgentChatRequest, AgentUnlockRequest, AgentUnlockResponse
from .service import agent_service

logger = logging.getLogger(__name__)

# 公开通道（免鉴权）：只暴露 readonly skill；私有通道（TOTP → agent_token）：额外给 write / MCP 高危工具。
public_router = APIRouter(prefix="/public/agent", tags=["public.agent"])
private_router = APIRouter(prefix="/agent", tags=["agent"], dependencies=[Depends(current_agent_owner)])


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@public_router.post("/unlock", response_model=ResponseModel[AgentUnlockResponse])
async def unlock(
    payload: AgentUnlockRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[AgentUnlockResponse]:
    """TOTP 解锁私有通道：6 位码校验（复用 console 那套 TOTP）→ 返回长 TTL 的 agent_token。"""
    unlock_limiter.hit(client_ip(request))  # 挡 TOTP 暴破
    owner = await terminal_service.unlock_with_totp(session, payload.totp)
    epoch = await AdminTotpRepository(session).agent_epoch(owner)  # 带上当前吊销纪元
    token, ttl = make_agent_token(owner, epoch)
    return ResponseModel(data=AgentUnlockResponse(token=token, ttl_seconds=ttl))


@private_router.post("/revoke", response_model=ResponseModel[dict])
async def revoke(
    owner: str = Depends(current_agent_owner),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[dict]:
    """注销该 owner 的所有 agent_token（纪元 +1，含当前这个），需重新 TOTP 解锁。"""
    await AdminTotpRepository(session).bump_agent_epoch(owner)
    return ResponseModel(data={"revoked": True})


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
