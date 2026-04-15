

**yt-dlp Subtitle Extraction in SpiceHub – Senior Product Dev Breakdown**



As the senior product developer building SpiceHub's cross-platform (Windows/iOS/Android) offline-first PWA, here's the precise technical explanation of how Phase 0 (Video-First) works in the unified importRecipeFromUrl() engine you now have in recipeParser.js.

This phase is the secret sauce that makes Instagram Reels (and similar short-form video from TikTok/YouTube Shorts) magically turn into full recipes — even when the visible caption is just emojis and hashtags.

Why yt-dlp Subtitle Extraction First? (Usability \& Reliability)

Many creators narrate recipes while filming: “Start by chopping the onion… add garlic… simmer for 10 minutes…”

The on-screen Instagram caption is often thin (“Recipe in comments 👇” or just ingredients list).

yt-dlp extracts the spoken narration (auto-generated or uploaded captions) as clean text — giving us rich ingredient + direction content before we even touch the embed or AI browser.

This is Phase 0 because:



It's often the fastest successful path.

It works great on mobile (low data if we skip video download).

It dramatically reduces fallback to manual paste.

Keeps the app feeling delightful and “smart”.



How yt-dlp Subtitle Extraction Actually Works (Under the Hood)

yt-dlp is a powerful command-line tool (fork of youtube-dl) that supports 1800+ sites, including Instagram Reels, TikTok, YouTube Shorts, etc. It doesn't just download video — it can extract only metadata, audio, or subtitles without saving the full video file.

Core mechanism:



URL parsing \& extractor: yt-dlp identifies the platform (Instagram) and uses its site-specific extractor to fetch metadata JSON.

Subtitle detection: It checks for:

Uploaded/manual subtitles (--write-subs)

Auto-generated captions (--write-auto-subs) — this is key for most Reels, as Instagram auto-creates them from speech.



Download only subs: With --skip-download, yt-dlp avoids downloading the video bytes. It only grabs the subtitle track (often in VTT, SRT, or TTML format).

Conversion: --convert-subs srt or vtt turns the raw timed captions into readable text.

Language targeting: --sub-langs en or --sub-langs "en.\*" prefers English (auto or manual).



Typical options used in recipe import tools (what we emulate in tryVideoExtraction()):



\--write-auto-subs — grab auto-generated narration

\--skip-download — no video file (saves bandwidth/storage)

\--sub-format srt or vtt

\--sub-langs en

\--quiet or --no-warnings for clean PWA integration

Sometimes --cookies-from-browser or login cookies for private/restricted Reels (we avoid this for simplicity in client-side flows)



Output example (after extraction):

A .srt or .vtt file containing timed lines like:

text00:00:01.000 --> 00:00:05.000

First, heat the oil in a large pan.



00:00:06.000 --> 00:00:12.000

Add the chopped onions and garlic. Stir until golden.

In tryVideoExtraction() we then:



Parse the file into plain text (strip timestamps).

Run hasRealContent() — checks length + recipe keywords (ingredient, add, mix, bake, etc.).

If good → feed directly into cleanSocialCaption() + structureWithAI().



Implementation Notes for SpiceHub (Production-Grade)

In the unified engine (recipeParser.js you just received):

JavaScriptconst videoResult = await tryVideoExtraction(url, progressCallback);

if (videoResult \&\& hasRealContent(videoResult.text)) {

&#x20; rawText = videoResult.text;

&#x20; bestImage = videoResult.bestImage || null;

}

How tryVideoExtraction is typically wired (you can implement or already have via backend helper):



Client-side light path: Use a small Node.js/Edge runtime call or WebAssembly version if available (rare).

Preferred: Lightweight backend endpoint (or your existing RecipeBulkScraperService / BrowserAssist agent) that runs yt-dlp with the options above.

Offline-first: Queue the URL if offline; sync when back online.

Progress feedback: Callback fires “Trying video subtitles (great for Reels)…” so the user sees instant activity in BrowserAssist.jsx.

Image bonus: yt-dlp metadata often includes thumbnail URLs — we pick the best one via selectBestImage().



Limitations (2026 reality – be transparent for max usability):



Instagram does not always expose clean subtitle tracks to yt-dlp (some Reels return “no subtitles available”).

Auto-captions can be inaccurate (accents, background noise, fast speech).

Rate limits / login walls can trigger on heavy use → that’s why we fallback gracefully to Phase 1 (embed) and Phase 2 (AI Browser).

Video download is avoided to keep the PWA storage-conscious and fast on mobile.



This is why the full pipeline is Video → Embed → Agent → Gemini — layered defense for reliability.

Integration Impact on SpiceHub



Maximum simplicity: User pastes Reel link → often done in <5 seconds with full structured recipe.

Interactivity: Progress stepper in BrowserAssist.jsx clearly shows “Phase 0: Video subtitles…” so users trust the process.

Cross-platform: Works identically on iOS PWA, Android, Windows desktop.

Parse from other apps: Share-target handler now routes through this same importRecipeFromUrl() — seamless from Instagram app share.

