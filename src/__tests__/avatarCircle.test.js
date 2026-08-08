import { describe, it, expect } from 'vitest';
import { getAvatarFallback } from '../data/pixelAvatars';

describe('getAvatarFallback', () => {
  it('returns photo type when avatarUrl is present', () => {
    const result = getAvatarFallback({ avatarUrl: 'https://example.com/avatar.jpg' });
    expect(result.type).toBe('photo');
    expect(result.src).toBe('https://example.com/avatar.jpg');
  });

  it('returns emoji type when avatarId is present and no avatarUrl', () => {
    const result = getAvatarFallback({ avatarId: 'chef' });
    expect(result.type).toBe('emoji');
    expect(result.emoji).toBe('👨‍🍳');
    expect(result.color).toBe('#FF6B35');
  });

  it('returns initials type when neither avatarUrl nor avatarId', () => {
    const result = getAvatarFallback({ displayName: 'Brian' });
    expect(result.type).toBe('initials');
    expect(result.initial).toBe('B');
  });

  it('uses username for initials when no displayName', () => {
    const result = getAvatarFallback({ username: 'gembaguru' });
    expect(result.type).toBe('initials');
    expect(result.initial).toBe('G');
  });

  it('falls back to M when no user info at all', () => {
    const result = getAvatarFallback({});
    expect(result.type).toBe('initials');
    expect(result.initial).toBe('M');
  });

  it('avatarUrl takes priority over avatarId', () => {
    const result = getAvatarFallback({ avatarUrl: 'https://x.com/a.jpg', avatarId: 'cat' });
    expect(result.type).toBe('photo');
  });

  it('handles null/undefined user', () => {
    expect(getAvatarFallback(null).type).toBe('initials');
    expect(getAvatarFallback(undefined).type).toBe('initials');
  });
});
