// casino 后端接口封装 + 一个轻量的钱包 store（避免每页各自拉一遍）。

import { apiGet, apiPost } from './api';
import { getDeviceId } from './deviceId';
import type {
  BlackjackState,
  CurveResponse,
  MinesState,
  PlayResult,
  StatsSummary,
  Wallet,
  ZhajinhuaState,
} from './types';

export function fetchWallet(): Promise<Wallet> {
  return apiPost<Wallet>('/api/public/casino/wallet', { device_id: getDeviceId() });
}

export function claim(): Promise<Wallet> {
  return apiPost<Wallet>('/api/public/casino/claim', { device_id: getDeviceId() });
}

export function play(game: string, betAmount: number, betDetail: Record<string, unknown>): Promise<PlayResult> {
  return apiPost<PlayResult>('/api/public/casino/play', {
    device_id: getDeviceId(),
    game,
    bet_amount: betAmount,
    bet_detail: betDetail,
  });
}

export function fetchCurve(): Promise<CurveResponse> {
  return apiGet<CurveResponse>(`/api/public/casino/curve?device_id=${encodeURIComponent(getDeviceId())}`);
}

export function fetchStats(): Promise<StatsSummary> {
  return apiGet<StatsSummary>('/api/public/casino/stats');
}

export function bjDeal(betAmount: number): Promise<BlackjackState> {
  return apiPost<BlackjackState>('/api/public/casino/blackjack/deal', {
    device_id: getDeviceId(),
    bet_amount: betAmount,
  });
}

export function bjAction(action: 'hit' | 'stand' | 'double'): Promise<BlackjackState> {
  return apiPost<BlackjackState>('/api/public/casino/blackjack/action', { device_id: getDeviceId(), action });
}

export function minesStart(betAmount: number, mines: number): Promise<MinesState> {
  return apiPost<MinesState>('/api/public/casino/mines/start', {
    device_id: getDeviceId(),
    bet_amount: betAmount,
    mines,
  });
}

export function minesReveal(tile: number): Promise<MinesState> {
  return apiPost<MinesState>('/api/public/casino/mines/reveal', { device_id: getDeviceId(), tile });
}

export function minesCashout(): Promise<MinesState> {
  return apiPost<MinesState>('/api/public/casino/mines/cashout', { device_id: getDeviceId() });
}

export function zjhStart(ante: number): Promise<ZhajinhuaState> {
  return apiPost<ZhajinhuaState>('/api/public/casino/zhajinhua/start', { device_id: getDeviceId(), ante });
}

export function zjhAction(action: 'look' | 'call' | 'raise' | 'fold' | 'compare'): Promise<ZhajinhuaState> {
  return apiPost<ZhajinhuaState>('/api/public/casino/zhajinhua/action', { device_id: getDeviceId(), action });
}

// 极简全局钱包广播：play / claim 后更新，WalletBar 订阅刷新。
type Listener = (w: Wallet | null) => void;
let current: Wallet | null = null;
const listeners = new Set<Listener>();

export function setWallet(w: Wallet): void {
  current = w;
  listeners.forEach((fn) => fn(current));
}

export function getWalletCache(): Wallet | null {
  return current;
}

export function subscribeWallet(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
