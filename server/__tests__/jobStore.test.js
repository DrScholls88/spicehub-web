import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as jobStore from '../jobStore.js';

describe('jobStore', () => {
  beforeEach(() => jobStore._resetForTests());

  it('returns null for unknown jobId', () => {
    expect(jobStore.get('nope')).toBeNull();
  });

  it('round-trips put → get', () => {
    jobStore.put('j1', { status: 'queued', url: 'https://x' });
    const j = jobStore.get('j1');
    expect(j.status).toBe('queued');
    expect(j.url).toBe('https://x');
    expect(j.jobId).toBe('j1');
    expect(typeof j.createdAt).toBe('number');
    expect(typeof j.updatedAt).toBe('number');
  });

  it('merges successive puts', () => {
    jobStore.put('j1', { status: 'queued' });
    jobStore.put('j1', { status: 'processing', progress: 'hi' });
    const j = jobStore.get('j1');
    expect(j.status).toBe('processing');
    expect(j.progress).toBe('hi');
  });

  it('evicts entries older than TTL on read', () => {
    vi.useFakeTimers();
    jobStore.put('j1', { status: 'done' });
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(jobStore.get('j1')).toBeNull();
    vi.useRealTimers();
  });
});
