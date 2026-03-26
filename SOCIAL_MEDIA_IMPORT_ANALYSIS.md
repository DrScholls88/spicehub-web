# Social Media Recipe Import: Mealie PR Analysis & SpiceHub Recommendations

## Executive Summary

Mealie's PR introduces **AI-powered video-to-recipe extraction** using `yt-dlp` + `ffmpeg` + OpenAI Whisper + LLM parsing. SpiceHub currently handles social media through **headless Chrome scraping of captions** with heuristic parsing — no video/audio processing at all. This document compares the two approaches and recommends how SpiceHub can incorporate the most valuable ideas.

---

## What Mealie's PR Does

### The Core Problem It Solves
Many modern recipes exist only as **spoken instructions in videos** (Instagram Reels, TikTok, YouTube Shorts) with no written caption. Mealie's existing web scraper can't extract anything useful because there's no text on the page — the recipe lives in the audio track.

### Mealie's Architecture (3-Stage Pipeline)

**Stage 1 — Metadata Extraction (`yt-dlp`)**
- Downloads video title, description, and thumbnail — NOT the full video
- `yt-dlp` handles authentication, geo-restrictions, and platform-specific quirks across Instagram, TikTok, Facebook, YouTube
- Zero bandwidth for the video itself at this stage

**Stage 2 — Smart Transcription (Priority-Based)**
- **Priority 1:** Download official subtitles/captions if they exist (free, fast, accurate)
- **Priority 2:** Download audio-only stream, convert to lightweight mono MP3 via `ffmpeg`, send to OpenAI Whisper for transcription
- Key insight: they never download the full video — just the audio track, then compress it aggressively

**Stage 3 — LLM Recipe Generation**
- Sends video metadata (title, description) + transcript to an LLM (GPT-4o by default)
- LLM parses unstructured spoken content into structured recipe JSON (name, ingredients with quantities, step-by-step directions)
- This is where the magic happens — the LLM understands context like "a splash of olive oil" or "cook until golden" and structures it properly

### Mealie's Integration Strategy
- Same page as the classic URL import — no separate "video import" flow
- Workflow: Try classic web scraper first → if it fails, try video URL scraper
- Works with their bulk importer too
- Configurable via env vars (`OPENAI_ENABLE_TRANSCRIPTION_SERVICES`)

### Docker Changes
- Added `ffmpeg` to Dockerfile (already present in their devcontainer)
- `yt-dlp` installed as a Python dependency
- Both are lightweight, zero resources when idle

---

## SpiceHub's Current Approach

### What SpiceHub Does Well
1. **Caption-based extraction works for most social media recipes** — the majority of Instagram/TikTok recipe posts DO have written captions
2. **Cascading fallback strategy** is robust: Instagram embed → Headless Chrome → Manual paste
3. **Heuristic parser (parseCaption)** is sophisticated — 80+ cooking verbs, 100+ food words, section header detection, smart title extraction
4. **No external API costs** — fully self-contained
5. **Client-side operation** means no server infrastructure needed for basic imports

### Where SpiceHub Falls Short
1. **Video-only recipes** (no caption) are completely unimportable — the user gets nothing
2. **Short/lazy captions** ("Recipe in video! 🔥") give terrible results
3. **Spoken quantities are lost** — even when a caption lists ingredients, it often omits measurements that are only spoken in the video
4. **No YouTube support** — YouTube descriptions rarely contain full recipes; the recipe is in the video
5. **Instagram login walls** remain a persistent problem despite the embed extraction + headless Chrome cascade
6. **CORS proxy fragility** — the 3 public CORS proxies can go down or start blocking

---

## Feature-by-Feature Comparison

| Feature | Mealie (PR) | SpiceHub (Current) |
|---|---|---|
| Blog URL import | ✅ Web scraper (JSON-LD, etc.) | ✅ Web scraper (JSON-LD, microdata, heuristics) |
| Social caption extraction | ✅ via yt-dlp metadata | ✅ via headless Chrome / embed |
| Video transcription | ✅ Whisper API or subtitles | ❌ Not supported |
| AI recipe structuring | ✅ LLM (GPT-4o) | ❌ Heuristic parsing only |
| Image OCR import | ✅ OpenAI Vision | ✅ Tesseract.js (client-side) |
| Paste text import | ❌ Not mentioned | ✅ Paste Text tab |
| Spreadsheet import | ❌ Not in this PR | ✅ CSV/Excel import |
| Paprika migration | ✅ Separate feature | ✅ Full .paprikarecipes support |
| Bulk import | ✅ Works with video URLs | ❌ One URL at a time |
| Platform support | Instagram, TikTok, Facebook, YouTube (via yt-dlp — hundreds of sites) | Instagram, TikTok (headless Chrome selectors) |
| Infrastructure | Docker container, Python backend | Client-side + optional Express server |
| API costs | OpenAI Whisper + GPT-4o per import | $0 |
| Offline capable | ❌ Requires API | ✅ Client-side works offline |

---

## Recommendations for SpiceHub

### Tier 1: Quick Wins (No AI Required)

#### 1A. Add `yt-dlp` Metadata Extraction to the Server
**Effort:** Medium | **Impact:** High

SpiceHub's Express server could use `yt-dlp` (available as an npm wrapper: `yt-dlp-wrap` or shell exec) to extract video metadata — title, description, thumbnail — without downloading any video. This would:
- Replace the fragile headless Chrome approach for TikTok, YouTube, Facebook
- Work reliably without anti-detection hacks
- Extract richer metadata than Chrome scraping (full descriptions, hashtags, timestamps)

```javascript
// Conceptual addition to server/index.js
app.post('/api/extract-video-meta', async (req, res) => {
  const { url } = req.body;
  // yt-dlp --dump-json --no-download <url>
  const meta = await ytdlp.getVideoInfo(url);
  res.json({
    title: meta.title,
    description: meta.description,
    thumbnail: meta.thumbnail,
    subtitles: meta.subtitles,  // If available
    duration: meta.duration,
  });
});
```

**Why this matters:** `yt-dlp` supports 1000+ sites and handles all the platform-specific extraction logic that SpiceHub currently re-invents with CSS selectors and anti-detection. It's battle-tested by millions of users.

#### 1B. Download Subtitles/Captions When Available
**Effort:** Low (if 1A is done) | **Impact:** High

Many YouTube videos and some TikToks have auto-generated or manual subtitles. `yt-dlp` can download these directly — no AI needed. Feed the subtitle text through SpiceHub's existing `parseCaption()` parser and you get structured recipes from video content for free.

```bash
yt-dlp --write-subs --write-auto-subs --sub-lang en --skip-download --sub-format vtt <url>
```

#### 1C. Improve the Heuristic Parser for Video Descriptions
**Effort:** Low | **Impact:** Medium

YouTube descriptions often have timestamps (e.g., "2:30 - Add the garlic"). SpiceHub's `parseCaption()` could detect these and use them as step separators. Similarly, TikTok descriptions often have abbreviated formats ("1c flour, 2 eggs, mix & bake 350° 25min") that could benefit from additional pattern matching.

### Tier 2: AI-Enhanced Import (Matches Mealie)

#### 2A. Add OpenAI Whisper Transcription
**Effort:** High | **Impact:** Very High

This is the flagship feature of Mealie's PR. The workflow:
1. `yt-dlp` downloads audio-only stream
2. `ffmpeg` converts to lightweight mono MP3 (reduces file size ~90%)
3. Send to OpenAI Whisper API for transcription
4. Feed transcript through parser

**SpiceHub considerations:**
- This requires a backend (the Express server) — can't run client-side
- OpenAI Whisper API costs ~$0.006/minute of audio — a 60-second reel costs less than a penny
- Users would need to provide their own OpenAI API key (or SpiceHub could offer a hosted tier)
- Alternative: use a free/local transcription model (e.g., whisper.cpp via WASM) for client-side operation, though quality and speed would suffer

#### 2B. Add LLM Recipe Structuring
**Effort:** Medium (if 2A is done) | **Impact:** Very High

This is what elevates Mealie's approach from "transcription" to "recipe import." The LLM takes messy spoken text like:

> "So first you're gonna want to get about two cups of flour, and then a half cup of sugar, throw in some butter — maybe like a stick — and then..."

And produces:
```json
{
  "ingredients": ["2 cups flour", "½ cup sugar", "1 stick butter"],
  "directions": ["Combine flour, sugar, and butter..."]
}
```

**SpiceHub could:**
- Use GPT-4o-mini for cost efficiency (~$0.001 per recipe)
- Make it optional — only triggered when heuristic parsing fails or for video URLs
- Fall back to `parseCaption()` if no API key is configured
- Use the same API key for both Whisper and GPT

#### 2C. Enhance Image OCR with AI Vision
**Effort:** Medium | **Impact:** Medium

SpiceHub currently uses Tesseract.js for OCR, which struggles with handwritten recipes, poor lighting, or stylized fonts. Mealie uses OpenAI Vision which handles these cases much better. SpiceHub could offer this as an optional enhancement when an API key is available.

### Tier 3: Architecture Overhaul

#### 3A. Unified Import Pipeline (Mealie's Best Idea)
**Effort:** High | **Impact:** High

Mealie's smartest design choice is the **unified import page** — one URL input that auto-detects and routes:
1. Is it a recipe blog? → Web scraper
2. Is it a video URL? → Video pipeline (metadata → subtitles/transcription → LLM)
3. Did the web scraper fail? → Try video pipeline as fallback
4. Everything failed? → Show what we got + let user edit

SpiceHub already partially does this (URL tab tries different strategies), but could formalize it into a cleaner pipeline with explicit fallback stages and user-visible progress.

#### 3B. Progressive Enhancement Pattern
**Effort:** Medium | **Impact:** High

Make the entire AI pipeline optional and progressive:
- **No API key:** Heuristic parsing only (current behavior)
- **API key provided:** Enable Whisper transcription + LLM structuring
- **Local model:** WASM-based Whisper for privacy-conscious users

This preserves SpiceHub's key advantage (zero-cost, client-side operation) while offering AI power for users who want it.

#### 3C. Add `ffmpeg` + `yt-dlp` to Server Docker Image
**Effort:** Low | **Impact:** Enables 2A/2B

If SpiceHub ever containerizes its server (for self-hosted users), adding `ffmpeg` and `yt-dlp` to the Dockerfile is trivial — Mealie already proved this works with minimal footprint.

```dockerfile
RUN apt-get update && apt-get install -y ffmpeg
RUN pip install yt-dlp
```

---

## Recommended Implementation Order

### Phase 1: No-Cost Improvements (1-2 weeks)
1. **1C** — Improve parseCaption() for video descriptions (timestamp parsing, abbreviated formats)
2. **1A** — Add yt-dlp metadata extraction to Express server
3. **1B** — Auto-download and parse subtitles when available

### Phase 2: AI Integration (2-4 weeks)
4. **3B** — Design the progressive enhancement API key system
5. **2A** — Whisper transcription pipeline
6. **2B** — LLM recipe structuring
7. **3A** — Unify the import pipeline with clear fallback stages

### Phase 3: Polish (1-2 weeks)
8. **2C** — AI-enhanced image OCR (optional)
9. Bulk import support for video URLs
10. User-visible progress indicators for multi-stage extraction

---

## Key Takeaways

1. **Mealie's biggest innovation is using AI to bridge the gap between spoken and written recipes.** SpiceHub's heuristic parsing is excellent for written captions but fundamentally can't extract recipes from video content.

2. **The subtitle download trick is the highest-value, lowest-cost feature to adopt.** Many videos have subtitles — using `yt-dlp` to grab them and feeding through parseCaption() requires no AI and no API costs.

3. **`yt-dlp` should replace headless Chrome for social media extraction.** It's more reliable, faster, cheaper, and supports 1000+ sites vs. SpiceHub's handful of CSS selectors.

4. **AI integration should be optional.** SpiceHub's client-side, zero-cost model is a competitive advantage. AI features should enhance, not replace, the existing system.

5. **Mealie's "try scraper first, then video pipeline" approach is the right UX.** Users shouldn't have to know whether a URL is a blog or a video — the system should figure it out.
