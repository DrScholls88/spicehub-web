import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { saveStoreMemory as dbSaveStoreMemory, getStoreMemory as dbGetStoreMemory } from '../db';

const STORES = [
  { id: 'target',     name: 'Target',       color: '#cc0000', logo: 'https://www.google.com/s2/favicons?domain=target.com&sz=32' },
  { id: 'traderjoes', name: "Trader Joe's",  color: '#c41e3a', logo: 'https://www.google.com/s2/favicons?domain=traderjoes.com&sz=32' },
  { id: 'hyvee',      name: 'HyVee',         color: '#e31837', logo: 'https://www.google.com/s2/favicons?domain=hy-vee.com&sz=32' },
  { id: 'costco',     name: 'Costco',        color: '#005daa', logo: 'https://www.google.com/s2/favicons?domain=costco.com&sz=32' },
  { id: 'newpi',      name: 'NewPi CoOp',    color: '#2d8632', logo: 'https://www.google.com/s2/favicons?domain=newpi.coop&sz=32' },
  { id: 'other',      name: 'Other',         color: '#666',    logo: '' },
];

const PANTRY_ID = '__pantry__';
const PANTRY_STORE = { id: PANTRY_ID, name: 'In Pantry', color: '#4caf50', logo: '' };

async function rememberStore(ingredientName, storeId) {
  const key = ingredientName.toLowerCase().trim();
  await dbSaveStoreMemory(key, storeId || '');
  window._storeMemory = window._storeMemory || {};
  if (storeId) window._storeMemory[key] = storeId;
  else delete window._storeMemory[key];
}

function sendToKeep(title, content, onToast) {
  if (navigator.share) {
    navigator.share({ title, text: content }).catch(() => {});
    return;
  }
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

  // View modes
  const [viewMode, setViewMode] = useState('simple'); // 'simple' | 'detailed'

  // Drag State
  const [draggedItems, setDraggedItems] = useState(null);

  const consolidateItems = useCallback((itemList) => {
    if (viewMode === 'detailed') return itemList.map(i => ({...i, indices: [i._idx], names: [i.name]}));
    const map = new Map();
    itemList.forEach(item => {
      const key = item.name.toLowerCase().trim();
      if (!map.has(key)) {
        map.set(key, { ...item, indices: [item._idx], names: [item.name], quantity: 1, allChecked: item.checked });
      } else {
        const existing = map.get(key);
        existing.indices.push(item._idx);
        existing.names.push(item.name);
        existing.quantity += 1;
        existing.allChecked = existing.allChecked && item.checked;
      }
    });
    return Array.from(map.values()).map(g => ({ ...g, checked: g.allChecked, _idx: g.indices[0], isConsolidated: g.quantity > 1 }));
  }, [viewMode]);

  // ── Item actions ────────────────────────────────────────────────────────────
  const toggleCheck = useCallback((indices) => {
    setItems(prev => {
      const anyUnchecked = indices.some(idx => !prev[idx].checked);
      return prev.map((item, i) => indices.includes(i) ? { ...item, checked: anyUnchecked } : item);
    });
  }, [setItems]);

  const removeItem = useCallback((indices) => {
    setItems(prev => prev.filter((_, i) => !indices.includes(i)));
  }, [setItems]);

  const markAsPantry = useCallback((indices, names) => {
    names.forEach(n => rememberStore(n, PANTRY_ID));
    setItems(prev => prev.map((item, i) => indices.includes(i) ? { ...item, store: PANTRY_ID } : item));
  }, [setItems]);

  const unmarkPantry = useCallback((indices, names) => {
    names.forEach(n => rememberStore(n, ''));
    setItems(prev => prev.map((item, i) => indices.includes(i) ? { ...item, store: '' } : item));
  }, [setItems]);

  const setStore = useCallback((indices, names, storeId) => {
    names.forEach(n => rememberStore(n, storeId));
    setItems(prev => prev.map((item, i) => indices.includes(i) ? { ...item, store: storeId } : item));
  }, [setItems]);

  // Drag & Drop Handlers
  const handleDragStart = (e, indices, names) => {
    setDraggedItems({indices, names});
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDrop = (e, storeId) => {
    e.preventDefault();
    if (draggedItems) {
      if (storeId === PANTRY_ID) markAsPantry(draggedItems.indices, draggedItems.names);
      else if (storeId === 'unsorted') unmarkPantry(draggedItems.indices, draggedItems.names);
      else setStore(draggedItems.indices, draggedItems.names, storeId);
    }
    setDraggedItems(null);
  };
  const handleDragOver = (e) => e.preventDefault();

  // ── Batch operations ────────────────────────────────────────────────────────
  const toggleSelect = (indices) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      const isSelected = indices.every(idx => next.has(idx));
      indices.forEach(idx => isSelected ? next.delete(idx) : next.add(idx));
      return next;
    });
  };

  const selectAllUnsorted = () => {
    const unsortedIdxs = items.map((item, i) => !item.store ? i : -1).filter(i => i >= 0);
    setSelectedItems(new Set(unsortedIdxs));
  };

  const batchAssignStore = (storeId) => {
    selectedItems.forEach(i => rememberStore(items[i].name, storeId));
    setItems(prev => prev.map((item, i) => selectedItems.has(i) ? { ...item, store: storeId } : item));
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

  const buildFullGroceryText = () => {
    const lines = [];
    lines.push('🎯 THIS WEEK’S PLAN');
    lines.push(buildWeekPlanText());
    lines.push('\n🛒 GROCERY LIST');
    
    const storeGroups = STORES.map(s => ({
      ...s,
      items: items.map((item, i) => ({...item, _idx: i})).filter(i => i.store === s.id && !i.checked),
    })).filter(g => g.items.length > 0);
    const unsortedItems = items.map((item, i) => ({...item, _idx: i})).filter(i => !i.store && !i.checked && i.store !== PANTRY_ID);
    
    for (const group of storeGroups) {
      lines.push(`\n--- ${group.name} ---`);
      for (const item of consolidateItems(group.items)) {
         lines.push(`• ${item.name}${item.quantity > 1 ? ` (×${item.quantity})` : ''}`);
      }
    }
    if (unsortedItems.length > 0) {
      lines.push('\n--- Other ---');
      for (const item of consolidateItems(unsortedItems)) {
         lines.push(`• ${item.name}${item.quantity > 1 ? ` (×${item.quantity})` : ''}`);
      }
    }
    return lines.join('\n').trim();
  };

  const buildStoreText = (storeId) => {
    const lines = [];
    lines.push(`🛒 ${STORES.find(s=>s.id===storeId)?.name || 'Store'} List`);
    const storeItems = items.map((item, i) => ({...item, _idx: i})).filter(i => i.store === storeId && !i.checked);
    for (const item of consolidateItems(storeItems)) {
        lines.push(`• ${item.name}${item.quantity > 1 ? ` (×${item.quantity})` : ''}`);
    }
    return lines.join('\n');
  };

  const sendStoreToKeep = (storeId) => {
    const store = STORES.find(s => s.id === storeId);
    sendToKeep(`${store.name} Shopping List`, buildStoreText(storeId), onToast);
  };

  const sendFullGroceryToKeep = () => {
    sendToKeep('Grocery List - SpiceHub', buildFullGroceryText(), onToast);
  };

  const sendWeekPlanToKeep = () => {
    sendToKeep('Meal Plan - SpiceHub', buildWeekPlanText(), onToast);
  };

  // Group views
  const rawUnsorted = items.map((item, i) => ({ ...item, _idx: i })).filter(i => !i.store);
  const rawPantry = items.map((item, i) => ({ ...item, _idx: i })).filter(i => i.store === PANTRY_ID);

  const unsortedList = consolidateItems(rawUnsorted);
  const pantryList = consolidateItems(rawPantry);
  
  const byStore = STORES.map(s => ({
    ...s,
    items: consolidateItems(items.map((item, idx) => ({ ...item, _idx: idx })).filter(i => i.store === s.id)),
  })).filter(g => g.items.length > 0);

  const activeItems = items.filter(i => i.store !== PANTRY_ID);
  const checkedCount = activeItems.filter(i => i.checked).length;
  const progressPercent = activeItems.length > 0 ? Math.round((checkedCount / activeItems.length) * 100) : 0;

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
          <motion.div className="gl-progress-fill" animate={{ width: `${progressPercent}%` }} layout />
        </div>
        <div className="gl-progress-text">
          {checkedCount}/{activeItems.length} items
          {pantryList.length > 0 && <span className="gl-pantry-badge"> · {rawPantry.length} in pantry</span>}
        </div>
      </div>

      {/* ── Top toolbar (sticky) ── */}
      <div className="gl-top-toolbar">
        <button
          className={`gl-btn-batch ${batchMode ? 'gl-active' : ''}`}
          onClick={() => { setBatchMode(!batchMode); setSelectedItems(new Set()); setBatchStoreOverlayOpen(false); }}
        >
          {batchMode ? '✕ Done' : '⟂ Batch'}
        </button>
        <button className="gl-btn-auto-sort" onClick={() => setViewMode(v => v === 'simple' ? 'detailed' : 'simple')}>
          {viewMode === 'simple' ? '≣ Detailed' : '≡ Simple'}
        </button>
        {rawUnsorted.length > 0 && !batchMode && (
          <button className="gl-btn-auto-sort" onClick={autoAssignFromMemory}>
            ◆ Auto Sort
          </button>
        )}
      </div>

      {/* ── Batch mode sticky toolbar ── */}
      {batchMode && (
        <div className="gl-batch-toolbar">
          <span className="gl-batch-count">{selectedItems.size} selected</span>
          {rawUnsorted.length > 0 && (
            <button className="gl-btn-select-all" onClick={selectAllUnsorted}>
              Select All Unsorted
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

      {/* ── Floating actions (bottom bar) ── */}
      <div className="gl-floating-actions">
        <button className="gl-btn-keep-primary" onClick={sendFullGroceryToKeep}>
          <KeepIcon /> Keep Export
        </button>
        <button className="gl-btn-keep-secondary" onClick={sendWeekPlanToKeep}>
          📅 Week
        </button>
      </div>

      {/* ── Batch store picker overlay ── */}
      <AnimatePresence>
      {batchStoreOverlayOpen && (
        <>
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="gl-overlay-backdrop" onClick={() => setBatchStoreOverlayOpen(false)}></motion.div>
          <motion.div initial={{y:'100%'}} animate={{y:0}} exit={{y:'100%'}} transition={{friction: 20}} className="gl-overlay-sheet">
            <div className="gl-sheet-header">
              <h2>Assign Store ({selectedItems.size} items)</h2>
              <button className="gl-sheet-close" onClick={() => setBatchStoreOverlayOpen(false)}>✕</button>
            </div>
            <div className="gl-sheet-content">
              <button className="gl-store-option" style={{ borderLeftColor: '#4caf50' }} onClick={() => batchAssignStore(PANTRY_ID)}>
                <span className="gl-store-logo-letter" style={{ background: '#4caf50', width: 28, height: 28, fontSize: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', color: 'white', fontWeight: 700, flexShrink: 0 }}>✓</span>
                <span className="gl-store-option-name">In Pantry</span>
              </button>
              {STORES.map(s => (
                <button key={s.id} className="gl-store-option" style={{ borderLeftColor: s.color }} onClick={() => batchAssignStore(s.id)}>
                  <StoreLogo store={s} size={28} />
                  <span className="gl-store-option-name">{s.name}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </>
      )}
      </AnimatePresence>

      <div style={{ paddingBottom: '90px' }}>
        <AnimatePresence>
        {/* ── Unsorted section ── */}
        {unsortedList.length > 0 && (
          <motion.div layout initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="gl-section" onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, 'unsorted')}>
            <div className="gl-section-header">
              <div className="gl-section-title">Unsorted</div>
              <span className="gl-section-count">{rawUnsorted.length}</span>
            </div>
            {unsortedList.map(item => (
              <GroceryItem
                key={item._idx}
                item={item}
                batchMode={batchMode}
                isSelected={item.indices.every(idx => selectedItems.has(idx))} // True only if all underlying selected
                onToggleCheck={() => toggleCheck(item.indices)}
                onToggleSelect={() => toggleSelect(item.indices)}
                onSetStore={(storeId) => setStore(item.indices, item.names, storeId)}
                onMarkPantry={() => markAsPantry(item.indices, item.names)}
                onRemove={() => removeItem(item.indices)}
                onDragStart={(e) => handleDragStart(e, item.indices, item.names)}
                stores={STORES}
              />
            ))}
          </motion.div>
        )}

        {/* ── Store sections ── */}
        {byStore.map(group => (
          <motion.div layout initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} key={group.id} className="gl-section" onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, group.id)}>
            <div className="gl-section-header">
              <div className="gl-section-title" style={{ borderLeftColor: group.color }}>
                <StoreLogo store={group} size={20} />
                {group.name}
              </div>
              <div className="gl-section-right">
                <span className="gl-section-count">{group.items.reduce((acc, i) => acc + i.quantity, 0)}</span>
                <button className="gl-btn-keep-section" onClick={() => sendStoreToKeep(group.id)}>
                  <KeepIcon size={16} />
                </button>
              </div>
            </div>
            {group.items.map(item => (
              <GroceryItem
                key={item._idx}
                item={item}
                batchMode={batchMode}
                isSelected={item.indices.every(idx => selectedItems.has(idx))}
                onToggleCheck={() => toggleCheck(item.indices)}
                onToggleSelect={() => toggleSelect(item.indices)}
                onSetStore={(storeId) => setStore(item.indices, item.names, storeId)}
                onMarkPantry={() => markAsPantry(item.indices, item.names)}
                onRemove={() => removeItem(item.indices)}
                onDragStart={(e) => handleDragStart(e, item.indices, item.names)}
                stores={STORES}
                isAssigned
              />
            ))}
          </motion.div>
        ))}

        {/* ── Pantry section ── */}
        {pantryList.length > 0 && (
          <motion.div layout initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="gl-section gl-pantry-section" onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, PANTRY_ID)}>
            <div className="gl-section-header">
              <div className="gl-section-title" style={{ borderLeftColor: '#4caf50' }}>
                <span className="gl-store-logo-letter" style={{ background: '#4caf50', width: 20, height: 20, fontSize: 11 }}>✓</span>
                In Pantry
              </div>
              <span className="gl-section-count">{rawPantry.length}</span>
            </div>
            {pantryList.map(item => (
              <motion.div layout key={item._idx} className="gl-item gl-item-pantry" draggable onDragStart={(e) => handleDragStart(e, item.indices, item.names)}>
                <div className="gl-item-content">
                  <span className="gl-pantry-check">✓</span>
                  <span className="gl-item-text gl-item-text-pantry">{item.name} {item.quantity > 1 && <span style={{marginLeft:4, opacity: 0.6}}>×{item.quantity}</span>}</span>
                </div>
                <div className="gl-item-actions">
                  <button className="gl-btn-unpantry" onClick={() => unmarkPantry(item.indices, item.names)}>↩</button>
                  <button className="gl-btn-remove" onClick={() => removeItem(item.indices)}>✕</button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Individual grocery item ──
function GroceryItem({ item, batchMode, isSelected, onToggleCheck, onToggleSelect, onSetStore, onMarkPantry, onRemove, stores, isAssigned, onDragStart }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const x = useMotionValue(0);
  
  // Dynamic colors for swipe reveals
  const background = useTransform(x, [-100, 0, 100], ['#e8f5e9', 'var(--surface)', '#ffebee']);
  const pantryOpacity = useTransform(x, [-80, -30], [1, 0]);
  const removeOpacity = useTransform(x, [30, 80], [0, 1]);

  const handleDragEnd = (event, info) => {
    const threshold = 60;
    if (info.offset.x > threshold && onRemove) {
      onRemove();
    } else if (info.offset.x < -threshold && onMarkPantry) {
      onMarkPantry();
    }
  };

  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
      style={{ position: 'relative', overflow: 'hidden', background: 'var(--surface)', borderRadius: 'var(--radius-sm)', marginBottom: '4px' }}
      className={`gl-item ${item.checked ? 'gl-item-checked' : ''} ${isSelected ? 'gl-item-selected' : ''}`}
    >
      {/* Swipe reveal layers */}
      {!batchMode && (
        <motion.div style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px', zIndex: 0, background }}>
           <motion.span style={{ color: '#f44336', fontWeight: 600, opacity: removeOpacity }}>✕ Remove</motion.span>
           <motion.span style={{ color: '#4caf50', fontWeight: 600, opacity: pantryOpacity }}>✓ To Pantry</motion.span>
        </motion.div>
      )}

      {/* Main draggable surface */}
      <motion.div 
        style={{ x, position: 'relative', zIndex: 1, background: 'var(--card)', width: '100%', display: 'flex', alignItems: 'center', height: '100%' }}
        drag={batchMode ? false : "x"}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.4}
        onDragEnd={handleDragEnd}
        draggable={!batchMode}
        onDragStart={(e) => {
          if (!pickerOpen && onDragStart) onDragStart(e);
        }}
      >
        <div className="gl-item-content" style={{ flex: 1 }}>
          {batchMode ? (
            <label className="gl-checkbox-label" onClick={onToggleSelect}>
              <input type="checkbox" className="gl-checkbox-input" checked={isSelected} onChange={onToggleSelect} />
              <span className="gl-item-text">{item.name} {item.quantity > 1 && <strong style={{ color: 'var(--primary)', marginLeft: 6 }}>×{item.quantity}</strong>}</span>
            </label>
          ) : (
            <label className="gl-checkbox-label" 
              onContextMenu={(e) => { e.preventDefault(); setPickerOpen(true); }} // Long press logic
            >
              <input type="checkbox" className="gl-checkbox-input" checked={item.checked} onChange={onToggleCheck} />
              <span className={`gl-item-text ${item.checked ? 'gl-item-text-checked' : ''}`}>
                {item.name} {item.quantity > 1 && <strong style={{ color: 'var(--primary)', marginLeft: 6, opacity: item.checked ? 0.5 : 1 }}>×{item.quantity}</strong>}
              </span>
            </label>
          )}
        </div>

        {!batchMode && (
          <div className="gl-item-actions" style={{ paddingRight: '8px' }}>
            <button className={`gl-btn-store ${isAssigned ? 'gl-btn-store-assigned' : ''}`} onClick={() => setPickerOpen(true)}>
              {isAssigned ? '◈' : '◇'}
            </button>
            
            {/* Quick picker overlay for this item */}
            <AnimatePresence>
            {pickerOpen && (
              <>
                <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="gl-picker-backdrop" style={{position:'fixed', zIndex: 90}} onClick={() => setPickerOpen(false)}></motion.div>
                <motion.div initial={{opacity:0, scale:0.95}} animate={{opacity:1, scale:1}} exit={{opacity:0, scale:0.95}} className="gl-item-picker" style={{zIndex: 91, right: '40px', bottom: 'auto', top: '50%', transform: 'translateY(-50%)'}}>
                  <div style={{fontSize: 12, fontWeight: 700, padding: '8px 12px', borderBottom: '1px solid var(--border)', color: 'var(--text-light)'}}>Assign Store</div>
                  <button className="gl-picker-option" style={{ borderLeftColor: '#4caf50' }} onClick={() => { onMarkPantry(); setPickerOpen(false); }}>
                    <span className="gl-store-logo-letter" style={{ background: '#4caf50', width: 20, height: 20, fontSize: 11 }}>✓</span> In Pantry
                  </button>
                  {stores.map(s => (
                    <button key={s.id} className="gl-picker-option" style={{ borderLeftColor: s.color }} onClick={() => { onSetStore(s.id); setPickerOpen(false); }}>
                      <StoreLogo store={s} size={20} /> {s.name}
                    </button>
                  ))}
                  {isAssigned && (
                    <button className="gl-picker-option gl-picker-unsort" onClick={() => { onSetStore(''); setPickerOpen(false); }}>
                      ◇ Unsort
                    </button>
                  )}
                </motion.div>
              </>
            )}
            </AnimatePresence>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function StoreLogo({ store, size = 20 }) {
  if (!store.logo) {
    return <span className="gl-store-logo-letter" style={{ background: store.color, width: size, height: size, fontSize: size * 0.55 }}>{store.name[0]}</span>;
  }
  return <img src={store.logo} alt="" className="gl-store-logo-img" style={{ width: size, height: size }} onError={e => {
    const span = document.createElement('span'); span.className = 'gl-store-logo-letter';
    span.style.cssText = `background:${store.color};width:${size}px;height:${size}px;font-size:${size * 0.55}px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;color:white;font-weight:700;flex-shrink:0;`;
    span.textContent = store.name[0]; e.target.replaceWith(span);
  }}/>;
}

function KeepIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <rect x="5" y="2" width="14" height="20" rx="2" fill="#FBBC04" />
      <circle cx="12" cy="9" r="3" fill="#fff" />
      <rect x="11" y="11" width="2" height="5" rx="1" fill="#fff" />
    </svg>
  );
}
