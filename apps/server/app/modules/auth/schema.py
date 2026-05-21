from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)


class LoginResponse(BaseModel):
    """两阶段登录的统一响应。

    - `requires_totp = false` → 直接拿 token 即可（未启用 TOTP 或 trust cookie 有效）
    - `requires_totp = true`  → 用 step_token 调 /totp/verify 拿正式 token
    """

    requires_totp: bool
    token: str | None = None
    expires_in: int | None = None
    step_token: str | None = None


class TotpVerifyRequest(BaseModel):
    step_token: str = Field(..., min_length=10)
    code: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")


class TotpVerifyResponse(BaseModel):
    token: str
    expires_in: int
