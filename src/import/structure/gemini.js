// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURE: GEMINI — the single ContextPack structuring path.
//
// Spec §6: provenance-labeled sections, explicit reconciliation rules,
// ~50K char budget (contextPack.js owns allocation), verifier mode when the
// structured-data candidate is complete, flash-lite → flash escalation.
//
// Returns RAW structured objects (RECIPE_SCHEMA shape). Callers own
// thinFromStructured + finalizeAIRecipe so this module never imports
// recipeParser (acyclic graph).
// ─────────────────────────────────────────────────────────────────────────────
import {
  SYSTEM_INSTRUCTION,
  RECIPE_SCHEMA,
  buildFewShotContents,
  detectKindHeuristic,
} from '../../recipeSchema.js';
import { buildPackSections, packHasCompleteCandidate } from '../contextPack.js';

const GEMINI_MODEL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_MODEL) || 'gemini-2.0-flash-lite';
const GEMINI_MODEL_FLAGSHIP =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_MODEL_FLAGSHIP) || 'gemini-2.5-flash';
const GEMINI_CONFIDENCE_FLOOR = 0.6;
const REQUEST_TIMEOUT_MS = 20000;

/**
 * Reconciliation rules (spec refinement B) — appended to the shared
 * SYSTEM_INSTRUCTION as a second system part for pack-based calls only, so the
 * caption path's behavior is unchanged until it migrates to packs.
 */
export const RECONCILIATION_RULES = [
  'SOURCE RECONCILIATION. The user message contains labeled source sections',
  '(CAPTION, TRANSCRIPT, PAGE CONTENT, STRUCTURED DATA FOUND). Reconcile them:',
  '- If STRUCTURED DATA (Schema.org JSON-LD) is present and complete, PREFER it',
  '  for ingredients and directions. Only override with caption/transcript/page',
  '  content when the structured data is missing a field or clearly contradicts',
  '  the other sources.',
  '- Use caption, transcript, and page content to ENRICH notes, tips, serving',
  '  suggestions, and any fields the structured data lacks.',
  '- Quantities: structured data wins on conflicts; page prose wins over',
  '  transcript guesses ("a splash" in speech vs "2 tbsp" in text -> 2 tbsp).',
  '- NEVER import navigation, comments, related-recipe teasers, or reader',
  '  reviews from PAGE CONTENT into any field.',
].join('\n');

export const VERIFIER_RULES = [
  'VERIFY MODE. The structured data for this recipe is COMPLETE. Do NOT',
  're-extract from prose. Your job is to verify and clean: normalize quantities',
  'and units, fix obvious OCR/encoding artifacts, split any compound steps,',
  'assign sections and grocery categories, extract notes/tips from the other',
  'sections, and strip every remaining piece of social or blog junk. Keep the',
  'structured data\'s ingredient list and step order intact unless something is',
  'clearly wrong.',
].join('\n');

/**
 * IG_RECONCILIATION — appended ONLY for Instagram packs (sourceType === 'instagram').
 * Reels pair a written caption with a spoken transcript; the caption's lists are
 * authoritative, the transcript backfills gaps, and neither may invent.
 */
export const IG_RECONCILIATION = [
  'INSTAGRAM REEL RULES.',
  '- The CAPTION is authoritative for ingredient lists and measured quantities.',
  '  Prefer numbered/bulleted lists in the CAPTION over anything spoken.',
  '- Use the TRANSCRIPT only to FILL missing steps or amounts the caption omits,',
  '  and to order steps. Never invent quantities or steps not supported by either.',
  '- Do not double-count: if the same step appears in both CAPTION and TRANSCRIPT,',
  '  emit it once.',
  '- Strip music credits, "original audio", @handles, #hashtags, timestamps, and',
  '  "link in bio" / "recipe in comments" CTAs from every field.',
].join('\n');

/**
 * PINTEREST_RECONCILIATION — appended for Pinterest pins (sourceType === 'pinterest').
 * Pinterest recipe pins usually have excellent schema.org/Recipe data.
 * We prefer the structured data, fall back to the pin description, and never invent.
 */
export const PINTEREST_RECONCILIATION = [
  'PINTEREST PIN RULES.',
  '- Prefer structured data (JSON-LD / Recipe schema) when present — it is usually the most accurate.',
  '- The pin description / caption is secondary; use it only to fill missing fields.',
  '- Never invent ingredients or steps. If the pin has no usable recipe content, return low confidence.',
  '- Clean Pinterest CDN image URLs (strip size/query params) before emitting.',
  '- Extract the original pinner / creator name when available.',
].join('\n');

/**
 * PACK_RESPONSE_SCHEMA — RECIPE_SCHEMA plus an optional provenance array so
 * the model reports which source each major field came from (auditable,
 * feeds ImportReview badges). Additive: consumers that ignore it are safe.
 */
export const PACK_RESPONSE_SCHEMA = {
  ...RECIPE_SCHEMA,
  properties: {
    ...RECIPE_SCHEMA.properties,
    provenance: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string' }, // e.g. "ingredients", "directions", "notes"
          via: { type: 'string' },   // e.g. "json-ld", "caption", "page-content"
        },
        required: ['field', 'via'],
      },
    },
  },
};

/** Strip control chars + code fences from a model response before JSON.parse. */
export function sanitizeModelJson(raw = '') {
  return String(raw)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .trim();
}

/**
 * Build the full Gemini `contents` array + mode for a ContextPack.
 * Exported for tests (prompt assembly is corpus-pinned).
 */
export function buildPackContents(pack, { type = 'meal' } = {}) {
  const { text, sections } = buildPackSections(pack);
  const kind =
    type === 'drink' ? 'drink'
    : detectKindHeuristic([pack.caption, pack.transcript, pack.markdown].filter(Boolean).join('\n').slice(0, 4000)) === 'drink' ? 'drink'
    : 'meal';

  const mode = packHasCompleteCandidate(pack) ? 'verify' : 'extract';

  const header = pack.title ? `Name hint: "${pack.title}"\n\n` : '';
  const userTurn = { role: 'user', parts: [{ text: `${header}${text}` }] };

  return {
    contents: [...buildFewShotContents(kind), userTurn],
    kind,
    mode,
    sections,
  };
}

/**
 * One structured-output call. Mirrors recipeParser's geminiGenerateStructured
 * result contract: { structured } | { status } | { failed } | { error }.
 * Never throws.
 */
export async function geminiPackRequest(model, contents, clientKey, { mode = 'extract', sourceType = null } = {}) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${clientKey}`;
  const systemParts = [{ text: SYSTEM_INSTRUCTION }, { text: RECONCILIATION_RULES }];
  if (mode === 'verify') systemParts.push({ text: VERIFIER_RULES });
  if (sourceType === 'instagram') systemParts.push({ text: IG_RECONCILIATION });
  if (sourceType === 'pinterest') systemParts.push({ text: PINTEREST_RECONCILIATION });

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: systemParts },
        contents,
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: PACK_RESPONSE_SCHEMA,
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return { status: res.status };
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!raw) return { failed: true };
    return { structured: JSON.parse(sanitizeModelJson(raw)) };
  } catch (err) {
    return { error: err?.message || String(err) };
  }
}

/** Resolve the /api/structure endpoint (env override → same-origin default). */
export function structureEndpoint() {
  const envUrl =
    typeof import.meta !== 'undefined' ? import.meta.env?.VITE_STRUCTURE_ENDPOINT : null;
  return envUrl || '/api/structure';
}

/**
 * serverStructurePack — POST the pack to /api/structure so the Gemini key can
 * stay server-side. Returns the raw structured object or null. Never throws.
 */
export async function serverStructurePack(pack, { type = 'meal', signal } = {}) {
  try {
    const res = await fetch(structureEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pack, type }),
      signal: signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS + 5000),
    });
    if (!res.ok) {
      console.log(`[SpiceHub] /api/structure HTTP ${res.status}`);
      return null;
    }
    const body = await res.json();
    if (!body?.ok || !body.structured?.isRecipe) return null;
    return body.structured;
  } catch (err) {
    console.log('[SpiceHub] /api/structure unreachable:', err?.message || err);
    return null;
  }
}

/**
 * structurePack — ContextPack in, raw RECIPE_SCHEMA object out (or null).
 * Client key path first (no extra hop when the key is bundled), server
 * passthrough when the client has no key. Confidence-driven escalation on the
 * client path; the server does its own escalation.
 */
export async function structurePack(pack, { type = 'meal', clientKey: keyOverride, signal } = {}) {
  if (!pack) return null;
  const clientKey =
    keyOverride !== undefined
      ? keyOverride
      : (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_GOOGLE_AI_KEY : null);
  if (!clientKey) return serverStructurePack(pack, { type, signal });

  const { contents, mode, kind } = buildPackContents(pack, { type });
  const sourceType = pack.sourceType || null;

  const primary = await geminiPackRequest(GEMINI_MODEL, contents, clientKey, { mode, sourceType });
  if (primary.status || primary.error || primary.failed) {
    console.warn(
      `[SpiceHub] structurePack ${primary.status ? 'HTTP ' + primary.status : primary.error || 'empty'} (${GEMINI_MODEL})`,
    );
    return null;
  }
  let best = primary.structured;
  if (!best?.isRecipe) return null;
  best._structureMode = mode;
  best._kind = kind;

  const lowConfidence = typeof best.confidence === 'number' && best.confidence < GEMINI_CONFIDENCE_FLOOR;
  if (lowConfidence && GEMINI_MODEL_FLAGSHIP && GEMINI_MODEL_FLAGSHIP !== GEMINI_MODEL) {
    console.log(`[SpiceHub] structurePack escalating to ${GEMINI_MODEL_FLAGSHIP} (confidence ${best.confidence})`);
    const esc = await geminiPackRequest(GEMINI_MODEL_FLAGSHIP, contents, clientKey, { mode, sourceType });
    if (esc.structured?.isRecipe && (esc.structured.confidence ?? 0) > (best.confidence ?? 0)) {
      best = esc.structured;
      best._structureMode = mode;
      best._kind = kind;
      best._escalated = true;
    }
  }
  return best;
}
