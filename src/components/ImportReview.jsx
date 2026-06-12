import { useState, useCallback, useMemo, useRef, useEffect, useId } from 'react';
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion';
import {
  Carrot,
  ClipboardList,
  Library,
  CalendarDays,
  ShoppingCart,
  Wine,
  AlertTriangle,
  GripVertical,
  ChevronDown,
  UtensilsCrossed,
  NotebookPen,
  MoreVertical,
  ArrowUp,
  ArrowDown,
  Trash2,
  X,
} from 'lucide-react';

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
 * Fix 4: header is a real <button> for keyboard accessibility.
 */
function AccordionSection({ icon, title, count, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <div className={`review-accordion${open ? ' open' : ' collapsed'}`}>
      <button
        type="button"
        className="review-accordion-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', font: 'inherit', cursor: 'pointer' }}
      >
        <span className="review-accordion-label">
          {icon && <span className="review-accordion-icon">{icon}</span>}
          {title}
          {count != null && <span className="review-accordion-count">{count}</span>}
        </span>
        <motion.span
          className="review-accordion-chevron"
          animate={{ rotate: open ? 0 : -90 }}
          transition={{ duration: 0.2, ease: SPRING_EASE }}
        >
          <ChevronDown size={16} strokeWidth={2} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            id={bodyId}
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
 * RowMenu — single 44x44 overflow menu replacing the ▲▼× button cluster (Fix 2).
 */
function RowMenu({
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onRemove,
  onMoveToOtherList,
  moveToOtherListLabel,
  moveToOtherListIcon,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointer, true);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointer, true);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [open]);

  const runAndClose = (fn) => () => {
    fn?.();
    setOpen(false);
  };

  return (
    <div className="review-row-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="review-row-menu"
        aria-label="Row actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVertical size={20} strokeWidth={2} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="review-row-menu-list"
            role="menu"
            initial={{ opacity: 0, scale: 0.92, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: -4 }}
            transition={{ duration: 0.12, ease: SPRING_EASE }}
          >
            <button
              type="button"
              role="menuitem"
              className="review-row-menu-item"
              disabled={isFirst}
              onClick={runAndClose(onMoveUp)}
            >
              <ArrowUp size={16} strokeWidth={2} />
              Move up
            </button>
            <button
              type="button"
              role="menuitem"
              className="review-row-menu-item"
              disabled={isLast}
              onClick={runAndClose(onMoveDown)}
            >
              <ArrowDown size={16} strokeWidth={2} />
              Move down
            </button>
            {onMoveToOtherList && (
              <button
                type="button"
                role="menuitem"
                className="review-row-menu-item"
                onClick={runAndClose(onMoveToOtherList)}
              >
                {moveToOtherListIcon}
                {moveToOtherListLabel}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="review-row-menu-item review-row-menu-item-danger"
              onClick={runAndClose(onRemove)}
            >
              <Trash2 size={16} strokeWidth={2} />
              Remove
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * ListItem — a single editable list row (ingredient or step).
 * Fix 1: drag handled by framer-motion Reorder.Item via a dedicated handle.
 * Fix 2: ▲▼× cluster replaced with a single overflow menu.
 * Fix 3: emoji replaced with lucide icons.
 */
function ListItem({
  value,
  index,
  onChange,
  onRemove,
  stepNum,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  flagged,
  onFlagAction,
  onMoveToOtherList,
  moveToOtherListLabel,
  moveToOtherListIcon,
  rowId,
  onHandleDrag,
  onHandleDragEnd,
}) {
  const dragControls = useDragControls();
  const [dragging, setDragging] = useState(false);

  return (
    <Reorder.Item
      as="div"
      value={rowId}
      dragListener={false}
      dragControls={dragControls}
      layout="position"
      transition={ROW_LAYOUT_TRANSITION}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -28, height: 0, marginTop: 0, marginBottom: 0 }}
      whileDrag={{ opacity: 0.6, scale: 1.02 }}
      className={`review-row${dragging ? ' is-dragging' : ''}`}
      onDrag={(e, info) => {
        onHandleDrag?.(info);
      }}
      onDragEnd={(e, info) => {
        setDragging(false);
        onHandleDragEnd?.(info);
      }}
    >
      {stepNum != null && (
        <span className="review-step-num">{stepNum}</span>
      )}
      <span
        className="review-row-handle"
        onPointerDown={(e) => {
          setDragging(true);
          dragControls.start(e);
        }}
      >
        <GripVertical size={18} strokeWidth={2} />
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(index, e.target.value)}
      />
      {flagged && (
        <button
          className="review-flag-chip"
          onClick={() => onFlagAction?.(index)}
          aria-label="Move to ingredients"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          Ingredient? <ArrowUp size={13} strokeWidth={2.5} />
        </button>
      )}
      <RowMenu
        isFirst={isFirst}
        isLast={isLast}
        onMoveUp={() => onMoveUp?.(index)}
        onMoveDown={() => onMoveDown?.(index)}
        onRemove={() => onRemove?.(index)}
        onMoveToOtherList={onMoveToOtherList ? () => onMoveToOtherList(index) : null}
        moveToOtherListLabel={moveToOtherListLabel}
        moveToOtherListIcon={moveToOtherListIcon}
      />
    </Reorder.Item>
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
export default function ImportReview({ recipe, onChange, onSave, confidence, destination, setDestination }) {
  // destination / setDestination are controlled from ImportSheet;
  // fall back to local state when used standalone
  const [localDestination, setLocalDestination] = useState('library');
  const destValue = destination !== undefined ? destination : localDestination;
  const setDest = setDestination !== undefined ? setDestination : setLocalDestination;
  // F.6: sticky tab-basket hybrid — one list visible at a time
  const [activeTab, setActiveTab] = useState('ingredients'); // 'ingredients' | 'directions'
  const [tabDragOver, setTabDragOver] = useState(null); // tab key being hovered during cross-list drag

  const isDrink = recipe?.type === 'drink' || recipe?.itemType === 'drink';

  // Refs to the tab buttons, used for hit-testing during cross-list drag (Fix 1)
  const ingredientsTabRef = useRef(null);
  const directionsTabRef = useRef(null);
  const tabRefs = { ingredients: ingredientsTabRef, directions: directionsTabRef };

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

  // Fix 1: framer-motion Reorder.Group onReorder — reorders both the recipe
  // list and rowIdsRef in lockstep, keeping row identity stable.
  const handleReorder = useCallback((field, newIds) => {
    const oldIds = rowIdsRef.current[field];
    const list = recipe[field] || [];
    const idToValue = new Map(oldIds.map((id, i) => [id, list[i]]));
    const newList = newIds.map((id) => idToValue.get(id));
    rowIdsRef.current[field] = newIds;
    onChange({ ...recipe, [field]: newList });
  }, [recipe, onChange]);

  // Cross-section move: move the row at `index` of `fromList` to the end of `toList`.
  const moveRowToOtherList = useCallback((fromList, toList, index) => {
    const fromArr = [...(recipe[fromList] || [])];
    const toArr = [...(recipe[toList] || [])];
    const [item] = fromArr.splice(index, 1);
    if (item == null) return;
    toArr.push(item);
    const [id] = rowIdsRef.current[fromList].splice(index, 1);
    rowIdsRef.current[toList].push(id);
    onChange({ ...recipe, [fromList]: fromArr, [toList]: toArr });
  }, [recipe, onChange]);

  const moveIngredientToStep = useCallback((index) => {
    moveRowToOtherList('ingredients', 'directions', index);
  }, [moveRowToOtherList]);

  // moveStepToIngredients defined below (kept name for flag-action compatibility)

  // ── Cross-list drag hit-testing (Fix 1) ─────────────────────────────────
  const handleHandleDrag = useCallback((listName, index, info) => {
    const otherList = listName === 'ingredients' ? 'directions' : 'ingredients';
    const otherTabEl = tabRefs[otherList]?.current;
    if (!otherTabEl) return;
    const rect = otherTabEl.getBoundingClientRect();
    const { x, y } = info.point;
    const over = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    setTabDragOver(over ? otherList : null);
  }, [tabRefs]);

  const handleHandleDragEnd = useCallback((listName, index, info) => {
    const otherList = listName === 'ingredients' ? 'directions' : 'ingredients';
    const otherTabEl = tabRefs[otherList]?.current;
    let over = false;
    if (otherTabEl) {
      const rect = otherTabEl.getBoundingClientRect();
      const { x, y } = info.point;
      over = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }
    if (over) {
      moveRowToOtherList(listName, otherList, index);
    }
    setTabDragOver(null);
  }, [tabRefs, moveRowToOtherList]);

  // ── Misplaced-ingredient flags (steps that look like ingredient lines) ───
  const flaggedSteps = useMemo(
    () => (recipe?.directions || []).reduce((acc, line, i) => {
      if (looksMisplacedIngredient(line)) acc.push(i);
      return acc;
    }, []),
    [recipe?.directions],
  );

  const moveStepToIngredients = useCallback((index) => {
    moveRowToOtherList('directions', 'ingredients', index);
  }, [moveRowToOtherList]);

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
        { key: 'library', label: 'Library', icon: <Library size={22} strokeWidth={2} /> },
        { key: 'bar', label: 'Bar', icon: <Wine size={22} strokeWidth={2} /> },
      ]
    : [
        { key: 'library', label: 'Library', icon: <Library size={22} strokeWidth={2} /> },
        { key: 'week', label: 'This Week', icon: <CalendarDays size={22} strokeWidth={2} /> },
        { key: 'grocery', label: 'Grocery', icon: <ShoppingCart size={22} strokeWidth={2} /> },
      ];

  const handleSave = useCallback(() => {
    const finalRecipe = { ...recipe, _saveDestination: destValue };
    onSave(finalRecipe);
  }, [recipe, destValue, onSave]);

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
        {!recipe.image && (
          <div className="review-hero-placeholder">
            <UtensilsCrossed size={48} strokeWidth={1.5} />
          </div>
        )}
        <div className="review-hero-gradient" />
        {(confidence != null || hasFlags) && (
          <span className={`review-confidence review-confidence-${confLevel}`}>
            {hasFlags ? (
              <>
                <AlertTriangle size={13} strokeWidth={2} /> Review needed
              </>
            ) : `${confLabel} ${Math.round(confidence * 100)}%`}
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
          The inactive tab doubles as a drop zone for cross-section moves
          during a handle-drag (Fix 1). */}
      <div className="review-tabs">
        {[
          { key: 'ingredients', label: 'Ingredients', icon: <Carrot size={16} strokeWidth={2} /> },
          { key: 'directions', label: 'Steps', icon: <ClipboardList size={16} strokeWidth={2} /> },
        ].map((t) => (
          <button
            key={t.key}
            ref={tabRefs[t.key]}
            className={`review-tab${activeTab === t.key ? ' active' : ''}${tabDragOver === t.key ? ' drag-over' : ''}${t.key === 'directions' && hasFlags ? ' flagged' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.icon}
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
        <Reorder.Group
          as="div"
          axis="y"
          values={ingredientIds}
          onReorder={(newIds) => handleReorder('ingredients', newIds)}
          className="review-list"
        >
          <AnimatePresence initial={false}>
            {(recipe.ingredients || []).map((item, i) => (
              <ListItem
                key={ingredientIds[i]}
                rowId={ingredientIds[i]}
                value={item}
                index={i}
                onChange={(idx, val) => updateListItem('ingredients', idx, val)}
                onRemove={(idx) => removeListItem('ingredients', idx)}
                onMoveUp={(idx) => moveListItem('ingredients', idx, 'up')}
                onMoveDown={(idx) => moveListItem('ingredients', idx, 'down')}
                isFirst={i === 0}
                isLast={i === (recipe.ingredients || []).length - 1}
                onMoveToOtherList={moveIngredientToStep}
                moveToOtherListLabel="Move to steps"
                moveToOtherListIcon={<ClipboardList size={16} strokeWidth={2} />}
                onHandleDrag={(info) => handleHandleDrag('ingredients', i, info)}
                onHandleDragEnd={(info) => handleHandleDragEnd('ingredients', i, info)}
              />
            ))}
          </AnimatePresence>
          <button
            className="review-add-row"
            onClick={() => addListItem('ingredients')}
          >
            + Add ingredient
          </button>
        </Reorder.Group>
      ) : (
        <Reorder.Group
          as="div"
          axis="y"
          values={directionIds}
          onReorder={(newIds) => handleReorder('directions', newIds)}
          className="review-list"
        >
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
                rowId={directionIds[i]}
                value={item}
                index={i}
                stepNum={i + 1}
                onChange={(idx, val) => updateListItem('directions', idx, val)}
                onRemove={(idx) => removeListItem('directions', idx)}
                onMoveUp={(idx) => moveListItem('directions', idx, 'up')}
                onMoveDown={(idx) => moveListItem('directions', idx, 'down')}
                isFirst={i === 0}
                isLast={i === (recipe.directions || []).length - 1}
                flagged={flaggedSteps.includes(i)}
                onFlagAction={moveStepToIngredients}
                onMoveToOtherList={moveStepToIngredients}
                moveToOtherListLabel="Move to ingredients"
                moveToOtherListIcon={<Carrot size={16} strokeWidth={2} />}
                onHandleDrag={(info) => handleHandleDrag('directions', i, info)}
                onHandleDragEnd={(info) => handleHandleDragEnd('directions', i, info)}
              />
            ))}
          </AnimatePresence>
          <button
            className="review-add-row"
            onClick={() => addListItem('directions')}
          >
            + Add step
          </button>
        </Reorder.Group>
      )}

      {/* Drink-specific fields */}
      {isDrink && (
        <AccordionSection icon={<Martini size={16} strokeWidth={2} />} title="Drink Details" defaultOpen={false}>
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
      <AccordionSection icon={<NotebookPen size={16} strokeWidth={2} />} title="Notes" defaultOpen={false}>
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
        <div className={`review-destination-grid${isDrink ? ' two-col' : ' three-col'}`}>
          {destinations.map((d) => (
            <motion.button
              key={d.key}
              className={`review-dest-card${destValue === d.key ? ' active' : ''}`}
              onClick={() => setDest(d.key)}
              whileTap={{ scale: 0.95 }}
              transition={{ duration: 0.1 }}
            >
              <span className="review-dest-icon">
                {d.icon}
              </span>
              <span className="review-dest-label">{d.label}</span>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}
