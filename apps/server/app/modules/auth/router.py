import logging

from db import get_session
from fastapi import APIRouter, Cookie, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from ..common_schema import ResponseModel
from ..totp.router import clear_trust_cookie, set_trust_cookie
from ..totp.service import totp_service
from .schema import LoginRequest, LoginResponse, TotpVerifyRequest, TotpVerifyResponse
from .service import auth_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/auth", tags=["admin.auth"])


@router.post("/login", response_model=ResponseModel[LoginResponse])
async def login(
    payload: LoginRequest,
    tg_trust: str | None = Cookie(default=None),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[LoginResponse]:
    """两阶段登录入口。详见 service。"""
    resp = await auth_service.login(session, payload, tg_trust)
    return ResponseModel(data=resp)


@router.post("/totp/verify", response_model=ResponseModel[TotpVerifyResponse])
async def totp_verify(
    payload: TotpVerifyRequest,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[TotpVerifyResponse]:
    """登录流第二阶段：拿 step_token + 6 位码换正式 session JWT，同时种 7d 信任 cookie。"""
    username = await totp_service.verify_step_and_code(session, payload.step_token, payload.code)
    final = auth_service.finalize_totp(username)
    set_trust_cookie(response, username)
    return ResponseModel(data=final)


@router.post("/logout-trust", response_model=ResponseModel[dict])
async def logout_trust(response: Response) -> ResponseModel[dict]:
    """清掉本设备的 7d 信任 cookie，下次登录必须 TOTP。"""
    clear_trust_cookie(response)
    return ResponseModel(data={"cleared": True})
