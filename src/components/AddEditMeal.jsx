import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, Reorder, useDragControls } from 'framer-motion';
import { Tag, GripVertical, X, ArrowRightLeft, AlignLeft, List as ListIcon } from 'lucide-react';
import { parseFromUrl, isSocialMediaUrl, getSocialPlatform } from '../recipeParser';
import { importRecipeFromPages } from '../lib/photoImportEngine.js';
import { getUserTags } from '../db';

// Auto-expand a textarea to fit its content (call on mount + onChange).
// field-sizing:content (CSS) already does this on modern Chrome/Safari; this
// stays as the universal fallback for browsers that don't support it yet.
function autoExpand(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

let rowIdSeq = 0;
const makeRowId = () => `row-${Date.now()}-${rowIdSeq++}`;

// Android's soft keyboard needs a beat to finish animating before the
// visual viewport settles — scrolling immediately on focus measures the
// pre-keyboard layout and undershoots. 300ms matches the keyboard-inset
// hook's own settling window used elsewhere in the app.
const KEYBOARD_SETTLE_MS = 300;

const MEAL_CATEGORIES = ['Dinners', 'Breakfasts', 'Lunches', 'Desserts', 'Sides', 'Tailgate', 'Snacks'];

export default function AddEditMeal({
  meal,
  onSave,
  onClose,
  title,             // override modal title
  placeholder = '🍽️', // icon shown in import toolbar
  ingredientLabel = 'Ingredients',
  directionsLabel = 'Directions',
  categories,        // if provided, show category picker
}) {
  const isEdit = !!(meal && meal.id);
  const isMealMode = placeholder !== '🍹';
  const [name, setName] = useState(meal?.name || '');
  const [category, setCategory] = useState(meal?.category || (isMealMode ? 'Dinners' : ''));
  const [ingredients, setIngredients] = useState(meal?.ingredients?.length ? meal.ingredients : ['']);
  const [ingredientIds, setIngredientIds] = useState(() => ingredients.map(makeRowId));
  const [directions, setDirections] = useState(meal?.directions?.length ? meal.directions : ['']);
  const [directionIds, setDirectionIds] = useState(() => directions.map(makeRowId));
  // Raw Text Mode — one big textarea, one step per line. Lets a pasted or
  // dictated recipe get entered in one motion instead of managing rows.
  const [directionsBulkMode, setDirectionsBulkMode] = useState(false);
  const [bulkDirectionsText, setBulkDirectionsText] = useState('');
  // Smart Paste Splitting — inline "split into N steps?" prompt shown after
  // a multi-line paste lands in a single step textarea.
  const [pasteSplitPrompt, setPasteSplitPrompt] = useState(null); // { index, lines }
  const [notes, setNotes] = useState(meal?.notes || '');
  const [link, setLink] = useState(meal?.link || '');
  const [imageUrl, setImageUrl] = useState(meal?.imageUrl || '');
  const notesRef = useRef(null);

  // Custom labels (MealLibrary's userTags) — previously only manageable via
  // the Library's quick-preview "⋯" sheet, not from the Edit Recipe form
  // itself. Meal-only (drinks don't have this tag system).
  const [tags, setTags] = useState(meal?.tags || []);
  const [availableTags, setAvailableTags] = useState([]);
  useEffect(() => {
    if (!isMealMode) return;
    getUserTags().then(setAvailableTags);
  }, [isMealMode]);
  const toggleTag = useCallback((name) => {
    setTags(prev => prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name]);
  }, []);

  const [importUrl, setImportUrl] = useState('');
  const [showImportUrl, setShowImportUrl] = useState(false);
  const [socialDetected, setSocialDetected] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [error, setError] = useState('');
  const ocrFileRef = useRef(null);

  const applyParsed = (result) => {
    if (!result || result._error) return false;
    if (result.name && result.name !== 'Imported Recipe') setName(result.name);
    if (result.ingredients?.length) setIngredients(result.ingredients);
    if (result.directions?.length) setDirections(result.directions);
    if (result.link) setLink(result.link);
    if (result.imageUrl) setImageUrl(result.imageUrl);
    return true;
  };

  const handleUrlChange = (e) => {
    const val = e.target.value;
    setImportUrl(val);
    setError('');
    if (isSocialMediaUrl(val)) {
      setSocialDetected({ platform: getSocialPlatform(val) });
    } else {
      setSocialDetected(null);
    }
  };

  const handleImportUrl = async () => {
    if (!importUrl.trim()) return;

    setImporting(true);
    setError('');
    try {
      const result = await parseFromUrl(importUrl.trim());
      if (!result) {
        setError('Could not extract recipe from that URL. The site may block automated access.');
      } else if (result._error) {
        setLink(importUrl.trim());
        if (result.reason === 'login-wall') {
          setError('This post requires login. You can still add the meal manually below.');
        } else {
          setError(`Could not extract from ${result.platform || 'this site'}. Please make sure the server is running.`);
        }
      } else {
        if (applyParsed(result)) {
          setShowImportUrl(false);
        }
      }
    } catch (e) {
      setError('Import failed: ' + e.message);
    }
    setImporting(false);
  };

  // Unified photo scan — same tiered pipeline as ImportSheet (Gemini vision →
  // Mistral → on-device Tesseract), same engine templating, dish-photo grab.
  const handleOcrImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportProgress('Reading your photo…');
    setError('');
    try {
      const imageDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const recipe = await importRecipeFromPages(
        [{ id: `aem-${Date.now()}`, dataUrl: imageDataUrl, source: 'gallery' }],
        {
          type: isMealMode ? 'meal' : 'drink',
          onProgress: (_stage, msg) => setImportProgress(msg),
        },
      );

      const title = (recipe.title || recipe.name || '').trim();
      if (title && title !== 'Imported Recipe') setName(title);
      if (recipe.ingredients?.length) setIngredients(recipe.ingredients);
      if (recipe.directions?.length) setDirections(recipe.directions);
      // Prefer the detected/cropped dish photo; the engine always returns one.
      if (recipe.imageUrl) setImageUrl(recipe.imageUrl);
      setShowImportUrl(false);
    } catch (err) {
      setError(err.message || 'Could not read a recipe from that photo. Try a clearer shot.');
    }
    setImporting(false);
    setImportProgress('');
    e.target.value = '';
  };

  const handleSave = () => {
    if (!name.trim()) { setError('Meal name is required.'); return; }
    // If the user hits Save while still in Raw Text Mode, split it the same
    // way exitBulkMode does rather than silently dropping the toggle state.
    const finalDirections = directionsBulkMode
      ? bulkDirectionsText.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      : directions;
    const data = {
      ...(isEdit ? { id: meal.id } : {}),
      name: name.trim(),
      ...(isMealMode && category ? { category } : {}),
      ...(isMealMode ? { tags } : {}),
      ingredients: ingredients.filter(i => i.trim()).length ? ingredients.filter(i => i.trim()) : ['No ingredients listed'],
      directions: finalDirections.filter(d => d.trim()).length ? finalDirections.filter(d => d.trim()) : ['No directions listed'],
      notes: notes.trim(),
      link: link.trim(),
      imageUrl: imageUrl.trim(),
    };
    onSave(data);
  };

  const updateList = (setter, idx, val) => setter(prev => prev.map((v, i) => i === idx ? val : v));

  // Add/remove a row and keep its parallel id array in lockstep — the ids
  // are what framer-motion's Reorder.Group tracks (Reorder needs stable,
  // unique values; recipe text can repeat, e.g. two "1 tsp salt" lines).
  const addRow = (setItems, setIds) => {
    setItems(prev => [...prev, '']);
    setIds(prev => [...prev, makeRowId()]);
  };
  const removeRow = (setItems, setIds, idx) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
    setIds(prev => prev.filter((_, i) => i !== idx));
  };
  // Insert/replace a run of rows at once — used by paste-splitting and
  // Raw Text Mode conversions where more than one row changes together.
  const spliceRows = (setItems, setIds, start, deleteCount, newVals) => {
    setItems(prev => { const next = [...prev]; next.splice(start, deleteCount, ...newVals); return next; });
    setIds(prev => { const next = [...prev]; next.splice(start, deleteCount, ...newVals.map(() => makeRowId())); return next; });
  };
  // framer-motion hands back the new id order on drop; rebuild the value
  // array from it so ids and values stay aligned.
  const reorderRows = (setItems, items, ids, setIds, newIdOrder) => {
    const newItems = newIdOrder.map(id => items[ids.indexOf(id)]);
    setIds(newIdOrder);
    setItems(newItems);
  };

  // Move a row between Ingredients <-> Directions. Replaces the old
  // cross-container HTML5 drag-and-drop, which never fires on touch
  // devices — draggable="true" has no touch equivalent without a polyfill,
  // so on Android this control silently did nothing. A one-tap swap works
  // everywhere.
  const moveRowToOtherList = (fromList, idx) => {
    const isIngredients = fromList === 'ingredients';
    const value = (isIngredients ? ingredients : directions)[idx];
    const setFromItems = isIngredients ? setIngredients : setDirections;
    const setFromIds = isIngredients ? setIngredientIds : setDirectionIds;
    const setToItems = isIngredients ? setDirections : setIngredients;
    const setToIds = isIngredients ? setDirectionIds : setIngredientIds;
    setFromItems(prev => prev.filter((_, i) => i !== idx));
    setFromIds(prev => prev.filter((_, i) => i !== idx));
    setToItems(prev => [...prev, value]);
    setToIds(prev => [...prev, makeRowId()]);
  };

  // Smart Paste Splitting — a multi-line paste into one step almost always
  // means the user pasted several instructions at once. Intercept it and
  // ask, rather than silently cramming N steps into one textarea.
  const handlePasteInStep = (idx, e) => {
    const text = e.clipboardData?.getData('text') ?? '';
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      e.preventDefault();
      setPasteSplitPrompt({ index: idx, lines });
    }
    // Single-line paste: let the browser paste it in natively.
  };
  const resolvePasteSplit = (action) => {
    if (!pasteSplitPrompt) return;
    const { index, lines } = pasteSplitPrompt;
    if (action === 'split') {
      const replacingEmptyStep = !directions[index]?.trim();
      spliceRows(setDirections, setDirectionIds, index, replacingEmptyStep ? 1 : 0, lines);
    } else {
      updateList(setDirections, index, lines.join('\n'));
    }
    setPasteSplitPrompt(null);
  };

  // Individual Steps <-> Raw Text Mode
  const enterBulkMode = () => {
    setBulkDirectionsText(directions.join('\n'));
    setDirectionsBulkMode(true);
  };
  const exitBulkMode = () => {
    const lines = bulkDirectionsText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const next = lines.length ? lines : [''];
    setDirections(next);
    setDirectionIds(next.map(makeRowId));
    setDirectionsBulkMode(false);
  };

  // Keyboard-aware focus scroll: Android shrinks the visual viewport when
  // the soft keyboard opens, which can leave the just-focused field hidden
  // beneath it. Nudge the field back into view once the keyboard animation
  // has had a moment to settle (immediate scrollIntoView measures the
  // pre-keyboard layout and undershoots).
  const handleFieldFocus = (e) => {
    const el = e.target;
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
    setTimeout(() => {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, KEYBOARD_SETTLE_MS);
  };

  // ── Drag-down-to-dismiss ──
  const dragControls = useDragControls();

  const handleSheetDragEnd = useCallback((_e, info) => {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      onClose();
    }
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div
        className="modal-content edit-modal"
        onClick={e => e.stopPropagation()}
        drag="y"
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        dragTransition={{ bounceStiffness: 600, bounceDamping: 30 }}
        onDragEnd={handleSheetDragEnd}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      >
        {/* ── Drag handle (visual indicator for drag-down-to-close) ── */}
        <div
          onPointerDown={(e) => dragControls.start(e)}
          style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '10px auto 0', cursor: 'grab' }}
        />
        <div className="modal-header">
          <h2>{title || (isEdit ? '✏️ Edit Meal' : '➕ Add New Meal')}</h2>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        {error && <div className="error-bar">{error}</div>}

        {/* ── Import toolbar ── */}
        {showImportUrl && <div className="import-buttons">
          <button
            className="btn-small active-toggle"
            onClick={() => { setShowImportUrl(false); setError(''); }}>
            ✕ Close Import
          </button>
        </div>}

        {/* ── URL import panel ── */}
        {showImportUrl && (
          <div className="import-section">
            {importing && importProgress ? (
              <div className="image-import-progress">
                <span className="browser-spinner large" />
                <p className="import-progress-text">{importProgress}</p>
              </div>
            ) : socialDetected ? (
              <div className="social-guide compact">
                <div className="social-guide-header">
                  <span className="social-badge">{socialDetected.platform}</span>
                  <span>Extracting recipe...</span>
                </div>
                <p className="help-text">
                  The app will automatically extract the recipe from {socialDetected.platform}.
                  If extraction fails, you can manually fill in the details below.
                </p>
              </div>
            ) : (
              <>
                <p className="help-text">Paste a URL or snap a photo of a recipe card/cookbook page.</p>
                <input
                  type="url"
                  placeholder="https://www.allrecipes.com/recipe/..."
                  value={importUrl}
                  onChange={handleUrlChange}
                  className="full-width"
                  onKeyDown={e => e.key === 'Enter' && handleImportUrl()}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-primary" onClick={handleImportUrl} disabled={importing} style={{ flex: 1 }}>
                    {importing ? 'Importing...' : 'Import URL'}
                  </button>
                  <input ref={ocrFileRef} type="file" accept="image/*" capture="environment" onChange={handleOcrImport} style={{ display: 'none' }} />
                  <button className="btn-secondary" onClick={() => ocrFileRef.current?.click()} disabled={importing} style={{ flex: 1 }}>
                    Snap Photo
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Form fields ── */}
        {/* onFocus delegates to every input/textarea below via bubbling
            (React's onFocus is focusin-backed, so this fires for nested
            fields too) — nudges the just-focused field above the Android
            soft keyboard instead of leaving it hidden underneath it. */}
        <div className="form-scroll" onFocus={handleFieldFocus}>
          <div className="form-group">
            <label>Name *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={placeholder === '🍹' ? 'e.g. Classic Margarita' : 'e.g. Chicken Parmesan'} />
          </div>
          {/* Category picker (meals only) */}
          {isMealMode && (
            <div className="form-group">
              <label>Category</label>
              <div className="category-picker">
                {(categories || MEAL_CATEGORIES).map(c => (
                  <button
                    key={c}
                    type="button"
                    className={`meal-cat-chip${category === c ? ' active' : ''}`}
                    onClick={() => setCategory(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Custom labels (MealLibrary's userTags) — was only editable from
              the Library's "⋯" quick-preview sheet, not from here. */}
          {isMealMode && availableTags.length > 0 && (
            <div className="form-group">
              <label>Labels</label>
              <div className="category-picker">
                {availableTags.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    className={`meal-cat-chip meal-tag-chip${tags.includes(t.name) ? ' active' : ''}`}
                    style={tags.includes(t.name) ? { background: t.color, borderColor: t.color, color: '#fff' } : undefined}
                    onClick={() => toggleTag(t.name)}
                  >
                    <Tag size={11} strokeWidth={2.5} /> {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="form-group">
            <label>Recipe Link</label>
            <input type="url" value={link} onChange={e => setLink(e.target.value)} placeholder="https://..." />
          </div>
          <div className="form-group">
            <label>Image URL</label>
            <input type="url" value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://..." />
            {imageUrl && <img src={imageUrl} alt="Preview" className="image-preview" onError={e => { e.target.style.display = 'none'; }} />}
          </div>

          <div className="form-group">
            <label>{ingredientLabel}</label>
            <Reorder.Group
              as="div"
              axis="y"
              values={ingredientIds}
              onReorder={(newIds) => reorderRows(setIngredients, ingredients, ingredientIds, setIngredientIds, newIds)}
              className="aem-list"
            >
              {ingredients.map((ing, i) => (
                <IngredientRow
                  key={ingredientIds[i]}
                  rowId={ingredientIds[i]}
                  value={ing}
                  index={i}
                  onChange={(val) => updateList(setIngredients, i, val)}
                  onRemove={() => removeRow(setIngredients, setIngredientIds, i)}
                  onMoveToDirections={() => moveRowToOtherList('ingredients', i)}
                  canRemove={ingredients.length > 1}
                />
              ))}
            </Reorder.Group>
            <button className="btn-small" onClick={() => addRow(setIngredients, setIngredientIds)}>+ Add Ingredient</button>
          </div>

<div className="form-group">
  <div className="aem-section-header">
    <label>{directionsLabel}</label>
    <div className="aem-mode-toggle" role="tablist" aria-label="Steps input mode">
      <button
        type="button"
        role="tab"
        aria-selected={!directionsBulkMode}
        className={`aem-mode-btn${!directionsBulkMode ? ' active' : ''}`}
        onClick={() => directionsBulkMode && exitBulkMode()}
      >
        <ListIcon size={13} strokeWidth={2.25} /> Individual
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={directionsBulkMode}
        className={`aem-mode-btn${directionsBulkMode ? ' active' : ''}`}
        onClick={() => !directionsBulkMode && enterBulkMode()}
      >
        <AlignLeft size={13} strokeWidth={2.25} /> Raw Text
      </button>
    </div>
  </div>

  {directionsBulkMode ? (
    <>
      <p className="help-text">One step per line — paste a whole recipe and split it up here.</p>
      <textarea
        value={bulkDirectionsText}
        onChange={e => { setBulkDirectionsText(e.target.value); autoExpand(e.target); }}
        ref={el => el && autoExpand(el)}
        placeholder={'Preheat oven to 400°F...\nSeason the chicken...\nRoast for 25 minutes...'}
        rows={4}
        className="aem-step-textarea"
      />
    </>
  ) : (
    <Reorder.Group
      as="div"
      axis="y"
      values={directionIds}
      onReorder={(newIds) => reorderRows(setDirections, directions, directionIds, setDirectionIds, newIds)}
      className="aem-list"
    >
      {directions.map((dir, i) => (
        <StepRow
          key={directionIds[i]}
          rowId={directionIds[i]}
          value={dir}
          index={i}
          stepNumber={i + 1}
          onChange={(val) => updateList(setDirections, i, val)}
          onRemove={() => removeRow(setDirections, setDirectionIds, i)}
          onMoveToIngredients={() => moveRowToOtherList('directions', i)}
          canRemove={directions.length > 1}
          onPaste={(e) => handlePasteInStep(i, e)}
          pastePrompt={pasteSplitPrompt?.index === i ? pasteSplitPrompt : null}
          onResolvePaste={resolvePasteSplit}
        />
      ))}
    </Reorder.Group>
  )}

  {!directionsBulkMode && (
    <button className="btn-small" onClick={() => addRow(setDirections, setDirectionIds)}>+ Add Step</button>
  )}
</div>

<div className="form-group">
  <label>Notes</label>
  <textarea
    value={notes}
    onChange={e => {
      setNotes(e.target.value);
      autoExpand(e.target);
    }}
    ref={el => {
      if (el) {
        notesRef.current = el; // Correctly assigns the ref
        autoExpand(el);        // Correctly triggers initial sizing
      }
    }}
    placeholder="Personal notes, substitutions, tips, serving ideas…"
    rows={2}
    style={{ resize: 'none', overflow: 'hidden', width: '100%', boxSizing: 'border-box' }}
  />
</div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>💾 {isEdit ? 'Save Changes' : 'Save'}</button>
        </div>
      </motion.div>
    </div>
  );
}

// ── IngredientRow ──
// A single ingredient line. Reorders via a dedicated left-edge drag handle
// (framer-motion Reorder, pointer/touch-native) instead of the old ↑/↓
// button pair + HTML5 draggable — draggable="true" never fires a touch drag
// on Android/iOS without a polyfill, so the previous reorder path was
// effectively dead on the phones this app targets.
function IngredientRow({ rowId, value, index, onChange, onRemove, onMoveToDirections, canRemove }) {
  const dragControls = useDragControls();
  return (
    <Reorder.Item
      as="div"
      value={rowId}
      dragListener={false}
      dragControls={dragControls}
      whileDrag={{ opacity: 0.65, scale: 1.01 }}
      className="aem-row aem-row-inline"
    >
      <span
        className="aem-drag-handle"
        onPointerDown={(e) => dragControls.start(e)}
        aria-label="Drag to reorder ingredient"
      >
        <GripVertical size={16} strokeWidth={2} />
      </span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={`Ingredient ${index + 1}`}
      />
      <button
        type="button"
        className="aem-row-action"
        onClick={onMoveToDirections}
        title="Move to directions"
        aria-label="Move ingredient to directions"
      >
        <ArrowRightLeft size={14} strokeWidth={2.25} />
      </button>
      {canRemove && (
        <button
          type="button"
          className="aem-row-action aem-row-action-danger"
          onClick={onRemove}
          aria-label="Remove ingredient"
        >
          <X size={15} strokeWidth={2.25} />
        </button>
      )}
    </Reorder.Item>
  );
}

// ── StepRow ──
// Controls live in a header row ABOVE the textarea (drag handle + "Step N"
// + move + delete) instead of a right-hand button column — on a 360px-wide
// phone a right column of two 30px buttons ate ~70px off the textarea, which
// is exactly the width pinch that made pasted text wrap into an unreadable
// sliver. The textarea now gets the full row width.
function StepRow({ rowId, value, index, stepNumber, onChange, onRemove, onMoveToIngredients, canRemove, onPaste, pastePrompt, onResolvePaste }) {
  const dragControls = useDragControls();
  const taRef = useRef(null);
  useEffect(() => { if (taRef.current) autoExpand(taRef.current); }, [value]);

  return (
    <Reorder.Item
      as="div"
      value={rowId}
      dragListener={false}
      dragControls={dragControls}
      whileDrag={{ opacity: 0.65, scale: 1.01 }}
      className="aem-row aem-row-step"
    >
      <div className="aem-step-header">
        <span
          className="aem-drag-handle"
          onPointerDown={(e) => dragControls.start(e)}
          aria-label="Drag to reorder step"
        >
          <GripVertical size={16} strokeWidth={2} />
        </span>
        <span className="aem-step-num">Step {stepNumber}</span>
        <span className="aem-step-spacer" />
        <button
          type="button"
          className="aem-row-action"
          onClick={onMoveToIngredients}
          title="Move to ingredients"
          aria-label="Move step to ingredients"
        >
          <ArrowRightLeft size={14} strokeWidth={2.25} />
        </button>
        {canRemove && (
          <button
            type="button"
            className="aem-row-action aem-row-action-danger"
            onClick={onRemove}
            aria-label="Remove step"
          >
            <X size={15} strokeWidth={2.25} />
          </button>
        )}
      </div>
      <textarea
        ref={taRef}
        value={value}
        onChange={e => { onChange(e.target.value); autoExpand(e.target); }}
        onPaste={onPaste}
        placeholder={`Step ${stepNumber}...`}
        rows={1}
        className="aem-step-textarea"
      />
      {pastePrompt && (
        <div className="aem-paste-prompt">
          <span>Split pasted text into {pastePrompt.lines.length} steps?</span>
          <div className="aem-paste-prompt-actions">
            <button type="button" className="btn-small" onClick={() => onResolvePaste('split')}>Split</button>
            <button type="button" className="btn-small ghost" onClick={() => onResolvePaste('keep')}>Keep as one</button>
          </div>
        </div>
      )}
    </Reorder.Item>
  );
}

// Legacy on-device OCR helpers (preprocessImageForOCR / cleanOcrText /
// classifyOcrLines) moved into src/lib/photoImportEngine.js as the Tier-3
// fallback of the unified pipeline — one code path for every photo import.
