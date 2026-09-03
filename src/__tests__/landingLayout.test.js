import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import {
  loadLandingLayout,
  saveLandingLayout,
  DEFAULT_WIDGET_ORDER,
  DEFAULT_HIDDEN,
} from '../lib/landingLayout.js';

const KEY = 'spicehub-landing-layout-v1';

// vitest runs in the default 'node' environment here (see vitest.config.js —
// setup.js only adds fake-indexeddb), so there is no window/localStorage.
// landingLayout.js reads window.localStorage lazily inside its functions, not
// at module load, so a stub installed in beforeAll is enough — no jsdom, and
// no config change that would slow every other suite down.
beforeAll(() => {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    },
  };
});

// Exactly what v1 shipped. The migration keys off this, so if it ever needs
// editing here, the migration is broken rather than the test.
const V1_ORDER = ['planWeek', 'spinWeek', 'myMeals', 'bar', 'grocery', 'pantry', 'fridge', 'stats'];
// What v2 shipped BEFORE the Friends tile was wired up. Frozen, like
// V1_ORDER above — it is the 'existing user' starting point for the
// friends-append test below, not a description of current defaults.
const V2_ORDER_PRE_FRIENDS = ['planWeek', 'spinWeek', 'myMeals', 'bar', 'grocery', 'pantry', 'stats'];

// The order the app ships RIGHT NOW. Unlike V1_ORDER / V2_ORDER_PRE_FRIENDS
// this tracks DEFAULT_WIDGET_ORDER and is expected to change whenever a
// tile is added or retired. It was called V2_ORDER until 2026-09-03, when
// 'friends' was added without a defaults-version bump — at which point the
// old name would have implied a frozen v2 snapshot it no longer was.
const CURRENT_ORDER = ['planWeek', 'spinWeek', 'myMeals', 'bar', 'grocery', 'pantry', 'friends', 'stats'];

// What an EXISTING record becomes after the merge. Not the same as
// CURRENT_ORDER, and deliberately so: loadLandingLayout appends unknown ids
// to the END of a saved order rather than splicing them into their canonical
// slot, because a returning user's arrangement is theirs and a new tile has
// no business pushing their layout around. So a fresh install sees
// …pantry, friends, stats while an upgraded one sees …pantry, stats, friends.
const MERGED_ORDER = [...V2_ORDER_PRE_FRIENDS, 'friends'];

const seed = (value) => {
  window.localStorage.clear();
  if (value !== undefined) window.localStorage.setItem(KEY, JSON.stringify(value));
};

describe('landingLayout — shipped defaults', () => {
  beforeEach(() => window.localStorage.clear());

  it('drops the retired fridge tile from the canonical order', () => {
    expect(DEFAULT_WIDGET_ORDER).toEqual(CURRENT_ORDER);
    expect(DEFAULT_WIDGET_ORDER).not.toContain('fridge');
  });

  // Regression guard for 2026-09-03: LandingPage defined a complete Friends
  // tile, but the id was missing here. visibleTiles maps over layout.order and
  // order is filtered against DEFAULT_WIDGET_ORDER, so the tile could never be
  // rendered by anyone. Any tile LandingPage can build MUST have its id here or
  // it does not exist as far as the UI is concerned.
  it('contains every tile id LandingPage can render, including friends', () => {
    expect(DEFAULT_WIDGET_ORDER).toContain('friends');
  });

  it('hides the four tiles that duplicate bottom-tab destinations', () => {
    expect(DEFAULT_HIDDEN).toEqual(['planWeek', 'myMeals', 'bar', 'grocery']);
  });

  it('a fresh install gets the trimmed Home', () => {
    seed(undefined);
    expect(loadLandingLayout()).toEqual({ order: CURRENT_ORDER, hidden: [...DEFAULT_HIDDEN], v: 2 });
  });
});

describe('landingLayout — v1 to v2 defaults migration', () => {
  beforeEach(() => window.localStorage.clear());

  // LandingPage persists the layout from a mount effect, so every existing
  // user has a v1 record whether or not they ever opened Customize Home.
  // A record identical to the v1 default was written by that effect.
  it('replaces the auto-saved v1 record nobody customised', () => {
    seed({ order: V1_ORDER, hidden: [] });
    expect(loadLandingLayout()).toEqual({ order: CURRENT_ORDER, hidden: [...DEFAULT_HIDDEN], v: 2 });
  });

  it('never resets a layout the user actually reordered', () => {
    seed({ order: ['stats', 'spinWeek', 'planWeek', 'myMeals', 'bar', 'grocery', 'pantry', 'fridge'], hidden: [] });
    expect(loadLandingLayout()).toEqual({
      order: ['stats', 'spinWeek', 'planWeek', 'myMeals', 'bar', 'grocery', 'pantry', 'friends'],
      hidden: [],
      v: 2,
    });
  });

  it('never resets a layout where the user hid something', () => {
    seed({ order: V1_ORDER, hidden: ['stats'] });
    expect(loadLandingLayout()).toEqual({ order: MERGED_ORDER, hidden: ['stats'], v: 2 });
  });

  it('treats hiding the retired tile as a real choice too', () => {
    seed({ order: V1_ORDER, hidden: ['fridge'] });
    expect(loadLandingLayout()).toEqual({ order: MERGED_ORDER, hidden: [], v: 2 });
  });

  // The upgrade path that actually matters for the Friends fix: a settled v2
  // record written before the tile existed. The merge must append the new id
  // rather than ignore it, or the fix reaches only fresh installs — and it
  // must land at the END, not in the canonical slot, so an existing layout is
  // not rearranged underneath the user.
  it('appends a newly-shipped tile id to an existing v2 record', () => {
    seed({ order: V2_ORDER_PRE_FRIENDS, hidden: [], v: 2 });
    expect(loadLandingLayout()).toEqual({ order: MERGED_ORDER, hidden: [], v: 2 });
  });

  // ...and does not un-hide anything the user hid while doing it.
  it('appends a new tile without disturbing a customised hidden set', () => {
    seed({ order: V2_ORDER_PRE_FRIENDS, hidden: ['stats'], v: 2 });
    expect(loadLandingLayout()).toEqual({ order: MERGED_ORDER, hidden: ['stats'], v: 2 });
  });

  it('does not re-apply defaults to an already-migrated record', () => {
    seed({ order: CURRENT_ORDER, hidden: [], v: 2 });
    expect(loadLandingLayout()).toEqual({ order: CURRENT_ORDER, hidden: [], v: 2 });
  });

  it('lets a user un-hide everything and have it stick', () => {
    seed({ order: V1_ORDER, hidden: [] });
    const migrated = loadLandingLayout();
    saveLandingLayout({ ...migrated, hidden: [] });
    expect(loadLandingLayout()).toEqual({ order: CURRENT_ORDER, hidden: [], v: 2 });
  });

  it('round-trips through save without drifting', () => {
    seed({ order: V1_ORDER, hidden: [] });
    const first = loadLandingLayout();
    saveLandingLayout(first);
    expect(loadLandingLayout()).toEqual(first);
  });
});

describe('landingLayout — corrupt records', () => {
  beforeEach(() => window.localStorage.clear());

  it('falls back to the trimmed defaults on unparseable JSON', () => {
    window.localStorage.setItem(KEY, '{{{');
    expect(loadLandingLayout()).toEqual({ order: CURRENT_ORDER, hidden: [...DEFAULT_HIDDEN], v: 2 });
  });

  it('falls back to the trimmed defaults when order is not an array', () => {
    // Regression guard: this used to fall through to the merge path and
    // silently restore the pre-v2 Home (default order, nothing hidden).
    seed({ order: 'nope', hidden: 42 });
    expect(loadLandingLayout()).toEqual({ order: CURRENT_ORDER, hidden: [...DEFAULT_HIDDEN], v: 2 });
  });

  it('drops unknown ids but keeps a real partial order', () => {
    seed({ order: ['bogusId', 'pantry'], hidden: ['alsoBogus'] });
    expect(loadLandingLayout()).toEqual({
      order: ['pantry', 'planWeek', 'spinWeek', 'myMeals', 'bar', 'grocery', 'friends', 'stats'],
      hidden: [],
      v: 2,
    });
  });
});
