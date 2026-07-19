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

// 注销该账号所有 agent 会话（吊销纪元 +1，含当前 token）。需带当前 agent_token。
export async function revokeAgent(token: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agent/revoke`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`注销失败 (HTTP ${res.status})`);
}

export interface SessionInfo {
  id: string;
  title: string | null;
  updated_at: string;
}

export interface TranscriptTurn {
  q: string;
  tools: { name: string; args: Record<string, unknown> }[];
  answer: string;
}

export interface Transcript {
  id: string;
  title: string | null;
  turns: TranscriptTurn[];
}

// 私有通道：取该 owner 的会话列表（最近活跃在前）。需带 agent_token。
async function agentApi<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api/agent${path}`, {
    ...init,
    headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}` },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as Envelope<T>;
  if (payload.code !== 0) throw new Error(payload.message || `api code ${payload.code}`);
  return payload.data;
}

export const listSessions = (token: string) => agentApi<SessionInfo[]>('/sessions', token);
export const getTranscript = (token: string, sid: string) => agentApi<Transcript>(`/sessions/${sid}`, token);
export const deleteSession = (token: string, sid: string) =>
  agentApi<{ deleted: boolean }>(`/sessions/${sid}`, token, { method: 'DELETE' });

// 长期记忆（记忆面板）：列 / 删。仅私有通道。
export interface MemoryItem {
  id: number;
  content: string;
  created_at: string;
}

export const listMemories = (token: string) => agentApi<MemoryItem[]>('/memories', token);
export const deleteMemory = (token: string, mid: number) =>
  agentApi<{ deleted: boolean }>(`/memories/${mid}`, token, { method: 'DELETE' });

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
