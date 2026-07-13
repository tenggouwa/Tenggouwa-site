"""终端模块的 REST + WSS 路由。

admin 端（需 session JWT）：
- POST /api/admin/terminal/agent/issue        创建一个新 agent，返回一次性 token
- GET  /api/admin/terminal/agents             列出 agent + 在线状态
- POST /api/admin/terminal/agent/{id}/revoke  撤销
- GET  /api/admin/terminal/sessions           最近 50 条会话审计
- WSS  /api/admin/terminal/ws?token=<session_jwt>&agent_id=<id>   admin 浏览器接入

console 端（公开，自带 voice/TOTP 鉴权）：
- POST /api/console/unlock        声纹 / TOTP → 返回 5min term_token + agents 列表
- WSS  /api/console/ws?token=<term_jwt>&agent_id=<id>   公开端浏览器接入

agent 端：
- WSS  /api/agent/ws              Mac agent 接入，Bearer agent_token
"""

import json
import logging

import jwt
from common import config
from common.rate_limit import client_ip, unlock_limiter
from db import get_session
from dependencies import DetailedHTTPException, current_admin
from fastapi import APIRouter, Cookie, Depends, Header, Query, Request, Response, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.websockets import WebSocketDisconnect, WebSocketState

from ..common_schema import ResponseModel
from ..totp.router import set_trust_cookie
from .broker import broker, make_json
from .repository import AgentRepository, TerminalSessionRepository
from .schema import (
    Agent,
    AgentIssueRequest,
    AgentIssueResponse,
    AgentLite,
    ConsoleUnlockRequest,
    ConsoleUnlockResponse,
    TerminalSessionLog,
)
from .service import TERM_TOKEN_TTL, VOICE_PHRASE, terminal_service

logger = logging.getLogger(__name__)


admin_router = APIRouter(
    prefix="/admin/terminal",
    tags=["admin.terminal"],
    dependencies=[Depends(current_admin)],
)


# ============================================================================
# REST: agents
# ============================================================================


@admin_router.post("/agent/issue", response_model=ResponseModel[AgentIssueResponse])
async def issue_agent(
    payload: AgentIssueRequest,
    owner: str = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[AgentIssueResponse]:
    raw, sha = terminal_service.issue_agent_token()
    row = await AgentRepository(session).create(payload.name, owner, sha)
    base = _agent_ws_base_url()
    return ResponseModel(
        data=AgentIssueResponse(id=row.id, name=row.name, token=raw, base_url=base),
    )


@admin_router.get("/agents", response_model=ResponseModel[list[Agent]])
async def list_agents(
    owner: str = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[list[Agent]]:
    rows = await AgentRepository(session).list_by_owner(owner)
    items = [
        Agent(
            id=r.id,
            name=r.name,
            created_at=r.created_at,
            last_seen_at=r.last_seen_at,
            revoked_at=r.revoked_at,
            online=broker.agent_online(r.id) and r.revoked_at is None,
        )
        for r in rows
    ]
    return ResponseModel(data=items)


@admin_router.post("/agent/{agent_id}/revoke", response_model=ResponseModel[dict])
async def revoke_agent(
    agent_id: int,
    owner: str = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[dict]:
    await terminal_service.verify_agent_owns(session, owner, agent_id)
    ok = await AgentRepository(session).revoke(agent_id)
    return ResponseModel(data={"revoked": ok})


@admin_router.get("/sessions", response_model=ResponseModel[list[TerminalSessionLog]])
async def list_sessions(
    owner: str = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[list[TerminalSessionLog]]:
    rows = await TerminalSessionRepository(session).list_recent(owner)
    return ResponseModel(
        data=[
            TerminalSessionLog(
                id=r.id,
                agent_id=r.agent_id,
                opened_at=r.opened_at,
                closed_at=r.closed_at,
                bytes_in=r.bytes_in,
                bytes_out=r.bytes_out,
                unlock_method=r.unlock_method,
                voice_transcript=r.voice_transcript,
                client_ip=r.client_ip,
            )
            for r in rows
        ],
    )


# ============================================================================
# WSS: agent inbound (Mac daemon)
# ============================================================================


agent_router = APIRouter(prefix="/agent", tags=["agent"])


@agent_router.websocket("/ws")
async def agent_ws(
    ws: WebSocket,
    authorization: str | None = Header(default=None),
) -> None:
    """Mac agent 接入。鉴权用 Authorization: Bearer <agent_token>。"""
    raw = _extract_bearer(authorization)
    if not raw:
        await ws.close(code=4401, reason="missing bearer")
        return
    sha = terminal_service.hash_token(raw)

    from db import async_pg  # noqa: PLC0415

    async with async_pg.session() as db_session:
        agent_row = await AgentRepository(db_session).get_by_token_sha(sha)
        if agent_row is None:
            await ws.close(code=4403, reason="invalid agent token")
            return
        await AgentRepository(db_session).touch_seen(agent_row.id)
        agent_id = agent_row.id

    await ws.accept()
    conn = await broker.register_agent(agent_id, ws)
    logger.info("agent %s connected", agent_id)
    try:
        await ws.send_text(make_json("hello", agent_id=agent_id))
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            client = conn.paired_client
            if "bytes" in msg and msg["bytes"] is not None:
                payload: bytes = msg["bytes"]
                if client is not None:
                    client.bytes_out += len(payload)
                    await broker.forward_bytes(ws, client.ws, payload)
            elif "text" in msg and msg["text"] is not None:
                # 控制帧：pty_alive / pong 拦下来，其他透传给 client
                text = msg["text"]
                try:
                    obj = json.loads(text)
                except json.JSONDecodeError:
                    obj = None
                if isinstance(obj, dict):
                    t = obj.get("t")
                    if t == "pty_alive":
                        broker.mark_pty_alive(agent_id, bool(obj.get("v")))
                        continue
                    if t == "pong":
                        continue
                    if t == "ping":
                        # agent 应用层心跳 → 立刻回 pong
                        await ws.send_text(make_json("pong"))
                        continue
                if client is not None:
                    await broker.forward_text(ws, client.ws, text)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        logger.exception("agent ws error agent=%s", agent_id)
    finally:
        await broker.unregister_agent(conn)
        logger.info("agent %s disconnected", agent_id)


# ============================================================================
# WSS: client (admin browser)
# ============================================================================


client_ws_router = APIRouter(prefix="/admin/terminal", tags=["admin.terminal.ws"])


@client_ws_router.websocket("/ws")
async def admin_terminal_ws(
    ws: WebSocket,
    token: str = Query(...),
    agent_id: int = Query(...),
) -> None:
    """admin 浏览器接入。鉴权用 query ?token=<session_jwt>&agent_id=<id>。"""
    owner = _decode_session_owner(token)
    if owner is None:
        await ws.close(code=4401, reason="bad session token")
        return

    from db import async_pg  # noqa: PLC0415

    async with async_pg.session() as db_session:
        agent = await AgentRepository(db_session).get_by_id(agent_id)
        if agent is None or agent.owner != owner or agent.revoked_at is not None:
            await ws.close(code=4404, reason="agent not found")
            return
        sess_row = await TerminalSessionRepository(db_session).open(
            agent_id=agent_id,
            owner=owner,
            unlock_method="session",
            voice_transcript=None,
            client_ip=_client_ip_from_ws(ws),
            client_ua=ws.headers.get("user-agent"),
        )
        session_id = sess_row.id

    await ws.accept()
    pair_result = await broker.pair_client(agent_id, session_id, ws)
    if pair_result is None:
        await ws.send_text(make_json("err", message="agent offline"))
        await ws.close(code=4503, reason="agent offline")
        return
    client, reuse_pty = pair_result

    try:
        await ws.send_text(make_json("paired", agent_id=agent_id, resumed=reuse_pty))
        agent_conn0 = broker.get_agent(agent_id)
        if agent_conn0 is not None and not reuse_pty:
            # 全新 session：让 agent 起 pty
            await broker.forward_text(ws, agent_conn0.ws, make_json("client_ready"))
        # reuse_pty 时不发 client_ready —— 之前那个 pty 还在跑，下面用户敲一下就有响应
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            agent_conn = broker.get_agent(agent_id)
            if agent_conn is None:
                await ws.send_text(make_json("err", message="agent disconnected"))
                break
            if "bytes" in msg and msg["bytes"] is not None:
                payload_bytes: bytes = msg["bytes"]
                client.bytes_in += len(payload_bytes)
                await broker.forward_bytes(ws, agent_conn.ws, payload_bytes)
            elif "text" in msg and msg["text"] is not None:
                text = msg["text"]
                # client → server 控制帧：拦 ping，其它透传给 agent
                try:
                    obj = json.loads(text)
                except json.JSONDecodeError:
                    obj = None
                if isinstance(obj, dict) and obj.get("t") == "ping":
                    await ws.send_text(make_json("pong"))
                    continue
                await broker.forward_text(ws, agent_conn.ws, text)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        logger.exception("client ws error session=%s", session_id)
    finally:

        async def _grace_expired() -> None:
            ac = broker.get_agent(agent_id)
            if ac is not None:
                try:
                    await broker.forward_text(ws, ac.ws, make_json("client_gone"))
                except Exception:  # noqa: BLE001
                    pass

        await broker.unregister_client_with_grace(client, _grace_expired)
        async with async_pg.session() as db_session:
            await TerminalSessionRepository(db_session).close(
                session_id,
                bytes_in=client.bytes_in,
                bytes_out=client.bytes_out,
            )
        if ws.application_state != WebSocketState.DISCONNECTED:
            try:
                await ws.close()
            except (RuntimeError, OSError):
                pass


# ============================================================================
# helpers
# ============================================================================


def _extract_bearer(auth_header: str | None) -> str | None:
    if not auth_header:
        return None
    if auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1].strip()
    return None


def _decode_session_owner(token: str) -> str | None:
    """校验 session JWT，返回 username；失败返回 None。

    兼容旧 token（没有 type 字段，老后端签的）——视作 session。
    新签的 token 都带 type=session；step / term / trust 都有显式 type，会被拒。
    """
    secret = config.get("AUTH_JWT_SECRET") or config.get("auth.jwt_secret")
    if not secret:
        raise DetailedHTTPException(500, "server auth misconfigured", "no jwt secret")
    try:
        payload = jwt.decode(token, str(secret), algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None
    tok_type = payload.get("type")
    if tok_type not in (None, "session"):
        return None
    sub = payload.get("sub")
    return sub if isinstance(sub, str) and sub else None


def _agent_ws_base_url() -> str:
    """提示给用户：agent 应该连哪个 WSS。prod = wss://api.tenggouwa.com，dev = ws://localhost。"""
    env = str(config.get("ENV") or "dev")
    if env == "prod":
        return "wss://api.tenggouwa.com/api/agent/ws"
    return "ws://127.0.0.1:10095/api/agent/ws"


def _client_ip_from_ws(ws: WebSocket) -> str | None:
    cf = ws.headers.get("cf-connecting-ip")
    if cf:
        return cf
    xff = ws.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return ws.client.host if ws.client else None


# ============================================================================
# Console 端：公开，自带 voice/TOTP 鉴权
# ============================================================================


console_router = APIRouter(prefix="/console", tags=["console"])


@console_router.get("/phrase", response_model=ResponseModel[dict])
async def console_phrase() -> ResponseModel[dict]:
    """返回当前生效的声纹口令（前端展示用）。公开。"""
    return ResponseModel(data={"phrase": VOICE_PHRASE})


@console_router.post("/unlock", response_model=ResponseModel[ConsoleUnlockResponse])
async def console_unlock(
    payload: ConsoleUnlockRequest,
    request: Request,
    response: Response,
    tg_trust: str | None = Cookie(default=None),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[ConsoleUnlockResponse]:
    unlock_limiter.hit(client_ip(request))  # 挡 TOTP/口令 暴破（与 agent unlock 共用一把闸）
    if payload.method == "voice":
        owner = await terminal_service.unlock_with_voice(
            session,
            payload.voice_transcript,
            tg_trust,
        )
    else:  # totp
        owner = await terminal_service.unlock_with_totp(session, payload.code)
        # TOTP 通过同时种 7d 信任 cookie，下次声纹就能用了
        set_trust_cookie(response, owner)

    agents = await AgentRepository(session).list_by_owner(owner)
    agents_lite = [
        AgentLite(id=a.id, name=a.name, online=broker.agent_online(a.id) and a.revoked_at is None)
        for a in agents
        if a.revoked_at is None
    ]
    term_token = terminal_service.make_term_token(owner)
    return ResponseModel(
        data=ConsoleUnlockResponse(
            term_token=term_token,
            ttl_seconds=TERM_TOKEN_TTL,
            agents=agents_lite,
            phrase=VOICE_PHRASE,
        ),
    )


@console_router.websocket("/ws")
async def console_ws(
    ws: WebSocket,
    token: str = Query(...),
    agent_id: int = Query(...),
) -> None:
    """C 端浏览器接入。query 用 term_token（5min TTL）。"""
    owner = terminal_service.decode_term_token(token)
    if owner is None:
        await ws.close(code=4401, reason="bad term token")
        return

    from db import async_pg  # noqa: PLC0415

    async with async_pg.session() as db_session:
        agent = await AgentRepository(db_session).get_by_id(agent_id)
        if agent is None or agent.owner != owner or agent.revoked_at is not None:
            await ws.close(code=4404, reason="agent not found")
            return
        sess_row = await TerminalSessionRepository(db_session).open(
            agent_id=agent_id,
            owner=owner,
            unlock_method="console",
            voice_transcript=None,
            client_ip=_client_ip_from_ws(ws),
            client_ua=ws.headers.get("user-agent"),
        )
        session_id = sess_row.id

    await ws.accept()
    pair_result = await broker.pair_client(agent_id, session_id, ws)
    if pair_result is None:
        await ws.send_text(make_json("err", message="agent offline"))
        await ws.close(code=4503, reason="agent offline")
        return
    client, reuse_pty = pair_result

    try:
        await ws.send_text(make_json("paired", agent_id=agent_id, resumed=reuse_pty))
        agent_conn0 = broker.get_agent(agent_id)
        if agent_conn0 is not None and not reuse_pty:
            await broker.forward_text(ws, agent_conn0.ws, make_json("client_ready"))
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            agent_conn = broker.get_agent(agent_id)
            if agent_conn is None:
                await ws.send_text(make_json("err", message="agent disconnected"))
                break
            if "bytes" in msg and msg["bytes"] is not None:
                payload_bytes: bytes = msg["bytes"]
                client.bytes_in += len(payload_bytes)
                await broker.forward_bytes(ws, agent_conn.ws, payload_bytes)
            elif "text" in msg and msg["text"] is not None:
                text = msg["text"]
                try:
                    obj = json.loads(text)
                except json.JSONDecodeError:
                    obj = None
                if isinstance(obj, dict) and obj.get("t") == "ping":
                    await ws.send_text(make_json("pong"))
                    continue
                await broker.forward_text(ws, agent_conn.ws, text)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        logger.exception("console ws error session=%s", session_id)
    finally:

        async def _grace_expired() -> None:
            ac = broker.get_agent(agent_id)
            if ac is not None:
                try:
                    await broker.forward_text(ws, ac.ws, make_json("client_gone"))
                except Exception:  # noqa: BLE001
                    pass

        await broker.unregister_client_with_grace(client, _grace_expired)
        async with async_pg.session() as db_session:
            await TerminalSessionRepository(db_session).close(
                session_id,
                bytes_in=client.bytes_in,
                bytes_out=client.bytes_out,
            )
        if ws.application_state != WebSocketState.DISCONNECTED:
            try:
                await ws.close()
            except (RuntimeError, OSError):
                pass
