// Shared grocery store routing — used by GroceryList, StoreMode and
// OnlineOrderRunner so the three surfaces always agree on which store an item
// belongs to, what its clean food name is, and whether a meal skip hides it.
// Pure + offline: everything here is local data or localStorage.
import { categorizeIngredient, canonicalizeUnit } from '../recipeSchema';

// searchUrl: item name gets URL-encoded and appended. Deep-link search only —
// no cart automation, no credentials (see harmonization plan Phase 3; the
// credential-based Hy-Vee cart integrations in the source doc were rejected
// outright). Every pattern below was verified live 2026-07-25, not guessed:
// Trader Joe's DOES have a real product search (contrary to earlier
// assumption); Costco's is /s?keyword= not /CatalogSearch?keyword=; Hy-Vee's
// param is `search`, not `q`. NewPi CoOp's own site search is blog/content
// only (no product catalog), so it's deliberately omitted rather than
// shipping a misleading link — same reasoning as `other`, which has no real
// site to link to at all.
export const STORES = [
  { id: 'target',     name: 'Target',       color: '#cc0000', logo: 'https://www.google.com/s2/favicons?domain=target.com&sz=32', searchUrl: 'https://www.target.com/s?searchTerm=' },
  { id: 'traderjoes', name: "Trader Joe's",  color: '#c41e3a', logo: 'https://www.google.com/s2/favicons?domain=traderjoes.com&sz=32', searchUrl: 'https://www.traderjoes.com/home/search?q=' },
  { id: 'hyvee',      name: 'HyVee',         color: '#e31837', logo: 'https://www.google.com/s2/favicons?domain=hy-vee.com&sz=32', searchUrl: 'https://www.hy-vee.com/aisles-online/search?search=' },
  { id: 'costco',     name: 'Costco',        color: '#005daa', logo: 'https://www.google.com/s2/favicons?domain=costco.com&sz=32', searchUrl: 'https://www.costco.com/s?keyword=' },
  { id: 'newpi',      name: 'NewPi CoOp',    color: '#2d8632', logo: 'https://www.google.com/s2/favicons?domain=newpi.coop&sz=32' },
  { id: 'other',      name: 'Other',         color: '#666',    logo: '' },
];
const STORE_IDS = new Set(STORES.map(s => s.id));

export const DEPT_EMOJI = {
  'Produce':        '🥦',
  'Meat & Seafood': '🥩',
  'Dairy':          '🥛',
  'Pantry':         '🫙',
  'Frozen':         '🧊',
  'Bakery':         '🍞',
  'Other':          '🛒',
  // Bar departments (drink imports only — see recipeSchema.js categorizeBarIngredient)
  'Spirits':           '🥃',
  'Beer & Wine':       '🍷',
  'Bitters & Syrups':  '🧪',
  'Mixers & Juices':   '🥤',
  'Garnish':           '🍒',
};

// ── Department aisle order (StoreMode drag-to-reorder, persisted per device) ──
const DEPT_ORDER_KEY = 'spicehub_dept_order';
export function loadDeptOrder() {
  try {
    const raw = localStorage.getItem(DEPT_ORDER_KEY);
    const arr = raw ? JSON.parse(raw) : null;
    return Array.isArray(arr) ? arr.filter(d => typeof d === 'string') : [];
  } catch { return []; }
}
export function saveDeptOrder(order) {
  try { localStorage.setItem(DEPT_ORDER_KEY, JSON.stringify(order)); } catch { /* ignore */ }
}

// ── Department → store defaults ("Produce → HyVee"), one-time setup ─────────
const DEPT_STORE_KEY = 'spicehub_dept_store';
export function loadDeptStores() {
  try {
    const obj = JSON.parse(localStorage.getItem(DEPT_STORE_KEY) || 'null');
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => STORE_IDS.has(v)));
  } catch { return {}; }
}
export function saveDeptStores(map) {
  try { localStorage.setItem(DEPT_STORE_KEY, JSON.stringify(map || {})); } catch { /* ignore */ }
}

// "1/2 cup heavy cream (sauce)" → "heavy cream". Parentheticals are the
// builder's section suffix or prep notes; anything after a comma is prep.
function tidy(s) {
  return String(s || '').replace(/\([^)]*\)/g, ' ').split(',')[0].replace(/\s+/g, ' ').trim();
}

/** Clean food name for search boxes, copy-paste lists and store memory. */
export function foodName(item) {
  if (!item) return '';
  const direct = item.food || item._struct?.name;
  if (direct) return tidy(direct);
  // Raw line with no structured food: drop the leading amount and a unit
  // word. (normalizeIngredient().item is too aggressive for display —
  // "2 tbsp olive oil" comes back as "oil".)
  let s = tidy(item.name).replace(/^[\d\s/.\-½¼¾⅓⅔⅛⅜⅝⅞]+/, '');
  const [first, ...rest] = s.split(' ');
  try {
    if (rest.length && canonicalizeUnit(first.toLowerCase().replace(/\.$/, ''))) s = rest.join(' ');
  } catch { /* best-effort */ }
  return s.trim() || tidy(item.name);
}

/** Store-memory key. MUST match what App.jsx's builder looks up (the food
 *  name), not the full display line — saving "3 cloves garlic, minced" and
 *  looking up "garlic" is why assignments never stuck week to week. */
export function memoryKeyFor(item) {
  return foodName(item).toLowerCase();
}

export function deptOf(item) {
  if (!item) return 'Other';
  return item._struct?.category || item.category || categorizeIngredient(foodName(item) || item.name || '') || 'Other';
}

/** A per-item choice (store memory or a manual pick) always wins; otherwise
 *  the item inherits its department's store. '' means not assigned. */
export function resolveStore(item, deptStores = {}) {
  if (!item) return '';
  if (item.store && STORE_IDS.has(item.store)) return item.store;
  return deptStores[deptOf(item)] || '';
}

/** Hidden when every meal that needs this item has been skipped. Items with
 *  no meal source (manual adds, Run Dry, quests) are never skip-hidden. */
export function isSkipped(item) {
  const meals = item?.meals;
  if (!Array.isArray(meals) || meals.length === 0) return false;
  const skipped = item.skipMeals || [];
  return meals.every(m => skipped.includes(m));
}

/** Plain one-item-per-line text: pastes into a Keep checklist or a store's
 *  list as separate items (no header, no bullets, no prep notes). */
export function cleanListText(lines) {
  return lines
    .map(l => {
      const name = String(l.food || '').trim();
      if (!name) return '';
      const label = name.charAt(0).toUpperCase() + name.slice(1);
      return l.count > 1 ? `${label} (${l.count})` : label;
    })
    .filter(Boolean)
    .join('\n');
}
