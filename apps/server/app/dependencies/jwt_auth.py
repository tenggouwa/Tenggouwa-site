"""JWT 鉴权依赖。

签发 / 校验逻辑都在 `modules.auth.service.AuthService` 里；这里只暴露 FastAPI
依赖函数 `current_admin`，让 `/api/admin/**` 路由可以一行注入：

    @router.get("", dependencies=[Depends(current_admin)])
"""

import logging

import jwt
from common import config
from fastapi import Header, HTTPException, Request

logger = logging.getLogger(__name__)


async def current_admin(
    request: Request,
    authorization: str | None = Header(None),
) -> str:
    """校验 `Authorization: Bearer <jwt>` 并返回 admin 用户名。"""
    if request.method == "OPTIONS":
        return ""

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")

    token = authorization.split(" ", 1)[1].strip()
    secret = config.get("AUTH_JWT_SECRET") or config.get("auth.jwt_secret")
    if not secret:
        logger.error("auth.jwt_secret is not configured")
        raise HTTPException(status_code=500, detail="server auth misconfigured")

    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(status_code=401, detail="token expired") from e
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail="invalid token") from e

    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub:
        raise HTTPException(status_code=401, detail="invalid token payload")
    return sub
