"""Safe retrieval-evaluation metrics and report builder."""

import math
from collections.abc import Awaitable, Callable
from typing import Any


def recall_at_k(results: list[str], expected: set[str], k: int) -> float:
    """Fraction of expected document IDs found in the first ``k`` results."""
    if not expected:
        return 1.0
    return len(set(results[:k]).intersection(expected)) / len(expected)


def ndcg_at_k(results: list[str], expected: set[str], k: int) -> float:
    """Binary-relevance nDCG@k for comparing retrieval configurations."""
    dcg = sum(1 / math.log2(index + 2) for index, item in enumerate(results[:k]) if item in expected)
    ideal = sum(1 / math.log2(index + 2) for index in range(min(k, len(expected))))
    return dcg / ideal if ideal else 1.0


async def evaluate_cases(
    cases: list[dict[str, Any]],
    retrieve: Callable[[str, int], Awaitable[list[dict[str, Any]]]],
    *,
    top_k: int,
) -> dict[str, Any]:
    """Evaluate curated cases and return a report that excludes chunk content and configuration."""
    results: list[dict[str, Any]] = []
    for case in cases:
        seen_urls: set[str] = set()
        retrieved: list[dict[str, str | float | None]] = []
        for hit in await retrieve(case["query"], top_k * 3):
            url = hit.get("url")
            if not isinstance(url, str) or url in seen_urls:
                continue
            seen_urls.add(url)
            retrieved.append(
                {
                    "title": str(hit.get("title") or ""),
                    "url": url,
                    "score": float(hit.get("score") or 0),
                }
            )
            if len(retrieved) == top_k:
                break
        expected = set(case["expected_urls"])
        urls = [str(hit["url"]) for hit in retrieved]
        recall = recall_at_k(urls, expected, top_k)
        ndcg = ndcg_at_k(urls, expected, top_k)
        first_expected_rank = next((index + 1 for index, url in enumerate(urls) if url in expected), None)
        results.append(
            {
                "id": case["id"],
                "query": case["query"],
                "expected_urls": sorted(expected),
                "retrieved": retrieved,
                "metrics": {
                    "recall_at_k": recall,
                    "ndcg_at_k": ndcg,
                    "first_expected_rank": first_expected_rank,
                    "reciprocal_rank": 1 / first_expected_rank if first_expected_rank else 0.0,
                },
                "passed": bool(set(urls).intersection(expected)),
            }
        )
    count = len(results)
    failed = [case["id"] for case in results if not case["passed"]]
    return {
        "top_k": top_k,
        "cases": results,
        "summary": {
            "cases": count,
            "recall_at_k": sum(case["metrics"]["recall_at_k"] for case in results) / count if count else 0.0,
            "ndcg_at_k": sum(case["metrics"]["ndcg_at_k"] for case in results) / count if count else 0.0,
            "top_1_rate": sum(case["metrics"]["first_expected_rank"] == 1 for case in results) / count
            if count
            else 0.0,
            "mean_reciprocal_rank": sum(case["metrics"]["reciprocal_rank"] for case in results) / count
            if count
            else 0.0,
            "failed_case_ids": failed,
        },
    }
