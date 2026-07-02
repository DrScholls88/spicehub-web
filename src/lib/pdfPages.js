/**
 * pdfPages.js — client-side PDF → page images for the photo import pipeline.
 *
 * Zero-cost approach: pdf.js is loaded on demand from a pinned CDN build the
 * first time a PDF is dropped, so the app bundle carries no PDF weight and no
 * new npm dependency (avoids native/module churn in the PWA build). Once the
 * service worker has cached the module it also works offline.
 */

const PDFJS_VERSION = '4.10.38';
const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

let _pdfjsPromise = null;

/** True when a File/Blob looks like a PDF (mime or .pdf extension). */
export function isPdfFile(file) {
  if (!file) return false;
  if (file.type === 'application/pdf') return true;
  return /\.pdf$/i.test(file.name || '');
}

async function loadPdfJs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = import(/* @vite-ignore */ PDFJS_URL)
      .then((mod) => {
        const pdfjs = mod.default || mod;
        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        return pdfjs;
      })
      .catch((err) => {
        _pdfjsPromise = null; // allow retry on next attempt
        throw new Error(
          navigator.onLine === false
            ? 'PDF support needs a connection the first time it loads.'
            : `Couldn't load the PDF reader (${err.message || 'network error'}).`,
        );
      });
  }
  return _pdfjsPromise;
}

/**
 * pdfToPageDataUrls — render up to `maxPages` pages of a PDF file to JPEG
 * data URLs sized for the vision pipeline.
 *
 * @param {File|Blob} file
 * @param {object} opts
 * @param {number} [opts.maxPages=10]
 * @param {number} [opts.targetWidth=1600] render width in px
 * @param {(pageNum: number, total: number) => void} [opts.onProgress]
 * @returns {Promise<{pages: string[], totalPages: number, truncated: boolean}>}
 */
export async function pdfToPageDataUrls(file, { maxPages = 10, targetWidth = 1600, onProgress } = {}) {
  const pdfjs = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;

  const total = doc.numPages;
  const count = Math.min(total, maxPages);
  const pages = [];

  for (let i = 1; i <= count; i++) {
    onProgress?.(i, count);
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, targetWidth / base.width);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    // White backing — PDFs with transparency otherwise render on black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push(canvas.toDataURL('image/jpeg', 0.85));
    page.cleanup();
  }

  try { doc.destroy(); } catch { /* already gone */ }
  return { pages, totalPages: total, truncated: total > count };
}
