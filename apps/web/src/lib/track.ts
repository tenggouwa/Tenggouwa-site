// 极简埋点。dev 模式 (BASE_URL=/) 也不调，避免本地点点把数据搞脏。
// 用 sendBeacon 优先；不支持的浏览器用 fetch keepalive 兜底。

const API_BASE: string = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
const ENABLED = import.meta.env.PROD && API_BASE !== '';

// 只埋下面这些 web 自己的页面；其它（比如 /admin/* 被 404.html 兜进来的）忽略
const KNOWN_PATH = /^\/(posts(\/.+)?|inspirations|lab(\/.+)?|about|projects)?$/;
const EVENT_NAMES = new Set([
  'project_open',
  'contact_cta_click',
  'github_open',
  'rss_open',
  'email_open',
  'agent_open',
  'agent_start',
  'agent_complete',
]);

let lastTracked = '';

export function trackPageView(path: string, referrer?: string): void {
  if (!ENABLED) return;
  if (!KNOWN_PATH.test(path)) return;
  // 同一个 path 不要重复打（StrictMode 双 effect 会触发两次）
  const key = `${path}|${referrer ?? ''}`;
  if (key === lastTracked) return;
  lastTracked = key;

  const url = `${API_BASE}/api/public/track`;
  const body = JSON.stringify({
    path,
    referrer: referrer ?? document.referrer ?? null,
  });

  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      return;
    }
  } catch {
    // sendBeacon 失败兜底 fetch
  }
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // 埋点失败不该影响浏览体验
  });
}

// 只记预定义的转化动作和短来源标识，不传正文、附件、邮箱内容或 token。
export function trackEvent(name: string, source: 'web' | 'agent', label?: string): void {
  if (!ENABLED || !EVENT_NAMES.has(name)) return;
  const body = JSON.stringify({ name, source, path: window.location.pathname, label: label?.slice(0, 120) });
  const url = `${API_BASE}/api/public/track/event`;
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      return;
    }
  } catch {
    // sendBeacon 失败兜底 fetch
  }
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // 埋点失败不该影响浏览体验
  });
}
