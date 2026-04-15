import { useState, useRef, useEffect, useCallback } from 'react';
import { downloadMealsFile, importMealsFromJson, shareMealsFile } from '../sync';
import { toggleRotation, bulkSetRotation } from '../db';
import useBackHandler from '../hooks/useBackHandler';
import SafeMediaImage from './SafeMediaImage';

// Thin wrapper: maps SafeMediaImage into tile-image card usage
function CardImage({ src, alt, className, phClass }) {
  if (!src) return <div className={phClass}>🍽️</div>;
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

export const MEAL_CATEGORIES = ['All', '🔄 The Rotation', 'Dinners', 'Breakfasts', 'Lunches', 'Desserts', 'Sides', 'Tailgate', 'Snacks'];

export default function MealLibrary({ meals, onAdd, onEdit, onDelete, onViewDetail, onShare, onImport, onReload, onToast, onToggleFavorite, onRate, onRetry = () => {}, onPasteManually = () => {} }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showOptionsSheet, setShowOptionsSheet] = useState(false);
  const [quickPreview, setQuickPreview] = useState(null); // meal object for popup
  const [selectMode, setSelectMode] = useState(false); // multi-select mode
  const [selectedIds, setSelectedIds] = useState(new Set()); // selected meal IDs
  const restoreRef = useRef(null);
  const categoryScrollRef = useRef(null);
  const longPressTimer = useRef(null);
  const touchStartPos = useRef(null); // {x, y} at touchStart — used to cancel long-press on scroll

  const filtered = meals.filter(m => {
    const matchSearch = m.name.toLowerCase().includes(search.toLowerCase());
    let matchCat;
    if (category === 'All') matchCat = true;
    else if (category === '🔄 The Rotation') matchCat = !!m.inRotation;
    else matchCat = (m.category || 'Dinners').toLowerCase() === category.toLowerCase();
    return matchSearch && matchCat;
  });

  const rotationCount = meals.filter(m => m.inRotation).length;

  // Sort with favorites first
  const sorted = [...filtered].sort((a, b) => {
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    return 0;
  });

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

  // ── Ghost-selection cleanup: remove deleted meal IDs from selectedIds ─────────
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

  // ── Long-press handlers with movement threshold ────────────────────────────────
  // A long press only fires if the finger hasn't moved more than 8px (prevents
  // firing during scroll or swipe gestures — the #1 cause of over-sensitivity).
  const LONG_PRESS_MS = 500;
  const MOVE_THRESHOLD_PX = 8;

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    touchStartPos.current = null;
  }, []);

  // Long press to show quick preview (when NOT in select mode)
  const handleTouchStart = useCallback((meal, e) => {
    if (selectMode) return;
    const touch = e.changedTouches?.[0];
    touchStartPos.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
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

  const handleTouchEnd = useCallback(() => cancelLongPress(), [cancelLongPress]);

  // ── Multi-select handlers ──────────────────────────────────────────────────
  const toggleSelect = (mealId) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(mealId)) next.delete(mealId);
      else next.add(mealId);
      // Exit select mode if nothing is selected
      if (next.size === 0) setSelectMode(false);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set(sorted.map(m => m.id)));
  };

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!window.confirm(`Delete ${count} meal${count !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    for (const id of selectedIds) {
      onDelete(id);
    }
    onToast?.(`Deleted ${count} meal${count !== 1 ? 's' : ''}`);
    exitSelectMode();
  };

  const handleBatchShare = async () => {
    if (selectedIds.size === 0) return;
    const selected = meals.filter(m => selectedIds.has(m.id));
    if (selected.length === 1) {
      onShare(selected[0]);
    } else {
      // Share as JSON for multiple meals
      const shareData = selected.map(m => ({
        name: m.name,
        ingredients: m.ingredients,
        directions: m.directions,
        category: m.category,
        imageUrl: m.imageUrl,
      }));
      const text = selected.map(m => `${m.name}\n\nIngredients:\n${m.ingredients.join('\n')}\n\nDirections:\n${m.directions.join('\n')}`).join('\n\n---\n\n');
      if (navigator.share) {
        try {
          await navigator.share({ title: `${selected.length} SpiceHub Recipes`, text });
        } catch { /* cancelled */ }
      } else {
        await navigator.clipboard?.writeText(text);
        onToast?.(`${selected.length} recipes copied to clipboard`);
      }
    }
    exitSelectMode();
  };

  // Enter multi-select via long-press on a tile (when not already in select mode)
  // NOTE: movement threshold is enforced by handleTouchMove above.
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

  // ── Rotation handler ─────────────────────────────────────────────────────────
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
  }, [selectedIds, onReload, onToast]);

  // ── Hardware back button handler (Android PWA) ──────────────────────────────
  // When in select mode, back button should deselect all items instead of closing the app
  useBackHandler(selectMode, exitSelectMode, 'meal-select');

  return (
    <div className="ml">
      {/* ── Search bar with pill style ── */}
      <div className="ml-search-zone">
        <input
          type="text"
          placeholder="Search meals..."
          className="ml-search-input"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* ── Category filter chips (horizontal scroll, no wrap) ── */}
      <div className="ml-categories-scroll" ref={categoryScrollRef}>
        <div className="ml-categories-track">
          {MEAL_CATEGORIES.map(c => (
            <button
              key={c}
              className={`ml-category-chip${category === c ? ' ml-active' : ''}${c === '🔄 The Rotation' ? ' ml-rotation-chip' : ''}`}
              onClick={() => setCategory(c)}
            >
              {c}{c === '🔄 The Rotation' && rotationCount > 0 ? ` (${rotationCount})` : ''}
            </button>
          ))}
        </div>
      </div>

      {/* ── Multi-select toolbar ── */}
      {selectMode && (
        <div className="ml-select-toolbar">
          <button className="ml-select-toolbar-btn" onClick={exitSelectMode}>✕ Cancel</button>
          <span className="ml-select-count">{selectedIds.size} selected</span>
          <button className="ml-select-toolbar-btn" onClick={handleSelectAll}>Select All</button>
          <button className="ml-select-toolbar-btn" onClick={handleBatchAddToRotation} disabled={selectedIds.size === 0}>🔄 Add to Rotation</button>
          <button className="ml-select-toolbar-btn" onClick={handleBatchShare} disabled={selectedIds.size === 0}>📤 Share</button>
          <button className="ml-select-toolbar-btn ml-select-delete" onClick={handleBatchDelete} disabled={selectedIds.size === 0}>🗑️ Delete</button>
        </div>
      )}

      {/* ── Gallery grid (Notion-style tiles) ── */}
      <div className="ml-gallery">
        {filtered.length === 0 ? (
          <div className="ml-empty-state">
            <div className="ml-empty-icon">🍽️</div>
            <p className="ml-empty-text">
              {search || category !== 'All'
                ? 'No meals match your search.'
                : 'No meals found. Add some recipes to get started!'}
            </p>
          </div>
        ) : (
          sorted.map((meal, idx) => {
            const mealStatus = meal?.status ?? 'done';
            return (
            <div
              key={meal.id}
              className={`ml-tile${selectMode && selectedIds.has(meal.id) ? ' ml-tile-selected' : ''} meal-card--${mealStatus}`}
              style={{ animationDelay: `${idx * 30}ms` }}
              onClick={() => {
                if (mealStatus !== 'done') return;
                if (selectMode) {
                  toggleSelect(meal.id);
                } else {
                  onViewDetail(meal);
                }
              }}
              onTouchStart={e => selectMode ? handleLongPressSelect(meal, e) : handleTouchStart(meal, e)}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
              onContextMenu={e => {
                e.preventDefault();
                if (selectMode) { toggleSelect(meal.id); }
                else { setQuickPreview(meal); }
              }}
            >
              {/* Ghost Recipe overlays */}
              {mealStatus === 'processing' && (
                <div className="meal-card__ghost-overlay">
                  <div className="meal-card__shimmer" />
                  <div className="meal-card__progress">{meal.importProgress || 'Importing…'}</div>
                </div>
              )}
              {mealStatus === 'failed' && (
                <div className="meal-card__failed">
                  <div className="meal-card__error">{meal.importError || 'Import failed.'}</div>
                  <button onClick={(e) => { e.stopPropagation(); onRetry(meal); }}>Retry</button>
                  <button onClick={(e) => { e.stopPropagation(); onPasteManually(meal); }}>Paste Manually</button>
                </div>
              )}
              {/* Select checkbox overlay in select mode */}
              {selectMode && mealStatus === 'done' && (
                <div className="ml-tile-check">
                  <span>{selectedIds.has(meal.id) ? '✓' : ''}</span>
                </div>
              )}
              {/* Image */}
              <div className="ml-tile-image">
                <CardImage src={meal.imageUrl} alt={meal.name} className="ml-tile-img" phClass="ml-tile-placeholder" />
                {meal.isFavorite && <span className="ml-tile-fav">❤️</span>}
                {meal.inRotation && <span className="ml-tile-rotation">🔄</span>}
                {meal.category && meal.category !== 'Dinners' && (
                  <span className="ml-tile-cat">{meal.category}</span>
                )}
              </div>
              {/* Info row */}
              <div className="ml-tile-info">
                <span className="ml-tile-name">{meal.name}</span>
                <span className="ml-tile-meta">
                  {meal.ingredients.length} ing · {meal.directions.length} steps
                </span>
                {meal.notes && (
                  <span className="ml-tile-notes">
                    {meal.notes.slice(0, 60)}{meal.notes.length > 60 ? '…' : ''}
                  </span>
                )}
              </div>
            </div>
            );
          })
        )}
      </div>

      {/* ── Floating Action Buttons ── */}
      <div className="ml-fab-group">
        <button className="ml-fab ml-fab-import" onClick={onImport} title="Import Recipe">
          <span>📥</span>
          <span className="ml-fab-label">Import</span>
        </button>
        <button className="ml-fab ml-fab-add" onClick={onAdd} title="Add New Meal">
          <span>+</span>
        </button>
      </div>

      {/* ── Quick Preview popup (long press or right-click) ── */}
      {quickPreview && (
        <div className="ml-qp-overlay" onClick={() => setQuickPreview(null)}>
          <div className="ml-qp-sheet" onClick={e => e.stopPropagation()}>
            <div className="ml-qp-handle" />
            {quickPreview.imageUrl && (
              <img src={quickPreview.imageUrl} alt="" className="ml-qp-image" />
            )}
            <div className="ml-qp-body">
              <h3 className="ml-qp-title">{quickPreview.name}</h3>
              {quickPreview.category && quickPreview.category !== 'Dinners' && (
                <span className="ml-tile-cat" style={{ position: 'static', marginBottom: 8 }}>{quickPreview.category}</span>
              )}
              <div className="ml-qp-section">
                <h4>Ingredients ({quickPreview.ingredients.length})</h4>
                <ul className="ml-qp-list">
                  {quickPreview.ingredients.slice(0, 8).map((ing, i) => (
                    <li key={i}>{ing}</li>
                  ))}
                  {quickPreview.ingredients.length > 8 && (
                    <li className="ml-qp-more">+{quickPreview.ingredients.length - 8} more...</li>
                  )}
                </ul>
              </div>
              <div className="ml-qp-section">
                <h4>Steps ({quickPreview.directions.length})</h4>
                <ol className="ml-qp-list ml-qp-steps">
                  {quickPreview.directions.slice(0, 4).map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                  {quickPreview.directions.length > 4 && (
                    <li className="ml-qp-more">+{quickPreview.directions.length - 4} more...</li>
                  )}
                </ol>
              </div>
            </div>
            <div className="ml-qp-actions">
              <button onClick={() => { setQuickPreview(null); onViewDetail(quickPreview); }}>
                View Full Recipe
              </button>
              <button onClick={() => { setQuickPreview(null); onEdit(quickPreview); }}>
                Edit
              </button>
              <button onClick={() => { onShare(quickPreview); }}>
                Share
              </button>
              <button onClick={() => { handleToggleRotation(quickPreview); setQuickPreview(null); }}>
                {quickPreview.inRotation ? '🔄 Remove from Rotation' : '🔄 Add to Rotation'}
              </button>
              {onToggleFavorite && (
                <button onClick={() => { onToggleFavorite(quickPreview); setQuickPreview(null); }}>
                  {quickPreview.isFavorite ? 'Unfavorite' : 'Favorite'}
                </button>
              )}
              <button className="ml-qp-danger" onClick={() => { setQuickPreview(null); setConfirmDeleteId(quickPreview.id); }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Options bottom sheet (backup/restore/import) ── */}
      {showOptionsSheet && (
        <div className="ml-overlay" onClick={() => setShowOptionsSheet(false)}>
          <div className="ml-sheet" onClick={e => e.stopPropagation()}>
            <div className="ml-sheet-handle" />
            <div className="ml-sheet-header">
              <h3>Meal Library Options</h3>
              <button className="ml-sheet-close" onClick={() => setShowOptionsSheet(false)}>✕</button>
            </div>
            <div className="ml-sheet-options">
              <button className="ml-sheet-option" onClick={() => onImport()}>
                <span className="ml-option-icon">📥</span>
                <span>Import from Spreadsheet/URL</span>
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
          </div>
        </div>
      )}

      {/* ── Delete confirmation bottom sheet ── */}
      {confirmDeleteId && (
        <div className="ml-overlay" onClick={closeConfirmDelete}>
          <div className="ml-sheet ml-delete-sheet" onClick={e => e.stopPropagation()}>
            <div className="ml-sheet-handle" />
            <div className="ml-delete-header">
              <span className="ml-delete-icon">🗑️</span>
            </div>
            <h3 className="ml-delete-title">Delete Meal?</h3>
            <p className="ml-delete-message">
              This meal will be permanently removed from your library.
            </p>
            <div className="ml-delete-actions">
              <button
                className="ml-delete-btn ml-delete-cancel"
                onClick={closeConfirmDelete}
              >
                Keep Meal
              </button>
              <button
                className="ml-delete-btn ml-delete-confirm"
                onClick={() => {
                  onDelete(confirmDeleteId);
                  setConfirmDeleteId(null);
                }}
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Menu button (top right) to open options sheet ── */}
      <button
        className="ml-menu-btn"
        onClick={() => setShowOptionsSheet(true)}
        title="More options"
      >
        ···
      </button>
    </div>
  );
}
