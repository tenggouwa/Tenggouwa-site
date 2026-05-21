"""TOTP 业务逻辑。

JWT token 类型约定：
- type=session：常规 24h 访问令牌（已有用法，沿用）
- type=step：login 第一阶段产物，5min TTL，只能用于 /totp/verify
- type=trust：HttpOnly cookie 里，7d TTL，证明"这台设备最近 TOTP 通过过"
"""

import logging
import time

import jwt
import pyotp
from common import config
from dependencies import DetailedHTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from .repository import AdminTotpRepository
from .schema import TotpEnrollStart

logger = logging.getLogger(__name__)

ISSUER = "tenggouwa.com"
STEP_TTL = 5 * 60           # 5 min
TRUST_TTL = 7 * 86400        # 7 day


class TotpService:
    async def status(self, session: AsyncSession, username: str) -> bool:
        row = await AdminTotpRepository(session).get(username)
        return bool(row and row.enrolled_at and not row.disabled)

    async def enroll_start(self, session: AsyncSession, username: str) -> TotpEnrollStart:
        secret = pyotp.random_base32()
        await AdminTotpRepository(session).upsert_pending(username, secret)
        uri = pyotp.totp.TOTP(secret).provisioning_uri(name=username, issuer_name=ISSUER)
        return TotpEnrollStart(secret_b32=secret, provisioning_uri=uri)

    async def enroll_verify(self, session: AsyncSession, username: str, code: str) -> None:
        row = await AdminTotpRepository(session).get(username)
        if row is None:
            raise DetailedHTTPException(
                status_code=400,
                detail="未生成 TOTP，请先 /enroll/start",
                full_detail="no totp row",
            )
        if not pyotp.TOTP(row.secret_b32).verify(code, valid_window=1):
            raise DetailedHTTPException(
                status_code=401,
                detail="验证码错误",
                full_detail=f"enroll verify failed for {username}",
            )
        await AdminTotpRepository(session).mark_enrolled(username)

    async def verify_step_and_code(
        self,
        session: AsyncSession,
        step_token: str,
        code: str,
    ) -> str:
        """校验 step_token + code；通过则返回 username。"""
        secret_key = self._jwt_secret()
        try:
            payload = jwt.decode(step_token, secret_key, algorithms=["HS256"])
        except jwt.ExpiredSignatureError as e:
            raise DetailedHTTPException(401, "登录步骤超时，请重新登录", "step expired") from e
        except jwt.InvalidTokenError as e:
            raise DetailedHTTPException(401, "步骤令牌无效", "step invalid") from e
        if payload.get("type") != "step":
            raise DetailedHTTPException(401, "步骤令牌类型不对", "wrong type")
        username = payload.get("sub")
        if not isinstance(username, str):
            raise DetailedHTTPException(401, "步骤令牌缺少 sub", "no sub")

        row = await AdminTotpRepository(session).get(username)
        if row is None or row.enrolled_at is None or row.disabled:
            raise DetailedHTTPException(401, "该账号未启用 TOTP", "not enrolled")
        if not pyotp.TOTP(row.secret_b32).verify(code, valid_window=1):
            raise DetailedHTTPException(401, "验证码错误", f"verify failed for {username}")
        await AdminTotpRepository(session).touch_verified(username)
        return username

    # ---- JWT helpers --------------------------------------------------------

    @staticmethod
    def _jwt_secret() -> str:
        secret = config.get("AUTH_JWT_SECRET") or config.get("auth.jwt_secret")
        if not secret:
            raise DetailedHTTPException(500, "server auth misconfigured", "no jwt secret")
        return str(secret)

    @classmethod
    def make_step_token(cls, username: str) -> str:
        now = int(time.time())
        return jwt.encode(
            {"sub": username, "type": "step", "iat": now, "exp": now + STEP_TTL},
            cls._jwt_secret(),
            algorithm="HS256",
        )

    @classmethod
    def make_trust_token(cls, username: str) -> str:
        now = int(time.time())
        return jwt.encode(
            {"sub": username, "type": "trust", "iat": now, "exp": now + TRUST_TTL},
            cls._jwt_secret(),
            algorithm="HS256",
        )

    @classmethod
    def verify_trust_token(cls, token: str | None, username: str) -> bool:
        if not token:
            return False
        try:
            payload = jwt.decode(token, cls._jwt_secret(), algorithms=["HS256"])
        except jwt.InvalidTokenError:
            return False
        if payload.get("type") != "trust":
            return False
        return payload.get("sub") == username

    @classmethod
    def username_from_trust_token(cls, token: str | None) -> str | None:
        """解 trust cookie 拿 username（不绑定具体账号校验，用于"任意管理员的 cookie 都行"）。"""
        if not token:
            return None
        try:
            payload = jwt.decode(token, cls._jwt_secret(), algorithms=["HS256"])
        except jwt.InvalidTokenError:
            return None
        if payload.get("type") != "trust":
            return None
        sub = payload.get("sub")
        return sub if isinstance(sub, str) and sub else None


totp_service = TotpService()
