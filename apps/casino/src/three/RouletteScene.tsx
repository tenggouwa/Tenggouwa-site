// Roulette 3D 场景（three.js / R3F）。
//
// 同 Dice：号码由后端权威 RNG 决定，前端只把转盘 + 球"演到"那个号码。轮盘与球反向旋转、
// 球减速螺旋内收落入目标号码格。对齐靠"同一套 cos/sin 公式"摆放彩格 / 号码 / 落点——
// 不依赖贴图 UV 角度，所以球一定落在渲染出来的那个号码上。

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';

export const ROULETTE_SPIN_MS = 8000;
const DUR = ROULETTE_SPIN_MS / 1000;
const WHEEL_TURNS = 5; // 投掷时盘面减速圈数
const BALL_TURNS = 18; // 球减速圈数（比盘快很多，反向）：圈数多 + 减速缓 = 落袋前多绕一会儿
const DROP_START = 0.84; // 球在外圈跑到这个进度后才开始螺旋内收落袋
const IDLE_VEL = 0.32; // 落袋后盘面（带着球）继续惯性慢转的角速度 rad/s
const TWO_PI = Math.PI * 2;

// 欧式轮盘物理排列（37 格）。
const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29,
  7, 28, 12, 35, 3, 26,
];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const STEP = (Math.PI * 2) / 37;

const R_IN = 1.7;
const R_OUT = 3.2;
const R_TEXT = (R_IN + R_OUT) / 2;
// 球始终在盘内：起跑轨道贴着号码环外侧(<R_OUT)，最终螺旋进号码环落袋。
const R_BALL_OUT = 2.95;
const R_BALL_POCKET = R_TEXT;
const BALL_RIDE_Y = 0.16;
const BALL_REST_Y = 0.1;
const LAND = Math.PI / 2; // 落点朝向相机（+Z）

function pocketColor(n: number): string {
  if (n === 0) return '#1f9d55';
  return RED.has(n) ? '#cf2b2b' : '#15191d';
}

// 单格扇形几何（XZ 平面，直接用 cos/sin 摆，无 rotateX 翻转）。
function wedgeGeometry(a0: number, a1: number): THREE.BufferGeometry {
  const seg = 4;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let s = 0; s < seg; s++) {
    const b0 = a0 + ((a1 - a0) * s) / seg;
    const b1 = a0 + ((a1 - a0) * (s + 1)) / seg;
    const base = (pos.length / 3) | 0;
    pos.push(R_IN * Math.cos(b0), 0, R_IN * Math.sin(b0));
    pos.push(R_OUT * Math.cos(b0), 0, R_OUT * Math.sin(b0));
    pos.push(R_OUT * Math.cos(b1), 0, R_OUT * Math.sin(b1));
    pos.push(R_IN * Math.cos(b1), 0, R_IN * Math.sin(b1));
    // 绕序让法线朝上（+Y），否则从上方看是背面、整盘发暗、红黑绿都看不出。
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function numberTexture(n: number): THREE.CanvasTexture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = '#f2f5f7';
  ctx.font = 'bold 38px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), s / 2, s / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function Wheel() {
  const wedges = useMemo(
    () =>
      WHEEL_ORDER.map((n, i) => {
        const a = i * STEP;
        return { n, geom: wedgeGeometry(a - STEP / 2, a + STEP / 2), color: pocketColor(n), tex: numberTexture(n), a };
      }),
    [],
  );
  return (
    <group>
      {/* 外圈金边 */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
        <ringGeometry args={[R_OUT, R_OUT + 0.28, 80]} />
        <meshStandardMaterial color="#c8a24c" metalness={0.9} roughness={0.3} />
      </mesh>
      {/* 碗壁：球贴着它内侧跑，兜住不外飞 */}
      <mesh position={[0, 0.18, 0]}>
        <cylinderGeometry args={[R_BALL_OUT + 0.12, R_BALL_OUT + 0.12, 0.36, 80, 1, true]} />
        <meshStandardMaterial color="#0c2a1d" metalness={0.25} roughness={0.55} side={THREE.DoubleSide} />
      </mesh>
      {/* 彩色号码格 */}
      {wedges.map((w, i) => (
        <mesh key={i} geometry={w.geom} position={[0, 0.03, 0]} receiveShadow>
          <meshStandardMaterial color={w.color} roughness={0.55} metalness={0.1} />
        </mesh>
      ))}
      {/* 格挡分隔条（fret）：每个格边界一条金属竖条 */}
      {wedges.map((w, i) => {
        const fa = w.a + STEP / 2;
        return (
          <mesh key={`f${i}`} position={[((R_IN + R_OUT) / 2) * Math.cos(fa), 0.07, ((R_IN + R_OUT) / 2) * Math.sin(fa)]} rotation={[0, -fa, 0]} castShadow>
            <boxGeometry args={[R_OUT - R_IN, 0.1, 0.035]} />
            <meshStandardMaterial color="#c8a24c" metalness={0.9} roughness={0.3} />
          </mesh>
        );
      })}
      {/* 号码（缩小到能塞进格子，摆正朝上） */}
      {wedges.map((w, i) => (
        <mesh key={`n${i}`} position={[R_TEXT * Math.cos(w.a), 0.15, R_TEXT * Math.sin(w.a)]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.34, 0.34]} />
          <meshBasicMaterial map={w.tex} transparent toneMapped={false} />
        </mesh>
      ))}
      {/* 内盘 + 中心金锥 */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.025, 0]}>
        <circleGeometry args={[R_IN, 64]} />
        <meshStandardMaterial color="#0c2a1d" roughness={0.6} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.35, 0]} castShadow>
        <coneGeometry args={[0.45, 0.7, 32]} />
        <meshStandardMaterial color="#c8a24c" metalness={0.95} roughness={0.25} />
      </mesh>
    </group>
  );
}

// 五次缓出：盘面减速用，尾巴拖得很长。
function easeOutQuint(t: number) {
  return 1 - Math.pow(1 - t, 5);
}
// 二次缓出：球减速用，比 quint 温和很多，中段仍保持明显速度——落袋前一直在绕。
function easeOutQuad(t: number) {
  return 1 - (1 - t) * (1 - t);
}
function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

interface SpinPlan {
  off: number; // 起转时盘面已有角度（含上一把累积的惯性，避免突跳）
  wheelEnd: number; // 减速结束时盘面角度（让目标格停到落点）
  ballStart: number;
  ballEnd: number;
}

function Spinner({ number, rollKey }: { number: number; rollKey: number }) {
  const wheelRef = useRef<THREE.Group>(null);
  const ballRef = useRef<THREE.Mesh>(null);
  const startTime = useRef<number | null>(null);
  const plan = useRef<SpinPlan | null>(null);

  useEffect(() => {
    startTime.current = null;
    plan.current = null;
  }, [rollKey]);

  useFrame((state) => {
    const wheel = wheelRef.current;
    const ball = ballRef.current;
    if (!wheel || !ball) return;

    // 开局前：盘面自己惯性慢转，球静候。
    if (rollKey === 0) {
      wheel.rotation.y = state.clock.elapsedTime * IDLE_VEL;
      ball.position.set(R_BALL_POCKET * Math.cos(LAND), BALL_REST_Y, R_BALL_POCKET * Math.sin(LAND));
      return;
    }

    // 起转：以当前盘面角为基准算落点，保证从惯性慢转平滑接上、且目标格停到 LAND。
    if (startTime.current == null || plan.current == null) {
      startTime.current = state.clock.elapsedTime;
      const off = wheel.rotation.y;
      const thetaTarget = Math.max(0, WHEEL_ORDER.indexOf(number)) * STEP;
      // 盘面停在随机角度（落点不固定）；球落在目标格的真实位置，每把都不同。
      const wheelEnd = off + WHEEL_TURNS * TWO_PI + Math.random() * TWO_PI;
      const ballEnd = thetaTarget - wheelEnd; // 目标格在盘面停稳后的世界方位
      plan.current = { off, wheelEnd, ballStart: ballEnd + BALL_TURNS * TWO_PI, ballEnd };
    }
    const p = plan.current;
    const tau = state.clock.elapsedTime - startTime.current;

    if (tau < DUR) {
      const t = tau / DUR;
      // 盘面用 quint（拖尾长），球用 quad（中段保持速度，落袋前一直在绕）。
      wheel.rotation.y = p.off + (p.wheelEnd - p.off) * easeOutQuint(t);
      const az = p.ballStart + (p.ballEnd - p.ballStart) * easeOutQuad(t);
      const inward = smoothstep(DROP_START, 1, t); // 跑到 DROP_START 之前都在外圈，之后才螺旋内收
      const r = R_BALL_OUT + (R_BALL_POCKET - R_BALL_OUT) * inward;
      const rattle = Math.abs(Math.sin(t * Math.PI * 10)) * 0.05 * inward * (1 - inward) * 4;
      const y = BALL_RIDE_Y + (BALL_REST_Y - BALL_RIDE_Y) * inward + rattle;
      ball.position.set(r * Math.cos(az), y, r * Math.sin(az));
    } else {
      // 落袋后：盘面与球都停住，不再转。
      wheel.rotation.y = p.wheelEnd;
      ball.position.set(R_BALL_POCKET * Math.cos(p.ballEnd), BALL_REST_Y, R_BALL_POCKET * Math.sin(p.ballEnd));
    }
  });

  return (
    <>
      <group ref={wheelRef}>
        <Wheel />
      </group>
      <mesh ref={ballRef} castShadow>
        <sphereGeometry args={[0.16, 24, 24]} />
        <meshStandardMaterial color="#f4f6f8" roughness={0.2} metalness={0.3} emissive="#9fb4c0" emissiveIntensity={0.2} />
      </mesh>
    </>
  );
}

function Scene({ number, rollKey }: { number: number; rollKey: number }) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[4, 10, 5]} intensity={1.5} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0002}>
        <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.1, 30]} />
      </directionalLight>
      <pointLight position={[-5, 4, 4]} intensity={45} color="#ff6ac1" distance={22} />
      <pointLight position={[5, 4, -3]} intensity={45} color="#57c7ff" distance={22} />

      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#0a0f12" roughness={0.9} metalness={0.2} />
      </mesh>
      <ContactShadows position={[0, 0.005, 0]} opacity={0.6} scale={16} blur={2.6} far={6} resolution={1024} />

      <Spinner number={number} rollKey={rollKey} />

      <Environment resolution={256}>
        <Lightformer form="rect" intensity={2} position={[0, 6, 2]} scale={[10, 6, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={3} position={[-6, 2, 3]} scale={[3, 8, 1]} color="#ff6ac1" />
        <Lightformer form="rect" intensity={3} position={[6, 2, -3]} scale={[3, 8, 1]} color="#57c7ff" />
      </Environment>

      <EffectComposer>
        <Bloom luminanceThreshold={0.7} luminanceSmoothing={0.9} intensity={0.4} mipmapBlur radius={0.5} />
        <Vignette eskil={false} offset={0.3} darkness={0.7} />
      </EffectComposer>
    </>
  );
}

export default function RouletteScene({ number, rollKey }: { number: number; rollKey: number }) {
  return (
    <Canvas shadows dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: [0, 6, 6.5], fov: 44 }}>
      <color attach="background" args={['#080b0d']} />
      <fog attach="fog" args={['#080b0d', 13, 30]} />
      <Scene number={number} rollKey={rollKey} />
    </Canvas>
  );
}
