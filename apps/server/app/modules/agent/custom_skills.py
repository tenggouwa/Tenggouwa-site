"""owner 自定义 skill 的存储 + 执行器。两种执行体（kind）：

- http：把参数填进一个公网 URL 的请求、响应返给 agent（SSRF 守卫 + 走 C2 审批）。
- prompt：用参数填一段提示词模板、跑一次 LLM 返回文本（纯变换、免审批）。

不做运行时任意代码执行。owner 维度、仅私有通道；参数用 {slot} 占位，_fill 做安全替换（不用 format 防注入）。
"""

import os
import re
from urllib.parse import urlparse

import httpx
from db.models import AgentCustomSkillRow
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..kb.provider import chat_llm
from ..skills.web_fetch import _pinned_url, _public_ips  # 复用 DNS 固定连接，避免校验后再次解析

_NAME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]{1,63}$")
_KINDS = ("http", "prompt")
_HTTP_METHODS = ("GET", "POST", "PUT", "DELETE")
_SECRET_ENV_RE = re.compile(r"^CUSTOM_SKILL_SECRET_[A-Z0-9_]{1,96}$")
_SENSITIVE_HEADERS = frozenset({"authorization", "proxy-authorization", "x-api-key", "api-key", "cookie"})
MAX_CUSTOM_PER_OWNER = 30
_MAX_RESULT = 6000


def _fill(template: str, args: dict) -> str:
    """把模板里的 {key} 替换成 args[key]（缺失留空）。不用 str.format 以免 KeyError / 花括号注入。"""
    return re.sub(r"\{(\w+)\}", lambda m: str(args.get(m.group(1), "")), template or "")


def _validate_http_config(config: dict) -> str | None:
    url_ok = str(config.get("url", "")).strip().startswith(("http://", "https://"))
    method_ok = str(config.get("method", "GET")).upper() in _HTTP_METHODS
    if not (url_ok and method_ok):
        return f"http 型需要合法 config.url（http/https）+ method（{' / '.join(_HTTP_METHODS)}）"
    headers = config.get("headers") or {}
    if not isinstance(headers, dict):
        return "http 型 config.headers 必须是对象"
    if any(str(key).lower() in _SENSITIVE_HEADERS and str(value).strip() for key, value in headers.items()):
        return "敏感请求头不能保存值；请改用 secret_headers 引用 CUSTOM_SKILL_SECRET_* 环境变量"
    secret_headers = config.get("secret_headers") or {}
    invalid_secret_ref = not isinstance(secret_headers, dict) or any(
        not _SECRET_ENV_RE.match(str(value)) for value in secret_headers.values()
    )
    if invalid_secret_ref:
        return "secret_headers 只能引用 CUSTOM_SKILL_SECRET_* 环境变量"
    return None


def custom_tool_schema(c: dict) -> dict:
    """自定义 skill → function-calling tool schema。"""
    params = c.get("parameters") or {"type": "object", "properties": {}}
    return {"type": "function", "function": {"name": c["name"], "description": c["description"], "parameters": params}}


class CustomSkillStore:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    @staticmethod
    def _validate(name: str, kind: str, config: dict) -> str | None:
        if not _NAME_RE.match(name or ""):
            return "name 需是合法函数名（字母开头，字母/数字/下划线，2–64 长）"
        from ..skills.registry import REGISTRY  # lazy：避开 skills↔agent import 环

        if name in REGISTRY:
            return f"name 与内置 skill 撞名了：{name}"
        if kind not in _KINDS:
            return f"kind 只能是 {' / '.join(_KINDS)}"
        if kind == "http":
            return _validate_http_config(config)
        if kind == "prompt" and not str(config.get("template", "")).strip():
            return "prompt 型需要 config.template"
        return None

    async def upsert(self, owner: str, name: str, description: str, parameters: dict, kind: str, config: dict) -> str:
        name = (name or "").strip()
        description = (description or "").strip()
        if not description:
            return "（skill 需要 description，模型靠它决定何时调。）"
        err = self._validate(name, kind, config)
        if err:
            return f"（{err}）"
        row = (
            await self.session.execute(
                select(AgentCustomSkillRow).where(AgentCustomSkillRow.owner == owner, AgentCustomSkillRow.name == name)
            )
        ).scalar_one_or_none()
        if row is None:
            n = (
                await self.session.execute(
                    select(func.count(AgentCustomSkillRow.id)).where(AgentCustomSkillRow.owner == owner)
                )
            ).scalar() or 0
            if n >= MAX_CUSTOM_PER_OWNER:
                return f"（自定义 skill 已达上限 {MAX_CUSTOM_PER_OWNER} 个，先删几个再加。）"
            self.session.add(
                AgentCustomSkillRow(
                    owner=owner,
                    name=name,
                    description=description,
                    parameters=parameters if isinstance(parameters, dict) else {},
                    kind=kind,
                    config=config if isinstance(config, dict) else {},
                )
            )
            verb = "已新建"
        else:
            row.description = description
            row.parameters = parameters if isinstance(parameters, dict) else {}
            row.kind = kind
            row.config = config if isinstance(config, dict) else {}
            verb = "已更新"
        await self.session.flush()
        return f"（{verb}自定义 skill「{name}」。）"

    async def list_all(self, owner: str) -> list[dict]:
        rows = (
            (
                await self.session.execute(
                    select(AgentCustomSkillRow)
                    .where(AgentCustomSkillRow.owner == owner)
                    .order_by(AgentCustomSkillRow.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        return [
            {
                "id": r.id,
                "name": r.name,
                "description": r.description,
                "parameters": r.parameters,
                "kind": r.kind,
                "config": r.config,
                "enabled": r.enabled,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ]

    async def list_enabled(self, owner: str) -> list[dict]:
        """给 agent 暴露用：只要启用的，且只带执行需要的字段。"""
        return [c for c in await self.list_all(owner) if c["enabled"]]

    async def delete_by_id(self, owner: str, sid: int) -> bool:
        res = await self.session.execute(
            delete(AgentCustomSkillRow).where(AgentCustomSkillRow.id == sid, AgentCustomSkillRow.owner == owner)
        )
        await self.session.flush()
        return (res.rowcount or 0) > 0


async def run_custom(skill: dict, args: dict) -> str:
    """执行一个自定义 skill（按 kind 分派）。异常收敛成结果字符串，不抛。"""
    kind = skill.get("kind")
    if kind == "prompt":
        return await _run_prompt(skill, args)
    if kind == "http":
        return await _run_http(skill, args)
    return f"（未知自定义 skill 类型：{kind}）"


async def _run_prompt(skill: dict, args: dict) -> str:
    filled = _fill(str(skill["config"].get("template", "")), args)
    try:
        out = await chat_llm.complete([{"role": "user", "content": filled}], tools=None)
    except Exception as e:  # noqa: BLE001 —— 收敛成结果，别把异常抛进工具循环
        return f"[出错] 自定义 skill 跑 LLM 失败：{e}"
    return ((out.get("content") or "").strip())[:_MAX_RESULT] or "[无结果] 空输出"


async def _run_http(skill: dict, args: dict) -> str:
    cfg = skill["config"]
    url = _fill(str(cfg.get("url", "")), args)
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return "[出错] 非法 URL"
    ips = _public_ips(parsed.hostname)
    if not ips:
        return "[出错] 拒绝：目标不是公网地址"
    method = str(cfg.get("method", "GET")).upper()
    headers = {str(k): _fill(str(v), args) for k, v in (cfg.get("headers") or {}).items() if str(k).lower() != "host"}
    for key, env_name in (cfg.get("secret_headers") or {}).items():
        value = os.environ.get(str(env_name), "")
        if not value:
            return f"[出错] 自定义 skill 密钥环境变量未配置：{env_name}"
        headers[str(key)] = value
    host_header = parsed.hostname if not parsed.port else f"{parsed.hostname}:{parsed.port}"
    headers["Host"] = host_header
    target = _pinned_url(parsed, ips[0])
    body = _fill(str(cfg.get("body", "")), args) if method in ("POST", "PUT") else None
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=6.0), follow_redirects=False) as client:
            resp = await client.request(
                method,
                target,
                headers=headers,
                content=body,
                extensions={"sni_hostname": parsed.hostname},
            )
            text = resp.text[:_MAX_RESULT]
    except httpx.HTTPError as e:
        return f"[出错] 自定义 skill 请求失败：{e}"
    return f"[{resp.status_code}]\n{text}"
