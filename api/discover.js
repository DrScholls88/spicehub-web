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
  seriouseats:    { name: 'Serious Eats',       feedUrl: 'https://www.seriouseats.com/rss', emoji: '🔬', tags: ['technique', 'comfort'] },
  budgetbytes:    { name: 'Budget Bytes',        feedUrl: 'https://www.budgetbytes.com/feed/', emoji: '💰', tags: ['budget', 'weeknight'] },
  recipetineats:  { name: 'RecipeTin Eats',      feedUrl: 'https://www.recipetineats.com/feed/', emoji: '🍳', tags: ['weeknight', 'comfort'] },
  minimalistbaker:{ name: 'Minimalist Baker',    feedUrl: 'https://minimalistbaker.com/feed/', emoji: '🌱', tags: ['vegan', 'simple'] },
  smittenkitchen: { name: 'Smitten Kitchen',     feedUrl: 'https://smittenkitchen.com/feed/', emoji: '🏙️', tags: ['comfort', 'baking'] },
  pinchofyum:     { name: 'Pinch of Yum',        feedUrl: 'https://pinchofyum.com/feed', emoji: '🤌', tags: ['weeknight', 'comfort'] },
  halfbakedharvest:{ name: 'Half Baked Harvest', feedUrl: 'https://www.halfbakedharvest.com/feed/', emoji: '🌾', tags: ['seasonal', 'comfort'] },
  cookieandkate:  { name: 'Cookie and Kate',     feedUrl: 'https://cookieandkate.com/feed/', emoji: '🥗', tags: ['vegetarian', 'healthy'] },
  sallysbaking:   { name: "Sally's Baking",      feedUrl: 'https://sallysbakingaddiction.com/feed/', emoji: '🧁', tags: ['baking', 'dessert'] },
  damndelicious:  { name: 'Damn Delicious',      feedUrl: 'https://damndelicious.net/feed/', emoji: '🔥', tags: ['weeknight', 'simple'] },
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

function extractImage(contentEncoded, description) {
  // Try content:encoded first (higher quality images)
  const imgRe = /src=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)/i;
  let m = contentEncoded.match(imgRe);
  if (m) return m[1].replace(/&amp;/g, '&');
  // Fallback to description
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

function parseRssFeed(xml, sourceKey, limit) {
  const source = SOURCES[sourceKey];
  if (!source) return [];

  // Split on <item> boundaries
  const items = xml.split(/<item>/i).slice(1); // first chunk is channel header
  const results = [];

  for (const itemXml of items.slice(0, limit)) {
    const title = stripHtml(extractTag(itemXml, 'title'));
    const link = extractTag(itemXml, 'link');
    const pubDate = extractTag(itemXml, 'pubDate');
    const description = extractTag(itemXml, 'description');
    const contentEncoded = extractTag(itemXml, 'content:encoded');
    const categories = extractAllTags(itemXml, 'category').map(c => stripHtml(c));

    // Skip non-recipe posts (giveaways, roundups, announcements)
    const skipPatterns = /giveaway|sweepstakes|gift\s*card|roundup|announcement|sponsored/i;
    if (skipPatterns.test(title) || skipPatterns.test(categories.join(' '))) continue;

    const imageUrl = extractImage(contentEncoded, description);
    const snippet = stripHtml(description).slice(0, 200);

    if (!title || !link) continue;

    results.push({
      title,
      link,
      imageUrl,
      snippet,
      pubDate: pubDate || null,
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
        return { key, items: parseRssFeed(xml, key, limit) };
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
