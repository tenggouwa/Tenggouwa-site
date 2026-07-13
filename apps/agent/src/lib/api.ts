// 简单 fetch 客户端：dev 走 vite 反代 (/api)；prod 走 VITE_API_BASE。
export const API_BASE: string = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

interface Envelope<T> {
  code: number;
  message: string;
  data: T;
}

export interface UnlockResult {
  token: string;
  ttl_seconds: number;
}

// 私有通道解锁：6 位 TOTP → 长 TTL 的 agent_token。失败抛带后端文案的 Error。
export async function unlockAgent(totp: string): Promise<UnlockResult> {
  const res = await fetch(`${API_BASE}/api/public/agent/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ totp }),
    credentials: 'include',
  });
  const payload = (await res.json().catch(() => null)) as
    | { code?: number; message?: string; detail?: string; data?: UnlockResult }
    | null;
  if (!res.ok || (payload && typeof payload.code === 'number' && payload.code !== 0)) {
    throw new Error(payload?.message || payload?.detail || `解锁失败 (HTTP ${res.status})`);
  }
  const data = payload?.data;
  if (!data?.token) throw new Error('解锁响应异常');
  return data;
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
