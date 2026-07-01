/**
 * SpiceHub resource server.
 *
 * The app remains client-first and offline-capable. These endpoints only help
 * online link imports fetch resources the browser cannot reliably access:
 * video metadata/subtitles, server-side HTML, and Instagram embed data.
 */

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import os from 'node:os';
import dns from 'node:dns/promises';
import net from 'node:net';
import { fileURLToPath } from 'url';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
// Shared extraction contract (single source of truth). recipeSchema.js has ZERO
// imports and is ESM + browser/server safe, so the server imports it directly to
// guarantee server-routed structuring produces output identical to the client.
import {
  SYSTEM_INSTRUCTION,
  RECIPE_SCHEMA,
  buildFewShotContents,
} from '../src/recipeSchema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve the yt-dlp binary once: explicit YT_DLP_BIN env wins; otherwise prefer
// the standalone binary the build script drops in <repo>/bin/yt-dlp (Python-free,
// fetched as a direct release asset — see render-build.sh); finally fall back to
// a `yt-dlp` on PATH. Cached so we only stat the file once.
const _BUNDLED_YT_DLP = path.join(__dirname, '..', 'bin', 'yt-dlp');
let _ytDlpBinCache = null;
function resolveYtDlpBin() {
  if (_ytDlpBinCache) return _ytDlpBinCache;
  if (process.env.YT_DLP_BIN) {
    _ytDlpBinCache = process.env.YT_DLP_BIN;
  } else if (fs.existsSync(_BUNDLED_YT_DLP)) {
    _ytDlpBinCache = _BUNDLED_YT_DLP;
  } else {
    _ytDlpBinCache = 'yt-dlp';
  }
  return _ytDlpBinCache;
}

export const app = express();
const PORT = process.env.PORT || 3001;

// CORS allowlist — driven by ALLOWED_ORIGINS (already wired up as a Render env
// var, see server/render.yaml). Fails CLOSED (no cross-origin access) rather
// than open when unset, so a forgotten config doesn't silently become "allow
// everyone". Same-origin/non-browser requests (no Origin header, e.g. curl,
// server-to-server) are always allowed through.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('cors-not-allowed'));
  },
}));
app.use(express.json({ limit: '1mb' }));

// Rate limiting — cheap metadata/lookup routes get a generous budget; routes
// that spawn subprocesses (yt-dlp/ffmpeg) or call the paid Gemini API get a
// tight one, since both are directly abusable for cost/DoS with no auth layer
// in front of them.
const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'rate-limited' },
});
const expensiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'rate-limited' },
});

// -----------------------------------------------------------------------------
// SSRF guard — every route below that fetches a user-supplied URL must call
// assertPublicHost() after validHttpUrl() passes. Blocks loopback, private
// (RFC1918), link-local/cloud-metadata (169.254.0.0/16), and numeric-literal
// IP tricks (decimal/octal/hex) that would otherwise bypass a naive hostname
// check. Resolves the hostname and checks the ACTUAL address(es) it points to,
// rather than just pattern-matching the hostname string.
// -----------------------------------------------------------------------------
function isPrivateOrReservedIp(ip) {
  const type = net.isIP(ip);
  if (type === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    return (
      a === 127 || a === 10 || a === 0 ||
      (a === 169 && b === 254) || // link-local + cloud metadata (169.254.169.254)
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224 // multicast/reserved
    );
  }
  if (type === 6) {
    const lower = ip.toLowerCase();
    return (
      lower === '::1' ||
      lower.startsWith('fe80:') || // link-local
      lower.startsWith('fc') || lower.startsWith('fd') || // unique local
      lower.startsWith('::ffff:127.') ||
      lower.startsWith('::ffff:10.') ||
      lower.startsWith('::ffff:169.254.')
    );
  }
  return true; // couldn't classify — fail closed
}

async function assertPublicHost(urlObj) {
  const hostname = urlObj.hostname;
  if (hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new Error('blocked-host');
  }
  // Reject numeric-looking hosts that aren't clean dotted-quad IPv4/IPv6 —
  // blocks decimal (2130706433), octal (017700000001), and hex (0x7f000001)
  // encodings of loopback/private addresses that would slip past a plain
  // dotted-quad regex.
  if (
    /^0x[0-9a-f]+$/i.test(hostname) ||
    /^\d+$/.test(hostname) ||
    /^0[0-7]+(\.[0-7]+)*$/.test(hostname)
  ) {
    throw new Error('blocked-host');
  }
  const addresses = await dns.lookup(hostname, { all: true });
  if (!addresses.length) throw new Error('blocked-host');
  for (const { address } of addresses) {
    if (isPrivateOrReservedIp(address)) throw new Error('blocked-host');
  }
}

async function requireSafeUrl(candidate) {
  const parsed = validHttpUrl(candidate);
  if (!parsed) return { ok: false, error: 'invalid-url' };
  try {
    await assertPublicHost(parsed);
  } catch {
    return { ok: false, error: 'blocked-host' };
  }
  return { ok: true, parsed };
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
];

function cleanUrl(input = '') {
  if (typeof input !== 'string') return '';
  let url = input.trim();
  const qualified = url.match(/https?:\/\/[^\s<>"']+/i);
  if (qualified) url = qualified[0];
  else {
    const schemeless = url.match(/(?:^|[\s<>"'])([a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>"']*)?)/i);
    if (schemeless?.[1]) url = `https://${schemeless[1]}`;
  }
  return url.replace(/\/https?:\/\/.+$/i, '').replace(/[)\],.;]+$/, '').replace(/\/$/, '');
}

function validHttpUrl(input) {
  try {
    const u = new URL(input);
    return ['http:', 'https:'].includes(u.protocol) ? u : null;
  } catch {
    return null;
  }
}

function headersFor(targetUrl) {
  const isInstagram = /instagram\.com/i.test(targetUrl);
  const headers = {
    'User-Agent': USER_AGENTS[Math.floor(Date.now() / 900000) % USER_AGENTS.length],
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
  };
  if (isInstagram) {
    headers.Referer = 'https://www.instagram.com/';
    const cookie = instagramCookieHeader();
    if (cookie) headers.Cookie = cookie;
  }
  return headers;
}

function instagramCookieHeader() {
  const raw = process.env.IG_COOKIES_JSON_B64;
  if (!raw) return '';
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    if (!Array.isArray(parsed)) return '';
    return parsed
      .filter((c) => c?.name && typeof c.value === 'string' && /instagram\.com/i.test(c.domain || 'instagram.com'))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  } catch {
    return '';
  }
}

async function fetchText(targetUrl, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(targetUrl, {
      redirect: 'follow',
      headers: headersFor(targetUrl),
      signal: ctrl.signal,
    });
    const text = await resp.text();
    return { ok: resp.ok, status: resp.status, contentType: resp.headers.get('content-type') || '', text };
  } finally {
    clearTimeout(timer);
  }
}

function extractMeta(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i');
  return (html.match(re)?.[1] || '').replace(/&amp;/g, '&').trim();
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractJsonLdRecipe(html) {
  const scripts = [...String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    try {
      const data = JSON.parse(script[1].trim());
      const nodes = Array.isArray(data) ? data : [data, ...(data?.['@graph'] || [])];
      const recipe = nodes.find((node) => {
        const type = node?.['@type'];
        return type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'));
      });
      if (recipe) return recipe;
    } catch { /* ignore malformed JSON-LD */ }
  }
  return null;
}

function extractInstagramShortcode(url) {
  return cleanUrl(url).match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/)?.[1] || '';
}

function extractInstagramEmbedData(html, sourceUrl) {
  let caption = '';
  const captionPatterns = [
    /"caption"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/,
    /"edge_media_to_caption"[^}]*"text"\s*:\s*"((?:[^"\\]|\\.)+)"/,
    /"caption_text"\s*:\s*"((?:[^"\\]|\\.){15,})"/,
    /<div\s+class="[^"]*(?:Caption|EmbedCaption)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];
  for (const re of captionPatterns) {
    const match = html.match(re);
    if (!match?.[1]) continue;
    try {
      caption = JSON.parse(`"${match[1]}"`);
    } catch {
      caption = stripHtml(match[1]).replace(/\\n/g, '\n');
    }
    if (caption.length > 20) break;
  }

  let imageUrl = '';
  const imagePatterns = [
    /"display_url"\s*:\s*"(https:[^"]+)"/i,
    /"thumbnail_src"\s*:\s*"(https:[^"]+)"/i,
    /<img[^>]+src="(https:\/\/[^"]*(?:scontent|fbcdn|cdninstagram)[^"]*_n\.(?:jpg|webp)[^"]*)"/i,
    /<video[^>]+poster="(https:\/\/[^"]+)"/i,
  ];
  for (const re of imagePatterns) {
    const match = html.match(re);
    const candidate = match?.[1]?.replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
    if (candidate && !/profile_pic|avatar|accounts\/avatars|150x150|s150x150/.test(candidate)) {
      imageUrl = candidate;
      break;
    }
  }

  const title = stripHtml(extractMeta(html, 'og:title') || '').replace(/^.*? on Instagram:\s*/i, '');
  return {
    caption: caption || stripHtml(extractMeta(html, 'og:description') || ''),
    rawText: stripHtml(html).slice(0, 7000),
    title,
    imageUrl,
    sourceUrl,
  };
}

function runYtDlpJson(url, timeoutMs = 70000) {
  return new Promise((resolve) => {
    const bin = resolveYtDlpBin();
    const child = spawn(bin, ['--dump-json', '--skip-download', '--no-warnings', url], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: 'yt-dlp-timeout' });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || !stdout.trim()) return resolve({ ok: false, error: stderr || `yt-dlp exited ${code}` });
      try {
        resolve({ ok: true, data: JSON.parse(stdout.trim().split('\n').at(-1)) });
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });
  });
}

function pickCaptionUrl(info) {
  const sources = [info?.subtitles, info?.automatic_captions].filter(Boolean);
  const preferredLangs = ['en', 'en-US', 'en-orig'];
  for (const lang of preferredLangs) {
    for (const source of sources) {
      const tracks = source?.[lang];
      const track = Array.isArray(tracks)
        ? tracks.find((t) => /vtt|srv3|json3/i.test(t.ext || t.url || '')) || tracks[0]
        : null;
      if (track?.url) return track.url;
    }
  }
  return '';
}

function cleanSubtitle(text) {
  return String(text || '')
    .replace(/^WEBVTT[\s\S]*?\n\n/i, '')
    .replace(/^\d+$/gm, '')
    .replace(/^\d{1,2}:\d{2}:\d{2}[\s\S]*?-->.*$/gm, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

app.get('/api/v2/ping', (_req, res) => {
  res.json({ ok: true, status: 'resource-server', clientFirst: true });
});

app.post('/api/resolve-url', standardLimiter, async (req, res) => {
  const target = cleanUrl(req.body?.url);
  const safe = await requireSafeUrl(target);
  if (!safe.ok) return res.status(400).json({ ok: false, error: safe.error });
  const { parsed } = safe;
  try {
    const response = await fetch(parsed.href, { method: 'HEAD', redirect: 'follow', headers: headersFor(parsed.href) });
    res.json({ ok: true, resolvedUrl: response.url || parsed.href });
  } catch {
    res.json({ ok: true, resolvedUrl: parsed.href });
  }
});

app.post('/api/extract-video', expensiveLimiter, async (req, res) => {
  const target = cleanUrl(req.body?.url);
  const safe = await requireSafeUrl(target);
  if (!safe.ok) return res.status(400).json({ ok: false, error: safe.error });
  const { parsed } = safe;

  const result = await runYtDlpJson(parsed.href);
  if (!result.ok) return res.json({ ok: false, error: result.error });

  const info = result.data;
  let transcript = '';
  const captionUrl = pickCaptionUrl(info);
  if (captionUrl) {
    try {
      const fetched = await fetchText(captionUrl, 20000);
      transcript = cleanSubtitle(fetched.text);
    } catch { /* metadata-only fallback */ }
  }

  res.json({
    ok: true,
    type: 'video-meta',
    title: info.title || '',
    description: info.description || '',
    transcript,
    hasSubtitles: transcript.length > 50,
    imageUrl: info.thumbnail || '',
    thumbnail: info.thumbnail || '',
    sourceUrl: parsed.href,
    extractedVia: transcript.length > 50 ? 'yt-dlp-subtitles' : 'yt-dlp-metadata',
  });
});

app.post('/api/extract-url', standardLimiter, async (req, res) => {
  const target = cleanUrl(req.body?.url);
  const safe = await requireSafeUrl(target);
  if (!safe.ok) return res.status(400).json({ ok: false, error: safe.error });
  const { parsed } = safe;

  try {
    const fetched = await fetchText(parsed.href, 25000);
    const recipe = extractJsonLdRecipe(fetched.text);
    if (recipe) {
      return res.json({
        ok: true,
        type: 'jsonld',
        recipe,
        sourceUrl: parsed.href,
        imageUrl: extractMeta(fetched.text, 'og:image') || '',
        extractedVia: 'server-jsonld',
      });
    }
    return res.json({
      ok: true,
      type: 'caption',
      caption: stripHtml(fetched.text).slice(0, 9000),
      title: extractMeta(fetched.text, 'og:title') || '',
      imageUrl: extractMeta(fetched.text, 'og:image') || '',
      sourceUrl: parsed.href,
      extractedVia: 'server-html',
    });
  } catch (err) {
    return res.json({ ok: false, error: err.message });
  }
});

app.post('/api/extract-instagram-agent', standardLimiter, async (req, res) => {
  const target = cleanUrl(req.body?.url);
  const parsed = validHttpUrl(target);
  if (!parsed || !/instagram\.com$/i.test(parsed.hostname.replace(/^www\./, ''))) {
    return res.status(400).json({ ok: false, error: 'invalid-instagram-url' });
  }

  const shortcode = extractInstagramShortcode(parsed.href);
  if (!shortcode) return res.status(400).json({ ok: false, error: 'missing-shortcode' });

  const candidates = [
    `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
    `https://www.instagram.com/reel/${shortcode}/embed/captioned/`,
    parsed.href,
  ];

  for (const candidate of candidates) {
    try {
      const fetched = await fetchText(candidate, 25000);
      if (!fetched.text || fetched.text.length < 500) continue;
      const data = extractInstagramEmbedData(fetched.text, parsed.href);
      if (data.caption || data.rawText || data.imageUrl) {
        return res.json({
          ok: true,
          ...data,
          imageUrls: data.imageUrl ? [data.imageUrl] : [],
          extractedVia: 'server-instagram-embed',
        });
      }
    } catch { /* try next candidate */ }
  }

  return res.json({ ok: false, error: 'no-instagram-data' });
});

app.post('/api/structure-recipe', expensiveLimiter, async (req, res) => {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_KEY;
  const rawText = String(req.body?.rawText || '').trim();
  if (!key) return res.status(503).json({ ok: false, error: 'gemini-not-configured' });
  if (rawText.length < 20) return res.status(400).json({ ok: false, error: 'rawText-required' });

  const type = req.body?.type === 'drink' ? 'drink' : 'meal';
  const title = String(req.body?.title || '').trim();
  // The user turn: the raw source, plus an optional name hint. The structuring
  // rules, taxonomy, and JSON shape all come from the shared SYSTEM_INSTRUCTION +
  // RECIPE_SCHEMA below, so this matches the client text path exactly.
  const userText = `${title ? `Name hint: ${title}\n\n` : ''}${rawText.slice(0, 9000)}`;

  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: RECIPE_SCHEMA,
      },
    });
    // Prepend kind-relevant few-shot turns, then the real source.
    const contents = [
      ...buildFewShotContents(type),
      { role: 'user', parts: [{ text: userText }] },
    ];
    const result = await model.generateContent({ contents });
    const text = result.response.text().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(text);
    if (parsed.error) return res.status(422).json({ ok: false, error: parsed.error });
    if (parsed.isRecipe === false) return res.status(422).json({ ok: false, error: 'not-a-recipe' });
    return res.json({ ok: true, recipe: parsed });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// ASR frontier scaffold (Phase 6) — OFF BY DEFAULT, provider-agnostic, env-gated.
// -----------------------------------------------------------------------------
// Transcribes video-only recipes (no captions) so the transcript can feed the
// client's captionToRecipe. This route does NOTHING unless ASR_ENDPOINT is set.
// Zero-cost two-tier strategy:
// (1) try yt-dlp subtitles first (cheap, no media download);
// (2) if no usable subs, download audio + ffmpeg transcode to 16kHz WAV;
// (3a) if ASR_ENDPOINT configured → POST WAV to external Whisper-compatible API;
// (3b) otherwise → serve the WAV back to the browser for client-side Whisper.
// No key/URL is ever hardcoded — env vars only (ASR_ENDPOINT, ASR_API_KEY).
/** True when an external Whisper-compatible endpoint is configured. */
function asrEndpointConfigured() {
  return Boolean(process.env.ASR_ENDPOINT);
}

// Run yt-dlp to write subtitles only (no full download). Resolves with the
// cleaned subtitle transcript if any English track was written, else ''.
function runYtDlpSubtitles(url, timeoutMs = 70000) {
  return new Promise((resolve) => {
    const bin = resolveYtDlpBin();
    // --skip-download grabs metadata/subs without the media; auto-subs cover
    // creator captions; --sub-lang en limits to English; --dump-json so we can
    // locate the written caption track URL via the same pickCaptionUrl path.
    const child = spawn(
      bin,
      [
        '--write-subs',
        '--write-auto-subs',
        '--sub-lang', 'en',
        '--skip-download',
        '--dump-json',
        '--no-warnings',
        url,
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: 'yt-dlp-timeout' });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
    child.on('close', async (code) => {
      clearTimeout(timer);
      if (code !== 0 || !stdout.trim()) {
        return resolve({ ok: false, error: stderr || `yt-dlp exited ${code}` });
      }
      let info;
      try {
        info = JSON.parse(stdout.trim().split('\n').at(-1));
      } catch (err) {
        return resolve({ ok: false, error: err.message });
      }
      const captionUrl = pickCaptionUrl(info);
      if (!captionUrl) return resolve({ ok: true, transcript: '', info });
      try {
        const fetched = await fetchText(captionUrl, 20000);
        return resolve({ ok: true, transcript: cleanSubtitle(fetched.text), info });
      } catch {
        return resolve({ ok: true, transcript: '', info });
      }
    });
  });
}

app.post('/api/transcribe', expensiveLimiter, async (req, res) => {
  const target = cleanUrl(req.body?.url);
  const safe = await requireSafeUrl(target);
  if (!safe.ok) return res.status(400).json({ ok: false, error: safe.error });
  const { parsed } = safe;

  // Step 1 — subtitles first (cheap path, no media download).
  const subs = await runYtDlpSubtitles(parsed.href);
  if (subs.ok && subs.transcript && subs.transcript.length > 50) {
    return res.json({
      ok: true,
      transcript: subs.transcript,
      sourceUrl: parsed.href,
      extractedVia: 'yt-dlp-subtitles',
    });
  }

  // Step 2 — no usable subtitles: download audio + transcode + POST to ASR.
  const tmpDir = os.tmpdir();
  const stamp = `spicehub-asr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rawAudioPath = path.join(tmpDir, `${stamp}-raw.%(ext)s`);
  const wavPath = path.join(tmpDir, `${stamp}.wav`);

  // Helper to silently remove temp files
  const cleanup = () => {
    for (const p of [wavPath]) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
    // yt-dlp output has the real extension filled in; glob-clean the prefix
    try {
      for (const f of fs.readdirSync(tmpDir)) {
        if (f.startsWith(stamp)) {
          try { fs.unlinkSync(path.join(tmpDir, f)); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  };

  try {
    // 1) Download best audio stream with yt-dlp
    const dlResult = await new Promise((resolve) => {
      const bin = resolveYtDlpBin();
      const child = spawn(bin, [
        '-f', 'bestaudio/best',
        '-x',
        '--audio-format', 'wav',
        '-o', rawAudioPath,
        '--no-warnings',
        '--no-playlist',
        parsed.href,
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

      let stderr = '';
      const timer = setTimeout(() => { child.kill(); resolve({ ok: false, error: 'audio-download-timeout' }); }, 120000);
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, error: err.message }); });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0 ? { ok: true } : { ok: false, error: stderr || `yt-dlp audio exit ${code}` });
      });
    });

    if (!dlResult.ok) {
      cleanup();
      return res.status(422).json({ ok: false, error: dlResult.error, sourceUrl: parsed.href });
    }

    // Find the actual downloaded file (yt-dlp replaces %(ext)s with real ext)
    const dlFiles = fs.readdirSync(tmpDir).filter((f) => f.startsWith(stamp) && f !== path.basename(wavPath));
    const rawFile = dlFiles[0] ? path.join(tmpDir, dlFiles[0]) : null;
    if (!rawFile || !fs.existsSync(rawFile)) {
      cleanup();
      return res.status(422).json({ ok: false, error: 'audio-file-not-found', sourceUrl: parsed.href });
    }

    // 2) Transcode to 16 kHz mono WAV with ffmpeg
    const ffResult = await new Promise((resolve) => {
      const child = spawn('ffmpeg', [
        '-y', '-i', rawFile,
        '-ar', '16000', '-ac', '1',
        '-f', 'wav',
        wavPath,
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

      let stderr = '';
      const timer = setTimeout(() => { child.kill(); resolve({ ok: false, error: 'ffmpeg-timeout' }); }, 60000);
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, error: `ffmpeg: ${err.message}` }); });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0 ? { ok: true } : { ok: false, error: stderr.slice(-500) || `ffmpeg exit ${code}` });
      });
    });

    if (!ffResult.ok || !fs.existsSync(wavPath)) {
      cleanup();
      return res.status(422).json({ ok: false, error: ffResult.error || 'transcode-failed', sourceUrl: parsed.href });
    }

    // 3) Branch: external ASR endpoint OR serve audio for browser Whisper
    if (asrEndpointConfigured()) {
      // ── External ASR endpoint (Whisper-compatible POST) ──
      const endpoint = process.env.ASR_ENDPOINT;
      const apiKey = process.env.ASR_API_KEY || '';
      const modelName = process.env.ASR_MODEL || 'whisper-1';

      const audioBuffer = fs.readFileSync(wavPath);
      const blob = new Blob([audioBuffer], { type: 'audio/wav' });
      const form = new FormData();
      form.append('file', blob, 'audio.wav');
      form.append('model', modelName);
      form.append('response_format', 'verbose_json');

      const headers = {};
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const asrResp = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: form,
      });

      cleanup();

      if (!asrResp.ok) {
        const errText = await asrResp.text().catch(() => '');
        return res.status(502).json({ ok: false, error: `asr-${asrResp.status}: ${errText.slice(0, 300)}` });
      }

      const asrData = await asrResp.json();
      const transcript = asrData.text || '';

      if (!transcript || transcript.length < 10) {
        return res.json({ ok: false, error: 'asr-empty-transcript', sourceUrl: parsed.href });
      }

      return res.json({
        ok: true,
        transcript,
        language: asrData.language || 'en',
        duration: asrData.duration,
        sourceUrl: parsed.href,
        extractedVia: `asr-${modelName}`,
      });
    }

    // ── No external ASR: serve the WAV for browser-side Whisper ──
    // Keep the WAV alive (don't cleanup yet) — it will be served via
    // /api/tmp-audio/:filename and auto-cleaned after download or timeout.
    const wavFilename = `${stamp}.wav`;
    // Clean up everything EXCEPT the WAV
    try {
      for (const f of fs.readdirSync(tmpDir)) {
        if (f.startsWith(stamp) && f !== wavFilename) {
          try { fs.unlinkSync(path.join(tmpDir, f)); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }

    // Schedule cleanup after 5 minutes in case browser never fetches
    setTimeout(() => {
      try { fs.unlinkSync(wavPath); } catch { /* ignore */ }
    }, 5 * 60 * 1000);

    return res.json({
      ok: false,
      audioUrl: `/api/tmp-audio/${wavFilename}`,
      sourceUrl: parsed.href,
      extractedVia: 'none',
      hint: 'audio-ready-for-browser',
    });
  } catch (err) {
    cleanup();
    return res.status(502).json({ ok: false, error: err.message });
  }
});

// Serve temp audio files for browser-side Whisper (zero-cost fallback)
app.get('/api/tmp-audio/:filename', (req, res) => {
  const { filename } = req.params;
  // Strict allowlist: only our own generated names, no path separators or
  // dot-dot segments possible (previously startsWith/endsWith checks alone
  // let `spicehub-asr-../../../etc/passwd.wav` through path.join unsanitized).
  if (!/^spicehub-asr-[a-zA-Z0-9_-]+\.wav$/.test(filename)) {
    return res.status(400).json({ error: 'invalid-filename' });
  }
  const filePath = path.join(os.tmpdir(), filename);
  // Belt-and-suspenders: confirm the resolved path still lives inside tmpdir.
  const resolvedTmp = path.resolve(os.tmpdir());
  if (!path.resolve(filePath).startsWith(resolvedTmp + path.sep)) {
    return res.status(400).json({ error: 'invalid-filename' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'audio-expired' });
  }
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Cache-Control', 'no-store');
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  stream.on('end', () => {
    // Clean up after serving
    setTimeout(() => {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }, 10000);
  });
});

const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath, {
  // Vite hashes /assets/[name]-[hash].ext, so those are safe to cache
  // immutably for a year. Everything else (notably index.html and sw.js)
  // must stay no-cache so PWA updates (registerType: 'autoUpdate') roll out
  // promptly instead of being stuck on a cached shell.
  setHeaders(res, filePath) {
    if (/[\\/]assets[\\/]/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(distPath, 'index.html'));
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`SpiceHub resource server listening on port ${PORT}`);
  });
}
