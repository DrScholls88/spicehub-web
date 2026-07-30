/**
 * Plan-only slot card for shared meals from group members.
 * Shows name, image, ingredients, attribution, and import affordance.
 * See spec Section 4: "Shared slot behavior"
 */
import { useState } from 'react';

export default function SharedSlotCard({
  slot,        // fromSlotData() output with _isSharedSlot, _sharedBy, link, etc.
  onImport,    // (sourceUrl) => void — triggers executeUrlImport
  onSaveTransfer, // (transferId) => void — claims a shared recipe transfer
  transferId,  // if a shared_recipe_transfers row exists for this meal
  hasLocalRecipe, // true if db.meals has a matching recipe by name
  onOpenLocal, // () => void — open CookMode/MealDetail for the local recipe
}) {
  const [importing, setImporting] = useState(false);

  const handleImport = async () => {
    if (!slot.link) return;
    setImporting(true);
    try {
      await onImport(slot.link);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '4px',
      padding: '8px', borderRadius: '8px',
      background: 'var(--bg-secondary)',
      position: 'relative',
    }}>
      {/* Meal name + image */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {slot.imageUrl && (
          <img
            src={slot.imageUrl}
            alt={slot.name}
            style={{ width: '40px', height: '40px', borderRadius: '6px', objectFit: 'cover' }}
            loading="lazy"
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 600, fontSize: '14px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{slot.name}</div>
          {slot._sharedBy && (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Added by {slot._sharedBy}
            </div>
          )}
        </div>
      </div>

      {/* Import / Save / Open actions */}
      {hasLocalRecipe ? (
        <button
          onClick={onOpenLocal}
          style={{
            padding: '6px 12px', fontSize: '13px',
            borderRadius: '6px', border: '1px solid var(--border)',
            background: 'var(--primary)', color: '#fff',
            cursor: 'pointer',
          }}
        >Open Recipe</button>
      ) : slot.link ? (
        <button
          onClick={handleImport}
          disabled={importing}
          style={{
            padding: '6px 12px', fontSize: '13px',
            borderRadius: '6px', border: '1px solid var(--primary)',
            background: 'transparent', color: 'var(--primary)',
            cursor: 'pointer',
          }}
        >{importing ? 'Importing…' : 'Import to My Library'}</button>
      ) : transferId ? (
        <button
          onClick={() => onSaveTransfer(transferId)}
          style={{
            padding: '6px 12px', fontSize: '13px',
            borderRadius: '6px', border: '1px solid var(--primary)',
            background: 'transparent', color: 'var(--primary)',
            cursor: 'pointer',
          }}
        >Save to My Library</button>
      ) : null}
    </div>
  );
}
