import { describe, expect, it } from 'vitest';
import { getPlanCardState, planForNextDays } from '../lib/landingHelpers.js';

const meal = (name) => ({ id: name, name });
const emptyDays = Array.from({ length: 7 }, () => ({ meal: null }));

describe('getPlanCardState', () => {
  it('loading wins over everything', () => {
    expect(getPlanCardState({ loading: true, mealsCount: 0, days: [{ meal: meal('x') }] }).state).toBe('loading');
  });

  it('hides when any of the next 7 days has a meal', () => {
    const days = [...emptyDays]; days[4] = { meal: meal('Thu') };
    expect(getPlanCardState({ mealsCount: 14, rotationCount: 14, days }).state).toBe('hidden');
  });

  it('emptyLibrary with no recipes', () => {
    expect(getPlanCardState({ mealsCount: 0, rotationCount: 0, days: emptyDays }).state).toBe('emptyLibrary');
  });

  it('rotationShort when The Rotation has 1-4, even with a big library', () => {
    expect(getPlanCardState({ mealsCount: 40, rotationCount: 3, days: emptyDays }))
      .toEqual({ state: 'rotationShort', needed: 2, pool: 'rotation' });
  });

  it('rotationShort against the library when The Rotation is empty and the library has 1-4', () => {
    expect(getPlanCardState({ mealsCount: 3, rotationCount: 0, days: emptyDays }))
      .toEqual({ state: 'rotationShort', needed: 2, pool: 'library' });
  });

  it('ready with 5+ in The Rotation, or an empty Rotation over a 5+ library (spinner fallback)', () => {
    expect(getPlanCardState({ mealsCount: 14, rotationCount: 14, days: emptyDays }).state).toBe('ready');
    expect(getPlanCardState({ mealsCount: 12, rotationCount: 0, days: emptyDays }).state).toBe('ready');
  });
});

describe('planForNextDays', () => {
  it('a Saturday install spans into next week via weekHistory', () => {
    const saturday = new Date(2026, 9, 3); // Sat Oct 3 2026; week of Mon Sep 28
    const weekPlan = [null, null, null, null, null, meal('Sat'), meal('Sun')];
    const weekHistory = [{ weekStart: new Date(2026, 9, 5).toISOString(), meals: [meal('NextMon'), null, null, null, null, null, null] }];
    const days = planForNextDays(saturday, 7, weekPlan, weekHistory);
    expect(days).toHaveLength(7);
    expect(days[0].isToday).toBe(true);
    expect(days.map(d => d.meal?.name ?? null)).toEqual(['Sat', 'Sun', 'NextMon', null, null, null, null]);
    expect(days[2].date.getDay()).toBe(1);
  });

  it('all seven empty when nothing is planned anywhere', () => {
    const days = planForNextDays(new Date(2026, 8, 30), 7, [], []);
    expect(days.every(d => d.meal === null)).toBe(true);
  });
});
