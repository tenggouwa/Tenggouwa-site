"""验证码提取：关键词上下文优先，纯数字兜底。

纯函数、无 IO，方便单测。与 apps/mail-worker 里的 JS 版保持同款启发式；
Worker 侧预抽一遍，后端这里兜底再抽一遍，双保险。
"""

import re

# 有序规则：命中即返回。关键词邻接置信度最高，最后才用孤立数字兜底。
_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(?:验证码|校验码|动态码|口令)[^0-9A-Za-z]{0,8}([0-9]{4,8})"), "numeric"),
    (re.compile(r"([0-9]{4,8})[^0-9A-Za-z]{0,8}(?:验证码|校验码|动态码)"), "numeric"),
    (
        re.compile(
            r"(?:verification|verify|security|one[- ]?time|login|auth|OTP|code|passcode|PIN)"
            r"\D{0,12}([0-9]{4,8})",
            re.IGNORECASE,
        ),
        "numeric",
    ),
    (re.compile(r"\bG-([0-9]{6})\b"), "numeric"),  # Google 风格 G-123456
]
_FALLBACK = re.compile(r"\b([0-9]{4,8})\b")


def extract_code(subject: str | None, body: str | None) -> tuple[str | None, str | None]:
    """从主题 + 正文里抽验证码。

    Args:
        subject: 邮件主题。
        body: 可读正文（纯文本，或 HTML 去标签后的文本）。

    Returns:
        `(code, kind)`；抽不到时 `(None, None)`。`kind` 目前恒为 `"numeric"`。
    """
    hay = f"{subject or ''}\n{body or ''}"
    for pattern, kind in _PATTERNS:
        match = pattern.search(hay)
        if match:
            return match.group(1), kind
    match = _FALLBACK.search(hay)
    if match:
        return match.group(1), "numeric"
    return None, None
