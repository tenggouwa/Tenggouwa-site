#!/usr/bin/env python3
"""CPU / standard library: causal attention vs incremental KV. No trained weights.
Run: python3 labs/attention_reference.py --tokens 16 --dim 8 --seed 7
Scope: one head, one layer, supplied Q/K/V; no RoPE/MLP/sampling or GPU benchmark.
"""
import argparse
import json
import math
import random


def softmax(xs):
    maximum = max(xs)
    exps = [math.exp(x - maximum) for x in xs]
    total = sum(exps)
    return [x / total for x in exps]


def attend(query, keys, values):
    scores = [sum(x*y for x, y in zip(query, key)) / math.sqrt(len(query)) for key in keys]
    weights = softmax(scores)
    return [sum(weight * value[j] for weight, value in zip(weights, values)) for j in range(len(query))]


def full_attention(q, k, v):
    # Causal reference: a query only reads current and earlier positions.
    return [attend(query, k[:i+1], v[:i+1]) for i, query in enumerate(q)]


def cached_attention(q, k, v):
    k_cache, v_cache, output = [], [], []
    for query, key, value in zip(q, k, v):
        k_cache.append(key)
        v_cache.append(value)
        output.append(attend(query, k_cache, v_cache))
    return output


def experiment(tokens=16, dim=8, seed=7):
    if not 1 <= tokens <= 512 or not 1 <= dim <= 128:
        raise ValueError('tokens must be 1..512, dim must be 1..128 for this CPU teaching example')
    rng = random.Random(seed)
    q, k, v = [[[rng.uniform(-2, 2) for _ in range(dim)] for _ in range(tokens)] for _ in range(3)]
    reference = full_attention(q, k, v)
    cached = cached_attention(q, k, v)
    error = max(abs(x-y) for row_a, row_b in zip(reference, cached) for x, y in zip(row_a, row_b))
    # Perturb future K/V: all earlier outputs must be unchanged.
    future_k = [row[:] for row in k]
    future_v = [row[:] for row in v]
    future_k[-1] = [value+100 for value in future_k[-1]]
    future_v[-1] = [value-100 for value in future_v[-1]]
    perturbed = full_attention(q, future_k, future_v)
    causal_error = max((abs(x-y) for row_a, row_b in zip(reference[:-1], perturbed[:-1]) for x, y in zip(row_a, row_b)), default=0)
    assert error < 1e-12, 'KV equivalence failed'
    assert causal_error < 1e-12, 'Future token leaked into earlier output'
    return {'experiment': 'single-head-attention-reference', 'tokens': tokens, 'dim': dim, 'seed': seed,
            'max_abs_error': error, 'causal_error': causal_error, 'passed': True,
            'kv_elements': 2*tokens*dim,
            'note': 'Python floats and list storage; not a GPU memory or latency measurement.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tokens', type=int, default=16)
    parser.add_argument('--dim', type=int, default=8)
    parser.add_argument('--seed', type=int, default=7)
    args = parser.parse_args()
    print(json.dumps(experiment(args.tokens, args.dim, args.seed), indent=2))
