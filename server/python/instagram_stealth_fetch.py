#!/usr/bin/env python3
"""
instagram_stealth_fetch: use playwright-stealth to fetch an Instagram post/reel.
Emits {ok, caption, imageUrls[], error?} JSON. Reads {url: str} from stdin.
Always exits 0.

Cookie loading:
  IG_COOKIES_JSON_B64 env var — Base64-encoded JSON array of cookie dicts
  (Netscape/playwright format: {name, value, domain, path, ...})

Video frame extraction:
  For Reels, seeks to max(1, min(duration*0.75, 8)) seconds and captures a frame
  via JavaScript canvas drawImage. Falls back to og:image/video poster on
  SecurityError (cross-origin canvas taint).
"""
import asyncio
import base64
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from playwright.async_api import async_playwright
    from playwright_stealth import stealth_async
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False


# ── Cookie loading ─────────────────────────────────────────────────────────────

def load_cookies() -> list[dict]:
    """Decode IG_COOKIES_JSON_B64 env var into a list of cookie dicts."""
    b64 = os.environ.get("IG_COOKIES_JSON_B64", "").strip()
    if not b64:
        return []
    try:
        decoded = base64.b64decode(b64).decode("utf-8")
        cookies = json.loads(decoded)
        if not isinstance(cookies, list):
            return []
        return cookies
    except Exception:
        return []


# ── Video frame extraction ─────────────────────────────────────────────────────

FRAME_JS = """
async (targetSec) => {
  const video = document.querySelector('video');
  if (!video) return null;

  // Wait for video metadata to load
  if (video.readyState < 1) {
    await new Promise((resolve, reject) => {
      video.addEventListener('loadedmetadata', resolve, { once: true });
      setTimeout(() => reject(new Error('metadata timeout')), 5000);
    });
  }

  const seekTo = Math.max(1, Math.min(video.duration * 0.75, targetSec));

  await new Promise((resolve, reject) => {
    video.currentTime = seekTo;
    video.addEventListener('seeked', resolve, { once: true });
    setTimeout(() => reject(new Error('seek timeout')), 5000);
  });

  const canvas = document.createElement('canvas');
  canvas.width  = video.videoWidth  || 640;
  canvas.height = video.videoHeight || 640;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}
"""


async def extract_video_frame(page, target_sec: float = 8.0) -> str | None:
    """Try to grab a frame from the Reel video. Returns data URL or None."""
    try:
        result = await page.evaluate(FRAME_JS, target_sec)
        if result and result.startswith("data:image"):
            return result
    except Exception:
        pass
    return None


# ── Caption extraction ─────────────────────────────────────────────────────────

async def extract_caption(page) -> str:
    """Pull the post caption from the page. Tries multiple selectors."""
    selectors = [
        'meta[property="og:description"]',
        'div[data-testid="post-comment-root"] span',
        'article div._a9zs span',
        'div.C4VMK span',
        'span[class*="_aacl"]',
    ]
    caption = ""

    # og:description is most reliable
    try:
        meta = await page.query_selector('meta[property="og:description"]')
        if meta:
            content = await meta.get_attribute("content")
            if content and len(content) > 20:
                caption = content
    except Exception:
        pass

    # Fallback: try visible span elements in the post article
    if not caption:
        for sel in selectors[1:]:
            try:
                el = await page.query_selector(sel)
                if el:
                    text = await el.inner_text()
                    if text and len(text) > 20:
                        caption = text
                        break
            except Exception:
                continue

    return caption.strip()


async def extract_image_urls(page) -> list[str]:
    """Collect image URLs from og:image and visible img tags."""
    urls: list[str] = []
    try:
        meta = await page.query_selector('meta[property="og:image"]')
        if meta:
            src = await meta.get_attribute("content")
            if src:
                urls.append(src)
    except Exception:
        pass

    # Also grab video poster as fallback
    try:
        video = await page.query_selector("video")
        if video:
            poster = await video.get_attribute("poster")
            if poster and poster not in urls:
                urls.append(poster)
    except Exception:
        pass

    return urls


# ── Main fetch ─────────────────────────────────────────────────────────────────

async def fetch(url: str) -> dict:
    if not PLAYWRIGHT_AVAILABLE:
        return {"ok": False, "error": "playwright or playwright-stealth not installed"}

    cookies = load_cookies()

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
            ],
        )
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
            ),
            viewport={"width": 390, "height": 844},
            locale="en-US",
        )

        if cookies:
            try:
                await context.add_cookies(cookies)
            except Exception:
                pass  # bad cookie format — proceed without

        page = await context.new_page()
        await stealth_async(page)

        # Block heavyweight resources to cut fetch time by 2-3s
        async def _block_unnecessary(route):
            if route.request.resource_type in {"image", "stylesheet", "font", "media", "other"}:
                await route.abort()
            else:
                await route.continue_()
        await page.route("**/*", _block_unnecessary)

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            # Give JS a moment to hydrate
            await page.wait_for_timeout(2500)
        except Exception as e:
            await browser.close()
            return {"ok": False, "error": f"navigation-failed: {e}"}

        # Check for login wall
        login_selectors = ['input[name="username"]', 'button[type="submit"][data-testid="royal_login_button"]']
        for sel in login_selectors:
            el = await page.query_selector(sel)
            if el:
                await browser.close()
                return {"ok": False, "error": "login-wall"}

        caption = await extract_caption(page)
        image_urls = await extract_image_urls(page)

        # Try video frame for Reels
        frame_data_url = await extract_video_frame(page, target_sec=8.0)
        if frame_data_url:
            # Prepend so firstImageUrl prefers it (data URLs win over http)
            image_urls = [frame_data_url] + image_urls

        await browser.close()

        if not caption and not image_urls:
            return {"ok": False, "error": "no-content-extracted"}

        return {"ok": True, "caption": caption, "imageUrls": image_urls}


def main():
    raw = sys.stdin.read() or "{}"
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        payload = {}

    url = payload.get("url")
    if not url:
        print(json.dumps({"ok": False, "error": "no-url"}))
        return

    result = asyncio.run(fetch(url))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
