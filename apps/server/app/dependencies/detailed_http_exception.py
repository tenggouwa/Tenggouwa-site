from fastapi import HTTPException


class DetailedHTTPException(HTTPException):
    """带有完整错误详情的 HTTPException，便于在统一异常中间件中输出更丰富的上下文。"""

    def __init__(self, status_code: int, detail: str, full_detail: str):
        super().__init__(status_code=status_code, detail=detail)
        self.full_detail = full_detail

    @classmethod
    def handle_exception(cls, detail: str, e: Exception) -> "DetailedHTTPException":
        status_code = 400 if isinstance(e, ValueError) else 500
        return DetailedHTTPException(status_code=status_code, detail=detail, full_detail=f"{e.__class__.__name__}: {e}")
