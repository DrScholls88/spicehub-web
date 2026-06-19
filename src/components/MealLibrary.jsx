import { useState, useRef, useEffect, useCallback } from 'react';
import { ChefHat, UtensilsCrossed } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { downloadMealsFile, importMealsFromJson, shareMealsFile } from '../sync';
import { toggleRotation, bulkSetRotation } from '../db';
import db from '../db';
import useBackHandler from '../hooks/useBackHandler';
import SafeMediaImage from './SafeMediaImage';
import ReExtractSheet from './ReExtractSheet';
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
    || (typeof meal.confidence === 'number' && meal.confidence < 0.75);
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

// Assignable category options (no 'All' or 'The Rotation' — those are filter views)
const CATEGORY_OPTIONS = ['Dinners', 'Breakfasts', 'Lunches', 'Desserts', 'Sides', 'Tailgate', 'Snacks'];

const CATEGORY_COLORS = {
  Dinners:    '#e07b4f',
  Breakfasts: '#f4c56a',
  Lunches:    '#6dbf8d',
  Desserts:   '#d479b8',
  Sides:      '#7ab8e0',
  Tailgate:   '#c97040',
  Snacks:     '#9b8fe0',
};

export const MEAL_CATEGORIES = ['All', '🔄 The Rotation', ...CATEGORY_OPTIONS];

// Speed-dial action reveal: rise + fade, staggered from the main FAB
const fabActionVariants = {
  closed: { opacity: 0, y: 14, scale: 0.9, transition: { duration: 0.12 } },
  open: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 420, damping: 26 } },
};

export default function MealLibrary({ meals, onAdd, onEdit, onDelete, onViewDetail, onShare, onImport, onReload, onToast, onToggleFavorite, onRate, onPlayVideo }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showOptionsSheet, setShowOptionsSheet] = useState(false);
  const [fabOpen, setFabOpen] = useState(false); // speed-dial: + expands to add/import
  const [reExtractMeal, setReExtractMeal] = useState(null); // I-5: meal being re-extracted
  const [quickPreview, setQuickPreview] = useState(null); // meal object for popup
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const restoreRef = useRef(null);
  const categoryScrollRef = useRef(null);
  const longPressTimer = useRef(null);
  const touchStartPos = useRef(null); // {x, y} at touchStart — cancel long-press on scroll
  const touchStartTime = useRef(0);   // ms timestamp at touchStart — for swipe-up velocity check
  const swipeStartPos = useRef(null); // {x, y} at touchStart — survives long-press cancel for fling-up analysis
  const swipeConsumed = useRef(false); // true when a fling-up fired → suppress the synthetic click

  // Swipe-to-dismiss state for quickPreview sheet
  const sheetRef = useRef(null);
  const sheetDragStartY = useRef(null);
  const sheetCurrentDragY = useRef(0);

  const [reimportingPhotoId, setReimportingPhotoId] = useState(null);

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
    else if (category === '🔄 The Rotation') matchCat = !!m.inRotation;
    else matchCat = (m.category || 'Dinners').toLowerCase() === category.toLowerCase();
    return matchSearch && matchCat;
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

  // Fling-up gesture thresholds (launches PiP video for tiles with a video source)
  const SWIPE_UP_MIN_DY = -55;   // must travel at least 55px upward (dy is negative)
  const SWIPE_UP_MAX_DX = 40;    // horizontal drift must stay under 40px (else it's a scroll/swipe)
  const SWIPE_UP_MAX_MS = 500;   // must be a flick, not a slow drag

  // Long press (non-select mode) → show quick preview
  const handleTouchStart = useCallback((meal, e) => {
    if (selectMode) return;
    const touch = e.changedTouches?.[0];
    touchStartPos.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    swipeStartPos.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    touchStartTime.current = Date.now();
    swipeConsumed.current = false;
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

  // touchend: first analyze for a fling-up (launches PiP video), then clean up long-press.
  // We only inspect the final displacement here — we never call preventDefault, so vertical
  // grid scrolling is fully preserved. The swipe only fires for tiles that actually have a
  // video source, when onPlayVideo is wired and we're not in multi-select.
  const handleTouchEnd = useCallback((meal, e) => {
    if (
      !selectMode &&
      meal &&
      onPlayVideo &&
      swipeStartPos.current &&
      getMealVideoSource(meal)
    ) {
      const touch = e?.changedTouches?.[0];
      if (touch) {
        const dx = touch.clientX - swipeStartPos.current.x;
        const dy = touch.clientY - swipeStartPos.current.y;
        const dt = Date.now() - touchStartTime.current;
        if (
          dy <= SWIPE_UP_MIN_DY &&
          Math.abs(dx) < SWIPE_UP_MAX_DX &&
          dt < SWIPE_UP_MAX_MS
        ) {
          swipeConsumed.current = true; // suppress the synthetic click that opens detail
          swipeStartPos.current = null;
          cancelLongPress();
          hapticLight();
          onPlayVideo(meal);
          return;
        }
      }
    }
    swipeStartPos.current = null;
    cancelLongPress();
  }, [selectMode, onPlayVideo, cancelLongPress]);

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
    // A fling-up just launched the video — swallow the synthetic click so we don't
    // also open the detail view for the same gesture.
    if (swipeConsumed.current) {
      swipeConsumed.current = false;
      return;
    }
    if (selectMode) {
      toggleSelect(meal.id);
      return;
    }
    // Failed imports: tap opens delete confirm instead of crashing detail view
    if (meal.status === 'failed') {
      setConfirmDeleteId(meal.id);
      return;
    }
    try {
      onViewDetail?.(meal);
    } catch (err) {
      console.error('[MealLibrary] onViewDetail threw:', err);
      onToast?.('Could not open this recipe — it may be corrupted.');
    }
  }, [selectMode, onViewDetail, onToast]);

  // ── Hardware back button (Android PWA) ───────────────────────────────────
  useBackHandler(selectMode, exitSelectMode, 'meal-select');
  useBackHandler(fabOpen, () => setFabOpen(false), 'meal-fab');
  useBackHandler(!!reExtractMeal, () => setReExtractMeal(null), 'meal-reextract');

  return (
    <div className="ml">

      {/* ── Search bar ── */}
      <div className="ml-search-zone">
        <input
          type="text"
          placeholder="Search… (-exclude)"
          className="ml-search-input"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* ── Category filter chips ── */}
      <div className="ml-categories-scroll" ref={categoryScrollRef}>
        <div className="ml-categories-track">
          {MEAL_CATEGORIES.map(c => (
            <motion.button
              key={c}
              className={`ml-category-chip${category === c ? ' ml-active' : ''}${c === '🔄 The Rotation' ? ' ml-rotation-chip' : ''}`}
              onClick={() => setCategory(c)}
              whileTap={{ scale: 0.93 }}
              style={{ position: 'relative', overflow: 'hidden' }}
            >
              {c}{c === '🔄 The Rotation' && rotationCount > 0 ? ` (${rotationCount})` : ''}
              {category === c && (
                <motion.span
                  layoutId="ml-active-indicator"
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: '4px',
                    right: '4px',
                    height: '2px',
                    borderRadius: '1px',
                    background: 'var(--primary)',
                  }}
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
            </motion.button>
          ))}
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
            📁 Category
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
      <div className="ml-gallery">
        {filtered.length === 0 ? (
          <motion.div
            className="ml-empty-state"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
          >
            <div className="ml-empty-icon"><ChefHat size={32} strokeWidth={1.75} /></div>
            {search || category !== 'All' ? (
              <>
                <p className="ml-empty-text">No meals match your search.</p>
                <p className="ml-empty-hint">Try a different keyword or category.</p>
              </>
            ) : (
              <>
                <p className="ml-empty-text">Your recipe box is empty</p>
                <p className="ml-empty-hint">Import a recipe from Instagram to start your collection.</p>
              </>
            )}
            {!search && category === 'All' && (
              <button className="ml-empty-cta" onClick={onImport}>Import a Recipe</button>
            )}
          </motion.div>
        ) : (
          <AnimatePresence mode="popLayout">
          {sorted.map((meal, idx) => (
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
              style={{ borderLeft: `3px solid ${CATEGORY_COLORS[meal.category || 'Dinners'] || '#ccc'}` }}
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
              <div className="ml-tile-image">
                <CardImage
                  src={meal.imageUrl}
                  alt={meal.name || 'Recipe'}
                  className="ml-tile-img"
                  phClass="ml-tile-placeholder"
                />
                {meal.isFavorite && <span className="ml-tile-fav">❤️</span>}
                {meal.inRotation && <span className="ml-tile-rotation">🔄</span>}
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
                    <span aria-hidden="true">✨</span> Improve
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
                    ⋯
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
                      <span className="ml-tile-play-tri" aria-hidden="true">▶</span>
                    </button>
                  );
                })()}
              </div>

              {/* Info row */}
              <div className="ml-tile-info">
                <span className="ml-tile-name">{meal.name || 'Untitled Recipe'}</span>
                <span className="ml-tile-meta">
                  {meal.status === 'processing'
                    ? '⏳ Import in progress…'
                    : meal.status === 'failed'
                    ? '⚠️ Import failed — tap to delete'
                    : `${(meal.ingredients || []).length} ing · ${(meal.directions || []).length} steps`}
                </span>
                {formatAddedDate(meal.importedAt || meal.createdAt || meal.created) && (
                  <span
                    className="ml-tile-added"
                    title={meal.importedAt || meal.createdAt || meal.created}
                  >
                    {formatAddedDate(meal.importedAt || meal.createdAt || meal.created)}
                  </span>
                )}
                {meal.notes && (
                  <span className="ml-tile-notes">
                    {meal.notes.slice(0, 60)}{meal.notes.length > 60 ? '…' : ''}
                  </span>
                )}
              </div>
            </motion.div>
          ))}
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
                <span className="ml-fab-action-label">Import from Web</span>
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

      {/* ── Quick Preview bottom sheet (long-press or ⋯ button) ── */}
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
          <motion.div
            ref={sheetRef}
            className="ml-qp-sheet"
            onClick={e => e.stopPropagation()}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            onTouchStart={handleSheetTouchStart}
            onTouchMove={handleSheetTouchMove}
            onTouchEnd={handleSheetTouchEnd}
            onTouchCancel={handleSheetTouchEnd}
          >
            <div className="ml-qp-handle" />
            {quickPreview.imageUrl && (
              <SafeMediaImage
                src={quickPreview.imageUrl}
                alt={quickPreview.name || 'Recipe'}
                style={{
                  width: '100%',
                  height: 200,
                  objectFit: 'cover',
                  borderRadius: '12px 12px 0 0',
                  flexShrink: 0,
                  display: 'block',
                }}
                fallbackEmoji="🍽️"
              />
            )}
            <div className="ml-qp-body">
              <h3 className="ml-qp-title">{quickPreview.name || 'Untitled Recipe'}</h3>
              {quickPreview.category && quickPreview.category !== 'Dinners' && (
                <span className="ml-tile-cat" style={{ position: 'static', marginBottom: 8 }}>
                  {quickPreview.category}
                </span>
              )}
              {(quickPreview.created || quickPreview.createdAt) && (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginBottom: 8 }}>
                  Added: {new Date(quickPreview.created || quickPreview.createdAt).toLocaleDateString()}
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
              <h3>Set Category</h3>
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
                <span>Import from URL / Spreadsheet</span>
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
