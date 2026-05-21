from pydantic import BaseModel, Field


class TotpStatus(BaseModel):
    enrolled: bool


class TotpEnrollStart(BaseModel):
    secret_b32: str
    provisioning_uri: str  # otpauth://...，前端用它生成二维码


class TotpEnrollVerifyRequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")


class TotpVerifyRequest(BaseModel):
    step_token: str = Field(..., min_length=10)
    code: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")
