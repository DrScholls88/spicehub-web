import { describe, it, expect } from 'vitest';
import { generateInviteCode } from '../lib/homeGroup';

describe('homeGroup', () => {
  describe('generateInviteCode', () => {
    it('returns a 6-char uppercase alphanumeric string', () => {
      const code = generateInviteCode();
      expect(code.length).toBe(6);
      expect(code).toMatch(/^[A-Z0-9]{6}$/);
    });

    it('generates unique codes', () => {
      const codes = new Set(Array.from({ length: 100 }, () => generateInviteCode()));
      expect(codes.size).toBe(100);
    });
  });
});
