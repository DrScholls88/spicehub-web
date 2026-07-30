-- SpiceHub Phase 2: Friends & Direct Meal/Drink Share
-- Run via Supabase Dashboard > SQL Editor or `supabase db push`
-- See spec: docs/superpowers/specs/2026-07-30-friends-direct-share-design.md

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. PROFILES
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.profiles (
  user_id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username            text UNIQUE
                        CHECK (
                          username IS NULL OR (
                            username = lower(username)
                            AND username ~ '^[a-z0-9_]{3,20}$'
                          )
                        ),
  display_name        text NOT NULL DEFAULT '',
  avatar_id           text,
  is_searchable       boolean NOT NULL DEFAULT true,
  username_changed_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_username_pattern
  ON public.profiles (username text_pattern_ops);

-- Auto-create a profiles row for every new auth.users signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', '')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_searchable_profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (is_searchable = true AND username IS NOT NULL);

CREATE POLICY "read_own_profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "update_own_profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- No INSERT policy: inserts come from the auth trigger only.

-- ── Username availability check ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_username_available(desired text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    lower(trim(desired)) ~ '^[a-z0-9_]{3,20}$'
    AND lower(trim(desired)) NOT IN (
      'admin', 'support', 'spicehub', 'null', 'system', 'mod', 'moderator',
      'help', 'info', 'abuse', 'postmaster', 'webmaster', 'root', 'test'
    )
    AND NOT EXISTS (
      SELECT 1 FROM profiles WHERE username = lower(trim(desired))
    );
$$;

REVOKE ALL ON FUNCTION public.check_username_available(text) FROM public;
GRANT EXECUTE ON FUNCTION public.check_username_available(text) TO authenticated;

-- ── User search ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.search_users(query text)
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  avatar_id text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.user_id, p.username, p.display_name, p.avatar_id
  FROM public.profiles p
  WHERE p.is_searchable = true
    AND p.username IS NOT NULL
    AND p.user_id <> auth.uid()
    AND length(trim(query)) >= 3
    AND p.username ILIKE lower(trim(query)) || '%'
    AND NOT EXISTS (
      SELECT 1 FROM friendships f
      WHERE f.status = 'blocked'
        AND (
          (f.requester_id = auth.uid() AND f.addressee_id = p.user_id)
          OR (f.requester_id = p.user_id AND f.addressee_id = auth.uid())
        )
    )
  ORDER BY
    CASE WHEN p.username = lower(trim(query)) THEN 0 ELSE 1 END,
    p.username
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.search_users(text) FROM public;
GRANT EXECUTE ON FUNCTION public.search_users(text) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. FRIENDSHIPS
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.friendships (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (requester_id <> addressee_id),
  UNIQUE (requester_id, addressee_id)
);

-- One row per unordered pair at DB level
CREATE UNIQUE INDEX idx_friendships_pair_canonical
  ON public.friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));

CREATE INDEX idx_friendships_addressee ON public.friendships (addressee_id, status);
CREATE INDEX idx_friendships_requester ON public.friendships (requester_id, status);

-- RLS: SELECT only — all mutations go through SECURITY DEFINER RPCs
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_own_friendships"
  ON public.friendships FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());

-- ── Query RPCs ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_friends(for_status text DEFAULT 'accepted')
RETURNS TABLE (
  friendship_id uuid,
  friend_id uuid,
  username text,
  display_name text,
  avatar_id text,
  status text,
  created_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT f.id, p.user_id, p.username, p.display_name, p.avatar_id, f.status, f.created_at
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

CREATE OR REPLACE FUNCTION public.get_pending_requests()
RETURNS TABLE (
  friendship_id uuid,
  from_user_id uuid,
  username text,
  display_name text,
  avatar_id text,
  created_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT f.id, f.requester_id, p.username, p.display_name, p.avatar_id, f.created_at
  FROM friendships f
  JOIN profiles p ON p.user_id = f.requester_id
  WHERE f.addressee_id = auth.uid()
    AND f.status = 'pending'
  ORDER BY f.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_pending_requests() FROM public;
GRANT EXECUTE ON FUNCTION public.get_pending_requests() TO authenticated;

-- ── Mutation RPCs ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.send_friend_request(to_user uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_my_username text;
BEGIN
  -- Must have a username set
  SELECT username INTO v_my_username FROM profiles WHERE user_id = auth.uid();
  IF v_my_username IS NULL THEN
    RAISE EXCEPTION 'Set a username before adding friends';
  END IF;

  -- Target must have a username
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = to_user AND username IS NOT NULL) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Cannot friend yourself (belt + suspenders with CHECK constraint)
  IF to_user = auth.uid() THEN
    RAISE EXCEPTION 'Cannot send a friend request to yourself';
  END IF;

  -- Check for block in either direction
  IF EXISTS (
    SELECT 1 FROM friendships
    WHERE status = 'blocked'
      AND (
        (requester_id = auth.uid() AND addressee_id = to_user)
        OR (requester_id = to_user AND addressee_id = auth.uid())
      )
  ) THEN
    RAISE EXCEPTION 'Cannot send request to this user';
  END IF;

  -- Check for existing row in either direction
  IF EXISTS (
    SELECT 1 FROM friendships
    WHERE (requester_id = auth.uid() AND addressee_id = to_user)
       OR (requester_id = to_user AND addressee_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'A request already exists with this user';
  END IF;

  -- Rate limit: 20/hour
  IF (
    SELECT count(*) FROM friendships
    WHERE requester_id = auth.uid()
      AND created_at > now() - interval '1 hour'
  ) >= 20 THEN
    RAISE EXCEPTION 'Too many friend requests. Try again later.';
  END IF;

  INSERT INTO friendships (requester_id, addressee_id, status)
  VALUES (auth.uid(), to_user, 'pending')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.send_friend_request(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.send_friend_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_friend_request(p_friendship_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE friendships
  SET status = 'accepted', updated_at = now()
  WHERE id = p_friendship_id
    AND addressee_id = auth.uid()
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Friend request not found or already handled';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_friend_request(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_friend_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.decline_friend_request(p_friendship_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM friendships
  WHERE id = p_friendship_id
    AND addressee_id = auth.uid()
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Friend request not found or already handled';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.decline_friend_request(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.decline_friend_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_friend_request(p_friendship_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM friendships
  WHERE id = p_friendship_id
    AND requester_id = auth.uid()
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Friend request not found or already handled';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_friend_request(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.cancel_friend_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.unfriend(p_friendship_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM friendships
  WHERE id = p_friendship_id
    AND status = 'accepted'
    AND (requester_id = auth.uid() OR addressee_id = auth.uid());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Friendship not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.unfriend(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.unfriend(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.block_user(target uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF target = auth.uid() THEN
    RAISE EXCEPTION 'Cannot block yourself';
  END IF;

  -- Delete any existing friendship row between the pair
  DELETE FROM friendships
  WHERE (requester_id = auth.uid() AND addressee_id = target)
     OR (requester_id = target AND addressee_id = auth.uid());

  -- Insert block row (me as requester = I'm the blocker)
  INSERT INTO friendships (requester_id, addressee_id, status)
  VALUES (auth.uid(), target, 'blocked')
  ON CONFLICT (requester_id, addressee_id) DO UPDATE
    SET status = 'blocked', updated_at = now();

  -- Auto-dismiss pending recipe shares in both directions
  UPDATE recipe_shares
  SET status = 'dismissed'
  WHERE status = 'pending'
    AND (
      (from_user_id = target AND to_user_id = auth.uid())
      OR (from_user_id = auth.uid() AND to_user_id = target)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.block_user(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.block_user(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.unblock_user(target uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM friendships
  WHERE requester_id = auth.uid()
    AND addressee_id = target
    AND status = 'blocked';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Block not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.unblock_user(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.unblock_user(uuid) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. RECIPE SHARES
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.recipe_shares (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_type      text NOT NULL DEFAULT 'meal'
                   CHECK (item_type IN ('meal', 'drink')),
  recipe_data    jsonb NOT NULL,
  note           text DEFAULT ''
                   CHECK (length(note) <= 280),
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'saved', 'dismissed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (from_user_id <> to_user_id)
);

CREATE INDEX idx_recipe_shares_to_user ON public.recipe_shares (to_user_id, status);
CREATE INDEX idx_recipe_shares_from_user ON public.recipe_shares (from_user_id, created_at DESC);

-- RLS
ALTER TABLE public.recipe_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_own_shares"
  ON public.recipe_shares FOR SELECT TO authenticated
  USING (from_user_id = auth.uid() OR to_user_id = auth.uid());

CREATE POLICY "update_as_recipient"
  ON public.recipe_shares FOR UPDATE TO authenticated
  USING (to_user_id = auth.uid())
  WITH CHECK (status IN ('saved', 'dismissed'));

-- No INSERT policy: inserts only via send_recipe_share RPC.

-- ── Send recipe share RPC ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.send_recipe_share(
  p_to_user_id uuid,
  p_item_type text,
  p_recipe_data jsonb,
  p_note text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  share_id uuid;
  v_username text;
  v_display_name text;
BEGIN
  -- Validate item_type
  IF p_item_type NOT IN ('meal', 'drink') THEN
    RAISE EXCEPTION 'Invalid item type';
  END IF;

  -- Validate recipe_data has a name
  IF NOT (p_recipe_data ? 'name')
     OR length(trim(p_recipe_data->>'name')) = 0 THEN
    RAISE EXCEPTION 'Recipe must have a name';
  END IF;

  -- Cap payload size (~100 KB)
  IF pg_column_size(p_recipe_data) > 100000 THEN
    RAISE EXCEPTION 'Recipe data too large';
  END IF;

  -- Validate note length
  IF length(p_note) > 280 THEN
    RAISE EXCEPTION 'Note too long (max 280 characters)';
  END IF;

  -- Cannot share with yourself
  IF p_to_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot share with yourself';
  END IF;

  -- Must be friends (accepted)
  IF NOT EXISTS (
    SELECT 1 FROM friendships
    WHERE status = 'accepted'
      AND (
        (requester_id = auth.uid() AND addressee_id = p_to_user_id)
        OR (requester_id = p_to_user_id AND addressee_id = auth.uid())
      )
  ) THEN
    RAISE EXCEPTION 'Not friends with this user';
  END IF;

  -- Rate limit: max 50 shares per user per day
  IF (
    SELECT count(*) FROM recipe_shares
    WHERE from_user_id = auth.uid()
      AND created_at > now() - interval '1 day'
  ) >= 50 THEN
    RAISE EXCEPTION 'Share limit reached. Try again tomorrow.';
  END IF;

  -- Server-side attribution (never trust client)
  SELECT username, display_name INTO v_username, v_display_name
  FROM profiles WHERE user_id = auth.uid();

  p_recipe_data := p_recipe_data
    - 'from_username'
    - 'from_display_name'
    || jsonb_build_object(
         'from_username', COALESCE(v_username, ''),
         'from_display_name', COALESCE(v_display_name, '')
       );

  INSERT INTO recipe_shares (from_user_id, to_user_id, item_type, recipe_data, note)
  VALUES (auth.uid(), p_to_user_id, p_item_type, p_recipe_data, p_note)
  RETURNING id INTO share_id;

  RETURN share_id;
END;
$$;

REVOKE ALL ON FUNCTION public.send_recipe_share(uuid, text, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.send_recipe_share(uuid, text, jsonb, text) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. REALTIME PUBLICATION
-- ══════════════════════════════════════════════════════════════════════════════

ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;
ALTER PUBLICATION supabase_realtime ADD TABLE public.recipe_shares;
