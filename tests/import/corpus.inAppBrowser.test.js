// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — native in-app recipe browser (lib/inAppRecipeBrowser.js)
// ─────────────────────────────────────────────────────────────────────────────
// For sites that refuse recipe apps' server fetches, the native app opens the
// page in @capgo/inappbrowser; the person taps the toolbar import button, the
// page posts its rendered HTML back, and the engine builds the pack from it
// with the same extractor /api/extract uses: no server fetch at all.
// The plugin is faked at the registerPlugin boundary so the real event flow
// (open → buttonNearDoneClick → executeScript → messageFromWebview → close) runs.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let native = true;
const listeners = {};
const plugin = {
  addListener: vi.fn(async (name, fn) => { listeners[name] = fn; return { remove: vi.fn(async () => { delete listeners[name]; }) }; }),
  openWebView: vi.fn(async () => ({ id: 'wv1' })),
  executeScript: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
};
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal()),
  Capacitor: { isNativePlatform: () => native, isPluginAvailable: (n) => native && n === 'InAppBrowser' },
  registerPlugin: () => plugin,
}));

const { canReadInApp, readRecipePageInApp } = await import('../../src/lib/inAppRecipeBrowser.js');
const { importRequest } = await import('../../src/import/engine.js');
const { missMessage } = await import('../../src/importCopy.js');
// packFromPageHtml loads the extractor lazily; warm it here so the engine test
// times the flow (~15 ms), not a cold module transform (many seconds in a VM).
await import('../../api/extract.js');

const URL_ = 'https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/';
const RECIPE_HTML = `<html><head><title>Cookies</title><script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'Recipe', name: 'Best Chocolate Chip Cookies',
  recipeIngredient: ['1 cup butter', '2 cups flour', '2 cups chocolate chips'],
  recipeInstructions: [{ '@type': 'HowToStep', text: 'Cream the butter.' }, { '@type': 'HowToStep', text: 'Bake 10 minutes at 350F.' }],
})}</script></head><body>${'<p>Cookie notes.</p>'.repeat(30)}</body></html>`;
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { native = true; Object.values(plugin).forEach((f) => f.mockClear()); });
afterEach(() => vi.unstubAllGlobals());

describe('readRecipePageInApp', () => {
  it('returns the page the person imported from the toolbar button', async () => {
    const pending = readRecipePageInApp(URL_);
    await tick();
    expect(plugin.openWebView.mock.calls[0][0]).toMatchObject({ url: URL_, preventDeeplink: true });
    listeners.buttonNearDoneClick({ id: 'wv1' });
    expect(plugin.executeScript).toHaveBeenCalledWith(expect.objectContaining({ id: 'wv1', code: expect.stringContaining('window.mobileApp.postMessage') }));
    listeners.messageFromWebview({ id: 'wv1', detail: { type: 'spicehub-recipe-page', url: URL_, html: RECIPE_HTML } });
    expect(await pending).toEqual({ url: URL_, html: RECIPE_HTML });
    expect(plugin.close).toHaveBeenCalledWith({ id: 'wv1' });
    expect(Object.keys(listeners)).toEqual([]); // every listener removed
  });

  it('closing the browser without importing resolves null', async () => {
    const pending = readRecipePageInApp(URL_);
    await tick();
    listeners.closeEvent({ id: 'wv1' });
    expect(await pending).toBeNull();
  });

  it('ignores other pages\' messages and rejects a non-http URL or empty HTML from the page', async () => {
    const pending = readRecipePageInApp(URL_);
    await tick();
    listeners.messageFromWebview({ id: 'wv1', detail: { type: 'something-else' } });
    listeners.messageFromWebview({ id: 'wv1', detail: { type: 'spicehub-recipe-page', url: 'javascript:alert(1)', html: 'x' } });
    expect(await pending).toBeNull();
  });

  it('is off on the web / without the plugin', async () => {
    native = false;
    expect(canReadInApp()).toBe(false);
    expect(await readRecipePageInApp(URL_)).toBeNull();
    expect(plugin.openWebView).not.toHaveBeenCalled();
  });
});

describe('engine with pageHtml', () => {
  it('builds the pack from the page, with no fetch', async () => {
    const fetchSpy = vi.fn(async () => { throw new Error('no network expected'); });
    vi.stubGlobal('fetch', fetchSpy);
    const { recipe, pack } = await importRequest({ url: URL_, pageHtml: RECIPE_HTML, kind: 'meal' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(pack.acquiredVia).toBe('json-ld');
    expect(pack.provenance).toContainEqual({ field: 'page', via: 'in-app-browser' });
    expect(recipe.name).toBe('Best Chocolate Chip Cookies');
    expect(recipe.link).toBe(URL_);
  });

  it('a page with nothing in it is "no recipe on page"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network expected'); }));
    const result = await importRequest({ url: URL_, pageHtml: '<html><body></body></html>', kind: 'meal' });
    expect(result.reasons).toEqual(['no-recipe-on-page']);
  });
});

describe('Miss copy offers the browser only where it exists', () => {
  it('canBrowse adds the browser first and says what to tap', () => {
    const msg = missMessage(['site-publisher-block'], URL_, { canBrowse: true });
    expect(msg.actions).toEqual(['browser', 'paste', 'screenshot']);
    expect(msg.text).toMatch(/SpiceHub browser and tap import/);
  });

  it('never for a missing page or an unreachable server', () => {
    expect(missMessage(['site-page-not-found'], URL_, { canBrowse: true }).actions).toEqual(['paste']);
    expect(missMessage(['site-unreachable'], URL_, { canBrowse: true }).actions).toEqual(['paste']);
  });
});
