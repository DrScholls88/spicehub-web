-- SpiceHub Home Group schema
-- Run via Supabase Dashboard > SQL Editor or `supabase db push`

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE home_groups (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL DEFAULT 'Our Kitchen',
  invite_code         text UNIQUE NOT NULL,
  invite_code_expires timestamptz,
  invite_code_uses    int DEFAULT 0,
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz DEFAULT now()
);

CREATE TABLE home_group_members (
  home_group_id  uuid REFERENCES home_groups(id) ON DELETE CASCADE,
  user_id        uuid REFERENCES auth.users(id),
  display_name   text,
  avatar         text,
  role           text DEFAULT 'member',
  joined_at      timestamptz DEFAULT now(),
  PRIMARY KEY (home_group_id, user_id)
);

CREATE TABLE shared_week_plan (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_group_id  uuid REFERENCES home_groups(id) ON DELETE CASCADE,
  day_index      int NOT NULL,
  slot           text NOT NULL DEFAULT 'dinner',
  slot_data      jsonb NOT NULL,
  updated_by     uuid REFERENCES auth.users(id),
  updated_at     timestamptz DEFAULT now(),
  UNIQUE (home_group_id, day_index, slot)
);

CREATE TABLE shared_grocery_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_group_id  uuid REFERENCES home_groups(id) ON DELETE CASCADE,
  name           text NOT NULL,
  quantity       text DEFAULT '',
  unit           text DEFAULT '',
  store          text DEFAULT '',
  checked        boolean DEFAULT false,
  sort_order     int DEFAULT 0,
  added_by       uuid REFERENCES auth.users(id),
  checked_by     uuid REFERENCES auth.users(id),
  updated_at     timestamptz DEFAULT now()
);

CREATE TABLE shared_recipe_transfers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_group_id  uuid REFERENCES home_groups(id) ON DELETE CASCADE,
  recipe_data    jsonb NOT NULL,
  from_user      uuid REFERENCES auth.users(id),
  to_user        uuid,
  created_at     timestamptz DEFAULT now(),
  claimed_at     timestamptz
);

-- ── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_shared_week_plan_group
  ON shared_week_plan (home_group_id, day_index, slot);

CREATE INDEX idx_shared_grocery_items_group
  ON shared_grocery_items (home_group_id, checked, sort_order);

CREATE INDEX idx_home_group_members_user
  ON home_group_members (user_id);

-- ── Row-Level Security ──────────────────────────────────────────────────────

ALTER TABLE home_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_week_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_grocery_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_recipe_transfers ENABLE ROW LEVEL SECURITY;

-- Helper: is the current user a member of the given group?
CREATE OR REPLACE FUNCTION is_group_member(gid uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM home_group_members
    WHERE home_group_id = gid AND user_id = auth.uid()
  );
$$;

-- home_groups: members can read their group; creator can insert
CREATE POLICY "members_read_group" ON home_groups
  FOR SELECT USING (is_group_member(id));

CREATE POLICY "auth_create_group" ON home_groups
  FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "owner_update_group" ON home_groups
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM home_group_members
      WHERE home_group_id = id AND user_id = auth.uid() AND role = 'owner'
    )
  );

CREATE POLICY "owner_delete_group" ON home_groups
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM home_group_members
      WHERE home_group_id = id AND user_id = auth.uid() AND role = 'owner'
    )
  );

-- home_group_members: members can read/leave; owner can manage
CREATE POLICY "members_read_members" ON home_group_members
  FOR SELECT USING (is_group_member(home_group_id));

CREATE POLICY "self_insert_member" ON home_group_members
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "self_delete_member" ON home_group_members
  FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "members_update_self" ON home_group_members
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- shared_week_plan: full CRUD for group members
CREATE POLICY "members_all_plan" ON shared_week_plan
  FOR ALL USING (is_group_member(home_group_id))
  WITH CHECK (is_group_member(home_group_id));

-- shared_grocery_items: full CRUD for group members
CREATE POLICY "members_all_grocery" ON shared_grocery_items
  FOR ALL USING (is_group_member(home_group_id))
  WITH CHECK (is_group_member(home_group_id));

-- shared_recipe_transfers: full CRUD for group members
CREATE POLICY "members_all_transfers" ON shared_recipe_transfers
  FOR ALL USING (is_group_member(home_group_id))
  WITH CHECK (is_group_member(home_group_id));

-- ── Realtime publication ────────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE shared_week_plan;
ALTER PUBLICATION supabase_realtime ADD TABLE shared_grocery_items;
ALTER PUBLICATION supabase_realtime ADD TABLE shared_recipe_transfers;
ALTER PUBLICATION supabase_realtime ADD TABLE home_group_members;
