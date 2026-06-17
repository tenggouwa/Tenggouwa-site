// Baccarat 3D 牌桌（three.js / R3F）。
//
// 牌由后端权威发好(含补牌)，前端把牌从牌靴滑到桌位、由背面翻到正面"演到"后端结果。
// 发牌顺序：闲1→庄1→闲2→庄2→(闲3)→(庄3)，与真实百家乐一致。

import { createRef, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';

export interface Card {
  r: string;
  s: string;
}
export interface BaccaratHand {
  player: Card[];
  banker: Card[];
}

const START = 0.2;
const STAGGER = 0.42;
const FLIP = 0.55;
export function dealDurationMs(numCards: number): number {
  return (START + Math.max(0, numCards - 1) * STAGGER + FLIP + 0.25) * 1000;
}

const SHOE = new THREE.Vector3(5.0, 3.4, 0);
const SUIT_CHAR: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

const faceCache = new Map<string, THREE.CanvasTexture>();
function cardFaceTexture(card: Card): THREE.CanvasTexture {
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
  // 角标
  ctx.font = 'bold 38px JetBrains Mono, monospace';
  ctx.fillText(card.r, 30, 36);
  ctx.font = '30px serif';
  ctx.fillText(suit, 30, 70);
  // 中心大花色
  ctx.font = '130px serif';
  ctx.fillText(suit, w / 2, h / 2 + 6);
  // 右下角标（旋转 180）
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
function cardBackTexture(): THREE.CanvasTexture {
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

function labelTexture(text: string, color: string): THREE.CanvasTexture {
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

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function Table({ hand, rollKey }: { hand: BaccaratHand; rollKey: number }) {
  const startTime = useRef<number | null>(null);
  const back = useMemo(() => cardBackTexture(), []);

  // 按发牌顺序展开成一个数组，算好每张牌的桌位与发牌序号 j。
  const cards = useMemo(() => {
    const out: { face: THREE.CanvasTexture; target: THREE.Vector3; j: number; ref: React.RefObject<THREE.Group | null> }[] = [];
    const rowX = (count: number, i: number) => (i - (count - 1) / 2) * 0.85;
    const order: { who: 'player' | 'banker'; i: number }[] = [
      { who: 'player', i: 0 },
      { who: 'banker', i: 0 },
      { who: 'player', i: 1 },
      { who: 'banker', i: 1 },
      { who: 'player', i: 2 },
      { who: 'banker', i: 2 },
    ];
    let j = 0;
    for (const o of order) {
      const arr = hand[o.who];
      if (o.i >= arr.length) continue;
      const y = o.who === 'player' ? -1.25 : 1.2;
      out.push({
        face: cardFaceTexture(arr[o.i]),
        target: new THREE.Vector3(rowX(arr.length, o.i), y, 0),
        j: j++,
        ref: createRef<THREE.Group>(),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand, rollKey]);

  useEffect(() => {
    startTime.current = null;
  }, [rollKey]);

  useFrame((state) => {
    if (rollKey === 0) {
      cards.forEach((c) => c.ref.current && (c.ref.current.visible = false));
      return;
    }
    if (startTime.current == null) startTime.current = state.clock.elapsedTime;
    const tau = state.clock.elapsedTime - startTime.current;
    for (const c of cards) {
      const g = c.ref.current;
      if (!g) continue;
      const local = (tau - (START + c.j * STAGGER)) / FLIP;
      if (local <= 0) {
        g.visible = false;
        continue;
      }
      g.visible = true;
      const e = easeOutCubic(Math.min(1, local));
      g.position.lerpVectors(SHOE, c.target, e);
      g.rotation.y = Math.PI * (1 - e); // 背面 → 正面
    }
  });

  return (
    <>
      {cards.map((c, k) => (
        <group key={k} ref={c.ref} visible={false}>
          <mesh>
            <boxGeometry args={[0.74, 1.04, 0.04]} />
            <meshStandardMaterial color="#e8edf0" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0, 0.022]}>
            <planeGeometry args={[0.7, 1.0]} />
            <meshBasicMaterial map={c.face} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0, -0.022]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[0.7, 1.0]} />
            <meshBasicMaterial map={back} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function Labels() {
  const banker = useMemo(() => labelTexture('庄 BANKER', '#ff6ac1'), []);
  const player = useMemo(() => labelTexture('闲 PLAYER', '#57c7ff'), []);
  return (
    <>
      <mesh position={[-2.4, 1.2, 0.05]}>
        <planeGeometry args={[2.0, 0.5]} />
        <meshBasicMaterial map={banker} transparent toneMapped={false} />
      </mesh>
      <mesh position={[-2.4, -1.25, 0.05]}>
        <planeGeometry args={[2.0, 0.5]} />
        <meshBasicMaterial map={player} transparent toneMapped={false} />
      </mesh>
    </>
  );
}

function Scene({ hand, rollKey }: { hand: BaccaratHand; rollKey: number }) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 5, 6]} intensity={1.2} />
      <pointLight position={[-5, 2, 4]} intensity={28} color="#ff6ac1" distance={20} />
      <pointLight position={[5, 2, 4]} intensity={28} color="#57c7ff" distance={20} />

      {/* 牌桌绒面 */}
      <mesh position={[0, 0, -0.6]}>
        <planeGeometry args={[20, 12]} />
        <meshStandardMaterial color="#0c2018" roughness={0.95} metalness={0.05} />
      </mesh>
      {/* 中线 */}
      <mesh position={[0, 0, -0.55]}>
        <planeGeometry args={[9, 0.02]} />
        <meshBasicMaterial color="#5af78e" toneMapped={false} opacity={0.4} transparent />
      </mesh>

      <Labels />
      <Table hand={hand} rollKey={rollKey} />

      <Environment resolution={256}>
        <Lightformer form="rect" intensity={2} position={[0, 5, 4]} scale={[10, 5, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={2} position={[-6, 1, 4]} scale={[3, 6, 1]} color="#ff6ac1" />
        <Lightformer form="rect" intensity={2} position={[6, 1, 4]} scale={[3, 6, 1]} color="#57c7ff" />
      </Environment>

      <EffectComposer>
        <Bloom luminanceThreshold={0.7} luminanceSmoothing={0.9} intensity={0.4} mipmapBlur radius={0.5} />
        <Vignette eskil={false} offset={0.3} darkness={0.7} />
      </EffectComposer>
    </>
  );
}

export default function BaccaratScene({ hand, rollKey }: { hand: BaccaratHand; rollKey: number }) {
  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: [0, 0, 7], fov: 44 }}>
      <color attach="background" args={['#080b0d']} />
      <Scene hand={hand} rollKey={rollKey} />
    </Canvas>
  );
}
