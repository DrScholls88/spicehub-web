// ─────────────────────────────────────────────────────────────────────────────
// /api/structure — server-side Gemini structuring passthrough.
//
// Keeps the Gemini key server-side (GOOGLE_GENERATIVE_AI_API_KEY env var).
// The client always routes through this proxy — no client-side API keys.
//
// SINGLE PROMPT SOURCE: this function imports the exact same system
// instruction, reconciliation/verifier rules, response schema, and few-shots
// the client uses. There is one extraction brain, wherever it runs.
// ─────────────────────────────────────────────────────────────────────────────
import { SYSTEM_INSTRUCTION } from '../src/recipeSchema.js';
import {
  RECONCILIATION_RULES,
  VERIFIER_RULES,
  IG_RECONCILIATION,
  PINTEREST_RECONCILIATION,
  DRINK_RECONCILIATION,
  KIND_LOCK_RULE,
  PACK_RESPONSE_SCHEMA,
  buildLockedResponseSchema,
  buildPackContents,
  sanitizeModelJson,
} from '../src/import/structure/gemini.js';
import { createContextPack } from '../src/import/contextPack.js';
import { GEMINI_PRIMARY_MODEL, GEMINI_FLAGSHIP_MODEL } from '../src/lib/importConfig.js';

// 2026-08-09: gemini-2.0-flash-lite is officially shut down (confirmed via
// Google's own model list, "Previous models" table, updated 2026-08-05) —
// any call to it now fails outright, which is why primary.status was always
// truthy and every /api/structure call was returning 502. gemini-2.5-flash-lite
// is its direct same-tier replacement (still listed Stable).
const PRIMARY_MODEL = process.env.GEMINI_MODEL || GEMINI_PRIMARY_MODEL;
const FLAGSHIP_MODEL = process.env.GEMINI_MODEL_FLAGSHIP || GEMINI_FLAGSHIP_MODEL;
const CONFIDENCE_FLOOR = 0.6;
const REQUEST_TIMEOUT_MS = 20000;

// ── Rate limiting (best-effort in-memory; resets on cold start) ──────────────
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX = 30;
const rateBuckets = new Map();

export function checkRateLimit(ip, now = Date.now()) {
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.reset) {
    rateBuckets.set(ip, { count: 1, reset: now + RATE_WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_MAX;
}

/** Normalize a request body into a ContextPack (accepts pack or rawText). */
export function packFromRequestBody(body = {}) {
  if (body.pack && typeof body.pack === 'object') {
    return createContextPack({ ...body.pack });
  }
  if (typeof body.rawText === 'string' && body.rawText.trim().length >= 20) {
    return createContextPack({
      sourceUrl: body.sourceUrl || '',
      sourceType: 'text',
      title: body.title || '',
      caption: body.rawText.slice(0, 50000),
      acquiredVia: 'raw-text',
    });
  }
  return null;
}

async function geminiCall(model, contents, mode, apiKey, sourceType = null, kind = null, kindLocked = false) {
  const systemParts = [{ text: SYSTEM_INSTRUCTION }, { text: RECONCILIATION_RULES }];
  if (mode === 'verify') systemParts.push({ text: VERIFIER_RULES });
  // I-4/1.4: this is the real production path (the client always routes
  // through /api/structure — see file header), so the drink addendum and the
  // kind lock both have to live here, not just in the client-only fallback
  // in src/import/structure/gemini.js.
  if (kind === 'drink') systemParts.push({ text: DRINK_RECONCILIATION });
  if (sourceType === 'instagram') systemParts.push({ text: IG_RECONCILIATION });
  if (sourceType === 'pinterest') systemParts.push({ text: PINTEREST_RECONCILIATION });
  if (kindLocked && kind && KIND_LOCK_RULE[kind]) systemParts.push({ text: KIND_LOCK_RULE[kind] });

  const responseSchema = (kindLocked && kind) ? buildLockedResponseSchema(kind) : PACK_RESPONSE_SCHEMA;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
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
    },
  );
  if (!res.ok) return { status: res.status };
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!raw) return { failed: true };
  try {
    return { structured: JSON.parse(sanitizeModelJson(raw)) };
  } catch {
    return { failed: true };
  }
}

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'post-only' });

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return res.status(503).json({ ok: false, reason: 'no-server-key' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) return res.status(429).json({ ok: false, reason: 'rate-limited' });

  const pack = packFromRequestBody(req.body || {});
  if (!pack) return res.status(400).json({ ok: false, reason: 'no-content' });

  const started = Date.now();
  try {
    const { contents, mode, kind } = buildPackContents(pack, { type: req.body?.type || 'meal' });
    // I-6/1.6: a caller-supplied sourceType overrides the pack's own value
    // (mirrors structurePack's client-side fix) instead of only trusting
    // whatever the acquirer happened to stamp onto the pack.
    const sourceType = req.body?.sourceType !== undefined ? req.body.sourceType : (pack.sourceType || null);
    // I-4/1.4: explicit user confirmation (Bar tab entry, or a manual chip
    // tap) pins the model's kind output — see api/structure.js's geminiCall.
    const kindLocked = !!req.body?.kindLocked;

    let primary = await geminiCall(PRIMARY_MODEL, contents, mode, apiKey, sourceType, kind, kindLocked);
    // 2026-08-09: an HTTP-level failure from the primary model (bad model ID,
    // quota, transient 5xx) used to fail the whole request immediately with
    // no attempt at the flagship model — the flagship fallback only ever ran
    // for a *successful-but-low-confidence* primary call, not an outright
    // error. That's backwards: an outright failure is exactly when a second
    // model is most worth trying. This is also what silently broke every
    // import while PRIMARY_MODEL pointed at a retired Gemini model — the
    // flagship model (still valid) never got a chance to save the request.
    if (primary.status) {
      if (FLAGSHIP_MODEL && FLAGSHIP_MODEL !== PRIMARY_MODEL) {
        const esc = await geminiCall(FLAGSHIP_MODEL, contents, mode, apiKey, sourceType, kind, kindLocked);
        if (esc.status) {
          // 2026-08-27: both models failed — the only server-side signal that
          // a model was renamed/retired (the client only sees the 502 body).
          console.error(`[api/structure] both models failed: ${PRIMARY_MODEL}=${primary.status}, ${FLAGSHIP_MODEL}=${esc.status}`);
          return res.status(502).json({ ok: false, reason: `gemini-${primary.status}+${esc.status}` });
        }
        if (esc.failed || !esc.structured?.isRecipe) {
          return res.status(200).json({ ok: true, structured: null, mode, elapsedMs: Date.now() - started });
        }
        primary = esc;
        primary.structured._escalated = true;
      } else {
        console.error(`[api/structure] ${PRIMARY_MODEL} failed with no flagship configured: status=${primary.status}`);
        return res.status(502).json({ ok: false, reason: 'gemini-' + primary.status });
      }
    }
    if (primary.failed || !primary.structured?.isRecipe) {
      return res.status(200).json({ ok: true, structured: null, mode, elapsedMs: Date.now() - started });
    }

    let best = primary.structured;
    const lowConfidence = !best._escalated && typeof best.confidence === 'number' && best.confidence < CONFIDENCE_FLOOR;
    if (lowConfidence && FLAGSHIP_MODEL && FLAGSHIP_MODEL !== PRIMARY_MODEL) {
      const esc = await geminiCall(FLAGSHIP_MODEL, contents, mode, apiKey, sourceType, kind, kindLocked);
      if (esc.structured?.isRecipe && (esc.structured.confidence ?? 0) > (best.confidence ?? 0)) {
        best = esc.structured;
        best._escalated = true;
      }
    }
    best._structureMode = mode;
    best._kind = kind;

    return res.status(200).json({
      ok: true,
      structured: best,
      mode,
      model: best._escalated ? FLAGSHIP_MODEL : PRIMARY_MODEL,
      elapsedMs: Date.now() - started,
    });
  } catch (err) {
    console.error(`[api/structure] handler threw: ${err?.name || 'Error'}: ${err?.message || err}`);
    return res.status(502).json({
      ok: false,
      reason: err?.name === 'TimeoutError' ? 'gemini-timeout' : 'structure-failed',
      detail: err?.message || String(err),
      elapsedMs: Date.now() - started,
    });
  }
}
