// 牛牛 3D 牌桌（three.js / R3F）。
//
// 闲庄各 5 张，由后端权威发好，前端把牌从牌靴滑到桌位、背面翻正"演到"后端结果。
// 发牌顺序：闲庄交替各 5 张。牌面/牛值都来自后端。

import { createRef, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { cardBackTexture, cardFaceTexture, labelTexture, type PlayingCard } from './cards';

export interface NiuNiuHand {
  player: PlayingCard[];
  banker: PlayingCard[];
}

const START = 0.2;
const STAGGER = 0.26;
const FLIP = 0.5;
export function dealDurationMs(numCards: number): number {
  return (START + Math.max(0, numCards - 1) * STAGGER + FLIP + 0.25) * 1000;
}

const SHOE = new THREE.Vector3(5.2, 3.6, 0);
const SPACING = 0.8;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const rowX = (count: number, i: number) => (i - (count - 1) / 2) * SPACING;

function Table({ hand, rollKey }: { hand: NiuNiuHand; rollKey: number }) {
  const startTime = useRef<number | null>(null);
  const back = useMemo(() => cardBackTexture(), []);

  const cards = useMemo(() => {
    const out: { face: THREE.CanvasTexture; target: THREE.Vector3; j: number; ref: React.RefObject<THREE.Group | null> }[] = [];
    let j = 0;
    for (let i = 0; i < 5; i++) {
      for (const who of ['player', 'banker'] as const) {
        const arr = hand[who];
        if (i >= arr.length) continue;
        const y = who === 'player' ? -1.3 : 1.25;
        out.push({
          face: cardFaceTexture(arr[i]),
          target: new THREE.Vector3(rowX(arr.length, i), y, 0),
          j: j++,
          ref: createRef<THREE.Group>(),
        });
      }
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
            <boxGeometry args={[0.72, 1.02, 0.04]} />
            <meshStandardMaterial color="#e8edf0" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0, 0.022]}>
            <planeGeometry args={[0.68, 0.98]} />
            <meshBasicMaterial map={c.face} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0, -0.022]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[0.68, 0.98]} />
            <meshBasicMaterial map={back} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function Labels() {
  const banker = useMemo(() => labelTexture('庄 BANKER', '#ff6ac1'), []);
  const player = useMemo(() => labelTexture('闲 YOU', '#57c7ff'), []);
  return (
    <>
      <mesh position={[-2.9, 1.25, 0.05]}>
        <planeGeometry args={[1.9, 0.46]} />
        <meshBasicMaterial map={banker} transparent toneMapped={false} />
      </mesh>
      <mesh position={[-2.9, -1.3, 0.05]}>
        <planeGeometry args={[1.9, 0.46]} />
        <meshBasicMaterial map={player} transparent toneMapped={false} />
      </mesh>
    </>
  );
}

function Scene({ hand, rollKey }: { hand: NiuNiuHand; rollKey: number }) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 5, 6]} intensity={1.2} />
      <pointLight position={[-5, 2, 4]} intensity={28} color="#ff6ac1" distance={20} />
      <pointLight position={[5, 2, 4]} intensity={28} color="#57c7ff" distance={20} />

      <mesh position={[0, 0, -0.6]}>
        <planeGeometry args={[22, 12]} />
        <meshStandardMaterial color="#0c2018" roughness={0.95} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0, -0.55]}>
        <planeGeometry args={[10, 0.02]} />
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

export default function NiuNiuScene({ hand, rollKey }: { hand: NiuNiuHand; rollKey: number }) {
  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: [0, 0, 7.8], fov: 46 }}>
      <color attach="background" args={['#080b0d']} />
      <Scene hand={hand} rollKey={rollKey} />
    </Canvas>
  );
}
