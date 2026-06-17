// Dice 3D 场景（three.js / R3F）。
//
// 关键约束：骰子点数由后端权威 RNG 决定，前端只把动画"演到"这个结果——不让物理/随机
// 自己决定输赢。所以这是一段受控投掷动画：翻滚 + 弹跳下落，最终精确停在后端给的点数朝上。
//
// 视觉：磨圆边的玻璃质骰子 + 3D 凹陷霓虹点 + 反光台面 + 环境光反射 + bloom 辉光，
// 走"终端霓虹 × 真实赌场"的 hybrid 质感。

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, MeshReflectorMaterial, RoundedBox } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';

export const DICE_ROLL_MS = 1800;
const DUR = DICE_ROLL_MS / 1000;
const SIZE = 1.0;
const REST_Y = SIZE / 2;
const GAP = 1.55;

// 标准西式骰子：对面点数和为 7。面分配（与下方点位摆放、朝上四元数三处一致）：
// +X=1 -X=6  +Y=2 -Y=5  +Z=3 -Z=4
const PIP2D: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [-0.5, -0.5],
    [0.5, 0.5],
  ],
  3: [
    [-0.6, -0.6],
    [0, 0],
    [0.6, 0.6],
  ],
  4: [
    [-0.5, -0.5],
    [0.5, -0.5],
    [-0.5, 0.5],
    [0.5, 0.5],
  ],
  5: [
    [-0.55, -0.55],
    [0.55, -0.55],
    [0, 0],
    [-0.55, 0.55],
    [0.55, 0.55],
  ],
  6: [
    [-0.5, -0.62],
    [0.5, -0.62],
    [-0.5, 0],
    [0.5, 0],
    [-0.5, 0.62],
    [0.5, 0.62],
  ],
};

// 一个点位：在骰子本地坐标里的位置 + 让圆点贴合所在面的朝向（圆面默认朝 +Z）。
interface Pip {
  pos: THREE.Vector3;
  rot: [number, number, number];
}

// 所有点位（21 个）一次算好，三颗骰子共用。圆点与骰面齐平（不凸出），按各面法线朝外。
function pipPositions(): Pip[] {
  const h = SIZE / 2 + 0.002; // 抬一丝，避免与面 z-fighting
  const spread = SIZE * 0.3;
  const out: Pip[] = [];
  const place = (
    value: number,
    rot: [number, number, number],
    toLocal: (u: number, v: number) => [number, number, number],
  ) => {
    for (const [u, v] of PIP2D[value]) out.push({ pos: new THREE.Vector3(...toLocal(u * spread, v * spread)), rot });
  };
  place(2, [-Math.PI / 2, 0, 0], (u, v) => [u, h, v]); // +Y
  place(5, [Math.PI / 2, 0, 0], (u, v) => [u, -h, v]); // -Y
  place(1, [0, Math.PI / 2, 0], (u, v) => [h, u, v]); // +X
  place(6, [0, -Math.PI / 2, 0], (u, v) => [-h, u, v]); // -X
  place(3, [0, 0, 0], (u, v) => [u, v, h]); // +Z
  place(4, [0, Math.PI, 0], (u, v) => [u, v, -h]); // -Z
  return out;
}

// 让 value 这一面朝上（+Y）的基础旋转。
const FACE_EULER: Record<number, [number, number, number]> = {
  1: [0, 0, Math.PI / 2],
  2: [0, 0, 0],
  3: [-Math.PI / 2, 0, 0],
  4: [Math.PI / 2, 0, 0],
  5: [Math.PI, 0, 0],
  6: [0, 0, -Math.PI / 2],
};

function faceUpQuat(value: number, yaw: number): THREE.Quaternion {
  const base = new THREE.Quaternion().setFromEuler(new THREE.Euler(...FACE_EULER[value]));
  const y = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return y.multiply(base);
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function Die({ value, rollKey, x }: { value: number; rollKey: number; x: number }) {
  const ref = useRef<THREE.Group>(null);
  const startTime = useRef<number | null>(null);
  const pips = useMemo(() => pipPositions(), []);

  const anim = useMemo(() => {
    const rnd = () => Math.random();
    return {
      startQ: new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6)),
      targetQ: faceUpQuat(value, (rnd() - 0.5) * Math.PI),
      spinAxis: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(),
      spinTurns: 3 + Math.floor(rnd() * 3),
    };
  }, [value, rollKey]);

  useEffect(() => {
    startTime.current = null;
  }, [rollKey]);

  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    if (rollKey === 0) {
      g.position.set(x, REST_Y, 0);
      g.quaternion.copy(anim.targetQ);
      return;
    }
    if (startTime.current == null) startTime.current = state.clock.elapsedTime;
    const t = Math.min(1, (state.clock.elapsedTime - startTime.current) / DUR);
    const e = easeOutCubic(t);

    const q = new THREE.Quaternion().slerpQuaternions(anim.startQ, anim.targetQ, e);
    const spin = new THREE.Quaternion().setFromAxisAngle(anim.spinAxis, anim.spinTurns * Math.PI * 2 * (1 - e));
    g.quaternion.copy(spin.multiply(q));

    let y: number;
    if (t < 0.58) {
      const p = t / 0.58;
      y = REST_Y + 4.5 * (1 - p * p);
    } else {
      const p = (t - 0.58) / 0.42;
      y = REST_Y + 1.05 * Math.abs(Math.sin(p * Math.PI)) * (1 - p);
    }
    g.position.set(x, y, 0);
  });

  return (
    <group ref={ref}>
      <RoundedBox args={[SIZE, SIZE, SIZE]} radius={SIZE * 0.13} smoothness={5} castShadow receiveShadow>
        <meshPhysicalMaterial
          color="#243641"
          roughness={0.16}
          metalness={0.2}
          clearcoat={1}
          clearcoatRoughness={0.1}
          envMapIntensity={1.7}
          reflectivity={0.7}
        />
      </RoundedBox>
      {pips.map((p, i) => (
        <mesh key={i} position={p.pos} rotation={p.rot}>
          <circleGeometry args={[SIZE * 0.092, 24]} />
          <meshStandardMaterial
            color="#c4ffd6"
            emissive="#5af78e"
            emissiveIntensity={1.1}
            roughness={0.5}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function Scene({ values, rollKey }: { values: [number, number, number]; rollKey: number }) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[4, 9, 4]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
      >
        <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.1, 30]} />
      </directionalLight>
      <pointLight position={[-5, 3, 4]} intensity={40} color="#ff6ac1" distance={20} />
      <pointLight position={[5, 3, -3]} intensity={40} color="#57c7ff" distance={20} />

      {/* 反光台面：暗色磨砂，带模糊反射，骰子在台面上有倒影 */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <MeshReflectorMaterial
          resolution={1024}
          blur={[400, 120]}
          mixBlur={1.1}
          mixStrength={4}
          depthScale={1.1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.2}
          color="#0a0f12"
          metalness={0.55}
          roughness={0.85}
        />
      </mesh>
      <ContactShadows position={[0, 0.015, 0]} opacity={0.7} scale={16} blur={2.6} far={6} resolution={1024} />

      {values.map((v, i) => (
        <Die key={i} value={v} rollKey={rollKey} x={(i - 1) * GAP} />
      ))}

      {/* 自建环境贴图：给玻璃骰子真实反射，无需联网下载 HDR */}
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={2} position={[0, 6, 2]} scale={[10, 6, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={3} position={[-6, 2, 3]} scale={[3, 8, 1]} color="#ff6ac1" />
        <Lightformer form="rect" intensity={3} position={[6, 2, -3]} scale={[3, 8, 1]} color="#57c7ff" />
        <Lightformer form="circle" intensity={1.5} position={[0, 3, -6]} scale={6} color="#5af78e" />
      </Environment>

      <EffectComposer>
        <Bloom luminanceThreshold={0.6} luminanceSmoothing={0.9} intensity={0.45} mipmapBlur radius={0.5} />
        <Vignette eskil={false} offset={0.3} darkness={0.7} />
      </EffectComposer>
    </>
  );
}

export default function DiceScene({ values, rollKey }: { values: [number, number, number]; rollKey: number }) {
  return (
    <Canvas shadows dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: [0, 4.6, 6.8], fov: 40 }}>
      <color attach="background" args={['#080b0d']} />
      <fog attach="fog" args={['#080b0d', 11, 28]} />
      <Scene values={values} rollKey={rollKey} />
    </Canvas>
  );
}
