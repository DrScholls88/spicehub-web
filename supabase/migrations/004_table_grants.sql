-- ══════════════════════════════════════════════════════════════════
-- 004_table_grants.sql
-- Missing table-level GRANTs for authenticated role.
-- RLS policies control WHICH rows; GRANTs control WHETHER the role
-- can touch the table at all. Without these, direct .from() queries
-- from @supabase/supabase-js fail with "permission denied for table".
-- SECURITY DEFINER RPCs were unaffected (they run as owner).
-- ══════════════════════════════════════════════════════════════════

-- ── 001 tables (Home Group) ────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.home_groups            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.home_group_members     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_week_plan       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_grocery_items   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_recipe_transfers TO authenticated;

-- ── 002 tables (Friends + Shares) ──────────────────────────────────
GRANT SELECT, UPDATE                ON public.profiles                TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friendships            TO authenticated;
GRANT SELECT, INSERT, UPDATE        ON public.recipe_shares           TO authenticated;
