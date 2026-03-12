import { useState, useRef } from 'react';
import db from '../db';

// Category chips shown in the library
const BAR_CATEGORIES = ['All', 'Cocktail', 'Mocktail', 'Beer & Wine', 'Shots', 'Non-Alcoholic'];

export default function BarLibrary({ drinks, onAdd, onEdit, onDelete, onViewDetail, onShare, onImport, onReload, onToast, onOpenShelf, onOpenBarFridge }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const [menuAnimation, setMenuAnimation] = useState(false);
  const restoreRef = useRef(null);

  const filtered = drinks.filter(d => {
    const matchSearch = d.name.toLowerCase().includes(search.toLowerCase());
    const matchCat = category === 'All' || (d.category || '').toLowerCase() === category.toLowerCase();
    return matchSearch && matchCat;
  });

  const handleBackup = async () => {
    handleMenuClose();
    const all = await db.drinks.toArray();
    const data = {
      version: 1,
      app: 'SpiceHub',
      type: 'bar',
      exportedAt: new Date().toISOString(),
      drinks: all.map(({ id, ...rest }) => rest),
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });

    if (navigator.canShare) {
      try {
        const file = new File([blob], 'spicehub-bar.json', { type: 'application/json' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ title: 'SpiceHub Bar Backup', files: [file] });
          return;
        }
      } catch { /* fall through */ }
    }
    // Download fallback
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spicehub-bar-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onToast?.('Bar backup downloaded');
  };

  const handleRestore = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const list = data.drinks || data.meals || [];
      if (!Array.isArray(list) || list.length === 0) throw new Error('No drinks found in backup file');

      const existing = await db.drinks.toArray();
      const existingNames = new Set(existing.map(d => d.name.toLowerCase().trim()));
      let added = 0, skipped = 0;
      for (const drink of list) {
        if (existingNames.has(drink.name.toLowerCase().trim())) { skipped++; }
        else { await db.drinks.add(drink); existingNames.add(drink.name.toLowerCase().trim()); added++; }
      }
      onReload?.();
      onToast?.(`Restored ${added} drink${added !== 1 ? 's' : ''}${skipped ? ` (${skipped} duplicates skipped)` : ''}`);
    } catch (err) {
      onToast?.('Restore failed: ' + err.message, 'error');
    }
    e.target.value = '';
    handleMenuClose();
  };

  const handleMenuOpen = () => {
    setShowMenu(true);
    setMenuAnimation(false);
  };

  const handleMenuClose = () => {
    setMenuAnimation(true);
    setTimeout(() => {
      setShowMenu(false);
      setMenuAnimation(false);
    }, 200);
  };

  const handleDeleteClick = (drinkId) => {
    setConfirmDelete(drinkId);
  };

  const handleConfirmDelete = (drinkId) => {
    onDelete(drinkId);
    setConfirmDelete(null);
  };

  const handleCancelDelete = () => {
    setConfirmDelete(null);
  };

  return (
    <div className="bl-library">
      {/* ── Search bar ── */}
      <div className="bl-search-container">
        <div className="bl-search-bar">
          <input
            type="text"
            placeholder="Search drinks…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── Header actions ── */}
      <div className="bl-header">
        {onOpenBarFridge && (
          <button className="bl-import-btn" onClick={onOpenBarFridge} title="What's on My Shelf?">
            🍸 My Shelf
          </button>
        )}
        {onOpenShelf && (
          <button className="bl-import-btn" onClick={onOpenShelf} title="View Bar Shelf" style={{ background: 'linear-gradient(135deg, #1a0a2e, #3a1f5e)', color: '#ff4081', border: 'none' }}>
            🎮 Shelf View
          </button>
        )}
        <button className="bl-import-btn" onClick={onImport} title="Import from URL or Paprika">
          📥 Import
        </button>
        <button className="bl-menu-btn" onClick={handleMenuOpen} title="More options">
          ⋯
        </button>
      </div>

      {/* ── Category chips - horizontal scroll ── */}
      <div className="bl-categories">
        {BAR_CATEGORIES.map(c => (
          <button
            key={c}
            className={`bl-cat-chip${category === c ? ' active' : ''}`}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {/* ── Drinks list ── */}
      <div className="bl-drinks-list">
        {filtered.length === 0 ? (
          <div className="bl-empty-state">
            <div className="bl-empty-emoji">🍹</div>
            <p className="bl-empty-text">
              {search || category !== 'All'
                ? 'No drinks match your search.'
                : 'The bar is empty! Add cocktail recipes or import from Paprika.'}
            </p>
            {!search && category === 'All' && (
              <button className="bl-btn-primary" onClick={onAdd}>
                Add a Drink
              </button>
            )}
          </div>
        ) : (
          filtered.map((drink, idx) => (
            <div
              key={drink.id}
              className={`bl-drink-card${confirmDelete === drink.id ? ' with-delete' : ''}`}
              style={{
                animationDelay: `${idx * 0.05}s`,
              }}
              onClick={() => onViewDetail(drink)}
            >
              <div className="bl-drink-image-container">
                {drink.imageUrl ? (
                  <img
                    src={drink.imageUrl}
                    alt={drink.name}
                    className="bl-drink-image"
                    onError={e => {
                      e.target.style.display = 'none';
                    }}
                  />
                ) : (
                  '🍹'
                )}
              </div>
              <div className="bl-drink-info">
                <div className="bl-drink-name">{drink.name}</div>
                <div className="bl-drink-meta">
                  {drink.category && <span className="bl-cat-tag">{drink.category}</span>}
                  <span>{drink.ingredients?.length ?? 0} ingredients · {drink.directions?.length ?? 0} steps</span>
                </div>
              </div>
              <div
                className="bl-card-actions"
                onClick={e => e.stopPropagation()}
              >
                <button
                  className="bl-icon-btn"
                  onClick={() => onShare(drink)}
                  title="Share"
                >
                  📤
                </button>
                <button
                  className="bl-icon-btn"
                  onClick={() => onEdit(drink)}
                  title="Edit"
                >
                  ✏️
                </button>
                <button
                  className="bl-icon-btn danger"
                  onClick={() => handleDeleteClick(drink.id)}
                  title="Delete"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Floating Action Button ── */}
      <button className="bl-fab" onClick={onAdd} title="Add new drink">
        🍹
      </button>

      {/* ── Menu Bottom Sheet ── */}
      {showMenu && (
        <>
          <div
            className={`bl-overlay${menuAnimation ? ' closing' : ''}`}
            onClick={handleMenuClose}
          />
          <div className={`bl-bottom-sheet${menuAnimation ? ' closing' : ''}`}>
            <div className="bl-sheet-handle" />
            <div className="bl-sheet-title">Bar Options</div>
            <button className="bl-sheet-button" onClick={handleBackup}>
              📦 Backup Bar
            </button>
            <button className="bl-sheet-button" onClick={() => restoreRef.current?.click()}>
              📂 Restore Backup
            </button>
            <input
              ref={restoreRef}
              type="file"
              accept=".json"
              onChange={handleRestore}
              style={{ display: 'none' }}
            />
          </div>
        </>
      )}

      {/* ── Delete Confirmation Bottom Sheet ── */}
      {confirmDelete && (
        <>
          <div
            className="bl-overlay"
            onClick={handleCancelDelete}
          />
          <div className="bl-delete-sheet">
            <div className="bl-sheet-handle" />
            <div className="bl-delete-message">
              Delete this drink? This cannot be undone.
            </div>
            <div className="bl-delete-actions">
              <button
                className="bl-delete-btn bl-delete-btn-confirm"
                onClick={() => handleConfirmDelete(confirmDelete)}
              >
                Yes, Delete Drink
              </button>
              <button
                className="bl-delete-btn bl-delete-btn-cancel"
                onClick={handleCancelDelete}
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
