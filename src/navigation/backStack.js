/**
 * Central back-navigation stack for SpiceHub PWA.
 *
 * Single owner of:
 *  - LIFO layer stack
 *  - history.pushState / history.back sync
 *  - popstate + CloseWatcher + Escape funnel via requestBack(source)
 *  - root double-back-to-exit guard
 *
 * Pure stack ops are testable without DOM; browser wiring is initBackNavigation().
 */

/** @typedef {'popstate' | 'closewatcher' | 'escape' | 'ui' | 'unmount'} BackSource */

/** @typedef {{
 *   pushId: string,
 *   id: string,
 *   onBack: () => void | 'prevent',
 *   ownsHistory: boolean,
 * }} Layer */

const stack = [];
let generation = 0;
/** @type {Set<number>} */
const programmaticGens = new Set();
/** @type {BackSource | null} */
let lastHandledSource = null;
let lastHandledAt = 0;
/** Only collapse CloseWatcher + popstate (same physical gesture). */
const DEDUPE_MS = 80;
const DEDUPE_PAIRS = new Set([
  'popstate>closewatcher',
  'closewatcher>popstate',
  'closewatcher>escape',
  'popstate>escape',
]);

let rootExitArmedUntil = 0;
/** @type {null | ((msg: string) => void)} */
let onRootExitHint = null;
let initialized = false;
let escapeBound = false;

// ── Stack ops (testable) ────────────────────────────────────────────────────

export function getStackSnapshot() {
  return stack.map((l) => ({ pushId: l.pushId, id: l.id, ownsHistory: l.ownsHistory }));
}

export function getStackDepth() {
  return stack.length;
}

export function resetBackStackForTests() {
  stack.length = 0;
  generation = 0;
  programmaticGens.clear();
  lastHandledSource = null;
  lastHandledAt = 0;
  rootExitArmedUntil = 0;
}

/**
 * @param {{ id: string, onBack: () => void | 'prevent', ownsHistory?: boolean }} layer
 * @returns {string} pushId
 */
export function pushLayer({ id, onBack, ownsHistory = true }) {
  const pushId = `${id}-${++generation}-${Math.random().toString(36).slice(2, 8)}`;
  stack.push({
    pushId,
    id: id || 'modal',
    onBack,
    ownsHistory: ownsHistory !== false,
  });

  if (ownsHistory !== false && typeof history !== 'undefined' && history.pushState) {
    try {
      history.pushState({ spicehub: 'modal', id: pushId, gen: generation }, '');
    } catch { /* private mode / quota */ }
  }

  return pushId;
}

/**
 * Remove a layer by pushId without calling onBack.
 * @param {string} pushId
 * @param {{ syncHistory?: boolean }} [opts]
 * @returns {boolean} whether a layer was removed
 */
export function detachLayer(pushId, opts = {}) {
  const { syncHistory = true } = opts;
  const idx = stack.findIndex((l) => l.pushId === pushId);
  if (idx === -1) return false;
  const [layer] = stack.splice(idx, 1);
  if (syncHistory && layer.ownsHistory) {
    programmaticHistoryBack();
  }
  return true;
}

/**
 * Pop top layer if it matches pushId (optional), call onBack.
 * @param {BackSource} source
 * @param {{ pushId?: string }} [opts]
 * @returns {'handled' | 'prevent' | 'empty' | 'root-hint' | 'root-exit' | 'deduped'}
 */
export function requestBack(source = 'ui', opts = {}) {
  const now = Date.now();
  // Dedupe only cross-channel pairs from the same physical gesture
  if (source !== 'ui' && source !== 'unmount' && lastHandledSource) {
    const pair = `${lastHandledSource}>${source}`;
    if (DEDUPE_PAIRS.has(pair) && now - lastHandledAt < DEDUPE_MS) {
      return 'deduped';
    }
  }

  if (opts.pushId) {
    const idx = stack.findIndex((l) => l.pushId === opts.pushId);
    if (idx === -1) return 'empty';
    // Only allow popping if it's the top layer (LIFO safety)
    if (idx !== stack.length - 1) {
      // Still remove if UI closed a non-top layer (shouldn't happen often)
      const [layer] = stack.splice(idx, 1);
      if (source === 'ui' || source === 'unmount') {
        if (layer.ownsHistory) programmaticHistoryBack();
      }
      // Hardware back already popped history when source is popstate
      const result = layer.onBack?.();
      if (result === 'prevent') {
        // Re-push if prevented mid-stack (rare)
        stack.splice(idx, 0, layer);
        if (layer.ownsHistory && source === 'popstate') {
          try { history.pushState({ spicehub: 'modal', id: layer.pushId }, ''); } catch { /* */ }
        }
        return 'prevent';
      }
      markHandled(source);
      return 'handled';
    }
  }

  if (stack.length === 0) {
    return handleRootBack(source);
  }

  // Pop first so a sync setState → detachLayer is a no-op (layer already gone)
  const layer = stack.pop();
  const result = layer.onBack?.();
  if (result === 'prevent') {
    stack.push(layer);
    // Browser already consumed history on popstate — restore entry
    if (source === 'popstate' && layer.ownsHistory) {
      try { history.pushState({ spicehub: 'modal', id: layer.pushId }, ''); } catch { /* */ }
    }
    markHandled(source);
    return 'prevent';
  }

  // popstate: browser already moved history back — do not history.back() again
  // closewatcher/escape/ui: must sync history when layer owned an entry
  if (source !== 'popstate' && layer.ownsHistory) {
    programmaticHistoryBack();
  }

  markHandled(source);
  return 'handled';
}

function markHandled(source) {
  lastHandledAt = Date.now();
  lastHandledSource = source || null;
}

function programmaticHistoryBack() {
  if (typeof history === 'undefined' || !history.back) return;
  const gen = ++generation;
  programmaticGens.add(gen);
  try {
    history.back();
  } catch { /* */ }
  // Clear after navigation settles; generation token is primary, timer is backup
  setTimeout(() => {
    programmaticGens.delete(gen);
  }, 400);
}

function handleRootBack(source) {
  // Only intercept real user backs at root
  if (source !== 'popstate' && source !== 'closewatcher' && source !== 'escape') {
    return 'empty';
  }

  const now = Date.now();
  if (now < rootExitArmedUntil) {
    rootExitArmedUntil = 0;
    markHandled(source);
    // Allow the browser/PWA to leave — history already moved on popstate
    return 'root-exit';
  }

  rootExitArmedUntil = now + 2000;
  if (typeof onRootExitHint === 'function') {
    try { onRootExitHint('Press back again to exit'); } catch { /* */ }
  }

  // Re-arm sentinel so the next back can exit (or show hint again after timeout)
  if (source === 'popstate') {
    try {
      history.pushState({ spicehub: 'root-sentinel', t: now }, '');
    } catch { /* */ }
  }

  markHandled(source);
  return 'root-hint';
}

/**
 * Install root exit hint callback (toast).
 * @param {null | ((msg: string) => void)} fn
 */
export function setRootExitHintHandler(fn) {
  onRootExitHint = fn;
}

/** Ensure a history sentinel so first back doesn't leave the app cold. */
export function ensureRootSentinel() {
  if (typeof history === 'undefined' || !history.pushState) return;
  try {
    const st = history.state;
    if (st && (st.spicehub === 'root-sentinel' || st.spicehub === 'modal')) return;
    history.pushState({ spicehub: 'root-sentinel', t: Date.now() }, '');
  } catch { /* */ }
}

// ── Browser wiring ──────────────────────────────────────────────────────────

function onPopState() {
  // Ignore programmatic history.back() completions
  if (programmaticGens.size > 0) {
    // Consume one token if present
    const first = programmaticGens.values().next().value;
    if (first != null) programmaticGens.delete(first);
    return;
  }
  requestBack('popstate');
}

function onKeyDown(e) {
  if (e.key !== 'Escape') return;
  if (e.defaultPrevented) return;
  // Don't steal Escape from inputs that handle it (contenteditable rare)
  if (stack.length === 0) return;
  e.preventDefault();
  requestBack('escape');
}

/**
 * Call once from app boot (safe to call multiple times).
 */
export function initBackNavigation() {
  if (typeof window === 'undefined') return;
  if (!initialized) {
    window.addEventListener('popstate', onPopState);
    initialized = true;
  }
  if (!escapeBound) {
    window.addEventListener('keydown', onKeyDown);
    escapeBound = true;
  }
  ensureRootSentinel();

  if (typeof window !== 'undefined') {
    window.__spicehubBackStack = () => getStackSnapshot();
  }
}

/**
 * Create a CloseWatcher that routes into requestBack (deduped with popstate).
 * @returns {CloseWatcher | null}
 */
export function createBackCloseWatcher() {
  if (typeof window === 'undefined' || !('CloseWatcher' in window)) return null;
  try {
    const watcher = new CloseWatcher();
    watcher.addEventListener('close', () => {
      requestBack('closewatcher');
    });
    return watcher;
  } catch {
    return null;
  }
}
