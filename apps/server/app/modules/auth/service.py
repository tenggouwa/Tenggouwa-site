"""Auth 业务逻辑。

凭证存放在配置里：

    auth:
      jwt_secret: <random>
      token_ttl_seconds: 86400
      admins:
        - username: tenggouwa
          # 用 `python -c "import bcrypt;print(bcrypt.hashpw(b'YOUR_PWD', bcrypt.gensalt()).decode())"` 生成
          password_hash: $2b$12$...

允许用纯文本密码（仅 dev）通过 `password` 字段，避免本地起服务还要 bcrypt：
    admins:
      - username: dev
        password: dev123
"""

import logging
import time

import bcrypt
import jwt
from common import config
from dependencies import DetailedHTTPException

from .schema import LoginRequest, LoginResponse

logger = logging.getLogger(__name__)


class AuthService:
    def login(self, req: LoginRequest) -> LoginResponse:
        admin = self._find_admin(req.username)
        if admin is None or not self._verify_password(req.password, admin):
            logger.warning("login failed for user=%s", req.username)
            raise DetailedHTTPException(
                status_code=401,
                detail="账号或密码错误",
                full_detail=f"username={req.username}",
            )
        ttl = int(config.get("auth.token_ttl_seconds", 86400) or 86400)
        token = self._sign_jwt(req.username, ttl)
        return LoginResponse(token=token, expires_in=ttl)

    @staticmethod
    def _find_admin(username: str) -> dict | None:
        admins = config.get("auth.admins") or []
        for a in admins:
            if isinstance(a, dict) and a.get("username") == username:
                return a
        return None

    @staticmethod
    def _verify_password(password: str, admin: dict) -> bool:
        # 优先 bcrypt 哈希
        password_hash = admin.get("password_hash")
        if password_hash:
            try:
                return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
            except ValueError:
                logger.exception("bad password_hash format for user=%s", admin.get("username"))
                return False
        # dev fallback: 明文密码
        plain = admin.get("password")
        if plain:
            return password == plain
        return False

    @staticmethod
    def _sign_jwt(username: str, ttl: int) -> str:
        secret = config.get("auth.jwt_secret")
        if not secret:
            raise DetailedHTTPException(
                status_code=500,
                detail="server auth misconfigured",
                full_detail="auth.jwt_secret missing",
            )
        now = int(time.time())
        payload = {"sub": username, "iat": now, "exp": now + ttl}
        return jwt.encode(payload, secret, algorithm="HS256")


auth_service = AuthService()
