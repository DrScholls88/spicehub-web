// ─────────────────────────────────────────────────────────────────────────────
// /api/extract — unified server-side acquisition (Vercel serverless, free tier)
//
// Scope (spec §4, deliberately narrow):
//   • Website fetching + basic parsing: JSON-LD (@graph aware), microdata,
//     OG meta, and Readability-style main-content isolation → markdown-lite.
//   • Instagram embed / ?__a=1-style JSON calls as a FALLBACK to Apify
//     (Apify orchestration stays client-side).
//
// No secrets required, rate-limited per IP. Uses cheerio (server-only) to read
// WordPress recipe-plugin cards; the client keeps its DOMParser path as fallback.
// Pure helpers are exported for the golden corpus (tests/import/corpus.extract.test.js).
// ─────────────────────────────────────────────────────────────────────────────
import { extractPluginCandidate } from '../src/import/pluginExtractors.js';

const FETCH_TIMEOUT_MS = 12000;
const MAX_HTML_BYTES = 2_500_000;
const MAX_MARKDOWN_CHARS = 60000;

export const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Control characters (except \t \n \r) — they break JSON.parse on sloppy sites.
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

// ── Rate limiting (best-effort in-memory; resets on cold start) ──────────────
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX = 40;
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

// ── Small shared utilities ────────────────────────────────────────────────────
export function decodeEntities(s = '') {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => {
      const code = Number(d);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : '';
    });
}

export function extractMetaTag(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${property}["'][^>]+content\\s*=\\s*["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]+(?:property|name)\\s*=\\s*["']${property}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m && m[1]) return decodeEntities(m[1].trim());
  }
  return '';
}

/** ISO-8601 duration ("PT1H35M") → human text ("1 hr 35 min"); passthrough otherwise. */
export function humanizeDuration(iso = '') {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(String(iso).trim());
  if (!m) return String(iso || '');
  const [, d, h, min] = m;
  const parts = [];
  if (d) parts.push(`${Number(d)} day${Number(d) > 1 ? 's' : ''}`);
  if (h) parts.push(`${Number(h)} hr`);
  if (min) parts.push(`${Number(min)} min`);
  return parts.join(' ') || String(iso);
}

// ── JSON-LD extraction (@graph aware) ────────────────────────────────────────
function walkForRecipes(node, out, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return;
  if (Array.isArray(node)) {
    for (const item of node) walkForRecipes(item, out, depth + 1);
    return;
  }
  const type = node['@type'];
  const types = Array.isArray(type) ? type : type ? [type] : [];
  if (types.some((t) => String(t).toLowerCase() === 'recipe')) out.push(node);
  if (node['@graph']) walkForRecipes(node['@graph'], out, depth + 1);
  if (node.mainEntity) walkForRecipes(node.mainEntity, out, depth + 1);
  if (node.mainEntityOfPage && typeof node.mainEntityOfPage === 'object') {
    walkForRecipes(node.mainEntityOfPage, out, depth + 1);
  }
}

export function extractJsonLdRecipes(html) {
  const out = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].replace(CONTROL_CHARS_RE, '').trim();
    if (!raw) continue;
    try {
      walkForRecipes(JSON.parse(raw), out);
    } catch {
      // Some sites emit trailing commas or concatenated objects; lenient pass.
      try {
        walkForRecipes(JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')), out);
      } catch {
        /* unparseable block — skip */
      }
    }
  }
  return out;
}

function instructionText(step) {
  if (!step) return '';
  if (typeof step === 'string') return decodeEntities(step.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  if (typeof step === 'object') return instructionText(step.text || step.name || '');
  return '';
}

function flattenInstructions(inst, out = []) {
  if (!inst) return out;
  if (typeof inst === 'string') {
    const cleaned = instructionText(inst);
    const byNumbers = cleaned.split(/\s*(?:^|\s)\d+[.)]\s+/).map((s) => s.trim()).filter((s) => s.length > 3);
    if (byNumbers.length > 1) out.push(...byNumbers);
    else if (cleaned) out.push(cleaned);
    return out;
  }
  if (Array.isArray(inst)) {
    for (const item of inst) flattenInstructions(item, out);
    return out;
  }
  if (typeof inst === 'object') {
    const types = Array.isArray(inst['@type']) ? inst['@type'] : [inst['@type']];
    if (types.some((t) => String(t).toLowerCase() === 'howtosection')) {
      flattenInstructions(inst.itemListElement, out);
      return out;
    }
    const text = instructionText(inst);
    if (text) out.push(text);
    else if (inst.itemListElement) flattenInstructions(inst.itemListElement, out);
    return out;
  }
  return out;
}

function imageFromJsonLd(image) {
  if (!image) return '';
  if (typeof image === 'string') return image;
  if (Array.isArray(image)) return imageFromJsonLd(image[0]);
  if (typeof image === 'object') return image.url || image.contentUrl || '';
  return '';
}

/** Map a raw Schema.org Recipe node to a flat recipe candidate. */
export function jsonLdToCandidate(node) {
  if (!node) return null;
  const ingredients = (Array.isArray(node.recipeIngredient) ? node.recipeIngredient : [])
    .map((i) => decodeEntities(String(i)).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const directions = flattenInstructions(node.recipeInstructions).filter(Boolean);
  const name = decodeEntities(String(node.name || '')).trim();
  if (!name && ingredients.length === 0 && directions.length === 0) return null;

  const nutrition = node.nutrition && typeof node.nutrition === 'object'
    ? {
        calories: node.nutrition.calories || '',
        protein: node.nutrition.proteinContent || '',
        carbohydrates: node.nutrition.carbohydrateContent || '',
        totalFat: node.nutrition.fatContent || '',
      }
    : null;

  return {
    name,
    description: decodeEntities(String(node.description || '')).trim(),
    ingredients,
    directions,
    imageUrl: imageFromJsonLd(node.image),
    recipeYield: Array.isArray(node.recipeYield) ? String(node.recipeYield[0] || '') : String(node.recipeYield || ''),
    servings: '',
    prepTime: humanizeDuration(node.prepTime || ''),
    cookTime: humanizeDuration(node.cookTime || ''),
    totalTime: humanizeDuration(node.totalTime || ''),
    cuisine: Array.isArray(node.recipeCuisine) ? String(node.recipeCuisine[0] || '') : String(node.recipeCuisine || ''),
    course: Array.isArray(node.recipeCategory) ? String(node.recipeCategory[0] || '') : String(node.recipeCategory || ''),
    nutrition,
    author: typeof node.author === 'object' ? (node.author?.name || '') : String(node.author || ''),
  };
}

// ── Microdata extraction ──────────────────────────────────────────────────────
export function extractMicrodataCandidate(html) {
  if (!/itemtype\s*=\s*["'][^"']*schema\.org\/Recipe/i.test(html)) return null;

  const ingredients = [];
  const ingRe = /itemprop\s*=\s*["']recipeIngredient["'][^>]*>([\s\S]*?)<\/(?:li|span|p|div)>/gi;
  let m;
  while ((m = ingRe.exec(html)) !== null) {
    const text = decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (text && text.length < 200) ingredients.push(text);
  }

  const directions = [];
  const dirRe = /itemprop\s*=\s*["']recipeInstructions["'][^>]*>([\s\S]*?)<\/(?:li|p|div|section|ol)>/gi;
  while ((m = dirRe.exec(html)) !== null) {
    const blob = decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!blob) continue;
    const sentences = blob.split(/(?<=[.!])\s+(?=[A-Z])/).map((s) => s.trim()).filter((s) => s.length > 5);
    directions.push(...(sentences.length ? sentences : [blob]));
  }

  const nameM = /itemprop\s*=\s*["']name["'][^>]*>([\s\S]*?)<\/(?:h1|h2|h3|span|div)>/i.exec(html);
  const name = nameM ? decodeEntities(nameM[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : '';
  const imgM = /<img[^>]+itemprop\s*=\s*["']image["'][^>]+src\s*=\s*["']([^"']+)["']/i.exec(html)
    || /itemprop\s*=\s*["']image["'][^>]+(?:content|href|src)\s*=\s*["']([^"']+)["']/i.exec(html);
  const yieldM = /itemprop\s*=\s*["']recipeYield["'][^>]*>([\s\S]*?)<\/(?:span|div|p)>/i.exec(html);

  if (!name && ingredients.length === 0) return null;
  return {
    name,
    description: '',
    ingredients,
    directions,
    imageUrl: imgM ? imgM[1] : '',
    recipeYield: yieldM ? decodeEntities(yieldM[1].replace(/<[^>]+>/g, ' ')).trim() : '',
    servings: '', prepTime: '', cookTime: '', totalTime: '',
    cuisine: '', course: '', nutrition: null, author: '',
  };
}

// ── Main-content isolation → markdown-lite ────────────────────────────────────
const DROP_TAGS = ['script', 'style', 'noscript', 'svg', 'iframe', 'form', 'nav', 'header', 'footer', 'aside', 'button', 'select', 'video', 'audio', 'canvas', 'template'];
const JUNK_BLOCK_RE = /(comment|sidebar|related|newsletter|share|social|widget|promo|advert|banner|cookie|popup|subscribe|breadcrumb|pagination|author-bio|jump-to)/i;

export function isolateMainContent(html) {
  let s = String(html);

  // 1. Drop entire non-content tag subtrees.
  for (const tag of DROP_TAGS) {
    s = s.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');
    s = s.replace(new RegExp(`<${tag}[^>]*\\/>`, 'gi'), ' ');
  }
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');

  // 2. Prefer the <main>/<article> region when present.
  const region = /<(main|article)[^>]*>([\s\S]*?)<\/\1>/i.exec(s);
  if (region && region[2] && region[2].replace(/<[^>]+>/g, '').trim().length > 300) {
    s = region[2];
  }

  // 3. Drop obvious junk blocks by id/class keyword (single-level heuristic:
  //    comments/related/share rails; imperfect on nesting, always followed by
  //    the line filters below).
  s = s.replace(
    /<(div|section|ul)[^>]+(?:class|id)\s*=\s*["'][^"']*(?:comment|related|share|social|newsletter|sidebar|widget|promo|advert)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi,
    ' ',
  );

  // 4. Structure → text markers.
  s = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|tr|table|blockquote|figure|figcaption)>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/(h1|h2|h3|h4|h5|h6)>/gi, '\n')
    .replace(/<h1[^>]*>/gi, '\n# ')
    .replace(/<h2[^>]*>/gi, '\n## ')
    .replace(/<h3[^>]*>/gi, '\n### ')
    .replace(/<(h4|h5|h6)[^>]*>/gi, '\n#### ')
    .replace(/<[^>]+>/g, ' ');

  s = decodeEntities(s);

  // 5. Line-level cleanup: collapse whitespace, drop junk-keyword and nav-ish
  //    short lines, dedupe consecutive repeats.
  const lines = [];
  let prev = '';
  for (let line of s.split('\n')) {
    line = line.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (line.length < 4 && !/^#/.test(line)) continue;
    if (JUNK_BLOCK_RE.test(line) && line.length < 60) continue;
    if (/^(home|recipes?|about|contact|shop|search|menu|log ?in|sign ?up|privacy|terms)([ ·|/-]+\w+)*$/i.test(line)) continue;
    if (line === prev) continue;
    lines.push(line);
    prev = line;
  }
  return lines.join('\n').slice(0, MAX_MARKDOWN_CHARS);
}

// ── Website extraction (pure; testable without network) ──────────────────────
export function extractFromHtml(html, url = '') {
  const jsonLdNodes = extractJsonLdRecipes(html);
  let jsonLd = null;
  let candidate = null;
  let acquiredVia = 'none';

  for (const node of jsonLdNodes) {
    const c = jsonLdToCandidate(node);
    if (c && (c.ingredients.length > 0 || c.directions.length > 0)) {
      jsonLd = node;
      candidate = c;
      acquiredVia = 'json-ld';
      break;
    }
    // Stub with a name only — keep as context, keep looking.
    if (c && !jsonLd) jsonLd = node;
  }

  if (!candidate) {
    const micro = extractMicrodataCandidate(html);
    if (micro && micro.ingredients.length > 0) {
      candidate = micro;
      acquiredVia = 'microdata';
    }
  }

  // WordPress recipe-plugin cards (WPRM / Tasty / Mediavine Create / EasyRecipe).
  // Runs only when structured data didn't already yield a candidate, so a complete
  // plugin card lets a blog import without a Gemini call. Falls back silently.
  if (!candidate) {
    const plugin = extractPluginCandidate(html);
    if (plugin && (plugin.ingredients.length > 0 || plugin.directions.length > 0)) {
      candidate = plugin;
      acquiredVia = 'plugin:' + plugin._pluginType;
    }
  }

  const meta = {
    title: extractMetaTag(html, 'og:title') || decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '')).trim(),
    description: extractMetaTag(html, 'og:description'),
    image: extractMetaTag(html, 'og:image') || extractMetaTag(html, 'og:image:secure_url') || extractMetaTag(html, 'twitter:image'),
    siteName: extractMetaTag(html, 'og:site_name'),
  };

  if (candidate && !candidate.imageUrl && meta.image) candidate.imageUrl = meta.image;
  if (acquiredVia === 'none' && meta.title) acquiredVia = 'og-meta';

  const markdown = isolateMainContent(html);

  const images = [];
  if (candidate?.imageUrl) images.push(candidate.imageUrl);
  if (meta.image && !images.includes(meta.image)) images.push(meta.image);

  return { url, acquiredVia, candidate, jsonLd, markdown, meta, images };
}

// ── Instagram fallback (embed page + ?__a=1) — fallback to Apify only ────────
export function extractInstagramShortcode(url = '') {
  const m = /\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/.exec(url);
  return m ? m[2] : null;
}

export function parseEmbedCaption(html) {
  const capM = /<div[^>]+class\s*=\s*["'][^"']*Caption[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (capM) {
    const text = decodeEntities(
      capM[1]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<a[^>]*>[\s\S]*?<\/a>/gi, ' ')
        .replace(/<[^>]+>/g, ' '),
    )
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    if (text.length > 20) return text;
  }
  const og = extractMetaTag(html, 'og:description') || extractMetaTag(html, 'description');
  return og && og.length > 20 ? og : '';
}

export function parseEmbedImage(html) {
  const m =
    /<img[^>]+class\s*=\s*["'][^"']*EmbeddedMediaImage[^"']*["'][^>]+src\s*=\s*["']([^"']+)["']/i.exec(html) ||
    /"display_url"\s*:\s*"([^"]+)"/.exec(html);
  if (!m) return extractMetaTag(html, 'og:image');
  return decodeEntities(m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/'));
}

export async function fetchWithTimeout(url, headers, timeoutMs = FETCH_TIMEOUT_MS) {
  const res = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const text = await res.text();
  return text.length > MAX_HTML_BYTES ? text.slice(0, MAX_HTML_BYTES) : text;
}

export async function extractInstagramFallback(url) {
  const shortcode = extractInstagramShortcode(url);
  if (!shortcode) return { ok: false, reason: 'no-shortcode' };

  // Tier 1: embed page (public, no auth).
  try {
    const html = await fetchWithTimeout(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, BROWSER_HEADERS);
    const caption = parseEmbedCaption(html);
    const image = parseEmbedImage(html);
    if (caption || image) {
      return { ok: true, acquiredVia: 'ig-embed', caption, images: image ? [image] : [], meta: { title: '' } };
    }
  } catch {
    /* fall through */
  }

  // Tier 2: ?__a=1 style JSON (frequently gated, but free when it works).
  try {
    const raw = await fetchWithTimeout(
      `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`,
      { ...BROWSER_HEADERS, Accept: 'application/json' },
      8000,
    );
    const data = JSON.parse(raw);
    const media = data?.items?.[0] || data?.graphql?.shortcode_media;
    if (media) {
      const caption = media?.caption?.text || media?.edge_media_to_caption?.edges?.[0]?.node?.text || '';
      const image = media?.image_versions2?.candidates?.[0]?.url || media?.display_url || '';
      const carousel = (media?.carousel_media || [])
        .map((c) => c?.image_versions2?.candidates?.[0]?.url)
        .filter(Boolean);
      return {
        ok: true,
        acquiredVia: 'ig-json',
        caption,
        images: [image, ...carousel].filter(Boolean).slice(0, 6),
        meta: { title: media?.user?.full_name || '' },
      };
    }
  } catch {
    /* fall through */
  }

  return { ok: false, reason: 'instagram-blocked' };
}

// ── HTTP handler ──────────────────────────────────────────────────────────────
function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const started = Date.now();
  const url = (req.method === 'POST' ? req.body?.url : req.query?.url) || '';

  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ ok: false, reason: 'invalid-url' });
  }
  // SSRF guard: public http(s) hosts only.
  try {
    const host = new URL(url).hostname;
    if (
      /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      !host.includes('.')
    ) {
      return res.status(400).json({ ok: false, reason: 'blocked-host' });
    }
  } catch {
    return res.status(400).json({ ok: false, reason: 'invalid-url' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ ok: false, reason: 'rate-limited' });
  }

  try {
    if (/instagram\.com\//i.test(url)) {
      const ig = await extractInstagramFallback(url);
      return res.status(ig.ok ? 200 : 502).json({
        ...ig,
        url,
        sourceType: 'instagram',
        elapsedMs: Date.now() - started,
      });
    }

    const html = await fetchWithTimeout(url, BROWSER_HEADERS);
    const result = extractFromHtml(html, url);
    return res.status(200).json({
      ok: true,
      sourceType: 'website',
      ...result,
      elapsedMs: Date.now() - started,
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      reason: err?.name === 'TimeoutError' ? 'upstream-timeout' : 'fetch-failed',
      detail: err?.message || String(err),
      url,
      elapsedMs: Date.now() - started,
    });
  }
}
