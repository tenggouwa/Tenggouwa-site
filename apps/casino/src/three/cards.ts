// 扑克牌贴图（canvas 生成，离线、不依赖字体 CDN）。Baccarat / Blackjack 共用卡面风格。

import * as THREE from 'three';

export interface PlayingCard {
  r: string;
  s: string;
}

const SUIT_CHAR: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

const faceCache = new Map<string, THREE.CanvasTexture>();

export function cardFaceTexture(card: PlayingCard): THREE.CanvasTexture {
  const key = `${card.r}${card.s}`;
  const cached = faceCache.get(key);
  if (cached) return cached;
  const w = 200;
  const h = 280;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f5f7f9';
  ctx.beginPath();
  ctx.roundRect(4, 4, w - 8, h - 8, 18);
  ctx.fill();
  const red = card.s === 'h' || card.s === 'd';
  ctx.fillStyle = red ? '#d23b3b' : '#1a2228';
  const suit = SUIT_CHAR[card.s];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 38px JetBrains Mono, monospace';
  ctx.fillText(card.r, 30, 36);
  ctx.font = '30px serif';
  ctx.fillText(suit, 30, 70);
  ctx.font = '130px serif';
  ctx.fillText(suit, w / 2, h / 2 + 6);
  ctx.save();
  ctx.translate(w - 30, h - 36);
  ctx.rotate(Math.PI);
  ctx.font = 'bold 38px JetBrains Mono, monospace';
  ctx.fillText(card.r, 0, 0);
  ctx.restore();
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  faceCache.set(key, t);
  return t;
}

let backTex: THREE.CanvasTexture | null = null;

export function cardBackTexture(): THREE.CanvasTexture {
  if (backTex) return backTex;
  const w = 200;
  const h = 280;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#123');
  g.addColorStop(1, '#0a1a14');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(4, 4, w - 8, h - 8, 18);
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,247,142,0.4)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(90,247,142,0.18)';
  ctx.lineWidth = 1;
  for (let i = -h; i < w; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + h, h);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(87,199,255,0.5)';
  ctx.beginPath();
  ctx.moveTo(w / 2, h / 2 - 40);
  ctx.lineTo(w / 2 + 30, h / 2);
  ctx.lineTo(w / 2, h / 2 + 40);
  ctx.lineTo(w / 2 - 30, h / 2);
  ctx.closePath();
  ctx.fill();
  backTex = new THREE.CanvasTexture(c);
  return backTex;
}

export function labelTexture(text: string, color: string): THREE.CanvasTexture {
  const w = 256;
  const h = 64;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.font = 'bold 34px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 2);
  return new THREE.CanvasTexture(c);
}
