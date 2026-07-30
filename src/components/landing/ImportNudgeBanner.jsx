import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';

const NUDGE_DISMISS_KEY = 'sh_import_nudge_dismissed';
const LAST_IMPORT_KEY = 'sh_last_import_ts';
const STALE_DAYS = 7;
const REDISMISS_DAYS = 3;

function isDismissed() {
  try {
    const ts = parseInt(localStorage.getItem(NUDGE_DISMISS_KEY), 10);
    if (!ts) return false;
    return Date.now() - ts < REDISMISS_DAYS * 86400000;
  } catch { return false; }
}

function isImportStale() {
  try {
    const ts = parseInt(localStorage.getItem(LAST_IMPORT_KEY), 10);
    if (!ts) return true; // never imported
    return Date.now() - ts > STALE_DAYS * 86400000;
  } catch { return true; }
}

export default function ImportNudgeBanner({ batchQueueCount = 0, onNavigate }) {
  const [dismissed, setDismissed] = useState(false);

  const nudge = useMemo(() => {
    if (dismissed || isDismissed()) return null;

    // Priority 1: pending imports in queue
    if (batchQueueCount > 0) {
      return {
        icon: '⏳',
        title: `${batchQueueCount} recipe${batchQueueCount === 1 ? '' : 's'} waiting to import`,
        subtitle: 'Tap to finish importing when you\'re online',
        action: () => onNavigate('library'),
      };
    }

    // Priority 2: stale imports
    if (isImportStale()) {
      return {
        icon: '📥',
        title: 'Find something new?',
        subtitle: 'Import a recipe from Instagram or any URL',
        action: () => onNavigate('library'),
      };
    }

    return null;
  }, [batchQueueCount, dismissed, onNavigate]);

  if (!nudge) return null;

  return (
    <motion.div
      className="install-banner nudge-orange"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0, padding: 0, overflow: 'hidden' }}
      transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
      onClick={nudge.action}
      role="region"
      aria-label="Recipe import banner"
    >
      <span className="install-icon">{nudge.icon}</span>
      <div className="install-text">
        <div className="install-title">{nudge.title}</div>
        <div className="install-subtitle">{nudge.subtitle}</div>
      </div>
      <button
        className="install-dismiss"
        onClick={(e) => {
          e.stopPropagation();
          setDismissed(true);
          try { localStorage.setItem(NUDGE_DISMISS_KEY, String(Date.now())); } catch {}
        }}
        aria-label="Dismiss banner"
      >
        ✕
      </button>
    </motion.div>
  );
}

/** Call this from the import engine on successful save */
export function markImportTimestamp() {
  try { localStorage.setItem(LAST_IMPORT_KEY, String(Date.now())); } catch {}
}
