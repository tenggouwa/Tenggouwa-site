// Money Wheel (Big Six) 3D 场景：竖立的钱轮面向相机，绕 Z 轴旋转，减速后让中奖格停在顶部指针下。
// 后端返回中奖格 index，前端把转盘演到该 index。

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';

export const WHEEL_SPIN_MS = 5200;
const SPINS = 6;
const TWO_PI = Math.PI * 2;

// 与后端 _WHEEL_SEGMENTS 完全一致的 54 格顺序（均匀打散）。
// prettier-ignore
const SEGMENTS = [
  '1', '2', '1', '5', '2', '1', '10', '1', '2', '1', '5', '1', '2', '20', '1', '2', '1', '1',
  '5', '2', '10', '1', '2', '1', '1', '2', '5', '40', 'joker', '1', '1', '2', '1', '10', '2', '5',
  '1', '1', '2', '1', '20', '2', '1', '5', '1', '2', '1', '10', '1', '2', '5', '1', '2', '1',
];
const STEP = TWO_PI / SEGMENTS.length;
const R_IN = 1.0;
const R_OUT = 3.0;
const R_TEXT = 2.3;

const SYMBOL_COLOR: Record<string, string> = {
  '1': '#2b3640',
  '2': '#2b9fe0',
  '5': '#3ad17a',
  '10': '#d9a92e',
  '20': '#ff6ac1',
  '40': '#cf2b2b',
  joker: '#caa34c',
};
const SYMBOL_LABEL: Record<string, string> = { joker: '★', '40': '40', '20': '20', '10': '10' };

function wedgeGeometry(a0: number, a1: number): THREE.BufferGeometry {
  const seg = 3;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let s = 0; s < seg; s++) {
    const b0 = a0 + ((a1 - a0) * s) / seg;
    const b1 = a0 + ((a1 - a0) * (s + 1)) / seg;
    const base = (pos.length / 3) | 0;
    pos.push(R_IN * Math.cos(b0), R_IN * Math.sin(b0), 0);
    pos.push(R_OUT * Math.cos(b0), R_OUT * Math.sin(b0), 0);
    pos.push(R_OUT * Math.cos(b1), R_OUT * Math.sin(b1), 0);
    pos.push(R_IN * Math.cos(b1), R_IN * Math.sin(b1), 0);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function labelTexture(text: string): THREE.CanvasTexture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = '#f5f7f9';
  ctx.font = 'bold 30px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, s / 2, s / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

function Wheel() {
  const segs = useMemo(
    () =>
      SEGMENTS.map((sym, i) => {
        // 第 i 格中心画在屏幕角 a_i = π/2 - i·step（i=0 在顶，顺时针铺）。
        const a = Math.PI / 2 - i * STEP;
        return {
          a,
          geom: wedgeGeometry(a - STEP / 2, a + STEP / 2),
          color: SYMBOL_COLOR[sym],
          tex: labelTexture(SYMBOL_LABEL[sym] ?? sym),
        };
      }),
    [],
  );
  return (
    <group>
      {segs.map((s, i) => (
        <group key={i}>
          <mesh geometry={s.geom}>
            <meshStandardMaterial color={s.color} roughness={0.5} metalness={0.15} side={THREE.DoubleSide} />
          </mesh>
          {/* 号码沿半径朝外摆正（顶部那格转到指针下时正好正立） */}
          <mesh
            position={[R_TEXT * Math.cos(s.a), R_TEXT * Math.sin(s.a), 0.03]}
            rotation={[0, 0, s.a - Math.PI / 2]}
          >
            <planeGeometry args={[0.42, 0.42]} />
            <meshBasicMaterial map={s.tex} transparent toneMapped={false} />
          </mesh>
        </group>
      ))}
      {/* 中心金毂 */}
      <mesh position={[0, 0, 0.05]}>
        <circleGeometry args={[R_IN, 48]} />
        <meshStandardMaterial color="#caa34c" metalness={0.9} roughness={0.3} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function Spinner({ index, rollKey }: { index: number; rollKey: number }) {
  const ref = useRef<THREE.Group>(null);
  const start = useRef<number | null>(null);
  const plan = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => {
    start.current = null;
    plan.current = null;
  }, [rollKey]);

  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    if (rollKey === 0) {
      g.rotation.z = 0;
      return;
    }
    if (start.current == null || plan.current == null) {
      start.current = state.clock.elapsedTime;
      const from = g.rotation.z;
      const target = index * STEP; // 屏幕角(π/2 - i·step) + W = π/2 ⟹ W ≡ index·step
      const base = from + SPINS * TWO_PI;
      const align = (((target - base) % TWO_PI) + TWO_PI) % TWO_PI;
      plan.current = { from, to: base + align };
    }
    const p = plan.current;
    const t = Math.min(1, (state.clock.elapsedTime - start.current) / (WHEEL_SPIN_MS / 1000));
    g.rotation.z = p.from + (p.to - p.from) * easeOutQuint(t);
  });

  return (
    <group ref={ref}>
      <Wheel />
    </group>
  );
}

function Scene({ index, rollKey }: { index: number; rollKey: number }) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 3, 6]} intensity={1.3} />
      <pointLight position={[-5, 2, 5]} intensity={30} color="#ff6ac1" distance={22} />
      <pointLight position={[5, 2, 5]} intensity={30} color="#57c7ff" distance={22} />

      {/* 外圈金边 */}
      <mesh position={[0, 0, -0.05]}>
        <ringGeometry args={[R_OUT, R_OUT + 0.22, 96]} />
        <meshStandardMaterial color="#caa34c" metalness={0.9} roughness={0.3} side={THREE.DoubleSide} />
      </mesh>

      <Spinner index={index} rollKey={rollKey} />

      {/* 顶部固定指针（不随盘转），尖朝下指入轮盘 */}
      <mesh position={[0, R_OUT + 0.05, 0.2]} rotation={[0, 0, Math.PI]}>
        <coneGeometry args={[0.16, 0.4, 3]} />
        <meshStandardMaterial color="#ff5f57" emissive="#ff5f57" emissiveIntensity={0.6} toneMapped={false} />
      </mesh>

      <Environment resolution={256}>
        <Lightformer form="rect" intensity={2} position={[0, 4, 5]} scale={[10, 5, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={2} position={[-6, 1, 5]} scale={[3, 6, 1]} color="#ff6ac1" />
        <Lightformer form="rect" intensity={2} position={[6, 1, 5]} scale={[3, 6, 1]} color="#57c7ff" />
      </Environment>

      <EffectComposer>
        <Bloom luminanceThreshold={0.7} luminanceSmoothing={0.9} intensity={0.4} mipmapBlur radius={0.5} />
        <Vignette eskil={false} offset={0.3} darkness={0.7} />
      </EffectComposer>
    </>
  );
}

export default function MoneyWheelScene({ index, rollKey }: { index: number; rollKey: number }) {
  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: [0, 0, 7.5], fov: 46 }}>
      <color attach="background" args={['#080b0d']} />
      <Scene index={index} rollKey={rollKey} />
    </Canvas>
  );
}
