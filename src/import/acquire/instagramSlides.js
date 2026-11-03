// ─────────────────────────────────────────────────────────────────────────────
// ACQUIRE: INSTAGRAM SLIDES — read recipe text printed on carousel images.
//
// Many recipe carousels put the ingredient list on the slides and leave a
// two-line caption, so the caption alone reaches Gemini with nothing to
// structure. When the caption has fewer than two quantity lines and the post
// has 2+ images, the slides go through the photo engine's ONLINE vision tiers
// (Gemini → Mistral, via /api/vision) and the text lands on pack.slideText,
// which buildPackSections sends as its own labelled section.
//
// Online tiers only, on purpose: running Tesseract over six slides in the
// middle of a URL import would stall it, and URL imports already need a
// connection. Any failure returns false and the import carries on as before.
// ─────────────────────────────────────────────────────────────────────────────
import { downloadImageAsDataUrl } from '../../api.js';
import { transcribePagesOnline, joinPageTranscripts } from '../../lib/photoImportEngine.js';
import { addProvenance } from '../contextPack.js';
import { countQuantityLines } from '../junk.js';
import { cleanSocialCaption } from '../clean/socialCaption.js';

const MAX_SLIDES = 6;       // cost + /api/vision body-size cap
const MIN_SLIDE_CHARS = 40; // less than this is a title card, not a recipe

/** Carousel images, de-duplicated by path (hero is often slide 1 with other query params). */
function slideImages(pack) {
  const seen = new Set();
  return (pack?.images || [])
    .filter((img) => {
      const key = String(img?.url || '').split('?')[0];
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SLIDES);
}

/** True when a carousel's caption is too thin to hold the recipe itself. */
export function shouldReadSlides(pack) {
  if (!pack || pack.slideText) return false;
  if (slideImages(pack).length < 2) return false;
  return countQuantityLines(cleanSocialCaption(pack.caption || '')) < 2;
}

/**
 * Read the slides into pack.slideText. Mutates the pack; returns true when
 * slide text was added.
 *
 * @param {object} pack — Instagram ContextPack
 * @param {{ signal?: AbortSignal, onProgress?: (msg: string) => void }} opts
 * @returns {Promise<boolean>}
 */
export async function readCarouselSlides(pack, { signal, onProgress = () => {} } = {}) {
  if (!shouldReadSlides(pack)) return false;
  try {
    onProgress('Reading the carousel slides…');
    const pages = (await Promise.all(
      slideImages(pack).map((img) => img.dataUrl || downloadImageAsDataUrl(img.url)),
    )).filter(Boolean);
    if (pages.length === 0 || signal?.aborted) return false;

    const contract = await transcribePagesOnline(pages, { signal });
    if (contract?.contentType === 'dish-photo') return false;
    const text = joinPageTranscripts(contract?.pages);
    if (text.length < MIN_SLIDE_CHARS) return false;

    pack.slideText = text;
    addProvenance(pack, 'slideText', 'vision:' + (contract.engine || 'unknown'));
    return true;
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return false;
  }
}
