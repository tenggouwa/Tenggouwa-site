// 简单 fetch 客户端：dev 走 vite 反代 (/api)；prod 走 VITE_API_BASE。
// 与 apps/web/src/lib/api.ts 同款封装（统一 ResponseModel 壳）。

const API_BASE: string = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  return apiRequest<T>('GET', path, undefined, init);
}

export async function apiPost<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return apiRequest<T>('POST', path, body, init);
}

async function apiRequest<T>(method: string, path: string, body: unknown, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = (await res.json()) as { detail?: string; message?: string };
      detail = data.detail ?? data.message ?? detail;
    } catch {
      // 非 JSON 错误体直接吞掉
    }
    throw new ApiError(detail, res.status);
  }
  const payload = (await res.json()) as ApiEnvelope<T> | T;
  if (isEnvelope<T>(payload)) {
    if (payload.code !== 0) {
      throw new ApiError(payload.message || 'unexpected api code', res.status, payload.code);
    }
    return payload.data;
  }
  return payload;
}

function isEnvelope<T>(x: unknown): x is ApiEnvelope<T> {
  return (
    typeof x === 'object' && x !== null && 'code' in x && 'data' in x && typeof (x as { code: unknown }).code === 'number'
  );
}
