"""KB 离线评测基线：语料必须可读，指标不依赖数据库或模型。"""

import json
import re
from pathlib import Path

from modules.kb.eval import ndcg_at_k, recall_at_k


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
