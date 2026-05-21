"""Auth 业务逻辑。

支持两阶段登录：
1) 用户名 / 密码 验证通过
2) 若该账号启用了 TOTP 并且本设备没有有效 `tg_trust` cookie：
   返回 step_token，要求前端调 /api/admin/auth/totp/verify 输 6 位码
3) 否则直接发正式 session JWT

凭证来源（沿用）：

    auth:
      jwt_secret: <random>
      token_ttl_seconds: 86400
      admins:
        - username: tenggouwa
          password_hash: $2b$12$...
"""

import logging
import time

import bcrypt
import jwt
from common import config
from dependencies import DetailedHTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..totp.repository import AdminTotpRepository
from ..totp.service import totp_service
from .schema import LoginRequest, LoginResponse, TotpVerifyResponse

logger = logging.getLogger(__name__)


class AuthService:
    async def login(
        self,
        session: AsyncSession,
        req: LoginRequest,
        trust_cookie: str | None,
    ) -> LoginResponse:
        admin = self._find_admin(req.username)
        if admin is None or not self._verify_password(req.password, admin):
            logger.warning("login failed for user=%s", req.username)
            raise DetailedHTTPException(
                status_code=401,
                detail="账号或密码错误",
                full_detail=f"username={req.username}",
            )

        totp_row = await AdminTotpRepository(session).get(req.username)
        has_totp = bool(totp_row and totp_row.enrolled_at and not totp_row.disabled)
        trust_ok = totp_service.verify_trust_token(trust_cookie, req.username)

        if has_totp and not trust_ok:
            step = totp_service.make_step_token(req.username)
            return LoginResponse(requires_totp=True, step_token=step)

        ttl = self._session_ttl()
        return LoginResponse(
            requires_totp=False,
            token=self._sign_session_jwt(req.username, ttl),
            expires_in=ttl,
        )

    def finalize_totp(self, username: str) -> TotpVerifyResponse:
        ttl = self._session_ttl()
        return TotpVerifyResponse(
            token=self._sign_session_jwt(username, ttl),
            expires_in=ttl,
        )

    # ---- internals ----------------------------------------------------------

    @staticmethod
    def _find_admin(username: str) -> dict | None:
        admins = config.get("auth.admins") or []
        for a in admins:
            if isinstance(a, dict) and a.get("username") == username:
                override = config.get(f"ADMIN_{username.upper()}_PASSWORD_HASH")
                if override:
                    return {**a, "password_hash": override}
                return a
        return None

    @staticmethod
    def _verify_password(password: str, admin: dict) -> bool:
        password_hash = admin.get("password_hash")
        if password_hash:
            try:
                return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
            except ValueError:
                logger.exception("bad password_hash format for user=%s", admin.get("username"))
                return False
        plain = admin.get("password")
        if plain:
            return password == plain
        return False

    @staticmethod
    def _session_ttl() -> int:
        return int(config.get("auth.token_ttl_seconds", 86400) or 86400)

    @classmethod
    def _sign_session_jwt(cls, username: str, ttl: int) -> str:
        secret = config.get("AUTH_JWT_SECRET") or config.get("auth.jwt_secret")
        if not secret:
            raise DetailedHTTPException(
                status_code=500,
                detail="server auth misconfigured",
                full_detail="auth.jwt_secret missing",
            )
        now = int(time.time())
        return jwt.encode(
            {"sub": username, "type": "session", "iat": now, "exp": now + ttl},
            secret,
            algorithm="HS256",
        )


auth_service = AuthService()
