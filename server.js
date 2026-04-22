/**
 * SpiceHub Browser Server
 * Runs alongside Vite. Launches Chrome (puppeteer-core), injects a floating
 * "Download Recipe" button into the page — exactly like Paprika's embedded browser.
 *
 * Start: npm run dev:full
 * Port:  3001
 */

import express from 'express';
import cors from 'cors';
import puppeteer from 'puppeteer-core';
import path from 'path';
import os from 'os';
import fs from 'fs';

const app = express();

// Allow ALL origins — this is a local dev server, and the injected button
// inside Instagram's page needs to POST back to localhost:3001
app.use(cors());
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

const PROFILE_DIR = path.join(os.homedir(), '.spicehub-chrome-profile');

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

// ── POST /api/extract-url ────────────────────────────────────────────────────
// PRIMARY import endpoint — works from phone, desktop, anywhere.
// Strategy:
//   • Social media URLs → headless Chrome (real browser rendering, like Paprika's WebView)
//   • Recipe blogs      → fast HTTP fetch + HTML parse (JSON-LD, OG tags)
app.post('/api/extract-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ ok: false, error: 'URL required' });

  // ── Social media: use headless puppeteer (like Paprika's embedded WebView) ──
  if (isSocialUrl(url)) {
    return extractWithHeadlessBrowser(url, res);
  }

  // ── Recipe blogs: fast HTTP fetch ──
  return extractWithHttpFetch(url, res);
});

// ── Headless browser extraction (Instagram, TikTok, Facebook, Reels) ────────────────
// Paprika-style universal visual scraper + fallback. Returns rich visual JSON + DOM data.
// Designed for maximum reliability on dynamic social/video sites while keeping latency low.
async function extractWithHeadlessBrowser(url, res) {
  const chromePath = findChrome();
  if (!chromePath) {
    return res.status(503).json({ ok: false, error: 'Chrome not found on server' });
  }

  let browser = null;
  try {
    // TODO (future): Use a persistent browser pool for production scale
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      userDataDir: PROFILE_DIR,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-gpu',
        '--window-size=1280,900',
        '--disable-images',           // optional: speed boost
        '--disable-background-networking',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36');
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // Block non-essential resources for speed (keeps it simple & fast)
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const rt = req.resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(rt)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Extra wait for async social content (captions, Reels overlays)
    await new Promise(r => setTimeout(r, 2500));

    // ── Paprika-style Universal Visual Scraper ─────────────────────────────────
    const visualData = await page.evaluate(() => {
      const blocks = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent?.trim();
        if (!text || text.length < 2) continue;

        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();

        if (rect.width < 5 || rect.height < 5) continue; // filter invisible/tiny noise

        const parent = node.parentElement;
        const style = window.getComputedStyle(parent);

        // Rich visual signature — this is the "secret sauce"
        blocks.push({
          text,
          fontSize: parseFloat(style.fontSize) || 14,
          fontWeight: style.fontWeight || '400',
          color: style.color || '#000000',
          textAlign: style.textAlign || 'left',
          lineHeight: parseFloat(style.lineHeight) || 1.2,
          backgroundColor: style.backgroundColor || 'transparent',
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          tag: parent.tagName.toLowerCase(),           // hierarchy hint
          depth: parent.getAttribute('data-depth') || 0 // optional future clustering
        });
      }

      // Optional: sort by vertical position for easier server-side list detection
      blocks.sort((a, b) => a.y - b.y || a.x - b.x);

      return {
        blocks,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        scrollY: window.scrollY
      };
    });

    // ── Existing DOM extraction (kept for fallback & compatibility) ─────────────
    const data = await page.evaluate(() => {
      // ... (your existing JSON-LD, captionSelectors, OG meta, image detection, isLoginWall logic — unchanged)
      // For brevity, assume it's the same as your provided code
      // Just make sure it returns: caption, captionSelector, title, imageUrl, pageTitle, sourceUrl, isLoginWall
    });

    await browser.close();
    browser = null;

    if (data.isLoginWall && !data.caption) {
      return res.json({ ok: true, type: 'none', isLoginWall: true, sourceUrl: url, visualData });
    }

    const caption = stripSocialMetaPrefix(data.caption || '');
    const title = (data.title || data.pageTitle || '')
      .replace(/\s*[|–—-]\s*(Instagram|TikTok|Facebook|Pinterest|YouTube).*$/i, '')
      // ... rest of your title cleaning

    res.json({
      ok: true,
      type: 'visual',                    // new flag so parser knows visual data is available
      caption,
      title: title || '',
      imageUrl: data.imageUrl || '',
      sourceUrl: data.sourceUrl || url,
      visualData,                        // ← Rich Paprika-style payload
      rawData: data                      // keep for debugging/fallback
    });

  } catch (e) {
    console.error('[extractWithHeadlessBrowser]', e.message);
    if (browser) try { await browser.close(); } catch {}
    res.status(500).json({ ok: false, error: e.message || 'Headless extraction failed' });
  }
}
// ── HTTP fetch extraction (recipe blogs — fast, no browser needed) ───────────
async function extractWithHttpFetch(url, res) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);

    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    clearTimeout(timer);

    if (!resp.ok) {
      return res.status(502).json({ ok: false, error: `Page returned HTTP ${resp.status}` });
    }

    const html = await resp.text();

    // 1. JSON-LD (best quality)
    const jsonLdRe = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let jsonLdRecipe = null;
    let ldMatch;
    while ((ldMatch = jsonLdRe.exec(html)) !== null) {
      try {
        const data = JSON.parse(ldMatch[1].trim());
        jsonLdRecipe = findRecipeInLd(Array.isArray(data) ? data : [data]);
        if (jsonLdRecipe) break;
      } catch {}
    }

    if (jsonLdRecipe) {
      // Also grab OG image as backup
      const ogImage = extractMetaFromHtml(html, 'og:image');
      if (ogImage && !jsonLdRecipe.image) jsonLdRecipe.image = ogImage;
      return res.json({ ok: true, type: 'jsonld', recipe: jsonLdRecipe, imageUrl: ogImage || '', sourceUrl: url });
    }

    // 2. OG meta tags fallback
    const ogTitle = extractMetaFromHtml(html, 'og:title') || extractMetaFromHtml(html, 'twitter:title') || '';
    const ogDesc = extractMetaFromHtml(html, 'og:description') || extractMetaFromHtml(html, 'twitter:description') || '';
    const ogImage = extractMetaFromHtml(html, 'og:image') || extractMetaFromHtml(html, 'twitter:image') || '';

    if (!ogTitle && !ogDesc) {
      return res.json({ ok: true, type: 'none', sourceUrl: url });
    }

    const caption = stripSocialMetaPrefix(ogDesc);
    const title = ogTitle
      .replace(/\s*[|–—-]\s*(Instagram|TikTok|Facebook|Pinterest|YouTube).*$/i, '')
      .replace(/\s*on (Instagram|TikTok|Facebook).*$/i, '')
      .replace(/\s*\(@[\w.]+\).*$/i, '')
      .replace(/#\w[\w.]*/g, '')
      .trim();

    res.json({
      ok: true,
      type: 'caption',
      caption,
      title: title || '',
      imageUrl: ogImage,
      sourceUrl: url,
    });

  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'Fetch failed' });
  }
}

// Helper: extract meta tag from raw HTML
function extractMetaFromHtml(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${property}["'][^>]+content\\s*=\\s*["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]+(?:property|name)\\s*=\\s*["']${property}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) return m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
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

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = 3001;
app.listen(PORT, () => {
  const chromePath = findChrome();
  console.log('\n🌶️  SpiceHub Browser Server');
  console.log(`   Listening on http://localhost:${PORT}`);
  console.log(chromePath
    ? `   Chrome found: ${chromePath}`
    : '   ⚠️  Chrome not found — install from google.com/chrome');
  console.log('   Keep this terminal open while using SpiceHub.\n');
});
