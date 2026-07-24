"""验证码提取启发式：真实文案样例参数化测试。"""

import pytest
from modules.mail.extract import extract_code


@pytest.mark.parametrize(
    "subject, body, expected",
    [
        # 中文关键词邻接
        ("【示例】验证码", "您的验证码是 482913，5分钟内有效", "482913"),
        ("微信", "494213（微信登录验证码），请勿泄露", "494213"),
        # 英文关键词
        ("Sign in to Example", "Your verification code is 903472. Do not share it.", "903472"),
        ("Netflix", "Your one-time code: 5821", "5821"),
        ("Confirm", "Use passcode 773391 to continue", "773391"),
        # Google 风格
        ("Google", "G-558021 is your Google verification code", "558021"),
        # 码在主题里
        ("验证码 640288 - 请在10分钟内使用", "见主题", "640288"),
        # 没有码
        ("欢迎注册", "感谢你的加入，祝使用愉快！", None),
        # 空
        (None, None, None),
    ],
)
def test_extract_code(subject: str | None, body: str | None, expected: str | None) -> None:
    code, _kind = extract_code(subject, body)
    assert code == expected
