"""内存 WSS broker：把一个 client 会话和一个 agent 串成双向通路。

约定：
- 每个 agent 最多 1 个活动连接（重复连接踢旧）
- 每个 agent 最多 1 个 client 配对（新 client 进来踢旧）
- 文本帧 = 控制消息 (JSON)；二进制帧 = pty IO 字节
- **pty grace 期**：客户端 WS 断开后，broker 不立刻让 agent 杀 pty——
  等 GRACE_SECONDS 内有新 client 重新配对就接管，pty 保持复用，
  实现"网络抖一下重新打开终端命令历史还在"的体验。
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect, WebSocketState

logger = logging.getLogger(__name__)

GRACE_SECONDS = 30


@dataclass
class AgentConn:
    agent_id: int
    ws: WebSocket
    paired_client: ClientConn | None = None
    pty_alive: bool = False
    grace_task: asyncio.Task | None = None
    closed: asyncio.Event = field(default_factory=asyncio.Event)


@dataclass
class ClientConn:
    session_id: int
    agent_id: int
    ws: WebSocket
    bytes_in: int = 0
    bytes_out: int = 0
    closed: asyncio.Event = field(default_factory=asyncio.Event)


class Broker:
    def __init__(self) -> None:
        self._agents: dict[int, AgentConn] = {}
        self._clients_by_session: dict[int, ClientConn] = {}
        self._lock = asyncio.Lock()

    # ---- agent side ---------------------------------------------------------

    async def register_agent(self, agent_id: int, ws: WebSocket) -> AgentConn:
        async with self._lock:
            old = self._agents.get(agent_id)
            if old is not None and old.ws is not ws:
                logger.info("agent %s reconnecting, kicking old conn", agent_id)
                old.closed.set()
                await _safe_close(old.ws, code=4000, reason="superseded")
                if old.paired_client is not None:
                    old.paired_client.closed.set()
                    await _safe_close(old.paired_client.ws, code=4001, reason="agent reconnect")
                if old.grace_task is not None and not old.grace_task.done():
                    old.grace_task.cancel()
            new = AgentConn(agent_id=agent_id, ws=ws)
            self._agents[agent_id] = new
            return new

    async def unregister_agent(self, conn: AgentConn) -> None:
        async with self._lock:
            current = self._agents.get(conn.agent_id)
            if current is conn:
                self._agents.pop(conn.agent_id, None)
                if conn.paired_client is not None:
                    conn.paired_client.closed.set()
                    await _safe_close(conn.paired_client.ws, code=4002, reason="agent offline")
                if conn.grace_task is not None and not conn.grace_task.done():
                    conn.grace_task.cancel()
            conn.closed.set()

    def agent_online(self, agent_id: int) -> bool:
        return agent_id in self._agents

    def get_agent(self, agent_id: int) -> AgentConn | None:
        return self._agents.get(agent_id)

    def mark_pty_alive(self, agent_id: int, alive: bool) -> None:
        agent = self._agents.get(agent_id)
        if agent is not None:
            agent.pty_alive = alive

    # ---- client side --------------------------------------------------------

    async def pair_client(
        self,
        agent_id: int,
        session_id: int,
        ws: WebSocket,
    ) -> tuple[ClientConn, bool] | None:
        """配对新 client。返回 (ClientConn, reuse_pty)；agent 不在线返回 None。

        reuse_pty=True 表示 agent 上有 grace 期没杀的 pty，直接复用。
        """
        async with self._lock:
            agent = self._agents.get(agent_id)
            if agent is None:
                return None
            reuse = False
            if agent.grace_task is not None and not agent.grace_task.done():
                agent.grace_task.cancel()
                agent.grace_task = None
                reuse = agent.pty_alive
            elif agent.pty_alive:
                reuse = True
            if agent.paired_client is not None:
                logger.info("agent %s replacing previous client session", agent_id)
                old = agent.paired_client
                old.closed.set()
                await _safe_close(old.ws, code=4003, reason="superseded by new session")
                self._clients_by_session.pop(old.session_id, None)
            client = ClientConn(session_id=session_id, agent_id=agent_id, ws=ws)
            agent.paired_client = client
            self._clients_by_session[session_id] = client
            return client, reuse

    async def unregister_client_with_grace(
        self,
        conn: ClientConn,
        on_grace_expired: Callable[[], Awaitable[None]],
    ) -> None:
        """客户端 WS 断开后调用。立刻解配对，但 grace 期内不杀 pty。"""
        async with self._lock:
            agent = self._agents.get(conn.agent_id)
            if agent is not None and agent.paired_client is conn:
                agent.paired_client = None
                if agent.grace_task is not None and not agent.grace_task.done():
                    agent.grace_task.cancel()
                agent.grace_task = asyncio.create_task(
                    _wait_then(agent, GRACE_SECONDS, on_grace_expired),
                )
            self._clients_by_session.pop(conn.session_id, None)
            conn.closed.set()

    # ---- forwarding helpers -------------------------------------------------

    @staticmethod
    async def forward_text(src: WebSocket, dst: WebSocket, message: str) -> None:
        if dst.application_state == WebSocketState.CONNECTED:
            await dst.send_text(message)

    @staticmethod
    async def forward_bytes(src: WebSocket, dst: WebSocket, data: bytes) -> None:
        if dst.application_state == WebSocketState.CONNECTED:
            await dst.send_bytes(data)


broker = Broker()


async def _wait_then(
    agent: AgentConn,
    seconds: int,
    callback: Callable[[], Awaitable[None]],
) -> None:
    try:
        await asyncio.sleep(seconds)
        if agent.paired_client is None:
            logger.info("pty grace expired for agent %s", agent.agent_id)
            agent.pty_alive = False
            await callback()
    except asyncio.CancelledError:
        pass


async def _safe_close(ws: WebSocket, code: int = 1000, reason: str = "") -> None:
    try:
        if ws.application_state != WebSocketState.DISCONNECTED:
            await ws.close(code=code, reason=reason)
    except (RuntimeError, WebSocketDisconnect, OSError):
        pass


def make_json(t: str, **kwargs) -> str:
    return json.dumps({"t": t, **kwargs}, ensure_ascii=False)
