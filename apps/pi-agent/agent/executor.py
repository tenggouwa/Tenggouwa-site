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
import shutil
import subprocess  # noqa: S404 —— 沙箱执行本就要 subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

from . import __version__

logger = logging.getLogger("pi-agent.exec")

_POLL_TIMEOUT = 20.0  # > 服务端 10s 长轮询挂起上限，留网络余量
_MAX_OUTPUT = 64_000  # 回传输出字节上限
_MAX_CMD_TIMEOUT = 120.0  # 单命令执行硬上限（服务端一般传 30）
_POLL_BACKOFF_MAX = 5.0  # 轮询失败退避封顶（秒）：代理抖一下别退到几十秒不接命令
_RESULT_RETRIES = 4  # 结果 POST 重试次数：命令跑完了别因一次 SSL EOF 把结果丢了（服务端白等超时）


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
            "--ro-bind", "/", "/",  # 系统只读
            "--dev", "/dev",
            "--proc", "/proc",
            "--tmpfs", "/tmp",
            "--bind", workspace, workspace,  # 只有 workspace 可写
            "--chdir", workspace,
            "--setenv", "HOME", workspace,
            "--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin",
            "--setenv", "TERM", "dumb",
        ]
        if allow_net:
            argv += ["--share-net"]  # 显式放开网络
        argv += ["--", "/bin/sh", "-lc", cmd]
        return argv
    return ["/bin/sh", "-lc", cmd]  # 无 bwrap：调用方已确认 ALLOW_UNSANDBOXED


def _run_command(cmd: str, workspace: str, timeout: float, *, allow_net: bool) -> dict:
    argv = _build_argv(cmd, workspace, allow_net=allow_net)
    timeout = max(1.0, min(timeout, _MAX_CMD_TIMEOUT))
    try:
        p = subprocess.run(  # noqa: S603 —— 命令已经 TOTP 私有通道 + C2 审批 + bwrap 沙箱
            argv, cwd=workspace, capture_output=True, timeout=timeout, check=False
        )
        raw, rc, timed_out = p.stdout + p.stderr, p.returncode, False
    except subprocess.TimeoutExpired as e:
        raw = (e.stdout or b"") + (e.stderr or b"")
        rc, timed_out = 124, True
    text = raw.decode("utf-8", errors="replace")
    return {
        "rc": rc,
        "output": text[:_MAX_OUTPUT],
        "truncated": len(text) > _MAX_OUTPUT,
        "timed_out": timed_out,
    }


def _headers(token: str) -> dict[str, str]:
    # 自定义 UA：Cloudflare 会 403 拦 "Python-urllib"（error 1010）
    return {"Authorization": f"Bearer {token}", "User-Agent": f"tenggouwa-pi-agent/{__version__}"}


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
        result = _run_command(cmd["cmd"], workspace, float(cmd.get("timeout", 30)), allow_net=allow_net)
        result["id"] = cmd["id"]
        try:
            _post_result(server, token, result)
        except (urllib.error.HTTPError, urllib.error.URLError, OSError) as e:
            logger.warning("exec-result post failed: %s", e)
    logger.info("exec loop stopped")
