// Plinko 3D 场景：12 排钉的高尔顿板，小球按后端给的 L/R 路径逐层下落，落入底部倍率格。

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';

export const PLINKO_DROP_MS = 2000;
export const PLINKO_MULT = [50, 12, 5, 2, 1, 0.5, 0.25, 0.5, 1, 2, 5, 12, 50];
const ROWS = 12;
const SP = 0.26; // 水平半步基准（整板宽 24·SP，要塞进相机视野）
const RH = 0.36; // 行高
const TOP_Y = (ROWS * RH) / 2 + 0.3;

function slotColor(m: number): string {
  if (m >= 12) return '#ff5f57';
  if (m >= 5) return '#ff6ac1';
  if (m >= 2) return '#f3d65a';
  if (m >= 1) return '#57c7ff';
  return '#2b3640';
}

function multTexture(m: number): THREE.CanvasTexture {
  const w = 96;
  const h = 48;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = m < 1 ? '#0b0f10' : '#0b0f10';
  ctx.font = 'bold 26px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${m}x`, w / 2, h / 2 + 1);
  return new THREE.CanvasTexture(c);
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function Ball({ path, rollKey }: { path: ('L' | 'R')[]; rollKey: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const start = useRef<number | null>(null);

  // 每一层落点 (level 0..12)。x = (右数*2 - level)·SP；y 逐层下降。
  const waypoints = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    let rights = 0;
    for (let k = 0; k <= ROWS; k++) {
      if (k > 0 && path[k - 1] === 'R') rights += 1;
      pts.push(new THREE.Vector3((2 * rights - k) * SP, TOP_Y - k * RH, 0));
    }
    return pts;
  }, [path, rollKey]);

  useEffect(() => {
    start.current = null;
  }, [rollKey]);

  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    if (rollKey === 0 || path.length === 0) {
      m.visible = false;
      return;
    }
    m.visible = true;
    if (start.current == null) start.current = state.clock.elapsedTime;
    const t = Math.min(1, (state.clock.elapsedTime - start.current) / (PLINKO_DROP_MS / 1000));
    const fl = t * ROWS;
    const i = Math.min(ROWS - 1, Math.floor(fl));
    const f = fl - i;
    const a = waypoints[i];
    const b = waypoints[i + 1];
    m.position.x = a.x + (b.x - a.x) * easeInOut(f);
    // 每段之间加一点弹跳弧度
    m.position.y = a.y + (b.y - a.y) * f + Math.sin(f * Math.PI) * 0.08;
  });

  return (
    <mesh ref={ref} visible={false}>
      <sphereGeometry args={[0.13, 24, 24]} />
      <meshStandardMaterial color="#f4f6f8" emissive="#9fb4c0" emissiveIntensity={0.3} roughness={0.2} metalness={0.3} />
    </mesh>
  );
}

function Board({ slot, settled }: { slot: number; settled: boolean }) {
  const pegs = useMemo(() => {
    const out: [number, number][] = [];
    for (let lvl = 1; lvl < ROWS; lvl++) {
      for (let p = 0; p <= lvl; p++) {
        out.push([(2 * p - lvl) * SP, TOP_Y - lvl * RH]);
      }
    }
    return out;
  }, []);

  const slotY = TOP_Y - ROWS * RH - 0.25;

  return (
    <>
      {pegs.map(([x, y], i) => (
        <mesh key={i} position={[x, y, 0]}>
          <sphereGeometry args={[0.06, 12, 12]} />
          <meshStandardMaterial color="#5a6772" emissive="#3a4650" emissiveIntensity={0.4} />
        </mesh>
      ))}
      {PLINKO_MULT.map((m, i) => {
        const x = (2 * i - ROWS) * SP;
        const hot = settled && i === slot;
        return (
          <group key={i} position={[x, slotY, 0]}>
            <mesh position={[0, 0, 0]} scale={hot ? 1.12 : 1}>
              <boxGeometry args={[SP * 1.85, 0.42, 0.16]} />
              <meshStandardMaterial
                color={slotColor(m)}
                emissive={slotColor(m)}
                emissiveIntensity={hot ? 1.3 : 0.35}
                toneMapped={false}
              />
            </mesh>
            <mesh position={[0, 0, 0.1]}>
              <planeGeometry args={[SP * 1.7, 0.32]} />
              <meshBasicMaterial map={multTexture(m)} transparent toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

function Scene({ path, slot, rollKey, settled }: { path: ('L' | 'R')[]; slot: number; rollKey: number; settled: boolean }) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 4, 6]} intensity={1.2} />
      <pointLight position={[-5, 2, 5]} intensity={26} color="#ff6ac1" distance={22} />
      <pointLight position={[5, 2, 5]} intensity={26} color="#57c7ff" distance={22} />

      <Board slot={slot} settled={settled} />
      <Ball path={path} rollKey={rollKey} />

      <Environment resolution={256}>
        <Lightformer form="rect" intensity={2} position={[0, 4, 5]} scale={[10, 6, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={2} position={[-6, 0, 5]} scale={[3, 8, 1]} color="#ff6ac1" />
        <Lightformer form="rect" intensity={2} position={[6, 0, 5]} scale={[3, 8, 1]} color="#57c7ff" />
      </Environment>

      <EffectComposer>
        <Bloom luminanceThreshold={0.6} luminanceSmoothing={0.9} intensity={0.5} mipmapBlur radius={0.6} />
        <Vignette eskil={false} offset={0.3} darkness={0.7} />
      </EffectComposer>
    </>
  );
}

export default function PlinkoScene({
  path,
  slot,
  rollKey,
  settled,
}: {
  path: ('L' | 'R')[];
  slot: number;
  rollKey: number;
  settled: boolean;
}) {
  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: [0, -0.2, 8.4], fov: 46 }}>
      <color attach="background" args={['#080b0d']} />
      <Scene path={path} slot={slot} rollKey={rollKey} settled={settled} />
    </Canvas>
  );
}
