"""Password-only, read-only mail portal with a separate cookie and signing key."""

import hashlib
import hmac
import time
from datetime import datetime

import bcrypt
import jwt
from common import config
from common.rate_limit import AttemptLimiter, client_ip
from db import get_session
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from ..common_schema import ResponseModel
from .schema import LatestCodeResult, MailInboxItem, MailMessageItem
from .service import mail_service

COOKIE = "tg_mail_session"
TTL = 8 * 60 * 60
login_limiter = AttemptLimiter(per_ip=6, ip_window=60, total=30, total_window=60)


class MailPortalLogin(BaseModel):
    password: str = Field(min_length=1, max_length=72)


def signing_key() -> bytes:
    password_hash = config.get("MAIL_PORTAL_PASSWORD_HASH")
    secret = config.get("AUTH_JWT_SECRET") or config.get("auth.jwt_secret")
    if not password_hash or not secret:
        raise HTTPException(503, "接码入口尚未启用")
    return hmac.digest(str(secret).encode(), f"mail-portal:{password_hash}".encode(), hashlib.sha256)


def require_mail_session(request: Request, response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    key = signing_key()
    try:
        claims = jwt.decode(
            request.cookies.get(COOKIE, ""),
            key,
            algorithms=["HS256"],
            audience="mail-portal",
            options={"require": ["exp", "iat", "sub", "aud"]},
        )
        if claims["sub"] != "mail-reader":
            raise jwt.InvalidTokenError("invalid subject")
    except jwt.InvalidTokenError as exc:
        raise HTTPException(401, "请使用访问密码登录") from exc


def require_portal_request(request: Request, response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    # A custom header forces cross-origin browser writes through the configured CORS preflight.
    if request.method == "POST" and request.headers.get("x-mail-portal") != "1":
        raise HTTPException(403, "invalid portal request")


router = APIRouter(prefix="/mail", tags=["mail.portal"], dependencies=[Depends(require_portal_request)])
reader = APIRouter(dependencies=[Depends(require_mail_session)])


@router.post("/login", response_model=ResponseModel[bool])
async def login(payload: MailPortalLogin, request: Request, response: Response) -> ResponseModel[bool]:
    login_limiter.hit(client_ip(request))
    key = signing_key()
    try:
        valid = await run_in_threadpool(
            bcrypt.checkpw, payload.password.encode(), str(config.get("MAIL_PORTAL_PASSWORD_HASH")).encode()
        )
    except ValueError:
        valid = False
    if not valid:
        raise HTTPException(401, "访问密码错误")
    now = int(time.time())
    token = jwt.encode(
        {"sub": "mail-reader", "aud": "mail-portal", "iat": now, "exp": now + TTL}, key, algorithm="HS256"
    )
    response.set_cookie(
        COOKIE,
        token,
        max_age=TTL,
        httponly=True,
        secure=request.url.hostname not in {"localhost", "127.0.0.1", "testserver"},
        samesite="lax",
        path="/api/mail",
    )
    return ResponseModel(data=True)


@router.post("/logout", response_model=ResponseModel[bool])
async def logout(response: Response) -> ResponseModel[bool]:
    response.delete_cookie(COOKIE, path="/api/mail", httponly=True, samesite="lax")
    return ResponseModel(data=True)


@reader.get("/inboxes", response_model=ResponseModel[list[MailInboxItem]])
async def inboxes(session: AsyncSession = Depends(get_session)) -> ResponseModel[list[MailInboxItem]]:
    return ResponseModel(data=await mail_service.list_inboxes(session))


@reader.get("/{mailbox}/messages", response_model=ResponseModel[list[MailMessageItem]])
async def messages(
    mailbox: str,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[list[MailMessageItem]]:
    return ResponseModel(data=await mail_service.list_messages(session, mailbox, limit=limit, offset=offset))


@reader.get("/{mailbox}/latest-code", response_model=ResponseModel[LatestCodeResult])
async def latest_code(
    mailbox: str,
    request: Request,
    response: Response,
    since: datetime | None = Query(default=None),
    wait: float = Query(default=0, ge=0, le=25),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[LatestCodeResult]:
    result = await mail_service.latest_code(session, mailbox, since=since, wait_seconds=wait)
    require_mail_session(request, response)
    return ResponseModel(data=result)


router.include_router(reader)
