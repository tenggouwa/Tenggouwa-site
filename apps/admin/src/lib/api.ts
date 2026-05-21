import axios, { AxiosError } from 'axios';
import { Message } from '@arco-design/web-react';
import { useAuth } from './auth';

const baseURL: string = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export const http = axios.create({
  baseURL,
  timeout: 15_000,
});

http.interceptors.request.use((cfg) => {
  const token = useAuth.getState().token;
  if (token) {
    cfg.headers = cfg.headers ?? {};
    cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
});

http.interceptors.response.use(
  (res) => {
    const body = res.data;
    if (body && typeof body === 'object' && 'code' in body && 'data' in body) {
      if (body.code !== 0) {
        Message.error(body.message ?? 'unexpected api error');
        return Promise.reject(new Error(body.message ?? `code=${body.code}`));
      }
      return body.data;
    }
    return body;
  },
  (err: AxiosError<{ detail?: string; message?: string }>) => {
    if (err.response?.status === 401) {
      useAuth.getState().setToken(null);
      Message.error('登录已失效，请重新登录');
      if (!window.location.pathname.endsWith('/login')) {
        window.location.href = `${import.meta.env.BASE_URL}login`;
      }
    } else {
      const detail = err.response?.data?.detail ?? err.response?.data?.message ?? err.message;
      Message.error(detail);
    }
    return Promise.reject(err);
  },
);
