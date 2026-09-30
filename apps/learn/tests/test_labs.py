import importlib.util
from pathlib import Path
import unittest


def load(name):
    path = Path(__file__).resolve().parents[1] / 'labs' / f'{name}.py'
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LabTests(unittest.TestCase):
    def test_attention_equivalence_and_causality(self):
        attention = load('attention_reference')
        for tokens, dim, seed in [(1, 1, 0), (7, 3, 1), (32, 16, 42)]:
            self.assertTrue(attention.experiment(tokens, dim, seed)['passed'])
        self.assertAlmostEqual(sum(attention.softmax([1000, 999, -1000])), 1)
        # Known analytical example independent of the full/cache comparison.
        out = attention.attend([1, 0], [[1, 0], [0, 1]], [[2, 0], [0, 4]])
        self.assertAlmostEqual(out[0], 1.3395230986533138)
        self.assertAlmostEqual(out[1], 1.3209538026933725)

    def test_scheduler_conservation_and_tradeoff(self):
        simulate = load('scheduler_reference').simulate
        small, large = simulate(128), simulate(2048)
        self.assertLess(small['max_decode_gap_including_initial_ms'], large['max_decode_gap_including_initial_ms'])
        self.assertGreater(small['prompt_complete_ms'], large['prompt_complete_ms'])
        for result in (small, large, simulate(333)):
            self.assertEqual(sum(e.get('tokens', 0) for e in result['events']), 2048)
            self.assertEqual(sum(e['type'] == 'decode' for e in result['events']), 16)
        with self.assertRaises(ValueError):
            simulate(0)

    def test_prefill_budget_boundaries(self):
        module = load('prefill_budget')
        self.assertTrue(module.self_test()['passed'])
        self.assertEqual(module.prefill_grant(2048, 512, 8), 504)
        self.assertEqual(module.prefill_grant(2048, 512, 8, 128), 128)
        self.assertEqual(module.prefill_grant(9, 8, 8, 128), 0)
        for args in [(-1, 8, 0), (1, 8, 9), (1, 8, 0, -1), (1.5, 8, 0), (True, 8, 0)]:
            with self.assertRaises(ValueError):
                module.prefill_grant(*args)

    def test_benchmark_valid_and_edge_cases(self):
        report = load('analyze_benchmark')
        rows = [{'id': 'a', 'success': True, 'ttft_ms': 10, 'latency_ms': 30, 'output_tokens': 3},
                {'id': 'b', 'success': True, 'ttft_ms': 20, 'latency_ms': 20, 'output_tokens': 1},
                {'id': 'c', 'success': False}]
        result = report.summarize(rows, 2)
        self.assertEqual(result['output_tokens_per_second'], 2)
        self.assertEqual(result['ttft_ms_p50'], 15)
        self.assertEqual(result['tpot_ms_p50'], 10)
        self.assertEqual(result['tpot_samples'], 1)
        self.assertEqual(report.summarize([{'id': 'x', 'success': False}], 2)['ttft_ms_p99'], None)
        for bad in ([], rows+[rows[0]], [{'id': 'x', 'success': 'true'}],
                    [{'id':'x','success':True,'ttft_ms':float('nan'),'latency_ms':20,'output_tokens':3}],
                    [{'id':'x','success':True,'ttft_ms':10,'latency_ms':5,'output_tokens':2}],
                    [{'id':'x','success':True,'ttft_ms':0,'latency_ms':5,'output_tokens':0}]):
            with self.assertRaises(ValueError):
                report.summarize(bad, 2)
        with self.assertRaises(ValueError):
            report.summarize(rows, 0)
        with self.assertRaises(ValueError):
            report.summarize(rows, .001)


if __name__ == '__main__':
    unittest.main()
