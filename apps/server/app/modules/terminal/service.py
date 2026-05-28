"""Terminal 服务：agent token / term token + console 解锁规则。

token 类型：
- agent_token：长期、Mac agent 用 Bearer 接入 WSS（sha256 入库）
- term_token：5min JWT type=term sub=admin_username，C 端 console 用
"""

import hashlib
import logging
import secrets
import time

import jwt
import pyotp
from common import config
from db.models import AdminTotpRow
from dependencies import DetailedHTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..totp.repository import AdminTotpRepository
from ..totp.service import totp_service
from .repository import AgentRepository

logger = logging.getLogger(__name__)

TERM_TOKEN_TTL = 5 * 60  # 5 min
VOICE_PHRASE = "芝麻开门"  # 仪式口令


class TerminalService:
    # ---- agent token --------------------------------------------------------

    @staticmethod
    def issue_agent_token() -> tuple[str, str]:
        raw = secrets.token_urlsafe(32)
        sha = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        return raw, sha

    @staticmethod
    def hash_token(raw: str) -> str:
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    # ---- term token (console) ----------------------------------------------

    @classmethod
    def make_term_token(cls, owner: str) -> str:
        secret = cls._jwt_secret()
        now = int(time.time())
        return jwt.encode(
            {
                "sub": owner,
                "type": "term",
                "iat": now,
                "exp": now + TERM_TOKEN_TTL,
                "jti": secrets.token_hex(8),
            },
            secret,
            algorithm="HS256",
        )

    @classmethod
    def decode_term_token(cls, token: str) -> str | None:
        secret = cls._jwt_secret()
        try:
            payload = jwt.decode(token, secret, algorithms=["HS256"])
        except jwt.InvalidTokenError:
            return None
        if payload.get("type") != "term":
            return None
        sub = payload.get("sub")
        return sub if isinstance(sub, str) and sub else None

    # ---- console 解锁 -------------------------------------------------------

    async def unlock_with_voice(
        self,
        session: AsyncSession,
        voice_transcript: str | None,
        trust_cookie: str | None,
    ) -> str:
        """声纹路径：(a) 7d 信任 cookie 有效 (b) 文本匹配口令。返回 admin username。"""
        owner = totp_service.username_from_trust_token(trust_cookie)
        if owner is None:
            raise DetailedHTTPException(
                403,
                "本设备未通过 TOTP（7 天信任未生效），请用 TOTP 解锁",
                "trust cookie missing or invalid",
            )
        if not _phrase_matches(voice_transcript or "", VOICE_PHRASE):
            raise DetailedHTTPException(
                403,
                f'口令不对，请念："{VOICE_PHRASE}"',
                f"voice phrase mismatch: {voice_transcript!r}",
            )
        # 校验 admin 仍然启用 TOTP
        row = await AdminTotpRepository(session).get(owner)
        if row is None or row.enrolled_at is None or row.disabled:
            raise DetailedHTTPException(403, "admin TOTP 已禁用", f"owner={owner}")
        return owner

    async def unlock_with_totp(
        self,
        session: AsyncSession,
        code: str | None,
    ) -> str:
        """TOTP 路径：扫所有启用的 admin，找到第一个 code 匹配的。返回 admin username。"""
        if not code or len(code) != 6 or not code.isdigit():
            raise DetailedHTTPException(400, "请输入 6 位数字", "bad code shape")
        stmt = select(AdminTotpRow).where(
            AdminTotpRow.enrolled_at.is_not(None),
            AdminTotpRow.disabled.is_(False),
        )
        rows = (await session.execute(stmt)).scalars().all()
        for r in rows:
            if pyotp.TOTP(r.secret_b32).verify(code, valid_window=1):
                await AdminTotpRepository(session).touch_verified(r.username)
                return r.username
        raise DetailedHTTPException(403, "验证码错误", "code mismatch")

    async def verify_agent_owns(
        self,
        session: AsyncSession,
        owner: str,
        agent_id: int,
    ) -> None:
        agent = await AgentRepository(session).get_by_id(agent_id)
        if agent is None or agent.owner != owner or agent.revoked_at is not None:
            raise DetailedHTTPException(404, "agent 不存在或已撤销", f"agent_id={agent_id}")

    # ---- internals ----------------------------------------------------------

    @staticmethod
    def _jwt_secret() -> str:
        secret = config.get("AUTH_JWT_SECRET") or config.get("auth.jwt_secret")
        if not secret:
            raise DetailedHTTPException(500, "server auth misconfigured", "no jwt secret")
        return str(secret)


def _phrase_matches(transcript: str, expected: str) -> bool:
    """宽松匹配：去标点 / 空格后包含即可。"""
    norm = "".join(ch for ch in transcript if ch.isalnum())
    return expected in norm or expected in transcript


terminal_service = TerminalService()
