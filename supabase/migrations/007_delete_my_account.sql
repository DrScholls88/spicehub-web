-- SpiceHub 007: in-app account deletion
-- Required by App Store Review Guideline 5.1.1(v) and Google Play's account
-- deletion policy, because SpiceHub lets people create an (optional) account.
-- Called from Settings > Delete account (src/lib/supabaseClient.js
-- deleteMyAccount), which removes the avatar file through the Storage API
-- first, since storage objects should not be deleted with SQL.
--
-- Deletes the caller's auth user. profiles, friendships and recipe_shares
-- cascade from auth.users. Household rows the person authored stay for the
-- rest of the household with the author cleared; a household they were the
-- last member of is deleted with its shared plan, grocery list and transfers.
-- Run via Supabase Dashboard > SQL Editor or `supabase db push`.

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  g record;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not signed in';
  END IF;

  FOR g IN SELECT home_group_id, role FROM public.home_group_members WHERE user_id = uid LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.home_group_members
      WHERE home_group_id = g.home_group_id AND user_id <> uid
    ) THEN
      -- Last member: the group goes, and its shared plan/grocery/transfers cascade.
      DELETE FROM public.home_groups WHERE id = g.home_group_id;
    ELSIF g.role = 'owner' AND NOT EXISTS (
      SELECT 1 FROM public.home_group_members
      WHERE home_group_id = g.home_group_id AND user_id <> uid AND role = 'owner'
    ) THEN
      -- Sole owner leaving a shared household: hand it to the longest-standing member.
      UPDATE public.home_group_members SET role = 'owner'
      WHERE home_group_id = g.home_group_id
        AND user_id = (
          SELECT user_id FROM public.home_group_members
          WHERE home_group_id = g.home_group_id AND user_id <> uid
          ORDER BY joined_at
          LIMIT 1
        );
    END IF;
  END LOOP;

  DELETE FROM public.home_group_members WHERE user_id = uid;
  UPDATE public.home_groups SET created_by = NULL WHERE created_by = uid;
  UPDATE public.shared_week_plan SET updated_by = NULL WHERE updated_by = uid;
  UPDATE public.shared_grocery_items SET added_by = NULL WHERE added_by = uid;
  UPDATE public.shared_grocery_items SET checked_by = NULL WHERE checked_by = uid;
  DELETE FROM public.shared_recipe_transfers WHERE from_user = uid OR to_user = uid;

  DELETE FROM auth.users WHERE id = uid;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
