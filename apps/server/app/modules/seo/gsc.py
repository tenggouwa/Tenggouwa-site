"""Google Search Console + Google Indexing API 客户端。

凭据来源：环境变量 GSC_SERVICE_ACCOUNT_JSON 直接放完整 JSON 内容（CI/部署
注入），或 GSC_SERVICE_ACCOUNT_FILE 指向一个 JSON 文件。

站点标识从 GSC_SITE_URL 读，常见两种格式：
  - "sc-domain:tenggouwa.com"   域名属性
  - "https://tenggouwa.com/"    URL 前缀属性
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Iterable
from datetime import date, timedelta

logger = logging.getLogger(__name__)

GSC_SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]
INDEXING_SCOPES = ["https://www.googleapis.com/auth/indexing"]


def _load_service_account_info() -> dict | None:
    raw = os.environ.get("GSC_SERVICE_ACCOUNT_JSON")
    if raw:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            logger.exception("GSC_SERVICE_ACCOUNT_JSON is not valid JSON")
            return None
    file_path = os.environ.get("GSC_SERVICE_ACCOUNT_FILE")
    if file_path and os.path.exists(file_path):
        with open(file_path) as fp:
            return json.load(fp)
    return None


def _build_client(api: str, version: str, scopes: list[str]):
    """同步构造 google-api client。在线程池里跑，不阻塞事件循环。"""
    info = _load_service_account_info()
    if info is None:
        return None
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    creds = service_account.Credentials.from_service_account_info(info, scopes=scopes)
    return build(api, version, credentials=creds, cache_discovery=False)


def fetch_search_analytics_sync(
    *,
    days_back: int = 1,
    row_limit: int = 1000,
) -> list[dict]:
    """同步：拉一天的 Search Analytics 数据，按 (page, query) 分组。

    返回 list[ {page, query, clicks, impressions, ctr, position} ]。
    Google API 把 query 放在 keys[1]；不分组的话只能拿到 page 维度。
    """
    site = os.environ.get("GSC_SITE_URL")
    if not site:
        logger.info("GSC fetch skip: GSC_SITE_URL not set")
        return []
    client = _build_client("searchconsole", "v1", GSC_SCOPES)
    if client is None:
        logger.info("GSC fetch skip: no service account")
        return []
    end = date.today() - timedelta(days=1)
    start = end - timedelta(days=days_back - 1)
    body = {
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "dimensions": ["page", "query"],
        "rowLimit": row_limit,
    }
    resp = client.searchanalytics().query(siteUrl=site, body=body).execute()
    rows = resp.get("rows", [])
    out: list[dict] = []
    for r in rows:
        keys = r.get("keys", ["", ""])
        out.append(
            {
                "page": keys[0],
                "query": keys[1] if len(keys) > 1 else "",
                "clicks": int(r.get("clicks", 0)),
                "impressions": int(r.get("impressions", 0)),
                "ctr": float(r.get("ctr", 0)),
                "position": float(r.get("position", 0)),
            }
        )
    return out


def url_index_status_sync(urls: Iterable[str]) -> dict[str, bool]:
    """同步：批量查 URL 是否被 Google 索引（URL Inspection API）。

    返回 dict[url, indexed]，未在 GSC 站点里的 URL 不会出现。
    Inspection API 每次 1 个 URL，整批用同步循环跑（量不大 < 100）。
    """
    site = os.environ.get("GSC_SITE_URL")
    if not site:
        return {}
    client = _build_client("searchconsole", "v1", GSC_SCOPES)
    if client is None:
        return {}
    result: dict[str, bool] = {}
    for url in urls:
        try:
            resp = (
                client.urlInspection()
                .index()
                .inspect(body={"inspectionUrl": url, "siteUrl": site})
                .execute()
            )
            verdict = resp.get("inspectionResult", {}).get("indexStatusResult", {}).get("verdict")
            result[url] = verdict == "PASS"
        except Exception:
            logger.exception(f"inspection failed for {url}")
            result[url] = False
    return result


def submit_url_for_indexing_sync(url: str, *, deleted: bool = False) -> bool:
    """同步：调 Google Indexing API 推一个 URL（type: URL_UPDATED / URL_DELETED）。

    注意：Indexing API 官方只允许 JobPosting / BroadcastEvent 类型，但实践中
    BlogPosting 也能加速抓取（Google 不保证）。
    """
    info = _load_service_account_info()
    if info is None:
        return False
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    creds = service_account.Credentials.from_service_account_info(info, scopes=INDEXING_SCOPES)
    client = build("indexing", "v3", credentials=creds, cache_discovery=False)
    body = {"url": url, "type": "URL_DELETED" if deleted else "URL_UPDATED"}
    try:
        client.urlNotifications().publish(body=body).execute()
        return True
    except Exception:
        logger.exception(f"Indexing API publish failed for {url}")
        return False
