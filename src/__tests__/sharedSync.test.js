import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import db from '../db.js';
import { enqueueSync, discardQueueForGroup } from '../lib/sharedSync';

beforeEach(async () => {
  await db.sharedSyncQueue.clear();
});

describe('sharedSync', () => {
  describe('enqueueSync', () => {
    it('adds a pending item to sharedSyncQueue', async () => {
      await enqueueSync({
        table: 'shared_week_plan',
        action: 'upsert',
        payload: { day_index: 0, slot: 'dinner', slot_data: { name: 'Test' } },
        homeGroupId: 'group-1',
      });

      const items = await db.sharedSyncQueue.toArray();
      expect(items.length).toBe(1);
      expect(items[0].status).toBe('pending');
      expect(items[0].table).toBe('shared_week_plan');
      expect(typeof items[0].clientMutationId).toBe('string');
    });
  });

  describe('discardQueueForGroup', () => {
    it('deletes all queue items for a group', async () => {
      await enqueueSync({ table: 'shared_week_plan', action: 'upsert', payload: {}, homeGroupId: 'g1' });
      await enqueueSync({ table: 'shared_week_plan', action: 'upsert', payload: {}, homeGroupId: 'g2' });

      await discardQueueForGroup('g1');

      const remaining = await db.sharedSyncQueue.toArray();
      expect(remaining.length).toBe(1);
      expect(remaining[0].homeGroupId).toBe('g2');
    });
  });
});
