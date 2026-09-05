/**
 * Auto-expand a textarea to fit its content (call on mount + onChange).
 * field-sizing:content (CSS) already does this on modern Chrome/Safari; this
 * stays as the universal fallback for browsers that don't support it yet.
 *
 * Shared between AddEditMeal.jsx and ImportReview.jsx so both screens'
 * auto-expanding fields (ingredient lines, step lines, notes, sauce rows)
 * behave identically instead of drifting apart as two local copies.
 */
export function autoExpand(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
