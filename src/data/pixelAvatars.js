/**
 * Pixel avatar definitions — 10 fixed options consistent with BarShelf pixel-art style.
 * Each avatar is a simple emoji + color pair for v1.
 * Future: replace with actual pixel-art SVGs.
 */
const PIXEL_AVATARS = [
  { id: 'chef',     emoji: '👨‍🍳', color: '#FF6B35', label: 'Chef' },
  { id: 'cowgirl',  emoji: '🤠', color: '#D4A574', label: 'Cowgirl' },
  { id: 'cat',      emoji: '🐱', color: '#9C27B0', label: 'Cat' },
  { id: 'fox',      emoji: '🦊', color: '#FF9800', label: 'Fox' },
  { id: 'alien',    emoji: '👽', color: '#4CAF50', label: 'Alien' },
  { id: 'robot',    emoji: '🤖', color: '#607D8B', label: 'Robot' },
  { id: 'ghost',    emoji: '👻', color: '#B0BEC5', label: 'Ghost' },
  { id: 'dragon',   emoji: '🐉', color: '#F44336', label: 'Dragon' },
  { id: 'unicorn',  emoji: '🦄', color: '#E91E63', label: 'Unicorn' },
  { id: 'penguin',  emoji: '🐧', color: '#2196F3', label: 'Penguin' },
];

export function getAvatar(id) {
  return PIXEL_AVATARS.find(a => a.id === id) || PIXEL_AVATARS[0];
}

export function getAvatarInitial(name) {
  return (name || 'M')[0].toUpperCase();
}

/**
 * Get the best available avatar display data.
 * Priority: avatarUrl (custom photo) > avatarId (pixel emoji) > initials.
 * @param {{ avatarUrl?: string, avatarId?: string, displayName?: string, username?: string }} user
 * @returns {{ type: 'photo'|'emoji'|'initials', src?: string, emoji?: string, color?: string, initial?: string }}
 */
export function getAvatarFallback(user) {
  if (user?.avatarUrl) {
    return { type: 'photo', src: user.avatarUrl };
  }
  if (user?.avatarId) {
    const av = getAvatar(user.avatarId);
    return { type: 'emoji', emoji: av.emoji, color: av.color };
  }
  const initial = (user?.displayName || user?.username || 'M')[0].toUpperCase();
  return { type: 'initials', initial, color: 'var(--primary)' };
}

export default PIXEL_AVATARS;
