import { describe, it, expect } from 'vitest';
import {
  parseLaunchIntent,
  intentFromShareEvent,
  ROUTE_TO_TAB,
  TAB_TO_ROUTE,
} from '../lib/launchIntent.js';

// parseLaunchIntent takes an optional {search, hash} so every case here runs
// without a DOM. Passing an explicit object is also what keeps these tests
// honest about precedence — a real browser can present all three at once.

describe('launchIntent — Web Share Target', () => {
  it('reads the GET that sw.js 303s the manifest POST into', () => {
    const i = parseLaunchIntent({
      search: '?share-target=1&url=https%3A%2F%2Finstagram.com%2Fp%2Fabc&title=Pasta&text=so+good',
      hash: '',
    });
    expect(i).toMatchObject({
      source: 'share-target',
      action: 'import',
      url: 'https://instagram.com/p/abc',
      title: 'Pasta',
      text: 'so good',
      isShare: true,
    });
  });

  it('still resolves when the OS sends text only (no url)', () => {
    const i = parseLaunchIntent({ search: '?share-target=1&text=2+oz+gin', hash: '' });
    expect(i.action).toBe('import');
    expect(i.url).toBe('');
    expect(i.text).toBe('2 oz gin');
  });

  it('outranks a stale hash left over from a previous session', () => {
    const i = parseLaunchIntent({ search: '?share-target=1&url=https%3A%2F%2Fx.com', hash: '#/shop' });
    expect(i.source).toBe('share-target');
  });
});

describe('launchIntent — manifest shortcuts', () => {
  // These three shipped in public/manifest.json with no handler anywhere in
  // src. Long-pressing the installed icon and tapping "Add Recipe" landed the
  // user on Home. If one of these ever fails, that regression is back.
  it('/?action=import opens the import sheet with no payload', () => {
    const i = parseLaunchIntent({ search: '?action=import', hash: '' });
    expect(i).toMatchObject({ source: 'shortcut', action: 'import', url: '', text: '' });
  });

  it('/?action=plan navigates to the Plan tab', () => {
    expect(parseLaunchIntent({ search: '?action=plan', hash: '' }))
      .toMatchObject({ action: 'navigate', tab: 'week' });
  });

  it('/?action=grocery navigates to the Shop tab', () => {
    expect(parseLaunchIntent({ search: '?action=grocery', hash: '' }))
      .toMatchObject({ action: 'navigate', tab: 'grocery' });
  });

  it('accepts a url alongside the action (iOS Shortcuts recipe form)', () => {
    const i = parseLaunchIntent({ search: '?action=import&url=https%3A%2F%2Ftiktok.com%2Fv%2F1', hash: '' });
    expect(i.url).toBe('https://tiktok.com/v/1');
    // A user-built Shortcut is not the OS share sheet — do not claim it is.
    expect(i.isShare).toBe(false);
  });

  it('ignores an action it does not own', () => {
    expect(parseLaunchIntent({ search: '?action=selfdestruct', hash: '' })).toBeNull();
  });
});

describe('launchIntent — hash routes', () => {
  it.each([
    ['#/home', 'home'],
    ['#/plan', 'week'],
    ['#/meals', 'library'],
    ['#/bar', 'bar'],
    ['#/shop', 'grocery'],
  ])('%s resolves to tab %s', (hash, tab) => {
    expect(parseLaunchIntent({ search: '', hash })).toMatchObject({ source: 'hash', action: 'navigate', tab });
  });

  it('tolerates a missing slash and a trailing slash', () => {
    expect(parseLaunchIntent({ search: '', hash: '#plan' }).tab).toBe('week');
    expect(parseLaunchIntent({ search: '', hash: '#/plan/' }).tab).toBe('week');
  });

  it('parses #/meals/:id back to the Meals tab and keeps the id', () => {
    const i = parseLaunchIntent({ search: '', hash: '#/meals/abc123' });
    expect(i.tab).toBe('library');
    expect(i.itemId).toBe('abc123');
  });

  it('#/import?url= behaves like a share-target GET but is not a share', () => {
    const i = parseLaunchIntent({ search: '', hash: '#/import?url=https%3A%2F%2Fex.com%2Fr' });
    expect(i).toMatchObject({ action: 'import', url: 'https://ex.com/r', isShare: false });
  });

  it('returns null for a fragment we do not own', () => {
    // PhotoSwipe writes this while a gallery is open.
    expect(parseLaunchIntent({ search: '', hash: '#&gid=1&pid=2' })).toBeNull();
    expect(parseLaunchIntent({ search: '', hash: '' })).toBeNull();
  });
});

describe('launchIntent — native share event', () => {
  it('normalizes a Capacitor payload into the same shape', () => {
    const i = intentFromShareEvent({ url: 'https://ig.com/p/1', title: 'T', text: 'x' });
    expect(i).toMatchObject({ source: 'native-share', action: 'import', isShare: true });
  });

  it('returns null for an empty payload', () => {
    expect(intentFromShareEvent(null)).toBeNull();
    expect(intentFromShareEvent({})).toBeNull();
    expect(intentFromShareEvent({ url: '', text: '' })).toBeNull();
  });
});

describe('launchIntent — route maps', () => {
  it('ROUTE_TO_TAB and TAB_TO_ROUTE are exact mirrors', () => {
    for (const [route, tab] of Object.entries(ROUTE_TO_TAB)) {
      expect(TAB_TO_ROUTE[tab]).toBe(route);
    }
    expect(Object.keys(ROUTE_TO_TAB)).toHaveLength(Object.keys(TAB_TO_ROUTE).length);
  });
});
