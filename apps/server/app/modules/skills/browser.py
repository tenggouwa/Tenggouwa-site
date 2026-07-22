"""browser skill：在 owner 私有沙箱（树莓派）的真实无头浏览器里操作网页（computer-use / 浏览器 agent）。

动作经 pi_exec 入队 → Pi 长轮询取走 → 一个**持久 Playwright 页面**上执行 → 回传"标题 + 可交互元素 + 正文摘要"。
observe→act 循环：navigate/snapshot 看到带 ref(e1/e2…) 的元素 → click/type 用 ref 操作 → 再拿新快照。

- risk="readonly"：不逐步审批（每点一下都弹卡会让浏览循环没法用）；只在 TOTP 私有通道暴露（private）。
  代价：它能提交表单/登录，是有副作用的——但仅 owner 自己可用、且跑在隔离的 Pi 上，学习场景可接受。
- 未配 env AGENT_PI_SANDBOX（服务端）或 PI_AGENT_BROWSER（Pi 端）→ 不可用。
- 与 web_fetch 的分工：只抓一个静态 URL 正文用 web_fetch 更快；要 JS 动态页 / 点按钮 / 填登录 / 翻页才用 browser。
"""

import os

from sqlalchemy.ext.asyncio import AsyncSession

from ..pi.exec import SandboxBusy, pi_exec
from .base import Skill

BROWSER_SKILL = "browser"
_TIMEOUT = 40.0  # 浏览器动作可能要等页面加载，比 shell 多留
_ACTIONS = ("navigate", "snapshot", "click", "type", "back", "close")


def _enabled() -> bool:
    return os.environ.get("AGENT_PI_SANDBOX", "").strip().lower() in ("1", "true", "yes")


def _build_kw(action: str, args: dict) -> tuple[dict, str | None]:
    """按动作组装给 Pi 的参数；返回 (kw, error)，error 非 None 表示参数不合法。"""
    if action == "navigate":
        url = str(args.get("url", "")).strip()
        return ({"url": url}, None) if url else ({}, "（navigate 需要 url。）")
    if action in ("click", "type"):
        ref = str(args.get("ref", "")).strip()
        if not ref:
            return {}, f"（{action} 需要 ref（来自上一次 snapshot 的 e1/e2…）。）"
        kw: dict = {"ref": ref}
        if action == "type":
            kw["text"] = str(args.get("text", ""))
            kw["submit"] = bool(args.get("submit", False))
        return kw, None
    return {}, None  # snapshot / back / close 无需额外参数


async def _handler(_session: AsyncSession, args: dict) -> str:
    if not _enabled():
        return "（未启用 Pi 沙箱（设 AGENT_PI_SANDBOX=1 开启），browser 不可用。）"
    action = str(args.get("action", "")).strip()
    if action not in _ACTIONS:
        return f"（未知浏览器动作：{action or '(空)'}。可选：{', '.join(_ACTIONS)}）"
    kw, err = _build_kw(action, args)
    if err:
        return err
    try:
        r = await pi_exec.submit_browser(action, timeout=_TIMEOUT, **kw)
    except TimeoutError:
        return "（Pi 沙箱无响应——daemon 在线吗？浏览器动作可能超时。）"
    except SandboxBusy:
        return "（沙箱积压已满，稍后再试。）"
    return r.get("output") or "（无输出）"


BROWSER = Skill(
    name="browser",
    description=(
        "在 owner 私有沙箱的真实无头浏览器里操作网页。action 之一："
        "navigate(去 url)、snapshot(看当前页可交互元素)、click(ref)、type(ref,text[,submit])、back、close。"
        "每次返回“标题 + 带 ref 的可交互元素(e1/e2…) + 正文摘要”，据此决定下一步。"
        "要 JS 动态页 / 点按钮 / 填登录框 / 翻页才拿得到的内容时用它；只抓静态 URL 正文用 web_fetch 更快。只读。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": list(_ACTIONS), "description": "浏览器动作"},
            "url": {"type": "string", "description": "navigate 的目标 URL"},
            "ref": {"type": "string", "description": "click/type 的目标元素 ref（来自 snapshot，如 e3）"},
            "text": {"type": "string", "description": "type 要填入的文本"},
            "submit": {"type": "boolean", "description": "type 后是否回车提交，默认 false"},
        },
        "required": ["action"],
    },
    handler=_handler,
    risk="readonly",
    private=True,
)
