import { useEffect, useRef } from 'react';
import LabFrame from './LabFrame';

const SCR_W = 80;
const SCR_H = 24;
const K1 = 15;
const K2 = 5;
const R1 = 1;
const R2 = 2;
const CHARS = '.,-~:;=!*#$@';

function frame(A: number, B: number): string {
  const b = new Array(SCR_W * SCR_H).fill(' ');
  const z = new Float32Array(SCR_W * SCR_H);
  const cosA = Math.cos(A);
  const sinA = Math.sin(A);
  const cosB = Math.cos(B);
  const sinB = Math.sin(B);

  for (let theta = 0; theta < Math.PI * 2; theta += 0.07) {
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    for (let phi = 0; phi < Math.PI * 2; phi += 0.02) {
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);
      const cx = R2 + R1 * cosT;
      const cy = R1 * sinT;
      const x = cx * (cosB * cosP + sinA * sinB * sinP) - cy * cosA * sinB;
      const y = cx * (sinB * cosP - sinA * cosB * sinP) + cy * cosA * cosB;
      const z3 = K2 + cosA * cx * sinP + cy * sinA;
      const ooz = 1 / z3;
      const xp = Math.floor(SCR_W / 2 + K1 * ooz * x);
      const yp = Math.floor(SCR_H / 2 - K1 * ooz * y);
      const L =
        cosP * cosT * sinB -
        cosA * cosT * sinP -
        sinA * sinT +
        cosB * (cosA * sinT - cosT * sinA * sinP);
      if (L > 0 && xp >= 0 && xp < SCR_W && yp >= 0 && yp < SCR_H) {
        const idx = xp + SCR_W * yp;
        if (ooz > z[idx]) {
          z[idx] = ooz;
          const li = Math.floor(L * 8);
          b[idx] = CHARS[Math.min(li, CHARS.length - 1)];
        }
      }
    }
  }
  const rows: string[] = [];
  for (let y = 0; y < SCR_H; y++) {
    rows.push(b.slice(y * SCR_W, (y + 1) * SCR_W).join(''));
  }
  return rows.join('\n');
}

export default function Donut() {
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let A = 0;
    let B = 0;
    let raf = 0;
    let last = performance.now();
    function step(now: number) {
      const dt = (now - last) / 1000;
      last = now;
      A += dt * 1.4;
      B += dt * 0.8;
      if (ref.current) ref.current.textContent = frame(A, B);
      raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <LabFrame
      slug="donut"
      title="donut.c"
      desc="致敬 a1k0n。3D torus 投影到 ASCII 字符，CPU 每帧重算。"
      accent="cyan"
    >
      <div className="p-4 bg-terminal-bg overflow-x-auto">
        <pre
          ref={ref}
          className="text-terminal-cyan text-[12px] leading-[14px] tracking-[0.05em] inline-block"
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            textShadow: '0 0 8px rgba(87, 199, 255, 0.6)',
          }}
        />
      </div>
    </LabFrame>
  );
}
