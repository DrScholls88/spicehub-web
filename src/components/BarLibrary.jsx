import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import db from '../db';
import { getBarInventory } from '../db';
import SafeMediaImage from './SafeMediaImage';
import useBackHandler from '../hooks/useBackHandler';

// ── Assignable drink categories ──────────────────────────────────────────────
const DRINK_CATEGORY_OPTIONS = [
  'Cocktail', 'Mocktail', 'Beer & Wine', 'Spirits', 'Shots', 'Non-Alcoholic',
];
export const BAR_CATEGORIES = ['All', ...DRINK_CATEGORY_OPTIONS];

// ── Rarity system ────────────────────────────────────────────────────────────
const LEGENDARY_NAMES = [
  'negroni','manhattan','old fashioned','mai tai','singapore sling','sazerac',
  'corpse reviver','aviation','last word','paper plane',
];

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
  return null;
}

function getRarityLabel(rarity) {
  if (rarity === 'legendary') return '★';
  if (rarity === 'rare') return '◆';
  return '';
}

// ── Ingredient matching (inventory-powered) ───────────────────────────────────
function matchScore(drink, inventory) {
  if (!drink.ingredients?.length || !inventory.length) {
    return { matched: 0, total: 0, missing: 0, pct: 0 };
  }
  let matched = 0;
  for (const ing of drink.ingredients) {
    const ingLower = ing.toLowerCase();
    if (inventory.some(inv => ingLower.includes(inv) || inv.includes(ingLower.split(' ').pop()))) {
      matched++;
    }
  }
  const total = drink.ingredients.length;
  return { matched, total, missing: total - matched, pct: Math.round((matched / total) * 100) };
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
  onImport, onReload, onToast, onOpenShelf, onOpenBarFridge,
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

  const longPressTimer    = useRef(null);
  const touchStartPos     = useRef(null);
  const sheetRef          = useRef(null);
  const sheetDragStartY   = useRef(null);
  const sheetCurrentDragY = useRef(0);
  const restoreRef        = useRef(null);

  useEffect(() => { getBarInventory().then(setBarInventory); }, []);

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

    return result;
  }, [drinks, search, category, quickFilter, barInventory]);

  const sorted = useMemo(() =>
    [...filtered].sort((a, b) => {
      const aDate = a.importedAt || a.createdAt || a.created || '';
      const bDate = b.importedAt || b.createdAt || b.created || '';
      return bDate.localeCompare(aDate);
    }),
  [filtered]);

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

  // ── Quick preview swipe-to-dismiss ────────────────────────────────────────
  const handleSheetTouchStart = useCallback((e) => {
    sheetDragStartY.current  = e.touches[0].clientY;
    sheetCurrentDragY.current = 0;
    if (sheetRef.current) sheetRef.current.style.transition = 'none';
  }, []);

  const handleSheetTouchMove = useCallback((e) => {
    const dy = e.touches[0].clientY - sheetDragStartY.current;
    if (dy < 0) return;
    sheetCurrentDragY.current = dy;
    if (sheetRef.current) sheetRef.current.style.transform = 'translateY(' + dy + 'px)';
  }, []);

  const handleSheetTouchEnd = useCallback(() => {
    if (sheetRef.current) sheetRef.current.style.transition = '';
    if (sheetCurrentDragY.current > 100) { setQuickPreview(null); }
    else if (sheetRef.current) sheetRef.current.style.transform = '';
  }, []);

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

  // ── Tile click ────────────────────────────────────────────────────────────
  const handleTileClick = useCallback((drink) => {
    if (selectMode) { toggleSelect(drink.id); return; }
    onViewDetail?.(drink);
  }, [selectMode, onViewDetail, toggleSelect]);

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
      </div>

      {/* Enter the Saloon hero button */}
      {onOpenShelf && (
        <button className="bl-saloon-btn" onClick={onOpenShelf}>
          <span className="bl-saloon-icon">&#127918;</span>
          <span className="bl-saloon-text">Enter the Saloon</span>
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

      {/* Tile gallery */}
      <div className="bl-gallery">
        {sorted.length === 0 ? (
          <div className="bl-empty-state" style={{ gridColumn: '1 / -1' }}>
            <div className="bl-empty-emoji">&#127865;</div>
            <p className="bl-empty-text">
              {search || category !== 'All' || quickFilter !== 'all'
                ? 'No drinks match your search.'
                : 'The bar is empty! Import cocktails from Instagram or add one manually.'}
            </p>
            {!search && category === 'All' && quickFilter === 'all' && (
              <div className="bl-empty-actions">
                <button className="bl-btn-primary" onClick={onImport}>Import from Instagram</button>
                <button className="bl-btn-secondary" onClick={onAdd}>+ Add Manually</button>
              </div>
            )}
          </div>
        ) : (
          sorted.map((drink, idx) => {
            const rarity      = getDrinkRarity(drink);
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

                <div className="bl-tile-image">
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
                  {ms && ms.pct === 100 && (
                    <span className="bl-tile-pour">&#127864;</span>
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
                </div>

                <div className="bl-tile-info">
                  <span
                    className="bl-tile-name"
                    style={rarityColor ? { color: rarityColor } : undefined}
                  >
                    {drink.name || 'Untitled Drink'}
                  </span>
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
                          background: ms.pct === 100 ? '#4caf50' : (rarityColor || '#8b5cf6'),
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* FABs */}
      <div className="bl-fab-group">
        <button className="bl-fab bl-fab-import" onClick={onImport} title="Import a drink">
          <span>&#128229;</span>
          <span className="bl-fab-label">Import</span>
        </button>
        <button className="bl-fab bl-fab-add" onClick={onAdd} title="Add new drink">+</button>
      </div>

      {/* Quick Preview bottom sheet */}
      {quickPreview && (
        <div className="bl-qp-overlay" onClick={() => setQuickPreview(null)}>
          <div
            ref={sheetRef}
            className="bl-qp-sheet"
            onClick={e => e.stopPropagation()}
            onTouchStart={handleSheetTouchStart}
            onTouchMove={handleSheetTouchMove}
            onTouchEnd={handleSheetTouchEnd}
            onTouchCancel={handleSheetTouchEnd}
          >
            <div className="bl-qp-handle" />
            {quickPreview.imageUrl && (
              <SafeMediaImage
                src={quickPreview.imageUrl}
                alt={quickPreview.name || 'Drink'}
                style={{ width: '100%', height: 200, objectFit: 'cover', borderRadius: '12px 12px 0 0', flexShrink: 0, display: 'block' }}
                fallbackEmoji="&#127865;"
              />
            )}
            <div className="bl-qp-body">
              <h3 className="bl-qp-title">{quickPreview.name || 'Untitled Drink'}</h3>

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
                <button
                  className="bl-qp-btn bl-qp-btn-danger"
                  onClick={() => { setQuickPreview(null); setConfirmDelete(quickPreview.id); }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
          </div>
        </>
      )}
    </div>
  );
}
