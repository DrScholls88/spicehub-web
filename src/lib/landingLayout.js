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
//
// 'fridge' was removed in v2: it and 'pantry' were two adjacent tiles for one
// user idea ("what do I have"), and the fridge one was titled with a question
// rather than a place. They are now a single Pantry tile carrying the pantry
// telemetry as its subtitle. Saved orders are filtered against this list, so
// the retired id drops out of existing records with no migration step.
//
// 'friends' added 2026-09-03. LandingPage.jsx has defined a fully-formed
// Friends tile for some time — colour token (TILE_COLORS.friends), idle
// animation (.idle-friends), live badge/count subtitle, onClick — but the id
// was never added HERE. `visibleTiles` maps over layout.order, and order is
// always filtered against this list, so an id absent from it can never enter
// the layout: the tile was unreachable by construction, on every device, for
// every user. A shipped feature that could not render.
//
// That is exactly the failure this file's header promises not to have ("an
// update to SpiceHub should never silently hide a new feature"). The
// append-missing-ids merge in loadLandingLayout is the mechanism that keeps
// that promise — it simply never had a chance to run for this id.
//
// Placed between 'pantry' and 'stats' to match where the tile sits in
// LandingPage.jsx's `tiles` array, per the "keep in sync" note above.
//
// Deliberately NOT added to DEFAULT_HIDDEN: that set exists for the four tiles
// that duplicate bottom-tab destinations. Friends has no tab — this tile, the
// header person button and a Settings row are its only entry points — so
// hiding it by default would re-create the same invisibility in a form that
// looks intentional.
//
// LAYOUT_DEFAULTS_VERSION is deliberately NOT bumped. A bump only affects the
// isUntouchedV1 branch, which compares against V1_DEFAULT_ORDER and is already
// false for every v2 record; existing users reach the merge path instead, which
// appends 'friends' to whatever order they have. Bumping would change no
// behaviour while falsely implying a defaults migration was required.
export const DEFAULT_WIDGET_ORDER = ['planWeek', 'spinWeek', 'myMeals', 'bar', 'grocery', 'pantry', 'friends', 'stats'];

// Exactly what v1 shipped, frozen. Only used by the defaults migration in
// loadLandingLayout — never edit this to match a newer default or the
// migration silently stops recognising untouched v1 records.
const V1_DEFAULT_ORDER = ['planWeek', 'spinWeek', 'myMeals', 'bar', 'grocery', 'pantry', 'fridge', 'stats'];

// Hidden out of the box from v2 on. These four are four of the five bottom-tab
// destinations; repeating them as tiles taught users that the real navigation
// lives in the dashboard rather than the tab bar. They stay fully defined and
// one tap away under Customize Home — this only changes what a user sees
// before they have expressed a preference.
export const DEFAULT_HIDDEN = ['planWeek', 'myMeals', 'bar', 'grocery'];

// Bumped whenever DEFAULT_HIDDEN / DEFAULT_WIDGET_ORDER change in a way that
// should reach users who never customised anything.
const LAYOUT_DEFAULTS_VERSION = 2;

function sameOrder(a, b) {
  return Array.isArray(a) && a.length === b.length && a.every((id, i) => id === b[i]);
}

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
 * Returns { order: string[], hidden: string[], v: number }.
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

  // ── v1 → v2 defaults migration ───────────────────────────────────────────
  // LandingPage persists the layout from a mount effect, so EVERY user who has
  // ever opened Home has a stored v1 record — whether or not they ever touched
  // Customize Home. A plain "is there a saved layout?" test would therefore
  // never let new defaults reach anyone.
  //
  // So distinguish by content instead: a v1 record that is identical to what
  // v1 shipped was written by that effect, not by a person, and is safe to
  // replace. A record that differs in any way is a real choice and is left
  // exactly as it is (the file's original promise — never reset a returning
  // user's carefully arranged layout). Compare against the RAW saved order,
  // not the filtered one, since filtering already strips the retired 'fridge'.
  const isUntouchedV1 =
    saved?.v !== LAYOUT_DEFAULTS_VERSION &&
    (!Array.isArray(saved?.hidden) || saved.hidden.length === 0) &&
    sameOrder(saved?.order, V1_DEFAULT_ORDER);

  // A record with no usable order is corrupt, not a preference. Without this
  // it fell through to the merge path below and produced "default order,
  // nothing hidden" — i.e. silently restored the pre-v2 Home.
  const hasUsableOrder = Array.isArray(saved?.order) && saved.order.length > 0;

  if (!saved || !hasUsableOrder || isUntouchedV1) {
    return {
      order: [...DEFAULT_WIDGET_ORDER],
      hidden: [...DEFAULT_HIDDEN],
      v: LAYOUT_DEFAULTS_VERSION,
    };
  }

  const savedOrder = Array.isArray(saved?.order) ? saved.order.filter(id => DEFAULT_WIDGET_ORDER.includes(id)) : [];
  const missing = DEFAULT_WIDGET_ORDER.filter(id => !savedOrder.includes(id));
  const order = [...savedOrder, ...missing];

  const hidden = Array.isArray(saved?.hidden) ? saved.hidden.filter(id => DEFAULT_WIDGET_ORDER.includes(id)) : [];

  return { order, hidden, v: LAYOUT_DEFAULTS_VERSION };
}

export function saveLandingLayout(layout) {
  try {
    if (typeof window === 'undefined') return;
    const order = Array.isArray(layout?.order) ? layout.order.filter(id => DEFAULT_WIDGET_ORDER.includes(id)) : DEFAULT_WIDGET_ORDER;
    const hidden = Array.isArray(layout?.hidden) ? layout.hidden.filter(id => DEFAULT_WIDGET_ORDER.includes(id)) : [];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ order, hidden, v: LAYOUT_DEFAULTS_VERSION }));
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
