import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { AnimatePresence } from 'framer-motion';
import db, { importSeedMeals, removeStarterKitMeals, logCook, logMix, saveWeekPlan, loadWeekPlan, saveGroceryList, loadGroceryList, getStoreMemory, getCookingLog, getWeekHistory, saveWeekToHistory, toggleRotation, addBatchQueueItems, getBatchQueueItems, updateBatchQueueItem, getLearnedAliases } from './db';
import { buildStarterKitMeals, STARTER_KIT_SEED_FLAG } from './data/starterKitMeals';
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
import BatchImportQueue, { BatchQueuePill } from './components/BatchImportQueue';
import DiscoverRecipes from './components/DiscoverRecipes';
import { startBatchImportEngine } from './batchImportEngine';
import { extractMultipleUrls } from './recipeParser';
import { categorizeIngredient, upgradeRecipeIngredients, setLearnedAliases } from './recipeSchema';
import { seedEntities } from './utils/ingredientEntities';
import CookMode from './components/CookMode';
import MixMode from './components/MixMode';
import FloatingVideoPlayer from './components/FloatingVideoPlayer';
import { getMealVideoSource } from './lib/videoSource';
import BarShelf from './components/BarShelf';
import RoomTransition from './components/RoomTransition';
import MealSpinner from './components/MealSpinner';
import SyncQueue from './components/SyncQueue';
import OfflineIndicator from './components/OfflineIndicator';
import { ThemeSettings } from './components/ThemeProvider';
import { isMobileDevice } from './isMobile';
import useOnlineStatus, { onOnlineStatusChange } from './hooks/useOnlineStatus';
import useBackHandler from './hooks/useBackHandler';
import useSwipeDismiss from './hooks/useSwipeDismiss';
import { planWeek, pickForSlot, buildRecencyMap } from './lib/weekPlanner';
import { renderRecipeExport, exportViaShare } from './utils/exportRenderer.js';
import { compressRecipeImage } from './imageCompressor.js';
import ConsentGate, { getStoredConsent } from './components/ConsentGate';
import AgeGate, { isAgeVerified } from './components/AgeGate';
import LegalFooter from './components/LegalFooter';
import './App.css';

// Code-split screens that aren't needed on first paint. Each is a modal/
// overlay gated behind its own boolean state, so a brief Suspense fallback
// (null — these all render as slide-up sheets/overlays, so a one-frame gap
// before the sheet appears is unnoticeable) is a safe tradeoff for keeping
// them out of the main bundle. InstagramZipImport in particular pulls in
// jszip, which has no reason to load until a user actually opens ZIP import.
const InstagramZipImport = lazy(() => import('./components/InstagramZipImport'));
// P5: PantryMode (persistent Kitchen Pantry) supersedes the old ephemeral
// FridgeMode — same entry points, same overlay slot, shared inventory store.
const PantryMode = lazy(() => import('./components/PantryMode'));
const BarFridgeMode = lazy(() => import('./components/BarFridgeMode'));
const MealStats = lazy(() => import('./components/MealStats'));
const StorageManager = lazy(() => import('./components/StorageManager'));
const ExportSheet = lazy(() => import('./components/ExportSheet'));

// A-1: household dietary preference for Smart Auto-Plan (device-local).
const DIETARY_PREF_KEY = 'spicehub_dietary_pref';
function loadDietaryPref() {
  try {
    const raw = localStorage.getItem(DIETARY_PREF_KEY);
    if (!raw) return { dietary: '', mode: 'require' };
    const p = JSON.parse(raw);
    return { dietary: p.dietary || '', mode: p.mode || 'require' };
  } catch { return { dietary: '', mode: 'require' }; }
}

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
  // A-1: household dietary preference + cached recency map for Smart Auto-Plan
  const [dietaryPref, setDietaryPref] = useState(loadDietaryPref);
  const recencyMapRef = useRef(new Map());
  const [detailItem, setDetailItem] = useState(null);   // meal or drink being viewed
  const [editMeal, setEditMeal] = useState(null);
  const [editDrink, setEditDrink] = useState(null);
  // Export sheet: { mode: 'recipe'|'grocery'|'mealPlan', data, recipes?, title? }
  const [exportSheet, setExportSheet] = useState(null);
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
  const [pipVideo, setPipVideo] = useState(null); // { source, meal } — floating PiP player
  const [showStats, setShowStats] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBarShelf, setShowBarShelf] = useState(false);
  const [showBarFridge, setShowBarFridge] = useState(false);
  // ── Room trip: animated "walk through the doorway" between My Bar & Saloon ──
  const [roomTrip, setRoomTrip] = useState(null); // 'toSaloon' | 'toMyBar' | null
  const roomTripBusy = useRef(false);
  const tripBetweenRooms = useCallback((target) => {
    if (roomTripBusy.current) return; // ignore re-taps mid-trip
    roomTripBusy.current = true;
    setRoomTrip(target);
    // Swap the underlying overlays at the veil's opaque apex so the cut is hidden.
    setTimeout(() => {
      if (target === 'toSaloon') { setShowBarFridge(false); setShowBarShelf(true); }
      else { setShowBarShelf(false); setShowBarFridge(true); }
    }, 400);
    // End the trip once the veil has receded.
    setTimeout(() => { setRoomTrip(null); roomTripBusy.current = false; }, 850);
  }, []);
  const [showDiscover, setShowDiscover] = useState(false); // Discover Recipes overlay (Landing entry point)
  const [showSpinner, setShowSpinner] = useState(false);
  const [cookingStats, setCookingStats] = useState({ streak: 0, totalCooked: 0, topMeal: null });
  const [queuedOps, setQueuedOps] = useState(0);
  const [showStorageManager, setShowStorageManager] = useState(false);
  const [storageWarning, setStorageWarning] = useState(null);
  const [sharedContent, setSharedContent] = useState(null); // { mode, url, text } from share-target
  // ── Batch import (multi-share) state ────────────────────────────────────
  const [showBatchQueue, setShowBatchQueue] = useState(false);
  const [batchQueueCount, setBatchQueueCount] = useState(0);
  const [batchReadyCount, setBatchReadyCount] = useState(0);
  const [batchReviewItem, setBatchReviewItem] = useState(null); // { item } opened in ImportSheet
  const [weekHistory, setWeekHistory] = useState([]); // past week plans
  const [isSyncing, setIsSyncing] = useState(false);

  // ── Legal: clickwrap consent gate + Bar/Saloon age gate ─────────────────
  const [consentAccepted, setConsentAccepted] = useState(() => getStoredConsent() !== null);
  const [showAgeGate, setShowAgeGate] = useState(false);
  // Wraps setTab so entering 'bar' the first time on this device is gated
  // behind the Drink Responsibly confirmation. Every other tab passes through.
  const navigateToTab = useCallback((target) => {
    if (target === 'bar' && !isAgeVerified()) {
      setShowAgeGate(true);
      return;
    }
    setTab(target);
  }, []);

  const handleBrandHome = useCallback(() => {
    setTab('home');
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      document.querySelector('.main-content')?.scrollTo?.({ top: 0, behavior: 'smooth' });
    });
  }, []);

  // ── I-1 Instagram ZIP import ──────────────────────────────────────────────
  const [showZipImport, setShowZipImport] = useState(false);

  // ── I-2 Post-share quick actions state ────────────────────────────────────
  const [postImportActions, setPostImportActions] = useState(null); // { message, recipe }
  const isShareImportRef = useRef(false); // set true when current import came from share-target

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
  useBackHandler(showDiscover, () => setShowDiscover(false), 'discover-landing');
  useBackHandler(!!cookModeMeal, () => setCookModeMeal(null), 'cook-mode');
  // Floating video PiP: mobile back / back-gesture closes the player instead of
  // navigating away from the app.
  useBackHandler(!!pipVideo, () => setPipVideo(null), 'pip-video');
  useBackHandler(!!mixModeDrink, () => setMixModeDrink(null), 'mix-mode');
  useBackHandler(showSpinner, () => setShowSpinner(false), 'spinner');
  useBackHandler(showStats, () => setShowStats(false), 'stats');
  useBackHandler(showStorageManager, () => setShowStorageManager(false), 'storage');
  useBackHandler(showSettings, () => setShowSettings(false), 'settings');
  useBackHandler(showBatchQueue, () => setShowBatchQueue(false), 'batch-queue');
  useBackHandler(!!batchReviewItem, () => setBatchReviewItem(null), 'batch-review');
  useBackHandler(showZipImport, () => setShowZipImport(false), 'zip-import');

  const showToast = useCallback((message, type = 'success', duration = 2500) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), duration);
  }, []);

  // ── I-2 Post-share quick action auto-dismiss (8s) ─────────────────────────
  useEffect(() => {
    if (!postImportActions) return;
    const t = setTimeout(() => setPostImportActions(null), 8000);
    return () => clearTimeout(t);
  }, [postImportActions]);

  // Spec D: load user-taught ingredient aliases into the resolver on startup so
  // they auto-apply everywhere (import categorization, grocery aggregation, hints).
  // Also seed first-class Food & Unit entities (v16) on first open.
  useEffect(() => {
    (async () => {
      try {
        const rows = await getLearnedAliases();
        const map = {};
        for (const r of rows) {
          if (r && r.raw && r.canonical) map[r.raw] = { canonical: r.canonical, aisle: r.aisle || 'unknown' };
        }
        setLearnedAliases(map);
      } catch { /* learned aliases are best-effort */ }
      // Seed ingredient entity tables (idempotent, skips if already populated)
      try { await seedEntities(); } catch { /* best-effort seeding */ }
    })();
  }, []);

  const handlePostAddToWeek = useCallback(() => {
    if (!postImportActions?.recipe) return;
    const recipe = postImportActions.recipe;
    setWeekPlan(prev => {
      const updated = [...prev];
      const slot = updated.findIndex(d => !d);
      if (slot !== -1) updated[slot] = recipe;
      return updated;
    });
    showToast(`"${recipe.name}" added to this week 📅`);
    setPostImportActions(null);
    setTab('week');
  }, [postImportActions, showToast]);

  const handlePostAddToGrocery = useCallback(() => {
    if (!postImportActions?.recipe) return;
    const recipe = postImportActions.recipe;
    const storeMemory = window._storeMemory || {};
    setGroceryItems(prev => {
      const existingKeys = new Set(prev.map(i => i.name.toLowerCase().trim()));
      const newItems = (recipe.ingredients || [])
        .filter(ing => ing && !existingKeys.has(ing.toLowerCase().trim()))
        .map(ing => ({
          name: ing,
          checked: false,
          store: storeMemory[ing.toLowerCase().trim()] || '',
          tag: 'imported',
        }));
      return [...prev, ...newItems];
    });
    showToast(`Ingredients added to grocery list 🛒`);
    setPostImportActions(null);
    setTab('grocery');
  }, [postImportActions, showToast]);

  // Quick import helper. The LandingPage import tray that used to call this was
  // removed (declutter). Now used by MealLibrary's Discover Recipes flow
  // (DiscoverRecipes.jsx) to hand off a selected Reddit post URL straight into
  // the standard ImportSheet review — item type (meal vs drink) is
  // auto-detected downstream by the import engine, so we open the meals sheet.
  const handleQuickImport = useCallback((url) => {
    if (!url) return;
    setImportModalKey(k => k + 1);
    setShowImportFor('meals');
    setSharedContent({ mode: 'url', url, text: '', title: '', isShare: false });
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

  // ── Starter Kit auto-seed ─────────────────────────────────────────────────
  // Brand-new install with 0 meals: pre-load the curated intro pack so Spin
  // works immediately. Once per device (localStorage flag). importSeedMeals
  // dedups by name so this never clobbers user recipes. Manual Add/Restore in
  // Settings always works even after remove.
  useEffect(() => {
    if (loading) return;
    if (meals.length > 0) return;
    if (localStorage.getItem(STARTER_KIT_SEED_FLAG)) return;
    localStorage.setItem(STARTER_KIT_SEED_FLAG, '1');

    importSeedMeals(buildStarterKitMeals())
      .then(({ imported }) => {
        if (imported > 0) {
          loadMeals();
          showToast(`Added ${imported} starter recipes to get you cooking`, 'success', 3500);
        }
      })
      .catch(err => {
        console.warn('[SpiceHub] Starter Kit seed failed (non-fatal):', err);
        localStorage.removeItem(STARTER_KIT_SEED_FLAG);
      });
  }, [loading, meals.length, loadMeals, showToast]);

  // ── Batch Import Engine bootstrap ────────────────────────────────────────
  useEffect(() => {
    startBatchImportEngine();

    const refreshBatchCount = () => {
      getBatchQueueItems().then(items => {
        const pending = items.filter(i => i.status === 'pending' || i.status === 'extracting').length;
        const ready = items.filter(i => i.status === 'ready').length;
        setBatchQueueCount(pending);
        setBatchReadyCount(ready);
      }).catch(() => {});
    };
    refreshBatchCount();

    const handleBatchComplete = (e) => {
      const { readyCount = 0, failedCount = 0 } = e.detail || {};
      let msg;
      if (readyCount > 0) {
        msg = `${readyCount} recipe${readyCount !== 1 ? 's' : ''} ready to review`;
      } else if (failedCount > 0) {
        msg = `Import finished — ${failedCount} failed`;
      } else {
        msg = 'Import complete';
      }
      showToast(msg, readyCount > 0 ? 'success' : 'info', 4000);
    };

    window.addEventListener('spicehub:batch-queue-updated', refreshBatchCount);
    window.addEventListener('spicehub:batch-import-complete', handleBatchComplete);
    return () => {
      window.removeEventListener('spicehub:batch-queue-updated', refreshBatchCount);
      window.removeEventListener('spicehub:batch-import-complete', handleBatchComplete);
    };
  }, [showToast]);

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

  // A-1 Smart auto-plan: IDs of meals used in the last 2 weeks so MealSpinner
  // can de-prioritize them without excluding them entirely (graceful fallback).
  const recentlyUsedIds = useMemo(() => {
    const ids = new Set();
    weekHistory.slice(-2).forEach(hw => {
      (hw.meals || []).forEach(m => { if (m && m.id) ids.add(m.id); });
    });
    weekPlan.forEach(m => { if (m && m.id) ids.add(m.id); });
    return ids;
  }, [weekHistory, weekPlan]);

  // A-1: warm the recency map once so single-day rerolls are recency-aware even
  // before the first "Plan my Week" tap. Refreshed again inside smartPlanWeek.
  useEffect(() => {
    let cancelled = false;
    getCookingLog()
      .then(log => { if (!cancelled) recencyMapRef.current = buildRecencyMap(log); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Persist grocery list whenever it changes
  useEffect(() => {
    if (groceryItems.length === 0) return;
    const t = setTimeout(() => saveGroceryList(groceryItems), 300);
    return () => clearTimeout(t);
  }, [groceryItems]);

  // Load store memory on startup (Dexie is canonical; migrate orphan localStorage once)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let mem = await getStoreMemory();
        if (cancelled) return;
        if (!mem || Object.keys(mem).length === 0) {
          try {
            const raw = localStorage.getItem('spicehub_store_memory');
            if (raw) mem = JSON.parse(raw) || {};
          } catch { /* ignore corrupt legacy key */ }
        }
        window._storeMemory = mem && typeof mem === 'object' ? mem : {};
      } catch {
        if (!cancelled) window._storeMemory = {};
      }
    })();
    return () => { cancelled = true; };
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

    const batchUrls = extractMultipleUrls(`${sharedUrl} ${sharedText}`);
    if (batchUrls.length >= 2) {
      addBatchQueueItems(batchUrls).then(() => {
        setShowBatchQueue(true);
        window.dispatchEvent(new CustomEvent('spicehub:batch-queue-updated'));
      });
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    const target = _looksLikeDrink(sharedUrl, sharedTitle, sharedText) ? 'drinks' : 'meals';
    if (sharedUrl) {
      // ── I-2: Offline share queue ─────────────────────────────────────────
      // If device is offline when a URL is shared, queue it for later
      // instead of silently failing inside ImportSheet.
      if (!navigator.onLine) {
        addBatchQueueItems([sharedUrl]).then(() => {
          setBatchQueueCount(c => c + 1);
          window.dispatchEvent(new CustomEvent('spicehub:batch-queue-updated'));
          setToast({ message: "Queued! We'll import this when you're back online 📥", type: 'info' });
          setTimeout(() => setToast(null), 4500);
        }).catch(() => {});
        window.history.replaceState({}, '', window.location.pathname);
        return;
      }
      // ── I-2: Mark share-target for post-save quick actions ───────────────
      isShareImportRef.current = target === 'meals';
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

    const batchUrls = extractMultipleUrls(`${detail.url || ''} ${detail.text || ''}`);
    if (batchUrls.length >= 2) {
      addBatchQueueItems(batchUrls).then(() => {
        setShowBatchQueue(true);
        window.dispatchEvent(new CustomEvent('spicehub:batch-queue-updated'));
      });
      return;
    }

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
    // Gemini UX audit (2026-07-06): a blocking browser alert() with no next
    // step was the "0 meals → can't spin" trust-breaker. Route to the Library
    // instead, where the existing empty-state CTA ("Import a Recipe") already
    // handles onboarding — no need to duplicate that flow here.
    if (meals.length < 5) {
      const remaining = 5 - meals.length;
      showToast(
        meals.length === 0
          ? 'Add a few meals to start spinning 🎲'
          : `Add ${remaining} more meal${remaining === 1 ? '' : 's'} to spin a full week`,
        'info',
        3200
      );
      navigateToTab('library');
      return;
    }
    // MealSpinner only mounts inside WeekView — always switch to Plan first so
    // Home / sticky Spin actually opens the spinner (mom-speed path).
    navigateToTab('week');
    setShowSpinner(true);
  }, [meals, showToast, navigateToTab]);

  // buildGroceryList is declared further down (Grocery section) — reference it
  // through a ref here to avoid a TDZ crash: putting the const itself in the
  // deps array below would evaluate it before initialization on every render.
  const buildGroceryListRef = useRef(null);

  const handleSpinnerCompleteForDates = useCallback(async (pairs, options = {}) => {
    // pairs = [{date: Date, meal: mealObj}] — one entry per spinner slot
    // options.buildGrocery: after apply, open Shop with list from the new plan
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
    let currentPlanApplied = null;
    for (const [, { mon, isCurrent, plan }] of weekMap) {
      if (isCurrent) {
        currentPlanApplied = plan;
        setWeekPlan(plan);
      } else {
        await saveWeekToHistory(mon.toISOString(), plan);
      }
    }

    // Refresh history so calendar reflects changes
    getWeekHistory().then(h => setWeekHistory(h));
    setShowSpinner(false);
    showToast(`${pairs.length} meal${pairs.length !== 1 ? 's' : ''} planned! 🎉`);

    // Post-spin "Build grocery list" — use the plan we just applied (state not flushed yet)
    if (options.buildGrocery && currentPlanApplied) {
      buildGroceryListRef.current?.(undefined, { plan: currentPlanApplied, merge: true });
    }
  }, [weekPlan, weekHistory, showToast]);

  const restoreWeek = useCallback((weekMeals) => {
    if (!weekMeals || weekMeals.length !== 7) return;
    setWeekPlan(weekMeals);
    showToast('Week restored!');
  }, [showToast]);

  // A-1: reroll a single day — rotation-only and score-aware (variety/recency/
  // time-fit), with jitter so repeated rerolls vary. Falls back to all meals
  // only when The Rotation is empty so the control never dead-ends.
  const respinDay = useCallback((dayIndex) => {
    const current = weekPlan[dayIndex];
    if (current && current._special) return;
    const pool = rotationMeals.length > 0 ? rotationMeals : meals;
    const pick = pickForSlot(pool, {
      slotIndex: dayIndex,
      currentPlan: weekPlan,
      recencyMap: recencyMapRef.current,
      prefs: dietaryPref,
    });
    if (!pick) { showToast('Add more meals to The Rotation to swap in 🔄'); return; }
    setWeekPlan(prev => prev.map((m, i) => i === dayIndex ? pick : m));
  }, [meals, weekPlan, rotationMeals, dietaryPref, showToast]);

  // A-1: Smart Auto-Plan — fill every empty, unlocked slot from The Rotation
  // using the local scoring engine. Locked/filled days are preserved.
  const smartPlanWeek = useCallback(async () => {
    if (rotationMeals.length === 0) {
      showToast('Add meals to The Rotation first, then plan your week 🔄');
      return;
    }
    let recencyMap = recencyMapRef.current;
    try {
      const log = await getCookingLog();
      recencyMap = buildRecencyMap(log);
      recencyMapRef.current = recencyMap;
    } catch { /* use cached/empty recency — still works offline */ }
    const planned = planWeek(rotationMeals, {
      currentPlan: weekPlan,
      recencyMap,
      prefs: dietaryPref,
    });
    const filled = planned.filter(Boolean).length;
    setWeekPlan(planned);
    if (filled < 7) {
      showToast(`Planned ${filled} day${filled === 1 ? '' : 's'} — add more to The Rotation to fill the week ✨`);
    } else {
      showToast('Week planned ✨');
    }
  }, [rotationMeals, weekPlan, dietaryPref, showToast]);

  const updateDietaryPref = useCallback((pref) => {
    const next = { dietary: pref?.dietary || '', mode: pref?.mode || 'require' };
    setDietaryPref(next);
    try { localStorage.setItem(DIETARY_PREF_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

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

  /** Protect all planned (non-special) days from re-spin — one tap instead of 14. */
  const lockAllPlanned = useCallback(() => {
    setWeekPlan(prev => {
      const next = prev.map(m => (m && !m._special ? { ...m, _locked: true } : m));
      const n = next.filter(m => m && m._locked).length;
      if (n > 0) showToast(`Protected ${n} meal${n === 1 ? '' : 's'} from re-spin`, 'success');
      else showToast('No meals to protect — spin a week first', 'info');
      return next;
    });
  }, [showToast]);

  const unlockAllPlanned = useCallback(() => {
    setWeekPlan(prev => prev.map(m => (m && !m._special ? { ...m, _locked: false } : m)));
    showToast('All days unlocked', 'info');
  }, [showToast]);

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
    mealData = await compressRecipeImage(mealData);
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

  const handleRemoveStarterKit = useCallback(async () => {
    const removed = await removeStarterKitMeals();
    await loadMeals();
    showToast(
      removed > 0 ? `Removed ${removed} starter recipe${removed === 1 ? '' : 's'}` : 'No starter recipes to remove',
      removed > 0 ? 'success' : 'info'
    );
  }, [loadMeals, showToast]);

  /** Manual add/restore — name-dedupe; always allowed (independent of auto-seed flag). */
  const handleAddStarterKit = useCallback(async () => {
    try {
      const { imported, skipped } = await importSeedMeals(buildStarterKitMeals());
      localStorage.setItem(STARTER_KIT_SEED_FLAG, '1');
      await loadMeals();
      if (imported > 0) {
        const skipNote = skipped > 0 ? ` (${skipped} already in library)` : '';
        showToast(`Added ${imported} starter recipe${imported === 1 ? '' : 's'}${skipNote}`, 'success');
      } else {
        showToast(
          skipped > 0 ? 'Starter pack already in your library' : 'No starter recipes to add',
          'info',
        );
      }
    } catch (err) {
      console.warn('[SpiceHub] Starter Kit add failed:', err);
      showToast('Could not add starter recipes — try again', 'error');
    }
  }, [loadMeals, showToast]);

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
    drinkData = await compressRecipeImage(drinkData);
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
  // dayIndices: optional DOW indices. options.plan: override weekPlan (post-spin).
  // options.merge (default true): keep checked/store for matching names on rebuild.
  const buildGroceryList = useCallback((dayIndices, options = {}) => {
    const planSource = Array.isArray(options.plan) ? options.plan : weekPlan;
    const merge = options.merge !== false;
    const items = {};
    const storeMemory = window._storeMemory || {};
    const plansToUse = dayIndices
      ? dayIndices.map(i => planSource[i]).filter(Boolean)
      : planSource;
    plansToUse.forEach(meal => {
      if (!meal || meal._special) return;

      // Spec A: prefer the structured ingredient array (source of truth).
      const structured = (Array.isArray(meal.ingredientsStructured) && meal.ingredientsStructured.length)
        ? meal.ingredientsStructured
        : (upgradeRecipeIngredients(meal).ingredientsStructured || []);

      if (structured.length) {
        structured.forEach(si => {
          if (!si) return;
          const base = (si.original_text || si.display || si.name || '').trim();
          if (!base) return;
          const sec = (si.section || '').trim();
          const name = sec ? `${base} (${sec})` : base;
          const key = name.toLowerCase().trim();
          if (!items[key]) {
            const rememberedStore = storeMemory[key] || '';
            const category = si.category || categorizeIngredient(si.name || name);
            items[key] = { name, checked: false, store: rememberedStore, category, _struct: si };
          }
        });
        return;
      }

      const metaMap = {};
      (meal._ingredientMeta || []).forEach(m => {
        if (m && m.text && m.category) metaMap[m.text.toLowerCase().trim()] = m.category;
      });
      (meal.ingredients || []).forEach(ing => {
        const key = ing.toLowerCase().trim();
        if (!items[key]) {
          const rememberedStore = storeMemory[key] || '';
          const category = metaMap[key] || categorizeIngredient(ing);
          items[key] = { name: ing, checked: false, store: rememberedStore, category };
        }
      });
    });

    let next = Object.values(items);
    if (merge && groceryItems.length > 0) {
      const prevByKey = new Map(
        groceryItems.map(i => [String(i.name || '').toLowerCase().trim(), i]),
      );
      next = next.map(item => {
        const prev = prevByKey.get(item.name.toLowerCase().trim());
        if (!prev) return item;
        return {
          ...item,
          checked: !!prev.checked,
          store: item.store || prev.store || '',
          category: item.category || prev.category || '',
        };
      });
    }

    setGroceryItems(next);
    setTab('grocery');
  }, [weekPlan, groceryItems]);

  // Keep the early-declared ref pointing at the latest buildGroceryList
  // (see handleSpinnerCompleteForDates — avoids use-before-init in deps).
  useEffect(() => { buildGroceryListRef.current = buildGroceryList; }, [buildGroceryList]);

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

  // ── Batch import: open a 'ready' row directly into ImportSheet review ─────
  const handleBatchReview = useCallback((item) => {
    setBatchReviewItem(item);
  }, []);

  // ── Batch import: open a 'failed' row into ImportSheet for retry ──────────
  const handleBatchRetry = useCallback((item) => {
    setImportModalKey(k => k + 1);
    setShowImportFor(item.itemType === 'drink' ? 'drinks' : 'meals');
    setSharedContent({ mode: 'url', url: item.url, title: '', text: '', isShare: true });
  }, []);

  // ── Import handler — routes to meals, drinks, grocery, or week ──────────────
  // destination overrides showImportFor and is set by the Smart Action Bar
  // in ImportModal when the user taps "→ Bar", "→ Grocery", or "→ This Week".
  const handleImport = useCallback(async (imported, destination) => {
    // ── I-2: Capture and reset share-target flag before any state clears ────
    const wasShareMeal = isShareImportRef.current;
    isShareImportRef.current = false;

    const target = destination || showImportFor;
    setShowImportFor(null);
    setSharedContent(null);

    // Compress any large data: URL recipe images before they ever hit Dexie.
    // No-op for recipes without a data: imageUrl or already-small ones — see
    // compressRecipeImage in imageCompressor.js for why this only touches
    // data: URLs (never triggers a fresh network fetch of a remote image).
    imported = await Promise.all(imported.map((r) => compressRecipeImage(r)));

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

    // ── I-2: Post-save quick actions for single-recipe share-target imports ──
    // Show an 8-second action strip with "Add to week" / "Add to grocery" instead
    // of the plain toast, so the clip→plan loop requires zero extra steps.
    if (wasShareMeal && target === 'meals' && real.length === 1) {
      setPostImportActions({ message: `"${name}" saved`, recipe: real[0] });
      return;
    }

    showToast(`Added ${name} to ${target === 'drinks' ? 'The Bar 🍸' : 'your library'}`);
  }, [showImportFor, loadMeals, loadDrinks, showToast, setGroceryItems, setWeekPlan, setTab, setPostImportActions]);

  // ── Batch import: mark a batchQueue row 'saved' after ImportSheet save ────
  const handleBatchReviewSave = useCallback(async (imported, destination) => {
    const item = batchReviewItem;
    setBatchReviewItem(null);
    await handleImport(imported, destination);
    if (item) {
      await updateBatchQueueItem(item.id, { status: 'saved' });
      window.dispatchEvent(new CustomEvent('spicehub:batch-queue-updated'));
    }
  }, [batchReviewItem, handleImport]);

  // ── Cook Mode ────────────────────────────────────────────────────────────────
  const startCookMode = useCallback((meal, scaleFactor = 1.0) => {
    setCookModeMeal({ meal, scaleFactor });
  }, []);

  // ── Floating PiP video player ────────────────────────────────────────────────
  const openPipForMeal = useCallback((meal) => {
    const source = getMealVideoSource(meal);
    if (!source) {
      showToast('No playable video found for this recipe');
      return;
    }
    setPipVideo({ source, meal });
  }, [showToast]);

  const closePip = useCallback(() => setPipVideo(null), []);

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

  // ── Share / Export ──────────────────────────────────────────────────────────
  // Quick share: uses the template renderer for clean text, then navigator.share
  const shareItem = useCallback((item) => {
    const text = renderRecipeExport(item, { format: 'text' });
    exportViaShare(item.name, text);
  }, []);

  // Full export sheet: opens the ExportSheet bottom-sheet with format picker
  const openExportSheet = useCallback((mode, data, opts = {}) => {
    setExportSheet({ mode, data, recipes: opts.recipes, title: opts.title });
  }, []);


  if (loading) return <div className="loading-screen"><div className="spinner" /><p>Loading SpiceHub…</p></div>;

  // Hard clickwrap gate — nothing else renders until the current
  // LEGAL_VERSION has been accepted on this device (see ConsentGate.jsx).
  if (!consentAccepted) {
    return <ConsentGate onAccept={() => setConsentAccepted(true)} />;
  }

  return (
    <div className="app">
      <OfflineIndicator
        queuedOps={queuedOps}
        isSyncing={isSyncing}
      />

      <header className="app-header">
        <div className="app-brand-wrap">
          <h1 className="app-brand-title">
            <button
              type="button"
              className="app-brand"
              onClick={handleBrandHome}
              aria-label="Go to SpiceHub landing page"
              aria-current={tab === 'home' ? 'page' : undefined}
            >
              <span className="app-brand-mark" aria-hidden="true">🌶️</span>
              <span className="app-brand-name">SpiceHub</span>
            </button>
          </h1>
          <button
            type="button"
            className="app-build-badge"
            title={`SpiceHub v${__SPICEHUB_VERSION__} · build #${__SPICEHUB_BUILD__}`}
            aria-label={`Build ${__SPICEHUB_BUILD__}, version ${__SPICEHUB_VERSION__}. Open settings.`}
            onClick={() => setShowSettings(true)}
          >
            #{__SPICEHUB_BUILD__}
          </button>
        </div>
        <div className="header-actions">
          <button className="hdr-btn" onClick={() => setShowFridge(true)} title="The Pantry — what can I cook?" aria-label="Open the pantry">🧺</button>
          <button className="hdr-btn" onClick={() => setShowStats(true)} title="Meal Stats" aria-label="Meal stats">📊</button>
          {/* I-1: Instagram saved-posts bulk import */}
          <button className="hdr-btn" onClick={() => setShowZipImport(true)} title="Import Instagram saved posts (ZIP)" aria-label="Import Instagram saved posts">📦</button>
          <button className="hdr-btn" onClick={() => setShowStorageManager(true)} title="Storage" aria-label="Storage manager">💾</button>
          <button className="hdr-btn" onClick={() => setShowSettings(true)} title="Settings" aria-label="Settings">⚙️</button>
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

      {/* ── I-1 Instagram ZIP import modal ── */}
      {showZipImport && (
        <div className="igzip-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setShowZipImport(false); }}>
          <div className="igzip-modal" role="dialog" aria-modal="true" aria-label="Import Instagram saved posts">
            <div className="igzip-modal-header">
              <h2 className="igzip-modal-title">Import Instagram Saved Posts</h2>
              <button
                className="igzip-modal-close"
                onClick={() => setShowZipImport(false)}
                aria-label="Close"
              >✕</button>
            </div>
            <Suspense fallback={null}>
              <InstagramZipImport
                onDone={() => { setShowZipImport(false); setShowBatchQueue(true); }}
                onToast={showToast}
              />
            </Suspense>
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
            onNavigate={navigateToTab}
            onGenerate={generateWeek}
            onViewDetail={setDetailItem}
            onOpenFridge={() => setShowFridge(true)}
            onOpenStats={() => setShowStats(true)}
            onOpenDiscover={() => setShowDiscover(true)}
            canInstall={!!deferredPrompt}
            onInstallApp={handleInstallApp}
          />
        )}
        {tab === 'home' && <LegalFooter />}
        {tab === 'week' && (
          <WeekView
            days={DAYS}
            weekPlan={weekPlan}
            meals={meals}
            specialDays={SPECIAL_DAYS}
            onGenerate={generateWeek}
            onSmartPlan={smartPlanWeek}
            dietaryPref={dietaryPref}
            onChangeDietaryPref={updateDietaryPref}
            onRespin={respinDay}
            onSetDay={setDayMeal}
            onSetSpecial={setDaySpecial}
            onViewDetail={setDetailItem}
            onBuildGrocery={buildGroceryList}
            onToggleLock={toggleLockDay}
            onLockAll={lockAllPlanned}
            onUnlockAll={unlockAllPlanned}
            cookingStats={cookingStats}
            weekHistory={weekHistory}
            onRestoreWeek={restoreWeek}
            rotationCount={rotationMeals.length}
            showSpinner={showSpinner}
            onCloseSpinner={() => setShowSpinner(false)}
            onSpinnerComplete={handleSpinnerCompleteForDates}
            rotationMeals={rotationMeals}
            currentPlan={weekPlan}
            recentlyUsedIds={recentlyUsedIds}
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
            onExport={(item) => openExportSheet('recipe', item)}
            onImport={() => { setImportModalKey(k => k + 1); setShowImportFor('meals'); }}
            onImportUrl={handleQuickImport}
            onReload={loadMeals}
            onToast={showToast}
            onToggleFavorite={toggleFavorite}
            onRate={rateMeal}
            onPlayVideo={openPipForMeal}
            onLoadStarterPack={handleAddStarterKit}
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
            onPlayVideo={openPipForMeal}
          />
        )}
        {tab === 'grocery' && (
          <GroceryList
            items={groceryItems}
            setItems={setGroceryItems}
            weekPlan={weekPlan}
            onRebuild={buildGroceryList}
            onToast={showToast}
            onExport={(items) => openExportSheet('grocery', items)}
          />
        )}
      </main>

      {/* ── Bottom Tab Bar (mobile-first) ── */}
      <nav className="tab-bar">
        <button className={tab === 'home' ? 'active' : ''} onClick={() => setTab('home')} aria-current={tab === 'home' ? 'page' : undefined}>
          <span style={{ fontSize: 18 }}>🏠</span>
          <span>Home</span>
        </button>
        <button className={tab === 'week' ? 'active' : ''} onClick={() => setTab('week')} aria-current={tab === 'week' ? 'page' : undefined}>
          <span style={{ fontSize: 18 }}>📅</span>
          <span>Plan</span>
        </button>
        <button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')} aria-current={tab === 'library' ? 'page' : undefined}>
          <span style={{ fontSize: 18 }}>🍳</span>
          <span>Meals</span>
        </button>
        <button className={tab === 'bar' ? 'active bar-tab' : 'bar-tab'} onClick={() => navigateToTab('bar')} aria-current={tab === 'bar' ? 'page' : undefined}>
          <span style={{ fontSize: 18 }}>🍹</span>
          <span>Bar</span>
        </button>
        <button className={tab === 'grocery' ? 'active' : ''} onClick={() => { setTab('grocery'); if (groceryItems.length === 0 && weekPlan.some(Boolean)) buildGroceryList(); }} aria-current={tab === 'grocery' ? 'page' : undefined}>
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
            onExport={() => openExportSheet('recipe', detailItem)}
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
      {exportSheet && (
        <Suspense fallback={null}>
          <ExportSheet
            mode={exportSheet.mode}
            data={exportSheet.data}
            recipes={exportSheet.recipes}
            title={exportSheet.title}
            onClose={() => setExportSheet(null)}
          />
        </Suspense>
      )}
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
          <Suspense fallback={null}>
            <PantryMode
              key="pantry-mode"
              meals={meals}
              onViewDetail={(meal) => { setShowFridge(false); setDetailItem(meal); }}
              onClose={() => setShowFridge(false)}
              onAddToGrocery={handleAddToGrocery}
            />
          </Suspense>
        )}
      </AnimatePresence>
      {showBarShelf && (
        <BarShelf
          drinks={drinks}
          onViewDetail={(drink) => { setShowBarShelf(false); setDetailItem(drink); }}
          onClose={() => setShowBarShelf(false)}
          onImport={() => { setImportModalKey(k => k + 1); setShowImportFor('drinks'); }}
          onAddToGrocery={handleAddToGrocery}
          onExitToMyBar={() => tripBetweenRooms('toMyBar')}
          onOpenPantry={() => { setShowBarShelf(false); setShowFridge(true); }}
        />
      )}
      <AnimatePresence>
        {showBarFridge && (
          <Suspense fallback={null}>
            <BarFridgeMode
              key="bar-fridge-mode"
              drinks={drinks}
              onViewDetail={(drink) => { setShowBarFridge(false); setDetailItem(drink); }}
              onClose={() => setShowBarFridge(false)}
              onAddToGrocery={handleAddToGrocery}
              onOpenSaloon={() => tripBetweenRooms('toSaloon')}
            />
          </Suspense>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {roomTrip && <RoomTransition key="room-trip" trip={roomTrip} />}
      </AnimatePresence>
      {/* ── Discover Recipes (Reddit browse-and-import) — Landing entry point ── */}
      <AnimatePresence>
        {showDiscover && (
          <DiscoverRecipes
            key="discover-recipes-landing"
            onClose={() => setShowDiscover(false)}
            onSelectUrl={(url) => {
              setShowDiscover(false);
              handleQuickImport(url);
            }}
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
            onPlayVideo={openPipForMeal}
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
        <Suspense fallback={null}>
          <MealStats
            meals={meals}
            onClose={() => setShowStats(false)}
            onViewDetail={(meal) => { setShowStats(false); setDetailItem(meal); }}
          />
        </Suspense>
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
            <Suspense fallback={null}>
              <StorageManager
                onClose={() => setShowStorageManager(false)}
                onToast={showToast}
              />
            </Suspense>
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
              <div className="st-section">
                <h3>Starter Kit</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-light)', margin: '0 0 10px' }}>
                  {meals.some(m => m.starterKit)
                    ? `${meals.filter(m => m.starterKit).length} starter recipe${meals.filter(m => m.starterKit).length === 1 ? '' : 's'} in your library — a curated pack to try Spin and grocery.`
                    : 'Load a curated pack of cookable recipes so Spin and grocery work out of the box.'}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button className="st-install-btn" type="button" onClick={handleAddStarterKit}>
                    <span className="st-install-icon">🍳</span>
                    <span>{meals.some(m => m.starterKit) ? 'Restore Missing Starter Recipes' : 'Add Starter Pack'}</span>
                  </button>
                  {meals.some(m => m.starterKit) && (
                    <button className="st-install-btn" type="button" onClick={handleRemoveStarterKit}>
                      <span className="st-install-icon">🧹</span>
                      <span>Remove Starter Kit Recipes</span>
                    </button>
                  )}
                </div>
              </div>
              <div className="st-section">
                <h3>Legal</h3>
                <LegalFooter />
              </div>
              <div className="st-version-footer">
                SpiceHub Meal Spinner · v{__SPICEHUB_VERSION__}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Drink Responsibly age gate — blocks first entry to Bar/Saloon ── */}
      {showAgeGate && (
        <AgeGate
          onConfirm={() => { setShowAgeGate(false); setTab('bar'); }}
          onCancel={() => setShowAgeGate(false)}
        />
      )}

      {/* ── Batch Import Queue ── */}
      {showBatchQueue && (
        <BatchImportQueue
          onReview={(item) => {
            setShowBatchQueue(false);
            setBatchReviewItem(item);
            setShowImportFor('meals');
          }}
          onRetry={(item) => {
            addBatchQueueItems([item.url]).then(() => {
              window.dispatchEvent(new CustomEvent('spicehub:batch-queue-updated'));
            });
          }}
          onClose={() => setShowBatchQueue(false)}
        />
      )}

      {/* BatchQueuePill — floating re-entry when queue is running but panel is closed */}
      {!showBatchQueue && (batchQueueCount > 0 || batchReadyCount > 0) && (
        <BatchQueuePill
          pendingCount={batchQueueCount}
          readyCount={batchReadyCount}
          onClick={() => setShowBatchQueue(true)}
        />
      )}

      {/* SyncQueue — background sync status indicator */}
      {isSyncing && <SyncQueue />}

      {/* ── I-2 Post-share quick actions strip ── */}
      {postImportActions && (
        <div className="post-import-actions">
          <p className="pia-message">{postImportActions.message}</p>
          <div className="pia-btns">
            <button className="pia-btn" onClick={handlePostAddToWeek}>
              📅 Add to this week
            </button>
            <button className="pia-btn" onClick={handlePostAddToGrocery}>
              🛒 Add to grocery
            </button>
            <button className="pia-close" onClick={() => setPostImportActions(null)} aria-label="Dismiss">✕</button>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <span>{toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : 'ℹ️'}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* ── Floating Picture-in-Picture video player (persists across views) ── */}
      <AnimatePresence>
        {pipVideo && (
          <FloatingVideoPlayer
            key="pip-player"
            source={pipVideo.source}
            meal={pipVideo.meal}
            isOnline={isOnline}
            onClose={closePip}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
