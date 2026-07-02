import { useState, useRef, useCallback } from 'react';
import { motion, useDragControls } from 'framer-motion';
import { parseFromUrl, isSocialMediaUrl, getSocialPlatform } from '../recipeParser';
import { importRecipeFromPages } from '../lib/photoImportEngine.js';

// Auto-expand a textarea to fit its content (call on mount + onChange)
function autoExpand(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

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
  const [directions, setDirections] = useState(meal?.directions?.length ? meal.directions : ['']);
  const [notes, setNotes] = useState(meal?.notes || '');
  const [link, setLink] = useState(meal?.link || '');
  const [imageUrl, setImageUrl] = useState(meal?.imageUrl || '');
  const notesRef = useRef(null);

  const [importUrl, setImportUrl] = useState('');
  const [showImportUrl, setShowImportUrl] = useState(false);
  const [socialDetected, setSocialDetected] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [error, setError] = useState('');
  const ocrFileRef = useRef(null);
  // Drag state for within-list reordering
  const [dragSrc, setDragSrc] = useState(null); // { listName, idx }

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
    const data = {
      ...(isEdit ? { id: meal.id } : {}),
      name: name.trim(),
      ...(isMealMode && category ? { category } : {}),
      ingredients: ingredients.filter(i => i.trim()).length ? ingredients.filter(i => i.trim()) : ['No ingredients listed'],
      directions: directions.filter(d => d.trim()).length ? directions.filter(d => d.trim()) : ['No directions listed'],
      notes: notes.trim(),
      link: link.trim(),
      imageUrl: imageUrl.trim(),
    };
    onSave(data);
  };

  const updateList = (setter, idx, val) => setter(prev => prev.map((v, i) => i === idx ? val : v));

  // Move item from one list to the other (cross-section arrow buttons)
  const moveToOtherList = (fromList, idx) => {
    if (fromList === 'ingredients') {
      const item = ingredients[idx];
      setIngredients(prev => prev.filter((_, i) => i !== idx));
      setDirections(prev => [...prev, item]);
    } else {
      const item = directions[idx];
      setDirections(prev => prev.filter((_, i) => i !== idx));
      setIngredients(prev => [...prev, item]);
    }
  };

  // Swap adjacent items within a list (↑/↓ reorder buttons)
  const reorderList = (setter, list, idx, dir) => {
    const newIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= list.length) return;
    const next = [...list];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    setter(next);
  };

  // HTML5 drag handlers — within-list reordering only
  const handleDragStart = (listName, idx, e) => {
    setDragSrc({ listName, idx });
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.style.opacity = '0.45';
  };
  const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const handleDropOnRow = (listName, dropIdx, e) => {
    e.preventDefault();
    if (!dragSrc) return;
    if (dragSrc.listName === listName) {
      // Same-list reorder
      const setter = listName === 'ingredients' ? setIngredients : setDirections;
      const list = listName === 'ingredients' ? [...ingredients] : [...directions];
      const [item] = list.splice(dragSrc.idx, 1);
      list.splice(dropIdx, 0, item);
      setter(list);
    } else {
      // Cross-section drag-drop
      const fromSetter = dragSrc.listName === 'ingredients' ? setIngredients : setDirections;
      const toSetter = listName === 'ingredients' ? setIngredients : setDirections;
      const fromList = dragSrc.listName === 'ingredients' ? [...ingredients] : [...directions];
      const toList = listName === 'ingredients' ? [...ingredients] : [...directions];
      const [item] = fromList.splice(dragSrc.idx, 1);
      toList.splice(dropIdx, 0, item);
      fromSetter(fromList);
      toSetter(toList);
    }
    setDragSrc(null);
  };
  const handleDropOnSection = (listName, e) => {
    e.preventDefault();
    if (!dragSrc) return;
    if (dragSrc.listName === listName) {
      // Same-list: move to end
      const setter = listName === 'ingredients' ? setIngredients : setDirections;
      const list = listName === 'ingredients' ? [...ingredients] : [...directions];
      const [item] = list.splice(dragSrc.idx, 1);
      list.push(item);
      setter(list);
    } else {
      // Cross-section: append to end of target
      const fromSetter = dragSrc.listName === 'ingredients' ? setIngredients : setDirections;
      const toSetter = listName === 'ingredients' ? setIngredients : setDirections;
      const fromList = dragSrc.listName === 'ingredients' ? [...ingredients] : [...directions];
      const toList = listName === 'ingredients' ? [...ingredients] : [...directions];
      const [item] = fromList.splice(dragSrc.idx, 1);
      toList.push(item);
      fromSetter(fromList);
      toSetter(toList);
    }
    setDragSrc(null);
  };
  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = '';
    setDragSrc(null);
  };
  const addToList = (setter) => setter(prev => [...prev, '']);
  const removeFromList = (setter, idx) => setter(prev => prev.filter((_, i) => i !== idx));

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
        <div className="form-scroll">
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

          <div className="form-group">
            <label>Recipe Link</label>
            <input type="url" value={link} onChange={e => setLink(e.target.value)} placeholder="https://..." />
          </div>
          <div className="form-group">
            <label>Image URL</label>
            <input type="url" value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://..." />
            {imageUrl && <img src={imageUrl} alt="Preview" className="image-preview" onError={e => { e.target.style.display = 'none'; }} />}
          </div>

          <div
            className={`form-group${dragSrc && dragSrc.listName === 'directions' ? ' drop-target-active' : ''}`}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDropOnSection('ingredients', e)}
          >
            <label>{ingredientLabel}{dragSrc && dragSrc.listName === 'directions' && <span className="drop-hint">↓ Drop here</span>}</label>
            {ingredients.map((ing, i) => (
              <div
                key={i}
                className={`list-input-row has-controls${dragSrc?.listName === 'ingredients' && dragSrc?.idx === i ? ' dragging' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart('ingredients', i, e)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDropOnRow('ingredients', i, e)}
                onDragEnd={handleDragEnd}
              >
                <input
                  type="text"
                  value={ing}
                  onChange={e => updateList(setIngredients, i, e.target.value)}
                  placeholder={`Ingredient ${i + 1}`}
                />
                <div className="list-row-controls">
                  <button
                    className="list-reorder-btn"
                    onClick={() => reorderList(setIngredients, ingredients, i, 'up')}
                    disabled={i === 0}
                    title="Move up"
                    aria-label="Move ingredient up"
                  >↑</button>
                  <button
                    className="list-reorder-btn"
                    onClick={() => reorderList(setIngredients, ingredients, i, 'down')}
                    disabled={i === ingredients.length - 1}
                    title="Move down"
                    aria-label="Move ingredient down"
                  >↓</button>
                  {/* Cross-section movement is now drag-drop only */}
                  {ingredients.length > 1 && (
                    <button
                      className="btn-icon small danger"
                      onClick={() => removeFromList(setIngredients, i)}
                      aria-label="Remove ingredient"
                    >✕</button>
                  )}
                </div>
              </div>
            ))}
            <button className="btn-small" onClick={() => addToList(setIngredients)}>+ Add Ingredient</button>
          </div>

<div
  className={`form-group${dragSrc && dragSrc.listName === 'ingredients' ? ' drop-target-active' : ''}`}
  onDragOver={handleDragOver}
  onDrop={(e) => handleDropOnSection('directions', e)}
>
  <label>{directionsLabel}{dragSrc && dragSrc.listName === 'ingredients' && <span className="drop-hint">↓ Drop here</span>}</label>
  {directions.map((dir, i) => (
    <div
      key={i}
      className={`list-input-row has-controls${dragSrc?.listName === 'directions' && dragSrc?.idx === i ? ' dragging' : ''}`}
      draggable
      onDragStart={(e) => handleDragStart('directions', i, e)}
      onDragOver={handleDragOver}
      onDrop={(e) => handleDropOnRow('directions', i, e)}
      onDragEnd={handleDragEnd}
    >
      <textarea
        value={dir}
        onChange={e => {
          updateList(setDirections, i, e.target.value);
          autoExpand(e.target);
        }}
        ref={el => el && autoExpand(el)}
        placeholder={`Step ${i + 1}...`}
        rows={1}
        style={{ resize: 'none', overflow: 'hidden' }}
      />
      <div className="list-row-controls">
        <button
          className="list-reorder-btn"
          onClick={() => reorderList(setDirections, directions, i, 'up')}
          disabled={i === 0}
          title="Move step up"
          aria-label="Move step up"
        >↑</button>
        <button
          className="list-reorder-btn"
          onClick={() => reorderList(setDirections, directions, i, 'down')}
          disabled={i === directions.length - 1}
          title="Move step down"
          aria-label="Move step down"
        >↓</button>
        {/* Cross-section movement is now drag-drop only */}
        {directions.length > 1 && (
          <button
            className="btn-icon small danger"
            onClick={() => removeFromList(setDirections, i)}
            aria-label="Remove step"
          >✕</button>
        )}
      </div>
    </div>
  ))}
  <button className="btn-small" onClick={() => addToList(setDirections)}>+ Add Step</button>
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

// Legacy on-device OCR helpers (preprocessImageForOCR / cleanOcrText /
// classifyOcrLines) moved into src/lib/photoImportEngine.js as the Tier-3
// fallback of the unified pipeline — one code path for every photo import.
