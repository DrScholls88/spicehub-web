// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — api/vision.js server-side Gemini vision proxy.
// Mirrors corpus.structure-server.test.js's rate-limit coverage. The handler
// itself makes a real fetch to Gemini, so (matching that file's precedent for
// api/structure.js's handler) it isn't unit-tested here — only the pure,
// exported checkRateLimit helper is.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { checkRateLimit } from '../../api/vision.js';

describe('api/vision — rate limiting', () => {
  it('allows a burst then blocks', () => {
    const now = Date.now();
    const ip = 'vision-test-' + Math.random();
    for (let i = 0; i < 60; i++) expect(checkRateLimit(ip, now)).toBe(true);
    expect(checkRateLimit(ip, now)).toBe(false);
  });

  it('resets after the rate window elapses', () => {
    const now = Date.now();
    const ip = 'vision-test-reset-' + Math.random();
    expect(checkRateLimit(ip, now)).toBe(true);
    expect(checkRateLimit(ip, now + 5 * 60 * 1000 + 1)).toBe(true);
  });

  it('tracks IPs independently', () => {
    const now = Date.now();
    const ipA = 'vision-test-a-' + Math.random();
    const ipB = 'vision-test-b-' + Math.random();
    for (let i = 0; i < 60; i++) expect(checkRateLimit(ipA, now)).toBe(true);
    expect(checkRateLimit(ipA, now)).toBe(false);
    expect(checkRateLimit(ipB, now)).toBe(true);
  });
});
