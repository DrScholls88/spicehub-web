// Ad-hoc, throwaway verification for the db.js v28 migration (Phase 3.4.1
// bar tag system). Not part of the permanent suite — copied into
// src/__tests__/ only for this one run, then deleted.
import { describe, it, expect } from 'vitest';
import db, { getUserTags, addUserTag, setDrinkTags, bulkSetDrinkTags, deleteUserTag, renameUserTag } from '../db';

describe('v28 migration — bar tag system', () => {
  it('opens cleanly at version 28 and seeds 7 drink-domain default tags', async () => {
    await db.open();
    expect(db.verno).toBe(28);
    const drinkTags = await getUserTags('drink');
    expect(drinkTags.length).toBe(7);
    expect(drinkTags.map(t => t.name).sort()).toEqual(
      ['Batch', 'Brunch', 'Crowd-pleaser', 'Low-ABV', 'Nightcap', 'Summer', 'Zero-Proof'].sort()
    );
  });

  it('meal-domain tags are untouched and still default to domain meal', async () => {
    const mealTags = await getUserTags(); // default domain = 'meal'
    expect(mealTags.length).toBeGreaterThan(0);
    expect(mealTags.every(t => (t.domain || 'meal') === 'meal')).toBe(true);
  });

  it('same tag name can exist once per domain without collision', async () => {
    const mealId = await addUserTag({ name: 'Brunch', color: '#111', domain: 'meal' });
    expect(mealId).toBeTruthy();
    const mealTags = await getUserTags('meal');
    const drinkTags = await getUserTags('drink');
    expect(mealTags.some(t => t.name === 'Brunch')).toBe(true);
    expect(drinkTags.some(t => t.name === 'Brunch')).toBe(true);
    // they are two distinct rows
    const mealBrunch = mealTags.find(t => t.name === 'Brunch');
    const drinkBrunch = drinkTags.find(t => t.name === 'Brunch');
    expect(mealBrunch.id).not.toBe(drinkBrunch.id);
  });

  it('setDrinkTags / bulkSetDrinkTags write to the new drinks.tags index', async () => {
    const drinkId = await db.drinks.add({ name: 'Test Cocktail', profileId: 'p1', tags: [] });
    await setDrinkTags(drinkId, ['Nightcap']);
    let row = await db.drinks.get(drinkId);
    expect(row.tags).toEqual(['Nightcap']);

    await bulkSetDrinkTags([drinkId], 'Summer', true);
    row = await db.drinks.get(drinkId);
    expect(row.tags.sort()).toEqual(['Nightcap', 'Summer'].sort());

    // multi-entry index actually queryable
    const found = await db.drinks.where('tags').equals('Summer').toArray();
    expect(found.some(d => d.id === drinkId)).toBe(true);
  });

  it('deleteUserTag only strips the tag from its own domain table', async () => {
    const drinkTags = await getUserTags('drink');
    const nightcap = drinkTags.find(t => t.name === 'Nightcap');
    const drinkId = (await db.drinks.where('tags').equals('Nightcap').toArray())[0].id;

    await deleteUserTag(nightcap.id);
    const row = await db.drinks.get(drinkId);
    expect(row.tags).not.toContain('Nightcap');

    const remaining = await getUserTags('drink');
    expect(remaining.some(t => t.name === 'Nightcap')).toBe(false);
  });

  it('renameUserTag renames within the drink domain and on tagged drinks', async () => {
    const drinkTags = await getUserTags('drink');
    const summer = drinkTags.find(t => t.name === 'Summer');
    await renameUserTag(summer.id, 'Poolside');
    const renamed = await getUserTags('drink');
    expect(renamed.some(t => t.name === 'Poolside')).toBe(true);
    expect(renamed.some(t => t.name === 'Summer')).toBe(false);

    const found = await db.drinks.where('tags').equals('Poolside').toArray();
    expect(found.length).toBeGreaterThan(0);
  });
});
