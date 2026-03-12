import { useState, useRef } from 'react';
import { downloadMealsFile, importMealsFromJson, shareMealsFile } from '../sync';

export const MEAL_CATEGORIES = ['All', 'Dinners', 'Breakfasts', 'Lunches', 'Desserts', 'Sides', 'Tailgate', 'Snacks'];

export default function MealLibrary({ meals, onAdd, onEdit, onDelete, onViewDetail, onShare, onImport, onReload, onToast, onToggleFavorite, onRate }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showOptionsSheet, setShowOptionsSheet] = useState(false);
  const restoreRef = useRef(null);
  const categoryScrollRef = useRef(null);

  const filtered = meals.filter(m => {
    const matchSearch = m.name.toLowerCase().includes(search.toLowerCase());
    const matchCat = category === 'All' || (m.category || 'Dinners').toLowerCase() === category.toLowerCase();
    return matchSearch && matchCat;
  });

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
              className={`ml-category-chip${category === c ? ' ml-active' : ''}`}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* ── Meal cards list ── */}
      <div className="ml-cards-container">
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
            <div key={meal.id} className="ml-card" style={{ animationDelay: `${idx * 40}ms` }}>
              {/* ── Card main content (tappable) ── */}
              <div className="ml-card-main" onClick={() => onViewDetail(meal)}>
                <div className="ml-card-image-zone">
                  {meal.imageUrl ? (
                    <img
                      src={meal.imageUrl}
                      alt={meal.name}
                      className="ml-card-image"
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <div className="ml-card-image-placeholder">🍽️</div>
                  )}
                </div>
                <div className="ml-card-info">
                  <h3 className="ml-card-title">{meal.name}</h3>
                  <div className="ml-card-meta">
                    {meal.category && meal.category !== 'Dinners' && (
                      <span className="ml-card-category-tag">{meal.category}</span>
                    )}
                    <span className="ml-card-stats">
                      {meal.ingredients.length} ingredients · {meal.directions.length} steps
                    </span>
                  </div>
                </div>
              </div>

              {/* ── Card action buttons ── */}
              <div className="ml-card-actions">
                {onToggleFavorite && (
                  <button
                    className="ml-action-btn ml-heart-btn"
                    onClick={() => onToggleFavorite(meal)}
                    title={meal.isFavorite ? 'Unfavorite' : 'Favorite'}
                  >
                    {meal.isFavorite ? '❤️' : '🤍'}
                  </button>
                )}
                {meal.rating > 0 && (
                  <span className="ml-card-rating" title={`Rated ${meal.rating}/5`}>
                    {'⭐'.repeat(meal.rating)}
                  </span>
                )}
                <button
                  className="ml-action-btn"
                  onClick={() => onShare(meal)}
                  title="Share"
                >
                  📤
                </button>
                <button
                  className="ml-action-btn"
                  onClick={() => onEdit(meal)}
                  title="Edit"
                >
                  ✏️
                </button>
                <button
                  className="ml-action-btn ml-danger"
                  onClick={() => setConfirmDeleteId(meal.id)}
                  title="Delete"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Floating Action Button (FAB) ── */}
      <button className="ml-fab" onClick={onAdd} title="Add New Meal">
        <span>+</span>
      </button>

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
