import { useEffect } from 'react';

/**
 * iOS Safari resizes `visualViewport` when the on-screen keyboard opens but
 * does NOT resize the layout viewport the same way — `100dvh`/`100svh` are
 * supposed to track this (and the sheets that use them, e.g. ImportSheet /
 * ReExtractSheet, already get most of the benefit for free), but dvh's
 * keyboard-awareness has known inconsistencies on some iOS/Safari versions.
 *
 * This hook is a defensive supplement, not a replacement: it mirrors the
 * live gap between the layout viewport and the visual viewport into a CSS
 * custom property (`--keyboard-inset`) that any fixed-position bottom
 * element can fold into its own safe-area padding as an extra buffer, e.g.:
 *
 *   padding-bottom: calc(12px + env(safe-area-inset-bottom) + var(--keyboard-inset, 0px));
 *
 * No-op (var stays "0px") on any browser without `visualViewport` support.
 * Call once near the app root — it's a global listener, not per-component.
 */
export default function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    if (!vv) {
      root.style.setProperty('--keyboard-inset', '0px');
      return;
    }

    const update = () => {
      // Gap between the full layout viewport and what's actually visible
      // above the keyboard. Clamped to 0 so this never goes negative when
      // the keyboard is closed (visualViewport can be marginally larger
      // than innerHeight during momentum scroll on some devices).
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--keyboard-inset', `${Math.round(inset)}px`);
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.setProperty('--keyboard-inset', '0px');
    };
  }, []);
}
