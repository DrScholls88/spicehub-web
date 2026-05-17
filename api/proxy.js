/**
 * Vercel Serverless Function — /api/proxy
 *
 * Acts as a server-side HTML fetcher so the client avoids CORS + IP-block issues.
 * Deployed on Vercel's edge, this function has a fresh non-datacenter IP per region
 * and can bypass the blocks that stop public CORS proxy services.
 *
 * Usage: GET /api/proxy?url=https://www.allrecipes.com/recipe/...
 */

export const config = {
  runtime: 'edge', // Use Edge Runtime — fast, cheap, no cold starts
};

// Sites known to require special handling
const INSTAGRAM_HOST = /instagram\.com|cdninstagram\.com|fbcdn\.net|scontent/i;

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
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

/**
 * Build realistic browser-like headers for a given URL.
 * This is critical — Allrecipes, NYTimes, etc. reject requests with bot-like headers.
 */
function buildHeaders(targetUrl) {
  const isInsta = INSTAGRAM_HOST.test(targetUrl);
  // Rotate UA every ~15 minutes to break bot-wall fingerprinting
  const ua = USER_AGENTS[Math.floor(Date.now() / 900000) % USER_AGENTS.length];

  const base = {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'DNT': '1',
  };

  if (isInsta) {
    base['Referer'] = 'https://www.instagram.com/';
    base['sec-ch-ua'] = '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
    base['sec-ch-ua-mobile'] = '?0';
    base['sec-ch-ua-platform'] = '"Windows"';
  }

  return base;
}

export default async function handler(req) {
  // Only allow GET
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const { searchParams } = new URL(req.url);

  // -- Mode routing: special server-side API calls --------------------------
  const mode = searchParams.get('mode');

  if (mode === 'instagram-oembed') {
    const igUrl = cleanUrl(searchParams.get('url') || '');
    if (!igUrl || (!igUrl.startsWith('https://www.instagram.com/') && !igUrl.startsWith('https://instagram.com/'))) {
      return new Response(JSON.stringify({ error: 'Invalid Instagram URL' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    const token = process.env.FB_APP_TOKEN || null;
    if (!token) {
      return new Response(JSON.stringify({ error: 'oEmbed not configured' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    try {
      const oEmbedUrl = `https://graph.facebook.com/v18.0/instagram_oembed?url=${encodeURIComponent(igUrl)}&fields=html,thumbnail_url,author_name&access_token=${token}`;
      const resp = await fetch(oEmbedUrl);
      const json = await resp.text();
      return new Response(json, {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'oEmbed fetch failed' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  if (mode === 'image-data-url') {
    const imageUrl = cleanUrl(searchParams.get('url') || '');
    let parsed;
    try {
      parsed = new URL(imageUrl);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid image URL' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return new Response(JSON.stringify({ error: 'Only http/https URLs are allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    try {
      const isInstaCdn = /instagram|fbcdn|cdninstagram|scontent/i.test(parsed.href);
      // Use image-appropriate Sec-Fetch headers — Instagram CDN rejects document/navigate
      const imageHeaders = {
        ...buildHeaders(parsed.href),
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        // Override the document-fetch Sec-Fetch-* that buildHeaders adds
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': isInstaCdn ? 'cross-site' : 'same-site',
        // Instagram CDN requires these to not block the request
        ...(isInstaCdn && {
          'Referer': 'https://www.instagram.com/',
          'Origin': 'https://www.instagram.com',
        }),
      };
      // Remove headers that browsers wouldn't send for img src requests
      delete imageHeaders['Upgrade-Insecure-Requests'];
      delete imageHeaders['Sec-Fetch-User'];

      const resp = await fetch(parsed.href, { headers: imageHeaders });
      if (!resp.ok) {
        return new Response(JSON.stringify({ error: 'Image fetch failed', status: resp.status }), {
          status: resp.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      let contentType = resp.headers.get('content-type') || 'image/jpeg';
      const bytes = await resp.arrayBuffer();
      // Raise size cap to 5MB — Instagram carousel images can be large
      if (bytes.byteLength < 100 || bytes.byteLength > 5 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: 'Image size rejected', bytes: bytes.byteLength }), {
          status: 422,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      // Magic-byte sniffing — some CDNs strip or mangle Content-Type
      if (!contentType.startsWith('image/')) {
        const head = new Uint8Array(bytes.slice(0, 4));
        const isJpeg = head[0] === 0xFF && head[1] === 0xD8;
        const isPng  = head[0] === 0x89 && head[1] === 0x50;
        const isWebp = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46;
        if (isJpeg) contentType = 'image/jpeg';
        else if (isPng) contentType = 'image/png';
        else if (isWebp) contentType = 'image/webp';
        else {
          return new Response(JSON.stringify({ error: 'Not a recognized image format', head: Array.from(head) }), {
            status: 422,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }
      }
      // Use Buffer.from for reliable base64 encoding in Node/Edge environments
      // (Array.from + btoa can silently fail on large binary buffers)
      const base64 = Buffer.from(bytes).toString('base64');
      const dataUrl = `data:${contentType.split(';')[0]};base64,${base64}`;
      return new Response(JSON.stringify({ dataUrl }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          // Cache aggressively — once we have the data URL, it's self-contained
          'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  if (mode === 'instagram-json') {
    const shortcode = searchParams.get('shortcode');
    if (!shortcode || !/^[A-Za-z0-9_-]+$/.test(shortcode)) {
      return new Response(JSON.stringify({ error: 'Invalid shortcode' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    try {
      const jsonUrl = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;
      const resp = await fetch(jsonUrl, { headers: buildHeaders(jsonUrl) });
      const text = await resp.text();
      return new Response(text, {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  if (mode === 'instagram-apify') {
    const igUrl = cleanUrl(searchParams.get('url') || '');
    if (!igUrl) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    const apifyToken = process.env.APIFY_TOKEN || null;
    if (!apifyToken) {
      return new Response(JSON.stringify({ error: 'Apify not configured' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    try {
      // Use Apify's synchronous run endpoint — starts the actor and waits for results
      const actorId = 'apify~instagram-post-scraper';
      const apiUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apifyToken}&timeout=25`;
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: [igUrl],
          resultsLimit: 1,
          dataDetailLevel: 'basicData',
        }),
      });
      if (!resp.ok) {
        return new Response(JSON.stringify({ error: `Apify returned ${resp.status}` }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      const items = await resp.json();
      if (!Array.isArray(items) || items.length === 0) {
        return new Response(JSON.stringify({ error: 'No data returned from Apify' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      const post = items[0];
      // Return a normalized subset — keep payload small
      const result = {
        ok: true,
        caption: post.caption || '',
        displayUrl: post.displayUrl || '',
        videoUrl: post.videoUrl || '',
        ownerUsername: post.ownerUsername || '',
        ownerFullName: post.ownerFullName || '',
        shortCode: post.shortCode || '',
        hashtags: post.hashtags || [],
        timestamp: post.timestamp || '',
        type: post.type || 'Unknown',
      };
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message || 'Apify request failed' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  if (mode === 'tiktok-oembed') {
    const ttUrl = searchParams.get('url');
    if (!ttUrl) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    if (!ttUrl.startsWith('https://www.tiktok.com/')) {
      return new Response(JSON.stringify({ error: 'Invalid TikTok URL' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    try {
      const oEmbedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(ttUrl)}`;
      const resp = await fetch(oEmbedUrl, {
        headers: { 'User-Agent': USER_AGENTS[Math.floor(Date.now() / 900000) % USER_AGENTS.length], 'Accept': 'application/json' },
      });
      const json = await resp.text();
      return new Response(json, {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  }
  // -- End mode routing -----------------------------------------------------

  const targetUrl = cleanUrl(searchParams.get('url') || '');

  // Validate URL
  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Security: Only allow http/https
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return new Response(JSON.stringify({ error: 'Only http/https URLs are allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Block SSRF
  const hostname = parsedUrl.hostname;
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('172.16.') || hostname.startsWith('172.17.') ||
    hostname.startsWith('172.18.') || hostname.startsWith('172.19.') ||
    hostname.startsWith('172.2') || hostname.startsWith('172.30.') ||
    hostname.startsWith('172.31.') ||
    hostname.startsWith('169.254.') ||
    hostname.endsWith('.local')
  ) {
    return new Response(JSON.stringify({ error: 'Private addresses not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: buildHeaders(targetUrl),
      redirect: 'follow',
    });

    const contentType = response.headers.get('content-type') || 'text/html';
    const html = await response.text();

    // Pass through the target's actual HTTP status so the client can distinguish
    // a successful fetch (2xx) from a bot-wall/auth block (403, 429, etc.).
    // CORS headers are always included so the browser can read non-2xx bodies.
    const targetStatus = response.status;
    return new Response(html, {
      status: targetStatus,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'X-Proxy-Status': String(targetStatus),
        'X-Proxy-Url': targetUrl,
        'Cache-Control': targetStatus === 200
          ? 'public, max-age=300, s-maxage=300'
          : 'no-store',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Fetch failed', message: err.message }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}
