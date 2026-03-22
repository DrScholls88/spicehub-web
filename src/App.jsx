import { useState, useEffect, useCallback } from 'react';
import db, { seedIfEmpty, SEED_DRINKS, importPaprikaMeals, logCook, logMix } from './db';
import { PAPRIKA_MEALS } from './paprika_import_data';
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
import { ThemeSettings } from './components/ThemeProvider';
import { isMobileDevice } from './isMobile';
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
  }, [loadMeals, loadDrinks]);

  // Load store memory on startup
  useEffect(() => {
    try {
      const mem = localStorage.getItem('spicehub_store_memory');
      if (mem) window._storeMemory = JSON.parse(mem);
    } catch {}
  }, []);

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

  // Handle PWA share-target
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('share-target')) {
      const sharedUrl = params.get('url') || params.get('text') || '';
      if (sharedUrl) {
        setShowImportFor('meals');
        window.history.replaceState({}, '', '/');
      }
    }
  }, []);

  // ── Week plan ─────────────────────────────────────────────────────────────────
  const generateWeek = useCallback(() => {
    // Only pull from "Dinners" category (meals without a category default to Dinners)
    const dinners = meals.filter(m => !m.category || m.category === 'Dinners');
    const pool = dinners.length >= 5 ? dinners : meals; // Fallback to all if < 5 dinners
    if (pool.length < 5) {
      alert('Need at least 5 meals (ideally tagged as Dinners) to generate a week!');
      return;
    }
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const plan = [];
    for (let i = 0; i < 7; i++) {
      plan.push(shuffled[i % shuffled.length]);
    }
    setWeekPlan(plan);
  }, [meals]);

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
      <header className="app-header">
        <div>
          <h1>SpiceHub</h1>
          <p className="subtitle">Meal Spinner <span className="build-tag">v{__SPICEHUB_VERSION__}</span></p>
        </div>
        <div className="header-actions">
          <button className="hdr-btn" onClick={() => setShowFridge(true)} title="What's in My Fridge?">🧊</button>
          <button className="hdr-btn" onClick={() => setShowStats(true)} title="Meal Stats">📊</button>
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
          onClose={() => setShowImportFor(null)}
          title={showImportFor === 'drinks' ? 'Import Drink' : 'Import Recipe'}
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
      {showStats && (
        <MealStats
          meals={meals}
          onClose={() => setShowStats(false)}
          onViewDetail={(meal) => { setShowStats(false); setDetailItem(meal); }}
        />
      )}
      {showSettings && (
        <div className="st-overlay" onClick={() => setShowSettings(false)}>
          <div className="st-sheet" onClick={e => e.stopPropagation()}>
            <div className="st-handle" />
            <div className="st-header">
              <h2 className="st-title">⚙️ Settings</h2>
              <button className="st-close" onClick={() => setShowSettings(false)}>✕</button>
            </div>
            <ThemeSettings />
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
