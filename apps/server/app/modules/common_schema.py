"""所有模块共用的响应包装类型。"""

from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class ResponseModel(BaseModel, Generic[T]):
    """统一响应壳。code=0 表示成功，其他值表示业务错误。"""

    code: int = Field(default=0)
    message: str = Field(default="ok")
    data: T | None = None
