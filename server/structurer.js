// server/structurer.js
import { GoogleGenerativeAI } from '@google/generative-ai';

const SYSTEM_PROMPT = `You are a recipe data extractor. You will receive up to two recipe sources:
- "metadata" — structured JSON-LD. Treat as ground truth for name/times/yields if present.
- "caption" — raw Instagram caption text. Expect fluff (emojis, hashtags, calls-to-action). Extract only culinary content. Ignore "link in bio", "tap to save", "comment for recipe" and similar.

When both are present, prefer metadata for structure and caption for detail.
When only caption is present, extract recipe data from it and ignore social CTAs.

Output STRICT JSON only. Schema:
{ "name": string, "ingredients": string[], "directions": string[], "yield": string, "prepTime": string, "cookTime": string, "image": string }

No prose. No markdown fences. No trailing commentary.`;

export async function structureWithGemini(rawSources, { sourceUrl, client } = {}) {
  try {
    const genAI = client || new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const userParts = rawSources.map((s) => `[${s.kind}]\n${s.text}`).join('\n\n---\n\n');
    const prompt = `${SYSTEM_PROMPT}\n\nSources for sourceUrl=${sourceUrl || 'unknown'}:\n\n${userParts}`;

    const resp = await model.generateContent(prompt);
    const text = resp.response.text().trim();
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) return { ok: false, error: 'no-json' };
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    return { ok: true, recipe: parsed };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}
