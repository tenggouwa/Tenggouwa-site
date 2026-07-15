import logging

from db import get_session
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..common_schema import ResponseModel
from .exec import pi_exec
from .schema import (
    PiArtifact,
    PiArtifactReport,
    PiExecChunk,
    PiExecCommand,
    PiExecPollResponse,
    PiExecResult,
    PiProbe,
    PiProbeReport,
    PiReport,
    PiStatus,
)
from .service import pi_service

logger = logging.getLogger(__name__)

# pi-agent 上报：树莓派主动 POST，鉴权用 Authorization: Bearer <PI_AGENT_TOKEN>
agent_router = APIRouter(prefix="/agent/pi", tags=["agent.pi"])


@agent_router.post("/report", response_model=ResponseModel[dict])
async def report(
    payload: PiReport,
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[dict]:
    if not pi_service.verify_token(_bearer(authorization)):
        raise HTTPException(status_code=401, detail="invalid pi agent token")
    await pi_service.ingest(session, payload)
    return ResponseModel(data={"ok": True})


@agent_router.post("/artifact", response_model=ResponseModel[dict])
async def artifact(
    payload: PiArtifactReport,
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[dict]:
    """Pi 上报每日产物（如它自己算的 ASCII 曼德博集合）。"""
    if not pi_service.verify_token(_bearer(authorization)):
        raise HTTPException(status_code=401, detail="invalid pi agent token")
    await pi_service.ingest_artifact(session, payload)
    return ResponseModel(data={"ok": True})


@agent_router.post("/probe", response_model=ResponseModel[dict])
async def probe(
    payload: list[PiProbeReport],
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[dict]:
    """Pi 上报一轮监控探针结果（HTTP 延迟 / 下行吞吐等）。"""
    if not pi_service.verify_token(_bearer(authorization)):
        raise HTTPException(status_code=401, detail="invalid pi agent token")
    await pi_service.ingest_probes(session, payload)
    return ResponseModel(data={"ok": True})


@agent_router.get("/exec-poll", response_model=ResponseModel[PiExecPollResponse])
async def exec_poll(
    authorization: str | None = Header(default=None),
) -> ResponseModel[PiExecPollResponse]:
    """Pi 长轮询：取一条待执行命令（最多挂 25s，无命令返回 command=null）。"""
    if not pi_service.verify_token(_bearer(authorization)):
        raise HTTPException(status_code=401, detail="invalid pi agent token")
    cmd = await pi_exec.poll()
    return ResponseModel(data=PiExecPollResponse(command=PiExecCommand(**cmd) if cmd else None))


@agent_router.post("/exec-result", response_model=ResponseModel[dict])
async def exec_result(
    payload: PiExecResult,
    authorization: str | None = Header(default=None),
) -> ResponseModel[dict]:
    """Pi 回传命令执行结果，唤醒等待的 shell_exec。"""
    if not pi_service.verify_token(_bearer(authorization)):
        raise HTTPException(status_code=401, detail="invalid pi agent token")
    ok = pi_exec.deliver(payload.id, payload.model_dump())
    return ResponseModel(data={"ok": ok})


@agent_router.post("/exec-chunk", response_model=ResponseModel[dict])
async def exec_chunk(
    payload: PiExecChunk,
    authorization: str | None = Header(default=None),
) -> ResponseModel[dict]:
    """Pi 边跑边推的一块流式输出 → 转给等待的 shell_exec 实时显示。"""
    if not pi_service.verify_token(_bearer(authorization)):
        raise HTTPException(status_code=401, detail="invalid pi agent token")
    ok = pi_exec.deliver_chunk(payload.id, payload.chunk)
    return ResponseModel(data={"ok": ok})


# 公开只读：前台 /pi 面板轮询
public_router = APIRouter(prefix="/public/pi", tags=["public.pi"])


@public_router.get("/status", response_model=ResponseModel[PiStatus])
async def status(session: AsyncSession = Depends(get_session)) -> ResponseModel[PiStatus]:
    return ResponseModel(data=await pi_service.status(session))


@public_router.get("/artifact", response_model=ResponseModel[PiArtifact | None])
async def get_artifact(session: AsyncSession = Depends(get_session)) -> ResponseModel[PiArtifact | None]:
    """前台展示 Pi 最新每日产物；还没有就返回 null。"""
    return ResponseModel(data=await pi_service.get_artifact(session))


@public_router.get("/probes", response_model=ResponseModel[list[PiProbe]])
async def get_probes(session: AsyncSession = Depends(get_session)) -> ResponseModel[list[PiProbe]]:
    """前台展示各监控探针目标的当前状态 + 历史序列。"""
    return ResponseModel(data=await pi_service.get_probes(session))


def _bearer(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return authorization[7:].strip()
