import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { X, Lock, LockKeyhole, LockKeyholeOpen, Star, BookOpen, UtensilsCrossed, ChevronDown, ChevronRight, MoreVertical, Plus, RefreshCw, CheckSquare, ShoppingCart, CalendarDays, List, GripVertical, Search, Share2 } from 'lucide-react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import MealSpinner from './MealSpinner';
import useBackHandler from '../hooks/useBackHandler';
import { filterMealsByConstraints, fridgeMatchRatio, mealTotalMinutes } from '../lib/weekPlanner';

// Extracted from App.css 2026-08-24 (see the header in that file for the
// move rules). MUST stay the first stylesheet imported here: these rules
// used to live in App.css, which loads ahead of every component sheet, and
// importing it first is what preserves that order for equal-specificity ties.
import '../styles/screens/WeekView.css';

// ── MealImage helper ──────────────────────────────────────────────────────────
function MealImage({ src, alt, className, style, fallbackEmoji = '🍽️', fallbackClass }) {
  const [status, setStatus] = useState(src ? 'loading' : 'fallback');
  useEffect(() => { setStatus(src ? 'loading' : 'fallback'); }, [src]);
  if (status === 'fallback' || !src)
    return <div className={fallbackClass || className} style={style}>{fallbackEmoji}</div>;
  return (
    <img
      src={src} alt={alt || ''} className={className} style={style}
      onLoad={() => setStatus('loaded')}
      onError={() => setStatus('fallback')}
    />
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_FULL   = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const LONG_PRESS_MS = 500;

// ── Date helpers ──────────────────────────────────────────────────────────────
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dateFromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setHours(0, 0, 0, 0);
  return date;
}

// Parse a nutrition string like "250 kcal" / "18 g" down to its leading number.
function parseNutritionNumber(str) {
  if (str == null) return null;
  const m = String(str).match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function getCalendarCells(year, month) {
  const firstDay = new Date(year, month, 1);
  const startDow = firstDay.getDay();
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - startDow);
  startDate.setHours(0, 0, 0, 0);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    d.setHours(0, 0, 0, 0);
    cells.push(d);
  }
  return cells;
}

// ── Keyframe injection ────────────────────────────────────────────────────────
const ANIMATIONS_CSS = `
  /* ── Plan-page-scoped dark palette ──
     The global dark theme (App.css) uses a brown-tinted canvas (--bg:#1f1a16)
     with a green --primary (#66bb6a) reused for borders/glows everywhere —
     on this page that read as "muddy brown + neon green". Rather than
     changing those app-wide tokens (every other screen — Bar, Meal Library,
     Landing — is tuned around them), redefine the same variable names locally
     on .wv-plan-root. CSS custom properties cascade, so every existing
     var(--card)/var(--border)/var(--primary)/etc. rule below picks up the
     new values automatically within this page only, with zero risk to the
     rest of the app. */
  .wv-plan-root {
    --primary-soft: rgba(230,81,0,0.1); /* light-theme default; overridden below for dark */
  }
  /* Scoped (not global .pk-name) so Meal Library's own picker sheets are
     untouched — this page's imported titles are the ones arriving in
     inconsistent case. */
  .wv-plan-root .pk-name { text-transform: capitalize; }
  [data-theme="dark"] .wv-plan-root,
  [data-theme="auto"][data-system-dark="true"] .wv-plan-root {
    --bg: #0e0f12;
    --card: #18181b;
    --card-bg: #18181b;
    --surface: #212126;
    --surface-2: #27272a;
    --border: rgba(63, 63, 70, 0.8);
    --text: #f4f4f5;
    --text-light: #d4d4d8;
    --text-muted: #8b8b94;
    --primary: #10b981;
    --primary-light: #34d399;
    --primary-dark: #059669;
    --success: #10b981;
    --primary-soft: rgba(16,185,129,0.14);
    --shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.6);
  }
  @keyframes wv-slideUp {
    from { transform: translateY(100%); opacity: 0; }
    to   { transform: translateY(0);   opacity: 1; }
  }
  @keyframes wv-fadeIn {
    from { opacity: 0; transform: scale(0.96); }
    to   { opacity: 1; transform: scale(1); }
  }
  @keyframes wv-emptyRise {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes wv-ripple {
    0%   { transform: scale(0); opacity: 0.6; }
    100% { transform: scale(2.5); opacity: 0; }
  }
  @keyframes wv-selectPop {
    0%   { transform: scale(1); }
    40%  { transform: scale(0.88); }
    70%  { transform: scale(1.06); }
    100% { transform: scale(1); }
  }
  @keyframes wv-slideInLeft {
    from { transform: translateX(-18px); opacity: 0; }
    to   { transform: translateX(0);     opacity: 1; }
  }
  @keyframes wv-slideInRight {
    from { transform: translateX(18px); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
  }
  @keyframes wv-mealFadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes wv-shimmer {
    0%   { background-position: -200px 0; }
    100% { background-position: calc(200px + 100%) 0; }
  }
  @keyframes wv-bounceIn {
    0%   { transform: scale(0.3); opacity: 0; }
    50%  { transform: scale(1.05); }
    70%  { transform: scale(0.9); }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes wv-pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.5; }
  }
  @keyframes wv-selectRing {
    0%   { box-shadow: 0 0 0 0 rgba(230,81,0,0.5); }
    100% { box-shadow: 0 0 0 8px rgba(230,81,0,0); }
  }
  .wv-cell-selected {
    animation: wv-selectPop 0.28s var(--ease-bounce, cubic-bezier(0.34,1.56,0.64,1)) forwards;
  }
  /* ── Grocery-active glow ── */
  .wv-tl-card.tl-grocery-active {
    border-color: #43a047;
    box-shadow: 0 0 0 1px #43a047, 0 2px 16px rgba(67,160,71,0.18);
    background: rgba(67,160,71,0.06);
  }
  .wv-tl-card.tl-grocery-active .wv-tl-grocery-badge {
    display: flex;
  }
  .wv-tl-grocery-badge {
    display: none; position: absolute; top: 4px; right: 4px;
    width: 18px; height: 18px; border-radius: 50%;
    background: #43a047; color: white;
    align-items: center; justify-content: center;
    font-size: 10px; font-weight: 800;
    box-shadow: 0 1px 4px rgba(0,0,0,0.15);
  }
  .wv-tl-card.tl-grocery-excluded {
    opacity: 0.4;
    border-style: dashed;
    border-color: var(--border);
  }
  @keyframes fadeSlideDown {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes wv-groceryPulse {
    0%, 100% { box-shadow: 0 0 0 1px #43a047, 0 2px 16px rgba(67,160,71,0.18); }
    50%      { box-shadow: 0 0 0 2px #43a047, 0 2px 20px rgba(67,160,71,0.30); }
  }
  .wv-tl-card.tl-grocery-active {
    animation: wv-groceryPulse 2s ease-in-out infinite;
  }
  .grocery-mode-bar {
    background: #43a047; color: white;
    padding: 6px 16px; font-size: 12px; font-weight: 600;
    display: flex; align-items: center; justify-content: space-between;
    animation: wv-fadeIn 0.2s ease both;
  }
  .grocery-mode-bar .gm-count {
    background: rgba(255,255,255,0.25); border-radius: 10px;
    padding: 1px 8px;
  }
  /* ── Timeline view styles ── */
  .wv-tl-card {
    position: relative;
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px;
    border-radius: 12px;
    transition: transform 160ms cubic-bezier(0.23,1,0.32,1), box-shadow 160ms ease, border-color 200ms ease, opacity 200ms ease;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    border: 1.5px solid var(--border);
    background: var(--card);
  }
  .wv-tl-card:active { transform: scale(0.97); }
  /* ── "Active" card treatment — a thin left accent bar + soft tint reads as
     confident and calm; the old thick glowing ring (box-shadow + scale)
     shouted for attention on every single "today" card. ── */
  .wv-tl-card.tl-today,
  .wv-tl-card.tl-selected {
    position: relative;
    border-color: transparent;
    background: var(--primary-soft);
    z-index: 2;
  }
  .wv-tl-card.tl-today::before,
  .wv-tl-card.tl-selected::before {
    content: '';
    position: absolute; left: 0; top: 6px; bottom: 6px; width: 3px;
    background: var(--primary);
    border-radius: 0 3px 3px 0;
  }
  .wv-tl-card.tl-selected {
    animation: wv-selectPop 0.28s var(--ease-bounce, cubic-bezier(0.34,1.56,0.64,1)) forwards;
  }
  .wv-tl-card.tl-empty {
    border-style: dashed;
    border-color: var(--border);
    background: transparent;
  }
  .wv-tl-card.tl-empty:active { transform: scale(0.98); }
  .wv-tl-card.tl-past { opacity: 0.55; }
  .wv-tl-dow { text-align: center; min-width: 38px; flex-shrink: 0; }
  .wv-tl-dow-label {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.5px; color: var(--text-muted);
  }
  .wv-tl-card.tl-today .wv-tl-dow-label { color: var(--primary); }
  .wv-tl-dow-num { font-size: 19px; font-weight: 800; color: var(--text); }
  .wv-tl-card.tl-today .wv-tl-dow-num { color: var(--primary); }
  .wv-tl-thumb {
    width: 48px; height: 48px; border-radius: 10px; flex-shrink: 0;
    object-fit: cover; display: block;
  }
  .wv-tl-thumb-ph {
    width: 48px; height: 48px; border-radius: 10px; flex-shrink: 0;
    background: var(--surface); display: flex; align-items: center;
    justify-content: center; font-size: 22px;
  }
  .wv-tl-empty-ph {
    width: 48px; height: 48px; border-radius: 10px; flex-shrink: 0;
    background: var(--surface); display: flex; align-items: center;
    justify-content: center;
  }
  .wv-tl-info { flex: 1; min-width: 0; }
  .wv-tl-name {
    font-size: 14px; font-weight: 700; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    /* Imported captions arrive as "MUSHROOM PARM ON GARLIC" or all-lowercase
       just as often as proper case — normalize display without touching the
       stored recipe name. */
    text-transform: capitalize;
  }
  .wv-tl-meta { font-size: 11px; color: var(--text-light); margin-top: 1px; }
  /* ── Unified action group — Lock / Search / Kebab used to be three loosely
     spaced siblings of inconsistent size; now a single right-aligned row of
     real 36×36px touch targets. ── */
  .wv-tl-actions-group {
    flex-shrink: 0; display: flex; align-items: center; gap: 2px;
  }
  .wv-tl-action {
    flex-shrink: 0; width: 36px; height: 36px; border-radius: 10px;
    background: transparent; border: none; color: var(--text-muted);
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: background 150ms cubic-bezier(0.32,0.72,0,1), color 150ms cubic-bezier(0.32,0.72,0,1);
    -webkit-tap-highlight-color: transparent;
  }
  .wv-tl-action:hover { color: var(--text); background: var(--surface); }
  .wv-tl-action:active { background: var(--surface); }
  .wv-tl-spin-chip {
    flex-shrink: 0; padding: 5px 10px; border-radius: 8px;
    background: var(--primary-soft); border: none;
    color: var(--primary); font-size: 11px; font-weight: 700;
    cursor: pointer; display: flex; align-items: center; gap: 4px;
    transition: transform 100ms ease;
  }
  .wv-tl-spin-chip:active { transform: scale(0.93); }
  .wv-tl-lock-btn {
    flex-shrink: 0; width: 36px; height: 36px; border-radius: 10px;
    background: transparent; border: none;
    color: var(--text-muted); font-size: 14px;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: transform 100ms ease, color 150ms ease, background 150ms cubic-bezier(0.32,0.72,0,1);
    -webkit-tap-highlight-color: transparent;
  }
  .wv-tl-lock-btn:hover { background: var(--surface); }
  .wv-tl-lock-btn:active { transform: scale(0.85); }
  .wv-tl-lock-btn.locked {
    color: var(--primary);
  }
  .wv-tl-section-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 16px 4px;
  }
  .wv-tl-section-title {
    font-size: 13px; font-weight: 700; color: var(--text-light);
  }
  .wv-tl-section-badge {
    font-size: 11px; font-weight: 700; color: var(--primary);
  }
  /* ── Contextual sub-header — Spin Unlocked / Lock toggle / Diet filter,
     one compact row under the week it acts on, instead of a bottom stack. ── */
  .wv-week-toolbar {
    display: flex; align-items: center; gap: 6px;
    padding: 4px 16px 10px;
  }
  .wv-week-toolbar-btn {
    flex-shrink: 0; display: flex; align-items: center; gap: 5px;
    padding: 7px 11px; border-radius: 20px; border: none;
    background: var(--surface); color: var(--text-light);
    font-size: 12px; font-weight: 700;
    cursor: pointer; -webkit-tap-highlight-color: transparent;
    transition: transform 100ms ease, background 150ms cubic-bezier(0.32,0.72,0,1);
  }
  .wv-week-toolbar-btn:active { transform: scale(0.95); }
  .wv-week-toolbar-btn.primary {
    background: var(--primary-soft); color: var(--primary);
  }
  /* iOS Safari zooms the whole page whenever a focused form control computes
     under 16px, and a PWA with a locked viewport gives you no way back out —
     this <select> at 12px was doing exactly that on every Diet-filter tap.
     16px + a 44px minimum keeps it zoom-free and inside Apple's HIG target;
     the row has the width for it now that it sits on its own line. */
  .wv-diet-pill {
    flex: 1; min-width: 0; margin-left: auto;
    padding: 6px 10px; border-radius: 20px;
    border: 1.5px solid var(--border); background: var(--card);
    color: var(--text); font: inherit; font-weight: 700; font-size: 16px;
    max-width: 168px;
    min-height: 44px;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  /* Let the toolbar wrap rather than crush the Diet select at 16px on narrow
     phones — three controls at full touch size don't fit one 360px row. */
  .wv-week-toolbar { flex-wrap: wrap; row-gap: 8px; }
  /* ── Next-week empty hero — one CTA + day chips instead of 7 stacked
     placeholder rows when there's nothing planned yet. ── */
  .wv-next-hero { padding: 4px 12px 10px; }
  .wv-next-hero-cta {
    width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;
    padding: 16px; border-radius: 14px; border: 1.5px dashed var(--primary);
    background: var(--primary-soft); color: var(--primary);
    font-size: 14px; font-weight: 800; cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform 100ms ease;
  }
  .wv-next-hero-cta:active { transform: scale(0.98); }
  .wv-next-hero-chips { display: flex; gap: 6px; margin-top: 10px; }
  .wv-next-hero-chip {
    flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 2px;
    padding: 8px 2px; border-radius: 10px; border: 1px solid var(--border); background: var(--card);
    cursor: pointer; -webkit-tap-highlight-color: transparent;
    transition: background 150ms cubic-bezier(0.32,0.72,0,1);
  }
  .wv-next-hero-chip:active { background: var(--surface); }
  .wv-next-hero-chip-day {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.4px; color: var(--text-muted);
  }
  .wv-next-hero-chip-num { font-size: 13px; font-weight: 800; color: var(--text); }
  /* Now a real <button> (was a <div onClick>, which iOS Safari was dropping
     taps on inside this user-select:none page) — so it needs the button reset
     that a div got for free: full width, inherited font, no UA chrome. */
  .wv-tl-next-collapsed {
    width: calc(100% - 24px);
    margin: 6px 12px 8px; padding: 12px 14px;
    background: var(--surface); border-radius: 12px;
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    cursor: pointer; border: 1px solid var(--border);
    color: inherit; font: inherit; text-align: left;
    /* Comfortably past the 44px Apple HIG minimum, and no 300ms tap delay. */
    min-height: 56px;
    touch-action: manipulation;
    transition: transform 160ms cubic-bezier(0.23,1,0.32,1);
    -webkit-tap-highlight-color: transparent;
    -webkit-appearance: none;
    appearance: none;
  }
  .wv-tl-next-collapsed:active { transform: scale(0.98); }
  .wv-tl-next-collapsed:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .wv-tl-toggle {
    display: flex; gap: 0; padding: 3px;
    background: var(--surface); border-radius: 12px;
    position: relative;
    border: 1.5px solid var(--border);
  }
  .wv-tl-toggle-btn {
    /* Equal halves. Not cosmetic: it is what lets the pill below be a fixed
       width that only ever translates. With content-sized segments ("Week" is
       narrower than "Month") the pill had to animate left AND width — two
       layout properties — or scaleX and distort its own 9px radius. Two equal
       segments is also what every native segmented control does. */
    flex: 1 1 0;
    justify-content: center;
    padding: 7px 14px; border-radius: 9px; border: none;
    font-size: 12px; font-weight: 700; cursor: pointer;
    display: flex; align-items: center; gap: 5px;
    transition: color 0.25s cubic-bezier(0.32,0.72,0,1);
    -webkit-tap-highlight-color: transparent;
    position: relative; z-index: 2;
    background: transparent;
  }
  .wv-tl-toggle-btn.active {
    color: var(--text);
  }
  .wv-tl-toggle-btn:not(.active) {
    color: var(--text-muted);
  }
  .wv-tl-toggle-btn:active { transform: scale(0.95); }
  .wv-tl-toggle-pill {
    position: absolute; top: 3px; bottom: 3px; left: 3px;
    /* 100% resolves against the container's padding box, which still includes
       its own 3px padding either side — hence the -6px before halving. */
    width: calc((100% - 6px) / 2);
    border-radius: 9px;
    background: var(--card);
    box-shadow: 0 1px 4px rgba(0,0,0,0.10), 0 0 0 0.5px rgba(0,0,0,0.04);
    z-index: 1;
    /* Was a transition on left AND width — both layout properties, so every
       toggle tap ran layout for 300ms. Equal segments (above) mean the second
       slot starts exactly at left+width, so translateX(100%) lands on it and
       the whole move is compositor-only. */
    transform: translateX(0);
    transition: transform 0.3s cubic-bezier(0.32,0.72,0,1);
  }
  .wv-tl-toggle-pill.is-month {
    transform: translateX(100%);
  }
  @media (prefers-reduced-motion: reduce) {
    .wv-tl-toggle-pill { transition: none; }
  }
  /* ── Pick-up / carry-to-place ──
     Tap-based, not native HTML5 drag — draggable+dragstart/drop never fires on
     iOS Safari touch and is flaky on Android, which is why the old "drag a
     meal" gesture felt broken. This grip is a real <button>: tap to pick up,
     tap again (or the sticky bar's Cancel) to put back down. */
  .wv-tl-grip {
    flex-shrink: 0; width: 26px; height: 26px; display: flex;
    align-items: center; justify-content: center;
    color: var(--text-muted); opacity: 0.35;
    background: none; border: none; border-radius: 7px; padding: 0;
    cursor: pointer; touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition: opacity 0.2s cubic-bezier(0.32,0.72,0,1),
                color 0.2s cubic-bezier(0.32,0.72,0,1),
                background 0.2s cubic-bezier(0.32,0.72,0,1);
    margin-left: -4px;
  }
  .wv-tl-grip:active { opacity: 0.7; }
  .wv-tl-card:hover .wv-tl-grip,
  .wv-tl-card:focus-within .wv-tl-grip { opacity: 0.6; }
  .wv-tl-grip.active {
    opacity: 1; color: white; background: var(--primary);
  }
  .wv-tl-card.tl-drop-target {
    border-color: var(--primary) !important;
    background: var(--primary-soft) !important;
    box-shadow: 0 0 0 2px var(--primary), var(--shadow-lg);
    transform: scale(1.02);
    cursor: pointer;
  }
  @keyframes wv-dropPulse {
    0%, 100% { box-shadow: 0 0 0 2px var(--primary), var(--shadow-lg); }
    50%      { box-shadow: 0 0 0 3px var(--primary), var(--shadow-lg); }
  }
  .wv-tl-card.tl-drop-target {
    animation: wv-dropPulse 1.2s ease-in-out infinite;
  }
  .wv-tl-card.tl-carry-source {
    border-style: dashed;
    border-color: var(--text-muted);
    background: var(--surface) !important;
    opacity: 0.65;
    cursor: pointer;
  }
  .wv-tl-card.tl-carry-dim {
    filter: saturate(0.7);
    cursor: default;
  }
  .wv-carry-source-badge {
    flex-shrink: 0; padding: 5px 10px; border-radius: 8px;
    background: var(--surface); border: 1px dashed var(--border);
    color: var(--text-muted); font-size: 11px; font-weight: 700;
  }
  .wv-carry-place-btn {
    flex-shrink: 0; padding: 7px 12px; border-radius: 8px;
    background: var(--primary); border: none;
    color: white; font-size: 12px; font-weight: 800;
    cursor: pointer; -webkit-tap-highlight-color: transparent;
    transition: transform 0.1s ease;
  }
  .wv-carry-place-btn:active { transform: scale(0.93); }
  .wv-carry-bar {
    position: sticky; top: 0; z-index: 30;
    display: flex; align-items: center; gap: 10px;
    margin: 0 12px 10px; padding: 10px 12px;
    background: var(--primary); color: white;
    border-radius: 12px;
    box-shadow: var(--shadow-lg);
  }
  .wv-carry-grip {
    flex-shrink: 0; width: 26px; height: 26px; border-radius: 7px;
    background: rgba(255,255,255,0.18);
    display: flex; align-items: center; justify-content: center;
  }
  .wv-carry-name {
    font-size: 13px; font-weight: 800;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    text-transform: capitalize;
  }
  .wv-carry-hint { font-size: 11px; opacity: 0.85; margin-top: 1px; }
  .wv-carry-cancel {
    flex-shrink: 0; padding: 7px 12px; border-radius: 8px;
    background: rgba(255,255,255,0.18); border: none;
    color: white; font-size: 12px; font-weight: 700; cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .wv-carry-cancel:active { background: rgba(255,255,255,0.3); }
  /* ── Previous weeks ── */
  .wv-prev-weeks { margin-bottom: 4px; }
  .wv-prev-toggle { margin: 6px 12px 8px; }
  .wv-prev-empty {
    margin: 0 12px 10px; padding: 14px;
    border: 1px dashed var(--border); border-radius: 12px;
    color: var(--text-muted); font-size: 12px; line-height: 1.5;
    max-width: 46ch;
  }
  .wv-prev-month-link {
    display: block; width: calc(100% - 24px);
    margin: 4px 12px 12px; padding: 10px;
    background: none; border: 1px dashed var(--border); border-radius: 10px;
    color: var(--text-muted); font-size: 12px; font-weight: 600;
    cursor: pointer; text-align: center;
    -webkit-tap-highlight-color: transparent;
  }
  .wv-prev-month-link:active { background: var(--surface); }
  /* ── Search button ── */
  .wv-tl-search-btn {
    color: var(--text-muted);
    opacity: 0.5;
    transition: opacity 0.15s cubic-bezier(0.32,0.72,0,1),
                color 0.15s cubic-bezier(0.32,0.72,0,1);
  }
  .wv-tl-card:hover .wv-tl-search-btn,
  .wv-tl-search-btn:focus { opacity: 0.8; }
  .wv-tl-search-btn:active { opacity: 1; color: var(--primary); }
  @media (prefers-reduced-motion: reduce) {
    .wv-tl-card, .wv-tl-spin-chip, .wv-tl-next-collapsed,
    .wv-tl-toggle-btn, .wv-tl-action, .wv-tl-lock-btn { transition: none !important; }
    .wv-tl-card:active, .wv-tl-spin-chip:active,
    .wv-tl-next-collapsed:active, .wv-tl-lock-btn:active { transform: none !important; }
  }
`;

const wvEmptyContainerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
};
const wvEmptyItemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.32, 0.72, 0, 1] } },
};

export default function WeekView({
  days, weekPlan, meals, specialDays,
  onGenerate, onSmartPlan, dietaryPref, onChangeDietaryPref,
  onRespin, onSetDay, onSetSpecial, onViewDetail, onBuildGrocery,
  onToggleLock, onLockAll, onUnlockAll,
  cookingStats = {},
  weekHistory = [],
  onRestoreWeek,
  onRestoreMeal,
  rotationCount = 0,
  showSpinner,
  onCloseSpinner,
  onSpinnerComplete,
  rotationMeals,
  currentPlan,
  recentlyUsedIds = null,
  spinConstraints = null,
  fridgeInventoryNames = [],
  onSpinConstraintsSkipped = null,
  onAddCustomDayTag,
  onDeleteCustomDayTag,
  profileDisplayName,
  onToast,
}) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const currentWeekMonday = useMemo(() => getMonday(today), [today]);

  // Spin Action Center constraints (Vegetarian Only / Under 30 Mins / Use Fridge
  // Stock) pre-filter the candidate pool handed to MealSpinner. This never
  // touches `meals`/`rotationMeals` themselves — those still drive the rest of
  // WeekView (grid, rotation management, etc.) untouched — it's purely what
  // the spinner is allowed to pick from. filterMealsByConstraints guarantees a
  // non-empty pool (skips a constraint rather than starving the spinner) and
  // reports which constraints it had to skip so we can toast an honest heads-up.
  const spinnerPools = useMemo(() => {
    const rotFiltered = filterMealsByConstraints(rotationMeals, spinConstraints, fridgeInventoryNames);
    const allFiltered = filterMealsByConstraints(meals, spinConstraints, fridgeInventoryNames);
    return { rotation: rotFiltered, all: allFiltered };
  }, [meals, rotationMeals, spinConstraints, fridgeInventoryNames]);

  useEffect(() => {
    if (!showSpinner) return;
    const skipped = spinnerPools.rotation.skipped.length > 0 ? spinnerPools.rotation.skipped : spinnerPools.all.skipped;
    if (skipped.length > 0) onSpinConstraintsSkipped?.(skipped);
    // Only fire once per spinner open, not on every pool recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSpinner]);

  const [viewMode, setViewMode] = useState('timeline');
  const [viewYear,  setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [activeDate, setActiveDate] = useState(today);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedDates, setSelectedDates] = useState(new Set());
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [pickerDay, setPickerDay] = useState(null);
  const [slideDir, setSlideDir] = useState(null);
  const [spinnerSelectedIndices, setSpinnerSelectedIndices] = useState(null);
  const [spinnerTargetDates, setSpinnerTargetDates] = useState(null);
  const [grocerySelectMode, setGrocerySelectMode] = useState(false);
  const [groceryDays, setGroceryDays] = useState(new Set());
  const [justCompletedSpin, setJustCompletedSpin] = useState(false);

  // ── Carry-to-place state (tap to pick up, tap to place) ─────────────────────
  // Native HTML5 drag-and-drop (draggable attr + dragstart/dragover/drop) does
  // not fire on touch in iOS Safari and is inconsistent on Android Chrome —
  // that was the real cause of "unclear" drag feedback on this touch-first
  // PWA. Replaced with an explicit pick-up → sticky status bar → tap-to-place
  // flow that behaves identically for touch and mouse and never relies on a
  // gesture the browser might silently swallow.
  const [carry, setCarry] = useState(null); // { meal, date, dayName, key }
  const [prevWeeksExpanded, setPrevWeeksExpanded] = useState(false);
  // Declared here rather than down beside nextWeekDates because handlePickUp
  // (further up this file) calls setNextWeekExpanded(true) to surface both
  // valid drop targets — reading the setter above its own useState made the
  // React Compiler bail out of optimizing this entire component.
  const [nextWeekExpanded, setNextWeekExpanded] = useState(false);

  // ── Search modal state ──────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTargetDate, setSearchTargetDate] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCuisine, setSearchCuisine] = useState('');

  // ── Pantry-Aware Quick Swap drawer state ────────────────────────────────────
  const [pantryMatchTargetDate, setPantryMatchTargetDate] = useState(null);

  // Hardware back / edge-swipe / Escape — innermost Plan UI first (Track 1)
  useBackHandler(!!carry, () => setCarry(null), 'week-carry');
  useBackHandler(!!pickerDay, () => setPickerDay(null), 'week-picker');
  useBackHandler(showDetailPanel, () => setShowDetailPanel(false), 'week-detail');
  useBackHandler(selectMode, () => { setSelectMode(false); setSelectedDates(new Set()); }, 'week-select');
  useBackHandler(grocerySelectMode, () => { setGrocerySelectMode(false); setGroceryDays(new Set()); }, 'week-grocery-select');
  useBackHandler(searchOpen, () => { setSearchOpen(false); setSearchQuery(''); setSearchCuisine(''); }, 'week-search');
  useBackHandler(!!pantryMatchTargetDate, () => setPantryMatchTargetDate(null), 'week-pantry-match');
  const [showCustomDayTagInput, setShowCustomDayTagInput] = useState(false);
  const [showFoodShortcuts, setShowFoodShortcuts] = useState(false);
  const [newDayTagName, setNewDayTagName] = useState('');
  const [newDayTagIcon, setNewDayTagIcon] = useState('🏷️');

  const longPressTimerRef     = useRef(null);
  const longPressRafRef       = useRef(null);
  const isDraggingSelectRef   = useRef(false);
  const lastDragKeyRef        = useRef(null);
  const longPressStartTimeRef = useRef(null);
  const [lpProgress, setLpProgress] = useState(null);

  const calendarCells = useMemo(() => getCalendarCells(viewYear, viewMonth), [viewYear, viewMonth]);
  const calendarGridRef = useRef(null);
  // Timeline scroll pane + the two disclosure panels, so expanding a week can
  // pull its contents into view instead of opening it silently below the fold.
  const timelineScrollRef = useRef(null);
  const nextWeekPanelRef = useRef(null);

  useEffect(() => {
    if (document.getElementById('wv-anim-style')) return;
    const style = document.createElement('style');
    style.id = 'wv-anim-style';
    style.textContent = ANIMATIONS_CSS;
    document.head.appendChild(style);
    return () => {};
  }, []);

  const getMealForDate = useCallback((date) => {
    const dow = date.getDay() === 0 ? 6 : date.getDay() - 1;
    const weekMon = getMonday(date);
    if (weekMon.getTime() === currentWeekMonday.getTime()) {
      return { meal: weekPlan[dow] || null, isCurrent: true, dow };
    }
    const histEntry = weekHistory.find(hw => {
      const hwMon = new Date(hw.weekStart); hwMon.setHours(0,0,0,0);
      return hwMon.getTime() === weekMon.getTime();
    });
    if (histEntry) {
      return { meal: histEntry.meals?.[dow] || null, isCurrent: false, dow, histEntry };
    }
    const isFuture = date > today;
    return { meal: null, isCurrent: false, isFuture, dow };
  }, [weekPlan, weekHistory, currentWeekMonday, today]);

  const handlePrevMonth = useCallback(() => {
    setSlideDir('right');
    setTimeout(() => setSlideDir(null), 320);
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }, [viewMonth]);

  const handleNextMonth = useCallback(() => {
    setSlideDir('left');
    setTimeout(() => setSlideDir(null), 320);
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }, [viewMonth]);

  const handleToday = useCallback(() => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  }, [today]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current)   clearTimeout(longPressTimerRef.current);
    if (longPressRafRef.current)     cancelAnimationFrame(longPressRafRef.current);
    longPressStartTimeRef.current = null;
    setLpProgress(null);
  }, []);

  const handleCellTouchStart = useCallback((e, date) => {
    cancelLongPress();
    const key = dateKey(date);
    longPressStartTimeRef.current = Date.now();

    const animateRing = () => {
      if (!longPressStartTimeRef.current) return;
      const elapsed = Date.now() - longPressStartTimeRef.current;
      const pct = Math.min(elapsed / LONG_PRESS_MS, 1);
      setLpProgress({ key, pct });
      if (pct < 1) longPressRafRef.current = requestAnimationFrame(animateRing);
    };
    longPressRafRef.current = requestAnimationFrame(animateRing);

    longPressTimerRef.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate([20, 10, 40]);
      cancelAnimationFrame(longPressRafRef.current);
      longPressStartTimeRef.current = null;
      setLpProgress(null);
      setSelectMode(true);
      isDraggingSelectRef.current = true;
      lastDragKeyRef.current = key;

      const { isCurrent, isFuture } = getMealForDate(date);
      if (isCurrent || isFuture || date >= today) {
        setSelectedDates(prev => { const n = new Set(prev); n.add(key); return n; });
      }
    }, LONG_PRESS_MS);
  }, [cancelLongPress, getMealForDate, today]);

  const handleCellTouchEnd = useCallback((e) => {
    cancelLongPress();
    isDraggingSelectRef.current = false;
    lastDragKeyRef.current = null;
  }, [cancelLongPress]);

  const handleGridTouchMove = useCallback((e) => {
    if (!isDraggingSelectRef.current) {
      cancelLongPress();
      return;
    }
    e.preventDefault();
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const cell = el?.closest('[data-datekey]');
    if (!cell) return;
    const key = cell.dataset.datekey;
    if (!key || key === lastDragKeyRef.current) return;
    lastDragKeyRef.current = key;
    const date = dateFromKey(key);
    const { isCurrent, isFuture } = getMealForDate(date);
    if (isCurrent || isFuture || date >= today) {
      setSelectedDates(prev => { const n = new Set(prev); n.add(key); return n; });
    }
  }, [cancelLongPress, getMealForDate, today]);

  const handleCellClick = useCallback((date) => {
    if (selectMode) {
      const key = dateKey(date);
      const { isCurrent, isFuture } = getMealForDate(date);
      if (!isCurrent && !isFuture && date < today) return;
      setSelectedDates(prev => {
        const n = new Set(prev);
        if (n.has(key)) n.delete(key); else n.add(key);
        return n;
      });
    } else {
      setActiveDate(date);
      setShowDetailPanel(true);
    }
  }, [selectMode, getMealForDate, today]);

  const handleSpinSelected = useCallback(() => {
    navigator.vibrate?.([50, 30, 50]);
    const sortedDates = Array.from(selectedDates)
      .map(key => dateFromKey(key))
      .sort((a, b) => a - b);
    if (sortedDates.length === 0) return;
    const indices = sortedDates.map(date => date.getDay() === 0 ? 6 : date.getDay() - 1);
    setSpinnerTargetDates(sortedDates);
    setSpinnerSelectedIndices(indices);
    setSelectMode(false);
    setSelectedDates(new Set());
    onGenerate();
  }, [selectedDates, onGenerate]);

  const spinnerSlotDates = useMemo(() => {
    if (spinnerTargetDates && spinnerTargetDates.length > 0) return spinnerTargetDates;
    return [0,1,2,3,4,5,6].map(idx => addDays(currentWeekMonday, idx));
  }, [spinnerTargetDates, currentWeekMonday]);

  const openPicker = useCallback((date) => {
    const dow = date.getDay() === 0 ? 6 : date.getDay() - 1;
    setPickerDay(dow);
  }, []);
  const closePicker = useCallback(() => setPickerDay(null), []);

  // ── Carry-to-place handlers ──────────────────────────────────────────────────
  // Tap a meal's grip to pick it up (or tap the same grip again / the source
  // card to put it back down). While carrying, eligible days in "This week"
  // and "Next week" light up as valid drop targets — tap one to place a copy.
  const handlePickUp = useCallback((date, meal) => {
    if (!meal || meal._special) return;
    const key = dateKey(date);
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    setCarry(prev => {
      if (prev && prev.key === key) return null; // tapping the same grip cancels
      return { meal, date, dayName: dayNames[date.getDay()], key };
    });
    navigator.vibrate?.([15]);
    setNextWeekExpanded(true); // surface both valid target weeks immediately
  }, []);

  const handleCancelCarry = useCallback(() => setCarry(null), []);

  const handlePlaceCarry = useCallback((targetDate) => {
    if (!carry) return;
    const tgtKey = dateKey(targetDate);
    if (tgtKey === carry.key) { setCarry(null); return; }

    const targetDow = targetDate.getDay() === 0 ? 6 : targetDate.getDay() - 1;
    const targetWeekMon = getMonday(targetDate);
    const isTargetCurrentWeek = targetWeekMon.getTime() === currentWeekMonday.getTime();

    // Copy the meal (strip _locked so the copy is unlocked)
    const mealCopy = { ...carry.meal };
    delete mealCopy._locked;

    if (isTargetCurrentWeek) {
      onSetDay(targetDow, mealCopy);
    } else {
      onSpinnerComplete([{ date: targetDate, meal: mealCopy }]);
    }

    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const srcLabel = carry.dayName;
    const tgtLabel = dayNames[targetDate.getDay()];
    onToast?.(`Copied from ${srcLabel} → ${tgtLabel}`);
    navigator.vibrate?.([30, 20, 30]);
    setCarry(null);
  }, [carry, currentWeekMonday, onSetDay, onSpinnerComplete, onToast]);

  // ── Drag-and-drop day swap ───────────────────────────────────────────────────
  // Complements carry (tap-to-pick-up/tap-to-place, which COPIES a meal — used
  // for longer-distance moves across scroll distance/weeks, e.g. pulling a meal
  // up from Previous Weeks). This is a direct physical drag of the grip handle
  // onto another visible day card, and it SWAPS — both days trade meals in one
  // gesture. Only wired for This/Next week (both usually on-screen together);
  // Previous Weeks stays carry-only since you can't drag onto a card that's
  // scrolled out of view. Routes through the same onSpinnerComplete/
  // applySpinResults path as carry's cross-week copy, which already resolves
  // "which week does this date belong to" for both sides of the swap in one
  // batched, offline-first Dexie write.
  const handleDragSwap = useCallback((sourceDate, sourceMeal, targetDateKey) => {
    if (!sourceMeal || sourceMeal._special) return;
    const srcKey = dateKey(sourceDate);
    if (!targetDateKey || targetDateKey === srcKey) return;
    const targetDate = dateFromKey(targetDateKey);
    if (targetDate < today) return; // can't swap a meal into the past

    const { meal: targetMeal } = getMealForDate(targetDate);
    const srcCopy = { ...sourceMeal }; delete srcCopy._locked;
    const tgtCopy = targetMeal ? { ...targetMeal } : null;
    if (tgtCopy) delete tgtCopy._locked;

    onSpinnerComplete([
      { date: sourceDate, meal: tgtCopy },
      { date: targetDate, meal: srcCopy },
    ]);

    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    onToast?.(`Swapped ${dayNames[sourceDate.getDay()]} ↔ ${dayNames[targetDate.getDay()]}`);
    navigator.vibrate?.([25, 15, 25, 15, 40]);
  }, [today, getMealForDate, onSpinnerComplete, onToast]);

  // ── Batch Cook & Leftover Chaining ───────────────────────────────────────────
  // "Cook 2x" tags the current day (_leftoverChainNext) and clones the meal
  // into tomorrow marked as an echo (_leftoverOf: <recipe id>). buildGroceryList
  // (App.jsx) skips any meal with _leftoverOf set, so the leftover day never
  // double-counts ingredients that were already shopped for on the cook day —
  // that's the "discount duplicate grocery items" half of this feature.
  // Scoped to the current week only (dow 0-5 → dow+1 stays in-bounds of
  // weekPlan); chaining across a week boundary would need to write into next
  // week's history via applySpinResults, deliberately left for a follow-up.
  const handleToggleBatchCook = useCallback((dow) => {
    const meal = weekPlan[dow];
    if (!meal || meal._special || dow >= 6) return;
    const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

    if (meal._leftoverChainNext) {
      // Un-chain: clear the source flag, and clear tomorrow's slot only if
      // it's still the untouched echo (don't clobber a meal the user picked
      // for tomorrow since).
      const sourceCopy = { ...meal };
      delete sourceCopy._leftoverChainNext;
      onSetDay(dow, sourceCopy);
      const next = weekPlan[dow + 1];
      if (next && next._leftoverOf === (meal.id || meal.name)) {
        onSetDay(dow + 1, null);
      }
      onToast?.('Leftover plan cancelled');
      return;
    }

    const sourceCopy = { ...meal, _leftoverChainNext: true };
    const leftoverCopy = { ...meal, _leftoverOf: meal.id || meal.name };
    delete leftoverCopy._locked;
    delete leftoverCopy._leftoverChainNext;
    onSetDay(dow, sourceCopy);
    onSetDay(dow + 1, leftoverCopy);
    onToast?.(`Leftovers queued for ${dayNames[dow + 1]} 🍱`);
    navigator.vibrate?.([20, 15, 20]);
  }, [weekPlan, onSetDay, onToast]);

  // ── Search modal handlers ──────────────────────────────────────────────────
  const openSearchForDate = useCallback((date) => {
    setSearchTargetDate(date);
    setSearchQuery('');
    setSearchCuisine('');
    setSearchOpen(true);
  }, []);

  const handleSearchSelect = useCallback((meal) => {
    if (!searchTargetDate) return;
    const targetDow = searchTargetDate.getDay() === 0 ? 6 : searchTargetDate.getDay() - 1;
    const targetWeekMon = getMonday(searchTargetDate);
    const isTargetCurrentWeek = targetWeekMon.getTime() === currentWeekMonday.getTime();

    if (isTargetCurrentWeek) {
      onSetDay(targetDow, meal);
    } else {
      onSpinnerComplete([{ date: searchTargetDate, meal }]);
    }

    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    onToast?.(`${dayNames[searchTargetDate.getDay()]} → ${meal.name}`);
    setSearchOpen(false);
    setSearchQuery('');
    setSearchCuisine('');
  }, [searchTargetDate, currentWeekMonday, onSetDay, onSpinnerComplete, onToast]);

  // ── Pantry-Aware Quick Swap ──────────────────────────────────────────────────
  // "Spin" still does an instant, blind random pick (unchanged — fast path
  // preserved). This is the deliberate, considered alternative: rank The
  // Rotation (falling back to the full library when it's empty, same fallback
  // respinDay uses) by how much of each recipe is already sitting in the
  // pantry/fridge, via the same fridgeMatchRatio scorer that already powers
  // the "Use Fridge Stock" spin constraint — one matching algorithm, two entry
  // points, instead of a second competing implementation.
  const openPantryMatchForDate = useCallback((date) => {
    setPantryMatchTargetDate(date);
  }, []);

  const pantryMatchRanked = useMemo(() => {
    const pool = rotationMeals && rotationMeals.length > 0 ? rotationMeals : meals;
    return pool
      .map(meal => ({ meal, score: fridgeMatchRatio(meal, fridgeInventoryNames) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
  }, [rotationMeals, meals, fridgeInventoryNames]);

  const handlePantryMatchSelect = useCallback((meal) => {
    if (!pantryMatchTargetDate) return;
    const targetDow = pantryMatchTargetDate.getDay() === 0 ? 6 : pantryMatchTargetDate.getDay() - 1;
    const targetWeekMon = getMonday(pantryMatchTargetDate);
    const isTargetCurrentWeek = targetWeekMon.getTime() === currentWeekMonday.getTime();

    if (isTargetCurrentWeek) {
      onSetDay(targetDow, meal);
    } else {
      onSpinnerComplete([{ date: pantryMatchTargetDate, meal }]);
    }

    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    onToast?.(`${dayNames[pantryMatchTargetDate.getDay()]} → ${meal.name}`);
    setPantryMatchTargetDate(null);
  }, [pantryMatchTargetDate, currentWeekMonday, onSetDay, onSpinnerComplete, onToast]);

  const availableCuisines = useMemo(() => {
    const cats = new Set();
    meals.forEach(m => { if (m.category) cats.add(m.category); });
    return [...cats].sort();
  }, [meals]);

  const filteredSearchMeals = useMemo(() => {
    let result = meals;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(m =>
        m.name?.toLowerCase().includes(q) ||
        m.category?.toLowerCase().includes(q) ||
        m.labels?.some(l => l.toLowerCase().includes(q))
      );
    }
    if (searchCuisine) {
      result = result.filter(m => m.category === searchCuisine);
    }
    return result;
  }, [meals, searchQuery, searchCuisine]);

  // Determine if activeDate falls in the current week — if not, assignments
  // must route through onSpinnerComplete (saves to weekHistory) rather than
  // onSetDay (only writes weekPlan — the current week).
  const isActiveDateCurrentWeek = useMemo(() => {
    const activeMon = getMonday(activeDate);
    return activeMon.getTime() === currentWeekMonday.getTime();
  }, [activeDate, currentWeekMonday]);

  // Spin a single future-week day: opens the spinner targeted at exactly that date.
  const handleSpinForDate = useCallback((date) => {
    const dates = [date];
    const indices = dates.map(d => d.getDay() === 0 ? 6 : d.getDay() - 1);
    setSpinnerTargetDates(dates);
    setSpinnerSelectedIndices(indices);
    navigator.vibrate?.([40, 25, 40]);
    onGenerate();
  }, [onGenerate]);

  // Fills all 7 days of next week in one go — the spinner already supports
  // targeting an arbitrary set of dates (used for multi-select), so this just
  // points it at the whole next-week range instead of a hand-picked subset.
  const handleAutoPlanNextWeek = useCallback((dates) => {
    const indices = dates.map(d => d.getDay() === 0 ? 6 : d.getDay() - 1);
    setSpinnerTargetDates(dates);
    setSpinnerSelectedIndices(indices);
    navigator.vibrate?.([50, 30, 50]);
    onGenerate();
  }, [onGenerate]);

  const renderPicker = () => {
    if (pickerDay === null) return null;
    const { meal: currentMeal } = getMealForDate(activeDate);
    const isPastDay = activeDate < today && !isSameDay(activeDate, today);
    return (
      <div className="pk-overlay" onClick={closePicker}>
        <div className="pk-sheet" onClick={e => e.stopPropagation()}
          style={{ animation: 'wv-slideUp 0.28s cubic-bezier(0.32,0.72,0,1) both' }}>
          <div className="pk-handle" />
          <div className="pk-hdr">
            <h3>Choose for {DAY_FULL[pickerDay]}</h3>
            <button className="pk-close" onClick={closePicker}>✕</button>
          </div>
          {!isPastDay && (<>
            {(() => {
              const PINNED_IDS = new Set(['__eat_out__', '__leftovers__', '__dealers_choice__', '__skip__']);
              const pinned = specialDays.filter(s => PINNED_IDS.has(s.id));
              const food = specialDays.filter(s => !PINNED_IDS.has(s.id));
              const renderChip = (s) => (
                <button key={s.id} className="pk-chip"
                  onClick={() => {
                    if (isActiveDateCurrentWeek) {
                      onSetSpecial(pickerDay, s.id);
                    } else {
                      onSpinnerComplete([{ date: activeDate, meal: { ...s, _special: true } }]);
                    }
                    closePicker();
                  }}
                  style={{ position: 'relative' }}
                >
                  <span>{s.icon}</span> {s.name}
                  {s._custom && onDeleteCustomDayTag && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Remove "${s.name}" from quick options?`)) {
                          onDeleteCustomDayTag(s._dbId);
                        }
                      }}
                      style={{
                        marginLeft: 4, fontSize: 10, opacity: 0.5,
                        cursor: 'pointer', lineHeight: 1,
                      }}
                    >✕</span>
                  )}
                </button>
              );
              return (
                <>
                  {/* Pinned row — always visible utility options */}
                  <div className="pk-specials pk-specials-pinned">
                    {pinned.map(renderChip)}
                    {currentMeal && (
                      <button className="pk-chip clear"
                        onClick={() => {
                          if (isActiveDateCurrentWeek) {
                            onSetSpecial(pickerDay, null);
                          } else {
                            onSpinnerComplete([{ date: activeDate, meal: null }]);
                          }
                          closePicker();
                        }}>
                        ✕ Clear
                      </button>
                    )}
                  </div>
                  {/* Expandable row — food shortcuts + custom tags */}
                  <button
                    className="pk-expand-toggle"
                    onClick={() => setShowFoodShortcuts(v => !v)}
                  >
                    {showFoodShortcuts ? '▾ Food shortcuts' : '▸ Food shortcuts'}
                    <span className="pk-expand-count">{food.length}</span>
                  </button>
                  {showFoodShortcuts && (
                    <div className="pk-specials pk-specials-food" style={{ animation: 'fadeSlideDown .2s cubic-bezier(.32,.72,0,1)' }}>
                      {food.map(renderChip)}
                      {onAddCustomDayTag && (
                        <button
                          className="pk-chip"
                          onClick={() => setShowCustomDayTagInput(true)}
                          style={{ borderStyle: 'dashed', opacity: 0.7 }}
                        >
                          <Plus size={12} strokeWidth={2.5} /> Custom
                        </button>
                      )}
                    </div>
                  )}
                </>
              );
            })()}

            {showCustomDayTagInput && (
              <div className="pk-custom-input" style={{
                display: 'flex', gap: 6, alignItems: 'center', padding: '6px 0',
                animation: 'fadeSlideDown .25s cubic-bezier(.32,.72,0,1)',
              }}>
                <input
                  autoFocus
                  value={newDayTagName}
                  onChange={e => setNewDayTagName(e.target.value)}
                  placeholder="Tag name…"
                  maxLength={20}
                  style={{
                    flex: 1, padding: '7px 10px', borderRadius: 8,
                    border: '1px solid var(--border, #3a3a3a)',
                    background: 'var(--surface-raised, #1e1e1e)',
                    color: 'var(--text, #fff)', fontSize: 13,
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newDayTagName.trim()) {
                      onAddCustomDayTag({ name: newDayTagName.trim(), icon: newDayTagIcon });
                      setNewDayTagName(''); setShowCustomDayTagInput(false);
                    } else if (e.key === 'Escape') {
                      setShowCustomDayTagInput(false); setNewDayTagName('');
                    }
                  }}
                />
                <select
                  value={newDayTagIcon}
                  onChange={e => setNewDayTagIcon(e.target.value)}
                  style={{
                    padding: '6px 4px', borderRadius: 8, fontSize: 16,
                    border: '1px solid var(--border, #3a3a3a)',
                    background: 'var(--surface-raised, #1e1e1e)',
                    color: 'var(--text, #fff)', width: 44, textAlign: 'center',
                  }}
                >
                  {['🏷️','🍖','🥘','🫕','🥙','🍱','🥓','🧆','🌯','🥗','🫔','🍛'].map(em => (
                    <option key={em} value={em}>{em}</option>
                  ))}
                </select>
                <button
                  disabled={!newDayTagName.trim()}
                  onClick={() => {
                    if (newDayTagName.trim()) {
                      onAddCustomDayTag({ name: newDayTagName.trim(), icon: newDayTagIcon });
                      setNewDayTagName(''); setShowCustomDayTagInput(false);
                    }
                  }}
                  style={{
                    padding: '6px 12px', borderRadius: 8, fontWeight: 600, fontSize: 12,
                    background: newDayTagName.trim() ? 'var(--accent, #FF6B35)' : '#333',
                    color: '#fff', border: 'none', cursor: newDayTagName.trim() ? 'pointer' : 'default',
                    transition: 'background .2s cubic-bezier(.32,.72,0,1)',
                  }}
                >Add</button>
                <button
                  onClick={() => { setShowCustomDayTagInput(false); setNewDayTagName(''); }}
                  style={{
                    padding: '6px 8px', borderRadius: 8, fontSize: 12,
                    background: 'transparent', color: 'var(--text-muted, #888)',
                    border: '1px solid var(--border, #3a3a3a)', cursor: 'pointer',
                  }}
                >✕</button>
              </div>
            )}
          </>)}
          <div className="pk-list">
            {meals.map(meal => {
              const isCur = currentMeal && !currentMeal._special && currentMeal.id === meal.id;
              return (
                <div key={meal.id} className={`pk-item ${isCur ? 'current' : ''}`}
                  onClick={() => {
                    if (isActiveDateCurrentWeek) {
                      onSetDay(pickerDay, meal);
                    } else {
                      onSpinnerComplete([{ date: activeDate, meal }]);
                    }
                    closePicker();
                  }}>
                  <MealImage src={meal.imageUrl} alt="" className="pk-img" fallbackClass="pk-img-ph" />
                  <div className="pk-info">
                    <span className="pk-name">{meal.name}</span>
                    <span className="pk-meta">
                      {meal.ingredients?.length || 0} ingredients
                      {meal.category ? ` · ${meal.category}` : ''}
                      {meal.inRotation && ' · 🔄'}
                    </span>
                  </div>
                  {isCur && <span className="pk-badge">current</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const isCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth();
  const plannedCount   = weekPlan.filter(Boolean).length;
  const hasWeek        = plannedCount > 0;
  const allWeekLocked  = hasWeek && weekPlan.filter(Boolean).every(m => m._locked);

  const thisWeekDates = useMemo(() =>
    [0,1,2,3,4,5,6].map(i => addDays(currentWeekMonday, i)), [currentWeekMonday]);
  const nextWeekMonday = useMemo(() => addDays(currentWeekMonday, 7), [currentWeekMonday]);
  const nextWeekDates = useMemo(() =>
    [0,1,2,3,4,5,6].map(i => addDays(nextWeekMonday, i)), [nextWeekMonday]);
  // nextWeekExpanded now lives with the rest of the state up top — see the note
  // beside its useState for why.

  const nextWeekPlannedCount = useMemo(() => {
    return nextWeekDates.filter(d => {
      const { meal } = getMealForDate(d);
      return !!meal;
    }).length;
  }, [nextWeekDates, getMealForDate]);

  // Expanding Next week used to open the panel below the fold with no scroll —
  // on a phone the toggle sits near the bottom of the pane, so the week
  // appeared not to open at all. Pull the panel into view once its
  // height:auto animation has laid out.
  const handleToggleNextWeek = useCallback(() => {
    const willExpand = !nextWeekExpanded;
    setNextWeekExpanded(willExpand);
    if (!willExpand) return;
    // Two frames: one for React to mount the panel, one for framer-motion to
    // resolve height:auto into a real measurement before we scroll to it.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      nextWeekPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }));
  }, [nextWeekExpanded]);

  // How many planned meals are locked? Used for grocery shortcut + export.
  const lockedMealCount = useMemo(
    () => weekPlan.filter(m => m && m._locked).length,
    [weekPlan],
  );

  const enterGroceryMode = useCallback(() => {
    // Shortcut: if any meals are locked, build grocery list directly from
    // locked days — skip the day-picker altogether. If nothing is locked,
    // fall back to the existing day-picker flow.
    if (lockedMealCount > 0) {
      onBuildGrocery(undefined, { lockedOnly: true });
      return;
    }
    const autoSelected = new Set();
    thisWeekDates.forEach(d => {
      const { meal } = getMealForDate(d);
      if (meal && !meal._special) autoSelected.add(dateKey(d));
    });
    setGroceryDays(autoSelected);
    setGrocerySelectMode(true);
    setSelectMode(false);
    setSelectedDates(new Set());
  }, [thisWeekDates, getMealForDate, lockedMealCount, onBuildGrocery]);

  const handleGroceryToggle = useCallback((key) => {
    setGroceryDays(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  }, []);

  const handleGroceryBuild = useCallback(() => {
    const indices = Array.from(groceryDays)
      .map(key => dateFromKey(key))
      .filter(d => {
        const wm = getMonday(d);
        return wm.getTime() === currentWeekMonday.getTime();
      })
      .map(d => d.getDay() === 0 ? 6 : d.getDay() - 1);
    onBuildGrocery(indices.length > 0 ? indices : undefined);
    setGrocerySelectMode(false);
    setGroceryDays(new Set());
  }, [groceryDays, currentWeekMonday, onBuildGrocery]);

  const cancelGroceryMode = useCallback(() => {
    setGrocerySelectMode(false);
    setGroceryDays(new Set());
  }, []);

  const groceryDayCount = groceryDays.size;

  // ── Export / Share Plan ──────────────────────────────────────────────────────
  const buildPlanText = useCallback(() => {
    const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const lines = DAY_NAMES.map((day, i) => {
      const meal = weekPlan[i];
      if (!meal) return `${day}: —`;
      if (meal._special) return `${day}: ${meal.icon || ''} ${meal.name}`.trim();
      const lock = meal._locked ? ' [locked]' : '';
      return `${day}: ${meal.name}${lock}`;
    });
    return lines.join('\n');
  }, [weekPlan]);

  const handleSharePlan = useCallback(async () => {
    const planText = buildPlanText();
    const title = 'This Week\'s Meal Plan';
    const shareBody = `${title}\n\n${planText}\n\n— SpiceHub`;
    if (navigator.share) {
      try {
        await navigator.share({ title, text: shareBody });
        return;
      } catch { /* user cancelled or share failed — fall through to clipboard */ }
    }
    try {
      await navigator.clipboard.writeText(shareBody);
      onToast?.('Copied meal plan to clipboard!', 'success');
    } catch {
      onToast?.('Could not copy to clipboard', 'error');
    }
  }, [buildPlanText, onToast]);

  return (
    <div
      className="wv-plan-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        /* Without min-height:0 a flex column refuses to shrink below its
           content, so the timeline pane below (flex:1 + overflow-y:auto) grows
           instead of scrolling and its lower rows end up under the tab bar.
           Chrome papers over this more often than iOS Safari does. */
        minHeight: 0,
        background: 'var(--bg)',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 12px 8px',
        background: 'var(--card)',
        borderBottom: '1px solid var(--border)',
      }}>
        {viewMode === 'month' ? (
          <>
            <button onClick={handlePrevMonth} style={NAV_BTN}>‹</button>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)',
                animation: slideDir ? `wv-slideIn${slideDir === 'left' ? 'Left' : 'Right'} 0.28s ease both` : undefined,
              }}>
                {MONTH_NAMES[viewMonth]} {viewYear}
              </span>
            </div>
            {!isCurrentMonth && (
              <button onClick={handleToday} style={TODAY_BTN}>Today</button>
            )}
          </>
        ) : (
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>
              Your Rotation
            </span>
          </div>
        )}

        <ViewToggle viewMode={viewMode} onChangeMode={setViewMode} />

        {viewMode === 'month' && (
          <button onClick={handleNextMonth} style={NAV_BTN}>›</button>
        )}
      </div>

      {selectMode && !grocerySelectMode && (
        <div style={{
          background: 'var(--primary)', color: 'white',
          padding: '6px 16px', fontSize: 12, fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          animation: 'wv-fadeIn 0.2s ease both',
        }}>
          <span>{viewMode === 'timeline' ? 'Tap days to select' : 'Tap or drag days to select · Long-press starts here too'}</span>
          {selectedDates.size > 0 && (
            <span style={{
              background: 'rgba(255,255,255,0.25)', borderRadius: 10,
              padding: '1px 8px',
            }}>{selectedDates.size} selected</span>
          )}
        </div>
      )}

      {grocerySelectMode && (
        <div className="grocery-mode-bar">
          <span><ShoppingCart size={13} strokeWidth={2.5} style={{ verticalAlign: 'middle', marginRight: 4 }} />Tap days to include in grocery list</span>
          <span className="gm-count" style={{ borderRadius: 10 }}>{groceryDayCount} day{groceryDayCount !== 1 ? 's' : ''}</span>
        </div>
      )}

      {viewMode === 'month' && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
          background: 'var(--card)', borderBottom: '1px solid var(--border)',
          paddingBottom: 4,
        }}>
          {DAY_LABELS.map((d, i) => (
            <div key={d} style={{
              textAlign: 'center', fontSize: 11, fontWeight: 700,
              color: (i === 0 || i === 6) ? 'var(--primary)' : 'var(--text-muted)',
              padding: '6px 0 2px', letterSpacing: '0.3px',
            }}>{d}</div>
          ))}
        </div>
      )}

      {viewMode === 'timeline' && (
        <div
          ref={timelineScrollRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            overscrollBehaviorY: 'contain',
            paddingTop: 4,
            /* Was a flat 8px, which left the expanded Next week panel's last
               row sitting under the fixed .tab-bar (52px + safe-area inset) on
               iPhone — the panel opened but you could not scroll to it. */
            paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
            position: 'relative',
          }}
        >

          {/* ── Carry status bar — sticky so it stays visible while you scroll to find a spot ── */}
          <AnimatePresence>
            {carry && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                className="wv-carry-bar"
              >
                <div className="wv-carry-grip"><GripVertical size={15} strokeWidth={2.5} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="wv-carry-name">{carry.meal.name}</div>
                  <div className="wv-carry-hint">Picked up from {carry.dayName} · tap a highlighted day to place it</div>
                </div>
                <button className="wv-carry-cancel" onClick={handleCancelCarry}>Cancel</button>
              </motion.div>
            )}
          </AnimatePresence>

          <PreviousWeeksSection
            currentWeekMonday={currentWeekMonday}
            weekHistory={weekHistory}
            today={today}
            getMealForDate={getMealForDate}
            expanded={prevWeeksExpanded}
            onToggleExpanded={() => setPrevWeeksExpanded(x => !x)}
            carry={carry}
            onPickUp={handlePickUp}
            onOpenMonthView={() => setViewMode('month')}
          />

          <div className="wv-tl-section-header">
            <span className="wv-tl-section-title">
              This week{' '}
              <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                {thisWeekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {thisWeekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </span>
            <span className="wv-tl-section-badge">
              {plannedCount}/7 planned
            </span>
          </div>

          {/* ── Contextual sub-header — week-level actions live right under the
              week they act on, instead of scattered in a bottom control stack. ── */}
          {!selectMode && !grocerySelectMode && !carry && (
            <div className="wv-week-toolbar">
              <button
                type="button"
                className="wv-week-toolbar-btn primary"
                onClick={() => { setJustCompletedSpin(false); navigator.vibrate?.([50, 30, 50]); onGenerate(); }}
              >
                <RefreshCw size={13} strokeWidth={2.5} /> Spin the week
              </button>

              {(onLockAll || onUnlockAll) && hasWeek && (
                <button
                  type="button"
                  className="wv-week-toolbar-btn"
                  onClick={() => {
                    setJustCompletedSpin(false);
                    if (allWeekLocked) onUnlockAll?.(); else onLockAll?.();
                  }}
                >
                  {allWeekLocked
                    ? <><LockKeyholeOpen size={13} strokeWidth={2.5} /> Unlock All</>
                    : <><LockKeyhole size={13} strokeWidth={2.5} /> Lock All</>
                  }
                </button>
              )}

              {hasWeek && (
                <button
                  type="button"
                  className="wv-week-toolbar-btn"
                  onClick={handleSharePlan}
                  aria-label="Share meal plan"
                >
                  <Share2 size={13} strokeWidth={2.5} /> Share
                </button>
              )}

              {onChangeDietaryPref && (
                <select
                  className="wv-diet-pill"
                  value={dietaryPref?.dietary || ''}
                  onChange={(e) => onChangeDietaryPref({ dietary: e.target.value, mode: 'require' })}
                  aria-label="Diet filter"
                >
                  <option value="">Any diet</option>
                  <option value="vegetarian">Vegetarian</option>
                  <option value="vegan">Vegan</option>
                  <option value="gluten-free">Gluten-free</option>
                  <option value="dairy-free">Dairy-free</option>
                  <option value="keto">Keto</option>
                  <option value="paleo">Paleo</option>
                </select>
              )}
            </div>
          )}

          {!selectMode && !grocerySelectMode && !carry && (
            <WeekSummaryStrip weekPlan={weekPlan} dietaryPref={dietaryPref} />
          )}

          <TimelineWeek
            weekDates={thisWeekDates}
            today={today}
            getMealForDate={getMealForDate}
            currentWeekMonday={currentWeekMonday}
            selectMode={selectMode}
            selectedDates={selectedDates}
            onCellClick={handleCellClick}
            onToggleSelect={(key) => {
              setSelectedDates(prev => {
                const n = new Set(prev);
                if (n.has(key)) n.delete(key); else n.add(key);
                return n;
              });
            }}
            onRespin={onRespin}
            onSpinForDate={handleSpinForDate}
            onToggleLock={onToggleLock}
            grocerySelectMode={grocerySelectMode}
            groceryDays={groceryDays}
            onGroceryToggle={handleGroceryToggle}
            carry={carry}
            onPickUp={handlePickUp}
            onPlace={handlePlaceCarry}
            allowDropTarget
            onOpenSearch={openSearchForDate}
            onSwapDrag={handleDragSwap}
          />

          <WeekDisclosureToggle
            id="wv-next-week"
            title="Next week"
            subtitle={
              <>
                {nextWeekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {nextWeekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                <span style={{ marginLeft: 6 }}>{nextWeekPlannedCount}/7 planned</span>
              </>
            }
            expanded={nextWeekExpanded}
            onToggle={handleToggleNextWeek}
          />

          <AnimatePresence>
            {nextWeekExpanded && (
              <motion.div
                id="wv-next-week-panel"
                ref={nextWeekPanelRef}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                style={{ overflow: 'hidden' }}
              >
                {/* An empty next week doesn't need 7 stacked "tap to add or spin"
                    placeholders — one CTA plus a day-chip row says the same thing
                    in a fifth of the space. Carrying a meal is the exception: the
                    real rows are needed as actual drop targets. */}
                {nextWeekPlannedCount === 0 && !carry && !selectMode && !grocerySelectMode ? (
                  <NextWeekEmptyHero
                    weekDates={nextWeekDates}
                    onAutoPlan={() => handleAutoPlanNextWeek(nextWeekDates)}
                    onDayTap={(date) => { setActiveDate(date); setShowDetailPanel(true); }}
                  />
                ) : (
                  <TimelineWeek
                    weekDates={nextWeekDates}
                    today={today}
                    getMealForDate={getMealForDate}
                    currentWeekMonday={currentWeekMonday}
                    selectMode={selectMode}
                    selectedDates={selectedDates}
                    onCellClick={handleCellClick}
                    onToggleSelect={(key) => {
                      setSelectedDates(prev => {
                        const n = new Set(prev);
                        if (n.has(key)) n.delete(key); else n.add(key);
                        return n;
                      });
                    }}
                    onRespin={onRespin}
                    onSpinForDate={handleSpinForDate}
                    onToggleLock={onToggleLock}
                    grocerySelectMode={grocerySelectMode}
                    groceryDays={groceryDays}
                    onGroceryToggle={handleGroceryToggle}
                    carry={carry}
                    onPickUp={handlePickUp}
                    onPlace={handlePlaceCarry}
                    allowDropTarget
                    onOpenSearch={openSearchForDate}
                    onSwapDrag={handleDragSwap}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {viewMode === 'month' && <div
        ref={calendarGridRef}
        onTouchMove={handleGridTouchMove}
        style={{
          flex: 1, display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 1, background: 'var(--border)',
          padding: 1, overflowY: 'auto',
          animation: slideDir ? `wv-slideIn${slideDir === 'left' ? 'Left' : 'Right'} 0.28s ease both` : undefined,
        }}
      >
        {calendarCells.map((date) => {
          const key = dateKey(date);
          const isThisMonth = date.getMonth() === viewMonth;
          const isToday     = isSameDay(date, today);
          const isPast      = date < today && !isToday;
          const isSelected  = selectedDates.has(key);
          const isDow56     = date.getDay() === 0 || date.getDay() === 6;
          const { meal }    = getMealForDate(date);
          const isLocked    = meal && meal._locked;
          const isSpecial   = meal && meal._special;
          const lpKey       = lpProgress?.key;
          const showLPRing  = lpKey === key && lpProgress.pct > 0;

          return (
            <div
              key={key}
              data-datekey={key}
              onClick={() => handleCellClick(date)}
              onTouchStart={(e) => handleCellTouchStart(e, date)}
              onTouchEnd={handleCellTouchEnd}
              onTouchCancel={handleCellTouchEnd}
              className={isSelected ? 'wv-cell-selected' : undefined}
              style={{
                position: 'relative',
                background: isToday
                  ? 'var(--primary)'
                  : isSelected
                    ? 'rgba(230,81,0,0.14)'
                    : 'var(--card)',
                padding: '5px 4px 4px',
                minHeight: 76,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                cursor: 'pointer',
                opacity: isThisMonth ? 1 : 0.28,
                transition: 'background 0.18s ease, opacity 0.15s ease',
                outline: isSelected ? '2px solid var(--primary)' : undefined,
                outlineOffset: -2,
                overflow: 'hidden',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {showLPRing && (
                <svg
                  viewBox="0 0 40 40"
                  style={{
                    position: 'absolute', inset: 0, width: '100%', height: '100%',
                    pointerEvents: 'none', zIndex: 10,
                  }}
                >
                  <circle cx="20" cy="20" r="17"
                    fill="none" stroke="var(--primary)" strokeWidth="2.5"
                    strokeDasharray={`${lpProgress.pct * 107} 107`}
                    strokeLinecap="round"
                    style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
                  />
                </svg>
              )}

              {isSelected && (
                <div style={{
                  position: 'absolute', inset: 0, pointerEvents: 'none',
                  background: 'rgba(230,81,0,0.08)',
                }} />
              )}

              <div style={{
                width: 24, height: 24,
                borderRadius: '50%',
                background: isToday ? 'rgba(255,255,255,0.22)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <span style={{
                  fontSize: 13, fontWeight: isToday ? 800 : isPast ? 400 : 600,
                  color: isToday ? 'white' : isDow56 ? 'var(--primary)' : isPast ? 'var(--text-muted)' : 'var(--text)',
                }}>
                  {date.getDate()}
                </span>
              </div>

              {isLocked && (
                <span style={{ fontSize: 8, lineHeight: 1, marginTop: 1 }}>🔒</span>
              )}

              {meal && !isSpecial && (
                <div style={{
                  flex: 1, width: '100%', marginTop: 3,
                  animation: 'wv-mealFadeIn 0.25s ease both',
                }}>
                  {meal.imageUrl ? (
                    <img
                      src={meal.imageUrl} alt=""
                      style={{
                        width: '100%', height: 30,
                        objectFit: 'cover', borderRadius: 4,
                        display: 'block',
                      }}
                      onError={e => e.target.style.display = 'none'}
                    />
                  ) : (
                    <div style={{
                      width: '100%',
                      background: isToday
                        ? 'rgba(255,255,255,0.2)'
                        : isSelected
                          ? 'rgba(230,81,0,0.18)'
                          : 'var(--surface)',
                      borderRadius: 4,
                      padding: '2px 3px',
                      fontSize: 9, lineHeight: 1.35, fontWeight: 600,
                      color: isToday ? 'white' : 'var(--text)',
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}>
                      {meal.name}
                    </div>
                  )}
                </div>
              )}

              {isSpecial && (
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, marginTop: 2,
                  animation: 'wv-mealFadeIn 0.2s ease both',
                }}>
                  {meal.icon}
                </div>
              )}

              {!meal && !isPast && isThisMonth && (
                <div style={{
                  marginTop: 'auto', width: 4, height: 4, borderRadius: '50%',
                  background: isToday ? 'rgba(255,255,255,0.4)' : 'var(--border)',
                  alignSelf: 'center',
                }} />
              )}
            </div>
          );
        })}
      </div>}

      <DetailPanel
        show={showDetailPanel}
        activeDate={activeDate}
        today={today}
        getMealForDate={getMealForDate}
        isCurrentWeek={isActiveDateCurrentWeek}
        onClose={() => setShowDetailPanel(false)}
        onToggleLock={onToggleLock}
        onViewDetail={(meal) => { setShowDetailPanel(false); onViewDetail(meal); }}
        onRespin={(dow) => { onRespin(dow); setShowDetailPanel(false); }}
        onSpinForDate={(date) => { handleSpinForDate(date); setShowDetailPanel(false); }}
        onOpenPantryMatch={() => { openPantryMatchForDate(activeDate); setShowDetailPanel(false); }}
        onToggleBatchCook={handleToggleBatchCook}
        onOpenPicker={() => { openPicker(activeDate); setShowDetailPanel(false); }}
        onClearDay={(dow) => {
          if (isActiveDateCurrentWeek) {
            onSetSpecial(dow, null);
          } else {
            onSpinnerComplete([{ date: activeDate, meal: null }]);
          }
          setShowDetailPanel(false);
        }}
      />

      {showSpinner && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 400, padding: '16px',
          animation: 'wv-fadeIn 0.2s ease both',
        }}>
          <MealSpinner
            meals={spinnerPools.all.pool}
            rotationMeals={spinnerPools.rotation.pool}
            currentPlan={currentPlan}
            onComplete={(pickedMeals) => {
              const targetDates = spinnerTargetDates && spinnerTargetDates.length > 0
                ? spinnerTargetDates
                : [0,1,2,3,4,5,6].map(idx => addDays(currentWeekMonday, idx));
              const pairs = pickedMeals.map((meal, i) => ({ date: targetDates[i], meal }));
              onSpinnerComplete(pairs);
              setSpinnerSelectedIndices(null);
              setSpinnerTargetDates(null);
              setJustCompletedSpin(true);
            }}
            onClose={() => {
              onCloseSpinner();
              setSpinnerSelectedIndices(null);
              setSpinnerTargetDates(null);
            }}
            recentlyUsedIds={recentlyUsedIds}
            selectedDayIndices={spinnerSelectedIndices}
            slotDates={spinnerSlotDates}
          />
        </div>
      )}

      {!showSpinner && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 8,
          padding: '10px 16px 12px',
          background: 'var(--card)',
          borderTop: '1px solid var(--border)',
        }}>
          {justCompletedSpin && (
            <button
              onClick={() => {
                setJustCompletedSpin(false);
                onBuildGrocery();
              }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '14px 16px', border: 'none', borderRadius: 12,
                background: 'linear-gradient(135deg, var(--primary), #c084fc)',
                color: 'white', fontSize: 15, fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                animation: 'wv-fadeIn 0.3s ease both',
              }}
            >
              <ShoppingCart size={16} strokeWidth={2.5} />
              Build your grocery list →
            </button>
          )}
          {selectMode ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleSpinSelected}
                disabled={selectedDates.size === 0}
                style={{
                  flex: 1, padding: '13px 8px',
                  background: selectedDates.size === 0 ? 'var(--border)' : 'var(--primary)',
                  color: selectedDates.size === 0 ? 'var(--text-muted)' : 'white',
                  border: 'none', borderRadius: 12,
                  fontSize: 14, fontWeight: 700, cursor: selectedDates.size === 0 ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  transform: selectedDates.size > 0 ? 'none' : undefined,
                }}
              >
                🎰 Spin {selectedDates.size > 0 ? `${selectedDates.size} Day${selectedDates.size !== 1 ? 's' : ''}` : 'Selected'}
              </button>
              <button
                onClick={() => { setSelectMode(false); setSelectedDates(new Set()); }}
                style={{
                  padding: '13px 16px', background: 'var(--surface)', color: 'var(--text)',
                  border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={() => { setJustCompletedSpin(false); navigator.vibrate?.([40, 25, 40]); onSmartPlan?.(); }}
                style={PRIMARY_BTN}
              >
                Plan my Week{rotationCount > 0 ? ` (${rotationCount})` : ''}
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => { setJustCompletedSpin(false); setSelectMode(true); }}
                  style={{ ...SECONDARY_BTN, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                >
                  <CheckSquare size={14} strokeWidth={2.5} /> Select
                </button>
                {hasWeek && !grocerySelectMode && (
                  <button onClick={enterGroceryMode} style={{ ...SECONDARY_BTN, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                    <ShoppingCart size={14} strokeWidth={2.5} />
                    {lockedMealCount > 0 ? `Grocery (${lockedMealCount})` : 'Grocery'}
                  </button>
                )}
              </div>
              {/* ── Share Plan — only visible once meals are planned ── */}
              {hasWeek && (
                <button
                  onClick={handleSharePlan}
                  style={{
                    ...SECONDARY_BTN,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    background: allWeekLocked
                      ? 'linear-gradient(135deg, var(--primary), #c084fc)'
                      : 'var(--surface)',
                    color: allWeekLocked ? 'white' : 'var(--text)',
                    fontWeight: allWeekLocked ? 700 : 600,
                    boxShadow: allWeekLocked ? '0 2px 8px rgba(0,0,0,0.15)' : undefined,
                  }}
                >
                  <Share2 size={14} strokeWidth={2.5} />
                  {allWeekLocked ? 'Share Locked Plan' : 'Share Plan'}
                </button>
              )}
            </>
          )}

          {grocerySelectMode && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={cancelGroceryMode} style={{ ...SECONDARY_BTN, flex: '0 0 auto', padding: '8px 16px' }}>
                Cancel
              </button>
              <button
                onClick={handleGroceryBuild}
                disabled={groceryDayCount === 0}
                style={{
                  ...PRIMARY_BTN, flex: 1, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', gap: 6,
                  opacity: groceryDayCount === 0 ? 0.4 : 1,
                }}
              >
                <ShoppingCart size={14} strokeWidth={2.5} />
                Build List ({groceryDayCount} day{groceryDayCount !== 1 ? 's' : ''})
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Search Modal ── */}
      <AnimatePresence>
        {searchOpen && (
          <SearchModal
            meals={filteredSearchMeals}
            allMeals={meals}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchCuisine={searchCuisine}
            onCuisineChange={setSearchCuisine}
            availableCuisines={availableCuisines}
            targetDate={searchTargetDate}
            onSelect={handleSearchSelect}
            onClose={() => { setSearchOpen(false); setSearchQuery(''); setSearchCuisine(''); }}
          />
        )}
      </AnimatePresence>

      {/* ── Pantry-Aware Quick Swap drawer ── */}
      <AnimatePresence>
        {!!pantryMatchTargetDate && (
          <PantryMatchDrawer
            ranked={pantryMatchRanked}
            targetDate={pantryMatchTargetDate}
            hasFridgeData={fridgeInventoryNames.length > 0}
            onSelect={handlePantryMatchSelect}
            onSurpriseMe={() => {
              const dow = pantryMatchTargetDate.getDay() === 0 ? 6 : pantryMatchTargetDate.getDay() - 1;
              const isTargetCurrentWeek = getMonday(pantryMatchTargetDate).getTime() === currentWeekMonday.getTime();
              setPantryMatchTargetDate(null);
              if (isTargetCurrentWeek) onRespin(dow);
              else handleSpinForDate(pantryMatchTargetDate);
            }}
            onClose={() => setPantryMatchTargetDate(null)}
          />
        )}
      </AnimatePresence>

      {renderPicker()}
    </div>
  );
}

// ── Weekly Macro & Prep Summary Strip ────────────────────────────────────────
// Compact read-only chip row under "This week" — quick "what am I in for this
// week" glance without opening each day. Sparse-data safe: recipes are only
// required to have prep/cook/total time and nutrition when the source stated
// them (see recipeSchema's extraction rules — nothing is ever fabricated), so
// every chip here is independently omitted when its underlying data is absent
// rather than showing a misleading "0 min" or "0 kcal". Ties into Batch Cook
// (Feature C) by surfacing leftover nights as their own chip.
function WeekSummaryStrip({ weekPlan, dietaryPref }) {
  const stats = useMemo(() => {
    const planned = (weekPlan || []).filter(m => m && !m._special);
    if (planned.length === 0) return null;

    const cookNights = planned.filter(m => !m._leftoverOf);
    const leftoverNights = planned.length - cookNights.length;

    const minutesList = cookNights.map(m => mealTotalMinutes(m)).filter(v => v != null);
    const avgMinutes = minutesList.length > 0
      ? Math.round(minutesList.reduce((a, b) => a + b, 0) / minutesList.length)
      : null;

    const calorieList = cookNights
      .map(m => parseNutritionNumber(m.nutrition?.calories))
      .filter(v => v != null);
    const avgCalories = calorieList.length > 0
      ? Math.round(calorieList.reduce((a, b) => a + b, 0) / calorieList.length)
      : null;

    let dietMatch = null;
    if (dietaryPref?.dietary) {
      const matches = cookNights.filter(m =>
        (Array.isArray(m.dietaryTags) ? m.dietaryTags : []).map(t => String(t).toLowerCase()).includes(dietaryPref.dietary)
      ).length;
      dietMatch = { matches, total: cookNights.length, label: dietaryPref.dietary };
    }

    if (avgMinutes == null && avgCalories == null && leftoverNights === 0 && !dietMatch) return null;
    return { avgMinutes, avgCalories, leftoverNights, dietMatch, minutesCoverage: minutesList.length, calorieCoverage: calorieList.length };
  }, [weekPlan, dietaryPref]);

  if (!stats) return null;

  const chipStyle = {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '5px 10px', borderRadius: 20,
    background: 'var(--surface)', border: '1px solid var(--border)',
    fontSize: 12, fontWeight: 700, color: 'var(--text-light)',
    whiteSpace: 'nowrap', flexShrink: 0,
  };

  return (
    <div style={{
      display: 'flex', gap: 6, padding: '0 12px 8px',
      overflowX: 'auto', WebkitOverflowScrolling: 'touch',
      msOverflowStyle: 'none', scrollbarWidth: 'none',
    }}>
      {stats.avgMinutes != null && (
        <span style={chipStyle} title={`Based on ${stats.minutesCoverage} recipe${stats.minutesCoverage !== 1 ? 's' : ''} with time data`}>
          ⏱ ~{stats.avgMinutes} min/night
        </span>
      )}
      {stats.avgCalories != null && (
        <span style={chipStyle} title={`Based on ${stats.calorieCoverage} recipe${stats.calorieCoverage !== 1 ? 's' : ''} with nutrition data`}>
          🔥 ~{stats.avgCalories} kcal/meal
        </span>
      )}
      {stats.leftoverNights > 0 && (
        <span style={chipStyle}>
          🍱 {stats.leftoverNights} leftover night{stats.leftoverNights !== 1 ? 's' : ''}
        </span>
      )}
      {stats.dietMatch && (
        <span style={chipStyle}>
          🥗 {stats.dietMatch.matches}/{stats.dietMatch.total} {stats.dietMatch.label}
        </span>
      )}
    </div>
  );
}

// ── Premium segmented toggle ─────────────────────────────────────────────────
// The pill used to be positioned by measurement: three refs, a state object,
// and a useEffect calling getBoundingClientRect on both the container and the
// active button after every toggle. Equal-width segments make its position a
// constant, so all of that is gone — the pill is now a CSS class swap, and
// nothing reads layout on the way.
function ViewToggle({ viewMode, onChangeMode }) {
  return (
    <div className="wv-tl-toggle">
      <div
        className={`wv-tl-toggle-pill${viewMode === 'month' ? ' is-month' : ''}`}
        aria-hidden="true"
      />
      <button
        className={`wv-tl-toggle-btn ${viewMode === 'timeline' ? 'active' : ''}`}
        onClick={() => onChangeMode('timeline')}
      >
        <List size={14} strokeWidth={2.5} /> Week
      </button>
      <button
        className={`wv-tl-toggle-btn ${viewMode === 'month' ? 'active' : ''}`}
        onClick={() => onChangeMode('month')}
      >
        <CalendarDays size={14} strokeWidth={2.5} /> Month
      </button>
    </div>
  );
}

// ── Next Week, empty state ── one CTA to auto-fill the whole week, plus a
// compact day-chip row for anyone who'd rather assign a single day by hand.
function NextWeekEmptyHero({ weekDates, onAutoPlan, onDayTap }) {
  return (
    <div className="wv-next-hero">
      <motion.button
        type="button"
        className="wv-next-hero-cta"
        onClick={onAutoPlan}
        whileTap={{ scale: 0.98 }}
      >
        ✨ Auto-Plan Next Week
      </motion.button>
      <div className="wv-next-hero-chips">
        {weekDates.map(date => (
          <button
            type="button"
            key={dateKey(date)}
            className="wv-next-hero-chip"
            onClick={() => onDayTap(date)}
          >
            <span className="wv-next-hero-chip-day">{PREV_WEEK_DAY_NAMES[date.getDay()]}</span>
            <span className="wv-next-hero-chip-num">{date.getDate()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const TL_STAGGER_DELAY = 40;

function TimelineWeek({
  weekDates, today, getMealForDate, currentWeekMonday,
  selectMode, selectedDates, onCellClick, onToggleSelect,
  onRespin, onSpinForDate, onToggleLock,
  grocerySelectMode, groceryDays, onGroceryToggle,
  carry, onPickUp, onPlace, allowDropTarget = false,
  onOpenSearch, onSwapDrag,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 12px' }}>
      {weekDates.map((date, idx) => {
        const key = dateKey(date);
        const isToday = isSameDay(date, today);
        const isPast = date < today && !isToday;
        const { meal, isCurrent, dow } = getMealForDate(date);
        const isSpecial = meal && meal._special;
        const isLocked = meal && meal._locked;
        const isSelected = selectedDates.has(key);
        const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][date.getDay()];

        const isGroceryActive = grocerySelectMode && groceryDays.has(key);
        const isGroceryExcluded = grocerySelectMode && meal && !meal._special && !groceryDays.has(key);
        const isCarrySource = !!carry && carry.key === key;
        const isEligibleTarget = !!carry && allowDropTarget && !isCarrySource && !isPast;
        const isCarryDim = !!carry && !isCarrySource && !isEligibleTarget;

        const classes = ['wv-tl-card'];
        if (isToday) classes.push('tl-today');
        if (!meal && !isPast) classes.push('tl-empty');
        if (isPast && !isToday) classes.push('tl-past');
        if (isSelected) classes.push('tl-selected');
        if (isGroceryActive) classes.push('tl-grocery-active');
        if (isGroceryExcluded) classes.push('tl-grocery-excluded');
        if (isCarrySource) classes.push('tl-carry-source');
        if (isEligibleTarget) classes.push('tl-drop-target');
        if (isCarryDim) classes.push('tl-carry-dim');

        // Stable key for tumbler: when meal changes on spin, AnimatePresence
        // triggers exit→enter with a blur-slide spring.
        const mealKey = meal ? (meal.id || meal.name || 'meal') : 'empty';

        const handleCardClick = () => {
          if (carry) {
            if (isCarrySource) { onPickUp?.(date, meal); return; } // tap the lifted card to put it back
            if (isEligibleTarget) { onPlace?.(date); return; }
            return; // inert everywhere else while carrying — no accidental drops
          }
          if (grocerySelectMode && meal && !meal._special) { onGroceryToggle(key); return; }
          onCellClick(date);
        };

        return (
          <motion.div
            key={key}
            data-datekey={key}
            className={classes.join(' ')}
            onClick={handleCardClick}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: isCarryDim ? 0.4 : (isPast && !isToday ? 0.55 : 1), y: 0 }}
            transition={{ duration: 0.3, delay: idx * TL_STAGGER_DELAY / 1000, ease: [0.23, 1, 0.32, 1] }}
          >
            {/* ── Pick-up grip — tap to carry this meal, tap again to put it back.
                Works identically for touch and mouse (no native HTML5 DnD, which
                iOS Safari ignores on touch). Available on past meals too, since
                Previous Weeks is a browsing source, not just current/next week. ── */}
            {meal && !isSpecial && !selectMode && !grocerySelectMode && (
              <motion.button
                type="button"
                className={`wv-tl-grip${isCarrySource ? ' active' : ''}`}
                onClick={(e) => { e.stopPropagation(); onPickUp?.(date, meal); }}
                aria-pressed={isCarrySource}
                aria-label={isCarrySource ? 'Put this meal back' : 'Pick up to copy to another day, or drag to swap with it'}
                title={isCarrySource ? 'Put back' : 'Tap to pick up, or drag onto another day to swap'}
                style={{ touchAction: (!carry && onSwapDrag) ? 'none' : undefined, position: 'relative' }}
                drag={!carry && !!onSwapDrag}
                dragSnapToOrigin
                dragElastic={0.5}
                dragMomentum={false}
                whileDrag={{ scale: 1.4, zIndex: 50, boxShadow: '0 6px 18px rgba(0,0,0,0.35)' }}
                onDragEnd={(e, info) => {
                  const dropEl = document.elementFromPoint(info.point.x, info.point.y);
                  const cell = dropEl?.closest('[data-datekey]');
                  if (cell?.dataset?.datekey) onSwapDrag?.(date, meal, cell.dataset.datekey);
                }}
              >
                <GripVertical size={16} strokeWidth={2.5} />
              </motion.button>
            )}

            <div className="wv-tl-dow">
              <div className="wv-tl-dow-label">{dayName}</div>
              <div className="wv-tl-dow-num">{date.getDate()}</div>
            </div>

            <div className="wv-tl-grocery-badge" aria-hidden="true">✓</div>

            {/* ── Tumbler: thumbnail animates on recipe swap ── */}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={mealKey + '-thumb'}
                initial={{ y: -24, opacity: 0, filter: 'blur(4px)' }}
                animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
                exit={{ y: 24, opacity: 0, filter: 'blur(4px)' }}
                transition={{ type: 'spring', stiffness: 340, damping: 28 }}
                style={{ flexShrink: 0 }}
              >
                {meal && !isSpecial ? (
                  meal.imageUrl ? (
                    <img
                      src={meal.imageUrl} alt=""
                      className="wv-tl-thumb"
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <div className="wv-tl-thumb-ph">
                      {meal.name?.charAt(0)?.toUpperCase() || '🍽️'}
                    </div>
                  )
                ) : isSpecial ? (
                  <div className="wv-tl-thumb-ph" style={{ fontSize: 26 }}>
                    {meal.icon}
                  </div>
                ) : (
                  <div className="wv-tl-empty-ph">
                    <Plus size={18} color="var(--text-muted)" strokeWidth={2} />
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            <div className="wv-tl-info" style={{ overflow: 'hidden' }}>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={mealKey + '-info'}
                  initial={{ y: -14, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 14, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 340, damping: 28 }}
                >
                  {meal ? (
                    <>
                      <div className="wv-tl-name">
                        {isLocked && <Lock size={11} strokeWidth={2.5} style={{ verticalAlign: 'middle', marginRight: 3, opacity: 0.5 }} />}
                        {meal.name}
                      </div>
                      <div className="wv-tl-meta">
                        {isSpecial
                          ? 'Special day'
                          : meal._leftoverOf
                            ? '🍱 Leftovers — no shopping needed'
                            : `${meal.ingredients?.length || 0} ingredients${meal.category ? ` · ${meal.category}` : ''}${meal._leftoverChainNext ? ' · 🍱 batch cooked' : ''}`}
                      </div>
                    </>
                  ) : (
                    <div className="wv-tl-meta" style={{ fontSize: 12.5 }}>
                      {isPast ? 'No meal planned' : 'Tap to add or spin'}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* ── Carry-mode action slot: replaces lock/search/menu while a meal is in hand ── */}
            {carry && isCarrySource && (
              <span className="wv-carry-source-badge">Picked up</span>
            )}
            {carry && isEligibleTarget && (
              <button
                type="button"
                className="wv-carry-place-btn"
                onClick={(e) => { e.stopPropagation(); onPlace?.(date); }}
              >
                Place here
              </button>
            )}

            {/* ── Unified action group: Lock / Search / Kebab share one right-aligned
                row of real 36×36px touch targets instead of loose siblings. ── */}
            {!carry && !selectMode && !isPast && !grocerySelectMode && (
              <div className="wv-tl-actions-group">
                {isCurrent && meal && !isSpecial && (
                  <motion.button
                    className={`wv-tl-lock-btn${isLocked ? ' locked' : ''}`}
                    onClick={(e) => { e.stopPropagation(); onToggleLock?.(dow); }}
                    whileTap={{ scale: 0.8 }}
                    animate={{
                      scale: isLocked ? [1, 1.15, 1] : 1,
                      color: isLocked ? 'var(--primary)' : 'var(--text-muted)',
                    }}
                    transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                    aria-label={isLocked ? 'Unlock day' : 'Lock day'}
                    title={isLocked ? "Locked — won't change on Spin" : 'Lock to keep this meal'}
                  >
                    {isLocked
                      ? <LockKeyhole size={16} strokeWidth={2.5} />
                      : <LockKeyholeOpen size={16} strokeWidth={2} />
                    }
                  </motion.button>
                )}

                <button
                  className="wv-tl-action wv-tl-search-btn"
                  onClick={(e) => { e.stopPropagation(); onOpenSearch?.(date); }}
                  aria-label="Search meals"
                  title="Search & assign a meal"
                >
                  <Search size={15} strokeWidth={2.5} />
                </button>

                {meal ? (
                  <button
                    className="wv-tl-action"
                    onClick={(e) => { e.stopPropagation(); onCellClick(date); }}
                    aria-label="Day options"
                  >
                    <MoreVertical size={18} strokeWidth={2} />
                  </button>
                ) : (
                  <button
                    className="wv-tl-spin-chip"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isCurrent) {
                        onRespin(dow);
                      } else if (date >= today) {
                        onSpinForDate?.(date);
                      } else {
                        onCellClick(date);
                      }
                    }}
                  >
                    <RefreshCw size={12} strokeWidth={2.5} /> Spin
                  </button>
                )}
              </div>
            )}

            {selectMode && !isPast && (
              <div style={{
                width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                border: isSelected ? 'none' : '2px solid var(--border)',
                background: isSelected ? 'var(--primary)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s ease',
              }}>
                {isSelected && <span style={{ color: 'white', fontSize: 14, fontWeight: 800 }}>✓</span>}
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

// ── Shared week disclosure header ───────────────────────────────────────────
// Both "Previous weeks" and "Next week" used to be a bare <div onClick>. On
// iOS Safari a non-interactive element only receives a synthesized click under
// a specific set of conditions, and inside this page — which sets
// user-select:none on its root and nests framer-motion children in the row —
// those taps were being dropped, so the panel simply never opened. A real
// <button> is always clickable, is reachable by keyboard and VoiceOver, and
// gets touch-action:manipulation to kill the 300ms tap delay. It also carries
// aria-expanded/aria-controls, which the div version had no way to express.
function WeekDisclosureToggle({ id, title, subtitle, expanded, onToggle, className = '' }) {
  return (
    <button
      type="button"
      id={`${id}-toggle`}
      className={`wv-tl-next-collapsed${className ? ` ${className}` : ''}`}
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={`${id}-panel`}
    >
      <div style={{ textAlign: 'left', minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-light)' }}>
          {title}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
          {subtitle}
        </div>
      </div>
      <motion.div
        animate={{ rotate: expanded ? 180 : 0 }}
        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        style={{ flexShrink: 0, display: 'flex' }}
      >
        <ChevronDown size={18} color="var(--text-muted)" strokeWidth={2} />
      </motion.div>
    </button>
  );
}

// ── Previous Weeks — quick reference + pick-up source for the last 6 weeks ──
// Sits above "This week" so scrolling *up* through the Plan page is literally
// scrolling back through history — cap at 6 weeks; anything older belongs in
// Month view, which already covers unlimited history.
const PREV_WEEKS_BACK = 6;
const PREV_WEEK_DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function PreviousWeeksSection({
  currentWeekMonday, weekHistory, today, getMealForDate,
  expanded, onToggleExpanded, carry, onPickUp, onOpenMonthView,
}) {
  const weeks = useMemo(() => {
    const list = [];
    for (let i = PREV_WEEKS_BACK; i >= 1; i--) {
      const monday = addDays(currentWeekMonday, -7 * i);
      const dates = [0,1,2,3,4,5,6].map(d => addDays(monday, d));
      const plannedCount = dates.reduce((n, d) => n + (getMealForDate(d).meal ? 1 : 0), 0);
      if (plannedCount === 0) continue; // nothing recorded for that week
      list.push({ monday, dates, plannedCount });
    }
    return list;
  }, [currentWeekMonday, weekHistory, getMealForDate]);

  // Previously: `if (weeks.length === 0) return null` — the whole section
  // vanished whenever the last 6 weeks happened to hold no saved plans, which
  // reads as "the Previous weeks control is missing" rather than "you have no
  // history yet". The toggle now always renders; an empty history just gets an
  // honest empty state behind it, with Month view as the escape hatch for
  // anything older than the 6-week window.
  const isEmpty = weeks.length === 0;

  const noop = () => {};

  return (
    <div className="wv-prev-weeks">
      <WeekDisclosureToggle
        id="wv-prev-weeks"
        className="wv-prev-toggle"
        title="Previous weeks"
        subtitle={
          isEmpty
            ? 'No saved plans in the last 6 weeks yet'
            : `${weeks.length} week${weeks.length !== 1 ? 's' : ''} to glance back at · tap a meal's grip to reuse it`
        }
        expanded={expanded}
        onToggle={onToggleExpanded}
      />

      <AnimatePresence>
        {expanded && (
          <motion.div
            id="wv-prev-weeks-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
            style={{ overflow: 'hidden' }}
          >
            {isEmpty && (
              <p className="wv-prev-empty">
                Weeks are saved here automatically once you plan them. Spin or
                fill in this week and it'll show up next Monday.
              </p>
            )}
            {weeks.map(({ monday, dates, plannedCount }) => (
              <div key={monday.getTime()} style={{ marginBottom: 10 }}>
                <div className="wv-tl-section-header" style={{ padding: '8px 16px 4px' }}>
                  <span className="wv-tl-section-title" style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>
                    {dates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {dates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                  <span className="wv-tl-section-badge" style={{ color: 'var(--text-muted)' }}>
                    {plannedCount}/7 planned
                  </span>
                </div>
                <TimelineWeek
                  weekDates={dates}
                  today={today}
                  getMealForDate={getMealForDate}
                  currentWeekMonday={currentWeekMonday}
                  selectMode={false}
                  selectedDates={EMPTY_SET}
                  onCellClick={noop}
                  onToggleSelect={noop}
                  onRespin={noop}
                  onSpinForDate={noop}
                  onToggleLock={noop}
                  grocerySelectMode={false}
                  groceryDays={EMPTY_SET}
                  onGroceryToggle={noop}
                  carry={carry}
                  onPickUp={onPickUp}
                  onPlace={noop}
                  allowDropTarget={false}
                  onOpenSearch={noop}
                />
              </div>
            ))}
            <button type="button" className="wv-prev-month-link" onClick={onOpenMonthView}>
              Looking further back? Browse Month view →
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const EMPTY_SET = new Set();

function DetailPanel({ show, activeDate, today, getMealForDate, isCurrentWeek, onClose, onToggleLock,
  onViewDetail, onRespin, onSpinForDate, onOpenPantryMatch, onToggleBatchCook, onOpenPicker, onClearDay }) {
  const dragControls = useDragControls();

  const handleSheetDragEnd = useCallback((_e, info) => {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      onClose();
    }
  }, [onClose]);

  const { meal, isCurrent, dow } = getMealForDate(activeDate);
  const isToday     = activeDate.getFullYear() === today.getFullYear() &&
    activeDate.getMonth() === today.getMonth() &&
    activeDate.getDate() === today.getDate();
  const isPast      = activeDate < today && !isToday;
  const isSpecial   = meal && meal._special;

  return (
    <AnimatePresence>
      {show && (
      <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 250,
          animation: 'wv-fadeIn 0.2s ease both',
        }}
      />
      <motion.div
        drag="y"
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        dragTransition={{ bounceStiffness: 600, bounceDamping: 30 }}
        onDragEnd={handleSheetDragEnd}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          maxWidth: 600, margin: '0 auto',
          background: 'var(--card)',
          borderRadius: '20px 20px 0 0',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
          zIndex: 260,
          maxHeight: '72vh',
          overflowY: 'auto',
        }}>
        <div
          onPointerDown={(e) => dragControls.start(e)}
          style={{
            width: 36, height: 4, borderRadius: 2, background: 'var(--border)',
            margin: '10px auto 0',
            cursor: 'grab',
          }}
        />

        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          padding: '14px 16px 8px',
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: 'var(--text)' }}>
              {DAY_FULL[activeDate.getDay() === 0 ? 6 : activeDate.getDay() - 1]}
              {isToday && (
                <span style={{
                  display: 'inline-block', marginLeft: 8,
                  background: 'var(--primary)', color: 'white',
                  borderRadius: 20, padding: '1px 8px', fontSize: 11, fontWeight: 700,
                  verticalAlign: 'middle',
                }}>Today</span>
              )}
              {isPast && (
                <span style={{
                  display: 'inline-block', marginLeft: 8,
                  background: 'var(--surface)', color: 'var(--text-muted)',
                  borderRadius: 20, padding: '1px 8px', fontSize: 11, fontWeight: 600,
                  verticalAlign: 'middle',
                }}>Past</span>
              )}
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-light)' }}>
              {activeDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: '50%', border: 'none',
            background: 'var(--surface)', color: 'var(--text-light)',
            fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexShrink: 0,
          }}>✕</button>
        </div>

        <div style={{ padding: '0 16px 24px' }}>
          {!meal ? (
            <motion.div
              className="wv-empty-state"
              variants={wvEmptyContainerVariants}
              initial="hidden"
              animate="visible"
            >
              <motion.div className="wv-empty-icon-wrap" variants={wvEmptyItemVariants}>
                <UtensilsCrossed size={26} color="var(--text-muted, var(--text-light))" strokeWidth={1.75} />
              </motion.div>
              <motion.p className="wv-empty-title" variants={wvEmptyItemVariants}>
                {isPast ? 'Nothing was planned here' : 'No meal planned yet'}
              </motion.p>
              {!isPast && (
                <motion.p className="wv-empty-hint-text" variants={wvEmptyItemVariants}>
                  Tap below to pick a recipe and fill this spot on your week.
                </motion.p>
              )}
              {!isPast && (
                <motion.div variants={wvEmptyItemVariants} style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                  <button
                    onClick={() => {
                      if (isCurrentWeek) {
                        onRespin(dow);
                      } else {
                        onSpinForDate?.(activeDate);
                      }
                    }}
                    style={{ ...PRIMARY_BTN, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  >
                    <RefreshCw size={15} strokeWidth={2.5} /> Spin a Meal
                  </button>
                  {onOpenPantryMatch && (
                    <button
                      onClick={onOpenPantryMatch}
                      style={{ ...OUTLINE_BTN, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    >
                      🎯 Pantry Picks — use what you have
                    </button>
                  )}
                  <button
                    onClick={onOpenPicker}
                    style={{ ...OUTLINE_BTN, width: '100%' }}
                  >
                    + Choose from Library
                  </button>
                </motion.div>
              )}
            </motion.div>
          ) : isSpecial ? (
            <div style={{ animation: 'wv-fadeIn 0.25s ease both' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 14,
                background: 'var(--surface)', borderRadius: 14, padding: '16px',
                marginBottom: 16,
              }}>
                <span style={{ fontSize: 36 }}>{meal.icon}</span>
                <span style={{ fontSize: 18, fontWeight: 700 }}>{meal.name}</span>
              </div>
              {isCurrent && (
                <button onClick={() => onClearDay(dow)} style={{ ...DANGER_BTN, width: '100%' }}>
                  <X size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Clear Day
                </button>
              )}
            </div>
          ) : (
            <div style={{ animation: 'wv-fadeIn 0.25s ease both' }}>
              <div style={{
                background: 'var(--surface)', borderRadius: 14, overflow: 'hidden',
                marginBottom: 14,
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              }}>
                {meal.imageUrl && (
                  <div style={{ position: 'relative' }}>
                    <img src={meal.imageUrl} alt={meal.name}
                      style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block' }}
                      onError={e => e.target.style.display = 'none'}
                    />
                    <div style={{
                      position: 'absolute', left: 10, right: 10, bottom: 10,
                      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                      background: 'rgba(0,0,0,0.35)',
                      backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                      borderRadius: 'var(--sh-radius-sm)',
                      padding: '8px 12px',
                    }}>
                      <h4 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#fff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
                        {meal.name}
                      </h4>
                      {meal._locked && (
                        <span style={{
                          background: 'rgba(255,255,255,0.18)', color: '#fff',
                          borderRadius: 20, padding: '2px 8px', fontSize: 11, fontWeight: 700,
                          flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3,
                        }}><Lock size={11} style={{ verticalAlign: 'middle' }} /> Locked</span>
                      )}
                    </div>
                  </div>
                )}
                <div style={{ padding: '12px 14px' }}>
                  {!meal.imageUrl && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <h4 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
                        {meal.name}
                      </h4>
                      {meal._locked && (
                        <span style={{
                          background: 'rgba(230,81,0,0.12)', color: 'var(--primary)',
                          borderRadius: 20, padding: '2px 8px', fontSize: 11, fontWeight: 700,
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                        }}><Lock size={11} style={{ verticalAlign: 'middle' }} /> Locked</span>
                      )}
                    </div>
                  )}
                  <p style={{ margin: meal.imageUrl ? 0 : '4px 0 0', fontSize: 13, color: 'var(--text-light)', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    <span>
                      {meal.ingredients?.length || 0} ingredients
                      {meal.category ? ` · ${meal.category}` : ''}
                    </span>
                    {meal.rating ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                        · {Array.from({ length: meal.rating }).map((_, i) => (
                          <Star key={i} size={12} fill="currentColor" style={{ verticalAlign: 'middle' }} />
                        ))}
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>

              {isCurrent && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button onClick={() => onViewDetail(meal)} style={OUTLINE_BTN}>
                    <BookOpen size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} /> View Recipe
                  </button>
                  <button
                    onClick={() => onToggleLock && onToggleLock(dow)}
                    style={{
                      ...OUTLINE_BTN,
                      background: meal._locked ? 'rgba(230,81,0,0.1)' : undefined,
                      color: meal._locked ? 'var(--primary)' : undefined,
                      borderColor: meal._locked ? 'var(--primary)' : undefined,
                    }}
                  >
                    {meal._locked ? '🔒 Locked' : '🔓 Lock It'}
                  </button>
                  {!meal._locked && (
                    <>
                      <button onClick={() => onRespin(dow)} style={OUTLINE_BTN}>
                        🔄 Respin
                      </button>
                      <button onClick={onOpenPicker} style={OUTLINE_BTN}>
                        ✏️ Change
                      </button>
                      {onOpenPantryMatch && (
                        <button onClick={onOpenPantryMatch} style={{ ...OUTLINE_BTN, gridColumn: '1 / -1' }}>
                          🎯 Swap for a Pantry Pick
                        </button>
                      )}
                      {onToggleBatchCook && dow < 6 && (
                        <button
                          onClick={() => onToggleBatchCook(dow)}
                          style={{
                            ...OUTLINE_BTN, gridColumn: '1 / -1',
                            background: meal._leftoverChainNext ? 'rgba(230,81,0,0.1)' : undefined,
                            color: meal._leftoverChainNext ? 'var(--primary)' : undefined,
                            borderColor: meal._leftoverChainNext ? 'var(--primary)' : undefined,
                          }}
                        >
                          {meal._leftoverChainNext ? '🍱 Leftovers Queued — tap to undo' : '🍱 Cook 2x — Make Tomorrow Leftovers'}
                        </button>
                      )}
                      <button onClick={() => onClearDay(dow)}
                        style={{ ...OUTLINE_BTN, gridColumn: '1 / -1', color: 'var(--danger)', borderColor: 'var(--danger)' }}>
                        ✕ Remove Meal
                      </button>
                    </>
                  )}
                </div>
              )}

              {!isCurrent && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button onClick={() => onViewDetail(meal)} style={OUTLINE_BTN}>
                    <BookOpen size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} /> View Recipe
                  </button>
                  {activeDate >= today ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <button onClick={() => onSpinForDate?.(activeDate)} style={OUTLINE_BTN}>
                        🔄 Respin
                      </button>
                      <button onClick={onOpenPicker} style={OUTLINE_BTN}>
                        ✏️ Change
                      </button>
                      {onOpenPantryMatch && (
                        <button onClick={onOpenPantryMatch} style={{ ...OUTLINE_BTN, gridColumn: '1 / -1' }}>
                          🎯 Swap for a Pantry Pick
                        </button>
                      )}
                      <button onClick={() => onClearDay(dow)}
                        style={{ ...OUTLINE_BTN, gridColumn: '1 / -1', color: 'var(--danger)', borderColor: 'var(--danger)' }}>
                        ✕ Remove Meal
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { onOpenPicker(); }}
                      style={PRIMARY_BTN}
                    >
                      ↩ Use This Meal Today
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
      </>
      )}
    </AnimatePresence>
  );
}

// ── Search Modal ─────────────────────────────────────────────────────────────
function SearchModal({ meals, allMeals, searchQuery, onSearchChange, searchCuisine, onCuisineChange, availableCuisines, targetDate, onSelect, onClose }) {
  const inputRef = useRef(null);
  const dayLabel = targetDate
    ? DAY_FULL[targetDate.getDay() === 0 ? 6 : targetDate.getDay() - 1]
    : '';
  const dateLabel = targetDate
    ? targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';

  useEffect(() => {
    // Focus input after mount animation
    const t = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          zIndex: 500, WebkitTapHighlightColor: 'transparent',
        }}
      />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          maxWidth: 600, margin: '0 auto',
          background: 'var(--card)',
          borderRadius: '20px 20px 0 0',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
          zIndex: 510,
          maxHeight: '88vh',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Handle */}
        <div style={{
          width: 36, height: 4, borderRadius: 2, background: 'var(--border)',
          margin: '10px auto 0', flexShrink: 0,
        }} />

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px 8px', flexShrink: 0,
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>
              Choose for {dayLabel}
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              {dateLabel} · {allMeals.length} meals in library
            </p>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: '50%', border: 'none',
            background: 'var(--surface)', color: 'var(--text-light)',
            fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexShrink: 0,
          }}>✕</button>
        </div>

        {/* Search input */}
        <div style={{ padding: '0 16px 8px', flexShrink: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--surface)',
            border: '1.5px solid var(--border)',
            borderRadius: 12, padding: '0 12px',
            transition: 'border-color 0.2s cubic-bezier(0.32,0.72,0,1)',
          }}>
            <Search size={16} color="var(--text-muted)" strokeWidth={2} style={{ flexShrink: 0 }} />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search by name, cuisine, or tag…"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              style={{
                flex: 1, border: 'none', outline: 'none',
                background: 'transparent', color: 'var(--text)',
                fontSize: 14, fontWeight: 500,
                padding: '11px 0', minWidth: 0,
              }}
            />
            {searchQuery && (
              <button onClick={() => onSearchChange('')} style={{
                border: 'none', background: 'var(--border)', color: 'var(--text-muted)',
                borderRadius: '50%', width: 20, height: 20, fontSize: 11,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>✕</button>
            )}
          </div>
        </div>

        {/* Cuisine filter pills */}
        {availableCuisines.length > 0 && (
          <div style={{
            display: 'flex', gap: 6, padding: '0 16px 10px',
            overflowX: 'auto', flexShrink: 0,
            WebkitOverflowScrolling: 'touch',
            msOverflowStyle: 'none', scrollbarWidth: 'none',
          }}>
            <button
              onClick={() => onCuisineChange('')}
              style={{
                padding: '5px 12px', borderRadius: 20, flexShrink: 0,
                border: !searchCuisine ? '1.5px solid var(--primary)' : '1.5px solid var(--border)',
                background: !searchCuisine ? 'rgba(230,81,0,0.1)' : 'transparent',
                color: !searchCuisine ? 'var(--primary)' : 'var(--text-muted)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                transition: 'all 0.15s cubic-bezier(0.32,0.72,0,1)',
              }}
            >All</button>
            {availableCuisines.map(c => (
              <button
                key={c}
                onClick={() => onCuisineChange(searchCuisine === c ? '' : c)}
                style={{
                  padding: '5px 12px', borderRadius: 20, flexShrink: 0,
                  border: searchCuisine === c ? '1.5px solid var(--primary)' : '1.5px solid var(--border)',
                  background: searchCuisine === c ? 'rgba(230,81,0,0.1)' : 'transparent',
                  color: searchCuisine === c ? 'var(--primary)' : 'var(--text-muted)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s cubic-bezier(0.32,0.72,0,1)',
                }}
              >{c}</button>
            ))}
          </div>
        )}

        {/* Results count */}
        <div style={{
          padding: '0 16px 6px', fontSize: 11, fontWeight: 600,
          color: 'var(--text-muted)', flexShrink: 0,
        }}>
          {meals.length === allMeals.length
            ? `${meals.length} meal${meals.length !== 1 ? 's' : ''}`
            : `${meals.length} of ${allMeals.length} meals`
          }
        </div>

        {/* Results list */}
        <div style={{
          flex: 1, overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}>
          {meals.length === 0 ? (
            <div style={{
              padding: '32px 16px', textAlign: 'center',
              color: 'var(--text-muted)', fontSize: 14,
            }}>
              No meals match your search
            </div>
          ) : (
            meals.map(meal => (
              <div
                key={meal.id}
                className="pk-item"
                onClick={() => onSelect(meal)}
              >
                <MealImage src={meal.imageUrl} alt="" className="pk-img" fallbackClass="pk-img-ph" />
                <div className="pk-info">
                  <span className="pk-name">{meal.name}</span>
                  <span className="pk-meta">
                    {meal.ingredients?.length || 0} ingredients
                    {meal.category ? ` · ${meal.category}` : ''}
                    {meal.inRotation && ' · 🔄'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </>
  );
}

// ── Pantry-Aware Quick Swap drawer ───────────────────────────────────────────
// Opened from "Pantry Picks" in the day sheet (DetailPanel) — surfaces The
// Rotation ranked by how much of each recipe is already covered by what's in
// the fridge/pantry (same fridgeMatchRatio scorer the "Use Fridge Stock" spin
// constraint already uses), so the top of the list is "cook this without a
// grocery run" instead of a blind random pick. "Surprise Me" at the top keeps
// the old one-tap random-spin behavior available for anyone who just wants that.
function PantryMatchDrawer({ ranked, targetDate, hasFridgeData, onSelect, onSurpriseMe, onClose }) {
  const dayLabel = targetDate
    ? DAY_FULL[targetDate.getDay() === 0 ? 6 : targetDate.getDay() - 1]
    : '';
  const dateLabel = targetDate
    ? targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          zIndex: 500, WebkitTapHighlightColor: 'transparent',
        }}
      />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          maxWidth: 600, margin: '0 auto',
          background: 'var(--card)',
          borderRadius: '20px 20px 0 0',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
          zIndex: 510,
          maxHeight: '88vh',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{
          width: 36, height: 4, borderRadius: 2, background: 'var(--border)',
          margin: '10px auto 0', flexShrink: 0,
        }} />

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px 8px', flexShrink: 0,
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>
              🎯 Pantry Picks for {dayLabel}
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              {dateLabel} · {hasFridgeData ? 'Ranked by what\'s already in your pantry' : 'Add pantry items for better matches'}
            </p>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: '50%', border: 'none',
            background: 'var(--surface)', color: 'var(--text-light)',
            fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexShrink: 0,
          }}>✕</button>
        </div>

        <div style={{ padding: '0 16px 10px', flexShrink: 0 }}>
          <button
            onClick={onSurpriseMe}
            style={{ ...OUTLINE_BTN, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <RefreshCw size={14} strokeWidth={2.5} /> Surprise Me (random spin)
          </button>
        </div>

        <div style={{
          flex: 1, overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}>
          {ranked.length === 0 ? (
            <div style={{
              padding: '32px 16px', textAlign: 'center',
              color: 'var(--text-muted)', fontSize: 14,
            }}>
              Add meals to your rotation to see pantry picks
            </div>
          ) : (
            ranked.map(({ meal, score }) => (
              <div
                key={meal.id}
                className="pk-item"
                onClick={() => onSelect(meal)}
              >
                <MealImage src={meal.imageUrl} alt="" className="pk-img" fallbackClass="pk-img-ph" />
                <div className="pk-info">
                  <span className="pk-name">{meal.name}</span>
                  <span className="pk-meta">
                    {meal.ingredients?.length || 0} ingredients
                    {meal.category ? ` · ${meal.category}` : ''}
                  </span>
                </div>
                {score > 0 && (
                  <span style={{
                    flexShrink: 0, fontSize: 11, fontWeight: 700,
                    padding: '3px 8px', borderRadius: 20,
                    background: score >= 0.7 ? 'rgba(16,185,129,0.14)' : 'var(--surface)',
                    color: score >= 0.7 ? 'var(--success, #10b981)' : 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                  }}>
                    {Math.round(score * 100)}% in pantry
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </motion.div>
    </>
  );
}

const NAV_BTN = {
  width: 36, height: 36, borderRadius: '50%', border: 'none',
  background: 'var(--surface)', color: 'var(--primary)',
  fontSize: 20, cursor: 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
  transition: 'background 0.15s',
  flexShrink: 0,
};

const TODAY_BTN = {
  padding: '4px 10px', borderRadius: 20,
  border: '1.5px solid var(--primary)', background: 'transparent',
  color: 'var(--primary)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
  whiteSpace: 'nowrap', flexShrink: 0,
};

const SELECT_TOGGLE_BTN = {
  padding: '5px 10px', borderRadius: 20,
  border: '1.5px solid var(--border)', background: 'transparent',
  fontSize: 11, fontWeight: 700, cursor: 'pointer',
  whiteSpace: 'nowrap', flexShrink: 0,
  transition: 'all 0.2s ease',
};

const PRIMARY_BTN = {
  padding: '13px 16px', border: 'none', borderRadius: 12,
  background: 'var(--primary)', color: 'white',
  fontSize: 14, fontWeight: 700, cursor: 'pointer',
  transition: 'transform 0.1s, opacity 0.1s',
};

const SECONDARY_BTN = {
  padding: '12px 8px', border: 'none', borderRadius: 12,
  background: 'var(--surface)', color: 'var(--text)',
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
};

const OUTLINE_BTN = {
  padding: '11px 12px', borderRadius: 10,
  border: '1.5px solid var(--border)', background: 'var(--card)',
  color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  transition: 'all 0.15s ease',
};

const DANGER_BTN = {
  padding: '12px', border: '1.5px solid var(--danger)', borderRadius: 10,
  background: 'transparent', color: 'var(--danger)',
  fontSize: 14, fontWeight: 700, cursor: 'pointer',
};
