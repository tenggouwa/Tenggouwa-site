// 炸金花 3D 场景：闲庄各 3 张固定牌位。闲在"闷牌"时自己也看不到（显示背面），看牌后翻开；
// 庄家牌结算才揭。每张牌落定后用阻尼旋转转到目标朝向，所以看牌/亮牌是原地翻。

import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { cardBackTexture, cardFaceTexture, labelTexture, type PlayingCard } from './cards';

const SHOE = new THREE.Vector3(4.6, 3.2, 0);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function Card3D({ card, faceUp, x, y, delay }: { card: PlayingCard | null; faceUp: boolean; x: number; y: number; delay: number }) {
  const ref = useRef<THREE.Group>(null);
  const start = useRef<number | null>(null);
  const face = useMemo(() => (card ? cardFaceTexture(card) : null), [card]);
  const back = useMemo(() => cardBackTexture(), []);
  const targetV = useMemo(() => new THREE.Vector3(x, y, 0), [x, y]);

  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    if (start.current == null) start.current = state.clock.elapsedTime;
    const t = Math.min(1, Math.max(0, (state.clock.elapsedTime - start.current - delay) / 0.5));
    const e = easeOutCubic(t);
    g.position.lerpVectors(SHOE, targetV, e);
    const target = faceUp && face ? 0 : Math.PI;
    if (t < 1) g.rotation.y = Math.PI + (target - Math.PI) * e;
    else g.rotation.y += (target - g.rotation.y) * 0.18; // 落定后阻尼到目标：看牌/亮牌原地翻
  });

  return (
    <group ref={ref} scale={1.15}>
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

function Scene({
  player,
  dealer,
  playerFaceUp,
  dealerFaceUp,
  dealKey,
}: {
  player: PlayingCard[];
  dealer: PlayingCard[];
  playerFaceUp: boolean;
  dealerFaceUp: boolean;
  dealKey: number;
}) {
  const dealerLbl = useMemo(() => labelTexture('庄 DEALER', '#ff6ac1'), []);
  const playerLbl = useMemo(() => labelTexture('闲 YOU', '#57c7ff'), []);
  const X = [-1.05, 0, 1.05];
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

      <mesh position={[-2.9, 1.45, 0.05]}>
        <planeGeometry args={[2.0, 0.5]} />
        <meshBasicMaterial map={dealerLbl} transparent toneMapped={false} />
      </mesh>
      <mesh position={[-2.9, -1.5, 0.05]}>
        <planeGeometry args={[2.0, 0.5]} />
        <meshBasicMaterial map={playerLbl} transparent toneMapped={false} />
      </mesh>

      {[0, 1, 2].map((i) => (
        <Card3D key={`d-${dealKey}-${i}`} card={dealer[i] ?? null} faceUp={dealerFaceUp} x={X[i]} y={1.15} delay={0.1 + i * 0.12} />
      ))}
      {[0, 1, 2].map((i) => (
        <Card3D key={`p-${dealKey}-${i}`} card={player[i] ?? null} faceUp={playerFaceUp} x={X[i]} y={-1.15} delay={i * 0.12} />
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

export default function ZhajinhuaScene({
  player,
  dealer,
  playerFaceUp,
  dealerFaceUp,
  dealKey,
}: {
  player: PlayingCard[];
  dealer: PlayingCard[];
  playerFaceUp: boolean;
  dealerFaceUp: boolean;
  dealKey: number;
}) {
  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: [0, 0, 6.5], fov: 46 }}>
      <color attach="background" args={['#080b0d']} />
      <Scene player={player} dealer={dealer} playerFaceUp={playerFaceUp} dealerFaceUp={dealerFaceUp} dealKey={dealKey} />
    </Canvas>
  );
}
