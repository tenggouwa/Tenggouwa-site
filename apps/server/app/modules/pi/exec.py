"""Pi 沙箱 exec 传输：agent 出一条命令 → 入队；Pi 长轮询取走、bwrap 执行、POST 回结果。

走 Pi 已跑通的 HTTPS POST（穿代理稳），不走 WSS——Pi 装不上 websockets、WSS 穿代理难
（见 apps/pi-agent/ROADMAP §Phase2）。服务器侧内存队列 + future 做「一发一收」rendezvous：
prod `fastapi.workers=1`（config-prod.yml），单进程内存够用，与现有 terminal broker 同假设。
详见 docs/agent/agent-d2-sandbox-design.md。

安全铁律：**submit 超时（Pi 离线/慢）的命令绝不能迟到执行**——poll 只投递「还在等结果」的命令，
陈旧的直接丢弃，否则一条 write 命令会在审批时刻之后无人看管地跑（评审）。队列有界防内存涨。
"""

import asyncio
from uuid import uuid4

_POLL_WAIT = 10.0  # 长轮询挂起上限（秒）：短一点让 Pi 那条代理连接更不容易被掐（SSL EOF），超时返回 null 即再轮询
_RESULT_GRACE = 20.0  # 服务器等结果比 Pi 执行超时多留的余量（秒）：给 Pi 侧结果 POST 的重试留足网络往返
_MAX_QUEUE = 256  # 离线积压上限；满了 submit 直接拒（防内存无限涨）


class SandboxBusy(Exception):
    """沙箱积压已满（Pi 长时间离线，命令堆积到上限）。"""


class PiExecBroker:
    def __init__(self) -> None:
        self._queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=_MAX_QUEUE)
        self._pending: dict[str, asyncio.Future] = {}

    async def submit(self, cmd: str, *, cwd: str, timeout: float) -> dict:
        """入队一条命令并等 Pi 回结果；Pi 无响应 timeout 后抛 TimeoutError，积压满抛 SandboxBusy。"""
        rid = uuid4().hex
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[rid] = fut
        try:
            self._queue.put_nowait({"id": rid, "cmd": cmd, "cwd": cwd, "timeout": timeout})
        except asyncio.QueueFull:
            self._pending.pop(rid, None)
            raise SandboxBusy from None
        try:
            return await asyncio.wait_for(fut, timeout + _RESULT_GRACE)
        finally:
            self._pending.pop(rid, None)  # 无论成/超时，都从待办清掉 → poll 会认出它已陈旧

    async def poll(self) -> dict | None:
        """长轮询取下一条**仍在等结果**的待执行命令；陈旧的（submit 已超时/取消）丢弃，不投递。"""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + _POLL_WAIT
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                return None
            try:
                item = await asyncio.wait_for(self._queue.get(), remaining)
            except TimeoutError:
                return None
            fut = self._pending.get(item["id"])
            if fut is not None and not fut.done():
                return item
            # 陈旧命令：对应 submit 已超时/被取消 → 丢弃，绝不让它迟到无人看管地跑

    def deliver(self, rid: str, result: dict) -> bool:
        """Pi 回传结果 → 唤醒对应 submit。未知/已完成 id 返回 False。"""
        fut = self._pending.get(rid)
        if fut is None or fut.done():
            return False
        fut.set_result(result)
        return True


pi_exec = PiExecBroker()
