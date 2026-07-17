"""发文/改文后台自动刷新的合并逻辑（不碰 DB，把真正的刷新替换成计数器）。"""

import asyncio

import pytest
from modules.kb import auto


@pytest.fixture(autouse=True)
def _reset():
    auto._dirty = False
    yield
    auto._dirty = False


async def _settle() -> None:
    for _ in range(50):
        if not auto._lock.locked() and not auto._dirty:
            return
        await asyncio.sleep(0.005)
    raise AssertionError("后台刷新没收敛")


async def test_single_trigger_runs_once(monkeypatch):
    calls: list[int] = []

    async def fake_once() -> None:
        calls.append(1)

    monkeypatch.setattr(auto, "_refresh_once", fake_once)
    auto.schedule_kb_refresh()
    await _settle()
    assert len(calls) == 1


async def test_write_during_refresh_coalesces_into_one_extra_pass(monkeypatch):
    calls: list[int] = []

    async def fake_once() -> None:
        calls.append(1)
        if len(calls) == 1:  # 模拟一趟刷新进行中又来了一次写
            auto.schedule_kb_refresh()

    monkeypatch.setattr(auto, "_refresh_once", fake_once)
    auto.schedule_kb_refresh()
    await _settle()
    # 中途那次写没被丢：补跑了一趟，且没有失控地反复跑
    assert len(calls) == 2
    assert auto._dirty is False


async def test_failure_is_swallowed_not_raised(monkeypatch):
    async def boom() -> None:
        raise RuntimeError("抽取炸了")

    monkeypatch.setattr(auto, "_refresh_once", boom)
    auto.schedule_kb_refresh()
    await _settle()  # 不应把异常抛出来卡死后台任务
    assert auto._dirty is False
