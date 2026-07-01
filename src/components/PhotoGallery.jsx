// src/components/PhotoGallery.jsx
//
// Reusable lightbox component wrapping PhotoSwipe v4.
// Supports single-image zoom and multi-image gallery with swipe/pinch.
//
// Usage:
//   <PhotoGallery
//     images={[{ src, w, h, title }]}     // array of items (at least 1)
//     index={0}                           // starting index (default 0)
//     open={true}                         // controlled open state
//     onClose={() => setOpen(false)}      // called when lightbox closes
//   />
//
// For a single image you can also use the static helper:
//   PhotoGallery.openSingle(src, title?)

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// Import PhotoSwipe CSS (Vite resolves these relative to the file)
import '../lib/photoswipe/photoswipe.css';
import '../lib/photoswipe/default-skin.css';

// ── Lazy-load PhotoSwipe JS (avoids blocking main bundle) ────────────────────

let _psPromise = null;

function loadPhotoSwipe() {
  if (_psPromise) return _psPromise;
  _psPromise = Promise.all([
    import('../lib/photoswipe/photoswipe.min.js'),
    import('../lib/photoswipe/photoswipe-ui-default.min.js'),
  ]).then(([psModule, uiModule]) => ({
    PhotoSwipe: psModule.default || psModule,
    PhotoSwipeUI: uiModule.default || uiModule,
  }));
  return _psPromise;
}

// ── Natural image size resolver ──────────────────────────────────────────────

function resolveImageSize(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 1200, h: 900 }); // fallback
    img.src = src;
  });
}

// ── PhotoSwipe DOM scaffold (required by v4) ─────────────────────────────────

function PswpScaffold({ innerRef }) {
  return (
    <div className="pswp" tabIndex="-1" role="dialog" aria-hidden="true" ref={innerRef}>
      <div className="pswp__bg" />
      <div className="pswp__scroll-wrap">
        <div className="pswp__container">
          <div className="pswp__item" />
          <div className="pswp__item" />
          <div className="pswp__item" />
        </div>
        <div className="pswp__ui pswp__ui--hidden">
          <div className="pswp__top-bar">
            <div className="pswp__counter" />
            <button className="pswp__button pswp__button--close" title="Close (Esc)" />
            <button className="pswp__button pswp__button--share" title="Share" />
            <button className="pswp__button pswp__button--fs" title="Toggle fullscreen" />
            <button className="pswp__button pswp__button--zoom" title="Zoom in/out" />
            <div className="pswp__preloader">
              <div className="pswp__preloader__icn">
                <div className="pswp__preloader__cut">
                  <div className="pswp__preloader__donut" />
                </div>
              </div>
            </div>
          </div>
          <div className="pswp__share-modal pswp__share-modal--hidden pswp__single-tap">
            <div className="pswp__share-tooltip" />
          </div>
          <button className="pswp__button pswp__button--arrow--left" title="Previous" />
          <button className="pswp__button pswp__button--arrow--right" title="Next" />
          <div className="pswp__caption">
            <div className="pswp__caption__center" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function PhotoGallery({ images = [], index = 0, open = false, onClose }) {
  const pswpRef = useRef(null);
  const instanceRef = useRef(null);

  // Destroy on unmount
  useEffect(() => {
    return () => {
      if (instanceRef.current) {
        try { instanceRef.current.close(); } catch (_) {}
        instanceRef.current = null;
      }
    };
  }, []);

  // Open/close effect
  useEffect(() => {
    if (!open || images.length === 0) return;

    let cancelled = false;

    (async () => {
      // Resolve sizes for any items missing w/h
      const resolvedItems = await Promise.all(
        images.map(async (item) => {
          if (item.w && item.h) return item;
          const size = await resolveImageSize(item.src);
          return { ...item, ...size };
        })
      );

      if (cancelled) return;

      const { PhotoSwipe, PhotoSwipeUI } = await loadPhotoSwipe();
      if (cancelled || !pswpRef.current) return;

      const options = {
        index: Math.min(index, resolvedItems.length - 1),
        bgOpacity: 0.92,
        showHideOpacity: true,
        showAnimationDuration: 280,
        hideAnimationDuration: 220,
        shareEl: false,       // we have our own share via ExportSheet
        fullscreenEl: true,
        zoomEl: true,
        counterEl: resolvedItems.length > 1,
        history: false,       // don't mess with PWA routing
        closeOnScroll: false, // PWA: don't close on scroll
        pinchToClose: true,
        closeOnVerticalDrag: true,
        // Better mobile experience
        getDoubleTapZoom: (_isMouseClick, item) => {
          return item.initialZoomLevel < 0.7 ? 1 : 1.5;
        },
        maxSpreadZoom: 2,
        // Caption from title
        addCaptionHTMLFn: (item, captionEl) => {
          // item.title comes from recipe/meal names, which originate from the
          // import pipeline (arbitrary web/Instagram/video sources) — use
          // textContent, not innerHTML, so it's always rendered as plain text.
          if (!item.title) {
            captionEl.children[0].textContent = '';
            return false;
          }
          captionEl.children[0].textContent = item.title;
          return true;
        },
      };

      const gallery = new PhotoSwipe(pswpRef.current, PhotoSwipeUI, resolvedItems, options);

      gallery.listen('close', () => {
        instanceRef.current = null;
        onClose?.();
      });

      gallery.init();
      instanceRef.current = gallery;
    })();

    return () => {
      cancelled = true;
      if (instanceRef.current) {
        try { instanceRef.current.close(); } catch (_) {}
        instanceRef.current = null;
      }
    };
  }, [open, images, index, onClose]);

  // Always render the scaffold in a portal so it's at document root
  return createPortal(<PswpScaffold innerRef={pswpRef} />, document.body);
}

// ── Static helper for single-image lightbox ──────────────────────────────────

PhotoGallery.openSingle = async function openSingle(src, title) {
  if (!src) return;
  const { PhotoSwipe, PhotoSwipeUI } = await loadPhotoSwipe();
  const size = await resolveImageSize(src);

  // Create a temporary scaffold
  const container = document.createElement('div');
  document.body.appendChild(container);
  container.innerHTML = `
    <div class="pswp" tabindex="-1" role="dialog" aria-hidden="true">
      <div class="pswp__bg"></div>
      <div class="pswp__scroll-wrap">
        <div class="pswp__container">
          <div class="pswp__item"></div>
          <div class="pswp__item"></div>
          <div class="pswp__item"></div>
        </div>
        <div class="pswp__ui pswp__ui--hidden">
          <div class="pswp__top-bar">
            <div class="pswp__counter"></div>
            <button class="pswp__button pswp__button--close" title="Close (Esc)"></button>
            <button class="pswp__button pswp__button--fs" title="Toggle fullscreen"></button>
            <button class="pswp__button pswp__button--zoom" title="Zoom in/out"></button>
            <div class="pswp__preloader">
              <div class="pswp__preloader__icn">
                <div class="pswp__preloader__cut">
                  <div class="pswp__preloader__donut"></div>
                </div>
              </div>
            </div>
          </div>
          <button class="pswp__button pswp__button--arrow--left" title="Previous"></button>
          <button class="pswp__button pswp__button--arrow--right" title="Next"></button>
          <div class="pswp__caption">
            <div class="pswp__caption__center"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  const el = container.querySelector('.pswp');
  const items = [{ src, w: size.w, h: size.h, title: title || '' }];

  const gallery = new PhotoSwipe(el, PhotoSwipeUI, items, {
    index: 0,
    bgOpacity: 0.92,
    showHideOpacity: true,
    showAnimationDuration: 280,
    hideAnimationDuration: 220,
    shareEl: false,
    counterEl: false,
    fullscreenEl: true,
    zoomEl: true,
    history: false,
    closeOnScroll: false,
    pinchToClose: true,
    closeOnVerticalDrag: true,
    getDoubleTapZoom: (_isMouseClick, item) => {
      return item.initialZoomLevel < 0.7 ? 1 : 1.5;
    },
    maxSpreadZoom: 2,
    addCaptionHTMLFn: (item, captionEl) => {
      // Same reasoning as the main gallery above — plain text, not HTML.
      if (!item.title) {
        captionEl.children[0].textContent = '';
        return false;
      }
      captionEl.children[0].textContent = item.title;
      return true;
    },
  });

  gallery.listen('destroy', () => {
    setTimeout(() => {
      try { document.body.removeChild(container); } catch (_) {}
    }, 50);
  });

  gallery.init();
  return gallery;
};
