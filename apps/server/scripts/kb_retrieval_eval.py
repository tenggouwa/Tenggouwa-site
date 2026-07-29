"""Run the curated KB retrieval evaluation and write a safe JSON report."""

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

APP_ROOT = Path(__file__).parents[1] / "app"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from db import async_pg  # noqa: E402
from modules.kb.eval import evaluate_cases  # noqa: E402
from modules.kb.service import kb_service  # noqa: E402

DEFAULT_CORPUS = Path(__file__).parents[1] / "tests" / "fixtures" / "kb_retrieval_eval.json"


async def run(corpus_path: Path, output_path: Path, top_k: int) -> dict[str, Any]:
    """Retrieve all curated cases and persist only safe result metadata."""
    cases = json.loads(corpus_path.read_text())
    async with async_pg.session() as session:
        report = await evaluate_cases(
            cases,
            lambda query, limit: kb_service.retrieve(session, query, None, limit=limit),
            top_k=top_k,
        )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--top-k", type=int, default=3)
    args = parser.parse_args()
    if args.top_k < 1:
        parser.error("--top-k must be at least 1")
    report = asyncio.run(run(args.corpus, args.output, args.top_k))
    summary = report["summary"]
    print(
        f"KB retrieval eval: {summary['cases']} cases, Recall@{args.top_k}={summary['recall_at_k']:.3f}, "
        f"nDCG@{args.top_k}={summary['ndcg_at_k']:.3f}, failed={len(summary['failed_case_ids'])}"
    )


if __name__ == "__main__":
    main()
