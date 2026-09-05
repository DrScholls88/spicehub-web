import React from 'react';
import { motion } from 'framer-motion';

const DISMISS_KEY = 'sh_ios_share_prompt_v1';

export function isIosSharePromptDismissed() {
  try { return !!localStorage.getItem(DISMISS_KEY); } catch { return true; }
}

/**
 * IosShareBanner — the one platform gap SpiceHub cannot close in code.
 *
 * Android PWAs register as a share-sheet target through the manifest's
 * `share_target`, so "Share -> SpiceHub" from Instagram just works. iOS has
 * never implemented it: an installed iOS PWA simply cannot appear in the share
 * sheet. The workaround is a one-time Shortcut that opens
 * `/?share-target=1&url=…` — a URL src/lib/launchIntent.js already parses.
 *
 * That workaround existed, but only as a collapsed row inside Settings, which
 * is not somewhere a new user goes. Sharing from Instagram is the product's
 * whole reason to exist, so on the one platform where it needs a setup step,
 * that step gets surfaced once, in the open, rather than waiting to be found.
 *
 * Deliberately narrow: only for installed iOS (App.jsx gates on
 * `isStandalone && isIOS()`), only until dismissed or set up, and it borrows
 * InstallBanner's markup and CSS wholesale — those two can never appear at the
 * same time, since `canInstall` is false once the app is already installed.
 */
export default function IosShareBanner({ onOpenSetup, onDismiss }) {
  return (
    <motion.div
      className="install-banner"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0, padding: 0, overflow: 'hidden' }}
      transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
      onClick={onOpenSetup}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenSetup?.(); } }}
    >
      <span className="install-icon" aria-hidden="true">📤</span>
      <div className="install-text">
        <div className="install-title">Share recipes straight from Instagram</div>
        <div className="install-subtitle">iPhone needs a one-time setup — takes a minute</div>
      </div>
      <button
        className="install-dismiss"
        onClick={(e) => {
          e.stopPropagation();
          try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode — it just returns next launch */ }
          onDismiss?.();
        }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </motion.div>
  );
}
