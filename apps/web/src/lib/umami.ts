// Umami 埋点动态注入。只在 prod + 配了 VITE_UMAMI_URL / VITE_UMAMI_WEBSITE_ID
// 时才挂 script，dev / 未配 时不动。
//
// Umami script 自带 SPA 路由跟踪，react-router 切换会被 history.pushState 钩到，
// 不需要手动调 umami.track。

const UMAMI_URL: string = import.meta.env.VITE_UMAMI_URL ?? '';
const UMAMI_WEBSITE_ID: string = import.meta.env.VITE_UMAMI_WEBSITE_ID ?? '';

export function startUmami(): void {
  if (!import.meta.env.PROD) return;
  if (!UMAMI_URL || !UMAMI_WEBSITE_ID) return;
  // 防止多次注入
  if (document.querySelector('script[data-umami-injected]')) return;
  const s = document.createElement('script');
  s.async = true;
  s.defer = true;
  s.src = UMAMI_URL;
  s.setAttribute('data-website-id', UMAMI_WEBSITE_ID);
  s.setAttribute('data-umami-injected', '1');
  document.head.appendChild(s);
}
