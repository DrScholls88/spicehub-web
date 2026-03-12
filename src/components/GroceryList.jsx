import { useState, useMemo, useCallback } from 'react';
import { saveStoreMemory as dbSaveStoreMemory, getStoreMemory as dbGetStoreMemory } from '../db';

const STORES = [
  { id: 'target',     name: 'Target',       color: '#cc0000', logo: 'https://www.google.com/s2/favicons?domain=target.com&sz=32' },
  { id: 'traderjoes', name: "Trader Joe's",  color: '#c41e3a', logo: 'https://www.google.com/s2/favicons?domain=traderjoes.com&sz=32' },
  { id: 'hyvee',      name: 'HyVee',         color: '#e31837', logo: 'https://www.google.com/s2/favicons?domain=hy-vee.com&sz=32' },
  { id: 'costco',     name: 'Costco',        color: '#005daa', logo: 'https://www.google.com/s2/favicons?domain=costco.com&sz=32' },
  { id: 'newpi',      name: 'NewPi CoOp',    color: '#2d8632', logo: 'https://www.google.com/s2/favicons?domain=newpi.coop&sz=32' },
  { id: 'other',      name: 'Other',         color: '#666',    logo: '' },
];

// ── Store memory: remembers which store each ingredient was last assigned to ──
async function rememberStore(ingredientName, storeId) {
  const key = ingredientName.toLowerCase().trim();
  await dbSaveStoreMemory(key, storeId || '');
  // Update window cache for instant UI feedback
  window._storeMemory = window._storeMemory || {};
  if (storeId) {
    window._storeMemory[key] = storeId;
  } else {
    delete window._storeMemory[key];
  }
}

// ── Share / export helper ────────────────────────────────────────────────────
function sendToKeep(title, content, onToast) {
  // Mobile: native share sheet (user picks Google Keep from the sheet)
  if (navigator.share) {
    navigator.share({ title, text: content }).catch(() => {});
    return;
  }
  // Desktop: copy to clipboard, then open Google Keep in a new tab
  navigator.clipboard.writeText(`${title}\n\n${content}`).then(() => {
    if (onToast) onToast('Copied to clipboard — paste into Google Keep', 'success');
    window.open('https://keep.google.com/#NOTE', '_blank');
  }).catch(() => {
    if (onToast) onToast('Could not copy to clipboard', 'error');
  });
}

export default function GroceryList({ items, setItems, weekPlan, onRebuild, onToast }) {
  const [batchMode, setBatchMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [batchStoreOverlayOpen, setBatchStoreOverlayOpen] = useState(false);

  // ── Item actions ────────────────────────────────────────────────────────────
  const toggleCheck = (index) => {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, checked: !item.checked } : item));
  };

  const setStore = useCallback((index, storeId) => {
    rememberStore(items[index].name, storeId); // Save to IndexedDB
    setItems(prev => prev.map((item, i) => {
      if (i === index) { return { ...item, store: storeId }; }
      return item;
    }));
  }, [setItems, items]);

  // ── Batch operations ────────────────────────────────────────────────────────
  const toggleSelect = (index) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const selectAllUnsorted = () => {
    const unsortedIdxs = items.map((item, i) => !item.store ? i : -1).filter(i => i >= 0);
    setSelectedItems(new Set(unsortedIdxs));
  };

  const batchAssignStore = (storeId) => {
    // Save all selected items to IndexedDB
    selectedItems.forEach(i => rememberStore(items[i].name, storeId));

    setItems(prev => prev.map((item, i) => {
      if (selectedItems.has(i)) { return { ...item, store: storeId }; }
      return item;
    }));
    setSelectedItems(new Set());
    setBatchStoreOverlayOpen(false);
    setBatchMode(false);
  };

  const autoAssignFromMemory = async () => {
    const mem = await dbGetStoreMemory();
    let assigned = 0;
    setItems(prev => prev.map(item => {
      if (!item.store) {
        const remembered = mem[item.name.toLowerCase().trim()];
        if (remembered) { assigned++; return { ...item, store: remembered }; }
      }
      return item;
    }));
    if (assigned > 0 && onToast) onToast(`Auto-assigned ${assigned} items from memory`, 'success');
    else if (onToast) onToast('No remembered store assignments found', 'info');
  };

  // ── Group items ──────────────────────────────────────────────────────────────
  const unsorted = useMemo(() =>
    items.map((item, i) => ({ ...item, _idx: i })).filter(i => !i.store),
  [items]);

  const byStore = useMemo(() =>
    STORES.map(s => ({
      ...s,
      items: items.map((item, idx) => ({ ...item, _idx: idx })).filter(i => i.store === s.id),
    })).filter(g => g.items.length > 0),
  [items]);

  const checkedCount = items.filter(i => i.checked).length;
  const progressPercent = Math.round((checkedCount / items.length) * 100);

  // ── Export text builders ──────────────────────────────────────────────────────
  const buildStoreText = (storeId) => {
    return items
      .filter(i => i.store === storeId && !i.checked)
      .map(i => i.name)
      .join('\n');
  };

  const buildFullGroceryText = () => {
    const lines = [];
    const storeGroups = STORES.map(s => ({
      ...s,
      items: items.filter(i => i.store === s.id && !i.checked),
    })).filter(g => g.items.length > 0);
    const unsortedItems = items.filter(i => !i.store && !i.checked);
    for (const group of storeGroups) {
      lines.push(`\n--- ${group.name} ---`);
      for (const item of group.items) lines.push(item.name);
    }
    if (unsortedItems.length > 0) {
      lines.push('\n--- Other ---');
      for (const item of unsortedItems) lines.push(item.name);
    }
    return lines.join('\n').trim();
  };

  const buildWeekPlanText = () => {
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    return DAYS.map((day, i) => {
      const entry = weekPlan[i];
      if (!entry) return `${day}: (no plan)`;
      if (entry._special) return `${day}: ${entry.icon} ${entry.name}`;
      return `${day}: ${entry.name}`;
    }).join('\n');
  };

  // ── Keep export handlers ──────────────────────────────────────────────────────
  const sendStoreToKeep = (storeId) => {
    const store = STORES.find(s => s.id === storeId);
    const content = buildStoreText(storeId);
    if (!content) return;
    sendToKeep(`${store.name} Shopping List`, content, onToast);
  };

  const sendFullGroceryToKeep = () => {
    sendToKeep('Grocery List - SpiceHub', buildFullGroceryText(), onToast);
  };

  const sendWeekPlanToKeep = () => {
    sendToKeep('Meal Plan - SpiceHub', buildWeekPlanText(), onToast);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  if (items.length === 0) {
    return (
      <div className="gl-container">
        <div className="gl-empty-state">
          <p>No grocery list yet.</p>
          <p>Generate a week plan first, then tap "Grocery List" to build your shopping list.</p>
          {weekPlan.some(m => m && !m._special) && (
            <button className="btn-primary" onClick={onRebuild}>Build Grocery List</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="gl-container">
      {/* ── Progress bar ── */}
      <div className="gl-progress-section">
        <div className="gl-progress-bar">
          <div className="gl-progress-fill" style={{ width: `${progressPercent}%` }}></div>
        </div>
        <div className="gl-progress-text">{checkedCount}/{items.length} items completed</div>
      </div>

      {/* ── Top toolbar (sticky) ── */}
      <div className="gl-top-toolbar">
        <button
          className={`gl-btn-batch ${batchMode ? 'gl-active' : ''}`}
          onClick={() => { setBatchMode(!batchMode); setSelectedItems(new Set()); setBatchStoreOverlayOpen(false); }}
        >
          {batchMode ? '✕' : '⟂'} {batchMode ? 'Done' : 'Batch'}
        </button>
        {unsorted.length > 0 && (
          <button className="gl-btn-auto-sort" onClick={autoAssignFromMemory}>
            ◆ Auto Sort
          </button>
        )}
        <button className="gl-btn-rebuild" onClick={onRebuild}>⟲ Rebuild</button>
      </div>

      {/* ── Batch mode sticky toolbar ── */}
      {batchMode && (
        <div className="gl-batch-toolbar">
          <span className="gl-batch-count">{selectedItems.size} selected</span>
          {unsorted.length > 0 && (
            <button className="gl-btn-select-all" onClick={selectAllUnsorted}>
              Select All
            </button>
          )}
          <button
            className="gl-btn-assign-store"
            disabled={selectedItems.size === 0}
            onClick={() => setBatchStoreOverlayOpen(!batchStoreOverlayOpen)}
          >
            Assign Store
          </button>
        </div>
      )}

      {/* ── Floating action buttons (bottom bar) ── */}
      <div className="gl-floating-actions">
        <button className="gl-btn-keep-primary" onClick={sendFullGroceryToKeep}>
          <KeepIcon /> Send All to Keep
        </button>
        <button className="gl-btn-keep-secondary" onClick={sendWeekPlanToKeep}>
          📅 Meal Plan
        </button>
      </div>

      {/* ── Batch store picker overlay (full-screen bottom sheet) ── */}
      {batchStoreOverlayOpen && (
        <>
          <div className="gl-overlay-backdrop" onClick={() => setBatchStoreOverlayOpen(false)}></div>
          <div className="gl-overlay-sheet">
            <div className="gl-sheet-header">
              <h2>Assign Store to {selectedItems.size} items</h2>
              <button className="gl-sheet-close" onClick={() => setBatchStoreOverlayOpen(false)}>✕</button>
            </div>
            <div className="gl-sheet-content">
              {STORES.map(s => (
                <button
                  key={s.id}
                  className="gl-store-option"
                  style={{ borderLeftColor: s.color }}
                  onClick={() => batchAssignStore(s.id)}
                >
                  <StoreLogo store={s} size={28} />
                  <span className="gl-store-option-name">{s.name}</span>
                  <span className="gl-store-option-arrow">›</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Unsorted section ── */}
      {unsorted.length > 0 && (
        <div className="gl-section">
          <div className="gl-section-header">
            <div className="gl-section-title">Unsorted</div>
            <span className="gl-section-count">{unsorted.length}</span>
          </div>
          {unsorted.map(item => (
            <GroceryItem
              key={item._idx}
              item={item}
              batchMode={batchMode}
              isSelected={selectedItems.has(item._idx)}
              onToggleCheck={() => toggleCheck(item._idx)}
              onToggleSelect={() => toggleSelect(item._idx)}
              onSetStore={(storeId) => setStore(item._idx, storeId)}
              stores={STORES}
            />
          ))}
        </div>
      )}

      {/* ── Store sections ── */}
      {byStore.map(group => (
        <div key={group.id} className="gl-section">
          <div className="gl-section-header">
            <div className="gl-section-title" style={{ borderLeftColor: group.color }}>
              <StoreLogo store={group} size={20} />
              {group.name}
            </div>
            <div className="gl-section-right">
              <span className="gl-section-count">{group.items.length}</span>
              <button
                className="gl-btn-keep-section"
                onClick={() => sendStoreToKeep(group.id)}
                title={`Send ${group.name} to Google Keep`}
              >
                <KeepIcon size={16} />
              </button>
            </div>
          </div>
          {group.items.map(item => (
            <GroceryItem
              key={item._idx}
              item={item}
              batchMode={batchMode}
              isSelected={selectedItems.has(item._idx)}
              onToggleCheck={() => toggleCheck(item._idx)}
              onToggleSelect={() => toggleSelect(item._idx)}
              onSetStore={(storeId) => setStore(item._idx, storeId)}
              stores={STORES}
              isAssigned
            />
          ))}
        </div>
      ))}

      {/* Bottom padding for floating action bar */}
      <div style={{ height: '80px' }}></div>
    </div>
  );
}

// ── Individual grocery item ─────────────────────────────────────────────────
function GroceryItem({ item, batchMode, isSelected, onToggleCheck, onToggleSelect, onSetStore, stores, isAssigned }) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className={`gl-item ${item.checked ? 'gl-item-checked' : ''} ${isSelected ? 'gl-item-selected' : ''}`}>
      <div className="gl-item-content">
        {batchMode ? (
          <label className="gl-checkbox-label" onClick={onToggleSelect}>
            <input
              type="checkbox"
              className="gl-checkbox-input"
              checked={isSelected}
              onChange={onToggleSelect}
              aria-label={`Select ${item.name}`}
            />
            <span className="gl-item-text">{item.name}</span>
          </label>
        ) : (
          <label className="gl-checkbox-label">
            <input
              type="checkbox"
              className="gl-checkbox-input"
              checked={item.checked}
              onChange={onToggleCheck}
              aria-label={`Check off ${item.name}`}
            />
            <span className={`gl-item-text ${item.checked ? 'gl-item-text-checked' : ''}`}>
              {item.name}
            </span>
          </label>
        )}
      </div>

      {!batchMode && (
        <div className="gl-item-actions">
          <button
            className={`gl-btn-store ${isAssigned ? 'gl-btn-store-assigned' : ''}`}
            onClick={() => setPickerOpen(!pickerOpen)}
            title={isAssigned ? 'Change store' : 'Assign store'}
            aria-expanded={pickerOpen}
          >
            {isAssigned ? '◈' : '◇'}
          </button>

          {pickerOpen && (
            <>
              <div className="gl-picker-backdrop" onClick={() => setPickerOpen(false)}></div>
              <div className="gl-item-picker">
                {stores.map(s => (
                  <button
                    key={s.id}
                    className="gl-picker-option"
                    style={{ borderLeftColor: s.color }}
                    onClick={() => { onSetStore(s.id); setPickerOpen(false); }}
                  >
                    <StoreLogo store={s} size={20} />
                    {s.name}
                  </button>
                ))}
                {isAssigned && (
                  <button
                    className="gl-picker-option gl-picker-unsort"
                    onClick={() => { onSetStore(''); setPickerOpen(false); }}
                  >
                    ◇ Unsort
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Store logo: favicon with letter fallback ────────────────────────────────
function StoreLogo({ store, size = 20 }) {
  if (!store.logo) {
    return (
      <span
        className="gl-store-logo-letter"
        style={{ background: store.color, width: size, height: size, fontSize: size * 0.55 }}
      >
        {store.name[0]}
      </span>
    );
  }
  return (
    <img
      src={store.logo}
      alt=""
      className="gl-store-logo-img"
      style={{ width: size, height: size }}
      onError={e => {
        // Fallback: replace with letter badge
        const span = document.createElement('span');
        span.className = 'gl-store-logo-letter';
        span.style.cssText = `background:${store.color};width:${size}px;height:${size}px;font-size:${size * 0.55}px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;color:white;font-weight:700;flex-shrink:0;`;
        span.textContent = store.name[0];
        e.target.replaceWith(span);
      }}
    />
  );
}

// ── Tiny Google Keep icon ───────────────────────────────────────────────────
function KeepIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <rect x="5" y="2" width="14" height="20" rx="2" fill="#FBBC04" />
      <circle cx="12" cy="9" r="3" fill="#fff" />
      <rect x="11" y="11" width="2" height="5" rx="1" fill="#fff" />
    </svg>
  );
}
