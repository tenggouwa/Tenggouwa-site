"""Mail TTL scheduler stays inert outside its explicit scheduled invocation."""

from modules.mail import scheduler


async def test_run_mail_retention_deletes_expired_rows(monkeypatch):
    captured = {}

    class _Repo:
        def __init__(self, session):
            captured["session"] = session

        async def delete_expired(self, now):
            captured["now"] = now
            return 3

    class _Session:
        async def __aenter__(self):
            return "db-session"

        async def __aexit__(self, *_args):
            return False

    monkeypatch.setattr(scheduler.async_pg, "session", _Session)
    monkeypatch.setattr(scheduler, "MailRepository", _Repo)
    await scheduler.run_mail_retention()
    assert captured["session"] == "db-session"
    assert captured["now"].tzinfo is not None
