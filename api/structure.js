// ─────────────────────────────────────────────────────────────────────────────
// /api/structure — server-side Gemini structuring passthrough.
//
// Spec §4: lets the Gemini key live server-side (GOOGLE_AI_KEY env var) so the
// client bundle can ship without VITE_GOOGLE_AI_KEY. The client keeps its own
// key path as a fallback for client-only deploys — structurePack() in
// src/import/structure/gemini.js decides which path to use.
//
// SINGLE PROMPT SOURCE: this function imports the exact same system
// instruction, reconciliation/verifier rules, response schema, and few-shots
// the client uses. There is one extraction brain, wherever it runs.
// ─────────────────────────────────────────────────────────────────────────────
import { SYSTEM_INSTRUCTION } from '../src/recipeSchema.js';
import {
  RECONCILIATION_RULES,
  VERIFIER_RULES,
  PACK_RESPONSE_SCHEMA,
  buildPackContents,
  sanitizeModelJson,
} from '../src/import/structure/gemini.js';
import { createContextPack } from '../src/import/contextPack.js';

const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';
const FLAGSHIP_MODEL = process.env.GEMINI_MODEL_FLAGSHIP || 'gemini-2.5-flash';
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

async function geminiCall(model, contents, mode, apiKey) {
  const systemParts = [{ text: SYSTEM_INSTRUCTION }, { text: RECONCILIATION_RULES }];
  if (mode === 'verify') systemParts.push({ text: VERIFIER_RULES });

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
          responseSchema: PACK_RESPONSE_SCHEMA,
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

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.VITE_GOOGLE_AI_KEY;
  if (!apiKey) return res.status(503).json({ ok: false, reason: 'no-server-key' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) return res.status(429).json({ ok: false, reason: 'rate-limited' });

  const pack = packFromRequestBody(req.body || {});
  if (!pack) return res.status(400).json({ ok: false, reason: 'no-content' });

  const started = Date.now();
  try {
    const { contents, mode, kind } = buildPackContents(pack, { type: req.body?.type || 'meal' });

    const primary = await geminiCall(PRIMARY_MODEL, contents, mode, apiKey);
    if (primary.status) return res.status(502).json({ ok: false, reason: 'gemini-' + primary.status });
    if (primary.failed || !primary.structured?.isRecipe) {
      return res.status(200).json({ ok: true, structured: null, mode, elapsedMs: Date.now() - started });
    }

    let best = primary.structured;
    const lowConfidence = typeof best.confidence === 'number' && best.confidence < CONFIDENCE_FLOOR;
    if (lowConfidence && FLAGSHIP_MODEL && FLAGSHIP_MODEL !== PRIMARY_MODEL) {
      const esc = await geminiCall(FLAGSHIP_MODEL, contents, mode, apiKey);
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
    return res.status(502).json({
      ok: false,
      reason: err?.name === 'TimeoutError' ? 'gemini-timeout' : 'structure-failed',
      detail: err?.message || String(err),
      elapsedMs: Date.now() - started,
    });
  }
}
