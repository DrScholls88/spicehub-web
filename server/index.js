/**
 * SpiceHub Recipe Extraction Server
 *
 * Two modes:
 *   LOCAL  — uses puppeteer-core + system Chrome (default for local dev)
 *   CLOUD  — uses full puppeteer with bundled Chromium (for Render / Railway)
 *
 * Environment variables:
 *   PORT               — server port (default 3001)
 *   SPICEHUB_MODE      — 'cloud' to use bundled Chromium (default: 'local')
 *   ALLOWED_ORIGINS    — comma-separated origins for CORS (default: allow all)
 *
 * Start locally:  node index.js
 * Start on cloud: SPICEHUB_MODE=cloud node index.js
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import os from 'os';
import fs from 'fs';

const IS_CLOUD = process.env.SPICEHUB_MODE === 'cloud';

// Dynamic import: puppeteer (bundled Chromium) or puppeteer-core (local Chrome)
let puppeteer;
if (IS_CLOUD) {
  puppeteer = (await import('puppeteer')).default;
} else {
  // Local dev — try puppeteer-core first, fall back to puppeteer
  try {
    puppeteer = (await import('puppeteer-core')).default;
  } catch {
    puppeteer = (await import('puppeteer')).default;
  }
}

const app = express();

// CORS: allow configured origins, or all origins for local dev
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : null; // null = allow all

app.use(cors({
  origin: allowedOrigins ? (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error('CORS not allowed'));
  } : true,
}));
app.use(express.json());

// ── Find Chrome ────────────────────────────────────────────────────────────────
function findChrome() {
  const home = os.homedir();
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* skip */ }
  }
  return null;
}

const PROFILE_DIR = IS_CLOUD ? '/tmp/.spicehub-chrome-profile' : path.join(os.homedir(), '.spicehub-chrome-profile');

// ── Launch options — cloud vs local ──────────────────────────────────────────
function getLaunchOptions(headless = true) {
  if (IS_CLOUD) {
    return {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
      ],
    };
  }
  const chromePath = findChrome();
  if (!chromePath) throw new Error('Chrome not found on this machine');
  return {
    executablePath: chromePath,
    headless: headless ? 'new' : false,
    userDataDir: PROFILE_DIR,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-gpu',
      '--window-size=1280,900',
    ],
  };
}

// ── Active browser state ───────────────────────────────────────────────────────
let activeBrowser = null;
let activePage = null;
let activeUrl = null;
let _pendingExtraction = null;  // Data injected button POSTs back to us

async function ensureBrowserClosed() {
  if (activeBrowser) {
    try { await activeBrowser.close(); } catch { /* ignore */ }
    activeBrowser = null;
    activePage = null;
    activeUrl = null;
  }
}

// ── Strip Instagram / TikTok social metadata prefix from OG descriptions ─────
// e.g. "13K likes, 213 comments - username on December 10, 2025: "actual content""
function stripSocialMetaPrefix(text) {
  if (!text) return text;
  // Pattern: "123 likes, 456 comments - username on Month DD, YYYY: "content""
  // Also handles variations without quotes, different date formats, etc.
  let cleaned = text
    .replace(/^[\d.]+[KkMm]?\s*likes?,\s*[\d.]+[KkMm]?\s*comments?\s*-\s*\S+\s+on\s+[^:]+:\s*[""]?/i, '')
    .replace(/[""]$/, '');
  // Fallback: if it still starts with "N likes" or "N comments"
  cleaned = cleaned.replace(/^[\d.]+[KkMm]?\s*(likes?|comments?|views?)\s*[,·•\-]+\s*/gi, '');
  return cleaned.trim() || text;
}

// ── JS to inject: floating "Download Recipe" button ───────────────────────────
// This runs inside Chrome/Instagram — just like Paprika's Download button overlay.
// Uses window.spicehubDownload() (exposed via page.exposeFunction) instead of
// fetch() to bypass Instagram's Content Security Policy.
const INJECT_DOWNLOAD_BUTTON = `
(function() {
  document.getElementById('spicehub-dl-btn')?.remove();

  const btn = document.createElement('button');
  btn.id = 'spicehub-dl-btn';
  btn.innerHTML = '⬇&nbsp; Download Recipe';
  btn.style.cssText = [
    'position:fixed !important',
    'bottom:24px !important',
    'right:24px !important',
    'z-index:2147483647 !important',
    'background:linear-gradient(135deg,#2e7d32,#43a047) !important',
    'color:#fff !important',
    'border:none !important',
    'border-radius:14px !important',
    'padding:14px 26px !important',
    'font-size:16px !important',
    'font-weight:700 !important',
    'cursor:pointer !important',
    'box-shadow:0 6px 24px rgba(0,0,0,0.45) !important',
    'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif !important',
    'letter-spacing:0.3px !important',
    'transition:opacity 0.2s !important',
  ].join(';');

  btn.onmouseenter = () => { btn.style.opacity = '0.88'; };
  btn.onmouseleave = () => { btn.style.opacity = '1'; };

  btn.onclick = async () => {
    btn.innerHTML = '⏳&nbsp; Extracting…';
    btn.style.opacity = '0.75';
    btn.disabled = true;

    try {
      // ── 1. JSON-LD (recipe blogs) ────────────────────────────────────────────
      function tryRecipe(obj) {
        if (!obj || typeof obj !== 'object') return null;
        if (Array.isArray(obj)) { for (const x of obj) { const r = tryRecipe(x); if (r) return r; } return null; }
        const t = [].concat(obj['@type'] || []).join(' ').toLowerCase();
        if (t.includes('recipe')) return obj;
        if (obj['@graph']) return tryRecipe(obj['@graph']);
        return null;
      }
      let result = null;
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try { const r = tryRecipe(JSON.parse(s.textContent)); if (r?.name) { result = {type:'jsonld', recipe:r}; break; } } catch {}
      }

      // ── 2. Caption selectors (Instagram / TikTok) ────────────────────────────
      if (!result) {
        const sels = [
          '._a9zs span', '._a9zs',
          'article h1', 'article div[dir="auto"]',
          'div[role="textbox"] span', 'div[role="textbox"]',
          '[data-bloks-name="igc.components.Text"]',
          '[data-e2e="video-desc"]', '[data-e2e="video-desc-container"]',
          '.video-meta-title',
          '[data-testid="tweetText"]',
          '#description-inner',
        ];
        for (const sel of sels) {
          const el = document.querySelector(sel);
          const text = el?.innerText?.trim();
          if (text && text.length > 20) { result = {type:'caption', caption:text, selector:sel}; break; }
        }
      }

      // ── 3. OG meta fallback ──────────────────────────────────────────────────
      if (!result) {
        const og = document.querySelector('meta[property="og:description"]')?.content?.trim();
        if (og && og.length > 20) result = {type:'caption', caption:og};
      }

      // ── 4. Grab post image (OG image, then visible post images) ───────────
      let imageUrl = '';
      // OG image is usually the best quality thumbnail
      const ogImg = document.querySelector('meta[property="og:image"]')?.content?.trim();
      if (ogImg) {
        imageUrl = ogImg;
      } else {
        // Instagram: look for the main post image in the article
        const imgSels = [
          'article img[srcset]',            // IG post photos
          'article img[src*="instagram"]',   // IG CDN images
          'article video[poster]',           // Reels — poster frame
          'img._aagt',                       // IG class for post images
          'article img',                     // generic fallback
        ];
        for (const sel of imgSels) {
          const el = document.querySelector(sel);
          if (el) {
            const src = el.getAttribute('poster') || el.src || el.currentSrc;
            if (src && src.startsWith('http') && !src.includes('profile_pic') && !src.includes('s150x150')) {
              imageUrl = src;
              break;
            }
          }
        }
      }

      if (result) {
        result.sourceUrl = window.location.href;
        result.pageTitle = document.title;
        if (imageUrl) result.imageUrl = imageUrl;
        // Use exposed Node.js function — bypasses CSP entirely (no HTTP request)
        await window.spicehubDownload(JSON.stringify(result));
        btn.innerHTML = '✅&nbsp; Recipe Sent!';
        btn.style.background = 'linear-gradient(135deg,#1565c0,#1976d2)';
        btn.style.opacity = '1';
      } else {
        btn.innerHTML = '❌&nbsp; Expand caption &amp; try again';
        btn.style.background = 'linear-gradient(135deg,#b71c1c,#c62828)';
        btn.style.opacity = '1';
        btn.disabled = false;
        setTimeout(() => {
          btn.innerHTML = '⬇&nbsp; Download Recipe';
          btn.style.background = 'linear-gradient(135deg,#2e7d32,#43a047)';
        }, 3000);
      }
    } catch(e) {
      btn.innerHTML = '❌&nbsp; ' + e.message;
      btn.disabled = false;
      setTimeout(() => { btn.innerHTML = '⬇&nbsp; Download Recipe'; btn.style.opacity = '1'; }, 3000);
    }
  };

  document.body.appendChild(btn);
})();
`;

// ── GET /api/status ────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const chromePath = findChrome();
  res.json({
    ok: true,
    chromeFound: !!chromePath,
    chromePath: chromePath || null,
    browserOpen: !!activeBrowser,
    activeUrl: activeUrl || null,
  });
});

// ── Detect social media URLs on server side ─────────────────────────────────
const SOCIAL_HOSTS = ['instagram.com', 'tiktok.com', 'vm.tiktok.com', 'facebook.com', 'fb.watch'];
function isSocialUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return SOCIAL_HOSTS.some(d => host === d || host.endsWith('.' + d));
  } catch { return false; }
}

// ── Instagram shortcode extraction from URL ──────────────────────────────────
function extractInstagramShortcode(url) {
  try {
    const u = new URL(url);
    // Matches: /p/ABC123/, /reel/ABC123/, /reels/ABC123/, /tv/ABC123/
    const m = u.pathname.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

function isInstagramUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'instagram.com' || host.endsWith('.instagram.com');
  } catch { return false; }
}

// ── Instagram embed page extraction ──────────────────────────────────────────
// Instagram's /embed/ endpoint serves a lighter page that often works without
// login walls. We parse the caption text and image from the embed HTML.
// This is tried BEFORE headless Chrome for Instagram URLs.
async function extractInstagramEmbed(url) {
  const shortcode = extractInstagramShortcode(url);
  if (!shortcode) return null;

  const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
  console.log(`[instagram-embed] Trying embed page: ${embedUrl}`);

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);

    const resp = await fetch(embedUrl, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://www.instagram.com/',
      },
      redirect: 'follow',
    });
    clearTimeout(timer);

    if (!resp.ok) {
      console.log(`[instagram-embed] HTTP ${resp.status}`);
      return null;
    }

    const html = await readResponseWithChunkTimeout(resp, 10000, 2 * 1024 * 1024);

    // Check for login wall
    if (html.length < 5000 && (html.includes('Log in') || html.includes('login'))) {
      console.log('[instagram-embed] Login wall detected');
      return null;
    }

    // ── Extract caption from embed HTML ──
    // The embed page has the caption in a specific div
    let caption = '';

    // Method 1: Look for the caption div in the embed
    const captionPatterns = [
      /<div\s+class="[^"]*Caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<div\s+class="[^"]*EmbedCaption[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      // Instagram embed uses class like "CaptionContent" or similar
      /class="[^"]*[Cc]aption[^"]*"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i,
    ];
    for (const re of captionPatterns) {
      const m = re.exec(html);
      if (m && m[1]) {
        const text = sanitizeText(m[1]);
        if (text && text.length > 15) { caption = text; break; }
      }
    }

    // Method 2: Look for window.__additionalData or shared_data in scripts
    if (!caption) {
      const dataPatterns = [
        /window\.__additionalDataLoaded\s*\(\s*['"][^'"]*['"]\s*,\s*({[\s\S]*?})\s*\)/,
        /"caption"\s*:\s*\{\s*"text"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/,
        /"edge_media_to_caption"\s*:\s*\{\s*"edges"\s*:\s*\[\s*\{\s*"node"\s*:\s*\{\s*"text"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/,
      ];
      for (const re of dataPatterns) {
        const m = re.exec(html);
        if (m) {
          let text = m[1];
          // If it looks like JSON, parse the caption from it
          if (text.startsWith('{')) {
            try {
              const data = JSON.parse(text);
              const cap = data?.graphql?.shortcode_media?.edge_media_to_caption?.edges?.[0]?.node?.text
                || data?.shortcode_media?.edge_media_to_caption?.edges?.[0]?.node?.text;
              if (cap) text = cap;
            } catch { /* use raw match */ }
          }
          // Unescape JSON string escapes
          try { text = JSON.parse(`"${text}"`); } catch {}
          text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (text.length > 15) { caption = text; break; }
        }
      }
    }

    // Method 3: Parse OG description from embed page
    if (!caption) {
      const ogDesc = extractMetaFromHtml(html, 'og:description');
      if (ogDesc && ogDesc.length > 15) {
        caption = stripSocialMetaPrefix(ogDesc);
      }
    }

    // ── Extract image ──
    let imageUrl = '';
    const ogImage = extractMetaFromHtml(html, 'og:image');
    if (ogImage) {
      imageUrl = ogImage;
    }
    // Also try extracting from embed HTML (may find higher-res)
    if (!imageUrl) {
      const imgPatterns = [
        /<img[^>]+class="[^"]*EmbedImage[^"]*"[^>]+src="([^"]+)"/i,
        /<img[^>]+src="(https:\/\/[^"]*instagram[^"]*\/[^"]*_n\.jpg[^"]*)"/i,
        /<img[^>]+src="(https:\/\/scontent[^"]+)"/i,
        // Newer IG embed patterns
        /<img[^>]+srcset="([^"]+)"/i,
        // Background image in style
        /background-image:\s*url\(['"]?(https:\/\/scontent[^'")\s]+)['"]?\)/i,
        // Any instagram CDN image
        /"display_url"\s*:\s*"(https:[^"]+)"/i,
        /"thumbnail_src"\s*:\s*"(https:[^"]+)"/i,
      ];
      for (const re of imgPatterns) {
        const m = re.exec(html);
        if (m) {
          let candidate = m[1].replace(/&amp;/g, '&').replace(/\\u0026/g, '&');
          // If srcset, pick the largest
          if (candidate.includes(',')) {
            const parts = candidate.split(',').map(s => s.trim());
            candidate = parts[parts.length - 1].split(/\s+/)[0]; // last = largest
          }
          if (candidate.startsWith('http')) {
            imageUrl = candidate;
            break;
          }
        }
      }
    }
    // Also try to find image from __additionalData JSON
    if (!imageUrl) {
      const dataMatch = html.match(/"display_url"\s*:\s*"(https:[^"]+)"/);
      if (dataMatch) imageUrl = dataMatch[1].replace(/\\u0026/g, '&')
    }

    // ── Extract title (username / post name) ──
    let title = '';
    const ogTitle = extractMetaFromHtml(html, 'og:title');
    if (ogTitle) {
      title = ogTitle
        .replace(/\s*on\s+Instagram\s*$/i, '')
        .replace(/\s*\(@[\w.]+\)\s*$/i, '')
        .replace(/#\w[\w.]*/g, '')
        .trim();
    }

    if (!caption && !title) {
      console.log('[instagram-embed] No caption or title found in embed page');
      return null;
    }

    console.log(`[instagram-embed] Success — caption: ${caption.length} chars, image: ${imageUrl ? 'yes' : 'no'}`);

    return {
      ok: true,
      type: 'caption',
      caption: stripSocialMetaPrefix(caption),
      title: title || '',
      imageUrl,
      sourceUrl: url,
    };
  } catch (e) {
    console.log(`[instagram-embed] Error: ${e.message}`);
    return null;
  }
}

// ── GET /api/image-proxy ─────────────────────────────────────────────────────
// Proxies external recipe images to avoid CORS issues and expired CDN URLs.
// Client can use this when <img> fails to load (e.g. Instagram CDN expiry).
app.get('/api/image-proxy', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).send('Missing ?url=');

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const resp = await fetch(imageUrl, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': new URL(imageUrl).origin + '/',
        'Accept': 'image/*,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    clearTimeout(timer);

    if (!resp.ok) return res.status(resp.status).send('Image fetch failed');

    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // cache 24h

    // Stream the image to the client
    const buffer = Buffer.from(await resp.arrayBuffer());
    res.send(buffer);
  } catch (e) {
    console.log(`[image-proxy] Failed: ${e.message}`);
    res.status(502).send('Image proxy error');
  }
});

// ── POST /api/extract-url ────────────────────────────────────────────────────
// PRIMARY import endpoint — works from phone, desktop, anywhere.
// Strategy:
//   • Instagram URLs    → embed page first, then headless Chrome fallback
//   • Other social URLs → headless Chrome (real browser rendering)
//   • Recipe blogs      → fast HTTP fetch + HTML parse (JSON-LD, OG tags)
app.post('/api/extract-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ ok: false, error: 'URL required' });

  // ── Instagram: try embed page first (fast, no browser needed) ──
  if (isInstagramUrl(url)) {
    const embedResult = await extractInstagramEmbed(url);
    if (embedResult && embedResult.ok && embedResult.caption) {
      return res.json(embedResult);
    }
    // Embed failed — fall through to headless Chrome
    console.log('[extract-url] Instagram embed failed, trying headless Chrome...');
  }

  // ── Social media: use headless puppeteer (like Paprika's embedded WebView) ──
  if (isSocialUrl(url)) {
    return extractWithHeadlessBrowser(url, res);
  }

  // ── Recipe blogs: fast HTTP fetch ──
  return extractWithHttpFetch(url, res);
});

// ── Headless browser extraction (Instagram, TikTok, Facebook) ────────────────
// Launches Chrome in headless mode, navigates to URL, waits for JS to render,
// then extracts recipe data from the rendered DOM — exactly like Paprika's WebView.
//
// Retry logic: Instagram is flaky with headless Chrome — we retry up to 2 times
// with increasing wait times if we get a login wall or empty page on first try.
async function extractWithHeadlessBrowser(url, res) {
  let browser = null;
  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const launchOpts = getLaunchOptions(true);
      browser = await puppeteer.launch(launchOpts);

      const page = await browser.newPage();

      // Rotate user agents to reduce detection — use current 2025/2026 Chrome versions
      const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      ];
      await page.setUserAgent(userAgents[attempt - 1] || userAgents[0]);

      // Anti-detection measures — comprehensive stealth
      await page.evaluateOnNewDocument(() => {
        // Hide webdriver flag
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        // Remove automation-related properties
        delete navigator.__proto__.webdriver;

        // Mock permissions API
        if (navigator.permissions) {
          const origQuery = navigator.permissions.query;
          navigator.permissions.query = (params) =>
            params.name === 'notifications'
              ? Promise.resolve({ state: Notification.permission })
              : origQuery(params);
        }
        // Mock plugins (real Chrome has PDF viewer etc)
        Object.defineProperty(navigator, 'plugins', {
          get: () => {
            const p = { length: 5 };
            ['Chrome PDF Plugin', 'Chrome PDF Viewer', 'Native Client', 'Chromium PDF Plugin', 'Chromium PDF Viewer']
              .forEach((name, i) => { p[i] = { name, length: 1 }; });
            return p;
          },
        });
        // Mock languages
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });
        // Fake Chrome runtime
        window.chrome = { runtime: {}, loadTimes: () => ({}) };
        // Override toString on functions to return native code string
        const origToString = Function.prototype.toString;
        Function.prototype.toString = function() {
          if (this === Function.prototype.toString) return 'function toString() { [native code] }';
          return origToString.call(this);
        };
        // Mock connection (headless often has missing NetworkInformation)
        if (!navigator.connection) {
          Object.defineProperty(navigator, 'connection', {
            get: () => ({ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false }),
          });
        }
      });

      // Set viewport to look like a real browser
      await page.setViewport({ width: 1280, height: 900 });

      // Navigate and wait for network to settle
      const waitTime = attempt === 1 ? 25000 : 35000;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: waitTime });

      // Adaptive wait: longer on retry, and wait for specific selectors
      const baseWait = attempt === 1 ? 3000 : 5000;
      await new Promise(r => setTimeout(r, baseWait));

      // Try to wait for Instagram caption elements specifically
      try {
        await page.waitForSelector('._a9zs, [data-e2e="video-desc"], article h1, script[type="application/ld+json"]', { timeout: 5000 });
      } catch { /* selector didn't appear, continue anyway */ }

    // ── Extract from rendered DOM (same approach as Paprika's browser.js) ──
    const data = await page.evaluate(() => {
      // 1. JSON-LD (recipe blogs that also happen to be on social media)
      function tryRecipe(obj) {
        if (!obj || typeof obj !== 'object') return null;
        if (Array.isArray(obj)) { for (const x of obj) { const r = tryRecipe(x); if (r) return r; } return null; }
        const t = [].concat(obj['@type'] || []).join(' ').toLowerCase();
        if (t.includes('recipe')) return obj;
        if (obj['@graph']) return tryRecipe(obj['@graph']);
        return null;
      }
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const r = tryRecipe(JSON.parse(s.textContent));
          if (r?.name) return { type: 'jsonld', recipe: r };
        } catch {}
      }

      // 2. Caption from rendered DOM (Instagram / TikTok specific selectors)
      const captionSelectors = [
        // Instagram
        'h1._ap3a',                                    // IG Reel/post title
        '._a9zs span',                                 // IG caption text
        '._a9zs',                                      // IG caption container
        'article h1',                                   // IG article heading
        'article div[dir="auto"]',                     // IG auto-dir text
        'div[role="textbox"] span',                    // IG editable area
        '[data-bloks-name="igc.components.Text"]',     // IG Bloks component
        // TikTok
        '[data-e2e="video-desc"]',                     // TT video description
        '[data-e2e="browse-video-desc"]',              // TT browse desc
        '.video-meta-title',                           // TT meta title
        // Twitter/X
        '[data-testid="tweetText"]',
        // YouTube
        '#description-inner',
      ];

      let caption = '';
      let captionSelector = '';
      for (const sel of captionSelectors) {
        const el = document.querySelector(sel);
        const text = el?.innerText?.trim();
        if (text && text.length > 10) {
          caption = text;
          captionSelector = sel;
          break;
        }
      }

      // 3. OG meta fallback
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content?.trim() || '';
      const ogDesc = document.querySelector('meta[property="og:description"]')?.content?.trim() || '';
      const ogImage = document.querySelector('meta[property="og:image"]')?.content?.trim() || '';

      // 4. Grab post image from rendered DOM (try multiple strategies)
      let imageUrl = ogImage;
      if (!imageUrl) {
        const imgSelectors = [
          'article img[srcset]',
          'article img[src*="instagram"]',
          'article img[src*="scontent"]',
          'article video[poster]',
          'img._aagt',
          'img[style*="object-fit"]',
          'article img',
          '[data-e2e="video-desc"] ~ img',
          'video[poster]',
          'img[src*="cdninstagram"]',
        ];
        for (const sel of imgSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            // Prefer srcset (higher resolution) over src
            let src = '';
            if (el.srcset) {
              const parts = el.srcset.split(',').map(s => s.trim());
              const last = parts[parts.length - 1]; // largest
              src = last.split(/\s+/)[0];
            }
            if (!src) src = el.getAttribute('poster') || el.currentSrc || el.src;
            if (src && src.startsWith('http') && !src.includes('profile_pic') && !src.includes('s150x150') && !src.includes('s320x320')) {
              imageUrl = src;
              break;
            }
          }
        }
      }
      // Also check for images via JSON-LD or script data
      if (!imageUrl) {
        for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
          try {
            const d = JSON.parse(s.textContent);
            const findImg = (o) => {
              if (!o) return '';
              if (typeof o.image === 'string') return o.image;
              if (Array.isArray(o.image)) return o.image[0]?.url || o.image[0] || '';
              if (o.image?.url) return o.image.url;
              if (o['@graph']) for (const g of o['@graph']) { const r = findImg(g); if (r) return r; }
              return '';
            };
            const img = findImg(d);
            if (img && img.startsWith('http')) { imageUrl = img; break; }
          } catch {}
        }
      }

      // 5. Detect login wall
      const bodyText = document.body?.innerText?.toLowerCase() || '';
      const isLoginWall = !caption && !ogDesc &&
        (bodyText.includes('log in') || bodyText.includes('sign in')) &&
        bodyText.length < 5000;

      return {
        caption: caption || ogDesc || '',
        captionSelector,
        title: ogTitle,
        imageUrl: imageUrl || '',
        pageTitle: document.title,
        sourceUrl: window.location.href,
        isLoginWall,
      };
    });

    await browser.close();
    browser = null;

    // Process result
    if (data.isLoginWall && !data.caption) {
      // On first attempt, retry — sometimes Instagram shows login wall briefly
      if (attempt < MAX_ATTEMPTS) {
        console.log(`[extract-url] Login wall on attempt ${attempt}, retrying...`);
        await new Promise(r => setTimeout(r, 2000));
        continue; // retry
      }
      return res.json({ ok: true, type: 'none', isLoginWall: true, sourceUrl: url });
    }

    const caption = stripSocialMetaPrefix(data.caption || '');
    const title = (data.title || data.pageTitle || '')
      .replace(/\s*[|–—-]\s*(Instagram|TikTok|Facebook|Pinterest|YouTube).*$/i, '')
      .replace(/\s*on (Instagram|TikTok|Facebook).*$/i, '')
      .replace(/\s*\(@[\w.]+\).*$/i, '')
      .replace(/#\w[\w.]*/g, '')
      .trim();

    if (!caption && !title) {
      // Empty result on first attempt — retry
      if (attempt < MAX_ATTEMPTS) {
        console.log(`[extract-url] Empty result on attempt ${attempt}, retrying...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      return res.json({ ok: true, type: 'none', sourceUrl: url });
    }

    // Success — return the data
    return res.json({
      ok: true,
      type: data.type === 'jsonld' ? 'jsonld' : 'caption',
      ...(data.type === 'jsonld' ? { recipe: data.recipe } : { caption }),
      title: title || '',
      imageUrl: data.imageUrl || '',
      sourceUrl: data.sourceUrl || url,
    });

  } catch (e) {
    console.error(`[extract-url headless] attempt ${attempt}:`, e.message);
    if (browser) try { await browser.close(); } catch {}
    browser = null;

    // Retry on timeout or network errors
    if (attempt < MAX_ATTEMPTS && (e.message.includes('timeout') || e.message.includes('net::') || e.message.includes('Navigation'))) {
      console.log(`[extract-url] Retrying after error: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    return res.status(500).json({ ok: false, error: e.message || 'Headless extraction failed' });
  }
  } // end retry loop
}

// ── Mealie-inspired browser-like request headers ──────────────────────────────
// These headers mimic a real browser to avoid 403 blocks from recipe sites.
// Adapted from Mealie's user_agents_manager.py get_scrape_headers()
const SCRAPE_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1.1 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
];

function getScrapeHeaders(userAgent) {
  return {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
  };
}

// ── HTTP fetch extraction (recipe blogs — fast, no browser needed) ───────────
// Strategy (Mealie/Paprika-style multi-pass):
//   1. JSON-LD structured data (best quality — Schema.org/Recipe)
//   2. Microdata (itemscope/itemtype Recipe — used by some older recipe sites)
//   3. Heuristic HTML parsing (look for common recipe CSS classes/patterns)
//   4. OG meta tags fallback
//
// Retry: cycles through user agents on failure (like Mealie's safe_scrape_html)
async function extractWithHttpFetch(url, res) {
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const ctrl = new AbortController();
      const timeout = attempt === 1 ? 15000 : attempt === 2 ? 20000 : 25000;
      const timer = setTimeout(() => ctrl.abort(), timeout);
      const ua = SCRAPE_USER_AGENTS[(attempt - 1) % SCRAPE_USER_AGENTS.length];

      const resp = await fetch(url, {
        signal: ctrl.signal,
        headers: getScrapeHeaders(ua),
        redirect: 'follow',
      });
      clearTimeout(timer);

      if (!resp.ok) {
        if (attempt < MAX_ATTEMPTS && (resp.status === 403 || resp.status === 429)) {
          console.log(`[extract-url http] HTTP ${resp.status} on attempt ${attempt}, retrying with different UA...`);
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
        return res.status(502).json({ ok: false, error: `Page returned HTTP ${resp.status}` });
      }

      // ── Mealie-inspired streaming with chunk-level timeout ──
      // Prevents hanging on huge pages that send data very slowly.
      // Each chunk must arrive within CHUNK_TIMEOUT_MS, and total body
      // is capped at MAX_BODY_BYTES to avoid memory issues.
      const CHUNK_TIMEOUT_MS = 10000; // 10s per chunk
      const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB max
      const html = await readResponseWithChunkTimeout(resp, CHUNK_TIMEOUT_MS, MAX_BODY_BYTES);

      // ── PASS 1: JSON-LD (best quality — most modern recipe sites) ──
      const jsonLdRe = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
      let jsonLdRecipe = null;
      let ldMatch;
      while ((ldMatch = jsonLdRe.exec(html)) !== null) {
        try {
          const raw = ldMatch[1].replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ').trim();
          const data = JSON.parse(raw);
          jsonLdRecipe = findRecipeInLd(Array.isArray(data) ? data : [data]);
          if (jsonLdRecipe) break;
        } catch {}
      }

      if (jsonLdRecipe) {
        // Mealie-inspired: pick the best/largest image from candidates
        const recipeImage = selectBestImage(jsonLdRecipe.image);
        const ogImage = extractMetaFromHtml(html, 'og:image');
        const bestImage = recipeImage || ogImage || '';
        jsonLdRecipe.image = bestImage;
        return res.json({ ok: true, type: 'jsonld', recipe: jsonLdRecipe, imageUrl: bestImage, sourceUrl: url });
      }

      // ── PASS 2: Microdata (Schema.org Recipe via itemscope/itemprop) ──
      const microdataRecipe = extractMicrodataRecipe(html);
      if (microdataRecipe) {
        const ogImage = extractMetaFromHtml(html, 'og:image');
        return res.json({ ok: true, type: 'jsonld', recipe: microdataRecipe, imageUrl: ogImage || '', sourceUrl: url });
      }

      // ── PASS 3: Heuristic HTML parsing (common recipe site patterns) ──
      const heuristicRecipe = extractRecipeFromHtmlHeuristic(html);
      if (heuristicRecipe) {
        return res.json({ ok: true, type: 'jsonld', recipe: heuristicRecipe, imageUrl: heuristicRecipe.image || '', sourceUrl: url });
      }

      // ── PASS 4: OG meta tags fallback ──
      const ogTitle = extractMetaFromHtml(html, 'og:title') || extractMetaFromHtml(html, 'twitter:title') || '';
      const ogDesc = extractMetaFromHtml(html, 'og:description') || extractMetaFromHtml(html, 'twitter:description') || '';
      const ogImage = extractMetaFromHtml(html, 'og:image') || extractMetaFromHtml(html, 'twitter:image') || '';

      if (!ogTitle && !ogDesc) {
        if (attempt < MAX_ATTEMPTS) {
          console.log(`[extract-url http] No data on attempt ${attempt}, retrying...`);
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
        return res.json({ ok: true, type: 'none', sourceUrl: url });
      }

      const caption = stripSocialMetaPrefix(ogDesc);
      const title = ogTitle
        .replace(/\s*[|–—-]\s*(Instagram|TikTok|Facebook|Pinterest|YouTube).*$/i, '')
        .replace(/\s*on (Instagram|TikTok|Facebook).*$/i, '')
        .replace(/\s*\(@[\w.]+\).*$/i, '')
        .replace(/#\w[\w.]*/g, '')
        .trim();

      return res.json({
        ok: true,
        type: 'caption',
        caption,
        title: title || '',
        imageUrl: ogImage,
        sourceUrl: url,
      });

    } catch (e) {
      if (attempt < MAX_ATTEMPTS && (e.name === 'AbortError' || e.message.includes('fetch'))) {
        console.log(`[extract-url http] attempt ${attempt} failed: ${e.message}, retrying...`);
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      return res.status(500).json({ ok: false, error: e.message || 'Fetch failed' });
    }
  }
}

// ── Microdata extraction (Schema.org Recipe via HTML itemscope/itemprop) ─────
// Handles older recipe sites that use Microdata instead of JSON-LD
function extractMicrodataRecipe(html) {
  // Check if there's a Recipe itemscope
  const recipeMatch = html.match(/<[^>]*itemtype\s*=\s*["'][^"']*schema\.org\/Recipe["'][^>]*>([\s\S]*?)(?=<[^>]*itemtype\s*=\s*["']|$)/i);
  if (!recipeMatch) return null;

  const block = recipeMatch[0];

  // Extract name
  const nameMatch = block.match(/<[^>]*itemprop\s*=\s*["']name["'][^>]*>([^<]+)/i)
    || block.match(/<[^>]*itemprop\s*=\s*["']name["'][^>]*content\s*=\s*["']([^"']+)/i);
  const name = nameMatch ? nameMatch[1].trim() : '';
  if (!name) return null;

  // Extract ingredients
  const ingredients = [];
  const ingRe = /<[^>]*itemprop\s*=\s*["']recipeIngredient["'][^>]*>([^<]*)/gi;
  let ingMatch;
  while ((ingMatch = ingRe.exec(html)) !== null) {
    const text = ingMatch[1].replace(/<[^>]*>/g, '').trim();
    if (text) ingredients.push(text);
  }
  // Also try content attribute
  const ingContentRe = /<[^>]*itemprop\s*=\s*["']recipeIngredient["'][^>]*content\s*=\s*["']([^"']+)/gi;
  while ((ingMatch = ingContentRe.exec(html)) !== null) {
    if (ingMatch[1].trim()) ingredients.push(ingMatch[1].trim());
  }

  // Extract instructions
  const instructions = [];
  const instRe = /<[^>]*itemprop\s*=\s*["']recipeInstructions["'][^>]*>([\s\S]*?)(?=<\/[a-z]+>)/gi;
  let instMatch;
  while ((instMatch = instRe.exec(html)) !== null) {
    const text = instMatch[1].replace(/<[^>]*>/g, '').trim();
    if (text) instructions.push(text);
  }

  // Extract image
  const imgMatch = block.match(/<img[^>]*itemprop\s*=\s*["']image["'][^>]*src\s*=\s*["']([^"']+)/i)
    || block.match(/<[^>]*itemprop\s*=\s*["']image["'][^>]*content\s*=\s*["']([^"']+)/i);
  const image = imgMatch ? imgMatch[1] : '';

  if (ingredients.length === 0 && instructions.length === 0) return null;

  return {
    name,
    recipeIngredient: ingredients,
    recipeInstructions: instructions.map(text => ({ '@type': 'HowToStep', text })),
    image,
  };
}

// ── Heuristic HTML extraction (Paprika-style CSS class pattern matching) ─────
// Looks for common recipe site DOM patterns when structured data is missing
function extractRecipeFromHtmlHeuristic(html) {
  // Common class/id patterns for recipe titles
  const titlePatterns = [
    /class\s*=\s*["'][^"']*recipe[_-]?title[^"']*["'][^>]*>([^<]+)/i,
    /class\s*=\s*["'][^"']*wprm-recipe-name[^"']*["'][^>]*>([^<]+)/i,
    /class\s*=\s*["'][^"']*tasty-recipes-title[^"']*["'][^>]*>([^<]+)/i,
    /class\s*=\s*["'][^"']*easyrecipe[^"']*["'][^>]*>[\s\S]*?<[^>]*class\s*=\s*["'][^"']*fn[^"']*["'][^>]*>([^<]+)/i,
  ];

  let recipeName = '';
  for (const re of titlePatterns) {
    const m = re.exec(html);
    if (m) { recipeName = m[1].trim(); break; }
  }

  // Common class patterns for ingredients
  const ingredientPatterns = [
    /class\s*=\s*["'][^"']*wprm-recipe-ingredient[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class\s*=\s*["'][^"']*recipe-ingredient[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class\s*=\s*["'][^"']*tasty-recipe[s]?-ingredient[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class\s*=\s*["'][^"']*ingredient[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
  ];

  const ingredients = [];
  for (const re of ingredientPatterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const text = sanitizeText(m[1]);
      if (text && text.length > 2 && text.length < 200) ingredients.push(text);
    }
    if (ingredients.length > 0) break;
  }

  // Common class patterns for instructions
  const instructionPatterns = [
    /class\s*=\s*["'][^"']*wprm-recipe-instruction[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class\s*=\s*["'][^"']*recipe-instruction[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class\s*=\s*["'][^"']*tasty-recipe[s]?-instruction[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class\s*=\s*["'][^"']*instruction[s]?-step[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class\s*=\s*["'][^"']*step-text[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div|p)>/gi,
  ];

  const instructions = [];
  for (const re of instructionPatterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const text = sanitizeText(m[1]);
      if (text && text.length > 5) instructions.push(text);
    }
    if (instructions.length > 0) break;
  }

  // Need at least a name + ingredients or instructions
  if (!recipeName && ingredients.length === 0) return null;
  if (ingredients.length === 0 && instructions.length === 0) return null;

  // Get OG title as fallback name
  if (!recipeName) {
    recipeName = extractMetaFromHtml(html, 'og:title') || 'Imported Recipe';
  }

  return {
    name: recipeName,
    recipeIngredient: ingredients,
    recipeInstructions: instructions.map(text => ({ '@type': 'HowToStep', text })),
    image: extractMetaFromHtml(html, 'og:image') || '',
  };
}

// ── HTML entity decoding (Mealie-style iterative cleaning) ─────────────────
function decodeHtmlEntities(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * Mealie-inspired iterative sanitization: clean HTML tags, entities, and
 * whitespace in a loop until the string stabilizes. Some sites have doubly-
 * escaped HTML (e.g. "&amp;lt;p&amp;gt;") that needs multiple passes.
 */
function sanitizeText(text) {
  if (!text || typeof text !== 'string') return '';
  let clean = text;
  let prev = '';
  // Max 5 iterations to prevent infinite loops
  for (let i = 0; i < 5 && clean !== prev; i++) {
    prev = clean;
    clean = clean
      .replace(/<[^>]+>/g, ' ')      // strip HTML tags
      .replace(/\xa0/g, ' ')          // non-breaking space
      .replace(/\t/g, ' ')
      .replace(/ +/g, ' ')            // collapse spaces
      .replace(/\n\s*\n/g, '\n\n');   // collapse blank lines
    clean = decodeHtmlEntities(clean).trim();
  }
  return clean;
}

/**
 * Mealie-inspired streaming body reader with per-chunk timeout.
 * Reads the response body as a stream, aborting if:
 *   - Any single chunk takes longer than chunkTimeoutMs to arrive
 *   - Total body exceeds maxBytes
 * This prevents the server from hanging on sites that trickle data slowly
 * or serve unexpectedly large pages (e.g. recipe sites with enormous inline images).
 */
async function readResponseWithChunkTimeout(resp, chunkTimeoutMs = 10000, maxBytes = 5 * 1024 * 1024) {
  // If no body stream (e.g. Node 18+ with ReadableStream), fall back to .text()
  if (!resp.body || typeof resp.body.getReader !== 'function') {
    // Fallback: use arrayBuffer with a safety timeout
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), chunkTimeoutMs * 3);
    try {
      const buf = await resp.arrayBuffer();
      clearTimeout(timer);
      return new TextDecoder().decode(buf);
    } catch (e) {
      clearTimeout(timer);
      throw new Error(`Response body read timed out: ${e.message}`);
    }
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      // Race: next chunk vs timeout
      const chunkPromise = reader.read();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Chunk read timed out')), chunkTimeoutMs)
      );

      const { done, value } = await Promise.race([chunkPromise, timeoutPromise]);

      if (done) break;

      totalBytes += value.length;
      if (totalBytes > maxBytes) {
        // We have enough HTML — recipe data is in the first few MB
        console.log(`[readResponseWithChunkTimeout] Body exceeded ${maxBytes} bytes, truncating`);
        chunks.push(decoder.decode(value, { stream: false }));
        break;
      }

      chunks.push(decoder.decode(value, { stream: true }));
    }
  } catch (e) {
    // If we already have some data, use it (recipe JSON-LD is usually near the top)
    if (chunks.length > 0) {
      console.log(`[readResponseWithChunkTimeout] ${e.message}, using ${totalBytes} bytes already received`);
      return chunks.join('');
    }
    throw e;
  } finally {
    try { reader.cancel(); } catch { /* ignore */ }
  }

  return chunks.join('');
}

/**
 * Mealie-inspired image selection: when a recipe has multiple image candidates,
 * pick the best one. Prefers URLs with size hints suggesting the largest image.
 * Falls back to the first valid URL.
 *
 * JSON-LD `image` can be: a string, an array of strings, an ImageObject,
 * an array of ImageObjects, or nested combinations.
 */
function selectBestImage(imageField) {
  if (!imageField) return '';

  // Collect all candidate URLs
  const candidates = [];

  function collect(val) {
    if (!val) return;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed && (trimmed.startsWith('http') || trimmed.startsWith('//'))) {
        candidates.push(trimmed);
      }
      return;
    }
    if (Array.isArray(val)) {
      for (const item of val) collect(item);
      return;
    }
    if (typeof val === 'object') {
      // ImageObject: { @type: "ImageObject", url: "...", width: 1200 }
      if (val.url) collect(val.url);
      else if (val.contentUrl) collect(val.contentUrl);
      // Also check thumbnail
      if (val.thumbnail?.url) collect(val.thumbnail.url);
    }
  }

  collect(imageField);
  if (candidates.length === 0) return '';
  if (candidates.length === 1) return candidates[0];

  // Score each candidate: prefer larger images based on URL hints
  function scoreUrl(url) {
    let score = 0;
    // Prefer URLs with size hints suggesting large images
    const sizeMatch = url.match(/(\d{3,4})x(\d{3,4})/);
    if (sizeMatch) {
      score = parseInt(sizeMatch[1]) * parseInt(sizeMatch[2]);
    }
    // URLs with "full", "large", "original" are likely higher quality
    if (/\b(full|large|original|hero|featured)\b/i.test(url)) score += 500000;
    // Penalize thumbnails and small sizes
    if (/\b(thumb|small|tiny|icon|avatar|s150|s320|150x150|320x320)\b/i.test(url)) score -= 1000000;
    // Prefer longer URLs (usually more specific/higher quality)
    score += url.length;
    return score;
  }

  candidates.sort((a, b) => scoreUrl(b) - scoreUrl(a));
  return candidates[0];
}

// Helper: extract meta tag from raw HTML
function extractMetaFromHtml(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${property}["'][^>]+content\\s*=\\s*["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]+(?:property|name)\\s*=\\s*["']${property}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) return decodeHtmlEntities(m[1]);
  }
  return '';
}

// Helper: recursively find a Recipe node in JSON-LD data
function findRecipeInLd(items) {
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const t = [].concat(item['@type'] || []).join(' ').toLowerCase();
    if (t.includes('recipe')) return item;
    if (item['@graph']) {
      const r = findRecipeInLd([].concat(item['@graph']));
      if (r) return r;
    }
    for (const val of Object.values(item)) {
      if (Array.isArray(val)) {
        const r = findRecipeInLd(val);
        if (r) return r;
      }
    }
  }
  return null;
}

// ── POST /api/browser/open ─────────────────────────────────────────────────────
// Opens Chrome visibly and injects the Download Recipe button (desktop fallback)
app.post('/api/browser/open', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const chromePath = findChrome();
  if (!chromePath) {
    return res.status(503).json({
      error: 'Google Chrome not found.',
      hint: 'Install Chrome from google.com/chrome',
    });
  }

  _pendingExtraction = null; // Clear any previous extraction

  try {
    // If already open, navigate to new URL
    if (activeBrowser && activePage) {
      try {
        await activePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        activeUrl = url;
        await new Promise(r => setTimeout(r, 1500));
        await activePage.evaluate(INJECT_DOWNLOAD_BUTTON);
        return res.json({ ok: true, action: 'navigated' });
      } catch {
        await ensureBrowserClosed();
      }
    }

    activeBrowser = await puppeteer.launch({
      executablePath: chromePath,
      headless: false,
      userDataDir: PROFILE_DIR,
      defaultViewport: null,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1280,900',
        '--window-position=100,50',
        '--disable-infobars',
      ],
    });

    activeBrowser.on('disconnected', () => {
      activeBrowser = null;
      activePage = null;
      activeUrl = null;
    });

    const pages = await activeBrowser.pages();
    activePage = pages[0] || await activeBrowser.newPage();

    await activePage.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await activePage.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // Expose Node.js function to Chrome's JS context BEFORE navigation.
    // This bypasses Instagram's CSP entirely — no fetch/XHR, the injected
    // button calls window.spicehubDownload() which bridges directly to Node.
    await activePage.exposeFunction('spicehubDownload', (dataJson) => {
      try {
        const data = JSON.parse(dataJson);
        // Clean up OG description metadata prefix if present
        if (data.caption) {
          data.caption = stripSocialMetaPrefix(data.caption);
        }
        _pendingExtraction = data;
      } catch (e) {
        _pendingExtraction = { type: 'caption', caption: dataJson };
      }
      // Close browser after a short delay (gives time for "✅ Recipe Sent!" to show)
      setTimeout(() => ensureBrowserClosed(), 1500);
    });

    await activePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    activeUrl = url;

    // Wait for JS rendering, then inject button
    await new Promise(r => setTimeout(r, 2000));
    await activePage.evaluate(INJECT_DOWNLOAD_BUTTON);

    res.json({ ok: true, action: 'launched' });
  } catch (e) {
    await ensureBrowserClosed();
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/browser/extracted ────────────────────────────────────────────────
// Called BY the injected Download button inside Chrome — receives the recipe data
app.post('/api/browser/extracted', (req, res) => {
  _pendingExtraction = req.body;
  res.json({ ok: true });
  // Close browser after a short delay (gives time for the "✅ Recipe Sent!" to show)
  setTimeout(() => ensureBrowserClosed(), 1500);
});

// ── GET /api/browser/poll ──────────────────────────────────────────────────────
// Frontend polls this every 2s waiting for the user to click Download in Chrome
app.get('/api/browser/poll', (req, res) => {
  if (_pendingExtraction) {
    const data = _pendingExtraction;
    _pendingExtraction = null;
    res.json({ ok: true, hasData: true, ...data });
  } else {
    res.json({ ok: true, hasData: false });
  }
});

// ── POST /api/browser/extract ──────────────────────────────────────────────────
// Manual fallback: extract from currently open page without the Download button
app.post('/api/browser/extract', async (req, res) => {
  if (!activePage) {
    return res.status(400).json({ error: 'No browser open.' });
  }
  try {
    await new Promise(r => setTimeout(r, 1000));
    const data = await activePage.evaluate(() => {
      function tryRecipe(obj) {
        if (!obj || typeof obj !== 'object') return null;
        if (Array.isArray(obj)) { for (const x of obj) { const r = tryRecipe(x); if (r) return r; } return null; }
        const t = [].concat(obj['@type'] || []).join(' ').toLowerCase();
        if (t.includes('recipe')) return obj;
        if (obj['@graph']) return tryRecipe(obj['@graph']);
        return null;
      }
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try { const r = tryRecipe(JSON.parse(s.textContent)); if (r?.name) return {type:'jsonld', recipe:r}; } catch {}
      }
      const sels = ['._a9zs span','._a9zs','article div[dir="auto"]','div[role="textbox"]','[data-e2e="video-desc"]'];
      for (const sel of sels) {
        const el = document.querySelector(sel);
        const text = el?.innerText?.trim();
        if (text && text.length > 20) return {type:'caption', caption:text};
      }
      const og = document.querySelector('meta[property="og:description"]')?.content?.trim();
      if (og && og.length > 20) {
        // Also grab image
        let imageUrl = document.querySelector('meta[property="og:image"]')?.content?.trim() || '';
        if (!imageUrl) {
          const imgEl = document.querySelector('article img[srcset]') || document.querySelector('article img');
          if (imgEl) imageUrl = imgEl.src || '';
        }
        return {type:'caption', caption:og, imageUrl};
      }
      const body = document.body?.innerText?.toLowerCase() || '';
      return {
        type: 'none',
        isLoginWall: (body.includes('log in') || body.includes('sign in')) && body.length < 5000,
        pageTitle: document.title,
      };
    });
    data.sourceUrl = activeUrl;
    // Clean OG description metadata prefix if present
    if (data.caption) {
      data.caption = stripSocialMetaPrefix(data.caption);
    }
    // Close browser after manual extract too
    setTimeout(() => ensureBrowserClosed(), 1000);
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/browser/close ────────────────────────────────────────────────────
app.post('/api/browser/close', async (req, res) => {
  await ensureBrowserClosed();
  res.json({ ok: true });
});

// ── GET /api/browser/status ────────────────────────────────────────────────────
app.get('/api/browser/status', (req, res) => {
  res.json({ open: !!activeBrowser, url: activeUrl || null });
});

// ── Health check (for Render / Railway) ──────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, mode: IS_CLOUD ? 'cloud' : 'local' }));

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🌶️  SpiceHub Recipe Server (${IS_CLOUD ? 'CLOUD' : 'LOCAL'} mode)`);
  console.log(`   Listening on port ${PORT}`);
  if (!IS_CLOUD) {
    const chromePath = findChrome();
    console.log(chromePath
      ? `   Chrome found: ${chromePath}`
      : '   ⚠️  Chrome not found — install from google.com/chrome');
  }
  console.log('');
});
