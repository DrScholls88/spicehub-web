// ─────────────────────────────────────────────────────────────────────────────
// /api/discover — server-side RSS aggregator for recipe blog discovery.
//
// Fetches RSS feeds from curated recipe blogs in parallel, parses XML,
// and returns a unified JSON array of recipe entries. No API keys needed —
// RSS is an open standard and every WordPress recipe blog publishes one.
//
// Query params:
//   ?sources=budgetbytes,minimalistbaker  (comma-sep, default: all)
//   ?limit=30                             (per-source cap, default: 15)
//   ?filter=strict|relaxed                (default: strict — only single-recipe posts)
//
// Caching: 30-minute Cache-Control so Vercel's CDN doesn't re-fetch on
// every request. Clients can force-refresh with Cache-Control: no-cache.
// ─────────────────────────────────────────────────────────────────────────────

export const config = { runtime: 'edge' };

const FEED_TIMEOUT_MS = 8000;

/**
 * Registry of recipe blog RSS feeds, keyed by slug.
 * Each entry: { name, url, feedUrl, emoji, categories[] }
 * `categories` is a loose thematic tag for client-side filtering —
 * actual post categories come from the RSS <category> elements.
 */
const SOURCES = {
  // ── Original 10 ────────────────────────────────────────────────────
  seriouseats:      { name: 'Serious Eats',        feedUrl: 'https://www.seriouseats.com/rss',              emoji: '🔬', tags: ['technique', 'comfort'] },
  budgetbytes:      { name: 'Budget Bytes',         feedUrl: 'https://www.budgetbytes.com/feed/',            emoji: '💰', tags: ['budget', 'weeknight'] },
  recipetineats:    { name: 'RecipeTin Eats',       feedUrl: 'https://www.recipetineats.com/feed/',          emoji: '🍳', tags: ['weeknight', 'comfort'] },
  minimalistbaker:  { name: 'Minimalist Baker',     feedUrl: 'https://minimalistbaker.com/feed/',            emoji: '🌱', tags: ['vegan', 'simple'] },
  smittenkitchen:   { name: 'Smitten Kitchen',      feedUrl: 'https://smittenkitchen.com/feed/',             emoji: '🏙️', tags: ['comfort', 'baking'] },
  pinchofyum:       { name: 'Pinch of Yum',         feedUrl: 'https://pinchofyum.com/feed',                 emoji: '🤌', tags: ['weeknight', 'comfort'] },
  halfbakedharvest: { name: 'Half Baked Harvest',   feedUrl: 'https://www.halfbakedharvest.com/feed/',       emoji: '🌾', tags: ['seasonal', 'comfort'] },
  cookieandkate:    { name: 'Cookie and Kate',      feedUrl: 'https://cookieandkate.com/feed/',              emoji: '🥗', tags: ['vegetarian', 'healthy'] },
  sallysbaking:     { name: "Sally's Baking",       feedUrl: 'https://sallysbakingaddiction.com/feed/',      emoji: '🧁', tags: ['baking', 'dessert'] },
  damndelicious:    { name: 'Damn Delicious',       feedUrl: 'https://damndelicious.net/feed/',              emoji: '🔥', tags: ['weeknight', 'simple'] },
  // ── Expansion (2026-07-16) ─────────────────────────────────────────
  loveandlemons:    { name: 'Love & Lemons',        feedUrl: 'https://www.loveandlemons.com/feed/',          emoji: '🍋', tags: ['vegetarian', 'seasonal'] },
  ambitiouskitchen: { name: 'Ambitious Kitchen',     feedUrl: 'https://www.ambitiouskitchen.com/feed/',       emoji: '💪', tags: ['healthy', 'mealprep'] },
  gimmesomeoven:    { name: 'Gimme Some Oven',       feedUrl: 'https://www.gimmesomeoven.com/feed/',          emoji: '🫕', tags: ['comfort', 'weeknight'] },
  skinnytaste:      { name: 'Skinnytaste',           feedUrl: 'https://www.skinnytaste.com/feed/',            emoji: '⚖️', tags: ['healthy', 'weeknight'] },
  acouplecooks:     { name: 'A Couple Cooks',        feedUrl: 'https://www.acouplecooks.com/feed/',           emoji: '👫', tags: ['healthy', 'vegetarian'] },
  mediterraneandish:{ name: 'Mediterranean Dish',    feedUrl: 'https://www.themediterraneandish.com/feed/',   emoji: '🫒', tags: ['healthy', 'comfort'] },
  feastingathome:   { name: 'Feasting at Home',      feedUrl: 'https://www.feastingathome.com/feed/',         emoji: '🍽️', tags: ['seasonal', 'technique'] },
  // ── Expansion v2 (2026-08-06) ──────────────────────────────────────
  allrecipes:       { name: 'AllRecipes',            feedUrl: 'https://www.allrecipes.com/rss',               emoji: '🍽️', tags: ['weeknight', 'comfort'] },
  simplyrecipes:    { name: 'Simply Recipes',        feedUrl: 'https://www.simplyrecipes.com/feed',           emoji: '📖', tags: ['technique', 'weeknight'] },
  thekitchn:        { name: 'The Kitchn',            feedUrl: 'https://www.thekitchn.com/main.rss',           emoji: '🏠', tags: ['technique', 'healthy'] },
  eatingwell:       { name: 'EatingWell',            feedUrl: 'https://www.eatingwell.com/rss',               emoji: '🥬', tags: ['healthy', 'mealprep'] },
  epicurious:       { name: 'Epicurious',            feedUrl: 'https://www.epicurious.com/feed/recipes-rss-feed/rss', emoji: '🧑‍🍳', tags: ['technique', 'seasonal'] },
  bonappetit:       { name: 'Bon Appétit',           feedUrl: 'https://www.bonappetit.com/feed/recipes-rss-feed/rss', emoji: '🇫🇷', tags: ['technique', 'comfort'] },
  foodnetwork:      { name: 'Food Network',          feedUrl: 'https://www.foodnetwork.com/fn-dish/recipes.rss',      emoji: '📺', tags: ['comfort', 'weeknight'] },
  nytcooking:       { name: 'NYT Cooking',           feedUrl: 'https://rss.nytimes.com/services/xml/rss/nyt/Cooking.xml', emoji: '📰', tags: ['technique', 'seasonal'] },
};

// ─── Minimal RSS parser ──────────────────────────────────────────────────────
// RSS XML is extremely predictable — <item> blocks with <title>, <link>,
// <pubDate>, <category>, <description>, and images inside <content:encoded>.
// A regex-based extractor is simpler, faster, and dependency-free compared
// to pulling in a full XML parser for this constrained input.

function extractTag(xml, tag) {
  // Handle both <tag>text</tag> and <tag><![CDATA[text]]></tag>
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

function extractAllTags(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'gi');
  const results = [];
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
  return results;
}

function extractImage(itemXml, contentEncoded, description) {
  // 1. content:encoded <img src="..."> — highest quality, most blogs
  const imgRe = /src=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)/i;
  let m = contentEncoded.match(imgRe);
  if (m) return m[1].replace(/&amp;/g, '&');

  // 2. <media:content url="..."> — Skinnytaste, some WordPress themes
  const mediaRe = /<media:content[^>]+url=["']([^"']+)/i;
  m = itemXml.match(mediaRe);
  if (m) return m[1].replace(/&amp;/g, '&');

  // 3. <enclosure url="..."> — podcast-style feeds that attach images
  const encRe = /<enclosure[^>]+url=["']([^"']+(?:jpg|jpeg|png|webp)[^"']*)/i;
  m = itemXml.match(encRe);
  if (m) return m[1].replace(/&amp;/g, '&');

  // 4. description fallback
  m = description.match(imgRe);
  if (m) return m[1].replace(/&amp;/g, '&');

  return '';
}

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#8230;/g, '…')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// ─── Post-type detection ─────────────────────────────────────────────────────
// Classify each RSS post so the client can filter/badge appropriately.
// Returns: 'recipe' | 'roundup' | 'mealplan' | 'guide' | 'baking-tool'

const ROUNDUP_TITLE_RX   = /\d{2,}\s+(best|easy|quick|favorite|delicious|healthy|amazing)|roundup|recipe ideas|meal ideas|what to (?:cook|make)|top\s+\d+/i;
const MEALPLAN_TITLE_RX  = /meal\s*plan|weekly\s*menu|week of meals|\d+\s*day\s*(?:meal|menu|eating)/i;
const GUIDE_TITLE_RX     = /best .+(?:to buy|we tested|we tried|for \d{4})|how to (?:choose|pick|buy|select)|kitchen gadget|product review|equipment guide/i;
const BAKING_TOOL_RX     = /best .+(?:pan|mixer|sheet|spatula|thermometer|scale|bakeware|rolling pin)/i;

function detectPostType(title, contentEncoded, link) {
  if (MEALPLAN_TITLE_RX.test(title))  return 'mealplan';
  if (BAKING_TOOL_RX.test(title))     return 'baking-tool';
  if (GUIDE_TITLE_RX.test(title))     return 'guide';
  if (ROUNDUP_TITLE_RX.test(title))   return 'roundup';

  // Link density check: roundup posts embed many same-domain recipe links
  if (contentEncoded) {
    try {
      const domain = new URL(link).hostname.replace(/^www\./, '');
      const linkMatches = contentEncoded.match(/<a\s[^>]*href=["'][^"']*[^"']+["']/gi) || [];
      const sameDomainLinks = linkMatches.filter(l => l.includes(domain)).length;
      if (sameDomainLinks > 4) return 'roundup';
    } catch { /* ignore URL parse failures */ }
  }

  return 'recipe';
}

// ─── Hard-skip patterns (always removed regardless of filter mode) ───────────
const HARD_SKIP_RX = /giveaway|sweepstakes|gift\s*card|announcement|sponsored/i;

function parseRssFeed(xml, sourceKey, limit, filterMode) {
  const source = SOURCES[sourceKey];
  if (!source) return [];

  // Support both RSS (<item>) and Atom (<entry>) feeds
  let items = xml.split(/<item>/i).slice(1);
  const isAtom = items.length === 0;
  if (isAtom) {
    items = xml.split(/<entry>/i).slice(1);
  }

  const results = [];

  for (const itemXml of items.slice(0, limit)) {
    const title = stripHtml(extractTag(itemXml, 'title'));
    const pubDate = extractTag(itemXml, 'pubDate') || extractTag(itemXml, 'published') || extractTag(itemXml, 'updated');
    const description = extractTag(itemXml, 'description') || extractTag(itemXml, 'summary');
    const contentEncoded = extractTag(itemXml, 'content:encoded') || extractTag(itemXml, 'content');
    const categories = extractAllTags(itemXml, 'category').map(c => stripHtml(c));

    // Link extraction: RSS uses <link>url</link>, Atom uses <link href="url"/>
    let link = extractTag(itemXml, 'link');
    if (!link) {
      const hrefMatch = itemXml.match(/<link[^>]+href=["']([^"']+)["']/i);
      if (hrefMatch) link = hrefMatch[1].trim();
    }

    // Hard skip — always removed (spam, giveaways, sponsored)
    if (HARD_SKIP_RX.test(title) || HARD_SKIP_RX.test(categories.join(' '))) continue;
    if (!title || !link) continue;

    const imageUrl = extractImage(itemXml, contentEncoded, description);
    const snippet = stripHtml(description).slice(0, 300);
    const postType = detectPostType(title, contentEncoded, link);

    // In strict mode, only single-recipe posts pass through
    if (filterMode === 'strict' && postType !== 'recipe') continue;

    results.push({
      title,
      link,
      imageUrl,
      snippet,
      pubDate: pubDate || null,
      postType,
      categories: categories.filter(c =>
        // Drop ingredient-level categories (Budget Bytes includes them)
        c.length > 2 && !/^(Garlic|Salt|Pepper|Oil|Butter|Onion|Sugar)$/i.test(c)
      ).slice(0, 5),
      source: sourceKey,
      sourceName: source.name,
      sourceEmoji: source.emoji,
    });
  }

  return results;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

function jsonResponse(body, status, cacheSeconds = 0) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };
  if (cacheSeconds > 0) {
    headers['Cache-Control'] = `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`;
  } else {
    headers['Cache-Control'] = 'no-store';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export default async function handler(req) {
  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const { searchParams } = new URL(req.url);
  const requestedSources = searchParams.get('sources');
  const limit = Math.min(parseInt(searchParams.get('limit') || '15', 10), 50);
  const filterMode = searchParams.get('filter') === 'relaxed' ? 'relaxed' : 'strict';

  // Determine which sources to fetch
  let sourceKeys = Object.keys(SOURCES);
  if (requestedSources) {
    const requested = requestedSources.split(',').map(s => s.trim().toLowerCase());
    sourceKeys = sourceKeys.filter(k => requested.includes(k));
    if (sourceKeys.length === 0) {
      return jsonResponse({ error: 'No valid sources specified', available: Object.keys(SOURCES) }, 400);
    }
  }

  // Fetch all RSS feeds in parallel — allSettled so one failing feed
  // doesn't break the entire response
  const feedResults = await Promise.allSettled(
    sourceKeys.map(async (key) => {
      const source = SOURCES[key];
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FEED_TIMEOUT_MS);
      try {
        const resp = await fetch(source.feedUrl, {
          signal: ctrl.signal,
          headers: {
            'User-Agent': 'SpiceHub/1.0 (recipe-discovery; PWA)',
            'Accept': 'application/rss+xml, application/xml, text/xml',
          },
        });
        clearTimeout(timer);
        if (!resp.ok) throw new Error(`${resp.status}`);
        const xml = await resp.text();
        return { key, items: parseRssFeed(xml, key, limit, filterMode) };
      } catch (err) {
        clearTimeout(timer);
        console.log(`[discover] Feed ${key} failed: ${err.message}`);
        return { key, items: [], error: err.message };
      }
    })
  );

  // Merge all results, interleave sources for variety
  const bySource = {};
  const errors = [];
  for (const result of feedResults) {
    const val = result.status === 'fulfilled' ? result.value : { key: 'unknown', items: [], error: result.reason?.message };
    if (val.error) errors.push({ source: val.key, error: val.error });
    if (val.items.length > 0) bySource[val.key] = val.items;
  }

  // Round-robin interleave: take one from each source in turn so the
  // feed isn't dominated by whichever blog posted most recently
  const merged = [];
  const iterators = Object.values(bySource).map(items => ({ items, idx: 0 }));
  let active = true;
  while (active) {
    active = false;
    for (const it of iterators) {
      if (it.idx < it.items.length) {
        merged.push(it.items[it.idx++]);
        active = true;
      }
    }
  }

  return jsonResponse({
    posts: merged,
    sources: Object.fromEntries(
      Object.entries(SOURCES)
        .filter(([k]) => sourceKeys.includes(k))
        .map(([k, v]) => [k, { name: v.name, emoji: v.emoji, tags: v.tags }])
    ),
    errors: errors.length > 0 ? errors : undefined,
    fetchedAt: new Date().toISOString(),
  }, 200, 1800); // 30-min cache
}
