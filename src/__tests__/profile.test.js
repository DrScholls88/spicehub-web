import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import {
  getProfile, updateProfile, getDietaryPref, saveDietaryPref,
  linkLocalProfile, setHomeGroupId, clearHomeGroup,
} from '../lib/profile';

// Reset Dexie between tests — must close before delete so re-open triggers upgrades.
let db;

beforeEach(async () => {
  const mod = await import('../db.js');
  db = mod.default;
  db.close();
  await Dexie.delete('SpiceHubDB');
  // Next table access auto-opens + runs all upgrades (including v22 profile seed)
});

describe('profile', () => {
  it('v22 migration creates a default profile', async () => {
    const profiles = await db.profiles.toArray();
    expect(profiles.length).toBe(1);
    const p = profiles[0];
    expect(p.displayName).toBe('Me');
    expect(typeof p.id).toBe('string');
    expect(p.id.length).toBe(36); // UUID
    expect(p.supabaseUid).toBeUndefined();
    expect(p.homeGroupId).toBeUndefined();
  });

  it('v22 migration stamps profileId on existing meals', async () => {
    // Add a meal before migration
    await db.meals.add({ name: 'Test Meal', ingredients: ['salt'] });
    const meal = await db.meals.where('name').equals('Test Meal').first();
    expect(typeof meal.profileId).toBe('string');
    expect(meal.profileId.length).toBe(36);
  });
});

describe('profile module', () => {
  it('getProfile returns default profile', async () => {
    const p = await getProfile();
    expect(p).not.toBeNull();
    expect(p.displayName).toBe('Me');
  });

  it('updateProfile updates displayName', async () => {
    const updated = await updateProfile({ displayName: 'Alex' });
    expect(updated.displayName).toBe('Alex');
    const reloaded = await getProfile();
    expect(reloaded.displayName).toBe('Alex');
  });

  it('getDietaryPref returns default', async () => {
    const pref = await getDietaryPref();
    expect(pref).toEqual({ dietary: '', mode: 'require' });
  });

  it('saveDietaryPref persists', async () => {
    await saveDietaryPref({ dietary: 'vegetarian', mode: 'require' });
    const pref = await getDietaryPref();
    expect(pref.dietary).toBe('vegetarian');
  });

  it('linkLocalProfile links supabaseUid', async () => {
    const uid = 'supabase-uid-123';
    const p = await linkLocalProfile(uid);
    expect(p.supabaseUid).toBe(uid);
  });

  it('linkLocalProfile is idempotent for same uid', async () => {
    const uid = 'supabase-uid-123';
    await linkLocalProfile(uid);
    const p = await linkLocalProfile(uid); // no throw
    expect(p.supabaseUid).toBe(uid);
  });

  it('linkLocalProfile throws for different uid', async () => {
    await linkLocalProfile('uid-1');
    await expect(linkLocalProfile('uid-2')).rejects.toThrow('different account');
  });

  it('setHomeGroupId + clearHomeGroup', async () => {
    await setHomeGroupId('group-abc');
    let p = await getProfile();
    expect(p.homeGroupId).toBe('group-abc');

    await clearHomeGroup();
    p = await getProfile();
    expect(p.homeGroupId).toBeUndefined();
  });
});
