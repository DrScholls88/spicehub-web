/**
 * Profile management — local-first, single profile per device (v1).
 * See spec Section 1 + Section 3.
 */
import db from '../db';

/**
 * Get the current (default) local profile.
 * Returns null only if migration hasn't run yet (should never happen in practice).
 */
export async function getProfile() {
  const profiles = await db.profiles.toArray();
  return profiles[0] || null;
}

/**
 * Update profile fields (partial update).
 */
export async function updateProfile(fields) {
  const profile = await getProfile();
  if (!profile) throw new Error('No local profile found');
  const updated = {
    ...fields,
    updatedAt: new Date().toISOString(),
  };
  await db.profiles.update(profile.id, updated);
  return { ...profile, ...updated };
}

/**
 * Get dietary preference from profile (replaces localStorage read).
 */
export async function getDietaryPref() {
  const profile = await getProfile();
  return profile?.dietaryPref || { dietary: '', mode: 'require' };
}

/**
 * Save dietary preference to profile (replaces localStorage write).
 */
export async function saveDietaryPref(pref) {
  return updateProfile({ dietaryPref: pref });
}

/**
 * Link local profile to a Supabase user ID.
 * Idempotent — no-op if already linked to the same user.
 * Throws if linked to a DIFFERENT user (requires explicit switch).
 */
export async function linkLocalProfile(supabaseUid) {
  const profile = await getProfile();
  if (!profile) throw new Error('No local profile found');

  if (profile.supabaseUid === supabaseUid) return profile; // already linked
  if (profile.supabaseUid && profile.supabaseUid !== supabaseUid) {
    throw new Error(
      'Profile already linked to a different account. Use "Switch Account" to change.'
    );
  }

  return updateProfile({ supabaseUid });
}

/**
 * Set the home group ID on the local profile.
 */
export async function setHomeGroupId(homeGroupId) {
  return updateProfile({ homeGroupId: homeGroupId || undefined });
}

/**
 * Clear home group association (on leave/sign-out).
 * Does NOT clear supabaseUid — keeps it for faster re-sign-in.
 */
export async function clearHomeGroup() {
  return updateProfile({ homeGroupId: undefined });
}
