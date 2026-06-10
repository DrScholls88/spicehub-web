import { useState, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Spring-like easing shared across review animations (spec §1)
const SPRING_EASE = [0.32, 0.72, 0, 1];
const ROW_LAYOUT_TRANSITION = { layout: { duration: 0.25, ease: SPRING_EASE } };

/**
 * Misplaced-ingredient heuristic (2026-06-09 CX review):
 * a "step" that starts with [number] + [unit] + [noun] and lacks an
 * imperative cooking verb is almost certainly an ingredient line.
 */
const UNIT_RE = /^\s*\d[\d/.\s-]*\s*(x\s*)?(g|kg|oz|lbs?|ml|l|cups?|tbsp|tsp|tablespoons?|teaspoons?|cloves?|cans?|packs?|packets?|blocks?|bricks?|bunch(?:es)?|slices?|pieces?|sticks?|pinch(?:es)?|handfuls?|sprigs?|fillets?|stalks?|heads?|jars?|bottles?|dash(?:es)?)\b/i;
const BARE_QTY_RE = /^\s*\d[\d/.\s-]*\s+(?:of\s+)?[a-z]/i;
const TIME_TEMP_RE = /\b(min(?:ute)?s?|hours?|hrs?|sec(?:ond)?s?|degrees?|°|until|then|while|when)\b/i;
const IMPERATIVE_RE = /^\s*(heat|add|mix|stir|combine|slice|chop|dice|boil|simmer|bake|preheat|cook|whisk|pour|serve|drain|season|toss|fry|saute|sauté|grill|roast|blend|marinate|garnish|remove|place|bring|reduce|let|cover|transfer|fold|knead|rest|chill|melt|cut|mince|press|squeeze|top|set|prepare|repeat|fill|shake|strain|muddle|rim|build|spread|sprinkle|layer|arrange|divide|enjoy)\b/i;

export function looksMisplacedIngredient(line) {
  if (!line || typeof line !== 'string') return false;
  const s = line.trim();
  if (s.length < 3 || s.length > 90) return false;
  if (IMPERATIVE_RE.test(s)) return false;
  if (UNIT_RE.test(s)) return true;
  return BARE_QTY_RE.test(s) && !TIME_TEMP_RE.test(s);
}

/**
 * AccordionSection — collapsible section used within ImportReview.
 */
function AccordionSection({ icon, title, count, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`review-accordion${open ? ' open' : ' collapsed'}`}>
      <div className="review-accordion-head" onClick={() => setOpen((v) => !v)}>
        <span className="review-accordion-label">
          {icon && <span className="review-accordion-icon">{icon}</span>}
          {title}
          {count != null && <span className="review-accordion-count">{count}</span>}
        </span>
        <motion.span
          className="review-accordion-chevron"
          animate={{ rotate: open ? 0 : -90 }}
          transition={{ duration: 0.2, ease: SPRING_EASE }}
        >&#9660;</motion.span>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: SPRING_EASE }}
            style={{ overflow: 'hidden' }}
          >
            <div className="review-accordion-body">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * ListItem — a single editable list row (ingredient or step).
 * Shows a drag handle, text input, and remove button.
 */
function ListItem({ value, index, onChange, onRemove, stepNum, onMoveUp, onMoveDown, isFirst, isLast, listName, onDragStart, onDragOver, onDrop, onDragEnd, flagged, onFlagAction }) {
  return (
    <motion.div
      layout="position"
      transition={ROW_LAYOUT_TRANSITION}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -28, height: 0, marginTop: 0, marginBottom: 0 }}
      className="review-row"
      draggable
      onDragStart={(e) => onDragStart?.(listName, index, e)}
      onDragOver={(e) => onDragOver?.(e)}
      onDrop={(e) => onDrop?.(listName, index, e)}
      onDragEnd={(e) => onDragEnd?.(e)}
    >
      {stepNum != null ? (
        <span className="review-step-num">{stepNum}</span>
      ) : (
        <span className="review-row-handle">&#9776;</span>
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(index, e.target.value)}
      />
      <button
        className="review-row-reorder"
        onClick={() => onMoveUp?.(index)}
        disabled={isFirst}
        aria-label="Move up"
        title="Move up"
      >&#9650;</button>
      <button
        className="review-row-reorder"
        onClick={() => onMoveDown?.(index)}
        disabled={isLast}
        aria-label="Move down"
        title="Move down"
      >&#9660;</button>
      <button
        className="review-row-more"
        onClick={() => onRemove(index)}
        aria-label="Remove"
      >
        &times;
      </button>
      {flagged && (
        <button
          className="review-flag-chip"
          onClick={() => onFlagAction?.(index)}
          aria-label="Move to ingredients"
        >
          Ingredient? &#8593;
        </button>
      )}
    </motion.div>
  );
}

/**
 * ImportReview — review and edit surface for a parsed recipe.
 *
 * Props:
 *   recipe      — parsed recipe object
 *   onChange     — callback to update the recipe object
 *   onSave      — callback with final recipe + destination
 *   confidence  — extraction confidence score (0-1)
 */
export default function ImportReview({ recipe, onChange, onSave, confidence }) {
  const [destination, setDestination] = useState('library'); // 'library' | 'week' | 'grocery' | 'bar'
  // F.6: sticky tab-basket hybrid — one list visible at a time
  const [activeTab, setActiveTab] = useState('ingredients'); // 'ingredients' | 'directions'
  const [tabDragOver, setTabDragOver] = useState(null); // tab key being dragged over

  const isDrink = recipe?.type === 'drink' || recipe?.itemType === 'drink';

  // ── Stable row IDs ───────────────────────────────────────────────────────
  // Lists are plain strings, so index keys would defeat framer-motion layout
  // animations (and content keys would remount inputs on every keystroke).
  // We track a parallel array of opaque ids per list; every mutation below
  // updates ids in lockstep so a row keeps its key as it moves.
  const idCounterRef = useRef(0);
  const rowIdsRef = useRef({ ingredients: [], directions: [] });
  const nextRowId = useCallback(() => `row-${++idCounterRef.current}`, []);

  // Render-time reconcile: external changes (new recipe object) get fresh ids
  const syncRowIds = (field, len) => {
    const arr = rowIdsRef.current[field];
    while (arr.length < len) arr.push(nextRowId());
    if (arr.length > len) arr.length = len;
    return arr;
  };
  const ingredientIds = syncRowIds('ingredients', (recipe?.ingredients || []).length);
  const directionIds = syncRowIds('directions', (recipe?.directions || []).length);

  // ── Field helpers ────────────────────────────────────────────────────────
  const updateField = useCallback((field, value) => {
    onChange({ ...recipe, [field]: value });
  }, [recipe, onChange]);

  const updateListItem = useCallback((field, index, value) => {
    const list = [...(recipe[field] || [])];
    list[index] = value;
    onChange({ ...recipe, [field]: list });
  }, [recipe, onChange]);

  const removeListItem = useCallback((field, index) => {
    const list = [...(recipe[field] || [])];
    list.splice(index, 1);
    rowIdsRef.current[field].splice(index, 1);
    onChange({ ...recipe, [field]: list });
  }, [recipe, onChange]);

  const addListItem = useCallback((field) => {
    const list = [...(recipe[field] || []), ''];
    rowIdsRef.current[field].push(nextRowId());
    onChange({ ...recipe, [field]: list });
  }, [recipe, onChange, nextRowId]);

  // ── Reorder helpers ──────────────────────────────────────────────────────
  const moveListItem = useCallback((field, index, direction) => {
    const list = [...(recipe[field] || [])];
    const newIdx = direction === 'up' ? index - 1 : index + 1;
    if (newIdx < 0 || newIdx >= list.length) return;
    [list[index], list[newIdx]] = [list[newIdx], list[index]];
    const ids = rowIdsRef.current[field];
    [ids[index], ids[newIdx]] = [ids[newIdx], ids[index]];
    onChange({ ...recipe, [field]: list });
  }, [recipe, onChange]);

  const [dragSrc, setDragSrc] = useState(null); // { listName, idx }

  const handleDragStart = useCallback((listName, idx, e) => {
    setDragSrc({ listName, idx });
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.style.opacity = '0.45';
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((listName, dropIdx, e) => {
    e.preventDefault();
    if (!dragSrc) return;
    if (dragSrc.listName === listName) {
      // Same-list reorder
      const list = [...(recipe[listName] || [])];
      const [item] = list.splice(dragSrc.idx, 1);
      list.splice(dropIdx, 0, item);
      const ids = rowIdsRef.current[listName];
      const [id] = ids.splice(dragSrc.idx, 1);
      ids.splice(dropIdx, 0, id);
      onChange({ ...recipe, [listName]: list });
    } else {
      // Cross-section move
      const fromList = [...(recipe[dragSrc.listName] || [])];
      const toList = [...(recipe[listName] || [])];
      const [item] = fromList.splice(dragSrc.idx, 1);
      toList.splice(dropIdx, 0, item);
      const [id] = rowIdsRef.current[dragSrc.listName].splice(dragSrc.idx, 1);
      rowIdsRef.current[listName].splice(dropIdx, 0, id);
      onChange({ ...recipe, [dragSrc.listName]: fromList, [listName]: toList });
    }
    setDragSrc(null);
  }, [dragSrc, recipe, onChange]);

  const handleDragEnd = useCallback((e) => {
    e.currentTarget.style.opacity = '';
    setDragSrc(null);
    setTabDragOver(null);
  }, []);

  // F.6: dropping a dragged row onto the other tab moves it to that list's end
  const handleTabDrop = useCallback((targetList, e) => {
    e.preventDefault();
    setTabDragOver(null);
    if (!dragSrc || dragSrc.listName === targetList) return;
    const fromList = [...(recipe[dragSrc.listName] || [])];
    const toList = [...(recipe[targetList] || [])];
    const [item] = fromList.splice(dragSrc.idx, 1);
    if (item == null) return;
    toList.push(item);
    const [id] = rowIdsRef.current[dragSrc.listName].splice(dragSrc.idx, 1);
    rowIdsRef.current[targetList].push(id);
    onChange({ ...recipe, [dragSrc.listName]: fromList, [targetList]: toList });
    setDragSrc(null);
  }, [dragSrc, recipe, onChange]);

  // ── Misplaced-ingredient flags (steps that look like ingredient lines) ───
  const flaggedSteps = useMemo(
    () => (recipe?.directions || []).reduce((acc, line, i) => {
      if (looksMisplacedIngredient(line)) acc.push(i);
      return acc;
    }, []),
    [recipe?.directions],
  );

  const moveStepToIngredients = useCallback((index) => {
    const directions = [...(recipe.directions || [])];
    const [item] = directions.splice(index, 1);
    if (item == null) return;
    const [id] = rowIdsRef.current.directions.splice(index, 1);
    rowIdsRef.current.ingredients.push(id);
    onChange({ ...recipe, directions, ingredients: [...(recipe.ingredients || []), item] });
  }, [recipe, onChange]);

  const moveAllFlaggedToIngredients = useCallback(() => {
    const dirs = recipe.directions || [];
    const dirIds = rowIdsRef.current.directions;
    const directions = []; const moved = [];
    const keepIds = []; const movedIds = [];
    dirs.forEach((line, i) => {
      if (looksMisplacedIngredient(line)) {
        moved.push(line); movedIds.push(dirIds[i]);
      } else {
        directions.push(line); keepIds.push(dirIds[i]);
      }
    });
    if (!moved.length) return;
    rowIdsRef.current.directions = keepIds;
    rowIdsRef.current.ingredients = [...rowIdsRef.current.ingredients, ...movedIds];
    onChange({ ...recipe, directions, ingredients: [...(recipe.ingredients || []), ...moved] });
  }, [recipe, onChange]);

  // ── Confidence chip — honest badge: visible flags override raw score ─────
  const hasFlags = flaggedSteps.length > 0;
  const confLabel = hasFlags ? 'Review needed'
    : confidence >= 0.7 ? 'High' : confidence >= 0.4 ? 'Medium' : 'Low';

  // ── Save destinations ────────────────────────────────────────────────────
  const destinations = isDrink
    ? [
        { key: 'library', label: 'Library' },
        { key: 'bar', label: 'Bar' },
      ]
    : [
        { key: 'library', label: 'Library' },
        { key: 'week', label: 'This Week' },
        { key: 'grocery', label: 'Grocery' },
      ];

  const handleSave = useCallback(() => {
    const finalRecipe = { ...recipe, _saveDestination: destination };
    onSave(finalRecipe);
  }, [recipe, destination, onSave]);

  if (!recipe) return null;

  const confLevel = hasFlags ? 'review'
    : confidence >= 0.7 ? 'high' : confidence >= 0.4 ? 'medium' : 'low';

  return (
    <div className="import-review">
      {/* Hero image + title + confidence */}
      <motion.div
        className="review-hero"
        style={recipe.image ? { backgroundImage: `url(${recipe.image})` } : undefined}
        initial={{ opacity: 0, scale: 1.03 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35, ease: SPRING_EASE }}
      >
        {!recipe.image && <div className="review-hero-placeholder">🍽️</div>}
        <div className="review-hero-gradient" />
        {(confidence != null || hasFlags) && (
          <span className={`review-confidence review-confidence-${confLevel}`}>
            {hasFlags ? '⚠ Review needed' : `${confLabel} ${Math.round(confidence * 100)}%`}
          </span>
        )}
        <div className="review-hero-title-wrap">
          <input
            className="review-hero-title"
            type="text"
            value={recipe.title || ''}
            onChange={(e) => updateField('title', e.target.value)}
            placeholder="Recipe title"
          />
        </div>
      </motion.div>

      {/* F.6: sticky segmented tabs with live counters.
          The inactive tab doubles as a drop zone for cross-section moves. */}
      <div className="review-tabs">
        {[
          { key: 'ingredients', label: '🥕 Ingredients' },
          { key: 'directions', label: '📝 Steps' },
        ].map((t) => (
          <button
            key={t.key}
            className={`review-tab${activeTab === t.key ? ' active' : ''}${tabDragOver === t.key ? ' drag-over' : ''}${t.key === 'directions' && hasFlags ? ' flagged' : ''}`}
            onClick={() => setActiveTab(t.key)}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragSrc && dragSrc.listName !== t.key) setTabDragOver(t.key);
            }}
            onDragLeave={() => setTabDragOver((v) => (v === t.key ? null : v))}
            onDrop={(e) => handleTabDrop(t.key, e)}
          >
            {t.label}
            <motion.span
              key={(recipe[t.key] || []).length}
              className="review-tab-count"
              initial={{ scale: 1.4, opacity: 0.5 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.2 }}
            >
              {(recipe[t.key] || []).length}
            </motion.span>
          </button>
        ))}
      </div>

      {/* Active list */}
      {activeTab === 'ingredients' ? (
        <div className="review-list">
          <AnimatePresence initial={false}>
            {(recipe.ingredients || []).map((item, i) => (
              <ListItem
                key={ingredientIds[i]}
                value={item}
                index={i}
                onChange={(idx, val) => updateListItem('ingredients', idx, val)}
                onRemove={(idx) => removeListItem('ingredients', idx)}
                onMoveUp={(idx) => moveListItem('ingredients', idx, 'up')}
                onMoveDown={(idx) => moveListItem('ingredients', idx, 'down')}
                isFirst={i === 0}
                isLast={i === (recipe.ingredients || []).length - 1}
                listName="ingredients"
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
              />
            ))}
          </AnimatePresence>
          <button
            className="review-add-row"
            onClick={() => addListItem('ingredients')}
          >
            + Add ingredient
          </button>
        </div>
      ) : (
        <div className="review-list">
          <AnimatePresence initial={false}>
            {hasFlags && (
              <motion.div
                key="flag-banner"
                className="review-flag-banner"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: SPRING_EASE }}
                style={{ overflow: 'hidden' }}
              >
                <span>
                  Looks like {flaggedSteps.length === 1
                    ? 'an ingredient slipped'
                    : `${flaggedSteps.length} ingredients slipped`} into the steps.
                </span>
                <button onClick={moveAllFlaggedToIngredients}>
                  Move {flaggedSteps.length === 1 ? 'it' : 'all'} to Ingredients
                </button>
              </motion.div>
            )}
            {(recipe.directions || []).map((item, i) => (
              <ListItem
                key={directionIds[i]}
                value={item}
                index={i}
                stepNum={i + 1}
                onChange={(idx, val) => updateListItem('directions', idx, val)}
                onRemove={(idx) => removeListItem('directions', idx)}
                onMoveUp={(idx) => moveListItem('directions', idx, 'up')}
                onMoveDown={(idx) => moveListItem('directions', idx, 'down')}
                isFirst={i === 0}
                isLast={i === (recipe.directions || []).length - 1}
                listName="directions"
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                flagged={flaggedSteps.includes(i)}
                onFlagAction={moveStepToIngredients}
              />
            ))}
          </AnimatePresence>
          <button
            className="review-add-row"
            onClick={() => addListItem('directions')}
          >
            + Add step
          </button>
        </div>
      )}

      {/* Drink-specific fields */}
      {isDrink && (
        <AccordionSection icon="🍸" title="Drink Details" defaultOpen={false}>
          <div className="review-drink-fields">
            <label>Glass</label>
            <input
              type="text"
              value={recipe.glass || ''}
              onChange={(e) => updateField('glass', e.target.value)}
              placeholder="e.g. Rocks, Coupe, Highball"
            />
            <label>Garnish</label>
            <input
              type="text"
              value={recipe.garnish || ''}
              onChange={(e) => updateField('garnish', e.target.value)}
              placeholder="e.g. Lemon twist, Cherry"
            />
            <label>Technique</label>
            <input
              type="text"
              value={recipe.technique || ''}
              onChange={(e) => updateField('technique', e.target.value)}
              placeholder="e.g. Shaken, Stirred, Built"
            />
          </div>
        </AccordionSection>
      )}

      {/* Notes */}
      <AccordionSection icon="📋" title="Notes" defaultOpen={false}>
        <textarea
          className="review-notes"
          value={recipe.notes || ''}
          onChange={(e) => updateField('notes', e.target.value)}
          placeholder="Any notes about this recipe..."
          rows={3}
        />
      </AccordionSection>

      {/* Save destination grid */}
      <div className="review-destination">
        <p className="review-destination-label">Save to</p>
        <div className="review-destination-grid">
          {destinations.map((d) => (
            <motion.button
              key={d.key}
              className={`review-dest-card${destination === d.key ? ' active' : ''}`}
              onClick={() => setDestination(d.key)}
              whileTap={{ scale: 0.95 }}
              transition={{ duration: 0.1 }}
            >
              <span className="review-dest-icon">
                {d.key === 'library' ? '📚' : d.key === 'week' ? '📅' : d.key === 'grocery' ? '🛒' : '🍹'}
              </span>
              <span className="review-dest-label">{d.label}</span>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}
