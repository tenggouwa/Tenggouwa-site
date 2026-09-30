#!/usr/bin/env python3
"""NVIDIA CUDA experiment. Install matching torch + triton in an isolated GPU env.
python3 labs/triton_softmax.py
No CPU fallback: do not interpret lack of hardware as a performance result.
Finite contiguous inputs only, <=4096 columns. Not a general-purpose softmax.
"""
import json
import sys


def main():
    try:
        import torch
        import triton
        import triton.language as tl
        import triton.testing
    except ImportError as exc:
        raise SystemExit('This lab requires torch + triton on an NVIDIA CUDA host.') from exc
    if not torch.cuda.is_available() or torch.version.hip:
        raise SystemExit('NVIDIA CUDA is required for this lab.')

    @triton.jit
    def kernel(X, Y, N: tl.constexpr, BLOCK: tl.constexpr):
        row = tl.program_id(0)
        cols = tl.arange(0, BLOCK)
        x = tl.load(X + row*N + cols, mask=cols < N, other=-float('inf')).to(tl.float32)
        numerator = tl.exp(x - tl.max(x, axis=0))
        y = numerator / tl.sum(numerator, axis=0)
        tl.store(Y + row*N + cols, y, mask=cols < N)

    def softmax(x):
        assert x.is_contiguous() and x.ndim == 2 and 0 < x.shape[1] <= 4096
        y = torch.empty_like(x)
        kernel[(x.shape[0],)](x, y, x.shape[1], triton.next_power_of_2(x.shape[1]), num_warps=4)
        return y

    torch.manual_seed(7)
    print(json.dumps({'torch': torch.__version__, 'triton': triton.__version__, 'gpu': torch.cuda.get_device_name(0)}))
    for dtype in (torch.float32, torch.float16):
        for rows, columns in ((1, 127), (64, 1000), (512, 1024), (256, 4096)):
            x = torch.randn(rows, columns, device='cuda', dtype=dtype)
            for scale in (1, 50):
                data = (x*scale).contiguous()
                actual = softmax(data)
                reference = torch.softmax(data, dim=-1)
                atol, rtol = (1e-5, 1e-4) if dtype == torch.float32 else (1e-3, 1e-3)
                torch.testing.assert_close(actual, reference, atol=atol, rtol=rtol)
            torch_ms = triton.testing.do_bench(lambda: torch.softmax(x, dim=-1))
            triton_ms = triton.testing.do_bench(lambda: softmax(x))
            print(json.dumps({'shape': [rows, columns], 'dtype': str(dtype), 'passed': True,
                              'max_abs_error_stress': (actual-reference).abs().max().item(),
                              'torch_ms': torch_ms, 'triton_ms': triton_ms, 'speedup': torch_ms/triton_ms}))


if __name__ == '__main__':
    main()
