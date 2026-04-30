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
const INSTAGRAM_HOST = /instagram\.com/i;

/**
 * Build realistic browser-like headers for a given URL.
 * This is critical — Allrecipes, NYTimes, etc. reject requests with bot-like headers.
 */
function buildHeaders(targetUrl) {
  const isInsta = INSTAGRAM_HOST.test(targetUrl);

  const base = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
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
    // Instagram needs these to not show login wall
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
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get('url');

  // Validate URL
  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
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

  // Block SSRF — prevent fetching internal/private addresses
  const hostname = parsedUrl.hostname;
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
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

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'X-Proxy-Status': String(response.status),
        'X-Proxy-Url': targetUrl,
        // Cache successful fetches for 5 minutes on the edge to reduce origin hammering
        'Cache-Control': 'public, max-age=300, s-maxage=300',
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
