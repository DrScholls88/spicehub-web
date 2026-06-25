import { useCallback, useEffect, useRef } from 'react';
import './GlowingEffect.css';

/**
 * GlowingEffect — pointer-tracked conic-gradient border glow.
 * Port of Aceternity UI "glowing-effect" to plain CSS variables (no Tailwind, no motion dep).
 * Place inside a position:relative, border-radius'd card. pointer-events:none so it never blocks clicks.
 */
export default function GlowingEffect({
  blur = 0,
  spread = 40,
  proximity = 64,
  inactiveZone = 0.01,
  borderWidth = 2,
  movementDuration = 2,
  disabled = false,
  glow = true,
  variant = 'default',
  className = '',
}) {
  const containerRef = useRef(null);
  const rafRef = useRef(0);
  const lastPos = useRef({ x: 0, y: 0 });

  const handleMove = useCallback(
    (e) => {
      const el = containerRef.current;
      if (!el) return;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const x = e?.clientX ?? lastPos.current.x;
        const y = e?.clientY ?? lastPos.current.y;
        lastPos.current = { x, y };

        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dist = Math.hypot(x - cx, y - cy);
        const inactiveRadius = 0.5 * Math.min(rect.width, rect.height) * inactiveZone;

        if (dist < inactiveRadius) {
          el.style.setProperty('--active', '0');
          return;
        }

        const active =
          x > rect.left - proximity &&
          x < rect.right + proximity &&
          y > rect.top - proximity &&
          y < rect.bottom + proximity;

        el.style.setProperty('--active', active ? '1' : '0');
        if (!active) return;

        const angleDeg = (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90;
        el.style.setProperty('--start', String(angleDeg));
      });
    },
    [inactiveZone, proximity]
  );

  useEffect(() => {
    if (disabled) return;
    const onScroll = () => handleMove();
    const onPointer = (e) => handleMove(e);
    window.addEventListener('scroll', onScroll, { passive: true });
    document.body.addEventListener('pointermove', onPointer, { passive: true });
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('scroll', onScroll);
      document.body.removeEventListener('pointermove', onPointer);
    };
  }, [handleMove, disabled]);

  return (
    <div
      ref={containerRef}
      className={`glow ${glow ? 'glow--on' : ''} ${disabled ? 'glow--disabled' : ''} glow--${variant} ${className}`}
      style={{
        '--blur': `${blur}px`,
        '--spread': spread,
        '--start': '0',
        '--active': '0',
        '--glow-border-width': `${borderWidth}px`,
        '--repeating-conic-gradient-times': 5,
        '--duration': `${movementDuration}s`,
      }}
    >
      <div className="glow__border" />
    </div>
  );
}
