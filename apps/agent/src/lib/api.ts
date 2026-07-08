// 简单 fetch 客户端：dev 走 vite 反代 (/api)；prod 走 VITE_API_BASE。
export const API_BASE: string = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

interface Envelope<T> {
  code: number;
  message: string;
  data: T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as Envelope<T> | T;
  if (payload && typeof payload === 'object' && 'code' in payload) {
    const env = payload as Envelope<T>;
    if (env.code !== 0) throw new Error(env.message || `api code ${env.code}`);
    return env.data;
  }
  return payload as T;
}
