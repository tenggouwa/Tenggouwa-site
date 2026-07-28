"""KB 离线评测基线：语料必须可读，指标不依赖数据库或模型。"""

import json
from pathlib import Path

from modules.kb.eval import ndcg_at_k, recall_at_k


def test_kb_retrieval_corpus_has_unique_queries_and_expected_urls():
    path = Path(__file__).parent / "fixtures" / "kb_retrieval_eval.json"
    corpus = json.loads(path.read_text())
    assert len({case["id"] for case in corpus}) == len(corpus)
    assert all(case["query"].strip() and case["expected_urls"] for case in corpus)


def test_retrieval_metrics():
    expected = {"a", "b"}
    assert recall_at_k(["x", "a", "b"], expected, 2) == 0.5
    assert ndcg_at_k(["a", "x", "b"], expected, 3) > 0.9
