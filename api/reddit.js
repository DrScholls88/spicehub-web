// ─────────────────────────────────────────────────────────────────────────────
// /api/reddit — server-side Reddit OAuth2 proxy (app-only "client_credentials"
// grant, no user login required).
//
// WHY THIS EXISTS (2026-07-08): the previous fix (2026-07-07) replaced the
// generic fetchHtmlViaProxy cascade with a JSON-specific one and fixed the
// Accept/Sec-Fetch header mismatch — but prod logs still show 403s from
// Reddit at the proxy level. Reddit has tightened anti-scraping enforcement
// on its anonymous `.json` endpoints (the same crackdown behind the 2023
// third-party-app pricing changes) and is blocking unauthenticated requests
// from cloud/datacenter IP ranges, including Vercel's — no amount of header
// tuning or proxy rotation fixes that; the request itself needs to be a
// legitimate, Reddit-sanctioned OAuth client.
//
// This endpoint does that: it authenticates as a registered Reddit "script"
// app via the client_credentials grant (read-only, no Reddit user account
// needed) and forwards the request to oauth.reddit.com, which mirrors the
// same path structure as www.reddit.com's public json endpoints.
//
// ONE-TIME MANUAL SETUP (site owner, not this code):
//   1. Log into Reddit → https://www.reddit.com/prefs/apps
//   2. "create another app..." → name: SpiceHub (or anything) → type: "script"
//      → redirect uri: http://localhost (unused by this grant, but required)
//   3. Copy the client ID (the string under the app name) and the "secret"
//   4. Vercel project → Settings → Environment Variables, add:
//        REDDIT_CLIENT_ID     = <client id>
//        REDDIT_CLIENT_SECRET = <secret>
//      then redeploy (env var changes need a redeploy to take effect).
//   Until these are set, this endpoint returns 503 and redditDiscovery.js
//   falls back to the old anonymous proxy cascade (which may still 403 —
//   that's the whole reason this endpoint exists).
//
// Free tier: Reddit's client_credentials app-only auth is free up to 100
// queries/minute per app — comfortably enough for a personal recipe app's
// browse+import traffic. If SpiceHub ever grows into much heavier multi-user
// load, revisit Reddit's API terms (id.reddit.com/api-terms) before scaling.
// ─────────────────────────────────────────────────────────────────────────────

export const config = {
  runtime: 'edge',
};

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API_BASE = 'https://oauth.reddit.com';
const USER_AGENT = 'web:spicehub-recipe-import:v1.0 (by /u/spicehub-app)';
const TOKEN_TIMEOUT_MS = 8000;
const API_TIMEOUT_MS = 10000;

// In-memory token cache — persists across requests on a warm Edge isolate,
// gone on cold start. That's fine: a token fetch is ~150ms and well within
// Reddit's free-tier rate limit even if every cold start re-fetches one.
let cachedToken = null; // { token, expiresAt }

/**
 * Exported for testing: lets a test reset module state between cases without
 * needing to mock module re-imports.
 */
export function _resetTokenCacheForTests() {
  cachedToken = null;
}

async function getAccessToken(clientId, clientSecret) {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 30_000) {
    return cachedToken.token;
  }
  const basic = btoa(`${clientId}:${clientSecret}`);
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new Error(`token request failed: ${resp.status}`);
  }
  const data = await resp.json();
  if (!data?.access_token) throw new Error('token response missing access_token');
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  return cachedToken.token;
}

/**
 * Validates that `path` is a same-host-relative Reddit API path, never a
 * full URL — keeps this endpoint from becoming an open proxy to arbitrary
 * hosts via the Authorization header.
 */
function isValidPath(path) {
  return typeof path === 'string'
    && path.startsWith('/')
    && !path.includes('://')
    && !/[^\x20-\x7e]/.test(path); // printable ASCII only
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export default async function handler(req) {
  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const { searchParams } = new URL(req.url);
  const path = searchParams.get('path') || '';
  if (!isValidPath(path)) {
    return jsonResponse({ error: 'Invalid path' }, 400);
  }

  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return jsonResponse({ error: 'Reddit OAuth not configured (REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET missing)' }, 503);
  }

  let token;
  try {
    token = await getAccessToken(clientId, clientSecret);
  } catch (err) {
    return jsonResponse({ error: `Reddit auth failed: ${err.message}` }, 502);
  }

  try {
    const upstream = await fetch(`${API_BASE}${path}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    const text = await upstream.text();
    // A stale/revoked cached token surfaces as 401 from oauth.reddit.com —
    // drop the cache so the NEXT request fetches a fresh one instead of
    // repeating the same failure for up to an hour.
    if (upstream.status === 401) cachedToken = null;
    return new Response(text, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': upstream.status === 200 ? 'public, max-age=120, s-maxage=120' : 'no-store',
      },
    });
  } catch (err) {
    return jsonResponse({ error: err.message || 'Reddit API request failed' }, 502);
  }
}
