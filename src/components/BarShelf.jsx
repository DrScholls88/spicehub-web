import { useState, useMemo, useEffect, useCallback, useReducer, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useAnimation, useReducedMotion, useDragControls, animate } from 'framer-motion';
import useBackHandler from '../hooks/useBackHandler';
import { getBarInventory, addToBarInventory } from '../db';
import SquigglyText from './SquigglyText';

/**
 * BarShelf — Fully realized 8-bit Speakeasy
 * 
 * Features:
 * - Bartender physically stands BEHIND the mahogany bar (only upper body visible)
 * - Randomized "Sneaky Swig" sequence after 8–15s of inactivity
 * - Retro LED Recipe Monitor on the barback
 * - CRT scanline atmosphere
 * - Wiping arm animation when idle
 * - Uses sprite sheet for smooth, authentic 8-bit animations
 */




// ── Bottle shape + colour mapping ────────────────────────────────────────────
const BOTTLE_STYLES = [
  { keywords: ['vodka'],                                                   shape: 'tall',   color: '#c8d8e4', label: '#2196f3', cap: '#666'    },
  { keywords: ['gin'],                                                     shape: 'tall',   color: '#c8e6c9', label: '#388e3c', cap: '#555'    },
  { keywords: ['rum', 'bacardi'],                                          shape: 'round',  color: '#795548', label: '#ffcc02', cap: '#4e342e' },
  { keywords: ['whiskey', 'bourbon', 'rye', 'scotch'],                    shape: 'square', color: '#a1887f', label: '#ff8f00', cap: '#5d4037' },
  { keywords: ['tequila', 'mezcal'],                                       shape: 'tall',   color: '#fff9c4', label: '#f57f17', cap: '#827717' },
  { keywords: ['wine', 'champagne', 'prosecco'],                          shape: 'wine',   color: '#7b1fa2', label: '#e1bee7', cap: '#4a148c' },
  { keywords: ['beer', 'ale', 'lager', 'stout', 'ipa'],                  shape: 'beer',   color: '#ffb74d', label: '#e65100', cap: '#bf360c' },
  { keywords: ['triple sec','cointreau','curacao','liqueur','kahlua','baileys','amaretto'],
                                                                           shape: 'round',  color: '#ff8a65', label: '#bf360c', cap: '#4e342e' },
  { keywords: ['bitters', 'angostura'],                                    shape: 'mini',   color: '#ffcc02', label: '#e65100', cap: '#5d4037' },
  { keywords: ['vermouth'],                                                shape: 'tall',   color: '#a5d6a7', label: '#1b5e20', cap: '#2e7d32' },
  { keywords: ['soda','tonic','ginger beer','juice','syrup','grenadine'], shape: 'can',    color: '#e0e0e0', label: '#424242', cap: '#9e9e9e' },
  { keywords: ['cognac', 'brandy'],                                        shape: 'round',  color: '#a1887f', label: '#e65100', cap: '#5d4037' },
  { keywords: ['absinthe'],                                                shape: 'tall',   color: '#a5d6a7', label: '#2e7d32', cap: '#1b5e20' },
  { keywords: ['coffee', 'espresso', 'irish'],                            shape: 'round',  color: '#5d4037', label: '#ffcc02', cap: '#3e2723' },
];

function getBottleStyle(drink) {
  const name = (drink.name + ' ' + (drink.ingredients || []).join(' ')).toLowerCase();
  for (const s of BOTTLE_STYLES) {
    if (s.keywords.some(kw => name.includes(kw))) return s;
  }
  return { shape: 'round', color: '#ce93d8', label: '#6a1b9a', cap: '#4a148c' };
}

// ── Pixel-art SVG bottle renderer ─────────────────────────────────────────────
function PixelBottle({ style, size = 48, glow = false }) {
  const s = size;
  const { shape, color, label, cap } = style;

  if (shape === 'tall') return (
    <svg width={s * 0.6} height={s} viewBox="0 0 20 36" className={`bs-bottle-svg ${glow ? 'bs-glow' : ''}`}>
      <rect x="7" y="0" width="6" height="3" fill={cap} />
      <rect x="8" y="3" width="4" height="6" fill={color} />
      <rect x="4" y="9" width="12" height="24" fill={color} rx="1" />
      <rect x="5" y="14" width="10" height="10" fill={label} />
      <rect x="5" y="10" width="2" height="16" fill="rgba(255,255,255,0.25)" />
    </svg>
  );
  if (shape === 'square') return (
    <svg width={s * 0.65} height={s} viewBox="0 0 22 36" className={`bs-bottle-svg ${glow ? 'bs-glow' : ''}`}>
      <rect x="8" y="0" width="6" height="3" fill={cap} />
      <rect x="9" y="3" width="4" height="5" fill={color} />
      <rect x="3" y="8" width="16" height="25" fill={color} rx="1" />
      <rect x="5" y="13" width="12" height="8" fill={label} />
      <rect x="4" y="9" width="2" height="22" fill="rgba(255,255,255,0.2)" />
    </svg>
  );
  if (shape === 'round') return (
    <svg width={s * 0.65} height={s} viewBox="0 0 22 36" className={`bs-bottle-svg ${glow ? 'bs-glow' : ''}`}>
      <rect x="8" y="0" width="6" height="3" fill={cap} />
      <rect x="9" y="3" width="4" height="5" fill={color} />
      <rect x="4" y="8" width="14" height="25" fill={color} rx="3" />
      <rect x="6" y="14" width="10" height="10" fill={label} rx="1" />
      <rect x="5" y="9" width="2" height="22" fill="rgba(255,255,255,0.2)" />
    </svg>
  );
  if (shape === 'wine') return (
    <svg width={s * 0.5} height={s} viewBox="0 0 18 36" className={`bs-bottle-svg ${glow ? 'bs-glow' : ''}`}>
      <rect x="7" y="0" width="4" height="3" fill={cap} />
      <rect x="7" y="3" width="4" height="10" fill={color} />
      <rect x="3" y="13" width="12" height="20" fill={color} rx="2" />
      <rect x="5" y="17" width="8" height="8" fill={label} rx="1" />
      <rect x="4" y="14" width="2" height="18" fill="rgba(255,255,255,0.15)" />
    </svg>
  );
  if (shape === 'beer') return (
    <svg width={s * 0.55} height={s * 0.85} viewBox="0 0 18 30" className={`bs-bottle-svg ${glow ? 'bs-glow' : ''}`}>
      <rect x="6" y="0" width="6" height="3" fill={cap} />
      <rect x="7" y="3" width="4" height="4" fill={color} />
      <rect x="4" y="7" width="10" height="20" fill={color} rx="1" />
      <rect x="5" y="10" width="8" height="8" fill={label} />
      <rect x="5" y="8" width="2" height="18" fill="rgba(255,255,255,0.25)" />
    </svg>
  );
  if (shape === 'mini') return (
    <svg width={s * 0.4} height={s * 0.7} viewBox="0 0 14 24" className={`bs-bottle-svg ${glow ? 'bs-glow' : ''}`}>
      <rect x="5" y="0" width="4" height="2" fill={cap} />
      <rect x="5" y="2" width="4" height="4" fill={color} />
      <rect x="2" y="6" width="10" height="16" fill={color} rx="1" />
      <rect x="3" y="9" width="8" height="6" fill={label} />
      <rect x="3" y="7" width="2" height="14" fill="rgba(255,255,255,0.2)" />
    </svg>
  );
  if (shape === 'can') return (
    <svg width={s * 0.45} height={s * 0.65} viewBox="0 0 16 22" className={`bs-bottle-svg ${glow ? 'bs-glow' : ''}`}>
      <rect x="2" y="0" width="12" height="22" fill={color} rx="2" />
      <rect x="3" y="1" width="10" height="3" fill={cap} rx="1" />
      <rect x="4" y="7" width="8" height="8" fill={label} />
      <rect x="3" y="2" width="2" height="18" fill="rgba(255,255,255,0.2)" />
    </svg>
  );
  return (
    <svg width={s * 0.6} height={s} viewBox="0 0 20 36" className={`bs-bottle-svg ${glow ? 'bs-glow' : ''}`}>
      <rect x="7" y="0" width="6" height="3" fill={cap} />
      <rect x="8" y="3" width="4" height="6" fill={color} />
      <rect x="4" y="9" width="12" height="24" fill={color} rx="2" />
      <rect x="6" y="14" width="8" height="8" fill={label} />
    </svg>
  );
}

// ── Neon sign text ─────────────────────────────────────────────────────────────
function NeonText({ text, color = '#ff4081' }) {
  return (
    <span className="bs-neon-text"
      style={{ color, textShadow: `0 0 4px ${color}, 0 0 8px ${color}, 0 0 16px ${color}40` }}>
      {text}
    </span>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SWINGING WOODEN SHINGLE — replaces the LED marquee board
// Clickable to rename the bar; sways gently on a CSS animation
// ══════════════════════════════════════════════════════════════════════════════
function SwingingShingle({ barName, onClickShingle }) {
  const displayName = (barName || 'SPICEHUB SALOON').toUpperCase().slice(0, 22);
  return (
    <div
      className="bs-shingle-wrap"
      onClick={onClickShingle}
      role="button"
      tabIndex={0}
      aria-label="Rename your bar"
      onKeyDown={e => e.key === 'Enter' && onClickShingle?.()}
    >
      {/* Pixel chain links */}
      <div className="bs-shingle-chains" aria-hidden="true">
        <svg className="bs-shingle-chain bs-shingle-chain--left" width="8" height="22" viewBox="0 0 8 22" style={{ imageRendering: 'pixelated' }}>
          <rect x="2" y="0"  width="4" height="4" fill="#8b6914" rx="1" />
          <rect x="2" y="5"  width="4" height="4" fill="#c8a882" rx="1" />
          <rect x="2" y="10" width="4" height="4" fill="#8b6914" rx="1" />
          <rect x="2" y="15" width="4" height="4" fill="#c8a882" rx="1" />
        </svg>
        <svg className="bs-shingle-chain bs-shingle-chain--right" width="8" height="22" viewBox="0 0 8 22" style={{ imageRendering: 'pixelated' }}>
          <rect x="2" y="0"  width="4" height="4" fill="#8b6914" rx="1" />
          <rect x="2" y="5"  width="4" height="4" fill="#c8a882" rx="1" />
          <rect x="2" y="10" width="4" height="4" fill="#8b6914" rx="1" />
          <rect x="2" y="15" width="4" height="4" fill="#c8a882" rx="1" />
        </svg>
      </div>
      {/* Wooden board */}
      <motion.div
        className="bs-shingle-board"
        whileTap={{ scale: 0.93, y: 3 }}
        transition={{ type: 'spring', stiffness: 500, damping: 28 }}
      >
        <div className="bs-shingle-inner">
          <span className="bs-shingle-star" aria-hidden="true">★</span>
          <span className="bs-shingle-text">{displayName}</span>
          <span className="bs-shingle-star" aria-hidden="true">★</span>
        </div>
        <span className="bs-shingle-sub" aria-hidden="true">FINE SPIRITS  ✦  EST. 8-BIT</span>
        <span className="bs-shingle-edit-hint" aria-hidden="true">tap to rename</span>
      </motion.div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// WALL CHALKBOARD — back wall, shows "Today's Special" based on inventory
// ══════════════════════════════════════════════════════════════════════════════
function WallChalkboard({ specialDrink, onClick }) {
  const drinkName = specialDrink
    ? specialDrink.name.toUpperCase().slice(0, 16)
    : '???';
  const ingredients = specialDrink
    ? (specialDrink.ingredients || []).slice(0, 3).join(' · ').slice(0, 28)
    : 'add bottles to\nsee specials!';

  return (
    <motion.button
      className="wall-chalkboard"
      onClick={onClick}
      aria-label="Today's special chalkboard — click for bartender reaction"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22, delay: 0.3 }}
      whileHover={{ scale: 1.05, rotate: -0.6 }}
      whileTap={{ scale: 0.93 }}
    >
      <div className="chalkboard-frame">
        <div className="chalkboard-surface">
          <div className="chalk-header">TODAY&apos;S<br/>SPECIAL</div>
          <div className="chalk-divider" />
          <AnimatePresence mode="wait">
            <motion.div
              key={drinkName}
              className="chalk-drink-name"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: 'easeOut' }}
            >
              {drinkName}
            </motion.div>
          </AnimatePresence>
          <div className="chalk-ingredients">{ingredients}</div>
          {/* Chalk corner decorations */}
          <div className="chalk-corner chalk-corner--tl" aria-hidden="true" />
          <div className="chalk-corner chalk-corner--tr" aria-hidden="true" />
          <div className="chalk-corner chalk-corner--bl" aria-hidden="true" />
          <div className="chalk-corner chalk-corner--br" aria-hidden="true" />
        </div>
      </div>
    </motion.button>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// WALL BOUNTY BOARD — back wall, shows "WANTED" parchment posters for
// the most-needed missing ingredients
// ══════════════════════════════════════════════════════════════════════════════
function WallBountyBoard({ bounties, onClickBounty }) {
  if (!bounties || bounties.length === 0) return null;
  return (
    <motion.div
      className="wall-bounty-board"
      aria-label="Wanted board for missing ingredients"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22, delay: 0.55 }}
    >
      <div className="bounty-board-header" aria-hidden="true">⚑ WANTED ⚑</div>
      <div className="bounty-posters">
        <AnimatePresence>
          {bounties.slice(0, 2).map((b, i) => (
            <motion.button
              key={b.ingredient}
              className="bounty-poster"
              onClick={() => onClickBounty?.(b)}
              aria-label={`Wanted: ${b.ingredient} for ${b.drinkName}`}
              initial={{ opacity: 0, scale: 0.72, rotate: i === 0 ? -10 : 10 }}
              animate={{ opacity: 1, scale: 1, rotate: i === 0 ? -2.5 : 2.5 }}
              exit={{ opacity: 0, scale: 0.65, transition: { duration: 0.15 } }}
              transition={{ type: 'spring', stiffness: 320, damping: 18, delay: i * 0.14 + 0.68 }}
              whileHover={{ scale: 1.09, rotate: 0 }}
              whileTap={{ scale: 0.92 }}
            >
              <div className="bounty-poster-label">WANTED</div>
              <div className="bounty-ingredient">
                {b.ingredient.toUpperCase().slice(0, 10)}
              </div>
              <div className="bounty-reward">
                REWARD:<br />{(b.drinkName || '?').slice(0, 9)}
              </div>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PIXEL ART BARTENDER
// States: idle | walking | grabbing | presenting | returning
//         swigwalk | swigging | swigreturn | polishing | tipping | dozing | shaking | surprised
// ══════════════════════════════════════════════════════════════════════════════
function PixelBartender({ state, holdingBottle, facingRight, swigBottle, swigQuip, isDancing }) {
  const flip = facingRight ? '' : 'scale(-1,1)';
  const isWalking   = ['walking', 'returning', 'swigwalk', 'swigreturn'].includes(state);
  const isGrabbing  = state === 'grabbing';
  const isPresenting = state === 'presenting';
  const isIdle      = state === 'idle';
  const isSwigging  = state === 'swigging';
  const isPolishing = state === 'polishing';
  const isTipping   = state === 'tipping';
  const isDozing    = state === 'dozing';
  const isShaking   = state === 'shaking';
  const isSurprised = state === 'surprised';

  return (
    <svg
      overflow="visible"
      width="120" height="168" viewBox="0 0 40 56"
      className={[
        'bs-bartender-svg',
        isWalking   ? 'bs-bt-walk'        : '',
        isPresenting ? 'bs-bt-present'    : '',
        isSwigging  ? 'bs-bt-swig-bounce' : '',
        isDancing   ? 'bs-bt-dance'       : '',
      ].join(' ')}
      style={{ imageRendering: 'pixelated' }}
    >
      <g transform={`translate(20,0) ${flip} translate(-20,0)`}>

        {/* ── Hat (bowler) ── tilts when tipping */}
        <g style={isTipping ? { transform: 'translate(3px, 0px) rotate(-8deg)' } : {}}>
          <rect x="10" y="0"  width="20" height="4"  fill="#1a1a1a" />
          <rect x="8"  y="4"  width="24" height="3"  fill="#1a1a1a" />
          <rect x="12" y="1"  width="16" height="6"  fill="#2a2a2a" />
        </g>

        {/* ── Head ── tilts back when swigging */}
        <g className={isSwigging ? 'bs-bt-head-tilt' : ''} style={isTipping ? { transform: 'skewX(-3deg)' } : {}}>
          <rect x="13" y="7" width="14" height="12" fill="#e8b88a" />
          {isSwigging ? (
            /* squinting eyes + open mouth for the swig */
            <>
              <rect x="14" y="12" width="5" height="1" fill="#4a3520" />
              <rect x="21" y="12" width="5" height="1" fill="#4a3520" />
              <rect x="17" y="17" width="6" height="2" fill="#3e2000" rx="1" />
            </>
          ) : isDozing ? (
            /* eyes shut + big smile */
            <>
              <rect x="15" y="12" width="3" height="1" fill="#4a3520" />
              <rect x="22" y="12" width="3" height="1" fill="#4a3520" />
              <rect x="16" y="16" width="8" height="2" fill="#3e2000" rx="1" />
            </>
          ) : isShaking ? (
            /* big O-mouth, wider eyes */
            <>
              <rect x="14" y="10" width="4" height="4" fill="#333" />
              <rect x="22" y="10" width="4" height="4" fill="#333" />
              <rect x="15" y="10" width="1" height="1" fill="#fff" />
              <rect x="23" y="10" width="1" height="1" fill="#fff" />
              <rect x="17" y="17" width="6" height="2" fill="#3e2000" rx="1" />
            </>
          ) : isSurprised ? (
            /* extra wide eyes + eyebrows + O-mouth */
            <>
              <rect x="14" y="10" width="5" height="3" fill="#333" />
              <rect x="21" y="10" width="5" height="3" fill="#333" />
              <rect x="15" y="10" width="1" height="1" fill="#fff" />
              <rect x="23" y="10" width="1" height="1" fill="#fff" />
              <rect x="14" y="9" width="5" height="1" fill="#4a3520" />
              <rect x="21" y="9" width="5" height="1" fill="#4a3520" />
              <rect x="17" y="16" width="6" height="2" fill="#3e2000" rx="1" />
            </>
          ) : (
            <>
              <rect x="15" y="11" width="3" height="3" fill="#333" />
              <rect x="22" y="11" width="3" height="3" fill="#333" />
              <rect x="16" y="11" width="1" height="1" fill="#fff" />
              <rect x="23" y="11" width="1" height="1" fill="#fff" />
              {(isIdle || isPolishing || isTipping) && <rect x="15" y="11" width="3" height="1" fill="#e8b88a" className="bs-bt-blink" />}
              {(isIdle || isPolishing || isTipping) && <rect x="22" y="11" width="3" height="1" fill="#e8b88a" className="bs-bt-blink" />}
            </>
          )}
          {/* Mustache */}
          <rect x="14" y="15" width="5" height="2" fill="#4a3520" />
          <rect x="21" y="15" width="5" height="2" fill="#4a3520" />
          <rect x="17" y="16" width="6" height="1" fill="#4a3520" />
        </g>

        {/* ── Bow tie ── */}
        <rect x="16" y="19" width="3" height="3" fill="#c62828" />
        <rect x="21" y="19" width="3" height="3" fill="#c62828" />
        <rect x="19" y="20" width="2" height="1" fill="#e53935" />

        {/* ── Body (vest + shirt) ── */}
        <rect x="12" y="22" width="16" height="16" fill="#333" />
        <rect x="17" y="22" width="6"  height="16" fill="#f5f5f5" />
        <rect x="19" y="24" width="2"  height="2"  fill="#ffd700" />
        <rect x="19" y="28" width="2"  height="2"  fill="#ffd700" />
        <rect x="19" y="32" width="2"  height="2"  fill="#ffd700" />

        {/* ── Arms ── */}
        {isSwigging ? (
          /* Swig arm raised high toward mouth; other arm resting on bar rail */
          <>
            <rect x="28" y="13" width="4" height="12" fill="#333" className="bs-bt-swig-arm" />
            <rect x="30" y="9"  width="4" height="5"  fill="#e8b88a" className="bs-bt-swig-arm" />
            <rect x="4"  y="26" width="8" height="4"  fill="#333" />
            <rect x="4"  y="30" width="4" height="3"  fill="#e8b88a" />
          </>
        ) : isPolishing ? (
          /* Extended polishing arm + wiping motion */
          <>
            <rect x="28" y="20" width="4" height="8" fill="#333" className="bs-bt-polish-arm" />
            <rect x="32" y="18" width="6" height="3" fill="#e8b88a" className="bs-bt-polish-arm" />
            <rect x="4"  y="24" width="8" height="4" fill="#333" />
            <rect x="4"  y="28" width="4" height="3" fill="#e8b88a" />
          </>
        ) : isShaking ? (
          /* Both arms up for shaking */
          <>
            <rect x="4"  y="18" width="4" height="14" fill="#333" />
            <rect x="2"  y="16" width="4" height="4"  fill="#e8b88a" />
            <rect x="32" y="18" width="4" height="14" fill="#333" />
            <rect x="34" y="16" width="4" height="4"  fill="#e8b88a" />
          </>
        ) : isIdle || isTipping || isDozing ? (
          /* Wiping arm + resting arm */
          <>
            <rect x="4"  y="24" width="8" height="4" fill="#333"    className="bs-bt-wipe-arm" />
            <rect x="4"  y="28" width="4" height="3" fill="#e8b88a" className="bs-bt-wipe-arm" />
            <rect x="28" y="24" width="8" height="4" fill="#333" />
            <rect x="32" y="28" width="4" height="3" fill="#e8b88a" />
          </>
        ) : isGrabbing || isPresenting ? (
          /* One arm raised to grab / hold bottle */
          <>
            <rect x="28" y="16" width="4" height="10" fill="#333" />
            <rect x="30" y="14" width="4" height="4"  fill="#e8b88a" />
            <rect x="4"  y="24" width="8" height="4"  fill="#333" />
            <rect x="4"  y="28" width="4" height="3"  fill="#e8b88a" />
          </>
        ) : (
          /* Walking / returning / surprised */
          <>
            <rect x="4"  y="24" width="8" height="4" fill="#333" />
            <rect x="4"  y="28" width="4" height="3" fill="#e8b88a" />
            <rect x="28" y="24" width="8" height="4" fill="#333" />
            <rect x="32" y="28" width="4" height="3" fill="#e8b88a" />
          </>
        )}

        {/* ── Apron ── */}
        <rect x="14" y="34" width="12" height="8" fill="#f5f5f5" />
        <rect x="16" y="34" width="8"  height="1" fill="#ddd" />

        {/* ── Legs ── */}
        <rect x="14" y="42" width="5" height="10" fill="#1a1a1a" />
        <rect x="21" y="42" width="5" height="10" fill="#1a1a1a" />
        <rect x="12" y="52" width="7" height="4"  fill="#3e2723" />
        <rect x="21" y="52" width="7" height="4"  fill="#3e2723" />
      </g>

      {/* ── Regular held bottle (grabbing / presenting) ── */}
      {holdingBottle && (isGrabbing || isPresenting) && (
        <g transform={facingRight ? 'translate(30, 6)' : 'translate(2, 6)'} className="bs-bt-held-bottle">
          <rect x="0"  y="0"  width="3" height="2"  fill={holdingBottle.cap} />
          <rect x="0"  y="2"  width="3" height="3"  fill={holdingBottle.color} />
          <rect x="-1" y="5"  width="5" height="10" fill={holdingBottle.color} rx="1" />
          <rect x="0"  y="7"  width="3" height="4"  fill={holdingBottle.label} />
        </g>
      )}

      {/* ── Swig bottle — tilted toward the open mouth ── */}
      {isSwigging && swigBottle && (
        <g
          transform={facingRight
            ? 'translate(33, 4) rotate(-125)'
            : 'translate(7, 4) rotate(125)'}
          className="bs-bt-swig-bottle"
        >
          <rect x="0"  y="0"  width="3" height="2" fill={swigBottle.cap} />
          <rect x="0"  y="2"  width="3" height="3" fill={swigBottle.color} />
          <rect x="-1" y="5"  width="5" height="9" fill={swigBottle.color} rx="1" />
          <rect x="0"  y="6"  width="3" height="3" fill={swigBottle.label} />
          {/* Liquid drip / pour droplet */}
          <circle cx="1.5" cy="-2" r="1.5" fill="rgba(255,200,80,0.9)" className="bs-bt-drip" />
        </g>
      )}

      {/* ── Wiping rag (idle only) ── */}
      {isIdle && (
        <g className="bs-bt-wipe-arm">
          <rect x="2" y="29" width="6" height="3" fill="#f5f5dc" rx="1" />
          <rect x="1" y="30" width="3" height="4" fill="#f5f5dc" rx="1" />
        </g>
      )}
    </svg>
  );
}

// ── Constants ──────────────────────────────────────────────────────────────────
const BOTTLES_PER_SHELF = 6;
const SHELVES_PER_PAGE  = 3;
const BOTTLES_PER_PAGE  = BOTTLES_PER_SHELF * SHELVES_PER_PAGE; // 15

// ── Time-of-day awareness ────────────────────────────────────────────────────
function getTimeContext() {
  const now = new Date();
  const h = now.getHours();
  const dow = now.getDay(); // 0=Sun
  const isFriday = dow === 5;
  const isSaturday = dow === 6;
  const isWeekend = isFriday || isSaturday || dow === 0;
  if (h >= 23 || h < 2)    return { period: 'lastcall',   isHappyHour: false, isWeekend };
  if (h < 10)              return { period: 'morning',     isHappyHour: false, isWeekend };
  if (h < 12)              return { period: 'brunch',      isHappyHour: false, isWeekend };
  if (h < 17)              return { period: 'afternoon',   isHappyHour: false, isWeekend };
  if (isFriday && h >= 17) return { period: 'happyhour',   isHappyHour: true,  isWeekend };
  if (h < 21)              return { period: 'evening',     isHappyHour: isWeekend, isWeekend };
  return                          { period: 'latenight',   isHappyHour: false, isWeekend };
}

// ── Inventory-aware dialogue engine ──────────────────────────────────────────
const TIME_GREETINGS = {
  lastcall:  ["Last call, partner!","Closin' time soon...","One more round?","The night's still young... barely."],
  morning:   ["Hair of the dog?","Mornin'! Coffee... or bourbon?","Early bird gets the worm... and the whiskey.","Brunch cocktails comin' up!"],
  brunch:    ["Mimosa o'clock!","Brunch is served!","Bloody Mary weather, eh?","Sunday funday vibes!"],
  afternoon: ["Afternoon delight!","Sun's over the yardarm.","Siesta fuel comin' right up.","Perfect pour weather."],
  happyhour: ["HAPPY HOUR!! Drinks on... well, you.","Friday vibes! What's your poison?","The weekend starts NOW.","Happy hour specials!"],
  evening:   ["Evenin'! What'll it be?","The night is young!","Perfect cocktail weather.","Step right up, friend."],
  latenight: ["Nightcap?","Still here? Respect.","One for the road?","The best drinks happen after dark."],
};

const INVENTORY_QUIPS = {
  empty:  ["Tumbleweeds are blowing through my top shelf...","A dry bar is a sad bar. Drop some bottles in!","Not a drop in sight!","A bar without bottles is just a counter."],
  low:    ["The shelves are drier than Prohibition...","We're runnin' low, friend.","Three bottles? We can work with that.","Slim pickings tonight."],
  medium: ["A respectable selection!","We're gettin' somewhere.","Not bad, not bad at all.","Now we're cookin'... er, mixin'."],
  high:   ["Top shelf collection!","Now THAT'S a bar!","Look at this selection! Magnificent.","You're making the local store owner rich!"],
  huge:   ["Sweet mother of mixology!","This is a MUSEUM of spirits!","The legends will speak of this bar.","I could work here forever."],
};

const AMBIENT_MUSINGS = [
  "Keep your muddy boots off the digital counter, partner.",
  "Wiping down this bar is 90% of my code.",
  "We don't serve water here unless it's frozen and clinking against glass.",
  "You look like someone who appreciates a stiff pixel.",
  "Gold rush outside, flavor rush inside.",
  "I've seen things... mostly empty glasses, but still.",
  "My mustache is calibrated to 8-bit precision.",
];

const CONTEXTUAL_QUIPS = {
  surprise: [
    "Wild West roulette, coming right up!",
    "Let's see where the spinner lands...",
  ],
  tuneOn: [
    "Ah, some honky-tonk melodies to soothe the pixels.",
    "Turning up the player piano!",
  ],
  tuneOff: [
    "Quiet room. I can hear the ice sweat.",
    "Player piano's takin' five.",
  ],
  topShelf: [
    "Ooh, the fancy stuff. Mind if I sneak a sip?",
    "Now we're running a classy establishment.",
  ],
  tapSpam: [
    "Hey, watch the vest. It's dry-clean only.",
    "Need a drink, or are you just testing my hitbox?",
  ],
  wake: [
    "I'm awake. Mostly.",
    "Easy now. I was resting my pixels.",
  ],
};

const TIP_JAR_WISDOM = [
  "Always chill the glass before the swagger.",
  "Bitters first. Regret later.",
  "A citrus peel is a handshake, not a hat.",
  "Two dashes means two. The bottle lies.",
  "Clear ice buys you ten seconds of respect.",
  "If it smells flat, wake it up with lemon oil.",
];

function sample(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function getInventoryTier(count) {
  if (count === 0) return 'empty';
  if (count <= 3)  return 'low';
  if (count <= 8)  return 'medium';
  if (count <= 15) return 'high';
  return 'huge';
}

// Detect potential cocktail combos from inventory
function detectPourMatch(drinks) {
  const names = drinks.map(d => (d.name + ' ' + (d.ingredients || []).join(' ')).toLowerCase());
  const allText = names.join(' ');
  const combos = [
    { keys: ['bourbon', 'bitters'],              quip: "Bourbon & Bitters? Are we doing this the old-fashioned way?" },
    { keys: ['gin', 'tonic'],                     quip: "Gin & tonic on deck. A classic!" },
    { keys: ['vodka', 'kahlua'],                  quip: "I smell a White Russian brewing..." },
    { keys: ['rum', 'lime'],                      quip: "Rum + lime = Daiquiri dreams!" },
    { keys: ['tequila', 'triple sec', 'lime'],    quip: "Margarita ingredients spotted! Salt the rim?" },
    { keys: ['whiskey', 'vermouth'],              quip: "Manhattan material right here." },
    { keys: ['vodka', 'tomato', 'celery'],        quip: "Bloody Mary supplies in position!" },
    { keys: ['champagne', 'orange'],              quip: "Mimosa time? I won't judge." },
  ];
  for (const c of combos) {
    if (c.keys.every(k => allText.includes(k))) return c.quip;
  }
  return null;
}

function getSmartQuip(drinks) {
  const tc = getTimeContext();
  const tier = getInventoryTier(drinks.length);
  const pool = [];

  // Time greetings — weighted higher
  pool.push(...(TIME_GREETINGS[tc.period] || TIME_GREETINGS.evening));
  pool.push(...(TIME_GREETINGS[tc.period] || TIME_GREETINGS.evening)); // double weight

  // Inventory awareness
  pool.push(...(INVENTORY_QUIPS[tier] || INVENTORY_QUIPS.medium));

  // Pour match (combo detection)
  const pourMatch = detectPourMatch(drinks);
  if (pourMatch) { pool.push(pourMatch); pool.push(pourMatch); pool.push(pourMatch); } // triple weight for specificity

  // General flavour
  pool.push("Pick yer poison!", "Name it, I got it!", "Fine spirits. Finer company.", "Every drink tells a story.");
  pool.push(...AMBIENT_MUSINGS);

  return pool[Math.floor(Math.random() * pool.length)];
}


/**
 * Returns a bartender quip based on inventory size and time of day.
 */
function getBartenderQuip(drinks, hour) {
  const count = drinks?.length ?? 0;
  if (hour >= 23 || hour < 2) return "Last call! What'll it be, friend?";
  if (hour >= 2 && hour < 10) return "Hair of the dog? Bold move. I respect it.";
  const day = new Date().getDay();
  if (day === 5 && hour >= 17) return "It's Friday after 5. Happy hour is officially ON.";
  if (count === 0) return "The shelves are bare. Time to stock up, partner.";
  if (count <= 3) return "The shelves are drier than a Prohibition-era Sunday…";
  if (count >= 10) return "Look at this selection! You're making the local liquor store owner very wealthy.";
  return null;
}
// ── Bad bartender jokes (tap 5x easter egg) ──────────────────────────────────
const BAR_JOKES = [
  "I'm reading a book about anti-gravity. It's impossible to put down.",
  "Why don't scientists trust atoms? Because they make up everything.",
  "I told my wife she was drawing her eyebrows too high. She looked surprised.",
  "I used to hate facial hair, but then it grew on me.",
  "What do you call a fake noodle? An impasta.",
];

const BAD_JOKES = [
  ...CONTEXTUAL_QUIPS.tapSpam,
  "Why did the bartender break up with the glass? It was too empty inside.",
  "I told a chemistry joke at the bar. No reaction.",
  "A neutron walks into a bar. 'How much for a drink?' 'For you, no charge.'",
  "What did the bartender say after oxygen, hydrogen, sulfur, sodium, and phosphorus walked in? OH SNaP!",
  "Why don't scientists drink? They know alcohol is a solution.",
  "I'm not an alcoholic. Alcoholics go to meetings. I go to bars.",
  "My bartending motto: I came, I poured, I conquered.",
  "What does a bartender do when they get cold? Stand in the corner. It's 90 degrees.",
  "A Roman walks into a bar, holds up 2 fingers, and says, 'Five beers please.'",
  "What did the grape say after the bartender stepped on it? Nothing, it just let out a little wine.",
];

// ── "Surprise Me" cocktail suggestions ──────────────────────────────────────
const SURPRISE_CLASSICS = [
  { name: "Old Fashioned" },
  { name: "Margarita" },
  { name: "Mojito" },
  { name: "Negroni" },
  { name: "Daiquiri" },
  { name: "Manhattan" },
  { name: "Espresso Martini" },
  { name: "Whiskey Sour" },
  { name: "Paloma" },
  { name: "Moscow Mule" },
  { name: "Tom Collins" },
  { name: "Gin Fizz" },
];

// ── Rarity system — determines bottle glow/color tier ───────────────────────
function getDrinkRarity(drink) {
  const ingCount = drink.ingredients?.length || 0;
  const name = (drink.name || '').toLowerCase();
  // Legendary: 6+ ingredients or named "classic" cocktails
  const legendaryNames = ['negroni','manhattan','old fashioned','mai tai','singapore sling','sazerac','corpse reviver','aviation','last word','paper plane'];
  if (legendaryNames.some(n => name.includes(n))) return 'legendary';
  if (ingCount >= 6) return 'legendary';
  if (ingCount >= 4) return 'rare';
  return 'common';
}

function getRarityColor(rarity) {
  if (rarity === 'legendary') return '#ffd700';
  if (rarity === 'rare') return '#42a5f5';
  return '#ccc';
}

// ── Ingredient matching against bar inventory ────────────────────────────────
function matchIngredients(drinkIngredients, inventory) {
  if (!drinkIngredients || !inventory || inventory.length === 0) {
    return { matched: [], missing: drinkIngredients || [], total: drinkIngredients?.length || 0, score: 0 };
  }
  const matched = [];
  const missing = [];
  for (const ing of drinkIngredients) {
    const ingLower = ing.toLowerCase();
    const isMatch = inventory.some(inv =>
      ingLower.includes(inv) || inv.includes(ingLower.split(' ').pop())
    );
    if (isMatch) matched.push(ing);
    else missing.push(ing);
  }
  return { matched, missing, total: drinkIngredients.length, score: matched.length / (drinkIngredients.length || 1) };
}

// ── Quest Scroll SVG ────────────────────────────────────────────────────────
function QuestScroll({ size = 20, color = '#ffd700' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" style={{ imageRendering: 'pixelated', flexShrink: 0 }}>
      <rect x="3" y="1" width="14" height="18" fill="#f5e6c8" rx="1" />
      <rect x="3" y="1" width="14" height="3" fill="#d4a574" rx="1" />
      <rect x="3" y="16" width="14" height="3" fill="#d4a574" rx="1" />
      <rect x="1" y="2" width="3" height="2" fill="#8b6914" />
      <rect x="16" y="2" width="3" height="2" fill="#8b6914" />
      <rect x="1" y="16" width="3" height="2" fill="#8b6914" />
      <rect x="16" y="16" width="3" height="2" fill="#8b6914" />
      <rect x="6" y="6" width="8" height="1" fill={color} />
      <rect x="6" y="9" width="6" height="1" fill={color} />
      <rect x="6" y="12" width="7" height="1" fill={color} />
    </svg>
  );
}

const SWIG_QUIPS = [
  "Ahhh... quality control!",
  "*hic*",
  "Don't tell the boss...",
  "Mmm... smooth.",
  "Just a nip!",
  "Don't mind if I do!",
  "For quality control...",
  "Shaken, not stirred... into me.",
  "The customer's always right, but I'm thirsty.",
  "This one's on the house. My house.",
  "A bartender's perk!",
  "Research purposes only.",
  "Occupational hazard!",
  "*suspicious glug*",
  "Aged to perfection... like me.",
];

const IDLE_BEHAVIORS = [
  "polishing",
  "tipping",
  "dozing",
];

// ── Chiptune engine (Web Audio API 8-bit jazz bar loop) ────────────────────
// Frequencies: A minor pentatonic
const CHIP_NOTES = [
  [220,0.18],[262,0.12],[294,0.18],[330,0.12],[294,0.12],[262,0.18],[220,0.24],
  [262,0.12],[294,0.12],[330,0.18],[392,0.12],[330,0.18],[294,0.12],[262,0.24],
  [294,0.12],[330,0.12],[392,0.18],[440,0.12],[392,0.12],[330,0.18],[294,0.36],
  [220,0.12],[262,0.18],[294,0.12],[262,0.12],[220,0.18],[196,0.12],[220,0.36],
];

function startChiptune() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    let stopped = false;
    function loop(startT) {
      if (stopped) return;
      let t = startT;
      for (const [freq, dur] of CHIP_NOTES) {
        const osc = ctx.createOscillator();
        const g   = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.055, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.85);
        osc.start(t); osc.stop(t + dur);
        t += dur;
      }
      const loopLen = CHIP_NOTES.reduce((s,[,d]) => s + d, 0);
      const delay   = Math.max(0, (t - ctx.currentTime) * 1000 - 80);
      const tid = setTimeout(() => { if (!stopped) loop(ctx.currentTime); }, delay);
      return tid;
    }
    loop(ctx.currentTime + 0.05);
    return () => { stopped = true; ctx.close(); };
  } catch { return () => {}; }
}
// ── Saloon ambient SVG components ─────────────────────────────────────────────

function HangingLantern({ x = 50, flicker = true }) {
  return (
    <svg
      className={`saloon-lantern${flicker ? ' saloon-lantern--flicker' : ''}`}
      style={{ left: `${x}%`, imageRendering: 'pixelated' }}
      width="24" height="36" viewBox="0 0 24 36"
    >
      {/* Chain */}
      <rect x="11" y="0" width="2" height="6" fill="#6b4c2a" />
      {/* Lantern body */}
      <rect x="5" y="6" width="14" height="18" fill="#b5651d" rx="2" />
      <rect x="7" y="8" width="10" height="14" fill="#ffe082" opacity="0.9" />
      {/* Glow center */}
      <rect x="9" y="10" width="6" height="10" fill="#fff9c4" opacity="0.95" />
      {/* Frame bars */}
      <rect x="5" y="6" width="2" height="18" fill="#5d4037" />
      <rect x="17" y="6" width="2" height="18" fill="#5d4037" />
      <rect x="5" y="14" width="14" height="2" fill="#5d4037" opacity="0.6" />
      {/* Top + bottom cap */}
      <rect x="4" y="4" width="16" height="4" fill="#4e342e" rx="1" />
      <rect x="4" y="24" width="16" height="4" fill="#4e342e" rx="1" />
      {/* Bottom hook */}
      <rect x="11" y="28" width="2" height="8" fill="#6b4c2a" />
    </svg>
  );
}

function BarStool({ active = false }) {
  return (
    <svg
      className="saloon-stool"
      style={{ imageRendering: 'pixelated', display: 'block' }}
      width="28" height="64" viewBox="0 0 28 64"
    >
      {/* Seat cushion — highlighted when active */}
      <rect x="2" y="0" width="24" height="7" fill={active ? '#8d6e63' : '#5d4037'} rx="2" />
      <rect x="3" y="1" width="22" height="4" fill={active ? '#a1887f' : '#795548'} rx="1" />
      {/* Seat highlight rim */}
      <rect x="3" y="0" width="22" height="1" fill="rgba(255,255,255,0.12)" rx="1" />
      {/* Center post */}
      <rect x="12" y="7" width="4" height="20" fill="#4e342e" />
      {/* Mid foot ring */}
      <rect x="4" y="23" width="20" height="3" fill="#6d4c41" rx="1" />
      {/* Legs — long enough to reach floor */}
      <rect x="5"  y="26" width="3" height="34" fill="#4e342e" />
      <rect x="20" y="26" width="3" height="34" fill="#4e342e" />
      {/* Leg bracing */}
      <rect x="8" y="42" width="12" height="2" fill="#3e2723" />
      {/* Foot pads */}
      <rect x="4"  y="58" width="5" height="4" fill="#3e2723" rx="1" />
      <rect x="19" y="58" width="5" height="4" fill="#3e2723" rx="1" />
    </svg>
  );
}

function PixelTipJar({ tipsCollected, coinNonce, onTip }) {
  return (
    <motion.button
      className="bs-tip-jar"
      onClick={onTip}
      title={`${tipsCollected} tips collected — tap to tip!`}
      aria-label={`Tip the bartender. ${tipsCollected} tips collected.`}
      whileHover={{ y: -3, transition: { type: 'spring', stiffness: 400, damping: 15 } }}
      whileTap={{ scale: 0.92 }}
      style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}
    >
      {/* Framer Motion spring coin drop */}
      <AnimatePresence>
        {coinNonce > 0 && (
          <motion.div
            key={coinNonce}
            aria-hidden="true"
            className="bs-tip-coin-fm"
            style={{ position: 'absolute', top: 0, left: '50%', translateX: '-50%', zIndex: 10 }}
            initial={{ y: -52, opacity: 1, scale: 1.1, rotate: 0 }}
            animate={{ y: 18, opacity: [1, 1, 0.8], scale: [1.1, 1, 0.85], rotate: [0, 15, -10, 5, 0] }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ type: 'spring', stiffness: 260, damping: 14, bounce: 0.42 }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" style={{ imageRendering: 'pixelated' }}>
              <circle cx="9" cy="9" r="7" fill="#ffd166" />
              <circle cx="9" cy="9" r="5" fill="#f0a500" />
              <text x="9" y="12" textAnchor="middle" fontSize="7" fill="#ffd166" fontFamily="monospace">$</text>
              <circle cx="6" cy="6" r="1.5" fill="rgba(255,255,200,0.5)" />
            </svg>
          </motion.div>
        )}
      </AnimatePresence>
      <svg width="42" height="46" viewBox="0 0 42 46" className="bs-tip-jar-svg" aria-hidden="true">
        <rect x="11" y="4" width="20" height="5" fill="#c8a882" />
        <rect x="8" y="9" width="26" height="31" fill="rgba(184,220,255,0.28)" />
        <rect x="10" y="12" width="22" height="25" fill="rgba(236,247,255,0.18)" />
        <rect x="8" y="9" width="3" height="31" fill="rgba(255,255,255,0.3)" />
        <rect x="31" y="9" width="3" height="31" fill="rgba(80,40,20,0.3)" />
        <rect x="12" y="19" width="18" height="8" fill="#f5e6c8" />
        <rect x="14" y="21" width="14" height="2" fill="#5d4037" />
        <rect x="16" y="25" width="10" height="1" fill="#8b6914" />
        <rect x="12" y="34" width="5" height="3" fill="#ffd166" />
        <rect x="22" y="32" width="6" height="3" fill="#ffd166" />
        <rect x="17" y="36" width="6" height="3" fill="#c9972c" />
        <rect x="8" y="40" width="26" height="4" fill="#5d4037" />
      </svg>
      <span className="bs-tip-count">{tipsCollected}</span>
    </motion.button>
  );
}

function PixelDog({ wagging = false }) {
  return (
    <div className={`saloon-dog-wrap${wagging ? ' saloon-dog-wag' : ''}`} aria-hidden="true">
      <svg width="36" height="20" viewBox="0 0 36 20" style={{ imageRendering: 'pixelated' }}>
        {/* Body */}
        <rect x="6" y="8" width="20" height="10" fill="#a1887f" rx="2" />
        {/* Head */}
        <rect x="22" y="4" width="12" height="10" fill="#a1887f" rx="2" />
        {/* Ear */}
        <rect x="28" y="2" width="4" height="5" fill="#8d6e63" rx="1" />
        {/* Eye */}
        <rect x="30" y="6" width="2" height="2" fill="#1a0f0a" />
        {/* Nose */}
        <rect x="33" y="9" width="2" height="2" fill="#5d4037" />
        {/* Zzz text */}
        <text x="36" y="4" fontSize="5" fill="#c8a882" opacity="0.7" fontFamily="monospace">z</text>
        <text x="34" y="1" fontSize="4" fill="#c8a882" opacity="0.5" fontFamily="monospace">z</text>
        {/* Legs */}
        <rect x="8"  y="17" width="4" height="3" fill="#8d6e63" />
        <rect x="14" y="17" width="4" height="3" fill="#8d6e63" />
        <rect x="20" y="17" width="4" height="3" fill="#8d6e63" />
        {/* Tail */}
        <rect x="2" y="6" width="6" height="4" fill="#8d6e63" rx="1" />
        <rect x="0" y="3" width="4" height="4" fill="#8d6e63" rx="1" />
      </svg>
    </div>
  );
}

function SaloonDoor({ open = false }) {
  return (
    <div className={`saloon-door-wrap${open ? ' saloon-door-wrap--open' : ''}`} aria-hidden="true">
      {/* Left panel */}
      <svg className="saloon-door saloon-door--left" width="22" height="56" viewBox="0 0 22 56"
           style={{ imageRendering: 'pixelated', transformOrigin: 'left center' }}>
        <rect x="0" y="0" width="22" height="56" fill="#6b3a1f" rx="1" />
        <rect x="2" y="4" width="18" height="20" fill="#7d4b28" rx="1" />
        <rect x="2" y="30" width="18" height="20" fill="#7d4b28" rx="1" />
        <rect x="10" y="0" width="2" height="56" fill="#5a3018" opacity="0.4" />
        {/* Hinge */}
        <rect x="0" y="10" width="3" height="5" fill="#c8a882" />
        <rect x="0" y="40" width="3" height="5" fill="#c8a882" />
      </svg>
      {/* Right panel */}
      <svg className="saloon-door saloon-door--right" width="22" height="56" viewBox="0 0 22 56"
           style={{ imageRendering: 'pixelated', transformOrigin: 'right center' }}>
        <rect x="0" y="0" width="22" height="56" fill="#6b3a1f" rx="1" />
        <rect x="2" y="4" width="18" height="20" fill="#7d4b28" rx="1" />
        <rect x="2" y="30" width="18" height="20" fill="#7d4b28" rx="1" />
        <rect x="10" y="0" width="2" height="56" fill="#5a3018" opacity="0.4" />
        {/* Hinge */}
        <rect x="19" y="10" width="3" height="5" fill="#c8a882" />
        <rect x="19" y="40" width="3" height="5" fill="#c8a882" />
      </svg>
    </div>
  );
}

function SteamParticles({ count = 5 }) {
  return (
    <div className="saloon-steam-wrap" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="steam-particle" style={{ '--i': i }} />
      ))}
    </div>
  );
}

// ── Pixel-art SVG Tumbleweed ──────────────────────────────────────────────────
function PixelTumbleweed() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" style={{ imageRendering: 'pixelated' }}>
      {/* Outer rough circle */}
      <rect x="8"  y="2"  width="20" height="4"  fill="#8d6e63" />
      <rect x="4"  y="6"  width="28" height="4"  fill="#795548" />
      <rect x="2"  y="10" width="32" height="16" fill="#6d4c41" />
      <rect x="4"  y="26" width="28" height="4"  fill="#795548" />
      <rect x="8"  y="30" width="20" height="4"  fill="#8d6e63" />
      {/* Inner cross-hatch */}
      <rect x="16" y="4"  width="4"  height="28" fill="#5d4037" opacity="0.5" />
      <rect x="4"  y="16" width="28" height="4"  fill="#5d4037" opacity="0.5" />
      {/* Highlight */}
      <rect x="8"  y="6"  width="6"  height="6"  fill="rgba(255,255,255,0.12)" />
    </svg>
  );
}

// ── Pixel-art SVG Rattlesnake ─────────────────────────────────────────────────
function PixelRattlesnake({ facingLeft = true }) {
  const flip = facingLeft ? 'scale(-1,1) translate(-100,0)' : '';
  return (
    <svg width="64" height="18" viewBox="0 0 64 18" style={{ imageRendering: 'pixelated' }}>
      <g transform={flip}>
        {/* Body segments */}
        <rect x="0"  y="8"  width="10" height="6" fill="#558b2f" rx="1" />
        <rect x="2"  y="6"  width="9"  height="2" fill="#33691e" />
        <rect x="10" y="7"  width="10" height="6" fill="#689f38" rx="1" />
        <rect x="12" y="5"  width="8"  height="2" fill="#558b2f" />
        <rect x="20" y="8"  width="10" height="6" fill="#558b2f" rx="1" />
        <rect x="22" y="6"  width="8"  height="2" fill="#33691e" />
        <rect x="30" y="7"  width="10" height="6" fill="#689f38" rx="1" />
        {/* Head */}
        <rect x="40" y="4"  width="14" height="10" fill="#558b2f" rx="2" />
        <rect x="50" y="3"  width="8"  height="4"  fill="#33691e" rx="1" />
        {/* Eye */}
        <rect x="50" y="5"  width="3"  height="3"  fill="#1a1a1a" />
        <rect x="51" y="5"  width="1"  height="1"  fill="#fff" />
        {/* Tongue */}
        <rect x="54" y="8"  width="8"  height="1"  fill="#e53935" />
        <rect x="59" y="7"  width="3"  height="1"  fill="#e53935" />
        <rect x="59" y="9"  width="3"  height="1"  fill="#e53935" />
        {/* Rattle */}
        <rect x="0"  y="9"  width="3"  height="4"  fill="#ffb74d" rx="1" />
        <rect x="1"  y="8"  width="4"  height="2"  fill="#ffa726" />
      </g>
    </svg>
  );
}

// ── Saloon Ambient Events Engine ──────────────────────────────────────────────
function SaloonAmbience({ bartenderX, onBartenderSurprise }) {
  const [activeEvent, setActiveEvent] = useState(null); // null | 'tumbleweed' | 'snake'

  useEffect(() => {
    const interval = setInterval(() => {
      if (activeEvent) return;
      const roll = Math.random();
      if (roll < 0.08) setActiveEvent('tumbleweed');
      else if (roll > 0.94) setActiveEvent('snake');
    }, 18000);
    return () => clearInterval(interval);
  }, [activeEvent]);

  const handleComplete = useCallback(() => setActiveEvent(null), []);

  return (
    <div className="saloon-ambience" aria-hidden="true">
      <AnimatePresence>
        {activeEvent === 'tumbleweed' && (
          <motion.div
            key="tumbleweed"
            className="saloon-tumbleweed"
            style={{ bottom: '92px' }}
            initial={{ x: '-60px', y: 0 }}
            animate={{
              x: 'calc(100vw + 60px)',
              y: [0, -18, 0, -10, 0, -5, 0],
            }}
            transition={{
              x: { duration: 5.5, ease: 'linear' },
              y: { duration: 5.5, times: [0, 0.15, 0.32, 0.48, 0.64, 0.80, 1], ease: 'easeInOut' },
            }}
            onAnimationComplete={handleComplete}
          >
            <motion.div
              animate={{ rotate: 720 }}
              transition={{ duration: 5.5, ease: 'linear' }}
            >
              <PixelTumbleweed />
            </motion.div>
          </motion.div>
        )}
        {activeEvent === 'snake' && (
          <SnakeAnim
            onComplete={handleComplete}
            bartenderX={bartenderX}
            onBartenderSurprise={onBartenderSurprise}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function SnakeAnim({ onComplete, bartenderX, onBartenderSurprise }) {
  const surprisedRef = useRef(false);
  const slitherY = Array.from({ length: 28 }, (_, i) => i % 2 === 0 ? '0px' : '3px');

  return (
    <motion.div
      className="saloon-snake"
      style={{ bottom: '92px', right: '-80px' }}
      initial={{ x: 0 }}
      animate={{
        x: 'calc(-100vw - 80px)',
        y: slitherY,
      }}
      transition={{
        x: { duration: 10, ease: 'linear' },
        y: { duration: 10, ease: 'linear' },
      }}
      onUpdate={(latest) => {
        // Surprise bartender when snake passes under them (~center of screen)
        const progressPct = Math.abs(parseFloat(latest.x)) / (window.innerWidth + 80);
        if (!surprisedRef.current && progressPct > 0.4 && progressPct < 0.6) {
          surprisedRef.current = true;
          onBartenderSurprise?.();
        }
      }}
      onAnimationComplete={onComplete}
    >
      <PixelRattlesnake facingLeft={true} />
    </motion.div>
  );
}

// ── Chiptune Visualizer ───────────────────────────────────────────────────────
const VISUALIZER_SEQS = [
  [1, 2.5, 0.8, 1.8, 1.2, 1],
  [1, 1.8, 2.8, 1, 2.2, 1],
  [1, 3, 1.5, 0.6, 2, 1],
  [1, 1.4, 2, 2.6, 1.2, 1],
];
function ChiptuneVisualizer() {
  return (
    <span className="bs-ct-visualizer" aria-hidden="true">
      {VISUALIZER_SEQS.map((seq, i) => (
        <motion.span
          key={i}
          className="bs-ct-bar"
          style={{ display: 'inline-block', height: '3px', transformOrigin: 'bottom center' }}
          animate={{ scaleY: seq }}
          transition={{
            repeat: Infinity,
            duration: 0.45 + i * 0.07,
            ease: 'easeInOut',
            delay: i * 0.09,
            repeatType: 'mirror',
          }}
        />
      ))}
    </span>
  );
}

// ── Floating Piano Notes — Framer Motion sine-wave spawner ───────────────────
const NOTE_SYMBOLS = ['♪', '♫', '♩', '♬'];
function FloatingNotes({ active }) {
  const [notes, setNotes] = useState([]);
  const counter = useRef(0);
  useEffect(() => {
    if (!active) { setNotes([]); return; }
    const tick = () => {
      const id = ++counter.current;
      setNotes(prev => [
        ...prev.slice(-7),
        { id, sym: NOTE_SYMBOLS[id % NOTE_SYMBOLS.length], dx: (Math.random() * 50 - 25) },
      ]);
    };
    tick(); // immediate first note
    const iv = setInterval(tick, 900 + Math.random() * 500);
    return () => clearInterval(iv);
  }, [active]);
  return (
    <div className="bs-float-notes" aria-hidden="true">
      <AnimatePresence>
        {notes.map(n => (
          <motion.span
            key={n.id}
            className="bs-float-note"
            style={{ position: 'absolute', bottom: 0, left: '50%' }}
            initial={{ y: 0, x: n.dx, opacity: 0 }}
            animate={{
              y:       [-8, -55, -100, -145, -185],
              x:       [n.dx, n.dx + 14, n.dx - 14, n.dx + 7, n.dx - 7],
              opacity: [0, 1, 1, 0.7, 0],
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2.6, ease: 'easeOut' }}
            onAnimationComplete={() => setNotes(p => p.filter(x => x.id !== n.id))}
          >
            {n.sym}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ── Pixel Sliding Mug — bar-surface delivery animation ────────────────────────
function PixelSlidingMug({ fromX, toX, onDone }) {
  return (
    <motion.div
      className="bs-sliding-mug"
      style={{ position: 'absolute', bottom: 10, zIndex: 6 }}
      initial={{ x: fromX }}
      animate={{ x: toX }}
      transition={{ type: 'spring', stiffness: 140, damping: 20, mass: 0.9 }}
      onAnimationComplete={onDone}
    >
      <svg width="32" height="30" viewBox="0 0 32 30" style={{ imageRendering: 'pixelated', display: 'block' }}>
        {/* Mug body */}
        <rect x="2" y="10" width="22" height="18" fill="#c8a044" rx="1" />
        <rect x="3" y="11" width="20" height="16" fill="#f0b429" />
        <rect x="3" y="11" width="3" height="16" fill="rgba(255,255,255,0.3)" />
        {/* Handle */}
        <rect x="24" y="12" width="5" height="2" fill="#a07520" />
        <rect x="24" y="22" width="5" height="2" fill="#a07520" />
        <rect x="27" y="12" width="2" height="12" fill="#c8a044" />
        {/* Foam crown */}
        <rect x="2" y="7"  width="22" height="5" fill="white" rx="1" />
        <rect x="5" y="5"  width="5"  height="4" fill="white" rx="1" />
        <rect x="12" y="4" width="5"  height="4" fill="white" rx="1" />
        <rect x="19" y="5" width="4"  height="4" fill="white" rx="1" />
      </svg>
      {/* Foam particle trail */}
      <div className="bs-mug-foam-trail" />
    </motion.div>
  );
}

// ── Saloon stage constants ─────────────────────────────────────────────────────
// Bartender home is mid-bar (slightly left so the centred door peeks out)
const WAYPOINTS = { left: 0.18, center: 0.34, home: 0.46 };

// ── Saloon reducer ─────────────────────────────────────────────────────────────
const initialSaloonState = {
  mode:        'idle',    // 'idle' | 'walking' | 'swigwalk' | 'swigging' | 'swigreturn' | 'grabbing' | 'presenting' | 'returning' | 'polishing' | 'tipping' | 'dozing' | 'shaking'
  doorOpen:    false,
  dogWagging:  false,
  secretPour:  false,
};

function saloonReducer(state, action) {
  switch (action.type) {
    case 'SET_MODE':       return { ...state, mode: action.mode };
    case 'DOOR_OPEN':      return { ...state, doorOpen: true  };
    case 'DOOR_CLOSE':     return { ...state, doorOpen: false };
    case 'DOG_WAG':        return { ...state, dogWagging: true  };
    case 'DOG_STILL':      return { ...state, dogWagging: false };
    case 'SECRET_POUR_ON': return { ...state, secretPour: true  };
    case 'SECRET_POUR_OFF':return { ...state, secretPour: false };
    default:               return state;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function BarShelf({ drinks, onViewDetail, onClose, onImport, onAddToGrocery, onExitToMyBar }) {
  // ── Reducer for discrete mode transitions ──────────────────────────────────
  const [saloon, dispatch] = useReducer(saloonReducer, initialSaloonState);

  // ── Framer Motion bartender position (motion value for drag compatibility) ──
  // Home base is 78% of bar width — initialized to 260 (≈78% × 340px default)
  const xMV = useMotionValue(260);
  const yMV = useMotionValue(0);                 // vertical fling for the ragdoll toss
  const bartenderControls = useAnimation(); // for rotate during toss
  const bartenderDragControls = useDragControls(); // long-press → programmatic drag start
  const dragActiveRef = useRef(false);           // true between drag start and end
  const prefersReducedMotion = useReducedMotion();

  // ── Synced state for quips/lantern positioning (cheaper than transform reads) ─
  const [bartenderX, setBartenderX] = useState(130);

  // ── Bartender home X: mid-bar (46% of width), re-read on every use ─────────
  const homeX = useCallback(
    () => (barTopRef.current?.clientWidth || 340) * 0.46 - 30,
    []
  );

  // ── Derived / legacy state kept for compatibility ───────────────────────────
  const [selectedDrink, setSelectedDrink] = useState(null);
  const [facingRight, setFacingRight] = useState(true);
  const [holdingBottle, setHoldingBottle] = useState(null);
  const [swigBottle, setSwigBottle] = useState(null);
  const [swigQuip, setSwigQuip] = useState(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageDirection, setPageDirection] = useState('none');
  const [idleQuipText, setIdleQuipText] = useState(() => getSmartQuip([]));
  const [spotlightQuip, setSpotlightQuip] = useState(null);
  const [swipeStartY, setSwipeStartY] = useState(null);

  // ── New personality state ──────────────────────────────────────────────────
  const [tapCount, setTapCount] = useState(0);
  const [jokeText, setJokeText] = useState(null);
  const [surpriseResult, setSurpriseResult] = useState(null);
  const [isHappyHour, setIsHappyHour] = useState(() => getTimeContext().isHappyHour);

  // ── Bar inventory (persistent, for quest system) ──────────────────────────
  const [barInventory, setBarInventory] = useState([]);
  
  // ── New persistence + UI state ─────────────────────────────────────────────
  const [chiptuneOn, setChiptuneOn] = useState(false);
  const [drinksMade, setDrinksMade] = useState(0);
  const [tipsCollected, setTipsCollected] = useState(0);

  // ── New personality features ───────────────────────────────────────────────
  const [isPolishingFast, setIsPolishingFast] = useState(false);
  const [secretCocktailActive, setSecretCocktailActive] = useState(false);
  const [secretFlash, setSecretFlash] = useState(false);
  // Bottle flip: 'none' | 'up' | 'catch' | 'crash'
  const [flipState, setFlipState] = useState('none');
  const [flipX, setFlipX] = useState('50%');
  const [tipCoinNonce, setTipCoinNonce] = useState(0);
  const [stoolFilter, setStoolFilter] = useState('all');
  const [showMarqueeModal, setShowMarqueeModal] = useState(false);
  const [marqueeInput, setMarqueeInput] = useState('');
  const [customMarquee, setCustomMarquee] = useState('');

  // ── Arcade Toss Bartender ─────────────────────────────────────────────────
  const [isGrabbed, setIsGrabbed] = useState(false);
  const [isFlying, setIsFlying] = useState(false);
  const [flyScream, setFlyScream] = useState(false);
  const [tossQuip, setTossQuip] = useState(null);
  // Refs that mirror grab/fly state synchronously — prevents stale closures
  // in walkTo's guard (useCallback closures lag one render behind).
  const isGrabbedRef = useRef(false);
  const isFlyingRef  = useRef(false);

  // ── Sliding mug delivery animation ─────────────────────────────────────
  // { key, fromX, toX } — fires when user taps a bottle
  const [slidingMug, setSlidingMug] = useState(null);

  // ── Screen shake ──────────────────────────────────────────────────────────
  const [shakeActive, setShakeActive] = useState(false);
  const [showImpactFlash, setShowImpactFlash] = useState(false);
  const shakeTimerRef = useRef(null);

  // Load persistence on mount
  useEffect(() => {
    getBarInventory().then(setBarInventory);
    const savedCount = localStorage.getItem('bs-drinks-made');
    if (savedCount) setDrinksMade(parseInt(savedCount, 10));
    const savedTips = localStorage.getItem('bs-tips-collected');
    if (savedTips) setTipsCollected(parseInt(savedTips, 10));
    const savedMarquee = localStorage.getItem('bs-custom-marquee');
    if (savedMarquee) {
      setCustomMarquee(savedMarquee);
      setMarqueeInput(savedMarquee);
    }
  }, []);

  // ── Inventory-aware startup quip ─────────────────────────────────────────
  useEffect(() => {
    const startupQuip = getBartenderQuip(drinks, new Date().getHours());
    if (startupQuip) {
      setIdleQuipText(startupQuip);
      const t = setTimeout(() => { setIdleQuipText(getSmartQuip(drinks)); }, 4000);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run only on mount

  // Convenience alias so existing logic doesn't need rewriting
  const bartenderState    = saloon.mode;
  const setBartenderState = (mode) => dispatch({ type: 'SET_MODE', mode });

  // Refs
  const bottleSlotsRef   = useRef({});
  const barTopRef        = useRef(null);
  const animationRef     = useRef(null);
  const timeoutRef       = useRef(null);
  const swigTimerRef     = useRef(null);
  const idleTimerRef     = useRef(null);
  const behaviorTimerRef = useRef(null);
  const wanderTimerRef   = useRef(null);
  const doorTimerRef     = useRef(null);
  const dogTimerRef      = useRef(null);
  const pourTimerRef     = useRef(null);
  const walkToRef        = useRef(null);  // stable ref to walkTo so rAF closures don't go stale
  const tapTimerRef      = useRef(null);
  const tipTimerRef      = useRef(null);
  const spotlightTimerRef= useRef(null);
  const afkTimerRef      = useRef(null);
  const chiptuneStopRef  = useRef(null);

  // ── New personality refs ──────────────────────────────────────────────────
  const secretSeqRef       = useRef([]);    // tracks ['top', 'bottom'] sequence
  const secretTimerRef     = useRef(null);  // 8s window reset
  const rapidClickCountRef = useRef(0);
  const rapidClickTimerRef = useRef(null);
  const polishFastTimerRef = useRef(null);
  const flipTimerRef       = useRef(null);
  const prevDrinkCountRef  = useRef(null);  // detects new bottle additions

  // ── Arcade Toss refs ──────────────────────────────────────────────────────
  const longPressTimerRef  = useRef(null);
  const constraintsRef     = useRef(null); // saloon-stage bounding box
  const wasDraggedRef      = useRef(false); // suppress click after drag

  // ── Sync xMV → bartenderX state (for quips/lantern positioning) ────────────
  useEffect(() => xMV.on('change', v => setBartenderX(v)), [xMV]);

  // ── Happy Hour check (every 60 s) ──────────────────────────────────────────
  useEffect(() => {
    const check = () => setIsHappyHour(getTimeContext().isHappyHour);
    const id = setInterval(check, 60000);
    return () => clearInterval(id);
  }, []);

  // ── P4: pause ambient loops when the tab is hidden (battery / jank) ─────────
  const [sceneHidden, setSceneHidden] = useState(false);
  useEffect(() => {
    const onVis = () => setSceneHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Ambient motion runs only when the user hasn't asked for reduced motion AND
  // the scene is actually on screen. Gates the wander / door / dog / pour loops.
  const ambientOK = !prefersReducedMotion && !sceneHidden;

  // ── P3: one-time hint strip teaching the saloon's hidden interactions ──────
  const [showTips, setShowTips] = useState(() => {
    try { return !localStorage.getItem('bs-tips-seen'); } catch { return false; }
  });
  const dismissTips = useCallback(() => {
    setShowTips(false);
    try { localStorage.setItem('bs-tips-seen', '1'); } catch { /* private mode */ }
  }, []);

  // ── Screen shake helper ───────────────────────────────────────────────────
  const triggerCabinetShake = useCallback(() => {
    setShowImpactFlash(true);
    setShakeActive(true);
    clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(() => {
      setShakeActive(false);
      setShowImpactFlash(false);
    }, 380);
    if (navigator.vibrate) navigator.vibrate([40, 20, 40, 10, 40]);
  }, []);

  // ── Arcade Toss: long-press detection ────────────────────────────────────
  const handleBartenderPointerDown = useCallback((e) => {
    e.stopPropagation();
    if (selectedDrink || isFlyingRef.current) return;
    // Persist the native pointer event so we can hand it to dragControls when
    // the long-press fires — React synthetic events are safe to hold in React 17+.
    const nativeEvt = e.nativeEvent || e;
    longPressTimerRef.current = setTimeout(() => {
      isGrabbedRef.current = true; setIsGrabbed(true);
      cancelAnimationFrame(animationRef.current); // freeze any walk
      setBartenderState('surprised');
      if (navigator.vibrate) navigator.vibrate([30, 10, 30]);
      // Begin dragging from the still-held pointer. Without this, framer-motion
      // never attaches the drag (drag was disabled at pointerdown), so the
      // bartender could be "grabbed" but never thrown. dragControls.start()
      // captures the in-progress pointer so a flick produces real velocity.
      try { bartenderDragControls.start(nativeEvt); } catch { /* pointer already released */ }
    }, 480);
  }, [selectedDrink, bartenderDragControls]);

  const handleBartenderPointerUp = useCallback(() => {
    clearTimeout(longPressTimerRef.current);
    if (!isGrabbedRef.current) return;
    // If a drag session is live, let onDragEnd own the release (it reads the
    // fling velocity). Only handle the release here as a fallback for the rare
    // case where the drag never attached.
    if (dragActiveRef.current) return;
    isGrabbedRef.current = false; setIsGrabbed(false);
    setBartenderState('walking');
    setFacingRight(false);
    walkToRef.current?.(homeX(), () => { setBartenderState('idle'); setFacingRight(true); });
  }, []);

  const handleBartenderPointerLeave = useCallback(() => {
    clearTimeout(longPressTimerRef.current);
  }, []);

  // ── Arcade Toss: drag end physics ────────────────────────────────────────
  const TOSS_QUIPS = [
    "That... was undignified.",
    "*dusts off vest* Happens more than you'd think.",
    "Did anyone see that?",
    "Occupational hazard, partner.",
    "My mustache survived. That's all that matters.",
    "I've been thrown outta worse saloons.",
    "I'm fine. The hat took most of it.",
  ];

  const handleBartenderDragEnd = useCallback(async (event, info) => {
    clearTimeout(longPressTimerRef.current);
    dragActiveRef.current = false;
    const speed = Math.sqrt(info.velocity.x ** 2 + info.velocity.y ** 2);

    if (speed > 180 && isGrabbedRef.current) {
      // Sync refs FIRST (before any await) so walkTo guard sees updated values
      isGrabbedRef.current = false; setIsGrabbed(false);
      isFlyingRef.current  = true;  setIsFlying(true);
      setFlyScream(true);
      setBartenderState('surprised');
      wasDraggedRef.current = true;

      const spinDir = info.velocity.x >= 0 ? 1 : -1;
      const spins   = Math.min(Math.max(Math.round(speed / 200), 1), 4);

      // ── Ballistic ragdoll launch ──────────────────────────────────────────
      // Fling him along the throw vector (not just spin in place): translate
      // xMV/yMV to a landing spot inside the stage while the inner div tumbles.
      const stageW   = constraintsRef.current?.clientWidth || barTopRef.current?.clientWidth || 360;
      const startX   = xMV.get();
      // Throw distance scales with speed; clamp so he always lands on-screen.
      const dist     = Math.min(Math.max(speed * 0.28, 90), stageW * 0.75);
      const landX    = Math.max(6, Math.min(stageW - 60, startX + spinDir * dist));
      // Arc height also scales with throw strength.
      const lift     = -Math.min(60 + speed * 0.12, 170);

      if (prefersReducedMotion) {
        // Reduced motion: no spin/arc — just settle him at the landing spot.
        await animate(xMV, landX, { duration: 0.28, ease: 'easeOut' }).finished;
      } else {
        await Promise.all([
          animate(xMV, landX, { duration: 0.62, ease: [0.16, 1, 0.3, 1] }).finished,
          animate(yMV, [0, lift, 0], { duration: 0.62, times: [0, 0.42, 1], ease: ['easeOut', 'easeIn'] }).finished,
          bartenderControls.start({
            rotate: 360 * spins * spinDir,
            transition: { duration: 0.62, ease: [0.16, 1, 0.3, 1] },
          }),
        ]);
        // Small bounce settle on landing
        triggerCabinetShake();
        await new Promise(r => setTimeout(r, 160));
      }

      setFlyScream(false);
      yMV.set(0);

      // Reset rotation (spring settle; instant under reduced motion)
      await bartenderControls.start({
        rotate: 0,
        transition: prefersReducedMotion
          ? { duration: 0 }
          : { type: 'spring', stiffness: 180, damping: 18 },
      });

      // Clear flying ref BEFORE walk call so walkTo guard allows passage
      isFlyingRef.current = false; setIsFlying(false);
      setBartenderState('walking');
      setFacingRight(false);

      // Walk of shame back to home
      walkToRef.current?.(homeX(), () => {
        setBartenderState('idle');
        setFacingRight(true);
        const quip = TOSS_QUIPS[Math.floor(Math.random() * TOSS_QUIPS.length)];
        setTossQuip(quip);
        setIdleQuipText(quip);
        setTimeout(() => setTossQuip(null), 4000);
      });
    } else {
      // Soft drop — no real throw
      isGrabbedRef.current = false; setIsGrabbed(false);
      isFlyingRef.current  = false; setIsFlying(false);
      setFlyScream(false);
      yMV.set(0);
      setBartenderState('walking');
      walkToRef.current?.(homeX(), () => { setBartenderState('idle'); setFacingRight(true); });
    }
  }, [bartenderControls, prefersReducedMotion, xMV, yMV, triggerCabinetShake]);

  // ── Tap bartender 5× for joke — also completes Secret Pour sequence ──────
  const handleBartenderTap = useCallback(() => {
    // ── Secret Pour Combination: top-shelf → bottom-shelf → bartender tap ──
    if (
      secretSeqRef.current.length === 2 &&
      secretSeqRef.current[0] === 'top' &&
      secretSeqRef.current[1] === 'bottom'
    ) {
      clearTimeout(secretTimerRef.current);
      secretSeqRef.current = [];
      setSecretCocktailActive(true);
      setSecretFlash(true);
      setIdleQuipText("★ THE PROHIBITION SPECIAL ★");
      setBartenderState('presenting');
      if (navigator.vibrate) navigator.vibrate([30, 15, 30, 15, 60]);
      setTimeout(() => setSecretFlash(false), 1500);
      setTimeout(() => {
        setSecretCocktailActive(false);
        setBartenderState('idle');
      }, 4500);
      return;
    }

    // ── Regular tap: 5× joke easter egg ──────────────────────────────────
    setTapCount(prev => {
      const next = prev + 1;
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = setTimeout(() => setTapCount(0), 3000);
      if (next >= 5) {
        const joke = sample(BAD_JOKES);
        setJokeText(joke);
        setBartenderState('surprised');
        setTimeout(() => { setJokeText(null); setBartenderState('idle'); }, 4000);
        return 0;
      }
      return next;
    });
    if (navigator.vibrate) navigator.vibrate(15);
  }, []);

  // ── Interactive tip jar ─────────────────────────────────────────────────
  const handleTipJar = useCallback((e) => {
    e.stopPropagation();
    if (selectedDrink || !['idle', 'dozing', 'tipping'].includes(bartenderState)) return;
    const wisdom = sample(TIP_JAR_WISDOM);
    setTipsCollected(prev => {
      const next = prev + 1;
      localStorage.setItem('bs-tips-collected', String(next));
      return next;
    });
    setTipCoinNonce(prev => prev + 1);
    setSpotlightQuip(wisdom);
    setIdleQuipText(wisdom);
    setBartenderState('tipping');
    if (navigator.vibrate) navigator.vibrate([15, 20, 15]);
    clearTimeout(tipTimerRef.current);
    clearTimeout(spotlightTimerRef.current);
    tipTimerRef.current = setTimeout(() => setBartenderState('idle'), 3600);
    spotlightTimerRef.current = setTimeout(() => setSpotlightQuip(null), 5200);
  }, [bartenderState, selectedDrink]);

  // ── "Surprise Me" handler ─────────────────────────────────────────────────
  const handleSurpriseMe = useCallback(() => {
    if (bartenderState !== 'idle' && bartenderState !== 'presenting') return;
    setIdleQuipText(sample(CONTEXTUAL_QUIPS.surprise));
    triggerCabinetShake();

    // Pick from user's own drinks first, else from classics
    const pick = drinks.length > 0
      ? drinks[Math.floor(Math.random() * drinks.length)]
      : null;
    const classic = SURPRISE_CLASSICS[Math.floor(Math.random() * SURPRISE_CLASSICS.length)];

    setBartenderState('shaking');
    if (navigator.vibrate) navigator.vibrate([50, 30, 50, 30, 50]); // cocktail shaker vibration

    setTimeout(() => {
      if (pick) {
        setSurpriseResult({ name: pick.name, isDrink: true, drink: pick });
      } else {
        setSurpriseResult({ name: classic.name, isDrink: false });
      }
      setBartenderState('presenting');
      setTimeout(() => {
        if (!selectedDrink) setBartenderState('idle');
        setSurpriseResult(null);
      }, 4000);
    }, 1200);
  }, [bartenderState, drinks, selectedDrink]);

  // ── Chiptune toggle ───────────────────────────────────────────────────
  const handleChiptuneToggle = useCallback(() => {
    setChiptuneOn(prev => {
      if (prev) {
        chiptuneStopRef.current?.();
        chiptuneStopRef.current = null;
      } else {
        chiptuneStopRef.current = startChiptune();
      }
      setIdleQuipText(sample(prev ? CONTEXTUAL_QUIPS.tuneOff : CONTEXTUAL_QUIPS.tuneOn));
      return !prev;
    });
  }, []);

  // Stop chiptune on unmount
  useEffect(() => () => chiptuneStopRef.current?.(), []);

  // ── Fill the Shelf ──────────────────────────────────────────────────
  const handleFillShelf = useCallback(() => {
    const freq = {};
    for (const drink of drinks) {
      const { missing } = matchIngredients(drink.ingredients, barInventory);
      for (const ing of missing) {
        const k = ing.toLowerCase();
        freq[k] = (freq[k] || 0) + 1;
      }
    }
    const top3 = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => ({ name, tag: 'bar-quest', questName: 'Fill the Shelf' }));
    if (top3.length && onAddToGrocery) {
      onAddToGrocery(top3);
      triggerCabinetShake();
      if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
    }
  }, [drinks, barInventory, onAddToGrocery, triggerCabinetShake]);

  // ── Made It! (Tipsy mode counter) ─────────────────────────────────────
  const handleMadeIt = useCallback(() => {
    setDrinksMade(prev => {
      const next = prev + 1;
      localStorage.setItem('bs-drinks-made', String(next));
      return next;
    });
    setIdleQuipText("Hat's off. That pour had style.");
    setBartenderState('tipping');
    if (navigator.vibrate) navigator.vibrate([40, 20, 40]);
    setTimeout(() => setBartenderState('idle'), 900);
  }, []);

  // ── Today's Special: drink with highest ingredient match in current inventory
  const specialDrink = useMemo(() => {
    if (drinks.length === 0 || barInventory.length === 0) return null;
    const inv = barInventory.map(i => (typeof i === 'string' ? i : (i.name || '')).toLowerCase());
    let best = null;
    let bestScore = -1;
    for (const d of drinks) {
      const { score } = matchIngredients(d.ingredients || [], inv);
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }, [drinks, barInventory]);

  // ── Bounties: top 2 most-wanted missing ingredients across all drinks
  const bounties = useMemo(() => {
    if (drinks.length === 0) return [];
    const inv = barInventory.map(i => (typeof i === 'string' ? i : (i.name || '')).toLowerCase());
    const freq = {};
    const drinkName = {};
    for (const d of drinks) {
      const { missing } = matchIngredients(d.ingredients || [], inv);
      for (const ing of missing) {
        const k = ing.toLowerCase();
        freq[k] = (freq[k] || 0) + 1;
        if (!drinkName[k]) drinkName[k] = d.name;
      }
    }
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([ingredient, count]) => ({ ingredient, drinkName: drinkName[ingredient], count }));
  }, [drinks, barInventory]);

  // ── Chalkboard click: bartender walks left to comment on Today's Special ──
  const handleChalkClick = useCallback(() => {
    if (bartenderState !== 'idle') return;
    const barWidth = barTopRef.current?.clientWidth || 320;
    const targetX = barWidth * 0.18 - 30;
    setBartenderState('walking');
    walkToRef.current?.(targetX, () => {
      setBartenderState('idle');
      setIdleQuipText(
        specialDrink
          ? `Today I recommend the ${specialDrink.name}! Classic choice, partner.`
          : "Stock up those shelves and I'll write something special!"
      );
    });
    if (navigator.vibrate) navigator.vibrate(15);
  }, [bartenderState, specialDrink]);

  // ── Bounty board click: bartender walks right to comment on wanted ingredient
  const handleBountyClick = useCallback((bounty) => {
    if (bartenderState !== 'idle') return;
    const barWidth = barTopRef.current?.clientWidth || 320;
    const targetX = barWidth * 0.68 - 30;
    setBartenderState('walking');
    walkToRef.current?.(targetX, () => {
      setBartenderState('idle');
      setIdleQuipText(
        bounty
          ? `You'll need ${bounty.ingredient} to unlock the ${bounty.drinkName}!`
          : "Wanted: more bottles on these shelves, partner!"
      );
    });
    if (navigator.vibrate) navigator.vibrate(15);
  }, [bartenderState]);

  // Cleanup — all timers cleared on unmount
  useEffect(() => () => {
    clearTimeout(behaviorTimerRef.current);
    clearTimeout(timeoutRef.current);
    cancelAnimationFrame(animationRef.current);
    clearTimeout(swigTimerRef.current);
    clearInterval(idleTimerRef.current);
    clearTimeout(wanderTimerRef.current);
    clearTimeout(doorTimerRef.current);
    clearTimeout(dogTimerRef.current);
    clearTimeout(pourTimerRef.current);
    clearTimeout(tapTimerRef.current);
    clearTimeout(tipTimerRef.current);
    clearTimeout(spotlightTimerRef.current);
    clearTimeout(afkTimerRef.current);
    clearTimeout(secretTimerRef.current);
    clearTimeout(rapidClickTimerRef.current);
    clearTimeout(polishFastTimerRef.current);
    clearTimeout(flipTimerRef.current);
  }, []);

  // ── Generic walk helper (stable ref prevents stale closure in rAF loops) ────
  const walkTo = useCallback((targetX, onArrive) => {
    // Guard uses refs (not state) so it reads the *current* grab/fly value
    // even inside stale useCallback closures — avoids walk-of-shame never firing.
    if (isGrabbedRef.current || isFlyingRef.current) return;
    cancelAnimationFrame(animationRef.current);
    const startX    = xMV.get(); // read from motion value, not state
    const walkTime  = Math.min(800, Math.max(200, Math.abs(targetX - startX) * 3));
    const walkStart = performance.now();
    setFacingRight(targetX > startX);
    const step = (now) => {
      const p = Math.min(1, (now - walkStart) / walkTime);
      const e = 1 - Math.pow(1 - p, 3);
      xMV.set(startX + (targetX - startX) * e); // drives xMV directly
      if (p < 1) {
        animationRef.current = requestAnimationFrame(step);
      } else {
        xMV.set(targetX);
        onArrive?.();
      }
    };
    animationRef.current = requestAnimationFrame(step);
  }, [xMV]); // refs are stable — no isGrabbed/isFlying in deps needed
  useEffect(() => { walkToRef.current = walkTo; }, [walkTo]);

  // ── Bartender wander (12–25 s idle → picks new waypoint) ───────────────────
  useEffect(() => {
    if (!ambientOK || bartenderState !== 'idle' || selectedDrink) {
      clearTimeout(wanderTimerRef.current);
      return;
    }
    const delay = 12000 + Math.random() * 13000;
    wanderTimerRef.current = setTimeout(() => {
      const barWidth = barTopRef.current?.clientWidth || 320;
      // Wander left/center — bartender home is 'home' (right side)
      const wanderKeys = ['left', 'center', 'home'];
      const key      = wanderKeys[Math.floor(Math.random() * wanderKeys.length)];
      const targetX  = WAYPOINTS[key] * barWidth - 30;
      setBartenderState('walking');
      walkToRef.current?.(targetX, () => setBartenderState('idle'));
    }, delay);
    return () => clearTimeout(wanderTimerRef.current);
  }, [ambientOK, bartenderState, selectedDrink]);

  // ── Saloon door (20–60 s — opens, holds 1.5 s, swings back) ────────────────
  useEffect(() => {
    if (!ambientOK) { clearTimeout(doorTimerRef.current); return; }
    const schedule = () => {
      doorTimerRef.current = setTimeout(() => {
        dispatch({ type: 'DOOR_OPEN' });
        doorTimerRef.current = setTimeout(() => {
          dispatch({ type: 'DOOR_CLOSE' });
          schedule();
        }, 1500);
      }, 20000 + Math.random() * 40000);
    };
    schedule();
    return () => clearTimeout(doorTimerRef.current);
  }, [ambientOK]);

  // ── Pixel dog tail wag (15–45 s intervals) ──────────────────────────────────
  useEffect(() => {
    if (!ambientOK) { clearTimeout(dogTimerRef.current); return; }
    const schedule = () => {
      dogTimerRef.current = setTimeout(() => {
        dispatch({ type: 'DOG_WAG' });
        dogTimerRef.current = setTimeout(() => {
          dispatch({ type: 'DOG_STILL' });
          schedule();
        }, 1200);
      }, 15000 + Math.random() * 30000);
    };
    schedule();
    return () => clearTimeout(dogTimerRef.current);
  }, [ambientOK]);

  // ── Secret pour (1 % chance per 60–120 s window, only when idle) ────────────
  useEffect(() => {
    if (!ambientOK || bartenderState !== 'idle' || selectedDrink) return;
    const delay = 60000 + Math.random() * 60000;
    pourTimerRef.current = setTimeout(() => {
      if (Math.random() < 0.01) {
        dispatch({ type: 'SECRET_POUR_ON' });
        setTimeout(() => dispatch({ type: 'SECRET_POUR_OFF' }), 2000);
      }
    }, delay);
    return () => clearTimeout(pourTimerRef.current);
  }, [ambientOK, bartenderState, selectedDrink]);

  // ── Filtering logic (Stool Navigation) ────────────────────────────────────
  // For cocktail/mocktail: show ALL bottles but dim non-matching ones (thematic bar look).
  // For 'recent': still filter (time-based — not a visual preference).
  const filteredDrinks = useMemo(() => {
    if (stoolFilter === 'recent') {
      return [...drinks].sort((a, b) => (b.id || 0) - (a.id || 0)).slice(0, 12);
    }
    return drinks; // all — dimming is handled per-bottle in render
  }, [drinks, stoolFilter]);

  // Per-bottle dim predicate
  const isDimmed = useCallback((drink) => {
    if (stoolFilter === 'all' || stoolFilter === 'recent') return false;
    const cat = (drink.category || '').toLowerCase();
    if (stoolFilter === 'cocktail') return !cat.includes('cocktail');
    if (stoolFilter === 'mocktail') return !cat.includes('mocktail');
    return false;
  }, [stoolFilter]);

  // ── Pagination ──────────────────────────────────────────────────────────────
  const totalPages        = Math.max(1, Math.ceil(filteredDrinks.length / BOTTLES_PER_PAGE));
  const currentPageDrinks = useMemo(() => {
    const start = currentPage * BOTTLES_PER_PAGE;
    return filteredDrinks.slice(start, start + BOTTLES_PER_PAGE);
  }, [filteredDrinks, currentPage]);

  const shelves = useMemo(() => {
    const rows = [];
    for (let i = 0; i < currentPageDrinks.length; i += BOTTLES_PER_SHELF) {
      rows.push(currentPageDrinks.slice(i, i + BOTTLES_PER_SHELF));
    }
    while (rows.length < SHELVES_PER_PAGE) rows.push([]);
    return rows;
  }, [currentPageDrinks]);

  // ── Get bottle DOM x-position ──────────────────────────────────────────────
  const getBottlePosition = useCallback((drinkId) => {
    const slotEl = bottleSlotsRef.current[drinkId];
    const areaEl = barTopRef.current;
    if (!slotEl || !areaEl) return 20;
    const slotRect = slotEl.getBoundingClientRect();
    const areaRect = areaEl.getBoundingClientRect();
    return slotRect.left - areaRect.left + slotRect.width / 2 - 60;
  }, []);

  // ── Dismiss detail card (returns bartender home) ───────────────────────────
  const dismissDrink = useCallback(() => {
    if (!selectedDrink || bartenderState !== 'presenting') return;

    const drink     = selectedDrink;
    const returnPos = getBottlePosition(drink.id);
    const startX    = xMV.get();

    setSelectedDrink(null);
    setFacingRight(returnPos > startX);
    setBartenderState('returning');

    const returnStart = performance.now();
    const returnTime  = Math.min(700, Math.max(300, Math.abs(returnPos - startX) * 3));

    const animateReturn = (now) => {
      const progress = Math.min(1, (now - returnStart) / returnTime);
      const eased    = 1 - Math.pow(1 - progress, 3);
      xMV.set(startX + (returnPos - startX) * eased);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animateReturn);
      } else {
        setHoldingBottle(null);
        setBartenderState('walking');
        const restPos = homeX();
        setFacingRight(restPos < returnPos);

        const idleStart = performance.now();
        const idleTime  = Math.min(600, Math.max(200, Math.abs(restPos - returnPos) * 3));

        const animateIdle = (iNow) => {
          const ip = Math.min(1, (iNow - idleStart) / idleTime);
          const ie = 1 - Math.pow(1 - ip, 3);
          xMV.set(returnPos + (restPos - returnPos) * ie);
          if (ip < 1) {
            animationRef.current = requestAnimationFrame(animateIdle);
          } else {
            setBartenderState('idle');
            setFacingRight(true);
          }
        };
        animationRef.current = requestAnimationFrame(animateIdle);
      }
    };
    animationRef.current = requestAnimationFrame(animateReturn);
  }, [xMV, selectedDrink, bartenderState, getBottlePosition]);

  // ── Android back button — detail card first, then whole shelf ─────────────
  // This is LIFO with App.jsx's bar-shelf handler; pressing back dismisses
  // the detail card before it closes the entire shelf.
  useBackHandler(
    selectedDrink !== null && bartenderState === 'presenting',
    dismissDrink,
    'bar-shelf-detail'
  );

  // ── Idle quip cycling (smart dialogue) ──────────────────────────────────────
  useEffect(() => {
    if (bartenderState !== 'idle') return;
    setIdleQuipText(getSmartQuip(drinks));
    idleTimerRef.current = setInterval(
      () => setIdleQuipText(getSmartQuip(drinks)),
      6000
    );
    return () => clearInterval(idleTimerRef.current);
  }, [bartenderState, drinks]);

  // ── Idle swig sequence ──────────────────────────────────────────────────────
  // After 8–15 s of inactivity the bartender sneaks a swig from a random bottle
  const runSwigSequence = useCallback(() => {
    if (isGrabbed || isFlying) return;
    const barWidth  = barTopRef.current?.clientWidth || 320;
    // Target somewhere in the middle 60 % of the bar
    const targetPos = barWidth * (0.15 + Math.random() * 0.55) - 60;
    const style     = BOTTLE_STYLES[Math.floor(Math.random() * BOTTLE_STYLES.length)];
    const quip      = SWIG_QUIPS[Math.floor(Math.random() * SWIG_QUIPS.length)];
    const startX    = xMV.get();

    setSwigBottle(style);
    setFacingRight(targetPos > startX);
    setBartenderState('swigwalk');

    const walkTime  = Math.min(700, Math.max(300, Math.abs(targetPos - startX) * 3));
    const walkStart = performance.now();

    const animSwigWalk = (now) => {
      const p = Math.min(1, (now - walkStart) / walkTime);
      const e = 1 - Math.pow(1 - p, 3);
      xMV.set(startX + (targetPos - startX) * e);

      if (p < 1) {
        animationRef.current = requestAnimationFrame(animSwigWalk);
      } else {
        xMV.set(targetPos);
        setBartenderState('swigging');
        setSwigQuip(quip);

        timeoutRef.current = setTimeout(() => {
          setSwigQuip(null);
          const restPos  = homeX();
          const retStart = performance.now();
          const retTime  = Math.min(700, Math.max(300, Math.abs(restPos - targetPos) * 3));
          setBartenderState('swigreturn');
          setFacingRight(restPos > targetPos); // face right back to home at 80%

          const animSwigReturn = (rNow) => {
            const rp = Math.min(1, (rNow - retStart) / retTime);
            const re = 1 - Math.pow(1 - rp, 3);
            xMV.set(targetPos + (restPos - targetPos) * re);

            if (rp < 1) {
              animationRef.current = requestAnimationFrame(animSwigReturn);
            } else {
              xMV.set(restPos);
              setFacingRight(true);
              setSwigBottle(null);

              // 40% chance of polishing before returning to idle
              if (Math.random() < 0.4) {
                setBartenderState('polishing');
                timeoutRef.current = setTimeout(() => {
                  setBartenderState('idle');
                }, 1200);
              } else {
                setBartenderState('idle');
              }
            }
          };
          animationRef.current = requestAnimationFrame(animSwigReturn);
        }, 1900); // swig duration (long enough to look natural)
      }
    };
    animationRef.current = requestAnimationFrame(animSwigWalk);
  }, [xMV, isGrabbed, isFlying]);

  // Keep a stable ref to the latest swig sequence function so the timer isn't recreated on every X change
  const runSwigRef = useRef(runSwigSequence);
  useEffect(() => { runSwigRef.current = runSwigSequence; }, [runSwigSequence]);

  useEffect(() => {
    if (bartenderState !== 'idle' || selectedDrink) {
      clearTimeout(swigTimerRef.current);
      return;
    }
    const delay = 8000 + Math.random() * 7000; // 8–15 s
    swigTimerRef.current = setTimeout(() => runSwigRef.current?.(), delay);
    return () => clearTimeout(swigTimerRef.current);
  }, [bartenderState, selectedDrink]);

  // ── Idle behavior cycling (tipping, dozing, etc.) ──────────────────────────
  useEffect(() => {
    if (bartenderState !== 'idle' || selectedDrink) {
      clearTimeout(behaviorTimerRef.current);
      return;
    }
    // Every 30-45s, randomly trigger tipping or dozing
    const delay = 30000 + Math.random() * 15000; // 30–45 s
    behaviorTimerRef.current = setTimeout(() => {
      const behaviors = ['tipping', 'dozing'];
      const behavior = behaviors[Math.floor(Math.random() * behaviors.length)];
      setBartenderState(behavior);

      // Return to idle after behavior duration
      const behaviorDuration = behavior === 'tipping' ? 1500 : 2000;
      timeoutRef.current = setTimeout(() => {
        setBartenderState('idle');
      }, behaviorDuration);
    }, delay);
    return () => clearTimeout(behaviorTimerRef.current);
  }, [bartenderState, selectedDrink]);

  // ── AFK doze / wake cycle ───────────────────────────────────────────────
  useEffect(() => {
    const wakeOnActivity = () => {
      clearTimeout(afkTimerRef.current);
      if (bartenderState === 'dozing') {
        setIdleQuipText(sample(CONTEXTUAL_QUIPS.wake));
        setBartenderState('surprised');
        timeoutRef.current = setTimeout(() => setBartenderState('idle'), 900);
      }
    };
    window.addEventListener('pointermove', wakeOnActivity, { passive: true });
    window.addEventListener('pointerdown', wakeOnActivity, { passive: true });
    window.addEventListener('keydown', wakeOnActivity);
    window.addEventListener('touchstart', wakeOnActivity, { passive: true });
    return () => {
      window.removeEventListener('pointermove', wakeOnActivity);
      window.removeEventListener('pointerdown', wakeOnActivity);
      window.removeEventListener('keydown', wakeOnActivity);
      window.removeEventListener('touchstart', wakeOnActivity);
    };
  }, [bartenderState]);

  useEffect(() => {
    clearTimeout(afkTimerRef.current);
    if (bartenderState !== 'idle' || selectedDrink) return;
    afkTimerRef.current = setTimeout(() => {
      setIdleQuipText("Resting my eyes behind the bar...");
      setBartenderState('dozing');
    }, 120000);
    return () => clearTimeout(afkTimerRef.current);
  }, [bartenderState, selectedDrink]);

  // ── Bottle flip easter egg (1% chance when a new drink is added) ──────────
  useEffect(() => {
    if (prevDrinkCountRef.current === null) {
      prevDrinkCountRef.current = drinks.length;
      return;
    }
    if (drinks.length > prevDrinkCountRef.current) {
      prevDrinkCountRef.current = drinks.length;
      if (Math.random() < 0.01) {
        const isCatch = Math.random() < 0.8;
        // Pick a random X position for the flip (roughly middle of bar area)
        const barWidth = barTopRef.current?.clientWidth || 320;
        const xPx = barWidth * (0.3 + Math.random() * 0.4);
        setFlipX(`${xPx}px`);
        setFlipState('up');
        setBartenderState('shaking');

        flipTimerRef.current = setTimeout(() => {
          setFlipState(isCatch ? 'catch' : 'crash');
          if (!isCatch) {
            // Minimal Web Audio crash burst
            try {
              const ctx = new (window.AudioContext || window.webkitAudioContext)();
              const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.35), ctx.sampleRate);
              const d = buf.getChannelData(0);
              for (let i = 0; i < d.length; i++) {
                d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.06));
              }
              const src = ctx.createBufferSource();
              src.buffer = buf;
              const filt = ctx.createBiquadFilter();
              filt.type = 'highpass';
              filt.frequency.value = 900;
              src.connect(filt);
              filt.connect(ctx.destination);
              src.start();
              src.onended = () => ctx.close();
            } catch {}
            setIdleQuipText("Oops... didn't see that coming.");
          } else {
            setIdleQuipText("Caught it! Like I meant to do that.");
          }
          flipTimerRef.current = setTimeout(() => {
            setFlipState('none');
            setBartenderState('idle');
          }, 2000);
        }, 850);
      }
    } else {
      prevDrinkCountRef.current = drinks.length;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drinks.length]);

  // ── Rapid activity tracking — used by container onClick ───────────────────
  const trackRapidClick = useCallback(() => {
    rapidClickCountRef.current += 1;
    clearTimeout(rapidClickTimerRef.current);
    rapidClickTimerRef.current = setTimeout(() => {
      if (rapidClickCountRef.current >= 3) {
        setIsPolishingFast(true);
        clearTimeout(polishFastTimerRef.current);
        polishFastTimerRef.current = setTimeout(() => setIsPolishingFast(false), 3000);
      }
      rapidClickCountRef.current = 0;
    }, 1400);
  }, []);

  // ── Page navigation ────────────────────────────────────────────────────────
  const goToPage = useCallback((newPage) => {
    if (newPage < 0 || newPage >= totalPages || newPage === currentPage) return;
    if (bartenderState !== 'idle') return;
    setPageDirection(newPage > currentPage ? 'right' : 'left');
    // Trigger shaking state briefly on page change
    setBartenderState('shaking');
    timeoutRef.current = setTimeout(() => {
      setCurrentPage(newPage);
      setPageDirection('none');
      setBartenderState('idle');
    }, 1000);
  }, [totalPages, currentPage, bartenderState]);

  // ── Bottle tap ─────────────────────────────────────────────────────────────
  const handleBottleTap = useCallback((drink, shelfIdx) => {
    if (isGrabbed || isFlying) return;
    if (bartenderState !== 'idle' && bartenderState !== 'presenting') return;

    // ── Secret sequence tracking (top-shelf → bottom-shelf → bartender) ──
    if (shelfIdx === 0) {
      secretSeqRef.current = ['top'];
      clearTimeout(secretTimerRef.current);
      secretTimerRef.current = setTimeout(() => { secretSeqRef.current = []; }, 8000);
    } else if (shelfIdx === 2 && secretSeqRef.current[0] === 'top') {
      secretSeqRef.current = ['top', 'bottom'];
      clearTimeout(secretTimerRef.current);
      secretTimerRef.current = setTimeout(() => { secretSeqRef.current = []; }, 8000);
    } else {
      secretSeqRef.current = [];
    }

    clearTimeout(swigTimerRef.current);

    if (selectedDrink?.id === drink.id) { dismissDrink(); return; }

    if (bartenderState === 'presenting' && selectedDrink) {
      setSelectedDrink(null);
      setBartenderState('idle');
    }

    const targetPos   = getBottlePosition(drink.id);
    const bottleStyle = getBottleStyle(drink);
    const rarity      = getDrinkRarity(drink);
    if (rarity !== 'common') setIdleQuipText(sample(CONTEXTUAL_QUIPS.topShelf));

    const startX = xMV.get();
    setFacingRight(targetPos > startX);
    setBartenderState('walking');

    const walkTime  = Math.min(800, Math.max(300, Math.abs(targetPos - startX) * 3));
    const walkStart = performance.now();

    const animateWalk = (now) => {
      const p = Math.min(1, (now - walkStart) / walkTime);
      const e = 1 - Math.pow(1 - p, 3);
      xMV.set(startX + (targetPos - startX) * e);

      if (p < 1) {
        animationRef.current = requestAnimationFrame(animateWalk);
      } else {
        setBartenderState('grabbing');
        setHoldingBottle(bottleStyle);

        timeoutRef.current = setTimeout(() => {
          setBartenderState('presenting');
          setSelectedDrink(drink);

          // ── Slide the mug across the bar surface toward the customer ──
          const barWidth = barTopRef.current?.clientWidth || 340;
          setSlidingMug({
            key: Date.now(),
            fromX: homeX(),
            toX: barWidth * 0.12,
          });

          const centerX    = (barTopRef.current?.clientWidth ?? 200) / 2 - 60;
          const grabX      = targetPos;
          const presStart  = performance.now();
          const presTime   = 400;
          setFacingRight(true);

          const animatePresent = (pNow) => {
            const pp = Math.min(1, (pNow - presStart) / presTime);
            const pe = 1 - Math.pow(1 - pp, 3);
            xMV.set(grabX + (centerX - grabX) * pe);
            if (pp < 1) animationRef.current = requestAnimationFrame(animatePresent);
          };
          animationRef.current = requestAnimationFrame(animatePresent);
        }, 350);
      }
    };
    animationRef.current = requestAnimationFrame(animateWalk);
  }, [xMV, bartenderState, selectedDrink, getBottlePosition, dismissDrink, isGrabbed, isFlying, homeX]);

  // ── Swipe-down to dismiss detail card ─────────────────────────────────────
  const handleDetailTouchStart = useCallback((e) => setSwipeStartY(e.touches[0].clientY), []);
  const handleDetailTouchEnd   = useCallback((e) => {
    if (swipeStartY === null) return;
    if (e.changedTouches[0].clientY - swipeStartY > 50) dismissDrink();
    setSwipeStartY(null);
  }, [swipeStartY, dismissDrink]);

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────────────────────
  const bsEmptyContainerVariants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
  };
  const bsEmptyItemVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.32, 0.72, 0, 1] } },
  };
  return (
    <div className="bs-overlay" onClick={onClose}>
      <div
  className={[
    'bs-container',
    isHappyHour ? 'bs-happy-hour' : '',
    drinksMade >= 3 ? 'bs-tipsy' : '',
    isPolishingFast ? 'bs-polishing-fast' : '',
    shakeActive ? 'bs-cabinet-shake' : '',
  ].filter(Boolean).join(' ')}
  style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}
  onClick={e => { e.stopPropagation(); trackRapidClick(); }}
>
        {/* Impact flash overlay */}
        {showImpactFlash && <div className="bs-impact-flash" key={Date.now()} aria-hidden="true" />}

        {/* ── Top bar ── */}
        <div className="bs-topbar">
          <button className="bs-back-btn" onClick={onClose}>
            <span className="bs-pixel-arrow">&larr;</span> BACK
          </button>
          <h1 className="bs-title">
            <SquigglyText as="span" style={{ display: 'inline-block' }}>
              <NeonText text="MY BAR" color={isHappyHour ? '#ffd700' : '#ff4081'} />
            </SquigglyText>
          </h1>
          <div className="bs-bottle-count">
            <span className="bs-count-num">{drinks.length}</span>
            <span className="bs-count-label">bottles</span>
          </div>
          <button
            className="bs-surprise-btn"
            onClick={handleSurpriseMe}
            title="Bartender's Special"
          >
            <span className="bs-pixel-icon bs-pixel-icon-die" aria-hidden="true" />
            <span className="bs-surprise-label">SURPRISE</span>
          </button>
          <button
            className={`bs-chiptune-btn ${chiptuneOn ? 'bs-chiptune-on' : ''}`}
            onClick={handleChiptuneToggle}
            title={chiptuneOn ? 'Mute chiptune' : 'Play 8-bit jazz'}
          >
            <span className={`bs-pixel-icon ${chiptuneOn ? 'bs-pixel-icon-speaker' : 'bs-pixel-icon-note'}`} aria-hidden="true" />
            <span className="bs-chiptune-label">{chiptuneOn ? 'MUTE' : 'TUNE'}</span>
            {chiptuneOn && <ChiptuneVisualizer />}
          </button>
          {onAddToGrocery && drinks.length > 0 && (
            <button
              className="bs-fillshelf-btn"
              onClick={handleFillShelf}
              title="Add top 3 missing ingredients to quest list"
            >
              <span className="bs-pixel-icon bs-pixel-icon-scroll" aria-hidden="true" />
              <span className="bs-fillshelf-label">FILL</span>
            </button>
          )}
          {onImport && (
            <button className="bs-import-btn" onClick={onImport} title="Import a drink">
              <span>+</span>
              <span className="bs-import-label">IMPORT</span>
            </button>
          )}
        </div>

        {/* First-run hints — teaches the hidden interactions (dismissed forever) */}
        {showTips && (
          <div className="bs-tips-banner" role="note">
            <p>Tap the chalkboard, bounty board, tip jar &amp; sign to interact. Long-press the bartender to grab — then flick to toss him!</p>
            <button className="bs-tips-dismiss" onClick={dismissTips} aria-label="Dismiss tips">OK</button>
          </div>
        )}

        {/* ═══ 3-LAYER SALOON STAGE ═══ */}
        <div className="saloon-stage" ref={(el) => { barTopRef.current = el; constraintsRef.current = el; }}>

          {/* ── LAYER 1: Background — brick wall, lanterns, steam ── */}
          <div className="saloon-bg" aria-hidden="true">
            <div className="saloon-brick-wall" />
            {/* Decorative picture frames on the wall */}
            <div className="saloon-frames">
              <div className="saloon-frame saloon-frame-1" />
              <div className="saloon-frame saloon-frame-2" />
              <div className="saloon-frame saloon-frame-3" />
            </div>
            {/* Hanging lanterns with CSS flicker */}
            <HangingLantern x={15} />
            <HangingLantern x={50} flicker={false} />
            <HangingLantern x={82} />
            {/* Rising steam from hot drinks */}
            <SteamParticles count={6} />
            {/* Original ambient overlay preserved */}
            <div className="bs-backbar-glow" />
            <div className="bs-ambient-left" />
            <div className="bs-ambient-right" />
          </div>

          {/* ── LAYER 2: Mid — shelves, wall boards, door, bartender, shingle ──
              Boards + door live INSIDE mid (not as a separate layer) so their
              z-index can be interleaved: shelves (1) < boards & door (2) <
              bartender (3). The bar counter (saloon-fg) still paints over the
              bottom of the door so it reads as standing behind the bar. */}
          <div className="saloon-mid">
            {/* Back-wall boards — chalkboard & bounty board */}
            <div className="saloon-boards">
              <WallChalkboard
                specialDrink={specialDrink}
                onClick={handleChalkClick}
              />
              <WallBountyBoard
                bounties={bounties}
                onClickBounty={handleBountyClick}
              />
            </div>

            {/* Full-height return door → My Bar, tucked behind the bar counter */}
            {onExitToMyBar && (
              <motion.button
                className="saloon-exit-door"
                onClick={() => { if (navigator.vibrate) navigator.vibrate(15); onExitToMyBar(); }}
                aria-label="Back to My Bar"
                title="Back to My Bar"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 24, delay: 0.4 }}
                whileHover={{ filter: 'brightness(1.12)' }}
                whileTap={{ scale: 0.97 }}
              >
                <span className="saloon-exit-lintel" aria-hidden="true">‹ MY BAR</span>
                <span className="saloon-exit-panel" aria-hidden="true">
                  <span className="saloon-exit-glow" aria-hidden="true" />
                  <span className="saloon-exit-knob" aria-hidden="true" />
                </span>
              </motion.button>
            )}

            {/* Lantern glow tracks bartender with spring lag */}
            <div
              className="lantern-glow"
              style={{
                left: `${bartenderX + 30}px`,
                transition: 'left 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
              aria-hidden="true"
            />

            {/* Swinging wooden shingle — replaces LED marquee */}
            <SwingingShingle
              barName={customMarquee}
              onClickShingle={() => { setShowMarqueeModal(true); if (navigator.vibrate) navigator.vibrate(15); }}
            />

            {/* Paginated bottle shelves */}
            <div className="bs-backbar">
              <div className="bs-display-case">
                <div className={`bs-backbar-shelves ${pageDirection !== 'none' ? `bs-page-${pageDirection}` : ''}`}>
                  {shelves.map((row, shelfIdx) => (
                    <div key={shelfIdx} className={`bs-shelf-row bs-shelf-wobble-${shelfIdx}`}>
                      <div className="bs-bottles-row">
                        {row.map((drink) => {
                          const bottleStyle = getBottleStyle(drink);
                          const isSelected  = selectedDrink?.id === drink.id;
                          const rarity = getDrinkRarity(drink);
                          const dimmed = isDimmed(drink);
                          const activeFilter = !dimmed && stoolFilter !== 'all' && stoolFilter !== 'recent';
                          return (
                            <motion.button
                              key={drink.id}
                              ref={el => { if (el) bottleSlotsRef.current[drink.id] = el; }}
                              className={[
                                'bs-bottle-slot',
                                isSelected ? 'bs-selected' : '',
                                `bs-bottle-${rarity}`,
                                dimmed ? 'bs-bottle-dimmed' : '',
                                activeFilter ? 'bs-bottle-active-filter' : '',
                              ].filter(Boolean).join(' ')}
                              onClick={() => !dimmed && handleBottleTap(drink, shelfIdx)}
                              title={drink.name}
                              whileHover={dimmed ? {} : {
                                rotate: [-4, 4, -3, 3, 0],
                                transition: { duration: 0.35, ease: 'easeInOut' },
                              }}
                              whileTap={dimmed ? {} : { scale: 0.88 }}
                            >
                              <div className="bs-bottle-idle" style={{ opacity: isSelected && holdingBottle ? 0.2 : 1 }}>
                                <PixelBottle style={bottleStyle} size={52} glow={isSelected || rarity === 'legendary'} />
                              </div>
                              <span className="bs-bottle-label" style={rarity !== 'common' ? { color: getRarityColor(rarity) } : undefined}>
                                {drink.name.length > 9 ? drink.name.slice(0, 8) + '…' : drink.name}
                              </span>
                            </motion.button>
                          );
                        })}
                        {row.length < BOTTLES_PER_SHELF && Array.from({ length: BOTTLES_PER_SHELF - row.length }).map((_, i) => (
                          <div key={`empty-${i}`} className="bs-bottle-slot bs-empty-slot"
                            onClick={() => { if (onImport) onImport(); }}
                            title="Add a drink"
                          >
                            <svg width="20" height="48" viewBox="0 0 20 48" className="bs-empty-bottle-svg">
                              <rect x="7" y="4" width="6" height="3" fill="none" stroke="#555" strokeWidth="1" strokeDasharray="2,2" />
                              <rect x="8" y="7" width="4" height="6" fill="none" stroke="#555" strokeWidth="1" strokeDasharray="2,2" />
                              <rect x="4" y="13" width="12" height="24" rx="1" fill="none" stroke="#555" strokeWidth="1" strokeDasharray="2,2" />
                              <line x1="7" y1="25" x2="13" y2="25" stroke="#666" strokeWidth="1.5" />
                              <line x1="10" y1="22" x2="10" y2="28" stroke="#666" strokeWidth="1.5" />
                            </svg>
                          </div>
                        ))}
                      </div>
                      <div className="bs-shelf-plank" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bartender — outer: x position + drag; inner: rotation + visual ── */}
            {/* Outer motion.div drives horizontal position via xMV + drag */}
            <motion.div
              style={{
                x: xMV,
                y: yMV,
                position: 'absolute',
                bottom: '14px', /* raised 14px so arm aligns with bartop counter top */
                zIndex: isGrabbed || isFlying ? 50 : 2,
                touchAction: 'none',
                cursor: isGrabbed ? 'grabbing' : 'grab',
              }}
              drag
              dragListener={false}
              dragControls={bartenderDragControls}
              dragConstraints={constraintsRef}
              dragElastic={0.18}
              dragMomentum={false}
              onDragStart={() => { dragActiveRef.current = true; }}
              onDragEnd={handleBartenderDragEnd}
            >
              {/* Inner motion.div handles rotation during toss */}
              <motion.div
                className={`bs-bartender-wrap bs-bartender-draggable${secretFlash ? ' bs-secret-flash' : ''}${isGrabbed ? ' bs-bartender-grabbed' : ''}`}
                animate={bartenderControls}
                onPointerDown={handleBartenderPointerDown}
                onPointerUp={handleBartenderPointerUp}
                onPointerLeave={handleBartenderPointerLeave}
                onClick={(e) => {
                  if (wasDraggedRef.current) { wasDraggedRef.current = false; return; }
                  handleBartenderTap(e);
                }}
                role="button"
                tabIndex={0}
                aria-label="Long-press to grab the bartender! Tap for quips."
                style={{ position: 'relative', display: 'inline-block' }}
              >
                <PixelBartender
                  state={isGrabbed || isFlying ? 'surprised' : bartenderState}
                  holdingBottle={holdingBottle}
                  facingRight={facingRight}
                  swigBottle={swigBottle}
                  swigQuip={swigQuip}
                  isDancing={chiptuneOn && bartenderState === 'idle' && !isGrabbed && !isFlying}
                />
                {/* Grab exclamation */}
                {isGrabbed && (
                  <div className="bs-grab-exclaim" aria-hidden="true">??!!</div>
                )}
                {/* Flying scream */}
                {isFlying && flyScream && (
                  <div className="bs-fly-scream" aria-hidden="true">AAAHH!!</div>
                )}
                {/* ZZZ floating particles during doze */}
                {bartenderState === 'dozing' && !isGrabbed && !isFlying && (
                  <div className="bs-zzzz-wrap" aria-hidden="true">
                    <span className="bs-zzzz-z" style={{ '--idx': 0, '--delay': '0s' }}>z</span>
                    <span className="bs-zzzz-z" style={{ '--idx': 1, '--delay': '0.7s' }}>z</span>
                    <span className="bs-zzzz-z" style={{ '--idx': 2, '--delay': '1.4s' }}>z</span>
                  </div>
                )}
                {/* Framer Motion floating music notes when chiptune is playing */}
                <FloatingNotes active={chiptuneOn && !isGrabbed && !isFlying} />
              </motion.div>
            </motion.div>

            {/* Bottle flip overlay (rare easter egg when adding a drink) */}
            {flipState !== 'none' && (
              <div className="bs-flip-wrap" aria-hidden="true">
                <div
                  className={`bs-flip-bottle bs-flip-${flipState === 'up' ? 'up' : flipState === 'catch' ? 'catch' : 'crash'}`}
                  style={{ '--flip-x': flipX, left: flipX, transform: 'translateX(-50%)' }}
                />
                {flipState === 'crash' && (
                  <div className="bs-flip-shards" style={{ '--flip-x': flipX }} />
                )}
                {(flipState === 'catch' || flipState === 'crash') && (
                  <div
                    className={`bs-flip-badge bs-flip-badge--${flipState}`}
                    style={{ '--flip-x': flipX }}
                  >
                    {flipState === 'catch' ? '✓ CAUGHT' : '✕ OOPS'}
                  </div>
                )}
              </div>
            )}

            {/* Quips layer — spring elastic lag so bubbles trail the bartender */}
            {(() => {
              // Position-aware bubble direction: extend toward center of screen,
              // never off the left or right edge regardless of facing direction.
              const barWidth = barTopRef.current?.clientWidth || 360;
              const bubbleDir = bartenderX < 120
                ? 'bs-bt-speech--right'                           // too close to left edge → open right
                : bartenderX > barWidth - 180
                  ? 'bs-bt-speech--left'                          // too close to right edge → open left
                  : facingRight ? 'bs-bt-speech--left' : 'bs-bt-speech--right'; // default: away from face
              return (
                <div
                  className="bs-quips-layer"
                  style={{
                    left: `${bartenderX}px`,
                    transition: 'left 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  }}
                >
                  {/* ── Post-toss shame quip ── */}
                  {tossQuip && !isFlying && !isGrabbed && bartenderState === 'idle' && (
                    <motion.div
                      className={`bs-bt-speech bs-bt-speech-shame ${bubbleDir}`}
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                    >
                      <span>{tossQuip}</span>
                    </motion.div>
                  )}

                  {/* ── Wake "!" exclamation (surprised without a joke) ── */}
                  {bartenderState === 'surprised' && !jokeText && !surpriseResult && !secretCocktailActive && !isFlying && !isGrabbed && (
                    <div className={`bs-bt-speech bs-bt-speech-wake ${bubbleDir}`}>
                      <span className="bs-wake-exclaim">!</span>
                    </div>
                  )}

                  {/* ── Secret Pour Combination unlock ── */}
                  {secretCocktailActive && (
                    <div className={`bs-bt-speech bs-bt-speech-secret ${bubbleDir}`} style={{ maxWidth: 'min(260px, 65vw)' }}>
                      <span>★ PROHIBITION SPECIAL ★</span>
                      <span className="bs-secret-sub">Top-shelf locked recipe unlocked!</span>
                    </div>
                  )}

                  {/* ── Joke easter egg (tap 5x) ── */}
                  {jokeText && (
                    <div className={`bs-bt-speech bs-bt-speech-joke ${bubbleDir}`} style={{ maxWidth: 'min(240px, 60vw)' }}>
                      <span>{jokeText}</span>
                    </div>
                  )}
                  {/* ── Surprise Me result ── */}
                  {surpriseResult && !selectedDrink && (
                    <div className={`bs-bt-speech bs-bt-speech-surprise ${bubbleDir}`} style={{ maxWidth: 'min(240px, 60vw)' }}>
                      <span>Special: {surpriseResult.name}</span>
                      {surpriseResult.isDrink && (
                        <button
                          className="bs-surprise-view-btn"
                          onClick={(e) => { e.stopPropagation(); onViewDetail(surpriseResult.drink); }}
                        >
                          VIEW
                        </button>
                      )}
                    </div>
                  )}
                  {bartenderState === 'presenting' && selectedDrink && !jokeText && !surpriseResult && !secretCocktailActive && (
                    <div className={`bs-bt-speech ${bubbleDir}`} style={{ maxWidth: 'min(240px, 60vw)' }}>
                      <span>Here ya go!</span>
                    </div>
                  )}
                  {bartenderState === 'swigging' && swigQuip && (
                    <div className={`bs-bt-speech bs-bt-speech-swig ${bubbleDir}`} style={{ maxWidth: 'min(240px, 60vw)' }}>
                      <span>{swigQuip}</span>
                    </div>
                  )}
                  {bartenderState === 'tipping' && (
                    <div className={`bs-bt-speech bs-bt-speech-tip ${bubbleDir}`} style={{ maxWidth: 'min(240px, 60vw)' }}>
                      <span>{spotlightQuip || idleQuipText}</span>
                    </div>
                  )}
                  {bartenderState === 'idle' && !selectedDrink && !jokeText && !surpriseResult && !secretCocktailActive && (
                    <div className={`bs-bt-speech bs-bt-speech-idle ${bubbleDir}`} style={{ maxWidth: 'min(240px, 60vw)' }}>
                      <AnimatePresence mode="wait">
                        <motion.span
                          key={spotlightQuip || idleQuipText}
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.22, ease: 'easeOut' }}
                        >
                          {spotlightQuip || idleQuipText}
                        </motion.span>
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* ── LAYER 4: Ambient Events (tumbleweed, snake) — above all static layers ── */}
          <SaloonAmbience
            bartenderX={bartenderX}
            onBartenderSurprise={() => {
              if (bartenderState === 'idle') {
                setBartenderState('surprised');
                setIdleQuipText("SNAKE!! *leaps*");
                setTimeout(() => setBartenderState('idle'), 900);
              }
            }}
          />

          {/* ── LAYER 3: Foreground — bar counter, stools, dog, door ── */}
          <div className="saloon-fg">
            {/* Saloon door — occasionally swings open */}
            <SaloonDoor open={saloon.doorOpen} />

            {/* Sleeping pixel dog with tail wag */}
            <PixelDog wagging={saloon.dogWagging} />

            {/* Secret pour — rare easter egg sliding glass animation */}
            {saloon.secretPour && (
              <div className="secret-pour-wrap" aria-hidden="true">
                <div className="secret-pour-glass" />
                <div className="secret-pour-trail" />
              </div>
            )}

            {/* Bar counter surface — wide left | gap at ~80% | narrow right */}
            <div className="bs-bar-surface">
              <div className="bs-bar-seg-l">
                <div className="bs-bar-coaster bs-bar-coaster-1" />
                <div className="bs-bar-napkin" />
                {/* Tip jar lives in the newly opened left real estate */}
                <PixelTipJar
                  tipsCollected={tipsCollected}
                  coinNonce={tipCoinNonce}
                  onTip={handleTipJar}
                />
                {/* Sliding mug delivery animation */}
                <AnimatePresence>
                  {slidingMug && (
                    <PixelSlidingMug
                      key={slidingMug.key}
                      fromX={slidingMug.fromX}
                      toX={slidingMug.toX}
                      onDone={() => setSlidingMug(null)}
                    />
                  )}
                </AnimatePresence>
              </div>
              {/* Walkthrough gap — bartender's legs show here, now at ~80% */}
              <div className="bs-bar-gap bs-bar-gap-right" aria-hidden="true" />
              <div className="bs-bar-seg-r">
                <div className="bs-bar-coaster bs-bar-coaster-2" />
              </div>
            </div>
            <div className="bs-bar-rail" />

            {/* Pixel-art bar stools — interactive filter nav on the customer side */}
            <div className="saloon-stools">
              {[
                {filter:'all',      label:'ALL',  x:'5%' },   /* left anchor */
                {filter:'cocktail', label:'CKTL', x:'23%'},  /* left-center */
                {filter:'mocktail', label:'MOCK', x:'42%'},  /* right-center */
                {filter:'recent',   label:'NEW',  x:'60%'},  /* stops before gap (~71%) */
              ].map(({filter, label, x}) => {
                const isActive = stoolFilter === filter;
                return (
                  <motion.button
                    key={filter}
                    className={`saloon-stool-btn ${isActive ? 'saloon-stool-active' : ''}`}
                    style={{ left: x }}
                    onClick={() => {
                      if (navigator.vibrate) navigator.vibrate(15);
                      setCurrentPage(0);
                      // Walk bartender to behind this tap handle before switching filter
                      const bw = barTopRef.current?.clientWidth || 340;
                      const tapX = bw * (parseFloat(x) / 100) + 10;
                      if (bartenderState === 'idle' && !isGrabbed && !isFlying) {
                        walkToRef.current?.(tapX, () => {
                          setStoolFilter(filter);
                          // Drift back home after a beat
                          setTimeout(() => {
                            if (bartenderState === 'idle') walkToRef.current?.(homeX(), () => {});
                          }, 700);
                        });
                      } else {
                        setStoolFilter(filter);
                      }
                    }}
                    title={`Filter: ${label}`}
                    aria-pressed={isActive}
                    whileTap={{
                      scaleY: 0.78,
                      y: 6,
                      transition: { type: 'spring', stiffness: 600, damping: 10 },
                    }}
                    animate={isActive ? { y: -4 } : { y: 0 }}
                    transition={{ type: 'spring', stiffness: 280, damping: 22 }}
                  >
                    <span className="saloon-stool-label">{label}</span>
                    <BarStool active={isActive} />
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Page navigation — outside the stage */}
        {totalPages > 1 && (
          <div className="bs-page-nav">
            <button className="bs-page-btn" onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 0}>◀</button>
            <div className="bs-page-dots">
              {Array.from({ length: totalPages }).map((_, i) => (
                <button key={i} className={`bs-page-dot ${i === currentPage ? 'active' : ''}`} onClick={() => goToPage(i)} />
              ))}
            </div>
            <button className="bs-page-btn" onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages - 1}>▶</button>
          </div>
        )}

        {/* ── Selected bottle detail card ── */}
        {selectedDrink && bartenderState === 'presenting' && (() => {
          const rarity = getDrinkRarity(selectedDrink);
          const rarityColor = getRarityColor(rarity);
          const ingMatch = matchIngredients(selectedDrink.ingredients, barInventory);
          const progressPct = Math.round(ingMatch.score * 100);
          return (
            <div
              className={`bs-detail-card bs-rarity-${rarity}`}
              onTouchStart={handleDetailTouchStart}
              onTouchEnd={handleDetailTouchEnd}
              style={{ borderColor: rarityColor }}
            >
              <div className="bs-detail-swipe-hint">
                <div className="bs-detail-swipe-bar" />
                <span className="bs-detail-swipe-text">swipe down to dismiss</span>
              </div>
              <div className="bs-detail-header">
                <div className="bs-detail-bottle-preview">
                  <PixelBottle style={getBottleStyle(selectedDrink)} size={72} glow />
                </div>
                <div className="bs-detail-info">
                  <h3 className="bs-detail-name" style={{ color: rarityColor }}>
                    {selectedDrink.name}
                    {rarity === 'legendary' && <span className="bs-rarity-badge bs-rarity-legendary" title="Legendary">★</span>}
                    {rarity === 'rare' && <span className="bs-rarity-badge bs-rarity-rare" title="Rare">◆</span>}
                  </h3>
                  <p className="bs-detail-meta">
                    {selectedDrink.category && <span className="bs-detail-cat">{selectedDrink.category}</span>}
                    {selectedDrink.ingredients && (
                      <span className="bs-detail-ing-count">{selectedDrink.ingredients.length} ingredients</span>
                    )}
                  </p>
                </div>
                <button className="bs-detail-close" onClick={dismissDrink}>✕</button>
              </div>

              {/* ── Ingredient progress bar ── */}
              {selectedDrink.ingredients && barInventory.length > 0 && (
                <div className="bs-progress-section">
                  <div className="bs-progress-bar-wrap">
                    <div
                      className="bs-progress-bar-fill"
                      style={{ width: `${progressPct}%`, background: progressPct === 100 ? '#4caf50' : rarityColor }}
                    />
                  </div>
                  <span className="bs-progress-label">
                    {progressPct === 100
                      ? 'Ready to pour!'
                      : `${ingMatch.matched.length}/${ingMatch.total} ingredients`}
                  </span>
                </div>
              )}

              {/* ── Ingredient chips with matched/missing status ── */}
              {selectedDrink.ingredients && (
                <div className="bs-detail-ingredients">
                  {selectedDrink.ingredients.map((ing, i) => {
                    const isOwned = barInventory.length > 0 && ingMatch.matched.includes(ing);
                    const isMissing = barInventory.length > 0 && ingMatch.missing.includes(ing);
                    return (
                      <span
                        key={i}
                        className={`bs-ing-chip ${isOwned ? 'bs-ing-owned' : ''} ${isMissing ? 'bs-ing-missing' : ''}`}
                      >
                        {isOwned && <span className="bs-ing-check">✓</span>}
                        {isMissing && <QuestScroll size={12} color={rarityColor} />}
                        {ing}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* ── Quest scroll — add missing to grocery ── */}
              {ingMatch.missing.length > 0 && onAddToGrocery && (
                <button
                  className="bs-quest-btn"
                  onClick={() => {
                    onAddToGrocery(ingMatch.missing.map(ing => ({
                      name: ing,
                      tag: 'bar-quest',
                      questDrinkId: selectedDrink.id,
                      questName: selectedDrink.name,
                    })));
                    if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
                  }}
                  style={{ borderColor: rarityColor, color: rarityColor }}
                >
                  <QuestScroll size={16} color={rarityColor} />
                  <span>Add {ingMatch.missing.length} missing to Quest List</span>
                </button>
              )}

              <div className="bs-detail-actions">
                <button className="bs-action-btn bs-action-view" onClick={() => onViewDetail(selectedDrink)}>
                  VIEW RECIPE
                </button>
                <button
                  className="bs-action-btn bs-action-madeit"
                  onClick={handleMadeIt}
                  title="Mark as made!"
                >
                  CHEERS
                </button>
                {barInventory.length === 0 && (
                  <button
                    className="bs-action-btn bs-action-pantry"
                    onClick={() => {
                      if (selectedDrink.ingredients) {
                        selectedDrink.ingredients.forEach(ing => addToBarInventory(ing));
                        getBarInventory().then(setBarInventory);
                      }
                    }}
                  >
                    I HAVE THESE
                  </button>
                )}
              </div>
              {drinksMade >= 3 && (
                <div className="bs-tipsy-notice">*hic* You've had {drinksMade}... drinks</div>
              )}
            </div>
          );
        })()}

        {/* ── Marquee customization modal ── */}
        {showMarqueeModal && (
          <div className="bs-marquee-modal-overlay" onClick={() => setShowMarqueeModal(false)}>
            <div className="bs-marquee-modal" onClick={e => e.stopPropagation()}>
              <div className="bs-marquee-modal-title">CUSTOM MARQUEE</div>
              <input
                className="bs-marquee-input"
                value={marqueeInput}
                onChange={e => setMarqueeInput(e.target.value)}
                placeholder="Friday Night at My Bar..."
                maxLength={60}
                autoFocus
              />
              <div className="bs-marquee-modal-btns">
                <button className="bs-marquee-save-btn" onClick={() => {
                  const val = marqueeInput.trim();
                  setCustomMarquee(val);
                  localStorage.setItem('bs-custom-marquee', val);
                  setShowMarqueeModal(false);
                }}>SAVE</button>
                <button className="bs-marquee-clear-btn" onClick={() => {
                  setCustomMarquee('');
                  setMarqueeInput('');
                  localStorage.removeItem('bs-custom-marquee');
                  setShowMarqueeModal(false);
                }}>CLEAR</button>
              </div>
            </div>
          </div>
        )}
        {/* ── Empty state ── */}
        {filteredDrinks.length === 0 && drinks.length === 0 && (
          <motion.div
            className="bs-empty-bar"
            variants={bsEmptyContainerVariants}
            initial="hidden"
            animate="visible"
          >
            <motion.span className="bs-empty-neon" variants={bsEmptyItemVariants}><NeonText text="OPEN" color="#4caf50" /></motion.span>
            <motion.p className="bs-empty-msg" variants={bsEmptyItemVariants}>The bar's open, but the shelves are bare. Pour in your first drink recipe to get this place pourin'.</motion.p>
            {onImport && (
              <motion.button className="bs-empty-import-btn" variants={bsEmptyItemVariants} onClick={onImport}>
                Import your first drink
              </motion.button>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}
