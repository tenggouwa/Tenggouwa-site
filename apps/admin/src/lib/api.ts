import axios, { AxiosError } from 'axios';
import { Message } from '@arco-design/web-react';
import { useAuth } from './auth';

const baseURL: string = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export const http = axios.create({
  baseURL,
  timeout: 15_000,
  // 让 7d 信任 cookie (tg_trust) 自动跟随 admin 域 → api.tenggouwa.com 跨站请求
  withCredentials: true,
});

http.interceptors.request.use((cfg) => {
  const token = useAuth.getState().token;
  if (token) {
    cfg.headers = cfg.headers ?? {};
    cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
});

// 某些 401 是"提权失败"而非"会话过期"——不要踢用户出去。
// 后端配合：unlock 之类的失败应该用 403。这里再加一道保险，避免再有疏忽。
const NO_LOGOUT_PATHS = ['/api/admin/terminal/unlock'];

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
    const status = err.response?.status;
    const url = err.config?.url ?? '';
    const skipLogout = NO_LOGOUT_PATHS.some((p) => url.includes(p));

    if (status === 401 && !skipLogout) {
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
