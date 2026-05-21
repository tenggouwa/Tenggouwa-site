import http
import json
import logging
from copy import copy
from typing import Protocol

import click
from uvicorn.logging import ColourizedFormatter


class StatusCodeFormatter(Protocol):
    def __call__(self, code: str) -> str: ...


class AccessFormatter(ColourizedFormatter):
    """自定义 access 日志格式化器，支持彩色和结构化字段输出。"""

    status_code_colours: dict[int, StatusCodeFormatter] = {
        1: lambda code: click.style(str(code), fg="bright_white"),
        2: lambda code: click.style(str(code), fg="green"),
        3: lambda code: click.style(str(code), fg="yellow"),
        4: lambda code: click.style(str(code), fg="red"),
        5: lambda code: click.style(str(code), fg="bright_red"),
    }

    def _get_status(self, status_code: int) -> str:
        try:
            status_phrase = http.HTTPStatus(status_code).phrase
        except ValueError:
            status_phrase = ""
        status_and_phrase = f'{status_code} "{status_phrase}"'
        if self.use_colors:

            def default(code: str) -> str:  # noqa: ARG001
                return status_and_phrase

            func = self.status_code_colours.get(status_code // 100, default)
            return func(status_and_phrase)
        return status_and_phrase

    def formatMessage(self, record: logging.LogRecord) -> str:
        record_copy = copy(record)

        remote_addr = record_copy.__dict__.get("remote_addr", "-")
        remote_user = record_copy.__dict__.get("remote_user", "-")
        request_method = record_copy.__dict__.get("request_method", "-")
        request_uri = record_copy.__dict__.get("request_uri", "-")
        http_version = record_copy.__dict__.get("http_version", "-")
        status = self._get_status(int(record_copy.__dict__.get("status", 0)))
        request_time = record_copy.__dict__.get("request_time", "-")
        http_host = record_copy.__dict__.get("http_host", "-")
        request_id = record_copy.__dict__.get("request_id", "-")
        user_id = record_copy.__dict__.get("user_id", "-")
        request_length = record_copy.__dict__.get("request_length", "0")
        body_bytes_sent = record_copy.__dict__.get("body_bytes_sent", "0")
        http_referer = record_copy.__dict__.get("http_referer", "-")
        http_user_agent = record_copy.__dict__.get("http_user_agent", "-")
        request_params = record_copy.__dict__.get("request_params", {})

        request_line = f"{request_method} {request_uri} HTTP/{http_version}"
        if self.use_colors:
            request_line = click.style(request_line, bold=True)

        formatted_params = json.dumps(request_params, ensure_ascii=False)

        record_copy.__dict__.update(
            {
                "remote_addr": remote_addr,
                "remote_user": remote_user,
                "http_host": http_host,
                "request_line": request_line,
                "status": status,
                "request_id": request_id,
                "user_id": user_id,
                "request_length": request_length,
                "body_bytes_sent": body_bytes_sent,
                "request_time": request_time,
                "http_referer": http_referer,
                "http_user_agent": http_user_agent,
                "request_params": formatted_params,
            }
        )

        return super().formatMessage(record_copy)
