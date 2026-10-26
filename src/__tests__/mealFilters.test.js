import { describe, it, expect } from 'vitest';
import { isDessert, matchesMealQuery } from '../lib/mealFilters';

describe('isDessert', () => {
  it('flags the Desserts category and its aliases', () => {
    expect(isDessert({ category: 'Desserts' })).toBe(true);
    expect(isDessert({ category: 'dessert' })).toBe(true);
    expect(isDessert({ category: 'Sweets' })).toBe(true);
  });
  it('flags course: dessert even when the category is a cuisine', () => {
    expect(isDessert({ category: 'Italian', course: 'Dessert' })).toBe(true);
  });
  it('leaves dinners, sides and empty input alone', () => {
    expect(isDessert({ category: 'Dinners', course: 'dinner' })).toBe(false);
    expect(isDessert({ category: 'Sides' })).toBe(false);
    expect(isDessert({})).toBe(false);
    expect(isDessert(null)).toBe(false);
  });
});

describe('matchesMealQuery', () => {
  const meal = { name: 'Chicken Tikka', category: 'Dinners', labels: ['Spicy', 'Quick'] };
  it('matches everything on a blank query', () => {
    expect(matchesMealQuery(meal, '')).toBe(true);
    expect(matchesMealQuery(meal, '   ')).toBe(true);
    expect(matchesMealQuery(meal, undefined)).toBe(true);
  });
  it('matches name, category and labels case-insensitively', () => {
    expect(matchesMealQuery(meal, 'tikka')).toBe(true);
    expect(matchesMealQuery(meal, 'DINNER')).toBe(true);
    expect(matchesMealQuery(meal, 'spic')).toBe(true);
  });
  it('rejects non-matches and tolerates missing fields', () => {
    expect(matchesMealQuery(meal, 'pasta')).toBe(false);
    expect(matchesMealQuery({ name: 'Soup' }, 'x')).toBe(false);
  });
});
