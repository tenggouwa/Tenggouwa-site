"""tenggouwa-mac-agent

把本地 pty 通过 WSS 暴露给 api.tenggouwa.com 的 /api/agent/ws。
配置：~/.tenggouwa-agent/config.toml （首次 install.sh 写入）

设计要点：
- 持久 WSS 长连接 + 指数退避重连
- 每个会话开一个独立 pty（agent 收到第一帧时按需 spawn）
- pty stdout → 二进制 WSS 帧
- WSS 二进制帧 → pty stdin
- WSS 文本帧 = JSON 控制消息，目前只处理 resize / kill / ping
- broker 那边踢掉旧 client 时，pty 也跟着关
"""

from __future__ import annotations

import asyncio
import fcntl
import json
import logging
import os
import signal
import struct
import sys
import termios
from pathlib import Path

import ptyprocess
from websockets.asyncio.client import ClientConnection
from websockets.asyncio.client import connect as ws_connect
from websockets.exceptions import ConnectionClosed, WebSocketException

DEFAULT_CONFIG_DIR = Path.home() / ".tenggouwa-agent"
DEFAULT_CONFIG_PATH = DEFAULT_CONFIG_DIR / "config.toml"

logger = logging.getLogger("agent")


# ---------------------------------------------------------------------------
# config


def _load_toml(path: Path) -> dict:
    try:
        import tomllib  # py 3.11+
    except ImportError as e:  # pragma: no cover
        raise RuntimeError("Python >= 3.11 required") from e
    with path.open("rb") as f:
        return tomllib.load(f)


def load_config(path: Path = DEFAULT_CONFIG_PATH) -> dict:
    if not path.exists():
        raise SystemExit(
            f"[agent] 缺少配置 {path}。\n"
            "在 admin 后台「站点设置 → 终端 agent → 新建」拿到 token 后，运行 install.sh。",
        )
    cfg = _load_toml(path)
    if "agent_token" not in cfg or "server_url" not in cfg:
        raise SystemExit(f"[agent] 配置缺 agent_token 或 server_url：{path}")
    cfg.setdefault("shell", os.environ.get("SHELL", "/bin/zsh"))
    cfg.setdefault("term", os.environ.get("TERM", "xterm-256color"))
    return cfg


# ---------------------------------------------------------------------------
# pty 包装


class PtySession:
    """一个 pty 子进程的最小包装。read 在 thread executor 上调，避免阻塞 event loop。"""

    def __init__(self, shell: str, term: str) -> None:
        env = os.environ.copy()
        env["TERM"] = term
        self.proc = ptyprocess.PtyProcess.spawn([shell, "-l"], dimensions=(40, 120), env=env)
        self._read_lock = asyncio.Lock()

    @property
    def alive(self) -> bool:
        return self.proc.isalive()

    @property
    def fd(self) -> int:
        return self.proc.fd

    async def read(self, size: int = 4096) -> bytes:
        """阻塞读，等到有数据或 EOF。"""
        loop = asyncio.get_running_loop()
        async with self._read_lock:
            return await loop.run_in_executor(None, self.proc.read, size)

    def write(self, data: bytes) -> None:
        self.proc.write(data)

    def resize(self, cols: int, rows: int) -> None:
        try:
            fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        except OSError:
            logger.debug("resize failed", exc_info=True)

    def kill(self) -> None:
        try:
            if self.proc.isalive():
                self.proc.kill(signal.SIGTERM)
                self.proc.wait()
        except Exception:  # noqa: BLE001
            pass


# ---------------------------------------------------------------------------
# agent 主流程


class Agent:
    def __init__(self, config: dict) -> None:
        self.config = config
        self._stop = asyncio.Event()

    def stop(self) -> None:
        self._stop.set()

    async def run(self) -> None:
        url = str(self.config["server_url"])
        token = str(self.config["agent_token"])
        headers = [("Authorization", f"Bearer {token}")]
        backoff = 1.0
        while not self._stop.is_set():
            try:
                logger.info("connecting %s", url)
                async with ws_connect(
                    url,
                    additional_headers=headers,
                    ping_interval=20,
                    ping_timeout=20,
                    open_timeout=10,
                    close_timeout=5,
                    max_size=2 * 1024 * 1024,
                ) as ws:
                    logger.info("connected")
                    backoff = 1.0
                    await self._serve(ws)
            except (WebSocketException, OSError) as e:
                logger.warning("disconnected: %s, reconnect in %.1fs", e, backoff)
            except Exception:  # noqa: BLE001
                logger.exception("unexpected error, reconnect in %.1fs", backoff)
            if self._stop.is_set():
                break
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=backoff)
            except TimeoutError:
                pass
            backoff = min(backoff * 2, 30.0)

    async def _serve(self, ws: ClientConnection) -> None:
        """一次连接的生命周期。pty 是 lazy spawn：等首帧 / client_ready 再起。

        附加：应用层心跳——每 25s 主动发 {"t":"ping"}，60s 内没收到任何消息
        就 close ws，让外层 run() 重连。专门防 "agent 进程活但 WS 半死"。
        """
        pty: PtySession | None = None
        pty_task: asyncio.Task | None = None
        last_rx = asyncio.get_running_loop().time()
        heartbeat_task: asyncio.Task | None = None

        async def pty_to_ws(p: PtySession) -> None:
            while p.alive:
                try:
                    data = await p.read(4096)
                except EOFError:
                    break
                if not data:
                    continue
                try:
                    await ws.send(data)
                except ConnectionClosed:
                    break

        async def report_pty(alive: bool) -> None:
            try:
                await ws.send(json.dumps({"t": "pty_alive", "v": alive}))
            except ConnectionClosed:
                pass

        async def heartbeat() -> None:
            try:
                while True:
                    await asyncio.sleep(25)
                    try:
                        await ws.send(json.dumps({"t": "ping"}))
                    except ConnectionClosed:
                        return
                    now = asyncio.get_running_loop().time()
                    if now - last_rx > 60:
                        logger.warning("heartbeat: no message in %.0fs, forcing reconnect", now - last_rx)
                        try:
                            await ws.close(code=4000, reason="heartbeat timeout")
                        except Exception:  # noqa: BLE001
                            pass
                        return
            except asyncio.CancelledError:
                pass

        def ensure_pty() -> PtySession:
            nonlocal pty, pty_task
            if pty is None:
                shell = str(self.config["shell"])
                term = str(self.config["term"])
                pty = PtySession(shell=shell, term=term)
                pty_task = asyncio.create_task(pty_to_ws(pty))
                logger.info("pty spawned: %s", shell)
                asyncio.create_task(report_pty(True))
            return pty

        def teardown_pty() -> None:
            nonlocal pty, pty_task
            if pty_task is not None and not pty_task.done():
                pty_task.cancel()
            if pty is not None:
                pty.kill()
                asyncio.create_task(report_pty(False))
            pty = None
            pty_task = None

        heartbeat_task = asyncio.create_task(heartbeat())
        try:
            async for msg in ws:
                last_rx = asyncio.get_running_loop().time()
                if isinstance(msg, bytes):
                    ensure_pty().write(msg)
                elif isinstance(msg, str):
                    try:
                        obj = json.loads(msg)
                    except json.JSONDecodeError:
                        continue
                    t = obj.get("t")
                    if t == "client_ready":
                        ensure_pty()
                    elif t == "r":
                        ensure_pty().resize(int(obj.get("c", 80)), int(obj.get("l", 24)))
                    elif t == "client_gone":
                        teardown_pty()
                    elif t == "kill":
                        teardown_pty()
                        break
                    elif t == "hello":
                        logger.info("server hello: %s", obj)
                    elif t == "pong":
                        pass  # 心跳应答；just bumping last_rx 已经够了
        finally:
            if heartbeat_task is not None and not heartbeat_task.done():
                heartbeat_task.cancel()
            teardown_pty()


# ---------------------------------------------------------------------------
# entry


def cli() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    config_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CONFIG_PATH
    config = load_config(config_path)
    agent = Agent(config)

    loop = asyncio.new_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, agent.stop)
    try:
        loop.run_until_complete(agent.run())
    finally:
        loop.close()


if __name__ == "__main__":
    cli()
