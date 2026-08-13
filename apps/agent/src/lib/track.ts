import { API_BASE } from './api';

const EVENTS = new Set(['agent_start', 'agent_complete']);
const ENABLED = import.meta.env.PROD && API_BASE !== '';

// 只打 Agent 生命周期，不发送用户问题、模型输出、附件或 token。
export function trackAgentEvent(name: 'agent_start' | 'agent_complete'): void {
  if (!ENABLED || !EVENTS.has(name)) return;
  const url = `${API_BASE}/api/public/track/event`;
  const body = JSON.stringify({ name, source: 'agent', path: window.location.pathname });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      return;
    }
  } catch {
    // sendBeacon 不可用时使用 keepalive fetch。
  }
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}
