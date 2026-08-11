import { makePattern, type Rgb } from '../lib/perlerPattern';

self.onmessage = (event: MessageEvent<{ pixels: Rgb[]; width: number; height: number; colorCount: number }>) => {
  const { pixels, width, height, colorCount } = event.data;
  self.postMessage(makePattern(pixels, width, height, colorCount));
};
