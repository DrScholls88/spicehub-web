#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// build-discover-catalog.mjs — dev-time builder for the static Discover catalog.
//
// WHY: api/discover.js is RSS-only, but several high-value drink sites
// (Difford's Guide, Kindred Cocktails) publish no feed. They do publish a
// sitemap and parseable recipe markup. This script turns a SMALL, curated slice
// of each sitemap into public/discover/<kind>-catalog.json, which api/discover.js
// merges into the feed. Run it by hand when you want to refresh the catalog:
//
//   node scripts/build-discover-catalog.mjs                 (all sites, drinks)
//   node scripts/build-discover-catalog.mjs --site kindred  (one site)
//   node scripts/build-discover-catalog.mjs --extra 40      (bigger spread sample)
//   node scripts/build-discover-catalog.mjs --dry           (list picks, no fetch)
//
// WHAT IT STORES: title, link, image URL (hot-linked) and an ingredient-NAME
// summary for filtering. No quantities, no method text — the full recipe is
// fetched live by the normal import when a user taps Import.
//
// MANNERS: honest User-Agent, one request per --delay ms (default 1200), backs
// off a site on repeated 403/429, bounded page count. robots.txt was checked by
// hand on 2026-10-27: Difford's allows /cocktails/recipe/*; Kindred allows
// /cocktail/* (explicit Allow overriding its broad Disallow). Re-check if a
// site changes its robots.txt.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseHtmlStructured, extractMeta, findJsonLdRecipes, decodeHtml } from '../src/lib/recipeHtmlExtraction.js';

const UA = 'SpiceHubCatalogBot/1.0 (+https://spicehub-web.vercel.app; personal recipe app, 1 req/s)';

// Sitemap → recipe-URL rules per site. `slugOf` returns the recipe slug or null.
export const SITES = {
  drinks: {
    diffords: {
      name: "Difford's Guide", emoji: '📚', tags: ['classic', 'database'],
      sitemaps: ['https://www.diffordsguide.com/sitemap/cocktail.xml'],
      slugOf: (u) => /\/cocktails\/recipe\/\d+\/([a-z0-9-]+)$/i.exec(u)?.[1]?.toLowerCase() ?? null,
    },
    kindred: {
      name: 'Kindred Cocktails', emoji: '🥂', tags: ['classic', 'community'],
      sitemaps: [1, 2, 3, 4, 5, 6].map((p) => `https://kindredcocktails.com/sitemap.xml?page=${p}`),
      slugOf: (u) => /kindredcocktails\.com\/cocktail\/([a-z0-9-]+)$/i.exec(u)?.[1]?.toLowerCase() ?? null,
    },
  },
};

// Hand-picked "high value" names. Each resolves by a precision-first ladder:
// the exact slug, then name + a "this is the canonical one" suffix. A name with
// no such page is SKIPPED rather than approximated — the shortest-prefix guess
// picked riffs ("negroni-flip", "martini-thyme"). Aliases cover sites that name
// the classic differently (Difford's files the martini under "dry-martini-*").
export const CANONICAL_SUFFIXES = ['', '-cocktail', '-diffords-recipe', '-classic', '-original', '-traditional', '-standard', '-savoy-spec'];
export const ALIASES = {
  martini: ['dry-martini', 'dry-martini-cocktail', 'gin-martini'],
  'mai-tai': ['mai-tai-trader-vics'],
  'pina-colada': ['pina-colada-cocktail'],
  vesper: ['vesper-martini'],
};

export const CLASSICS = [
  'old-fashioned', 'negroni', 'manhattan', 'martini', 'margarita', 'daiquiri', 'whiskey-sour',
  'mai-tai', 'mojito', 'paloma', 'espresso-martini', 'moscow-mule', 'cosmopolitan', 'tom-collins',
  'french-75', 'sazerac', 'boulevardier', 'last-word', 'aviation', 'gimlet', 'penicillin',
  'paper-plane', 'bees-knees', 'mint-julep', 'bloody-mary', 'pina-colada', 'jungle-bird',
  'painkiller', 'sidecar', 'vesper', 'white-russian', 'amaretto-sour', 'tequila-sunrise',
  'mimosa', 'bellini', 'caipirinha', 'pisco-sour', 'singapore-sling', 'zombie', 'gin-and-tonic',
];

// ── Pure helpers (exported for tests/import/corpus.discoverCatalog.test.js) ──

/** <loc> URLs from sitemap XML (urlset only; sitemap-index entries are ignored). */
export function parseSitemapLocs(xml) {
  return [...String(xml).matchAll(/<url>[\s\S]*?<loc>([^<]+)<\/loc>/gi)].map((m) => decodeHtml(m[1].trim()));
}

/** Resolve each classic via the canonical ladder. Returns [{ name, url }]. */
export function pickClassics(urls, slugOf, classics = CLASSICS) {
  const bySlug = new Map();
  for (const u of urls) {
    const sl = slugOf(u);
    if (sl && !bySlug.has(sl)) bySlug.set(sl, u);
  }
  const picks = [];
  for (const name of classics) {
    const candidates = [name, ...(ALIASES[name] || [])].flatMap((n) => CANONICAL_SUFFIXES.map((x) => n + x));
    const hit = candidates.find((c) => bySlug.has(c));
    if (hit) picks.push({ name, url: bySlug.get(hit) });
  }
  return picks;
}

/** Deterministic evenly-spaced sample of `n` URLs (stable across runs). */
export function spreadSample(urls, n, slugOf, exclude = new Set()) {
  const pool = urls.filter((u) => slugOf(u) && !exclude.has(u)).sort();
  if (n <= 0 || !pool.length) return [];
  if (pool.length <= n) return pool;
  return Array.from({ length: n }, (_, i) => pool[Math.floor((i * pool.length) / n)]);
}

const UNIT_RX = /^(?:oz|ounces?|ml|cl|dl|l|dash(?:es)?|ds|tsp|tbsp|cups?|cubes?|twst|twists?|whole|each|ea|parts?|bsp|barspoons?|drops?|leaf|leaves|slices?|wedges?|sprigs?|splash(?:es)?|pinch(?:es)?|rinse|scoops?|barspoon)\b\.?\s*/i;

/** "3 oz Bourbon (or rye)" → "Bourbon". Display/filter only; tolerant of noise. */
export function ingredientName(line) {
  let s = String(line || '').replace(/\([^)]*\)/g, ' ').replace(/^[\s\d/.½¼¾⅓⅔-]+/, '');
  s = s.replace(UNIT_RX, '');
  s = s.split(',')[0].replace(/\s+/g, ' ').trim();
  return s.length > 1 && s.length <= 40 ? s : '';
}

/** Build one catalog post from a fetched recipe page, or null if unusable. */
export function postFromHtml(html, url, siteKey, site) {
  const r = parseHtmlStructured(html, url);
  // Strip a trailing "(Difford's recipe)"-style attribution from the card title.
  const name = (r?.name || '').replace(/\s*\([^)]*\brecipe\)\s*$/i, '').trim();
  if (!r || !name || !(r.ingredients?.length > 0)) return null;
  // og:image / JSON-LD only — parseHtmlStructured's pickImage() may grab an
  // arbitrary on-page <img> (avatars, logos) that is wrong for a card.
  const jsonLdImage = findJsonLdRecipes(html)[0]?.imageUrl || '';
  const imageUrl = extractMeta(html, 'og:image') || jsonLdImage || '';
  const names = [...new Set(r.ingredients.map(ingredientName).filter(Boolean))];
  return {
    title: name,
    link: url,
    imageUrl: /^https?:\/\//i.test(imageUrl) ? imageUrl : '',
    snippet: names.join(', ').slice(0, 300),
    pubDate: null,
    postType: 'recipe',
    categories: [],
    source: siteKey,
    sourceName: site.name,
    sourceEmoji: site.emoji,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const resp = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xml' }, signal: AbortSignal.timeout(20000) });
  return { status: resp.status, text: resp.ok ? await resp.text() : '' };
}

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

async function main() {
  const kind = String(arg('kind', 'drinks'));
  const only = arg('site', null);
  const extra = Number(arg('extra', 30));
  const delay = Number(arg('delay', 1200));
  const dry = arg('dry', false) === true;
  const sites = SITES[kind];
  if (!sites) throw new Error(`Unknown --kind "${kind}". Known: ${Object.keys(SITES).join(', ')}`);

  const outFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'discover', `${kind}-catalog.json`);
  let previous = { posts: [], sources: {} };
  try { previous = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch { /* first run */ }

  const posts = [];
  const sources = {};
  for (const [key, site] of Object.entries(sites)) {
    if (only && only !== key) {
      // Keep the other sites' existing entries untouched.
      posts.push(...previous.posts.filter((p) => p.source === key));
      if (previous.sources?.[key]) sources[key] = previous.sources[key];
      continue;
    }
    console.log(`\n== ${site.name}`);
    const urls = [];
    for (const sm of site.sitemaps) {
      const { status, text } = await get(sm);
      if (status !== 200) { console.log(`  sitemap ${sm} -> ${status}`); continue; }
      urls.push(...parseSitemapLocs(text));
      await sleep(delay);
    }
    const recipeUrls = urls.filter((u) => site.slugOf(u));
    const classics = pickClassics(recipeUrls, site.slugOf);
    const spread = spreadSample(recipeUrls, extra, site.slugOf, new Set(classics.map((c) => c.url)));
    const targets = [...classics.map((c) => c.url), ...spread];
    console.log(`  ${recipeUrls.length} recipe URLs → ${classics.length} classics + ${spread.length} sampled`);
    if (dry) { targets.forEach((u) => console.log('   ', u)); continue; }
    if (!recipeUrls.length) {
      console.log('  no sitemap data — keeping previous entries for this site');
      posts.push(...previous.posts.filter((p) => p.source === key));
      if (previous.sources?.[key]) sources[key] = previous.sources[key];
      continue;
    }

    let blocked = 0;
    const got = [];
    for (const u of targets) {
      const { status, text } = await get(u).catch((e) => ({ status: 0, text: '', err: e.message }));
      if (status === 403 || status === 429) { if (++blocked >= 2) { console.log('  blocked twice — stopping this site'); break; } }
      else if (status === 200) {
        const p = postFromHtml(text, u, key, site);
        if (p) { got.push(p); console.log(`  ✓ ${p.title}`); } else console.log(`  - no recipe parsed: ${u}`);
      } else console.log(`  ! ${status} ${u}`);
      await sleep(delay);
    }
    if (got.length) {
      posts.push(...got);
      sources[key] = { name: site.name, emoji: site.emoji, tags: site.tags };
    } else {
      posts.push(...previous.posts.filter((p) => p.source === key));
      if (previous.sources?.[key]) sources[key] = previous.sources[key];
    }
  }

  if (dry) return;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), sources, posts }, null, 1) + '\n');
  console.log(`\nWrote ${posts.length} posts → ${path.relative(process.cwd(), outFile)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
