Phase 3 – AI Structuring (The Final Polish Layer)
(Production-grade implementation for SpiceHub’s unified import engine)
As the senior product developer building SpiceHub’s cross-platform offline-first PWA (installable on Windows, iOS, and Android), Phase 3 is the always-run intelligence layer that turns messy social media text (from Instagram Reels, TikTok, etc.) into a clean, structured Recipe object ready for your library, meal planner, grocery list, and cook mode.
This phase runs after we have gathered the best possible raw text from:

Phase 0 (yt-dlp subtitles — narration gold)
Phase 1 (fast embed)
Phase 2 (AI browser/agent)

It ensures maximum usability: even a thin caption or noisy video transcript becomes a reliable, interactive recipe.
Why Phase 3 Is Always Executed (Simplicity & Reliability)

Social captions are noisy: hashtags, emojis, timestamps, sponsor phrases (“watch till the end”), “link in bio”, etc.
cleanSocialCaption() does aggressive pre-cleaning, but it’s still raw free-form text.
Gemini (or fallback) applies structured output + domain knowledge to classify lines, extract ingredients/directions, title, servings, time, etc.
It provides the “magic” feel users love — turning a Reel into a full recipe in seconds.
Keeps the app server-light while supporting full offline queuing.

Exact Implementation in recipeParser.js (You Already Have This Skeleton)
Here’s the clean production code block for Phase 3 (inside importFromInstagram and importFromGenericUrl):
JavaScript// Phase 3 – Always run AI structuring (the magic polish)
progressCallback({ step: 'phase3', message: 'Structuring recipe with Gemini…' });

const cleaned = cleanSocialCaption(rawText);   // aggressive cleaning already done in prior phases

// Optional: attach context from earlier phases (platform, bestImage, sourceUrl)
const metadata = {
  platform: 'instagram',   // or 'tiktok', 'generic'
  sourceUrl: url,
  bestImage: bestImage
};

const recipe = await structureWithAI(cleaned, metadata);

// Final touch-ups for usability
if (bestImage) recipe.imageUrl = bestImage;
recipe.sourceUrl = url;
recipe.importedAt = new Date().toISOString();

progressCallback({ step: 'complete', message: 'Recipe imported successfully!' });
return recipe;
If no usable text at all → we never reach here; we return the graceful { _needsManualCaption: true, sourceUrl: url } so BrowserAssist.jsx / ImportModal.jsx switches to the paste tab with the URL pre-filled.
Core Function: structureWithAI(text, metadata)
This is the heart of Phase 3. Here’s the 2026 production implementation tailored for your PWA (client-side first for offline feel, with graceful server fallback).
JavaScript// In recipeParser.js or a dedicated aiParser.js (recommended for maintainability)
export async function structureWithAI(rawText, metadata = {}) {
  if (!rawText || rawText.trim().length < 30) {
    throw new Error('Insufficient text for structuring');
  }

  const prompt = buildRecipeStructuringPrompt(rawText, metadata);

  try {
    // Prefer client-side Gemini (zero extra server round-trip, works offline when queued)
    if (import.meta.env.VITE_GOOGLE_AI_KEY) {
      return await callGeminiClientSide(prompt);
    } else {
      // Fallback to your existing backend endpoint (api.js proxy or RecipeBulkScraperService)
      return await callGeminiViaBackend(prompt);
    }
  } catch (err) {
    console.warn('Gemini structuring failed, falling back to heuristic parser', err);
    // Last resort: your old heuristic parseCaption() + smartClassifyLines()
    return fallbackHeuristicParse(rawText);
  }
}
1. Prompt Engineering (Critical for Recipe Quality)
Use a strong, consistent system prompt that forces structured JSON output. Example (store in a constant or .prompt file):
JavaScriptfunction buildRecipeStructuringPrompt(text, metadata) {
  return `
You are an expert recipe parser. Convert the following social media post text into a clean, structured recipe.

Source: ${metadata.platform || 'social'} – ${metadata.sourceUrl || ''}

Rules:
- Extract title, ingredients (as array of strings or objects with amount/unit/name), directions (numbered steps), prepTime, cookTime, servings, difficulty.
- Classify every line accurately: ingredient vs direction vs note.
- Clean up quantities, units, and fractions (1/2 → 0.5).
- Ignore hashtags, @mentions, timestamps, ads, "watch this", "full recipe in comments".
- If image description or video narration is implied, enhance logically but stay faithful to text.
- Output ONLY valid JSON matching this schema:

{
  "title": string,
  "ingredients": [ { "amount": string, "unit": string, "name": string } ],
  "directions": [string],
  "prepTime": number (minutes),
  "cookTime": number (minutes),
  "servings": number,
  "tags": [string],
  "notes": string (optional)
}

Text to parse:
"""${text}"""
`;
}
2. Client-Side Gemini Call (2026 Best Practice)
Use the official @google/genai SDK (or Firebase AI Logic for even tighter PWA integration). Install via npm install @google/genai.
JavaScriptasync function callGeminiClientSide(prompt) {
  const { GoogleGenAI } = await import('@google/genai');   // dynamic import for bundle size
  const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GOOGLE_AI_KEY });

  const model = ai.getGenerativeModel({ model: "gemini-2.5-pro" });   // or gemini-2.0-flash for speed/cost

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",   // forces structured JSON
      temperature: 0.1,                       // low for consistency
    }
  });

  const jsonText = result.response.text();
  return JSON.parse(jsonText);
}
Security note: Exposing the API key client-side is acceptable for a personal/offline-first PWA (users install and use their own key if desired). For public distribution, route through a thin backend proxy with usage quotas.
3. Fallbacks for Maximum Reliability

Heuristic fallback (smartClassifyLines, looksLikeIngredient, parseCaption): your existing rule-based parser handles simple cases when LLM is unavailable/offline.
Queued retry: If offline, store the raw cleaned text + metadata in your Dexie storage / SyncQueue. Process on next online sync.
User feedback: Progress callback shows “Structuring recipe with Gemini…” with a smooth animated indicator in BrowserAssist.jsx.

Usability & Cross-Platform Wins

Interactive feel: Phase 3 is the last step — users see the recipe appear with editable ingredients/directions immediately.
Parse from other apps: Share-target, browser import, bulk URL paste — all flow through the same importRecipeFromUrl() → Phase 3.
Storage-conscious: Only the final structured Recipe object is saved (small JSON). Raw text can be discarded after success.
Testing tip: Feed known tricky Reels (thin caption + narration) and verify ingredients/directions split correctly.

This completes the four-phase Instagram pipeline:

Phase 0 → yt-dlp subtitles (narration)
Phase 1 → fast embed
Phase 2 → AI browser/agent
Phase 3 → Gemini structuring (always polish)

The entire flow now lives cleanly in recipeParser.js as the single source of truth.