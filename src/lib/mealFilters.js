import { normalizeMealCategory } from '../recipeSchema';

// A meal counts as a dessert when its category normalizes to "Desserts" or the
// importer tagged its course "dessert": the two fields the rest of the app
// already uses (recipeSchema MEAL_TYPE_CATEGORIES / COURSE). No new list.
export function isDessert(meal) {
  if (!meal) return false;
  if (normalizeMealCategory(meal.category) === 'Desserts') return true;
  return String(meal.course || '').trim().toLowerCase() === 'dessert';
}

// Text match used by every "pick a meal for this day" list: name, category or
// label contains the query (case-insensitive). A blank query matches everything.
export function matchesMealQuery(meal, query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return true;
  return !!(
    meal?.name?.toLowerCase().includes(q) ||
    meal?.category?.toLowerCase().includes(q) ||
    (Array.isArray(meal?.labels) && meal.labels.some(l => String(l).toLowerCase().includes(q)))
  );
}
