import logging

from dependencies import DetailedHTTPException
from fastapi import HTTPException
from modules.common_schema import ResponseModel
from starlette.middleware.base import BaseHTTPMiddleware, DispatchFunction, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp


class GlobalExceptionMiddleware(BaseHTTPMiddleware):
    """全局异常捕获中间件：将未捕获异常统一转换为 ResponseModel 格式返回。"""

    def __init__(self, app: ASGIApp, dispatch: DispatchFunction | None = None):
        super().__init__(app, dispatch=dispatch)
        self.logger = logging.getLogger("uvicorn.error")

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        try:
            return await call_next(request)
        except DetailedHTTPException as e:
            self.logger.exception("Detailed HTTP exception occurred")
            return JSONResponse(
                status_code=e.status_code,
                content=ResponseModel[dict](
                    code=e.status_code, message=e.detail, data={"detail": e.full_detail}
                ).model_dump(),
            )
        except HTTPException as e:
            self.logger.exception("HTTP exception occurred")
            return JSONResponse(
                status_code=e.status_code,
                content=ResponseModel[dict](code=e.status_code, message=str(e.detail), data=None).model_dump(),
            )
        except Exception as e:  # noqa: BLE001
            self.logger.exception("Unhandled exception occurred")
            return JSONResponse(
                status_code=500,
                content=ResponseModel[dict](
                    code=500, message="Internal server error", data={"detail": str(e)}
                ).model_dump(),
            )
