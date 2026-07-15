"""tenggouwa pi-agent · 沙箱 exec

长轮询后端 /api/agent/pi/exec-poll 拿一条命令 → bwrap 里跑 → POST 回 /exec-result。
和遥测循环并行跑在独立线程。纯 stdlib（urllib + subprocess + threading），零三方依赖。

安全（见 docs/agent/agent-d2-sandbox-design.md）：
- **off-by-default**：只有 PI_AGENT_EXEC=1 才起这条线程。
- 命令强制 bwrap 隔离：`--clearenv`（丢掉 daemon 自己的 PI_AGENT_TOKEN 等 env，命令读不到！）
  + 只读系统 + 只绑 workspace 读写 + `--chdir` workspace + 默认 `--unshare-net`（无网）+ 超时。
- bwrap 不存在则**拒执行**（除非显式 PI_AGENT_EXEC_ALLOW_UNSANDBOXED=1，仅供你信得过的机器裸跑）。
- 输出字节上限 64KB（服务端还会再按 MAX_TOOL_RESULT_CHARS 兜底截断）。

配置（env / systemd EnvironmentFile）：
  PI_AGENT_EXEC                   =1 开启沙箱 exec
  PI_AGENT_WORKSPACE             命令的 jailed 工作目录，默认 ~/.tenggouwa-agent/workspace
  PI_AGENT_EXEC_ALLOW_NET        =1 允许命令联网（默认无网）
  PI_AGENT_EXEC_ALLOW_UNSANDBOXED =1 无 bwrap 时也裸跑（危险，默认否）
"""

from __future__ import annotations

import json
import logging
import os
import queue
import select
import shutil
import subprocess  # noqa: S404 —— 沙箱执行本就要 subprocess
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path

from . import __version__

logger = logging.getLogger("pi-agent.exec")

_POLL_TIMEOUT = 20.0  # > 服务端 10s 长轮询挂起上限，留网络余量
_MAX_OUTPUT = 64_000  # 回传输出字节上限
_MAX_CMD_TIMEOUT = 120.0  # 单命令执行硬上限（服务端一般传 30）
_POLL_BACKOFF_MAX = 5.0  # 轮询失败退避封顶（秒）：代理抖一下别退到几十秒不接命令
_RESULT_RETRIES = 4  # 结果 POST 重试次数：命令跑完了别因一次 SSL EOF 把结果丢了（服务端白等超时）
_MAX_READ_CHARS = 8_000  # file_read 回给 LLM 的正文上限
_MAX_READ_BYTES = 200_000  # file_read 读盘上限
_MAX_WRITE_BYTES = 100_000  # file_write 内容上限
_MAX_ENTRIES = 200  # file_list 条数上限


def _default_workspace() -> str:
    return str(Path(os.environ.get("PI_AGENT_WORKSPACE") or (Path.home() / ".tenggouwa-agent" / "workspace")))


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes")


def _build_argv(cmd: str, workspace: str, *, allow_net: bool) -> list[str]:
    """构造执行 argv：有 bwrap 就关进 namespace 沙箱，否则（已确认允许）裸跑 sh -lc。"""
    if shutil.which("bwrap"):
        argv = [
            "bwrap",
            "--die-with-parent",
            "--unshare-all",  # user/ipc/pid/net/uts/cgroup 全 unshare（含无网）
            "--clearenv",  # 关键：丢掉 daemon 的 env，命令读不到 PI_AGENT_TOKEN 等
            "--ro-bind",
            "/",
            "/",  # 系统只读
            "--dev",
            "/dev",
            "--proc",
            "/proc",
            "--tmpfs",
            "/tmp",
            "--bind",
            workspace,
            workspace,  # 只有 workspace 可写
            "--chdir",
            workspace,
            "--setenv",
            "HOME",
            workspace,
            "--setenv",
            "PATH",
            "/usr/local/bin:/usr/bin:/bin",
            "--setenv",
            "TERM",
            "dumb",
        ]
        if allow_net:
            argv += ["--share-net"]  # 显式放开网络
        argv += ["--", "/bin/sh", "-lc", cmd]
        return argv
    return ["/bin/sh", "-lc", cmd]  # 无 bwrap：调用方已确认 ALLOW_UNSANDBOXED


def _run_command(cmd: str, workspace: str, timeout: float, *, allow_net: bool, on_chunk: Callable[[str], None]) -> dict:
    """流式执行：Popen + select 边读边累计输出；块经**独立线程** POST（on_chunk 可能阻塞的网络 IO
    绝不卡在读循环里，否则一次慢 POST 会撑爆管道、把跑完的命令误判超时）。best-effort，丢块无碍。
    """
    argv = _build_argv(cmd, workspace, allow_net=allow_net)
    timeout = max(1.0, min(timeout, _MAX_CMD_TIMEOUT))

    chunk_q: queue.Queue = queue.Queue()
    stop = object()

    def _poster() -> None:
        while True:
            item = chunk_q.get()
            if item is stop:
                return
            try:
                on_chunk(item)
            except Exception:  # noqa: BLE001 —— chunk 发送失败不影响命令执行
                pass

    poster = threading.Thread(target=_poster, daemon=True)
    poster.start()

    proc = subprocess.Popen(  # noqa: S603 —— 命令已过 TOTP 私有通道 + C2 审批 + bwrap 沙箱
        argv, cwd=workspace, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
    )
    assert proc.stdout is not None
    fd = proc.stdout.fileno()
    buf = bytearray()
    streamed = 0
    deadline = time.monotonic() + timeout
    timed_out = False
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                timed_out = True
                break
            ready, _, _ = select.select([fd], [], [], min(remaining, 0.5))
            if not ready:
                continue  # 暂无输出，回头看是否超时
            data = os.read(fd, 4096)
            if not data:
                break  # EOF：进程输出结束
            buf.extend(data)
            if streamed < _MAX_OUTPUT:  # 只把上限内的输出往前端流，别 firehose
                chunk_q.put(data.decode("utf-8", errors="replace"))  # 非阻塞入队，网络 IO 交给 poster 线程
                streamed += len(data)
    finally:
        proc.stdout.close()
        chunk_q.put(stop)
        poster.join(timeout=3.0)  # 给残余块 POST 一点时间（尽量在 result 前到），但别为它拖住命令返回

    if timed_out:
        proc.kill()  # bwrap --die-with-parent 会连带清掉沙箱内子进程
    for _ in range(2):
        try:
            proc.wait(timeout=5)
            break
        except subprocess.TimeoutExpired:
            proc.kill()
    text = bytes(buf).decode("utf-8", errors="replace")
    return {
        "rc": 124 if timed_out else (proc.returncode if proc.returncode is not None else -1),
        "output": text[:_MAX_OUTPUT],
        "truncated": len(text) > _MAX_OUTPUT,
        "timed_out": timed_out,
    }


def _run_file(op: str, path: str, content: str, workspace: str) -> dict:
    """在 workspace 内 jail 执行文件操作（read/write/list）。realpath 后须仍落在 workspace 内，否则拒。"""
    root = Path(workspace).resolve()
    target = (root / (path or ".").lstrip("/")).resolve()
    if not (target == root or target.is_relative_to(root)):  # 越狱（符号链接/`..`/绝对）→ 拒
        return {"rc": 1, "output": "（拒绝：路径越出 workspace。）", "truncated": False, "timed_out": False}
    try:
        if op == "list":
            if not target.exists():
                return _fresult(1, f"（不存在：{path}）")
            if not target.is_dir():
                return _fresult(1, f"（不是目录：{path}）")
            lines = []
            for i, p in enumerate(sorted(target.iterdir())):
                if i >= _MAX_ENTRIES:
                    lines.append(f"…（还有更多，已截断到 {_MAX_ENTRIES} 项）")
                    break
                lines.append(
                    f"{'dir ' if p.is_dir() else 'file'}\t{p.stat().st_size if p.is_file() else '-'}\t{p.name}"
                )
            header = "./" if target == root else f"{target.relative_to(root)}/"
            return _fresult(0, header + "\n" + ("\n".join(lines) if lines else "（空目录）"))
        if op == "read":
            if not target.is_file():
                return _fresult(1, f"（不存在或不是文件：{path}）")
            with target.open("rb") as f:
                raw = f.read(_MAX_READ_BYTES + 1)  # 至多读上限+1 字节，别把超大文件整个吃进内存（Pi OOM）
            text = raw[:_MAX_READ_BYTES].decode("utf-8", errors="replace")
            if len(raw) > _MAX_READ_BYTES or len(text) > _MAX_READ_CHARS:
                return _fresult(0, text[:_MAX_READ_CHARS] + "\n…[已截断，文件更大]", truncated=True)
            return _fresult(0, text or "（空文件）")
        if op == "write":
            if target == root or target.is_dir():
                return _fresult(1, f"（目标是目录，不能写：{path}）")
            if len(content.encode("utf-8")) > _MAX_WRITE_BYTES:
                return _fresult(1, f"（内容过大，上限 {_MAX_WRITE_BYTES} 字节。）")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
            return _fresult(0, f"（已写入 {target.relative_to(root)}，{len(content)} 字。）")
        return _fresult(1, f"（未知文件操作：{op}）")
    except OSError as e:
        return _fresult(1, f"（文件操作失败：{e.strerror or '错误'}）")  # 只回 errno 文案，不泄漏宿主绝对路径


def _fresult(rc: int, output: str, *, truncated: bool = False) -> dict:
    return {"rc": rc, "output": output, "truncated": truncated, "timed_out": False}


def _headers(token: str) -> dict[str, str]:
    # 自定义 UA：Cloudflare 会 403 拦 "Python-urllib"（error 1010）
    return {"Authorization": f"Bearer {token}", "User-Agent": f"tenggouwa-pi-agent/{__version__}"}


def _post_chunk(server: str, token: str, rid: str, chunk: str) -> None:
    """把一块流式输出推给后端（best-effort，短超时、不重试——纯 UI 实时显示，丢了无碍）。"""
    body = json.dumps({"id": rid, "chunk": chunk}).encode("utf-8")
    headers = {**_headers(token), "Content-Type": "application/json"}
    req = urllib.request.Request(f"{server}/api/agent/pi/exec-chunk", data=body, method="POST", headers=headers)
    with urllib.request.urlopen(req, timeout=5.0) as resp:  # noqa: S310
        resp.read()


def _poll(server: str, token: str) -> dict | None:
    req = urllib.request.Request(f"{server}/api/agent/pi/exec-poll", method="GET", headers=_headers(token))
    with urllib.request.urlopen(req, timeout=_POLL_TIMEOUT) as resp:  # noqa: S310 (固定 https 后端)
        payload = json.loads(resp.read())
    return (payload.get("data") or {}).get("command")


def _post_result(server: str, token: str, result: dict) -> None:
    """回传结果，带重试——命令已经跑完了，别因一次网络抖动把结果丢了（服务端会白等到超时）。"""
    body = json.dumps(result).encode("utf-8")
    headers = {**_headers(token), "Content-Type": "application/json"}
    last: Exception | None = None
    for attempt in range(_RESULT_RETRIES):
        try:
            req = urllib.request.Request(
                f"{server}/api/agent/pi/exec-result", data=body, method="POST", headers=headers
            )
            with urllib.request.urlopen(req, timeout=10.0) as resp:  # noqa: S310
                resp.read()
            return
        except (urllib.error.URLError, OSError) as e:
            last = e
            if attempt < _RESULT_RETRIES - 1:
                time.sleep(min(1.0 * 2**attempt, 8.0))
    raise last if last else RuntimeError("exec-result post failed")


def exec_loop(server: str, token: str, stop: dict) -> None:
    """长轮询 → 执行 → 回传，直到 stop['v']。异常退避重试，不让线程死掉。"""
    if not shutil.which("bwrap") and not _flag("PI_AGENT_EXEC_ALLOW_UNSANDBOXED"):
        logger.error("bwrap 不存在且未设 PI_AGENT_EXEC_ALLOW_UNSANDBOXED，沙箱 exec 禁用")
        return
    workspace = _default_workspace()
    allow_net = _flag("PI_AGENT_EXEC_ALLOW_NET")
    Path(workspace).mkdir(parents=True, exist_ok=True)
    logger.info("exec loop up (workspace=%s, net=%s, bwrap=%s)", workspace, allow_net, bool(shutil.which("bwrap")))
    backoff = 1.0
    while not stop["v"]:
        try:
            cmd = _poll(server, token)
            backoff = 1.0
        except urllib.error.HTTPError as e:
            logger.warning("exec-poll rejected: HTTP %s", e.code)
            time.sleep(backoff)
            backoff = min(backoff * 2, _POLL_BACKOFF_MAX)
            continue
        except (urllib.error.URLError, OSError, json.JSONDecodeError) as e:
            # 代理抖动（SSL EOF / timeout）很常见：小步退避快速重连，别一抖就几十秒不接命令
            logger.warning("exec-poll failed: %s (retry in %.0fs)", e, backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, _POLL_BACKOFF_MAX)
            continue
        if not cmd:
            continue  # 空轮询（挂起上限内无命令）→ 立即再来
        rid = cmd["id"]

        # 整段执行兜底 try：一条命令的任何异常（如 path 含 null 字节的 ValueError、超大文件 MemoryError）
        # 都不能崩掉这条共享的 exec 线程——否则会连累 shell 一起挂，得重启 daemon 才恢复。
        try:
            if cmd.get("kind") == "file":
                result = _run_file(cmd.get("op", ""), cmd.get("path", ""), cmd.get("content", ""), workspace)
            else:

                def _chunk(text: str, _rid: str = rid) -> None:
                    try:
                        _post_chunk(server, token, _rid, text)
                    except (urllib.error.URLError, OSError):
                        pass  # chunk 是纯 UI 实时输出，丢了无碍（最终结果照常回传）

                result = _run_command(
                    cmd["cmd"], workspace, float(cmd.get("timeout", 30)), allow_net=allow_net, on_chunk=_chunk
                )
        except Exception as e:  # noqa: BLE001 —— 单条命令出错不该崩线程
            logger.exception("command %s failed", rid)
            result = {"rc": 1, "output": f"（执行出错：{e}）", "truncated": False, "timed_out": False}
        result["id"] = rid
        try:
            _post_result(server, token, result)
        except (urllib.error.HTTPError, urllib.error.URLError, OSError) as e:
            logger.warning("exec-result post failed: %s", e)
    logger.info("exec loop stopped")
