import { useState, useEffect, useCallback } from 'react';
import db, { seedIfEmpty, SEED_DRINKS, importPaprikaMeals, logCook, logMix, saveWeekPlan, loadWeekPlan, saveGroceryList, loadGroceryList, getCookingLog, processImportQueue } from './db';
import { PAPRIKA_MEALS } from './paprika_import_data';
import { checkStorageQuota, checkAndRecommendCleanup } from './storageManager';
import { initializeBackgroundSync } from './backgroundSync';
import WeekView from './components/WeekView';
import MealLibrary from './components/MealLibrary';
import BarLibrary from './components/BarLibrary';
import GroceryList from './components/GroceryList';
import MealDetail from './components/MealDetail';
import AddEditMeal from './components/AddEditMeal';
import ImportModal from './components/ImportModal';
import FridgeMode from './components/FridgeMode';
import CookMode from './components/CookMode';
import MixMode from './components/MixMode';
import MealStats from './components/MealStats';
import BarShelf from './components/BarShelf';
import BarFridgeMode from './components/BarFridgeMode';
import MealSpinner from './components/MealSpinner';
import SyncQueue from './components/SyncQueue';
import StorageManager from './components/StorageManager';
import OfflineIndicator from './components/OfflineIndicator';
import { ThemeSettings } from './components/ThemeProvider';
import { isMobileDevice } from './isMobile';
import useOnlineStatus, { onOnlineStatusChange } from './hooks/useOnlineStatus';
import useBackHandler from './hooks/useBackHandler';
import useSwipeDismiss from './hooks/useSwipeDismiss';
import './App.css';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Special "non-meal" day options
const SPECIAL_DAYS = [
  { id: '__eat_out__', name: 'Eat Out', icon: '🍽️' },
  { id: '__leftovers__', name: 'Leftovers', icon: '📦' },
  { id: '__dealers_choice__', name: "Dealer's Choice", icon: '🎲' },
  { id: '__pizza_movie__', name: 'Pizza & Movie Night', icon: '🍕' },
  { id: '__skip__', name: 'No Plan', icon: '⏭️' },
];

export default function App() {
  const { isOnline } = useOnlineStatus();
  const [tab, setTab] = useState('week');
  const [meals, setMeals] = useState([]);
  const [drinks, setDrinks] = useState([]);
  const [weekPlan, setWeekPlan] = useState(Array(7).fill(null));
  const [detailItem, setDetailItem] = useState(null);   // meal or drink being viewed
  const [editMeal, setEditMeal] = useState(null);
  const [editDrink, setEditDrink] = useState(null);
  // 'meals' | 'drinks' | null — controls which ImportModal is open and where to save
  const [showImportFor, setShowImportFor] = useState(null);
  const [groceryItems, setGroceryItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [showFridge, setShowFridge] = useState(false);
  const [cookModeMeal, setCookModeMeal] = useState(null); // { meal, scaleFactor }
  const [mixModeDrink, setMixModeDrink] = useState(null); // { drink, scaleFactor }
  const [showStats, setShowStats] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBarShelf, setShowBarShelf] = useState(false);
  const [showBarFridge, setShowBarFridge] = useState(false);
  const [showSpinner, setShowSpinner] = useState(false);
  const [cookingStats, setCookingStats] = useState({ streak: 0, totalCooked: 0, topMeal: null });
  const [queuedOps, setQueuedOps] = useState(0);
  const [showStorageManager, setShowStorageManager] = useState(false);
  const [storageWarning, setStorageWarning] = useState(null);
  const [sharedContent, setSharedContent] = useState(null); // { mode, url, text } from share-target

  // ── Swipe-down-to-dismiss for inline bottom sheets ──────────────────────────
  const storageSwipe = useSwipeDismiss(() => setShowStorageManager(false));
  const settingsSwipe = useSwipeDismiss(() => setShowSettings(false));

  // ── Hardware back button handlers (Android PWA) ─────────────────────────────
  // Order matters: later entries are higher priority (LIFO stack)
  useBackHandler(!!detailItem, () => setDetailItem(null), 'detail');
  useBackHandler(editMeal !== null, () => setEditMeal(null), 'edit-meal');
  useBackHandler(editDrink !== null, () => setEditDrink(null), 'edit-drink');
  useBackHandler(!!showImportFor, () => setShowImportFor(null), 'import');
  useBackHandler(showFridge, () => setShowFridge(false), 'fridge');
  useBackHandler(showBarShelf, () => setShowBarShelf(false), 'bar-shelf');
  useBackHandler(showBarFridge, () => setShowBarFridge(false), 'bar-fridge');
  useBackHandler(!!cookModeMeal, () => setCookModeMeal(null), 'cook-mode');
  useBackHandler(!!mixModeDrink, () => setMixModeDrink(null), 'mix-mode');
  useBackHandler(showSpinner, () => setShowSpinner(false), 'spinner');
  useBackHandler(showStats, () => setShowStats(false), 'stats');
  useBackHandler(showStorageManager, () => setShowStorageManager(false), 'storage');
  useBackHandler(showSettings, () => setShowSettings(false), 'settings');

  const showToast = useCallback((message, type = 'success', duration = 2500) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), duration);
  }, []);

  // ── Data loaders ─────────────────────────────────────────────────────────────
  const loadMeals = useCallback(async () => {
    await seedIfEmpty();
    // One-time Paprika import (deduplicates automatically)
    const paprikaResult = await importPaprikaMeals(PAPRIKA_MEALS);
    if (paprikaResult.imported > 0) {
      console.log(`🌶️ Imported ${paprikaResult.imported} Paprika recipes (${paprikaResult.skipped} skipped)`);
    }
    const all = await db.meals.toArray();
    setMeals(all);
    setLoading(false);
  }, []);

  const loadDrinks = useCallback(async () => {
    // Seed bar with a few example drinks on first use
    const count = await db.drinks.count();
    if (count === 0) {
      await db.drinks.bulkAdd(SEED_DRINKS);
    }
    const all = await db.drinks.toArray();
    setDrinks(all);
  }, []);

  useEffect(() => {
    loadMeals();
    loadDrinks();
    // Restore persisted week plan and grocery list
    loadWeekPlan().then(plan => { if (plan) setWeekPlan(plan); });
    loadGroceryList().then(items => { if (items) setGroceryItems(items); });

    // Check storage quota on startup
    checkStorageQuota()
      .then(quota => {
        if (quota.percentUsed > 75) {
          setStorageWarning(`Storage usage is high (${quota.percentUsed}%). Consider cleaning up old logs.`);
        }
      })
      .catch(err => console.warn('Failed to check storage quota:', err));
  }, [loadMeals, loadDrinks]);

  // Persist week plan whenever it changes (debounced)
  useEffect(() => {
    if (!weekPlan.some(Boolean)) return; // Don't save empty plans
    const t = setTimeout(() => saveWeekPlan(weekPlan), 300);
    return () => clearTimeout(t);
  }, [weekPlan]);

  // Persist grocery list whenever it changes
  useEffect(() => {
    if (groceryItems.length === 0) return;
    const t = setTimeout(() => saveGroceryList(groceryItems), 300);
    return () => clearTimeout(t);
  }, [groceryItems]);

  // Load store memory on startup
  useEffect(() => {
    try {
      const mem = localStorage.getItem('spicehub_store_memory');
      if (mem) window._storeMemory = JSON.parse(mem);
    } catch {}
  }, []);

  // Compute cooking stats for dashboard
  const computeStats = useCallback(async () => {
    try {
      const log = await getCookingLog();
      const totalCooked = log.filter(e => e.type !== 'mix').length;

      // Calculate streak: consecutive days with at least one cook
      let streak = 0;
      if (log.length > 0) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const cookDays = new Set(log.filter(e => e.type !== 'mix').map(e => {
          const d = new Date(e.cookedAt); d.setHours(0, 0, 0, 0); return d.getTime();
        }));
        for (let i = 0; i < 365; i++) {
          const check = new Date(today); check.setDate(check.getDate() - i);
          check.setHours(0, 0, 0, 0);
          if (cookDays.has(check.getTime())) streak++;
          else if (i > 0) break; // Allow today to be uncounted
        }
      }

      // Top meal by cook count
      const allMeals = await db.meals.toArray();
      const topMeal = allMeals.filter(m => m.cookCount > 0).sort((a, b) => (b.cookCount || 0) - (a.cookCount || 0))[0] || null;

      setCookingStats({ streak, totalCooked, topMeal });
    } catch {}
  }, []);

  useEffect(() => { computeStats(); }, [computeStats]);

  // Handle online status changes — process queued operations when coming back online
  useEffect(() => {
    const unsubscribe = onOnlineStatusChange(({ isOnline: nowOnline }) => {
      if (nowOnline && queuedOps > 0) {
        setIsSyncing(true);
        // Simulate sync completion after a short delay
        const t = setTimeout(() => {
          setQueuedOps(0);
          setIsSyncing(false);
          showToast('✓ All changes synced', 'success');
        }, 1500);
        return () => clearTimeout(t);
      }
    });
    return unsubscribe;
  }, [queuedOps, showToast]);

  // Handle PWA install prompt
  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    if (isMobileDevice()) setShowInstallBanner(true);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallApp = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') showToast('SpiceHub installed!', 'success');
      setShowInstallBanner(false);
      setDeferredPrompt(null);
    } else {
      showToast('Tap Safari menu → "Add to Home Screen"', 'info', 3000);
      setShowInstallBanner(false);
    }
  };

  // Handle PWA share-target — intelligently route content to the right import mode
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('share-target')) {
      const sharedUrl = params.get('url');
      const sharedText = params.get('text');
      const sharedTitle = params.get('title');

      if (sharedUrl || sharedText) {
        // Determine the import mode based on what was shared
        let mode = 'url'; // default: assume URL import
        let contentData = null;

        // Priority: URL > text (text might be a URL or recipe text)
        if (sharedUrl) {
          mode = 'url';
          contentData = { mode, url: sharedUrl, title: sharedTitle };
        } else if (sharedText) {
          // Check if shared text looks like a URL
          const textTrimmed = sharedText.trim();
          if (textTrimmed.startsWith('http://') || textTrimmed.startsWith('https://')) {
            mode = 'url';
            contentData = { mode, url: textTrimmed, title: sharedTitle };
          } else {
            // Plain text — likely recipe instructions/ingredients
            mode = 'paste';
            contentData = { mode, text: textTrimmed, title: sharedTitle };
          }
        }

        if (contentData) {
          console.log('[Share Target] Received shared content:', { mode, hasUrl: !!contentData.url, hasText: !!contentData.text });
          setSharedContent(contentData);
          setShowImportFor('meals');
          // Clear share-target from URL to prevent re-processing on back navigation
          window.history.replaceState({}, '', '/');
        }
      }
    }
  }, []);

  // ── Week plan ─────────────────────────────────────────────────────────────────
  const generateWeek = useCallback(() => {
    if (meals.length < 5) {
      alert('Need at least 5 meals to generate a week!');
      return;
    }
    setShowSpinner(true);
  }, [meals]);

  const handleSpinnerComplete = useCallback((plan) => {
    setWeekPlan(plan);
    setShowSpinner(false);
    showToast('Week plan generated!');
  }, [showToast]);

  const respinDay = useCallback((dayIndex) => {
    const current = weekPlan[dayIndex];
    if (current && current._special) return;
    const otherIds = weekPlan.filter((m, i) => i !== dayIndex && m && !m._special).map(m => m.id);
    const available = meals.filter(m => !otherIds.includes(m.id) && m.id !== current?.id);
    if (available.length === 0) { alert('No more meals available to swap in!'); return; }
    const pick = available[Math.floor(Math.random() * available.length)];
    setWeekPlan(prev => prev.map((m, i) => i === dayIndex ? pick : m));
  }, [meals, weekPlan]);

  const setDayMeal = useCallback((dayIndex, meal) => {
    setWeekPlan(prev => prev.map((m, i) => i === dayIndex ? meal : m));
  }, []);

  const setDaySpecial = useCallback((dayIndex, specialId) => {
    const special = SPECIAL_DAYS.find(s => s.id === specialId);
    if (special) {
      setWeekPlan(prev => prev.map((m, i) => i === dayIndex ? { ...special, _special: true } : m));
    } else {
      setWeekPlan(prev => prev.map((m, i) => i === dayIndex ? null : m));
    }
  }, []);

  // ── Meal CRUD ─────────────────────────────────────────────────────────────────
  const saveMeal = useCallback(async (mealData) => {
    if (mealData.id) { await db.meals.update(mealData.id, mealData); }
    else { await db.meals.add(mealData); }
    await loadMeals();
    setEditMeal(null);
  }, [loadMeals]);

  const deleteMeal = useCallback(async (id) => {
    await db.meals.delete(id);
    setWeekPlan(prev => prev.map(m => m?.id === id ? null : m));
    await loadMeals();
  }, [loadMeals]);

  const toggleFavorite = useCallback(async (meal) => {
    await db.meals.update(meal.id, { isFavorite: !meal.isFavorite });
    await loadMeals();
  }, [loadMeals]);

  const rateMeal = useCallback(async (meal, rating) => {
    await db.meals.update(meal.id, { rating });
    await loadMeals();
  }, [loadMeals]);

  // ── Drink CRUD ────────────────────────────────────────────────────────────────
  const saveDrink = useCallback(async (drinkData) => {
    if (drinkData.id) { await db.drinks.update(drinkData.id, drinkData); }
    else { await db.drinks.add(drinkData); }
    await loadDrinks();
    setEditDrink(null);
  }, [loadDrinks]);

  const deleteDrink = useCallback(async (id) => {
    await db.drinks.delete(id);
    await loadDrinks();
  }, [loadDrinks]);

  // ── Grocery list ──────────────────────────────────────────────────────────────
  const buildGroceryList = useCallback(() => {
    const items = {};
    const storeMemory = window._storeMemory || {};
    weekPlan.forEach(meal => {
      if (!meal || meal._special) return;
      meal.ingredients.forEach(ing => {
        const key = ing.toLowerCase().trim();
        if (!items[key]) {
          const rememberedStore = storeMemory[key] || '';
          items[key] = { name: ing, checked: false, store: rememberedStore };
        }
      });
    });
    setGroceryItems(Object.values(items));
    setTab('grocery');
  }, [weekPlan]);

  // ── Import handler — routes to meals or drinks table ─────────────────────────
  const handleImport = useCallback(async (imported) => {
    const target = showImportFor;
    setShowImportFor(null);
    for (const r of imported) {
      if (target === 'drinks') { await db.drinks.add(r); }
      else { await db.meals.add(r); }
    }
    if (target === 'drinks') { await loadDrinks(); }
    else { await loadMeals(); }
    const count = imported.length;
    const noun = target === 'drinks' ? (count === 1 ? 'drink' : 'drinks') : (count === 1 ? 'recipe' : 'recipes');
    const name = count === 1 ? imported[0].name : `${count} ${noun}`;
    showToast(`Added ${name} to ${target === 'drinks' ? 'The Bar' : 'your library'}`);
  }, [showImportFor, loadMeals, loadDrinks, showToast]);

  // ── Cook Mode ────────────────────────────────────────────────────────────────
  const startCookMode = useCallback((meal, scaleFactor = 1.0) => {
    setCookModeMeal({ meal, scaleFactor });
  }, []);

  const finishCookMode = useCallback(async () => {
    if (cookModeMeal) {
      const { meal } = cookModeMeal;
      try {
        await logCook(meal.id, meal.name);
        await loadMeals(); // Refresh to pick up updated cookCount
        showToast(`Nice! Logged "${meal.name}" as cooked 🎉`);
      } catch {}
    }
    setCookModeMeal(null);
  }, [cookModeMeal, loadMeals, showToast]);

  // ── Mix Mode (drinks) ───────────────────────────────────────────────────────
  const startMixMode = useCallback((drink, scaleFactor = 1.0) => {
    setMixModeDrink({ drink, scaleFactor });
  }, []);

  const finishMixMode = useCallback(async () => {
    if (mixModeDrink) {
      const { drink } = mixModeDrink;
      try {
        await logMix(drink.id, drink.name);
        await loadDrinks();
        showToast(`Cheers! Logged "${drink.name}" as mixed 🍹`);
      } catch {}
    }
    setMixModeDrink(null);
  }, [mixModeDrink, loadDrinks, showToast]);

  // Helper: check if a detailItem is a drink (exists in drinks array)
  const isDrink = useCallback((item) => {
    if (!item) return false;
    return drinks.some(d => d.id === item.id);
  }, [drinks]);

  // ── Share ─────────────────────────────────────────────────────────────────────
  const shareItem = useCallback((item) => {
    const text = item.name + '\n\nIngredients:\n' + item.ingredients.map(i => '- ' + i).join('\n') +
      '\n\nDirections:\n' + item.directions.map((d, i) => (i + 1) + '. ' + d).join('\n') +
      (item.link ? '\n\nRecipe: ' + item.link : '');
    if (navigator.share) { navigator.share({ title: item.name, text }).catch(() => {}); }
    else { navigator.clipboard.writeText(text).then(() => alert('Recipe copied to clipboard!')).catch(() => {}); }
  }, []);


  if (loading) return <div className="loading-screen"><div className="spinner" /><p>Loading SpiceHub…</p></div>;

  return (
    <div className="app">
      <OfflineIndicator
        queuedOps={queuedOps}
      />

      <header className="app-header">
        <div>
          <h1>SpiceHub</h1>
          <p className="subtitle">Meal Spinner <span className="build-tag">v{__SPICEHUB_VERSION__}</span></p>
        </div>
        <div className="header-actions">
          <button className="hdr-btn" onClick={() => setShowFridge(true)} title="What's in My Fridge?">🧊</button>
          <button className="hdr-btn" onClick={() => setShowStats(true)} title="Meal Stats">📊</button>
          <button className="hdr-btn" onClick={() => setShowStorageManager(true)} title="Storage">💾</button>
          <button className="hdr-btn" onClick={() => setShowSettings(true)} title="Settings">⚙️</button>
        </div>
      </header>

      {showInstallBanner && (
        <div className="install-banner">
          <div className="install-banner-content">
            <span>Add SpiceHub to your home screen</span>
            <div className="install-banner-actions">
              <button className="btn-small" onClick={handleInstallApp}>Install</button>
              <button className="btn-icon small" onClick={() => setShowInstallBanner(false)}>✕</button>
            </div>
          </div>
        </div>
      )}

      <main className="main-content">
        {tab === 'week' && (
          <WeekView
            days={DAYS}
            weekPlan={weekPlan}
            meals={meals}
            specialDays={SPECIAL_DAYS}
            onGenerate={generateWeek}
            onRespin={respinDay}
            onSetDay={setDayMeal}
            onSetSpecial={setDaySpecial}
            onViewDetail={setDetailItem}
            onBuildGrocery={buildGroceryList}
            cookingStats={cookingStats}
          />
        )}
        {tab === 'library' && (
          <MealLibrary
            meals={meals}
            onAdd={() => setEditMeal({})}
            onEdit={setEditMeal}
            onDelete={deleteMeal}
            onViewDetail={setDetailItem}
            onShare={shareItem}
            onImport={() => setShowImportFor('meals')}
            onReload={loadMeals}
            onToast={showToast}
            onToggleFavorite={toggleFavorite}
            onRate={rateMeal}
          />
        )}
        {tab === 'bar' && (
          <BarLibrary
            drinks={drinks}
            onAdd={() => setEditDrink({})}
            onEdit={setEditDrink}
            onDelete={deleteDrink}
            onViewDetail={setDetailItem}
            onShare={shareItem}
            onImport={() => setShowImportFor('drinks')}
            onReload={loadDrinks}
            onToast={showToast}
            onOpenShelf={() => setShowBarShelf(true)}
            onOpenBarFridge={() => setShowBarFridge(true)}
          />
        )}
        {tab === 'grocery' && (
          <GroceryList
            items={groceryItems}
            setItems={setGroceryItems}
            weekPlan={weekPlan}
            onRebuild={buildGroceryList}
            onToast={showToast}
          />
        )}
      </main>

      {/* ── Bottom Tab Bar (mobile-first) ── */}
      <nav className="tab-bar">
        <button className={tab === 'week' ? 'active' : ''} onClick={() => setTab('week')}>
          <span style={{ fontSize: 18 }}>📅</span>
          <span>Week</span>
        </button>
        <button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}>
          <span style={{ fontSize: 18 }}>🍳</span>
          <span>Meals</span>
        </button>
        <button className={tab === 'bar' ? 'active bar-tab' : 'bar-tab'} onClick={() => setTab('bar')}>
          <span style={{ fontSize: 18 }}>🍹</span>
          <span>Bar</span>
        </button>
        <button className={tab === 'grocery' ? 'active' : ''} onClick={() => { setTab('grocery'); if (groceryItems.length === 0 && weekPlan.some(Boolean)) buildGroceryList(); }}>
          <span style={{ fontSize: 18 }}>🛒</span>
          <span>Grocery</span>
        </button>
      </nav>

      {/* ── Modals ── */}
      {detailItem && (
        <MealDetail
          meal={detailItem}
          onClose={() => setDetailItem(null)}
          onShare={() => shareItem(detailItem)}
          onToggleFavorite={isDrink(detailItem) ? null : toggleFavorite}
          onRate={isDrink(detailItem) ? null : rateMeal}
          onStartCook={isDrink(detailItem) ? null : startCookMode}
          onStartMix={isDrink(detailItem) ? startMixMode : null}
          isDrink={isDrink(detailItem)}
        />
      )}
      {editMeal !== null && (
        <AddEditMeal meal={editMeal} onSave={saveMeal} onClose={() => setEditMeal(null)} />
      )}
      {editDrink !== null && (
        <AddEditMeal
          meal={editDrink}
          onSave={saveDrink}
          onClose={() => setEditDrink(null)}
          title={editDrink.id ? 'Edit Drink' : 'Add Drink'}
          placeholder="🍹"
          ingredientLabel="Ingredients"
          directionsLabel="Instructions"
        />
      )}
      {showImportFor && (
        <ImportModal
          onImport={handleImport}
          onClose={() => { setShowImportFor(null); setSharedContent(null); }}
          title={showImportFor === 'drinks' ? 'Import Drink' : 'Import Recipe'}
          sharedContent={sharedContent}
        />
      )}

      {/* ── New feature overlays ── */}
      {showFridge && (
        <FridgeMode
          meals={meals}
          onViewDetail={(meal) => { setShowFridge(false); setDetailItem(meal); }}
          onClose={() => setShowFridge(false)}
        />
      )}
      {showBarShelf && (
        <BarShelf
          drinks={drinks}
          onViewDetail={(drink) => { setShowBarShelf(false); setDetailItem(drink); }}
          onClose={() => setShowBarShelf(false)}
        />
      )}
      {showBarFridge && (
        <BarFridgeMode
          drinks={drinks}
          onViewDetail={(drink) => { setShowBarFridge(false); setDetailItem(drink); }}
          onClose={() => setShowBarFridge(false)}
        />
      )}
      {cookModeMeal && (
        <CookMode
          meal={cookModeMeal.meal}
          scaleFactor={cookModeMeal.scaleFactor}
          onClose={finishCookMode}
        />
      )}
      {mixModeDrink && (
        <MixMode
          drink={mixModeDrink.drink}
          scaleFactor={mixModeDrink.scaleFactor}
          onClose={finishMixMode}
        />
      )}
      {showSpinner && (
        <MealSpinner
          meals={meals}
          onComplete={handleSpinnerComplete}
          onClose={() => setShowSpinner(false)}
        />
      )}
      {showStats && (
        <MealStats
          meals={meals}
          onClose={() => setShowStats(false)}
          onViewDetail={(meal) => { setShowStats(false); setDetailItem(meal); }}
        />
      )}
      {storageWarning && (
        <div className="storage-warning-banner">
          <span>⚠️ {storageWarning}</span>
          <button className="warning-close" onClick={() => setStorageWarning(null)}>✕</button>
        </div>
      )}

      {showStorageManager && (
        <div className="st-overlay" onClick={() => setShowStorageManager(false)}>
          <div className="st-sheet" ref={storageSwipe.sheetRef} onClick={e => e.stopPropagation()}
            onTouchStart={storageSwipe.handleTouchStart} onTouchMove={storageSwipe.handleTouchMove} onTouchEnd={storageSwipe.handleTouchEnd}>
            <div className="st-handle" />
            <StorageManager
              onClose={() => setShowStorageManager(false)}
              onToast={showToast}
            />
          </div>
        </div>
      )}

      {showSettings && (
        <div className="st-overlay" onClick={() => setShowSettings(false)}>
          <div className="st-sheet" ref={settingsSwipe.sheetRef} onClick={e => e.stopPropagation()}
            onTouchStart={settingsSwipe.handleTouchStart} onTouchMove={settingsSwipe.handleTouchMove} onTouchEnd={settingsSwipe.handleTouchEnd}>
            <div className="st-handle" />
            <div className="st-header">
              <h2 className="st-title">⚙️ Settings</h2>
              <button className="st-close" onClick={() => setShowSettings(false)}>✕</button>
            </div>
            <div className="st-content">
              <div className="st-section">
                <h3>Theme</h3>
                <ThemeSettings />
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <span>{toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : 'ℹ️'}</span>
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
