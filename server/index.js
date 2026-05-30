/**
 * SpiceHub resource server.
 *
 * The app remains client-first and offline-capable. These endpoints only help
 * online link imports fetch resources the browser cannot reliably access:
 * video metadata/subtitles, server-side HTML, and Instagram embed data.
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'node:child_process';
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

export const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

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
    const bin = process.env.YT_DLP_BIN || 'yt-dlp';
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

app.post('/api/resolve-url', async (req, res) => {
  const target = cleanUrl(req.body?.url);
  const parsed = validHttpUrl(target);
  if (!parsed) return res.status(400).json({ ok: false, error: 'invalid-url' });
  try {
    const response = await fetch(parsed.href, { method: 'HEAD', redirect: 'follow', headers: headersFor(parsed.href) });
    res.json({ ok: true, resolvedUrl: response.url || parsed.href });
  } catch {
    res.json({ ok: true, resolvedUrl: parsed.href });
  }
});

app.post('/api/extract-video', async (req, res) => {
  const target = cleanUrl(req.body?.url);
  const parsed = validHttpUrl(target);
  if (!parsed) return res.status(400).json({ ok: false, error: 'invalid-url' });

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

app.post('/api/extract-url', async (req, res) => {
  const target = cleanUrl(req.body?.url);
  const parsed = validHttpUrl(target);
  if (!parsed) return res.status(400).json({ ok: false, error: 'invalid-url' });

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

app.post('/api/extract-instagram-agent', async (req, res) => {
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

app.post('/api/structure-recipe', async (req, res) => {
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
// Strategy: (1) try yt-dlp subtitles first (cheap, no media download); (2) ONLY
// if no usable subs exist, download an audio-only stream, transcode with ffmpeg,
// and POST to a Whisper-compatible endpoint at ASR_ENDPOINT. No key/URL is ever
// hardcoded — both come from server env (ASR_ENDPOINT, optional ASR_API_KEY).
function asrEnabled() {
  return Boolean(process.env.ASR_ENDPOINT);
}

// Run yt-dlp to write subtitles only (no full download). Resolves with the
// cleaned subtitle transcript if any English track was written, else ''.
function runYtDlpSubtitles(url, timeoutMs = 70000) {
  return new Promise((resolve) => {
    const bin = process.env.YT_DLP_BIN || 'yt-dlp';
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

app.post('/api/transcribe', async (req, res) => {
  // Hard env gate: when ASR is not configured, return 501 and change nothing.
  if (!asrEnabled()) {
    return res.status(501).json({ ok: false, error: 'asr-disabled' });
  }

  const target = cleanUrl(req.body?.url);
  const parsed = validHttpUrl(target);
  if (!parsed) return res.status(400).json({ ok: false, error: 'invalid-url' });

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

  // Step 2 — no usable subtitles: fall back to audio download + ASR.
  // SCAFFOLD: the audio→ffmpeg→Whisper-POST network path is intentionally a
  // clearly-commented stub. It is wired only behind the ASR_ENDPOINT gate above
  // and performs no work / makes no external calls until implemented.
  try {
    // TODO(asr): 1) yt-dlp -f bestaudio -x --audio-format <wav|mp3> to a temp file
    //    (reuse spawn(bin, [...]) like runYtDlpJson; write to os.tmpdir()).
    // TODO(asr): 2) Transcode/normalize with ffmpeg to 16kHz mono PCM/WAV
    //    (spawn('ffmpeg', ['-i', inFile, '-ar', '16000', '-ac', '1', outFile])).
    // TODO(asr): 3) POST the audio to the Whisper-compatible endpoint:
    //    const endpoint = process.env.ASR_ENDPOINT;            // never hardcoded
    //    const apiKey = process.env.ASR_API_KEY;               // optional, env-only
    //    const form = new FormData();
    //    form.append('file', new Blob([audioBuffer]), 'audio.wav');
    //    form.append('model', process.env.ASR_MODEL || 'whisper-1');
    //    const r = await fetch(endpoint, {
    //      method: 'POST',
    //      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    //      body: form,
    //    });
    //    const { text } = await r.json();
    // TODO(asr): 4) Clean up temp files, then return the transcript below.
    return res.status(501).json({
      ok: false,
      error: 'asr-audio-path-not-implemented',
      sourceUrl: parsed.href,
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
});

const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`SpiceHub resource server listening on port ${PORT}`);
  });
}
