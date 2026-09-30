#!/usr/bin/env python3
"""PyTorch profiler tutorial, CPU by default. Requires a compatible PyTorch install.
python3 labs/torch_profile.py --device cpu --output work/trace-cpu.json
NVIDIA lab machine: --device cuda --output work/trace-cuda.json
Toy workload, not an inference service or TTFT benchmark.
"""
import argparse
import json
from pathlib import Path
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device', choices=['cpu', 'cuda'], default='cpu')
    parser.add_argument('--output', default='work/torch-trace.json')
    args = parser.parse_args()
    try:
        import torch
    except ImportError:
        parser.error('PyTorch is required. Install a build compatible with your CPU/CUDA environment.')
    if args.device == 'cuda' and not torch.cuda.is_available():
        parser.error('CUDA requested but unavailable; choose --device cpu or use an NVIDIA lab host.')
    torch.manual_seed(7)
    device = torch.device(args.device)
    x = torch.randn(512, 512, device=device)
    w = torch.randn(512, 512, device=device)

    def synchronize():
        if device.type == 'cuda':
            torch.cuda.synchronize()

    def workload():
        with torch.profiler.record_function('toy_linear_softmax'):
            return torch.softmax(x @ w, dim=-1)

    with torch.inference_mode():
        for _ in range(5):
            workload()
        synchronize()
        start = time.perf_counter()
        for _ in range(20):
            result = workload()
        synchronize()
        mean_ms = (time.perf_counter()-start)*1000/20
        activities = [torch.profiler.ProfilerActivity.CPU]
        if device.type == 'cuda':
            activities.append(torch.profiler.ProfilerActivity.CUDA)
        with torch.profiler.profile(activities=activities, record_shapes=True, profile_memory=True) as profile:
            for _ in range(5):
                result = workload()
            synchronize()
        assert bool(torch.isfinite(result).all()), 'non-finite result'
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    profile.export_chrome_trace(str(output))
    print(profile.key_averages().table(sort_by='self_cpu_time_total', row_limit=8))
    print(json.dumps({'torch': torch.__version__, 'device': str(device), 'unprofiled_mean_ms': mean_ms,
                      'iterations': 20, 'trace': str(output.resolve()), 'note': 'toy workload, not full-model inference'}))


if __name__ == '__main__':
    main()
