// src/lib/nativeShell.js as it behaves inside the Capacitor app. vitest runs in
// node, so the few DOM globals the module touches are stubbed before import.
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  SystemBars: { setStyle: vi.fn(() => Promise.resolve()) },
  SystemBarsStyle: { Dark: 'DARK', Light: 'LIGHT' },
  SystemBarType: { StatusBar: 'StatusBar', NavigationBar: 'NavigationBar' },
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(), exitApp: vi.fn() } }));

const API = 'https://spicehub-web.vercel.app';
const seen = [];
let shell;

beforeAll(async () => {
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('HTMLAnchorElement', class { click() {} });
  vi.stubGlobal('window', {
    location: { href: 'https://localhost/', origin: 'https://localhost' },
    fetch: (input, init) => {
      seen.push({ url: input instanceof Request ? input.url : String(input), method: input instanceof Request ? input.method : init?.method });
      return Promise.resolve(new Response('{}'));
    },
  });
  shell = await import('../lib/nativeShell');
});

const last = () => seen[seen.length - 1];

describe('nativeShell on a device', () => {
  it('sends relative and same-origin /api/* calls to the deployed API', async () => {
    await window.fetch('/api/extract?url=x');
    expect(last().url).toBe(`${API}/api/extract?url=x`);
    await window.fetch('https://localhost/api/vision?model=m', { method: 'POST' });
    expect(last()).toEqual({ url: `${API}/api/vision?model=m`, method: 'POST' });
  });

  it('keeps the method and body of a rewritten Request', async () => {
    await window.fetch(new Request('https://localhost/api/structure', { method: 'POST', body: '{}' }));
    expect(last()).toEqual({ url: `${API}/api/structure`, method: 'POST' });
  });

  it('leaves local assets and other hosts alone', async () => {
    await window.fetch('/assets/app.js');
    expect(last().url).toBe('/assets/app.js');
    await window.fetch('https://example.com/api/x');
    expect(last().url).toBe('https://example.com/api/x');
  });

  it('apiUrl prefixes /api paths for <img src>', () => {
    expect(shell.apiUrl('/api/proxy?mode=image-data-url')).toBe(`${API}/api/proxy?mode=image-data-url`);
    expect(shell.apiUrl('/icon-192.png')).toBe('/icon-192.png');
  });

  it('installs a navigator.share fallback where the WebView has none', () => {
    expect(typeof navigator.share).toBe('function');
    expect(navigator.canShare()).toBe(true);
  });
});
