"""KB 离线评测基线：语料必须可读，指标不依赖数据库或模型。"""

import json
import re
from pathlib import Path

from modules.kb.eval import evaluate_cases, ndcg_at_k, recall_at_k


def test_kb_retrieval_corpus_has_unique_queries_and_expected_urls():
    path = Path(__file__).parent / "fixtures" / "kb_retrieval_eval.json"
    corpus = json.loads(path.read_text())
    assert len({case["id"] for case in corpus}) == len(corpus)
    assert all(case["query"].strip() and case["expected_urls"] for case in corpus)


def test_kb_retrieval_corpus_urls_match_current_published_posts():
    root = Path(__file__).parents[3]
    urls = {
        f"/posts/{match.group(1)}/"
        for path in (root / "content" / "posts").rglob("*.md")
        if (match := re.search(r"^slug:\s*(\S+)\s*$", path.read_text(), re.MULTILINE))
    }
    corpus = json.loads((Path(__file__).parent / "fixtures" / "kb_retrieval_eval.json").read_text())
    assert {url for case in corpus for url in case["expected_urls"]}.issubset(urls)


def test_retrieval_metrics():
    expected = {"a", "b"}
    assert recall_at_k(["x", "a", "b"], expected, 2) == 0.5
    assert ndcg_at_k(["a", "x", "b"], expected, 3) > 0.9


async def test_evaluate_cases_reports_only_safe_retrieval_metadata():
    async def retrieve(_query: str, _limit: int):
        return [
            {"title": "目标文章", "url": "/posts/target/", "score": 0.8, "content": "不得出现在报告"},
            {"title": "重复 chunk", "url": "/posts/target/", "score": 0.7, "content": "不得出现在报告"},
            {"title": "其他文章", "url": "/posts/other/", "score": 0.5, "content": "不得出现在报告"},
        ]

    report = await evaluate_cases(
        [{"id": "case", "query": "查询", "expected_urls": ["/posts/target/"]}], retrieve, top_k=2
    )

    assert report["summary"] == {
        "cases": 1,
        "recall_at_k": 1.0,
        "ndcg_at_k": 1.0,
        "top_1_rate": 1.0,
        "mean_reciprocal_rank": 1.0,
        "failed_case_ids": [],
    }
    assert report["cases"][0]["retrieved"] == [
        {"title": "目标文章", "url": "/posts/target/", "score": 0.8},
        {"title": "其他文章", "url": "/posts/other/", "score": 0.5},
    ]
    assert report["cases"][0]["metrics"]["first_expected_rank"] == 1
    assert report["cases"][0]["metrics"]["reciprocal_rank"] == 1.0
    assert "content" not in str(report)
