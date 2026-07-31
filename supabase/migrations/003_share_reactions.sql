-- SpiceHub Phase 2 Tier 1: Emoji reactions on shared recipes
-- Run via Supabase Dashboard > SQL Editor or `supabase db push`

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. ADD REACTION COLUMN TO recipe_shares
-- ══════════════════════════════════════════════════════════════════════════════

-- Nullable text column holding a single emoji reaction from the recipient.
-- Constrained to a small allowlist to prevent abuse / large payloads.
ALTER TABLE public.recipe_shares
  ADD COLUMN IF NOT EXISTS reaction text DEFAULT NULL
    CHECK (
      reaction IS NULL
      OR reaction IN ('❤️', '🔥', '😋', '👨‍🍳', '🤤', '👍')
    );

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. RPC: react_to_share  (recipient only)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.react_to_share(
  p_share_id uuid,
  p_reaction text  -- NULL to remove reaction
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only the recipient may react
  UPDATE recipe_shares
  SET reaction = p_reaction
  WHERE id = p_share_id
    AND to_user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Share not found or not yours';
  END IF;
END;
$$;
