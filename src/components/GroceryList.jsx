import { useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ShoppingCart, Search, X as XIcon, Store as StoreIcon, Copy, ExternalLink, Check } from 'lucide-react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { saveStoreMemory as dbSaveStoreMemory, addToBarInventory } from '../db';
import { GROCERY_CATEGORIES, fuzzyResolveIngredient,
         canonicalizeUnit, UNIT_CANON, normalizeFraction } from '../recipeSchema';
import { convertUnit } from '../utils/ingredientNormalizer';
import { STORES, DEPT_EMOJI, loadDeptOrder, loadDeptStores, saveDeptStores,
         foodName, memoryKeyFor, deptOf, resolveStore, isSkipped, cleanListText } from '../lib/groceryStores';
import StoreMode from './StoreMode';
import OnlineOrderRunner from './OnlineOrderRunner';

// Extracted from App.css 2026-08-24 (see the header in that file for the
// move rules). MUST stay the first stylesheet imported here: these rules
// used to live in App.css, which loads ahead of every component sheet, and
// importing it first is what preserves that order for equal-specificity ties.
import '../styles/screens/GroceryList.css';

// Grocery screen v2 (2026-10-23). The list is shopped, not sorted:
//   • one tab per store, department-sorted. An item's store is its own choice
//     (store memory / manual pick) or else its department's default
//     (lib/groceryStores.js resolveStore), so nothing starts in an
//     "Unsorted" pile. Each tab has In store (StoreMode filtered to that
//     store), Order online (OnlineOrderRunner) and Copy list.
//   • pantry-covered items (real inventory + assumed staples, item.covered
//     from App.jsx buildGroceryList) sit in a "Got these?" chip strip — tap one
//     you're out of and it joins its store tab.
//   • rows show the meals that need them; a meal chip skips that meal's items.
// Retired with v2: batch mode, the Simple/Detailed/Dept toggle, HTML5
// drag-to-store (never fired on phones), the Unsorted + bottom In Pantry
// sections and the separate Alchemist's Supply rail (quest items now live in
// their store tab, tagged with their drink/meal, and keep the confetti).
const UNASSIGNED = '__unassigned__';
const STRIP_OK_KEY = 'spicehub_gotthese_ok';
const FOOD_DEPTS = GROCERY_CATEGORIES.slice(0, 7); // Produce … Other (rest are bar)
const isQuestTag = t => t === 'bar-quest' || t === 'meal-quest';
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ── Quantity aggregation helpers ─────────────────────────────────────────────
// Build display labels from recipeSchema's UNIT_CANON (canonical key → preferred display string).
// Use the canonical key itself as display, except for a few special cases.
const UNIT_DISPLAY = Object.fromEntries(
  Object.entries(UNIT_CANON).map(([canon]) => {
    // 'l' displays as 'L' for liters
    const display = canon === 'l' ? 'L' : canon;
    return [canon, display];
  })
);

function parseAmount(str) {
  const s = normalizeFraction(str.trim());
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[1]) / parseInt(frac[2]);
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatAmount(n) {
  if (n === Math.round(n)) return String(n);
  const whole = Math.floor(n);
  const frac = n - whole;
  const VULGAR = [[1/8,'⅛'],[1/4,'¼'],[1/3,'⅓'],[3/8,'⅜'],[1/2,'½'],[5/8,'⅝'],[2/3,'⅔'],[3/4,'¾'],[7/8,'⅞']];
  for (const [v, sym] of VULGAR) {
    if (Math.abs(frac - v) < 0.04) return whole > 0 ? `${whole}${sym}` : sym;
  }
  return n.toFixed(1).replace(/\.0$/, '');
}

function parseIngredient(rawName) {
  const m = rawName.trim().match(/^([\d\s/½¼¾⅓⅔⅛⅜⅝⅞.]+?)\s+([a-z]+\.?)\s+(.+)$/i);
  if (!m) return null;
  const amount = parseAmount(m[1].trim());
  if (!amount) return null;
  const unitRaw = m[2].trim().toLowerCase().replace(/\.$/, '');
  const canonical = canonicalizeUnit(unitRaw);
  if (!canonical) return null;
  const ingredient = m[3].trim();
  if (!ingredient) return null;
  return { amount, unit: canonical, ingredient };
}

// Spec A: build the same {amount, unit, ingredient} shape directly from a
// structured ingredient Item (no string re-parse). Returns null when the item
// lacks a summable quantity+unit, so callers fall back to count-based grouping.
function parsedFromStruct(s) {
  if (!s) return null;
  const ingredient = (s.name || '').trim();
  if (!ingredient) return null;
  const amount = s.quantity ? parseAmount(String(s.quantity)) : null;
  const unitRaw = (s.unit || '').toLowerCase().replace(/\.$/, '');
  const canonical = canonicalizeUnit(unitRaw) || unitRaw || null;
  if (amount && canonical) return { amount, unit: canonical, ingredient };
  return null;
}

// key: memoryKeyFor(item) — the clean food name, which is exactly what
// App.jsx's buildGroceryList looks up next week. (It used to save the full
// display line, so "3 cloves garlic, minced" never matched "garlic" again.)
async function rememberStore(key, storeId) {
  if (!key) return;
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

export default function GroceryList({ items, setItems, weekPlan, onRebuild, onToast, onExport, onSyncGrocery }) {
  const [confettiBurst, setConfettiBurst] = useState(0); // incremented to rekey confetti
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState(null);       // store id | UNASSIGNED
  const [storeModeFor, setStoreModeFor] = useState(null); // store id | UNASSIGNED | null
  const [runner, setRunner] = useState(null);             // { store, lines } snapshot | null
  const [deptStores, setDeptStores] = useState(() => loadDeptStores());
  const [deptSheetOpen, setDeptSheetOpen] = useState(false);
  const [stripOkSig, setStripOkSig] = useState(() => {
    try { return localStorage.getItem(STRIP_OK_KEY) || ''; } catch { return ''; }
  });

  const consolidateItems = useCallback((itemList) => {
    const map = new Map();
    itemList.forEach(item => {
      // Spec A: prefer the structured Item (real qty/unit/name) over re-parsing
      // the display string; fall back to the string parser when absent.
      const parsed = (item._struct ? parsedFromStruct(item._struct) : null) || parseIngredient(item.name);
      // Canonical grouping token: collapse fuzzy-equivalent food names (e.g.
      // "cherry tomatoes" + "roma tomato" -> "tomato") so they merge onto one line.
      const base = parsed ? parsed.ingredient : (item._struct?.name || item.name);
      const literalBase = (parsed ? parsed.ingredient : item.name).toLowerCase().trim();
      let canonicalBase = literalBase;
      let fuzzyCanonical = null; // set only on a confident fuzzy (non-exact) match
      try {
        const fz = fuzzyResolveIngredient(base);
        if (fz && fz.method !== 'none' && fz.score >= 0.9) {
          canonicalBase = fz.canonical;
          if (fz.method !== 'exact') fuzzyCanonical = fz.canonical;
        }
      } catch { /* defensive: never let matching break consolidation */ }
      // Unit stays part of the key so different units of the same canonical
      // (e.g. "1 cup tomato" vs "2 cans tomato") correctly stay on separate lines.
      const key = parsed
        ? `qty::${parsed.unit}::${canonicalBase}`
        : `raw::${canonicalBase}`;
      if (!map.has(key)) {
        map.set(key, {
          ...item,
          indices: [item._idx],
          names: [item.name],
          quantity: 1,
          allChecked: item.checked,
          _parsed: parsed,
          _totalAmount: parsed ? parsed.amount : null,
          _ingredientBase: parsed ? parsed.ingredient : null,
          _fuzzyCanonical: fuzzyCanonical,
          _canonicalBase: canonicalBase,
        });
      } else {
        const existing = map.get(key);
        existing.indices.push(item._idx);
        existing.names.push(item.name);
        existing.quantity += 1;
        existing.allChecked = existing.allChecked && item.checked;
        if (parsed && existing._totalAmount !== null) {
          existing._totalAmount += parsed.amount;
        }
      }
    });

    // ── Ingredient Dedup Bridge: cross-unit consolidation ────────────────────
    // The grouping above keys by exact unit, so "2 tbsp olive oil" and "1/4
    // cup olive oil" land in separate qty::tbsp::olive-oil / qty::cup::olive-oil
    // buckets even though they're the same shopping item. Fold any buckets
    // that share an ingredient identity (_canonicalBase, already fuzzy-resolved
    // above) and whose units are unit-convertible (both volume, or both weight)
    // into a single summed line. Count-style units (clove, can, jar, piece...)
    // aren't in the conversion table, so convertUnit correctly returns null for
    // them and those lines are left untouched — no false merges.
    const byIngredient = new Map();
    for (const [key, g] of map) {
      if (!g._parsed || g._totalAmount == null) continue; // raw/unparsed entries can't be safely merged across units
      if (!byIngredient.has(g._canonicalBase)) byIngredient.set(g._canonicalBase, []);
      byIngredient.get(g._canonicalBase).push(key);
    }
    for (const [, keys] of byIngredient) {
      if (keys.length < 2) continue;
      for (let i = 1; i < keys.length; i++) {
        const target = map.get(keys[i]);
        if (!target) continue;
        for (let j = 0; j < i; j++) {
          const base = map.get(keys[j]);
          if (!base) continue;
          const converted = convertUnit(target._totalAmount, target._parsed.unit, base._parsed.unit);
          if (converted == null) continue;
          base._totalAmount += converted;
          base.indices.push(...target.indices);
          base.names.push(...target.names);
          base.quantity += target.quantity;
          base.allChecked = base.allChecked && target.allChecked;
          map.delete(keys[i]);
          break;
        }
      }
    }

    return Array.from(map.values()).map(g => {
      let name = g.name;
      let showBadge = g.quantity > 1;
      // When a fuzzy merge combined variant names, display the shared canonical
      // (e.g. "tomato") instead of whichever variant happened to be first.
      const displayBase = g._fuzzyCanonical || g._ingredientBase;
      if (g._parsed && g._totalAmount !== null && g.quantity > 1) {
        const unitDisp = UNIT_DISPLAY[g._parsed.unit] || g._parsed.unit;
        name = `${formatAmount(g._totalAmount)} ${unitDisp} ${displayBase}`;
        showBadge = false;
      } else if (g._fuzzyCanonical && g.quantity > 1) {
        // Quantities not summable (raw items, or mixed/unparseable amounts):
        // show the clean canonical and keep the count badge.
        name = g._fuzzyCanonical;
      }
      return {
        ...g,
        name,
        checked: g.allChecked,
        _idx: g.indices[0],
        isConsolidated: g.quantity > 1,
        quantity: showBadge ? g.quantity : 1,
      };
    });
  }, []);
  // ── Item actions ────────────────────────────────────────────────────────────
  const toggleCheck = useCallback((indices) => {
    setItems(prev => {
      const anyUnchecked = indices.some(idx => !prev[idx].checked);
      const next = prev.map((item, i) => indices.includes(i) ? { ...item, checked: anyUnchecked } : item);
      // Sync checked state to home group
      if (onSyncGrocery) {
        const affected = indices.map(i => next[i]).filter(Boolean);
        onSyncGrocery('check', affected);
      }
      return next;
    });
  }, [setItems, onSyncGrocery]);

  const removeItem = useCallback((indices) => {
    // Sync deletions before removing from state (need item data for cloudId)
    if (onSyncGrocery) {
      setItems(prev => {
        const removed = indices.map(i => prev[i]).filter(Boolean);
        if (removed.length) onSyncGrocery('delete', removed);
        return prev.filter((_, i) => !indices.includes(i));
      });
    } else {
      setItems(prev => prev.filter((_, i) => !indices.includes(i)));
    }
  }, [setItems, onSyncGrocery]);

  // Explicit set (not toggle) — the online-order pass marks Added / Skip.
  const setChecked = useCallback((indices, value) => {
    setItems(prev => {
      const next = prev.map((item, i) => indices.includes(i) ? { ...item, checked: value } : item);
      if (onSyncGrocery) onSyncGrocery('check', indices.map(i => next[i]).filter(Boolean));
      return next;
    });
  }, [setItems, onSyncGrocery]);

  // ── Real Pantry↔Grocery sync (Phase 2b) ──────────────────────────────────
  // Promoting an item is "I bought it" — it really stocks db.barInventory
  // (qtyLevel: FULL), not just a display-only toggle on the grocery row.
  // Quest items (missing cocktail/recipe ingredients) keep their celebration.
  const promoteToInventory = useCallback((indices, names) => {
    names.forEach(n => addToBarInventory(n, { qtyLevel: 'FULL' }));
    const quest = indices.some(i => isQuestTag(items[i]?.tag));
    setItems(prev => {
      const next = prev.map((item, i) =>
        indices.includes(i) ? { ...item, covered: true, checked: true } : item
      );
      if (onSyncGrocery) {
        const affected = indices.map(i => next[i]).filter(Boolean);
        onSyncGrocery('check', affected);
      }
      return next;
    });
    if (quest) {
      if (onToast) onToast(`✓ Added to your pantry!`, 'success');
      if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
      setConfettiBurst(prev => prev + 1);
    }
  }, [items, setItems, onSyncGrocery, onToast]);

  // Demoting only flips the grocery-side flag back ("actually I still need
  // this") — it deliberately does NOT touch db.barInventory. A staple's
  // "assumed stocked" default or a real inventory record should only change
  // via the Pantry/My Bar screens themselves (Run Dry etc.), not a Grocery
  // list toggle, so real stock data stays the single source of truth.
  const demoteFromInventory = useCallback((indices, names) => {
    setItems(prev => {
      const next = prev.map((item, i) =>
        indices.includes(i) ? { ...item, covered: false, checked: false } : item
      );
      if (onSyncGrocery) {
        const affected = indices.map(i => next[i]).filter(Boolean);
        onSyncGrocery('check', affected);
      }
      return next;
    });
  }, [setItems, onSyncGrocery]);

  // A per-item store pick is remembered under the food name, so next week's
  // build puts it back in the same tab (see rememberStore).
  const setStore = useCallback((indices, storeId) => {
    new Set(indices.map(i => memoryKeyFor(items[i])).filter(Boolean))
      .forEach(k => rememberStore(k, storeId));
    setItems(prev => prev.map((item, i) => indices.includes(i) ? { ...item, store: storeId } : item));
  }, [items, setItems]);

  const pickDeptStore = (dept, storeId) => {
    const next = { ...deptStores };
    if (storeId) next[dept] = storeId; else delete next[dept];
    setDeptStores(next);
    saveDeptStores(next);
  };

  // ── Meal skip: hide every item only that meal needs (persisted per row) ──
  const allMeals = useMemo(() => [...new Set(items.flatMap(i => i.meals || []))], [items]);
  const skippedMeals = useMemo(() => new Set(items.flatMap(i => i.skipMeals || [])), [items]);
  const toggleSkipMeal = (label) => {
    const skipping = !skippedMeals.has(label);
    setItems(prev => prev.map(it => {
      if (!(it.meals || []).includes(label)) return it;
      const cur = new Set(it.skipMeals || []);
      if (skipping) cur.add(label); else cur.delete(label);
      return { ...it, skipMeals: [...cur] };
    }));
    if (onToast) onToast(skipping ? `Skipped ${label}'s ingredients` : `${label} is back on the list`);
  };

  // ── Derived views ─────────────────────────────────────────────────────────
  // Aisle order is read fresh each time so a Store Mode drag-reorder shows up
  // in the tab list as soon as Store Mode closes (localStorage, tiny).
  const groupByDept = (lines) => {
    const deptOrder = loadDeptOrder();
    const rank = (d) => {
      const si = deptOrder.indexOf(d);
      if (si >= 0) return si;
      const ci = GROCERY_CATEGORIES.indexOf(d);
      return (ci >= 0 ? ci : 999) + 1000;
    };
    const m = new Map();
    lines.forEach(l => {
      const d = deptOf(l);
      if (!m.has(d)) m.set(d, []);
      m.get(d).push(l);
    });
    return [...m.entries()]
      .map(([dept, ls]) => ({
        dept,
        lines: ls.sort((a, b) => (a.checked === b.checked ? 0 : a.checked ? 1 : -1)),
      }))
      .sort((a, b) => rank(a.dept) - rank(b.dept));
  };

  const q = searchQuery.trim().toLowerCase();
  const { live, pantryLines, tabs } = useMemo(() => {
    const indexed = items.map((item, i) => ({ ...item, _idx: i }));
    const liveRows = indexed.filter(i => !isSkipped(i));
    const shown = q
      ? liveRows.filter(i => i.name.toLowerCase().includes(q) || foodName(i).toLowerCase().includes(q))
      : liveRows;
    const shopRows = shown.filter(i => !i.covered);
    const storeOf = (i) => resolveStore(i, deptStores) || UNASSIGNED;
    const tabList = [...STORES, { id: UNASSIGNED, name: 'Not assigned', color: '', logo: '' }]
      .map(s => ({ ...s, lines: consolidateItems(shopRows.filter(i => storeOf(i) === s.id)) }))
      .filter(t => t.lines.length > 0)
      .map(t => ({ ...t, open: t.lines.filter(l => !l.checked).length }));
    return { live: liveRows, pantryLines: consolidateItems(shown.filter(i => i.covered)), tabs: tabList };
  }, [items, q, deptStores, consolidateItems]);
  const tab = tabs.find(t => t.id === activeTab) || tabs[0] || null;

  const tagsFor = (line) => {
    const out = new Set();
    line.indices.forEach(i => {
      const it = items[i];
      (it?.meals || []).forEach(m => out.add(m));
      if (it?.questName) out.add(`${it.tag === 'meal-quest' ? '🍳' : '🍸'} ${it.questName}`);
    });
    return [...out];
  };
  const openLines = (t) => groupByDept(t.lines).flatMap(g => g.lines).filter(l => !l.checked);

  // ── "Got these?" strip. Signature is the UNfiltered covered set, so "All
  //    good" sticks until a rebuild changes what's assumed stocked. ─────────
  const pantrySig = useMemo(
    () => [...new Set(live.filter(i => i.covered).map(memoryKeyFor))].sort().join('|'),
    [live],
  );
  const stripCollapsed = pantryLines.length > 0 && stripOkSig === pantrySig;
  const confirmStrip = () => {
    setStripOkSig(pantrySig);
    try { localStorage.setItem(STRIP_OK_KEY, pantrySig); } catch { /* ignore */ }
  };
  const needThis = (line) => {
    demoteFromInventory(line.indices, line.names);
    const sid = resolveStore(items[line.indices[0]], deptStores);
    const sname = STORES.find(s => s.id === sid)?.name;
    if (onToast) onToast(`${cap(foodName(line))} added${sname ? ` to ${sname}` : ''}`, 'success');
  };

  // ── Copy: plain one-item-per-line text (pastes into a Keep checklist) ────
  const copyLines = async (lines, label) => {
    const text = cleanListText(lines);
    if (!text) return;
    const n = text.split('\n').length;
    try {
      await navigator.clipboard.writeText(text);
      if (onToast) onToast(`Copied ${n} ${label} item${n !== 1 ? 's' : ''} — paste into Keep or the store's list`, 'success');
    } catch {
      if (navigator.share) navigator.share({ title: `${label} list`, text }).catch(() => {});
      else if (onToast) onToast('Could not copy to clipboard', 'error');
    }
  };
  const copyTab = (t) => copyLines(
    openLines(t).map(l => ({ food: foodName(l), count: l.quantity })),
    t.id === UNASSIGNED ? 'unassigned' : t.name,
  );

  const openRunner = (t) => setRunner({
    store: t,
    lines: openLines(t).map(l => ({
      key: l.indices.join(','), query: foodName(l), detail: l.name, tags: tagsFor(l), indices: l.indices,
    })),
  });

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
    for (const t of tabs) {
      const open = openLines(t);
      if (!open.length) continue;
      lines.push(`\n--- ${t.id === UNASSIGNED ? 'Other' : t.name} ---`);
      for (const item of open) {
        lines.push(`• ${item.name}${item.quantity > 1 ? ` (×${item.quantity})` : ''}`);
      }
    }
    return lines.join('\n').trim();
  };

  const sendFullGroceryToKeep = () => {
    sendToKeep('Grocery List - SpiceHub', buildFullGroceryText(), onToast);
  };

  const sendWeekPlanToKeep = () => {
    sendToKeep('Meal Plan - SpiceHub', buildWeekPlanText(), onToast);
  };

  const activeItems = live.filter(i => !i.covered);
  const checkedCount = activeItems.filter(i => i.checked).length;
  const progressPercent = activeItems.length > 0 ? Math.round((checkedCount / activeItems.length) * 100) : 0;
  const sheetDepts = [...new Set([...FOOD_DEPTS, ...items.map(i => deptOf(i))])];

  if (items.length === 0) {
    return (
      <div className="gl-container">
        <motion.div
          className="gl-empty-state"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
        >
          <div className="gl-empty-icon"><ShoppingCart size={32} strokeWidth={1.75} /></div>
          <p className="gl-empty-title">Your list is empty</p>
          <p className="gl-empty-hint">Generate a week plan, then tap "Grocery List" to build your shopping list.</p>
          {weekPlan.some(m => m && !m._special) && (
            <button className="btn-primary" onClick={onRebuild}>Build Grocery List</button>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="gl-container">
      {/* ── In store (StoreMode, filtered to one store) + Order online ── */}
      <AnimatePresence>
        {storeModeFor && (
          <StoreMode
            key="store-mode"
            items={items}
            setItems={setItems}
            include={(it) => !isSkipped(it) && (resolveStore(it, deptStores) || UNASSIGNED) === storeModeFor}
            title={tabs.find(t => t.id === storeModeFor)?.name}
            onExit={() => setStoreModeFor(null)}
            onToast={onToast}
            onSyncGrocery={onSyncGrocery}
          />
        )}
        {runner && (
          <OnlineOrderRunner
            key="online-order"
            store={runner.store}
            lines={runner.lines}
            otherStores={STORES.filter(s => s.id !== runner.store.id)}
            onSetChecked={setChecked}
            onMove={setStore}
            onCopy={(ls) => copyLines(ls.map(l => ({ food: l.query, count: 1 })), runner.store.name)}
            onExit={() => setRunner(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deptSheetOpen && (
          <DeptStoreSheet
            key="dept-sheet"
            depts={sheetDepts}
            deptStores={deptStores}
            onPick={pickDeptStore}
            onClose={() => setDeptSheetOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Alchemy confetti burst ── */}
      {confettiBurst > 0 && (
        <div className="gl-confetti-wrap" key={confettiBurst} aria-hidden="true">
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className="gl-confetti-piece" style={{ '--i': i }} />
          ))}
        </div>
      )}

      {/* ── Progress bar ── */}
      <div className="gl-progress-section">
        <div className="gl-progress-bar">
          <motion.div className="gl-progress-fill" animate={{ width: `${progressPercent}%` }} layout />
        </div>
        <div className="gl-progress-text">
          {checkedCount}/{activeItems.length} items
        </div>
        {/* Pixel bartender encouragement at 50% */}
        {progressPercent >= 50 && progressPercent < 100 && (
          <div className="gl-mini-bartender">
            <svg width="28" height="40" viewBox="0 0 28 40" style={{ imageRendering: 'pixelated', flexShrink: 0 }}>
              <rect x="8" y="0" width="12" height="3" fill="#1a1a1a" />
              <rect x="6" y="3" width="16" height="2" fill="#1a1a1a" />
              <rect x="9" y="5" width="10" height="8" fill="#e8b88a" />
              <rect x="10" y="8" width="2" height="2" fill="#333" />
              <rect x="16" y="8" width="2" height="2" fill="#333" />
              <rect x="10" y="11" width="3" height="1" fill="#4a3520" />
              <rect x="15" y="11" width="3" height="1" fill="#4a3520" />
              <rect x="8" y="13" width="12" height="10" fill="#333" />
              <rect x="11" y="13" width="6" height="10" fill="#f5f5f5" />
              <rect x="3" y="17" width="5" height="3" fill="#333" />
              <rect x="20" y="17" width="5" height="3" fill="#333" />
              <rect x="10" y="23" width="4" height="7" fill="#1a1a1a" />
              <rect x="14" y="23" width="4" height="7" fill="#1a1a1a" />
            </svg>
            <div className="gl-mini-bartender-bubble">Halfway there! 🥃</div>
          </div>
        )}
      </div>

      {/* ── Got these? — pantry-covered items, one tap to add back ── */}
      {pantryLines.length > 0 && (stripCollapsed ? (
        <button type="button" className="gl-got-collapsed" onClick={() => setStripOkSig('')}>
          <Check size={16} aria-hidden="true" />
          {pantryLines.length} assumed in your pantry · Review
        </button>
      ) : (
        <section className="gl-got" aria-labelledby="gl-got-title">
          <div className="gl-got-head">
            <h3 id="gl-got-title" className="gl-got-title">Got these?</h3>
            <button type="button" className="gl-got-ok" onClick={confirmStrip}>All good</button>
          </div>
          <p className="gl-got-sub">This week&apos;s meals use them. Tap anything you&apos;re out of.</p>
          <div className="gl-got-chips">
            {pantryLines.map(l => (
              <button
                type="button"
                key={l._idx}
                className="gl-got-chip"
                onClick={() => needThis(l)}
                aria-label={`Out of ${foodName(l)} — add to the list`}
              >
                {foodName(l)}
              </button>
            ))}
          </div>
        </section>
      ))}

      {/* ── Meals on this list — tap to skip a meal's ingredients ── */}
      {allMeals.length > 0 && (
        <div className="gl-meals" role="group" aria-label="Meals on this list">
          <span className="gl-meals-label">Meals</span>
          <div className="gl-meals-chips">
            {allMeals.map(m => {
              const off = skippedMeals.has(m);
              return (
                <button
                  type="button"
                  key={m}
                  className={`gl-meal-chip${off ? ' off' : ''}`}
                  aria-pressed={!off}
                  aria-label={`${m}: ${off ? 'skipped, tap to add back' : 'on the list, tap to skip'}`}
                  onClick={() => toggleSkipMeal(m)}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Search filter ── */}
      {items.length > 0 && (
        <div className="gl-search-wrap">
          <Search size={16} strokeWidth={1.75} className="gl-search-icon" />
          <input
            className="gl-search-input"
            type="search"
            placeholder="Search groceries…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="gl-search-clear" onClick={() => setSearchQuery('')} aria-label="Clear search">
              <XIcon size={14} strokeWidth={2} />
            </button>
          )}
        </div>
      )}

      {/* ── One tab per store ── */}
      <div className="gl-tabs-row">
        <div className="gl-tabs" role="tablist" aria-label="Stores">
          {tabs.map(t => (
            <button
              type="button"
              role="tab"
              key={t.id}
              aria-selected={tab?.id === t.id}
              className={`gl-tab${tab?.id === t.id ? ' on' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.id !== UNASSIGNED && <StoreLogo store={t} size={18} />}
              <span>{t.name}</span>
              <span className="gl-tab-count">{t.open}</span>
            </button>
          ))}
        </div>
        <button type="button" className="gl-tab gl-tab-setup" onClick={() => setDeptSheetOpen(true)} aria-label="Choose stores by department">
          <StoreIcon size={18} aria-hidden="true" />
          <span>Stores</span>
        </button>
      </div>

      {tab?.id === UNASSIGNED && (
        <div className="gl-setup-card">
          <p className="gl-setup-text">
            <strong>Set where you shop, once.</strong> Pick a store per department (Produce → HyVee, Pantry → Target…) and every item lands in its store&apos;s tab.
          </p>
          <button type="button" className="gl-setup-btn" onClick={() => setDeptSheetOpen(true)}>Set up stores</button>
        </div>
      )}

      {tab && (
        <div className="gl-tab-actions">
          <button type="button" className="gl-act gl-act-primary" onClick={() => setStoreModeFor(tab.id)}>
            <ShoppingCart size={18} aria-hidden="true" /> In store
          </button>
          {tab.searchUrl && (
            <button type="button" className="gl-act" onClick={() => openRunner(tab)} disabled={!tab.open}>
              <ExternalLink size={18} aria-hidden="true" /> Order online
            </button>
          )}
          <button type="button" className="gl-act" onClick={() => copyTab(tab)} disabled={!tab.open} aria-label={`Copy ${tab.name} list`}>
            <Copy size={18} aria-hidden="true" /> Copy list
          </button>
        </div>
      )}

      {/* ── Floating actions (bottom bar) ── */}
      <div className="gl-floating-actions">
        <button className="gl-btn-keep-primary" onClick={sendFullGroceryToKeep}>
          <KeepIcon /> Keep Export
        </button>
        {onExport && (
          <button className="gl-btn-keep-secondary" onClick={() => onExport(items.map(i => i.name || i))}>
            📤 Export
          </button>
        )}
        <button className="gl-btn-keep-secondary" onClick={sendWeekPlanToKeep}>
          📅 Week
        </button>
      </div>

      <div style={{ paddingBottom: '90px' }} role="tabpanel" aria-label={tab ? `${tab.name} list` : undefined}>
        {tab ? groupByDept(tab.lines).map(g => (
          <section key={g.dept} className="gl-section">
            <div className="gl-section-header">
              <div className="gl-section-title">{DEPT_EMOJI[g.dept] || '🛒'} {g.dept}</div>
              <span className="gl-section-count">{g.lines.filter(l => !l.checked).length}</span>
            </div>
            <AnimatePresence initial={false}>
              {g.lines.map(line => (
                <GroceryItem
                  key={line._idx}
                  item={line}
                  tags={tagsFor(line)}
                  stores={STORES}
                  isAssigned={!!items[line._idx]?.store && items[line._idx].store !== '__pantry__'}
                  onToggleCheck={() => toggleCheck(line.indices)}
                  onSetStore={(storeId) => setStore(line.indices, storeId)}
                  onPromote={() => promoteToInventory(line.indices, line.names)}
                  onRemove={() => removeItem(line.indices)}
                  searchUrl={tab.searchUrl}
                  searchStoreName={tab.name}
                />
              ))}
            </AnimatePresence>
          </section>
        )) : (
          <p className="gl-empty-tab">
            {q ? 'No items match your search.' : 'Nothing left to buy — everything is covered or skipped.'}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Department → store defaults sheet (one-time setup, editable any time) ──
function DeptStoreSheet({ depts, deptStores, onPick, onClose }) {
  return createPortal(
    <>
      <motion.div
        className="gl-ds-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="gl-ds-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gl-ds-title"
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 36 }}
      >
        <div className="gl-ds-head">
          <h2 id="gl-ds-title" className="gl-ds-title">Where do you shop?</h2>
          <button type="button" className="gl-ds-done" onClick={onClose}>Done</button>
        </div>
        <p className="gl-ds-sub">Pick a store for each department, once. Items you move by hand are remembered on their own.</p>
        <div className="gl-ds-list">
          {depts.map(d => (
            <div key={d} className="gl-ds-row">
              <div className="gl-ds-dept"><span aria-hidden="true">{DEPT_EMOJI[d] || '🛒'}</span> {d}</div>
              <div className="gl-ds-chips" role="group" aria-label={`Store for ${d}`}>
                {STORES.map(s => {
                  const on = deptStores[d] === s.id;
                  return (
                    <button
                      type="button"
                      key={s.id}
                      className={`gl-ds-chip${on ? ' on' : ''}`}
                      aria-pressed={on}
                      onClick={() => onPick(d, on ? '' : s.id)}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </>,
    document.body,
  );
}

// ── Individual grocery item ──
function GroceryItem({ item, tags = [], onToggleCheck, onSetStore, onPromote, onRemove, stores, isAssigned, searchUrl, searchStoreName }) {
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
    } else if (info.offset.x < -threshold && onPromote) {
      onPromote();
    }
  };

  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
      style={{ position: 'relative', overflow: 'hidden', background: 'var(--surface)', borderRadius: 'var(--radius-sm)', marginBottom: '4px' }}
      className={`gl-item ${item.checked ? 'gl-item-checked' : ''}`}
    >
      {/* Swipe reveal layers: right = remove, left = "I have it" (to pantry) */}
      <motion.div style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px', zIndex: 0, background }}>
        <motion.span style={{ color: '#c62828', fontWeight: 600, opacity: removeOpacity }}>✕ Remove</motion.span>
        <motion.span style={{ color: '#2e7d32', fontWeight: 600, opacity: pantryOpacity }}>✓ To Pantry</motion.span>
      </motion.div>

      {/* Main swipeable surface */}
      <motion.div
        style={{ x, position: 'relative', zIndex: 1, background: 'var(--card)', width: '100%', display: 'flex', alignItems: 'center', height: '100%' }}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.4}
        onDragEnd={handleDragEnd}
      >
        <div className="gl-item-content" style={{ flex: 1 }}>
          <label className="gl-checkbox-label"
            onContextMenu={(e) => { e.preventDefault(); setPickerOpen(true); }} // Long press logic
          >
            <input type="checkbox" className="gl-checkbox-input" checked={item.checked} onChange={onToggleCheck} />
            <span className="gl-item-main">
              <span className={`gl-item-text ${item.checked ? 'gl-item-text-checked' : ''}`}>
                {item.name} {item.quantity > 1 && <strong style={{ color: 'var(--primary-ink)', marginLeft: 6, opacity: item.checked ? 0.5 : 1 }}>×{item.quantity}</strong>}
              </span>
              {tags.length > 0 && <span className="gl-item-tags">{tags.join(' · ')}</span>}
            </span>
          </label>
        </div>

        <div className="gl-item-actions" style={{ paddingRight: '8px' }}>
          {searchUrl && (
            <button
              type="button"
              className="gl-btn-search"
              aria-label={`Search ${foodName(item)} on ${searchStoreName || 'the store site'}`}
              onClick={(e) => {
                e.stopPropagation();
                window.open(searchUrl + encodeURIComponent(foodName(item)), '_blank', 'noopener,noreferrer');
              }}
            >
              <Search size={18} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className={`gl-btn-store ${isAssigned ? 'gl-btn-store-assigned' : ''}`}
            onClick={() => setPickerOpen(true)}
            aria-label={`Change store for ${foodName(item)}`}
          >
            <StoreIcon size={18} aria-hidden="true" />
          </button>

          {/* Quick picker overlay for this item — portaled to <body> so it
              escapes the swipeable row's transform/overflow:hidden, which
              was clipping it behind the list (previously z-index alone
              couldn't fix this: the animated ancestor's transform creates
              a new containing block for position:fixed descendants). */}
          {createPortal(
            <AnimatePresence>
              {pickerOpen && (
                <>
                  <motion.div key="backdrop" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="gl-picker-backdrop" style={{position:'fixed', zIndex: 900}} onClick={() => setPickerOpen(false)}></motion.div>
                  <motion.div key="picker" initial={{opacity:0, scale:0.95}} animate={{opacity:1, scale:1}} exit={{opacity:0, scale:0.95}} className="gl-item-picker" style={{position: 'fixed', zIndex: 901, right: '40px', bottom: 'auto', top: '50%', transform: 'translateY(-50%)'}}>
                    <div style={{fontSize: 12, fontWeight: 700, padding: '8px 12px', borderBottom: '1px solid var(--border)', color: 'var(--text-light)'}}>Store for {foodName(item)}</div>
                    <button className="gl-picker-option" style={{ borderLeftColor: '#4caf50' }} onClick={() => { onPromote(); setPickerOpen(false); }}>
                      <span className="gl-store-logo-letter" style={{ background: '#2e7d32', width: 20, height: 20, fontSize: 11 }}>✓</span> I have it (pantry)
                    </button>
                    {stores.map(s => (
                      <button key={s.id} className="gl-picker-option" style={{ borderLeftColor: s.color }} onClick={() => { onSetStore(s.id); setPickerOpen(false); }}>
                        <StoreLogo store={s} size={20} /> {s.name}
                      </button>
                    ))}
                    {isAssigned && (
                      <button className="gl-picker-option gl-picker-unsort" onClick={() => { onSetStore(''); setPickerOpen(false); }}>
                        Use department default
                      </button>
                    )}
                  </motion.div>
                </>
              )}
            </AnimatePresence>,
            document.body
          )}
        </div>
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
