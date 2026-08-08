import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useReducedGraphicMotion from './useGraphicMotion';

// Mirrors the real behavior in GroceryList.jsx: items start unsorted, get
// assigned a `store`, and consolidate. This is illustrative sample data
// (the hero renders pre-login, before any real grocery list exists).
const ITEMS = [
  { id: 'onions', label: 'Onions', lane: 'tj' },
  { id: 'salmon', label: 'Salmon', lane: 'costco' },
  { id: 'cream', label: 'Heavy Cream', lane: 'costco' },
];

const LANES = [
  { id: 'costco', label: 'Costco' },
  { id: 'tj', label: "Trader Joe's" },
];

const UNSORTED_MS = 1100;
const SORTED_HOLD_MS = 2200;

/**
 * Grocery BOM stage micro-canvas: a brief scan beat, then each ingredient
 * pill leaves the unsorted pile and settles into its store lane. Uses
 * fade + short vertical travel (not a measured cross-container path) —
 * cheap, GPU-safe (transform/opacity only), and reads clearly at this size.
 *
 * Loops via a self-perpetuating setTimeout chain (see PlanGraphic for why
 * — every setState call lives inside a timeout callback, never
 * synchronously in the effect body).
 */
export default function GroceryGraphic({ accent }) {
  const reduced = useReducedGraphicMotion();
  const [sorted, setSorted] = useState(reduced);

  useEffect(() => {
    if (reduced) return undefined;
    let timer;
    const unsort = () => {
      setSorted(false);
      timer = setTimeout(sort, UNSORTED_MS);
    };
    const sort = () => {
      setSorted(true);
      timer = setTimeout(unsort, SORTED_HOLD_MS);
    };
    timer = setTimeout(sort, UNSORTED_MS);
    return () => clearTimeout(timer);
  }, [reduced]);

  return (
    <div style={{ height: '100%', position: 'relative', display: 'flex', alignItems: 'center' }}>
      {/* Scan sweep — decorative, plays once per unsorted phase. Plain
          conditional (not AnimatePresence) so it mounts/unmounts fresh
          each time `sorted` flips back to false, restarting the sweep. */}
      {!reduced && !sorted && (
        <motion.div
          initial={{ top: '0%', opacity: 0 }}
          animate={{ top: '100%', opacity: [0, 1, 0] }}
          transition={{ duration: UNSORTED_MS / 1000, ease: 'easeInOut' }}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: '1.5px',
            background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
            pointerEvents: 'none',
          }}
        />
      )}

      <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '8.5px', fontWeight: 800, letterSpacing: '0.04em', color: 'var(--text-light)', marginBottom: '4px' }}>
            UNSORTED
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <AnimatePresence>
              {!sorted && ITEMS.map((item) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18 }}
                  style={{
                    fontSize: '10px',
                    color: 'var(--text)',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: '999px',
                    padding: '3px 8px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {item.label}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px', flex: 1 }}>
          {LANES.map((lane) => (
            <div key={lane.id} style={{ flex: 1, minWidth: 0, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '5px 6px' }}>
              <div style={{ fontSize: '8.5px', fontWeight: 800, color: accent, marginBottom: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {lane.label}
              </div>
              <AnimatePresence>
                {sorted && ITEMS.filter((i) => i.lane === lane.id).map((item, idx) => (
                  <motion.div
                    key={item.id}
                    initial={reduced ? {} : { opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: reduced ? 0 : idx * 0.1, duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                    style={{ fontSize: '9.5px', color: 'var(--text-light)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    • {item.label}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
