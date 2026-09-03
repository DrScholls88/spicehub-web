import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Dices, GripVertical, EyeOff, Eye, Pencil, Check } from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { loadLandingLayout, saveLandingLayout } from '../lib/landingLayout.js';
import { freshnessOf, categorizeKitchen } from '../lib/pantryDomain.js';
import {
  getMondayOfWeek,
  localDateKey,
  addDays,
  TILE_COLORS,
  PRIMARY_TILES,
  getSeasonInfo,
  getSeasonalMeals,
  getTimeOfDayClass,
  haptic,
} from '../lib/landingHelpers.js';
import './LandingPage.css';
import TodayHeroCard from './landing/TodayHeroCard.jsx';
import DiscoverFeatureCard from './landing/DiscoverFeatureCard.jsx';
import InstallBanner from './landing/InstallBanner.jsx';
import StickyHeader from './landing/StickyHeader.jsx';
import DayPhotoCard from './landing/DayPhotoCard.jsx';
import MealPreviewSheet from './landing/MealPreviewSheet.jsx';
import { findPantryMatches } from '../lib/pantryMatch.js';
import CookTonightCarousel from './landing/CookTonightCarousel.jsx';
import OnboardingCoach from './landing/OnboardingCoach.jsx';
import ImportNudgeBanner from './landing/ImportNudgeBanner.jsx';
import AppIntroHero from './landing/AppIntroHero.jsx';

// Written the first time the app is backgrounded with the intro hero on
// screen. See the showIntroHero initializer for why sh_onboarding_v1 alone
// could not do this job.
const INTRO_SEEN_KEY = 'sh_intro_seen_v1';

const STYLES = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    background: 'var(--bg)',
    color: 'var(--text)',
    padding: '16px',
    paddingBottom: '100px',
  },
};

// ── Main component ────────────────────────────────────────────────────────────
export default function LandingPage({
  cookingStats = {},
  weekPlan = [],
  weekHistory = [],
  meals = [],
  drinks = [],
  groceryItems = [],
  fridgeInventory = [],
  rotationCount = 0,
  onNavigate = () => {},
  onGenerate = () => {},
  onViewDetail = () => {},
  onOpenPantryMatches = () => {},
  onOpenPantry = () => {},
  onOpenStats = () => {},
  onOpenDiscover = () => {},
  onOpenFriends = null,
  friendsBadgeCount = 0,
  friendCount = 0,
  onInstallApp = null,
  canInstall = false,
  onRespinDate = null,
  onAssignMeal = null,
  onCreateMealForDay = null,
  batchQueueCount = 0,
}) {
  const [previewDay, setPreviewDay] = useState(null); // { date, meal, isToday }

  // ── Widget dashboard: reorder / pin / hide, persisted device-local ────────
  const [editMode, setEditMode] = useState(false);
  const [layout, setLayout] = useState(() => loadLandingLayout()); // { order, hidden }
  useEffect(() => { saveLandingLayout(layout); }, [layout]);

  // ── Sticky header visibility via IntersectionObserver ────────────────────
  const heroRef = useRef(null);
  const ctaRef = useRef(null);
  const myMealsRef = useRef(null);
  const [showOnboarding] = useState(() => {
    try { return !localStorage.getItem('sh_onboarding_v1'); } catch { return false; }
  });

  // ── Intro hero retirement ─────────────────────────────────────────────────
  // AppIntroHero used to render unconditionally — a four-stage feature carousel
  // pinned above the fold on day 400. It is onboarding, and onboarding that
  // never leaves is a brochure, so it retires after the first session.
  //
  // `sh_onboarding_v1` alone was not a usable kill switch: it is written only
  // when OnboardingCoach *completes*, and the coach only mounts when
  // meals.length === 0 — so most users never set it and the hero would have
  // outlived them. We honour it (anyone who finished onboarding has certainly
  // seen the pitch) and add our own key, written the first time the app is
  // backgrounded with the hero on screen. That is genuinely "after session
  // one", rather than "the second time you tap Home" — the hero does not
  // vanish out from under someone still reading it.
  const [showIntroHero] = useState(() => {
    try {
      return !localStorage.getItem(INTRO_SEEN_KEY) && !localStorage.getItem('sh_onboarding_v1');
    } catch {
      return false; // storage blocked — err toward the quieter Home
    }
  });

  useEffect(() => {
    if (!showIntroHero) return undefined;
    const retire = () => {
      try { localStorage.setItem(INTRO_SEEN_KEY, '1'); } catch { /* nothing to do */ }
    };
    // visibilitychange covers Android/desktop; iOS standalone PWAs sometimes
    // skip it but always fire pagehide — the same pairing main.jsx already
    // relies on for update checks.
    const onVisibility = () => { if (document.visibilityState === 'hidden') retire(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', retire);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', retire);
    };
  }, [showIntroHero]);
  const [stickyVisible, setStickyVisible] = useState(false);

  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setStickyVisible(!entry.isIntersecting),
      { threshold: 0, rootMargin: '-1px 0px 0px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const timeClass = useMemo(() => getTimeOfDayClass(), []);

  // ── Build Next 5 Days ──────────────────────────────────────────────────────
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const currentWeekMonday = useMemo(() => getMondayOfWeek(today), [today]);

  const next5Days = useMemo(() => {
    return Array.from({ length: 5 }, (_, i) => {
      const date = addDays(today, i);
      const isToday = i === 0;
      // Find meal: check current weekPlan first, then weekHistory
      const weekMon = getMondayOfWeek(date);
      const dow = date.getDay() === 0 ? 6 : date.getDay() - 1; // Mon-first index
      let meal = null;
      if (weekMon.getTime() === currentWeekMonday.getTime()) {
        meal = weekPlan[dow] || null;
      } else {
        const key = localDateKey(weekMon);
        const histEntry = weekHistory.find(hw => {
          const hwMon = new Date(hw.weekStart); hwMon.setHours(0,0,0,0);
          return localDateKey(hwMon) === key;
        });
        if (histEntry) meal = histEntry.meals?.[dow] || null;
      }
      return { date, meal, isToday };
    });
  }, [today, currentWeekMonday, weekPlan, weekHistory]);

  const hasAnyMeal = next5Days.some(d => d.meal !== null);

  // ── Tiles ──────────────────────────────────────────────────────────────────
  const { totalCooked = 0 } = cookingStats || {};

  // Widget telemetry (Gemini landing analysis, 2026-07-14): status at a glance,
  // computed entirely from local data already in props — no network calls.
  const groceryTelemetry = useMemo(() => {
    if (!groceryItems.length) return 'Build shopping list';
    const unchecked = groceryItems.filter(i => !i.isChecked).length;
    return unchecked > 0 ? `${unchecked} item${unchecked === 1 ? '' : 's'} needed` : 'All set ✓';
  }, [groceryItems]);

  const pantryTelemetry = useMemo(() => {
    if (!fridgeInventory.length) return 'All I have is ingredients for food.';
    // "Expiring soon" only makes sense for perishables — a jar of cumin isn't
    // going anywhere in 6 days the way a chicken breast is.
    const PERISHABLE = new Set(['protein', 'produce', 'dairy']);
    const aging = fridgeInventory.filter(r => {
      const fresh = freshnessOf(r?.addedAt);
      if (fresh !== 'aging' && fresh !== 'old') return false;
      const cat = categorizeKitchen(r?.ingredient)?.category;
      return cat ? PERISHABLE.has(cat) : false;
    }).length;
    if (aging > 0) return `${aging} item${aging === 1 ? '' : 's'} aging — use soon`;
    return `${fridgeInventory.length} item${fridgeInventory.length === 1 ? '' : 's'} on hand`;
  }, [fridgeInventory]);

  const tiles = useMemo(() => [
    {
      id: 'planWeek',
      emoji: '📅',
      title: 'Plan out your week of meals',
      subtitle: 'Drag & drop meals onto each day',
      accent: TILE_COLORS.planWeek,
      onClick: () => onNavigate('week'),
    },
    {
      id: 'spinWeek',
      emoji: '🎲',
      title: 'Spin the Week',
      subtitle: "So you stop texting ‘idk, you pick’ at 5pm.",
      accent: TILE_COLORS.spinWeek,
      onClick: () => onGenerate(),
    },
    {
      id: 'myMeals',
      emoji: '📓',
      title: 'My Meals',
      subtitle: `${meals.length} recipes saved`,
      accent: TILE_COLORS.myMeals,
      onClick: () => onNavigate('library'),
    },
    {
      id: 'bar',
      emoji: '🍸',
      title: 'Bar Shelf',
      subtitle: drinks.length > 0 ? "Tonight's Cocktail" : `${drinks.length} drinks saved`,
      accent: TILE_COLORS.bar,
      onClick: () => onNavigate('bar'),
    },
    {
      id: 'grocery',
      emoji: '🛒',
      title: 'Grocery List',
      subtitle: groceryTelemetry,
      accent: TILE_COLORS.grocery,
      onClick: () => onNavigate('grocery'),
    },
    // Merged 2026-09-03: this was two adjacent tiles — 'Pantry' (static
    // subtitle) and 'What Can I Cook today?' (the live telemetry) — for a
    // single user idea, one of them titled with a question instead of a place.
    // Now one Pantry tile carrying the telemetry. Same destination either way;
    // it just opens on the matches view when there is actually stock to match
    // against, and on the plain shelf when there is not.
    {
      id: 'pantry',
      emoji: '🥫',
      title: 'Pantry',
      subtitle: pantryTelemetry,
      accent: TILE_COLORS.pantry,
      onClick: () => (fridgeInventory.length > 0 ? onOpenPantryMatches() : onOpenPantry()),
    },
    // Friends tile — only shown when the feature is on
    ...(onOpenFriends ? [{
      id: 'friends',
      emoji: '👤',
      title: 'Friends',
      subtitle: friendsBadgeCount > 0 ? `${friendsBadgeCount} new` : friendCount > 0 ? `${friendCount} friend${friendCount === 1 ? '' : 's'}` : 'Find friends & share recipes',
      accent: TILE_COLORS.friends,
      onClick: () => onOpenFriends(),
    }] : []),
    {
      id: 'stats',
      emoji: '📊',
      title: 'Stats',
      subtitle: totalCooked > 0 ? `${totalCooked} meals cooked` : 'Track your cooking',
      accent: TILE_COLORS.stats,
      onClick: () => onOpenStats(),
    },
  ], [rotationCount, meals.length, drinks.length, totalCooked, groceryTelemetry, pantryTelemetry, fridgeInventory.length, friendsBadgeCount, friendCount, onNavigate, onGenerate, onOpenPantryMatches, onOpenPantry, onOpenStats, onOpenFriends]);

  const tilesById = useMemo(() => {
    const map = {};
    for (const t of tiles) map[t.id] = t;
    return map;
  }, [tiles]);

  // Layout order/hidden reference tile ids only — tile definitions (emoji,
  // onClick, live telemetry) always come fresh from `tiles` above, so a
  // reordered/hidden widget never goes stale.
  const visibleTiles = useMemo(
    () => layout.order.map(id => tilesById[id]).filter(Boolean).filter(t => !layout.hidden.includes(t.id)),
    [layout, tilesById]
  );
  const hiddenTileDefs = useMemo(
    () => layout.order.map(id => tilesById[id]).filter(Boolean).filter(t => layout.hidden.includes(t.id)),
    [layout, tilesById]
  );

  const handleReorderTiles = useCallback((newVisibleOrder) => {
    setLayout(prev => {
      const newIds = newVisibleOrder.map(t => t.id);
      // Preserve hidden tiles' relative position by appending them after the
      // reordered visible ones — they're not shown, but this keeps `order`
      // a stable superset so un-hiding doesn't dump them at a random spot.
      const stillHidden = prev.order.filter(id => prev.hidden.includes(id));
      return { ...prev, order: [...newIds, ...stillHidden] };
    });
  }, []);

  const handleToggleHidden = useCallback((id) => {
    setLayout(prev => {
      const hidden = prev.hidden.includes(id)
        ? prev.hidden.filter(h => h !== id)
        : [...prev.hidden, id];
      return { ...prev, hidden };
    });
  }, []);

  // ── Seasonal picks ──────────────────────────────────────────────────────────
  const seasonInfo = useMemo(() => getSeasonInfo(), []);
  const seasonalMeals = useMemo(() => getSeasonalMeals(meals, seasonInfo), [meals, seasonInfo]);

  const pantryMatches = useMemo(
    () => findPantryMatches(fridgeInventory, meals),
    [fridgeInventory, meals]
  );

  // Today's meal for hero card
  const todayMeal = next5Days[0]?.meal;

  return (
    <div style={STYLES.container} className={timeClass}>
      {/* Sticky mini-header — appears on scroll past hero */}
      <StickyHeader visible={stickyVisible} onSpin={onGenerate} />

      {/* Hero — app introduction + feature highlights. Spin now lives down in
          the widget grid as its own "Spin the Week" tile (2026-07-30) — this
          fold's job is telling a user what SpiceHub does, not pushing Spin.
          Retired after the first session; see showIntroHero above. */}
      {showIntroHero && (
        <div ref={heroRef} style={{ marginBottom: '20px' }}>
          <AppIntroHero />
        </div>
      )}

      {/* Install banner — shown when PWA install is available */}
      <AnimatePresence>
        {canInstall && onInstallApp && (
          <InstallBanner onInstall={onInstallApp} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        <ImportNudgeBanner batchQueueCount={batchQueueCount} onNavigate={onNavigate} />
      </AnimatePresence>

      {/* Today's meal — elevated hero card */}
      {todayMeal && !todayMeal._special && todayMeal.name && (
        <TodayHeroCard meal={todayMeal} onPress={onViewDetail} />
      )}

      {/* Cook Tonight — pantry-matched meals */}
      <CookTonightCarousel matches={pantryMatches} onViewDetail={onViewDetail} />

      {/* ── Next 5 Days ──
          Doubles as the sticky-header scroll sentinel once the intro hero has
          retired: heroRef would otherwise point at nothing, the
          IntersectionObserver would bail on mount, and the sticky mini-header
          (with its Spin button) would never appear again. */}
      <div className="landing-next-days" ref={showIntroHero ? undefined : heroRef}>
        <div className="landing-section-label">Next 5 Days</div>
        {hasAnyMeal ? (
          <div className="landing-next-days-wrap">
            <motion.div
              className="landing-next-days-scroll sh-carousel"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.15 }}
              variants={{ visible: { transition: { staggerChildren: 0.07 } } }}
            >
              {next5Days.map(({ date, meal, isToday }) => (
                <DayPhotoCard
                  key={localDateKey(date)}
                  date={date}
                  meal={meal}
                  isToday={isToday}
                  onClick={() => setPreviewDay({ date, meal, isToday })}
                />
              ))}
              {seasonalMeals.length >= 2 && (
                <motion.button
                  key="seasonal-tail"
                  className="day-card"
                  variants={{ hidden: { opacity: 0, y: 18, scale: 0.94 }, visible: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 320, damping: 26 } } }}
                  whileHover={{ y: -4 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => onNavigate('library')}
                  style={{ background: 'linear-gradient(135deg, var(--surface), var(--card))' }}
                >
                  <div className="day-card-photo-fallback" style={{ fontSize: '22px' }}>
                    {seasonInfo.emoji}
                  </div>
                  <div className="day-card-body">
                    <div className="day-card-label">{seasonInfo.name}</div>
                    <div className="day-card-name">{seasonalMeals.length} seasonal picks →</div>
                  </div>
                </motion.button>
              )}
            </motion.div>
            <div className="landing-next-days-fade" aria-hidden="true" />
          </div>
        ) : (
          <motion.div
            className="landing-empty"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
          >
            <motion.div
              className="landing-empty-icon"
              animate={{ scale: [1, 1.06, 1] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Dices size={22} strokeWidth={1.75} />
            </motion.div>
            <div className="landing-empty-text">Nothing planned yet</div>
            <div className="landing-empty-hint">One tap picks meals for every empty day.</div>
            <button
              className="landing-empty-btn"
              onClick={onGenerate}
            >
              Fill my week
            </button>
          </motion.div>
        )}
      </div>

      {/* ── Widget dashboard (reorder / pin / hide, persisted local layout) ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div className="landing-section-label" style={{ marginBottom: 0 }}>Shortcuts</div>
        <button
          type="button"
          className="landing-edit-toggle"
          onClick={() => setEditMode(e => !e)}
          aria-pressed={editMode}
        >
          {editMode ? (<><Check size={14} strokeWidth={2.5} /> Done</>) : (<><Pencil size={13} strokeWidth={2.25} /> Edit</>)}
        </button>
      </div>

      {!editMode ? (
        <motion.div
          className="landing-tiles-grid"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
        >
          {visibleTiles.map((tile) => {
            const isPrimary = PRIMARY_TILES.has(tile.id);
            const isBar = tile.id === 'bar';
            const tileClasses = [
              'landing-tile',
              'landing-tile-glass',
              isPrimary ? 'landing-tile-primary' : '',
              isBar ? 'tile-bar' : '',
            ].filter(Boolean).join(' ');

            return (
              <motion.button
                key={tile.id}
                ref={tile.id === 'myMeals' ? myMealsRef : undefined}
                className={tileClasses}
                onClick={() => { haptic(10); tile.onClick(); }}
                variants={{ hidden: { opacity: 0, scale: 0.9 }, visible: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 300, damping: 24 } } }}
                whileHover={{ scale: 0.97, y: -2, boxShadow: 'var(--shadow)', opacity: 0.98 }}
                whileTap={{ scale: 0.94 }}
                style={{ outline: 'none' }}
              >
                {!isPrimary && (
                  <div className="landing-tile-accent" style={{ backgroundColor: tile.accent }} />
                )}
                {isPrimary ? (
                  <>
                    <div className={`tile-emoji-wrap idle-${tile.id}`}>{tile.emoji}</div>
                    <div className="tile-text-wrap">
                      <div className="landing-tile-title">{tile.title}</div>
                      <div className="landing-tile-subtitle">{tile.subtitle}</div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={`landing-tile-emoji idle-${tile.id}`}>{tile.emoji}</div>
                    <div className="landing-tile-title">{tile.title}</div>
                    <div className="landing-tile-subtitle">{tile.subtitle}</div>
                  </>
                )}
              </motion.button>
            );
          })}
        </motion.div>
      ) : (
        <>
          <Reorder.Group
            as="div"
            axis="y"
            values={visibleTiles}
            onReorder={handleReorderTiles}
            style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14, listStyle: 'none', padding: 0, margin: '0 0 14px' }}
          >
            {visibleTiles.map((tile) => (
              <Reorder.Item
                as="div"
                key={tile.id}
                value={tile}
                className="landing-widget-edit-row"
                whileDrag={{ scale: 1.02, boxShadow: 'var(--shadow)', zIndex: 5 }}
              >
                <span className="landing-drag-handle" aria-hidden="true"><GripVertical size={18} strokeWidth={2} /></span>
                <span style={{ fontSize: 26, flexShrink: 0 }}>{tile.emoji}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div className="landing-tile-title" style={{ fontSize: 14, marginBottom: 2 }}>{tile.title}</div>
                  <div className="landing-tile-subtitle">{tile.subtitle}</div>
                </span>
                <button
                  type="button"
                  className="landing-hide-btn"
                  aria-label={`Hide ${tile.title} widget`}
                  onClick={() => handleToggleHidden(tile.id)}
                >
                  <EyeOff size={16} strokeWidth={2} />
                </button>
              </Reorder.Item>
            ))}
          </Reorder.Group>

          {hiddenTileDefs.length > 0 && (
            <div className="landing-hidden-widgets">
              <div className="landing-hidden-widgets-label">Hidden widgets — tap to restore</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {hiddenTileDefs.map((tile) => (
                  <button
                    key={tile.id}
                    type="button"
                    className="landing-hidden-chip"
                    onClick={() => handleToggleHidden(tile.id)}
                  >
                    <Eye size={13} strokeWidth={2} /> {tile.emoji} {tile.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Discover — browse recipe communities, tap to import. Not
          functional yet, so it's parked below the Stats tile/strip rather
          than in a prominent spot (feedback 2026-07-15). ── */}
      <DiscoverFeatureCard onPress={onOpenDiscover} />

      {/* ── Day preview bottom sheet ── */}
      <AnimatePresence>
        {previewDay && (
          <MealPreviewSheet
            key="preview-sheet"
            date={previewDay.date}
            meal={previewDay.meal}
            isToday={previewDay.isToday}
            onClose={() => setPreviewDay(null)}
            onViewFull={(meal) => { onViewDetail(meal); }}
            meals={meals}
            onRespinDate={onRespinDate}
            onAssignMeal={onAssignMeal}
            onCreateMealForDay={onCreateMealForDay}
          />
        )}
      </AnimatePresence>

      {showOnboarding && meals.length === 0 && (
        <OnboardingCoach
          onComplete={() => { try { localStorage.setItem('sh_onboarding_v1', '1'); } catch {} }}
          targets={{ cta: ctaRef, myMeals: myMealsRef }}
        />
      )}
    </div>
  );
}
