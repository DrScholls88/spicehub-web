import { useEffect, useState, useId } from 'react';

/**
 * SquigglyText — animated wobble via cycled SVG turbulence/displacement filters.
 * Port of Aceternity UI "squiggly-text" to plain React (no Tailwind).
 *
 * Respects prefers-reduced-motion: when the user requests reduced motion we hold
 * a single static frame (frame 0) instead of cycling filters, keeping the subtle
 * hand-drawn distortion without any movement.
 */
export default function SquigglyText({
  children,
  as: Tag = 'span',
  steps = 5,
  stepDuration = 80,
  scale = [6, 8],
  baseFrequency = 0.02,
  numOctaves = 3,
  className = '',
  style = {},
}) {
  const rawId = useId();
  const id = rawId.replace(/[:]/g, '');
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (steps <= 1) return;
    // Honour reduced-motion: don't animate, just rest on the first frame.
    const mq = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    if (mq && mq.matches) { setFrame(0); return; }
    const t = setInterval(() => setFrame((f) => (f + 1) % steps), stepDuration);
    return () => clearInterval(t);
  }, [steps, stepDuration]);

  const scales = Array.isArray(scale) ? scale : [scale];

  return (
    <Tag
      className={className}
      style={{ ...style, filter: `url(#squiggly-${id}-${frame})` }}
    >
      <svg
        aria-hidden="true"
        width="0"
        height="0"
        style={{ position: 'absolute', width: 0, height: 0 }}
      >
        <defs>
          {Array.from({ length: steps }).map((_, i) => (
            <filter id={`squiggly-${id}-${i}`} key={i}>
              <feTurbulence
                type="fractalNoise"
                baseFrequency={baseFrequency}
                numOctaves={numOctaves}
                seed={i}
                result="noise"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale={scales[i % scales.length]}
              />
            </filter>
          ))}
        </defs>
      </svg>
      {children}
    </Tag>
  );
}
