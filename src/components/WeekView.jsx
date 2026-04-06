import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import MealSpinner from './MealSpinner';

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
  // Use local date parts to avoid timezone issues
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
  const startDow = firstDay.getDay(); // 0=Sun, already leftmost column
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - startDow); // rewind to the Sunday before (or on) month start
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
`;

// ── Component ─────────────────────────────────────────────────────────────────
export default function WeekView({
  days, weekPlan, meals, specialDays,
  onGenerate, onRespin, onSetDay, onSetSpecial, onViewDetail, onBuildGrocery,
  onToggleLock,
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
}) {
  // ── Core state ──────────────────────────────────────────────────────────────
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const currentWeekMonday = useMemo(() => getMonday(today), [today]);

  const [viewYear,  setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [activeDate, setActiveDate] = useState(today);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedDates, setSelectedDates] = useState(new Set());
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [pickerDay, setPickerDay] = useState(null);
  const [slideDir, setSlideDir] = useState(null); // 'left'|'right'|null (month transition)
  const [spinnerSelectedIndices, setSpinnerSelectedIndices] = useState(null);
  const [spinnerTargetDates, setSpinnerTargetDates] = useState(null);

  // ── Long-press + drag refs ──────────────────────────────────────────────────
  const longPressTimerRef     = useRef(null);
  const longPressRafRef       = useRef(null);
  const isDraggingSelectRef   = useRef(false);
  const lastDragKeyRef        = useRef(null);
  const longPressStartTimeRef = useRef(null);
  const [lpProgress, setLpProgress] = useState(null); // { key, pct }

  // ── Calendar cells ──────────────────────────────────────────────────────────
  const calendarCells = useMemo(() => getCalendarCells(viewYear, viewMonth), [viewYear, viewMonth]);
  const calendarGridRef = useRef(null);

  // Inject keyframes once
  useEffect(() => {
    if (document.getElementById('wv-anim-style')) return;
    const style = document.createElement('style');
    style.id = 'wv-anim-style';
    style.textContent = ANIMATIONS_CSS;
    document.head.appendChild(style);
    return () => {};
  }, []);

  // ── Meal lookup ─────────────────────────────────────────────────────────────
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

  // ── Month navigation ────────────────────────────────────────────────────────
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

  // ── Long-press detection ────────────────────────────────────────────────────
  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current)   clearTimeout(longPressTimerRef.current);
    if (longPressRafRef.current)     cancelAnimationFrame(longPressRafRef.current);
    longPressStartTimeRef.current = null;
    setLpProgress(null);
  }, []);

  const handleCellTouchStart = useCallback((e, date) => {
    // Don't prevent default here — we still want scrolling if not long-pressing
    cancelLongPress();
    const key = dateKey(date);
    longPressStartTimeRef.current = Date.now();

    // Animate the progress ring
    const animateRing = () => {
      if (!longPressStartTimeRef.current) return;
      const elapsed = Date.now() - longPressStartTimeRef.current;
      const pct = Math.min(elapsed / LONG_PRESS_MS, 1);
      setLpProgress({ key, pct });
      if (pct < 1) longPressRafRef.current = requestAnimationFrame(animateRing);
    };
    longPressRafRef.current = requestAnimationFrame(animateRing);

    longPressTimerRef.current = setTimeout(() => {
      // Activate select mode via long press
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

  // ── Grid-level touch-move for drag selection ────────────────────────────────
  const handleGridTouchMove = useCallback((e) => {
    if (!isDraggingSelectRef.current) {
      // Cancel long press if user scrolls
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

  // ── Normal cell tap ─────────────────────────────────────────────────────────
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

  // ── Spin selected days ──────────────────────────────────────────────────────
  const handleSpinSelected = useCallback(() => {
    // Collect ALL selected dates (any week), sorted chronologically
    const sortedDates = Array.from(selectedDates)
      .map(key => dateFromKey(key))
      .sort((a, b) => a - b);

    if (sortedDates.length === 0) return;

    // Mon-first DOW index (0=Mon..6=Sun) for each date — used in MealSpinner for locked-meal lookup
    const indices = sortedDates.map(date => date.getDay() === 0 ? 6 : date.getDay() - 1);

    setSpinnerTargetDates(sortedDates);
    setSpinnerSelectedIndices(indices);
    setSelectMode(false);
    setSelectedDates(new Set());
    onGenerate();
  }, [selectedDates, onGenerate]);

  // Dates for each spinner slot (shown as labels inside spinner)
  const spinnerSlotDates = useMemo(() => {
    if (spinnerTargetDates && spinnerTargetDates.length > 0) return spinnerTargetDates;
    // Default: full current week Mon→Sun
    return [0,1,2,3,4,5,6].map(idx => addDays(currentWeekMonday, idx));
  }, [spinnerTargetDates, currentWeekMonday]);

  // ── Meal picker ─────────────────────────────────────────────────────────────
  const openPicker = useCallback((date) => {
    const dow = date.getDay() === 0 ? 6 : date.getDay() - 1;
    setPickerDay(dow);
  }, []);
  const closePicker = useCallback(() => setPickerDay(null), []);

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
          {!isPastDay && (
            <div className="pk-specials">
              {specialDays.map(s => (
                <button key={s.id} className="pk-chip"
                  onClick={() => { onSetSpecial(pickerDay, s.id); closePicker(); }}>
                  <span>{s.icon}</span> {s.name}
                </button>
              ))}
              {currentMeal && (
                <button className="pk-chip clear"
                  onClick={() => { onSetSpecial(pickerDay, null); closePicker(); }}>
                  ✕ Clear
                </button>
              )}
            </div>
          )}
          <div className="pk-list">
            {meals.map(meal => {
              const isCur = currentMeal && !currentMeal._special && currentMeal.id === meal.id;
              return (
                <div key={meal.id} className={`pk-item ${isCur ? 'current' : ''}`}
                  onClick={() => { onSetDay(pickerDay, meal); closePicker(); }}>
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

  // ── Derived values ──────────────────────────────────────────────────────────
  const isCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth();
  const plannedCount   = weekPlan.filter(Boolean).length;
  const hasWeek        = plannedCount > 0;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', userSelect: 'none' }}>

      {/* ── Month nav header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 12px 8px',
        background: 'var(--card)',
        borderBottom: '1px solid var(--border)',
      }}>
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

        {/* Select mode toggle (button) */}
        <button
          onClick={() => { setSelectMode(s => !s); setSelectedDates(new Set()); }}
          style={{
            ...SELECT_TOGGLE_BTN,
            background: selectMode ? 'var(--primary)' : 'transparent',
            color:      selectMode ? 'white' : 'var(--text-light)',
            borderColor: selectMode ? 'var(--primary)' : 'var(--border)',
          }}
        >
          {selectMode ? '✓ Done' : '☑ Select'}
        </button>

        <button onClick={handleNextMonth} style={NAV_BTN}>›</button>
      </div>

      {/* Select mode hint bar */}
      {selectMode && (
        <div style={{
          background: 'var(--primary)', color: 'white',
          padding: '6px 16px', fontSize: 12, fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          animation: 'wv-fadeIn 0.2s ease both',
        }}>
          <span>Tap or drag days to select · Long-press starts here too</span>
          {selectedDates.size > 0 && (
            <span style={{
              background: 'rgba(255,255,255,0.25)', borderRadius: 10,
              padding: '1px 8px',
            }}>{selectedDates.size} selected</span>
          )}
        </div>
      )}

      {/* ── Day-of-week labels ── */}
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

      {/* ── Calendar grid ── */}
      <div
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
          const isDow56     = date.getDay() === 0 || date.getDay() === 6; // weekend
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
              {/* Long-press progress ring */}
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

              {/* Selection ripple */}
              {isSelected && (
                <div style={{
                  position: 'absolute', inset: 0, pointerEvents: 'none',
                  background: 'rgba(230,81,0,0.08)',
                }} />
              )}

              {/* Day number */}
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

              {/* Lock indicator */}
              {isLocked && (
                <span style={{ fontSize: 8, lineHeight: 1, marginTop: 1 }}>🔒</span>
              )}

              {/* Meal preview */}
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

              {/* Special day icon */}
              {isSpecial && (
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, marginTop: 2,
                  animation: 'wv-mealFadeIn 0.2s ease both',
                }}>
                  {meal.icon}
                </div>
              )}

              {/* No meal dot for current/future empty */}
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
      </div>

      {/* ── Detail Panel (slides up from bottom) ── */}
      <DetailPanel
        show={showDetailPanel}
        activeDate={activeDate}
        today={today}
        getMealForDate={getMealForDate}
        onClose={() => setShowDetailPanel(false)}
        onToggleLock={onToggleLock}
        onViewDetail={(meal) => { setShowDetailPanel(false); onViewDetail(meal); }}
        onRespin={(dow) => { onRespin(dow); setShowDetailPanel(false); }}
        onOpenPicker={() => { openPicker(activeDate); setShowDetailPanel(false); }}
        onClearDay={(dow) => { onSetSpecial(dow, null); setShowDetailPanel(false); }}
      />

      {/* ── Spinner overlay ── */}
      {showSpinner && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 400, padding: '16px',
          animation: 'wv-fadeIn 0.2s ease both',
        }}>
          <MealSpinner
            meals={meals}
            rotationMeals={rotationMeals}
            currentPlan={currentPlan}
            onComplete={(pickedMeals) => {
              // Map each picked meal to its target date → [{date, meal}] pairs
              const targetDates = spinnerTargetDates && spinnerTargetDates.length > 0
                ? spinnerTargetDates
                : [0,1,2,3,4,5,6].map(idx => addDays(currentWeekMonday, idx));
              const pairs = pickedMeals.map((meal, i) => ({ date: targetDates[i], meal }));
              onSpinnerComplete(pairs);
              setSpinnerSelectedIndices(null);
              setSpinnerTargetDates(null);
            }}
            onClose={() => {
              onCloseSpinner();
              setSpinnerSelectedIndices(null);
              setSpinnerTargetDates(null);
            }}
            selectedDayIndices={spinnerSelectedIndices}
            slotDates={spinnerSlotDates}
          />
        </div>
      )}

      {/* ── Action bar ── */}
      {!showSpinner && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 8,
          padding: '10px 16px 12px',
          background: 'var(--card)',
          borderTop: '1px solid var(--border)',
        }}>
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
              <button onClick={onGenerate} style={PRIMARY_BTN}>
                🎰 Spin the Week{rotationCount > 0 ? ` (${rotationCount})` : ''}
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setSelectMode(true)}
                  style={{ ...SECONDARY_BTN, flex: 1 }}
                >
                  📌 Select Days
                </button>
                {hasWeek && (
                  <button onClick={onBuildGrocery} style={{ ...SECONDARY_BTN, flex: 1 }}>
                    🛒 Grocery
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Stats strip ── */}
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

      {/* Meal picker sheet */}
      {renderPicker()}
    </div>
  );
}

// ── Detail Panel sub-component ────────────────────────────────────────────────
function DetailPanel({ show, activeDate, today, getMealForDate, onClose, onToggleLock,
  onViewDetail, onRespin, onOpenPicker, onClearDay }) {
  if (!show) return null;

  const { meal, isCurrent, dow } = getMealForDate(activeDate);
  const isToday     = activeDate.getFullYear() === today.getFullYear() &&
    activeDate.getMonth() === today.getMonth() &&
    activeDate.getDate() === today.getDate();
  const isPast      = activeDate < today && !isToday;
  const isSpecial   = meal && meal._special;

  return (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 250,
          animation: 'wv-fadeIn 0.2s ease both',
        }}
      />
      {/* Sheet */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        maxWidth: 600, margin: '0 auto',
        background: 'var(--card)',
        borderRadius: '20px 20px 0 0',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
        zIndex: 260,
        maxHeight: '72vh',
        overflowY: 'auto',
        animation: 'wv-slideUp 0.3s cubic-bezier(0.32,0.72,0,1) both',
      }}>
        {/* Handle */}
        <div style={{
          width: 36, height: 4, borderRadius: 2, background: 'var(--border)',
          margin: '10px auto 0',
        }} />

        {/* Header */}
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

        {/* Content */}
        <div style={{ padding: '0 16px 24px' }}>
          {!meal ? (
            /* Empty state */
            <div style={{
              textAlign: 'center', padding: '24px 0',
              animation: 'wv-fadeIn 0.25s ease both',
            }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🍽️</div>
              <p style={{ color: 'var(--text-light)', marginBottom: 16, fontSize: 15 }}>
                {isPast ? 'Nothing was planned here.' : 'Nothing planned yet.'}
              </p>
              {!isPast && (
                <button onClick={onOpenPicker} style={{ ...PRIMARY_BTN, width: '100%' }}>
                  + Add a Meal
                </button>
              )}
            </div>
          ) : isSpecial ? (
            /* Special day */
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
                  ✕ Clear Day
                </button>
              )}
            </div>
          ) : (
            /* Regular meal */
            <div style={{ animation: 'wv-fadeIn 0.25s ease both' }}>
              {/* Meal card */}
              <div style={{
                background: 'var(--surface)', borderRadius: 14, overflow: 'hidden',
                marginBottom: 14,
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              }}>
                {meal.imageUrl && (
                  <img src={meal.imageUrl} alt={meal.name}
                    style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block' }}
                    onError={e => e.target.style.display = 'none'}
                  />
                )}
                <div style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <h4 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--text)', flex: 1 }}>
                      {meal.name}
                    </h4>
                    {meal._locked && (
                      <span style={{
                        background: 'rgba(230,81,0,0.12)', color: 'var(--primary)',
                        borderRadius: 20, padding: '2px 8px', fontSize: 11, fontWeight: 700,
                      }}>🔒 Locked</span>
                    )}
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-light)' }}>
                    {meal.ingredients?.length || 0} ingredients
                    {meal.category ? ` · ${meal.category}` : ''}
                    {meal.rating ? ` · ${'⭐'.repeat(meal.rating)}` : ''}
                  </p>
                </div>
              </div>

              {/* Action buttons grid */}
              {isCurrent && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button onClick={() => onViewDetail(meal)} style={OUTLINE_BTN}>
                    📖 View Recipe
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

              {/* Past week - show restore option */}
              {!isCurrent && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button onClick={() => onViewDetail(meal)} style={OUTLINE_BTN}>
                    📖 View Recipe
                  </button>
                  <button
                    onClick={() => { onOpenPicker(); }}
                    style={PRIMARY_BTN}
                  >
                    ↩ Use This Meal Today
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Stat pill sub-component ───────────────────────────────────────────────────
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

// ── Shared button styles ──────────────────────────────────────────────────────
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
