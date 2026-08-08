import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useReducedGraphicMotion from './useGraphicMotion';

// Loop timing: hold the URL pill ~1.3s, hold the parsed card ~2.0s, repeat.
const PILL_MS = 1300;
const CARD_MS = 2000;

/**
 * Import stage micro-canvas: a pulsing URL pill crossfades into a parsed
 * recipe-card preview with a "Parsed in 0.8s" badge, then loops. Mounted
 * only while the Import stage is active (see AppIntroHero's AnimatePresence
 * mode="wait" — the previous stage unmounts before this one mounts), so
 * the interval below never runs offscreen.
 */
export default function ImportGraphic({ accent }) {
  const reduced = useReducedGraphicMotion();
  const [phase, setPhase] = useState(reduced ? 'card' : 'pill');

  useEffect(() => {
    if (reduced) return undefined;
    const timer = setTimeout(
      () => setPhase((p) => (p === 'pill' ? 'card' : 'pill')),
      phase === 'pill' ? PILL_MS : CARD_MS
    );
    return () => clearTimeout(timer);
  }, [phase, reduced]);

  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center' }}>
      <AnimatePresence mode="wait">
        {phase === 'pill' ? (
          <motion.div
            key="pill"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            style={{ width: '100%' }}
          >
            <motion.div
              animate={reduced ? {} : { opacity: [0.55, 1, 0.55] }}
              transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                padding: '9px 11px',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '11px',
              }}
            >
              <span style={{ color: 'var(--text-light)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                instagram.com/reel/C8x9Y…
              </span>
              <span style={{ color: accent, fontSize: '9px', fontWeight: 800, letterSpacing: '0.04em', flexShrink: 0 }}>
                PARSING
              </span>
            </motion.div>
          </motion.div>
        ) : (
          <motion.div
            key="card"
            initial={{ opacity: 0, scale: 0.96, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              background: 'var(--card)',
              border: `1px solid ${accent}33`,
              borderRadius: '10px',
              padding: '8px 10px',
              position: 'relative',
            }}
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: `${accent}22`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '15px',
                flexShrink: 0,
              }}
              aria-hidden="true"
            >
              🍲
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Lasagna Soup
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--text-light)' }}>
                ⏱ 35m · 8 ingredients
              </div>
            </div>
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', duration: 0.4, bounce: 0.25 }}
              style={{
                position: 'absolute',
                top: '-7px',
                right: '-6px',
                background: 'var(--success)',
                color: '#fff',
                fontSize: '9px',
                fontWeight: 700,
                padding: '2.5px 6px',
                borderRadius: '999px',
                whiteSpace: 'nowrap',
                boxShadow: 'var(--shadow)',
              }}
            >
              ✓ Parsed in 0.8s
            </motion.span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
