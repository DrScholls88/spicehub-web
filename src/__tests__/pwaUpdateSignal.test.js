import { describe, it, expect } from 'vitest';
import { isUpdateContext, isNewerBuild } from '../lib/pwaUpdateSignal.js';

describe('isUpdateContext', () => {
  it('is an update when the SW controller is present (the common case)', () => {
    expect(isUpdateContext({ hasController: true, hasLaunchedBefore: false })).toBe(true);
  });

  it('is an update when the device has launched before, even with a null controller', () => {
    // This is the iOS case: WebKit nulled navigator.serviceWorker.controller
    // across a resumed standalone session even though a worker was active.
    expect(isUpdateContext({ hasController: false, hasLaunchedBefore: true })).toBe(true);
  });

  it('is NOT an update on a genuine first install (neither signal present)', () => {
    expect(isUpdateContext({ hasController: false, hasLaunchedBefore: false })).toBe(false);
  });

  it('is an update when both signals are present', () => {
    expect(isUpdateContext({ hasController: true, hasLaunchedBefore: true })).toBe(true);
  });
});

describe('isNewerBuild', () => {
  it('is true when the remote build is strictly greater', () => {
    expect(isNewerBuild(42, 41)).toBe(true);
  });

  it('is false when the builds match', () => {
    expect(isNewerBuild(41, 41)).toBe(false);
  });

  it('is false when the remote build is behind (should not happen, but never regress the UI)', () => {
    expect(isNewerBuild(40, 41)).toBe(false);
  });

  it('is false for a missing/undefined remote build (fetch failed or 404)', () => {
    expect(isNewerBuild(undefined, 41)).toBe(false);
  });

  it('is false for a malformed remote build (bad JSON shape)', () => {
    expect(isNewerBuild('not-a-number', 41)).toBe(false);
    expect(isNewerBuild(null, 41)).toBe(false);
    expect(isNewerBuild({}, 41)).toBe(false);
  });

  it('is false when the local build is somehow not a number', () => {
    expect(isNewerBuild(42, undefined)).toBe(false);
  });

  it('accepts numeric strings, since JSON round-trips numbers cleanly but a hand-edited file might not', () => {
    expect(isNewerBuild('42', 41)).toBe(true);
  });
});
