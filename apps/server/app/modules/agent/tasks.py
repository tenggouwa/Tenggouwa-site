"""Durable task runner for owner-only Agent work.

The HTTP request creates a task and returns immediately. A browser may disconnect
without cancelling the LLM/tool loop; emitted events are persisted for SSE replay.
"""

import asyncio
import logging

from db import async_pg

from .repository import AgentRepository
from .service import agent_service

logger = logging.getLogger(__name__)
_jobs: dict[str, asyncio.Task[None]] = {}


def start_task(task_id: str) -> None:
    """Start once per process. DB status remains the source of truth."""
    if task_id not in _jobs:
        _jobs[task_id] = asyncio.create_task(_run(task_id), name=f"agent-task-{task_id}")


async def _run(task_id: str) -> None:
    try:
        async with async_pg.session() as session:
            repo = AgentRepository(session)
            task = await repo.get_task_unscoped(task_id)
            if task is None or task.status != "queued":
                return
            await session.commit()
            async with async_pg.session() as status_session:
                status_repo = AgentRepository(status_session)
                await status_repo.set_task_status(task_id, "running")
                seq = await status_repo.next_task_event_seq(task_id)
            waiting_approval = False
            async for event in agent_service.answer_stream(
                session,
                "" if task.options.get("approvals") is not None else task.prompt,
                session_id=task.session_id,
                approvals=task.options.get("approvals"),
                privileged=True,
                owner=task.owner,
                auto_approve=bool(task.options.get("auto_approve")),
                deep=bool(task.options.get("deep_think")),
                reflect=bool(task.options.get("reflect")),
                auto_model=bool(task.options.get("auto_model")),
            ):
                seq += 1
                async with async_pg.session() as event_session:
                    event_repo = AgentRepository(event_session)
                    await event_repo.append_task_event(task_id, seq, event)
                    if event["type"] == "approval":
                        await event_repo.set_task_status(task_id, "waiting_approval")
                    elif event["type"] == "done" and not waiting_approval:
                        await event_repo.set_task_status(task_id, "completed")
                if event["type"] == "approval":
                    waiting_approval = True
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("agent task failed: %s", task_id)
        async with async_pg.session() as session:
            await AgentRepository(session).set_task_status(task_id, "failed", error=str(exc)[:2000])
    finally:
        _jobs.pop(task_id, None)


async def fail_interrupted_tasks() -> None:
    """A process restart cannot safely replay an in-flight side-effecting command."""
    async with async_pg.session() as session:
        await AgentRepository(session).fail_running_tasks("执行节点重启；请从任务报告确认结果后重试。")
