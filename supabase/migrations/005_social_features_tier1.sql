-- SpiceHub Phase 2 Tier 1 + Activity Feed: What's Cooking status, expanded
-- reactions, "Want to Try" bookmarks, and a friend activity feed RPC.
-- Run via Supabase Dashboard > SQL Editor or `supabase db push`
-- See docs/superpowers/specs/2026-07-30-friends-direct-share-design.md and
-- FriendsBrainstorm.md (2026-08-05 critique + brainstorm) for design context.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. "WHAT'S COOKING?" STATUS — profiles.current_status
-- ══════════════════════════════════════════════════════════════════════════════

-- Ambient one-tap status: { emoji, recipeName, itemType, setAt }. Decay (4h)
-- is computed client-side from setAt — no cron needed. Size-capped to stop
-- abuse (same defensive pattern as recipe_shares' pg_column_size guard).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS current_status jsonb DEFAULT NULL
    CHECK (current_status IS NULL OR pg_column_size(current_status) < 2000);

-- Writes go through the existing "update_own_profile" RLS policy + the
-- profiles GRANT from 004 — no new RPC needed, matches how displayName/
-- avatar/searchable are already updated client-side in cloudProfile.js.

-- get_friends must now surface current_status for each friend row. Column
-- set is changing, so CREATE OR REPLACE isn't enough — Postgres requires a
-- DROP when a function's OUT columns change.
DROP FUNCTION IF EXISTS public.get_friends(text);

CREATE FUNCTION public.get_friends(for_status text DEFAULT 'accepted')
RETURNS TABLE (
  friendship_id uuid,
  friend_id uuid,
  username text,
  display_name text,
  avatar_id text,
  status text,
  created_at timestamptz,
  current_status jsonb
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT f.id, p.user_id, p.username, p.display_name, p.avatar_id, f.status, f.created_at, p.current_status
  FROM friendships f
  JOIN profiles p ON p.user_id = CASE
    WHEN f.requester_id = auth.uid() THEN f.addressee_id
    ELSE f.requester_id
  END
  WHERE (f.requester_id = auth.uid() OR f.addressee_id = auth.uid())
    AND f.status = for_status
    AND (
      for_status <> 'blocked' OR f.requester_id = auth.uid()
    )
  ORDER BY p.display_name;
$$;

REVOKE ALL ON FUNCTION public.get_friends(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_friends(text) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. REACTION PALETTE EXPANSION — recipe_shares.reaction
-- ══════════════════════════════════════════════════════════════════════════════

-- Was ('❤️','🔥','😋','👨‍🍳','🤤','👍') as of 003_share_reactions.sql.
-- Adding 💯 and 🎉. Must match SHARE_REACTIONS in src/lib/recipeShare.js
-- exactly, or the client will offer a reaction the server rejects.
ALTER TABLE public.recipe_shares
  DROP CONSTRAINT IF EXISTS recipe_shares_reaction_check;

ALTER TABLE public.recipe_shares
  ADD CONSTRAINT recipe_shares_reaction_check
    CHECK (
      reaction IS NULL
      OR reaction IN ('❤️', '🔥', '😋', '👨‍🍳', '🤤', '👍', '💯', '🎉')
    );

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. "WANT TO TRY" BOOKMARK — recipe_shares.status
-- ══════════════════════════════════════════════════════════════════════════════

-- Was ('pending','saved','dismissed') as of 002_friends_direct_share.sql.
-- Adding 'bookmarked': recipient wants to keep it visible in a "Try Soon"
-- list without fully importing it into their library yet.
ALTER TABLE public.recipe_shares
  DROP CONSTRAINT IF EXISTS recipe_shares_status_check;

ALTER TABLE public.recipe_shares
  ADD CONSTRAINT recipe_shares_status_check
    CHECK (status IN ('pending', 'saved', 'dismissed', 'bookmarked'));

-- update_as_recipient's WITH CHECK must allow the new status value too, or
-- the recipient's own UPDATE gets silently rejected by RLS.
DROP POLICY IF EXISTS "update_as_recipient" ON public.recipe_shares;

CREATE POLICY "update_as_recipient"
  ON public.recipe_shares FOR UPDATE TO authenticated
  USING (to_user_id = auth.uid())
  WITH CHECK (status IN ('saved', 'dismissed', 'bookmarked'));

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. FRIEND ACTIVITY FEED — get_friend_activity RPC
-- ══════════════════════════════════════════════════════════════════════════════

-- No new tables: derived from friendships (accepted) + recipe_shares (sent
-- and received), unioned and ordered by time. SECURITY DEFINER, but every
-- branch filters on auth.uid() so a user can only ever see their own edges
-- of the graph — same safety pattern as get_friends/get_pending_requests.
CREATE OR REPLACE FUNCTION public.get_friend_activity(
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  activity_type text,
  occurred_at timestamptz,
  other_user_id uuid,
  other_username text,
  other_display_name text,
  other_avatar_id text,
  item_type text,
  recipe_name text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT activity_type, occurred_at, other_user_id, other_username,
         other_display_name, other_avatar_id, item_type, recipe_name
  FROM (
    SELECT
      'friend_added'::text AS activity_type,
      f.updated_at AS occurred_at,
      CASE WHEN f.requester_id = auth.uid() THEN f.addressee_id ELSE f.requester_id END AS other_user_id,
      p.username AS other_username,
      p.display_name AS other_display_name,
      p.avatar_id AS other_avatar_id,
      NULL::text AS item_type,
      NULL::text AS recipe_name
    FROM friendships f
    JOIN profiles p ON p.user_id = CASE WHEN f.requester_id = auth.uid() THEN f.addressee_id ELSE f.requester_id END
    WHERE f.status = 'accepted'
      AND (f.requester_id = auth.uid() OR f.addressee_id = auth.uid())

    UNION ALL

    SELECT
      'share_sent'::text,
      rs.created_at,
      rs.to_user_id,
      p.username,
      p.display_name,
      p.avatar_id,
      rs.item_type,
      rs.recipe_data->>'name'
    FROM recipe_shares rs
    JOIN profiles p ON p.user_id = rs.to_user_id
    WHERE rs.from_user_id = auth.uid()

    UNION ALL

    SELECT
      'share_received'::text,
      rs.created_at,
      rs.from_user_id,
      p.username,
      p.display_name,
      p.avatar_id,
      rs.item_type,
      rs.recipe_data->>'name'
    FROM recipe_shares rs
    JOIN profiles p ON p.user_id = rs.from_user_id
    WHERE rs.to_user_id = auth.uid()
  ) activity
  ORDER BY occurred_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

REVOKE ALL ON FUNCTION public.get_friend_activity(int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.get_friend_activity(int, int) TO authenticated;
