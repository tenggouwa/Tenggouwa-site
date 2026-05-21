import logging

from common import config
from db import get_session
from dependencies import current_admin
from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from ..common_schema import ResponseModel
from .repository import AdminTotpRepository
from .schema import TotpEnrollStart, TotpEnrollVerifyRequest, TotpStatus
from .service import TRUST_TTL, totp_service

logger = logging.getLogger(__name__)

TRUST_COOKIE_NAME = "tg_trust"


def set_trust_cookie(response: Response, username: str) -> None:
    """种 7d 信任 cookie。prod 用 SameSite=None+Secure（跨站到 github.io），
    dev 用 SameSite=Lax+无 Secure（http localhost 不允许 secure cookie）。"""
    env = str(config.get("ENV") or "dev")
    is_prod = env == "prod"
    response.set_cookie(
        key=TRUST_COOKIE_NAME,
        value=totp_service.make_trust_token(username),
        max_age=TRUST_TTL,
        secure=is_prod,
        httponly=True,
        samesite="none" if is_prod else "lax",
        path="/",
    )


def clear_trust_cookie(response: Response) -> None:
    env = str(config.get("ENV") or "dev")
    is_prod = env == "prod"
    response.delete_cookie(
        TRUST_COOKIE_NAME,
        path="/",
        samesite="none" if is_prod else "lax",
        secure=is_prod,
    )


router = APIRouter(prefix="/admin/auth/totp", tags=["admin.totp"])


@router.get("/status", response_model=ResponseModel[TotpStatus])
async def status(
    username: str = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[TotpStatus]:
    enrolled = await totp_service.status(session, username)
    return ResponseModel(data=TotpStatus(enrolled=enrolled))


@router.post("/enroll/start", response_model=ResponseModel[TotpEnrollStart])
async def enroll_start(
    username: str = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[TotpEnrollStart]:
    data = await totp_service.enroll_start(session, username)
    return ResponseModel(data=data)


@router.post("/enroll/verify", response_model=ResponseModel[dict])
async def enroll_verify(
    payload: TotpEnrollVerifyRequest,
    response: Response,
    username: str = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[dict]:
    await totp_service.enroll_verify(session, username, payload.code)
    set_trust_cookie(response, username)
    return ResponseModel(data={"enrolled": True})


@router.post("/disable", response_model=ResponseModel[dict])
async def disable(
    response: Response,
    username: str = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[dict]:
    """关闭 TOTP（紧急用，会丢掉信任 cookie）。需要已经登录态。"""
    await AdminTotpRepository(session).delete(username)
    clear_trust_cookie(response)
    return ResponseModel(data={"disabled": True})
