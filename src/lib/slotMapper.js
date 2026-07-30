/**
 * Week-plan slot mappers — local Dexie ↔ Supabase shared_week_plan.
 * Pure functions, no side effects.
 * See spec Section 4: "Week-plan mapper (local ↔ cloud)"
 */

// Special day tag icons — must match SPECIAL_DAYS in App.jsx
const SPECIAL_TAG_ICONS = {
  '__eat_out__': '🍽️',
  '__leftovers__': '📦',
  '__dealers_choice__': '🎲',
  '__pizza__': '🍕',
  '__grill__': '🔥',
  '__tacos__': '🌮',
  '__nachos__': '🧀',
  '__pasta__': '🍝',
  '__soup__': '🍲',
  '__sandwiches__': '🥪',
  '__salad__': '🥗',
  '__breakfast__': '🥞',
  '__skip__': '⏭️',
};

/**
 * Returns true if the URL is a public HTTP(S) URL safe to share.
 * Rejects data:, blob:, empty, null, undefined.
 */
export function isPublicUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * Local weekPlan slot → Supabase slot_data JSONB.
 * @param {object|null} localSlot - meal object, special-day object, or null
 * @param {string} profileName - display name of the profile making the assignment
 * @returns {object|null} slot_data payload, or null for empty slots (no row created)
 */
export function toSlotData(localSlot, profileName) {
  if (!localSlot) return null;

  // Special day tag (id starts with __)
  if (localSlot.id && typeof localSlot.id === 'string' && localSlot.id.startsWith('__')) {
    return {
      name: localSlot.name,
      ingredients: [],
      source_profile_name: profileName,
      is_special: true,
      special_tag: localSlot.id,
    };
  }

  // Real meal
  return {
    name: localSlot.name,
    imageUrl: isPublicUrl(localSlot.imageUrl) ? localSlot.imageUrl : undefined,
    ingredients: (localSlot.ingredients || []).map(i =>
      typeof i === 'string' ? i : (i && i.name) || ''
    ),
    servings: localSlot.servings,
    source_url: localSlot.link || undefined,
    source_profile_name: profileName,
    source_profile_id: localSlot.profileId,
    is_special: false,
  };
}

/**
 * Supabase shared_week_plan row → local weekPlan slot.
 * @param {object} row - Supabase row with slot_data, updated_by, updated_at
 * @returns {object} local slot object
 */
export function fromSlotData(row) {
  const d = row.slot_data;

  if (d.is_special) {
    return {
      id: d.special_tag,
      name: d.name,
      icon: SPECIAL_TAG_ICONS[d.special_tag] || '🏷️',
    };
  }

  return {
    name: d.name,
    imageUrl: d.imageUrl,
    ingredients: d.ingredients,
    servings: d.servings,
    link: d.source_url,
    _sharedBy: d.source_profile_name,
    _updatedBy: row.updated_by,
    _updatedAt: row.updated_at,
    _isSharedSlot: true,
  };
}

export { SPECIAL_TAG_ICONS };
