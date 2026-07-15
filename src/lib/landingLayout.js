// landingLayout.js — persisted, device-local layout for the Landing Page's
// widget dashboard (order + hidden set). Pure/localStorage-only so it can be
// read synchronously as a useState initializer (same pattern as App.jsx's
// dietaryPref) and never depends on Dexie being open yet.
//
// Forward-compatible on purpose: if a future update adds a new widget id that
// isn't in a user's saved order, it's appended to the end rather than
// dropped — an update to SpiceHub should never silently hide a new feature,
// and should never reset a returning user's carefully arranged layout either.

const STORAGE_KEY = 'spicehub-landing-layout-v1';

// Canonical id list + order shipped in the app. Keep in sync with the `tiles`
// array built in LandingPage.jsx — this is only the fallback/merge reference,
// LandingPage still owns the actual tile definitions (emoji/title/onClick).
export const DEFAULT_WIDGET_ORDER = ['planWeek', 'myMeals', 'bar', 'grocery', 'pantry', 'fridge', 'stats'];

function safeParse(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Returns { order: string[], hidden: string[] }.
 * `order` always contains every id from DEFAULT_WIDGET_ORDER at least once
 * (any ids the saved layout doesn't know about yet are appended in default
 * order), and never contains an id that no longer exists in the app.
 */
export function loadLandingLayout() {
  let saved = null;
  try {
    saved = typeof window !== 'undefined' ? safeParse(window.localStorage.getItem(STORAGE_KEY)) : null;
  } catch {
    saved = null;
  }

  const savedOrder = Array.isArray(saved?.order) ? saved.order.filter(id => DEFAULT_WIDGET_ORDER.includes(id)) : [];
  const missing = DEFAULT_WIDGET_ORDER.filter(id => !savedOrder.includes(id));
  const order = [...savedOrder, ...missing];

  const hidden = Array.isArray(saved?.hidden) ? saved.hidden.filter(id => DEFAULT_WIDGET_ORDER.includes(id)) : [];

  return { order, hidden };
}

export function saveLandingLayout(layout) {
  try {
    if (typeof window === 'undefined') return;
    const order = Array.isArray(layout?.order) ? layout.order.filter(id => DEFAULT_WIDGET_ORDER.includes(id)) : DEFAULT_WIDGET_ORDER;
    const hidden = Array.isArray(layout?.hidden) ? layout.hidden.filter(id => DEFAULT_WIDGET_ORDER.includes(id)) : [];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ order, hidden }));
  } catch {
    /* best-effort — a failed write just means the layout won't persist this time */
  }
}

// ── Spin Action Center — pre-spin constraint toggles ─────────────────────────
// Same device-local persistence approach as the layout above. Kept separate
// from `dietaryPref` (App.jsx) because that's a household-wide setting used
// by the Rotation/Grocery/Planner at large; these three toggles are specific
// to "what should THIS spin honor" and default to all-off.
const SPIN_PREFS_KEY = 'spicehub-spin-constraints-v1';

export const DEFAULT_SPIN_CONSTRAINTS = {
  vegetarianOnly: false,
  under30: false,
  useFridgeStock: false,
};

export function loadSpinConstraints() {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(SPIN_PREFS_KEY) : null;
    const parsed = raw ? safeParse(raw) : null;
    if (!parsed) return { ...DEFAULT_SPIN_CONSTRAINTS };
    return {
      vegetarianOnly: !!parsed.vegetarianOnly,
      under30: !!parsed.under30,
      useFridgeStock: !!parsed.useFridgeStock,
    };
  } catch {
    return { ...DEFAULT_SPIN_CONSTRAINTS };
  }
}

export function saveSpinConstraints(constraints) {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SPIN_PREFS_KEY, JSON.stringify({
      vegetarianOnly: !!constraints?.vegetarianOnly,
      under30: !!constraints?.under30,
      useFridgeStock: !!constraints?.useFridgeStock,
    }));
  } catch {
    /* best-effort */
  }
}
