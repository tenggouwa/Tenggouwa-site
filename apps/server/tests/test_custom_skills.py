"""owner 自定义 skill：模板填充 / 校验 / 两种执行器 / SSRF / 暴露给 agent / http 走审批。不碰真 DB/网络。"""

import modules.agent.custom_skills as cs
from modules.agent.custom_skills import CustomSkillStore, _fill, custom_tool_schema, run_custom
from modules.skills.permissions import requires_approval
from modules.skills.service import skills_service


def test_fill_replaces_slots_safely():
    assert _fill("你好 {name}，今天 {city} 天气", {"name": "A", "city": "上海"}) == "你好 A，今天 上海 天气"
    assert _fill("缺 {missing} 留空", {}) == "缺  留空"  # 缺失填空，不 KeyError


def test_validate_rejects_bad_inputs():
    v = CustomSkillStore._validate
    assert v("1bad", "prompt", {"template": "x"})  # 名字非法
    assert v("ok_name", "weird", {})  # kind 非法
    assert v("http_no_url", "http", {"method": "GET"})  # http 缺 url
    assert v("prompt_no_tmpl", "prompt", {})  # prompt 缺 template
    assert v("raw_secret", "http", {"url": "https://x.com", "headers": {"Authorization": "Bearer secret"}})
    assert v("bad_secret_ref", "http", {"url": "https://x.com", "secret_headers": {"Authorization": "HOME"}})
    assert v("send_email", "http", {"url": "https://x.com", "method": "POST"}) is None  # 合法


def test_validate_rejects_name_collision_with_native():
    assert CustomSkillStore._validate("kb_search", "prompt", {"template": "x"})  # 撞内置名


async def test_run_prompt_fills_and_calls_llm(monkeypatch):
    captured = {}

    class _LLM:
        async def complete(self, messages, **kw):
            captured["prompt"] = messages[0]["content"]
            return {"content": "译文"}

    monkeypatch.setattr(cs, "chat_llm", _LLM())
    skill = {"kind": "prompt", "config": {"template": "把 {text} 翻译成英文"}}
    out = await run_custom(skill, {"text": "你好"})
    assert out == "译文"
    assert captured["prompt"] == "把 你好 翻译成英文"


async def test_run_http_rejects_private_host():
    # SSRF：内网/环回地址直接拒，不联网
    skill = {"kind": "http", "config": {"url": "http://127.0.0.1:8080/x", "method": "GET"}}
    out = await run_custom(skill, {})
    assert "拒绝" in out and "公网" in out


async def test_run_http_pins_validated_ip_and_reads_secret_from_env(monkeypatch):
    captured = {}

    class _Response:
        status_code = 200
        text = "ok"

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def request(self, method, url, **kwargs):
            captured.update(method=method, url=url, **kwargs)
            return _Response()

    monkeypatch.setattr(cs, "_public_ips", lambda _host: ["203.0.113.9"])
    monkeypatch.setattr(cs.httpx, "AsyncClient", lambda **_kw: _Client())
    monkeypatch.setenv("CUSTOM_SKILL_SECRET_DEMO", "Bearer top-secret")
    out = await run_custom(
        {
            "kind": "http",
            "config": {
                "url": "https://api.example.com/v1?q={q}",
                "method": "GET",
                "headers": {"X-Query": "{q}"},
                "secret_headers": {"Authorization": "CUSTOM_SKILL_SECRET_DEMO"},
            },
        },
        {"q": "hello"},
    )
    assert out == "[200]\nok"
    assert captured["url"] == "https://203.0.113.9/v1?q=hello"
    assert captured["headers"] == {"X-Query": "hello", "Authorization": "Bearer top-secret", "Host": "api.example.com"}
    assert captured["extensions"] == {"sni_hostname": "api.example.com"}


def test_custom_tool_schema_shape():
    s = custom_tool_schema({"name": "send_email", "description": "发邮件", "parameters": {"type": "object"}})
    assert s["function"]["name"] == "send_email" and s["function"]["description"] == "发邮件"


def test_tools_appends_custom_only_when_privileged():
    custom = [{"name": "send_email", "description": "发邮件", "parameters": {}, "kind": "http", "config": {}}]
    pub = skills_service.tools(privileged=False, custom=custom)
    assert not any(t["function"]["name"] == "send_email" for t in pub)  # 公开通道不暴露
    priv = skills_service.tools(privileged=True, custom=custom)
    assert any(t["function"]["name"] == "send_email" for t in priv)  # 私有通道暴露


async def test_invoke_dispatches_to_custom(monkeypatch):
    class _LLM:
        async def complete(self, messages, **kw):
            return {"content": "OK"}

    monkeypatch.setattr(cs, "chat_llm", _LLM())
    custom = [{"name": "shout", "description": "d", "parameters": {}, "kind": "prompt", "config": {"template": "{t}"}}]
    out = await skills_service.invoke(None, "shout", {"t": "hi"}, privileged=True, custom=custom)
    assert out == "OK"
    # 公开通道即便传了 custom 也不跑（返回未知 skill）
    pub = await skills_service.invoke(None, "shout", {"t": "hi"}, privileged=False, custom=custom)
    assert "未知 skill" in pub


def test_http_custom_needs_approval_prompt_does_not():
    http_names = frozenset({"send_email"})
    assert requires_approval("send_email", http_names) is True  # http 自定义走审批
    assert requires_approval("translate", frozenset()) is False  # prompt 自定义免批
