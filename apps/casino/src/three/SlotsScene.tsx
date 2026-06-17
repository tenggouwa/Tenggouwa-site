// Slots 3D 场景（three.js / R3F）。
//
// 三根卷轴(drum)绕水平轴旋转，结果由后端权威 RNG 决定，前端只把每根轴"演到"对应符号。
// 三轴依次错峰停下(左→中→右)，是真老虎机的手感。

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';

const STOP_BASE = 2800; // 第一根轴停的时间(ms)
const STOP_STAGGER = 1100; // 后面每根轴多转的时间（间隔大，末轴吊足胃口）
export const SLOTS_SPIN_MS = STOP_BASE + 2 * STOP_STAGGER + 250; // 末轴停稳后再揭晓
const SPINS = 9; // 每根轴减速圈数
const TWO_PI = Math.PI * 2;

// 卷轴上的符号环(6 格)。顺序只影响视觉相邻，不影响正确性。
const DRUM = ['seven', 'bar', 'bell', 'cherry', 'diamond', 'blank'];
const SLOT_STEP = TWO_PI / DRUM.length;
const R = 1.15; // 卷轴半径
const REEL_DX = 2.0; // 三根轴的水平间距

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeSymbolTexture(sym: string): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const cx = s / 2;

  // 每个符号画在一块圆角面板上：深色渐变底 + 细边框，像正经的卷轴符号格。
  const panel = ctx.createLinearGradient(0, 24, 0, s - 24);
  panel.addColorStop(0, '#141d23');
  panel.addColorStop(1, '#0b1014');
  ctx.fillStyle = panel;
  roundRect(ctx, 18, 18, s - 36, s - 36, 30);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(90,247,142,0.18)';
  ctx.stroke();

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const glow = (color: string, blur: number) => {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
  };
  const noGlow = () => {
    ctx.shadowBlur = 0;
  };

  if (sym === 'seven') {
    const g = ctx.createLinearGradient(0, 70, 0, 190);
    g.addColorStop(0, '#ff8a7a');
    g.addColorStop(1, '#e02e2e');
    ctx.fillStyle = g;
    ctx.font = 'bold 170px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    glow('#ff5f57', 26);
    ctx.fillText('7', cx, cx + 8);
    noGlow();
  } else if (sym === 'cherry') {
    // 茎与叶
    ctx.strokeStyle = '#3ad17a';
    ctx.lineWidth = 7;
    glow('#5af78e', 10);
    ctx.beginPath();
    ctx.moveTo(cx + 34, 64);
    ctx.quadraticCurveTo(cx - 4, 96, cx - 44, 150);
    ctx.moveTo(cx + 34, 64);
    ctx.quadraticCurveTo(cx + 24, 110, cx + 40, 152);
    ctx.stroke();
    noGlow();
    ctx.fillStyle = '#5af78e';
    ctx.beginPath();
    ctx.ellipse(cx + 54, 58, 26, 13, -0.5, 0, TWO_PI);
    ctx.fill();
    // 两颗带高光的樱桃
    const cherry = (px: number, py: number) => {
      const rg = ctx.createRadialGradient(px - 9, py - 10, 4, px, py, 34);
      rg.addColorStop(0, '#ffd0d8');
      rg.addColorStop(0.4, '#ff4d6d');
      rg.addColorStop(1, '#a01230');
      ctx.fillStyle = rg;
      glow('#ff4d6d', 16);
      ctx.beginPath();
      ctx.arc(px, py, 33, 0, TWO_PI);
      ctx.fill();
      noGlow();
    };
    cherry(cx - 44, 168);
    cherry(cx + 40, 172);
  } else if (sym === 'bell') {
    const g = ctx.createLinearGradient(0, 50, 0, 200);
    g.addColorStop(0, '#fff0a8');
    g.addColorStop(1, '#d9a92e');
    ctx.fillStyle = g;
    glow('#f3d65a', 20);
    ctx.beginPath();
    ctx.moveTo(cx, 56);
    ctx.bezierCurveTo(cx + 92, 78, cx + 78, 172, cx + 100, 196);
    ctx.lineTo(cx - 100, 196);
    ctx.bezierCurveTo(cx - 78, 172, cx - 92, 78, cx, 56);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, 212, 16, 0, TWO_PI);
    ctx.fill();
    noGlow();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.ellipse(cx - 28, 110, 12, 40, -0.2, 0, TWO_PI);
    ctx.fill();
  } else if (sym === 'diamond') {
    const g = ctx.createLinearGradient(0, 56, 0, 200);
    g.addColorStop(0, '#bff0ff');
    g.addColorStop(1, '#2b9fe0');
    ctx.fillStyle = g;
    glow('#57c7ff', 22);
    ctx.beginPath();
    ctx.moveTo(cx, 50);
    ctx.lineTo(cx + 82, 120);
    ctx.lineTo(cx, 206);
    ctx.lineTo(cx - 82, 120);
    ctx.closePath();
    ctx.fill();
    noGlow();
    // 切面高光
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 82, 120);
    ctx.lineTo(cx + 82, 120);
    ctx.moveTo(cx, 50);
    ctx.lineTo(cx, 206);
    ctx.moveTo(cx - 40, 85);
    ctx.lineTo(cx + 40, 85);
    ctx.stroke();
  } else if (sym === 'bar') {
    const g = ctx.createLinearGradient(0, cx - 40, 0, cx + 40);
    g.addColorStop(0, '#f4dd8a');
    g.addColorStop(1, '#b8862c');
    ctx.fillStyle = g;
    glow('#c8a24c', 18);
    roundRect(ctx, cx - 88, cx - 40, 176, 80, 14);
    ctx.fill();
    noGlow();
    ctx.fillStyle = '#0b0f10';
    ctx.font = 'bold 54px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BAR', cx, cx + 3);
  } else {
    ctx.fillStyle = 'rgba(138,145,153,0.28)';
    ctx.font = '60px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('—', cx, cx + 3);
  }

  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}

// 五次缓出：前段快、临停前长时间很慢地爬到位。
const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

function Reel({ symbol, index, rollKey }: { symbol: string; index: number; rollKey: number }) {
  const ref = useRef<THREE.Group>(null);
  const startTime = useRef<number | null>(null);
  const plan = useRef<{ startW: number; finalW: number; dur: number } | null>(null);
  const tiles = useMemo(
    () => DRUM.map((sym, k) => ({ theta: k * SLOT_STEP, tex: makeSymbolTexture(sym) })),
    [],
  );

  useEffect(() => {
    startTime.current = null;
    plan.current = null;
  }, [rollKey]);

  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    if (rollKey === 0) {
      g.rotation.x = 0;
      return;
    }
    if (startTime.current == null || plan.current == null) {
      startTime.current = state.clock.elapsedTime;
      const startW = g.rotation.x;
      const kt = Math.max(0, DRUM.indexOf(symbol));
      // 绕 X 轴转 W 后，第 k 格位于 (R·sin(θ−W), R·cos(θ−W))，故该格转到正前方(+Z)需 W ≡ θ_k。
      const target = kt * SLOT_STEP;
      const base = startW + SPINS * TWO_PI;
      const alignDelta = (((target - base) % TWO_PI) + TWO_PI) % TWO_PI;
      plan.current = { startW, finalW: base + alignDelta, dur: (STOP_BASE + index * STOP_STAGGER) / 1000 };
    }
    const p = plan.current;
    const t = Math.min(1, (state.clock.elapsedTime - startTime.current) / p.dur);
    g.rotation.x = p.startW + (p.finalW - p.startW) * easeOutQuint(t);
  });

  return (
    <group ref={ref} position={[(index - 1) * REEL_DX, 0, 0]}>
      {/* 卷轴芯：挡住背面的符号 */}
      <mesh rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[R - 0.08, R - 0.08, 0.95, 40]} />
        <meshStandardMaterial color="#0b1014" roughness={0.7} metalness={0.2} />
      </mesh>
      {tiles.map((tile, k) => (
        <mesh key={k} position={[0, R * Math.sin(tile.theta), R * Math.cos(tile.theta)]} rotation={[-tile.theta, 0, 0]}>
          <planeGeometry args={[1.0, 1.0]} />
          <meshBasicMaterial map={tile.tex} transparent toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function makeFaceTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#1a2730');
  g.addColorStop(0.5, '#0e161b');
  g.addColorStop(1, '#0a0f12');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return new THREE.CanvasTexture(c);
}

const WIN_HALF_W = 3.0; // 窗口半宽
const WIN_HALF_H = 0.78; // 窗口半高（只露中间一行 + 邻格一点点）

function gold(extra?: Partial<{ emissive: string }>) {
  return (
    <meshPhysicalMaterial
      color="#caa34c"
      metalness={1}
      roughness={0.28}
      clearcoat={1}
      clearcoatRoughness={0.2}
      envMapIntensity={1.4}
      emissive={extra?.emissive ?? '#000000'}
    />
  );
}

function Cabinet() {
  const faceTex = useMemo(() => makeFaceTexture(), []);
  const frameW = WIN_HALF_W + 0.35;
  const frameH = WIN_HALF_H + 0.35;
  return (
    <group>
      {/* 机身面板：竖向渐变，不再是死黑 */}
      <mesh position={[0, 0, -1.15]}>
        <planeGeometry args={[frameW * 2 + 1.4, 5.4]} />
        <meshStandardMaterial map={faceTex} roughness={0.75} metalness={0.25} />
      </mesh>
      {/* 窗口凹陷（深色嵌入感） */}
      <mesh position={[0, 0, -0.45]}>
        <boxGeometry args={[WIN_HALF_W * 2 + 0.1, WIN_HALF_H * 2 + 0.1, 0.5]} />
        <meshStandardMaterial color="#060a0c" roughness={0.9} metalness={0.2} />
      </mesh>

      {/* 上下遮罩：盖住窗口外的卷轴符号 */}
      {[1, -1].map((d) => (
        <mesh key={d} position={[0, d * (WIN_HALF_H + 1.0), 1.2]}>
          <planeGeometry args={[frameW * 2, 2.0]} />
          <meshStandardMaterial map={faceTex} roughness={0.75} metalness={0.25} />
        </mesh>
      ))}

      {/* 金边框：上下横梁 + 左右立柱 + 两根分隔柱，磨砂金、带反射 */}
      {[1, -1].map((d) => (
        <mesh key={`h${d}`} position={[0, d * frameH, 1.25]}>
          <boxGeometry args={[frameW * 2 + 0.3, 0.3, 0.34]} />
          {gold()}
        </mesh>
      ))}
      {[1, -1].map((d) => (
        <mesh key={`v${d}`} position={[d * frameW, 0, 1.25]}>
          <boxGeometry args={[0.3, frameH * 2 + 0.3, 0.34]} />
          {gold()}
        </mesh>
      ))}
      {[-1, 1].map((d) => (
        <mesh key={`d${d}`} position={[d * REEL_DX * 0.5, 0, 1.22]}>
          <boxGeometry args={[0.1, WIN_HALF_H * 2, 0.28]} />
          {gold()}
        </mesh>
      ))}

      {/* 中奖线（粉霓虹） */}
      <mesh position={[0, 0, 1.34]}>
        <boxGeometry args={[WIN_HALF_W * 2, 0.035, 0.3]} />
        <meshStandardMaterial color="#ff6ac1" emissive="#ff6ac1" emissiveIntensity={2} toneMapped={false} />
      </mesh>

      {/* 顶部霓虹招牌 */}
      <mesh position={[0, frameH + 0.7, 1.1]}>
        <boxGeometry args={[frameW * 2 + 0.3, 0.7, 0.3]} />
        <meshStandardMaterial color="#11181d" roughness={0.6} metalness={0.4} />
      </mesh>
      <mesh position={[0, frameH + 0.7, 1.27]}>
        <boxGeometry args={[frameW * 2 - 0.2, 0.12, 0.26]} />
        <meshStandardMaterial color="#5af78e" emissive="#5af78e" emissiveIntensity={2} toneMapped={false} />
      </mesh>

      {/* 左右霓虹立灯条 */}
      <mesh position={[-frameW - 0.32, 0, 1.2]}>
        <boxGeometry args={[0.1, frameH * 2, 0.24]} />
        <meshStandardMaterial color="#ff6ac1" emissive="#ff6ac1" emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
      <mesh position={[frameW + 0.32, 0, 1.2]}>
        <boxGeometry args={[0.1, frameH * 2, 0.24]} />
        <meshStandardMaterial color="#57c7ff" emissive="#57c7ff" emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Scene({ reels, rollKey }: { reels: string[]; rollKey: number }) {
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 6, 6]} intensity={1.3} />
      <pointLight position={[-5, 2, 4]} intensity={35} color="#ff6ac1" distance={20} />
      <pointLight position={[5, 2, 4]} intensity={35} color="#57c7ff" distance={20} />

      <Cabinet />
      {[0, 1, 2].map((i) => (
        <Reel key={i} symbol={reels[i] ?? 'blank'} index={i} rollKey={rollKey} />
      ))}

      <Environment resolution={256}>
        <Lightformer form="rect" intensity={2} position={[0, 5, 4]} scale={[10, 5, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={3} position={[-6, 1, 4]} scale={[3, 6, 1]} color="#ff6ac1" />
        <Lightformer form="rect" intensity={3} position={[6, 1, 4]} scale={[3, 6, 1]} color="#57c7ff" />
      </Environment>

      <EffectComposer>
        <Bloom luminanceThreshold={0.6} luminanceSmoothing={0.9} intensity={0.5} mipmapBlur radius={0.6} />
        <Vignette eskil={false} offset={0.3} darkness={0.7} />
      </EffectComposer>
    </>
  );
}

export default function SlotsScene({ reels, rollKey }: { reels: string[]; rollKey: number }) {
  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: [0, 0, 6.4], fov: 44 }}>
      <color attach="background" args={['#080b0d']} />
      <Scene reels={reels} rollKey={rollKey} />
    </Canvas>
  );
}
