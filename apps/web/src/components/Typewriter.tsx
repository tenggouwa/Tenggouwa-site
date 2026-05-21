import { useEffect, useState } from 'react';

interface Props {
  lines: string[];
  speed?: number;
  lineDelay?: number;
}

export default function Typewriter({ lines, speed = 36, lineDelay = 350 }: Props) {
  const [rendered, setRendered] = useState<string[]>(['']);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let lineIdx = 0;
    let charIdx = 0;
    const buffer: string[] = [''];

    function tick() {
      if (cancelled) return;
      const current = lines[lineIdx];
      if (charIdx < current.length) {
        buffer[lineIdx] = current.slice(0, charIdx + 1);
        setRendered([...buffer]);
        charIdx += 1;
        setTimeout(tick, speed);
        return;
      }
      lineIdx += 1;
      charIdx = 0;
      if (lineIdx < lines.length) {
        buffer.push('');
        setRendered([...buffer]);
        setTimeout(tick, lineDelay);
      } else {
        setDone(true);
      }
    }
    tick();
    return () => {
      cancelled = true;
    };
  }, [lines, speed, lineDelay]);

  return (
    <pre className="whitespace-pre-wrap text-sm md:text-base leading-relaxed">
      {rendered.map((l, i) => (
        <div key={i}>
          <span className="text-terminal-pink">$</span> <span>{l}</span>
          {i === rendered.length - 1 && !done && (
            <span className="inline-block w-2 h-4 align-[-2px] ml-0.5 bg-terminal-green animate-blink" />
          )}
        </div>
      ))}
    </pre>
  );
}
