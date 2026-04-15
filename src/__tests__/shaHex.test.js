import { describe, it, expect } from 'vitest';
import { shaHex } from '../shaHex.js';

describe('shaHex', () => {
  it('computes a stable lowercase hex sha256', async () => {
    const h = await shaHex('hello');
    expect(h).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
  it('differs for different inputs', async () => {
    expect(await shaHex('a')).not.toBe(await shaHex('b'));
  });
});
