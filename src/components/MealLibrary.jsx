import { useState, useRef, useEffect, useCallback } from 'react';
import { downloadMealsFile, importMealsFromJson, shareMealsFile } from '../sync';
import { proxyImageUrl } from '../api';
import { toggleRotation, bulkSetRotation } from '../db';

// Image component with CORS proxy fallback for expired CDN URLs
function CardImage({ src, alt, className, phClass }) {
  const [failed, setFailed] = useState(false);
  const [triedProxy, setTriedProxy] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(src);
  useEffect(() => { setFailed(false); setTriedProxy(false); setCurrentSrc(src); }, [src]);
  if (!src || failed) return <div className={phClass}>🍽️</div>;
  return (
    <img
      src={currentSrc}
      alt={alt || ''}
      className={className}
      loading="lazy"
      onError={() => {
        if (!triedProxy && src.startsWith('http')) {
          // Try CORS proxy fallback (no backend server needed)
          setCurrentSrc(proxyImageUrl(src));
          setTriedProxy(true);
        } else {
          setFailed(true);
        }
      }}
    />
  );
}

export const MEAL_CATEGORIES = ['All', '🔄 The Rotation', 'Dinners', 'Breakfasts', 'Lunches', 'Desserts', 'Sides', 'Tailgate', 'Snacks'];

export default function MealLibrary({ meals, onAdd, onEdit, onDelete, onViewDetail, onShare, onImport, onReload, onToast, onToggleFavorite, onRate }) {
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

  // Long press to show quick preview
  const handleTouchStart = (meal) => {
    longPressTimer.current = setTimeout(() => {
      setQuickPreview(meal);
    }, 500);
  };
  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

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
  const handleLongPressSelect = (meal) => {
    longPressTimer.current = setTimeout(() => {
      if (!selectMode) {
        setSelectMode(true);
        setSelectedIds(new Set([meal.id]));
      }
    }, 500);
  };

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
          sorted.map((meal, idx) => (
            <div
              key={meal.id}
              className={`ml-tile${selectMode && selectedIds.has(meal.id) ? ' ml-tile-selected' : ''}`}
              style={{ animationDelay: `${idx * 30}ms` }}
              onClick={() => {
                if (selectMode) {
                  toggleSelect(meal.id);
                } else {
                  onViewDetail(meal);
                }
              }}
              onTouchStart={() => selectMode ? null : handleLongPressSelect(meal)}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
              onContextMenu={e => {
                e.preventDefault();
                if (selectMode) { toggleSelect(meal.id); }
                else { setQuickPreview(meal); }
              }}
            >
              {/* Select checkbox overlay in select mode */}
              {selectMode && (
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
              </div>
            </div>
          ))
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
