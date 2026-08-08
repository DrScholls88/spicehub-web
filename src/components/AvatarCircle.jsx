/**
 * AvatarCircle — universal avatar renderer.
 * Fallback chain: custom photo URL → pixel emoji → initials letter.
 *
 * Props:
 *   avatarUrl   — custom photo URL (from Supabase Storage)
 *   avatarId    — pixel avatar ID (from pixelAvatars.js)
 *   displayName — used for initials fallback
 *   username    — used for initials fallback if no displayName
 *   size        — diameter in px (default 36, iOS min 44 for tap targets)
 *   showPresence — show green "online/recent" dot (default false)
 *   isRecent    — controls presence dot color (green if true)
 *   onClick     — optional click handler
 *   className   — optional extra class
 */
import { useState } from 'react';
import { getAvatarFallback } from '../data/pixelAvatars';

export default function AvatarCircle({
  avatarUrl, avatarId, displayName, username,
  size = 36, showPresence = false, isRecent = false,
  onClick, className = '',
}) {
  const [imgError, setImgError] = useState(false);

  // Recompute fallback when photo fails to load
  const user = {
    avatarUrl: imgError ? null : avatarUrl,
    avatarId,
    displayName,
    username,
  };
  const av = getAvatarFallback(user);

  const circleStyle = {
    width: size,
    height: size,
    minWidth: size,
    minHeight: size,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
    flexShrink: 0,
    cursor: onClick ? 'pointer' : undefined,
    background: av.type === 'photo' ? 'var(--surface-raised, #333)' : (av.color || 'var(--primary)'),
    border: '2px solid var(--border, rgba(255,255,255,0.1))',
  };

  const Tag = onClick ? 'button' : 'div';
  const interactiveProps = onClick ? {
    type: 'button',
    onClick,
    'aria-label': `${displayName || username || 'User'} avatar`,
    style: { ...circleStyle, padding: 0, borderStyle: 'solid' },
  } : { style: circleStyle };

  return (
    <Tag className={`avatar-circle ${className}`} {...interactiveProps}>
      {av.type === 'photo' ? (
        <img
          src={av.src}
          alt=""
          onError={() => setImgError(true)}
          loading="lazy"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            borderRadius: '50%',
          }}
        />
      ) : av.type === 'emoji' ? (
        <span style={{ fontSize: size * 0.55, lineHeight: 1 }} aria-hidden="true">
          {av.emoji}
        </span>
      ) : (
        <span style={{
          fontSize: size * 0.45,
          fontWeight: 700,
          color: '#fff',
          lineHeight: 1,
          userSelect: 'none',
        }}>
          {av.initial}
        </span>
      )}

      {showPresence && (
        <span
          className="avatar-presence-dot"
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: Math.max(8, size * 0.25),
            height: Math.max(8, size * 0.25),
            borderRadius: '50%',
            background: isRecent ? '#4CAF50' : 'var(--text-muted)',
            border: '2px solid var(--bg, #1a1a1a)',
          }}
          aria-label={isRecent ? 'Recently active' : 'Inactive'}
        />
      )}
    </Tag>
  );
}
