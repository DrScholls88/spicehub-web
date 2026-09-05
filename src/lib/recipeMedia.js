/**
 * recipeMedia.js — the media model behind the recipe hero carousel.
 *
 * Pure, synchronous, DOM-free: safe to call during render and inside a test.
 * Lives apart from RecipeMediaCarousel.jsx so that component file exports a
 * component and nothing else (React Fast Refresh requirement), and so these
 * two functions — the parts with real branching logic — can be unit-tested
 * without mounting anything.
 *
 * ── Where a recipe's photos come from ───────────────────────────────────────
 *   item.imageUrl            the cover photo; what every tile and list shows
 *   item.userPhotos[]        photos the user added by hand, oldest first
 *   item._scanPages[]        pages captured by the document/photo scanner
 *   item._carouselImages[]   { url, dataUrl } pairs from the import pipeline
 *   item._igCarouselImages[] raw Instagram carousel URLs
 *   item.hiddenPhotos[]      suppression list (see below)
 *
 * ── Why deletion uses a suppression list ────────────────────────────────────
 * The four import arrays are the extraction record: db.js's mergeRecipeData
 * unions them across re-imports so a recipe never loses a photo the pipeline
 * managed to gather. Splicing a frame out of one of them would therefore be
 * undone by the next re-import of the same URL. Recording the removal in
 * `hiddenPhotos` instead survives that merge (mergeRecipeData unions this
 * array too) and destroys nothing. User-added photos are not part of that
 * record, so those are removed outright.
 */

/**
 * buildMediaModel(item, videoSource) → { photos, slides, videoIndex }
 *
 * @param {object|null} item         a meal or drink record
 * @param {object|null} videoSource  result of getMealVideoSource(item), or null
 * @returns {{
 *   photos: Array<{ src: string, origin: string, title: string }>,
 *   slides: Array<object>,
 *   videoIndex: number
 * }}
 *   photos     deduped, suppression-list applied, cover first
 *   slides     [{ type:'video' }?, ...{ type:'photo', photoIndex, src, origin }]
 *   videoIndex 0 when a video slide exists, otherwise -1
 */
export function buildMediaModel(item, videoSource) {
  const photos = [];
  const seen = new Set();
  const hidden = new Set(
    (Array.isArray(item?.hiddenPhotos) ? item.hiddenPhotos : []).filter(
      (s) => typeof s === 'string' && s,
    ),
  );
  const title = item?.name || '';

  const push = (src, origin) => {
    if (!src || typeof src !== 'string') return;
    if (seen.has(src) || hidden.has(src)) return;
    seen.add(src);
    photos.push({ src, origin, title });
  };

  // Cover first — it is what the library tile the user just tapped was
  // showing, so leading with it keeps the shared-element morph continuous.
  push(item?.imageUrl, 'primary');

  // The user's own additions next: they added them deliberately and should
  // not be buried behind a dozen scraped carousel frames.
  if (Array.isArray(item?.userPhotos)) {
    for (const src of item.userPhotos) push(src, 'user');
  }

  if (Array.isArray(item?._scanPages)) {
    for (const src of item._scanPages) push(src, 'scan');
  }

  // _carouselImages entries carry both a remote url and a cached dataUrl.
  // Prefer the cached copy (it works offline), but remember the raw url so
  // the _igCarouselImages pass below doesn't add the same shot again.
  const carouselRawUrls = new Set();
  if (Array.isArray(item?._carouselImages)) {
    for (const c of item._carouselImages) {
      if (c?.url) carouselRawUrls.add(c.url);
      push(c?.dataUrl || c?.url, 'carousel');
    }
  }

  if (Array.isArray(item?._igCarouselImages)) {
    for (const src of item._igCarouselImages) {
      if (carouselRawUrls.has(src)) continue;
      push(src, 'ig');
    }
  }

  const slides = [];
  let videoIndex = -1;
  if (videoSource) {
    videoIndex = 0;
    slides.push({ type: 'video', key: `video:${videoSource.id}` });
  }
  photos.forEach((p, photoIndex) => {
    slides.push({
      type: 'photo',
      photoIndex,
      key: `photo:${photoIndex}:${p.src.slice(0, 96)}`,
      ...p,
    });
  });

  return { photos, slides, videoIndex };
}

/**
 * mediaPatchForDelete(item, photo, photos) → patch | null
 *
 * The patch to hand a persistence layer when the user removes `photo`.
 * `photos` is the current model's photo list (used to pick a replacement
 * cover). Returns null when there is nothing sensible to do.
 */
export function mediaPatchForDelete(item, photo, photos = []) {
  if (!item || !photo?.src) return null;
  const patch = {};

  if (photo.origin === 'user') {
    patch.userPhotos = (Array.isArray(item.userPhotos) ? item.userPhotos : []).filter(
      (s) => s !== photo.src,
    );
  } else {
    const hidden = Array.isArray(item.hiddenPhotos) ? item.hiddenPhotos : [];
    patch.hiddenPhotos = hidden.includes(photo.src) ? hidden : [...hidden, photo.src];
  }

  // Removing the cover promotes the next surviving photo, so a recipe with
  // photos left never falls back to the empty-plate tile placeholder.
  if (item.imageUrl && item.imageUrl === photo.src) {
    const survivor = photos.find((p) => p.src !== photo.src);
    patch.imageUrl = survivor ? survivor.src : '';
    // A promoted user photo would otherwise appear twice — once as the cover,
    // once as its own userPhotos entry. Drop the duplicate.
    if (survivor && survivor.origin === 'user') {
      const base = patch.userPhotos || (Array.isArray(item.userPhotos) ? item.userPhotos : []);
      patch.userPhotos = base.filter((s) => s !== survivor.src);
    }
  }

  return patch;
}

/**
 * mediaPatchForUpload(item, addedSrcs, photos) → patch | null
 *
 * The patch for appending freshly-compressed photos. Skips anything already
 * present, un-hides anything the user is deliberately re-adding, and adopts
 * the first new photo as the cover when the recipe has none.
 */
export function mediaPatchForUpload(item, addedSrcs = [], photos = []) {
  if (!item) return null;
  const known = new Set(photos.map((p) => p.src));
  const fresh = addedSrcs.filter((src) => typeof src === 'string' && src && !known.has(src));
  if (!fresh.length) return null;

  const existingUser = Array.isArray(item.userPhotos) ? item.userPhotos : [];
  const patch = { userPhotos: [...existingUser, ...fresh] };

  if (Array.isArray(item.hiddenPhotos) && item.hiddenPhotos.length) {
    const readded = new Set(fresh);
    patch.hiddenPhotos = item.hiddenPhotos.filter((s) => !readded.has(s));
  }

  if (!item.imageUrl) {
    patch.imageUrl = fresh[0];
    patch.userPhotos = patch.userPhotos.filter((s) => s !== fresh[0]);
  }

  return { patch, fresh };
}
