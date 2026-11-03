// ─────────────────────────────────────────────────────────────────────────────
// UNDO CLEANUP — reverse one line the deterministic cleanup moved or dropped.
//
// enforceDeterministicRules (recipeParser.js) records every line it moves
// between ingredients/directions, or drops as trash/nutrition, in
// recipe._postProcessAudit.{moved,filtered} as { from, to?, line, index, reason }.
// Review lists those lines; Undo hands one back here. Pure: returns a new
// recipe, never mutates the input.
// ─────────────────────────────────────────────────────────────────────────────

const sameEntry = (a, b) =>
  a === b || (a && b && a.from === b.from && a.to === b.to && a.line === b.line && a.reason === b.reason);

/** Remove the first entry matching `entry` (by identity or by fields). */
function withoutEntry(list, entry) {
  const arr = Array.isArray(list) ? list : [];
  const k = arr.findIndex((e) => sameEntry(e, entry));
  return k === -1 ? arr : [...arr.slice(0, k), ...arr.slice(k + 1)];
}

/**
 * @param {object} recipe — review recipe carrying _postProcessAudit
 * @param {{ from: 'ingredients'|'directions', to?: string, line: string, index?: number|null }} entry
 * @returns {object} new recipe with the line restored and the entry removed from the audit
 */
export function undoCleanup(recipe, entry) {
  if (!recipe || !entry?.line || (entry.from !== 'ingredients' && entry.from !== 'directions')) return recipe;
  const lists = {
    ingredients: [...(Array.isArray(recipe.ingredients) ? recipe.ingredients : [])],
    directions: [...(Array.isArray(recipe.directions) ? recipe.directions : [])],
  };

  // A moved line: take it out of where the cleanup put it (if still there).
  if (entry.to === 'ingredients' || entry.to === 'directions') {
    const k = lists[entry.to].indexOf(entry.line);
    if (k !== -1) lists[entry.to].splice(k, 1);
  }
  // Put it back in its original list, at its original position when known.
  const target = lists[entry.from];
  if (!target.includes(entry.line)) {
    const at = Number.isInteger(entry.index) ? Math.min(entry.index, target.length) : target.length;
    target.splice(at, 0, entry.line);
  }

  const audit = recipe._postProcessAudit || {};
  const isMove = !!entry.to;
  const moved = isMove ? withoutEntry(audit.moved, entry) : (audit.moved || []);
  const filtered = isMove ? (audit.filtered || []) : withoutEntry(audit.filtered, entry);
  return {
    ...recipe,
    ingredients: lists.ingredients,
    directions: lists.directions,
    _postProcessAudit: {
      ...audit,
      moved,
      filtered,
      movedCount: Math.max(0, (audit.movedCount ?? moved.length) - (isMove && moved !== audit.moved ? 1 : 0)),
      filteredCount: Math.max(0, (audit.filteredCount ?? filtered.length) - (!isMove && filtered !== audit.filtered ? 1 : 0)),
    },
  };
}
