import { useState, useCallback, useMemo, useRef, useEffect, useId } from 'react';
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion';
import {
  Carrot,
  ClipboardList,
  Library,
  CalendarDays,
  ShoppingCart,
  Wine,
  Martini,
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
  Crop,
} from 'lucide-react';
import { fuzzyResolveIngredient, normalizeIngredientForMatching, learnableAliasFrom, addLearnedAlias } from '../recipeSchema';
import { saveLearnedAliases } from '../db';
import PhotoGallery from './PhotoGallery';
import DishPhotoCropper from './DishPhotoCropper';
import CoverPicker from './import/CoverPicker.jsx';

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
 * Friendly engine label derived from `recipe._structuredVia`.
 * Returns null for unknown/absent tags so older recipes render nothing.
 */
export function engineLabel(structuredVia) {
  if (!structuredVia || typeof structuredVia !== 'string') return null;
  const v = structuredVia.toLowerCase();
  // Plain-language: cooks don't need the model name, just how it was read.
  if (v.startsWith('grok')) return 'Smart import';
  if (v.startsWith('gemini')) return 'Smart import';
  if (v.startsWith('server')) return 'Smart import';
  if (v.startsWith('heuristic')) return 'Quick import';
  return null;
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
  confHints,
}) {
  const dragControls = useDragControls();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

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
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(index, e.target.value)}
      />
      {Array.isArray(confHints) && confHints.length > 0 && (
        <span className="review-conf-hints">
          {confHints.map((h) => (
            <button
              key={h.field}
              type="button"
              className="review-conf-hint"
              onClick={() => inputRef.current?.focus()}
              title="Tap to edit this field"
            >
              {h.label}
            </button>
          ))}
        </span>
      )}
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
export default function ImportReview({ recipe, onChange, onSave, confidence, destination, setDestination, scanPages = null }) {
  // Manual dish-photo re-crop (photo imports only — needs the original pages)
  const [showCropper, setShowCropper] = useState(false);
  // destination / setDestination are controlled from ImportSheet;
  // fall back to local state when used standalone
  const [localDestination, setLocalDestination] = useState('library');
  const destValue = destination !== undefined ? destination : localDestination;
  const setDest = setDestination !== undefined ? setDestination : setLocalDestination;
  // F.6: sticky tab-basket hybrid — one list visible at a time
  const [activeTab, setActiveTab] = useState('ingredients'); // 'ingredients' | 'directions'
  const [tabDragOver, setTabDragOver] = useState(null); // tab key being hovered during cross-list drag
  const [rowDragging, setRowDragging] = useState(false); // a row handle is mid-drag → cue the other tab as a drop target

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

  // ── Alias learning (Spec D) ──────────────────────────────────────────────
  // Remember each ingredient row's imported origin (keyed by stable rowId) so an
  // edit can be diffed against what was imported. Reorder/delete-safe because the
  // rowId travels with the row. Staged corrections commit to Dexie on save.
  const learnOriginRef = useRef({}); // rowId -> imported structured item
  const pendingLearnsRef = useRef({}); // raw -> { raw, canonical, aisle, category }
  useEffect(() => {
    const items = Array.isArray(recipe?.ingredientsStructured) ? recipe.ingredientsStructured : [];
    if (!items.length) return;
    const ids = rowIdsRef.current.ingredients;
    ids.forEach((id, i) => {
      if (id && learnOriginRef.current[id] === undefined && items[i]) {
        learnOriginRef.current[id] = items[i];
      }
    });
  }, [recipe?.ingredientsStructured]);

  // ── Field helpers ────────────────────────────────────────────────────────
  const updateField = useCallback((field, value) => {
    onChange({ ...recipe, [field]: value });
  }, [recipe, onChange]);

  const updateListItem = useCallback((field, index, value) => {
    const list = [...(recipe[field] || [])];
    list[index] = value;
    onChange({ ...recipe, [field]: list });
    // Spec D: stage a learned alias when an ingredient's food NAME was corrected
    // (qty/unit-only edits return null and learn nothing). Reverting unstages it.
    if (field === 'ingredients') {
      const rowId = rowIdsRef.current.ingredients[index];
      const origin = rowId ? learnOriginRef.current[rowId] : null;
      if (origin && origin.name) {
        const learn = learnableAliasFrom(origin.name, value);
        if (learn) {
          pendingLearnsRef.current[learn.raw] = learn;
        } else {
          const key = normalizeIngredientForMatching(origin.name);
          if (key) delete pendingLearnsRef.current[key];
        }
      }
    }
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
    setRowDragging(true);
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
    setRowDragging(false);
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
  // Plain-language confidence — one signal, no raw percentage to second-guess.
  const confLabel = hasFlags ? 'Give this a look'
    : confidence >= 0.7 ? 'Looks good' : confidence >= 0.4 ? 'Worth a check' : 'Worth a review';

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
    // Spec D: persist any aliases the user taught us this session, and apply them
    // immediately to the in-memory map so the rest of this session benefits.
    const pending = Object.values(pendingLearnsRef.current);
    if (pending.length) {
      saveLearnedAliases(pending).catch(() => {});
      pending.forEach((p) => addLearnedAlias(p.raw, p.canonical, p.aisle));
    }
    const finalRecipe = { ...recipe, _saveDestination: destValue };
    onSave(finalRecipe);
  }, [recipe, destValue, onSave]);

  if (!recipe) return null;

  const confLevel = hasFlags ? 'review'
    : confidence >= 0.7 ? 'high' : confidence >= 0.4 ? 'medium' : 'low';

  // ── Engine metadata chip (read-only; renders nothing on older recipes) ───
  const engineName = engineLabel(recipe._structuredVia);
  const audit = recipe._postProcessAudit;
  const correctionCount =
    (typeof audit?.movedCount === 'number' ? audit.movedCount : 0)
    + (typeof audit?.filteredCount === 'number' ? audit.filteredCount : 0);

  // ── Extraction source + image-status chip (Instagram import diagnostics) ──
  // Plain-language source labels — no scraper/brand jargon (Apify, oEmbed, IG JSON…).
  const SOURCE_LABELS = { apify: 'Instagram', oembed: 'Instagram', 'ig-json': 'Instagram', embed: 'Instagram', browser: 'Web page', video: 'Video', photo: 'Photo' };
  const VISION_LABELS = { gemini: 'read in the cloud', mistral: 'read in the cloud', tesseract: 'read on your device' };
  let sourceLabel = recipe._extractionSource ? (SOURCE_LABELS[recipe._extractionSource] || null) : null;
  if (recipe._extractionSource === 'photo' && VISION_LABELS[recipe._visionEngine]) {
    sourceLabel = `${sourceLabel} · ${VISION_LABELS[recipe._visionEngine]}`;
  }
  const imageStatusLabel =
    recipe._imageStatus === 'data-url' ? 'photo saved'
    : recipe._imageStatus === 'proxied' ? 'photo saved'
    : recipe._imageStatus === 'raw' ? 'photo not saved yet'
    : recipe._imageStatus === 'none' ? 'no photo'
    : null;
  // Cloud vision failed before this fell back to on-device OCR (Component 3,
  // 2026-07-07-photo-import-csp-fix-design.md) — say why in the same
  // plain-language diagnostics line, no HTTP codes or engine names.
  const visionErrorLabel = recipe._visionError
    ? (recipe._visionError.status === 429 ? 'cloud reading was busy' : 'cloud reading failed')
    : null;

  // ── Normalization hints (read-only) ─────────────────────────────────────
  // For each imported ingredient string, surface how its messy name maps to a
  // cleaner canonical form. Only kept when the resolution is confident AND the
  // canonical actually differs from the raw normalized input.
  const normalizationHints = useMemo(() => {
    const ings = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
    const hints = [];
    for (const ing of ings) {
      if (typeof ing !== 'string' || !ing.trim()) continue;
      let match = null;
      try {
        match = fuzzyResolveIngredient(ing);
      } catch {
        match = null;
      }
      if (!match || match.method === 'none') continue;
      if (typeof match.score !== 'number' || match.score < 0.85) continue;
      if (!match.canonical) continue;
      if (match.canonical === normalizeIngredientForMatching(ing)) continue;
      hints.push({
        original: ing,
        canonical: match.canonical,
        score: match.score,
        method: match.method,
      });
    }
    return hints;
  }, [recipe?.ingredients]);

  // ── Per-field confidence hints (Spec B) ──────────────────────────────────
  // Map each structured ingredient's flat line → its confidenceFields so we can
  // flag the exact uncertain field per row. Keyed by line (survives reorder /
  // delete); once a line is edited it stops matching, which reads as "fixed".
  const confByLine = useMemo(() => {
    const m = new Map();
    const items = Array.isArray(recipe?.ingredientsStructured) ? recipe.ingredientsStructured : [];
    for (const it of items) {
      if (!it || !it.confidenceFields) continue;
      const base = String(it.original_text || '').trim();
      if (!base) continue;
      const sec = String(it.section || '').trim();
      const line = sec ? `${base} (${sec})` : base;
      if (!m.has(line)) m.set(line, { cf: it.confidenceFields, item: it });
    }
    return m;
  }, [recipe?.ingredientsStructured]);

  const hintsForLine = useCallback((line) => {
    const hit = confByLine.get(String(line == null ? '' : line).trim());
    if (!hit) return [];
    const { cf, item } = hit;
    const out = [];
    if (cf.quantity < 0.6) out.push({ field: 'quantity', label: String(item.quantity || '').trim() ? 'Check qty' : 'Add qty' });
    if (cf.unit < 0.6) out.push({ field: 'unit', label: String(item.unit || '').trim() ? 'Check unit' : 'Add unit' });
    if (cf.name < 0.6) out.push({ field: 'name', label: 'Check name' });
    return out;
  }, [confByLine]);

  const lowFieldCount = useMemo(
    () => (recipe?.ingredients || []).reduce((n, line) => n + hintsForLine(line).length, 0),
    [recipe?.ingredients, hintsForLine],
  );

  // ── Import details — one plain-language line, replacing the old stack of
  //    engine / source / image / normalization strips. Still visible, but no
  //    longer four separate muted blocks pushing the recipe down the page.
  const importDetailParts = [
    sourceLabel ? `From ${sourceLabel}` : null,
    engineName || null,
    imageStatusLabel || null,
    visionErrorLabel || null,
    correctionCount > 0 ? `tidied ${correctionCount} line${correctionCount === 1 ? '' : 's'}` : null,
    normalizationHints.length > 0
      ? `matched ${normalizationHints.length} ingredient name${normalizationHints.length === 1 ? '' : 's'}`
      : null,
  ].filter(Boolean);

  return (
    <div className="import-review">
      {/* Hero image + title + confidence */}
      <motion.div
        className="review-hero"
        style={recipe.image ? { backgroundImage: `url(${recipe.image})`, cursor: 'zoom-in' } : undefined}
        onClick={recipe.image ? () => PhotoGallery.openSingle(recipe.image, recipe.name || 'Imported Recipe') : undefined}
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
        {(confidence != null || hasFlags || lowFieldCount > 0) && (
          <span className={`review-confidence review-confidence-${confLevel}`}>
            {hasFlags ? (
              <>
                <AlertTriangle size={13} strokeWidth={2} /> {confLabel}
              </>
            ) : confidence != null ? (
              <>
                {confLabel}
                {lowFieldCount > 0 ? ` · ${lowFieldCount} to check` : ''}
              </>
            ) : (
              `${lowFieldCount} to check`
            )}
          </span>
        )}
        <div className="review-hero-title-wrap" onClick={(e) => e.stopPropagation()}>
          <input
            className="review-hero-title"
            type="text"
            value={recipe.title || ''}
            onChange={(e) => updateField('title', e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            placeholder="Recipe title"
          />
        </div>

        {/* Manual dish-photo re-crop — only for photo scans (original pages on hand) */}
        {Array.isArray(scanPages) && scanPages.length > 0 && (
          <button
            type="button"
            className="review-hero-adjust"
            onClick={(e) => { e.stopPropagation(); setShowCropper(true); }}
            aria-label="Adjust recipe photo"
          >
            <Crop size={14} strokeWidth={2.5} />
            {recipe.image ? 'Adjust photo' : 'Pick photo'}
          </button>
        )}
      </motion.div>

      {/* Dish-photo cropper overlay */}
      <AnimatePresence>
        {showCropper && Array.isArray(scanPages) && scanPages.length > 0 && (
          <DishPhotoCropper
            pages={scanPages}
            initialPage={Math.max(0, (recipe._dishPhotoBox?.page || 1) - 1)}
            initialBox={recipe._dishPhotoBox?.box || null}
            onApply={(dataUrl) => {
              setShowCropper(false);
              onChange({ ...recipe, image: dataUrl, imageUrl: dataUrl, _imageStatus: 'data-url' });
            }}
            onClose={() => setShowCropper(false)}
          />
        )}
      </AnimatePresence>

      {/* Carousel cover picker — appears only when the import captured
          multiple photos (_carouselImages from images.js, ≤6 data URLs) */}
      <CoverPicker recipe={recipe} onChange={onChange} />

      {/* Import details — one muted, read-only line summarizing how this recipe
          was brought in. Consolidates the former engine / source / image /
          normalization strips. Renders nothing on older recipes with no metadata. */}
      {importDetailParts.length > 0 && (
        <p className="review-import-details">
          {importDetailParts.join(' · ')}
        </p>
      )}

      {/* Creator's note — the short friendly intro/story the extraction engine
          preserved from a social caption (see recipeSchema `intro`). Only renders
          when the source actually had one; never fabricated by the model. */}
      {recipe.intro && recipe.intro.trim() && (
        <div className="review-creator-note">
          <NotebookPen size={14} strokeWidth={2} className="review-creator-note-icon" />
          <div className="review-creator-note-body">
            <p className="review-creator-note-text">{recipe.intro}</p>
            {recipe.author && recipe.author.trim() && (
              <span className="review-creator-note-attribution">
                — {recipe.author}
                {recipe.sourcePlatform && recipe.sourcePlatform !== 'web'
                  ? ` on ${recipe.sourcePlatform[0].toUpperCase()}${recipe.sourcePlatform.slice(1)}`
                  : ''}
              </span>
            )}
          </div>
        </div>
      )}

      {/* F.6: sticky segmented tabs with live counters.
          The inactive tab doubles as a drop zone for cross-section moves
          during a handle-drag (Fix 1). */}
      <div className="review-tabs">
        {[
          { key: 'ingredients', label: 'Ingredients', icon: <Carrot size={16} strokeWidth={2} /> },
          { key: 'directions', label: 'Steps', icon: <ClipboardList size={16} strokeWidth={2} /> },
        ].map((t) => {
          // While a row is being dragged, the *other* tab becomes a labelled
          // drop target — teaching the "drag a row onto the other list" gesture
          // that was previously invisible.
          const isDropTarget = rowDragging && t.key !== activeTab;
          return (
            <button
              key={t.key}
              ref={tabRefs[t.key]}
              className={`review-tab${activeTab === t.key ? ' active' : ''}${tabDragOver === t.key ? ' drag-over' : ''}${isDropTarget ? ' drop-target' : ''}${t.key === 'directions' && hasFlags ? ' flagged' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.icon}
              {isDropTarget ? 'Drop to move here' : t.label}
              {!isDropTarget && (
                <motion.span
                  key={(recipe[t.key] || []).length}
                  className="review-tab-count"
                  initial={{ scale: 1.4, opacity: 0.5 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.2 }}
                >
                  {(recipe[t.key] || []).length}
                </motion.span>
              )}
            </button>
          );
        })}
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
                confHints={hintsForLine(item)}
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
