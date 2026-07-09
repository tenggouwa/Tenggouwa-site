"""私有 agent 通道鉴权：TOTP 解锁 → 长 TTL 的 agent_token（JWT type=agent）。

对话是逐轮 POST，console 的 5min term_token 太短（每 5 分钟要重解锁）。这里签发一个
可配置的更长 TTL token（默认 8h，env AGENT_TOKEN_TTL_MIN 覆盖）：
- 签发：过 TOTP 2FA（复用 terminal_service.unlock_with_totp，扫已启用 admin 校验 6 位码）。
- 校验：只认 type=agent；复用同一个 AUTH_JWT_SECRET。
"""

import hashlib
import os
import secrets
import time

import jwt
from common import config
from fastapi import Header, HTTPException

_DEFAULT_TTL_MIN = 240  # 4h（比 console 5min term_token 长得多、够一次会话）；env AGENT_TOKEN_TTL_MIN 可调


def _ttl_seconds() -> int:
    try:
        minutes = int(os.environ.get("AGENT_TOKEN_TTL_MIN", _DEFAULT_TTL_MIN))
    except ValueError:
        minutes = _DEFAULT_TTL_MIN
    return max(5, minutes) * 60


def _secret() -> str:
    """agent_token 用派生密钥，而非 AUTH_JWT_SECRET 本身。

    否则同密钥签的 agent_token（sub=admin 用户名）会被只认签名+sub 的 current_admin 当成
    admin token 放行，等于公开 TOTP 一步换来全 admin 权限（评审 Critical）。派生后签名对
    current_admin / term / trust 等通道天然无效，彻底隔离。
    """
    base = config.get("AUTH_JWT_SECRET") or config.get("auth.jwt_secret")
    if not base:
        raise HTTPException(status_code=500, detail="server auth misconfigured")
    return hashlib.sha256(f"{base}:agent-token-v1".encode()).hexdigest()


def make_agent_token(owner: str) -> tuple[str, int]:
    """签发 agent_token，返回 (token, ttl_seconds)。"""
    ttl = _ttl_seconds()
    now = int(time.time())
    token = jwt.encode(
        {"sub": owner, "type": "agent", "iat": now, "exp": now + ttl, "jti": secrets.token_hex(8)},
        _secret(),
        algorithm="HS256",
    )
    return token, ttl


def _decode(token: str) -> str | None:
    try:
        payload = jwt.decode(token, _secret(), algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None
    if payload.get("type") != "agent":  # 别把 admin / term / trust token 当 agent 用
        return None
    sub = payload.get("sub")
    return sub if isinstance(sub, str) and sub else None


async def current_agent_owner(authorization: str | None = Header(None)) -> str:
    """私有 agent 通道依赖：校验 `Authorization: Bearer <agent_token>`，返回 owner。"""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    owner = _decode(authorization.split(" ", 1)[1].strip())
    if owner is None:
        raise HTTPException(status_code=401, detail="invalid or expired agent token")
    return owner
