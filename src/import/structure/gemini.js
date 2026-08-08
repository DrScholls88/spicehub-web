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
 * DRINK_RECONCILIATION — appended whenever kind === 'drink' (Phase 1 / I-4,
 * bar-library-parity-plan-2026-08-07.md). The base SYSTEM_INSTRUCTION and
 * RECONCILIATION_RULES speak entirely in meal terms ("steps", "amounts") —
 * this fills the gap so cocktail captions get treated on their own terms
 * instead of being force-fit into a meal shape.
 */
export const DRINK_RECONCILIATION = [
  'DRINK RULES. This is a cocktail/drink recipe, not a meal.',
  '- oz / dash / dashes / splash / barspoon / part / parts / cl / ml / jigger / shot',
  '  are INGREDIENT MEASURES, not steps. Do not turn a measured ingredient line',
  '  into a direction.',
  '- "garnish" is its own field and must never be duplicated into ingredients.',
  '- Populate `glass` (e.g. coupe, rocks glass, highball, martini glass) and',
  '  `method` (one of: shaken, stirred, built, blended, muddled, thrown)',
  '  whenever the source specifies or clearly implies them.',
  '- A syrup, infusion, or other sub-recipe component (e.g. "simmer equal parts',
  '  sugar and water for the simple syrup") belongs in `notes` as a component of',
  '  the drink — it is NOT the main recipe and must never cause you to classify',
  '  the whole thing as a meal.',
  '- Never reclassify a drink as a meal because a step mentions simmering,',
  '  boiling, or heating a component (simple syrup, mulled wine, hot toddy water,',
  '  infusions). Those are drink-making steps.',
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

/**
 * buildLockedResponseSchema — PACK_RESPONSE_SCHEMA with `kind`'s enum narrowed
 * to a single value. Used when the user has explicitly confirmed the item
 * type (Bar tab entry, or a manual Meal/Drink chip tap) — Gemini structured
 * output respects a single-value enum, which removes the "model overrides the
 * user's stated intent" failure mode entirely instead of just asking nicely
 * via prompt text (Phase 1 / I-1/I-4, bar-library-parity-plan-2026-08-07.md).
 */
export function buildLockedResponseSchema(kind) {
  return {
    ...PACK_RESPONSE_SCHEMA,
    properties: {
      ...PACK_RESPONSE_SCHEMA.properties,
      kind: { type: 'string', enum: [kind] },
    },
  };
}

/** System-part text pinning the model's `kind` output to an explicit user choice. */
export const KIND_LOCK_RULE = {
  drink: 'The user has confirmed this is a DRINK. Set kind="drink". Do not classify as a meal.',
  meal: 'The user has confirmed this is a MEAL. Set kind="meal". Do not classify as a drink.',
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
export async function geminiPackRequest(
  model, contents, clientKey,
  { mode = 'extract', sourceType = null, kind = null, kindLocked = false } = {},
) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${clientKey}`;
  const systemParts = [{ text: SYSTEM_INSTRUCTION }, { text: RECONCILIATION_RULES }];
  if (mode === 'verify') systemParts.push({ text: VERIFIER_RULES });
  if (kind === 'drink') systemParts.push({ text: DRINK_RECONCILIATION });
  if (sourceType === 'instagram') systemParts.push({ text: IG_RECONCILIATION });
  if (sourceType === 'pinterest') systemParts.push({ text: PINTEREST_RECONCILIATION });
  // I-4/1.4: an explicit user choice pins the model's kind output rather than
  // merely hinting at it via few-shot selection (which buildPackContents alone
  // already did, but couldn't stop the model choosing 'meal' anyway).
  if (kindLocked && kind && KIND_LOCK_RULE[kind]) systemParts.push({ text: KIND_LOCK_RULE[kind] });

  const responseSchema = (kindLocked && kind) ? buildLockedResponseSchema(kind) : PACK_RESPONSE_SCHEMA;

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
          responseSchema,
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
export async function serverStructurePack(pack, { type = 'meal', signal, kindLocked = false, sourceType } = {}) {
  try {
    const res = await fetch(structureEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pack, type, kindLocked, sourceType }),
      signal: signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS + 5000),
    });
    if (!res.ok) {
      if (res.status === 429) {
        console.warn('[SpiceHub] /api/structure rate-limited (429) — back off');
        // Surface 429 so callers can show a toast instead of silent fail
        const err429 = new Error('AI structuring rate-limited — try again shortly');
        err429.status = 429;
        throw err429;
      }
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
 * Always routes through the /api/structure server proxy so the Gemini key
 * stays server-side. The `clientKey` override is retained only for tests.
 */
export async function structurePack(
  pack,
  { type = 'meal', clientKey: keyOverride, signal, kindLocked = false, sourceType: sourceTypeOverride } = {},
) {
  if (!pack) return null;
  // I-6/1.6: honour an explicit sourceType override instead of silently
  // discarding it — previously only `pack.sourceType` was read (and only on
  // the client-key test path below), so a caller passing
  // `{ sourceType: 'pinterest' }` (recipeParser.js:3017) had no effect unless
  // the pack itself already carried that value. Computed before the server
  // early-return so the real production path (no clientKey) gets it too.
  const sourceType = sourceTypeOverride !== undefined ? sourceTypeOverride : (pack.sourceType || null);

  // Security: never read VITE_GOOGLE_AI_KEY from the client bundle.
  // If a test passes an explicit key override, honour it; otherwise go server.
  const clientKey = keyOverride !== undefined ? keyOverride : null;
  if (!clientKey) return serverStructurePack(pack, { type, signal, kindLocked, sourceType });

  const { contents, mode, kind } = buildPackContents(pack, { type });

  const primary = await geminiPackRequest(GEMINI_MODEL, contents, clientKey, { mode, sourceType, kind, kindLocked });
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
    const esc = await geminiPackRequest(GEMINI_MODEL_FLAGSHIP, contents, clientKey, { mode, sourceType, kind, kindLocked });
    if (esc.structured?.isRecipe && (esc.structured.confidence ?? 0) > (best.confidence ?? 0)) {
      best = esc.structured;
      best._structureMode = mode;
      best._kind = kind;
      best._escalated = true;
    }
  }
  return best;
}
