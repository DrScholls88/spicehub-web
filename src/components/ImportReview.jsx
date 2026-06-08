import { useState, useCallback } from 'react';

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
        <span className={`review-accordion-chevron${!open ? ' rotated' : ''}`}>&#9660;</span>
      </div>
      {open && (
        <div className="review-accordion-body">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * ListItem — a single editable list row (ingredient or step).
 * Shows a drag handle, text input, and remove button.
 */
function ListItem({ value, index, onChange, onRemove, stepNum, onMoveUp, onMoveDown, isFirst, isLast, listName, onDragStart, onDragOver, onDrop, onDragEnd }) {
  return (
    <div
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
    </div>
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

  const isDrink = recipe?.type === 'drink' || recipe?.itemType === 'drink';

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
    onChange({ ...recipe, [field]: list });
  }, [recipe, onChange]);

  const addListItem = useCallback((field) => {
    const list = [...(recipe[field] || []), ''];
    onChange({ ...recipe, [field]: list });
  }, [recipe, onChange]);

  // ── Reorder helpers ──────────────────────────────────────────────────────
  const moveListItem = useCallback((field, index, direction) => {
    const list = [...(recipe[field] || [])];
    const newIdx = direction === 'up' ? index - 1 : index + 1;
    if (newIdx < 0 || newIdx >= list.length) return;
    [list[index], list[newIdx]] = [list[newIdx], list[index]];
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
      onChange({ ...recipe, [listName]: list });
    } else {
      // Cross-section move
      const fromList = [...(recipe[dragSrc.listName] || [])];
      const toList = [...(recipe[listName] || [])];
      const [item] = fromList.splice(dragSrc.idx, 1);
      toList.splice(dropIdx, 0, item);
      onChange({ ...recipe, [dragSrc.listName]: fromList, [listName]: toList });
    }
    setDragSrc(null);
  }, [dragSrc, recipe, onChange]);

  const handleDragEnd = useCallback((e) => {
    e.currentTarget.style.opacity = '';
    setDragSrc(null);
  }, []);

  // ── Confidence chip color ────────────────────────────────────────────────
  const confColor = confidence >= 0.7 ? '#27ae60' : confidence >= 0.4 ? '#f39c12' : '#e74c3c';
  const confLabel = confidence >= 0.7 ? 'High' : confidence >= 0.4 ? 'Medium' : 'Low';

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

  const confLevel = confidence >= 0.7 ? 'high' : confidence >= 0.4 ? 'medium' : 'low';

  return (
    <div className="import-review">
      {/* Hero image + title + confidence */}
      <div
        className="review-hero"
        style={recipe.image ? { backgroundImage: `url(${recipe.image})` } : undefined}
      >
        {!recipe.image && <div className="review-hero-placeholder">🍽️</div>}
        <div className="review-hero-gradient" />
        {confidence != null && (
          <span className={`review-confidence review-confidence-${confLevel}`}>
            {confLabel} {Math.round(confidence * 100)}%
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
      </div>

      {/* Ingredients */}
      <AccordionSection
        icon="🥕"
        title="Ingredients"
        count={recipe.ingredients?.length || 0}
        defaultOpen={true}
      >
        {(recipe.ingredients || []).map((item, i) => (
          <ListItem
            key={i}
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
        <button
          className="review-add-row"
          onClick={() => addListItem('ingredients')}
        >
          + Add ingredient
        </button>
      </AccordionSection>

      {/* Steps / Directions */}
      <AccordionSection
        icon="📝"
        title="Steps"
        count={recipe.directions?.length || 0}
        defaultOpen={true}
      >
        {(recipe.directions || []).map((item, i) => (
          <ListItem
            key={i}
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
          />
        ))}
        <button
          className="review-add-row"
          onClick={() => addListItem('directions')}
        >
          + Add step
        </button>
      </AccordionSection>

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
            <button
              key={d.key}
              className={`review-dest-card${destination === d.key ? ' active' : ''}`}
              onClick={() => setDestination(d.key)}
            >
              <span className="review-dest-icon">
                {d.key === 'library' ? '📚' : d.key === 'week' ? '📅' : d.key === 'grocery' ? '🛒' : '🍹'}
              </span>
              <span className="review-dest-label">{d.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
