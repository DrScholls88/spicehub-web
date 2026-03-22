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
const PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

/**
 * Fetch HTML from any URL via CORS proxy cascade.
 * Tries each proxy in order; returns HTML string or null.
 */
export async function fetchHtmlViaProxy(url, timeoutMs = 15000) {
  for (const makeProxy of PROXIES) {
    const proxyUrl = makeProxy(url);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const resp = await fetch(proxyUrl, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) continue;
      const text = await resp.text();
      // Detect Instagram login wall
      if (text.includes('Log in') && text.includes('instagram') && text.length < 20000) {
        continue;
      }
      if (text.length < 500) continue; // Error page
      return text;
    } catch { /* try next proxy */ }
  }
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

// ── Instagram embed extraction (client-side, no server needed) ────────────────

function extractInstagramShortcode(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
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
 * Returns { ok, type, caption, title, imageUrl, sourceUrl } or null.
 */
export async function extractInstagramEmbed(url) {
  const shortcode = extractInstagramShortcode(url);
  if (!shortcode) return null;

  const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
  console.log(`[instagram-embed] Trying embed page: ${embedUrl}`);

  try {
    const html = await fetchHtmlViaProxy(embedUrl, 15000);
    if (!html) {
      console.log('[instagram-embed] CORS proxy returned no data');
      return null;
    }

    // Check for login wall
    if (html.length < 5000 && (html.includes('Log in') || html.includes('login'))) {
      console.log('[instagram-embed] Login wall detected');
      return null;
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

    // Method 2: JSON data in scripts
    if (!caption) {
      const dataPatterns = [
        /"caption"\s*:\s*\{\s*"text"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/,
        /"text"\s*:\s*"([^"]{20,}(?:\\.[^"]*)*)"/,
      ];
      for (const re of dataPatterns) {
        const m = re.exec(html);
        if (m && m[1]) {
          try {
            caption = JSON.parse('"' + m[1] + '"');
            if (caption.length > 15) break;
            caption = '';
          } catch { caption = m[1]; if (caption.length > 15) break; caption = ''; }
        }
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
    // OG image
    const ogImgMatch = html.match(/<meta[^>]+property\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']*)["']/i)
      || html.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+property\s*=\s*["']og:image["']/i);
    if (ogImgMatch) imageUrl = ogImgMatch[1].replace(/&amp;/g, '&');

    // Fallback image patterns
    if (!imageUrl) {
      const imgPatterns = [
        /<img[^>]+class="[^"]*EmbedImage[^"]*"[^>]+src="([^"]+)"/i,
        /<img[^>]+src="(https:\/\/[^"]*instagram[^"]*\/[^"]*_n\.jpg[^"]*)"/i,
        /<img[^>]+src="(https:\/\/scontent[^"]+)"/i,
        /"display_url"\s*:\s*"(https:[^"]+)"/i,
        /"thumbnail_src"\s*:\s*"(https:[^"]+)"/i,
        /background-image:\s*url\(['"]?(https:\/\/scontent[^'")\s]+)['"]?\)/i,
      ];
      for (const re of imgPatterns) {
        const m = re.exec(html);
        if (m) {
          const candidate = m[1].replace(/&amp;/g, '&').replace(/\\u0026/g, '&');
          if (candidate.startsWith('http')) { imageUrl = candidate; break; }
        }
      }
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

    if (!caption && !title) {
      console.log('[instagram-embed] No caption or title found');
      return null;
    }

    console.log(`[instagram-embed] Success — caption: ${caption.length} chars, image: ${imageUrl ? 'yes' : 'no'}`);

    return {
      ok: true,
      type: 'caption',
      caption,
      title: title || '',
      imageUrl,
      sourceUrl: url,
    };
  } catch (e) {
    console.log(`[instagram-embed] Error: ${e.message}`);
    return null;
  }
}

// ── Legacy exports (kept for backward compat, now no-ops or thin wrappers) ──

/** @deprecated Server no longer required. Returns false always. */
export async function isServerAvailable() { return false; }

/** @deprecated No-op. */
export function resetServerAvailabilityCache() {}

/** @deprecated Server extraction replaced by client-side. Returns unavailable. */
export async function extractUrl(/* url */) {
  return { ok: false, reason: 'server-unavailable' };
}
