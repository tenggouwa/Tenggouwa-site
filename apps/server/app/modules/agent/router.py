import asyncio
import json
import logging

from common.rate_limit import client_ip, unlock_limiter
from db import get_session
from dependencies import current_admin
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..common_schema import ResponseModel
from ..mcp.manager import mcp_manager
from ..memory.store import MemoryStore
from ..terminal.service import terminal_service
from ..totp.repository import AdminTotpRepository
from .auth import current_agent_owner, make_agent_token
from .repository import AgentRepository
from .schema import (
    AgentChatRequest,
    AgentMemoryItem,
    AgentSessionInfo,
    AgentTranscript,
    AgentTranscriptTurn,
    AgentUnlockRequest,
    AgentUnlockResponse,
)
from .service import agent_service

logger = logging.getLogger(__name__)

# 公开通道（免鉴权）：只暴露 readonly skill；私有通道（TOTP → agent_token）：额外给 write / MCP 高危工具。
public_router = APIRouter(prefix="/public/agent", tags=["public.agent"])
private_router = APIRouter(prefix="/agent", tags=["agent"], dependencies=[Depends(current_agent_owner)])
# MCP 状态属运维视角（不是 agent 会话），走 admin JWT，与 kb 的 admin 端点一致。
admin_router = APIRouter(prefix="/admin/agent", tags=["admin.agent"], dependencies=[Depends(current_admin)])


@admin_router.get("/mcp", response_model=ResponseModel[dict])
async def mcp_status() -> ResponseModel[dict]:
    """MCP 连了哪些 server、桥了哪些工具、哪些免审批。

    MCP 工具只在私有通道暴露、启动日志又是 INFO（prod 过滤掉）——没这个端点就完全是黑盒。
    """
    return ResponseModel(data=mcp_manager.status())


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


def _chat_stream(
    session: AsyncSession, payload: AgentChatRequest, *, privileged: bool, owner: str | None = None
) -> StreamingResponse:
    async def gen():
        try:
            async for ev in agent_service.answer_stream(
                session,
                payload.q,
                session_id=payload.session_id,
                approvals=payload.approvals,
                privileged=privileged,
                auto_approve=payload.auto_approve,
                owner=owner,
                deep=payload.deep_think,
            ):
                yield _sse(ev["type"], ev)
        except asyncio.CancelledError:
            # 客户端断连（用户按 Esc / 关页面）→ 干净退出：本轮 DB 写入随请求事务一起回滚，不留半条脏消息
            # （H1：不会留下没配对 tool 结果的 assistant(tool_calls)）。已派发到 Pi 的命令会跑完但结果被丢弃。
            logger.info("agent chat cancelled by client (session=%s)", payload.session_id)
            raise
        except Exception as e:  # noqa: BLE001 —— 流内异常转 SSE error 事件回前端
            logger.exception("agent chat failed")
            yield _sse("error", {"message": str(e)})

    return StreamingResponse(gen(), media_type="text/event-stream")


@public_router.post("/chat")
async def chat(
    payload: AgentChatRequest,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    return _chat_stream(session, payload, privileged=False)  # owner=None：公开会话不归属，也不进「我的会话」


@private_router.post("/chat")
async def chat_privileged(
    payload: AgentChatRequest,
    owner: str = Depends(current_agent_owner),
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    """owner-only 私有通道：可用 write / MCP 高危工具（仍走 C2 审批）；会话归属该 owner。"""
    return _chat_stream(session, payload, privileged=True, owner=owner)


@private_router.get("/sessions", response_model=ResponseModel[list[AgentSessionInfo]])
async def list_sessions(
    owner: str = Depends(current_agent_owner),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[list[AgentSessionInfo]]:
    """列出该 owner 的会话（最近活跃在前），供前端「我的会话」侧栏。"""
    rows = await AgentRepository(session).list_sessions(owner)
    data = [AgentSessionInfo(id=r.id, title=r.title, updated_at=r.updated_at.isoformat()) for r in rows]
    return ResponseModel(data=data)


async def _owned_session(sid: str, owner: str, session: AsyncSession) -> AgentRepository:
    """校验 sid 属于 owner，否则 404（不泄漏「存在但不属于你」）。返回 repo 复用。"""
    repo = AgentRepository(session)
    row = await repo.get_session(sid)
    if row is None or row.owner != owner:
        raise HTTPException(status_code=404, detail="会话不存在")
    return repo


@private_router.get("/sessions/{sid}", response_model=ResponseModel[AgentTranscript])
async def get_transcript(
    sid: str,
    owner: str = Depends(current_agent_owner),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[AgentTranscript]:
    """取某会话的完整对话记录（重建成轮次），供前端点开续聊时回填。"""
    repo = await _owned_session(sid, owner, session)
    row = await repo.get_session(sid)
    turns = [AgentTranscriptTurn(**t) for t in await repo.transcript(sid)]
    return ResponseModel(data=AgentTranscript(id=sid, title=row.title if row else None, turns=turns))


@private_router.delete("/sessions/{sid}", response_model=ResponseModel[dict])
async def delete_session(
    sid: str,
    owner: str = Depends(current_agent_owner),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[dict]:
    """删除该 owner 名下的一个会话（连带消息）。"""
    repo = await _owned_session(sid, owner, session)
    await repo.delete_session(sid)
    return ResponseModel(data={"deleted": True})


@private_router.get("/memories", response_model=ResponseModel[list[AgentMemoryItem]])
async def list_memories(
    owner: str = Depends(current_agent_owner),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[list[AgentMemoryItem]]:
    """列出该 owner 的长期记忆（最近在前），供前端「记忆」面板查看 / 手动删。"""
    rows = await MemoryStore(session).list_all(owner)
    return ResponseModel(data=[AgentMemoryItem(**r) for r in rows])


@private_router.delete("/memories/{mid}", response_model=ResponseModel[dict])
async def delete_memory(
    mid: int,
    owner: str = Depends(current_agent_owner),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[dict]:
    """删该 owner 名下一条记忆。owner 圈定，删不到（不存在 / 不属于你）→ 404。"""
    if not await MemoryStore(session).delete_by_id(owner, mid):
        raise HTTPException(status_code=404, detail="记忆不存在")
    return ResponseModel(data={"deleted": True})
