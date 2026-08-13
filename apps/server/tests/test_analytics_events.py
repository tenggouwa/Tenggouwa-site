"""匿名转化事件的白名单与隐私边界测试。"""

from unittest.mock import AsyncMock, patch

import pytest
from modules.analytics.schema import TrackEventRequest
from modules.analytics.service import analytics_service


@pytest.mark.asyncio
async def test_track_event_persists_only_whitelisted_metadata() -> None:
    session = object()
    payload = TrackEventRequest(
        name="project_open",
        source="web",
        path="/projects/?utm=ignored",
        label="  perler-pattern\n",
    )
    repo = AsyncMock()
    with patch("modules.analytics.service.AnalyticsRepository", return_value=repo):
        recorded = await analytics_service.track_event(session, payload, ip="127.0.0.1", ua="Mozilla/5.0")

    assert recorded is True
    repo.insert_event.assert_awaited_once()
    kwargs = repo.insert_event.await_args.kwargs
    assert kwargs["path"] == "/projects"
    assert kwargs["label"] == "perler-pattern"
    assert len(kwargs["visitor_hash"]) == 32


@pytest.mark.asyncio
async def test_track_event_rejects_unlisted_event_without_writing() -> None:
    payload = TrackEventRequest(name="arbitrary_user_text", source="web", path="/")
    repo = AsyncMock()
    with patch("modules.analytics.service.AnalyticsRepository", return_value=repo):
        recorded = await analytics_service.track_event(object(), payload, ip="127.0.0.1", ua="Mozilla/5.0")

    assert recorded is False
    repo.insert_event.assert_not_awaited()
