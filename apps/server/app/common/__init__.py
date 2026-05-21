from common.access_formatter import AccessFormatter
from common.config_manager import config
from common.route_trace_context import RouteTraceContextFilter
from common.setup_logging import load_logging_config, setup_logging

setup_logging(config.get("logger.config_path", None))

__all__ = [
    "config",
    "setup_logging",
    "load_logging_config",
    "AccessFormatter",
    "RouteTraceContextFilter",
]
