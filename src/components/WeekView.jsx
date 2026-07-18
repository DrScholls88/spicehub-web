import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { X, Lock, Star, BookOpen, UtensilsCrossed, ChevronDown, ChevronRight, MoreVertical, Plus, RefreshCw, CheckSquare, ShoppingCart, CalendarDays, List } from 'lucide-react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import MealSpinner from './MealSpinner';
import { filterMealsByConstraints } from '../lib/weekPlanner';

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
  .wv-tl-card.tl-today {
    border-color: var(--primary);
    box-shadow: 0 0 0 1px var(--primary), 0 2px 12px rgba(230,81,0,0.12);
  }
  .wv-tl-card.tl-empty {
    border-style: dashed;
    border-color: var(--border);
    background: transparent;
  }
  .wv-tl-card.tl-empty:active { transform: scale(0.98); }
  .wv-tl-card.tl-selected {
    border-color: var(--primary);
    background: rgba(230,81,0,0.06);
    animation: wv-selectPop 0.28s var(--ease-bounce, cubic-bezier(0.34,1.56,0.64,1)) forwards;
  }
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
  }
  .wv-tl-meta { font-size: 11px; color: var(--text-light); margin-top: 1px; }
  .wv-tl-action {
    flex-shrink: 0; padding: 6px; border-radius: 8px;
    background: transparent; border: none; color: var(--text-muted);
    cursor: pointer; display: flex; align-items: center; justify-content: center;
  }
  .wv-tl-action:active { background: var(--surface); }
  .wv-tl-spin-chip {
    flex-shrink: 0; padding: 5px 10px; border-radius: 8px;
    background: rgba(230,81,0,0.1); border: none;
    color: var(--primary); font-size: 11px; font-weight: 700;
    cursor: pointer; display: flex; align-items: center; gap: 4px;
    transition: transform 100ms ease;
  }
  .wv-tl-spin-chip:active { transform: scale(0.93); }
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
  .wv-tl-next-collapsed {
    margin: 6px 12px 8px; padding: 12px 14px;
    background: var(--surface); border-radius: 12px;
    display: flex; align-items: center; justify-content: space-between;
    cursor: pointer; border: 1px solid var(--border);
    transition: transform 160ms cubic-bezier(0.23,1,0.32,1);
    -webkit-tap-highlight-color: transparent;
  }
  .wv-tl-next-collapsed:active { transform: scale(0.98); }
  .wv-tl-toggle {
    display: flex; gap: 0; padding: 3px;
    background: var(--surface); border-radius: 12px;
    position: relative;
    border: 1.5px solid var(--border);
  }
  .wv-tl-toggle-btn {
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
    position: absolute; top: 3px; bottom: 3px;
    border-radius: 9px;
    background: var(--card);
    box-shadow: 0 1px 4px rgba(0,0,0,0.10), 0 0 0 0.5px rgba(0,0,0,0.04);
    z-index: 1;
    transition: left 0.3s cubic-bezier(0.32,0.72,0,1), width 0.3s cubic-bezier(0.32,0.72,0,1);
  }
  @media (prefers-reduced-motion: reduce) {
    .wv-tl-card, .wv-tl-spin-chip, .wv-tl-next-collapsed,
    .wv-tl-toggle-btn, .wv-tl-action { transition: none !important; }
    .wv-tl-card:active, .wv-tl-spin-chip:active,
    .wv-tl-next-collapsed:active { transform: none !important; }
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
  const [showCustomDayTagInput, setShowCustomDayTagInput] = useState(false);
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
            <div className="pk-specials" style={{ maxHeight: 120, overflowY: 'auto', flexWrap: 'wrap' }}>
              {specialDays.map(s => (
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
              ))}
              {onAddCustomDayTag && (
                <button
                  className="pk-chip"
                  onClick={() => setShowCustomDayTagInput(true)}
                  style={{ borderStyle: 'dashed', opacity: 0.7 }}
                >
                  <Plus size={12} strokeWidth={2.5} /> Custom
                </button>
              )}
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

  const thisWeekDates = useMemo(() =>
    [0,1,2,3,4,5,6].map(i => addDays(currentWeekMonday, i)), [currentWeekMonday]);
  const nextWeekMonday = useMemo(() => addDays(currentWeekMonday, 7), [currentWeekMonday]);
  const nextWeekDates = useMemo(() =>
    [0,1,2,3,4,5,6].map(i => addDays(nextWeekMonday, i)), [nextWeekMonday]);
  const [nextWeekExpanded, setNextWeekExpanded] = useState(false);

  const nextWeekPlannedCount = useMemo(() => {
    return nextWeekDates.filter(d => {
      const { meal } = getMealForDate(d);
      return !!meal;
    }).length;
  }, [nextWeekDates, getMealForDate]);

  const enterGroceryMode = useCallback(() => {
    const autoSelected = new Set();
    thisWeekDates.forEach(d => {
      const { meal } = getMealForDate(d);
      if (meal && !meal._special) autoSelected.add(dateKey(d));
    });
    setGroceryDays(autoSelected);
    setGrocerySelectMode(true);
    setSelectMode(false);
    setSelectedDates(new Set());
  }, [thisWeekDates, getMealForDate]);

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', userSelect: 'none' }}>

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
              The Rotation
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
        <div style={{ flex: 1, overflowY: 'auto', paddingTop: 4, paddingBottom: 8 }}>
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
            grocerySelectMode={grocerySelectMode}
            groceryDays={groceryDays}
            onGroceryToggle={handleGroceryToggle}
          />

          <div
            className="wv-tl-next-collapsed"
            onClick={() => setNextWeekExpanded(x => !x)}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-light)' }}>
                Next week
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                {nextWeekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {nextWeekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                <span style={{ marginLeft: 6 }}>{nextWeekPlannedCount}/7 planned</span>
              </div>
            </div>
            <motion.div
              animate={{ rotate: nextWeekExpanded ? 180 : 0 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            >
              <ChevronDown size={18} color="var(--text-muted)" strokeWidth={2} />
            </motion.div>
          </div>

          <AnimatePresence>
            {nextWeekExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                style={{ overflow: 'hidden' }}
              >
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
                  grocerySelectMode={grocerySelectMode}
                  groceryDays={groceryDays}
                  onGroceryToggle={handleGroceryToggle}
                />
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
              {onChangeDietaryPref && (
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 10px', borderRadius: 10,
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  fontSize: 12.5, fontWeight: 600, color: 'var(--text-light)',
                }}>
                  <span style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>Plan for</span>
                  <select
                    value={dietaryPref?.dietary || ''}
                    onChange={(e) => onChangeDietaryPref({ dietary: e.target.value, mode: 'require' })}
                    style={{
                      flex: 1, minWidth: 0, padding: '5px 8px', borderRadius: 8,
                      border: '1.5px solid var(--border)', background: 'var(--bg)',
                      color: 'var(--text)', font: 'inherit', fontWeight: 700, fontSize: 13,
                    }}
                  >
                    <option value="">Any diet</option>
                    <option value="vegetarian">Vegetarian</option>
                    <option value="vegan">Vegan</option>
                    <option value="gluten-free">Gluten-free</option>
                    <option value="dairy-free">Dairy-free</option>
                    <option value="keto">Keto</option>
                    <option value="paleo">Paleo</option>
                  </select>
                </label>
              )}
              <button
                onClick={() => { setJustCompletedSpin(false); navigator.vibrate?.([40, 25, 40]); onSmartPlan?.(); }}
                style={PRIMARY_BTN}
              >
                Plan my Week{rotationCount > 0 ? ` (${rotationCount})` : ''}
              </button>
              {(onLockAll || onUnlockAll) && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => { onLockAll?.(); setJustCompletedSpin(false); }}
                    style={{ ...SECONDARY_BTN, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '10px 8px', fontSize: 12 }}
                  >
                    🔒 Lock All
                  </button>
                  <button
                    onClick={() => { onUnlockAll?.(); setJustCompletedSpin(false); }}
                    style={{ ...SECONDARY_BTN, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '10px 8px', fontSize: 12 }}
                  >
                    🔓 Unlock All
                  </button>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => { setJustCompletedSpin(false); navigator.vibrate?.([50, 30, 50]); onGenerate(); }}
                  style={{ ...SECONDARY_BTN, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                >
                  <RefreshCw size={14} strokeWidth={2.5} /> Spin
                </button>
                <button
                  onClick={() => { setJustCompletedSpin(false); setSelectMode(true); }}
                  style={{ ...SECONDARY_BTN, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                >
                  <CheckSquare size={14} strokeWidth={2.5} /> Select
                </button>
                {hasWeek && !grocerySelectMode && (
                  <button onClick={enterGroceryMode} style={{ ...SECONDARY_BTN, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                    <ShoppingCart size={14} strokeWidth={2.5} /> Grocery
                  </button>
                )}
              </div>
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

      {(cookingStats.streak > 0 || cookingStats.totalCooked > 0) && !showSpinner && (
        <div style={{
          display: 'flex', gap: 20, justifyContent: 'center', alignItems: 'center',
          padding: '8px 16px 12px',
          background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
        }}>
          {cookingStats.streak > 0 && (
            <StatPill icon="🔥" value={cookingStats.streak} label="streak" color="var(--primary)" />
          )}
          {cookingStats.totalCooked > 0 && (
            <StatPill icon="🍳" value={cookingStats.totalCooked} label="cooked" color="var(--text)" />
          )}
          {cookingStats.topMeal && (
            <StatPill icon="⭐" value={cookingStats.topMeal.name?.substring(0, 10) + '…'} label="top pick" color="var(--text)" />
          )}
        </div>
      )}

      {renderPicker()}
    </div>
  );
}

// ── Premium segmented toggle ─────────────────────────────────────────────────
function ViewToggle({ viewMode, onChangeMode }) {
  const toggleRef = useRef(null);
  const weekBtnRef = useRef(null);
  const monthBtnRef = useRef(null);
  const [pillStyle, setPillStyle] = useState({});

  useEffect(() => {
    const container = toggleRef.current;
    const activeBtn = viewMode === 'timeline' ? weekBtnRef.current : monthBtnRef.current;
    if (!container || !activeBtn) return;
    const cRect = container.getBoundingClientRect();
    const bRect = activeBtn.getBoundingClientRect();
    setPillStyle({
      left: bRect.left - cRect.left,
      width: bRect.width,
    });
  }, [viewMode]);

  return (
    <div className="wv-tl-toggle" ref={toggleRef}>
      <div
        className="wv-tl-toggle-pill"
        style={{ left: pillStyle.left ?? 3, width: pillStyle.width ?? '50%' }}
      />
      <button
        ref={weekBtnRef}
        className={`wv-tl-toggle-btn ${viewMode === 'timeline' ? 'active' : ''}`}
        onClick={() => onChangeMode('timeline')}
      >
        <List size={14} strokeWidth={2.5} /> Week
      </button>
      <button
        ref={monthBtnRef}
        className={`wv-tl-toggle-btn ${viewMode === 'month' ? 'active' : ''}`}
        onClick={() => onChangeMode('month')}
      >
        <CalendarDays size={14} strokeWidth={2.5} /> Month
      </button>
    </div>
  );
}

const TL_STAGGER_DELAY = 40;

function TimelineWeek({
  weekDates, today, getMealForDate, currentWeekMonday,
  selectMode, selectedDates, onCellClick, onToggleSelect,
  onRespin, onSpinForDate, grocerySelectMode, groceryDays, onGroceryToggle,
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

        const classes = ['wv-tl-card'];
        if (isToday) classes.push('tl-today');
        if (!meal && !isPast) classes.push('tl-empty');
        if (isPast && !isToday) classes.push('tl-past');
        if (isSelected) classes.push('tl-selected');
        if (isGroceryActive) classes.push('tl-grocery-active');
        if (isGroceryExcluded) classes.push('tl-grocery-excluded');

        return (
          <motion.div
            key={key}
            data-datekey={key}
            className={classes.join(' ')}
            onClick={() => grocerySelectMode && meal && !meal._special ? onGroceryToggle(key) : onCellClick(date)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: isPast && !isToday ? 0.55 : 1, y: 0 }}
            transition={{ duration: 0.3, delay: idx * TL_STAGGER_DELAY / 1000, ease: [0.23, 1, 0.32, 1] }}
          >
            <div className="wv-tl-dow">
              <div className="wv-tl-dow-label">{dayName}</div>
              <div className="wv-tl-dow-num">{date.getDate()}</div>
            </div>

            <div className="wv-tl-grocery-badge" aria-hidden="true">✓</div>

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

            <div className="wv-tl-info">
              {meal ? (
                <>
                  <div className="wv-tl-name">
                    {isSpecial ? meal.name : meal.name}
                    {isLocked && <span style={{ marginLeft: 6, fontSize: 11 }}>🔒</span>}
                  </div>
                  <div className="wv-tl-meta">
                    {isSpecial ? 'Special day' : `${meal.ingredients?.length || 0} ingredients${meal.category ? ` · ${meal.category}` : ''}`}
                  </div>
                </>
              ) : (
                <div className="wv-tl-meta" style={{ fontSize: 12.5 }}>
                  {isPast ? 'No meal planned' : 'Tap to add or spin'}
                </div>
              )}
            </div>

            {!selectMode && !isPast && !grocerySelectMode && (
              meal ? (
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
              )
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

function DetailPanel({ show, activeDate, today, getMealForDate, isCurrentWeek, onClose, onToggleLock,
  onViewDetail, onRespin, onSpinForDate, onOpenPicker, onClearDay }) {
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
                      <h4 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#fff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                      <h4 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

function StatPill({ icon, value, label, color }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 48 }}>
      <div style={{ fontSize: 20, marginBottom: 2 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        {label}
      </div>
    </div>
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
