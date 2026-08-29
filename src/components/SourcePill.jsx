import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Pencil, Link as LinkIcon, Camera } from 'lucide-react';

/* ── Platform icon config ──────────────────────────────────────────────── */
const PLATFORMS = {
  instagram: {
    gradient: 'linear-gradient(135deg, #f09433, #dc2743, #bc1888)',
    label: 'Instagram',
  },
  tiktok: {
    gradient: 'linear-gradient(135deg, #25F4EE, #010101 50%, #FE2C55)',
    label: 'TikTok',
  },
  youtube: {
    gradient: 'linear-gradient(135deg, #FF0000, #CC0000)',
    label: 'YouTube',
  },
  facebook: {
    gradient: 'linear-gradient(135deg, #1877F2, #0D5BBF)',
    label: 'Facebook',
  },
  pinterest: {
    gradient: 'linear-gradient(135deg, #E60023, #AD081B)',
    label: 'Pinterest',
  },
};

/** Detect social platform from URL. Returns key or null. */
export function detectPlatform(url) {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.includes('instagram.com') || lower.includes('instagr.am')) return 'instagram';
  if (lower.includes('tiktok.com') || lower.includes('vm.tiktok.com')) return 'tiktok';
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('facebook.com') || lower.includes('fb.watch')) return 'facebook';
  if (lower.includes('pinterest.com') || lower.includes('pin.it')) return 'pinterest';
  return null;
}

/** Human-readable detection label for the DetectionChip. */
export function getDetectionLabel(url) {
  const platform = detectPlatform(url);
  if (!platform) return 'Recipe page';
  if (platform === 'instagram') return 'Instagram reel';
  if (platform === 'tiktok') return 'TikTok video';
  if (platform === 'youtube') return 'YouTube video';
  if (platform === 'facebook') return 'Facebook post';
  if (platform === 'pinterest') return 'Pinterest pin';
  return 'Web page';
}

/**
 * SourcePill — shows the import source during loading.
 *
 * @param {string}   url      - Source URL (empty for photo imports)
 * @param {boolean}  isPhoto  - True for photo imports
 * @param {function} onEdit   - Called when the pencil is tapped (aborts + re-expands)
 */
export default function SourcePill({ url, isPhoto, onEdit }) {
  const platform = useMemo(() => (isPhoto ? null : detectPlatform(url)), [url, isPhoto]);
  const config = platform ? PLATFORMS[platform] : null;

  const displayUrl = useMemo(() => {
    if (!url) return '';
    return url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50);
  }, [url]);

  return (
    <motion.div
      className="source-pill"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
    >
      {/* Platform / photo icon */}
      <div
        className="source-pill-icon"
        style={config ? { background: config.gradient } : undefined}
      >
        {isPhoto ? (
          <Camera size={14} color="#fff" />
        ) : (
          <LinkIcon size={14} color="#fff" />
        )}
      </div>

      {/* Truncated URL or "Recipe photo" */}
      <span className="source-pill-url">
        {isPhoto ? 'Recipe photo' : displayUrl}
      </span>

      {/* Edit / abort button */}
      <button
        className="source-pill-edit"
        onClick={onEdit}
        aria-label={isPhoto ? 'Cancel import and retake photo' : 'Cancel import and edit URL'}
        type="button"
      >
        <Pencil size={13} />
      </button>
    </motion.div>
  );
}
