import { useState, useEffect, useCallback, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import db, { importPaprikaMeals, logCook, logMix, saveWeekPlan, loadWeekPlan, saveGroceryList, loadGroceryList, getCookingLog, getWeekHistory, saveWeekToHistory, toggleRotation } from './db';
import { PAPRIKA_MEALS } from './paprika_import_data';
import { checkStorageQuota, checkAndRecommendCleanup } from './storageManager';
import { initializeBackgroundSync } from './backgroundSync';
import WeekView from './components/WeekView';
import LandingPage from './components/LandingPage';
import MealLibrary from './components/MealLibrary';
import BarLibrary from './components/BarLibrary';
import GroceryList from './components/GroceryList';
import MealDetail from './components/MealDetail';
import AddEditMeal from './components/AddEditMeal';
import ImportSheet from './components/ImportSheet';
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

// ── Date utilities (shared with week history logic) ───────────────────────────
function getMondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

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
  const [tab, setTab] = useState('home');
  const [meals, setMeals] = useState([]);
  const [drinks, setDrinks] = useState([]);
  const [weekPlan, setWeekPlan] = useState(Array(7).fill(null));
  const [detailItem, setDetailItem] = useState(null);   // meal or drink being viewed
  const [editMeal, setEditMeal] = useState(null);
  const [editDrink, setEditDrink] = useState(null);
  // 'meals' | 'drinks' | null — controls which ImportModal is open and where to save
  const [showImportFor, setShowImportFor] = useState(null);
  // Increment this to force ImportModal to fully remount (fresh state) on each open
  const [importModalKey, setImportModalKey] = useState(0);
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
  const [weekHistory, setWeekHistory] = useState([]); // past week plans
  const [isSyncing, setIsSyncing] = useState(false)

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
    const all = await db.meals.toArray();
    // Show all meals. Ghost rows (status:'processing'/'failed') render as loading/error
    // cards in MealLibrary so the user always sees what's happening — never a silent void.
    // BrowserAssist is now the default import path so new ghost rows shouldn't be created,
    // but any existing ones in the DB should remain visible and deletable.
    setMeals(all);
    setLoading(false);
  }, []);

  const loadDrinks = useCallback(async () => {
    const all = await db.drinks.toArray();
    setDrinks(all);
  }, []);

  // Background worker has been deprecated in favor of synchronous local JSON-LD parsing.
  useEffect(() => {
    loadMeals();
    loadDrinks();
    // Restore persisted week plan and grocery list
    loadWeekPlan().then(plan => { if (plan) setWeekPlan(plan); });
    loadGroceryList().then(items => { if (items) setGroceryItems(items); });
    getWeekHistory().then(history => setWeekHistory(history));

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
    const t = setTimeout(() => {
      saveWeekPlan(weekPlan);
      // Also save to history for the current week
      const now = new Date();
      const day = now.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const monday = new Date(now);
      monday.setDate(monday.getDate() + diff);
      monday.setHours(0, 0, 0, 0);
      saveWeekToHistory(monday.toISOString(), weekPlan)
        .then(() => getWeekHistory().then(h => setWeekHistory(h)));
    }, 300);
    return () => clearTimeout(t);
  }, [weekPlan]);

  // Compute rotation meals
  const rotationMeals = useMemo(() => meals.filter(m => m.inRotation), [meals]);

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
    } catch { }
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
    } catch { }
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
  }, [queuedOps, showToast, isSyncing]);

  // Handle PWA install prompt — only show when browser actually offers it,
  // and only if the user hasn't permanently dismissed it.
  useEffect(() => {
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Only auto-show banner if user hasn't dismissed it before
      if (!dismissed) setShowInstallBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    // NOTE: removed unconditional isMobileDevice() auto-show — was causing the
    // persistent banner on every tab load. Install is now accessible via ⚙️ Settings.
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallApp = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') showToast('SpiceHub installed! 🎉', 'success');
      setShowInstallBanner(false);
      setDeferredPrompt(null);
    } else {
      // iOS Safari fallback instruction
      showToast('Tap Share → "Add to Home Screen"', 'info', 4000);
      setShowInstallBanner(false);
    }
  };

  const handleDismissInstallBanner = () => {
    setShowInstallBanner(false);
    // Persist dismissal so it doesn't reappear on next session
    localStorage.setItem('pwa-install-dismissed', '1');
  };

// ── Shared-content drink detection helper ────────────────────────────────────
// Returns true if the URL / title / text looks like a cocktail / drink post.
// Used to auto-route shares to the Bar instead of the Meal library.
const DRINK_KEYWORDS_RX = /\b(cocktail|drink|bar\b|bartend|beer|wine|whiskey|whisky|bourbon|vodka|rum\b|gin\b|tequila|mezcal|margarita|martini|negroni|mojito|spritz|mocktail|mixolog|booze|seltzer|cider|mead|sake|liqueur|schnapps|aperol|campari|baileys|kahlua|triple\s*sec|bitters|pour\s*over|pour-over|on\s+the\s+rocks|neat\b|craft\s+beer|ipa\b|lager|ale\b|stout|porter\b|sour\b|daiquiri|paloma|mule\b|sling\b|punch\b|highball|lowball|nightcap|happy\s*hour)\b/i;

function _looksLikeDrink(url, title, text) {
  return DRINK_KEYWORDS_RX.test(url || '') ||
         DRINK_KEYWORDS_RX.test(title || '') ||
         DRINK_KEYWORDS_RX.test(text || '');
}

// Handle Share Target (Android + PWA)
// Supports both GET (legacy) and POST (via sw.js redirect) methods
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.has('share-target')) {
    const sharedUrl   = params.get('url')   || '';
    const sharedTitle = params.get('title') || '';
    const sharedText  = params.get('text')  || '';
    const target = _looksLikeDrink(sharedUrl, sharedTitle, sharedText) ? 'drinks' : 'meals';
    if (sharedUrl) {
      setImportModalKey(k => k + 1);
      setShowImportFor(target);
      setSharedContent({ mode: 'url', url: sharedUrl, title: sharedTitle, text: sharedText, isShare: true });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }
}, []);

// Handle native share-target intents from Capacitor (@capgo/capacitor-share-target).
// main.jsx wires the native plugin and dispatches `spicehub:share-import` whenever
// the OS routes a share to us. Here we mirror the PWA behavior — open the import
// modal and pre-populate it with the shared URL or text.
useEffect(() => {
  const handler = (e) => {
    const detail = e?.detail;
    if (!detail || (!detail.url && !detail.text)) return;
    const target = _looksLikeDrink(detail.url, detail.title, detail.text) ? 'drinks' : 'meals';
    setImportModalKey(k => k + 1);
    setShowImportFor(target);
    setSharedContent({
      mode: detail.mode || (detail.url ? 'url' : 'text'),
      url: detail.url || '',
      text: detail.text || '',
      title: detail.title || '',
      isShare: true,
    });
  };
  window.addEventListener('spicehub:share-import', handler);
  return () => window.removeEventListener('spicehub:share-import', handler);
}, []);

// Re-import hook: allows MealDetail "Re-import" button to trigger import
useEffect(() => {
  window.__spicehubTriggerImport = (url) => {
    const target = _looksLikeDrink(url, '', '') ? 'drinks' : 'meals';
    setImportModalKey(k => k + 1);
    setShowImportFor(target);
    setSharedContent({ mode: 'url', url, title: '', text: '', isReimport: true });
  };
  return () => { delete window.__spicehubTriggerImport; };
}, []);

  // ── Week plan ─────────────────────────────────────────────────────────────────
  const generateWeek = useCallback(() => {
    if (meals.length < 5) {
      alert('Need at least 5 meals to generate a week!');
      return;
    }
    setShowSpinner(true);
  }, [meals]);

  const handleSpinnerCompleteForDates = useCallback(async (pairs) => {
    // pairs = [{date: Date, meal: mealObj}] — one entry per spinner slot
    const todayMonday = getMondayOfWeek(new Date());
    const weekMap = new Map();

    pairs.forEach(({ date, meal }) => {
      const weekMon = getMondayOfWeek(date);
      const key = localDateKey(weekMon);
      const dow = date.getDay() === 0 ? 6 : date.getDay() - 1; // Mon-first DOW index

      if (!weekMap.has(key)) {
        const isCurrent = weekMon.getTime() === todayMonday.getTime();
        // Seed plan from current state or from history
        let plan;
        if (isCurrent) {
          plan = [...weekPlan];
        } else {
          const histEntry = weekHistory.find(hw => {
            const hwMon = new Date(hw.weekStart); hwMon.setHours(0, 0, 0, 0);
            return localDateKey(hwMon) === key;
          });
          plan = histEntry ? [...histEntry.meals] : Array(7).fill(null);
        }
        weekMap.set(key, { mon: weekMon, isCurrent, plan });
      }

      weekMap.get(key).plan[dow] = meal;
    });

    // Persist each week
    for (const [, { mon, isCurrent, plan }] of weekMap) {
      if (isCurrent) {
        setWeekPlan(plan);
      } else {
        await saveWeekToHistory(mon.toISOString(), plan);
      }
    }

    // Refresh history so calendar reflects changes
    getWeekHistory().then(h => setWeekHistory(h));
    setShowSpinner(false);
    showToast(`${pairs.length} meal${pairs.length !== 1 ? 's' : ''} planned! 🎉`);
  }, [weekPlan, weekHistory, showToast]);

  const restoreWeek = useCallback((weekMeals) => {
    if (!weekMeals || weekMeals.length !== 7) return;
    setWeekPlan(weekMeals);
    showToast('Week restored!');
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

  const toggleLockDay = useCallback((dayIndex) => {
    setWeekPlan(prev => prev.map((m, i) => {
      if (i === dayIndex && m && !m._special) {
        return { ...m, _locked: !m._locked };
      }
      return m;
    }));
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
    else { await db.meals.add({ ...mealData, createdAt: new Date().toISOString() }); }
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

  const handleToggleRotation = useCallback(async (meal) => {
    const newVal = !meal.inRotation;
    await toggleRotation(meal.id, newVal);
    // Update the detailItem in-place so UI reflects immediately
    setDetailItem(prev => prev && prev.id === meal.id ? { ...prev, inRotation: newVal } : prev);
    await loadMeals();
    showToast(newVal ? `Added "${meal.name}" to The Rotation` : `Removed "${meal.name}" from The Rotation`);
  }, [loadMeals, showToast]);

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

  // ── Add quest items to grocery (Bar → Grocery bridge) ───────────────────────
  const handleAddToGrocery = useCallback((questItems) => {
    if (!questItems || questItems.length === 0) return;
    const storeMemory = window._storeMemory || {};
    setGroceryItems(prev => {
      const existingKeys = new Set(prev.map(i => i.name.toLowerCase().trim()));
      const newItems = questItems
        .filter(qi => !existingKeys.has(qi.name.toLowerCase().trim()))
        .map(qi => ({
          name: qi.name,
          checked: false,
          store: storeMemory[qi.name.toLowerCase().trim()] || '',
          tag: qi.tag || 'bar-quest',
          questDrinkId: qi.questDrinkId,
          questName: qi.questName,
        }));
      if (newItems.length === 0) return prev;
      return [...prev, ...newItems];
    });
    const count = questItems.length;
    showToast(`📜 ${count} ingredient${count !== 1 ? 's' : ''} added to grocery quest!`, 'success');
    if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
  }, [showToast]);

  // ── Import handler — routes to meals, drinks, grocery, or week ──────────────
  // destination overrides showImportFor and is set by the Smart Action Bar
  // in ImportModal when the user taps "→ Bar", "→ Grocery", or "→ This Week".
  const handleImport = useCallback(async (imported, destination) => {
    const target = destination || showImportFor;
    setShowImportFor(null);
    setSharedContent(null);

    const real = imported.filter(r => r.name);

    // ── Grocery destination ────────────────────────────────────────────────────
    // Merges recipe ingredients into the grocery list without saving to the library.
    if (target === 'grocery') {
      if (!real.length) return;
      const storeMemory = window._storeMemory || {};
      setGroceryItems(prev => {
        const existingKeys = new Set(prev.map(i => i.name.toLowerCase().trim()));
        const newItems = real.flatMap(r => (r.ingredients || []))
          .filter(ing => ing && !existingKeys.has(ing.toLowerCase().trim()))
          .map(ing => ({
            name: ing,
            checked: false,
            store: storeMemory[ing.toLowerCase().trim()] || '',
            tag: 'imported',
          }));
        return [...prev, ...newItems];
      });
      const name = real.length === 1 ? (real[0].name || 'Recipe') : `${real.length} recipes`;
      showToast(`Ingredients from "${name}" added to Grocery`);
      setTab('grocery');
      return;
    }

    // ── Week destination ───────────────────────────────────────────────────────
    // Saves the recipe AND places it into the first empty day of the current week.
    if (target === 'week') {
      try {
        for (const r of imported) {
          if (r.id && !r.name && !r.ingredients) continue;
          await db.meals.put(r);
        }
        await loadMeals();
        // Place first real recipe into the first empty slot
        if (real.length > 0) {
          setWeekPlan(prev => {
            const updated = [...prev];
            const firstEmpty = updated.findIndex(d => !d);
            if (firstEmpty !== -1) updated[firstEmpty] = real[0];
            return updated;
          });
        }
      } catch (err) {
        console.error('[handleImport] DB write failed (week):', err);
      }
      const name = real.length === 1 ? (real[0].name || 'Recipe') : `${real.length} recipes`;
      showToast(`"${name}" saved and added to this week`);
      setTab('week');
      return;
    }

    // ── Library destination (meals or drinks) ─────────────────────────────────
    // Ghost rows (from V2 optimistic path) arrive with an `id` already set in Dexie.
    // We use put() for everything: it upserts, so ghost rows re-save harmlessly
    // and new recipes get inserted. add() would throw ConstraintError on ghost refs.
    try {
      for (const r of imported) {
        if (r.id && !r.name && !r.ingredients) continue;
        if (target === 'drinks') { await db.drinks.put(r); }
        else { await db.meals.put(r); }
      }
    } catch (err) {
      console.error('[handleImport] DB write failed:', err);
    } finally {
      if (target === 'drinks') { await loadDrinks(); }
      else { await loadMeals(); }
    }

    if (!real.length) return;
    const count = real.length;
    const noun = target === 'drinks' ? (count === 1 ? 'drink' : 'drinks') : (count === 1 ? 'recipe' : 'recipes');
    const name = count === 1 ? (real[0].name || 'Recipe') : `${count} ${noun}`;
    showToast(`Added ${name} to ${target === 'drinks' ? 'The Bar 🍸' : 'your library'}`);
  }, [showImportFor, loadMeals, loadDrinks, showToast, setGroceryItems, setWeekPlan, setTab]);

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
      } catch { }
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
      } catch { }
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
    if (navigator.share) { navigator.share({ title: item.name, text }).catch(() => { }); }
    else { navigator.clipboard.writeText(text).then(() => alert('Recipe copied to clipboard!')).catch(() => { }); }
  }, []);


  if (loading) return <div className="loading-screen"><div className="spinner" /><p>Loading SpiceHub…</p></div>;

  return (
    <div className="app">
      <OfflineIndicator
        queuedOps={queuedOps}
        isSyncing={isSyncing}
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
              <button className="btn-icon small" onClick={handleDismissInstallBanner} aria-label="Dismiss install banner">✕</button>
            </div>
          </div>
        </div>
      )}

      <main className="main-content">
        {tab === 'home' && (
          <LandingPage
            cookingStats={cookingStats}
            weekPlan={weekPlan}
            weekHistory={weekHistory}
            meals={meals}
            drinks={drinks}
            rotationCount={rotationMeals.length}
            onNavigate={setTab}
            onGenerate={generateWeek}
            onViewDetail={setDetailItem}
            onOpenFridge={() => setShowFridge(true)}
            onOpenStats={() => setShowStats(true)}
          />
        )}
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
            onToggleLock={toggleLockDay}
            cookingStats={cookingStats}
            weekHistory={weekHistory}
            onRestoreWeek={restoreWeek}
            rotationCount={rotationMeals.length}
            showSpinner={showSpinner}
            onCloseSpinner={() => setShowSpinner(false)}
            onSpinnerComplete={handleSpinnerCompleteForDates}
            rotationMeals={rotationMeals}
            currentPlan={weekPlan}
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
            onImport={() => { setImportModalKey(k => k + 1); setShowImportFor('meals'); }}
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
            onImport={() => { setImportModalKey(k => k + 1); setShowImportFor('drinks'); }}
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
        <button className={tab === 'home' ? 'active' : ''} onClick={() => setTab('home')}>
          <span style={{ fontSize: 18 }}>🏠</span>
          <span>Home</span>
        </button>
        <button className={tab === 'week' ? 'active' : ''} onClick={() => setTab('week')}>
          <span style={{ fontSize: 18 }}>📅</span>
          <span>Plan</span>
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
          <span>Shop</span>
        </button>
      </nav>

      {/* ── Modals ── */}
      <AnimatePresence>
        {detailItem && (
          <MealDetail
            key="meal-detail"
            meal={detailItem}
            onClose={() => setDetailItem(null)}
            onShare={() => shareItem(detailItem)}
            onToggleFavorite={isDrink(detailItem) ? null : toggleFavorite}
            onToggleRotation={isDrink(detailItem) ? null : handleToggleRotation}
            onRate={isDrink(detailItem) ? null : rateMeal}
            onStartCook={isDrink(detailItem) ? null : startCookMode}
            onStartMix={isDrink(detailItem) ? startMixMode : null}
            isDrink={isDrink(detailItem)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {editMeal !== null && (
          <AddEditMeal key="edit-meal" meal={editMeal} onSave={saveMeal} onClose={() => setEditMeal(null)} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {editDrink !== null && (
          <AddEditMeal
            key="edit-drink"
            meal={editDrink}
            onSave={saveDrink}
            onClose={() => setEditDrink(null)}
            title={editDrink.id ? 'Edit Drink' : 'Add Drink'}
            placeholder="🍹"
            ingredientLabel="Ingredients"
            directionsLabel="Instructions"
          />
        )}
      </AnimatePresence>
      {/* Note: onClose() must set state to null/false to unmount — AnimatePresence then plays each modal's exit={{ y: '100%' }} slide-down before removal */}
      {showImportFor && (
        <ImportSheet
          key={importModalKey}
          onImport={handleImport}
          onClose={() => { setShowImportFor(null); setSharedContent(null); }}
          title={showImportFor === 'drinks' ? 'Import Drink' : 'Import Recipe'}
          sharedContent={sharedContent}
          initialItemType={showImportFor === 'drinks' ? 'drink' : 'meal'}
        />
      )}

      {/* ── New feature overlays ── */}
      <AnimatePresence>
        {showFridge && (
          <FridgeMode
            key="fridge-mode"
            meals={meals}
            onViewDetail={(meal) => { setShowFridge(false); setDetailItem(meal); }}
            onClose={() => setShowFridge(false)}
          />
        )}
      </AnimatePresence>
      {showBarShelf && (
        <BarShelf
          drinks={drinks}
          onViewDetail={(drink) => { setShowBarShelf(false); setDetailItem(drink); }}
          onClose={() => setShowBarShelf(false)}
          onImport={() => { setImportModalKey(k => k + 1); setShowImportFor('drinks'); }}
          onAddToGrocery={handleAddToGrocery}
        />
      )}
      <AnimatePresence>
        {showBarFridge && (
          <BarFridgeMode
            key="bar-fridge-mode"
            drinks={drinks}
            onViewDetail={(drink) => { setShowBarFridge(false); setDetailItem(drink); }}
            onClose={() => setShowBarFridge(false)}
            onAddToGrocery={handleAddToGrocery}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {cookModeMeal && (
          <CookMode
            key="cook-mode"
            meal={cookModeMeal.meal}
            scaleFactor={cookModeMeal.scaleFactor}
            onClose={finishCookMode}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {mixModeDrink && (
          <MixMode
            key="mix-mode"
            drink={mixModeDrink.drink}
            scaleFactor={mixModeDrink.scaleFactor}
            onClose={finishMixMode}
          />
        )}
      </AnimatePresence>

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
              {/* PWA Install — only shown when browser supports it or on mobile */}
              <div className="st-section st-install-section">
                <h3>App</h3>
                <button
                  className="st-install-btn"
                  onClick={() => {
                    // Reset dismissal so banner can reappear, then trigger install
                    localStorage.removeItem('pwa-install-dismissed');
                    handleInstallApp();
                  }}
                >
                  <span className="st-install-icon">📲</span>
                  <span>Add to Home Screen</span>
                </button>
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
