-- SpiceHub 006: Custom Avatar Uploads
-- Creates a public 'avatars' Storage bucket with per-user RLS, and adds
-- avatar_url to profiles for custom photo URLs (coexists with avatar_id).
-- Run via Supabase Dashboard > SQL Editor or `supabase db push`.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. STORAGE BUCKET — public 'avatars'
-- ══════════════════════════════════════════════════════════════════════════════

-- Public bucket = files are readable without auth token via the public URL.
-- Saves egress vs signed URLs and lets us cache the URL in Dexie forever
-- (it never expires). File size capped at 500KB — client compresses to
-- ~50-100KB before upload, this is a server-side safety net.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  512000, -- 500KB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ── RLS policies on storage.objects ──────────────────────────────────────────

-- Read: any authenticated user can read any avatar (they're public anyway,
-- but this allows listing via the Storage API if ever needed).
CREATE POLICY "avatars_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');

-- Upload/Upsert: authenticated users can only write to their own folder.
-- Path convention: avatars/{user_id}/avatar.{ext}
-- The (storage.foldername(name))[1] = auth.uid()::text check ensures users
-- can't write into another user's folder.
CREATE POLICY "avatars_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Delete: users can delete their own avatar (to replace it).
CREATE POLICY "avatars_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. PROFILES — avatar_url column
-- ══════════════════════════════════════════════════════════════════════════════

-- Stores the public URL of the user's uploaded avatar photo. When present,
-- takes priority over avatar_id (pixel emoji avatar). Both coexist: the
-- user can clear their photo and fall back to the pixel avatar, or vice versa.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text DEFAULT NULL;

-- Update get_friends to also return avatar_url so friend rows carry it.
DROP FUNCTION IF EXISTS public.get_friends(text);

CREATE FUNCTION public.get_friends(for_status text DEFAULT 'accepted')
RETURNS TABLE (
  friendship_id uuid,
  friend_id uuid,
  username text,
  display_name text,
  avatar_id text,
  avatar_url text,
  status text,
  created_at timestamptz,
  current_status jsonb
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT f.id, p.user_id, p.username, p.display_name, p.avatar_id, p.avatar_url,
         f.status, f.created_at, p.current_status
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

-- Update get_friend_activity to include avatar_url.
DROP FUNCTION IF EXISTS public.get_friend_activity(int, int);

CREATE FUNCTION public.get_friend_activity(
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
  other_avatar_url text,
  item_type text,
  recipe_name text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT activity_type, occurred_at, other_user_id, other_username,
         other_display_name, other_avatar_id, other_avatar_url, item_type, recipe_name
  FROM (
    SELECT
      'friend_added'::text AS activity_type,
      f.updated_at AS occurred_at,
      CASE WHEN f.requester_id = auth.uid() THEN f.addressee_id ELSE f.requester_id END AS other_user_id,
      p.username AS other_username,
      p.display_name AS other_display_name,
      p.avatar_id AS other_avatar_id,
      p.avatar_url AS other_avatar_url,
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
      p.avatar_url,
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
      p.avatar_url,
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

-- Update search_users to also return avatar_url.
DROP FUNCTION IF EXISTS public.search_users(text);

CREATE FUNCTION public.search_users(query text)
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  avatar_id text,
  avatar_url text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.user_id, p.username, p.display_name, p.avatar_id, p.avatar_url
  FROM profiles p
  WHERE p.is_searchable = true
    AND p.username IS NOT NULL
    AND p.username LIKE (query || '%')
    AND p.user_id <> auth.uid()
  ORDER BY p.username
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.search_users(text) FROM public;
GRANT EXECUTE ON FUNCTION public.search_users(text) TO authenticated;
