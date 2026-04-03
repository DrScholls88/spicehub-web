import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import MealSpinner from './MealSpinner';

// Helper: image component with proper fallback
function MealImage({ src, alt, className, fallbackEmoji = '🍽️', fallbackClass }) {
  const [status, setStatus] = useState(src ? 'loading' : 'fallback');
  const imgRef = useRef(null);

  useEffect(() => {
    setStatus(src ? 'loading' : 'fallback');
  }, [src]);

  if (status === 'fallback' || !src) {
    return <div className={fallbackClass || className}>{fallbackEmoji}</div>;
  }

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt || ''}
      className={className}
      onLoad={() => setStatus('loaded')}
      onError={() => setStatus('fallback')}
      style={status === 'loading' ? { minHeight: 60, background: 'var(--surface-2, #f5f5f5)' } : undefined}
    />
  );
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function formatMonth(monday) {
  const sunday = addDays(monday, 6);
  if (monday.getMonth() === sunday.getMonth()) {
    return monday.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  return `${monday.toLocaleDateString('en-US', { month: 'short' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
}

function formatWeekRange(weekStart) {
  const mon = new Date(weekStart);
  const sun = addDays(mon, 6);
  const opts = { month: 'short', day: 'numeric' };
  return `${mon.toLocaleDateString('en-US', opts)} – ${sun.toLocaleDateString('en-US', opts)}`;
}

function getWeeksAgoLabel(weekStart) {
  const now = getMonday(new Date());
  const then = new Date(weekStart);
  const diffWeeks = Math.round((now - then) / (7 * 24 * 60 * 60 * 1000));
  if (diffWeeks === 0) return 'This week';
  if (diffWeeks === 1) return 'Last week';
  return `${diffWeeks}w ago`;
}

// ── Mini week card (used in both current and past views) ─────────────────────
function MiniWeekCard({ weekMeals, label, sublabel, isCurrent, onRestoreWeek, onRestoreMeal, onSelectDay }) {
  return (
    <div className={`wv2-mini-week${isCurrent ? ' current' : ''}`}>
      <div className="wv2-mini-week-hdr">
        <span className="wv2-mini-week-label">{label}</span>
        {sublabel && <span className="wv2-mini-week-sub">{sublabel}</span>}
        {!isCurrent && onRestoreWeek && (
          <button className="wv2-mini-restore" onClick={() => onRestoreWeek(weekMeals)}>
            ↩ Use
          </button>
        )}
      </div>
      <div className="wv2-mini-days">
        {DAY_LABELS.map((day, i) => {
          const entry = weekMeals?.[i];
          const isSpecial = entry && entry._special;
          const hasMeal = !!entry;
          return (
            <div
              key={i}
              className={`wv2-mini-day${hasMeal ? ' filled' : ''}`}
              onClick={() => {
                if (isCurrent && onSelectDay) onSelectDay(i);
                else if (!isCurrent && hasMeal && !isSpecial && onRestoreMeal) onRestoreMeal(entry, i);
              }}
            >
              <span className="wv2-mini-day-lbl">{day}</span>
              {isSpecial ? (
                <span className="wv2-mini-day-icon">{entry.icon}</span>
              ) : hasMeal ? (
                <div className="wv2-mini-day-meal">
                  {entry.imageUrl ? (
                    <MealImage src={entry.imageUrl} alt="" className="wv2-mini-day-img" fallbackEmoji="" fallbackClass="wv2-mini-day-img-ph" />
                  ) : (
                    <div className="wv2-mini-day-img-ph">🍽️</div>
                  )}
                  <span className="wv2-mini-day-name">{entry.name}</span>
                </div>
              ) : (
                <span className="wv2-mini-day-empty">—</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function WeekView({
  days, weekPlan, meals, specialDays,
  onGenerate, onRespin, onSetDay, onSetSpecial, onViewDetail, onBuildGrocery,
  cookingStats = {},
  weekHistory = [],
  onRestoreWeek,
  onRestoreMeal,
  rotationCount = 0,
  showSpinner,
  onCloseSpinner,
  onSpinnerComplete,
  rotationMeals,
}) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const thisMonday = useMemo(() => getMonday(today), [today]);

  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(() => {
    const d = today.getDay();
    return d === 0 ? 6 : d - 1;
  });
  const [pickerDay, setPickerDay] = useState(null);
  const [swipeStart, setSwipeStart] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  const activeMonday = useMemo(() => addDays(thisMonday, weekOffset * 7), [thisMonday, weekOffset]);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(activeMonday, i)), [activeMonday]);

  const isCurrentWeek = weekOffset === 0;
  const hasWeek = weekPlan.some(Boolean);
  const plannedCount = weekPlan.filter(Boolean).length;

  const todayIdx = useMemo(() => {
    const d = today.getDay();
    return d === 0 ? 6 : d - 1;
  }, [today]);

  // Touch swipe handling for week navigation
  const handleTouchStart = useCallback((e) => {
    setSwipeStart(e.touches[0].clientX);
  }, []);

  const handleTouchEnd = useCallback((e) => {
    if (swipeStart === null) return;
    const diff = swipeStart - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 60) {
      if (diff > 0) {
        if (showHistory) { /* swipe in history doesn't navigate weeks */ }
        else setWeekOffset(o => o + 1);
      } else {
        if (showHistory) { /* swipe in history doesn't navigate weeks */ }
        else setWeekOffset(o => o - 1);
      }
    }
    setSwipeStart(null);
  }, [swipeStart, showHistory]);

  const openPicker = useCallback((idx) => {
    setPickerDay(prev => prev === idx ? null : idx);
  }, []);

  const closePicker = useCallback(() => setPickerDay(null), []);

  const handleRestoreMealToDay = useCallback((meal, dayIdx) => {
    if (meal && !meal._special) {
      onSetDay(dayIdx, meal);
    }
  }, [onSetDay]);

  const selectedEntry = weekPlan[selectedDay];
  const selectedIsSpecial = selectedEntry && selectedEntry._special;

  // Filter out "this week" from history for the side panel
  const pastWeeks = useMemo(() => {
    const currentMondayStr = thisMonday.toISOString();
    return weekHistory.filter(hw => hw.weekStart !== currentMondayStr);
  }, [weekHistory, thisMonday]);

  // ── SPLIT VIEW MODE (History active) ──────────────────────────────────────
  if (showHistory) {
    return (
      <div className="wv2 wv2-split-mode">
        {/* Toggle bar */}
        <div className="wv2-split-toggle">
          <button className="wv2-split-toggle-btn active" onClick={() => setShowHistory(false)}>
            ✕ Close History
          </button>
        </div>

        <div className="wv2-split-container">
          {/* LEFT: Current week (condensed) */}
          <div className="wv2-split-current">
            <div className="wv2-split-section-hdr">
              <span>This Week</span>
              <span className="wv2-split-section-sub">{plannedCount}/7</span>
            </div>
            <MiniWeekCard
              weekMeals={weekPlan}
              label={formatMonth(activeMonday)}
              isCurrent
              onSelectDay={(i) => { setSelectedDay(i); setShowHistory(false); }}
            />
            <div className="wv2-split-actions">
              <button className="wv2-btn primary compact" onClick={onGenerate}>
                🎰 Spin{rotationCount > 0 ? ` (${rotationCount})` : ''}
              </button>
              {hasWeek && (
                <button className="wv2-btn secondary compact" onClick={onBuildGrocery}>
                  🛒 Grocery
                </button>
              )}
            </div>
          </div>

          {/* RIGHT: Past weeks (scrollable) */}
          <div className="wv2-split-history">
            <div className="wv2-split-section-hdr">
              <span>Past Weeks</span>
              <span className="wv2-split-section-sub">{pastWeeks.length} saved</span>
            </div>
            <div className="wv2-split-history-scroll">
              {pastWeeks.length === 0 ? (
                <div className="wv2-split-empty">
                  <p>No past weeks saved yet.</p>
                  <p>Your weekly plans will appear here automatically.</p>
                </div>
              ) : (
                pastWeeks.map((hw) => (
                  <MiniWeekCard
                    key={hw.id}
                    weekMeals={hw.meals}
                    label={formatWeekRange(hw.weekStart)}
                    sublabel={getWeeksAgoLabel(hw.weekStart)}
                    onRestoreWeek={onRestoreWeek}
                    onRestoreMeal={handleRestoreMealToDay}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Meal picker (still available) */}
        {pickerDay !== null && renderPicker()}
      </div>
    );
  }

  // ── NORMAL VIEW MODE ──────────────────────────────────────────────────────
  function renderPicker() {
    return (
      <div className="pk-overlay" onClick={closePicker}>
        <div className="pk-sheet" onClick={e => e.stopPropagation()}>
          <div className="pk-handle" />
          <div className="pk-hdr">
            <h3>Choose for {DAY_FULL[pickerDay]}</h3>
            <button className="pk-close" onClick={closePicker}>✕</button>
          </div>

          <div className="pk-specials">
            {specialDays.map(s => (
              <button
                key={s.id}
                className="pk-chip"
                onClick={() => { onSetSpecial(pickerDay, s.id); closePicker(); }}
              >
                <span>{s.icon}</span> {s.name}
              </button>
            ))}
            {weekPlan[pickerDay] && (
              <button
                className="pk-chip clear"
                onClick={() => { onSetSpecial(pickerDay, null); closePicker(); }}
              >
                ✕ Clear
              </button>
            )}
          </div>

          <div className="pk-list">
            {meals.map(meal => {
              const isCurrent = weekPlan[pickerDay] && !weekPlan[pickerDay]._special && weekPlan[pickerDay].id === meal.id;
              return (
                <div
                  key={meal.id}
                  className={`pk-item ${isCurrent ? 'current' : ''}`}
                  onClick={() => { onSetDay(pickerDay, meal); closePicker(); }}
                >
                  <MealImage
                    src={meal.imageUrl}
                    alt=""
                    className="pk-img"
                    fallbackClass="pk-img-ph"
                  />
                  <div className="pk-info">
                    <span className="pk-name">{meal.name}</span>
                    <span className="pk-meta">
                      {meal.ingredients?.length || 0} ingredients
                      {meal.category ? ` · ${meal.category}` : ''}
                      {meal.inRotation && ' · 🔄'}
                    </span>
                  </div>
                  {isCurrent && <span className="pk-badge">current</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="wv2"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* ── Compact header with week nav ── */}
      <div className="wv2-header">
        <button className="wv2-nav" onClick={() => setWeekOffset(o => o - 1)} aria-label="Previous week">‹</button>
        <div className="wv2-header-center">
          <span className="wv2-month">{formatMonth(activeMonday)}</span>
          {!isCurrentWeek && (
            <button className="wv2-today-link" onClick={() => { setWeekOffset(0); setSelectedDay(todayIdx); }}>
              Back to today
            </button>
          )}
        </div>
        <button className="wv2-nav" onClick={() => setWeekOffset(o => o + 1)} aria-label="Next week">›</button>
      </div>

      {/* ── Day strip (clean pills) ── */}
      <div className="wv2-strip">
        {DAY_LABELS.map((label, i) => {
          const date = weekDates[i];
          const isToday = isCurrentWeek && i === todayIdx;
          const isSelected = i === selectedDay;
          const hasContent = !!weekPlan[i];
          return (
            <button
              key={i}
              className={`wv2-pill${isSelected ? ' sel' : ''}${isToday ? ' today' : ''}`}
              onClick={() => setSelectedDay(i)}
            >
              <span className="wv2-pill-lbl">{label}</span>
              <span className="wv2-pill-num">{date.getDate()}</span>
              {hasContent && <span className="wv2-pill-dot" />}
            </button>
          );
        })}
      </div>

      {/* ── Progress bar ── */}
      <div className="wv2-progress-wrap">
        <div className="wv2-progress-bar">
          <div className="wv2-progress-fill" style={{ width: `${(plannedCount / 7) * 100}%` }} />
        </div>
        <span className="wv2-progress-label">{plannedCount}/7 planned</span>
      </div>

      {/* ── Meal Spinner or Selected day/Week list ── */}
      {showSpinner ? (
        <MealSpinner
          meals={meals}
          rotationMeals={rotationMeals}
          onComplete={onSpinnerComplete}
          onClose={onCloseSpinner}
        />
      ) : (
        <>
          <div className={`wv2-hero ${selectedEntry && selectedEntry._locked ? 'locked' : ''}`}>
            <div className="wv2-hero-hdr">
              <h2 className="wv2-hero-day">
                {DAY_FULL[selectedDay]}
                {isCurrentWeek && selectedDay === todayIdx && <span className="wv2-badge">Today</span>}
              </h2>
              <span className="wv2-hero-date">
                {weekDates[selectedDay].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>

            {selectedIsSpecial ? (
              <div className="wv2-hero-special">
                <span className="wv2-hero-special-icon">{selectedEntry.icon}</span>
                <span className="wv2-hero-special-name">{selectedEntry.name}</span>
                <button className="wv2-clear-btn" onClick={() => onSetSpecial(selectedDay, null)}>Clear</button>
              </div>
            ) : selectedEntry ? (
              <div className="wv2-hero-meal">
                <div className="wv2-hero-img-wrap">
                  <MealImage
                    src={selectedEntry.imageUrl}
                    alt={selectedEntry.name}
                    className="wv2-hero-img"
                    fallbackClass="wv2-hero-img-ph"
                  />
                </div>
                <div className="wv2-hero-body">
                  <h3 className="wv2-hero-name">{selectedEntry.name}</h3>
                  <p className="wv2-hero-meta">
                    {selectedEntry.ingredients?.length || 0} ingredients
                    {selectedEntry.category ? ` · ${selectedEntry.category}` : ''}
                  </p>
                  <div className="wv2-hero-actions">
                    <button className={`wv2-act ${selectedEntry._locked ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); onToggleLock(selectedDay); }}>
                      {selectedEntry._locked ? '🔒 Locked' : '🔓 Lock'}
                    </button>
                    <button className="wv2-act" onClick={() => onViewDetail(selectedEntry)}>📖 View</button>
                    {!selectedEntry._locked && <button className="wv2-act" onClick={() => onRespin(selectedDay)}>🔄 Respin</button>}
                    {!selectedEntry._locked && <button className="wv2-act" onClick={() => openPicker(selectedDay)}>✏️ Change</button>}
                    {!selectedEntry._locked && <button className="wv2-act danger" onClick={() => onSetSpecial(selectedDay, null)}>✕</button>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="wv2-hero-empty" onClick={() => openPicker(selectedDay)}>
                <div className="wv-empty-circle"><span>+</span></div>
                <p className="wv-empty-lbl">Tap to add a meal</p>
              </div>
            )}
          </div>

          <div className="wv2-week-list">
            {DAY_LABELS.map((label, i) => {
              if (i === selectedDay) return null;
              const entry = weekPlan[i];
              const isSpecial = entry && entry._special;
              const isToday = isCurrentWeek && i === todayIdx;
              return (
                <div
                  key={i}
                  className={`wv2-row${isToday ? ' today' : ''}${entry ? ' filled' : ''}${entry && entry._locked ? ' locked' : ''}`}
                  onClick={() => setSelectedDay(i)}
                >
                  <div className="wv2-row-day">
                    <span className="wv2-row-lbl">{label}</span>
                    <span className="wv2-row-date">{weekDates[i].getDate()}</span>
                  </div>
                  {isSpecial ? (
                    <div className="wv2-row-content">
                      <span className="wv2-row-icon">{entry.icon}</span>
                      <span className="wv2-row-name">{entry.name}</span>
                    </div>
                  ) : entry ? (
                    <div className="wv2-row-content">
                      {entry.imageUrl && (
                        <MealImage
                          src={entry.imageUrl}
                          alt=""
                          className="wv2-row-img"
                          fallbackEmoji=""
                          fallbackClass="wv2-row-img-ph"
                        />
                      )}
                      <span className="wv2-row-name">{entry.name}</span>
                    </div>
                  ) : (
                    <div className="wv2-row-content empty">
                      <span className="wv2-row-plus">+</span>
                      <span className="wv2-row-name empty">No meal</span>
                    </div>
                  )}
                  {entry && entry._locked ? (
                    <span className="wv2-row-lock-icon">🔒</span>
                  ) : (
                    <span className="wv2-row-chevron">›</span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Action buttons (thumb zone) ── */}
      {!showSpinner && (
        <div className="wv2-actions-bar">
          <button className="wv2-btn primary" onClick={onGenerate}>
            🎰 Spin the Week{rotationCount > 0 ? ` (${rotationCount})` : ''}
          </button>
          <div className="wv2-actions-row">
            {hasWeek && (
              <button className="wv2-btn secondary" onClick={onBuildGrocery}>
                🛒 Grocery List
              </button>
            )}
            <button className="wv2-btn tertiary" onClick={() => setShowHistory(true)}>
              📅 Past Weeks{pastWeeks.length > 0 ? ` (${pastWeeks.length})` : ''}
            </button>
          </div>
        </div>
      )}

      {/* ── Stats strip (condensed) ── */}
      {(cookingStats.streak > 0 || cookingStats.totalCooked > 0) && (
        <div className="wv2-stats">
          {cookingStats.streak > 0 && (
            <div className="wv2-stat fire">
              <span className="wv2-stat-n">{cookingStats.streak}</span>
              <span className="wv2-stat-l">streak</span>
            </div>
          )}
          {cookingStats.totalCooked > 0 && (
            <div className="wv2-stat">
              <span className="wv2-stat-n">{cookingStats.totalCooked}</span>
              <span className="wv2-stat-l">cooked</span>
            </div>
          )}
          {cookingStats.topMeal && (
            <div className="wv2-stat fav">
              <span className="wv2-stat-n" title={cookingStats.topMeal.name}>
                {cookingStats.topMeal.name.length > 10
                  ? cookingStats.topMeal.name.substring(0, 10) + '…'
                  : cookingStats.topMeal.name}
              </span>
              <span className="wv2-stat-l">top pick</span>
            </div>
          )}
        </div>
      )}

      {/* ── Meal picker bottom sheet ── */}
      {pickerDay !== null && renderPicker()}
    </div>
  );
}
