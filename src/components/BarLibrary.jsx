import { useState, useRef, useEffect, useMemo } from 'react';
import db from '../db';
import { getBarInventory } from '../db';

// Category chips shown in the library
const BAR_CATEGORIES = ['All', 'Cocktail', 'Mocktail', 'Beer & Wine', 'Shots', 'Non-Alcoholic'];

// ── Rarity system (mirrored from BarShelf) ──────────────────────────────────
const LEGENDARY_NAMES = ['negroni','manhattan','old fashioned','mai tai','singapore sling','sazerac','corpse reviver','aviation','last word','paper plane'];

function getDrinkRarity(drink) {
  const ingCount = drink.ingredients?.length || 0;
  const name = (drink.name || '').toLowerCase();
  if (LEGENDARY_NAMES.some(n => name.includes(n))) return 'legendary';
  if (ingCount >= 6) return 'legendary';
  if (ingCount >= 4) return 'rare';
  return 'common';
}

function getRarityColor(rarity) {
  if (rarity === 'legendary') return '#ffd700';
  if (rarity === 'rare') return '#42a5f5';
  return null; // common — no special color
}

function getRarityLabel(rarity) {
  if (rarity === 'legendary') return '★';
  if (rarity === 'rare') return '◆';
  return '';
}

// ── Ingredient matching ────────────────────────────────────────────────────
function matchScore(drink, inventory) {
  if (!drink.ingredients || drink.ingredients.length === 0 || inventory.length === 0) return { matched: 0, total: 0, missing: 0, pct: 0 };
  let matched = 0;
  for (const ing of drink.ingredients) {
    const ingLower = ing.toLowerCase();
    if (inventory.some(inv => ingLower.includes(inv) || inv.includes(ingLower.split(' ').pop()))) matched++;
  }
  const total = drink.ingredients.length;
  return { matched, total, missing: total - matched, pct: Math.round((matched / total) * 100) };
}

export default function BarLibrary({ drinks, onAdd, onEdit, onDelete, onViewDetail, onShare, onImport, onReload, onToast, onOpenShelf, onOpenBarFridge }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const [menuAnimation, setMenuAnimation] = useState(false);
  const [quickFilter, setQuickFilter] = useState('all'); // 'all' | 'canMake' | 'almostReady'
  const [barInventory, setBarInventory] = useState([]);
  const restoreRef = useRef(null);

  // Load bar inventory for progress/quest features
  useEffect(() => { getBarInventory().then(setBarInventory); }, []);

  // ── Filtering with negative search support ──────────────────────────────
  const filtered = useMemo(() => {
    let result = drinks;

    // Category filter
    if (category !== 'All') {
      result = result.filter(d => (d.category || '').toLowerCase() === category.toLowerCase());
    }

    // Search with negative filtering (e.g. "-mocktail")
    if (search.trim()) {
      const terms = search.toLowerCase().split(/\s+/);
      const positive = terms.filter(t => !t.startsWith('-'));
      const negative = terms.filter(t => t.startsWith('-')).map(t => t.slice(1)).filter(Boolean);

      result = result.filter(d => {
        const text = (d.name + ' ' + (d.category || '') + ' ' + (d.ingredients || []).join(' ')).toLowerCase();
        const matchPos = positive.length === 0 || positive.every(t => text.includes(t));
        const matchNeg = negative.every(t => !text.includes(t));
        return matchPos && matchNeg;
      });
    }

    // Quick filter (requires inventory)
    if (quickFilter !== 'all' && barInventory.length > 0) {
      result = result.filter(d => {
        const ms = matchScore(d, barInventory);
        if (quickFilter === 'canMake') return ms.missing === 0;
        if (quickFilter === 'almostReady') return ms.missing > 0 && ms.missing <= 2;
        return true;
      });
    }

    return result;
  }, [drinks, search, category, quickFilter, barInventory]);

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

  // Stats for quick filter badges
  const canMakeCount = useMemo(() => {
    if (barInventory.length === 0) return 0;
    return drinks.filter(d => matchScore(d, barInventory).missing === 0).length;
  }, [drinks, barInventory]);

  const almostCount = useMemo(() => {
    if (barInventory.length === 0) return 0;
    return drinks.filter(d => { const ms = matchScore(d, barInventory); return ms.missing > 0 && ms.missing <= 2; }).length;
  }, [drinks, barInventory]);

  return (
    <div className="bl-library">
      {/* ── Search bar ── */}
      <div className="bl-search-container">
        <div className="bl-search-bar">
          <input
            type="text"
            placeholder="Search drinks… (use -term to exclude)"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── "Enter the Saloon" hero button ── */}
      {onOpenShelf && (
        <button className="bl-saloon-btn" onClick={onOpenShelf}>
          <span className="bl-saloon-icon">🎮</span>
          <span className="bl-saloon-text">Enter the Saloon</span>
          <span className="bl-saloon-count">{drinks.length} bottles</span>
        </button>
      )}

      {/* ── Header actions ── */}
      <div className="bl-header">
        {onOpenBarFridge && (
          <button className="bl-import-btn" onClick={onOpenBarFridge} title="What's on My Shelf?">
            🍸 My Shelf
          </button>
        )}
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

      {/* ── Quick filter bar (inventory-powered) ── */}
      {barInventory.length > 0 && (
        <div className="bl-quick-filters">
          <button
            className={`bl-qf-chip ${quickFilter === 'all' ? 'active' : ''}`}
            onClick={() => setQuickFilter('all')}
          >
            All
          </button>
          <button
            className={`bl-qf-chip bl-qf-ready ${quickFilter === 'canMake' ? 'active' : ''}`}
            onClick={() => setQuickFilter('canMake')}
          >
            Ready to Pour {canMakeCount > 0 && <span className="bl-qf-badge">{canMakeCount}</span>}
          </button>
          <button
            className={`bl-qf-chip bl-qf-almost ${quickFilter === 'almostReady' ? 'active' : ''}`}
            onClick={() => setQuickFilter('almostReady')}
          >
            Almost There {almostCount > 0 && <span className="bl-qf-badge">{almostCount}</span>}
          </button>
        </div>
      )}

      {/* ── Drinks list ── */}
      <div className="bl-drinks-list">
        {filtered.length === 0 ? (
          <div className="bl-empty-state">
            <div className="bl-empty-emoji">🍹</div>
            <p className="bl-empty-text">
              {search || category !== 'All' || quickFilter !== 'all'
                ? 'No drinks match your search.'
                : 'The bar is empty! Add cocktail recipes or import from Paprika.'}
            </p>
            {!search && category === 'All' && quickFilter === 'all' && (
              <button className="bl-btn-primary" onClick={onAdd}>
                Add a Drink
              </button>
            )}
          </div>
        ) : (
          filtered.map((drink, idx) => {
            const rarity = getDrinkRarity(drink);
            const rarityColor = getRarityColor(rarity);
            const rarityBadge = getRarityLabel(rarity);
            const ms = barInventory.length > 0 ? matchScore(drink, barInventory) : null;
            return (
              <div
                key={drink.id}
                className={`bl-drink-card${confirmDelete === drink.id ? ' with-delete' : ''} bl-card-${rarity}`}
                style={{
                  animationDelay: `${idx * 0.05}s`,
                  ...(rarityColor ? { borderLeftColor: rarityColor } : {}),
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
                  {/* Rarity badge overlay */}
                  {rarityBadge && (
                    <span className={`bl-rarity-pip bl-rarity-${rarity}`}>{rarityBadge}</span>
                  )}
                </div>
                <div className="bl-drink-info">
                  <div className="bl-drink-name" style={rarityColor ? { color: rarityColor } : undefined}>
                    {drink.name}
                  </div>
                  <div className="bl-drink-meta">
                    {drink.category && <span className="bl-cat-tag">{drink.category}</span>}
                    <span>{drink.ingredients?.length ?? 0} ingredients</span>
                    {ms && ms.pct > 0 && ms.pct < 100 && (
                      <span className="bl-meta-progress">{ms.pct}% ready</span>
                    )}
                    {ms && ms.pct === 100 && (
                      <span className="bl-meta-pour">Pour it!</span>
                    )}
                  </div>
                  {/* Mini progress bar */}
                  {ms && ms.total > 0 && (
                    <div className="bl-mini-progress">
                      <div
                        className="bl-mini-progress-fill"
                        style={{
                          width: `${ms.pct}%`,
                          background: ms.pct === 100 ? '#4caf50' : (rarityColor || '#ff4081'),
                        }}
                      />
                    </div>
                  )}
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
            );
          })
        )}
      </div>

      {/* ── Floating Import Button (bottom-right, matches Meal Library) ── */}
      <button className="bl-fab bl-fab-import" onClick={onImport} title="Import a drink">
        📥
      </button>

      {/* ── Floating Add Button ── */}
      <button className="bl-fab bl-fab-add" onClick={onAdd} title="Add new drink">
        +
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
