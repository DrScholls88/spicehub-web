import { useCallback, useEffect, useRef } from 'react';
import './GlowingEffect.css';

/**
 * GlowingEffect — a restrained, on-brand border glow that follows the cursor.
 *
 * Renders a `pointer-events:none` overlay inside a `position:relative`,
 * border-radius'd card. The glow is a single-accent (theme `--primary`) radial
 * bloom confined to the card's border ring. Only active on hover-capable
 * devices, so it never gets stuck "on" after a tap on touchscreens.
 *
 * Props (all optional):
 *   proximity   – px beyond the card bounds where the glow starts to show (default 56)
 *   borderWidth – ring thickness in px (default 1.5)
 *   glowSize    – diameter of the bloom in px (default 180)
 *   disabled    – turn the effect off entirely
 */
export default function GlowingEffect({
  proximity = 56,
  borderWidth = 1.5,
  glowSize = 180,
  disabled = false,
  className = '',
}) {
  const ref = useRef(null);
  const rafRef = useRef(0);

  const onMove = useCallback(
    (e) => {
      const el = ref.current;
      if (!el) return;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;
        const inside =
          x > r.left - proximity &&
          x < r.right + proximity &&
          y > r.top - proximity &&
          y < r.bottom + proximity;

        el.style.setProperty('--active', inside ? '1' : '0');
        if (!inside) return;

        const mx = ((x - r.left) / r.width) * 100;
        const my = ((y - r.top) / r.height) * 100;
        el.style.setProperty('--mx', `${mx}%`);
        el.style.setProperty('--my', `${my}%`);
      });
    },
    [proximity]
  );

  useEffect(() => {
    if (disabled) return undefined;
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    // Only wire pointer tracking on devices that actually hover.
    if (!window.matchMedia('(hover: hover)').matches) return undefined;

    const handler = (e) => onMove(e);
    window.addEventListener('pointermove', handler, { passive: true });
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('pointermove', handler);
    };
  }, [onMove, disabled]);

  return (
    <div
      ref={ref}
      className={`glow ${className}`.trim()}
      style={{
        '--glow-border-width': `${borderWidth}px`,
        '--glow-size': `${glowSize}px`,
        '--active': '0',
      }}
    >
      <div className="glow__border" />
    </div>
  );
}
