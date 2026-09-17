/**
 * Profile management — local-first, single profile per device (v1).
 * See spec Section 1 + Section 3.
 */
import db from '../db';

/**
 * Same default profile shape the v22 Dexie `.upgrade()` callback creates
 * (see db.js `db.version(22)`). That callback only runs when an *existing*
 * IndexedDB is migrated forward through v22 — a brand-new install (fresh
 * iPad PWA, a wipe/reinstall, private browsing) opens the DB directly at
 * the current schema version and never fires it, so `profiles` stays empty
 * forever unless something else seeds it. This is that something else.
 */
async function createDefaultProfile() {
  const now = new Date().toISOString();

  // Mirror the v22 upgrade's one-time localStorage migration, in case this
  // is a reinstall on a device that still has the old key lying around.
  let dietaryPref = null;
  try {
    const raw = localStorage.getItem('spicehub_dietary_pref');
    if (raw) dietaryPref = JSON.parse(raw);
  } catch { /* ignore */ }

  const profile = {
    id: crypto.randomUUID(),
    displayName: 'Me',
    supabaseUid: undefined,
    homeGroupId: undefined,
    dietaryPref: dietaryPref || { dietary: '', mode: 'require' },
    createdAt: now,
    updatedAt: now,
  };

  await db.profiles.add(profile);

  try { localStorage.removeItem('spicehub_dietary_pref'); } catch { /* ignore */ }

  return profile;
}

/**
 * Get the current (default) local profile, seeding a default one first if
 * this device's `profiles` table is empty (see createDefaultProfile above).
 * Wrapped in a transaction so two callers racing on first-ever load (e.g.
 * two screens mounting at once) can't both insert a profile row.
 */
export async function ensureProfile() {
  return db.transaction('rw', db.profiles, async () => {
    const existing = await db.profiles.toArray();
    if (existing.length > 0) return existing[0];
    return createDefaultProfile();
  });
}

/**
 * Get the current (default) local profile.
 * Backed by ensureProfile() — this used to return null when the v22
 * migration hadn't run yet (fresh installs never ran it), which broke
 * anything that depended on a profile existing, e.g. saving a shared
 * recipe on a new device. Now it always returns a profile.
 */
export async function getProfile() {
  return ensureProfile();
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
