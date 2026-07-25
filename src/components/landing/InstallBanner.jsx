import React, { useState } from 'react';
import { motion } from 'framer-motion';

export default function InstallBanner({ onInstall }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <motion.div
      className="install-banner"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0, padding: 0, overflow: 'hidden' }}
      transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
      onClick={onInstall}
    >
      <span className="install-icon">📲</span>
      <div className="install-text">
        <div className="install-title">Install SpiceHub</div>
        <div className="install-subtitle">Add to home screen for faster access</div>
      </div>
      <button
        className="install-dismiss"
        onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </motion.div>
  );
}
