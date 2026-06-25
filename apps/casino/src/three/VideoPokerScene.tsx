// 视频扑克 3D 牌面（three.js / R3F）。
//
// 5 张定位排开、始终面向玩家（手牌不是隐藏信息）。HOLD 的牌加绿色发光框 + 标签；
// 换牌时未留的牌位换上新牌并翻面——靠 React key 变化重新挂载触发翻入动画，留下的不动。

import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { cardBackTexture, cardFaceTexture, type PlayingCard } from './cards';

const SLOT = 1.5;
const slotX = (i: number) => (i - 2) * SLOT;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

// 一张牌：挂载时从背面翻到正面（顺带轻微下落），停在 slot 位。
function Card3D({ card, x }: { card: PlayingCard; x: number }) {
  const ref = useRef<THREE.Group>(null);
  const start = useRef<number | null>(null);
  const face = useMemo(() => cardFaceTexture(card), [card]);
  const back = useMemo(() => cardBackTexture(), []);

  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    if (start.current == null) start.current = state.clock.elapsedTime;
    const e = easeOutCubic(Math.min(1, (state.clock.elapsedTime - start.current) / 0.45));
    g.position.set(x, 0.3 * (1 - e), 0);
    g.rotation.y = Math.PI * (1 - e); // 背面 → 正面
  });

  return (
    <group ref={ref}>
      <mesh>
        <boxGeometry args={[1.0, 1.42, 0.05]} />
        <meshStandardMaterial color="#e8edf0" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0, 0.03]}>
        <planeGeometry args={[0.94, 1.34]} />
        <meshBasicMaterial map={face} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, -0.03]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.94, 1.34]} />
        <meshBasicMaterial map={back} toneMapped={false} />
      </mesh>
    </group>
  );
}

// HOLD 发光框：留牌时显示在牌后。
function HoldFrame({ x }: { x: number }) {
  return (
    <mesh position={[x, -1.05, -0.04]}>
      <planeGeometry args={[1.18, 0.16]} />
      <meshBasicMaterial color="#5af78e" toneMapped={false} />
    </mesh>
  );
}

function Scene({ hand, holds, dealKey }: { hand: PlayingCard[]; holds: boolean[]; dealKey: number }) {
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[2, 5, 6]} intensity={1.1} />
      <pointLight position={[-5, 2, 4]} intensity={24} color="#ff6ac1" distance={22} />
      <pointLight position={[5, 2, 4]} intensity={24} color="#57c7ff" distance={22} />

      <mesh position={[0, 0, -0.7]}>
        <planeGeometry args={[24, 12]} />
        <meshStandardMaterial color="#0c2018" roughness={0.95} metalness={0.05} />
      </mesh>

      {hand.map((c, i) => (
        // key 含牌面 + dealKey：留下的牌 key 不变（不翻），换上的新牌 key 变（重挂触发翻入）。
        <Card3D key={`${i}-${c.r}${c.s}-${dealKey}`} card={c} x={slotX(i)} />
      ))}
      {hand.map((_, i) => (holds[i] ? <HoldFrame key={`h-${i}`} x={slotX(i)} /> : null))}

      <Environment resolution={256}>
        <Lightformer form="rect" intensity={2} position={[0, 5, 4]} scale={[12, 5, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={2} position={[-6, 1, 4]} scale={[3, 6, 1]} color="#ff6ac1" />
        <Lightformer form="rect" intensity={2} position={[6, 1, 4]} scale={[3, 6, 1]} color="#57c7ff" />
      </Environment>

      <EffectComposer>
        <Bloom luminanceThreshold={0.72} luminanceSmoothing={0.9} intensity={0.4} mipmapBlur radius={0.5} />
        <Vignette eskil={false} offset={0.3} darkness={0.7} />
      </EffectComposer>
    </>
  );
}

export default function VideoPokerScene({
  hand,
  holds,
  dealKey,
}: {
  hand: PlayingCard[];
  holds: boolean[];
  dealKey: number;
}) {
  if (hand.length === 0) {
    return (
      <Canvas dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: [0, 0, 6.4], fov: 50 }}>
        <color attach="background" args={['#080b0d']} />
      </Canvas>
    );
  }
  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: [0, 0, 6.4], fov: 50 }}>
      <color attach="background" args={['#080b0d']} />
      <Scene hand={hand} holds={holds} dealKey={dealKey} />
    </Canvas>
  );
}
