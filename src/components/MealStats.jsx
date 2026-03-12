import { useState, useMemo } from 'react';

export default function MealStats({ meals, onClose, onViewDetail }) {
  const [hoveredWeek, setHoveredWeek] = useState(null);

  // ============ STREAK CALCULATION ============
  const streakData = useMemo(() => {
    if (!meals || meals.length === 0) {
      return { currentStreak: 0, bestStreak: 0, lastCookedDate: null };
    }

    // Collect all unique dates when meals were cooked (from lastCooked field)
    const cookedDates = new Set();
    meals.forEach(meal => {
      if (meal.lastCooked) {
        const dateStr = new Date(meal.lastCooked).toDateString();
        cookedDates.add(dateStr);
      }
    });

    if (cookedDates.size === 0) {
      return { currentStreak: 0, bestStreak: 0, lastCookedDate: null };
    }

    // Convert to sorted array of Date objects
    const dates = Array.from(cookedDates)
      .map(d => new Date(d))
      .sort((a, b) => b - a);

    let currentStreak = 0;
    let bestStreak = 0;
    let tempStreak = 1;

    for (let i = 0; i < dates.length - 1; i++) {
      const diffMs = dates[i] - dates[i + 1];
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      if (Math.abs(diffDays - 1) < 0.1) {
        tempStreak++;
      } else {
        bestStreak = Math.max(bestStreak, tempStreak);
        tempStreak = 1;
      }
    }
    bestStreak = Math.max(bestStreak, tempStreak);

    // Current streak: check if most recent cook was today or yesterday
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const mostRecent = new Date(dates[0]);
    mostRecent.setHours(0, 0, 0, 0);

    const diffMs = today - mostRecent;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays <= 1) {
      currentStreak = 1;
      for (let i = 0; i < dates.length - 1; i++) {
        const d1 = new Date(dates[i]);
        const d2 = new Date(dates[i + 1]);
        d1.setHours(0, 0, 0, 0);
        d2.setHours(0, 0, 0, 0);
        const diff = (d1 - d2) / (1000 * 60 * 60 * 24);
        if (Math.abs(diff - 1) < 0.1) {
          currentStreak++;
        } else {
          break;
        }
      }
    }

    return {
      currentStreak,
      bestStreak,
      lastCookedDate: dates[0],
    };
  }, [meals]);

  // ============ TOP STATS ============
  const topStats = useMemo(() => {
    const totalRecipes = meals ? meals.length : 0;
    const favorites = meals ? meals.filter(m => m.isFavorite).length : 0;

    const ratedMeals = meals ? meals.filter(m => m.rating && m.rating > 0) : [];
    const avgRating = ratedMeals.length > 0
      ? (ratedMeals.reduce((sum, m) => sum + m.rating, 0) / ratedMeals.length).toFixed(1)
      : 0;

    let mostCookedMeal = null;
    let maxCookCount = 0;
    if (meals) {
      meals.forEach(m => {
        const cookCount = m.cookCount || 0;
        if (cookCount > maxCookCount) {
          maxCookCount = cookCount;
          mostCookedMeal = m;
        }
      });
    }

    return {
      totalRecipes,
      favorites,
      avgRating,
      mostCookedMeal,
      maxCookCount,
    };
  }, [meals]);

  // ============ CATEGORY BREAKDOWN ============
  const categoryBreakdown = useMemo(() => {
    if (!meals || meals.length === 0) return [];

    const categoryMap = {};
    meals.forEach(meal => {
      const cat = meal.category || 'Uncategorized';
      categoryMap[cat] = (categoryMap[cat] || 0) + 1;
    });

    const entries = Object.entries(categoryMap)
      .map(([name, count]) => ({
        name,
        count,
        percentage: (count / meals.length) * 100,
      }))
      .sort((a, b) => b.count - a.count);

    return entries;
  }, [meals]);

  // ============ COOKING CALENDAR (12-week heatmap) ============
  const calendarData = useMemo(() => {
    if (!meals || meals.length === 0) {
      return {
        weeks: [],
        maxCount: 0,
      };
    }

    // Build a map of dates to cook counts
    const dateMap = new Map();
    meals.forEach(meal => {
      if (meal.lastCooked) {
        const dateStr = new Date(meal.lastCooked).toDateString();
        dateMap.set(dateStr, (dateMap.get(dateStr) || 0) + (meal.cookCount || 1));
      }
    });

    const today = new Date();
    const weeks = [];
    const maxCount = Math.max(...Array.from(dateMap.values()), 1);

    // Go back 12 weeks
    for (let w = 11; w >= 0; w--) {
      const week = [];
      for (let day = 6; day >= 0; day--) {
        const date = new Date(today);
        date.setDate(date.getDate() - (w * 7 + day));
        const dateStr = date.toDateString();
        const count = dateMap.get(dateStr) || 0;
        week.unshift({ date, count, dateStr });
      }
      weeks.unshift(week);
    }

    return { weeks, maxCount };
  }, [meals]);

  // ============ TOP RECIPES ============
  const topRecipes = useMemo(() => {
    if (!meals) return [];
    return meals
      .filter(m => m.cookCount && m.cookCount > 0)
      .sort((a, b) => (b.cookCount || 0) - (a.cookCount || 0))
      .slice(0, 5);
  }, [meals]);

  // ============ RECIPE DIVERSITY SCORE ============
  const diversityScore = useMemo(() => {
    if (!meals || meals.length === 0) return 0;

    const uniqueCategories = new Set(meals.map(m => m.category || 'Uncategorized')).size;
    const ratedCount = meals.filter(m => m.rating && m.rating > 0).length;
    const favoriteRatio = meals.filter(m => m.isFavorite).length / meals.length;

    const categoryScore = Math.min(uniqueCategories * 15, 40);
    const ratedScore = Math.min(ratedCount * 5, 30);
    const favScore = favoriteRatio * 30;

    return Math.round(categoryScore + ratedScore + favScore);
  }, [meals]);

  // ============ HELPER: INTENSITY LEVEL ============
  const getIntensityLevel = (count, maxCount) => {
    if (count === 0) return 'level-0';
    if (count <= maxCount * 0.25) return 'level-1';
    if (count <= maxCount * 0.5) return 'level-2';
    return 'level-3';
  };

  return (
    <div className="ms-overlay" onClick={onClose}>
      <div className="ms-sheet" onClick={e => e.stopPropagation()}>
        <div className="ms-handle" />

        {/* ========== HEADER ========== */}
        <div className="ms-header">
          <h2 className="ms-title">📊 Meal Stats</h2>
          <button className="ms-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* ========== CONTENT SCROLL AREA ========== */}
        <div className="ms-content">

          {/* ========== STREAK SECTION ========== */}
          <section className="ms-streak-section">
            {streakData.currentStreak > 0 || streakData.bestStreak > 0 ? (
              <>
                <h3 className="ms-section-title">🔥 Cooking Streak</h3>
                <div className="ms-streak-container">
                  <div className="ms-streak-card current">
                    <div className="ms-streak-number">{streakData.currentStreak}</div>
                    <div className="ms-streak-label">Current Streak</div>
                    <div className="ms-streak-subtext">days</div>
                  </div>
                  <div className="ms-streak-card best">
                    <div className="ms-streak-number">{streakData.bestStreak}</div>
                    <div className="ms-streak-label">Best Streak</div>
                    <div className="ms-streak-subtext">days</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="ms-empty-state">
                <p className="ms-empty-icon">🎯</p>
                <p className="ms-empty-text">Start cooking to build your streak!</p>
              </div>
            )}
          </section>

          {/* ========== TOP STATS ROW ========== */}
          <section className="ms-top-stats-section">
            <h3 className="ms-section-title">📈 Quick Stats</h3>
            <div className="ms-stats-scroll">
              <div className="ms-stat-card">
                <div className="ms-stat-icon">📚</div>
                <div className="ms-stat-value">{topStats.totalRecipes}</div>
                <div className="ms-stat-label">Total Recipes</div>
              </div>

              <div className="ms-stat-card">
                <div className="ms-stat-icon">❤️</div>
                <div className="ms-stat-value">{topStats.favorites}</div>
                <div className="ms-stat-label">Favorites</div>
              </div>

              <div className="ms-stat-card">
                <div className="ms-stat-icon">⭐</div>
                <div className="ms-stat-value">{topStats.avgRating}</div>
                <div className="ms-stat-label">Avg Rating</div>
              </div>

              {topStats.mostCookedMeal && (
                <div className="ms-stat-card">
                  <div className="ms-stat-icon">🍳</div>
                  <div className="ms-stat-value">{topStats.maxCookCount}</div>
                  <div className="ms-stat-label">{topStats.mostCookedMeal.name}</div>
                </div>
              )}
            </div>
          </section>

          {/* ========== CATEGORY BREAKDOWN ========== */}
          {categoryBreakdown.length > 0 && (
            <section className="ms-category-section">
              <h3 className="ms-section-title">🍽️ Categories</h3>
              <div className="ms-category-list">
                {categoryBreakdown.map((cat, idx) => (
                  <div key={idx} className="ms-category-bar-wrapper">
                    <div className="ms-category-label-row">
                      <span className="ms-category-name">{cat.name}</span>
                      <span className="ms-category-count">{cat.count}</span>
                    </div>
                    <div className="ms-category-bar-bg">
                      <div
                        className="ms-category-bar-fill"
                        style={{ width: `${cat.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ========== COOKING CALENDAR ========== */}
          {calendarData.weeks.length > 0 && (
            <section className="ms-calendar-section">
              <h3 className="ms-section-title">📅 Cooking Calendar</h3>
              <div className="ms-calendar-grid">
                {calendarData.weeks.map((week, weekIdx) => (
                  <div key={weekIdx} className="ms-calendar-week">
                    {week.map((day, dayIdx) => (
                      <div
                        key={dayIdx}
                        className={`ms-cal-cell ${getIntensityLevel(day.count, calendarData.maxCount)}`}
                        title={`${day.dateStr}: ${day.count} meal${day.count !== 1 ? 's' : ''}`}
                        onMouseEnter={() => setHoveredWeek({ weekIdx, dayIdx, ...day })}
                        onMouseLeave={() => setHoveredWeek(null)}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div className="ms-calendar-legend">
                <span className="ms-legend-label">Less</span>
                <div className="ms-cal-cell level-0" />
                <div className="ms-cal-cell level-1" />
                <div className="ms-cal-cell level-2" />
                <div className="ms-cal-cell level-3" />
                <span className="ms-legend-label">More</span>
              </div>
              {hoveredWeek && (
                <div className="ms-calendar-tooltip">
                  {hoveredWeek.dateStr}: {hoveredWeek.count} meal{hoveredWeek.count !== 1 ? 's' : ''}
                </div>
              )}
            </section>
          )}

          {/* ========== TOP RECIPES ========== */}
          {topRecipes.length > 0 && (
            <section className="ms-top-recipes-section">
              <h3 className="ms-section-title">🏆 Top Recipes</h3>
              <ol className="ms-top-recipes-list">
                {topRecipes.map((meal, idx) => (
                  <li key={meal.id} className="ms-recipe-item">
                    <span className="ms-recipe-rank">{idx + 1}</span>
                    <span
                      className="ms-recipe-name"
                      onClick={() => {
                        onViewDetail(meal);
                      }}
                    >
                      {meal.name}
                    </span>
                    <span className="ms-recipe-count-badge">{meal.cookCount}x</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* ========== DIVERSITY SCORE ========== */}
          <section className="ms-diversity-section">
            <h3 className="ms-section-title">✨ Recipe Diversity Score</h3>
            <div className="ms-diversity-container">
              <svg
                className="ms-diversity-ring"
                viewBox="0 0 100 100"
                width="120"
                height="120"
              >
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="4"
                  opacity="0.1"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeDasharray={`${(diversityScore / 100) * 283} 283`}
                  strokeLinecap="round"
                  className="ms-diversity-fill"
                />
                <text
                  x="50"
                  y="50"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="24"
                  fontWeight="bold"
                  fill="currentColor"
                >
                  {diversityScore}
                </text>
              </svg>
              <div className="ms-diversity-info">
                <p className="ms-diversity-text">
                  {diversityScore >= 80
                    ? 'Amazing diversity! You explore many cuisines.'
                    : diversityScore >= 60
                    ? 'Good variety in your meal choices.'
                    : diversityScore >= 40
                    ? 'Build your recipe repertoire!'
                    : 'Start rating and favoriting recipes to boost this score.'}
                </p>
              </div>
            </div>
          </section>

          {/* ========== EMPTY STATE ========== */}
          {(!meals || meals.length === 0) && (
            <div className="ms-empty-state-full">
              <p className="ms-empty-icon">👨‍🍳</p>
              <p className="ms-empty-text">No meals yet. Start building your recipe collection!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
