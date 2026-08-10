/**
 * Detect if running on a mobile/tablet device.
 * Used only for UI hints — NOT for disabling features.
 * The browser import feature works on all devices because the PC's server
 * handles Chrome automation; the phone just polls for results over the network.
 */
export function isMobileDevice() {
  const ua = navigator.userAgent;
  return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
}

// 2026-08-09 (bar-library-parity-plan-2026-08-07.md §0.5 "Also noted" + Phase 2
// execution order item 0): these used to be defined inline inside App.jsx as
// component-local consts, which meant they weren't reachable from anywhere
// else — BarLibrary's Phase 2 status-bar-scrim and platform-specific touch
// handling both need them. Lifted here verbatim (same UA checks), App.jsx now
// imports them instead of redefining them so its existing call sites/prop
// passing don't change.
export function isIOS() {
  return typeof window !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

// Plain UA check — kept independent of the `beforeinstallprompt` event so an
// "Install to phone" affordance can show on Android even before/without a
// captured deferredPrompt.
export function isAndroid() {
  return typeof window !== 'undefined' && /Android/.test(navigator.userAgent);
}
