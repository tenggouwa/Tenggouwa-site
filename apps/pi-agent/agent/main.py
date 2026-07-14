"""tenggouwa pi-agent

周期采集树莓派系统遥测，主动 POST 给后端 /api/agent/pi/report。
服务器没有任何入站连接，全部走 Pi 主动发起的 outbound HTTPS。

配置走环境变量（systemd EnvironmentFile，见 install.sh）：
  PI_AGENT_SERVER_URL  后端基址，如 https://api.tenggouwa.com
  PI_AGENT_TOKEN       上报鉴权 token（要与后端 PI_AGENT_TOKEN 一致）
  PI_AGENT_INTERVAL    上报间隔秒数，默认 30

纯 stdlib，零三方依赖，系统 python3 (>=3.9) 直接跑。
"""

from __future__ import annotations

import json
import logging
import os
import signal
import threading
import time
import urllib.error
import urllib.request

from . import __version__, artifact, executor, probe, telemetry

logger = logging.getLogger("pi-agent")


def _post(url: str, token: str, body: dict | list, timeout: float = 10.0) -> None:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {token}")
    # 自定义 UA：Cloudflare 默认会 403 拦 "Python-urllib" 这类 UA（error 1010）
    req.add_header("User-Agent", f"tenggouwa-pi-agent/{__version__}")
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (固定 https 后端)
        resp.read()


def run() -> None:
    server = os.environ.get("PI_AGENT_SERVER_URL", "").rstrip("/")
    token = os.environ.get("PI_AGENT_TOKEN", "")
    interval = float(os.environ.get("PI_AGENT_INTERVAL", "30"))
    if not server or not token:
        raise SystemExit("[pi-agent] 缺少 PI_AGENT_SERVER_URL / PI_AGENT_TOKEN 环境变量")
    url = f"{server}/api/agent/pi/report"
    artifact_url = f"{server}/api/agent/pi/artifact"
    probe_url = f"{server}/api/agent/pi/probe"
    probe_every = 60.0  # 每 60s 跑一轮监控探针

    stop = {"v": False}

    def _stop(*_: object) -> None:
        stop["v"] = True

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    # 沙箱 exec（D2）：off-by-default，PI_AGENT_EXEC=1 才起一条独立线程长轮询接命令，不干扰遥测。
    if os.environ.get("PI_AGENT_EXEC", "").strip().lower() in ("1", "true", "yes"):
        threading.Thread(target=executor.exec_loop, args=(server, token, stop), daemon=True).start()
        logger.info("sandbox exec enabled")

    logger.info("pi-agent up, reporting to %s every %.0fs", url, interval)
    backoff = 1.0
    last_artifact_day = None
    last_probe = 0.0
    while not stop["v"]:
        wait = interval
        try:
            _post(url, token, telemetry.collect())
            backoff = 1.0
        except urllib.error.HTTPError as e:
            logger.warning("report rejected: HTTP %s", e.code)
        except (urllib.error.URLError, OSError) as e:
            logger.warning("report failed: %s (retry in %.0fs)", e, backoff)
            wait = backoff
            backoff = min(backoff * 2, 30.0)

        # 每日产物：每天首次成功上报后，让 Pi 自己算一张 ASCII 曼德博集合推上去
        today = time.strftime("%Y-%m-%d", time.gmtime())
        if today != last_artifact_day:
            try:
                _post(artifact_url, token, artifact.generate())
                last_artifact_day = today
                logger.info("posted daily artifact for %s", today)
            except (urllib.error.HTTPError, urllib.error.URLError, OSError) as e:
                logger.warning("artifact post failed: %s", e)

        # 监控探针：每 60s 跑一轮（HTTP 延迟 + 下行吞吐），结果 POST 上去
        now_m = time.monotonic()
        if now_m - last_probe >= probe_every:
            last_probe = now_m
            try:
                _post(probe_url, token, probe.run())
            except (urllib.error.HTTPError, urllib.error.URLError, OSError) as e:
                logger.warning("probe post failed: %s", e)

        slept = 0.0
        while slept < wait and not stop["v"]:
            time.sleep(0.5)
            slept += 0.5
    logger.info("pi-agent stopped")


def cli() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    run()


if __name__ == "__main__":
    cli()
