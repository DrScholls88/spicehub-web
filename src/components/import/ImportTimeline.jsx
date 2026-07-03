// ─────────────────────────────────────────────────────────────────────────────
// ImportTimeline — the single three-stage progress vector for every import:
//
//     Fetching ─── Understanding ─── Polishing
//
// Design notes (spec §10):
//   • ONE timeline for social + websites + photos — no more per-source lists.
//   • Tier chip shows the acquisition method that's winning ("via Apify").
//   • Rail fill is spring-animated; the active node breathes via a CSS
//     animation (off the main thread — stays smooth while the engine works).
//   • Status line is passed in already-humanized; it crossfades per message.
//   • prefers-reduced-motion collapses movement to opacity-only.
//
// Isolated + memoized so its perpetual pulse never re-renders ImportSheet.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import { STAGES } from '../../import/progressMap.js';
import './ImportTimeline.css';

const SPRING = { type: 'spring', stiffness: 210, damping: 26 };

function Node({ state, label, reduced }) {
  return (
    <div className={`itl-node-wrap itl-node--${state}`}>
      <motion.div
        className="itl-node"
        animate={
          reduced
            ? { opacity: 1 }
            : state === 'active'
              ? { scale: 1.12 }
              : { scale: 1 }
        }
        transition={SPRING}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {state === 'done' ? (
            <motion.span
              key="check"
              initial={reduced ? { opacity: 0 } : { scale: 0.5, opacity: 0 }}
              animate={reduced ? { opacity: 1 } : { scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={SPRING}
              className="itl-node-check"
            >
              <Check size={11} strokeWidth={3} aria-hidden="true" />
            </motion.span>
          ) : (
            <motion.span
              key="core"
              className="itl-node-core"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            />
          )}
        </AnimatePresence>
      </motion.div>
      <span className="itl-label">{label}</span>
    </div>
  );
}

/**
 * @param {number}      stage      0..2 — current stage index
 * @param {string|null} chip       acquisition tier chip ("Apify", "JSON-LD")
 * @param {string}      statusMsg  humanized status line
 * @param {boolean}     slow       true after ~8s → show patience subtext
 * @param {string}      error      inline error text ('' when healthy)
 */
function ImportTimeline({ stage = 0, chip = null, statusMsg = '', slow = false, error = '' }) {
  const reduced = useReducedMotion();
  // Rail fill: 0 → 50 → 100% as stages complete; the active stage shows a
  // half-step so the rail visibly reaches the breathing node.
  const fillPct = error ? Math.min(stage, 2) * 50 : Math.min(stage * 50 + 18, 100);

  return (
    <div className={`itl${error ? ' itl--error' : ''}`} role="status" aria-live="polite">
      <div className="itl-rail-row">
        <div className="itl-rail" aria-hidden="true">
          <motion.div
            className="itl-rail-fill"
            initial={false}
            animate={{ transform: `scaleX(${fillPct / 100})` }}
            transition={reduced ? { duration: 0 } : SPRING}
          />
        </div>
        <div className="itl-nodes">
          {STAGES.map((label, i) => (
            <Node
              key={label}
              label={label}
              reduced={reduced}
              state={error && i === stage ? 'error' : i < stage ? 'done' : i === stage ? 'active' : 'pending'}
            />
          ))}
        </div>
      </div>

      <div className="itl-status-row">
        <AnimatePresence mode="popLayout" initial={false}>
          {chip && !error && (
            <motion.span
              key={chip}
              className="itl-chip"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={SPRING}
            >
              via {chip}
            </motion.span>
          )}
        </AnimatePresence>
        <div className="itl-status-text">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.p
              key={error || statusMsg}
              className={error ? 'itl-msg itl-msg--error' : 'itl-msg'}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            >
              {error || statusMsg}
            </motion.p>
          </AnimatePresence>
          {slow && !error && (
            <span className="itl-subtext">Still working — some sites are slow to share…</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default React.memo(ImportTimeline);
