import { describe, it, expect } from 'vitest';
import db from '../db';

describe('v28 debug', () => {
  it('dumps raw userTags after open', async () => {
    await db.open();
    console.log('verno', db.verno);
    const all = await db.userTags.toArray();
    console.log('userTags count', all.length);
    console.log(JSON.stringify(all.filter(t => t.domain === 'drink'), null, 2));
    console.log('drink count', all.filter(t => t.domain === 'drink').length);
    expect(true).toBe(true);
  });
});
