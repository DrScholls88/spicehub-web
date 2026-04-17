import { useState, useMemo, useEffect, useCallback, useReducer, useRef } from 'react';
import useBackHandler from '../hooks/useBackHandler';

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
// BARBACK DISPLAY — Retro LED / dot-matrix menu board
// Shows scrolling marquee when idle; shows drink recipe when bartender presents
// ══════════════════════════════════════════════════════════════════════════════
function BarbackDisplay({ selectedDrink, isPresenting }) {
  const showRecipe = selectedDrink && isPresenting;
  return (
    <div className="bs-barback-display">
      <div className="bs-display-inner">
        <div className="bs-display-scanline" aria-hidden="true" />
        <div className="bs-display-grid-overlay" />
        <div className="bs-display-toprow" style={{ borderBottom: '2px solid #333' }}>
          <span className="bs-display-led bs-led-grn">● RECIPE_FEED</span>
          <span className="bs-display-title-text">MOD_0.8.bit</span>
        </div>
        <div className="bs-display-body">
          {showRecipe ? (
            <div className="bs-display-recipe" key={selectedDrink.id}>
              <span className="bs-display-drink-name">
                {selectedDrink.name.toUpperCase().slice(0, 22)}
              </span>
              {selectedDrink.ingredients?.length > 0 && (
                <span className="bs-display-recipe-ings">
                  {selectedDrink.ingredients.slice(0, 3).join('  ·  ')}
                </span>
              )}
            </div>
          ) : (
            <div className="bs-display-marquee-wrap">
              <span className="bs-display-marquee">
                ★ HAPPY HOUR ★&nbsp;&nbsp;HANDCRAFTED COCKTAILS ★&nbsp;&nbsp;TOP SHELF SPIRITS ★&nbsp;&nbsp;NAME YOUR POISON ★&nbsp;&nbsp;FINE DRINKS SERVED HERE ★&nbsp;&nbsp;
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PIXEL ART BARTENDER
// States: idle | walking | grabbing | presenting | returning
//         swigwalk | swigging | swigreturn | polishing | tipping | dozing | shaking | surprised
// ══════════════════════════════════════════════════════════════════════════════
function PixelBartender({ state, holdingBottle, facingRight, swigBottle, swigQuip }) {
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
      width="120" height="168" viewBox="0 0 40 56"
      className={[
        'bs-bartender-svg',
        isWalking   ? 'bs-bt-walk'        : '',
        isPresenting ? 'bs-bt-present'    : '',
        isSwigging  ? 'bs-bt-swig-bounce' : '',
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

const IDLE_QUIPS = [
  "Pick yer poison!",
  "What'll it be, partner?",
  "Top shelf or bottom?",
  "Name it, I got it!",
  "Happy hour never ends here...",
  "Step right up!",
  "The bar is open.",
  "Fine spirits. Finer company.",
  "Every drink tells a story.",
  "Don't be shy!",
];

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

function BarStool({ x = 0 }) {
  return (
    <svg
      className="saloon-stool"
      style={{ left: `${x}px`, imageRendering: 'pixelated' }}
      width="28" height="44" viewBox="0 0 28 44"
    >
      {/* Seat */}
      <rect x="2" y="0" width="24" height="6" fill="#5d4037" rx="2" />
      <rect x="3" y="1" width="22" height="3" fill="#795548" rx="1" />
      {/* Center post */}
      <rect x="12" y="6" width="4" height="18" fill="#4e342e" />
      {/* Foot ring */}
      <rect x="4" y="20" width="20" height="3" fill="#6d4c41" rx="1" />
      {/* Legs */}
      <rect x="5"  y="23" width="3" height="18" fill="#4e342e" />
      <rect x="20" y="23" width="3" height="18" fill="#4e342e" />
      {/* Foot pads */}
      <rect x="4"  y="39" width="5" height="3" fill="#3e2723" rx="1" />
      <rect x="19" y="39" width="5" height="3" fill="#3e2723" rx="1" />
    </svg>
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

// ── Saloon stage constants ─────────────────────────────────────────────────────
const WAYPOINTS = { left: 0.10, center: 0.42, right: 0.74 };

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
export default function BarShelf({ drinks, onViewDetail, onClose, onImport }) {
  // ── Reducer for discrete mode transitions ──────────────────────────────────
  const [saloon, dispatch] = useReducer(saloonReducer, initialSaloonState);

  // ── Frame-level animation position (not in reducer — updated 60fps) ─────────
  const [bartenderX, setBartenderX] = useState(140);

  // ── Derived / legacy state kept for compatibility ───────────────────────────
  const [selectedDrink, setSelectedDrink] = useState(null);
  const [facingRight, setFacingRight] = useState(true);
  const [holdingBottle, setHoldingBottle] = useState(null);
  const [swigBottle, setSwigBottle] = useState(null);
  const [swigQuip, setSwigQuip] = useState(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageDirection, setPageDirection] = useState('none');
  const [idleQuip, setIdleQuip] = useState(0);
  const [swipeStartY, setSwipeStartY] = useState(null);

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
  }, []);

  // ── Generic walk helper (stable ref prevents stale closure in rAF loops) ────
  const walkTo = useCallback((targetX, onArrive) => {
    cancelAnimationFrame(animationRef.current);
    const startX    = bartenderX;
    const walkTime  = Math.min(800, Math.max(200, Math.abs(targetX - startX) * 3));
    const walkStart = performance.now();
    setFacingRight(targetX > startX);
    const step = (now) => {
      const p = Math.min(1, (now - walkStart) / walkTime);
      const e = 1 - Math.pow(1 - p, 3);
      setBartenderX(startX + (targetX - startX) * e);
      if (p < 1) {
        animationRef.current = requestAnimationFrame(step);
      } else {
        setBartenderX(targetX);
        onArrive?.();
      }
    };
    animationRef.current = requestAnimationFrame(step);
  }, [bartenderX]);
  useEffect(() => { walkToRef.current = walkTo; }, [walkTo]);

  // ── Bartender wander (12–25 s idle → picks new waypoint) ───────────────────
  useEffect(() => {
    if (bartenderState !== 'idle' || selectedDrink) {
      clearTimeout(wanderTimerRef.current);
      return;
    }
    const delay = 12000 + Math.random() * 13000;
    wanderTimerRef.current = setTimeout(() => {
      const barWidth = barTopRef.current?.clientWidth || 320;
      const keys     = Object.keys(WAYPOINTS);
      const key      = keys[Math.floor(Math.random() * keys.length)];
      const targetX  = WAYPOINTS[key] * barWidth - 30;
      setBartenderState('walking');
      walkToRef.current?.(targetX, () => setBartenderState('idle'));
    }, delay);
    return () => clearTimeout(wanderTimerRef.current);
  }, [bartenderState, selectedDrink]);

  // ── Saloon door (20–60 s — opens, holds 1.5 s, swings back) ────────────────
  useEffect(() => {
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
  }, []);

  // ── Pixel dog tail wag (15–45 s intervals) ──────────────────────────────────
  useEffect(() => {
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
  }, []);

  // ── Secret pour (1 % chance per 60–120 s window, only when idle) ────────────
  useEffect(() => {
    if (bartenderState !== 'idle' || selectedDrink) return;
    const delay = 60000 + Math.random() * 60000;
    pourTimerRef.current = setTimeout(() => {
      if (Math.random() < 0.01) {
        dispatch({ type: 'SECRET_POUR_ON' });
        setTimeout(() => dispatch({ type: 'SECRET_POUR_OFF' }), 2000);
      }
    }, delay);
    return () => clearTimeout(pourTimerRef.current);
  }, [bartenderState, selectedDrink]);

  // ── Pagination ──────────────────────────────────────────────────────────────
  const totalPages        = Math.max(1, Math.ceil(drinks.length / BOTTLES_PER_PAGE));
  const currentPageDrinks = useMemo(() => {
    const start = currentPage * BOTTLES_PER_PAGE;
    return drinks.slice(start, start + BOTTLES_PER_PAGE);
  }, [drinks, currentPage]);

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
    const startX    = bartenderX;

    setSelectedDrink(null);
    setFacingRight(returnPos > bartenderX);
    setBartenderState('returning');

    const returnStart = performance.now();
    const returnTime  = Math.min(700, Math.max(300, Math.abs(returnPos - startX) * 3));

    const animateReturn = (now) => {
      const progress = Math.min(1, (now - returnStart) / returnTime);
      const eased    = 1 - Math.pow(1 - progress, 3);
      setBartenderX(startX + (returnPos - startX) * eased);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animateReturn);
      } else {
        setHoldingBottle(null);
        setBartenderState('walking');
        setFacingRight(20 < returnPos);

        const restPos  = 20;
        const idleStart = performance.now();
        const idleTime  = Math.min(600, Math.max(200, Math.abs(restPos - returnPos) * 3));

        const animateIdle = (iNow) => {
          const ip = Math.min(1, (iNow - idleStart) / idleTime);
          const ie = 1 - Math.pow(1 - ip, 3);
          setBartenderX(returnPos + (restPos - returnPos) * ie);
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
  }, [selectedDrink, bartenderState, bartenderX, getBottlePosition]);

  // ── Android back button — detail card first, then whole shelf ─────────────
  // This is LIFO with App.jsx's bar-shelf handler; pressing back dismisses
  // the detail card before it closes the entire shelf.
  useBackHandler(
    selectedDrink !== null && bartenderState === 'presenting',
    dismissDrink,
    'bar-shelf-detail'
  );

  // ── Idle quip cycling ──────────────────────────────────────────────────────
  useEffect(() => {
    if (bartenderState !== 'idle') return;
    idleTimerRef.current = setInterval(
      () => setIdleQuip(q => (q + 1) % IDLE_QUIPS.length),
      5000
    );
    return () => clearInterval(idleTimerRef.current);
  }, [bartenderState]);

  // ── Idle swig sequence ──────────────────────────────────────────────────────
  // After 8–15 s of inactivity the bartender sneaks a swig from a random bottle
  const runSwigSequence = useCallback(() => {
    const barWidth  = barTopRef.current?.clientWidth || 320;
    // Target somewhere in the middle 60 % of the bar
    const targetPos = barWidth * (0.15 + Math.random() * 0.55) - 60;
    const style     = BOTTLE_STYLES[Math.floor(Math.random() * BOTTLE_STYLES.length)];
    const quip      = SWIG_QUIPS[Math.floor(Math.random() * SWIG_QUIPS.length)];
    const startX    = bartenderX;

    setSwigBottle(style);
    setFacingRight(targetPos > startX);
    setBartenderState('swigwalk');

    const walkTime  = Math.min(700, Math.max(300, Math.abs(targetPos - startX) * 3));
    const walkStart = performance.now();

    const animSwigWalk = (now) => {
      const p = Math.min(1, (now - walkStart) / walkTime);
      const e = 1 - Math.pow(1 - p, 3);
      setBartenderX(startX + (targetPos - startX) * e);

      if (p < 1) {
        animationRef.current = requestAnimationFrame(animSwigWalk);
      } else {
        setBartenderX(targetPos);
        setBartenderState('swigging');
        setSwigQuip(quip);

        timeoutRef.current = setTimeout(() => {
          setSwigQuip(null);
          const restPos  = 20;
          const retStart = performance.now();
          const retTime  = Math.min(700, Math.max(300, Math.abs(restPos - targetPos) * 3));
          setBartenderState('swigreturn');
          setFacingRight(restPos > targetPos); // face left back to home

          const animSwigReturn = (rNow) => {
            const rp = Math.min(1, (rNow - retStart) / retTime);
            const re = 1 - Math.pow(1 - rp, 3);
            setBartenderX(targetPos + (restPos - targetPos) * re);

            if (rp < 1) {
              animationRef.current = requestAnimationFrame(animSwigReturn);
            } else {
              setBartenderX(restPos);
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
  }, [bartenderX]);

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
  const handleBottleTap = useCallback((drink) => {
    if (bartenderState !== 'idle' && bartenderState !== 'presenting') return;

    // Cancel any pending swig
    clearTimeout(swigTimerRef.current);

    if (selectedDrink?.id === drink.id) { dismissDrink(); return; }

    if (bartenderState === 'presenting' && selectedDrink) {
      setSelectedDrink(null);
      setBartenderState('idle');
    }

    const targetPos   = getBottlePosition(drink.id);
    const bottleStyle = getBottleStyle(drink);

    setFacingRight(targetPos > bartenderX);
    setBartenderState('walking');

    const startX    = bartenderX;
    const walkTime  = Math.min(800, Math.max(300, Math.abs(targetPos - startX) * 3));
    const walkStart = performance.now();

    const animateWalk = (now) => {
      const p = Math.min(1, (now - walkStart) / walkTime);
      const e = 1 - Math.pow(1 - p, 3);
      setBartenderX(startX + (targetPos - startX) * e);

      if (p < 1) {
        animationRef.current = requestAnimationFrame(animateWalk);
      } else {
        setBartenderState('grabbing');
        setHoldingBottle(bottleStyle);

        timeoutRef.current = setTimeout(() => {
          setBartenderState('presenting');
          setSelectedDrink(drink);

          const centerX    = (barTopRef.current?.clientWidth ?? 200) / 2 - 60;
          const grabX      = targetPos;
          const presStart  = performance.now();
          const presTime   = 400;
          setFacingRight(true);

          const animatePresent = (pNow) => {
            const pp = Math.min(1, (pNow - presStart) / presTime);
            const pe = 1 - Math.pow(1 - pp, 3);
            setBartenderX(grabX + (centerX - grabX) * pe);
            if (pp < 1) animationRef.current = requestAnimationFrame(animatePresent);
          };
          animationRef.current = requestAnimationFrame(animatePresent);
        }, 350);
      }
    };
    animationRef.current = requestAnimationFrame(animateWalk);
  }, [bartenderState, bartenderX, selectedDrink, getBottlePosition, dismissDrink]);

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
  return (
    <div className="bs-overlay" onClick={onClose}>
      <div className="bs-container" onClick={e => e.stopPropagation()}>

        {/* ── Top bar ── */}
        <div className="bs-topbar">
          <button className="bs-back-btn" onClick={onClose}>
            <span className="bs-pixel-arrow">&larr;</span> BACK
          </button>
          <h1 className="bs-title">
            <NeonText text="MY BAR" color="#ff4081" />
          </h1>
          <div className="bs-bottle-count">
            <span className="bs-count-num">{drinks.length}</span>
            <span className="bs-count-label">bottles</span>
          </div>
          {onImport && (
            <button className="bs-import-btn" onClick={onImport} title="Import a drink">
              <span>+</span>
              <span className="bs-import-label">IMPORT</span>
            </button>
          )}
        </div>

        {/* ═══ 3-LAYER SALOON STAGE ═══ */}
        <div className="saloon-stage" ref={barTopRef}>

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

          {/* ── LAYER 2: Mid — shelves, bartender, LED board ── */}
          <div className="saloon-mid">
            {/* Lantern glow tracks bartender with spring lag */}
            <div
              className="lantern-glow"
              style={{
                left: `${bartenderX + 30}px`,
                transition: 'left 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
              aria-hidden="true"
            />

            {/* LED menu board */}
            <BarbackDisplay
              selectedDrink={selectedDrink}
              isPresenting={bartenderState === 'presenting'}
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
                          return (
                            <button
                              key={drink.id}
                              ref={el => { if (el) bottleSlotsRef.current[drink.id] = el; }}
                              className={`bs-bottle-slot ${isSelected ? 'bs-selected' : ''}`}
                              onClick={() => handleBottleTap(drink)}
                              title={drink.name}
                            >
                              <div className="bs-bottle-idle" style={{ opacity: isSelected && holdingBottle ? 0.2 : 1 }}>
                                <PixelBottle style={bottleStyle} size={52} glow={isSelected} />
                              </div>
                              <span className="bs-bottle-label">
                                {drink.name.length > 9 ? drink.name.slice(0, 8) + '…' : drink.name}
                              </span>
                            </button>
                          );
                        })}
                        {row.length < BOTTLES_PER_SHELF && Array.from({ length: BOTTLES_PER_SHELF - row.length }).map((_, i) => (
                          <div key={`empty-${i}`} className="bs-bottle-slot bs-empty-slot">
                            <div className="bs-empty-bottle" />
                          </div>
                        ))}
                      </div>
                      <div className="bs-shelf-plank" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bartender behind the bar */}
            <div
              className="bs-bartender-wrap"
              style={{
                transform: `translateX(${bartenderX}px)`,
                transition: bartenderState === 'idle' ? 'transform 0.3s ease' : 'none',
              }}
            >
              <PixelBartender
                state={bartenderState}
                holdingBottle={holdingBottle}
                facingRight={facingRight}
                swigBottle={swigBottle}
                swigQuip={swigQuip}
                idleQuip={IDLE_QUIPS[idleQuip]}
              />
            </div>

            {/* Quips layer — spring elastic lag so bubbles trail the bartender */}
            <div
              className="bs-quips-layer"
              style={{
                left: `${bartenderX}px`,
                transition: 'left 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            >
              {bartenderState === 'presenting' && selectedDrink && (
                <div className={`bs-bt-speech ${facingRight ? 'bs-bt-speech--left' : 'bs-bt-speech--right'}`}>
                  <span>Here ya go!</span>
                </div>
              )}
              {bartenderState === 'swigging' && swigQuip && (
                <div className={`bs-bt-speech bs-bt-speech-swig ${facingRight ? 'bs-bt-speech--left' : 'bs-bt-speech--right'}`}>
                  <span>{swigQuip}</span>
                </div>
              )}
              {bartenderState === 'tipping' && (
                <div className={`bs-bt-speech bs-bt-speech-tip ${facingRight ? 'bs-bt-speech--left' : 'bs-bt-speech--right'}`}>
                  <span>Much obliged!</span>
                </div>
              )}
              {bartenderState === 'idle' && !selectedDrink && (
                <div className={`bs-bt-speech bs-bt-speech-idle ${facingRight ? 'bs-bt-speech--left' : 'bs-bt-speech--right'}`}>
                  <span>{IDLE_QUIPS[idleQuip]}</span>
                </div>
              )}
            </div>
          </div>

          {/* ── LAYER 3: Foreground — bar counter, stools, dog, door ── */}
          <div className="saloon-fg">
            {/* Pixel-art bar stools */}
            <div className="saloon-stools" aria-hidden="true">
              <BarStool x={18} />
              <BarStool x={80} />
              <BarStool x={148} />
              <BarStool x={210} />
            </div>

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

            {/* Bar counter surface sits on top of everything */}
            <div className="bs-bar-surface">
              <div className="bs-bar-coaster bs-bar-coaster-1" />
              <div className="bs-bar-coaster bs-bar-coaster-2" />
              <div className="bs-bar-napkin" />
            </div>
            <div className="bs-bar-rail" />
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
        {selectedDrink && bartenderState === 'presenting' && (
          <div
            className="bs-detail-card"
            onTouchStart={handleDetailTouchStart}
            onTouchEnd={handleDetailTouchEnd}
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
                <h3 className="bs-detail-name">{selectedDrink.name}</h3>
                <p className="bs-detail-meta">
                  {selectedDrink.category && <span className="bs-detail-cat">{selectedDrink.category}</span>}
                  {selectedDrink.ingredients && (
                    <span className="bs-detail-ing-count">{selectedDrink.ingredients.length} ingredients</span>
                  )}
                </p>
              </div>
              <button className="bs-detail-close" onClick={dismissDrink}>✕</button>
            </div>

            {selectedDrink.ingredients && (
              <div className="bs-detail-ingredients">
                {selectedDrink.ingredients.slice(0, 4).map((ing, i) => (
                  <span key={i} className="bs-ing-chip">{ing}</span>
                ))}
                {selectedDrink.ingredients.length > 4 && (
                  <span className="bs-ing-more">+{selectedDrink.ingredients.length - 4} more</span>
                )}
              </div>
            )}

            <div className="bs-detail-actions">
              <button className="bs-action-btn bs-action-view" onClick={() => onViewDetail(selectedDrink)}>
                VIEW RECIPE
              </button>
            </div>
          </div>
        )}

        {/* ── Empty state ── */}
        {drinks.length === 0 && (
          <div className="bs-empty-bar">
            <span className="bs-empty-neon"><NeonText text="OPEN" color="#4caf50" /></span>
            <p className="bs-empty-msg">Your bar is empty! Add some drinks to stock the shelves.</p>
          </div>
        )}
      </div>
    </div>
  );
}
