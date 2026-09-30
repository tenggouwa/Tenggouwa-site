export function softmax(scores: number[], causal = false): number[] {
  const valid = scores.map((v, i) => (causal && i === 2 ? -Infinity : v));
  const max = Math.max(...valid);
  const exp = valid.map((v) => Math.exp(v - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((v) => v / sum);
}
export function kvGiB(
  layers: number,
  tokens: number,
  heads: number,
  dim: number,
  bytes: number,
  batch: number,
) {
  return (2 * layers * tokens * heads * dim * bytes * batch) / 2 ** 30;
}
export function roofline(
  flopsG: number,
  dataGB: number,
  peakTF: number,
  bandwidthTB: number,
) {
  const computeMs = flopsG / peakTF;
  const memoryMs = dataGB / bandwidthTB;
  return {
    computeMs,
    memoryMs,
    boundMs: Math.max(computeMs, memoryMs),
    intensity: flopsG / dataGB,
  };
}
export function speculate(
  k: number,
  a: number,
  baseMs: number,
  draftMs: number,
  verifyMs: number,
) {
  let expected = 1;
  for (let i = 1; i <= k; i++) expected += a ** i;
  return { expected, speedup: (expected * baseMs) / (draftMs + verifyMs) };
}
export function amdahl(fraction: number, speedup: number) {
  return 1 / (1 - fraction + fraction / speedup);
}
export function schedule(chunk: number, prompt = 2048, output = 16) {
  const events: {
    type: 'prefill' | 'decode' | 'overhead';
    start: number;
    duration: number;
  }[] = [];
  let remaining = prompt,
    decoded = 0,
    time = 0,
    promptEnd = 0;
  const arrivals: number[] = [];
  while (remaining > 0 || decoded < output) {
    events.push({ type: 'overhead', start: time, duration: 0.4 });
    time += 0.4;
    if (remaining > 0) {
      const n = Math.min(chunk, remaining),
        duration = n * 0.02;
      events.push({ type: 'prefill', start: time, duration });
      time += duration;
      remaining -= n;
      if (!remaining) promptEnd = time;
    }
    if (decoded < output) {
      events.push({ type: 'decode', start: time, duration: 1 });
      time += 1;
      decoded++;
      arrivals.push(time);
    }
  }
  const gaps = arrivals.map((v, i) => v - (i ? arrivals[i - 1] : 0));
  return {
    events,
    time,
    promptEnd,
    maxGap: Math.max(...gaps),
    first: arrivals[0],
  };
}
