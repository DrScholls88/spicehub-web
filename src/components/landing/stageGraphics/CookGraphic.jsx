import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import useReducedGraphicMotion from './useGraphicMotion';

// Not in the original Gemini doc — added so all 4 stages carry a graphic
// instead of 3 rich mockups + 1 bare icon.
const PANTRY = ['🧄', '🍚', '🧅', '🥚', '🧈', '🌶️'];
const MATCH_INDICES = [0, 2, 4]; // garlic, onion, butter → matches the chip below

const UNMATCHED_MS = 700;
const HOLD_MS = 2400;

/**
 * Loops via a self-perpetuating setTimeout chain (see PlanGraphic for why
 * — every setState call lives inside a timeout callback, never
 * synchronously in the effect body).
 */
export default function CookGraphic({ accent }) {
  const reduced = useReducedGraphicMotion();
  const [matched, setMatched] = useState(reduced);

  useEffect(() => {
    if (reduced) return undefined;
    let timer;
    const unmatch = () => {
      setMatched(false);
      timer = setTimeout(match, UNMATCHED_MS);
    };
    const match = () => {
      setMatched(true);
      timer = setTimeout(unmatch, HOLD_MS);
    };
    timer = setTimeout(match, UNMATCHED_MS);
    return () => clearTimeout(timer);
  }, [reduced]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '5px' }}>
        {PANTRY.map((emoji, idx) => {
          const isMatch = MATCH_INDICES.includes(idx);
          return (
            <div
              key={idx}
              style={{
                flex: 1,
                aspectRatio: '1',
                borderRadius: '8px',
                background: matched && isMatch ? `${accent}22` : 'var(--surface-2)',
                border: `1px solid ${matched && isMatch ? accent : 'var(--border)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '13px',
                transition: 'background 0.3s ease, border-color 0.3s ease',
              }}
              aria-hidden="true"
            >
              {emoji}
            </div>
          );
        })}
      </div>

      <motion.div
        key={`chip-${matched}`}
        initial={reduced ? {} : { opacity: 0, y: 4 }}
        animate={{ opacity: matched ? 1 : 0, y: matched ? 0 : 4 }}
        transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: 'var(--card)',
          border: `1px solid ${accent}33`,
          borderRadius: '999px',
          padding: '4px 9px',
          alignSelf: 'flex-start',
        }}
      >
        <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text)' }}>Garlic Fried Rice</span>
        <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--success)' }}>✓ You have this</span>
      </motion.div>
    </div>
  );
}
