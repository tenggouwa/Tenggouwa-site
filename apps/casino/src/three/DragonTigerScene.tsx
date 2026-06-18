// Dragon Tiger 3D 场景：龙、虎各一张牌，结算时从牌靴滑入 + 翻面。牌面/结果由后端给。

import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { cardBackTexture, cardFaceTexture, labelTexture, type PlayingCard } from './cards';

const SHOE = new THREE.Vector3(0, 4, 0);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function Card3D({ card, x }: { card: PlayingCard | null; x: number }) {
  const ref = useRef<THREE.Group>(null);
  const start = useRef<number | null>(null);
  const face = useMemo(() => (card ? cardFaceTexture(card) : null), [card]);
  const back = useMemo(() => cardBackTexture(), []);
  const target = useMemo(() => new THREE.Vector3(x, 0, 0), [x]);

  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    if (start.current == null) start.current = state.clock.elapsedTime;
    const t = Math.min(1, (state.clock.elapsedTime - start.current) / 0.55);
    const e = easeOutCubic(t);
    g.position.lerpVectors(SHOE, target, e);
    g.rotation.y = Math.PI * (1 - e);
  });

  return (
    <group ref={ref} scale={1.4}>
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

function Scene({ dragon, tiger, dealKey }: { dragon: PlayingCard | null; tiger: PlayingCard | null; dealKey: number }) {
  const dragonLbl = useMemo(() => labelTexture('龙 DRAGON', '#ff6ac1'), []);
  const tigerLbl = useMemo(() => labelTexture('虎 TIGER', '#57c7ff'), []);
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 5, 6]} intensity={1.2} />
      <pointLight position={[-5, 2, 4]} intensity={28} color="#ff6ac1" distance={20} />
      <pointLight position={[5, 2, 4]} intensity={28} color="#57c7ff" distance={20} />

      <mesh position={[0, 0, -0.6]}>
        <planeGeometry args={[20, 12]} />
        <meshStandardMaterial color="#0c2018" roughness={0.95} metalness={0.05} />
      </mesh>

      <mesh position={[-1.4, 1.5, 0.05]}>
        <planeGeometry args={[2.2, 0.55]} />
        <meshBasicMaterial map={dragonLbl} transparent toneMapped={false} />
      </mesh>
      <mesh position={[1.4, 1.5, 0.05]}>
        <planeGeometry args={[2.2, 0.55]} />
        <meshBasicMaterial map={tigerLbl} transparent toneMapped={false} />
      </mesh>

      {dragon && <Card3D key={`d-${dealKey}`} card={dragon} x={-1.4} />}
      {tiger && <Card3D key={`t-${dealKey}`} card={tiger} x={1.4} />}

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

export default function DragonTigerScene({
  dragon,
  tiger,
  dealKey,
}: {
  dragon: PlayingCard | null;
  tiger: PlayingCard | null;
  dealKey: number;
}) {
  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: [0, 0, 6.5], fov: 44 }}>
      <color attach="background" args={['#080b0d']} />
      <Scene dragon={dragon} tiger={tiger} dealKey={dealKey} />
    </Canvas>
  );
}
