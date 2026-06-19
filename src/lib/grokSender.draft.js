/**
 * grokSender.draft.js — MOCK-UP / DRAFT (not wired into the extraction cascade).
 * ---------------------------------------------------------------------------
 * A Grok (xAI) counterpart to structureWithAIClient() in recipeParser.js.
 * xAI's API is OpenAI-compatible, so the request shape differs from Gemini:
 *   • POST https://api.x.ai/v1/chat/completions
 *   • Authorization: Bearer <key>   (NOT a ?key= query param)
 *   • messages[] with roles system | user | assistant   (not Gemini "contents")
 *   • response_format for structured output  (not Gemini "responseSchema")
 *
 * It reuses the SAME shared brain as the Gemini path so quality stays
 * consistent across providers:
 *   - SYSTEM_INSTRUCTION  (the strong extraction rules)
 *   - thinFromStructured  (schema object -> SpiceHub thin display recipe)
 *   - buildStructuredFields / sanitizeRecipeTitle (recipeParser helpers)
 *
 * To go live: set VITE_XAI_API_KEY, confirm GROK_MODEL against console.x.ai,
 * then call this first in structureWithAI() (before the Gemini client path) or
 * behind a provider flag. Keep the model id in ONE constant so swapping
 * provider/model stays a one-line change.
 *
 * SECURITY: like the existing Gemini key, this key is bundled into the client.
 * Acceptable for a personal/family PWA; never commit the actual key — env only.
 */

import { SYSTEM_INSTRUCTION, RECIPE_SCHEMA, thinFromStructured } from '../recipeSchema';
import { buildStructuredFields, sanitizeRecipeTitle } from '../recipeParser';

// ── Config ───────────────────────────────────────────────────────────────────
const XAI_ENDPOINT = 'https://api.x.ai/v1/chat/completions';
// Verify the exact model id at console.x.ai — likely "grok-4-1-fast" (cheap,
// 2M context) or "grok-4-3" (flagship). Cheap+big-context fits extraction well.
const GROK_MODEL = 'grok-4-1-fast';
const REQUEST_TIMEOUT_MS = 20000; // Grok can be a touch slower than flash-lite
const MAX_INPUT_CHARS = 24000;    // 2M-token context — far less truncation than Gemini's 8k slice

/**
 * Adapt the existing Gemini-format few-shot turns ([{ role:'user'|'model',
 * parts:[{text}] }]) into OpenAI chat messages. Pass the result as `fewShot`.
 * Kept as a pure helper so the caller controls whether/which exemplars to send.
 */
export function geminiTurnsToOpenAIMessages(turns = []) {
  if (!Array.isArray(turns)) return [];
  return turns.map((t) => ({
    role: t.role === 'model' ? 'assistant' : 'user',
    content: Array.isArray(t.parts)
      ? t.parts.map((p) => (p && p.text) || '').join('\n')
      : String(t.content || ''),
  }));
}

/**
 * structureWithGrok(rawText, opts) → SpiceHub recipe object | null
 *
 * opts: { title?, imageUrl?, sourceUrl?, type?: 'meal'|'drink', fewShot?: msg[],
 *         strictSchema?: boolean }
 *
 * Returns null when: no key, input too short, network/parse failure, or the
 * source isn't a recipe (isRecipe:false). Never throws.
 */
export async function structureWithGrok(rawText, {
  title: hintTitle = '',
  imageUrl = '',
  sourceUrl = '',
  type = 'meal',
  fewShot = [],
  strictSchema = false,
} = {}) {
  const key = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_XAI_API_KEY : null;
  if (!key || !rawText || rawText.trim().length < 20) return null;

  const userText = hintTitle
    ? `Name hint: "${hintTitle}"\n\n${rawText.slice(0, MAX_INPUT_CHARS)}`
    : rawText.slice(0, MAX_INPUT_CHARS);

  const messages = [
    { role: 'system', content: SYSTEM_INSTRUCTION },
    ...geminiTurnsToOpenAIMessages(fewShot),
    { role: 'user', content: userText },
  ];

  // Structured output. Default to json_object (robust + simple); flip
  // strictSchema:true to enforce RECIPE_SCHEMA — but OpenAI strict mode wants
  // every object to declare additionalProperties:false + full `required`, so
  // RECIPE_SCHEMA likely needs a conversion pass before strict will validate.
  const response_format = strictSchema
    ? { type: 'json_schema', json_schema: { name: 'recipe', strict: true, schema: RECIPE_SCHEMA } }
    : { type: 'json_object' };

  let res;
  try {
    res = await fetch(XAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        messages,
        temperature: 0.1,
        response_format,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn('[SpiceHub] Grok request failed:', err?.message || err);
    return null;
  }

  if (!res.ok) {
    console.warn('[SpiceHub] Grok HTTP', res.status, '— caller should fall back');
    return null;
  }

  let structured;
  try {
    const data = await res.json();
    // OpenAI-compatible shape: choices[0].message.content holds the JSON string.
    const raw = data?.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    structured = JSON.parse(jsonText);
  } catch (err) {
    console.warn('[SpiceHub] Grok JSON parse failed:', err?.message || err);
    return null;
  }

  if (!structured || !structured.isRecipe) return null;

  console.log(
    '[SpiceHub] Grok extraction OK — groups:', structured.ingredientGroups?.length,
    'directions:', structured.directions?.length,
    'confidence:', structured.confidence
  );

  // Map the rich schema object to SpiceHub's thin display shape — identical to
  // the Gemini path so downstream code is provider-agnostic.
  const thin = thinFromStructured(structured);
  return {
    name: sanitizeRecipeTitle(thin.title || hintTitle || 'Imported Recipe'),
    ...thin,
    ...buildStructuredFields(thin.ingredients, thin.directions),
    imageUrl: imageUrl || '',
    link: sourceUrl || '',
    _aiStructured: true,
    _structuredVia: `grok:${GROK_MODEL}`,
  };
}
