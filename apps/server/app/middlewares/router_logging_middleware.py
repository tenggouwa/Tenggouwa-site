import logging
import time
from urllib.parse import unquote

from common import RouteTraceContextFilter, config
from starlette.middleware.base import BaseHTTPMiddleware, DispatchFunction, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp


class RouterLoggingMiddleware(BaseHTTPMiddleware):
    """请求访问日志中间件。

    - 记录 request_id、user_id 等追踪头到日志上下文
    - 输出统一格式的 access 日志（由 AccessFormatter 渲染）
    - 对请求体/表单/查询参数做截断，避免日志爆炸
    """

    def __init__(self, app: ASGIApp, dispatch: DispatchFunction | None = None, max_param_length: int = 100):
        super().__init__(app, dispatch=dispatch)
        self.logger = logging.getLogger("access")
        self.max_param_length = max_param_length

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        start_time = time.perf_counter()
        response: Response | None = None
        request_params: dict = {}

        # 保存设置新上下文的 token，用于后续恢复
        token = RouteTraceContextFilter.route_trace_context.set({})

        try:
            if request.headers.get("content-type", "").startswith("multipart/form-data"):
                request_params = await self._get_url_params(request)
            else:
                request_params = await self._get_request_params(request)

            # 设置上下文值
            trace_headers = config.get("logger.route_trace_context.headers", {})
            for key, value in trace_headers.items():
                RouteTraceContextFilter.set_context_value(key, request.headers.get(value, "-"))

            response = await call_next(request)
            return response
        finally:
            try:
                request_time = time.perf_counter() - start_time
                status = response.status_code if response else 500
                body_bytes_sent = response.headers.get("content-length", "0") if response else "0"

                self.logger.info(
                    "",
                    extra={
                        "remote_addr": request.headers.get("X-Forwarded-For", request.client.host),
                        "remote_user": "-",
                        "http_host": request.headers.get("host", "-"),
                        "request_method": request.method,
                        "request_uri": request.url.path,
                        "http_version": request.scope["http_version"],
                        "status": status,
                        "request_id": request.headers.get("x-request-id", "-"),
                        "user_id": request.headers.get("x-user-id", "-"),
                        "request_length": request.headers.get("content-length", "0"),
                        "body_bytes_sent": body_bytes_sent,
                        "request_time": f"{request_time:.3f}",
                        "http_referer": request.headers.get("referer", "-"),
                        "http_user_agent": request.headers.get("user-agent", "-"),
                        "request_params": request_params,
                    },
                )
            finally:
                RouteTraceContextFilter.route_trace_context.reset(token)

    async def _get_request_params(self, request: Request) -> dict:
        """获取并截断请求参数，限制单值长度避免日志膨胀。"""
        params: dict = {}

        for key, value in request.query_params.items():
            params[key] = self._truncate_param(value)

        if request.method in ["POST", "PUT", "PATCH"] and request.headers.get("content-type") == "application/json":
            try:
                json_body = await request.json()
                if isinstance(json_body, dict):
                    for key, value in json_body.items():
                        params[key] = self._truncate_param(str(value))
            except Exception:  # noqa: BLE001, S110
                pass

        elif request.method in ["POST", "PUT", "PATCH"]:
            try:
                form = await request.form()
                for key, value in form.items():
                    params[key] = self._truncate_param(str(value))
            except Exception:  # noqa: BLE001, S110
                pass

        return params

    async def _get_url_params(self, request: Request) -> dict:
        return {key: self._truncate_param(unquote(value)) for key, value in request.query_params.items()}

    def _truncate_param(self, value: str) -> str:
        value = value.replace('"', '\\"').replace("\n", "\\n")
        if len(value) > self.max_param_length:
            return value[: self.max_param_length] + "..."
        return value
