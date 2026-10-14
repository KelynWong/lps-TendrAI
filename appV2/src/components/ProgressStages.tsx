// Simulated long-running action: named stages with timing, reusing the
// existing app's .pipeline styles. Purely a demo device.

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';

export function ProgressStages({
  stages,
  onComplete,
}: {
  stages: { label: string; ms: number }[];
  onComplete?: () => void;
}) {
  const [done, setDone] = useState(0); // stages completed
  const timers = useRef<number[]>([]);
  const fired = useRef(false);

  useEffect(() => {
    let at = 200;
    stages.forEach((s, i) => {
      at += s.ms;
      timers.current.push(
        window.setTimeout(() => {
          setDone(i + 1);
          if (i === stages.length - 1 && !fired.current) {
            fired.current = true;
            onComplete?.();
          }
        }, at),
      );
    });
    return () => timers.current.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ol className="pipeline" aria-live="polite">
      {stages.map((s, i) => {
        const state = i < done ? 'done' : i === done ? 'running' : 'pending';
        return (
          <li key={s.label} className={`stage ${state}`}>
            <span className="stage-icon">
              {state === 'done' ? <CheckCircle2 size={16} aria-hidden /> : state === 'running' ? <Loader2 size={16} aria-hidden /> : <Circle size={14} aria-hidden />}
            </span>
            <div><div className="stage-label">{s.label}</div></div>
          </li>
        );
      })}
    </ol>
  );
}
