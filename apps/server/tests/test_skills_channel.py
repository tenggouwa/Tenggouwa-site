"""skills 通道过滤（Phase C-auth）：公开通道只 readonly，私有（鉴权）通道给 write / MCP。

这是能力暴露的执行点——公开端点天然拿不到高危工具（tools 过滤），
再加 invoke 一层纵深兜底（模型幻觉出高危工具名也拒执行）。
"""

import modules.skills.service as sksvc
from modules.skills.base import Skill


def _skill(name: str, risk: str, calls: list, *, private: bool = False) -> Skill:
    async def handler(_s, _a):
        calls.append(name)
        return f"[{name} ok]"

    return Skill(
        name=name,
        description=name,
        parameters={"type": "object", "properties": {}},
        handler=handler,
        risk=risk,
        private=private,
    )


def _registry(monkeypatch, calls) -> None:
    reg = {
        "kb_search": _skill("kb_search", "readonly", calls),
        "file_write": _skill("file_write", "write", calls),
        "file_read": _skill("file_read", "readonly", calls, private=True),  # 只读但私有
    }
    monkeypatch.setattr(sksvc, "REGISTRY", reg)


def _names(tools) -> list[str]:
    return [t["function"]["name"] for t in tools]


def test_public_tools_exclude_write_and_private(monkeypatch):
    _registry(monkeypatch, [])
    # 公开只留既 readonly 又非 private 的：write（file_write）和 private-readonly（file_read）都被挡
    assert _names(sksvc.skills_service.tools(privileged=False)) == ["kb_search"]


def test_private_tools_include_all(monkeypatch):
    _registry(monkeypatch, [])
    names = _names(sksvc.skills_service.tools(privileged=True))
    assert set(names) == {"kb_search", "file_write", "file_read"}


async def test_public_invoke_private_readonly_refused(monkeypatch):
    calls: list = []
    _registry(monkeypatch, calls)
    out = await sksvc.skills_service.invoke(None, "file_read", {}, privileged=False)
    assert "私有通道" in out
    assert calls == []  # 只读但 private，公开通道也不跑


async def test_public_invoke_write_refused_handler_not_run(monkeypatch):
    calls: list = []
    _registry(monkeypatch, calls)
    out = await sksvc.skills_service.invoke(None, "file_write", {}, privileged=False)
    assert "私有通道" in out
    assert calls == []  # handler 没跑，纵深兜底住了


async def test_private_invoke_write_runs(monkeypatch):
    calls: list = []
    _registry(monkeypatch, calls)
    out = await sksvc.skills_service.invoke(None, "file_write", {}, privileged=True)
    assert calls == ["file_write"] and "ok" in out


async def test_public_invoke_readonly_runs(monkeypatch):
    calls: list = []
    _registry(monkeypatch, calls)
    await sksvc.skills_service.invoke(None, "kb_search", {}, privileged=False)
    assert calls == ["kb_search"]


async def test_public_mcp_tool_refused(monkeypatch):
    _registry(monkeypatch, [])
    monkeypatch.setattr(sksvc.mcp_manager, "has", lambda _n: True)
    out = await sksvc.skills_service.invoke(None, "srv__do", {}, privileged=False)
    assert "MCP" in out and "私有通道" in out


def test_list_skills_hides_private(monkeypatch):
    # 公开 /api/public/skills 页只列非 private——private 工具名/描述不该在无鉴权端点泄漏
    _registry(monkeypatch, [])  # file_read 是 private=True，其余非 private
    names = [s.name for s in sksvc.skills_service.list_skills()]
    assert "file_read" not in names  # private → 公开页隐藏
    assert "kb_search" in names
