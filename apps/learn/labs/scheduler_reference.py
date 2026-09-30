#!/usr/bin/env python3
"""Synthetic logical-time model, NOT a vLLM/GPU benchmark. Standard library only.
A 2048-token prompt and a separate running request with 16 decode steps.
Each round: 0.4 ms overhead, one prefill chunk (0.02 ms/token), one decode (1 ms).
"""
import argparse
import json


def simulate(chunk=512, prompt=2048, output=16):
    if min(chunk, prompt, output) <= 0:
        raise ValueError('chunk, prompt and output must be positive')
    remaining, decoded, time, prompt_end = prompt, 0, 0.0, 0.0
    arrivals, events = [], []
    while remaining or decoded < output:
        time += 0.4
        if remaining:
            n = min(chunk, remaining)
            events.append({'type': 'prefill', 'tokens': n, 'start_ms': time})
            time += n * 0.02
            remaining -= n
            if not remaining:
                prompt_end = time
        if decoded < output:
            events.append({'type': 'decode', 'start_ms': time})
            time += 1
            decoded += 1
            arrivals.append(time)
    gaps = [v - (arrivals[i-1] if i else 0) for i, v in enumerate(arrivals)]
    return {'kind': 'synthetic-logical-time', 'chunk': chunk, 'prefill_tokens': prompt,
            'decode_tokens': output, 'first_decode_ms': arrivals[0],
            'max_decode_gap_including_initial_ms': max(gaps), 'prompt_complete_ms': prompt_end,
            'total_ms': time, 'events': events}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chunk', type=int, nargs='+', default=[128, 512, 2048])
    parser.add_argument('--events', action='store_true')
    args = parser.parse_args()
    for chunk in args.chunk:
        result = simulate(chunk)
        if not args.events:
            result.pop('events')
        print(json.dumps(result))
