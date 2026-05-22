// 真实用户 Core Web Vitals 上报：LCP / CLS / INP / FCP / TTFB。
// 用 sendBeacon 在 visibilitychange / pagehide 时发，不阻塞渲染。
//
// 只在 prod + 有 API_BASE 时启用，避免本地数据污染。

import { onCLS, onINP, onLCP, onFCP, onTTFB, type Metric } from 'web-vitals';

const API_BASE: string = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
const ENABLED = import.meta.env.PROD && API_BASE !== '';

function send(metric: Metric): void {
  if (!ENABLED) return;
  const body = JSON.stringify({
    path: location.pathname,
    metric: metric.name,
    value: metric.value,
    rating: metric.rating, // 'good' | 'needs-improvement' | 'poor'
    nav_type: metric.navigationType,
  });
  const url = `${API_BASE}/api/public/vitals`;
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      return;
    }
  } catch {
    // beacon 失败兜底 fetch
  }
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // 上报失败不影响浏览
  });
}

export function startVitals(): void {
  // web-vitals v4 默认在合适时机自动 emit，回调里发就行
  onLCP(send);
  onCLS(send);
  onINP(send);
  onFCP(send);
  onTTFB(send);
}
