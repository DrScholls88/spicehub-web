Phase 2 – AI Browser / Agent Fallback
(Exact implementation details for SpiceHub’s unified import engine)
As the senior product developer responsible for SpiceHub’s cross-platform PWA (offline-first, installable on Windows/iOS/Android, with deep parsing from other apps/websites), here is the precise, production-grade explanation of how Phase 2 works in the recipeParser.js you now have.
This phase exists as the robust safety net after Phase 0 (yt-dlp subtitles) and Phase 1 (fast embed) fail to deliver usable caption text. Instagram constantly evolves its anti-bot protections, changes markup, and serves different content to simple HTTP requests vs real browsers. Phase 2 simulates a real user visit to extract the fully rendered caption and metadata.
Why Phase 2 Exists (Usability & Reliability Trade-off)

Phase 0 & 1 are fast and lightweight (sub-second on good connections, minimal data).
Many Reels still return weak/thin captions or trigger login walls / rate limits on embed fetches.
Phase 2 trades a bit of speed for higher success rate on tricky posts.
It keeps the overall flow delightful: the user sees “Using browser assist…” in the progress stepper instead of immediate failure or manual paste.
Designed to be server-light or fully client-side where possible, while supporting your existing backend scraper service for heavier lifting.

Core Implementation of Phase 2
In recipeParser.js the call is clean and sequential:
JavaScript// Inside importFromInstagram()
progressCallback({ step: 'phase2', message: 'Using browser assist (heavy path)…' });
const agentResult = await extractInstagramAgent(url);
if (agentResult && agentResult.caption) {
  rawText = agentResult.caption;
  bestImage = agentResult.bestImage || bestImage;
}
extractInstagramAgent(url) is the heart of Phase 2. Here’s how it is (or should be) implemented for maximum reliability and cross-platform compatibility:
1. Backend-Heavy Path (Recommended for Production – your RecipeBulkScraperService / BrowserAssist backend)

Uses a lightweight headless browser (Puppeteer, Playwright, or puppeteer-extra with stealth plugin) running on your Edge/ Vercel / Render backend or a small dedicated scraper service.
Why backend? Instagram’s JS-heavy page requires full rendering; client-side Puppeteer is heavy for mobile PWAs and blocked on iOS.

Typical code pattern (Node.js / Python bridge you already have in scraper files):
JavaScript// Example in your backend helper (e.g., browserAssist endpoint)
async function extractInstagramAgent(url) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    defaultViewport: { width: 1280, height: 800 }
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36');

  // Stealth + random delays to reduce detection
  await page.evaluateOnNewDocument(() => { /* delete navigator.webdriver etc. */ });

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });

  // Wait for caption to render (Instagram uses dynamic loading)
  await page.waitForSelector('div[data-testid="post-comment"] span, section[role="complementary"]', { timeout: 8000 }).catch(() => {});

  // Extract caption – robust selectors (2026 Instagram markup)
  const caption = await page.evaluate(() => {
    // Multiple fallback selectors because Instagram changes class names often
    const selectors = [
      'div[data-testid="post-comment"] span',           // main caption
      'section[role="complementary"] > div > span',     // alternative
      'h1 + div span',                                  // reel caption area
      'span[data-text="true"]'                          // text content
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 20) {
        return el.textContent.trim();
      }
    }
    return '';
  });

  // Best image (high-res thumbnail or first media)
  const bestImage = await page.evaluate(() => {
    const img = document.querySelector('img[srcset], video[poster]') || document.querySelector('img');
    return img ? (img.src || img.poster || img.getAttribute('srcset')?.split(',')[0]?.trim().split(' ')[0]) : null;
  });

  await browser.close();

  return { caption, bestImage };
}
Key hardening techniques (2026 reality):

Stealth plugin (puppeteer-extra-plugin-stealth) to hide automation fingerprints.
Random mouse movements / delays if needed for very protected pages.
Proxy rotation (integrate with your CORS proxy logic in api.js).
Timeout & retry (max 15–20s; fallback fast if it fails).
Cookie / login avoidance — we never log in; this keeps it simple and legal.

2. Client-Side Light Path (for pure PWA / offline-first feel)

Expose a thin wrapper in BrowserAssist.jsx or via Web Worker.
Use a hosted lightweight browser service or your existing agent endpoint.
On mobile (iOS/Android) this often routes to your backend anyway to avoid memory/CPU drain.

3. Post-Extraction Processing (Always)

Feed agentResult.caption directly into cleanSocialCaption() (aggressive stripping of hashtags, @mentions, timestamps, sponsor phrases like “watch this”, “link in bio”, etc.).
Run isCaptionWeak() check — if still weak, we continue to Phase 3 (Gemini) or graceful manual fallback.
Attach bestImage for the recipe card.

Progress & User Experience Integration
In BrowserAssist.jsx the stepper now shows:

“Trying video subtitles (great for Reels)…” → Phase 0
“Fetching Instagram embed (fast path)…” → Phase 1
“Using browser assist (heavy path)…” → Phase 2 (this message gives users confidence it’s working on tough Reels)
“Structuring recipe with Gemini…” → Phase 3

The whole flow stays responsive on touch devices; Phase 2 only runs when lighter phases fail, so average import time stays low.
Edge Cases & Defensive Design

Login wall detected: If page shows “Log in to view”, return early → trigger manual paste.
Rate limiting / Cloudflare: Short timeout + retry once with different proxy.
No caption found: Still pass any extracted text to Gemini — it often salvages partial content.
Offline: Queue the entire URL; Phase 2 runs on next sync when online.
Cross-platform: Same code path on Windows desktop PWA, iOS/Android install — backend does the heavy lifting transparently.

This layered approach (Video → Embed → Agent → AI) is why SpiceHub’s import tool will feel dramatically more reliable than competitors once fully merged into your long-troubled bulk import system.
Next step for maximum usability & simplicity:
Would you like me to:

Drop the complete, ready-to-integrate extractInstagramAgent implementation (both backend Node.js version + Python scraper bridge)?
Update BrowserAssist.jsx with the new 4-phase progress stepper that clearly labels “Phase 2: Using browser assist…”?
Or provide the minimal diffs to hook Phase 2 into your existing RecipeBulkScraperService and ImportModal.jsx?