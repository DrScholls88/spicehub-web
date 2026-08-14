import Dexie from 'dexie';
import { buildStructuredFields } from './recipeParser';
import { upgradeRecipeIngredients, cleanImportedTitle, normalizeMealCategory } from './recipeSchema';
import { categorizeBottle } from './lib/barMatch';

const db = new Dexie('SpiceHubDB');

db.version(1).stores({
  meals: '++id, name',
  weekPlan: 'dayIndex',
  groceryItems: '++id, name, storeId, isChecked',
});

// v2: added The Bar (drinks library)
db.version(2).stores({
  drinks: '++id, name',
});

// v3: Added storeMemory for persisting ingredient->store mappings
db.version(3).stores({
  storeMemory: 'ingredient',
});

// v4: Added cookingLog for tracking when meals are cooked (streaks, stats)
db.version(4).stores({
  cookingLog: '++id, mealId, cookedAt',
});

// v5: Added importQueue for offline recipe imports with background sync
db.version(5).stores({
  importQueue: '++id, status, createdAt',
});

// v6: Added storageMetadata for tracking storage usage and quotas
db.version(6).stores({
  storageMetadata: 'key',
});

// v7: Added weekHistory for past week plans
db.version(7).stores({
  weekHistory: '++id, weekStart',
});

// v8: Instagram import cache (offline-first, avoids re-fetching same URL)
db.version(8).stores({
  instagramCache: 'url, cachedAt',
});

// v9: Unified Import Engine — Ghost Recipe status + sourceHash + jobId on meals
db.version(9).stores({
  meals: '++id, name, status, sourceHash, jobId',
});

// v10: Structured fields — ingredients_text indexed for full-text search
db.version(10).stores({
  meals: '++id, name, status, sourceHash, jobId, ingredients_text',
}).upgrade(tx => {
  // Backfill existing meals that don't yet have structured fields
  return tx.table('meals').toCollection().modify(meal => {
    if (!meal.ingredients_text && Array.isArray(meal.ingredients)) {
      const built = buildStructuredFields(meal.ingredients, meal.directions || []);
      Object.assign(meal, built);
    }
  });
});

// v11: Bar inventory — persistent "My Bar Inventory" for quest system & fridge mode
db.version(11).stores({
  barInventory: 'ingredient',
});

// v12: Unified Import Engine — Draft Persistence
db.version(12).stores({
  importDrafts: 'url, timestamp',
});

// v13: Batch Import — multi-share queue (P12)
db.version(13).stores({
  batchQueue: '++id, status, createdAt',
});

// v14: Spec A — structured ingredients as source of truth. Backfill
// `ingredientsStructured` on every existing meal + drink from their flat
// ingredients[] + _ingredientMeta[]. Idempotent, offline, no network. New
// imports already populate the field via thinFromStructured; consumers also
// upgrade on the fly, so this backfill is belt-and-suspenders for old records.
db.version(14).stores({
  meals: '++id, name, status, sourceHash, jobId, ingredients_text',
  drinks: '++id, name',
}).upgrade(tx => {
  const backfill = (meal) => {
    if (Array.isArray(meal.ingredientsStructured) && meal.ingredientsStructured.length) return;
    try {
      const upgraded = upgradeRecipeIngredients(meal);
      if (Array.isArray(upgraded.ingredientsStructured)) {
        meal.ingredientsStructured = upgraded.ingredientsStructured;
      }
    } catch (e) {
      // Defensive: a single bad record must never abort the whole upgrade.
      console.warn('[SpiceHub DB] v14 ingredient backfill skipped a record:', e);
    }
  };
  const meals = tx.table('meals').toCollection().modify(backfill);
  const drinks = tx.table('drinks').toCollection().modify(backfill);
  return Promise.all([meals, drinks]);
});

// v15: Spec D — learned ingredient aliases (user corrections from ImportReview).
// Keyed by the normalized raw imported name; augments the static INGREDIENT_ALIASES.
db.version(15).stores({
  ingredientAliases: 'raw, updatedAt',
});

// v16: Unified Schema Upgrade — first-class Food & Unit entities + nutrition +
// structured directions with ingredient references. New tables seeded on first
// open by ingredientEntities.seedEntities(). Backfill adds directionsStructured
// and nutrition:null to existing meals/drinks. Lazy upgrade on read means old
// records without these fields are transparently handled by CookMode/MealDetail.
db.version(16).stores({
  meals: '++id, name, status, sourceHash, jobId, ingredients_text',
  drinks: '++id, name',
  // First-class ingredient entities
  ingredientFoods: '++id, name',
  ingredientUnits: '++id, name',
}).upgrade(tx => {
  const backfillDirections = (record) => {
    // Add directionsStructured from flat directions if missing
    if (!Array.isArray(record.directionsStructured)) {
      record.directionsStructured = Array.isArray(record.directions)
        ? record.directions.map(d => ({
            text: typeof d === 'string' ? d : (d && d.text) || '',
            ingredientRefs: (d && Array.isArray(d.ingredientRefs)) ? d.ingredientRefs : [],
          })).filter(d => d.text)
        : [];
    }
    // Add nutrition:null placeholder if missing
    if (record.nutrition === undefined) {
      record.nutrition = null;
    }
  };
  const meals = tx.table('meals').toCollection().modify(backfillDirections);
  const drinks = tx.table('drinks').toCollection().modify(backfillDirections);
  return Promise.all([meals, drinks]);
});

// v17: Granular bar inventory. The `barInventory` primary key stays `ingredient`
// (canonical lowercase name), so this is an additive migration — existing rows
// gain `displayName` + inferred `category`; brand/subcategory/qty/notes stay
// undefined until the user edits a bottle. Legacy callers that expect a plain
// name list keep working via getBarInventory(); the new UI uses
// getBarInventoryRecords().
db.version(17).stores({
  barInventory: 'ingredient',
}).upgrade(tx => {
  return tx.table('barInventory').toCollection().modify(row => {
    if (!row || typeof row.ingredient !== 'string') return;
    if (row.displayName === undefined) row.displayName = row.ingredient;
    if (row.category === undefined) {
      try {
        row.category = categorizeBottle(row.ingredient) || null;
      } catch {
        row.category = null;
      }
    }
  });
});

// v18: User-defined tags for meal categorization + scroll-fatigue relief.
// userTags table stores the available tag labels. Meals gain a `tags` array
// (multi-entry indexed) for secondary categorization alongside the existing
// `category` field (which stays as primary type: Dinners, Breakfasts, etc.).
db.version(18).stores({
  meals: '++id, name, status, sourceHash, jobId, ingredients_text, *tags',
  userTags: '++id, &name',
}).upgrade(tx => {
  const defaults = [
    { name: 'Weeknight',    color: '#4CAF50', emoji: '⚡', sortOrder: 0 },
    { name: 'Meal Prep',    color: '#2196F3', emoji: '📦', sortOrder: 1 },
    { name: 'Comfort Food', color: '#FF9800', emoji: '🫕', sortOrder: 2 },
    { name: 'Date Night',   color: '#E91E63', emoji: '🌹', sortOrder: 3 },
    { name: 'Kid-Friendly', color: '#9C27B0', emoji: '👶', sortOrder: 4 },
  ];
  const seedTags = tx.table('userTags').bulkAdd(defaults);
  const backfillTags = tx.table('meals').toCollection().modify(meal => {
    if (!Array.isArray(meal.tags)) meal.tags = [];
  });
  return Promise.all([seedTags, backfillTags]);
});

// v19: Bar expansion — strength on barInventory for ABV calculation.
// No new indexes (glass/method/abv/strength are unindexed display fields).
// Existing barInventory rows gain `strength: null` so abvCalculator.js has a
// consistent shape. Drinks gain glass/method/abv/garnish via seed library or
// next import — no migration needed for schemaless Dexie fields.
db.version(19).stores({
  barInventory: 'ingredient',
}).upgrade(tx => {
  return tx.table('barInventory').toCollection().modify(row => {
    if (row.strength === undefined) row.strength = null;
  });
});

// v20: Custom day-tag builder for planner quick-assign + expanded default meal tags.
// customDayTags stores user-created quick-assign day options (icon, name).
// Also seeds additional default userTags for broader categorization.
db.version(20).stores({
  customDayTags: '++id, &name',
}).upgrade(async tx => {
  // Expanded default meal tags — only add if not already present
  const newDefaults = [
    { name: 'Pasta',       color: '#FF7043', emoji: '🍝', sortOrder: 10 },
    { name: 'Asian',       color: '#26A69A', emoji: '🥡', sortOrder: 11 },
    { name: 'Mexican',     color: '#EF5350', emoji: '🌮', sortOrder: 12 },
    { name: 'Grill',       color: '#8D6E63', emoji: '🔥', sortOrder: 13 },
    { name: 'Sandwiches',  color: '#FFA726', emoji: '🥪', sortOrder: 14 },
    { name: 'Dump & Bake', color: '#AB47BC', emoji: '🫕', sortOrder: 15 },
    { name: 'Holiday',     color: '#D32F2F', emoji: '🎄', sortOrder: 16 },
    { name: 'Vegan',       color: '#66BB6A', emoji: '🌱', sortOrder: 17 },
    { name: 'Meat',        color: '#A1887F', emoji: '🥩', sortOrder: 18 },
    { name: 'Seafood',     color: '#42A5F5', emoji: '🐟', sortOrder: 19 },
    { name: 'Slow Cooker', color: '#78909C', emoji: '🍲', sortOrder: 20 },
    { name: 'Instant Pot', color: '#5C6BC0', emoji: '⏱️', sortOrder: 21 },
    { name: 'One-Pot',     color: '#26C6DA', emoji: '🥘', sortOrder: 22 },
    { name: 'Appetizers',  color: '#EC407A', emoji: '🧆', sortOrder: 23 },
  ];
  const tagsTable = tx.table('userTags');
  const existing = await tagsTable.toArray();
  const existingNames = new Set(existing.map(t => t.name.toLowerCase()));
  const toAdd = newDefaults.filter(t => !existingNames.has(t.name.toLowerCase()));
  if (toAdd.length > 0) await tagsTable.bulkAdd(toAdd);
});

// v21: Fix broken custom-tag ordering. `sortOrder` has been written onto every
// userTags record since v18 (and reorderUserTags/addUserTag both query it),
// but the field was never added to this table's Dexie index — only
// '++id, &name' was ever declared. Calling `.orderBy('sortOrder')` on a
// non-indexed keyPath throws a Dexie SchemaError, which getUserTags() (and
// addUserTag's maxOrder lookup) silently swallowed via try/catch. Net effect:
// getUserTags() has always resolved to [], so custom tags never rendered in
// the Meal Library label bar or the Edit Recipe Labels picker, and
// addUserTag()'s own maxOrder query threw *before* reaching db.userTags.add(),
// so newly "created" tags silently never got written at all.
db.version(21).stores({
  userTags: '++id, &name, sortOrder',
}).upgrade(tx => {
  return tx.table('userTags').toCollection().modify(tag => {
    if (typeof tag.sortOrder !== 'number') tag.sortOrder = 0;
  });
});

// v22: User Profiles & Home Group — local profile, sync queue, sync metadata.
// Creates a default profile, stamps profileId on personal tables, migrates
// dietary pref from localStorage. See spec:
// docs/superpowers/specs/2026-07-28-user-profiles-home-group-design.md
db.version(22).stores({
  profiles: 'id, supabaseUid, updatedAt',
  meals: '++id, name, status, sourceHash, jobId, ingredients_text, *tags, profileId',
  drinks: '++id, name, profileId',
  barInventory: 'ingredient, profileId',
  cookingLog: '++id, mealId, cookedAt, profileId',
  sharedSyncQueue: '++id, table, status, createdAt, clientMutationId',
  sharedMeta: 'homeGroupId',
}).upgrade(async tx => {
  // 1. Create default profile
  const profileId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Migrate dietary pref from localStorage
  let dietaryPref = null;
  try {
    const raw = localStorage.getItem('spicehub_dietary_pref');
    if (raw) {
      dietaryPref = JSON.parse(raw);
    }
  } catch { /* ignore */ }

  await tx.table('profiles').add({
    id: profileId,
    displayName: 'Me',
    supabaseUid: undefined,
    homeGroupId: undefined,
    dietaryPref: dietaryPref || { dietary: '', mode: 'require' },
    createdAt: now,
    updatedAt: now,
  });

  // 2. Stamp profileId on personal tables
  const stampProfile = (record) => {
    if (!record.profileId) record.profileId = profileId;
  };
  await tx.table('meals').toCollection().modify(stampProfile);
  await tx.table('drinks').toCollection().modify(stampProfile);
  await tx.table('barInventory').toCollection().modify(stampProfile);
  await tx.table('cookingLog').toCollection().modify(stampProfile);

  // 3. Delete old localStorage key after successful migration
  try { localStorage.removeItem('spicehub_dietary_pref'); } catch { /* ignore */ }
});

// v23: Friends & Direct Share — friend list cache + received recipe shares.
// Additive only (no data transformation). Tables stay empty until user signs in
// with VITE_FRIENDS_ENABLED=true. See spec:
// docs/superpowers/specs/2026-07-30-friends-direct-share-design.md
db.version(23).stores({
  friends: 'id, otherUserId, username, displayName, avatarId, status, updatedAt',
  recipeShares: 'id, fromUserId, toUserId, itemType, status, createdAt',
});

// v24: Learned recipe domains — grows RECIPE_DOMAINS allowlist from successful blog extractions.
// When a blog yields a structured recipe, its domain is recorded here so future link-priority
// scoring treats it as "known" (priority 0-1 instead of 2-3). Additive only.
db.version(24).stores({
  learnedDomains: 'domain',
});

// v25: One-time category-TYPE normalization migration (Meal Library audit,
// 2026-08-04) — collapses spelling/synonym variants ("Dinner" -> "Dinners")
// on every existing meal so the library's collapsible sections stop
// splintering. Uses the same normalizeMealCategory() that saveMealDeduped
// now applies going forward, so old and new data converge on one vocabulary.
// No index/schema change — meals is re-declared unchanged only so the
// upgrade callback has a table to migrate, same pattern as v10/v14.
db.version(25).stores({
  meals: '++id, name, status, sourceHash, jobId, ingredients_text, *tags, profileId',
}).upgrade(tx => {
  return tx.table('meals').toCollection().modify(meal => {
    if (meal.category) {
      const normalized = normalizeMealCategory(meal.category);
      if (normalized !== meal.category) meal.category = normalized;
    }
  });
});

// v26: Structured per-import telemetry (harden-ideas-audit-2026-08-06.md §1).
// The pipeline previously only had console.log breadcrumbs — no queryable
// record of which stage an import failed at, why, or how long it took.
// Cheapest useful version: one row per pipeline stage per import, written by
// the fire-and-forget logImportTelemetry() helper below. Never blocks or
// throws — a telemetry write failing must never fail an import.
db.version(26).stores({
  importTelemetry: '++id, url, stage, ok, domain, ts',
});

// v27: Friend activity feed cache (offline-first instant load) + avatar_url
// support on friends. See 2026-08-08 social tab optimization plan §A3/§B4 —
// getFriendActivity() was online-only; this caches the last page in Dexie so
// the feed renders instantly (then refreshes in the background), and adds
// avatarUrl to the friends store schema so custom photo avatars are indexed
// the same way avatarId already is.
db.version(27).stores({
  friends: 'id, otherUserId, username, displayName, avatarId, avatarUrl, status, updatedAt',
  friendActivityCache: '++id, occurredAt',
});

// v28: Bar tag system (bar-library-parity-plan-2026-08-07.md Phase 3.4.1).
// userTags previously had a bare `&name` unique index, which is now a
// compound `&[domain+name]` — the same tag name can exist once per domain
// ('meal' or 'drink'), so a drink-side "Brunch" tag doesn't collide with (or
// leak into the picker for) a meal-side "Brunch" tag. Existing rows have no
// `domain` field; the upgrade backfills `domain: 'meal'` on all of them,
// which is safe under the new unique index because names were already
// unique among themselves (old `&name` constraint), so `[meal, name]` stays
// unique too. drinks gains a `*tags` multi-entry index (meals has had one
// since v18) so the same setDrinkTags/bulkSetDrinkTags/deleteUserTag machinery
// can query it the same way.
db.version(28).stores({
  userTags: '++id, &[domain+name], sortOrder',
  drinks: '++id, name, profileId, *tags',
}).upgrade(async tx => {
  const tagsTable = tx.table('userTags');
  await tagsTable.toCollection().modify(tag => {
    if (!tag.domain) tag.domain = 'meal';
  });
  await tx.table('drinks').toCollection().modify(drink => {
    if (!Array.isArray(drink.tags)) drink.tags = [];
  });
  // Bar-native default tags (plan §3.4 item 1) — only add if not already present.
  const barDefaults = [
    { name: 'Summer',         color: '#FF9800', emoji: '☀️', domain: 'drink', sortOrder: 0 },
    { name: 'Batch',          color: '#8D6E63', emoji: '🪙', domain: 'drink', sortOrder: 1 },
    { name: 'Brunch',         color: '#FFB300', emoji: '🥂', domain: 'drink', sortOrder: 2 },
    { name: 'Nightcap',       color: '#5C6BC0', emoji: '🌙', domain: 'drink', sortOrder: 3 },
    { name: 'Low-ABV',        color: '#66BB6A', emoji: '🍃', domain: 'drink', sortOrder: 4 },
    { name: 'Zero-Proof',     color: '#26C6DA', emoji: '🎋', domain: 'drink', sortOrder: 5 },
    { name: 'Crowd-pleaser',  color: '#E91E63', emoji: '🎉', domain: 'drink', sortOrder: 6 },
  ];
  const existing = await tagsTable.toArray();
  const existingDrinkNames = new Set(
    existing.filter(t => t.domain === 'drink').map(t => t.name.toLowerCase())
  );
  const toAdd = barDefaults.filter(t => !existingDrinkNames.has(t.name.toLowerCase()));
  if (toAdd.length > 0) await tagsTable.bulkAdd(toAdd);
});

// v29: Fix "drink import vanishes" bug. saveMealDeduped() (added alongside the
// sourceHash dedup feature, see the "Save-time duplicate detection" comment
// below) has always run `targetTable.where('sourceHash').equals(...)` for
// BOTH tables it's called with — but `sourceHash` was only ever indexed on
// `meals` (since v9). Any import routed to `db.drinks` (target === 'drinks'/
// 'bar', or a recipe whose parsed itemType read as 'drink') threw a Dexie
// SchemaError ("KeyPath sourceHash on object store drinks is not indexed")
// the instant saveMealDeduped tried the lookup. App.jsx's handleImport
// swallows that into a console.error with no user-facing failure state, so
// the import appeared to succeed (toast + UI close) while nothing was ever
// written — the "parses fine, then disappears" report. Adds the missing
// index and backfills a real value so existing drinks become dedup-matchable
// too, instead of just unblocking future writes.
db.version(29).stores({
  drinks: '++id, name, profileId, *tags, sourceHash',
}).upgrade(tx => {
  return tx.table('drinks').toCollection().modify(drink => {
    if (!drink.sourceHash) {
      const sourceUrl = drink.link || drink.sourceUrl || '';
      drink.sourceHash = normalizeSourceForHash(sourceUrl) || '';
    }
  });
});

// ── Fresh-install seed data (Dexie 'populate' event) ────────────────────────
// Discovered while building the v28 bar tag seed above: per Dexie's own
// docs (dexie.org/docs/Tutorial/Design#database-versioning), "If no database
// present, Dexie initializes the last version directly by parsing the
// stores schema... No upgrade() functions run in this case." Every default
// tag seeded inside a .upgrade() callback above (v18's five, v20's fourteen,
// v28's seven bar tags) therefore ONLY ever reaches users who are upgrading
// an existing SpiceHubDB — a genuinely fresh install (new browser profile,
// or a from-scratch test run) gets an empty userTags table, because
// .upgrade() is a migration hook, not a seed hook. Dexie's documented fix is
// the separate 'populate' event, which fires exactly once, only on true
// database creation, and never on upgrade — so it can't double-seed or
// collide with the .upgrade() paths above. Left the v18/v20/v28 .upgrade()
// bodies untouched (Dexie's own guidance: don't edit old version callbacks)
// and duplicated the same literal tag lists here rather than importing
// them, for the same reason — this event fires once per install, ever, so a
// shared "single source of truth" constant isn't worth coupling frozen
// migration history to a live code path.
db.on('populate', async () => {
  await db.userTags.bulkAdd([
    // v18 defaults
    { name: 'Weeknight',    color: '#4CAF50', emoji: '⚡', domain: 'meal', sortOrder: 0 },
    { name: 'Meal Prep',    color: '#2196F3', emoji: '📦', domain: 'meal', sortOrder: 1 },
    { name: 'Comfort Food', color: '#FF9800', emoji: '🫕', domain: 'meal', sortOrder: 2 },
    { name: 'Date Night',   color: '#E91E63', emoji: '🌹', domain: 'meal', sortOrder: 3 },
    { name: 'Kid-Friendly', color: '#9C27B0', emoji: '👶', domain: 'meal', sortOrder: 4 },
    // v20 defaults
    { name: 'Pasta',       color: '#FF7043', emoji: '🍝', domain: 'meal', sortOrder: 10 },
    { name: 'Asian',       color: '#26A69A', emoji: '🥡', domain: 'meal', sortOrder: 11 },
    { name: 'Mexican',     color: '#EF5350', emoji: '🌮', domain: 'meal', sortOrder: 12 },
    { name: 'Grill',       color: '#8D6E63', emoji: '🔥', domain: 'meal', sortOrder: 13 },
    { name: 'Sandwiches',  color: '#FFA726', emoji: '🥪', domain: 'meal', sortOrder: 14 },
    { name: 'Dump & Bake', color: '#AB47BC', emoji: '🫕', domain: 'meal', sortOrder: 15 },
    { name: 'Holiday',     color: '#D32F2F', emoji: '🎄', domain: 'meal', sortOrder: 16 },
    { name: 'Vegan',       color: '#66BB6A', emoji: '🌱', domain: 'meal', sortOrder: 17 },
    { name: 'Meat',        color: '#A1887F', emoji: '🥩', domain: 'meal', sortOrder: 18 },
    { name: 'Seafood',     color: '#42A5F5', emoji: '🐟', domain: 'meal', sortOrder: 19 },
    { name: 'Slow Cooker', color: '#78909C', emoji: '🍲', domain: 'meal', sortOrder: 20 },
    { name: 'Instant Pot', color: '#5C6BC0', emoji: '⏱️', domain: 'meal', sortOrder: 21 },
    { name: 'One-Pot',     color: '#26C6DA', emoji: '🥘', domain: 'meal', sortOrder: 22 },
    { name: 'Appetizers',  color: '#EC407A', emoji: '🧆', domain: 'meal', sortOrder: 23 },
    // v28 bar-native defaults
    { name: 'Summer',        color: '#FF9800', emoji: '☀️', domain: 'drink', sortOrder: 0 },
    { name: 'Batch',         color: '#8D6E63', emoji: '🪙', domain: 'drink', sortOrder: 1 },
    { name: 'Brunch',        color: '#FFB300', emoji: '🥂', domain: 'drink', sortOrder: 2 },
    { name: 'Nightcap',      color: '#5C6BC0', emoji: '🌙', domain: 'drink', sortOrder: 3 },
    { name: 'Low-ABV',       color: '#66BB6A', emoji: '🍃', domain: 'drink', sortOrder: 4 },
    { name: 'Zero-Proof',    color: '#26C6DA', emoji: '🎋', domain: 'drink', sortOrder: 5 },
    { name: 'Crowd-pleaser', color: '#E91E63', emoji: '🎉', domain: 'drink', sortOrder: 6 },
  ]);
});

export default db;

// ── Import pipeline telemetry (v26) ─────────────────────────────────────────
// One row per {stage, import}. `stage` is one of 'acquire' | 'blog' |
// 'finalize' (see harden-ideas-audit-2026-08-06.md §1's contract table —
// 'acquire' covers the Apify/oEmbed/ig-json race, 'blog' covers Phase 0.5B,
// 'finalize' is the single exit point for every LLM path and also captures
// which structuring engine actually won via extractionSource).
/**
 * @param {object} entry
 * @param {'acquire'|'blog'|'finalize'} entry.stage
 * @param {boolean} entry.ok
 * @param {string} [entry.reason]           e.g. 'apify-weak', 'quality-gate-failed'
 * @param {string} [entry.domain]           hostname the stage was working against
 * @param {string} [entry.extractionSource] e.g. '_structuredVia' value, or acquire winner src
 * @param {number} [entry.ms]               stage duration in ms
 * @param {string} [entry.url]              the import's source URL
 */
export async function logImportTelemetry(entry) {
  try {
    await db.importTelemetry.add({
      stage: entry.stage || 'unknown',
      ok: !!entry.ok,
      reason: entry.reason || '',
      domain: entry.domain || '',
      extractionSource: entry.extractionSource || '',
      ms: typeof entry.ms === 'number' ? entry.ms : null,
      url: entry.url || '',
      ts: new Date().toISOString(),
    });
  } catch (err) {
    // Telemetry must never break an import — log and move on.
    console.warn('[SpiceHub] logImportTelemetry failed (non-fatal):', err?.message || err);
  }
}

/**
 * Small read helper for a future debug view — most recent N telemetry rows,
 * newest first. Not wired into any UI yet; exported so it's easy to add one.
 * @param {number} [limit=200]
 */
export async function getImportTelemetry(limit = 200) {
  try {
    return await db.importTelemetry.orderBy('ts').reverse().limit(limit).toArray();
  } catch {
    return [];
  }
}

/** Best-effort hostname extraction for telemetry `domain` fields. */
export function domainForTelemetry(url = '') {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// ── Custom Day Tags helpers (v20) ───────────────────────────────────────────
export async function getCustomDayTags() {
  try {
    return await db.customDayTags.toArray();
  } catch (e) {
    console.warn('[SpiceHub DB] getCustomDayTags failed:', e);
    return [];
  }
}

export async function addCustomDayTag({ name, icon }) {
  if (!name || !name.trim()) return null;
  const trimmed = name.trim();
  try {
    const existing = await db.customDayTags.where('name').equalsIgnoreCase(trimmed).first();
    if (existing) return existing.id;
    return await db.customDayTags.add({ name: trimmed, icon: icon || '🏷️' });
  } catch (e) {
    console.warn('[SpiceHub DB] addCustomDayTag failed:', e);
    return null;
  }
}

export async function deleteCustomDayTag(id) {
  try {
    await db.customDayTags.delete(id);
  } catch (e) {
    console.warn('[SpiceHub DB] deleteCustomDayTag failed:', e);
  }
}

// ── User Tags helpers (v18; domain-scoped since v28 — see migration comment) ─
// `domain` is 'meal' (default, preserves every pre-existing call site) or
// 'drink'. Tags are looked up by scanning userTags.toArray() rather than an
// indexed `.where('domain')` query — the table is a couple dozen rows at
// most, and a plain index on `domain` alone would be redundant with the
// compound `&[domain+name]` unique index already declared in v28.
function tagTargetTable(domain) {
  return domain === 'drink' ? db.drinks : db.meals;
}

export async function getUserTags(domain = 'meal') {
  try {
    const tags = await db.userTags.toArray();
    return tags
      .filter(t => (t.domain || 'meal') === domain)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  } catch (e) {
    console.warn('[SpiceHub DB] getUserTags failed:', e);
    return [];
  }
}

export async function addUserTag({ name, color, emoji, domain = 'meal' }) {
  if (!name || !name.trim()) return null;
  const trimmed = name.trim();
  try {
    const all = await db.userTags.toArray();
    const domainTags = all.filter(t => (t.domain || 'meal') === domain);
    const existing = domainTags.find(t => t.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id; // don't duplicate within this domain
    const maxOrder = domainTags.reduce((max, t) => Math.max(max, t.sortOrder ?? -1), -1);
    const id = await db.userTags.add({
      name: trimmed,
      color: color || '#888888',
      emoji: emoji || '🏷️',
      domain,
      sortOrder: maxOrder + 1,
    });
    return id;
  } catch (e) {
    console.warn('[SpiceHub DB] addUserTag failed:', e);
    return null;
  }
}

export async function updateUserTag(id, patch) {
  try {
    await db.userTags.update(id, patch);
  } catch (e) {
    console.warn('[SpiceHub DB] updateUserTag failed:', e);
  }
}

export async function deleteUserTag(id) {
  try {
    const tag = await db.userTags.get(id);
    if (!tag) return;
    // Remove this tag from every item in its own domain (meals or drinks —
    // never both, since a tag can only belong to one domain).
    await tagTargetTable(tag.domain).where('tags').equals(tag.name).modify(item => {
      item.tags = (item.tags || []).filter(t => t !== tag.name);
    });
    await db.userTags.delete(id);
  } catch (e) {
    console.warn('[SpiceHub DB] deleteUserTag failed:', e);
  }
}

// reorderUserTags — persist a new display order for custom labels after a
// drag-to-reorder gesture in the label bar (long-press to enter edit mode).
// Takes tag ids in the desired order and rewrites sortOrder sequentially so
// getUserTags()'s in-memory sort picks it up. Domain-agnostic: ids are
// already unique per row, so reordering one domain's subset never touches
// another domain's sortOrder values.
export async function reorderUserTags(orderedIds) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return;
  try {
    await Promise.all(orderedIds.map((id, i) => db.userTags.update(id, { sortOrder: i })));
  } catch (e) {
    console.warn('[SpiceHub DB] reorderUserTags failed:', e);
  }
}

export async function renameUserTag(id, newName) {
  if (!newName || !newName.trim()) return;
  const trimmed = newName.trim();
  try {
    const tag = await db.userTags.get(id);
    if (!tag) return;
    const oldName = tag.name;
    // Update tag record
    await db.userTags.update(id, { name: trimmed });
    // Rename in every item (of this tag's own domain) that carries the old name
    if (oldName !== trimmed) {
      await tagTargetTable(tag.domain).where('tags').equals(oldName).modify(item => {
        item.tags = (item.tags || []).map(t => t === oldName ? trimmed : t);
      });
    }
  } catch (e) {
    console.warn('[SpiceHub DB] renameUserTag failed:', e);
  }
}

export async function setMealTags(mealId, tags) {
  try {
    await db.meals.update(mealId, { tags: Array.isArray(tags) ? tags : [] });
  } catch (e) {
    console.warn('[SpiceHub DB] setMealTags failed:', e);
  }
}

export async function addMealTag(mealId, tagName) {
  try {
    const meal = await db.meals.get(mealId);
    if (!meal) return;
    const current = Array.isArray(meal.tags) ? meal.tags : [];
    if (!current.includes(tagName)) {
      await db.meals.update(mealId, { tags: [...current, tagName] });
    }
  } catch (e) {
    console.warn('[SpiceHub DB] addMealTag failed:', e);
  }
}

export async function removeMealTag(mealId, tagName) {
  try {
    const meal = await db.meals.get(mealId);
    if (!meal) return;
    const current = Array.isArray(meal.tags) ? meal.tags : [];
    await db.meals.update(mealId, { tags: current.filter(t => t !== tagName) });
  } catch (e) {
    console.warn('[SpiceHub DB] removeMealTag failed:', e);
  }
}

export async function bulkSetMealTags(mealIds, tagName, add = true) {
  if (!Array.isArray(mealIds) || !mealIds.length || !tagName) return;
  try {
    await db.meals.where('id').anyOf(mealIds).modify(meal => {
      const current = Array.isArray(meal.tags) ? meal.tags : [];
      if (add) {
        if (!current.includes(tagName)) meal.tags = [...current, tagName];
      } else {
        meal.tags = current.filter(t => t !== tagName);
      }
    });
  } catch (e) {
    console.warn('[SpiceHub DB] bulkSetMealTags failed:', e);
  }
}

// ── Drink Tags helpers (v28 — Phase 3.4.1 bar tag system) ──────────────────
// Byte-for-byte mirrors of the meal versions above, targeting db.drinks
// instead. Kept as separate exports (rather than a single itemType-switched
// function) to match the existing db.js convention of one function per
// table — see setMealTags/bulkSetMealTags immediately above.
export async function setDrinkTags(drinkId, tags) {
  try {
    await db.drinks.update(drinkId, { tags: Array.isArray(tags) ? tags : [] });
  } catch (e) {
    console.warn('[SpiceHub DB] setDrinkTags failed:', e);
  }
}

export async function addDrinkTag(drinkId, tagName) {
  try {
    const drink = await db.drinks.get(drinkId);
    if (!drink) return;
    const current = Array.isArray(drink.tags) ? drink.tags : [];
    if (!current.includes(tagName)) {
      await db.drinks.update(drinkId, { tags: [...current, tagName] });
    }
  } catch (e) {
    console.warn('[SpiceHub DB] addDrinkTag failed:', e);
  }
}

export async function removeDrinkTag(drinkId, tagName) {
  try {
    const drink = await db.drinks.get(drinkId);
    if (!drink) return;
    const current = Array.isArray(drink.tags) ? drink.tags : [];
    await db.drinks.update(drinkId, { tags: current.filter(t => t !== tagName) });
  } catch (e) {
    console.warn('[SpiceHub DB] removeDrinkTag failed:', e);
  }
}

export async function bulkSetDrinkTags(drinkIds, tagName, add = true) {
  if (!Array.isArray(drinkIds) || !drinkIds.length || !tagName) return;
  try {
    await db.drinks.where('id').anyOf(drinkIds).modify(drink => {
      const current = Array.isArray(drink.tags) ? drink.tags : [];
      if (add) {
        if (!current.includes(tagName)) drink.tags = [...current, tagName];
      } else {
        drink.tags = current.filter(t => t !== tagName);
      }
    });
  } catch (e) {
    console.warn('[SpiceHub DB] bulkSetDrinkTags failed:', e);
  }
}

// ── Learned recipe domain helpers (v24 — blog link follower growth) ───────────
// After a successful structured extraction from a blog, record the domain so
// future imports prioritize links from that domain in link discovery scoring.
export async function recordLearnedDomain(domain) {
  if (!domain || typeof domain !== 'string') return;
  const d = domain.toLowerCase().replace(/^www\./, '').trim();
  if (!d || d.includes('/')) return;
  try {
    const existing = await db.learnedDomains.get(d);
    await db.learnedDomains.put({
      domain: d,
      successCount: (existing?.successCount || 0) + 1,
      firstSeen: existing?.firstSeen || Date.now(),
      lastSuccess: Date.now(),
    });
  } catch (e) {
    console.warn('[SpiceHub DB] recordLearnedDomain failed:', e);
  }
}

export async function getLearnedDomains() {
  try {
    const rows = await db.learnedDomains.toArray();
    return new Set(rows.map(r => r.domain));
  } catch (e) {
    console.warn('[SpiceHub DB] getLearnedDomains failed:', e);
    return new Set();
  }
}

// ── Learned alias helpers (Spec D) ────────────────────────────────────────────
export async function getLearnedAliases() {
  try {
    return await db.ingredientAliases.toArray();
  } catch (e) {
    console.warn('[SpiceHub DB] getLearnedAliases failed:', e);
    return [];
  }
}

export async function saveLearnedAlias(entry) {
  if (!entry || !entry.raw || !entry.canonical) return;
  const raw = String(entry.raw).trim().toLowerCase();
  if (!raw) return;
  try {
    const existing = await db.ingredientAliases.get(raw);
    await db.ingredientAliases.put({
      raw,
      canonical: entry.canonical,
      aisle: entry.aisle || 'unknown',
      category: entry.category || '',
      count: (existing?.count || 0) + 1,
      updatedAt: Date.now(),
    });
  } catch (e) {
    console.warn('[SpiceHub DB] saveLearnedAlias failed:', e);
  }
}

export async function saveLearnedAliases(list = []) {
  // Batched version of saveLearnedAlias: previously this looped and did one
  // `get` + one `put` per entry (2N IndexedDB round trips). Now it's a single
  // bulkGet + single bulkPut regardless of list size. Duplicate `raw` values
  // within the same list are merged locally so counts still increment
  // correctly for each occurrence (matching the old sequential behavior).
  const entries = (Array.isArray(list) ? list : [])
    .map((entry) => {
      if (!entry || !entry.raw || !entry.canonical) return null;
      const raw = String(entry.raw).trim().toLowerCase();
      if (!raw) return null;
      return { raw, canonical: entry.canonical, aisle: entry.aisle || 'unknown', category: entry.category || '' };
    })
    .filter(Boolean);
  if (!entries.length) return;

  try {
    const uniqueRaws = [...new Set(entries.map((e) => e.raw))];
    const existingRows = await db.ingredientAliases.bulkGet(uniqueRaws);
    const baseCounts = new Map(uniqueRaws.map((raw, i) => [raw, existingRows[i]?.count || 0]));

    const now = Date.now();
    const byRaw = new Map();
    for (const entry of entries) {
      const prevCount = byRaw.has(entry.raw) ? byRaw.get(entry.raw).count : baseCounts.get(entry.raw);
      byRaw.set(entry.raw, {
        raw: entry.raw,
        canonical: entry.canonical,
        aisle: entry.aisle,
        category: entry.category,
        count: prevCount + 1,
        updatedAt: now,
      });
    }
    await db.ingredientAliases.bulkPut([...byRaw.values()]);
  } catch (e) {
    console.warn('[SpiceHub DB] saveLearnedAliases failed:', e);
  }
}

// ── Bar Inventory helpers ─────────────────────────────────────────────────────
// Records: { ingredient(PK/canonical), displayName, category, subcategory, brand, qty, notes, addedAt }
export async function getBarInventory() {
  // Legacy signature: returns canonical name strings. Kept for callers that only
  // need the flat list (matching, quick checks).
  try {
    const items = await db.barInventory.toArray();
    return items.map(i => i.ingredient);
  } catch (e) {
    console.warn('[SpiceHub DB] getBarInventory failed:', e);
    return [];
  }
}

export async function getBarInventoryRecords() {
  // Full bottle records for the richer inventory UI.
  try {
    return await db.barInventory.toArray();
  } catch (e) {
    console.warn('[SpiceHub DB] getBarInventoryRecords failed:', e);
    return [];
  }
}

export async function addToBarInventory(ingredient, meta = {}) {
  const key = String(ingredient || '').toLowerCase().trim();
  if (!key) return;
  try {
    const existing = await db.barInventory.get(key);
    let category = meta.category;
    if (category === undefined) {
      // Preserve an existing category; otherwise infer from the name.
      category = existing?.category;
      if (category === undefined) {
        try { category = categorizeBottle(key) || null; } catch { category = null; }
      }
    }
    await db.barInventory.put({
      ingredient: key,
      displayName: meta.displayName ?? existing?.displayName ?? key,
      category,
      subcategory: meta.subcategory ?? existing?.subcategory,
      brand: meta.brand ?? existing?.brand,
      qty: meta.qty ?? existing?.qty,
      notes: meta.notes ?? existing?.notes,
      qtyLevel: meta.qtyLevel ?? existing?.qtyLevel, // P3 semantic stock enum — preserve on re-add
      strength: meta.strength ?? existing?.strength ?? null, // ABV 0-100, for abvCalculator.js
      addedAt: existing?.addedAt ?? new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[SpiceHub DB] addToBarInventory failed:', e);
  }
}

export async function updateBarBottle(ingredient, patch = {}) {
  const key = String(ingredient || '').toLowerCase().trim();
  if (!key) return;
  try {
    const existing = await db.barInventory.get(key);
    if (!existing) return;
    // qtyLevel: P3 semantic stock enum (string, additive beside legacy qty).
    // addedAt: refreshed on restock for the pantry freshness indicator.
    const allowed = ['displayName', 'category', 'subcategory', 'brand', 'qty', 'notes', 'qtyLevel', 'strength', 'addedAt'];
    const next = { ...existing };
    for (const field of allowed) {
      if (field in patch) next[field] = patch[field];
    }
    await db.barInventory.put(next);
  } catch (e) {
    console.warn('[SpiceHub DB] updateBarBottle failed:', e);
  }
}

export async function removeFromBarInventory(ingredient) {
  const key = ingredient.toLowerCase().trim();
  try {
    await db.barInventory.delete(key);
  } catch (e) {
    console.warn('[SpiceHub DB] removeFromBarInventory failed:', e);
  }
}

export async function clearBarInventory() {
  try { await db.barInventory.clear(); } catch (e) { console.warn('[SpiceHub DB] clearBarInventory failed:', e); }
}

export async function isInBarInventory(ingredient) {
  const key = ingredient.toLowerCase().trim();
  try {
    const item = await db.barInventory.get(key);
    return !!item;
  } catch { return false; }
}

// ── Week plan persistence ─────────────────────────────────────────────────────
export async function saveWeekPlan(weekPlan) {
  try {
    const entries = weekPlan.map((meal, i) => ({
      dayIndex: i,
      meal: meal || null,
    }));
    await db.transaction('rw', db.weekPlan, async () => {
      await db.weekPlan.clear();
      await db.weekPlan.bulkPut(entries);
    });
  } catch (error) {
    console.error('[SpiceHub DB] saveWeekPlan failed:', error);
    throw new Error('Failed to save week plan. Your data is safe — try refreshing.');
  }
}

export async function loadWeekPlan() {
  try {
    const entries = await db.weekPlan.toArray();
    if (entries.length === 0) return null; // No saved plan
    const plan = Array(7).fill(null);
    for (const entry of entries) {
      if (entry.dayIndex >= 0 && entry.dayIndex < 7) {
        plan[entry.dayIndex] = entry.meal;
      }
    }
    // Only return if there's at least one non-null entry
    return plan.some(Boolean) ? plan : null;
  } catch (error) {
    console.error('[SpiceHub DB] loadWeekPlan failed:', error);
    throw new Error('Failed to load week plan. Your data is safe — try refreshing.');
  }
}

// ── Grocery list persistence ──────────────────────────────────────────────────
export async function saveGroceryList(items) {
  try {
    await db.transaction('rw', db.groceryItems, async () => {
      await db.groceryItems.clear();
      if (items.length > 0) {
        await db.groceryItems.bulkAdd(items.map(item => ({
          name: item.name,
          checked: item.checked || false,
          store: item.store || '',
          ...(item.cloudId && { cloudId: item.cloudId }),
          ...(item.covered != null && { covered: item.covered }),
          ...(item.tag && { tag: item.tag }),
          ...(item.quantity && { quantity: item.quantity }),
          ...(item.unit && { unit: item.unit }),
          ...(item.category && { category: item.category }),
        })));
      }
    });
  } catch (error) {
    console.error('[SpiceHub DB] saveGroceryList failed:', error);
    throw new Error('Failed to save grocery list. Your data is safe — try refreshing.');
  }
}

export async function loadGroceryList() {
  try {
    const items = await db.groceryItems.toArray();
    return items.length > 0 ? items : null;
  } catch (error) {
    console.error('[SpiceHub DB] loadGroceryList failed:', error);
    throw new Error('Failed to load grocery list. Your data is safe — try refreshing.');
  }
}

// Helper functions for store memory persistence
export async function getStoreMemory() {
  try {
    const records = await db.storeMemory.toArray();
    const memory = {};
    for (const rec of records) {
      memory[rec.ingredient] = rec.store;
    }
    return memory;
  } catch (error) {
    console.error('[SpiceHub DB] getStoreMemory failed:', error);
    throw new Error('Failed to load store memory. Returning empty memory.');
  }
}

export async function saveStoreMemory(ingredient, store) {
  try {
    await db.storeMemory.put({ ingredient, store });
  } catch (error) {
    console.error('[SpiceHub DB] saveStoreMemory failed:', error);
    throw new Error('Failed to save store memory. Your data is safe — try again.');
  }
}

export async function clearStoreMemory() {
  await db.storeMemory.clear();
}

// Cooking log helpers
export async function logCook(mealId, mealName) {
  try {
    await db.cookingLog.add({ mealId, mealName, cookedAt: new Date().toISOString() });
    // Also increment cookCount and set lastCooked on the meal
    const meal = await db.meals.get(mealId);
    if (meal) {
      await db.meals.update(mealId, {
        cookCount: (meal.cookCount || 0) + 1,
        lastCooked: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('[SpiceHub DB] logCook failed:', error);
    throw new Error('Failed to log cook. Your data is safe — try again.');
  }
}

export async function getCookingLog() {
  return db.cookingLog.toArray();
}

// Mixing log helpers (for drinks)
export async function logMix(drinkId, drinkName) {
  try {
    await db.cookingLog.add({ mealId: drinkId, mealName: drinkName, cookedAt: new Date().toISOString(), type: 'mix' });
    // Increment mixCount on the drink
    const drink = await db.drinks.get(drinkId);
    if (drink) {
      await db.drinks.update(drinkId, {
        cookCount: (drink.cookCount || 0) + 1,
        lastCooked: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('[SpiceHub DB] logMix failed:', error);
    throw new Error('Failed to log mix. Your data is safe — try again.');
  }
}

// ── Offline recipe import queue ───────────────────────────────────────────
function validateRecipe(data) {
  const errors = [];
  if (!data.name || typeof data.name !== 'string' || data.name.trim() === '') {
    errors.push('Recipe must have a non-empty name');
  }
  if (!Array.isArray(data.ingredients)) {
    errors.push('Ingredients must be an array');
  }
  if (!Array.isArray(data.directions)) {
    errors.push('Directions must be an array');
  }
  return { valid: errors.length === 0, errors };
}

export async function queueRecipeImport(url, recipeData, opts = {}) {
  try {
    // Validate recipe data
    const validation = validateRecipe(recipeData);
    if (!validation.valid) {
      throw new Error(`Invalid recipe: ${validation.errors.join(', ')}`);
    }

    // Check if recipe with same name already exists
    const existing = await db.meals.where('name').equalsIgnoreCase(recipeData.name).first();
    if (existing) {
      return { queueId: null, isDuplicate: true, existingId: existing.id };
    }

    // Check if already in queue
    const inQueue = await db.importQueue.where('url').equals(url).toArray();
    const alreadyQueued = inQueue.find(q =>
      q.recipeData?.name?.toLowerCase() === recipeData.name.toLowerCase()
    );
    if (alreadyQueued) {
      return { queueId: alreadyQueued.id, isDuplicate: true, alreadyInQueue: true };
    }

    // Add to queue
    const id = await db.importQueue.add({
      url,
      recipeData,
      status: 'pending',
      error: null,
      createdAt: new Date().toISOString(),
      attemptCount: 0,
      visualConfidence: opts.visualConfidence ?? null,
      needsGemini: opts.needsGemini ?? false,
    });

    return { queueId: id, isDuplicate: false };
  } catch (error) {
    console.error('[SpiceHub DB] queueRecipeImport failed:', error);
    throw new Error(`Failed to queue recipe: ${error.message}`);
  }
}

export async function getQueuedRecipes() {
  return db.importQueue.where('status').anyOf(['pending', 'failed']).toArray();
}

/**
 * queuePhotoUpgrade — after an OFFLINE photo import saved an on-device OCR
 * draft, queue the compressed scan pages so processImportQueue can re-run the
 * online vision tiers (Gemini → Mistral) on reconnect and merge the better
 * extraction into the saved recipe. Pages are purged once the upgrade lands.
 *
 * @param {object} recipeData  the draft recipe as saved (needs .name)
 * @param {string[]} scanPageDataUrls  compressed page data URLs, in order
 * @param {'meal'|'drink'} itemType
 */
export async function queuePhotoUpgrade(recipeData, scanPageDataUrls, itemType = 'meal') {
  if (!recipeData?.name || !Array.isArray(scanPageDataUrls) || scanPageDataUrls.length === 0) {
    return { queueId: null };
  }
  const id = await db.importQueue.add({
    url: `photo-scan:${Date.now()}`,
    mode: 'photo-upgrade',
    recipeData,
    scanPages: scanPageDataUrls,
    itemType,
    targetName: recipeData.name,
    status: 'pending',
    error: null,
    createdAt: new Date().toISOString(),
    attemptCount: 0,
  });
  return { queueId: id };
}

export function mergeRecipeData(existing, incoming) {
  // PiP invariant (see harden-ideas-audit-2026-08-06.md, found via that audit):
  // videoUrl/_sources were NOT in this merge's explicit field list, so the
  // ...existing spread below silently kept existing.videoUrl even when it was
  // empty and incoming had just resolved a real one — the exact "never drop
  // PiP URL" rule the audit calls non-negotiable, broken by this function.
  // Fix: prefer whichever side actually has a non-empty videoUrl, and
  // reconcile _sources.videoUrl to match so the two never disagree.
  const mergedVideoUrl = existing.videoUrl || incoming.videoUrl || '';
  const mergedSources = (existing._sources || incoming._sources)
    ? { ...incoming._sources, ...existing._sources, videoUrl: mergedVideoUrl }
    : existing._sources;

  // 2026-08-11: gathered-photo union. Previously this function only ever
  // spread `...existing` as the base and never touched _carouselImages/
  // _igCarouselImages/_scanPages, so a re-import that discovered NEW extra
  // photos (e.g. blog page changed, or the IG carousel grew) silently
  // couldn't add them — only the very first import's photo set ever stuck.
  // Union both sides, deduped by src, so "keep any photos gathered in
  // either [import]" holds across re-imports too, not just within one.
  const mergePhotoArrays = (a, b) => {
    const arrA = Array.isArray(a) ? a : [];
    const arrB = Array.isArray(b) ? b : [];
    if (!arrA.length) return arrB;
    if (!arrB.length) return arrA;
    const seen = new Set();
    const out = [];
    for (const item of [...arrA, ...arrB]) {
      const key = typeof item === 'string' ? item : (item?.dataUrl || item?.url || '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  };

  // 2026-08-14: `existing._userEdited` (stamped by App.jsx's saveMeal whenever
  // the user manually saves changes via AddEditMeal) means a human trimmed or
  // corrected this list on purpose — a re-import of the same source (retry,
  // re-share, batch queue) must never silently undo that. Without this check,
  // the plain length comparison below always prefers whichever side has MORE
  // lines, so a hand-deleted garbage ingredient line comes right back the next
  // time this recipe's URL gets re-scraped, because the fresh scrape is still
  // "longer" than the user's cleaned-up version.
  const keepExistingIngredients = existing._userEdited || (incoming.ingredients?.length || 0) <= (existing.ingredients?.length || 0);
  const keepExistingDirections = existing._userEdited || (incoming.directions?.length || 0) <= (existing.directions?.length || 0);
  return {
    ...existing,
    // Prefer the version with more ingredients — unless the user hand-edited
    // the existing copy, in which case their edit always wins.
    ingredients: keepExistingIngredients ? existing.ingredients : incoming.ingredients,
    // Prefer the version with more directions — same user-edit override.
    directions: keepExistingDirections ? existing.directions : incoming.directions,
    // Fill in missing fields from incoming
    imageUrl: existing.imageUrl || incoming.imageUrl,
    link: existing.link || incoming.link,
    videoUrl: mergedVideoUrl,
    _sources: mergedSources,
    _carouselImages: mergePhotoArrays(existing._carouselImages, incoming._carouselImages),
    _igCarouselImages: mergePhotoArrays(existing._igCarouselImages, incoming._igCarouselImages),
    _scanPages: mergePhotoArrays(existing._scanPages, incoming._scanPages),
    updatedAt: new Date().toISOString(),
  };
}

// ── Save-time duplicate detection ("Ingredient Dedup Bridge" sibling: this is
// the *recipe*-level dedup, not the ingredient-level one in GroceryList) ──────
// `sourceHash` has been an indexed column on `meals` since v9 ("Unified Import
// Engine — Ghost Recipe status + sourceHash + jobId") but nothing ever actually
// computed/stored a value into it — every live import (App.jsx's handleImport,
// the 'week'/'library' destinations) called db.meals.put() directly with no
// duplicate check at all, which is the real cause of e.g. three separate saved
// copies of the same imported recipe. This normalizes the source URL (strip
// tracking params/fragment/trailing slash) into that dormant column and uses
// it — plus a normalized-title fallback for recipes with no link — as the
// match key. Both fields are already real Dexie indexes, so the lookups here
// are fast, no schema migration required.
function normalizeSourceForHash(url = '') {
  if (!url) return '';
  try {
    const u = new URL(url);
    u.hash = '';
    // Strip common tracking params so the same post shared via different
    // referral links still hashes identically.
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'igshid', 'igsh', 'fbclid'].forEach(p => u.searchParams.delete(p));
    let out = `${u.hostname.replace(/^www\./, '')}${u.pathname}`.toLowerCase();
    out = out.replace(/\/+$/, '');
    return out;
  } catch {
    return String(url).trim().toLowerCase();
  }
}

/**
 * saveMealDeduped — Single choke point for saving a freshly-imported recipe
 * (or drink) that actually checks for an existing match before creating a
 * new row. Rows that already carry an `id` (ghost/optimistic-path rows, or
 * an explicit edit) skip dedup entirely and just upsert — they're already a
 * tracked record, not a duplicate risk.
 * @param {object} recipeData
 * @param {{ table?: 'meals'|'drinks' }} [opts]
 * @returns {Promise<{ id: number, merged: boolean }>}
 */
export async function saveMealDeduped(recipeData, { table = 'meals' } = {}) {
  const targetTable = table === 'drinks' ? db.drinks : db.meals;

  if (recipeData.id) {
    await targetTable.put(recipeData);
    return { id: recipeData.id, merged: false };
  }

  const cleanedName = cleanImportedTitle(recipeData.name || '') || recipeData.name;
  const sourceUrl = recipeData.link || recipeData.sourceUrl || '';
  const sourceHash = normalizeSourceForHash(sourceUrl);
  // Category-TYPE normalization (Dinner -> Dinners etc.) only applies to
  // meals — drinks use a different categorization concept entirely.
  const normalizedCategory = table !== 'drinks' && recipeData.category
    ? normalizeMealCategory(recipeData.category)
    : recipeData.category;
  const candidate = {
    ...recipeData,
    name: cleanedName,
    category: normalizedCategory,
    sourceHash: sourceHash || recipeData.sourceHash,
  };

  let existing = null;
  if (sourceHash) {
    existing = await targetTable.where('sourceHash').equals(sourceHash).first();
  }
  if (!existing && cleanedName) {
    existing = await targetTable.where('name').equalsIgnoreCase(cleanedName).first();
  }

  if (existing) {
    const merged = {
      ...mergeRecipeData(existing, candidate),
      _importCount: (existing._importCount || 1) + 1,
      _lastImportedAt: new Date().toISOString(),
    };
    await targetTable.update(existing.id, merged);
    return { id: existing.id, merged: true };
  }

  const stamped = {
    ...candidate,
    createdAt: candidate.createdAt || new Date().toISOString(),
    _importCount: 1,
  };
  const newId = await targetTable.add(stamped);
  return { id: newId, merged: false };
}

export async function processImportQueue() {
  try {
    // Claim every queued item before doing any async work. getQueuedRecipes()
    // used to just be re-read here with no lock, so two concurrent calls
    // (two open tabs both reacting to the same 'online' event, or a mount-time
    // call racing a listener-triggered call in the same tab) would both read
    // the same pending/failed rows and both process them — e.g. both calling
    // db.meals.add() for the same queued recipe, producing a duplicate. Dexie's
    // Collection#modify() runs as one transaction, so this claim (flip status
    // to 'processing') can't interleave with another caller's read — whichever
    // call's modify() commits first "owns" these rows; the other sees none left.
    const claimedIds = [];
    await db.importQueue.where('status').anyOf(['pending', 'failed']).modify(item => {
      claimedIds.push(item.id);
      item.status = 'processing';
    });
    const queued = claimedIds.length
      ? await db.importQueue.where('id').anyOf(claimedIds).toArray()
      : [];
    let succeeded = 0;
    let failed = 0;

    for (const item of queued) {
      try {
        // ── Photo-upgrade entries: re-run the online vision tiers on the
        //    stored scan pages and merge the improvement into the saved
        //    recipe. Never adds a new meal (the draft was already saved).
        if (item.mode === 'photo-upgrade') {
          try {
            // Dynamic import avoids a db.js ↔ recipeParser.js cycle.
            const { importRecipeFromPages } = await import('./lib/photoImportEngine.js');
            const pages = (item.scanPages || []).map((dataUrl, i) => ({ id: `q-${item.id}-${i}`, dataUrl }));
            const improved = await importRecipeFromPages(pages, { type: item.itemType || 'meal' });

            if (improved && !improved._ocrDraft) {
              const target = await db.meals.where('name').equalsIgnoreCase(item.targetName).first();
              if (target) {
                await db.meals.update(target.id, {
                  ...mergeRecipeData(target, {
                    ...improved,
                    name: improved.name || improved.title || target.name,
                  }),
                  // Vision found the real dish photo — it beats the page scan
                  // (mergeRecipeData would otherwise keep the existing image).
                  imageUrl: improved.imageUrl || target.imageUrl,
                  sourceCaption: improved.sourceCaption || target.sourceCaption,
                  confidence: improved.confidence ?? target.confidence,
                  needsReview: false,
                  _ocrDraft: false,
                  _structuredVia: improved._structuredVia || target._structuredVia,
                  _visionEngine: improved._visionEngine || target._visionEngine,
                });
              }
              // Purge the heavy page payload on success (storage hygiene).
              await db.importQueue.update(item.id, { status: 'done', error: null, scanPages: null });
              succeeded++;
            } else {
              // Still offline / online tiers still down — leave pending.
              throw new Error('Vision tiers unavailable — will retry');
            }
          } catch (err) {
            failed++;
            const newAttempt = (item.attemptCount || 0) + 1;
            const willRetry = newAttempt < 5; // more patience than URL imports
            await db.importQueue.update(item.id, {
              status: willRetry ? 'pending' : 'failed',
              error: err.message,
              attemptCount: newAttempt,
              ...(willRetry ? {} : { scanPages: null }), // don't hoard pages forever
            });
          }
          continue;
        }

        // Attempt Gemini re-processing if the offline visual parse had low confidence
        let recipeToSave = item.recipeData;

        if (item.needsGemini && item.url) {
          try {
            // Re-submit URL to the server's deep waterfall (Python scraper + Gemini)
            const API_BASE = typeof window !== 'undefined' ? '' : '';
            const resp = await fetch(`${API_BASE}/api/v2/import/sync`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: item.url }),
              signal: AbortSignal.timeout(30000),
            });
            if (resp.ok) {
              const { recipe } = await resp.json();
              if (recipe && recipe.name && !recipe._error) {
                recipeToSave = recipe;
                console.log(`[SpiceHub DB] Gemini re-processing improved recipe: ${recipe.name}`);
              }
            }
          } catch (geminiErr) {
            console.warn('[SpiceHub DB] Gemini re-processing failed, using cached recipe:', geminiErr.message);
            // Falls through to use item.recipeData
          }
        }

        // Validate recipe before processing
        const validation = validateRecipe(recipeToSave);
        if (!validation.valid) {
          throw new Error(`Invalid recipe: ${validation.errors.join(', ')}`);
        }

        // Check if recipe still doesn't exist
        const existing = await db.meals.where('name').equalsIgnoreCase(recipeToSave.name).first();
        if (existing) {
          // Check if it's a true duplicate or just same name
          const isSameSource = existing.link && recipeToSave.link &&
            existing.link === recipeToSave.link;

          if (isSameSource) {
            // Same recipe from same URL — merge (keep richer data)
            const merged = mergeRecipeData(existing, recipeToSave);
            await db.meals.update(existing.id, merged);
            await db.importQueue.update(item.id, { status: 'done', error: null });
            succeeded++;
          } else {
            // Different recipe, same name — rename and add
            const uniqueName = `${recipeToSave.name} (imported ${new Date().toLocaleDateString()})`;
            await db.meals.add({ ...recipeToSave, name: uniqueName, createdAt: recipeToSave.createdAt || recipeToSave.created || new Date().toISOString() });
            await db.importQueue.update(item.id, { status: 'done', error: null });
            succeeded++;
          }
          continue;
        }

        // Add to meals
        await db.meals.add({ ...recipeToSave, createdAt: recipeToSave.createdAt || recipeToSave.created || new Date().toISOString() });
        await db.importQueue.update(item.id, { status: 'done', error: null });
        succeeded++;
      } catch (err) {
        failed++;
        const newAttempt = (item.attemptCount || 0) + 1;
        const willRetry = newAttempt < 3;
        await db.importQueue.update(item.id, {
          status: willRetry ? 'pending' : 'failed',
          error: err.message,
          attemptCount: newAttempt,
        });
      }
    }

    return { processed: queued.length, succeeded, failed };
  } catch (error) {
    console.error('[SpiceHub DB] processImportQueue failed:', error);
    throw new Error('Failed to process import queue. Try again later.');
  }
}

export async function retryFailedImports() {
  const failed = await db.importQueue.where('status').equals('failed').toArray();
  for (const item of failed) {
    await db.importQueue.update(item.id, {
      status: 'pending',
      error: null,
      attemptCount: 0,
    });
  }
  return failed.length;
}

export async function clearQueueItem(id) {
  await db.importQueue.delete(id);
}

export async function clearCompletedImports() {
  await db.importQueue.where('status').equals('done').delete();
}

// ── Batch Import Queue helpers ────────────────────────────────────────────
export async function addBatchQueueItems(urls) {
  const now = Date.now();
  const ids = [];
  for (const url of urls) {
    const id = await db.batchQueue.add({
      url,
      status: 'pending',
      itemType: 'meal',
      itemTypeUserOverride: false,
      recipe: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    });
    ids.push(id);
  }
  return ids;
}

export async function getBatchQueueItems() {
  return db.batchQueue.orderBy('createdAt').toArray();
}

export async function getNextPendingBatchItem() {
  return db.batchQueue.where('status').equals('pending').first();
}

export async function updateBatchQueueItem(id, changes) {
  await db.batchQueue.update(id, { ...changes, updatedAt: Date.now() });
}

export async function setBatchItemType(id, itemType) {
  await db.batchQueue.update(id, {
    itemType,
    itemTypeUserOverride: true,
    updatedAt: Date.now(),
  });
}

export async function deleteBatchQueueItem(id) {
  await db.batchQueue.delete(id);
}

export async function clearFinishedBatchItems() {
  await db.batchQueue.where('status').equals('saved').delete();
}

export async function recoverStuckBatchItems() {
  const stuck = await db.batchQueue.where('status').equals('extracting').toArray();
  for (const item of stuck) {
    await db.batchQueue.update(item.id, { status: 'pending', updatedAt: Date.now() });
  }
  return stuck.length;
}

// ── Rotation helpers ─────────────────────────────────────────────────────────
export async function toggleRotation(mealId, inRotation) {
  await db.meals.update(mealId, { inRotation });
}

export async function getRotationMeals() {
  const all = await db.meals.toArray();
  return all.filter(m => m.inRotation);
}

export async function bulkSetRotation(mealIds, inRotation) {
  // Single indexed-scan write instead of one update() per id (N+1 writes).
  if (!Array.isArray(mealIds) || mealIds.length === 0) return;
  await db.meals.where('id').anyOf(mealIds).modify({ inRotation });
}

// ── Week History helpers ─────────────────────────────────────────────────────
export async function saveWeekToHistory(weekStart, weekPlan) {
  // weekStart is ISO string of the Monday of that week
  // Only save if there are actual meals
  if (!weekPlan.some(Boolean)) return;

  // Check if we already have this week
  const existing = await db.weekHistory.where('weekStart').equals(weekStart).first();
  if (existing) {
    await db.weekHistory.update(existing.id, { meals: weekPlan, savedAt: new Date().toISOString() });
  } else {
    await db.weekHistory.add({ weekStart, meals: weekPlan, savedAt: new Date().toISOString() });
  }
}

export async function getWeekHistory(limit = 12) {
  const all = await db.weekHistory.orderBy('weekStart').reverse().toArray();
  return all.slice(0, limit);
}

export async function deleteWeekFromHistory(id) {
  await db.weekHistory.delete(id);
}

// ── Meal ↔ Bar transfer (2026-07-14) ──────────────────────────────────────────
// Corrects mis-imported recipes that landed in the wrong library — e.g. a
// drink saved to db.meals before the import-type-routing fix. Moves the full
// record across tables (drinks/meals get their own auto-increment id, so the
// old id is dropped) and stamps the type fields so downstream code (CookMode
// vs MixMode routing, ImportReview's isDrink check) treats it correctly going
// forward.
// Both moves used to add() to the destination table and delete() from the
// source table as two independent awaits. If the tab closed, crashed, or lost
// power between the two (exactly the kind of interruption these corrections
// exist to recover from), the record could end up added to the destination
// but never removed from the source — a permanent duplicate with no guard
// against the same move being retried later. Wrapping both steps in one Dexie
// transaction makes them commit or roll back together.
export async function moveMealToBar(meal) {
  if (!meal || !meal.id) throw new Error('moveMealToBar: meal with id required');
  const { id, ...rest } = meal;
  return db.transaction('rw', db.meals, db.drinks, async () => {
    const newId = await db.drinks.add({ ...rest, itemType: 'drink', _type: 'drink', type: 'drink' });
    await db.meals.delete(id);
    return newId;
  });
}

export async function moveDrinkToMeals(drink) {
  if (!drink || !drink.id) throw new Error('moveDrinkToMeals: drink with id required');
  const { id, ...rest } = drink;
  return db.transaction('rw', db.meals, db.drinks, async () => {
    const newId = await db.meals.add({ ...rest, itemType: 'meal', _type: 'meal', type: 'meal' });
    await db.drinks.delete(id);
    return newId;
  });
}

// ── Instagram import cache ────────────────────────────────────────────────────
const INSTAGRAM_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Cache key is type-aware: a URL imported as a drink and the same URL imported
// as a meal must never collide. Primary key on the `instagramCache` store is
// still a plain string (`url, cachedAt` — no schema/version bump needed; a
// longer composite string is still just a string).
function cacheKey(url, type = 'meal') {
  return `${url}::${type || 'meal'}`;
}

export async function getCachedInstagramRecipe(url, type = 'meal') {
  try {
    const key = cacheKey(url, type);
    const entry = await db.instagramCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > INSTAGRAM_CACHE_TTL_MS) {
      await db.instagramCache.delete(key);
      return null;
    }
    return entry.recipe;
  } catch (e) {
    console.warn('[SpiceHub DB] instagramCache get failed:', e);
    return null;
  }
}

export async function cacheInstagramRecipe(url, recipe, type = 'meal') {
  try {
    await db.instagramCache.put({ url: cacheKey(url, type), recipe, cachedAt: Date.now() });
  } catch (e) {
    console.warn('[SpiceHub DB] instagramCache put failed:', e);
  }
}

export async function clearInstagramCache() {
  try {
    await db.instagramCache.clear();
  } catch (e) {
    console.warn('[SpiceHub DB] instagramCache clear failed:', e);
  }
}

// ── Generic import cache helpers (aliases over instagramCache for unified use) ──
// Used by importFromInstagram and importFromTikTok in recipeParser.js.
export const getCachedImport   = getCachedInstagramRecipe;
export const setCachedImport   = cacheInstagramRecipe;

export async function importSeedMeals(seedMeals) {
  try {
    const existing = await db.meals.toArray();
    const existingNames = new Set(existing.map(m => m.name.toLowerCase().trim()));
    const toAdd = [];
    let skipped = 0;

    for (const meal of seedMeals) {
      if (existingNames.has(meal.name.toLowerCase().trim())) {
        skipped++;
        continue;
      }
      existingNames.add(meal.name.toLowerCase().trim());
      toAdd.push(meal);
    }

    if (toAdd.length > 0) {
      await db.meals.bulkAdd(toAdd);
    }

    return { imported: toAdd.length, skipped, total: seedMeals.length };
  } catch (error) {
    console.error('[SpiceHub DB] importSeedMeals failed:', error);
    throw new Error('Failed to import seed meals. Your data is safe — try again.');
  }
}

// Bulk-removes the "Starter Kit" pre-seeded recipes (see data/starterKitMeals.js).
// Only touches meals explicitly tagged starterKit:true — never a user's own
// imports or manually-added recipes. Returns the number removed.
export async function removeStarterKitMeals() {
  try {
    const ids = await db.meals.filter(m => m.starterKit === true).primaryKeys();
    if (ids.length > 0) {
      await db.meals.bulkDelete(ids);
    }
    return ids.length;
  } catch (error) {
    console.error('[SpiceHub DB] removeStarterKitMeals failed:', error);
    throw new Error('Failed to remove starter kit recipes. Your data is safe — try again.');
  }
}

export async function safeGetMeal(id) {
  try {
    return await db.meals.get(id);
  } catch {
    return null;
  }
}



export async function getTableStats() {
  const stats = {
    meals: 0,
    drinks: 0,
    weekPlan: 0,
    groceryItems: 0,
    storeMemory: 0,
    cookingLog: 0,
    importQueue: 0,
    storageMetadata: 0,
  };

  const tables = Object.keys(stats);
  for (const tableName of tables) {
    if (!db[tableName]) continue;
    try {
      const items = await db[tableName].toArray();
      const jsonStr = JSON.stringify(items);
      stats[tableName] = new Blob([jsonStr]).size;
    } catch (error) {
      console.warn(`Failed to calculate size for ${tableName}:`, error);
    }
  }

  return stats;
}
