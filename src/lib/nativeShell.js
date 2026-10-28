/**
 * Native shell glue for the Capacitor builds (android/, ios/).
 *
 * main.jsx imports this FIRST, before anything can call fetch. On the web
 * every branch below is skipped and the exports are inert, so the PWA is
 * untouched. On a device the bundled dist/ is served from https://localhost
 * (Android) or capacitor://localhost (iOS), which is what most of this file
 * exists to paper over.
 */
import { Capacitor, SystemBars, SystemBarsStyle, SystemBarType } from '@capacitor/core';
import { requestBack } from '../navigation/backStack';

export const isNative = Capacitor.isNativePlatform();

// ── /api/* → the deployed API ───────────────────────────────────────────────
// Every import call is a relative `/api/...` fetch. On a device that resolves
// to the local asset server and 404s, so the whole import engine would die.
// Rewriting at window.fetch covers all ~18 call sites (and future ones) in one
// place; apiUrl() is for the few non-fetch uses such as <img src>.
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN || 'https://spicehub-web.vercel.app').replace(/\/$/, '');

export function apiUrl(path) {
  return isNative && path.startsWith('/api/') ? API_ORIGIN + path : path;
}

// ── Sign-in return trip ─────────────────────────────────────────────────────
// Registered in AndroidManifest.xml and Info.plist (CFBundleURLTypes); must
// also be listed under Supabase → Auth → URL Configuration → Redirect URLs.
export const NATIVE_AUTH_REDIRECT = 'com.spicehub.app://auth/callback';

// ── System bar icon colours ─────────────────────────────────────────────────
// The status bar always sits on the body::before scrim (App.css): orange
// --primary, or near-black on the Bar tab. So its icons stay light, like the
// PWA's black-translucent bar; following the theme would put dark icons on the
// Bar tab's black strip. The gesture/nav bar sits on the tab bar, which does
// follow the theme. (SystemBarsStyle.Dark = light icons, for dark backgrounds.)
export function setSystemBarsDark(isDark) {
  if (!isNative) return;
  SystemBars.setStyle({ style: SystemBarsStyle.Dark, bar: SystemBarType.StatusBar }).catch(() => {});
  SystemBars.setStyle({
    style: isDark ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
    bar: SystemBarType.NavigationBar,
  }).catch(() => {});
}

if (isNative) {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    let url;
    try {
      url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    } catch {
      return nativeFetch(input, init);
    }
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
      return nativeFetch(input, init);
    }
    const target = API_ORIGIN + url.pathname + url.search;
    return nativeFetch(input instanceof Request ? new Request(target, input) : target, init);
  };

  // ── Native plugins: back button + deep links ──────────────────────────────
  import('@capacitor/app').then(({ App }) => {
    // Android hardware back goes through the same backStack funnel as
    // popstate/Escape, so it closes the top sheet first. At the root it shows
    // the existing "Press back again to exit" hint, and the second press quits.
    App.addListener('backButton', () => {
      if (requestBack('native') === 'root-exit') App.exitApp();
    });

    App.addListener('appUrlOpen', async ({ url }) => {
      if (!url?.startsWith(NATIVE_AUTH_REDIRECT)) return; // ://share is the share plugin's
      try {
        // ponytail: dynamic on purpose. supabaseClient.js statically imports this file, so a
        // static import here would be a cycle. Vite's "will not move module into another chunk"
        // warning for it is expected.
        const { completeNativeSignIn } = await import('./supabaseClient');
        await completeNativeSignIn(url);
        window.location.reload(); // same as the web /auth/callback path in App.jsx
      } catch (err) {
        console.warn('[native] sign-in return failed:', err?.message || err);
      }
    });
  }).catch((err) => console.warn('[native] App plugin unavailable:', err?.message || err));

  // ── Share sheet + file saving ─────────────────────────────────────────────
  // Android WebView has no navigator.share, and neither WebView saves
  // <a download> blobs, so exports, backups and "share list" did nothing.
  // Polyfill share with the native sheet, then route blob downloads through
  // it. iOS keeps WebKit's own navigator.share.
  if (!navigator.share) {
    navigator.share = async ({ title, text, url, files } = {}) => {
      const { Share } = await import('@capacitor/share');
      let fileUris;
      if (files?.length) {
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        fileUris = await Promise.all(files.map(async (file) => {
          const data = await blobToBase64(file);
          const { uri } = await Filesystem.writeFile({ path: file.name || 'spicehub-export', data, directory: Directory.Cache });
          return uri;
        }));
      }
      try {
        await Share.share({ title, text, url, files: fileUris, dialogTitle: title });
      } catch (err) {
        // Web callers check err.name === 'AbortError' for a user cancel.
        if (/cancel/i.test(err?.message || '')) throw new DOMException('Share canceled', 'AbortError');
        throw err;
      }
    };
    navigator.canShare = () => true;
  }

  // Callers revoke the blob: URL right after a.click(), so remember the Blob
  // behind each URL to read it synchronously when the click lands.
  const blobs = new Map();
  const createObjectURL = URL.createObjectURL.bind(URL);
  const revokeObjectURL = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (obj) => {
    const href = createObjectURL(obj);
    if (obj instanceof Blob) blobs.set(href, obj);
    return href;
  };
  URL.revokeObjectURL = (href) => {
    blobs.delete(href);
    revokeObjectURL(href);
  };
  const anchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function click() {
    const blob = this.download && blobs.get(this.href);
    if (!blob) return anchorClick.call(this);
    const file = new File([blob], this.download, { type: blob.type });
    navigator.share({ files: [file], title: this.download }).catch((err) => {
      if (err?.name !== 'AbortError') console.warn('[native] save failed:', err?.message || err);
    });
  };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
