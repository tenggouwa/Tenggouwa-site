#!/usr/bin/env python3
"""把 content/posts/ai-series/*.md 一次性推到 admin /api/admin/posts。

用法：
    API_BASE=https://api.tenggouwa.com \\
    ADMIN_USER=xxx ADMIN_PASS=xxx \\
    python3 scripts/publish-series.py [--dir content/posts/ai-series] [--update]

frontmatter 字段：
    slug / title / summary / tags / published_at（ISO 日期或 datetime）

默认遇到已存在 slug 跳过；加 --update 则覆盖更新。
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, time, timedelta, timezone
from pathlib import Path

FM_RE = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.DOTALL)


def parse_frontmatter(text: str) -> tuple[dict, str]:
    m = FM_RE.match(text)
    if not m:
        raise ValueError("missing frontmatter")
    fm_block, body = m.group(1), m.group(2).lstrip("\n")
    data: dict = {}
    for line in fm_block.splitlines():
        line = line.rstrip()
        if not line or line.startswith("#"):
            continue
        key, _, raw = line.partition(":")
        key = key.strip()
        raw = raw.strip()
        if raw.startswith("[") and raw.endswith("]"):
            inner = raw[1:-1].strip()
            data[key] = [x.strip().strip("'\"") for x in inner.split(",") if x.strip()]
        else:
            data[key] = raw.strip("'\"")
    return data, body


def to_iso_datetime(v: str) -> str:
    if "T" in v or " " in v:
        dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
    else:
        dt = datetime.combine(datetime.fromisoformat(v).date(), time(9, 0))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone(timedelta(hours=8)))
    return dt.astimezone(timezone.utc).isoformat()


def http_json(url: str, *, method: str = "GET", body: dict | None = None, token: str | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "tenggouwa-publish/1.0 (+https://tenggouwa.com)",
        "Accept": "application/json",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors="replace")
        raise SystemExit(f"HTTP {e.code} {method} {url}\n{msg}") from e


def login(api_base: str, user: str, password: str) -> str:
    resp = http_json(f"{api_base}/api/admin/auth/login", method="POST", body={"username": user, "password": password})
    data = resp["data"]
    if not data["requires_totp"]:
        return data["token"]
    code = input("TOTP code (6 digits): ").strip()
    resp = http_json(
        f"{api_base}/api/admin/auth/totp/verify",
        method="POST",
        body={"step_token": data["step_token"], "code": code},
    )
    return resp["data"]["token"]


def find_existing(api_base: str, token: str) -> dict[str, int]:
    resp = http_json(f"{api_base}/api/admin/posts", token=token)
    return {p["slug"]: p["id"] for p in resp["data"]}


def upsert(api_base: str, token: str, payload: dict, existing_id: int | None, *, update: bool) -> None:
    if existing_id is None:
        http_json(f"{api_base}/api/admin/posts", method="POST", body=payload, token=token)
        print(f"  ✓ created  {payload['slug']}  published_at={payload['published_at']}")
        return
    if not update:
        print(f"  - skip     {payload['slug']}  (exists; pass --update to overwrite)")
        return
    update_payload = {k: payload[k] for k in ("title", "summary", "tags", "content", "published_at")}
    http_json(f"{api_base}/api/admin/posts/{existing_id}", method="PUT", body=update_payload, token=token)
    print(f"  ✓ updated  {payload['slug']}  published_at={payload['published_at']}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="content/posts/ai-series")
    ap.add_argument("--update", action="store_true", help="覆盖已存在的 slug")
    args = ap.parse_args()

    api_base = os.environ.get("API_BASE", "http://localhost:8000").rstrip("/")
    user = os.environ.get("ADMIN_USER") or input("admin user: ").strip()
    password = os.environ.get("ADMIN_PASS") or getpass.getpass("admin pass: ")

    print(f"→ login {api_base} as {user}")
    token = login(api_base, user, password)

    root = Path(args.dir)
    files = sorted(root.glob("*.md"))
    if not files:
        print(f"no .md under {root}")
        return

    existing = find_existing(api_base, token)
    print(f"→ {len(files)} file(s); {len(existing)} existing post(s)")

    for path in files:
        fm, body = parse_frontmatter(path.read_text())
        if "published_at" in fm:
            fm["published_at"] = to_iso_datetime(fm["published_at"])
        payload = {
            "slug": fm["slug"],
            "title": fm["title"],
            "summary": fm.get("summary", ""),
            "tags": fm.get("tags", []),
            "content": body,
            "published_at": fm.get("published_at"),
        }
        upsert(api_base, token, payload, existing.get(payload["slug"]), update=args.update)


if __name__ == "__main__":
    main()
