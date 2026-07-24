"""mail 收件箱总览：service.list_inboxes 映射（假 repo，不碰 DB）。"""

from datetime import datetime
from types import SimpleNamespace

from modules.mail import service as mail_service_mod
from modules.mail.service import MailService


async def test_list_inboxes_maps_rows(monkeypatch):
    rows = [
        SimpleNamespace(mailbox="netflix", total=3, with_code=2, latest_at=datetime(2026, 7, 24, 10)),
        SimpleNamespace(mailbox="github", total=1, with_code=1, latest_at=datetime(2026, 7, 24, 9)),
    ]

    class FakeRepo:
        def __init__(self, _session):
            pass

        async def list_inboxes(self):
            return rows

    monkeypatch.setattr(mail_service_mod, "MailRepository", FakeRepo)
    items = await MailService().list_inboxes(None)
    assert [i.mailbox for i in items] == ["netflix", "github"]
    assert items[0].total == 3
    assert items[0].with_code == 2
