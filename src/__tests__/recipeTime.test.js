import { describe, it, expect } from 'vitest';
import { parseTimeToMinutes, getTotalMinutes, formatMinutes } from '../lib/recipeTime.js';

// This module was lifted out of MealLibrary.jsx so MealDetail's time chip and
// the Library's "Quick" category / Time filter share one parser. These tests
// pin the behaviour the Library already depended on, so the extraction can't
// silently change what counts as a 30-minute meal.

describe('parseTimeToMinutes', () => {
  it('parses ISO 8601 durations', () => {
    expect(parseTimeToMinutes('PT30M')).toBe(30);
    expect(parseTimeToMinutes('PT1H')).toBe(60);
    expect(parseTimeToMinutes('PT1H30M')).toBe(90);
    expect(parseTimeToMinutes('pt2h15m')).toBe(135);
  });

  it('parses freeform English durations', () => {
    expect(parseTimeToMinutes('15 min')).toBe(15);
    expect(parseTimeToMinutes('45 minutes')).toBe(45);
    expect(parseTimeToMinutes('2 hours')).toBe(120);
    expect(parseTimeToMinutes('1 hr 30 min')).toBe(90);
    expect(parseTimeToMinutes('1.5 hours')).toBe(90);
  });

  it('treats a bare number as minutes', () => {
    expect(parseTimeToMinutes('45')).toBe(45);
    expect(parseTimeToMinutes(90)).toBe(90);
  });

  it('returns null for unknown / empty input rather than zero', () => {
    expect(parseTimeToMinutes('')).toBeNull();
    expect(parseTimeToMinutes(null)).toBeNull();
    expect(parseTimeToMinutes(undefined)).toBeNull();
    expect(parseTimeToMinutes('   ')).toBeNull();
    expect(parseTimeToMinutes('overnight')).toBeNull();
  });
});

describe('getTotalMinutes', () => {
  it('prefers an explicit totalTime', () => {
    expect(getTotalMinutes({ totalTime: 'PT45M', prepTime: '10 min', cookTime: '10 min' })).toBe(45);
  });

  it('falls back to prep + cook', () => {
    expect(getTotalMinutes({ prepTime: '10 min', cookTime: '20 min' })).toBe(30);
    expect(getTotalMinutes({ prepTime: '10 min' })).toBe(10);
    expect(getTotalMinutes({ cookTime: 'PT1H' })).toBe(60);
  });

  it('returns null when no time data exists, so unknowns never read as quick', () => {
    expect(getTotalMinutes({})).toBeNull();
    expect(getTotalMinutes({ totalTime: 'a while' })).toBeNull();
    expect(getTotalMinutes(null)).toBeNull();
  });
});

describe('formatMinutes', () => {
  it('formats minutes, hours, and mixed durations', () => {
    expect(formatMinutes(25)).toBe('25 min');
    expect(formatMinutes(60)).toBe('1 hr');
    expect(formatMinutes(90)).toBe('1 hr 30 min');
    expect(formatMinutes(120)).toBe('2 hr');
  });

  it('returns an empty string for nothing worth showing', () => {
    expect(formatMinutes(null)).toBe('');
    expect(formatMinutes(0)).toBe('');
    expect(formatMinutes(undefined)).toBe('');
    expect(formatMinutes(NaN)).toBe('');
  });
});
