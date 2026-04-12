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
 *   YTDLP_VERSION      — pin yt-dlp version (e.g. '2025.03.31'). Auto-installs on startup if mismatched.
 *
 * Start locally:  node index.js
 * Start on cloud: SPICEHUB_MODE=cloud node index.js
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execFile, exec } from 'child_process';
import { parseRecipe } from '../recipeParser.js';

// yt-dlp-exec — required for YouTube video recipe parsing
const ytDlp = require('yt-dlp-exec');

// Load .env file for local dev (optional; not required in cloud)
try {
  const dotenv = await import('dotenv');
  dotenv.default.config();
} catch (e) {
  // dotenv not installed — OK for cloud environments (Render/Railway set env vars via dashboard)
}

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
// ── yt-dlp-exec (dynamic import — required because file is ESM)

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
app.get('/api/status', async (req, res) => {
  const chromePath = findChrome();
  const ytdlp = await isYtdlpAvailable();
  res.json({
    ok: true,
    chromeFound: !!chromePath,
    chromePath: chromePath || null,
    browserOpen: !!activeBrowser,
    activeUrl: activeUrl || null,
    ytdlpAvailable: ytdlp,
  });
});

// ── Detect social media URLs on server side ─────────────────────────────────
const SOCIAL_HOSTS = ['instagram.com', 'tiktok.com', 'vm.tiktok.com', 'facebook.com', 'fb.watch', 'youtube.com', 'youtu.be'];
function isSocialUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return SOCIAL_HOSTS.some(d => host === d || host.endsWith('.' + d));
  } catch { return false; }
}
// Video URL detector (YouTube + common video hosts)
function isVideoUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return /youtube\.com|youtu\.be|vimeo\.com|facebook\.com|instagram\.com\/reel/i.test(host);
  } catch {
    return false;
  }
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
    let caption = '';

    // Method 1: Caption div patterns — covers multiple Instagram embed class naming schemes
    const captionPatterns = [
      /<div\s+class="[^"]*Caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<div\s+class="[^"]*EmbedCaption[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /class="[^"]*[Cc]aption[^"]*"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i,
      /data-caption[^>]*>([\s\S]*?)<\//i,
    ];
    for (const re of captionPatterns) {
      const m = re.exec(html);
      if (m && m[1]) {
        const text = sanitizeText(m[1]);
        if (text && text.length > 15) { caption = text; break; }
      }
    }

    // Method 2: JSON data in scripts — multiple field names Instagram has used over time
    if (!caption) {
      const dataPatterns = [
        // Current: edge_media_to_caption
        /"edge_media_to_caption"\s*:\s*\{\s*"edges"\s*:\s*\[\s*\{\s*"node"\s*:\s*\{\s*"text"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/,
        // window.__additionalDataLoaded (older embed pages)
        /window\.__additionalDataLoaded\s*\(\s*['"][^'"]*['"]\s*,\s*({[\s\S]*?})\s*\)/,
        // caption.text
        /"caption"\s*:\s*\{\s*"text"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/,
        // Direct caption_text
        /"caption_text"\s*:\s*"([^"]{20,}(?:\\.[^"]*)*)"/,
        // accessibility_caption (Reels often have this)
        /"accessibility_caption"\s*:\s*"([^"]{20,}(?:\\.[^"]*)*)"/,
        // Any long "text" field — likely the caption
        /"text"\s*:\s*"([^"]{80,}(?:\\.[^"]*)*)"/,
      ];
      for (const re of dataPatterns) {
        const m = re.exec(html);
        if (m) {
          let text = m[1];
          if (text.startsWith('{')) {
            try {
              const data = JSON.parse(text);
              const cap = data?.graphql?.shortcode_media?.edge_media_to_caption?.edges?.[0]?.node?.text
                || data?.shortcode_media?.edge_media_to_caption?.edges?.[0]?.node?.text
                || data?.data?.xdt_shortcode_v2?.edge_media_to_caption?.edges?.[0]?.node?.text;
              if (cap) text = cap;
            } catch { /* use raw match */ }
          }
          try { text = JSON.parse(`"${text}"`); } catch { }
          text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (text.length > 15) { caption = text; break; }
        }
      }
    }

    // Method 3: OG description
    if (!caption) {
      const ogDesc = extractMetaFromHtml(html, 'og:description');
      if (ogDesc && ogDesc.length > 15) {
        caption = stripSocialMetaPrefix(ogDesc);
      }
    }

    // Method 4: meta description fallback
    if (!caption) {
      const metaDesc = extractMetaFromHtml(html, 'description');
      if (metaDesc && metaDesc.length > 15) {
        caption = stripSocialMetaPrefix(metaDesc);
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
    // Broaden JSON image field search — Instagram has used several field names
    if (!imageUrl) {
      const jsonImgPatterns = [
        /"display_url"\s*:\s*"(https:[^"]+)"/,
        /"thumbnail_src"\s*:\s*"(https:[^"]+)"/,
        /"thumbnail_url"\s*:\s*"(https:[^"]+)"/,
        /"media_url"\s*:\s*"(https:[^"]+)"/,
        /"cover_image_url"\s*:\s*"(https:[^"]+)"/,
      ];
      for (const re of jsonImgPatterns) {
        const m = html.match(re);
        if (m) { imageUrl = m[1].replace(/\\u0026/g, '&').replace(/\\/g, ''); break; }
      }
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

    return { type: 'caption', caption, title, imageUrl, sourceUrl: url };
  } catch (err) {
    console.error(`[instagram-embed] Error: ${err.message}`);
    return null;
  }
}

// ── POST /api/extract-instagram-agent ─────────────────────────────────────────
// Real Puppeteer-based extraction (replaces dead @vercel/agent-browser CLI)
app.post('/api/extract-instagram-agent', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ ok: false, error: 'Missing url' });

  console.log(`[agent-browser] Puppeteer extraction for: ${url}`);
  let browser = null;
  try {
    browser = await puppeteer.launch(getLaunchOptions(true));
    const page = await browser.newPage();

    // Mobile viewport (iPhone 15 Pro equivalent)
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');

    // Anti-detection
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
      window.chrome = { runtime: {} };
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });

    // Auto-expand "more" / "See more" caption buttons
    try {
      await page.evaluate(() => {
        const moreButtons = document.querySelectorAll('button, span, a, div');
        for (const btn of moreButtons) {
          const text = (btn.textContent || '').trim().toLowerCase();
          if (text === 'more' || text === 'see more' || text === '… more') {
            btn.click();
            break;
          }
        }
      });
      await new Promise(r => setTimeout(r, 1000));
    } catch { /* caption may already be expanded */ }

    // Extract caption via Instagram-specific CSS selectors
    const caption = await page.evaluate(() => {
      const selectors = [
        '._a9zs span[dir="auto"]',
        'article div[dir="auto"]',
        '[data-testid="post-comment"] span',
        '.x9f619 span[dir="auto"]',
        'h1[dir="auto"]',
      ];
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const text = (el.textContent || '').trim();
          if (text.length > 30) return text;
        }
      }
      // Fallback: og:description
      const ogMeta = document.querySelector('meta[property="og:description"]');
      if (ogMeta) return ogMeta.getAttribute('content') || '';
      return '';
    });

    // Extract title from og:title
    const title = await page.evaluate(() => {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      return ogTitle ? (ogTitle.getAttribute('content') || '') : '';
    });

    // Extract carousel images via srcset (largest resolution)
    const imageUrls = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img[srcset], article img[src]');
      const urls = [];
      for (const img of imgs) {
        const src = img.src || '';
        if (src && src.startsWith('http') && !src.includes('profile_pic') && !src.includes('s150x150')) {
          urls.push(src);
        }
      }
      return [...new Set(urls)].slice(0, 5);
    });

    await browser.close();
    browser = null;

    const cleanedCaption = stripSocialMetaPrefix(caption || '');
    const cleanedTitle = cleanTitle(
      (title || '').replace(/\s*on\s+Instagram\s*$/i, '').replace(/\s*\(@[\w.]+\)\s*$/i, '').replace(/#\w[\w.]*/g, '').trim()
    );

    if (!cleanedCaption && !cleanedTitle) {
      return res.json({ ok: false, type: 'none', error: 'No content found' });
    }

    return res.json({
      ok: true,
      type: 'caption',
      caption: cleanedCaption,
      title: cleanedTitle,
      imageUrl: imageUrls[0] || '',
      imageUrls: imageUrls || [],
      subtitleText: '',
      sourceUrl: url,
      extractedVia: 'agent-puppeteer',
    });
  } catch (e) {
    if (browser) { try { await browser.close(); } catch {} }
    console.error(`[agent-browser] Puppeteer error: ${e.message}`);
    return res.json({ ok: false, type: 'none', error: e.message });
  }
});

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

// ── yt-dlp integration (Mealie-inspired video metadata + subtitle extraction) ─
// Uses yt-dlp to extract video metadata and subtitles from social media URLs.
// This replaces the fragile headless Chrome approach for platforms yt-dlp supports.
// Zero API cost — subtitles are free, no AI/transcription needed.
//
// Version pinning: Set YTDLP_VERSION env var to pin a specific release.
// Startup check will auto-install/upgrade if version mismatches.

const YTDLP_VERSION = process.env.YTDLP_VERSION || null; // e.g. '2025.03.31'
let _ytdlpAvailable = null;
let _ytdlpVersion = null;

/**
 * Lightweight yt-dlp wrapper — runs yt-dlp with given args via Python module.
 * Uses `python -m yt_dlp` instead of shell binary for better portability
 * (especially on Render/Railway where PATH may not include yt-dlp).
 *
 * Fallback: tries `yt-dlp` shell command if Python module fails.
 *
 * @param {string[]} args - Command-line arguments for yt-dlp
 * @param {object} opts - { timeout?: number, maxBuffer?: number, label?: string }
 * @returns {Promise<{ stdout: string, stderr: string } | null>} null on error
 */
function runYtdlp(args, opts = {}) {
  const {
    timeout = 30000,
    maxBuffer = 10 * 1024 * 1024,
    label = 'yt-dlp',
  } = opts;

  return new Promise((resolve) => {
    // Try Python module first (more reliable on cloud platforms)
    execFile('python', ['-m', 'yt_dlp', ...args], { timeout, maxBuffer }, (err, stdout, stderr) => {
      if (!err) {
        resolve({ stdout: stdout || '', stderr: stderr || '' });
        return;
      }
      // Fallback: try shell binary
      execFile('yt-dlp', args, { timeout, maxBuffer }, (err2, stdout2, stderr2) => {
        if (err2) {
          console.log(`[${label}] error: ${err.message} (Python) and ${err2.message} (shell)`);
          resolve(null);
          return;
        }
        resolve({ stdout: stdout2 || '', stderr: stderr2 || '' });
      });
    });
  });
}

/**
 * Check if yt-dlp is available and optionally verify/install pinned version.
 * Called at startup and cached thereafter.
 */
async function isYtdlpAvailable() {
  if (_ytdlpAvailable !== null) return _ytdlpAvailable;

  // Step 1: Check if yt-dlp exists
  const result = await runYtdlp(['--version'], { timeout: 5000, label: 'yt-dlp-check' });
  if (!result || !result.stdout.trim()) {
    // Not installed — attempt install if version is pinned
    if (YTDLP_VERSION) {
      console.log(`   yt-dlp not found — attempting install v${YTDLP_VERSION}...`);
      const installed = await installYtdlp(YTDLP_VERSION);
      if (installed) {
        _ytdlpAvailable = true;
        return true;
      }
    }
    console.log('   yt-dlp not found — video metadata extraction disabled');
    _ytdlpAvailable = false;
    return false;
  }

  _ytdlpVersion = result.stdout.trim();
  console.log(`   yt-dlp found: v${_ytdlpVersion}`);

  // Step 2: If version is pinned, check for mismatch
  if (YTDLP_VERSION && _ytdlpVersion !== YTDLP_VERSION) {
    console.log(`   yt-dlp version mismatch: have v${_ytdlpVersion}, want v${YTDLP_VERSION}`);
    const upgraded = await installYtdlp(YTDLP_VERSION);
    if (upgraded) {
      console.log(`   yt-dlp upgraded to v${YTDLP_VERSION}`);
    } else {
      console.log(`   yt-dlp upgrade failed — continuing with v${_ytdlpVersion}`);
    }
  }

  _ytdlpAvailable = true;
  return true;
}

/**
 * Install or upgrade yt-dlp to a specific version via pip.
 * Returns true on success, false on failure.
 */
function installYtdlp(version) {
  return new Promise((resolve) => {
    const pkg = version ? `yt-dlp==${version}` : 'yt-dlp';
    console.log(`   Installing ${pkg} via pip...`);
    exec(`pip install --break-system-packages "${pkg}" 2>&1 || pip install "${pkg}" 2>&1 || pip3 install "${pkg}" 2>&1`, {
      timeout: 120000, // 2 min for install
    }, (err, stdout) => {
      if (err) {
        console.log(`   yt-dlp install failed: ${err.message}`);
        resolve(false);
        return;
      }
      // Verify installation via Python module
      execFile('python', ['-m', 'yt_dlp', '--version'], { timeout: 5000 }, (err2, stdout2) => {
        if (err2 || !stdout2.trim()) {
          console.log('   yt-dlp install verification failed');
          resolve(false);
        } else {
          _ytdlpVersion = stdout2.trim();
          _ytdlpAvailable = true;
          console.log(`   yt-dlp installed: v${_ytdlpVersion}`);
          resolve(true);
        }
      });
    });
  });
}

/**
 * Extract video metadata via yt-dlp --dump-json (no download).
 * Returns { title, description, thumbnail, uploader, subtitles, duration } or null.
 */
async function extractVideoMeta(url) {
  if (!await isYtdlpAvailable()) return null;

  const result = await runYtdlp([
    '--dump-json',
    '--no-download',
    '--no-playlist',
    '--socket-timeout', '15',
    url,
  ], { timeout: 30000, label: 'yt-dlp-meta' });

  if (!result) return null;

  try {
    const info = JSON.parse(result.stdout);
    return {
      title: info.title || info.fulltitle || '',
      description: info.description || '',
      thumbnail: info.thumbnail || info.thumbnails?.[info.thumbnails.length - 1]?.url || '',
      uploader: info.uploader || info.channel || '',
      duration: info.duration || 0,
      subtitles: info.subtitles || {},       // manual subs
      autoSubs: info.automatic_captions || {}, // auto-generated subs
      webpage_url: info.webpage_url || url,
    };
  } catch (e) {
    console.log(`[yt-dlp-meta] JSON parse error: ${e.message}`);
    return null;
  }
}
// ── YouTube Recipe Metadata Extractor (yt-dlp) ─────────────────────────────
async function getYouTubeRecipeMetadata(url) {
  if (!ytDlp) {
    console.error('[yt-dlp] Not loaded');
    return null;
  }
  try {
    const output = await ytDlp(url, {
      dumpSingleJson: true,
      noWarnings: true,
      addHeader: [
        'referer:youtube.com',
        'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      ],
      writeDescription: true,
      skipDownload: true
    });

    const rawText = output.description 
      || output.caption 
      || (output.title ? output.title + '\n\n' + (output.automatic_captions?.en?.[0]?.text || '') : '');

    console.log(`[yt-dlp] Extracted metadata from ${url}`);
    return rawText.trim();
  } catch (err) {
    console.error('[yt-dlp] Extraction failed:', err.message);
    return null;
  }
}

/**
 * Download subtitles/captions for a video URL via yt-dlp.
 * Subtitle-only mode: --skip-download for minimal bandwidth.
 * Priority: manual English subs > auto-generated English subs.
 * Returns subtitle text string or null.
 */
async function downloadSubtitles(url, metaInfo = null) {
  if (!await isYtdlpAvailable()) return null;

  // Check if subtitles are available from metadata
  const meta = metaInfo || await extractVideoMeta(url);
  if (!meta) return null;

  const hasManualSubs = meta.subtitles && Object.keys(meta.subtitles).length > 0;
  const hasAutoSubs = meta.autoSubs && Object.keys(meta.autoSubs).length > 0;

  if (!hasManualSubs && !hasAutoSubs) {
    console.log('[yt-dlp] No subtitles available for this video');
    return null;
  }

  // Determine which subtitle languages are available
  const manualLangs = Object.keys(meta.subtitles || {});
  const autoLangs = Object.keys(meta.autoSubs || {});
  const preferManual = manualLangs.some(l => l.startsWith('en'));
  const hasEnAuto = autoLangs.some(l => l.startsWith('en'));

  if (!preferManual && !hasEnAuto) {
    // No English subs — try first available language
    if (manualLangs.length === 0 && autoLangs.length === 0) return null;
  }

  const tmpDir = path.join(os.tmpdir(), '.spicehub-subs-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const args = [
    '--skip-download',
    '--no-playlist',
    '--write-subs',
    '--write-auto-subs',
    '--sub-lang', 'en.*,en',
    '--sub-format', 'vtt/srt/best',
    '--convert-subs', 'srt',
    '-o', path.join(tmpDir, 'subs.%(ext)s'),
    '--socket-timeout', '15',
    url,
  ];

  const result = await runYtdlp(args, { timeout: 30000, maxBuffer: 5 * 1024 * 1024, label: 'yt-dlp-subs' });
  if (!result) {
    cleanup();
    return null;
  }

  // Find the subtitle file that was created
  try {
    const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.srt') || f.endsWith('.vtt'));
    if (files.length === 0) {
      console.log('[yt-dlp] No subtitle file created');
      cleanup();
      return null;
    }

    const subFile = path.join(tmpDir, files[0]);
    const raw = fs.readFileSync(subFile, 'utf8');
    cleanup();

    // Clean SRT/VTT format to plain text
    const plainText = cleanSubtitleText(raw);
    if (plainText.length < 20) {
      console.log('[yt-dlp] Subtitle text too short after cleaning');
      return null;
    }

    console.log(`[yt-dlp] Subtitles extracted: ${plainText.length} chars`);
    return plainText;
  } catch (e) {
    console.log(`[yt-dlp] subtitle read error: ${e.message}`);
    cleanup();
    return null;
  }

  function cleanup() {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
  }
}

/**
 * Clean SRT/VTT subtitle text to plain readable text.
 * Removes timestamps, sequence numbers, HTML tags, and deduplicates lines.
 */
function cleanSubtitleText(raw) {
  let cleaned = raw
    // Remove VTT header and metadata block
    .replace(/^WEBVTT[\s\S]*?\n\n/, '')
    // Remove NOTE blocks (VTT comments)
    .replace(/^NOTE[\s\S]*?\n\n/gm, '')
    // Remove STYLE blocks
    .replace(/^STYLE[\s\S]*?\n\n/gm, '')
    // Remove SRT sequence numbers (standalone digit lines)
    .replace(/^\d+\s*\n(?=[\d:.,-]+\s*-->)/gm, '')
    // Remove timestamp lines (SRT: "00:00:01,000 --> 00:00:03,000" / VTT: "00:00:01.000 --> 00:00:03.000")
    .replace(/^[\d:.,-]+\s*-->\s*[\d:.,-]+.*$/gm, '')
    // Remove VTT position/alignment/line cues
    .replace(/^(position|align|size|line|vertical|region):.*$/gm, '')
    // Remove HTML-like tags (<c>, <b>, <i>, <font>, etc.) and VTT cue tags
    .replace(/<\/?[^>]+>/g, '')
    // Remove VTT voice tags like <v Speaker Name>
    .replace(/<v\s+[^>]*>/g, '')
    // Remove [Music], [Applause], [Laughter], [MUSIC PLAYING], etc.
    .replace(/\[[\w\s]+\]/g, '')
    // Remove (music), (applause), etc.
    .replace(/\([\w\s]+\)/g, '')
    // Remove speaker labels like "SPEAKER 1:" or ">> "
    .replace(/^(?:SPEAKER\s*\d*|>>)\s*:?\s*/gmi, '')
    // Remove ♪ music note markers
    .replace(/[♪♫♬]+/g, '')
    // Collapse whitespace
    .replace(/\n{2,}/g, '\n');

  // Split into lines, clean, deduplicate
  const lines = cleaned.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    // Deduplicate consecutive identical lines (common in auto-subs)
    .filter((line, i, arr) => i === 0 || line !== arr[i - 1])
    // Remove near-duplicate lines where one is a prefix of the next
    // (YouTube auto-subs often show partial → full line pairs)
    .filter((line, i, arr) => {
      if (i === 0) return true;
      // If previous line is a strict prefix of this line, keep only this (the longer one)
      if (arr[i - 1] && line.startsWith(arr[i - 1]) && line.length > arr[i - 1].length + 3) {
        return true; // keep — but we need to mark the previous as skip
      }
      // If THIS line is a strict prefix of the next line, skip it
      if (i + 1 < arr.length && arr[i + 1] && arr[i + 1].startsWith(line) && arr[i + 1].length > line.length + 3) {
        return false; // skip — the next line has the full text
      }
      return true;
    });

  return lines.join(' ')
    // Collapse multiple spaces
    .replace(/\s{2,}/g, ' ')
    // Fix common punctuation issues from concatenation
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/([.!?])\s*([A-Z])/g, '$1 $2')
    .trim();
}

// ── Video URL detection (broader than social — includes any yt-dlp-supported site) ─
const VIDEO_HOSTS = [
  'youtube.com', 'youtu.be', 'tiktok.com', 'vm.tiktok.com',
  'instagram.com', 'facebook.com', 'fb.watch',
  'vimeo.com', 'dailymotion.com', 'twitch.tv',
];
function isVideoUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return VIDEO_HOSTS.some(d => host === d || host.endsWith('.' + d));
  } catch { return false; }
}

// ── GET /api/ytdlp-status ────────────────────────────────────────────────────
// Check if yt-dlp is available for video extraction
app.get('/api/ytdlp-status', async (req, res) => {
  const available = await isYtdlpAvailable();
  res.json({ ok: true, available });
});

// ── POST /api/extract-video ──────────────────────────────────────────────────
// Mealie-inspired video metadata + subtitle extraction endpoint.
// Uses yt-dlp to get metadata and subtitles without downloading the video.
// Zero cost — no AI, no API keys required.
// Returns structured data optimized for recipe parsing:
//   { ok, type, title, description, thumbnail, uploader, duration,
//     subtitleText, combinedText, hasSubtitles, sourceUrl,
//     platform, isShortForm, parsedRecipe }
//
// Optional Whisper path (progressive enhancement):
//   If WHISPER_ENABLED=true and no subtitles found, could transcribe audio.
//   Currently stubbed — uncomment when Whisper integration is desired.
app.post('/api/extract-video', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ ok: false, error: 'URL required' });

  console.log(`[extract-video] Processing: ${url}`);

  // Detect platform for frontend UX hints
  let platform = 'unknown';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.includes('instagram')) platform = 'instagram';
    else if (host.includes('tiktok')) platform = 'tiktok';
    else if (host.includes('youtube') || host === 'youtu.be') platform = 'youtube';
    else if (host.includes('facebook') || host === 'fb.watch') platform = 'facebook';
    else if (host.includes('vimeo')) platform = 'vimeo';
  } catch { }

  // 1. For Instagram, try embed page first (fast, no yt-dlp needed)
  if (platform === 'instagram') {
    const embedResult = await extractInstagramEmbed(url);
    if (embedResult && embedResult.ok && embedResult.caption && embedResult.caption.length > 30) {
      console.log(`[extract-video] Instagram embed succeeded — ${embedResult.caption.length} chars`);
      return res.json({
        ok: true,
        type: 'video-meta',
        title: embedResult.title || '',
        description: embedResult.caption || '',
        thumbnail: embedResult.imageUrl || '',
        uploader: '',
        duration: 0,
        subtitleText: '',
        combinedText: embedResult.caption || '',
        hasSubtitles: false,
        sourceUrl: url,
        platform,
        isShortForm: true,
        extractedVia: 'instagram-embed',
      });
    }
  }

  // 2. Get metadata via yt-dlp
  const meta = await extractVideoMeta(url);
  if (!meta) {
    return res.json({
      ok: false,
      error: 'Could not extract video metadata. yt-dlp may not be installed or the URL may not be supported.',
      platform,
    });
  }

  console.log(`[extract-video] Metadata: "${meta.title}" by ${meta.uploader} (${meta.duration}s)`);

  // Detect short-form video (Reels, Shorts, TikTok — typically < 3 min)
  const isShortForm = meta.duration > 0 && meta.duration < 180;

  // 3. Try to download subtitles
  const subtitleText = await downloadSubtitles(url, meta);

  // ── Optional: Whisper audio transcription (progressive enhancement) ──
  // Uncomment the block below to enable audio-only + Whisper transcription
  // when no subtitles are available. Requires:
  //   - WHISPER_ENABLED=true in environment
  //   - Either: OpenAI API key (OPENAI_API_KEY) for cloud Whisper
  //   - Or: local whisper binary (whisper.cpp or openai-whisper)
  //
  // let whisperText = null;
  // if (!subtitleText && process.env.WHISPER_ENABLED === 'true') {
  //   try {
  //     console.log('[extract-video] No subtitles — trying Whisper transcription...');
  //     const audioPath = await downloadAudioOnly(url); // yt-dlp -x --audio-format mp3
  //     if (audioPath) {
  //       if (process.env.OPENAI_API_KEY) {
  //         // Cloud Whisper via OpenAI API
  //         whisperText = await transcribeWithOpenAI(audioPath);
  //       } else {
  //         // Local Whisper binary fallback
  //         whisperText = await transcribeWithLocalWhisper(audioPath);
  //       }
  //       // Cleanup audio file
  //       try { fs.unlinkSync(audioPath); } catch {}
  //     }
  //   } catch (e) {
  //     console.log(`[extract-video] Whisper transcription failed: ${e.message}`);
  //   }
  // }
  // const transcriptText = subtitleText || whisperText || '';
  const transcriptText = subtitleText || '';

  // 4. Combine description + transcript for best results
  // Mealie pattern: description has ingredients, transcript has spoken directions
  let combinedText = '';
  if (meta.description && meta.description.length > 30) {
    combinedText = stripSocialMetaPrefix(meta.description);
  }
  if (transcriptText) {
    if (combinedText) {
      combinedText += '\n\nTranscript:\n' + transcriptText;
    } else {
      combinedText = transcriptText;
    }
  }

  return res.json({
    ok: true,
    type: 'video-meta',
    title: meta.title || '',
    description: stripSocialMetaPrefix(meta.description || ''),
    thumbnail: meta.thumbnail || '',
    uploader: meta.uploader || '',
    duration: meta.duration || 0,
    subtitleText: transcriptText,
    combinedText: combinedText || stripSocialMetaPrefix(meta.description || ''),
    hasSubtitles: !!transcriptText,
    sourceUrl: meta.webpage_url || url,
    platform,
    isShortForm,
    extractedVia: transcriptText ? 'yt-dlp-subtitles' : 'yt-dlp-metadata',
  });
}),

// ── POST /api/extract-url ────────────────────────────────────────────────────
// PRIMARY import endpoint — works from phone, desktop, anywhere.
// Strategy (Mealie-inspired unified pipeline):
//   1. Instagram URLs    → embed page first, then yt-dlp, then headless Chrome
//   2. Video URLs        → yt-dlp metadata + subtitles first, then headless Chrome
//   3. Other social URLs → yt-dlp first, then headless Chrome
//   4. Recipe blogs      → fast HTTP fetch + HTML parse (JSON-LD, OG tags)
app.post('/api/extract-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ ok: false, error: 'URL required' });

  // ── Instagram: try embed page first (fast, no browser needed) ──
  if (isInstagramUrl(url)) {
    const embedResult = await extractInstagramEmbed(url);
    if (embedResult && embedResult.ok && embedResult.caption) {
      return res.json(embedResult);
    }
    console.log('[extract-url] Instagram embed failed, trying yt-dlp...');
  }

  // ── Video/Social URLs: try yt-dlp metadata + subtitles first (Mealie-inspired) ──
  // yt-dlp is faster and more reliable than headless Chrome for supported sites.
  if (isVideoUrl(url) || isSocialUrl(url)) {
    const meta = await extractVideoMeta(url);
    if (meta && (meta.title || meta.description)) {
      console.log(`[extract-url] yt-dlp metadata: "${meta.title}" (${meta.duration}s)`);

      // Try to get subtitles too
      const subtitleText = await downloadSubtitles(url, meta);

      // Build combined text for caption parsing
      let captionText = '';
      if (meta.description && meta.description.length > 30) {
        captionText = meta.description;
      }
      if (subtitleText) {
        // Subtitles are often richer than descriptions for recipe content
        if (captionText) {
          captionText += '\n\nTranscript:\n' + subtitleText;
        } else {
          captionText = subtitleText;
        }
      }

      if (captionText && captionText.length > 20) {
        return res.json({
          ok: true,
          type: 'caption',
          caption: stripSocialMetaPrefix(captionText),
          title: meta.title || '',
          imageUrl: meta.thumbnail || '',
          sourceUrl: meta.webpage_url || url,
          hasSubtitles: !!subtitleText,
          extractedVia: 'yt-dlp',
        });
      }
    }

      // yt-dlp got metadata but no useful text — if we have a title + thumbnail,
      // return what we have (user can edit in preview)
      if (meta.title && meta.thumbnail) {
        return res.json({
          ok: true,
          type: 'video-meta',
          caption: meta.description || '',
          title: meta.title,
          imageUrl: meta.thumbnail,
          sourceUrl: meta.webpage_url || url,
          hasSubtitles: false,
          extractedVia: 'yt-dlp',
        });
      }
    }
    console.log('[extract-url] yt-dlp failed or insufficient, trying headless Chrome...');
  },


// ── Video/Social URLs: try yt-dlp metadata + subtitles first (Mealie-inspired) ──
// yt-dlp is faster and more reliable than headless Chrome for supported sites.
// ── POST /api/parse ───────────────────────────────────────────────────────────
// Main import endpoint used by ImportModal + BrowserAssist
app.post('/api/parse', async (req, res) => {
  const { url, type = 'recipe' } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'URL required' });

  // ── Video platforms (YouTube, etc.) → yt-dlp first (fastest + subtitles)
  if (isVideoUrl(url)) {
    const rawText = await getYouTubeRecipeMetadata(url);

    if (!rawText) {
      return res.status(400).json({
        success: false,
        error: 'Could not extract text from YouTube video'
      });
    }

    const recipe = await parseRecipe(rawText);

    return res.json({
      success: true,
      source: 'youtube',
      rawText,
      recipe,
      extractedVia: 'yt-dlp'
    });
  }

  // ── Social media (Instagram, TikTok, etc.) → headless fallback
  if (isSocialUrl(url)) {
    return extractWithHeadlessBrowser(url, res);
  }

  // ── Regular recipe blogs → fast HTTP fetch
  return extractWithHttpFetch(url, res);
}));

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
        Function.prototype.toString = function () {
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

      // ── Extract from rendered DOM — enhanced with recipe plugin detection ──
      const data = await page.evaluate(() => {
        // ── Recipe plugin detection (WPRM, Tasty, EasyRecipe, etc.) ──
        function extractRecipePlugins() {
          // WPRM (WP Recipe Maker)
          const wprmEl = document.querySelector('.wprm-recipe, [data-wprm-recipe]');
          if (wprmEl) {
            const title = wprmEl.querySelector('.wprm-recipe-name, h2.wprm-recipe-name, [itemprop="name"]')?.textContent?.trim() || '';
            const ings = [...wprmEl.querySelectorAll('.wprm-recipe-ingredient, li[itemprop="recipeIngredient"]')]
              .map(el => el.textContent?.trim()).filter(Boolean);
            const dirs = [...wprmEl.querySelectorAll('.wprm-recipe-instruction, li[itemprop="recipeInstructions"]')]
              .map(el => el.textContent?.trim()).filter(Boolean);
            const img = wprmEl.querySelector('.wprm-recipe-image img, img[itemprop="image"]');
            const imgUrl = img?.src || img?.getAttribute('data-src') || '';
            if (ings.length > 0 || dirs.length > 0) return { type: 'wprm', title, ingredients: ings, directions: dirs, imageUrl: imgUrl };
          }

          // Tasty Recipes
          const tastyEl = document.querySelector('.tasty-recipes, [data-tasty-recipe]');
          if (tastyEl) {
            const title = tastyEl.querySelector('.tasty-recipes-title, h2')?.textContent?.trim() || '';
            const ings = [...tastyEl.querySelectorAll('.tasty-recipes-ingredients li, li[itemprop="recipeIngredient"]')]
              .map(el => el.textContent?.trim()).filter(Boolean);
            const dirs = [...tastyEl.querySelectorAll('.tasty-recipes-instructions li, li[itemprop="recipeInstructions"]')]
              .map(el => el.textContent?.trim()).filter(Boolean);
            const img = tastyEl.querySelector('.tasty-recipes-image img, img');
            const imgUrl = img?.src || '';
            if (ings.length > 0 || dirs.length > 0) return { type: 'tasty', title, ingredients: ings, directions: dirs, imageUrl: imgUrl };
          }

          // EasyRecipe / Microdata
          const easyEl = document.querySelector('.EasyRecipeType, [itemtype*="Recipe"]');
          if (easyEl) {
            const title = easyEl.querySelector('[itemprop="name"], .ERSName, h2')?.textContent?.trim() || '';
            const ings = [...easyEl.querySelectorAll('[itemprop="recipeIngredient"], [itemprop="ingredients"], .ingredient')]
              .map(el => el.textContent?.trim()).filter(Boolean);
            const dirs = [...easyEl.querySelectorAll('[itemprop="recipeInstructions"] li, .instruction, .step')]
              .map(el => el.textContent?.trim()).filter(Boolean);
            const img = easyEl.querySelector('[itemprop="image"], img');
            const imgUrl = (img?.src || img?.getAttribute('content') || '');
            if (ings.length > 0 || dirs.length > 0) return { type: 'easyrecipe', title, ingredients: ings, directions: dirs, imageUrl: imgUrl };
          }

          // Common CSS patterns for recipe sites
          const cssSelectors = {
            ingredients: [
              '.recipe-ingredients li', '.ingredients li', '.ingredient-list li',
              '[class*="ingredient"] li', '[class*="Ingredient"] li',
              '.wprm-recipe-ingredient', '.tasty-recipe-ingredients li',
              'ul.ingredients li', 'ol.ingredients li',
            ],
            directions: [
              '.recipe-instructions li', '.instructions li', '.directions li', '.steps li',
              '[class*="instruction"] li', '[class*="direction"] li', '[class*="step"] li',
              '.recipe-method li', '.method li', '.preparation li',
            ],
          };

          let cssIngs = [];
          let cssDirs = [];
          for (const sel of cssSelectors.ingredients) {
            const els = document.querySelectorAll(sel);
            if (els.length > 0) { cssIngs = [...els].map(el => el.textContent?.trim()).filter(Boolean); break; }
          }
          for (const sel of cssSelectors.directions) {
            const els = document.querySelectorAll(sel);
            if (els.length > 0) { cssDirs = [...els].map(el => el.textContent?.trim()).filter(Boolean); break; }
          }
          if (cssIngs.length > 0 || cssDirs.length > 0) {
            const title = document.querySelector('h1, h2')?.textContent?.trim() || '';
            return { type: 'css-patterns', title, ingredients: cssIngs, directions: cssDirs, imageUrl: '' };
          }

          return null;
        }

        // 1. JSON-LD (recipe blogs — Schema.org Recipe)
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
          } catch { }
        }

        // 2. Try recipe plugin detection (DOM-based structured extraction)
        const pluginResult = extractRecipePlugins();
        if (pluginResult) {
          return {
            type: 'plugin',
            pluginType: pluginResult.type,
            recipe: {
              name: pluginResult.title,
              recipeIngredient: pluginResult.ingredients,
              recipeInstructions: pluginResult.directions.map(d => ({ text: d })),
              image: pluginResult.imageUrl || undefined,
            },
          };
        }

        // 3. Caption from rendered DOM (Instagram / TikTok specific selectors)
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

        // 4. OG meta fallback
        const ogTitle = document.querySelector('meta[property="og:title"]')?.content?.trim() || '';
        const ogDesc = document.querySelector('meta[property="og:description"]')?.content?.trim() || '';
        const ogImage = document.querySelector('meta[property="og:image"]')?.content?.trim() || '';

        // 5. Grab post image from rendered DOM (try multiple strategies)
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
              let src = '';
              if (el.srcset) {
                const parts = el.srcset.split(',').map(s => s.trim());
                const last = parts[parts.length - 1];
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
            } catch { }
          }
        }

        // 6. Detect login wall
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
      // Plugin extraction returns structured recipe data (same format as jsonld)
      const resultType = (data.type === 'jsonld' || data.type === 'plugin') ? 'jsonld' : 'caption';
      return res.json({
        ok: true,
        type: resultType,
        ...(resultType === 'jsonld' ? { recipe: data.recipe } : { caption }),
        title: title || '',
        imageUrl: data.imageUrl || '',
        sourceUrl: data.sourceUrl || url,
        ...(data.pluginType ? { pluginType: data.pluginType } : {}),
      });

    } catch (e) {
      console.error(`[extract-url headless] attempt ${attempt}:`, e.message);
      if (browser) try { await browser.close(); } catch { }
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

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 2: Agent-style automatic extraction (Instagram / social media)
// Runs headless Chrome with full automation — no user button click required.
//
// Key additions over extractWithHeadlessBrowser:
//   1. Mobile viewport (Instagram renders and exposes more on mobile user-agents)
//   2. Auto-expand truncated captions (clicks "more" / "See more" button)
//   3. Carousel image extraction (navigates through all slides)
//   4. Subtitle extraction via DOM JS eval for Reels (faster than yt-dlp)
//   5. Returns imageUrls[] array for the whole carousel
// ══════════════════════════════════════════════════════════════════════════════

async function extractWithAgentAuto(url) {
  let browser = null;
  try {
    const launchOpts = getLaunchOptions(true);
    browser = await puppeteer.launch(launchOpts);
    const page = await browser.newPage();

    // Mobile user-agent — Instagram serves more complete markup on mobile
    const mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1';
    await page.setUserAgent(mobileUA);
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

    // Anti-detection
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      delete navigator.__proto__.webdriver;
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    console.log(`[agent-auto] Navigating: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Adaptive wait for content to render
    try {
      await page.waitForSelector(
        'article, [data-e2e="video-desc"], main, ._a9zs, h1',
        { timeout: 8000 }
      );
    } catch { /* continue regardless */ }
    await new Promise(r => setTimeout(r, 2000));

    // ── Step 1: Auto-expand truncated caption ────────────────────────────────
    // Instagram shows "...more" link when caption is cut off; TikTok uses "See more"
    try {
      const expanded = await page.evaluate(() => {
        const moreSelectors = [
          // Instagram "...more" span
          '._a9zs span[role="button"]',
          'article span[role="button"]',
          // Button containing just "more" text
          'button:not([aria-label])',
          // TikTok "See more"
          '[data-e2e="video-desc"] span[role="button"]',
          '[data-e2e="view-more"]',
        ];
        for (const sel of moreSelectors) {
          const els = document.querySelectorAll(sel);
          for (const el of els) {
            const txt = el.textContent?.trim().toLowerCase();
            if (txt === 'more' || txt === 'see more' || txt === '...more' || txt === '… more') {
              el.click();
              return true;
            }
          }
        }
        return false;
      });
      if (expanded) await new Promise(r => setTimeout(r, 600));
    } catch { /* no expand needed */ }

    // ── Step 2: Subtitle/transcript extraction for Reels via DOM ────────────
    // Instagram Reels often have CC/subtitle text accessible in the DOM
    // This is faster than yt-dlp and works for short-form content
    let subtitleText = '';
    try {
      subtitleText = await page.evaluate(() => {
        const subSelectors = [
          // Instagram Reels CC / accessibility overlay
          '[class*="subtitle"]', '[class*="Subtitle"]',
          '[class*="caption"][class*="reel"]',
          '[aria-label*="subtitle"]',
          // YouTube auto-captions
          '.ytp-caption-segment',
          '#subtitle span',
          // TikTok captions
          '[data-e2e*="caption"]',
          '[class*="DivVideoSubtitle"]',
        ];
        const parts = [];
        for (const sel of subSelectors) {
          const els = document.querySelectorAll(sel);
          if (els.length > 0) {
            els.forEach(el => {
              const t = el.textContent?.trim();
              if (t && t.length > 5) parts.push(t);
            });
            if (parts.length > 0) break;
          }
        }
        return parts.join(' ').trim();
      });
    } catch { /* no subtitles */ }

    // ── Step 3: Full data extraction ────────────────────────────────────────
    const data = await page.evaluate(() => {
      // JSON-LD structured data (recipe blogs)
      function tryRecipe(obj) {
        if (!obj || typeof obj !== 'object') return null;
        if (Array.isArray(obj)) {
          for (const x of obj) { const r = tryRecipe(x); if (r) return r; }
          return null;
        }
        const t = [].concat(obj['@type'] || []).join(' ').toLowerCase();
        if (t.includes('recipe')) return obj;
        if (obj['@graph']) return tryRecipe(obj['@graph']);
        return null;
      }
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const r = tryRecipe(JSON.parse(s.textContent));
          if (r?.name) return { type: 'jsonld', recipe: r };
        } catch { }
      }

      // Caption from DOM selectors
      const captionSelectors = [
        'h1._ap3a', '._a9zs span', '._a9zs',
        'article h1', 'article div[dir="auto"]',
        'div[role="textbox"] span',
        '[data-bloks-name="igc.components.Text"]',
        '[data-e2e="video-desc"]', '[data-e2e="browse-video-desc"]',
        '.video-meta-title',
        '[data-testid="tweetText"]',
        '#description-inner',
      ];
      let caption = '';
      for (const sel of captionSelectors) {
        const el = document.querySelector(sel);
        const text = el?.innerText?.trim();
        if (text && text.length > 10) { caption = text; break; }
      }

      // OG meta fallback
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content?.trim() || '';
      const ogDesc = document.querySelector('meta[property="og:description"]')?.content?.trim() || '';
      const ogImage = document.querySelector('meta[property="og:image"]')?.content?.trim() || '';

      // Primary image — prefer OG (highest quality), then DOM search
      let imageUrl = ogImage;
      if (!imageUrl) {
        const imgSelectors = [
          'article img[srcset]', 'article img[src*="scontent"]',
          'article img[src*="cdninstagram"]', 'article video[poster]',
          'img._aagt', 'img[style*="object-fit"]', 'article img',
          'video[poster]',
        ];
        for (const sel of imgSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            let src = '';
            if (el.srcset) {
              const parts = el.srcset.split(',').map(s => s.trim());
              src = parts[parts.length - 1].split(/\s+/)[0];
            }
            if (!src) src = el.getAttribute('poster') || el.currentSrc || el.src;
            if (src && src.startsWith('http') && !/profile_pic|s150x150|s320x320/.test(src)) {
              imageUrl = src; break;
            }
          }
        }
      }

      const isLoginWall = !caption && !ogDesc &&
        (document.body?.innerText?.toLowerCase().includes('log in') ||
          document.body?.innerText?.toLowerCase().includes('sign in')) &&
        document.body?.innerText?.length < 5000;

      return {
        type: 'caption',
        caption: caption || ogDesc || '',
        title: ogTitle,
        imageUrl,
        sourceUrl: window.location.href,
        isLoginWall,
        // Detect carousel: Instagram shows navigation arrows on carousel posts
        isCarousel: !!(
          document.querySelector('[aria-label="Next"]') ||
          document.querySelector('button[aria-label*="Next"]') ||
          document.querySelectorAll('article img').length > 1
        ),
      };
    });

    if (data.isLoginWall && !data.caption) {
      return { isLoginWall: true };
    }

    // ── Step 4: Carousel — navigate through slides and collect all images ───
    const carouselImages = [data.imageUrl].filter(Boolean);
    if (data.isCarousel) {
      try {
        const seen = new Set(carouselImages);
        for (let slide = 0; slide < 9; slide++) { // max 10 slides
          const nextBtn = await page.$('[aria-label="Next"], button[aria-label*="Next"]');
          if (!nextBtn) break;

          await nextBtn.click();
          await new Promise(r => setTimeout(r, 600));

          const slideImg = await page.evaluate(() => {
            const selectors = ['article img[srcset]', 'article img', 'article video[poster]'];
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el) {
                let src = '';
                if (el.srcset) {
                  const parts = el.srcset.split(',').map(s => s.trim());
                  src = parts[parts.length - 1].split(/\s+/)[0];
                }
                if (!src) src = el.getAttribute('poster') || el.currentSrc || el.src;
                if (src && src.startsWith('http') && !/profile_pic|s150x150/.test(src)) return src;
              }
            }
            return null;
          });

          if (slideImg && !seen.has(slideImg)) {
            carouselImages.push(slideImg);
            seen.add(slideImg);
          } else if (slideImg && seen.has(slideImg)) {
            break; // wrapped around, done
          }
        }
      } catch { /* carousel extraction failed, use what we have */ }
    }

    return {
      ...data,
      subtitleText: subtitleText || '',
      imageUrls: carouselImages,
    };

  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}

// POST /api/extract-instagram-agent
// Phase 2 endpoint: automatic, no-click extraction for Instagram / social media.
// Returns caption, title, primary imageUrl, full imageUrls[] carousel array,
// and optional subtitleText for Reels.
app.post('/api/extract-instagram-agent', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ ok: false, error: 'url required' });

  console.log(`[extract-instagram-agent] ${url}`);

  try {
    const result = await extractWithAgentAuto(url);

    if (!result || result.isLoginWall) {
      return res.json({
        ok: true, type: 'none', isLoginWall: !!result?.isLoginWall, sourceUrl: url,
      });
    }

    if (!result.caption && !result.title) {
      return res.json({ ok: false, error: 'No content found' });
    }

    const caption = stripSocialMetaPrefix(result.caption || '');
    const title = (result.title || '')
      .replace(/\s*on\s+(Instagram|TikTok|Facebook|YouTube)\s*$/i, '')
      .replace(/\s*\(@[\w.]+\)\s*$/i, '')
      .replace(/#\w[\w.]*/g, '')
      .trim();

    return res.json({
      ok: true,
      type: result.type || 'caption',
      caption,
      title,
      imageUrl: result.imageUrls?.[0] || result.imageUrl || '',
      imageUrls: result.imageUrls || [],
      subtitleText: result.subtitleText || '',
      sourceUrl: result.sourceUrl || url,
      extractedVia: 'agent-auto',
    });
  } catch (e) {
    console.error('[extract-instagram-agent] Error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

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
        } catch { }
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
        try { const r = tryRecipe(JSON.parse(s.textContent)); if (r?.name) return { type: 'jsonld', recipe: r }; } catch { }
      }
      const sels = ['._a9zs span', '._a9zs', 'article div[dir="auto"]', 'div[role="textbox"]', '[data-e2e="video-desc"]'];
      for (const sel of sels) {
        const el = document.querySelector(sel);
        const text = el?.innerText?.trim();
        if (text && text.length > 20) return { type: 'caption', caption: text };
      }
      const og = document.querySelector('meta[property="og:description"]')?.content?.trim();
      if (og && og.length > 20) {
        // Also grab image
        let imageUrl = document.querySelector('meta[property="og:image"]')?.content?.trim() || '';
        if (!imageUrl) {
          const imgEl = document.querySelector('article img[srcset]') || document.querySelector('article img');
          if (imgEl) imageUrl = imgEl.src || '';
        }
        return { type: 'caption', caption: og, imageUrl };
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

// ── POST /api/structure-recipe ─────────────────────────────────────────────
//   Uses Google Gemini Flash to convert messy caption/subtitle text into a
//   clean recipe JSON: { title, ingredients:[{name,amount}], directions:[] }
//   Requires: GOOGLE_GENERATIVE_AI_API_KEY env var (free tier: 1500 req/day)
app.post('/api/structure-recipe', async (req, res) => {
  const { rawText, title: hintTitle, imageUrl } = req.body;
  if (!rawText || rawText.trim().length < 20) {
    return res.status(400).json({ error: 'rawText too short to structure' });
  }
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'GOOGLE_GENERATIVE_AI_API_KEY not configured on server' });
  }
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `You are a recipe extraction assistant. Convert the following messy social media post (which may include emojis, hashtags, promotional text, timestamps, and filler words) into a clean, structured recipe JSON.

Return ONLY valid JSON matching this exact schema:
{
  "title": "string — short recipe name (no hashtags or emojis)",
  "ingredients": [
    { "name": "string — ingredient name", "amount": "string — quantity and unit, e.g. '2 cups'" }
  ],
  "directions": ["string — one clear step per item"],
  "servings": "string or null",
  "cookTime": "string or null",
  "notes": "string or null — any tips, storage notes, or substitutions"
}

Rules:
- Remove all hashtags, @mentions, sponsor text, and filler phrases like "link in bio"
- Keep measurements precise; do not invent amounts if not given — use "to taste" or "as needed"
- Split compound steps into separate direction strings
- If the title hint is provided, use it as a starting point but clean it up
- If no clear recipe exists, return { "error": "not a recipe" }

${hintTitle ? `Title hint: "${hintTitle}"` : ''}

Raw text:
---
${rawText.slice(0, 6000)}
---`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // Strip markdown fences if Gemini wraps in ```json ... ```
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(jsonText);

    if (parsed.error) {
      return res.status(422).json({ error: parsed.error });
    }

    // Attach the image if we have one
    if (imageUrl) parsed.image = imageUrl;

    res.json({ ok: true, recipe: parsed });
  } catch (err) {
    console.error('[structure-recipe] Gemini error:', err.message);
    res.status(500).json({ error: 'AI structuring failed', detail: err.message });
  }
});

// ── Health check (for Render / Railway) ──────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, mode: IS_CLOUD ? 'cloud' : 'local' }));

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`\n🌶️  SpiceHub Recipe Server (${IS_CLOUD ? 'CLOUD' : 'LOCAL'} mode)`);
  console.log(`   Listening on port ${PORT}`);
  if (!IS_CLOUD) {
    const chromePath = findChrome();
    console.log(chromePath
      ? `   Chrome found: ${chromePath}`
      : '   ⚠️  Chrome not found — install from google.com/chrome');
  }
  // Check yt-dlp availability on startup (installs/upgrades if YTDLP_VERSION is set)
  if (YTDLP_VERSION) console.log(`   yt-dlp pinned version: ${YTDLP_VERSION}`);
  await isYtdlpAvailable();
  console.log('');
});
