// Blackjack 3D 牌桌（three.js / R3F）。
//
// 多步：玩家手牌随要牌增多、庄家暗牌结算时翻开。每张牌出现(mount)时自己从牌靴滑入 + 翻面，
// 牌面/结果都由后端权威给出，前端只演动画。

import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { cardBackTexture, cardFaceTexture, labelTexture, type PlayingCard } from './cards';

const SHOE = new THREE.Vector3(5.0, 3.6, 0);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

// 一张会"滑入 + 翻面"的牌。faceUp=false 则停在背面（庄家暗牌）。
function Card3D({ card, target, faceUp }: { card: PlayingCard | null; target: [number, number]; faceUp: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const start = useRef<number | null>(null);
  const face = useMemo(() => (card ? cardFaceTexture(card) : null), [card]);
  const back = useMemo(() => cardBackTexture(), []);
  const targetV = useMemo(() => new THREE.Vector3(target[0], target[1], 0), [target[0], target[1]]);

  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    if (start.current == null) start.current = state.clock.elapsedTime;
    const t = Math.min(1, (state.clock.elapsedTime - start.current) / 0.5);
    const e = easeOutCubic(t);
    g.position.lerpVectors(SHOE, targetV, e);
    // 翻面：faceUp 的牌从背(π)转到正(0)；暗牌固定背面(π)。
    g.rotation.y = faceUp ? Math.PI * (1 - e) : Math.PI;
  });

  return (
    <group ref={ref}>
      <mesh>
        <boxGeometry args={[0.74, 1.04, 0.04]} />
        <meshStandardMaterial color="#e8edf0" roughness={0.5} />
      </mesh>
      {face && (
        <mesh position={[0, 0, 0.022]}>
          <planeGeometry args={[0.7, 1.0]} />
          <meshBasicMaterial map={face} toneMapped={false} />
        </mesh>
      )}
      <mesh position={[0, 0, -0.022]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.7, 1.0]} />
        <meshBasicMaterial map={back} toneMapped={false} />
      </mesh>
    </group>
  );
}

function row(count: number, i: number): number {
  return (i - (count - 1) / 2) * 0.85;
}

function Scene({
  player,
  dealer,
  holeHidden,
}: {
  player: PlayingCard[];
  dealer: PlayingCard[];
  holeHidden: boolean;
}) {
  const banker = useMemo(() => labelTexture('庄 DEALER', '#ff6ac1'), []);
  const playerLbl = useMemo(() => labelTexture('闲 YOU', '#57c7ff'), []);

  // 庄家牌：进行中在明牌后补一张暗牌占位。
  const dealerCount = dealer.length + (holeHidden ? 1 : 0);

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 5, 6]} intensity={1.2} />
      <pointLight position={[-5, 2, 4]} intensity={26} color="#ff6ac1" distance={20} />
      <pointLight position={[5, 2, 4]} intensity={26} color="#57c7ff" distance={20} />

      <mesh position={[0, 0, -0.6]}>
        <planeGeometry args={[20, 12]} />
        <meshStandardMaterial color="#0c2018" roughness={0.95} metalness={0.05} />
      </mesh>

      <mesh position={[-2.7, 1.55, 0.05]}>
        <planeGeometry args={[2.0, 0.5]} />
        <meshBasicMaterial map={banker} transparent toneMapped={false} />
      </mesh>
      <mesh position={[-2.7, -1.6, 0.05]}>
        <planeGeometry args={[2.0, 0.5]} />
        <meshBasicMaterial map={playerLbl} transparent toneMapped={false} />
      </mesh>

      {/* 庄家行 */}
      {dealer.map((c, i) => (
        <Card3D key={`d-${i}-${c.r}${c.s}`} card={c} target={[row(dealerCount, i), 1.05]} faceUp />
      ))}
      {holeHidden && <Card3D key="d-hole" card={null} target={[row(dealerCount, dealer.length), 1.05]} faceUp={false} />}

      {/* 玩家行 */}
      {player.map((c, i) => (
        <Card3D key={`p-${i}-${c.r}${c.s}`} card={c} target={[row(player.length, i), -1.1]} faceUp />
      ))}

      <Environment resolution={256}>
        <Lightformer form="rect" intensity={2} position={[0, 5, 4]} scale={[10, 5, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={2} position={[-6, 1, 4]} scale={[3, 6, 1]} color="#ff6ac1" />
        <Lightformer form="rect" intensity={2} position={[6, 1, 4]} scale={[3, 6, 1]} color="#57c7ff" />
      </Environment>

      <EffectComposer>
        <Bloom luminanceThreshold={0.75} luminanceSmoothing={0.9} intensity={0.35} mipmapBlur radius={0.5} />
        <Vignette eskil={false} offset={0.3} darkness={0.7} />
      </EffectComposer>
    </>
  );
}

export default function BlackjackScene({
  player,
  dealer,
  holeHidden,
}: {
  player: PlayingCard[];
  dealer: PlayingCard[];
  holeHidden: boolean;
}) {
  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: [0, 0, 7.2], fov: 44 }}>
      <color attach="background" args={['#080b0d']} />
      <Scene player={player} dealer={dealer} holeHidden={holeHidden} />
    </Canvas>
  );
}
