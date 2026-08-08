import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted() guarantees these are initialized before the vi.mock()
// factory below runs — see friends.deltaSync.test.js for why the plain
// "mock"-prefix auto-hoist convention wasn't reliable here.
const { mockToArray, mockClear, mockBulkPut, mockPut } = vi.hoisted(() => ({
  mockToArray: vi.fn().mockResolvedValue([]),
  mockClear: vi.fn().mockResolvedValue(undefined),
  mockBulkPut: vi.fn().mockResolvedValue(undefined),
  mockPut: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../db', () => ({
  default: {
    friendActivityCache: {
      orderBy: () => ({ reverse: () => ({ limit: () => ({ toArray: mockToArray }) }) }),
      clear: mockClear,
      bulkPut: mockBulkPut,
    },
    storageMetadata: { put: mockPut },
  },
}));

import { getCachedActivity, cacheActivityItems } from '../lib/friendActivity';

describe('friendActivity cache', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getCachedActivity returns empty array when no cache', async () => {
    mockToArray.mockResolvedValue([]);
    const items = await getCachedActivity();
    expect(items).toEqual([]);
  });

  it('getCachedActivity returns cached items', async () => {
    const cached = [{ activityType: 'friend_added', occurredAt: '2026-08-01T00:00:00Z' }];
    mockToArray.mockResolvedValue(cached);
    const items = await getCachedActivity();
    expect(items).toEqual(cached);
  });

  it('cacheActivityItems clears and repopulates', async () => {
    const items = [
      { activityType: 'share_sent', occurredAt: '2026-08-07T12:00:00Z', otherUserId: 'u1' },
    ];
    await cacheActivityItems(items);
    expect(mockClear).toHaveBeenCalledOnce();
    expect(mockBulkPut).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ activityType: 'share_sent', id: 1 })])
    );
    expect(mockPut).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'friendActivityCachedAt' })
    );
  });

  it('getCachedActivity swallows errors and returns []', async () => {
    mockToArray.mockRejectedValue(new Error('Dexie borked'));
    const items = await getCachedActivity();
    expect(items).toEqual([]);
  });
});
