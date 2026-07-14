/**
 * SpiceHub — Client-side API helpers.
 *
 * FULLY CLIENT-SIDE — no backend server required.
 * All recipe extraction runs in the browser using CORS proxies.
 * Deployed on Vercel with zero backend costs.
 *
 * Strategy:
 *   1. Instagram URLs → embed page fetch via CORS proxy
 *   2. Recipe blog URLs → CORS proxy fetch → JSON-LD / microdata / CSS heuristic parse
 *   3. All URLs → OG meta tag fallback
 *   4. Social media → guide user to Paste Text tab
 */

// ── CORS proxies (cycled on failure) ──────────────────────────────────────────
// Ordered roughly by reliability. Rotation starts from last successful index.
const PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  url => `https://thingproxy.freeboard.io/fetch/${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, // returns JSON {contents} — handled below
];

/**
 * Normalize Instagram URL to canonical form for cache lookups.
 * Strips UTM params, www., trailing slashes, and normalizes /p/ vs /reel/.
 */
export function normalizeInstagramUrl(url) {
  try {
    const u = new URL(url);
    // Strip tracking params
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','igshid','igsh','hl','ref'].forEach(p => u.searchParams.delete(p));
    // Normalize hostname
    u.hostname = 'www.instagram.com';
    // Normalize path — strip trailing slash
    u.pathname = u.pathname.replace(/\/$/, '');
    return u.toString();
  } catch { return url; }
}

// Track last successful proxy index to avoid always hammering proxy[0]
let _lastGoodProxyIdx = 0;

/**
 * Fetch HTML via robust proxy cascade.
 * 
 * STRATEGY (in order):
 *  1. Internal /api/proxy Vercel serverless function — runs server-side, full browser headers,
 *     no CORS issues, not IP-blocked like public proxies. This is the PRIMARY path.
 *  2. Public CORS proxy waterfall — fallback for local dev or if Vercel fn fails.
 */
/**
 * Robustly clean a URL string.
 * - Trims whitespace
 * - Resolves doubled-concatenated URLs (common mobile paste bug)
 * - Removes trailing slashes
 */
export function cleanUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let cleaned = url.trim();

  // Mobile share sheets and manual pastes can concatenate URLs without a
  // separator. Prefer the first fully-qualified URL if one exists, otherwise
  // accept a schemeless domain and add https below.
  const urlMatch = cleaned.match(/https?:\/\/[^\s<>"']+/i);
  if (urlMatch) {
    cleaned = urlMatch[0];
  } else {
    const schemeless = cleaned.match(/(?:^|[\s<>"'])([a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>"']*)?)/i);
    if (schemeless?.[1]) cleaned = schemeless[1];
  }

  // Handle double-concatenated URLs even if the first part lacks 'http://'
  // (e.g. "instagram.com/reel/XYZhttps://www.instagram.com/reel/XYZ")
  const firstHttp = cleaned.indexOf('http');
  if (firstHttp > 0) {
    cleaned = cleaned.substring(firstHttp);
  }

  // Remove any duplicated URL suffix (common bug source: "https://site.com/https://site.com")
  const firstHttpAfterClean = cleaned.indexOf('http');
  if (firstHttpAfterClean !== -1) {
    const secondHttp = cleaned.indexOf('http', firstHttpAfterClean + 4);
    if (secondHttp !== -1) {
      cleaned = cleaned.substring(0, secondHttp);
    }
  }
  cleaned = cleaned.replace(/\/https?:\/\/.+$/, '').replace(/[)\],.;]+$/, '');

  if (/^(?:www\.)?(?:instagram\.com|tiktok\.com|youtube\.com|youtu\.be)\//i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  } else if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }

  return cleaned.replace(/\/$/, '');
}

/**
 * Fetch HTML via robust proxy cascade.
 * 
 * STRATEGY (in order):
 *  1. Internal /api/proxy Vercel serverless function — runs server-side, full browser headers,
 *     no CORS issues, not IP-blocked like public proxies. This is the PRIMARY path.
 *  2. Public CORS proxy waterfall — fallback for local dev or if Vercel fn fails.
 */
export async function fetchHtmlViaProxy(url, timeoutMs = 30000) {
  const targetUrl = cleanUrl(url);
  console.log('[fetchHtmlViaProxy] Target:', targetUrl);


  // ── 1. Internal Vercel /api/proxy (primary) ──────────────────────────────────
  // In production on Vercel, this is a same-origin call with zero CORS overhead.
  // In local dev (vite), this will 404 which is fine — we fall through to public proxies.
  try {
    const internalUrl = `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
    const ctrl = new AbortController();
    // 2026-07-14: was the full timeoutMs (up to 30s) before even trying a
    // public proxy. This is a same-origin serverless call — if it's healthy it
    // answers in well under a second; capping it short means a slow/hanging
    // instance fails fast into the public-proxy cascade instead of burning the
    // whole budget here first.
    const timer = setTimeout(() => ctrl.abort(), Math.min(timeoutMs, 10000));
    const resp = await fetch(internalUrl, { signal: ctrl.signal });
    clearTimeout(timer);

    if (resp.ok) {
      // Check what the TARGET site actually returned (proxy always returns 200,
      // but forwards the real status in X-Proxy-Status header).
      const proxyStatus = parseInt(resp.headers.get('X-Proxy-Status') || '200', 10);
      if (proxyStatus >= 400) {
        console.log(`[fetchHtmlViaProxy] Internal proxy: target returned ${proxyStatus}, falling to public proxies`);
      } else {
        const text = await resp.text();
        if (text && text.length > 1000 && !text.includes('"error"')) {
          console.log('[fetchHtmlViaProxy] ✅ Internal proxy succeeded');
          return text;
        }
      }
    }
    console.log('[fetchHtmlViaProxy] Internal proxy returned empty/error, trying public proxies...');
  } catch (e) {
    console.log('[fetchHtmlViaProxy] Internal proxy unavailable (local dev?), using public proxies');
  }

  // ── 2. Public CORS proxy waterfall (secondary / local dev fallback) ────────────
  // Ordered by observed reliability (codetabs and allorigins succeed most often).
  // corsproxy.io often returns 403 for major recipe/social sites — kept but de-prioritized.
  // proxy.cors.sh hits 429 rate limits quickly — kept as a last resort.
  //
  // 2026-07-14: thingproxy.freeboard.io and cors.bridged.cc removed. Both
  // came back net::ERR_NAME_NOT_RESOLVED in production console logs — the
  // domains themselves no longer resolve (service discontinued), not a rate
  // limit or transient failure. Keeping them in the rotation meant every
  // single import ate a guaranteed-dead DNS lookup, on top of however many
  // times this whole waterfall runs per import (embed page, oEmbed, mirror
  // fallbacks can each call fetchHtmlViaProxy separately).
  const PUBLIC_PROXIES = [
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://proxy.cors.sh/${u}`,
  ];

  // Per-proxy timeout is shorter since we try multiple. Was capped at 15s —
  // a working proxy answers in 1-4s, so 8s is still generous headroom while
  // cutting the worst-case wait for a hanging one roughly in half.
  const perProxyTimeout = Math.min(timeoutMs / 2, 8000);

  for (const makeProxy of PUBLIC_PROXIES) {
    const proxyUrl = makeProxy(targetUrl);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), perProxyTimeout);
      const resp = await fetch(proxyUrl, {
        signal: ctrl.signal,
        headers: proxyUrl.includes('proxy.cors.sh')
          ? { 'x-cors-api-key': import.meta.env.VITE_CORS_SH_KEY || '' }
          : {},
      });
      clearTimeout(timer);

         // If we get a 403 or 429, don't crash—just skip to the next proxy
    if (resp.status === 403 || resp.status === 429 || !resp.ok) {
      console.warn(`[Proxy skip] ${proxyUrl.split('/')[2]} returned ${resp.status}`);
      continue; 
    }

      let text = await resp.text();

      // Unwrap JSON-envelope proxies (allorigins /get returns {contents, status})
      if (proxyUrl.includes('allorigins.win/get')) {
        try {
          const j = JSON.parse(text);
          // allorigins also exposes the original HTTP status — skip if target was blocked
          if (j.status?.http_code && j.status.http_code >= 400) {
            console.warn(`[Proxy skip] allorigins/get: target returned ${j.status.http_code}`);
            continue;
          }
          if (j.contents) text = j.contents;
        } catch (e) { /* ignore parse error */ }
      }

      if (!text || text.length < 1000) continue;

      // Detect bot/login walls — common patterns from Cloudflare, Instagram, Allrecipes
      const blocked =
        (text.includes('cloudflare') && text.includes('checking your browser')) ||
        text.includes('is_viewer_logged_in":false') ||
        (text.includes('loginForm') && text.length < 35000) ||
        (text.includes('access denied') && text.length < 5000) ||
        (text.includes('403 Forbidden') && text.length < 5000);
      if (blocked) continue;

      console.log(`[fetchHtmlViaProxy] ✅ Public proxy succeeded: ${proxyUrl.split('/')[2]}`);
      return text;
  } catch (err) {
    console.error("Proxy request failed:", err);
    // Continue to next proxy in list
  }
}

  console.warn('[fetchHtmlViaProxy] ❌ All proxies failed for:', targetUrl);
  return null;
}

/**
 * Fetch + parse a JSON API endpoint via a small, tightly time-bounded proxy
 * cascade. Deliberately separate from fetchHtmlViaProxy(): that helper's
 * success heuristics (bot-wall regexes, a >1000-char gate, a
 * `!text.includes('"error"')` check) are tuned for scraping HTML pages and
 * can misfire on legitimate JSON — and it internally chains its own
 * internal-proxy + up to 7 public proxies, which stacked on top of a
 * caller's own retry logic produced worst-case latency in the tens of
 * seconds (observed with Reddit's discovery JSON endpoints).
 *
 * Total worst case here is bounded to roughly 3 × perAttemptTimeout, not the
 * unbounded cascade fetchHtmlViaProxy produces.
 *
 * @param {string} targetUrl - the JSON API URL to fetch (already fully formed)
 * @param {number} [timeoutMs=6000] - per-attempt timeout
 * @returns {Promise<object|Array|null>} parsed JSON, or null if every attempt failed
 */
export async function fetchJsonViaProxy(targetUrl, timeoutMs = 6000) {
  const attempts = [
    () => `/api/proxy?url=${encodeURIComponent(targetUrl)}`,
    () => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`,
    () => `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
  ];

  for (const makeUrl of attempts) {
    const proxyUrl = makeUrl();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const resp = await fetch(proxyUrl, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);
      if (!resp.ok) {
        console.log(`[fetchJsonViaProxy] ${proxyUrl.split('/')[2] || proxyUrl.split('?')[0]} returned ${resp.status}`);
        continue;
      }
      const text = await resp.text();
      if (!text) continue;
      const parsed = JSON.parse(text);
      console.log(`[fetchJsonViaProxy] ✅ succeeded via ${proxyUrl.split('/')[2] || proxyUrl.split('?')[0]}`);
      return parsed;
    } catch (err) {
      console.log(`[fetchJsonViaProxy] attempt failed (${err.message}) — trying next`);
    }
  }

  console.warn('[fetchJsonViaProxy] ❌ All attempts failed for:', targetUrl);
  return null;
}

/**
 * Proxy an image URL through CORS proxy (for displaying images that block cross-origin).
 * Returns a proxied URL string that can be used as an <img> src.
 */
export function proxyImageUrl(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith('http')) return imageUrl;
  // allorigins works well for images too
  return `https://api.allorigins.win/raw?url=${encodeURIComponent(imageUrl)}`;
}

// ── Apify Instagram scraper (server-side via Vercel proxy) ────────────────────
// Uses managed residential proxies for reliable extraction + fresh CDN image URLs.
// Returns { ok, caption, displayUrl, videoUrl, ownerUsername, ownerFullName, ... } or null.

export async function fetchInstagramViaApify(url) {
  const cleanedUrl = cleanUrl(url);
  const proxyUrl = `/api/proxy?mode=instagram-apify&url=${encodeURIComponent(cleanedUrl)}`;

  // One bounded retry on TRANSIENT failures (network throw / 5xx / timeout).
  // We do NOT retry on a successful-but-weak response — that just re-bills Apify.
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 35000); // Apify runs can take 20-30s
      const resp = await fetch(proxyUrl, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        console.log('[fetchInstagramViaApify] Failed:', resp.status, errData.error || '');
        // Retry only on server-side / transient statuses; 4xx is permanent.
        if (resp.status >= 500 && attempt === 0) {
          await new Promise(r => setTimeout(r, 800));
          continue;
        }
        return null;
      }
      const data = await resp.json();
      if (!data.ok || !data.caption) {
        console.log('[fetchInstagramViaApify] No caption in response');
        return null; // permanent — no retry
      }
      console.log(`[fetchInstagramViaApify] ✅ Got caption (${data.caption.length} chars) + image: ${data.displayUrl ? 'yes' : 'no'}${attempt ? ` (retry ${attempt})` : ''}`);
      return data;
    } catch (e) {
      console.log(`[fetchInstagramViaApify] Error${attempt ? ` (retry ${attempt})` : ''}:`, e.message);
      if (attempt === 0) { await new Promise(r => setTimeout(r, 800)); continue; }
      return null;
    }
  }
  return null;
}

// ── Instagram embed extraction (client-side, no server needed) ────────────────

function extractInstagramShortcode(url) {
  // CB-07: Added /stories/<username>/ path variant — story posts have a different
  // URL structure: /stories/{username}/{mediaId}/. We extract mediaId as shortcode.
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/) ||
              u.pathname.match(/\/stories\/[^/]+\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

export function isInstagramUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'instagram.com' || host.endsWith('.instagram.com');
  } catch { return false; }
}

/**
 * Extract recipe from Instagram embed page (client-side via CORS proxy).
 * Instagram's /embed/captioned/ endpoint is lighter and often bypasses login walls.
 * Tries both /p/ and /reel/ forms, returning the one with the longest caption.
 * Returns { ok, type, caption, title, imageUrl, sourceUrl } or null.
 */
export async function extractInstagramEmbed(url) {
  const shortcode = extractInstagramShortcode(url);
  if (!shortcode) return null;

  // Try both /p/ and /reel/ embed forms — Instagram may serve either
  const embedUrls = [
    `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
    `https://www.instagram.com/reel/${shortcode}/embed/captioned/`,
  ];

  let bestResult = null;
  let bestCaptionLength = 0;

  for (const embedUrl of embedUrls) {
    console.log(`[instagram-embed] Trying embed page: ${embedUrl}`);

    try {
      const html = await fetchHtmlViaProxy(embedUrl, 15000);
      if (!html) {
        console.log('[instagram-embed] CORS proxy returned no data for ' + embedUrl);
        continue;
      }

      // Check for actual login wall (not just pages that mention "login" in code)
      if (
        html.includes('"viewerId":null') ||
        (html.length < 4000 && html.includes('"requiresLogin":true')) ||
        (html.length < 3000 && !html.includes('EmbedCaption') && !html.includes('CaptionUsername') && !html.includes('"shortcode"'))
      ) {
        console.log('[instagram-embed] Login wall or empty embed detected for ' + embedUrl);
        continue;
      }

      // ── Extract caption ──
      let caption = '';
      const captionPatterns = [
        /<div\s+class="[^"]*Caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /<div\s+class="[^"]*EmbedCaption[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /class="[^"]*[Cc]aption[^"]*"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i,
      ];
      for (const re of captionPatterns) {
        const m = re.exec(html);
        if (m && m[1]) {
          const text = m[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
          if (text && text.length > 15) { caption = text; break; }
        }
      }

      // Method 2: JSON data in scripts — expanded patterns for all IG embed formats
      if (!caption) {
        const dataPatterns = [
          // Standard embed JSON: "caption":{"text":"..."}
          /"caption"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/,
          // Newer embed format: "node":{"...","caption":"..."}
          /"captionText"\s*:\s*"((?:[^"\\]|\\.){20,})"/,
          // edge_media_to_caption edges
          /"edges"\s*:\s*\[\s*\{[^}]*"text"\s*:\s*"((?:[^"\\]|\\.){20,})"/,
          // accessibility_caption
          /"accessibility_caption"\s*:\s*"((?:[^"\\]|\\.){20,})"/,
          // Any long "text" value in a script block (heuristic, broad)
          /"text"\s*:\s*"((?:[^"\\]|\\.){40,})"/,
        ];
        for (const re of dataPatterns) {
          const m = re.exec(html);
          if (m && m[1]) {
            try {
              const decoded = JSON.parse('"' + m[1] + '"');
              if (decoded.length > 15) { caption = decoded; break; }
            } catch {
              if (m[1].length > 15) { caption = m[1]; break; }
            }
          }
        }
      }

      // Method 2b: parse __additionalData / window.__InstagramWebSharedData JSON blobs
      if (!caption) {
        const scriptM = html.match(/window\.__additionalDataLoaded\([^,]+,(\{[\s\S]+?\})\);/) ||
                        html.match(/<script[^>]*>window\._sharedData\s*=\s*(\{[\s\S]+?\});<\/script>/);
        if (scriptM) {
          try {
            const data = JSON.parse(scriptM[1]);
            // Recursively search for a caption text field
            const findCaption = (obj, depth = 0) => {
              if (!obj || typeof obj !== 'object' || depth > 8) return '';
              if (typeof obj.text === 'string' && obj.text.length > 20) return obj.text;
              if (typeof obj.caption === 'string' && obj.caption.length > 20) return obj.caption;
              if (obj.caption?.text?.length > 20) return obj.caption.text;
              for (const val of Object.values(obj)) {
                const found = findCaption(val, depth + 1);
                if (found) return found;
              }
              return '';
            };
            const found = findCaption(data);
            if (found) caption = found;
          } catch { /* not parseable */ }
        }
      }

      // Method 3: OG description
      if (!caption) {
        const ogMatch = html.match(/<meta[^>]+property\s*=\s*["']og:description["'][^>]+content\s*=\s*["']([^"']*)["']/i)
          || html.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+property\s*=\s*["']og:description["']/i);
        if (ogMatch && ogMatch[1] && ogMatch[1].length > 15) {
          caption = ogMatch[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        }
      }

      // ── Extract image ──
      let imageUrl = '';

      // Primary: Post-specific image patterns (prefer over og:image which is often the profile pic)
      const imgPatterns = [
        /"display_url"\s*:\s*"(https:[^"]+)"/i,
        /"thumbnail_src"\s*:\s*"(https:[^"]+)"/i,
        /<img[^>]+class="[^"]*EmbedImage[^"]*"[^>]+src="([^"]+)"/i,
        /<img[^>]+src="(https:\/\/[^"]*instagram[^"]*\/[^"]*_n\.jpg[^"]*)"/i,
        /<img[^>]+src="(https:\/\/scontent[^"]+)"/i,
        /background-image:\s*url\(['"]?(https:\/\/scontent[^'")\s]+)['"]?\)/i,
      ];
      for (const re of imgPatterns) {
        const m = re.exec(html);
        if (m) {
          const candidate = m[1].replace(/&amp;/g, '&').replace(/\\u0026/g, '&');
          if (candidate.startsWith('http')) { imageUrl = candidate; break; }
        }
      }

      // Fallback: OG image
      if (!imageUrl) {
        const ogImgMatch = html.match(/<meta[^>]+property\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']*)["']/i)
          || html.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+property\s*=\s*["']og:image["']/i);
        if (ogImgMatch) imageUrl = ogImgMatch[1].replace(/&amp;/g, '&');
      }

      // ── Extract title ──
      let title = '';
      const ogTitleMatch = html.match(/<meta[^>]+property\s*=\s*["']og:title["'][^>]+content\s*=\s*["']([^"']*)["']/i)
        || html.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+property\s*=\s*["']og:title["']/i);
      if (ogTitleMatch) {
        title = ogTitleMatch[1]
          .replace(/\s*on\s+Instagram\s*$/i, '')
          .replace(/\s*\(@[\w.]+\)\s*$/i, '')
          .replace(/#\w[\w.]*/g, '')
          .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
          .trim();
      }

      // Even with no caption, extract raw visible text from the embed page for Gemini fallback
      let rawPageText = '';
      if (!caption) {
        // Strip all script/style/meta tags, collapse whitespace
        rawPageText = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<!--[\s\S]*?-->/g, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 3000); // cap for Gemini
      }

      if (!caption && !title && !rawPageText) {
        console.log('[instagram-embed] No content found in ' + embedUrl);
        continue;
      }

      // Keep result if caption is longer than previous best
      const effectiveLength = caption.length || (rawPageText.length > 200 ? rawPageText.length * 0.1 : 0);
      if (effectiveLength > bestCaptionLength || (!bestResult && (caption || rawPageText))) {
        bestCaptionLength = effectiveLength;
        bestResult = {
          ok: true,
          type: 'caption',
          caption: caption || '',
          rawPageText: caption ? '' : rawPageText, // only used when caption is empty
          title: title || '',
          imageUrl,
          sourceUrl: url,
        };
        console.log(`[instagram-embed] Found in ${embedUrl} — caption: ${caption.length} chars, rawText: ${rawPageText.length} chars, image: ${imageUrl ? 'yes' : 'no'}`);
      }
    } catch (e) {
      console.log(`[instagram-embed] Error from ${embedUrl}: ${e.message}`);
      continue;
    }
  }

  if (bestResult) {
    return bestResult;
  }

  console.log('[instagram-embed] No usable caption found from any URL variant');
  return null;
}

// ── Instagram CDN image download → base64 data URL ───────────────────────────
// Instagram/Meta CDN URLs (scontent.cdninstagram.com, fbcdn.net, etc.) expire
// after hours and block hotlinking via Referer checks. The fix: download at
// import time and store as a self-contained data URL in Dexie.

const INSTAGRAM_CDN_RE = /\.(cdninstagram\.com|fbcdn\.net|fbsbx\.com|fna\.fbcdn\.net)/i;

export function isInstagramCdnUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try { return INSTAGRAM_CDN_RE.test(new URL(url).hostname); } catch { return false; }
}

// ── Generic retry-with-backoff wrapper ───────────────────────────────────────
// Used for flaky endpoints (Gemini API, extract-video, image CDNs).
// Always resolves — on total failure returns { ok: false, error } rather than throwing.

/**
 * Sleep helper (cancellable via AbortSignal).
 */
function _sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
    }
  });
}

/**
 * Fetch with exponential backoff retry. Never throws — returns the Response or null.
 *
 * @param {string|Request} input — URL or Request
 * @param {RequestInit} [init] — fetch init
 * @param {object} [opts]
 * @param {number} [opts.retries=2] — retry attempts after the first try (so total = retries+1)
 * @param {number} [opts.timeoutMs=12000] — per-attempt timeout
 * @param {number} [opts.backoffMs=600] — initial backoff; doubles each attempt (+/- jitter)
 * @param {(status:number)=>boolean} [opts.shouldRetryStatus] — return true to retry on non-2xx
 * @returns {Promise<Response|null>}
 */
export async function fetchWithRetry(input, init = {}, opts = {}) {
  const {
    retries = 2,
    timeoutMs = 12000,
    backoffMs = 600,
    shouldRetryStatus = (s) => s === 429 || s >= 500,
  } = opts;

  let attempt = 0;
  const total = retries + 1;
  let lastErr = null;

  while (attempt < total) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    // Honor caller-supplied signal
    if (init.signal) {
      if (init.signal.aborted) { clearTimeout(timer); return null; }
      init.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    }

    try {
      const resp = await fetch(input, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      if (resp.ok) return resp;
      if (!shouldRetryStatus(resp.status) || attempt === total - 1) return resp;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      // AbortError with no pending retries — bail
      if (err?.name === 'AbortError' && attempt === total - 1) break;
    }

    // Exponential backoff with ±25% jitter
    const base = backoffMs * Math.pow(2, attempt);
    const jitter = base * (0.75 + Math.random() * 0.5);
    try { await _sleep(Math.round(jitter)); } catch { /* aborted */ }
    attempt++;
  }

  if (lastErr) console.log(`[SpiceHub] fetchWithRetry gave up: ${lastErr.message}`);
  return null;
}

/**
 * Convert a fetched Blob → base64 data URL. Validates image MIME and size.
 * Returns null on any failure (caller decides fallback strategy).
 */
async function _blobToValidatedDataUrl(resp, { maxBytes = 2 * 1024 * 1024, minBytes = 100 } = {}) {
  if (!resp || !resp.ok) return null;
  let blob;
  try { blob = await resp.blob(); } catch { return null; }
  if (!blob || blob.size < minBytes || blob.size > maxBytes) return null;
  // Some proxies strip MIME — sniff magic bytes as backup
  if (!blob.type.startsWith('image/')) {
    try {
      const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
      const isJpeg = head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF;
      const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47;
      const isWebp = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
                     head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
      const isGif = head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46;
      if (!(isJpeg || isPng || isWebp || isGif)) return null;
    } catch { return null; }
  }
  try {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

/**
 * Generic image downloader — works for any host. Tries direct fetch first
 * (cheapest, may succeed for CORS-friendly hosts), then falls back through the
 * proxy cascade. Returns a base64 data URL on success, or `null` on failure.
 *
 * Use this for ephemeral CDN URLs that may 403/expire (Instagram, TikTok, FB, Pinterest).
 * For already-persistent images (recipe blog hero images, data URLs) prefer
 * leaving the URL alone — browsers will cache them normally.
 *
 * @param {string} imageUrl
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=9000]
 * @param {number} [opts.maxBytes=2*1024*1024]
 * @returns {Promise<string|null>} data URL or null
 */
export async function downloadImageAsDataUrl(imageUrl, opts = {}) {
  if (!imageUrl || typeof imageUrl !== 'string') return null;
  const { timeoutMs = 9000, maxBytes = 2 * 1024 * 1024 } = opts;
  const cleanedImageUrl = cleanUrl(imageUrl);

  // Skip direct fetch for Instagram/Meta CDN URLs — they require server-side headers
  // and will 403 in browser context anyway. Go straight to the internal proxy.
  if (!isInstagramCdnUrl(cleanedImageUrl)) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs / 2);
      const resp = await fetch(cleanedImageUrl, {
        signal: ctrl.signal,
        headers: { 'Accept': 'image/*' },
      });
      clearTimeout(timer);
      const dataUrl = await _blobToValidatedDataUrl(resp, { maxBytes });
      if (dataUrl) return dataUrl;
    } catch { /* fall through to proxy */ }
  }

  // Same-origin serverless image fetcher can read CDN bytes without browser CORS.
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(`/api/proxy?mode=image-data-url&url=${encodeURIComponent(cleanedImageUrl)}`, {
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (resp.ok) {
      const data = await resp.json();
      if (typeof data?.dataUrl === 'string' && data.dataUrl.startsWith('data:image/')) return data.dataUrl;
    }
  } catch { /* fall through to public proxies */ }

  // Fallback through proxy cascade
  const html = await fetchHtmlViaProxy(cleanedImageUrl, timeoutMs);
  if (html && html.startsWith('data:')) return html; // already a data URL

  // Last resort: try via allorigins which might return image data
  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(cleanedImageUrl)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs / 2);
    const resp = await fetch(proxyUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    return await _blobToValidatedDataUrl(resp, { maxBytes });
  } catch { return null; }
}

// ── Import reliability: oEmbed + TikTok fetchers ──────────────────────────────

/**
 * Fetch Instagram oEmbed data via the Vercel proxy (uses FB_APP_TOKEN server-side).
 * Returns { html, thumbnail_url, author_name } or null on failure/not-configured.
 */
export async function fetchInstagramOEmbed(url) {
  try {
    const cleanedUrl = cleanUrl(url);
    const proxyUrl = `/api/proxy?mode=instagram-oembed&url=${encodeURIComponent(cleanedUrl)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const resp = await fetch(proxyUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.error) {
      console.log('[fetchInstagramOEmbed] Not configured or error:', data.error);
      return null;
    }
    return data; // { html, thumbnail_url, author_name }
  } catch (e) {
    console.log('[fetchInstagramOEmbed] Failed:', e.message);
    return null;
  }
}

/**
 * Fetch Instagram post JSON via the ?__a=1 endpoint (server-side via proxy).
 * Returns caption string or null. Works ~60% of the time.
 * @param {string} shortcode - Instagram post shortcode (e.g. 'ABC123xyz')
 */
export async function fetchInstagramJson(shortcode) {
  try {
    const proxyUrl = `/api/proxy?mode=instagram-json&shortcode=${encodeURIComponent(shortcode)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const resp = await fetch(proxyUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const text = await resp.text();
    if (!text || text.length < 10) return null;

    try {
      return parseInstagramMediaJson(text)?.caption || null;
    } catch {
      return null;
    }
  } catch (e) {
    console.log('[fetchInstagramJson] Failed:', e.message);
    return null;
  }
}

function parseInstagramMediaJson(text) {
  const data = JSON.parse(text);
  const media =
    data?.graphql?.shortcode_media ||
    data?.items?.[0] ||
    data?.data?.shortcode_media ||
    null;
  if (!media) return null;

  const captionEdges = media?.edge_media_to_caption?.edges;
  const captionFromEdges = Array.isArray(captionEdges) && captionEdges.length > 0
    ? captionEdges[0]?.node?.text
    : null;
  const caption = captionFromEdges || media?.caption?.text || media?.caption || '';

  const candidateUrls = [
    media.display_url,
    media.thumbnail_src,
    media.image_versions2?.candidates?.[0]?.url,
    media.carousel_media?.[0]?.image_versions2?.candidates?.[0]?.url,
    media.carousel_media?.[0]?.display_url,
    media.video_versions?.[0]?.url,
  ].filter(Boolean);

  const imageUrl = candidateUrls.find((url) =>
    typeof url === 'string' &&
    /scontent|fbcdn|cdninstagram|instagram/i.test(url) &&
    !/profile_pic|avatar|accounts\/avatars|150x150|s150x150/.test(url)
  ) || '';

  return {
    caption: typeof caption === 'string' ? caption : '',
    imageUrl: imageUrl.replace(/\\u0026/g, '&').replace(/&amp;/g, '&'),
    title: media.title || media.owner?.username || '',
  };
}

export async function fetchInstagramJsonDetails(shortcode) {
  try {
    const proxyUrl = `/api/proxy?mode=instagram-json&shortcode=${encodeURIComponent(shortcode)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const resp = await fetch(proxyUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const text = await resp.text();
    if (!text || text.length < 10) return null;
    return parseInstagramMediaJson(text);
  } catch (e) {
    console.log('[fetchInstagramJsonDetails] Failed:', e.message);
    return null;
  }
}
