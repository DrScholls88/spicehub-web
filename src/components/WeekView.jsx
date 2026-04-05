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

function dateKey(date) {
  return date.toISOString().split('T')[0]; // 'YYYY-MM-DD'
}

function getCalendarCells(year, month) {
  // Get first day of month
  const firstDay = new Date(year, month, 1);
  // Get start day (0=Sun, 1=Mon, etc.)
  const startDow = firstDay.getDay();
  // Calculate offset to Monday (0=Mon, 1=Tue, ..., 6=Sun)
  const startOffset = startDow === 0 ? 6 : startDow - 1;

  // Build start date (go back to Monday before month starts)
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - startOffset);
  startDate.setHours(0, 0, 0, 0);

  // Always 6 weeks (42 days)
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    cells.push(d);
  }
  return cells;
}

// ── Component ────────────────────────────────────────────────────────────────

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
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const currentWeekMonday = useMemo(() => getMonday(today), [today]);

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-11
  const [activeDate, setActiveDate] = useState(today);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedDates, setSelectedDates] = useState(new Set());
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [pickerDay, setPickerDay] = useState(null);

  const calendarCells = useMemo(() => getCalendarCells(viewYear, viewMonth), [viewYear, viewMonth]);

  // Get meal for any date (current week, past history, or future)
  const getMealForDate = useCallback((date) => {
    const dow = date.getDay() === 0 ? 6 : date.getDay() - 1; // 0=Mon index
    const weekMon = getMonday(date);

    // Is this in the current active week?
    if (weekMon.getTime() === currentWeekMonday.getTime()) {
      return { meal: weekPlan[dow] || null, isCurrent: true, dow };
    }

    // Is this in a past week? Check history.
    const histEntry = weekHistory.find(hw => {
      const hwMon = new Date(hw.weekStart);
      hwMon.setHours(0, 0, 0, 0);
      return hwMon.getTime() === weekMon.getTime();
    });

    if (histEntry) {
      return { meal: histEntry.meals?.[dow] || null, isCurrent: false, dow, histEntry };
    }

    // Future or no data
    const isFuture = date > today;
    return { meal: null, isCurrent: weekMon.getTime() === currentWeekMonday.getTime(), isFuture, dow };
  }, [weekPlan, weekHistory, currentWeekMonday, today]);

  // Handle calendar cell click
  const handleCellClick = useCallback((date) => {
    if (selectMode) {
      // Toggle selection (only current/future)
      const key = dateKey(date);
      const { isCurrent, isFuture } = getMealForDate(date);
      if (!isCurrent && !isFuture && date < today) {
        // Past day - skip in select mode
        return;
      }
      setSelectedDates(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    } else {
      // Detail mode - open panel
      setActiveDate(date);
      setShowDetailPanel(true);
    }
  }, [selectMode, getMealForDate, today]);

  // Navigate month
  const handlePrevMonth = useCallback(() => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(y => y - 1);
    } else {
      setViewMonth(m => m - 1);
    }
  }, [viewMonth]);

  const handleNextMonth = useCallback(() => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(y => y + 1);
    } else {
      setViewMonth(m => m + 1);
    }
  }, [viewMonth]);

  const handleToday = useCallback(() => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  }, [today]);

  // Handle spinning selected days
  const handleSpinSelected = useCallback(() => {
    // Convert selected dateKeys to current-week day indices
    const indices = [];
    selectedDates.forEach(key => {
      const date = new Date(key + 'T00:00:00');
      const { isCurrent, dow } = getMealForDate(date);
      if (isCurrent) indices.push(dow);
    });

    // For now, just trigger onGenerate
    // In a more advanced version, we'd pass indices to the spinner
    onGenerate();
    setSelectMode(false);
    setSelectedDates(new Set());
  }, [selectedDates, getMealForDate, onGenerate]);

  // Open meal picker
  const openPicker = useCallback((date) => {
    const dow = date.getDay() === 0 ? 6 : date.getDay() - 1;
    setPickerDay(dow);
  }, []);

  const closePicker = useCallback(() => setPickerDay(null), []);

  // Render meal picker bottom sheet
  const renderPicker = () => {
    if (pickerDay === null) return null;

    const isPastDay = activeDate < today && activeDate.getTime() !== currentWeekMonday.getTime() + (pickerDay * 24 * 60 * 60 * 1000);
    const { meal: currentMeal } = getMealForDate(activeDate);

    return (
      <div className="pk-overlay" onClick={closePicker}>
        <div className="pk-sheet" onClick={e => e.stopPropagation()}>
          <div className="pk-handle" />
          <div className="pk-hdr">
            <h3>Choose for {DAY_FULL[pickerDay]}</h3>
            <button className="pk-close" onClick={closePicker}>✕</button>
          </div>

          {!isPastDay && (
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
              {currentMeal && (
                <button
                  className="pk-chip clear"
                  onClick={() => { onSetSpecial(pickerDay, null); closePicker(); }}
                >
                  ✕ Clear
                </button>
              )}
            </div>
          )}

          <div className="pk-list">
            {meals.map(meal => {
              const isCurrent = currentMeal && !currentMeal._special && currentMeal.id === meal.id;
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
  };

  // Check if we're viewing current month
  const isCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth();

  // Count meals in current plan
  const plannedCount = weekPlan.filter(Boolean).length;
  const hasWeek = plannedCount > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' }}>
      {/* ── Month Navigation Header ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        background: 'var(--card)',
        borderBottom: '1px solid var(--border)',
        gap: '8px',
      }}>
        <button
          onClick={handlePrevMonth}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '20px',
            cursor: 'pointer',
            padding: '8px 12px',
            color: 'var(--primary)',
          }}
          aria-label="Previous month"
        >
          ‹
        </button>

        <h2 style={{
          flex: 1,
          textAlign: 'center',
          fontSize: '16px',
          fontWeight: 700,
          color: 'var(--text)',
          margin: 0,
        }}>
          {new Date(viewYear, viewMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </h2>

        {!isCurrentMonth && (
          <button
            onClick={handleToday}
            style={{
              background: 'transparent',
              border: `1px solid var(--primary)`,
              borderRadius: '20px',
              padding: '4px 12px',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--primary)',
              cursor: 'pointer',
            }}
          >
            Today
          </button>
        )}

        <button
          onClick={handleNextMonth}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '20px',
            cursor: 'pointer',
            padding: '8px 12px',
            color: 'var(--primary)',
          }}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      {/* ── Day headers (Mo Tu We ...) ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        background: 'var(--card)',
        borderBottom: '1px solid var(--border)',
      }}>
        {DAY_LABELS.map(day => (
          <div
            key={day}
            style={{
              padding: '12px 8px',
              textAlign: 'center',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text-light)',
              textTransform: 'uppercase',
            }}
          >
            {day}
          </div>
        ))}
      </div>

      {/* ── Calendar Grid ── */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: '1px',
        background: 'var(--border)',
        padding: '1px',
        overflowY: 'auto',
      }}>
        {calendarCells.map((date, idx) => {
          const isThisMonth = date.getMonth() === viewMonth;
          const isToday = date.getTime() === today.getTime();
          const isPast = date < today;
          const key = dateKey(date);
          const isSelected = selectedDates.has(key);
          const { meal } = getMealForDate(date);
          const isLocked = meal && meal._locked;

          return (
            <div
              key={key}
              onClick={() => handleCellClick(date)}
              style={{
                background: isToday ? 'var(--primary)' : isSelected ? 'rgba(230, 81, 0, 0.15)' : 'var(--card)',
                padding: '8px',
                minHeight: '80px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                justifyContent: 'flex-start',
                cursor: 'pointer',
                opacity: isThisMonth ? 1 : 0.4,
                transition: 'background 0.2s',
                borderRadius: '4px',
              }}
              onMouseEnter={e => {
                if (!isToday) {
                  e.currentTarget.style.background = isSelected ? 'rgba(230, 81, 0, 0.25)' : 'var(--surface)';
                }
              }}
              onMouseLeave={e => {
                if (!isToday) {
                  e.currentTarget.style.background = isSelected ? 'rgba(230, 81, 0, 0.15)' : 'var(--card)';
                }
              }}
            >
              <span style={{
                fontSize: '14px',
                fontWeight: 600,
                color: isToday ? 'white' : 'var(--text)',
                marginBottom: '4px',
              }}>
                {date.getDate()}
              </span>

              {isLocked && (
                <span style={{ fontSize: '10px', marginBottom: '2px' }}>🔒</span>
              )}

              {meal && (
                <div style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: meal._special ? 'var(--warning)' : 'var(--primary)',
                  marginTop: 'auto',
                }} />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Detail Panel (bottom sheet) ── */}
      {showDetailPanel && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            background: 'var(--card)',
            borderRadius: '20px 20px 0 0',
            boxShadow: '0 -4px 24px rgba(0,0,0,0.12)',
            padding: '20px 16px',
            zIndex: 200,
            maxHeight: '60vh',
            overflowY: 'auto',
            animation: 'slideUp 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
              {DAY_FULL[activeDate.getDay() === 0 ? 6 : activeDate.getDay() - 1]}
              {' '}
              <span style={{ fontSize: '14px', color: 'var(--text-light)' }}>
                {activeDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </h3>
            <button
              onClick={() => setShowDetailPanel(false)}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '20px',
                cursor: 'pointer',
                color: 'var(--text-light)',
              }}
            >
              ✕
            </button>
          </div>

          {(() => {
            const { meal, isCurrent } = getMealForDate(activeDate);
            const dow = activeDate.getDay() === 0 ? 6 : activeDate.getDay() - 1;

            if (!meal) {
              return (
                <button
                  onClick={() => { openPicker(activeDate); setShowDetailPanel(false); }}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: 'var(--primary)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  + Add a meal
                </button>
              );
            }

            if (meal._special) {
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px',
                    background: 'var(--surface)',
                    borderRadius: '8px',
                  }}>
                    <span style={{ fontSize: '24px' }}>{meal.icon}</span>
                    <span style={{ fontSize: '16px', fontWeight: 600 }}>{meal.name}</span>
                  </div>
                  {isCurrent && (
                    <button
                      onClick={() => { onSetSpecial(dow, null); setShowDetailPanel(false); }}
                      style={{
                        padding: '10px',
                        background: 'var(--danger)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              );
            }

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {meal.imageUrl && (
                  <img
                    src={meal.imageUrl}
                    alt={meal.name}
                    style={{
                      width: '100%',
                      height: '160px',
                      objectFit: 'cover',
                      borderRadius: '8px',
                    }}
                  />
                )}
                <div>
                  <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>
                    {meal.name}
                  </h4>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-light)' }}>
                    {meal.ingredients?.length || 0} ingredients
                    {meal.category ? ` · ${meal.category}` : ''}
                  </p>
                </div>

                {isCurrent && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <button
                      onClick={() => { onToggleLock(dow); setShowDetailPanel(false); }}
                      style={{
                        padding: '10px',
                        background: meal._locked ? 'var(--primary)' : 'var(--surface)',
                        color: meal._locked ? 'white' : 'var(--text)',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {meal._locked ? '🔒 Locked' : '🔓 Unlock'}
                    </button>
                    <button
                      onClick={() => { onViewDetail(meal); setShowDetailPanel(false); }}
                      style={{
                        padding: '10px',
                        background: 'var(--surface)',
                        color: 'var(--text)',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      📖 View Details
                    </button>
                    {!meal._locked && (
                      <>
                        <button
                          onClick={() => { onRespin(dow); setShowDetailPanel(false); }}
                          style={{
                            padding: '10px',
                            background: 'var(--surface)',
                            color: 'var(--text)',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '14px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          🔄 Respin
                        </button>
                        <button
                          onClick={() => { openPicker(activeDate); setShowDetailPanel(false); }}
                          style={{
                            padding: '10px',
                            background: 'var(--surface)',
                            color: 'var(--text)',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '14px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          ✏️ Change
                        </button>
                        <button
                          onClick={() => { onSetSpecial(dow, null); setShowDetailPanel(false); }}
                          style={{
                            padding: '10px',
                            background: 'var(--danger)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '14px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          ✕ Clear
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Spinner Overlay ── */}
      {showSpinner && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 300,
        }}>
          <MealSpinner
            meals={meals}
            rotationMeals={rotationMeals}
            currentPlan={currentPlan}
            onComplete={(plan) => {
              onSpinnerComplete(plan);
              setSelectMode(false);
              setSelectedDates(new Set());
            }}
            onClose={onCloseSpinner}
          />
        </div>
      )}

      {/* ── Action Bar (fixed bottom) ── */}
      {!showSpinner && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          padding: '12px 16px',
          background: 'var(--card)',
          borderTop: '1px solid var(--border)',
          position: 'sticky',
          bottom: 0,
        }}>
          {selectMode ? (
            <>
              <button
                onClick={handleSpinSelected}
                disabled={selectedDates.size === 0}
                style={{
                  padding: '12px',
                  background: selectedDates.size === 0 ? 'var(--border)' : 'var(--primary)',
                  color: selectedDates.size === 0 ? 'var(--text-muted)' : 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: selectedDates.size === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                🎰 Spin Selected ({selectedDates.size})
              </button>
              <button
                onClick={() => {
                  setSelectMode(false);
                  setSelectedDates(new Set());
                }}
                style={{
                  padding: '12px',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onGenerate}
                style={{
                  padding: '12px',
                  background: 'var(--primary)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🎰 Spin the Week{rotationCount > 0 ? ` (${rotationCount})` : ''}
              </button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setSelectMode(true)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  📌 Select Days
                </button>
                {hasWeek && (
                  <button
                    onClick={onBuildGrocery}
                    style={{
                      flex: 1,
                      padding: '12px',
                      background: 'var(--surface)',
                      color: 'var(--text)',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    🛒 Grocery
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Stats Strip ── */}
      {(cookingStats.streak > 0 || cookingStats.totalCooked > 0) && (
        <div style={{
          display: 'flex',
          gap: '12px',
          padding: '12px 16px',
          background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
          justifyContent: 'center',
        }}>
          {cookingStats.streak > 0 && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--primary)' }}>
                {cookingStats.streak}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-light)', marginTop: '2px' }}>
                streak
              </div>
            </div>
          )}
          {cookingStats.totalCooked > 0 && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)' }}>
                {cookingStats.totalCooked}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-light)', marginTop: '2px' }}>
                cooked
              </div>
            </div>
          )}
          {cookingStats.topMeal && (
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 700,
                  color: 'var(--text)',
                  maxWidth: '80px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={cookingStats.topMeal.name}
              >
                {cookingStats.topMeal.name}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-light)', marginTop: '2px' }}>
                top pick
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Meal Picker Bottom Sheet ── */}
      {renderPicker()}

      <style>{`
        @keyframes slideUp {
          from {
            transform: translateY(100%);
          }
          to {
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
