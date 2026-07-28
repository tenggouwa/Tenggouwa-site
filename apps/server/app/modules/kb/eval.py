"""Pure offline retrieval metrics used by the curated KB regression corpus."""

import math


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
