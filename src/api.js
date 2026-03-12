/**
 * SpiceHub — API client for the recipe extraction server.
 *
 * In production: server is deployed to a cloud URL (Render, Railway, etc.)
 * In local dev:  server runs on the same machine (localhost:3001)
 *
 * The server URL is determined by:
 *   1. VITE_API_URL env variable (set in .env or .env.production)
 *   2. Auto-detect from window.location (local dev fallback)
 */

function getServerURL() {
  // 1. Explicit env variable (set during build)
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) return envUrl.replace(/\/$/, ''); // Strip trailing slash

  // 2. Local dev auto-detect
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://localhost:3001';
  }
  // Remote LAN IP (e.g., 192.168.x.x:5173 → same IP :3001)
  return `http://${host}:3001`;
}

const SERVER = getServerURL();
const CHECK_TIMEOUT = 8000;

// Cache server availability for 30s
let _serverAvailable = null;
let _lastCheck = 0;
const CACHE_DURATION = 30_000;

export async function isServerAvailable() {
  const now = Date.now();
  if (_serverAvailable !== null && now - _lastCheck < CACHE_DURATION) {
    return _serverAvailable;
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT);

    const r = await fetch(`${SERVER}/api/status`, {
      signal: ctrl.signal,
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    clearTimeout(timer);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    _serverAvailable = data.ok === true;
    _lastCheck = now;
    return _serverAvailable;
  } catch (e) {
    console.warn('[SpiceHub] Server unavailable:', e.message);
    _serverAvailable = false;
    _lastCheck = now;
    return false;
  }
}

export async function getServerStatus() {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), CHECK_TIMEOUT);
    const r = await fetch(`${SERVER}/api/status`, { signal: ctrl.signal });
    return await r.json();
  } catch {
    return { ok: false, chromeFound: false };
  }
}

export async function openBrowser(url) {
  const r = await fetch(`${SERVER}/api/browser/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return r.json();
}

export async function extractFromBrowser() {
  const r = await fetch(`${SERVER}/api/browser/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return r.json();
}

export async function closeBrowser() {
  try {
    await fetch(`${SERVER}/api/browser/close`, { method: 'POST' });
  } catch { /* ignore */ }
  _serverAvailable = null;
  _lastCheck = 0;
}

/**
 * Primary recipe extraction — server fetches the page and parses it.
 * Works for both social media (headless Chrome) and recipe blogs (HTTP fetch).
 */
export async function extractUrl(url) {
  try {
    const available = await isServerAvailable();
    if (!available) {
      // Server not available — fall back to client-side parsing
      console.log('[SpiceHub] Server unavailable for URL extraction, using client-side parser');
      const { parseFromUrl } = await import('./recipeParser.js');
      const result = await parseFromUrl(url);
      if (result && !result._error) {
        // Convert client-side result to server response format
        return {
          ok: true,
          type: 'jsonld',
          sourceUrl: url,
          title: result.name,
          recipe: {
            name: result.name,
            recipeIngredient: result.ingredients,
            recipeInstructions: result.directions,
            image: result.imageUrl ? [result.imageUrl] : [],
          },
          imageUrl: result.imageUrl,
        };
      }
      return result || { ok: false, reason: 'client-parse-failed' };
    }

    const r = await fetch(`${SERVER}/api/extract-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    return r.json();
  } catch (e) {
    console.error('[SpiceHub] extractUrl error:', e.message);
    // Fall back to client-side parsing on network error
    try {
      const { parseFromUrl } = await import('./recipeParser.js');
      const result = await parseFromUrl(url);
      if (result && !result._error) {
        return {
          ok: true,
          type: 'jsonld',
          sourceUrl: url,
          title: result.name,
          recipe: {
            name: result.name,
            recipeIngredient: result.ingredients,
            recipeInstructions: result.directions,
            image: result.imageUrl ? [result.imageUrl] : [],
          },
          imageUrl: result.imageUrl,
        };
      }
      return result || { ok: false, reason: 'client-parse-failed' };
    } catch (fallbackErr) {
      console.error('[SpiceHub] Fallback parsing also failed:', fallbackErr);
      return { ok: false, reason: 'extraction-failed', error: e.message };
    }
  }
}
