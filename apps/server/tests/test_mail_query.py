"""mail 查询：latest-code 短轮询 + list_messages（假 repo，不碰 DB）。"""

from datetime import datetime
from types import SimpleNamespace

from modules.mail import service as mail_service_mod
from modules.mail.service import MailService


class _FakeRepo:
    """按预设序列返回 latest_code；list_messages 返回预设行。"""

    def __init__(self, _session, latest_seq=None, rows=None):
        self._latest_seq = list(latest_seq or [])
        self._rows = rows or []
        self.calls = 0

    async def latest_code(self, _mailbox, *, since=None):
        self.calls += 1
        if self._latest_seq:
            return self._latest_seq.pop(0)
        return None

    async def list_messages(self, _mailbox, *, limit, offset):
        return self._rows[offset : offset + limit]


def _row(**kw):
    base = {
        "id": 1,
        "message_id": "m",
        "from_address": "a@x.com",
        "subject": "验证码",
        "code": "123456",
        "received_at": datetime(2026, 7, 24),
    }
    base.update(kw)
    return SimpleNamespace(**base)


async def test_latest_code_hit_immediately(monkeypatch):
    repo = _FakeRepo(None, latest_seq=[_row(code="424242")])
    monkeypatch.setattr(mail_service_mod, "MailRepository", lambda _s: repo)
    result = await MailService().latest_code(None, "Box", wait_seconds=0)
    assert result.code == "424242"
    assert repo.calls == 1  # 立刻命中，不轮询


async def test_latest_code_empty_no_wait(monkeypatch):
    repo = _FakeRepo(None, latest_seq=[])
    monkeypatch.setattr(mail_service_mod, "MailRepository", lambda _s: repo)
    result = await MailService().latest_code(None, "box", wait_seconds=0)
    assert result.code is None


async def test_latest_code_appears_during_wait(monkeypatch):
    # 前两轮 None，第三轮出码；把 sleep 变 no-op 让测试瞬间跑完
    async def _no_sleep(_):
        return None

    monkeypatch.setattr(mail_service_mod.asyncio, "sleep", _no_sleep)
    repo = _FakeRepo(None, latest_seq=[None, None, _row(code="778899")])
    monkeypatch.setattr(mail_service_mod, "MailRepository", lambda _s: repo)
    result = await MailService().latest_code(None, "box", wait_seconds=10)
    assert result.code == "778899"


async def test_latest_code_timeout_returns_empty(monkeypatch):
    async def _no_sleep(_):
        return None

    monkeypatch.setattr(mail_service_mod.asyncio, "sleep", _no_sleep)
    repo = _FakeRepo(None, latest_seq=[])
    monkeypatch.setattr(mail_service_mod, "MailRepository", lambda _s: repo)
    result = await MailService().latest_code(None, "box", wait_seconds=3)
    assert result.code is None
    assert repo.calls >= 3  # 轮询到超时


async def test_list_messages_maps_rows(monkeypatch):
    rows = [_row(id=2, code="111111"), _row(id=1, code=None)]
    repo = _FakeRepo(None, rows=rows)
    monkeypatch.setattr(mail_service_mod, "MailRepository", lambda _s: repo)
    items = await MailService().list_messages(None, "box", limit=50, offset=0)
    assert [i.id for i in items] == [2, 1]
    assert items[0].code == "111111"
    assert items[1].code is None
