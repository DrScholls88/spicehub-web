import { useState, useMemo, useCallback, useRef } from 'react';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_FULL   = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

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

// ── Component ────────────────────────────────────────────────────────────────

export default function WeekView({
  days, weekPlan, meals, specialDays,
  onGenerate, onRespin, onSetDay, onSetSpecial, onViewDetail, onBuildGrocery,
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

  const contentRef = useRef(null);

  const activeMonday = useMemo(() => addDays(thisMonday, weekOffset * 7), [thisMonday, weekOffset]);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(activeMonday, i)), [activeMonday]);

  const isCurrentWeek = weekOffset === 0;
  const hasWeek = weekPlan.some(Boolean);

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
      if (diff > 0) setWeekOffset(o => o + 1); // swipe left = next week
      else setWeekOffset(o => o - 1);           // swipe right = prev week
    }
    setSwipeStart(null);
  }, [swipeStart]);

  const openPicker = useCallback((idx) => {
    setPickerDay(prev => prev === idx ? null : idx);
  }, []);

  const closePicker = useCallback(() => setPickerDay(null), []);

  // Build the cards to show: selected day expanded + remaining days compact
  const selectedEntry = weekPlan[selectedDay];
  const selectedIsSpecial = selectedEntry && selectedEntry._special;

  return (
    <div
      className="wv"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >

      {/* ── Week nav + month label ── */}
      <div className="wv-topbar">
        <button className="wv-nav-btn" onClick={() => setWeekOffset(o => o - 1)}>‹</button>
        <div className="wv-month-area">
          <span className="wv-month">{formatMonth(activeMonday)}</span>
          {!isCurrentWeek && (
            <button className="wv-today-btn" onClick={() => { setWeekOffset(0); setSelectedDay(todayIdx); }}>
              Today
            </button>
          )}
        </div>
        <button className="wv-nav-btn" onClick={() => setWeekOffset(o => o + 1)}>›</button>
      </div>

      {/* ── Horizontal day strip (like iOS Calendar) ── */}
      <div className="wv-day-strip">
        {DAY_LABELS.map((label, i) => {
          const date = weekDates[i];
          const isToday = isCurrentWeek && i === todayIdx;
          const isSelected = i === selectedDay;
          const hasContent = !!weekPlan[i];
          return (
            <button
              key={i}
              className={`wv-day-pill ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
              onClick={() => setSelectedDay(i)}
            >
              <span className="wv-day-lbl">{label}</span>
              <span className={`wv-day-num ${isToday && !isSelected ? 'today-ring' : ''}`}>
                {date.getDate()}
              </span>
              {hasContent && <span className="wv-day-dot" />}
            </button>
          );
        })}
      </div>

      {/* ── Selected day hero card ── */}
      <div className="wv-hero" ref={contentRef}>
        <div className="wv-hero-hdr">
          <h2 className="wv-hero-day">
            {DAY_FULL[selectedDay]}
            {isCurrentWeek && selectedDay === todayIdx && <span className="wv-today-chip">Today</span>}
          </h2>
          <span className="wv-hero-date">
            {weekDates[selectedDay].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>

        {selectedIsSpecial ? (
          <div className="wv-hero-special">
            <span className="wv-hero-special-icon">{selectedEntry.icon}</span>
            <span className="wv-hero-special-name">{selectedEntry.name}</span>
            <button className="wv-clear-btn" onClick={() => onSetSpecial(selectedDay, null)}>Clear</button>
          </div>
        ) : selectedEntry ? (
          <div className="wv-hero-meal">
            <div className="wv-hero-img-wrap">
              {selectedEntry.imageUrl ? (
                <img
                  src={selectedEntry.imageUrl}
                  alt={selectedEntry.name}
                  className="wv-hero-img"
                  onError={e => { e.target.style.display = 'none'; }}
                />
              ) : (
                <div className="wv-hero-img-ph">🍽️</div>
              )}
            </div>
            <div className="wv-hero-info">
              <h3 className="wv-hero-name">{selectedEntry.name}</h3>
              <p className="wv-hero-meta">
                {selectedEntry.ingredients?.length || 0} ingredients
                {selectedEntry.category ? ` · ${selectedEntry.category}` : ''}
              </p>
            </div>
            {/* Action buttons */}
            <div className="wv-hero-actions">
              <button className="wv-action" onClick={() => onViewDetail(selectedEntry)}>
                <span className="wv-action-icon">📖</span>
                <span>View</span>
              </button>
              <button className="wv-action" onClick={() => onRespin(selectedDay)}>
                <span className="wv-action-icon">🔄</span>
                <span>Respin</span>
              </button>
              <button className="wv-action" onClick={() => openPicker(selectedDay)}>
                <span className="wv-action-icon">✏️</span>
                <span>Change</span>
              </button>
              <button className="wv-action danger" onClick={() => onSetSpecial(selectedDay, null)}>
                <span className="wv-action-icon">✕</span>
                <span>Clear</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="wv-hero-empty" onClick={() => openPicker(selectedDay)}>
            <div className="wv-empty-circle">
              <span>+</span>
            </div>
            <p>Tap to add a meal</p>
          </div>
        )}
      </div>

      {/* ── Rest of week summary (compact cards) ── */}
      <div className="wv-rest">
        <h4 className="wv-rest-title">This Week</h4>
        {DAY_LABELS.map((label, i) => {
          if (i === selectedDay) return null;
          const entry = weekPlan[i];
          const isSpecial = entry && entry._special;
          const isToday = isCurrentWeek && i === todayIdx;
          return (
            <div
              key={i}
              className={`wv-mini ${isToday ? 'today' : ''} ${entry ? 'filled' : 'empty'}`}
              onClick={() => setSelectedDay(i)}
            >
              <div className="wv-mini-day">
                <span className="wv-mini-label">{label}</span>
                <span className="wv-mini-date">{weekDates[i].getDate()}</span>
              </div>
              {isSpecial ? (
                <div className="wv-mini-content">
                  <span>{entry.icon}</span>
                  <span className="wv-mini-name">{entry.name}</span>
                </div>
              ) : entry ? (
                <div className="wv-mini-content">
                  {entry.imageUrl && (
                    <img src={entry.imageUrl} alt="" className="wv-mini-img" onError={e => { e.target.style.display='none'; }} />
                  )}
                  <span className="wv-mini-name">{entry.name}</span>
                </div>
              ) : (
                <div className="wv-mini-content empty">
                  <span className="wv-mini-plus">+</span>
                  <span className="wv-mini-name empty">No meal</span>
                </div>
              )}
              <span className="wv-mini-arrow">›</span>
            </div>
          );
        })}
      </div>

      {/* ── Bottom action bar (thumb zone) ── */}
      <div className="wv-bottom-bar">
        <button className="wv-bottom-btn primary" onClick={onGenerate}>
          <span>🎰</span> Generate Week
        </button>
        {hasWeek && (
          <button className="wv-bottom-btn secondary" onClick={onBuildGrocery}>
            <span>🛒</span> Grocery
          </button>
        )}
      </div>

      {/* ── Full-screen meal picker (bottom sheet) ── */}
      {pickerDay !== null && (
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
                    {meal.imageUrl ? (
                      <img src={meal.imageUrl} alt="" className="pk-img" onError={e => { e.target.style.display = 'none'; }} />
                    ) : (
                      <div className="pk-img-ph">🍽️</div>
                    )}
                    <div className="pk-info">
                      <span className="pk-name">{meal.name}</span>
                      <span className="pk-meta">
                        {meal.ingredients?.length || 0} ingredients
                        {meal.category ? ` · ${meal.category}` : ''}
                      </span>
                    </div>
                    {isCurrent && <span className="pk-badge">current</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
