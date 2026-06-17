import logging

from db import get_session
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..common_schema import ResponseModel
from .schema import PiReport, PiStatus
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


# 公开只读：前台 /pi 面板轮询
public_router = APIRouter(prefix="/public/pi", tags=["public.pi"])


@public_router.get("/status", response_model=ResponseModel[PiStatus])
async def status(session: AsyncSession = Depends(get_session)) -> ResponseModel[PiStatus]:
    return ResponseModel(data=await pi_service.status(session))


def _bearer(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return authorization[7:].strip()
