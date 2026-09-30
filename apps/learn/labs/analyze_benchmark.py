#!/usr/bin/env python3
"""Validate and summarize request JSONL. No network requests are sent.
Each row: id (string), success (bool); successful rows also require
  ttft_ms, latency_ms, output_tokens. All times are client end-to-end milliseconds.
--duration-s is the measured whole-run wall time, including failed requests.
Example: python3 labs/analyze_benchmark.py --demo
         python3 labs/analyze_benchmark.py run.jsonl --duration-s 120
Demo values are SYNTHETIC. TPOT is not per-token ITL. Failed outputs are excluded.
"""
import argparse
import json
import math
import statistics
import sys


def percentile(values, p):
    if not values:
        return None
    values = sorted(values)
    position = (len(values)-1)*p
    low = math.floor(position)
    high = math.ceil(position)
    return values[low] + (values[high]-values[low])*(position-low)


def summarize(rows, duration_s):
    if isinstance(duration_s, bool) or not isinstance(duration_s, (int, float)) or not math.isfinite(duration_s) or duration_s <= 0:
        raise ValueError('duration_s must be finite and positive')
    if not rows:
        raise ValueError('input has no requests')
    successes, ids = [], set()
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get('id'), str) or not row['id'] or row['id'] in ids:
            raise ValueError('every row needs a unique non-empty string id')
        ids.add(row['id'])
        if not isinstance(row.get('success'), bool):
            raise ValueError('success must be boolean')
        if not row['success']:
            continue
        for key in ('ttft_ms', 'latency_ms', 'output_tokens'):
            value = row.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                raise ValueError(f'{key} must be a non-negative finite number')
        if not isinstance(row['output_tokens'], int) or row['output_tokens'] < 1:
            raise ValueError('a successful row needs at least one integer output token')
        if row['latency_ms'] < row['ttft_ms']:
            raise ValueError('latency_ms cannot precede first token')
        if row['latency_ms'] > duration_s*1000 + 1e-6:
            raise ValueError('whole-run duration cannot be shorter than a request latency')
        successes.append(row)
    ttft = [r['ttft_ms'] for r in successes]
    tpot = [(r['latency_ms']-r['ttft_ms'])/(r['output_tokens']-1) for r in successes if r['output_tokens'] > 1]
    return {'requests': len(rows), 'successes': len(successes), 'failures': len(rows)-len(successes),
            'failure_rate': 1-len(successes)/len(rows), 'duration_s': duration_s,
            'output_tokens_per_second': sum(r['output_tokens'] for r in successes)/duration_s,
            'ttft_ms_p50': percentile(ttft, .5), 'ttft_ms_p99': percentile(ttft, .99),
            'tpot_ms_p50': percentile(tpot, .5), 'tpot_ms_p99': percentile(tpot, .99),
            'tpot_samples': len(tpot),
            'mean_output_tokens': statistics.mean([r['output_tokens'] for r in successes]) if successes else None,
            'warning': 'P99 needs sufficient samples; TPOT is per-request average, not token-level ITL.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path', nargs='?')
    parser.add_argument('--duration-s', type=float)
    parser.add_argument('--demo', action='store_true')
    args = parser.parse_args()
    if args.demo:
        if args.path or args.duration_s is not None:
            parser.error('--demo must not be combined with a file or duration')
        rows = [{'id': str(i), 'success': True, 'ttft_ms': 100+i*10, 'latency_ms': 1000+i*10, 'output_tokens': 100} for i in range(10)]
        rows.append({'id': 'failed-example', 'success': False})
        duration = 5
    else:
        if not args.path or args.duration_s is None:
            parser.error('provide JSONL path and --duration-s, or use --demo')
        with open(args.path, encoding='utf-8') as stream:
            rows = [json.loads(line) for line in stream if line.strip()]
        duration = args.duration_s
    print(json.dumps({'synthetic_demo': args.demo, **summarize(rows, duration)}, indent=2, allow_nan=False))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        print(f'Invalid benchmark: {error}', file=sys.stderr)
        sys.exit(1)
