import { describe, it, expect, vi, beforeEach } from 'vitest';

// We're testing the skip-logic wrapper, not the actual Supabase calls.
// Mock the Dexie storageMetadata table. vi.hoisted() guarantees these are
// initialized before the vi.mock() factory below runs (which itself is
// hoisted above the `import '../lib/friends'` that transitively imports
// '../db') — relying on the "mock"-prefix auto-hoist convention alone was
// flaky on this vitest version.
const { mockGet, mockPut } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPut: vi.fn(),
}));

vi.mock('../db', () => ({
  default: {
    storageMetadata: { get: mockGet, put: mockPut },
    friends: { toArray: vi.fn().mockResolvedValue([]) },
  },
}));

// We'll test the exported helper
import { shouldSkipFriendsSync, recordFriendsSync } from '../lib/friends';

describe('friends delta sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should NOT skip when no previous sync exists', async () => {
    mockGet.mockResolvedValue(undefined);
    const result = await shouldSkipFriendsSync();
    expect(result).toBe(false);
  });

  it('should skip when last sync was < 60s ago and no event fired', async () => {
    mockGet.mockResolvedValue({ key: 'lastFriendsSyncAt', value: Date.now() - 10_000 });
    const result = await shouldSkipFriendsSync();
    expect(result).toBe(true);
  });

  it('should NOT skip when last sync was > 60s ago', async () => {
    mockGet.mockResolvedValue({ key: 'lastFriendsSyncAt', value: Date.now() - 90_000 });
    const result = await shouldSkipFriendsSync();
    expect(result).toBe(false);
  });

  it('recordFriendsSync writes timestamp to storageMetadata', async () => {
    await recordFriendsSync();
    expect(mockPut).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'lastFriendsSyncAt', value: expect.any(Number) })
    );
  });
});
