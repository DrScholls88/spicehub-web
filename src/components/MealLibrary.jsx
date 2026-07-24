import { useState, useRef, useEffect, useCallback } from 'react';
import { ChefHat, UtensilsCrossed, MoreHorizontal, Play, Sparkles, Heart, Repeat, Clock, AlertTriangle, Tag, Plus, Pencil, Trash2, Check, X, Grid2x2, Grid3x3, List, HelpCircle } from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { downloadMealsFile, importMealsFromJson, shareMealsFile } from '../sync';
import { toggleRotation, bulkSetRotation, getUserTags, addUserTag, deleteUserTag, renameUserTag, reorderUserTags, setMealTags, bulkSetMealTags } from '../db';
import db from '../db';
import useBackHandler from '../hooks/useBackHandler';
import SafeMediaImage from './SafeMediaImage';
import ReExtractSheet from './ReExtractSheet';
import DiscoverRecipes from './DiscoverRecipes';
import { hapticLight, hapticSuccess } from '../haptics';
import { getMealVideoSource } from '../lib/videoSource';

// I-5: a recipe is "improvable" when it was imported with a low-confidence /
// needs-review flag AND we kept its source caption (so we can re-run extraction
// on the cached text — no re-scrape). Recipes without a caption can't be re-run.
function isImprovable(meal) {
  if (!meal || meal.status === 'processing' || meal.status === 'failed') return false;
  const hasCaption = typeof meal.sourceCaption === 'string' && meal.sourceCaption.trim().length > 20;
  if (!hasCaption) return false;
  return meal.needsReview === true
    || (typeof meal.confidence === 'number' && meal.confidence < 0.75)
    || (typeof meal._postProcessAudit?.movedCount === 'number' && meal._postProcessAudit.movedCount > 2);
}

// Friendly engine label from `meal._structuredVia` (read-only; null when absent)
function mealEngineLabel(structuredVia) {
  if (!structuredVia || typeof structuredVia !== 'string') return null;
  const v = structuredVia.toLowerCase();
  if (v.startsWith('grok')) return 'Grok';
  if (v.startsWith('gemini')) return 'Gemini';
  if (v.startsWith('server')) return 'Server';
  if (v.startsWith('heuristic')) return 'Basic parser';
  return null;
}

// ── Date formatter: relative for recent, absolute for older ──────────────────
function formatAddedDate(isoString) {
  if (!isoString) return null;
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return null;
    const diffMs = Date.now() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays < 1)  return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7)  return `${diffDays}d ago`;
    const month = d.toLocaleString('default', { month: 'short' });
    const day   = d.getDate();
    const year  = d.getFullYear();
    return year === new Date().getFullYear() ? `${month} ${day}` : `${month} ${day}, ${year}`;
  } catch { return null; }
}

// Thin wrapper: maps SafeMediaImage into tile-image card usage
function CardImage({ src, alt, className, phClass }) {
  if (!src) return (
    <div className={phClass} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <UtensilsCrossed size={28} strokeWidth={1.5} style={{ opacity: 0.35 }} />
    </div>
  );
  return (
    <SafeMediaImage
      src={src}
      alt={alt || ''}
      className={className}
      fallbackEmoji="🍽️"
      style={null}
    />
  );
}

// ── Meal "Type" — the structural role of a meal (single-select, one per meal).
// Shown as section grouping headers in the gallery, not as filter chips.
const TYPE_OPTIONS = ['Dinners', 'Breakfasts', 'Lunches', 'Desserts', 'Sides', 'Tailgate', 'Snacks'];
// Legacy alias for external consumers (AddEditMeal, etc.)
const CATEGORY_OPTIONS = TYPE_OPTIONS;

const TYPE_COLORS = {
  Dinners:    '#e07b4f',
  Breakfasts: '#f4c56a',
  Lunches:    '#6dbf8d',
  Desserts:   '#d479b8',
  Sides:      '#7ab8e0',
  Tailgate:   '#c97040',
  Snacks:     '#9b8fe0',
};
// Legacy alias
const CATEGORY_COLORS = TYPE_COLORS;

// ── Smart view filters — computed views, not assignable.
const FIVE_OR_LESS = '5 or Less';
const QUICK_WEEKNIGHT = 'Quick';
const QUICK_WEEKNIGHT_MAX_MIN = 30;

// View tabs: these are the top-level view modes, NOT assignable to meals.
const VIEW_FILTERS = ['All', 'The Rotation', FIVE_OR_LESS, QUICK_WEEKNIGHT];

// Legacy export for anything consuming MEAL_CATEGORIES externally
export const MEAL_CATEGORIES = [...VIEW_FILTERS, ...CATEGORY_OPTIONS];

// Count ingredients from the structured list (source of truth) with a fallback
// to the legacy array/string field for meals not yet upgraded.
function getIngredientCount(meal) {
  if (Array.isArray(meal.ingredientsStructured) && meal.ingredientsStructured.length) {
    return meal.ingredientsStructured.length;
  }
  if (Array.isArray(meal.ingredients)) return meal.ingredients.length;
  if (typeof meal.ingredients === 'string') {
    return meal.ingredients.split(/\n|,/).map(s => s.trim()).filter(Boolean).length;
  }
  return 0;
}

// Parse a freeform time string ("15 min", "1 hr 30 min", "PT30M", "45") to minutes.
function parseTimeToMinutes(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (!s) return null;
  // ISO 8601 duration, e.g. PT1H30M
  const iso = s.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/i);
  if (iso) {
    const h = parseInt(iso[1] || '0', 10);
    const m = parseInt(iso[2] || '0', 10);
    return h * 60 + m;
  }
  let total = 0;
  const hrMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h\b)/i);
  if (hrMatch) total += parseFloat(hrMatch[1]) * 60;
  const minMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m\b)/i);
  if (minMatch) total += parseFloat(minMatch[1]);
  if (total > 0) return Math.round(total);
  // Bare number — assume minutes
  const bare = s.match(/^(\d+(?:\.\d+)?)$/);
  if (bare) return Math.round(parseFloat(bare[1]));
  return null;
}

// A meal counts as "Quick Weeknight" if its total (or prep+cook) time is
// known and at or under QUICK_WEEKNIGHT_MAX_MIN. Meals with no time data
// don't match — we'd rather under-promise than mislabel an unknown as quick.
function getTotalMinutes(meal) {
  const total = parseTimeToMinutes(meal.totalTime);
  if (total != null) return total;
  const prep = parseTimeToMinutes(meal.prepTime) || 0;
  const cook = parseTimeToMinutes(meal.cookTime) || 0;
  if (prep || cook) return prep + cook;
  return null;
}

// Speed-dial action reveal: rise + fade, staggered from the main FAB
const fabActionVariants = {
  closed: { opacity: 0, y: 14, scale: 0.9, transition: { duration: 0.12 } },
  open: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 420, damping: 26 } },
};

export default function MealLibrary({ meals, onAdd, onEdit, onDelete, onViewDetail, onShare, onImport, onImportUrl, onImportZip, onReload, onToast, onToggleFavorite, onRate, onPlayVideo, onLoadStarterPack, onMoveToBar }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showOptionsSheet, setShowOptionsSheet] = useState(false);
  const [fabOpen, setFabOpen] = useState(false); // speed-dial: + expands to add/import
  const [showDiscover, setShowDiscover] = useState(false); // Discover Recipes overlay
  const [reExtractMeal, setReExtractMeal] = useState(null); // I-5: meal being re-extracted
  const [quickPreview, setQuickPreview] = useState(null); // meal object for popup
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [userTags, setUserTags] = useState([]);
  const [activeTags, setActiveTags] = useState([]); // active tag names for filtering
  const [collapsedSections, setCollapsedSections] = useState({}); // { category: true }
  const [showTagManager, setShowTagManager] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(null); // meal id for single-meal tag picker
  const [showBulkTagPicker, setShowBulkTagPicker] = useState(false); // bulk tag picker
  const [newTagName, setNewTagName] = useState('');
  const [editingTagId, setEditingTagId] = useState(null);
  const [editingTagName, setEditingTagName] = useState('');
  const [gridLayout, setGridLayout] = useState(() => {
    try { return localStorage.getItem('ml-grid-layout') || '2x'; } catch { return '2x'; }
  }); // '2x' | '3x' | 'list'
  const [showRotationTip, setShowRotationTip] = useState(false);
  const restoreRef = useRef(null);
  const categoryScrollRef = useRef(null);
  const longPressTimer = useRef(null);
  const touchStartPos = useRef(null); // {x, y} at touchStart — cancel long-press on scroll

  // Long-press-to-rearrange/delete for custom tag chips only (built-in
  // categories stay fixed order — see project_meallibrary_label_bar memory).
  const [tagEditMode, setTagEditMode] = useState(false);
  const tagLongPressTimer = useRef(null);
  const tagTouchStartPos = useRef(null);

  // Swipe-to-dismiss state for quickPreview sheet
  const sheetRef = useRef(null);
  const sheetDragStartY = useRef(null);
  const sheetCurrentDragY = useRef(0);

  const [reimportingPhotoId, setReimportingPhotoId] = useState(null);

  const handleGridChange = useCallback((layout) => {
    setGridLayout(layout);
    hapticLight();
    try { localStorage.setItem('ml-grid-layout', layout); } catch {}
  }, []);

  // ── Load user tags from DB ────────────────────────────────────────────────
  const refreshTags = useCallback(async () => {
    const tags = await getUserTags();
    setUserTags(tags);
  }, []);

  useEffect(() => { refreshTags(); }, [refreshTags]);
  // Also refresh tags when meals reload (parent may have changed them)
  useEffect(() => { refreshTags(); }, [meals, refreshTags]);

  // ── Filtered + sorted meal list ────────────────────────────────────────────
  const filtered = meals.filter(m => {
    // Parse positive and negative tokens
    const tokens = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const positiveTokens = tokens.filter(t => !t.startsWith('-'));
    const negativeTokens = tokens.filter(t => t.startsWith('-')).map(t => t.slice(1));
    const name = (m.name || '').toLowerCase();
    const ingredients = Array.isArray(m.ingredients)
      ? m.ingredients.join(' ').toLowerCase()
      : (m.ingredients || '').toLowerCase();
    const desc = (m.description || m.notes || '').toLowerCase();
    const searchable = `${name} ${ingredients} ${desc}`;
    const matchSearch = positiveTokens.every(t => searchable.includes(t))
      && negativeTokens.every(t => !searchable.includes(t));
    let matchCat;
    if (category === 'All') matchCat = true;
    else if (category === 'The Rotation') matchCat = !!m.inRotation;
    else if (category === FIVE_OR_LESS) matchCat = getIngredientCount(m) > 0 && getIngredientCount(m) <= 5;
    else if (category === QUICK_WEEKNIGHT) {
      const mins = getTotalMinutes(m);
      matchCat = mins != null && mins <= QUICK_WEEKNIGHT_MAX_MIN;
    }
    else matchCat = (m.category || 'Dinners').toLowerCase() === category.toLowerCase();
    // Tag filter: if any tags are active, meal must have ALL of them
    const matchTags = activeTags.length === 0
      || activeTags.every(t => (m.tags || []).includes(t));
    return matchSearch && matchCat && matchTags;
  });

  const rotationCount = meals.filter(m => m.inRotation).length;

  // Sort: favorites first, then by creation date (newest first)
  const sorted = [...filtered].sort((a, b) => {
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    const aDate = a.importedAt || a.createdAt || a.created || '';
    const bDate = b.importedAt || b.createdAt || b.created || '';
    return bDate.localeCompare(aDate);
  });

  // ── Ghost-selection cleanup: remove deleted meal IDs from selectedIds ──────
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const liveMealIds = new Set(meals.map(m => m.id));
    const hasGhosts = [...selectedIds].some(id => !liveMealIds.has(id));
    if (hasGhosts) {
      setSelectedIds(prev => {
        const cleaned = new Set([...prev].filter(id => liveMealIds.has(id)));
        if (cleaned.size === 0) setSelectMode(false);
        return cleaned;
      });
    }
  }, [meals, selectedIds]);

  // ── Backup / Restore ───────────────────────────────────────────────────────
  const handleBackup = async () => {
    setShowOptionsSheet(false);
    if (navigator.canShare) {
      try { await shareMealsFile(); return; } catch { /* fall through to download */ }
    }
    await downloadMealsFile();
    onToast?.('Backup downloaded');
  };

  const handleRestore = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { added, skipped } = await importMealsFromJson(text);
      onReload?.();
      onToast?.(`Restored ${added} meal${added !== 1 ? 's' : ''}${skipped ? ` (${skipped} duplicates skipped)` : ''}`);
    } catch (err) {
      onToast?.('Restore failed: ' + err.message, 'error');
    }
    e.target.value = '';
    setShowOptionsSheet(false);
  };

  const closeConfirmDelete = () => setConfirmDeleteId(null);

  // ── Long-press with movement threshold ────────────────────────────────────
  const LONG_PRESS_MS = 500;
  const MOVE_THRESHOLD_PX = 8;

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    touchStartPos.current = null;
  }, []);

  // Long press (non-select mode) → show quick preview
  const handleTouchStart = useCallback((meal, e) => {
    if (selectMode) return;
    const touch = e.changedTouches?.[0];
    touchStartPos.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      hapticLight();
      setQuickPreview(meal);
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

  // touchend: clean up the long-press timer. (The fling-up gesture that used to launch
  // the floating video player has been removed — the video player is launched only via
  // the ▶ play badge and the quick-preview "Play Video" button.)
  const handleTouchEnd = useCallback(() => {
    cancelLongPress();
  }, [cancelLongPress]);

  // Long press (non-select mode) → enter multi-select
  const handleLongPressSelect = useCallback((meal, e) => {
    if (selectMode) return;
    const touch = e.changedTouches?.[0];
    touchStartPos.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      setSelectMode(true);
      setSelectedIds(new Set([meal.id]));
    }, LONG_PRESS_MS);
  }, [selectMode]);

  // ── Long-press a custom tag chip → enter rearrange/delete mode ───────────
  // Same movement-cancel convention as the meal-tile long-press above, kept
  // on separate refs/timers since a tag-chip press and a tile press can't
  // overlap but sharing one timer would be a subtle bug waiting to happen.
  const cancelTagLongPress = useCallback(() => {
    if (tagLongPressTimer.current) {
      clearTimeout(tagLongPressTimer.current);
      tagLongPressTimer.current = null;
    }
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

  const handleTagTouchEnd = useCallback(() => {
    cancelTagLongPress();
  }, [cancelTagLongPress]);

  // Drag-reorder inside edit mode — optimistic local order + persisted sortOrder.
  const handleReorderTags = useCallback((newOrder) => {
    setUserTags(newOrder);
    reorderUserTags(newOrder.map(t => t.id)).catch(() => {});
  }, []);

  // ── Swipe-to-dismiss on quickPreview sheet ────────────────────────────────
  const handleSheetTouchStart = useCallback((e) => {
    sheetDragStartY.current = e.touches[0].clientY;
    sheetCurrentDragY.current = 0;
    if (sheetRef.current) sheetRef.current.style.transition = 'none';
  }, []);

  const handleSheetTouchMove = useCallback((e) => {
    if (sheetDragStartY.current === null) return;
    const dy = e.touches[0].clientY - sheetDragStartY.current;
    if (dy <= 0) return; // no pulling up
    sheetCurrentDragY.current = dy;
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${dy}px)`;
    }
  }, []);

  const handleSheetTouchEnd = useCallback(() => {
    const dy = sheetCurrentDragY.current;
    if (dy > 80) {
      // Animate sheet offscreen manually, THEN unmount — avoids FM entrance/exit state mismatch
      if (sheetRef.current) {
        sheetRef.current.style.transition = 'transform 0.22s cubic-bezier(0.25, 0.8, 0.5, 1)';
        sheetRef.current.style.transform = 'translateY(110%)';
      }
      sheetDragStartY.current = null;
      sheetCurrentDragY.current = 0;
      setTimeout(() => setQuickPreview(null), 230);
      return;
    }
    // Snap back
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'transform 0.25s cubic-bezier(0.25, 0.8, 0.5, 1)';
      sheetRef.current.style.transform = '';
    }
    sheetDragStartY.current = null;
    sheetCurrentDragY.current = 0;
  }, []);

  // ── Multi-select handlers ──────────────────────────────────────────────────
  const toggleSelect = (mealId) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(mealId)) next.delete(mealId);
      else next.add(mealId);
      if (next.size === 0) setSelectMode(false);
      return next;
    });
  };

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setShowCategoryPicker(false);
  }, []);

  const handleSelectAll = () => {
    setSelectedIds(new Set(sorted.map(m => m.id)));
  };

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!window.confirm(`Delete ${count} meal${count !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    for (const id of selectedIds) {
      onDelete?.(id);
    }
    onToast?.(`Deleted ${count} meal${count !== 1 ? 's' : ''}`);
    exitSelectMode();
  };

  const handleBatchShare = async () => {
    if (selectedIds.size === 0) return;
    const selected = meals.filter(m => selectedIds.has(m.id));
    if (selected.length === 1) {
      onShare?.(selected[0]);
    } else {
      const text = selected.map(m =>
        `${m.name}\n\nIngredients:\n${(m.ingredients || []).join('\n')}\n\nDirections:\n${(m.directions || []).join('\n')}`
      ).join('\n\n---\n\n');
      if (navigator.share) {
        try { await navigator.share({ title: `${selected.length} SpiceHub Recipes`, text }); }
        catch { /* cancelled */ }
      } else {
        await navigator.clipboard?.writeText(text);
        onToast?.(`${selected.length} recipes copied to clipboard`);
      }
    }
    exitSelectMode();
  };

  // ── Single-meal type change (quick-preview) ────────────────────────────
  const handleSetMealType = useCallback(async (mealId, newType) => {
    try {
      await db.meals.update(mealId, { category: newType });
      onReload?.();
      // Update quickPreview in place so the chip reflects instantly
      setQuickPreview(prev => prev && prev.id === mealId ? { ...prev, category: newType } : prev);
    } catch (err) {
      onToast?.('Failed to update type: ' + err.message, 'error');
    }
  }, [onReload, onToast]);

  // ── Batch set category ────────────────────────────────────────────────────
  const handleBatchSetCategory = useCallback(async (newCategory) => {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    try {
      await Promise.all(ids.map(id => db.meals.update(id, { category: newCategory })));
      onReload?.();
      onToast?.(`Set category to "${newCategory}" for ${ids.length} meal${ids.length !== 1 ? 's' : ''}`);
    } catch (err) {
      onToast?.('Failed to update categories: ' + err.message, 'error');
    }
    setShowCategoryPicker(false);
    exitSelectMode();
  }, [selectedIds, onReload, onToast, exitSelectMode]);

  // ── Rotation handler ─────────────────────────────────────────────────────
  const handleToggleRotation = useCallback(async (meal) => {
    const newVal = !meal.inRotation;
    await toggleRotation(meal.id, newVal);
    onReload?.();
    onToast?.(newVal ? `Added "${meal.name}" to The Rotation` : `Removed "${meal.name}" from The Rotation`);
  }, [onReload, onToast]);

  const handleBatchAddToRotation = useCallback(async () => {
    if (selectedIds.size === 0) return;
    await bulkSetRotation([...selectedIds], true);
    onReload?.();
    onToast?.(`Added ${selectedIds.size} meal${selectedIds.size !== 1 ? 's' : ''} to The Rotation`);
    exitSelectMode();
  }, [selectedIds, onReload, onToast, exitSelectMode]);

  // ── Tag filter toggle ─────────────────────────────────────────────────────
  const handleTagToggle = useCallback((tagName) => {
    hapticLight();
    setActiveTags(prev =>
      prev.includes(tagName) ? prev.filter(t => t !== tagName) : [...prev, tagName]
    );
  }, []);

  // ── Tag management ──────────────────────────────────────────────────────
  const handleCreateTag = useCallback(async () => {
    if (!newTagName.trim()) return;
    const TAG_COLORS = ['#4CAF50', '#2196F3', '#FF9800', '#E91E63', '#9C27B0', '#00BCD4', '#FF5722', '#607D8B', '#795548', '#CDDC39'];
    const color = TAG_COLORS[userTags.length % TAG_COLORS.length];
    await addUserTag({ name: newTagName.trim(), color, emoji: '🏷️' });
    setNewTagName('');
    await refreshTags();
  }, [newTagName, userTags.length, refreshTags]);

  const handleDeleteTag = useCallback(async (tagId) => {
    const tag = userTags.find(t => t.id === tagId);
    if (!tag) return;
    if (!window.confirm(`Delete "${tag.name}" tag? It will be removed from all meals.`)) return;
    await deleteUserTag(tagId);
    setActiveTags(prev => prev.filter(t => t !== tag.name));
    await refreshTags();
    onReload?.();
  }, [userTags, refreshTags, onReload]);

  const handleRenameTag = useCallback(async (tagId) => {
    if (!editingTagName.trim()) return;
    await renameUserTag(tagId, editingTagName.trim());
    setEditingTagId(null);
    setEditingTagName('');
    await refreshTags();
    onReload?.();
  }, [editingTagName, refreshTags, onReload]);

  // ── Single-meal tag assignment ──────────────────────────────────────────
  const handleToggleMealTag = useCallback(async (mealId, tagName) => {
    hapticLight();
    const meal = meals.find(m => m.id === mealId);
    if (!meal) return;
    const current = Array.isArray(meal.tags) ? meal.tags : [];
    const newTags = current.includes(tagName)
      ? current.filter(t => t !== tagName)
      : [...current, tagName];
    await setMealTags(mealId, newTags);
    // Quick-preview holds its own snapshot of the meal (set at open time), so
    // a reload alone doesn't touch it — without this the tapped chip only
    // shows as active after closing and reopening the sheet.
    setQuickPreview(prev => prev && prev.id === mealId ? { ...prev, tags: newTags } : prev);
    onReload?.();
  }, [meals, onReload]);

  // ── Bulk tag assignment ─────────────────────────────────────────────────
  const handleBulkTag = useCallback(async (tagName) => {
    if (selectedIds.size === 0) return;
    await bulkSetMealTags([...selectedIds], tagName, true);
    onReload?.();
    onToast?.(`Tagged ${selectedIds.size} meal${selectedIds.size !== 1 ? 's' : ''} with "${tagName}"`);
    setShowBulkTagPicker(false);
    exitSelectMode();
  }, [selectedIds, onReload, onToast, exitSelectMode]);

  // ── Section collapse toggle ─────────────────────────────────────────────
  const toggleSection = useCallback((sectionKey) => {
    hapticLight();
    setCollapsedSections(prev => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  }, []);

  // ── Group sorted meals by category for collapsible sections ──────────────
  const groupedByCategory = (() => {
    // Only group when viewing All, no search, no tag filter
    if (category !== 'All' || search || activeTags.length > 0) return null;
    const groups = {};
    for (const meal of sorted) {
      const cat = meal.category || 'Dinners';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(meal);
    }
    // Sort groups by CATEGORY_OPTIONS order, unknown cats at end
    const catOrder = CATEGORY_OPTIONS.reduce((m, c, i) => { m[c] = i; return m; }, {});
    return Object.entries(groups).sort(([a], [b]) =>
      (catOrder[a] ?? 999) - (catOrder[b] ?? 999)
    );
  })();

  // ── Re-import photo ───────────────────────────────────────────────────────
  const handleReimportPhoto = useCallback(async (meal) => {
    const sourceUrl = meal.link || meal.sourceUrl;
    if (!sourceUrl) { onToast?.('No source URL to search for a photo'); return; }
    setReimportingPhotoId(meal.id);
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
        await db.meals.update(meal.id, { imageUrl: data.imageUrl });
        onReload?.();
        onToast?.('📸 Found a better photo!');
      } else {
        onToast?.('No better photo found for this recipe');
      }
    } catch {
      onToast?.('Photo search failed — check your connection and try again');
    } finally {
      setReimportingPhotoId(null);
    }
  }, [onToast, onReload]);

  // ── Tile click handler — safe for broken meals ────────────────────────────
  const handleTileClick = useCallback((meal) => {
    if (selectMode) {
      toggleSelect(meal.id);
      return;
    }
    // Failed imports: tap opens delete confirm instead of crashing detail view
    if (meal.status === 'failed') {
      setConfirmDeleteId(meal.id);
      return;
    }
    // Tap → expand the tile into the centered expandable card (shared-element morph).
    // "View Full Recipe" inside the card still routes to the full detail view.
    hapticLight();
    setQuickPreview(meal);
  }, [selectMode]);

  // ── Hardware back button (Android PWA) ───────────────────────────────────
  useBackHandler(selectMode, exitSelectMode, 'meal-select');
  useBackHandler(fabOpen, () => setFabOpen(false), 'meal-fab');
  useBackHandler(!!reExtractMeal, () => setReExtractMeal(null), 'meal-reextract');
  useBackHandler(!!quickPreview, () => setQuickPreview(null), 'meal-quickpreview');
  useBackHandler(showDiscover, () => setShowDiscover(false), 'meal-discover');
  useBackHandler(showTagManager, () => { setShowTagManager(false); setEditingTagId(null); }, 'meal-tagmgr');
  useBackHandler(showBulkTagPicker, () => setShowBulkTagPicker(false), 'meal-bulktag');

  // ── Escape key closes the expandable card (desktop / keyboard) ──────────────
  useEffect(() => {
    if (!quickPreview) return;
    const onKey = (e) => { if (e.key === 'Escape') setQuickPreview(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [quickPreview]);

  // ── Render Tile ────────────────────────────────────────────────────────────
  const renderTile = (meal, idx) => (
    <motion.div
      key={meal.id}
      layout="position"
      initial={{ opacity: 0, y: 14, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.88, transition: { duration: 0.14 } }}
      transition={{
        type: 'spring',
        stiffness: 480,
        damping: 32,
        delay: Math.min(idx * 0.03, 0.22),
      }}
      whileHover={!selectMode ? {
        y: -3,
        scale: 1.02,
        transition: { type: 'spring', stiffness: 300, damping: 20, delay: 0 },
      } : undefined}
      whileTap={{ scale: 0.96, transition: { duration: 0.1 } }}
      className={[
        'ml-tile',
        selectMode && selectedIds.has(meal.id) ? 'ml-tile-selected' : '',
        meal.status === 'failed' ? 'ml-tile-failed' : '',
      ].filter(Boolean).join(' ')}
      onClick={() => handleTileClick(meal)}
      onTouchStart={e => selectMode ? handleLongPressSelect(meal, e) : handleTouchStart(meal, e)}
      onTouchMove={handleTouchMove}
      onTouchEnd={e => handleTouchEnd(meal, e)}
      onTouchCancel={e => handleTouchEnd(meal, e)}
      onContextMenu={e => {
        e.preventDefault();
        if (selectMode) toggleSelect(meal.id);
        else { hapticLight(); setQuickPreview(meal); }
      }}
    >
      {/* Select checkbox overlay */}
      {selectMode && (
        <div className="ml-tile-check">
          <span>{selectedIds.has(meal.id) ? '✓' : ''}</span>
        </div>
      )}

      {/* Image area */}
      <motion.div className="ml-tile-image" layoutId={`ml-card-img-${meal.id}`}>
        <CardImage
          src={meal.imageUrl}
          alt={meal.name || 'Recipe'}
          className="ml-tile-img"
          phClass="ml-tile-placeholder"
        />
        {meal.isFavorite && <span className="ml-tile-fav"><Heart size={15} fill="#e53935" color="#e53935" aria-label="Favorite" /></span>}
        {meal.inRotation && <span className="ml-tile-rotation"><Repeat size={13} strokeWidth={2.5} aria-label="In rotation" /></span>}
        {meal.category && meal.category !== 'Dinners' && (
          <span className="ml-tile-cat">{meal.category}</span>
        )}
        {/* I-5: low-confidence import → one-tap re-extraction */}
        {!selectMode && isImprovable(meal) && (
          <button
            className="ml-tile-improve"
            aria-label="Improve this recipe with the latest engine"
            title="Low-confidence import — tap to re-run extraction"
            onClick={e => { e.stopPropagation(); hapticLight(); setReExtractMeal(meal); }}
            onTouchEnd={e => e.stopPropagation()}
          >
            <Sparkles size={13} strokeWidth={2.5} aria-hidden="true" /> Improve
          </button>
        )}
        {/* ⋯ menu button — always visible, bottom-right of image */}
        {!selectMode && (
          <button
            className="ml-tile-menu-btn"
            aria-label="More options"
            onClick={e => { e.stopPropagation(); hapticLight(); setQuickPreview(meal); }}
            onTouchEnd={e => e.stopPropagation()}
          >
            <MoreHorizontal size={18} strokeWidth={2.5} />
          </button>
        )}
        {/* PiP: play video badge — only on cards with a YouTube/Instagram source */}
        {!selectMode && onPlayVideo && (() => {
          const vsrc = getMealVideoSource(meal);
          if (!vsrc) return null;
          return (
            <button
              className={`ml-tile-play ml-tile-play-${vsrc.platform}`}
              aria-label={`Play ${vsrc.label} video in floating player`}
              title={`Play video (${vsrc.label})`}
              onClick={e => { e.stopPropagation(); hapticLight(); onPlayVideo(meal); }}
              onTouchEnd={e => e.stopPropagation()}
            >
              <Play size={14} fill="#fff" color="#fff" aria-hidden="true" />
            </button>
          );
        })()}
      </motion.div>

      {/* Info row */}
      <div className="ml-tile-info">
        <motion.span className="ml-tile-name" layoutId={`ml-card-title-${meal.id}`}>
          {/* Category color as a small dot, not a card side-stripe */}
          <span
            className="ml-tile-cat-dot"
            style={{ background: CATEGORY_COLORS[meal.category || 'Dinners'] || '#ccc' }}
            aria-hidden="true"
          />
          {meal.name || 'Untitled Recipe'}
        </motion.span>
        <span className="ml-tile-meta">
          {meal.starterKit && <span className="ml-tile-starter">Starter</span>}
          {meal.status === 'processing' ? (
            <><Clock size={12} strokeWidth={2.5} style={{ verticalAlign: '-2px' }} /> Import in progress…</>
          ) : meal.status === 'failed' ? (
            <><AlertTriangle size={12} strokeWidth={2.5} style={{ verticalAlign: '-2px' }} /> Import failed — tap to delete</>
          ) : (
            `${(meal.ingredients || []).length} ing · ${(meal.directions || []).length} steps`
          )}
        </span>
        {formatAddedDate(meal.importedAt || meal.createdAt || meal.created) && (
          <span
            className="ml-tile-added"
            title={meal.importedAt || meal.createdAt || meal.created}
          >
            {formatAddedDate(meal.importedAt || meal.createdAt || meal.created)}
          </span>
        )}
        {/* Notes may be a structured [{title,text}] array (post-2026-06-26 schema)
            or a legacy flat string — never render either raw, since React throws
            on plain-object children. This was the root cause of the "Meal Library
            goes blank" bug: any meal with populated structured notes (starter pack
            recipes always have them) crashed the whole tile render with no
            ErrorBoundary to catch it. */}
        {(() => {
          const notePreview = meal._notesFlat
            || (Array.isArray(meal.notes)
                ? meal.notes.map(n => (typeof n === 'string' ? n : n?.text || '')).filter(Boolean).join(' ')
                : (typeof meal.notes === 'string' ? meal.notes : ''));
          if (!notePreview) return null;
          return (
            <span className="ml-tile-notes">
              {notePreview.slice(0, 60)}{notePreview.length > 60 ? '…' : ''}
            </span>
          );
        })()}
      </div>
    </motion.div>
  );

  return (
    <div className="ml">

      {/* ── Search bar + rotation tooltip + grid toggle ── */}
      <div className="ml-search-zone" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          <button
            className="ml-rotation-tip-btn"
            onClick={() => { setShowRotationTip(p => !p); hapticLight(); }}
            aria-label="How does the spinner work?"
            style={{
              background: 'none', border: 'none', padding: 4, cursor: 'pointer',
              color: 'var(--text-muted, #999)', display: 'flex',
              transition: 'color .2s cubic-bezier(.32,.72,0,1)',
            }}
          >
            <HelpCircle size={16} strokeWidth={2} />
          </button>
          <AnimatePresence>
            {showRotationTip && (
              <motion.div
                initial={{ opacity: 0, x: -6, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -4, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                onClick={() => setShowRotationTip(false)}
                style={{
                  position: 'absolute', top: '50%', left: '100%', transform: 'translateY(-50%)',
                  zIndex: 40, marginLeft: 8,
                  padding: '7px 12px', borderRadius: 8,
                  background: 'var(--surface-raised, #1a1a1a)',
                  border: '1px solid var(--border, #333)',
                  boxShadow: '0 4px 16px rgba(0,0,0,.3)',
                  fontSize: 11, lineHeight: 1.4, color: 'var(--text, #eee)',
                  whiteSpace: 'nowrap', cursor: 'pointer',
                }}
              >
                🎰 Spinner only uses <span style={{ color: 'var(--primary, #FF6B35)', fontWeight: 600 }}>🔄 Rotation</span> meals
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <input
          type="text"
          placeholder="Search… (-exclude)"
          className="ml-search-input"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />
        <div className="ml-grid-toggle" style={{
          display: 'flex', gap: 2, padding: 2, borderRadius: 8,
          background: 'var(--surface-raised, #1a1a1a)',
          border: '1px solid var(--border, #2a2a2a)',
        }}>
          {[
            { id: '2x', icon: <Grid2x2 size={15} strokeWidth={2} />, label: '2 columns' },
            { id: '3x', icon: <Grid3x3 size={15} strokeWidth={2} />, label: '3 columns' },
            { id: 'list', icon: <List size={15} strokeWidth={2} />, label: 'List view' },
          ].map(opt => (
            <button
              key={opt.id}
              aria-label={opt.label}
              onClick={() => handleGridChange(opt.id)}
              style={{
                padding: '5px 7px', borderRadius: 6, border: 'none',
                background: gridLayout === opt.id ? 'var(--primary, #FF6B35)' : 'transparent',
                color: gridLayout === opt.id ? '#fff' : 'var(--text-muted, #888)',
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                transition: 'all .2s cubic-bezier(.32,.72,0,1)',
              }}
            >
              {opt.icon}
            </button>
          ))}
        </div>
      </div>

      {/* ── Row 1: View filter tabs — smart computed views (not assignable) ── */}
      <div className="ml-view-filters">
        {VIEW_FILTERS.map(v => (
          <motion.button
            key={v}
            className={`ml-view-tab${category === v ? ' ml-view-active' : ''}`}
            onClick={() => { hapticLight(); setCategory(v); }}
            whileTap={{ scale: 0.96 }}
          >
            {v === 'The Rotation' ? '🔄 Rotation' : v}
            {v === 'The Rotation' && rotationCount > 0 ? ` (${rotationCount})` : ''}
            {category === v && (
              <motion.span
                layoutId="ml-view-indicator"
                className="ml-view-underline"
                transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              />
            )}
          </motion.button>
        ))}
      </div>

      {/* ── Row 2: Tag chips — user-created multi-select labels ── */}
      <div className="ml-labels-scroll" ref={categoryScrollRef}>
        <div className="ml-labels-track">
          <button
            className="ml-label-add-btn"
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
              values={userTags}
              onReorder={handleReorderTags}
              className="ml-labels-reorder-group"
            >
              {userTags.map(tag => (
                <Reorder.Item
                  as="div"
                  key={tag.id}
                  value={tag}
                  layout
                  className="ml-label-chip ml-label-chip--tag ml-label-chip--editing"
                  whileDrag={{ scale: 1.08, zIndex: 2, boxShadow: '0 6px 16px -4px rgba(0,0,0,0.35)' }}
                >
                  <Tag size={11} strokeWidth={2.5} /> {tag.name}
                  <button
                    type="button"
                    className="ml-label-chip-remove"
                    onClick={(e) => { e.stopPropagation(); hapticLight(); handleDeleteTag(tag.id); }}
                    aria-label={`Delete ${tag.name} label`}
                  >
                    <X size={11} strokeWidth={3} />
                  </button>
                </Reorder.Item>
              ))}
            </Reorder.Group>
          ) : (
            userTags.map(tag => (
              <button
                key={tag.id}
                className={`ml-label-chip ml-label-chip--tag${activeTags.includes(tag.name) ? ' ml-tag-active' : ''}`}
                onClick={() => handleTagToggle(tag.name)}
                onTouchStart={handleTagTouchStart}
                onTouchMove={handleTagTouchMove}
                onTouchEnd={handleTagTouchEnd}
                onTouchCancel={handleTagTouchEnd}
                style={activeTags.includes(tag.name) ? { background: tag.color, borderColor: tag.color, color: '#fff' } : undefined}
              >
                <Tag size={11} strokeWidth={2.5} /> {tag.name}
                {(() => {
                  const count = meals.filter(m => (m.tags || []).includes(tag.name)).length;
                  return count > 0 ? <span className="ml-label-count">{count}</span> : null;
                })()}
              </button>
            ))
          )}

          {tagEditMode ? (
            <button
              className="ml-label-chip ml-label-done-btn"
              onClick={() => { hapticLight(); setTagEditMode(false); }}
            >
              <Check size={12} strokeWidth={3} /> Done
            </button>
          ) : (
            <button
              className="ml-label-chip ml-label-manage-btn"
              onClick={() => { hapticLight(); setShowTagManager(true); }}
            >
              <Pencil size={11} strokeWidth={2.5} /> Manage
            </button>
          )}
        </div>
      </div>

      {/* ── Multi-select toolbar ── */}
      <AnimatePresence>
      {selectMode && (
        <motion.div
          className="ml-select-toolbar"
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        >
          <button className="ml-select-toolbar-btn" onClick={exitSelectMode}>✕ Cancel</button>
          <span className="ml-select-count">{selectedIds.size} selected</span>
          <button className="ml-select-toolbar-btn" onClick={handleSelectAll}>All</button>
          <button
            className="ml-select-toolbar-btn"
            onClick={() => setShowCategoryPicker(true)}
            disabled={selectedIds.size === 0}
          >
            📁 Type
          </button>
          <button
            className="ml-select-toolbar-btn"
            onClick={() => setShowBulkTagPicker(true)}
            disabled={selectedIds.size === 0}
          >
            🏷️ Tag
          </button>
          <button
            className="ml-select-toolbar-btn"
            onClick={handleBatchAddToRotation}
            disabled={selectedIds.size === 0}
          >
            🔄 Rotation
          </button>
          <button
            className="ml-select-toolbar-btn"
            onClick={handleBatchShare}
            disabled={selectedIds.size === 0}
          >
            📤 Share
          </button>
          <button
            className="ml-select-toolbar-btn ml-select-delete"
            onClick={handleBatchDelete}
            disabled={selectedIds.size === 0}
          >
            🗑️ Delete
          </button>
        </motion.div>
      )}
      </AnimatePresence>

      {/* ── Gallery grid ── */}
      <div className={`ml-gallery ml-layout-${gridLayout}`}>
        {filtered.length === 0 ? (
          <motion.div
            className="ml-empty-state"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
          >
            <div className="ml-empty-icon"><ChefHat size={32} strokeWidth={1.75} /></div>
            {search || category !== 'All' || activeTags.length > 0 ? (
              <>
                <p className="ml-empty-text">No meals match your search.</p>
                <p className="ml-empty-hint">Try a different keyword, category, or tag.</p>
              </>
            ) : (
              <>
                <p className="ml-empty-text">Your recipe box is empty</p>
                <p className="ml-empty-hint">Load the starter pack for ready-to-spin meals, or import a recipe from a link.</p>
              </>
            )}
            {!search && category === 'All' && activeTags.length === 0 && (
              <div className="ml-empty-actions">
                {onLoadStarterPack && (
                  <button className="ml-empty-cta" type="button" onClick={onLoadStarterPack}>
                    Load starter recipes
                  </button>
                )}
                <button
                  className={onLoadStarterPack ? 'ml-empty-cta ml-empty-cta-secondary' : 'ml-empty-cta'}
                  type="button"
                  onClick={onImport}
                >
                  Import a Recipe
                </button>
              </div>
            )}
          </motion.div>
        ) : groupedByCategory ? (
          /* ── Collapsible sections by category ── */
          groupedByCategory.map(([catName, catMeals]) => (
            <div key={catName} className="ml-section">
              <button
                className="ml-section-header"
                onClick={() => toggleSection(catName)}
                aria-expanded={!collapsedSections[catName]}
              >
                <span
                  className="ml-section-dot"
                  style={{ background: CATEGORY_COLORS[catName] || '#ccc' }}
                />
                <span className="ml-section-title">{catName}</span>
                <span className="ml-section-count">{catMeals.length}</span>
                <span className={`ml-section-chevron${collapsedSections[catName] ? ' ml-section-chevron-collapsed' : ''}`}>▾</span>
              </button>
              {!collapsedSections[catName] && (
                <div className={`ml-section-grid ml-layout-${gridLayout}`}>
                  <AnimatePresence mode="popLayout">
                  {catMeals.map((meal, idx) => renderTile(meal, idx))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          ))
        ) : (
          /* ── Flat list (filtered / searched / tagged) ── */
          <AnimatePresence mode="popLayout">
          {sorted.map((meal, idx) => renderTile(meal, idx))}
          </AnimatePresence>
        )}
      </div>

      {/* ── Speed-dial FAB: single + expands to Create / Import ── */}
      <AnimatePresence>
        {fabOpen && (
          <motion.div
            key="ml-fab-scrim"
            className="ml-fab-scrim"
            onClick={() => setFabOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
        )}
      </AnimatePresence>

      <motion.div
        className="ml-fab-group"
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22, delay: 0.15 }}
      >
        <AnimatePresence>
          {fabOpen && (
            <motion.div
              key="ml-fab-actions"
              className="ml-fab-actions"
              initial="closed"
              animate="open"
              exit="closed"
              variants={{
                open: { transition: { staggerChildren: 0.06, delayChildren: 0.02 } },
                closed: { transition: { staggerChildren: 0.04, staggerDirection: -1 } },
              }}
            >
              <motion.button
                className="ml-fab-action"
                variants={fabActionVariants}
                onClick={() => { hapticLight(); setFabOpen(false); onImport?.(); }}
                whileTap={{ scale: 0.94 }}
              >
                <span className="ml-fab-action-label">Import Recipe</span>
                <span className="ml-fab-action-icon ml-fab-action-icon--import" aria-hidden="true">📥</span>
              </motion.button>
              <motion.button
                className="ml-fab-action"
                variants={fabActionVariants}
                onClick={() => { hapticLight(); setFabOpen(false); onAdd?.(); }}
                whileTap={{ scale: 0.94 }}
              >
                <span className="ml-fab-action-label">Create Manual Recipe</span>
                <span className="ml-fab-action-icon ml-fab-action-icon--add" aria-hidden="true">✏️</span>
              </motion.button>
              <motion.button
                className="ml-fab-action"
                variants={fabActionVariants}
                onClick={() => { hapticLight(); setFabOpen(false); setShowDiscover(true); }}
                whileTap={{ scale: 0.94 }}
              >
                <span className="ml-fab-action-label">Discover Recipes</span>
                <span className="ml-fab-action-icon ml-fab-action-icon--discover" aria-hidden="true">🔎</span>
              </motion.button>
              {/* Moved here from the header icon strip (feedback 2026-07-15:
                  header decluttering) */}
              {onImportZip && (
                <motion.button
                  className="ml-fab-action"
                  variants={fabActionVariants}
                  onClick={() => { hapticLight(); setFabOpen(false); onImportZip(); }}
                  whileTap={{ scale: 0.94 }}
                >
                  <span className="ml-fab-action-label">Import Instagram Saved (ZIP)</span>
                  <span className="ml-fab-action-icon ml-fab-action-icon--zip" aria-hidden="true">📦</span>
                </motion.button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          className="ml-fab ml-fab-add ml-fab-main"
          onClick={() => { hapticLight(); setFabOpen(o => !o); }}
          aria-expanded={fabOpen}
          aria-label={fabOpen ? 'Close actions' : 'Add or import a recipe'}
          whileTap={{ scale: 0.88 }}
          animate={{ rotate: fabOpen ? 45 : 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
        >
          <span>+</span>
        </motion.button>
      </motion.div>

      {/* ── I-5 Re-extraction (improve) sheet ── */}
      <AnimatePresence>
        {reExtractMeal && (
          <ReExtractSheet
            key="reextract-sheet"
            meal={reExtractMeal}
            onClose={() => setReExtractMeal(null)}
            onSaved={async (updated) => {
              try {
                await db.meals.put(updated);
              } catch (err) {
                console.error('[MealLibrary] re-extract save failed:', err);
                onToast?.('Could not save changes');
                return;
              }
              setReExtractMeal(null);
              await onReload?.();
              onToast?.('Recipe improved ✨');
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Discover Recipes (blog aggregator) ── */}
      <AnimatePresence>
        {showDiscover && (
          <DiscoverRecipes
            key="discover-recipes"
            onClose={() => setShowDiscover(false)}
            onSelectUrl={(url) => {
              setShowDiscover(false);
              onImportUrl?.(url);
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Expandable card (tap a tile, long-press, or ⋯ button) ──
            Shared-element morph: the tapped tile's image + title carry the same
            layoutId as this card's hero + title, so the tile grows into the modal
            and shrinks back on close (Aceternity "expandable card" pattern). */}
      <AnimatePresence>
      {quickPreview && (
        <motion.div
          key="qp-overlay"
          className="ml-qp-overlay"
          onClick={() => setQuickPreview(null)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
        >
          {/* Floating close button (Aceternity-style), outside the card surface */}
          <motion.button
            key="qp-close"
            className="ml-qp-close"
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
            className="ml-qp-sheet ml-qp-card"
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
            <div className="ml-qp-handle" />
            <motion.div className="ml-qp-hero" layoutId={`ml-card-img-${quickPreview.id}`}>
              {quickPreview.imageUrl ? (
                <SafeMediaImage
                  src={quickPreview.imageUrl}
                  alt={quickPreview.name || 'Recipe'}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  fallbackEmoji="🍽️"
                />
              ) : (
                <div className="ml-qp-hero-empty">
                  <UtensilsCrossed size={40} strokeWidth={1.5} style={{ opacity: 0.35 }} />
                </div>
              )}
            </motion.div>
            <div className="ml-qp-body">
              <motion.h3 className="ml-qp-title" layoutId={`ml-card-title-${quickPreview.id}`}>
                {quickPreview.name || 'Untitled Recipe'}
              </motion.h3>
              {/* ── Type picker (single-select) ── */}
              <div className="ml-qp-type-row">
                {TYPE_OPTIONS.map(t => (
                  <button
                    key={t}
                    className={`ml-qp-type-chip${(quickPreview.category || 'Dinners') === t ? ' ml-qp-type-active' : ''}`}
                    style={(quickPreview.category || 'Dinners') === t ? { background: TYPE_COLORS[t], borderColor: TYPE_COLORS[t], color: '#fff' } : undefined}
                    onClick={() => handleSetMealType(quickPreview.id, t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {(quickPreview.created || quickPreview.createdAt) && (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginBottom: 8 }}>
                  Added: {new Date(quickPreview.created || quickPreview.createdAt).toLocaleDateString()}
                </div>
              )}
              {mealEngineLabel(quickPreview._structuredVia) && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 8 }}>
                  Parsed by {mealEngineLabel(quickPreview._structuredVia)}
                  {typeof quickPreview.confidence === 'number'
                    ? ` · ${Math.round(quickPreview.confidence * 100)}%`
                    : ''}
                </div>
              )}

              {/* ── Tag chips (tap to toggle) ── */}
              {userTags.length > 0 && (
                <div className="ml-qp-tags">
                  {userTags.map(tag => {
                    const hasTag = (quickPreview.tags || []).includes(tag.name);
                    return (
                      <button
                        key={tag.id}
                        className={`ml-qp-tag${hasTag ? ' ml-qp-tag-active' : ''}`}
                        style={hasTag ? { background: tag.color, borderColor: tag.color, color: '#fff' } : undefined}
                        onClick={() => handleToggleMealTag(quickPreview.id, tag.name)}
                      >
                        {hasTag ? <Check size={11} strokeWidth={3} /> : <Tag size={11} strokeWidth={2} />}
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="ml-qp-section">
                <h4>Ingredients ({(quickPreview.ingredients || []).length})</h4>
                <ul className="ml-qp-list">
                  {(quickPreview.ingredients || []).slice(0, 8).map((ing, i) => (
                    <li key={i}>{ing}</li>
                  ))}
                  {(quickPreview.ingredients || []).length > 8 && (
                    <li className="ml-qp-more">
                      +{(quickPreview.ingredients || []).length - 8} more…
                    </li>
                  )}
                </ul>
              </div>

              <div className="ml-qp-section">
                <h4>Steps ({(quickPreview.directions || []).length})</h4>
                <ol className="ml-qp-list ml-qp-steps">
                  {(quickPreview.directions || []).slice(0, 4).map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                  {(quickPreview.directions || []).length > 4 && (
                    <li className="ml-qp-more">
                      +{(quickPreview.directions || []).length - 4} more…
                    </li>
                  )}
                </ol>
              </div>
            </div>

            <div className="ml-qp-actions">
              <button onClick={() => { setQuickPreview(null); onViewDetail?.(quickPreview); }}>
                View Full Recipe
              </button>
              <button onClick={() => { setQuickPreview(null); onEdit?.(quickPreview); }}>
                Edit
              </button>
              <button onClick={() => { onShare?.(quickPreview); }}>
                Share
              </button>
              <button onClick={() => { hapticSuccess(); handleToggleRotation(quickPreview); setQuickPreview(null); }}>
                {quickPreview.inRotation ? '🔄 Remove from Rotation' : '🔄 Add to Rotation'}
              </button>
              {onToggleFavorite && (
                <button onClick={() => { onToggleFavorite(quickPreview); setQuickPreview(null); }}>
                  {quickPreview.isFavorite ? '💔 Unfavorite' : '❤️ Favorite'}
                </button>
              )}
              {onPlayVideo && getMealVideoSource(quickPreview) && (
                <button
                  onClick={() => { hapticLight(); onPlayVideo(quickPreview); setQuickPreview(null); }}
                >
                  🎥 Play Video ({getMealVideoSource(quickPreview).label})
                </button>
              )}
              {(quickPreview.link || quickPreview.sourceUrl) && (
                <button
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
              {onMoveToBar && (
                <button
                  onClick={() => { hapticLight(); onMoveToBar(quickPreview); setQuickPreview(null); }}
                  title="Move this to the Bar Library — for a recipe that got imported as a meal by mistake"
                >
                  🍸 Move to Bar
                </button>
              )}
              <button
                className="ml-qp-danger"
                onClick={() => { setQuickPreview(null); setConfirmDeleteId(quickPreview.id); }}
              >
                🗑️ Delete
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* ── Category picker sheet (multi-select) ── */}
      <AnimatePresence>
      {showCategoryPicker && (
        <motion.div
          key="cat-picker"
          className="ml-overlay"
          onClick={() => setShowCategoryPicker(false)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className="ml-sheet"
            onClick={e => e.stopPropagation()}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          >
            <div className="ml-sheet-handle" />
            <div className="ml-sheet-header">
              <h3>Set Type</h3>
              <button className="ml-sheet-close" onClick={() => setShowCategoryPicker(false)}>✕</button>
            </div>
            <p className="ml-sheet-subtitle">
              Assigning to {selectedIds.size} meal{selectedIds.size !== 1 ? 's' : ''}
            </p>
            <div className="ml-sheet-options">
              {CATEGORY_OPTIONS.map(cat => (
                <button
                  key={cat}
                  className="ml-sheet-option"
                  onClick={() => handleBatchSetCategory(cat)}
                >
                  <span className="ml-option-icon">📁</span>
                  <span>{cat}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* ── Tag Manager sheet ── */}
      <AnimatePresence>
      {showTagManager && (
        <motion.div
          key="tag-manager"
          className="ml-overlay"
          onClick={() => { setShowTagManager(false); setEditingTagId(null); }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className="ml-sheet"
            onClick={e => e.stopPropagation()}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          >
            <div className="ml-sheet-handle" />
            <div className="ml-sheet-header">
              <h3>Manage Tags</h3>
              <button className="ml-sheet-close" onClick={() => { setShowTagManager(false); setEditingTagId(null); }}>✕</button>
            </div>
            <p className="ml-sheet-subtitle">
              Create custom tags to organize your recipes
            </p>
            {/* New tag input */}
            <div className="ml-tag-create-row">
              <input
                type="text"
                className="ml-tag-create-input"
                placeholder="New tag name…"
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateTag(); }}
                maxLength={30}
              />
              <button
                className="ml-tag-create-btn"
                onClick={handleCreateTag}
                disabled={!newTagName.trim()}
              >
                <Plus size={16} strokeWidth={2.5} />
              </button>
            </div>
            {/* Existing tags */}
            <div className="ml-sheet-options ml-tag-list">
              {userTags.map(tag => (
                <div key={tag.id} className="ml-tag-row">
                  {editingTagId === tag.id ? (
                    <div className="ml-tag-edit-row">
                      <input
                        type="text"
                        className="ml-tag-create-input"
                        value={editingTagName}
                        onChange={e => setEditingTagName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRenameTag(tag.id); }}
                        autoFocus
                      />
                      <button className="ml-tag-save-btn" onClick={() => handleRenameTag(tag.id)}>
                        <Check size={14} strokeWidth={2.5} />
                      </button>
                      <button className="ml-tag-cancel-btn" onClick={() => setEditingTagId(null)}>✕</button>
                    </div>
                  ) : (
                    <>
                      <span className="ml-tag-row-dot" style={{ background: tag.color }} />
                      <span className="ml-tag-row-name">{tag.emoji} {tag.name}</span>
                      <span className="ml-tag-row-count">
                        {meals.filter(m => (m.tags || []).includes(tag.name)).length}
                      </span>
                      <button
                        className="ml-tag-row-action"
                        onClick={() => { setEditingTagId(tag.id); setEditingTagName(tag.name); }}
                        title="Rename"
                      >
                        <Pencil size={13} strokeWidth={2} />
                      </button>
                      <button
                        className="ml-tag-row-action ml-tag-row-delete"
                        onClick={() => handleDeleteTag(tag.id)}
                        title="Delete"
                      >
                        <Trash2 size={13} strokeWidth={2} />
                      </button>
                    </>
                  )}
                </div>
              ))}
              {userTags.length === 0 && (
                <p style={{ textAlign: 'center', color: 'var(--text-light)', fontSize: 13, padding: 16 }}>
                  No tags yet — create one above
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* ── Bulk Tag Picker sheet (multi-select mode) ── */}
      <AnimatePresence>
      {showBulkTagPicker && (
        <motion.div
          key="bulk-tag-picker"
          className="ml-overlay"
          onClick={() => setShowBulkTagPicker(false)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className="ml-sheet"
            onClick={e => e.stopPropagation()}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          >
            <div className="ml-sheet-handle" />
            <div className="ml-sheet-header">
              <h3>Tag {selectedIds.size} Meal{selectedIds.size !== 1 ? 's' : ''}</h3>
              <button className="ml-sheet-close" onClick={() => setShowBulkTagPicker(false)}>✕</button>
            </div>
            <div className="ml-sheet-options">
              {userTags.map(tag => (
                <button
                  key={tag.id}
                  className="ml-sheet-option"
                  onClick={() => handleBulkTag(tag.name)}
                >
                  <span className="ml-tag-row-dot" style={{ background: tag.color }} />
                  <span>{tag.emoji} {tag.name}</span>
                </button>
              ))}
              {userTags.length === 0 && (
                <p style={{ textAlign: 'center', color: 'var(--text-light)', fontSize: 13, padding: 16 }}>
                  No tags yet — create tags in the tag manager first
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* ── Options sheet (backup / restore / import) ── */}
      <AnimatePresence>
      {showOptionsSheet && (
        <motion.div
          key="options-sheet"
          className="ml-overlay"
          onClick={() => setShowOptionsSheet(false)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className="ml-sheet"
            onClick={e => e.stopPropagation()}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          >
            <div className="ml-sheet-handle" />
            <div className="ml-sheet-header">
              <h3>Meal Library Options</h3>
              <button className="ml-sheet-close" onClick={() => setShowOptionsSheet(false)}>✕</button>
            </div>
            <div className="ml-sheet-options">
              <button className="ml-sheet-option" onClick={() => { onImport?.(); setShowOptionsSheet(false); }}>
                <span className="ml-option-icon">📥</span>
                <span>Import Recipe</span>
              </button>
              <button className="ml-sheet-option" onClick={handleBackup}>
                <span className="ml-option-icon">📦</span>
                <span>Backup Meals</span>
              </button>
              <button className="ml-sheet-option" onClick={() => restoreRef.current?.click()}>
                <span className="ml-option-icon">📂</span>
                <span>Restore Backup</span>
              </button>
              <input
                ref={restoreRef}
                type="file"
                accept=".json"
                onChange={handleRestore}
                style={{ display: 'none' }}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* ── Delete confirmation sheet ── */}
      <AnimatePresence>
      {confirmDeleteId && (
        <motion.div
          key="delete-confirm"
          className="ml-overlay"
          onClick={closeConfirmDelete}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className="ml-sheet ml-delete-sheet"
            onClick={e => e.stopPropagation()}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          >
            <div className="ml-sheet-handle" />
            <div className="ml-delete-header">
              <span className="ml-delete-icon">🗑️</span>
            </div>
            <h3 className="ml-delete-title">Delete Meal?</h3>
            <p className="ml-delete-message">
              This meal will be permanently removed from your library.
            </p>
            <div className="ml-delete-actions">
              <button className="ml-delete-btn ml-delete-cancel" onClick={closeConfirmDelete}>
                Keep Meal
              </button>
              <button
                className="ml-delete-btn ml-delete-confirm"
                onClick={() => {
                  onDelete?.(confirmDeleteId);
                  setConfirmDeleteId(null);
                }}
              >
                Yes, Delete
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* ── Menu button (top right of screen) ── */}
      <motion.button
        className="ml-menu-btn"
        onClick={() => setShowOptionsSheet(true)}
        title="More options"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      >
        ···
      </motion.button>
    </div>
  );
}
