import { useState, useCallback } from 'react';

/**
 * AccordionSection — collapsible section used within ImportReview.
 */
function AccordionSection({ title, count, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      border: '1px solid var(--border-color, #e0e0e0)',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 14px',
          background: 'var(--bg-muted, #f8f8f8)',
          border: 'none', cursor: 'pointer',
          fontSize: '0.95rem', fontWeight: 600,
          color: 'var(--text-color, #333)',
        }}
      >
        <span>{title}{count != null ? ` (${count})` : ''}</span>
        <span style={{
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s', fontSize: '0.8rem',
        }}>
          &#9660;
        </span>
      </button>
      {open && (
        <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
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
function ListItem({ value, index, onChange, onRemove }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px',
    }}>
      <span style={{
        cursor: 'grab', fontSize: '1rem', opacity: 0.4, userSelect: 'none',
        padding: '0 2px',
      }}>
        &#9776;
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(index, e.target.value)}
        style={{
          flex: 1, padding: '7px 10px',
          borderRadius: 8,
          border: '1px solid var(--border-color, #ddd)',
          fontSize: '0.9rem',
          outline: 'none',
        }}
      />
      <button
        onClick={() => onRemove(index)}
        aria-label="Remove"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: '1.1rem', color: 'var(--text-muted, #999)',
          padding: '2px 6px', lineHeight: 1,
        }}
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Hero image + title + confidence */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
        {recipe.image && (
          <img
            src={recipe.image}
            alt={recipe.title || 'Recipe'}
            style={{
              width: 80, height: 80, objectFit: 'cover',
              borderRadius: 12, flexShrink: 0,
            }}
          />
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <input
            type="text"
            value={recipe.title || ''}
            onChange={(e) => updateField('title', e.target.value)}
            placeholder="Recipe title"
            style={{
              fontSize: '1.1rem', fontWeight: 600,
              border: '1px solid var(--border-color, #ddd)',
              borderRadius: 8, padding: '8px 10px',
              outline: 'none', width: '100%',
            }}
          />
          {confidence != null && (
            <span style={{
              display: 'inline-block',
              padding: '2px 10px',
              borderRadius: 12,
              background: confColor + '20',
              color: confColor,
              fontSize: '0.75rem',
              fontWeight: 600,
              alignSelf: 'flex-start',
            }}>
              {confLabel} confidence ({Math.round(confidence * 100)}%)
            </span>
          )}
        </div>
      </div>

      {/* Ingredients */}
      <AccordionSection
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
          />
        ))}
        <button
          onClick={() => addListItem('ingredients')}
          style={{
            background: 'none', border: '1px dashed var(--border-color, #ccc)',
            borderRadius: 8, padding: '6px', cursor: 'pointer',
            fontSize: '0.85rem', color: 'var(--text-muted, #888)',
          }}
        >
          + Add ingredient
        </button>
      </AccordionSection>

      {/* Steps / Directions */}
      <AccordionSection
        title="Steps"
        count={recipe.directions?.length || 0}
        defaultOpen={true}
      >
        {(recipe.directions || []).map((item, i) => (
          <ListItem
            key={i}
            value={item}
            index={i}
            onChange={(idx, val) => updateListItem('directions', idx, val)}
            onRemove={(idx) => removeListItem('directions', idx)}
          />
        ))}
        <button
          onClick={() => addListItem('directions')}
          style={{
            background: 'none', border: '1px dashed var(--border-color, #ccc)',
            borderRadius: 8, padding: '6px', cursor: 'pointer',
            fontSize: '0.85rem', color: 'var(--text-muted, #888)',
          }}
        >
          + Add step
        </button>
      </AccordionSection>

      {/* Drink-specific fields */}
      {isDrink && (
        <AccordionSection title="Drink Details" defaultOpen={false}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-muted, #888)' }}>Glass</label>
            <input
              type="text"
              value={recipe.glass || ''}
              onChange={(e) => updateField('glass', e.target.value)}
              placeholder="e.g. Rocks, Coupe, Highball"
              style={{
                padding: '7px 10px', borderRadius: 8,
                border: '1px solid var(--border-color, #ddd)',
                fontSize: '0.9rem', outline: 'none',
              }}
            />
            <label style={{ fontSize: '0.85rem', color: 'var(--text-muted, #888)' }}>Garnish</label>
            <input
              type="text"
              value={recipe.garnish || ''}
              onChange={(e) => updateField('garnish', e.target.value)}
              placeholder="e.g. Lemon twist, Cherry"
              style={{
                padding: '7px 10px', borderRadius: 8,
                border: '1px solid var(--border-color, #ddd)',
                fontSize: '0.9rem', outline: 'none',
              }}
            />
            <label style={{ fontSize: '0.85rem', color: 'var(--text-muted, #888)' }}>Technique</label>
            <input
              type="text"
              value={recipe.technique || ''}
              onChange={(e) => updateField('technique', e.target.value)}
              placeholder="e.g. Shaken, Stirred, Built"
              style={{
                padding: '7px 10px', borderRadius: 8,
                border: '1px solid var(--border-color, #ddd)',
                fontSize: '0.9rem', outline: 'none',
              }}
            />
          </div>
        </AccordionSection>
      )}

      {/* Notes */}
      <AccordionSection title="Notes" defaultOpen={false}>
        <textarea
          value={recipe.notes || ''}
          onChange={(e) => updateField('notes', e.target.value)}
          placeholder="Any notes about this recipe..."
          rows={3}
          style={{
            width: '100%', padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid var(--border-color, #ddd)',
            fontSize: '0.9rem', resize: 'vertical',
            fontFamily: 'inherit', outline: 'none',
          }}
        />
      </AccordionSection>

      {/* Save destination grid */}
      <div>
        <p style={{ margin: '0 0 8px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted, #888)' }}>
          Save to:
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {destinations.map((d) => (
            <button
              key={d.key}
              onClick={() => setDestination(d.key)}
              style={{
                flex: '1 1 auto',
                minWidth: 80,
                padding: '8px 16px',
                borderRadius: 10,
                border: destination === d.key
                  ? '2px solid var(--accent, #e67e22)'
                  : '1px solid var(--border-color, #ccc)',
                background: destination === d.key ? 'var(--accent, #e67e22)' + '18' : 'var(--card-bg, #fff)',
                fontWeight: destination === d.key ? 600 : 400,
                fontSize: '0.9rem',
                cursor: 'pointer',
                color: destination === d.key ? 'var(--accent, #e67e22)' : 'var(--text-color, #333)',
                transition: 'all 0.15s',
              }}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        style={{
          width: '100%',
          padding: '12px',
          borderRadius: 12,
          border: 'none',
          background: 'var(--accent, #e67e22)',
          color: '#fff',
          fontWeight: 700,
          fontSize: '1.05rem',
          cursor: 'pointer',
          transition: 'opacity 0.15s',
        }}
      >
        Save {isDrink ? 'Drink' : 'Recipe'}
      </button>
    </div>
  );
}
