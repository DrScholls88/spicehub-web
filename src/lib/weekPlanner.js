// =============================================================================
// weekPlanner.js — A-1 Smart Weekly Auto-Plan scoring engine
// -----------------------------------------------------------------------------
// Pure, offline, unit-testable. ZERO imports, no DOM, no network, no secrets.
// Given a pool of rotation meals it produces a balanced 7-day dinner plan that:
//   • prefers dinner/main-course recipes for dinner slots,
//   • spreads cuisines so adjacent nights don't repeat,
//   • surfaces meals you haven't cooked recently and rests ones you just made,
//   • respects a weeknight time budget (Mon–Thu = quick, Fri–Sun = projects ok),
//   • honors an optional household dietary preference, and
//   • adds a touch of jitter so re-rolling the same week varies.
//
// The scoring is deliberately additive and bounded so signals compose
// predictably. Every field on a meal is treated as optional — missing data
// never throws and simply contributes a neutral (zero) score for that signal.
// =============================================================================

// ── Tunable weights (kept in one place so behavior is easy to reason about) ──
const W = {
  courseDinner: 4,      // bonus when the meal reads as a dinner/main
  courseWrong: -3,      // penalty for clearly non-dinner courses (dessert/side/etc.)
  cuisineAdjacent: -6,  // penalty when an adjacent slot shares this cuisine
  cuisineRepeat: -2,    // mild penalty per other slot already using this cuisine
  recencyFresh: 5,      // boost for meals never cooked / cooked 30+ days ago
  recencyMid: 1,        // small boost for 14–30 days
  recencyRecent: -6,    // penalty for meals cooked in the last ~7 days
  recencyWarm: -2,      // mild penalty for 7–14 days
  timeFit: 3,           // bonus when the meal fits the slot's time budget
  timeMiss: -3,         // penalty when a weeknight meal blows the budget
  dietaryMatch: 4,      // bonus when meal satisfies the preferred dietary tag
  dietaryViolate: -40,  // large penalty when meal violates an exclusion pref
  jitter: 2.5,          // +/- random spread to vary re-rolls
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKNIGHT_MAX_MIN = 40; // Mon–Thu target ceiling for total time

// Courses that read as a sensible dinner. Anything outside this that is a clearly
// non-dinner course (dessert/side/sauce/etc.) is gently down-weighted but never
// hard-excluded — a small rotation should still fill the week.
const DINNER_COURSES = new Set(['dinner', 'main', 'main course', 'lunch', 'supper', 'entree', 'entrée']);
const NON_DINNER_COURSES = new Set(['dessert', 'side', 'sauce', 'condiment', 'snack', 'drink', 'baked good', 'appetizer']);

// -----------------------------------------------------------------------------
// parseTotalMinutes — best-effort duration parser
// -----------------------------------------------------------------------------
// Accepts the messy time strings recipes carry: "40 min", "1 hr", "1 hour 10 min",
// "1h", "PT45M" (ISO-8601 duration), bare numbers, and React-safe nullish input.
// Returns total minutes as a Number, or null when nothing numeric is found.
export function parseTotalMinutes(str) {
  if (str == null) return null;
  if (typeof str === 'number') return Number.isFinite(str) ? str : null;
  const s = String(str).trim().toLowerCase();
  if (!s) return null;

  // ISO-8601 duration, e.g. "PT1H30M" / "PT45M"
  const iso = s.match(/^pt(?:(\d+)h)?(?:(\d+)m)?$/i);
  if (iso && (iso[1] || iso[2])) {
    const h = parseInt(iso[1] || '0', 10);
    const m = parseInt(iso[2] || '0', 10);
    return h * 60 + m;
  }

  let total = 0;
  let matched = false;

  // Hours: "1 hour", "2 hrs", "1h"
  const hrMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  if (hrMatch) { total += parseFloat(hrMatch[1]) * 60; matched = true; }

  // Minutes: "10 min", "45 minutes", "30m"
  const minMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/);
  if (minMatch) { total += parseFloat(minMatch[1]); matched = true; }

  if (matched) return Math.round(total);

  // Bare number — assume minutes ("40" → 40)
  const bare = s.match(/^(\d+(?:\.\d+)?)$/);
  if (bare) return Math.round(parseFloat(bare[1]));

  return null;
}

// -----------------------------------------------------------------------------
// buildRecencyMap — mealId → ms since last cooked (Infinity if never cooked)
// -----------------------------------------------------------------------------
// Consumes the cookingLog array ({ mealId, cookedAt }) from db.getCookingLog().
// Keeps the most-recent cookedAt per meal. Robust to malformed rows.
export function buildRecencyMap(cookingLog = [], now = Date.now()) {
  const map = new Map();
  if (!Array.isArray(cookingLog)) return map;
  for (const entry of cookingLog) {
    if (!entry || entry.mealId == null) continue;
    const t = Date.parse(entry.cookedAt);
    if (Number.isNaN(t)) continue;
    const age = Math.max(0, now - t);
    const prev = map.get(entry.mealId);
    // Smaller age = more recent. Keep the smallest (most recent) age.
    if (prev === undefined || age < prev) map.set(entry.mealId, age);
  }
  return map;
}

// ── Internal helpers ─────────────────────────────────────────────────────────
function normStr(v) {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

function mealCuisine(meal) {
  return normStr(meal?.cuisine);
}

function mealDietaryTags(meal) {
  const tags = meal?.dietaryTags;
  if (Array.isArray(tags)) return tags.map(normStr).filter(Boolean);
  return [];
}

// Pull the most representative total time in minutes from whatever fields exist.
function mealTotalMinutes(meal) {
  if (!meal) return null;
  const total = parseTotalMinutes(meal.totalTime);
  if (total != null) return total;
  // Fall back to prep + cook when no explicit total is present.
  const prep = parseTotalMinutes(meal.prepTime);
  const cook = parseTotalMinutes(meal.cookTime);
  if (prep != null || cook != null) return (prep || 0) + (cook || 0);
  return null;
}

// -----------------------------------------------------------------------------
// scoreMeal — additive score for placing `meal` at `slotIndex`
// -----------------------------------------------------------------------------
// ctx: { slotIndex, chosenSoFar (array[7] of meal|null), recencyMap, prefs, now }
// prefs: { dietary: '' | tag, mode: 'require'|'exclude' } — optional household pref.
//   - mode 'require' (default for positive tags like 'vegetarian'): boost matches.
//   - mode 'exclude': heavily penalize meals carrying the tag.
// Returns a Number; higher is a better fit. Pure aside from Math.random jitter.
export function scoreMeal(meal, ctx = {}) {
  if (!meal) return -Infinity;
  const {
    slotIndex = 0,
    chosenSoFar = [],
    recencyMap = new Map(),
    prefs = null,
    now = Date.now(),
  } = ctx;

  let score = 0;

  // ── Course fit (dinner planner) ──
  const course = normStr(meal.course);
  if (course) {
    if (DINNER_COURSES.has(course)) score += W.courseDinner;
    else if (NON_DINNER_COURSES.has(course)) score += W.courseWrong;
  }

  // ── Cuisine variety ──
  const cuisine = mealCuisine(meal);
  if (cuisine) {
    // Penalize sharing a cuisine with an immediately adjacent (already-chosen) slot.
    const prev = chosenSoFar[slotIndex - 1];
    const next = chosenSoFar[slotIndex + 1];
    if (prev && mealCuisine(prev) === cuisine) score += W.cuisineAdjacent;
    if (next && mealCuisine(next) === cuisine) score += W.cuisineAdjacent;
    // Mild penalty for every other slot in the week already using this cuisine.
    let repeats = 0;
    for (let i = 0; i < chosenSoFar.length; i++) {
      if (i === slotIndex - 1 || i === slotIndex + 1) continue; // already counted
      const m = chosenSoFar[i];
      if (m && mealCuisine(m) === cuisine) repeats++;
    }
    score += repeats * W.cuisineRepeat;
  }

  // ── Recency ──
  const age = recencyMap instanceof Map ? recencyMap.get(meal.id) : undefined;
  if (age === undefined || age === Infinity) {
    score += W.recencyFresh; // never cooked → fresh idea
  } else {
    const days = age / DAY_MS;
    if (days >= 30) score += W.recencyFresh;
    else if (days >= 14) score += W.recencyMid;
    else if (days >= 7) score += W.recencyWarm;
    else score += W.recencyRecent; // cooked in the last week → rest it
  }

  // ── Time budget ──
  const mins = mealTotalMinutes(meal);
  const isWeeknight = slotIndex >= 0 && slotIndex <= 3; // Mon–Thu
  if (mins != null) {
    if (isWeeknight) {
      score += mins <= WEEKNIGHT_MAX_MIN ? W.timeFit : W.timeMiss;
    } else {
      // Fri–Sun: longer "project" meals are welcome; give a small nudge to the
      // bigger cooks so they migrate toward the weekend.
      if (mins > WEEKNIGHT_MAX_MIN) score += W.timeFit;
    }
  }

  // ── Dietary preference ──
  if (prefs && prefs.dietary) {
    const want = normStr(prefs.dietary);
    const tags = mealDietaryTags(meal);
    const has = tags.includes(want);
    if (prefs.mode === 'exclude') {
      if (has) score += W.dietaryViolate; // meal carries an excluded tag
    } else {
      // require/boost mode
      if (has) score += W.dietaryMatch;
    }
  }

  // ── Jitter (keeps re-rolls lively without overriding strong signals) ──
  score += (Math.random() - 0.5) * 2 * W.jitter;

  return score;
}

// -----------------------------------------------------------------------------
// pickForSlot — best single rotation meal for one slot (reroll)
// -----------------------------------------------------------------------------
// Excludes meals already used elsewhere in currentPlan (and the slot's own
// current meal so a reroll actually changes something when possible).
// Returns a meal object or null when nothing eligible exists.
export function pickForSlot(rotationMeals = [], opts = {}) {
  const {
    slotIndex = 0,
    currentPlan = [],
    recencyMap = new Map(),
    prefs = null,
    now = Date.now(),
  } = opts;

  if (!Array.isArray(rotationMeals) || rotationMeals.length === 0) return null;

  const currentMeal = currentPlan[slotIndex];
  // IDs taken by OTHER slots (real meals, not special days).
  const takenIds = new Set();
  currentPlan.forEach((m, i) => {
    if (i !== slotIndex && m && !m._special && m.id != null) takenIds.add(m.id);
  });

  let candidates = rotationMeals.filter(m => m && m.id != null && !takenIds.has(m.id));
  // Prefer something different from what's already there, if alternatives exist.
  const differing = candidates.filter(m => !currentMeal || m.id !== currentMeal.id);
  if (differing.length > 0) candidates = differing;
  if (candidates.length === 0) return null;

  let best = null;
  let bestScore = -Infinity;
  for (const m of candidates) {
    const s = scoreMeal(m, { slotIndex, chosenSoFar: currentPlan, recencyMap, prefs, now });
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best;
}

// -----------------------------------------------------------------------------
// planWeek — greedily fill empty + unlocked slots with the best-scoring meals
// -----------------------------------------------------------------------------
// opts: { currentPlan (array[7]|undefined), recencyMap, prefs, now }
// Returns a NEW array[7]. Locked slots and already-filled slots are preserved
// untouched. No meal is used twice within the resulting week. Slots are filled
// in a quick→long, weeknight-first order so the strongest signals land on the
// constrained weeknight slots first.
export function planWeek(rotationMeals = [], opts = {}) {
  const {
    currentPlan = Array(7).fill(null),
    recencyMap = new Map(),
    prefs = null,
    now = Date.now(),
  } = opts;

  // Start from a copy of the current plan so locks/fills survive.
  const plan = Array.from({ length: 7 }, (_, i) => (currentPlan ? currentPlan[i] : null) || null);

  if (!Array.isArray(rotationMeals) || rotationMeals.length === 0) {
    return plan; // nothing to place
  }

  // Track meal ids already present (locked/manual) so we never duplicate.
  const usedIds = new Set();
  plan.forEach(m => { if (m && !m._special && m.id != null) usedIds.add(m.id); });

  // Slots we are allowed to (re)fill: empty AND not locked AND not a special day.
  const openSlots = [];
  for (let i = 0; i < 7; i++) {
    const m = plan[i];
    const isLocked = m && m._locked;
    const isFilled = !!m; // any non-null (meal or special) counts as filled
    if (!isFilled && !isLocked) openSlots.push(i);
  }

  // Fill weeknights (0–3) before weekends (4–6) so the tighter time budget gets
  // first pick of fast meals. Within each group keep natural day order.
  openSlots.sort((a, b) => {
    const aWk = a <= 3 ? 0 : 1;
    const bWk = b <= 3 ? 0 : 1;
    if (aWk !== bWk) return aWk - bWk;
    return a - b;
  });

  for (const slotIndex of openSlots) {
    let best = null;
    let bestScore = -Infinity;
    for (const meal of rotationMeals) {
      if (!meal || meal.id == null || usedIds.has(meal.id)) continue;
      const s = scoreMeal(meal, { slotIndex, chosenSoFar: plan, recencyMap, prefs, now });
      if (s > bestScore) { bestScore = s; best = meal; }
    }
    if (!best) break; // rotation exhausted — leave remaining slots empty
    plan[slotIndex] = best;
    usedIds.add(best.id);
  }

  return plan;
}

export default {
  parseTotalMinutes,
  buildRecencyMap,
  scoreMeal,
  pickForSlot,
  planWeek,
};
