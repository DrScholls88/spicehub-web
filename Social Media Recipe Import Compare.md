# Social Media Recipe Import Comparison: Mealie vs Paprika

**Last Updated**: April 2026  
**Goal**: Understand how the two leading recipe managers handle Instagram, TikTok, YouTube, and other social/video content so we can make SpiceHub's import experience superior.

## 1. Mealie (Self-Hosted, Open Source)

Mealie has evolved significantly with **PR #6764** (v3.13+) and now offers strong native support for social media and video imports.

### How Mealie Does It
- **Unified Import Flow**: User pastes any URL (blog, Instagram Reel, TikTok, YouTube, Facebook) into the standard "Import Recipe" field.
- **Core Technology Stack**:
  - **yt-dlp**: Extracts metadata, title, description, thumbnail, and subtitles (no full video download in subtitle mode).
  - **Subtitles First**: Tries official + auto-generated subtitles (`--write-subs --write-auto-subs --sub-lang en`).
  - **Audio Transcription (when needed)**: Downloads lightweight audio-only stream → converts with `ffmpeg` → sends to **OpenAI Whisper** (or compatible endpoint) for transcription.
  - **LLM Structuring**: Feeds cleaned transcript + metadata to GPT-4o (or similar) to parse into structured recipe JSON (name, ingredients with quantities, step-by-step directions).
- **Fallbacks**: Traditional web scraper (JSON-LD, microdata) runs first for regular recipe sites.
- **Offline / Partial Support**: Limited — transcription and LLM steps require internet and API key.
- **Cost**: Uses OpenAI Whisper + GPT (user provides their own API key). Very cheap per import (~$0.01 or less for short reels).

### Strengths
- Excellent for **video-only recipes** (Reels, TikTok, YouTube Shorts) where there's little or no written caption.
- High success rate on spoken recipes.
- Unified experience — one URL field handles everything.

### Weaknesses
- Requires OpenAI (or compatible) API key for best results.
- Not fully offline.
- Transcription quality depends on audio clarity and model.

## 2. Paprika (Paid, Cross-Platform App)

Paprika takes a simpler, more traditional approach focused on its built-in browser.

### How Paprika Does It
- **Built-in Browser**: User opens an in-app web browser (or pastes URL), navigates to the recipe page (Instagram, TikTok, blog, etc.).
- **"Download Recipe" Button**: On recipe sites or social posts with visible text/captions, user taps a prominent download button.
- **Extraction Method**:
  - Primarily **HTML scraping** of visible text, captions, JSON-LD (when present), and images.
  - For Instagram/TikTok: Relies heavily on the caption text being visible/expanded in the browser.
  - No native video transcription or Whisper integration (as of 2026).
  - For video-heavy posts: Users often manually copy the caption or description and paste it.
- **Image Handling**: Automatically grabs the best available image from the page (OG image, post image, etc.).
- **Offline**: Fully offline once the recipe is imported (local database).

### Strengths
- Simple, reliable for traditional recipe blogs and posts with good captions.
- Excellent cross-device sync and native app feel.
- One-time purchase model (no ongoing API costs).

### Weaknesses
- Struggles with **video-only recipes** (Reels, Shorts) that have little written text.
- Often requires manual caption expansion or copy-paste on Instagram/TikTok.
- No automatic transcription of spoken instructions.
- Less "magic" compared to AI-powered solutions.

## Direct Comparison

| Aspect                        | Mealie                                      | Paprika                                      |
|-------------------------------|---------------------------------------------|----------------------------------------------|
| **Video / Spoken Recipes**    | Excellent (yt-dlp + Whisper + LLM)         | Weak (relies on visible caption)            |
| **Traditional Blogs**         | Very good (scraper + JSON-LD)              | Excellent (built-in browser + scraper)      |
| **Automation Level**          | High (paste URL → structured recipe)       | Medium (browse + tap Download)              |
| **Image Grabbing**            | Good (thumbnail + best image logic)        | Very good (page image detection)            |
| **Offline Capability**        | Partial (needs internet for transcription) | Fully offline after import                  |
| **Cost**                      | Free + OpenAI API key                      | One-time purchase per platform              |
| **Mobile Experience**         | Web-based (PWA possible)                   | Native apps (iOS, Android, Mac, Windows)    |
| **AI Structuring**            | Strong (LLM parses spoken text)            | None (heuristic only)                       |

## Key Takeaways for SpiceHub

SpiceHub's current approach (client-side `extractWithBrowserAPI` + `parseCaption` + offline queue) sits nicely between the two:

- Closer to **Paprika** in simplicity and offline-first design.
- Has room to grow toward **Mealie**'s strength on video content by adding a lightweight yt-dlp subtitle path.

**Our Opportunity**:
- Combine Paprika-style reliable browser + caption parsing with selective Mealie-style subtitle extraction.
- Keep everything **progressive** (zero-cost by default, optional yt-dlp enhancement).
- Focus on making the preview + drag-and-drop experience feel premium (something neither does particularly well today).

This comparison shows why Instagram import is our keystone feature — users expect modern apps to handle video recipes seamlessly.

---

Would you like me to expand any section, add a "SpiceHub vs Mealie/Paprika" column, or turn this into a living document with implementation notes for Ruflo? Just let me know. 

This file is now ready to drop into your project and reference during the next Ruflo swarm.