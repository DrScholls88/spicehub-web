import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  pushLayer,
  detachLayer,
  requestBack,
  getStackDepth,
  getStackSnapshot,
  resetBackStackForTests,
  setRootExitHintHandler,
} from '../navigation/backStack';

describe('backStack', () => {
  beforeEach(() => {
    resetBackStackForTests();
    setRootExitHintHandler(null);
    // Minimal history mock
    const states = [{ spicehub: 'root-sentinel' }];
    vi.stubGlobal('history', {
      get state() { return states[states.length - 1]; },
      pushState(st) { states.push(st); },
      back() { if (states.length > 1) states.pop(); },
    });
  });

  it('pushLayer increases depth', () => {
    pushLayer({ id: 'a', onBack: () => {} });
    expect(getStackDepth()).toBe(1);
    pushLayer({ id: 'b', onBack: () => {} });
    expect(getStackDepth()).toBe(2);
    expect(getStackSnapshot().map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('requestBack pops LIFO and calls only top onBack', () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    pushLayer({ id: 'a', onBack: a });
    pushLayer({ id: 'b', onBack: b });
    pushLayer({ id: 'c', onBack: c });

    expect(requestBack('ui')).toBe('handled');
    expect(c).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(getStackDepth()).toBe(2);

    expect(requestBack('popstate')).toBe('handled');
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    expect(getStackDepth()).toBe(1);
  });

  it('dedupes rapid non-ui backs', () => {
    const a = vi.fn();
    pushLayer({ id: 'a', onBack: a });
    expect(requestBack('popstate')).toBe('handled');
    expect(requestBack('closewatcher')).toBe('deduped');
    expect(a).toHaveBeenCalledTimes(1);
    expect(getStackDepth()).toBe(0);
  });

  it('detachLayer removes without calling onBack', () => {
    const a = vi.fn();
    const id = pushLayer({ id: 'a', onBack: a });
    expect(detachLayer(id)).toBe(true);
    expect(a).not.toHaveBeenCalled();
    expect(getStackDepth()).toBe(0);
  });

  it('prevent keeps layer on stack', () => {
    const a = vi.fn(() => 'prevent');
    pushLayer({ id: 'a', onBack: a });
    expect(requestBack('ui')).toBe('prevent');
    expect(getStackDepth()).toBe(1);
  });

  it('root double-back: hint then exit', () => {
    const hint = vi.fn();
    setRootExitHintHandler(hint);
    expect(requestBack('popstate')).toBe('root-hint');
    expect(hint).toHaveBeenCalledWith('Press back again to exit');
    expect(requestBack('popstate')).toBe('root-exit');
  });

  it('three stacked backs close three layers', () => {
    const calls = [];
    pushLayer({ id: 'a', onBack: () => calls.push('a') });
    pushLayer({ id: 'b', onBack: () => calls.push('b') });
    pushLayer({ id: 'c', onBack: () => calls.push('c') });
    requestBack('popstate');
    requestBack('ui'); // ui bypasses dedupe window
    // after first popstate, generation marked — use ui for remaining
    requestBack('ui');
    expect(calls).toEqual(['c', 'b', 'a']);
    expect(getStackDepth()).toBe(0);
  });
});
