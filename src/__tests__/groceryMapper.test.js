import { describe, it, expect } from 'vitest';
import { toCloudGrocery, fromCloudGrocery } from '../lib/groceryMapper';

describe('toCloudGrocery', () => {
  it('maps local grocery item to cloud shape', () => {
    const local = {
      id: 5,
      cloudId: 'uuid-abc',
      name: 'Milk',
      checked: false,
      store: 'Kroger',
    };
    const result = toCloudGrocery(local, 'group-1', 'user-1');
    expect(result.id).toBe('uuid-abc');
    expect(result.home_group_id).toBe('group-1');
    expect(result.name).toBe('Milk');
    expect(result.checked).toBe(false);
    expect(result.store).toBe('Kroger');
    expect(result.added_by).toBe('user-1');
  });

  it('generates cloudId if missing', () => {
    const local = { id: 5, name: 'Eggs', checked: true, store: '' };
    const result = toCloudGrocery(local, 'group-1', 'user-1');
    expect(typeof result.id).toBe('string');
    expect(result.id.length).toBe(36); // UUID
    expect(result._generatedCloudId).toBe(result.id); // signals caller to save back
  });

  it('normalizes isChecked to checked', () => {
    const local = { id: 1, name: 'Salt', isChecked: true };
    const result = toCloudGrocery(local, 'g', 'u');
    expect(result.checked).toBe(true);
  });
});

describe('fromCloudGrocery', () => {
  it('maps cloud grocery to local shape', () => {
    const cloud = {
      id: 'uuid-abc',
      name: 'Bread',
      checked: true,
      store: 'Target',
      quantity: '2',
      unit: 'loaves',
      sort_order: 3,
      added_by: 'user-2',
      checked_by: 'user-1',
      updated_at: '2026-07-28T10:00:00Z',
    };
    const result = fromCloudGrocery(cloud);
    expect(result.cloudId).toBe('uuid-abc');
    expect(result.name).toBe('Bread');
    expect(result.checked).toBe(true);
    expect(result.store).toBe('Target');
    expect(result._addedBy).toBe('user-2');
  });
});
