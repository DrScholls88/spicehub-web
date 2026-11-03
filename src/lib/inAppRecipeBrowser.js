// ─────────────────────────────────────────────────────────────────────────────
// In-app recipe browser (native app only).
//
// Some sites refuse recipe apps' server fetches (People Inc's 402 licensing
// wall on allrecipes / Serious Eats, Cloudflare bot checks). In the Capacitor
// app the person can open the page in a real in-app browser, read it as any
// visitor would, and tap the import button in the toolbar: SpiceHub then reads
// the recipe from the page they are already viewing. That is their own visit,
// not a server scrape. The PWA cannot do this (CSP frame-src, cross-origin
// DOM), which is why BrowserAssist was retired on 2026-07-14.
//
// Plugin: @capgo/inappbrowser (same vendor as @capgo/capacitor-share-target),
// reached through registerPlugin so the web bundle carries none of its code.
// The native half arrives with `npm install @capgo/inappbrowser` +
// `npx cap sync`; until then canReadInApp() is false and no button shows.
// ─────────────────────────────────────────────────────────────────────────────
import { Capacitor, registerPlugin } from '@capacitor/core';

const InAppBrowser = registerPlugin('InAppBrowser');

const MESSAGE_TYPE = 'spicehub-recipe-page';
// The rendered DOM after any consent banner or challenge has cleared. JSON-LD
// sits in <head> and recipe cards early in <body>, so 1.5 MB is plenty and
// keeps the native bridge message small.
const PAGE_HTML_CAP = 1_500_000;
const MIN_PAGE_HTML = 200;

// Runs inside the visited page when the toolbar button is tapped.
const READ_PAGE_SCRIPT = `(function () {
  try {
    window.mobileApp.postMessage({ detail: { type: '${MESSAGE_TYPE}', url: location.href,
      html: document.documentElement.outerHTML.slice(0, ${PAGE_HTML_CAP}) } });
  } catch (e) {
    window.mobileApp.postMessage({ detail: { type: '${MESSAGE_TYPE}', error: String(e) } });
  }
})();`;

/** True in the native app once the in-app browser plugin is installed. */
export function canReadInApp() {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InAppBrowser');
}

/**
 * Open `url` in the in-app browser and wait for the person to tap import.
 *
 * @param {string} url
 * @returns {Promise<{ url: string, html: string } | null>} null if they close
 *   the browser without importing, or anything fails
 */
export function readRecipePageInApp(url) {
  if (!canReadInApp() || !/^https?:\/\//i.test(url || '')) return Promise.resolve(null);

  return new Promise((resolve) => {
    const handles = [];
    let webviewId;
    let settled = false;
    const mine = (event) => !webviewId || !event?.id || event.id === webviewId;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      handles.forEach((h) => h.remove().catch(() => {}));
      resolve(result);
    };

    (async () => {
      handles.push(await InAppBrowser.addListener('buttonNearDoneClick', (event) => {
        if (!mine(event)) return;
        InAppBrowser.executeScript({ code: READ_PAGE_SCRIPT, id: webviewId }).catch(() => finish(null));
      }));
      handles.push(await InAppBrowser.addListener('messageFromWebview', (event) => {
        const detail = event?.detail;
        if (!mine(event) || detail?.type !== MESSAGE_TYPE) return;
        InAppBrowser.close({ id: webviewId }).catch(() => {});
        // Trust boundary: page content is untrusted. Only an http(s) URL and a
        // string of HTML go on, into the same extractor /api/extract uses.
        const pageUrl = /^https?:\/\//i.test(detail.url || '') ? detail.url : url;
        const html = typeof detail.html === 'string' ? detail.html.slice(0, PAGE_HTML_CAP) : '';
        finish(html.length >= MIN_PAGE_HTML ? { url: pageUrl, html } : null);
      }));
      handles.push(await InAppBrowser.addListener('closeEvent', (event) => {
        if (mine(event)) finish(null);
      }));

      const opened = await InAppBrowser.openWebView({
        url,
        title: 'Tap the import button when the recipe shows',
        // Self-paired, theme-invariant toolbar (design.md §5): dark text and
        // icon on the import sheet's light background, 13:1 contrast.
        toolbarColor: '#F7F5F2',
        toolbarTextColor: '#2A2521',
        showReloadButton: true,
        preventDeeplink: true, // keep the page here instead of bouncing to the site's own app
        buttonNearDone: {
          ios: { iconType: 'sf-symbol', icon: 'square.and.arrow.down' },
          android: { iconType: 'vector', icon: 'ic_spicehub_import', width: 24, height: 24 },
        },
      });
      webviewId = opened?.id;
    })().catch(() => finish(null));
  });
}
