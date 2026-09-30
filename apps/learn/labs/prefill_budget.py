"""Teaching-only per-request prefill budget; not an engine patch or benchmark.
Run: python3 prefill_budget.py
"""
from itertools import product
import json


def prefill_grant(remaining, token_budget, decode_tokens, cap=0):
    """Reserve decode budget first; cap=0 preserves the uncapped policy."""
    values = (remaining, token_budget, decode_tokens, cap)
    if any(type(value) is not int for value in values):
        raise ValueError('counts must be integers')
    if min(values) < 0:
        raise ValueError('counts must be non-negative')
    if decode_tokens > token_budget:
        raise ValueError('decode reservation exceeds budget')
    available = token_budget - decode_tokens
    limit = remaining if cap == 0 else cap
    return min(remaining, available, limit)


def self_test():
    assert prefill_grant(2048, 512, 8, 0) == 504
    assert prefill_grant(2048, 512, 8, 128) == 128
    assert prefill_grant(7, 512, 8, 128) == 7
    assert prefill_grant(2048, 8, 8, 128) == 0
    checked = 0
    for remaining, budget, decode, cap in product(
        (0, 1, 7, 128, 2048), (0, 8, 128, 512), (0, 1, 8, 128), (0, 1, 128, 2048)
    ):
        if decode > budget:
            continue
        grant = prefill_grant(remaining, budget, decode, cap)
        assert 0 <= grant <= remaining
        assert grant + decode <= budget
        if cap:
            assert grant <= cap
        else:
            assert grant == min(remaining, budget - decode)
        checked += 1
    return {'passed': True, 'valid_grid_cases': checked,
            'uncapped_example': 504, 'capped_example': 128,
            'scope': 'teaching policy only; no engine or GPU performance claim'}


if __name__ == '__main__':
    print(json.dumps(self_test(), indent=2))
