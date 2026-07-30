/**
 * Home Group operations — create, join, leave, invite code management.
 * See spec Section 2 + Section 5.
 */
import db from '../db';
import { getSupabase, getCurrentUserId } from './supabaseClient';
import { getProfile, setHomeGroupId, clearHomeGroup } from './profile';
import { enqueueSync, discardQueueForGroup, fullFetch, drainQueue,
         subscribeRealtime, unsubscribeRealtime } from './sharedSync';
import { toSlotData } from './slotMapper';
import { toCloudGrocery } from './groceryMapper';
import { loadWeekPlan } from '../db';

/**
 * Generate a 6-character uppercase alphanumeric invite code.
 */
export function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 for readability
  let code = '';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * Create a new home group. Owner is the current user.
 * Bootstraps shared state from local week plan + grocery list.
 */
export async function createGroup(name = 'Our Kitchen') {
  const supabase = getSupabase();
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Must be signed in to create a group');

  const profile = await getProfile();
  const inviteCode = generateInviteCode();

  // 1. Create group
  const { data: group, error: groupErr } = await supabase
    .from('home_groups')
    .insert({
      name,
      invite_code: inviteCode,
      created_by: userId,
    })
    .select()
    .single();

  if (groupErr) throw groupErr;

  // 2. Add self as owner
  const { error: memberErr } = await supabase
    .from('home_group_members')
    .insert({
      home_group_id: group.id,
      user_id: userId,
      display_name: profile.displayName,
      avatar: profile.avatar || null,
      role: 'owner',
    });

  if (memberErr) throw memberErr;

  // 3. Update local profile
  await setHomeGroupId(group.id);

  // 4. Bootstrap: push current local plan + grocery as initial shared state
  await bootstrapSharedState(group.id, userId, profile.displayName);

  return { groupId: group.id, inviteCode, name: group.name };
}

/**
 * Push local week plan + grocery as initial shared state on group creation.
 */
async function bootstrapSharedState(groupId, userId, profileName) {
  const supabase = getSupabase();

  // Week plan
  const localPlan = await loadWeekPlan();
  if (localPlan) {
    const rows = [];
    for (let i = 0; i < localPlan.length; i++) {
      const slotData = toSlotData(localPlan[i], profileName);
      if (!slotData) continue;
      rows.push({
        home_group_id: groupId,
        day_index: i,
        slot: 'dinner',
        slot_data: slotData,
        updated_by: userId,
      });
    }
    if (rows.length > 0) {
      await supabase.from('shared_week_plan').upsert(rows, {
        onConflict: 'home_group_id,day_index,slot',
      });
    }
  }

  // Grocery list
  const localGrocery = await db.groceryItems.toArray();
  if (localGrocery.length > 0) {
    const groceryRows = localGrocery.map((item, idx) => {
      const cloud = toCloudGrocery(item, groupId, userId);
      // Save cloudId back to local
      if (cloud._generatedCloudId) {
        db.groceryItems.update(item.id, { cloudId: cloud._generatedCloudId });
      }
      const { _generatedCloudId, ...row } = cloud;
      return { ...row, sort_order: idx };
    });
    await supabase.from('shared_grocery_items').upsert(groceryRows);
  }
}

/**
 * Join a group via invite code (calls the rate-limited Edge Function).
 */
export async function joinGroup(inviteCode) {
  const supabase = getSupabase();
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error('Must be signed in to join a group');

  const profile = await getProfile();

  const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/join-group`;
  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      invite_code: inviteCode.toUpperCase().trim(),
      display_name: profile.displayName,
      avatar: profile.avatar || null,
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Failed to join group');
  }

  // Update local profile
  await setHomeGroupId(result.home_group_id);

  return { groupId: result.home_group_id, name: result.name };
}

/**
 * Leave the current home group.
 * Tears down Realtime, discards queue, clears local group reference.
 * Local snapshot of shared data is kept as read-only.
 */
export async function leaveGroup() {
  const profile = await getProfile();
  if (!profile.homeGroupId) return;

  const homeGroupId = profile.homeGroupId;

  // 1. Tear down Realtime
  unsubscribeRealtime();

  // 2. Discard pending sync queue
  await discardQueueForGroup(homeGroupId);

  // 3. Remove membership from Supabase (if online)
  try {
    const supabase = getSupabase();
    const userId = await getCurrentUserId();
    if (userId) {
      // Check if sole owner
      const { data: members } = await supabase
        .from('home_group_members')
        .select('user_id, role')
        .eq('home_group_id', homeGroupId);

      const owners = (members || []).filter(m => m.role === 'owner');
      if (owners.length === 1 && owners[0].user_id === userId && members.length > 1) {
        throw new Error(
          'You are the only owner. Transfer ownership to another member before leaving, or delete the group.'
        );
      }

      await supabase
        .from('home_group_members')
        .delete()
        .eq('home_group_id', homeGroupId)
        .eq('user_id', userId);

      // If last member, delete the group entirely
      if (members && members.length <= 1) {
        await supabase.from('home_groups').delete().eq('id', homeGroupId);
      }
    }
  } catch (err) {
    // If offline or error, we still clear locally — the membership row
    // will be orphaned on the server but RLS prevents access anyway
    if (err.message?.includes('only owner')) throw err;
    console.warn('[HomeGroup] leaveGroup remote cleanup failed:', err);
  }

  // 4. Clear local profile
  await clearHomeGroup();
  await db.sharedMeta.delete(homeGroupId);
}

/**
 * Regenerate invite code for the current group (owner only).
 */
export async function regenerateInviteCode() {
  const profile = await getProfile();
  if (!profile.homeGroupId) throw new Error('Not in a group');

  const newCode = generateInviteCode();
  const supabase = getSupabase();

  const { error } = await supabase
    .from('home_groups')
    .update({ invite_code: newCode, invite_code_uses: 0 })
    .eq('id', profile.homeGroupId);

  if (error) throw error;
  return newCode;
}

/**
 * Get current group info + member list.
 */
export async function getGroupInfo() {
  const profile = await getProfile();
  if (!profile.homeGroupId) return null;

  const supabase = getSupabase();

  const { data: group } = await supabase
    .from('home_groups')
    .select('*')
    .eq('id', profile.homeGroupId)
    .single();

  const { data: members } = await supabase
    .from('home_group_members')
    .select('*')
    .eq('home_group_id', profile.homeGroupId);

  return { group, members: members || [] };
}

/**
 * Share a full recipe (for manually-created recipes without source_url).
 * Writes to shared_recipe_transfers table.
 */
export async function shareFullRecipe(mealId, toUserId = null) {
  const profile = await getProfile();
  if (!profile.homeGroupId) throw new Error('Not in a group');

  const meal = await db.meals.get(mealId);
  if (!meal) throw new Error('Meal not found');

  // Strip private fields
  const { id, cookCount, lastCooked, profileId, ...recipeData } = meal;

  const supabase = getSupabase();
  const userId = await getCurrentUserId();

  const { error } = await supabase
    .from('shared_recipe_transfers')
    .insert({
      home_group_id: profile.homeGroupId,
      recipe_data: recipeData,
      from_user: userId,
      to_user: toUserId,
    });

  if (error) throw error;
}

/**
 * Claim a shared recipe transfer — save to local library.
 */
export async function claimRecipeTransfer(transferId) {
  const supabase = getSupabase();

  const { data: transfer, error: fetchErr } = await supabase
    .from('shared_recipe_transfers')
    .select('*')
    .eq('id', transferId)
    .single();

  if (fetchErr) throw fetchErr;
  if (!transfer) throw new Error('Transfer not found');

  // Save to local library
  const profile = await getProfile();
  const newMeal = {
    ...transfer.recipe_data,
    profileId: profile.id,
    importedAt: new Date().toISOString(),
    _sharedFrom: transfer.from_user,
  };

  await db.meals.add(newMeal);

  // Mark as claimed and delete
  await supabase
    .from('shared_recipe_transfers')
    .delete()
    .eq('id', transferId);
}
