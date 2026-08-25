import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Martini, Heart, Grid2x2, Grid3x3, List, Tag, Plus, Pencil, Check, Trash2 } from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import db from '../db';
import {
  getBarInventory, clearInstagramCache,
  getUserTags, addUserTag, deleteUserTag, renameUserTag, reorderUserTags,
  setDrinkTags, bulkSetDrinkTags,
} from '../db';
import SafeMediaImage from './SafeMediaImage';
import ReExtractSheet from './ReExtractSheet';
import useBackHandler from '../hooks/useBackHandler';
import useSwipeDismiss from '../hooks/useSwipeDismiss';
import { hapticLight } from '../haptics';
import { getMealVideoSource } from '../lib/videoSource';
import { RefreshCw } from 'lucide-react';
import SquigglyText from './SquigglyText';
import SharePickerSheet from './SharePickerSheet';
import SharedWithYouSection from './SharedWithYouSection';
import { isFriendsEnabled } from '../lib/supabaseClient';
import { matchDrink, categorizeBottle } from '../lib/barMatch';
import { getOneAwayDrinks, buildShoppingList, exportShoppingListText } from '../lib/barShopping';
import { getStrengthTier } from '../lib/abvCalculator';
import canonData from '../data/bar/barCanon.json';

// Extracted from App.css 2026-08-24 (see the header in that file for the
// move rules). MUST stay the first stylesheet imported here: these rules
// used to live in App.css, which loads ahead of every component sheet, and
// importing it first is what preserves that order for equal-specificity ties.
import '../styles/screens/BarLibrary.css';
// BarLibrary reuses three MealLibrary classes (.ml-filter-btn, .ml-grid-layout,
// .ml-grid-toggle) for its shared list controls, so it needs that sheet too.
// Vite hoists the shared stylesheet into one chunk — it is not duplicated.
import '../styles/screens/MealLibrary.css';

// ── Assignable drink categories ──────────────────────────────────────────────
const DRINK_CATEGORY_OPTIONS = [
  'Cocktail', 'Mocktail', 'Beer & Wine', 'Spirits', 'Shots', 'Non-Alcoholic',
];
export const BAR_CATEGORIES = ['All', ...DRINK_CATEGORY_OPTIONS];

// I-5 (parity with Meal Library): a drink is "improvable" when it was imported
// with a low-confidence / needs-review flag AND we kept its source caption (so we
// can re-run extraction on the cached text — no re-scrape). Same predicate as
// MealLibrary.isImprovable so the badge fires on identical signals.
function isImprovable(drink) {
  if (!drink || drink.status === 'processing' || drink.status === 'failed') return false;
  const hasCaption = typeof drink.sourceCaption === 'string' && drink.sourceCaption.trim().length > 20;
  if (!hasCaption) return false;
  return drink.needsReview === true
    || (typeof drink.confidence === 'number' && drink.confidence < 0.75)
    || (typeof drink._postProcessAudit?.movedCount === 'number' && drink._postProcessAudit.movedCount > 2);
}

// Friendly engine label from `drink._structuredVia` (read-only; null when absent)
function drinkEngineLabel(structuredVia) {
  if (!structuredVia || typeof structuredVia !== 'string') return null;
  const v = structuredVia.toLowerCase();
  if (v.startsWith('grok')) return 'Grok';
  if (v.startsWith('gemini')) return 'Gemini';
  if (v.startsWith('server')) return 'Server';
  if (v.startsWith('heuristic')) return 'Basic parser';
  return null;
}

// Speed-dial action reveal: rise + fade, staggered from the main FAB
// (mirrors MealLibrary's fabActionVariants)
const fabActionVariants = {
  closed: { opacity: 0, y: 14, scale: 0.9, transition: { duration: 0.12 } },
  open: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 420, damping: 26 } },
};

// ── Rarity system ────────────────────────────────────────────────────────────
// Phase 2.4 (bar-library-parity-plan-2026-08-07.md §2.4): ingredient count was
// the wrong metric — a Long Island Iced Tea scored legendary, a Martini
// scored common; it measured "how long is the list", not anything real.
// Rarity now answers "can I make this, and is it special?":
//   canon (brass) — matches the classics list (barCanon.json), independent
//                   of inventory.
//   rare  (copper)— missing a spirit/modifier the USER doesn't stock right
//                   now. Personal, not static: re-evaluated against whatever
//                   inventory is passed in, via the real barMatch matcher
//                   (not the old bidirectional-substring one). A missing
//                   mixer (soda water etc.) does NOT trigger this — running
//                   out of club soda shouldn't make a drink read as rare.
//   house (green) — everything else: you already have what it needs.
const CANON_NAMES = (canonData && canonData.canon) || [];
const NON_KEY_CATEGORIES = new Set(['soda']); // plain mixers, not spirits/modifiers

function isCanonDrink(drink) {
  const name = (drink.name || '').toLowerCase();
  return CANON_NAMES.some(n => name.includes(n));
}

function getDrinkRarity(drink, inventory) {
  if (isCanonDrink(drink)) return 'canon';
  const ingredients = drink.ingredients;
  if (Array.isArray(inventory) && inventory.length > 0 && Array.isArray(ingredients) && ingredients.length > 0) {
    const m = matchDrink(drink, inventory);
    const missesKeyIngredient = m.missing.some((ing) => {
      const cat = categorizeBottle(ing);
      return cat && !NON_KEY_CATEGORIES.has(cat);
    });
    if (missesKeyIngredient) return 'rare';
  }
  return 'house';
}

function getRarityColor(rarity) {
  if (rarity === 'canon') return 'var(--bar-accent, #ffd700)';
  if (rarity === 'rare') return 'var(--bar-accent-dim, #42a5f5)';
  return null;
}

// ── Base-spirit grouping (Phase 3.4.4) ──────────────────────────────────────
// Plan: "Collapsible sections — group by base spirit rather than category.
// More useful than the assignable category chips for a bar." Only the six
// true base spirits count as a "base" — vermouth/liqueur/bitters/soda are
// modifiers, not what defines a drink's shelf, so grouping by them would
// just scatter every Negroni-family drink across three sections.
const BASE_SPIRIT_CATEGORIES = ['whiskey', 'rum', 'gin', 'vodka', 'tequila', 'brandy'];
const SPIRIT_SECTION_LABELS = {
  whiskey: 'Whiskey', rum: 'Rum', gin: 'Gin', vodka: 'Vodka',
  tequila: 'Tequila', brandy: 'Brandy',
};
const SPIRIT_SECTION_ORDER = [...BASE_SPIRIT_CATEGORIES, 'Other'];

// Returns the display label for a drink's base spirit, or 'Other' for
// mocktails / beer & wine / anything with no recognized base spirit.
function getDrinkBaseSpirit(drink) {
  const ingredients = Array.isArray(drink?.ingredients) ? drink.ingredients : [];
  for (const ing of ingredients) {
    const cat = categorizeBottle(ing);
    if (cat && BASE_SPIRIT_CATEGORIES.includes(cat)) return SPIRIT_SECTION_LABELS[cat];
  }
  return 'Other';
}

function getRarityLabel(rarity) {
  if (rarity === 'canon') return '★';
  if (rarity === 'rare') return '◆';
  return '';
}

// Phase 3.3 — same labels MealDetail.jsx already uses, kept as a small local
// copy (matches that file's own pattern) rather than a shared export, per the
// plan's "resist rewriting abvCalculator" guardrail — this only reads it.
const STRENGTH_LABELS = {
  virgin: 'Zero-proof',
  light: 'Light',
  medium: 'Medium',
  strong: 'Strong',
  'very strong': 'Very strong',
  unknown: '',
};

// ── Ingredient matching (inventory-powered) ───────────────────────────────────
// Phase 3.1 (bar-library-parity-plan-2026-08-07.md §3.1): this used to be a
// bidirectional substring matcher — "ice" matched inside "juice", every count
// in the library was wrong. barMatch.matchDrink() is the real, tested,
// alias/category/derivable-aware matcher already powering BarFridgeMode and
// PantryMode; this is a thin adapter so every existing call site here
// (ms.matched/total/missing/pct) keeps working unchanged. `missing` stays a
// hard-missing count (derivable ingredients — e.g. ice from the freezer —
// don't count against "can I make this"); `pct` blends matched + half-credit
// for derivable, matching matchDrink's own scoring so the progress bar and
// the "ready to pour" state agree with each other.
function matchScore(drink, inventory) {
  if (!drink.ingredients?.length || !inventory.length) {
    return { matched: 0, total: 0, missing: 0, derivable: 0, pct: 0, tier: 'reach' };
  }
  const m = matchDrink(drink, inventory);
  if (m.total === 0) return { matched: 0, total: 0, missing: 0, derivable: 0, pct: 0, tier: 'reach' };
  const pct = Math.round(((m.matchedCount + 0.5 * m.derivable.length) / m.total) * 100);
  return {
    matched: m.matchedCount,
    total: m.total,
    missing: m.missing.length,
    derivable: m.derivable.length,
    pct: Math.min(100, pct),
    tier: m.tier, // 'ready' | 'almost' | 'reach'
  };
}

// Phase 3.2: navigator.share works well on iOS and is arguably better there
// than Android (per plan §Phase 4 iOS notes — handleBackup already uses the
// canShare({files}) shape correctly). Plain-text share/clipboard fallback,
// same pattern GroceryList.jsx's sendToKeep already uses for its own export.
function shareText(title, text, onToast) {
  if (navigator.share) {
    navigator.share({ title, text }).catch(() => {});
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    onToast?.('Shopping list copied to clipboard', 'success');
  }).catch(() => {
    onToast?.('Could not copy shopping list', 'error');
  });
}

// ── Date formatter ────────────────────────────────────────────────────────────
function formatAddedDate(isoString) {
  if (!isoString) return null;
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return null;
    const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (diffDays < 1)   return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7)   return diffDays + 'd ago';
    const month = d.toLocaleString('default', { month: 'short' });
    const day   = d.getDate();
    const year  = d.getFullYear();
    return year === new Date().getFullYear() ? month + ' ' + day : month + ' ' + day + ', ' + year;
  } catch { return null; }
}

function DrinkImage({ src, alt, className, phClass }) {
  if (!src) return <div className={phClass}>&#127865;</div>;
  return (
    <SafeMediaImage
      src={src}
      alt={alt || ''}
      className={className}
      fallbackEmoji="&#127865;"
      style={null}
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function BarLibrary({
  drinks, onAdd, onEdit, onDelete, onViewDetail, onShare,
  onImport, onReload, onToast, onOpenShelf, onOpenBarFridge, onPlayVideo,
  onMoveToMeals, onToggleFavorite, onAddMissingToGrocery,
}) {
  const [search, setSearch]                   = useState('');
  const [category, setCategory]               = useState('All');
  const [quickFilter, setQuickFilter]         = useState('all');
  const [barInventory, setBarInventory]       = useState([]);
  const [selectMode, setSelectMode]           = useState(false);
  const [selectedIds, setSelectedIds]         = useState(new Set());
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [quickPreview, setQuickPreview]       = useState(null);
  const [confirmDelete, setConfirmDelete]     = useState(null);
  const [showMenu, setShowMenu]               = useState(false);
  const [menuAnimation, setMenuAnimation]     = useState(false);
  const [fabOpen, setFabOpen]                 = useState(false); // speed-dial: + expands to add/import
  const [reExtractDrink, setReExtractDrink]   = useState(null);  // I-5: drink being re-extracted
  const [reimportingPhotoId, setReimportingPhotoId] = useState(null); // parity w/ Meal Library's Find Photo
  const [friendShareDrink, setFriendShareDrink] = useState(null); // drink for SharePickerSheet
  const [showShoppingList, setShowShoppingList] = useState(false); // Phase 3.2
  // Phase 3.4.4-5: grid density + collapsible base-spirit sections.
  // Default '3x' preserves the exact look Phase 2.3 shipped (bottles are
  // tall/narrow, 3-up is the tuned default) — the toggle only changes things
  // if the user reaches for it, mirroring MealLibrary's 'ml-grid-layout' key.
  const [gridLayout, setGridLayout] = useState(() => {
    try { return localStorage.getItem('bl-grid-layout') || '3x'; } catch { return '3x'; }
  });
  const [collapsedSections, setCollapsedSections] = useState({}); // { spiritLabel: true }

  // Phase 3.4.1: tag system (domain-scoped 'drink' — see db.js v28 migration).
  const [drinkTags, setDrinkTagsList]       = useState([]);
  const [activeTags, setActiveTags]         = useState([]); // active tag names for filtering
  const [showTagManager, setShowTagManager] = useState(false);
  const [showBulkTagPicker, setShowBulkTagPicker] = useState(false);
  const [newTagName, setNewTagName]         = useState('');
  const [editingTagId, setEditingTagId]     = useState(null);
  const [editingTagName, setEditingTagName] = useState('');
  const [tagEditMode, setTagEditMode]       = useState(false);
  const tagLongPressTimer = useRef(null);
  const tagTouchStartPos  = useRef(null);

  // Phase 3.4.2: Filters(n) sheet — bar dimensions (base spirit / strength /
  // method / zero-proof) instead of MealLibrary's time/diet/cuisine, all
  // computable from data already on the drink (plan §3.4 item 2).
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  const [filterSpirit, setFilterSpirit]       = useState([]); // subset of BASE_SPIRIT_CATEGORIES
  const [filterStrength, setFilterStrength]   = useState(null); // null | 'light'|'medium'|'strong'|'very strong'
  const [filterMethod, setFilterMethod]       = useState([]); // subset of lowercased drink.method values
  const [filterZeroProof, setFilterZeroProof] = useState(false);

  const longPressTimer    = useRef(null);
  const touchStartPos     = useRef(null);
  const restoreRef        = useRef(null);

  useEffect(() => { getBarInventory().then(setBarInventory); }, []);

  // ── Load drink tags from DB (domain: 'drink') ─────────────────────────────
  const refreshTags = useCallback(async () => {
    const tags = await getUserTags('drink');
    setDrinkTagsList(tags);
  }, []);
  useEffect(() => { refreshTags(); }, [refreshTags]);
  useEffect(() => { refreshTags(); }, [drinks, refreshTags]);

  // ── Phase 3.2: "One Bottle Away" — the flagship differentiator (§3.2/4.1
  // of the plan). getOneAwayDrinks returns one row per drink; group by the
  // missing ingredient so the rail reads "Buy Campari → unlocks 4 drinks"
  // instead of one card per drink.
  const oneAwayGroups = useMemo(() => {
    if (barInventory.length === 0 || drinks.length === 0) return [];
    const oneAway = getOneAwayDrinks(drinks, barInventory);
    const byIngredient = new Map();
    for (const { drink, missingIngredient } of oneAway) {
      const key = missingIngredient.toLowerCase().trim();
      if (!key) continue;
      if (!byIngredient.has(key)) byIngredient.set(key, { ingredient: missingIngredient, drinks: [] });
      byIngredient.get(key).drinks.push(drink);
    }
    return [...byIngredient.values()].sort((a, b) => b.drinks.length - a.drinks.length);
  }, [drinks, barInventory]);

  // Bar shopping list (3.2) — computed from every drink currently missing
  // something, not just the "one away" set. Only actually built while the
  // sheet is open or has ever been opened isn't worth the complexity here;
  // buildShoppingList is O(drinks) and cheap.
  const shoppingList = useMemo(
    () => buildShoppingList(drinks, barInventory),
    [drinks, barInventory],
  );

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = drinks;

    if (category !== 'All') {
      result = result.filter(d =>
        (d.category || '').toLowerCase() === category.toLowerCase()
      );
    }

    if (search.trim()) {
      const terms = search.toLowerCase().split(/\s+/);
      const pos   = terms.filter(t => !t.startsWith('-'));
      const neg   = terms.filter(t => t.startsWith('-')).map(t => t.slice(1)).filter(Boolean);
      result = result.filter(d => {
        const text = (d.name + ' ' + (d.category || '') + ' ' + (d.ingredients || []).join(' ')).toLowerCase();
        return (pos.length === 0 || pos.every(t => text.includes(t)))
            && neg.every(t => !text.includes(t));
      });
    }

    if (quickFilter !== 'all' && barInventory.length > 0) {
      result = result.filter(d => {
        const ms = matchScore(d, barInventory);
        if (quickFilter === 'canMake')     return ms.missing === 0;
        if (quickFilter === 'almostReady') return ms.missing > 0 && ms.missing <= 2;
        return true;
      });
    }

    // Phase 3.4.1: tag filter — a drink must carry ALL active tags (AND, same
    // rule as MealLibrary.matchTags).
    if (activeTags.length > 0) {
      result = result.filter(d => activeTags.every(t => (d.tags || []).includes(t)));
    }

    // Phase 3.4.2: Filters(n) sheet — additive (AND) with everything above,
    // same convention as MealLibrary's Time/Diet/Cuisine block.
    if (filterSpirit.length > 0) {
      result = result.filter(d => filterSpirit.includes(getDrinkBaseSpirit(d)));
    }
    if (filterStrength) {
      result = result.filter(d => getStrengthTier(d.abv) === filterStrength);
    }
    if (filterMethod.length > 0) {
      result = result.filter(d => filterMethod.includes(String(d.method || '').toLowerCase().trim()));
    }
    if (filterZeroProof) {
      result = result.filter(d => getStrengthTier(d.abv) === 'virgin');
    }

    return result;
  }, [drinks, search, category, quickFilter, barInventory, activeTags, filterSpirit, filterStrength, filterMethod, filterZeroProof]);

  // Methods actually present among current drinks — avoids offering an empty
  // picker full of options nobody has any drinks for (mirrors MealLibrary's
  // availableCuisines).
  const availableMethods = useMemo(() => {
    const set = new Set();
    for (const d of drinks) {
      const m = String(d.method || '').trim();
      if (m) set.add(m);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [drinks]);

  const activeFilterCount = filterSpirit.length + (filterStrength ? 1 : 0) + filterMethod.length + (filterZeroProof ? 1 : 0);

  const toggleFilterSpirit = useCallback((cat) => {
    hapticLight();
    setFilterSpirit(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
  }, []);
  const toggleFilterMethod = useCallback((m) => {
    hapticLight();
    const key = m.toLowerCase().trim();
    setFilterMethod(prev => prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key]);
  }, []);
  const clearAllFilters = useCallback(() => {
    hapticLight();
    setFilterSpirit([]);
    setFilterStrength(null);
    setFilterMethod([]);
    setFilterZeroProof(false);
  }, []);

  const sorted = useMemo(() =>
    [...filtered].sort((a, b) => {
      // Phase 3.4.6: favorites first — same rule as MealLibrary.
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      const aDate = a.importedAt || a.createdAt || a.created || '';
      const bDate = b.importedAt || b.createdAt || b.created || '';
      return bDate.localeCompare(aDate);
    }),
  [filtered]);

  // Phase 3.4.5: grid density toggle — persisted, mirrors MealLibrary.
  const handleGridChange = useCallback((layout) => {
    hapticLight();
    setGridLayout(layout);
    try { localStorage.setItem('bl-grid-layout', layout); } catch {}
  }, []);

  // Phase 3.4.4: collapsible-section toggle.
  const toggleSection = useCallback((sectionKey) => {
    hapticLight();
    setCollapsedSections(prev => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  }, []);

  // Group sorted drinks by base spirit for collapsible sections. Same
  // suppression rule as MealLibrary's groupedByCategory: only group the
  // unfiltered "browse everything" view — a search or active quick-filter
  // already narrows the list enough that sections just add scroll friction.
  const groupedBySpirit = useMemo(() => {
    if (category !== 'All' || search.trim() || quickFilter !== 'all' || activeTags.length > 0 || activeFilterCount > 0) return null;
    const groups = {};
    for (const drink of sorted) {
      const spirit = getDrinkBaseSpirit(drink);
      if (!groups[spirit]) groups[spirit] = [];
      groups[spirit].push(drink);
    }
    return Object.entries(groups).sort(([a], [b]) =>
      SPIRIT_SECTION_ORDER.indexOf(a) - SPIRIT_SECTION_ORDER.indexOf(b)
    );
  }, [sorted, category, search, quickFilter, activeTags, activeFilterCount]);

  const canMakeCount = useMemo(() =>
    barInventory.length === 0 ? 0 : drinks.filter(d => matchScore(d, barInventory).missing === 0).length,
  [drinks, barInventory]);

  const almostCount = useMemo(() =>
    barInventory.length === 0 ? 0 : drinks.filter(d => {
      const ms = matchScore(d, barInventory);
      return ms.missing > 0 && ms.missing <= 2;
    }).length,
  [drinks, barInventory]);

  // ── Ghost cleanup ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const liveIds = new Set(drinks.map(d => d.id));
    if ([...selectedIds].some(id => !liveIds.has(id))) {
      setSelectedIds(prev => {
        const cleaned = new Set([...prev].filter(id => liveIds.has(id)));
        if (cleaned.size === 0) setSelectMode(false);
        return cleaned;
      });
    }
  }, [drinks, selectedIds]);

  // ── Select helpers ────────────────────────────────────────────────────────
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  useBackHandler(selectMode, exitSelectMode, 'bar-select');
  useBackHandler(fabOpen, () => setFabOpen(false), 'bar-fab');
  useBackHandler(!!reExtractDrink, () => setReExtractDrink(null), 'bar-reextract');
  useBackHandler(!!quickPreview, () => setQuickPreview(null), 'bar-quickpreview');
  useBackHandler(showTagManager, () => { setShowTagManager(false); setEditingTagId(null); }, 'bar-tagmgr');
  useBackHandler(showBulkTagPicker, () => setShowBulkTagPicker(false), 'bar-bulktag');
  useBackHandler(showFilterSheet, () => setShowFilterSheet(false), 'bar-filters');

  // ── Escape key closes the expandable card (desktop / keyboard) ──────────────
  useEffect(() => {
    if (!quickPreview) return;
    const onKey = (e) => { if (e.key === 'Escape') setQuickPreview(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [quickPreview]);

  // ── Long-press to enter select mode ───────────────────────────────────────
  const LONG_PRESS_MS     = 500;
  const MOVE_THRESHOLD_PX = 8;

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    touchStartPos.current = null;
  }, []);

  const handleTouchStart = useCallback((drink, e) => {
    if (selectMode) return;
    const touch = e.changedTouches?.[0];
    touchStartPos.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      if (navigator.vibrate) navigator.vibrate(15);
      setSelectMode(true);
      setSelectedIds(new Set([drink.id]));
    }, LONG_PRESS_MS);
  }, [selectMode]);

  const handleTouchMove = useCallback((e) => {
    if (!touchStartPos.current || !longPressTimer.current) return;
    const touch = e.changedTouches?.[0];
    if (!touch) return;
    const dx = Math.abs(touch.clientX - touchStartPos.current.x);
    const dy = Math.abs(touch.clientY - touchStartPos.current.y);
    if (dx > MOVE_THRESHOLD_PX || dy > MOVE_THRESHOLD_PX) cancelLongPress();
  }, [cancelLongPress]);

  const handleTouchEnd = useCallback(() => cancelLongPress(), [cancelLongPress]);

  // ── Long-press a tag chip → enter rearrange/delete mode (Phase 3.4.1) ─────
  // Mirrors MealLibrary's tag long-press exactly, on its own timer/ref pair
  // (a tag-chip press and a tile press can't overlap, but sharing one timer
  // would still be a subtle bug waiting to happen). Reuses this component's
  // own LONG_PRESS_MS/MOVE_THRESHOLD_PX above.
  const cancelTagLongPress = useCallback(() => {
    if (tagLongPressTimer.current) { clearTimeout(tagLongPressTimer.current); tagLongPressTimer.current = null; }
    tagTouchStartPos.current = null;
  }, []);

  const handleTagTouchStart = useCallback((e) => {
    if (tagEditMode) return;
    const touch = e.changedTouches?.[0];
    tagTouchStartPos.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    tagLongPressTimer.current = setTimeout(() => {
      tagLongPressTimer.current = null;
      hapticLight();
      setTagEditMode(true);
    }, LONG_PRESS_MS);
  }, [tagEditMode]);

  const handleTagTouchMove = useCallback((e) => {
    if (!tagTouchStartPos.current || !tagLongPressTimer.current) return;
    const touch = e.changedTouches?.[0];
    if (!touch) return;
    const dx = Math.abs(touch.clientX - tagTouchStartPos.current.x);
    const dy = Math.abs(touch.clientY - tagTouchStartPos.current.y);
    if (dx > MOVE_THRESHOLD_PX || dy > MOVE_THRESHOLD_PX) cancelTagLongPress();
  }, [cancelTagLongPress]);

  const handleTagTouchEnd = useCallback(() => cancelTagLongPress(), [cancelTagLongPress]);

  const handleReorderTags = useCallback((newOrder) => {
    setDrinkTagsList(newOrder);
    reorderUserTags(newOrder.map(t => t.id)).catch(() => {});
  }, []);

  const handleTagToggle = useCallback((tagName) => {
    hapticLight();
    setActiveTags(prev =>
      prev.includes(tagName) ? prev.filter(t => t !== tagName) : [...prev, tagName]
    );
  }, []);

  const handleCreateTag = useCallback(async () => {
    if (!newTagName.trim()) return;
    const TAG_COLORS = ['#FF9800', '#8D6E63', '#FFB300', '#5C6BC0', '#66BB6A', '#26C6DA', '#E91E63', '#9C27B0', '#795548', '#42A5F5'];
    const color = TAG_COLORS[drinkTags.length % TAG_COLORS.length];
    await addUserTag({ name: newTagName.trim(), color, emoji: '🏷️', domain: 'drink' });
    setNewTagName('');
    await refreshTags();
  }, [newTagName, drinkTags.length, refreshTags]);

  const handleDeleteTag = useCallback(async (tagId) => {
    const tag = drinkTags.find(t => t.id === tagId);
    if (!tag) return;
    if (!window.confirm(`Delete "${tag.name}" tag? It will be removed from all drinks.`)) return;
    await deleteUserTag(tagId);
    setActiveTags(prev => prev.filter(t => t !== tag.name));
    await refreshTags();
    onReload?.();
  }, [drinkTags, refreshTags, onReload]);

  const handleRenameTag = useCallback(async (tagId) => {
    if (!editingTagName.trim()) return;
    await renameUserTag(tagId, editingTagName.trim());
    setEditingTagId(null);
    setEditingTagName('');
    await refreshTags();
    onReload?.();
  }, [editingTagName, refreshTags, onReload]);

  const handleBulkTag = useCallback(async (tagName) => {
    await bulkSetDrinkTags([...selectedIds], tagName, true);
    onReload?.();
    onToast?.(`Tagged ${selectedIds.size} drink${selectedIds.size !== 1 ? 's' : ''} with "${tagName}"`);
    setShowBulkTagPicker(false);
    exitSelectMode();
  }, [selectedIds, onReload, onToast, exitSelectMode]);

  // ── Quick preview swipe-to-dismiss ────────────────────────────────────────
  // Phase 2.3a (bar-library-parity-plan-2026-08-07.md): this used to be a
  // hand-rolled drag handler that set style.transition='none' and mutated
  // transforms directly — on iOS that can fight Safari's own scroll
  // compositing. useSwipeDismiss is the same hook the rest of the app's
  // sheets already use (velocity-aware release, overlay fade, scrollable-
  // content passthrough so dragging a scrolled ingredient list doesn't
  // trigger dismiss).
  const { sheetRef, handleTouchStart: handleSheetTouchStart, handleTouchMove: handleSheetTouchMove, handleTouchEnd: handleSheetTouchEnd } =
    useSwipeDismiss(() => setQuickPreview(null));

  // ── Batch category assignment ─────────────────────────────────────────────
  const handleBatchSetCategory = useCallback(async (newCategory) => {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    try {
      await Promise.all(ids.map(id => db.drinks.update(id, { category: newCategory })));
      onReload?.();
      onToast?.('Set "' + newCategory + '" for ' + ids.length + ' drink' + (ids.length !== 1 ? 's' : ''));
    } catch (err) {
      onToast?.('Failed to update: ' + err.message, 'error');
    }
    setShowCategoryPicker(false);
    exitSelectMode();
  }, [selectedIds, onReload, onToast, exitSelectMode]);

  // ── Inline category assignment (single drink, from quick preview) ─────────
  const handleSetCategory = useCallback(async (drink, newCategory) => {
    try {
      await db.drinks.update(drink.id, { category: newCategory });
      onReload?.();
      onToast?.('"' + drink.name + '" → ' + newCategory);
      setQuickPreview(prev => prev?.id === drink.id ? { ...prev, category: newCategory } : prev);
    } catch (err) {
      onToast?.('Failed: ' + err.message, 'error');
    }
  }, [onReload, onToast]);

  // ── Batch delete ──────────────────────────────────────────────────────────
  const handleBatchDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!window.confirm('Delete ' + count + ' drink' + (count !== 1 ? 's' : '') + '? This cannot be undone.')) return;
    for (const id of selectedIds) onDelete?.(id);
    onToast?.('Deleted ' + count + ' drink' + (count !== 1 ? 's' : ''));
    exitSelectMode();
  }, [selectedIds, onDelete, onToast, exitSelectMode]);

  // ── Re-import photo (parity with Meal Library's "Find Better Photo") ──────
  const handleReimportPhoto = useCallback(async (drink) => {
    const sourceUrl = drink.link || drink.sourceUrl;
    if (!sourceUrl) { onToast?.('No source URL to search for a photo'); return; }
    setReimportingPhotoId(drink.id);
    onToast?.('🔍 Searching for a better photo…');
    try {
      const res = await fetch('/api/import/photo-only', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sourceUrl }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok && data.imageUrl) {
        await db.drinks.update(drink.id, { imageUrl: data.imageUrl });
        onReload?.();
        onToast?.('📸 Found a better photo!');
      } else {
        onToast?.('No better photo found for this drink');
      }
    } catch {
      onToast?.('Photo search failed — check your connection and try again');
    } finally {
      setReimportingPhotoId(null);
    }
  }, [onToast, onReload]);

  // ── Tile click ────────────────────────────────────────────────────────────
  const handleTileClick = useCallback((drink) => {
    if (selectMode) { toggleSelect(drink.id); return; }
    hapticLight();
    setQuickPreview(drink);
  }, [selectMode, toggleSelect]);

  // ── Render Tile (Phase 3.4.4-5: extracted so both the flat gallery and the
  // collapsible base-spirit sections share one implementation) ──────────────
  const renderTile = (drink, idx) => {
    const rarity      = getDrinkRarity(drink, barInventory);
    const rarityColor = getRarityColor(rarity);
    const rarityBadge = getRarityLabel(rarity);
    const ms          = barInventory.length > 0 ? matchScore(drink, barInventory) : null;
    const isSelected  = selectedIds.has(drink.id);

    return (
      <div
        key={drink.id}
        className={'bl-tile bl-tile-' + rarity + (selectMode && isSelected ? ' bl-tile-selected' : '')}
        style={{ animationDelay: Math.min(idx * 25, 250) + 'ms' }}
        onClick={() => handleTileClick(drink)}
        onTouchStart={e => handleTouchStart(drink, e)}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onContextMenu={e => { e.preventDefault(); if (!selectMode) setQuickPreview(drink); }}
      >
        {selectMode && (
          <div className="bl-tile-check">
            {isSelected ? '✓' : ''}
          </div>
        )}

        <motion.div className="bl-tile-image" layoutId={`bl-card-img-${drink.id}`}>
          <DrinkImage
            src={drink.imageUrl}
            alt={drink.name}
            className="bl-tile-img"
            phClass="bl-tile-placeholder"
          />
          {rarityBadge && (
            <span className={'bl-rarity-pip bl-rarity-' + rarity}>{rarityBadge}</span>
          )}
          {drink.category && (
            <span className="bl-tile-cat-tag">{drink.category}</span>
          )}
          {drink.isFavorite && (
            <span className="bl-tile-fav"><Heart size={14} fill="#e53935" color="#e53935" aria-label="Favorite" /></span>
          )}
          {ms && ms.missing === 0 && (
            <span className="bl-tile-pour">&#127864;</span>
          )}
          {/* I-5: low-confidence import → one-tap re-extraction (parity with Meal Library) */}
          {!selectMode && isImprovable(drink) && (
            <button
              className="bl-tile-improve"
              aria-label="Improve this drink with the latest engine"
              title="Low-confidence import — tap to re-run extraction"
              onClick={e => { e.stopPropagation(); hapticLight(); setReExtractDrink(drink); }}
              onTouchEnd={e => e.stopPropagation()}
            >
              <span aria-hidden="true">✨</span> Improve
            </button>
          )}
          {!selectMode && (
            <button
              className="bl-tile-menu-btn"
              aria-label="More options"
              onClick={e => { e.stopPropagation(); setQuickPreview(drink); }}
              onTouchEnd={e => e.stopPropagation()}
            >
              &hellip;
            </button>
          )}
          {/* PiP: play-video badge — only on cards with a YouTube/Instagram source */}
          {!selectMode && onPlayVideo && (() => {
            const vsrc = getMealVideoSource(drink);
            if (!vsrc) return null;
            return (
              <button
                className={'bl-tile-play bl-tile-play-' + vsrc.platform}
                aria-label={'Play ' + vsrc.label + ' video in floating player'}
                title={'Play video (' + vsrc.label + ')'}
                onClick={e => { e.stopPropagation(); hapticLight(); onPlayVideo(drink); }}
                onTouchEnd={e => e.stopPropagation()}
              >
                <span className="bl-tile-play-tri" aria-hidden="true">▶</span>
              </button>
            );
          })()}
        </motion.div>

        <div className="bl-tile-info">
          <motion.span
            className="bl-tile-name"
            layoutId={`bl-card-title-${drink.id}`}
            style={rarityColor ? { color: rarityColor } : undefined}
          >
            {drink.name || 'Untitled Drink'}
          </motion.span>
          <span className="bl-tile-meta">
            {drink.ingredients?.length ?? 0} ing
            {ms && ms.pct > 0 && ms.pct < 100 && ' - ' + ms.pct + '% ready'}
          </span>
          {formatAddedDate(drink.importedAt || drink.createdAt || drink.created) && (
            <span className="bl-tile-added">
              {formatAddedDate(drink.importedAt || drink.createdAt || drink.created)}
            </span>
          )}
          {ms && ms.total > 0 && (
            <div className="bl-mini-progress">
              <div
                className="bl-mini-progress-fill"
                style={{
                  width: ms.pct + '%',
                  background: ms.missing === 0 ? 'var(--bar-ready, #4caf50)' : (rarityColor || 'var(--bar-accent-dim, #8b5cf6)'),
                }}
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Backup / restore ──────────────────────────────────────────────────────
  const handleMenuOpen  = () => { setShowMenu(true); setMenuAnimation(false); };
  const handleMenuClose = () => {
    setMenuAnimation(true);
    setTimeout(() => { setShowMenu(false); setMenuAnimation(false); }, 200);
  };

  const handleBackup = async () => {
    handleMenuClose();
    const all  = await db.drinks.toArray();
    const data = {
      version: 1, app: 'SpiceHub', type: 'bar',
      exportedAt: new Date().toISOString(),
      drinks: all.map(({ id, ...rest }) => rest),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    if (navigator.canShare) {
      try {
        const file = new File([blob], 'spicehub-bar.json', { type: 'application/json' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ title: 'SpiceHub Bar Backup', files: [file] });
          return;
        }
      } catch { /* fall through */ }
    }
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = 'spicehub-bar-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click(); URL.revokeObjectURL(url);
    onToast?.('Bar backup downloaded');
  };

  const handleRestore = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const list = data.drinks || data.meals || [];
      if (!Array.isArray(list) || list.length === 0) throw new Error('No drinks found');
      const existing     = await db.drinks.toArray();
      const existingNames = new Set(existing.map(d => d.name.toLowerCase().trim()));
      let added = 0, skipped = 0;
      for (const drink of list) {
        if (existingNames.has(drink.name.toLowerCase().trim())) { skipped++; }
        else { await db.drinks.add(drink); existingNames.add(drink.name.toLowerCase().trim()); added++; }
      }
      onReload?.();
      onToast?.('Restored ' + added + ' drink' + (added !== 1 ? 's' : '') + (skipped ? ' (' + skipped + ' skipped)' : ''));
    } catch (err) {
      onToast?.('Restore failed: ' + err.message, 'error');
    }
    e.target.value = '';
    handleMenuClose();
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="bl">

      {/* Search */}
      <div className="bl-search-zone">
        <input
          type="text"
          placeholder="Search drinks... (use -term to exclude)"
          className="bl-search-input"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {/* Phase 3.4.2: Filters(n) sheet trigger — mirrors MealLibrary's ml-filter-btn */}
        <button
          className={'bl-filter-btn' + (activeFilterCount > 0 ? ' has-active' : '')}
          onClick={() => { hapticLight(); setShowFilterSheet(true); }}
          aria-label="Filters"
        >
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
        {/* Phase 3.4.5: grid density toggle — mirrors MealLibrary's ml-grid-toggle */}
        <div className="bl-grid-toggle">
          {[
            { id: '2x', icon: <Grid2x2 size={15} strokeWidth={2} />, label: '2 columns' },
            { id: '3x', icon: <Grid3x3 size={15} strokeWidth={2} />, label: '3 columns' },
            { id: 'list', icon: <List size={15} strokeWidth={2} />, label: 'List view' },
          ].map(opt => (
            <button
              key={opt.id}
              type="button"
              aria-label={opt.label}
              className={'bl-grid-toggle-btn' + (gridLayout === opt.id ? ' active' : '')}
              onClick={() => handleGridChange(opt.id)}
            >
              {opt.icon}
            </button>
          ))}
        </div>
      </div>

      {/* Enter the Saloon hero button */}
      {onOpenShelf && (
        <button className="bl-saloon-btn" onClick={onOpenShelf}>
          <span className="bl-saloon-icon">&#127918;</span>
          <SquigglyText as="span" className="bl-saloon-text" steps={5} stepDuration={110} scale={[3, 4]}>Enter the Saloon</SquigglyText>
          <span className="bl-saloon-count">{drinks.length} bottle{drinks.length !== 1 ? 's' : ''}</span>
        </button>
      )}

      {/* Category chips */}
      <div className="bl-categories-scroll">
        <div className="bl-categories-track">
          {BAR_CATEGORIES.map(c => (
            <button
              key={c}
              className={'bl-cat-chip' + (category === c ? ' bl-cat-active' : '')}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Inventory quick filters */}
      {barInventory.length > 0 && (
        <div className="bl-quick-filters">
          <button className={'bl-qf-chip' + (quickFilter === 'all' ? ' active' : '')} onClick={() => setQuickFilter('all')}>
            All
          </button>
          <button className={'bl-qf-chip bl-qf-ready' + (quickFilter === 'canMake' ? ' active' : '')} onClick={() => setQuickFilter('canMake')}>
            Ready to Pour {canMakeCount > 0 && <span className="bl-qf-badge">{canMakeCount}</span>}
          </button>
          <button className={'bl-qf-chip bl-qf-almost' + (quickFilter === 'almostReady' ? ' active' : '')} onClick={() => setQuickFilter('almostReady')}>
            Almost There {almostCount > 0 && <span className="bl-qf-badge">{almostCount}</span>}
          </button>
        </div>
      )}

      {/* ── Tag chips (Phase 3.4.1) — user-created multi-select labels ── */}
      <div className="bl-labels-scroll">
        <div className="bl-labels-track">
          <button
            className="bl-label-add-btn"
            onClick={() => { hapticLight(); setShowTagManager(true); }}
            aria-label="Create a new tag"
            title="Create a new tag"
          >
            <Plus size={16} strokeWidth={2.5} />
          </button>

          {tagEditMode ? (
            <Reorder.Group
              as="div"
              axis="x"
              values={drinkTags}
              onReorder={handleReorderTags}
              className="bl-labels-reorder-group"
            >
              {drinkTags.map(tag => (
                <Reorder.Item
                  as="div"
                  key={tag.id}
                  value={tag}
                  layout
                  className="bl-label-chip bl-label-chip--editing"
                  whileDrag={{ scale: 1.08, zIndex: 2, boxShadow: '0 6px 16px -4px rgba(0,0,0,0.35)' }}
                >
                  <Tag size={11} strokeWidth={2.5} /> {tag.name}
                  <button
                    type="button"
                    className="bl-label-chip-remove"
                    onClick={(e) => { e.stopPropagation(); hapticLight(); handleDeleteTag(tag.id); }}
                    aria-label={`Delete ${tag.name} label`}
                  >
                    ✕
                  </button>
                </Reorder.Item>
              ))}
            </Reorder.Group>
          ) : (
            drinkTags.map(tag => (
              <button
                key={tag.id}
                className={'bl-label-chip' + (activeTags.includes(tag.name) ? ' bl-tag-active' : '')}
                onClick={() => handleTagToggle(tag.name)}
                onTouchStart={handleTagTouchStart}
                onTouchMove={handleTagTouchMove}
                onTouchEnd={handleTagTouchEnd}
                onTouchCancel={handleTagTouchEnd}
                style={activeTags.includes(tag.name) ? { background: tag.color, borderColor: tag.color, color: '#fff' } : undefined}
              >
                <Tag size={11} strokeWidth={2.5} /> {tag.name}
                {(() => {
                  const count = drinks.filter(d => (d.tags || []).includes(tag.name)).length;
                  return count > 0 ? <span className="bl-label-count">{count}</span> : null;
                })()}
              </button>
            ))
          )}

          {tagEditMode ? (
            <button
              className="bl-label-chip bl-label-done-btn"
              onClick={() => { hapticLight(); setTagEditMode(false); }}
            >
              <Check size={12} strokeWidth={3} /> Done
            </button>
          ) : (
            <button
              className="bl-label-chip bl-label-manage-btn"
              onClick={() => { hapticLight(); setShowTagManager(true); }}
            >
              <Pencil size={11} strokeWidth={2.5} /> Manage
            </button>
          )}
        </div>
      </div>

      {/* Multi-select toolbar */}
      {selectMode && (
        <div className="bl-select-toolbar">
          <button className="bl-select-toolbar-btn" onClick={exitSelectMode}>Cancel</button>
          <span className="bl-select-count">{selectedIds.size} selected</span>
          <button className="bl-select-toolbar-btn" onClick={() => setSelectedIds(new Set(sorted.map(d => d.id)))}>All</button>
          <button
            className="bl-select-toolbar-btn"
            onClick={() => setShowCategoryPicker(true)}
            disabled={selectedIds.size === 0}
          >
            Category
          </button>
          <button
            className="bl-select-toolbar-btn"
            onClick={() => setShowBulkTagPicker(true)}
            disabled={selectedIds.size === 0}
          >
            Tag
          </button>
          <button
            className="bl-select-toolbar-btn bl-select-delete"
            onClick={handleBatchDelete}
            disabled={selectedIds.size === 0}
          >
            Delete
          </button>
        </div>
      )}

      {/* Header actions - hidden in select mode */}
      {!selectMode && (
        <div className="bl-header-actions">
          {onOpenBarFridge && (
            <button className="bl-header-btn" onClick={onOpenBarFridge}>My Shelf</button>
          )}
          <button className="bl-header-btn" onClick={handleMenuOpen}>More</button>
        </div>
      )}

      {/* Phase 3.4.3: drinks-only inbox — straight port, itemType scoped */}
      <SharedWithYouSection onToast={onToast} onReload={onReload} itemType="drink" />

      {/* ── "One Bottle Away" rail (Phase 3.2/4.1) ── */}
      {oneAwayGroups.length > 0 && (
        <div className="bl-oneaway-wrap">
          <div className="bl-oneaway-scroll sh-carousel">
            {oneAwayGroups.map(g => (
              <button
                key={g.ingredient}
                className="bl-oneaway-card"
                onClick={() => { hapticLight(); setSearch(g.ingredient); }}
                title={g.drinks.map(d => d.name || 'Untitled').join(', ')}
              >
                <span className="bl-oneaway-title">Buy {g.ingredient}</span>
                <span className="bl-oneaway-sub">
                  &#8594; unlocks {g.drinks.length} drink{g.drinks.length !== 1 ? 's' : ''}
                </span>
              </button>
            ))}
          </div>
          <div className="bl-oneaway-fade" aria-hidden="true" />
        </div>
      )}

      {/* Tile gallery */}
      <div className={'bl-gallery bl-layout-' + gridLayout}>
        {sorted.length === 0 ? (
          <div className="bl-empty-state bl-empty-state-anim" style={{ gridColumn: '1 / -1' }}>
            <div className="bl-empty-emoji"><Martini size={32} strokeWidth={1.75} /></div>
            {search || category !== 'All' || quickFilter !== 'all' || activeTags.length > 0 || activeFilterCount > 0 ? (
              <>
                <p className="bl-empty-text">No drinks match your search.</p>
                <p className="bl-empty-hint">Try a different keyword, tag, or filter.</p>
                {activeFilterCount > 0 && (
                  <button className="bl-empty-cta" type="button" onClick={clearAllFilters}>
                    Clear filters
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="bl-empty-text">Your bar is empty</p>
                <p className="bl-empty-hint">Import a cocktail from Instagram or add one manually to get pouring.</p>
              </>
            )}
            {!search && category === 'All' && quickFilter === 'all' && activeTags.length === 0 && activeFilterCount === 0 && (
              <div className="bl-empty-actions">
                <button className="bl-btn-primary" onClick={onImport}>Import from Instagram</button>
                <button className="bl-btn-secondary" onClick={onAdd}>+ Add Manually</button>
              </div>
            )}
          </div>
        ) : groupedBySpirit ? (
          /* ── Collapsible sections by base spirit (Phase 3.4.4) ── */
          groupedBySpirit.map(([spiritName, spiritDrinks]) => (
            <div key={spiritName} className="bl-section">
              <button
                className="bl-section-header"
                onClick={() => toggleSection(spiritName)}
                aria-expanded={!collapsedSections[spiritName]}
              >
                <span className="bl-section-title">{spiritName}</span>
                <span className="bl-section-count">{spiritDrinks.length}</span>
                <span className={'bl-section-chevron' + (collapsedSections[spiritName] ? ' bl-section-chevron-collapsed' : '')}>▾</span>
              </button>
              {!collapsedSections[spiritName] && (
                <div className={'bl-section-grid bl-layout-' + gridLayout}>
                  {spiritDrinks.map((drink, idx) => renderTile(drink, idx))}
                </div>
              )}
            </div>
          ))
        ) : (
          /* ── Flat list (filtered / searched / quick-filtered) ── */
          sorted.map((drink, idx) => renderTile(drink, idx))
        )}
      </div>

      {/* ── Speed-dial FAB: single + expands to Create / Import (parity with Meal Library) ── */}
      <AnimatePresence>
        {fabOpen && (
          <motion.div
            key="bl-fab-scrim"
            className="bl-fab-scrim"
            onClick={() => setFabOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
        )}
      </AnimatePresence>

      <motion.div
        className="bl-fab-group"
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22, delay: 0.15 }}
      >
        <AnimatePresence>
          {fabOpen && (
            <motion.div
              key="bl-fab-actions"
              className="bl-fab-actions"
              initial="closed"
              animate="open"
              exit="closed"
              variants={{
                open: { transition: { staggerChildren: 0.06, delayChildren: 0.02 } },
                closed: { transition: { staggerChildren: 0.04, staggerDirection: -1 } },
              }}
            >
              <motion.button
                className="bl-fab-action"
                variants={fabActionVariants}
                onClick={() => { hapticLight(); setFabOpen(false); onImport?.(); }}
                whileTap={{ scale: 0.94 }}
              >
                <span className="bl-fab-action-label">Import Drink</span>
                <span className="bl-fab-action-icon bl-fab-action-icon--import" aria-hidden="true">📥</span>
              </motion.button>
              <motion.button
                className="bl-fab-action"
                variants={fabActionVariants}
                onClick={() => { hapticLight(); setFabOpen(false); onAdd?.(); }}
                whileTap={{ scale: 0.94 }}
              >
                <span className="bl-fab-action-label">Create Manual Drink</span>
                <span className="bl-fab-action-icon bl-fab-action-icon--add" aria-hidden="true">✏️</span>
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          className="bl-fab bl-fab-add bl-fab-main"
          onClick={() => { hapticLight(); setFabOpen(o => !o); }}
          aria-expanded={fabOpen}
          aria-label={fabOpen ? 'Close actions' : 'Add or import a drink'}
          whileTap={{ scale: 0.88 }}
          animate={{ rotate: fabOpen ? 45 : 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
        >
          <span>+</span>
        </motion.button>
      </motion.div>

      {/* ── I-5 Re-extraction (improve) sheet ── */}
      <AnimatePresence>
        {reExtractDrink && (
          <ReExtractSheet
            key="bl-reextract-sheet"
            meal={{ ...reExtractDrink, itemType: reExtractDrink.itemType || reExtractDrink.type || 'drink' }}
            onClose={() => setReExtractDrink(null)}
            onSaved={async (updated) => {
              try {
                // If the drink didn't originally carry an itemType/type, strip the
                // temporary 'drink' seed we passed in so we never persist a spurious
                // field onto the stored record.
                let toSave = updated;
                if (!(reExtractDrink.itemType || reExtractDrink.type)) {
                  toSave = { ...updated };
                  delete toSave.itemType;
                }
                await db.drinks.put(toSave);
              } catch (err) {
                console.error('[BarLibrary] re-extract save failed:', err);
                onToast?.('Could not save changes');
                return;
              }
              setReExtractDrink(null);
              await onReload?.();
              onToast?.('Drink improved ✨');
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Expandable card (tap a tile, long-press is select, or ⋯ button) ──
            Shared-element morph: the tapped tile's image + title carry the same
            layoutId as this card's hero + title, so the tile grows into the modal
            and shrinks back on close (Aceternity "expandable card" pattern). */}
      <AnimatePresence>
      {quickPreview && (
        <motion.div
          key="bl-qp-overlay"
          className="bl-qp-overlay"
          onClick={() => setQuickPreview(null)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
        >
          {/* Floating close button (Aceternity-style), outside the card surface */}
          <motion.button
            key="bl-qp-close"
            className="bl-qp-close"
            aria-label="Close"
            onClick={() => setQuickPreview(null)}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1, transition: { delay: 0.08 } }}
            exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.05 } }}
            whileTap={{ scale: 0.88 }}
          >
            ✕
          </motion.button>

          <motion.div
            ref={sheetRef}
            className="bl-qp-sheet bl-qp-card"
            onClick={e => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 18, transition: { duration: 0.16 } }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            onTouchStart={handleSheetTouchStart}
            onTouchMove={handleSheetTouchMove}
            onTouchEnd={handleSheetTouchEnd}
            onTouchCancel={handleSheetTouchEnd}
          >
            <div className="bl-qp-handle" />
            <motion.div className="bl-qp-hero" layoutId={`bl-card-img-${quickPreview.id}`}>
              {quickPreview.imageUrl ? (
                <SafeMediaImage
                  src={quickPreview.imageUrl}
                  alt={quickPreview.name || 'Drink'}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  fallbackEmoji="&#127865;"
                />
              ) : (
                <div className="bl-qp-hero-empty" aria-hidden="true">&#127864;</div>
              )}
            </motion.div>
            <div className="bl-qp-body">
              <motion.h3 className="bl-qp-title" layoutId={`bl-card-title-${quickPreview.id}`}>
                {quickPreview.name || 'Untitled Drink'}
              </motion.h3>

              {typeof quickPreview.abv === 'number' && (
                <div className={'bl-qp-strength bl-qp-strength-' + getStrengthTier(quickPreview.abv).replace(' ', '-')}>
                  {STRENGTH_LABELS[getStrengthTier(quickPreview.abv)] || ''} · {quickPreview.abv}% ABV
                </div>
              )}

              {drinkEngineLabel(quickPreview._structuredVia) && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 8 }}>
                  Parsed by {drinkEngineLabel(quickPreview._structuredVia)}
                  {typeof quickPreview.confidence === 'number'
                    ? ' · ' + Math.round(quickPreview.confidence * 100) + '%'
                    : ''}
                </div>
              )}

              <div className="bl-qp-cat-row">
                <span className="bl-qp-cat-label">Category:</span>
                <div className="bl-qp-cat-chips">
                  {DRINK_CATEGORY_OPTIONS.map(c => (
                    <button
                      key={c}
                      className={'bl-qp-cat-chip' + ((quickPreview.category || '') === c ? ' active' : '')}
                      onClick={() => handleSetCategory(quickPreview, c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {quickPreview.ingredients?.length > 0 && (
                <div className="bl-qp-section">
                  <div className="bl-qp-section-title">Ingredients</div>
                  <ul className="bl-qp-list">
                    {quickPreview.ingredients.slice(0, 6).map((ing, i) => (
                      <li key={i}>{ing}</li>
                    ))}
                    {quickPreview.ingredients.length > 6 && (
                      <li className="bl-qp-more">+{quickPreview.ingredients.length - 6} more</li>
                    )}
                  </ul>
                </div>
              )}

              <div className="bl-qp-actions">
                <button className="bl-qp-btn" onClick={() => { setQuickPreview(null); onViewDetail?.(quickPreview); }}>View</button>
                <button className="bl-qp-btn" onClick={() => { setQuickPreview(null); onEdit?.(quickPreview); }}>Edit</button>
                <button className="bl-qp-btn" onClick={() => { setQuickPreview(null); onShare?.(quickPreview); }}>Share</button>
                {onToggleFavorite && (
                  <button className="bl-qp-btn" onClick={() => { hapticLight(); onToggleFavorite(quickPreview); setQuickPreview(null); }}>
                    {quickPreview.isFavorite ? '💔 Unfavorite' : '❤️ Favorite'}
                  </button>
                )}
                {isFriendsEnabled() && (
                  <button className="bl-qp-btn" onClick={() => { setQuickPreview(null); setFriendShareDrink(quickPreview); }}>👤 Send to Friend</button>
                )}
                {onPlayVideo && getMealVideoSource(quickPreview) && (
                  <button
                    className="bl-qp-btn"
                    onClick={() => { hapticLight(); onPlayVideo(quickPreview); setQuickPreview(null); }}
                  >
                    🎥 Play ({getMealVideoSource(quickPreview).label})
                  </button>
                )}
                {isImprovable(quickPreview) && (
                  <button
                    className="bl-qp-btn"
                    onClick={() => { hapticLight(); setReExtractDrink(quickPreview); setQuickPreview(null); }}
                  >
                    ✨ Improve
                  </button>
                )}
                {(quickPreview.link || quickPreview.sourceUrl) && (
                  <button
                    className="bl-qp-btn"
                    onClick={() => {
                      const url = quickPreview.link || quickPreview.sourceUrl;
                      hapticLight();
                      setQuickPreview(null);
                      if (window.__spicehubTriggerImport) {
                        window.__spicehubTriggerImport(url);
                      } else {
                        navigator.clipboard.writeText(url).catch(() => {});
                        onToast?.('Link copied — open Import to re-import this drink.');
                      }
                    }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <RefreshCw size={15} strokeWidth={1.75} /> Re-import
                  </button>
                )}
                {(quickPreview.link || quickPreview.sourceUrl) && (
                  <button
                    className="bl-qp-btn"
                    onClick={() => { handleReimportPhoto(quickPreview); setQuickPreview(null); }}
                    disabled={reimportingPhotoId === quickPreview.id}
                  >
                    {reimportingPhotoId === quickPreview.id
                      ? '⏳ Searching…'
                      : quickPreview.imageUrl
                      ? '📸 Find Better Photo'
                      : '📸 Find Photo'}
                  </button>
                )}
                {onMoveToMeals && (
                  <button
                    className="bl-qp-btn"
                    onClick={() => { hapticLight(); onMoveToMeals(quickPreview); setQuickPreview(null); }}
                    title="Move this to the Meal Library — for a recipe that got imported as a drink by mistake"
                  >
                    🍽️ Move to Meals
                  </button>
                )}
                <button
                  className="bl-qp-btn bl-qp-btn-danger"
                  onClick={() => { setQuickPreview(null); setConfirmDelete(quickPreview.id); }}
                >
                  Delete
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Batch Category Picker */}
      {showCategoryPicker && (
        <>
          <div className="bl-overlay" onClick={() => setShowCategoryPicker(false)} />
          <div className="bl-bottom-sheet">
            <div className="bl-sheet-handle" />
            <div className="bl-sheet-title">
              Set Category for {selectedIds.size} drink{selectedIds.size !== 1 ? 's' : ''}
            </div>
            {DRINK_CATEGORY_OPTIONS.map(c => (
              <button key={c} className="bl-sheet-button" onClick={() => handleBatchSetCategory(c)}>
                {c}
              </button>
            ))}
            <button className="bl-sheet-button bl-sheet-cancel" onClick={() => setShowCategoryPicker(false)}>
              Cancel
            </button>
          </div>
        </>
      )}

      {/* ── Filters(n) sheet (Phase 3.4.2) ── */}
      {showFilterSheet && (
        <>
          <div className="bl-overlay" onClick={() => setShowFilterSheet(false)} />
          <div className="bl-bottom-sheet bl-filter-sheet">
            <div className="bl-sheet-handle" />
            <div className="bl-sheet-title">Filters</div>

            <p className="bl-sheet-subtitle">Base spirit</p>
            <div className="bl-filter-chip-row">
              {BASE_SPIRIT_CATEGORIES.map(cat => {
                const label = SPIRIT_SECTION_LABELS[cat];
                return (
                  <button
                    key={cat}
                    className={'bl-label-chip' + (filterSpirit.includes(label) ? ' bl-tag-active' : '')}
                    onClick={() => toggleFilterSpirit(label)}
                    style={filterSpirit.includes(label) ? { background: '#7b1fa2', borderColor: '#7b1fa2' } : undefined}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <p className="bl-sheet-subtitle">Strength</p>
            <div className="bl-filter-chip-row">
              {[
                { id: 'light', label: 'Light' },
                { id: 'medium', label: 'Medium' },
                { id: 'strong', label: 'Strong' },
                { id: 'very strong', label: 'Very strong' },
              ].map(opt => (
                <button
                  key={opt.id}
                  className={'bl-label-chip' + (filterStrength === opt.id ? ' bl-tag-active' : '')}
                  onClick={() => { hapticLight(); setFilterStrength(prev => prev === opt.id ? null : opt.id); }}
                  style={filterStrength === opt.id ? { background: '#7b1fa2', borderColor: '#7b1fa2' } : undefined}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <p className="bl-sheet-subtitle">Zero-proof</p>
            <div className="bl-filter-chip-row">
              <button
                className={'bl-label-chip' + (filterZeroProof ? ' bl-tag-active' : '')}
                onClick={() => { hapticLight(); setFilterZeroProof(v => !v); }}
                style={filterZeroProof ? { background: '#7b1fa2', borderColor: '#7b1fa2' } : undefined}
              >
                Zero-proof only
              </button>
            </div>

            {availableMethods.length > 0 && (
              <>
                <p className="bl-sheet-subtitle">Method</p>
                <div className="bl-filter-chip-row" style={{ marginBottom: 8 }}>
                  {availableMethods.map(m => {
                    const key = m.toLowerCase().trim();
                    return (
                      <button
                        key={m}
                        className={'bl-label-chip' + (filterMethod.includes(key) ? ' bl-tag-active' : '')}
                        onClick={() => toggleFilterMethod(m)}
                        style={filterMethod.includes(key) ? { background: '#7b1fa2', borderColor: '#7b1fa2' } : undefined}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <div className="bl-filter-sheet-footer">
              <button
                className="bl-sheet-button bl-sheet-cancel"
                onClick={clearAllFilters}
                disabled={activeFilterCount === 0}
                style={{ flex: 1, opacity: activeFilterCount === 0 ? 0.5 : 1 }}
              >
                Clear all
              </button>
              <button
                className="bl-sheet-button bl-filter-show-btn"
                onClick={() => setShowFilterSheet(false)}
                style={{ flex: 1 }}
              >
                <Check size={15} strokeWidth={2.5} /> Show {filtered.length} drink{filtered.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Tag Manager sheet (Phase 3.4.1) ── */}
      {showTagManager && (
        <>
          <div className="bl-overlay" onClick={() => { setShowTagManager(false); setEditingTagId(null); }} />
          <div className="bl-bottom-sheet bl-tag-manager-sheet">
            <div className="bl-sheet-handle" />
            <div className="bl-sheet-title">Manage Drink Tags</div>
            <p className="bl-sheet-subtitle">Create custom tags to organize your bar</p>

            {/* New tag input — 16px font per iOS-2 (no zoom-on-focus) */}
            <div className="bl-tag-create-row">
              <input
                type="text"
                className="bl-tag-create-input"
                placeholder="New tag name…"
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateTag(); }}
                maxLength={30}
              />
              <button
                className="bl-tag-create-btn"
                onClick={handleCreateTag}
                disabled={!newTagName.trim()}
              >
                <Plus size={16} strokeWidth={2.5} />
              </button>
            </div>

            {/* Existing tags */}
            <div className="bl-tag-list">
              {drinkTags.map(tag => (
                <div key={tag.id} className="bl-tag-row">
                  {editingTagId === tag.id ? (
                    <div className="bl-tag-edit-row">
                      <input
                        type="text"
                        className="bl-tag-create-input"
                        value={editingTagName}
                        onChange={e => setEditingTagName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRenameTag(tag.id); }}
                        autoFocus
                      />
                      <button className="bl-tag-save-btn" onClick={() => handleRenameTag(tag.id)}>
                        <Check size={14} strokeWidth={2.5} />
                      </button>
                      <button className="bl-tag-cancel-btn" onClick={() => setEditingTagId(null)}>✕</button>
                    </div>
                  ) : (
                    <>
                      <span className="bl-tag-row-dot" style={{ background: tag.color }} />
                      <span className="bl-tag-row-name">{tag.emoji} {tag.name}</span>
                      <span className="bl-tag-row-count">
                        {drinks.filter(d => (d.tags || []).includes(tag.name)).length}
                      </span>
                      <button
                        className="bl-tag-row-action"
                        onClick={() => { setEditingTagId(tag.id); setEditingTagName(tag.name); }}
                        title="Rename"
                      >
                        <Pencil size={13} strokeWidth={2} />
                      </button>
                      <button
                        className="bl-tag-row-action bl-tag-row-delete"
                        onClick={() => handleDeleteTag(tag.id)}
                        title="Delete"
                      >
                        <Trash2 size={13} strokeWidth={2} />
                      </button>
                    </>
                  )}
                </div>
              ))}
              {drinkTags.length === 0 && (
                <p style={{ textAlign: 'center', color: 'var(--text-light)', fontSize: 13, padding: 16 }}>
                  No tags yet — create one above
                </p>
              )}
            </div>

            <button
              className="bl-sheet-button bl-sheet-cancel"
              onClick={() => { setShowTagManager(false); setEditingTagId(null); }}
            >
              Done
            </button>
          </div>
        </>
      )}

      {/* ── Bulk Tag Picker sheet (multi-select mode, Phase 3.4.1) ── */}
      {showBulkTagPicker && (
        <>
          <div className="bl-overlay" onClick={() => setShowBulkTagPicker(false)} />
          <div className="bl-bottom-sheet">
            <div className="bl-sheet-handle" />
            <div className="bl-sheet-title">Tag {selectedIds.size} Drink{selectedIds.size !== 1 ? 's' : ''}</div>
            {drinkTags.map(tag => (
              <button
                key={tag.id}
                className="bl-sheet-button"
                onClick={() => handleBulkTag(tag.name)}
              >
                <span className="bl-tag-row-dot" style={{ background: tag.color }} />
                <span>{tag.emoji} {tag.name}</span>
              </button>
            ))}
            {drinkTags.length === 0 && (
              <p style={{ textAlign: 'center', color: 'var(--text-light)', fontSize: 13, padding: 16 }}>
                No tags yet — create tags in the tag manager first
              </p>
            )}
            <button className="bl-sheet-button bl-sheet-cancel" onClick={() => setShowBulkTagPicker(false)}>
              Cancel
            </button>
          </div>
        </>
      )}

      {/* Delete Confirmation */}
      {confirmDelete && (
        <>
          <div className="bl-overlay" onClick={() => setConfirmDelete(null)} />
          <div className="bl-delete-sheet">
            <div className="bl-sheet-handle" />
            <div className="bl-delete-message">Delete this drink? This cannot be undone.</div>
            <div className="bl-delete-actions">
              <button
                className="bl-delete-btn bl-delete-btn-confirm"
                onClick={() => { onDelete?.(confirmDelete); setConfirmDelete(null); }}
              >
                Yes, Delete Drink
              </button>
              <button
                className="bl-delete-btn bl-delete-btn-cancel"
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {/* Options menu */}
      {showMenu && (
        <>
          <div className={'bl-overlay' + (menuAnimation ? ' closing' : '')} onClick={handleMenuClose} />
          <div className={'bl-bottom-sheet' + (menuAnimation ? ' closing' : '')}>
            <div className="bl-sheet-handle" />
            <div className="bl-sheet-title">Bar Options</div>
            <button className="bl-sheet-button" onClick={handleBackup}>Backup Bar</button>
            <button className="bl-sheet-button" onClick={() => restoreRef.current?.click()}>Restore Backup</button>
            <input ref={restoreRef} type="file" accept=".json" onChange={handleRestore} style={{ display: 'none' }} />
            {/* 1.1: dev/QA affordance — the instagram import cache is now keyed
                by url+type (drink vs meal), so a cold re-import needs the old
                cached entry cleared first when testing the fix
                (bar-library-parity-plan-2026-08-07.md 1.1 "Verify first"). */}
            <button
              className="bl-sheet-button"
              onClick={async () => {
                hapticLight();
                await clearInstagramCache();
                onToast?.('Import cache cleared');
                handleMenuClose();
              }}
            >
              Clear Import Cache
            </button>
            {/* Phase 3.2: barShopping.js wired in — was built and tested but
                consumed by nothing until now. */}
            <button
              className="bl-sheet-button"
              onClick={() => { hapticLight(); handleMenuClose(); setShowShoppingList(true); }}
            >
              Shopping List{shoppingList.summary.totalMissing > 0 ? ` (${shoppingList.summary.totalMissing})` : ''}
            </button>
          </div>
        </>
      )}

      {/* ── Bar shopping list sheet (Phase 3.2) ── */}
      {showShoppingList && (
        <>
          <div className="bl-overlay" onClick={() => setShowShoppingList(false)} />
          <div className="bl-bottom-sheet bl-shoplist-sheet">
            <div className="bl-sheet-handle" />
            <div className="bl-sheet-title">Bar Shopping List</div>
            {shoppingList.items.length === 0 ? (
              <p className="bl-shoplist-empty">Nothing to buy — your bar is fully stocked!</p>
            ) : (
              <>
                <p className="bl-shoplist-summary">
                  {shoppingList.summary.totalMissing} item{shoppingList.summary.totalMissing !== 1 ? 's' : ''}
                  {shoppingList.summary.unlockableDrinks > 0
                    ? ` · unlocks ${shoppingList.summary.unlockableDrinks} drink${shoppingList.summary.unlockableDrinks !== 1 ? 's' : ''}`
                    : ''}
                </p>
                <div className="bl-shoplist-items">
                  {shoppingList.items.map(item => (
                    <div key={item.ingredient} className={'bl-shoplist-item bl-shoplist-priority-' + item.priority}>
                      <span className="bl-shoplist-item-name">{item.displayName}</span>
                      <span className="bl-shoplist-item-needed">needed for {item.neededBy.join(', ')}</span>
                    </div>
                  ))}
                </div>
                <div className="bl-shoplist-actions">
                  <button
                    className="bl-sheet-button"
                    onClick={() => {
                      hapticLight();
                      onAddMissingToGrocery?.(
                        shoppingList.items.map(item => ({ name: item.displayName, tag: 'bar-quest' })),
                      );
                      onToast?.(`Added ${shoppingList.items.length} item${shoppingList.items.length !== 1 ? 's' : ''} to your grocery list`);
                      setShowShoppingList(false);
                    }}
                  >
                    Add All to Grocery List
                  </button>
                  <button
                    className="bl-sheet-button"
                    onClick={() => shareText('Bar Shopping List', exportShoppingListText(shoppingList), onToast)}
                  >
                    Share / Copy List
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ── Share to friend picker ── */}
      <SharePickerSheet
        open={!!friendShareDrink}
        onClose={() => setFriendShareDrink(null)}
        meal={friendShareDrink}
        itemType="drink"
        showToast={onToast}
      />
    </div>
  );
}
