"""D1 文件工具：jailed workspace 内 list/read/write + 越狱防护（含符号链接 / `..` / 绝对路径）。"""

import pytest
from modules.skills.file_ops import (
    FILE_LIST,
    FILE_READ,
    FILE_WRITE,
    _list_handler,
    _read_handler,
    _write_handler,
)


@pytest.fixture
def ws(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_WORKSPACE", str(tmp_path))
    return tmp_path


async def test_write_then_read_roundtrip(ws):
    out = await _write_handler(None, {"path": "notes/a.txt", "content": "你好"})
    assert "已写入" in out
    assert (ws / "notes/a.txt").read_text() == "你好"  # 自动建了父目录
    assert await _read_handler(None, {"path": "notes/a.txt"}) == "你好"


async def test_list_dir(ws):
    (ws / "a.txt").write_text("x")
    (ws / "sub").mkdir()
    out = await _list_handler(None, {"path": "."})
    assert "a.txt" in out and "sub" in out


async def test_jail_escape_dotdot_rejected(ws):
    (ws.parent / "secret.txt").write_text("SECRET")
    out = await _read_handler(None, {"path": "../secret.txt"})
    assert "越出 workspace" in out
    assert "SECRET" not in out


async def test_absolute_path_forced_into_workspace(ws):
    # 绝对路径去掉前导 '/' 后并入 workspace：读的是 workspace/etc/passwd（不存在），绝不触及真 /etc/passwd
    out = await _read_handler(None, {"path": "/etc/passwd"})
    assert "不存在或不是文件" in out
    assert not (ws / "etc" / "passwd").exists()  # 确实落在 workspace 内解析


async def test_write_escape_rejected(ws):
    out = await _write_handler(None, {"path": "../evil.txt", "content": "x"})
    assert "越出 workspace" in out
    assert not (ws.parent / "evil.txt").exists()


async def test_symlink_escape_rejected(ws):
    outside = ws.parent / "outside"
    outside.mkdir(exist_ok=True)  # tmp_path.parent 在会话内共享，避免与同批用例撞名
    (outside / "s.txt").write_text("OUT")
    (ws / "link").symlink_to(outside, target_is_directory=True)
    out = await _read_handler(None, {"path": "link/s.txt"})
    assert "越出 workspace" in out  # realpath 解析符号链接后越界 → 拒


async def test_write_through_symlinked_dir_rejected(ws):
    # 写路径经由指向外部的符号链接子目录 → _resolve 在 mkdir/写入前就拦下，外部不落任何文件
    outside = ws.parent / "outside"
    outside.mkdir(exist_ok=True)  # tmp_path.parent 在会话内共享，避免与同批用例撞名
    (ws / "link").symlink_to(outside, target_is_directory=True)
    out = await _write_handler(None, {"path": "link/evil.txt", "content": "x"})
    assert "越出 workspace" in out
    assert not (outside / "evil.txt").exists()


async def test_missing_workspace_refuses(monkeypatch):
    monkeypatch.delenv("AGENT_WORKSPACE", raising=False)
    assert "未配置" in await _write_handler(None, {"path": "a.txt", "content": "x"})
    assert "未配置" in await _read_handler(None, {"path": "a.txt"})
    assert "未配置" in await _list_handler(None, {"path": "."})


async def test_read_truncated(ws):
    (ws / "big.txt").write_text("y" * 20000)
    out = await _read_handler(None, {"path": "big.txt"})
    assert len(out) < 20000 and "已截断" in out


async def test_write_too_large_rejected(ws):
    out = await _write_handler(None, {"path": "big.txt", "content": "z" * 200_000})
    assert "内容过大" in out
    assert not (ws / "big.txt").exists()


def test_channel_and_risk_flags():
    # 三个都 private（只在私有通道）；只有 file_write 是 write（走 C2 审批）
    assert FILE_LIST.private and FILE_READ.private and FILE_WRITE.private
    assert FILE_LIST.risk == "readonly" and FILE_READ.risk == "readonly"
    assert FILE_WRITE.risk == "write"
