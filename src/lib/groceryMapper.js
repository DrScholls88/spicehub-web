/**
 * Grocery item mappers — local Dexie ↔ Supabase shared_grocery_items.
 * Pure functions, no side effects.
 * See spec Section 4: "Grocery field mapping"
 */

/**
 * Local grocery item → Supabase shared_grocery_items row.
 * If item has no cloudId, generates one and signals caller via _generatedCloudId.
 */
export function toCloudGrocery(local, homeGroupId, userId) {
  let cloudId = local.cloudId;
  let generated = false;

  if (!cloudId) {
    cloudId = crypto.randomUUID();
    generated = true;
  }

  const row = {
    id: cloudId,
    home_group_id: homeGroupId,
    name: local.name,
    checked: !!(local.checked ?? local.isChecked),
    store: local.store || '',
    quantity: local.quantity || '',
    unit: local.unit || '',
    sort_order: local.sortOrder ?? 0,
    added_by: userId,
  };

  // Signal caller to write cloudId back to local Dexie record
  if (generated) {
    row._generatedCloudId = cloudId;
  }

  return row;
}

/**
 * Supabase shared_grocery_items row → local Dexie grocery item.
 */
export function fromCloudGrocery(cloud) {
  return {
    cloudId: cloud.id,
    name: cloud.name,
    checked: cloud.checked,
    store: cloud.store || '',
    quantity: cloud.quantity || '',
    unit: cloud.unit || '',
    sortOrder: cloud.sort_order ?? 0,
    _addedBy: cloud.added_by,
    _checkedBy: cloud.checked_by,
    _updatedAt: cloud.updated_at,
  };
}
