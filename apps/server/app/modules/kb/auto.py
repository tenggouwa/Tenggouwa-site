"""发文/改文后自动把知识库追平：reindex（切块 + 嵌入）+ 增量抽概念图谱。

跑在服务端进程内、绑在内容变更事件上——不靠 CI（CI 碰不到生产 DB），也不用新密钥。
多次触发（一次批量发文）会被**合并成一趟**：正在刷新时来的写只置脏标记，由当前这趟收尾时补跑，
避免每篇都全量扫一遍。reindex / build_graph 本就按 hash 增量，没变的文档不会白跑 LLM。
"""

import asyncio
import logging

from db import async_pg

from .service import kb_service

logger = logging.getLogger(__name__)

_dirty = False
_lock = asyncio.Lock()


async def _refresh_once() -> None:
    async with async_pg.session() as s:
        await kb_service.reindex(s, "blog")
        await kb_service.build_graph(s)


async def _run() -> None:
    global _dirty
    async with _lock:
        while _dirty:
            _dirty = False  # 先清再跑；跑的过程中再来的写会把它重新置脏，循环补一趟
            try:
                await _refresh_once()
            except Exception:  # noqa: BLE001 —— 后台刷新失败只记日志，别把异常抛进 create_task 黑洞
                logger.exception("KB 自动刷新失败（reindex + 抽图谱）")


def schedule_kb_refresh() -> None:
    """发文/改文后调它：合并式后台刷新。多次快速触发只会跑一趟（外加必要的补跑）。"""
    global _dirty
    _dirty = True
    if not _lock.locked():
        asyncio.create_task(_run())
