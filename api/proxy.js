/**
 * Vercel Serverless Function — /api/proxy
 *
 * Acts as a server-side HTML fetcher so the client avoids CORS + IP-block issues.
 * Deployed on Vercel's edge, this function has a fresh non-datacenter IP per region
 * and can bypass the blocks that stop public CORS proxy services.
 *
 * Usage: GET /api/proxy?url=https://www.allrecipes.com/recipe/...
 */

export const config = {
  runtime: 'edge', // Use Edge Runtime — fast, cheap, no cold starts
};

// Sites known to require special handling
const INSTAGRAM_HOST = /instagram\.com/i;
const REDDIT_HOST = /(^|\.)reddit\.com$/i;

// HTML size cap (harden-ideas-audit-2026-08-06.md §3) — api/extract.js already
// caps its own fetch at MAX_HTML_BYTES=2_500_000; this generic passthrough
// (used by blogLinkFollower.js's fetchHtmlViaProxy for every blog/short-link/
// bio-hub fetch) had no cap at all, so a large page would be read into memory
// in full before any parsing happened. 2MB is comfortably past any real
// recipe blog page while still bounding worst-case memory per request.
const MAX_HTML_CHARS = 2_000_000;

/**
 * SSRF guard. Edge Runtime has no `dns`/`net` modules, so this can't re-resolve
 * a hostname and check the live IP the way the Node-based server/index.js does
 * (see assertPublicHost there) — that means DNS-rebinding (a hostname that
 * resolves to a public IP at check time but a private one at fetch time) is not
 * fully closed here. What this DOES close: literal private/loopback/link-local
 * hosts, and the decimal/octal/hex IP-literal tricks that a plain string-prefix
 * check misses (e.g. `2130706433` == 127.0.0.1, `0x7f000001`, `017700000001`).
 */
function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.local')) return true;
  // Decimal / octal / hex encodings of an IP (bypass naive dotted-quad checks).
  if (/^0x[0-9a-f]+$/i.test(h) || /^\d+$/.test(h) || /^0[0-7]+(\.[0-7]+)*$/.test(h)) return true;
  // IPv6 loopback / link-local / unique-local / IPv4-mapped-private forms.
  if (
    h === '::1' || h === '[::1]' ||
    h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd') ||
    h.includes('::ffff:127.') || h.includes('::ffff:10.') || h.includes('::ffff:169.254.')
  ) return true;
  // IPv4 dotted-quad private/reserved ranges (correctly bounded 172.16-172.31,
  // unlike a startsWith('172.2') chain which also matches public 172.2.x.x).
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (
      a === 127 || a === 10 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    ) return true;
  }
  return false;
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
];

// 2026-08-09: root-caused the "most drink imports fail" report — for a growing
// share of posts (confirmed live: sponsored/paid-partnership posts, likely
// others) apify/instagram-post-scraper returns error:"restricted_page" and
// omits the `caption` field entirely, BUT still includes a fully usable
// `description` field in Instagram's standard oEmbed-style wrapper:
//   '<N> likes, <N> comments - <user> on <date>: "<actual caption>". '
// Every caller downstream (fetchInstagramViaApify → validateApifyPayload →
// acquireInstagramPack) only ever looked at `caption`, so a restricted-page
// response with a perfectly good recipe caption sitting in `description` was
// silently discarded as "no caption in response", forcing the whole import
// through the much less reliable embed/proxy-chain fallback (which is what
// was actually failing in production for these posts).
export function extractCaptionFromApifyDescription(description = '') {
  const s = String(description || '').trim();
  if (!s) return '';
  // '... - user on date: "caption text". ' — capture between the last
  // `: "` and the final `".` so captions containing internal quotes don't
  // truncate early.
  const m = /:\s*"([\s\S]*)"\.\s*$/.exec(s);
  if (m && m[1] && m[1].trim().length > 10) return m[1].trim();
  // Unrecognized wrapper shape — the raw description is still better than
  // nothing (Gemini's DRINK_RECONCILIATION/structuring prompt can work with
  // loosely-formatted text same as any other caption source).
  return s.length > 10 ? s : '';
}

function cleanUrl(input = '') {
  if (typeof input !== 'string') return '';
  let url = input.trim();
  const qualified = url.match(/https?:\/\/[^\s<>"']+/i);
  if (qualified) url = qualified[0];
  else {
    const schemeless = url.match(/(?:^|[\s<>"'])([a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>"']*)?)/i);
    if (schemeless?.[1]) url = `https://${schemeless[1]}`;
  }
  return url.replace(/\/https?:\/\/.+$/i, '').replace(/[)\],.;]+$/, '').replace(/\/$/, '');
}

/**
 * Build realistic browser-like headers for a given URL.
 * This is critical — Allrecipes, NYTimes, etc. reject requests with bot-like headers.
 */
function buildHeaders(targetUrl) {
  const isInsta = INSTAGRAM_HOST.test(targetUrl);
  const isRedditJson = REDDIT_HOST.test(new URL(targetUrl).hostname || '') && /\.json(\?|$)/.test(targetUrl);
  // Rotate UA every ~15 minutes to break bot-wall fingerprinting
  const ua = USER_AGENTS[Math.floor(Date.now() / 900000) % USER_AGENTS.length];

  const base = {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'DNT': '1',
  };

  if (isInsta) {
    base['Referer'] = 'https://www.instagram.com/';
    base['sec-ch-ua'] = '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
    base['sec-ch-ua-mobile'] = '?0';
    base['sec-ch-ua-platform'] = '"Windows"';
  }

  if (isRedditJson) {
    // A .json API endpoint being requested with an HTML-page Accept header
    // (and page-navigation Sec-Fetch-* hints) is itself an inconsistent
    // fingerprint. Send a plain, honest JSON-fetch header set instead — this
    // doesn't guarantee Reddit won't still block known cloud-provider IP
    // ranges (that's IP-based, not header-based, and no header change can
    // fix it), but an inconsistent Accept/Sec-Fetch combo is one more signal
    // bot detection can key on for free, so there's no reason to send it.
    base['Accept'] = 'application/json, text/plain, */*';
    base['Sec-Fetch-Dest'] = 'empty';
    base['Sec-Fetch-Mode'] = 'cors';
    delete base['Upgrade-Insecure-Requests'];
    delete base['Sec-Fetch-User'];
  }

  return base;
}

export default async function handler(req) {
  // Only allow GET
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const { searchParams } = new URL(req.url);

  // -- Mode routing: special server-side API calls --------------------------
  const mode = searchParams.get('mode');

  if (mode === 'instagram-oembed') {
    const igUrl = cleanUrl(searchParams.get('url') || '');
    if (!igUrl || (!igUrl.startsWith('https://www.instagram.com/') && !igUrl.startsWith('https://instagram.com/'))) {
      return new Response(JSON.stringify({ error: 'Invalid Instagram URL' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    const token = process.env.FB_APP_TOKEN || null;
    if (!token) {
      return new Response(JSON.stringify({ error: 'oEmbed not configured' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    try {
      const oEmbedUrl = `https://graph.facebook.com/v18.0/instagram_oembed?url=${encodeURIComponent(igUrl)}&fields=html,thumbnail_url,author_name&access_token=${token}`;
      const resp = await fetch(oEmbedUrl);
      const json = await resp.text();
      return new Response(json, {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    } catch {
      return new Response(JSON.stringify({ error: 'oEmbed fetch failed' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  if (mode === 'image-data-url') {
    const imageUrl = cleanUrl(searchParams.get('url') || '');
    let parsed;
    try {
      parsed = new URL(imageUrl);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid image URL' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return new Response(JSON.stringify({ error: 'Only http/https URLs are allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    if (isBlockedHost(parsed.hostname)) {
      return new Response(JSON.stringify({ error: 'Private addresses not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    try {
      const resp = await fetch(parsed.href, {
        headers: {
          ...buildHeaders(parsed.href),
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
      });
      if (!resp.ok) {
        return new Response(JSON.stringify({ error: 'Image fetch failed', status: resp.status }), {
          status: resp.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      const contentType = resp.headers.get('content-type') || 'image/jpeg';
      const bytes = await resp.arrayBuffer();
      if (bytes.byteLength < 100 || bytes.byteLength > 3 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: 'Image size rejected' }), {
          status: 422,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      const binary = Array.from(new Uint8Array(bytes), (b) => String.fromCharCode(b)).join('');
      const dataUrl = `data:${contentType.split(';')[0]};base64,${btoa(binary)}`;
      return new Response(JSON.stringify({ dataUrl }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  if (mode === 'instagram-json') {
    const shortcode = searchParams.get('shortcode');
    if (!shortcode || !/^[A-Za-z0-9_-]+$/.test(shortcode)) {
      return new Response(JSON.stringify({ error: 'Invalid shortcode' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    try {
      const jsonUrl = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;
      const resp = await fetch(jsonUrl, { headers: buildHeaders(jsonUrl) });
      const text = await resp.text();
      return new Response(text, {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  if (mode === 'instagram-apify') {
    const igUrl = cleanUrl(searchParams.get('url') || '');
    if (!igUrl) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    const apifyToken = process.env.APIFY_TOKEN || null;
    if (!apifyToken) {
      return new Response(JSON.stringify({ error: 'Apify not configured' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    try {
      // Use Apify's synchronous run endpoint — starts the actor and waits for results
      const actorId = 'apify~instagram-post-scraper';
      // Pin actor version when APIFY_ACTOR_VERSION is set (harden-ideas §2)
      const actorVersion = process.env.APIFY_ACTOR_VERSION || '';
      const versionParam = actorVersion ? `&build=${encodeURIComponent(actorVersion)}` : '';
      const apiUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apifyToken}&timeout=25${versionParam}`;
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: [igUrl],
          resultsLimit: 1,
          dataDetailLevel: 'basicData',
        }),
      });
      if (!resp.ok) {
        return new Response(JSON.stringify({ error: `Apify returned ${resp.status}` }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      const items = await resp.json();
      if (!Array.isArray(items) || items.length === 0) {
        return new Response(JSON.stringify({ error: 'No data returned from Apify' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      const post = items[0];
      // Carousel support (import unification step 4): Sidecar images + child posts.
      const carousel = [
        ...(Array.isArray(post.images) ? post.images : []),
        ...(Array.isArray(post.childPosts)
          ? post.childPosts.map((c) => c?.displayUrl || c?.imageUrl || '').filter(Boolean)
          : []),
      ].filter((u, i, a) => u && a.indexOf(u) === i).slice(0, 6);
      // Return a normalized subset — keep payload small
      // latestComments + ownerUsername feed the blog link follower's
      // comment/bio discovery surface (Phase 0.5B hypercharge).
      const latestComments = Array.isArray(post.latestComments)
        ? post.latestComments.slice(0, 5).map((c) => c?.text || c?.body || (typeof c === 'string' ? c : '')).filter(Boolean)
        : [];
      // Defensive bio/external-URL extraction (harden-ideas-audit-2026-08-06.md
      // §2). apify~instagram-post-scraper is a POST scraper, not a profile
      // scraper — dataDetailLevel='basicData' items are not guaranteed to carry
      // the owner's bio link at all. This checks every field name Apify's
      // post-scraper output has been observed to expose it under, so if the
      // actor DOES already return it somewhere, it's captured for free. If none
      // are present, profileBioUrl stays '' exactly as it did before this
      // change (no regression). Closing this gap for real — guaranteed, not
      // best-effort — would need either a `dataDetailLevel` upgrade (cost/
      // latency hit on every call, not just failures) or a separate Apify
      // profile-scraper actor call; that tradeoff needs a live-API check
      // against the actual response shape before committing to it, so it's
      // deliberately not done here.
      const profileBioUrl = post.ownerExternalUrl || post.externalUrl || post.bioLink
        || post.owner?.externalUrl || post.owner?.bioLink || '';
      // restricted_page (and any other error-flagged) responses drop `caption`,
      // `displayUrl`, and the top-level owner fields — fall back to `description`
      // (see extractCaptionFromApifyDescription above) and the nested `user`
      // object so a partial/restricted fetch still yields a usable result
      // instead of silently looking like "no data".
      const caption = post.caption || extractCaptionFromApifyDescription(post.description) || '';
      const result = {
        ok: true,
        caption,
        displayUrl: post.displayUrl || post.image || '',
        images: carousel,
        videoUrl: post.videoUrl || '',
        ownerUsername: post.ownerUsername || post.user?.username || '',
        ownerFullName: post.ownerFullName || post.user?.full_name || post.user?.username || '',
        profileBioUrl,
        shortCode: post.shortCode || '',
        hashtags: post.hashtags || [],
        timestamp: post.timestamp || '',
        type: post.type || 'Unknown',
        latestComments,
        isVideo: post.type === 'Video' || !!post.videoUrl,
        // Diagnostic only — not consumed by validateApifyPayload/client code,
        // but useful in logs/telemetry to see how often this path is hit.
        restricted: !!post.error,
      };
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message || 'Apify request failed' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  if (mode === 'tiktok-oembed') {
    const ttUrl = searchParams.get('url');
    if (!ttUrl) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    if (!ttUrl.startsWith('https://www.tiktok.com/')) {
      return new Response(JSON.stringify({ error: 'Invalid TikTok URL' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    try {
      const oEmbedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(ttUrl)}`;
      const resp = await fetch(oEmbedUrl, {
        headers: { 'User-Agent': USER_AGENTS[Math.floor(Date.now() / 900000) % USER_AGENTS.length], 'Accept': 'application/json' },
      });
      const json = await resp.text();
      return new Response(json, {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  }
  // -- End mode routing -----------------------------------------------------

  const targetUrl = cleanUrl(searchParams.get('url') || '');

  // Validate URL
  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Security: Only allow http/https
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return new Response(JSON.stringify({ error: 'Only http/https URLs are allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Block SSRF — see isBlockedHost() above for what this does/doesn't cover.
  if (isBlockedHost(parsedUrl.hostname)) {
    return new Response(JSON.stringify({ error: 'Private addresses not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: buildHeaders(targetUrl),
      redirect: 'follow',
    });

    const contentType = response.headers.get('content-type') || 'text/html';
    const rawHtml = await response.text();
    const html = rawHtml.length > MAX_HTML_CHARS ? rawHtml.slice(0, MAX_HTML_CHARS) : rawHtml;

    // Pass through the target's actual HTTP status so the client can distinguish
    // a successful fetch (2xx) from a bot-wall/auth block (403, 429, etc.).
    // CORS headers are always included so the browser can read non-2xx bodies.
    const targetStatus = response.status;
    return new Response(html, {
      status: targetStatus,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'X-Proxy-Status': String(targetStatus),
        'X-Proxy-Url': targetUrl,
        'Cache-Control': targetStatus === 200
          ? 'public, max-age=300, s-maxage=300'
          : 'no-store',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Fetch failed', message: err.message }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}
