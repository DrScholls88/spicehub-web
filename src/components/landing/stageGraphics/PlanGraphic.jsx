import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Dices } from 'lucide-react';
import useReducedGraphicMotion from './useGraphicMotion';

const DAYS = [
  { label: 'MON', meal: 'Salmon' },
  { label: 'TUE', meal: 'Tacos' },
  { label: 'WED', meal: 'Ramen' },
];

const HOLD_MS = 2600;
const RESET_MS = 400;

/**
 * Auto-Plan stage micro-canvas: a die spins once, then three day slots
 * spring in staggered with a placeholder meal name — echoing the app's
 * real Spin/Rotation interaction without re-implementing it.
 *
 * Loops via a self-perpetuating setTimeout chain scheduled once on mount
 * (effect deps stay `[reduced]`, not tied to a "cycle" counter) — every
 * setState call happens inside a timeout callback, never synchronously in
 * the effect body, per react-hooks/set-state-in-effect.
 */
export default function PlanGraphic({ accent }) {
  const reduced = useReducedGraphicMotion();
  const [filled, setFilled] = useState(true);

  useEffect(() => {
    if (reduced) return undefined;
    let timer;
    const hide = () => {
      setFilled(false);
      timer = setTimeout(show, RESET_MS);
    };
    const show = () => {
      setFilled(true);
      timer = setTimeout(hide, HOLD_MS);
    };
    timer = setTimeout(hide, HOLD_MS);
    return () => clearTimeout(timer);
  }, [reduced]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '8px' }}>
      <motion.div
        key={`dice-${filled}`}
        initial={reduced ? {} : { rotate: 0, opacity: 0.4 }}
        animate={{ rotate: reduced ? 0 : 360, opacity: 1 }}
        transition={{ duration: 0.55, ease: [0.77, 0, 0.175, 1] }}
        style={{ alignSelf: 'center', color: accent }}
        aria-hidden="true"
      >
        <Dices size={18} strokeWidth={2.25} />
      </motion.div>

      <div style={{ display: 'flex', gap: '6px' }}>
        {DAYS.map((day, idx) => (
          <div
            key={day.label}
            style={{
              flex: 1,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '6px 4px',
              textAlign: 'center',
              overflow: 'hidden',
            }}
          >
            <div style={{ fontSize: '8.5px', fontWeight: 800, letterSpacing: '0.04em', color: accent }}>
              {day.label}
            </div>
            <motion.div
              key={`${day.label}-${filled}`}
              initial={reduced ? {} : { y: -6, opacity: 0 }}
              animate={{ y: 0, opacity: filled ? 1 : 0 }}
              transition={{ delay: reduced ? 0 : idx * 0.14, type: 'spring', duration: 0.4, bounce: 0.3 }}
              style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--text)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {day.meal}
            </motion.div>
          </div>
        ))}
      </div>
    </div>
  );
}
