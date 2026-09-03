/**
 * SpiceHub - Inbound Launch Intent Parser
 *
 * ONE place that answers "why was the app just opened?". Before this file the
 * answer was scattered: App.jsx read `?share-target=1` inline, main.jsx wired
 * the Capacitor `spicehub:share-import` event, and the three home-screen
 * shortcuts declared in public/manifest.json (`/?action=import`, `/?action=plan`,
 * `/?action=grocery`) were read by NOTHING AT ALL - long-pressing the installed
 * icon and tapping "Add Recipe" just dropped the user on Home. This module makes
 * every inbound path produce the same normalized shape so App.jsx has exactly
 * one branch to maintain.
 *
 * Sources handled:
 *   1. Web Share Target   `/?share-target=1&url=&title=&text=`
 *                         (sw.js 303-redirects the manifest's POST into this GET
 *                         - do NOT move share_target.action to a hash, a POST
 *                         body cannot be stuffed into a fragment)
 *   2. Manifest shortcuts `/?action=import|plan|grocery|meals|bar`
 *   3. Hash routes        `#/plan  #/meals  #/bar  #/shop  #/home  #/import?url=`
 *   4. Native share       the `spicehub:share-import` CustomEvent that main.jsx
 *                         dispatches from @capgo/capacitor-share-target
 *
 * Everything here is pure and window-optional so it can be unit tested without
 * a DOM. The only side-effecting helpers are scrubLaunchQuery / syncTabHash,
 * both of which no-op when `window` or `history` is missing.
 */

// ---- Route vocabulary -------------------------------------------------------
// Deliberately the USER's nouns, not the internal tab ids. `week` is the tab id
// but nobody calls it that - the tab is labelled "Plan", so the route is /plan.
// Keep these two maps mirror images of each other.

/** user-facing route segment -> internal tab id */
export const ROUTE_TO_TAB = Object.freeze({
  home: 'home',
  plan: 'week',
  meals: 'library',
  bar: 'bar',
  shop: 'grocery',
});

/** internal tab id -> user-facing route segment */
export const TAB_TO_ROUTE = Object.freeze({
  home: 'home',
  week: 'plan',
  library: 'meals',
  bar: 'bar',
  grocery: 'shop',
});

// ---- Manifest shortcut contract --------------------------------------------
// These strings are a CONTRACT with public/manifest.json. Renaming a key here
// without renaming the matching shortcut `url` there silently re-breaks that
// home-screen shortcut, which is the exact bug this module exists to fix.
const ACTION_MAP = Object.freeze({
  import:  { action: 'import',   tab: null },
  plan:    { action: 'navigate', tab: 'week' },
  grocery: { action: 'navigate', tab: 'grocery' },
  meals:   { action: 'navigate', tab: 'library' },
  bar:     { action: 'navigate', tab: 'bar' },
});

/**
 * @typedef {object} LaunchIntent
 * @property {'share-target'|'shortcut'|'hash'|'native-share'} source
 * @property {'import'|'navigate'} action
 * @property {string|null} tab      internal tab id, or null for an import intent
 * @property {string} url
 * @property {string} title
 * @property {string} text
 * @property {string} itemId        parsed from `#/meals/:id`; not consumed yet
 * @property {boolean} isShare      true only when the OS handed us this content
 */

function normalize(partial) {
  return {
    source: partial.source,
    action: partial.action,
    tab: partial.tab || null,
    url: partial.url || '',
    title: partial.title || '',
    text: partial.text || '',
    itemId: partial.itemId || '',
    isShare: !!partial.isShare,
  };
}

function safeParams(qs) {
  try {
    return new URLSearchParams(qs || '');
  } catch {
    return new URLSearchParams();
  }
}

/**
 * Parse a hash fragment into an intent fragment, or null if it is not a route
 * we own. Tolerates `#/plan`, `#plan`, `#/plan/`, `#/meals/abc123` and
 * `#/import?url=https%3A%2F%2F...`.
 * @param {string} hash
 */
function parseHashRoute(hash) {
  if (!hash || typeof hash !== 'string') return null;

  const raw = hash.replace(/^#\/?/, '');
  if (!raw) return null;

  const qIndex = raw.indexOf('?');
  const pathPart = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const queryPart = qIndex === -1 ? '' : raw.slice(qIndex + 1);

  const segments = pathPart.split('/').filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  const head = (segments[0] || '').toLowerCase();
  if (!head) return null;

  if (head === 'import') {
    const hp = safeParams(queryPart);
    return {
      action: 'import',
      url: hp.get('url') || '',
      title: hp.get('title') || '',
      text: hp.get('text') || '',
      isShare: false,
    };
  }

  const tab = ROUTE_TO_TAB[head];
  if (!tab) return null;
  return { action: 'navigate', tab, itemId: segments[1] || '' };
}

/**
 * Parse the current (or a supplied) location into a LaunchIntent, or null when
 * the app was opened plainly.
 *
 * Precedence is share-target > shortcut > hash, because only the first two can
 * carry a payload the user just handed us from another app - a stale hash left
 * over from a previous session must never outrank a fresh share.
 *
 * @param {{search?: string, hash?: string}} [loc]  defaults to window.location
 * @returns {LaunchIntent|null}
 */
export function parseLaunchIntent(loc) {
  const hasWindow = typeof window !== 'undefined';
  const search = typeof loc?.search === 'string'
    ? loc.search
    : (hasWindow ? window.location.search : '');
  const hash = typeof loc?.hash === 'string'
    ? loc.hash
    : (hasWindow ? window.location.hash : '');

  const params = safeParams(search);

  // 1. Web Share Target (sw.js POST -> 303 -> this GET).
  if (params.has('share-target')) {
    return normalize({
      source: 'share-target',
      action: 'import',
      url: params.get('url') || '',
      title: params.get('title') || '',
      text: params.get('text') || '',
      isShare: true,
    });
  }

  // 2. Manifest home-screen shortcut.
  const actionKey = (params.get('action') || '').toLowerCase().trim();
  if (actionKey && Object.prototype.hasOwnProperty.call(ACTION_MAP, actionKey)) {
    const mapped = ACTION_MAP[actionKey];
    return normalize({
      source: 'shortcut',
      action: mapped.action,
      tab: mapped.tab,
      // A shortcut can legally carry a url too (e.g. an iOS Shortcuts recipe
      // that builds `/?action=import&url=...` instead of the share-target form).
      url: params.get('url') || '',
      title: params.get('title') || '',
      text: params.get('text') || '',
    });
  }

  // 3. Hash route.
  const fromHash = parseHashRoute(hash);
  if (fromHash) return normalize({ source: 'hash', ...fromHash });

  return null;
}

/**
 * Normalize the payload of a `spicehub:share-import` CustomEvent (dispatched by
 * main.jsx from the Capacitor plugin) into the same shape parseLaunchIntent
 * returns, so App.jsx handles native and web shares with one code path.
 * @param {{url?: string, text?: string, title?: string}} detail
 * @returns {LaunchIntent|null}
 */
export function intentFromShareEvent(detail) {
  if (!detail || (!detail.url && !detail.text)) return null;
  return normalize({
    source: 'native-share',
    action: 'import',
    url: detail.url || '',
    title: detail.title || '',
    text: detail.text || '',
    isShare: true,
  });
}

/**
 * Strip the launch query string from the address bar once an intent has been
 * consumed, so a reload does not re-fire the same import.
 *
 * Deliberately PRESERVES the hash: for a `#/plan` launch the fragment is the
 * address, not a spent token. Also deliberately uses replaceState, never
 * pushState - src/navigation/backStack.js owns popstate for modal layers, and a
 * second writer would make one back gesture close two things.
 */
export function scrubLaunchQuery() {
  try {
    if (typeof window === 'undefined' || !window.history?.replaceState) return;
    const { pathname, hash } = window.location;
    window.history.replaceState({}, '', `${pathname}${hash || ''}`);
  } catch {
    /* non-fatal - a wrong address bar is never worth throwing over */
  }
}

/**
 * Keep the address bar honest about which tab is open.
 *
 * replaceState only, for the backStack reason above. That means this gives us
 * shareable/bookmarkable tab URLs and a truthful address bar, but NOT
 * back-restores-the-previous-tab - wiring that needs backStack to own tab
 * layers too, which is a separate change.
 *
 * @param {string} tab  internal tab id
 */
export function syncTabHash(tab) {
  try {
    if (typeof window === 'undefined' || !window.history?.replaceState) return;
    const route = TAB_TO_ROUTE[tab];
    if (!route) return;

    // Home is the bare URL - a `#/home` fragment on the landing page is noise.
    const next = route === 'home' ? '' : `#/${route}`;
    const current = window.location.hash || '';
    if (current === next) return;

    // Never clobber a fragment we do not own. PhotoSwipe's History module
    // writes `#&gid=1&pid=2` while a gallery is open; stomping that would
    // close the lightbox out from under the user.
    if (current) {
      const head = current.replace(/^#\/?/, '').split(/[/?&]/)[0].toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(ROUTE_TO_TAB, head)) return;
    }

    window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}${next}`);
  } catch {
    /* non-fatal */
  }
}
