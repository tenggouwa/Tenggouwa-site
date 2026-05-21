import contextvars
import logging

from common import config


class RouteTraceContextFilter(logging.Filter):
    """路由追踪上下文日志过滤器。

    将请求上下文（如 request_id, user_id 等）透传到当前异步任务的日志中，
    使得一次请求的所有日志可以通过统一的追踪 ID 串联起来。
    """

    logger = logging.getLogger(__name__)
    # 为每个任务创建独立的上下文
    route_trace_context: contextvars.ContextVar[dict[str, str] | None] = contextvars.ContextVar(
        "route_trace_context", default=None
    )

    def __init__(self, name: str = "") -> None:
        super().__init__(name)
        self.trace_headers = config.get("logger.route_trace_context.headers", {})

    @classmethod
    def set_context_value(cls, key: str, value: str) -> None:
        try:
            context = cls.route_trace_context.get()
            if context is None:
                context = {}
                cls.route_trace_context.set(context)
            context[key] = value
        except Exception:
            cls.logger.exception("set context value error")

    @classmethod
    def get_context_values(cls) -> dict[str, str]:
        try:
            context = cls.route_trace_context.get()
            return context if context else {}
        except Exception:
            cls.logger.exception("get context values error")
            return {}

    def _set_default_context_values(self, record: logging.LogRecord) -> None:
        for key, _ in self.trace_headers.items():
            exist_value = getattr(record, key, None)
            if not exist_value:
                setattr(record, key, "-")

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            context = self.route_trace_context.get()
            # 只有当上下文被显式设置时才使用上下文值
            if context is not None:
                for key, value in context.items():
                    setattr(record, key, value)
            else:
                self._set_default_context_values(record)
        except Exception:
            self.logger.exception("filter error")
            self._set_default_context_values(record)

        return True
