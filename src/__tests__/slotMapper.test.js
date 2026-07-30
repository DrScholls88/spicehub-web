import { describe, it, expect } from 'vitest';
import { toSlotData, fromSlotData, isPublicUrl } from '../lib/slotMapper';

describe('isPublicUrl', () => {
  it('accepts https URLs', () => {
    expect(isPublicUrl('https://cdn.example.com/photo.jpg')).toBe(true);
  });
  it('accepts http URLs', () => {
    expect(isPublicUrl('http://example.com/photo.jpg')).toBe(true);
  });
  it('rejects data URLs', () => {
    expect(isPublicUrl('data:image/png;base64,abc')).toBe(false);
  });
  it('rejects blob URLs', () => {
    expect(isPublicUrl('blob:http://localhost/abc')).toBe(false);
  });
  it('rejects undefined/null', () => {
    expect(isPublicUrl(undefined)).toBe(false);
    expect(isPublicUrl(null)).toBe(false);
    expect(isPublicUrl('')).toBe(false);
  });
});

describe('toSlotData', () => {
  it('returns null for null slot', () => {
    expect(toSlotData(null, 'Alex')).toBeNull();
  });

  it('maps special day tag', () => {
    const slot = { id: '__eat_out__', name: 'Eat Out', icon: '🍽️' };
    const result = toSlotData(slot, 'Alex');
    expect(result).toEqual({
      name: 'Eat Out',
      ingredients: [],
      source_profile_name: 'Alex',
      is_special: true,
      special_tag: '__eat_out__',
    });
  });

  it('maps real meal with public image', () => {
    const slot = {
      name: 'Chicken Tikka',
      imageUrl: 'https://cdn.ig.com/photo.jpg',
      ingredients: [{ name: 'chicken' }, 'salt', { name: 'yogurt' }],
      servings: 4,
      link: 'https://instagram.com/p/abc',
      profileId: 'profile-uuid',
    };
    const result = toSlotData(slot, 'Alex');
    expect(result.name).toBe('Chicken Tikka');
    expect(result.imageUrl).toBe('https://cdn.ig.com/photo.jpg');
    expect(result.ingredients).toEqual(['chicken', 'salt', 'yogurt']);
    expect(result.servings).toBe(4);
    expect(result.source_url).toBe('https://instagram.com/p/abc');
    expect(result.source_profile_name).toBe('Alex');
    expect(result.is_special).toBe(false);
  });

  it('omits non-public imageUrl', () => {
    const slot = {
      name: 'Test',
      imageUrl: 'data:image/png;base64,abc',
      ingredients: [],
    };
    const result = toSlotData(slot, 'Alex');
    expect(result.imageUrl).toBeUndefined();
  });

  it('omits source_url when link is absent', () => {
    const slot = { name: 'Test', ingredients: [] };
    const result = toSlotData(slot, 'Alex');
    expect(result.source_url).toBeUndefined();
  });
});

describe('fromSlotData', () => {
  it('maps special day tag back', () => {
    const row = {
      slot_data: {
        name: 'Eat Out',
        is_special: true,
        special_tag: '__eat_out__',
        source_profile_name: 'Alex',
        ingredients: [],
      },
      updated_by: 'user-123',
      updated_at: '2026-07-28T10:00:00Z',
    };
    const result = fromSlotData(row);
    expect(result.id).toBe('__eat_out__');
    expect(result.name).toBe('Eat Out');
    expect(typeof result.icon).toBe('string');
  });

  it('maps real meal with shared metadata', () => {
    const row = {
      slot_data: {
        name: 'Pasta',
        imageUrl: 'https://cdn.com/pasta.jpg',
        ingredients: ['pasta', 'sauce'],
        servings: 2,
        source_url: 'https://recipe.com/pasta',
        source_profile_name: 'Alex',
        is_special: false,
      },
      updated_by: 'user-456',
      updated_at: '2026-07-28T12:00:00Z',
    };
    const result = fromSlotData(row);
    expect(result.name).toBe('Pasta');
    expect(result.ingredients).toEqual(['pasta', 'sauce']);
    expect(result.link).toBe('https://recipe.com/pasta');
    expect(result._sharedBy).toBe('Alex');
    expect(result._isSharedSlot).toBe(true);
  });
});
