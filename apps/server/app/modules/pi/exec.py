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
        self._chunks: dict[str, asyncio.Queue] = {}  # 命令 id -> 流式输出块队列（Pi 边跑边推）

    def _enqueue(self, payload: dict, timeout: float) -> tuple[str, asyncio.Future, asyncio.Queue]:
        """入队一条给 Pi 的命令（payload 即命令体，如 {cmd,cwd} 或 {kind:file,op,path,content}）。"""
        rid = uuid4().hex
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        chunk_q: asyncio.Queue = asyncio.Queue()
        self._pending[rid] = fut
        self._chunks[rid] = chunk_q
        try:
            self._queue.put_nowait({"id": rid, "timeout": timeout, **payload})
        except asyncio.QueueFull:
            self._pending.pop(rid, None)
            self._chunks.pop(rid, None)
            raise SandboxBusy from None
        return rid, fut, chunk_q

    async def submit(self, cmd: str, *, cwd: str, timeout: float) -> dict:
        """入队一条 shell 命令并等 Pi 回结果；Pi 无响应 timeout 后抛 TimeoutError，积压满抛 SandboxBusy。"""
        rid, fut, _ = self._enqueue({"cmd": cmd, "cwd": cwd}, timeout)
        try:
            return await asyncio.wait_for(fut, timeout + _RESULT_GRACE)
        finally:
            self._pending.pop(rid, None)  # 无论成/超时，都从待办清掉 → poll 会认出它已陈旧
            self._chunks.pop(rid, None)

    async def submit_file(self, op: str, path: str, content: str, *, timeout: float) -> dict:
        """入队一条文件操作（read/write/list）给 Pi 沙箱（在 Pi 的 workspace 内 jail 执行），等结果。

        cmd="true" 是给「还没更新到带 _run_file 的旧 executor」的 Pi 的兜底——旧 Pi 不认 kind 会去跑 cmd，
        跑个 no-op `true`（rc0 空输出）而非 _run_command(None) 崩掉 exec 线程（会连累 shell）。新 Pi 先看 kind。
        """
        payload = {"kind": "file", "op": op, "path": path, "content": content, "cmd": "true"}
        rid, fut, _ = self._enqueue(payload, timeout)
        try:
            return await asyncio.wait_for(fut, timeout + _RESULT_GRACE)
        finally:
            self._pending.pop(rid, None)
            self._chunks.pop(rid, None)

    async def submit_stream(self, cmd: str, *, cwd: str, timeout: float):
        """流式版：yield {"chunk": str} 边跑边出，最后 yield {"result": dict}。超时抛 TimeoutError。"""
        rid, fut, chunk_q = self._enqueue({"cmd": cmd, "cwd": cwd}, timeout)
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout + _RESULT_GRACE
        try:
            while True:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    raise TimeoutError
                getter = asyncio.ensure_future(chunk_q.get())
                done, _ = await asyncio.wait({getter, fut}, timeout=remaining, return_when=asyncio.FIRST_COMPLETED)
                if getter in done:
                    yield {"chunk": getter.result()}
                else:
                    getter.cancel()
                if fut.done():
                    while not chunk_q.empty():
                        yield {"chunk": chunk_q.get_nowait()}  # 收尾把残余块吐干净
                    yield {"result": fut.result()}
                    return
                if not done:
                    raise TimeoutError
        finally:
            self._pending.pop(rid, None)
            self._chunks.pop(rid, None)

    def deliver_chunk(self, rid: str, chunk: str) -> bool:
        """Pi 推来一块流式输出 → 塞进对应队列。未知 id（已结束/超时）返回 False。"""
        q = self._chunks.get(rid)
        if q is None:
            return False
        q.put_nowait(chunk)
        return True

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
