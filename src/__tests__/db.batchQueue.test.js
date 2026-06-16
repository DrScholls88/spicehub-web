import { describe, it, expect, beforeEach } from 'vitest';
import db, {
  addBatchQueueItems,
  getBatchQueueItems,
  getNextPendingBatchItem,
  updateBatchQueueItem,
  setBatchItemType,
  deleteBatchQueueItem,
  clearFinishedBatchItems,
} from '../db.js';

describe('batchQueue helpers', () => {
  beforeEach(async () => {
    await db.batchQueue.clear();
  });

  it('addBatchQueueItems writes pending rows for each url', async () => {
    const ids = await addBatchQueueItems([
      'https://www.instagram.com/reel/AAA111/',
      'https://www.instagram.com/reel/BBB222/',
    ]);
    expect(ids).toHaveLength(2);

    const items = await getBatchQueueItems();
    expect(items).toHaveLength(2);
    expect(items.every(i => i.status === 'pending')).toBe(true);
    expect(items.every(i => i.itemType === 'meal')).toBe(true);
    expect(items.every(i => i.itemTypeUserOverride === false)).toBe(true);
  });

  it('getNextPendingBatchItem returns the oldest pending item', async () => {
    const [firstId] = await addBatchQueueItems(['https://www.instagram.com/reel/AAA111/']);
    await addBatchQueueItems(['https://www.instagram.com/reel/BBB222/']);

    const next = await getNextPendingBatchItem();
    expect(next.id).toBe(firstId);
  });

  it('updateBatchQueueItem updates status and recipe', async () => {
    const [id] = await addBatchQueueItems(['https://www.instagram.com/reel/AAA111/']);
    await updateBatchQueueItem(id, { status: 'ready', recipe: { title: 'Test Recipe' } });

    const items = await getBatchQueueItems();
    const item = items.find(i => i.id === id);
    expect(item.status).toBe('ready');
    expect(item.recipe.title).toBe('Test Recipe');
    expect(item.updatedAt).toBeGreaterThan(0);
  });

  it('setBatchItemType sets itemType and itemTypeUserOverride', async () => {
    const [id] = await addBatchQueueItems(['https://www.instagram.com/reel/AAA111/']);
    await setBatchItemType(id, 'drink');

    const items = await getBatchQueueItems();
    const item = items.find(i => i.id === id);
    expect(item.itemType).toBe('drink');
    expect(item.itemTypeUserOverride).toBe(true);
  });

  it('deleteBatchQueueItem removes a single row', async () => {
    const [id1, id2] = await addBatchQueueItems([
      'https://www.instagram.com/reel/AAA111/',
      'https://www.instagram.com/reel/BBB222/',
    ]);
    await deleteBatchQueueItem(id1);

    const items = await getBatchQueueItems();
    expect(items.map(i => i.id)).toEqual([id2]);
  });

  it('clearFinishedBatchItems removes only saved rows', async () => {
    const [id1, id2] = await addBatchQueueItems([
      'https://www.instagram.com/reel/AAA111/',
      'https://www.instagram.com/reel/BBB222/',
    ]);
    await updateBatchQueueItem(id1, { status: 'saved' });
    await updateBatchQueueItem(id2, { status: 'ready' });

    await clearFinishedBatchItems();

    const items = await getBatchQueueItems();
    expect(items.map(i => i.id)).toEqual([id2]);
  });
});
