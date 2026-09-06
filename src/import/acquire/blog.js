// ─────────────────────────────────────────────────────────────────────────────
// ACQUIRE: BLOG — website pack + raw HTML for DomAimSheet.
//
// Wraps acquireWebsitePack and attaches the raw page HTML (capped at 2 MB via
// capHtml) so a later DomAimSheet has something to render. The reddit fork
// nests into this for link-posts.
//
// No imports from recipeParser — keeps the module graph acyclic.
// ─────────────────────────────────────────────────────────────────────────────
import { acquireWebsitePack } from './website.js';
import { addProvenance } from '../contextPack.js';
import { capHtml } from '../../lib/importGuards.js';
import { fetchHtmlViaProxy } from '../../api.js';

/**
 * Acquire a ContextPack from a blog/website URL.
 *
 * @param {string} url
 * @param {{ signal?: AbortSignal, onProgress?: Function }} opts
 * @returns {Promise<object|null>} ContextPack with .html attached, or null
 */
export async function acquireBlogPack(url, { signal, onProgress = () => {} } = {}) {
  onProgress('Extracting from website…');
  const pack = await acquireWebsitePack(url, { signal });
  if (!pack) return null;

  // Attach raw HTML for future DomAimSheet rendering (capped at 2 MB).
  // Non-fatal — the pack is still useful without it.
  try {
    const rawHtml = await fetchHtmlViaProxy(url, 12_000, signal);
    if (rawHtml && typeof rawHtml === 'string' && rawHtml.length > 200) {
      pack.html = capHtml(rawHtml);
      addProvenance(pack, 'html', 'blog-fetch');
    }
  } catch {
    // Network failure is expected offline — degrade gracefully.
  }

  return pack;
}
