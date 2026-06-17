#!/bin/sh
# 开机校时。Pi 4 无 RTC，断电重启时钟会漂 → HTTPS 证书校验失败（not yet valid）。
# 走代理从 HTTP Date 头取正确时间设进系统（NTP 的 UDP 多半被公司/校园网挡）。
# 由 systemd ExecStartPre=+ 以 root 调用（date -s 需 root）；读 env 里的 http_proxy。
# 能直连公网（http_proxy 为空）时 curl --proxy "" 即不走代理，一样工作。
D=$(curl -sf -m 10 -I -x "${http_proxy:-}" http://www.gstatic.com/generate_204 2>/dev/null \
    | grep -i '^date:' | cut -d' ' -f2-)
[ -n "$D" ] && date -s "$D"
exit 0
