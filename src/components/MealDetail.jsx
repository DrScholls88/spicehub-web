import { useState, useRef, useCallback } from 'react';
import { motion, useDragControls } from 'framer-motion';
import { X, Share2, Copy, Check, Heart, Star, RefreshCw, Flame, UtensilsCrossed, Loader2, CheckCircle2, XCircle, Camera, ChefHat, Martini, FileDown } from 'lucide-react';
import db from '../db';
import PhotoGallery from './PhotoGallery';
import { NUTRITION_LABELS } from '../recipeSchema';
import { formatNutritionValue, formatIngredientLine } from '../utils/displayFormatter';

function CopyLinkButton({ url }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <button className="detail-source-copy" onClick={handleCopy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {copied ? <Check size={16} strokeWidth={1.75} /> : <Copy size={16} strokeWidth={1.75} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function MealDetail({ meal, onClose, onShare, onExport, onToggleFavorite, onRate, onStartCook, onStartMix, onToggleRotation, isDrink = false, onPhotoUpdated }) {
  // ── Drag-down-to-dismiss ──
  const sheetRef = useRef(null);
  const dragControls = useDragControls();

  const handleSheetDragEnd = useCallback((_e, info) => {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      onClose();
    }
  }, [onClose]);
  const scaleOptions = [
    { value: 1.0, label: '1×' },
    { value: 1.5, label: '1.5×' },
    { value: 2.0, label: '2×' },
  ];
  const [scaleFactor, setScaleFactor] = useState(1.0);

  // ── PhotoSwipe lightbox ────────────────────────────────────────────────────────
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // ── Re-import photo ───────────────────────────────────────────────────────────
  // Local imageUrl override so the new photo shows immediately without parent re-render.
  const [localImageUrl, setLocalImageUrl] = useState(meal.imageUrl || null);
  const [photoState, setPhotoState] = useState(null); // null | 'loading' | 'done' | 'none'
  const sourceUrl = meal.link || meal.sourceUrl || null;

  const handleReimportPhoto = useCallback(async () => {
    if (!sourceUrl) { setPhotoState('none'); return; }
    setPhotoState('loading');
    try {
      const res = await fetch('/api/import/photo-only', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sourceUrl }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok && data.imageUrl) {
        await db.meals.update(meal.id, { imageUrl: data.imageUrl });
        setLocalImageUrl(data.imageUrl);
        setPhotoState('done');
        onPhotoUpdated?.(meal.id, data.imageUrl);
      } else {
        setPhotoState('none');
      }
    } catch {
      setPhotoState('none');
    }
  }, [sourceUrl, meal.id, onPhotoUpdated]);

  // Scale + format ingredients: prefer structured data (display formatter with
  // unicode fractions + auto-pluralization), fall back to regex for legacy records.
  const scaleIngredientLegacy = (ingredient, factor) => {
    const regex = /^(\d+\.?\d*|\d+\/\d+|\d+\s+\d+\/\d+)\s*(.*)$/;
    const match = ingredient.match(regex);
    if (!match) return ingredient;
    const [, amount, rest] = match;
    let value = 0;
    const parts = amount.split(/\s+/);
    for (const part of parts) {
      if (part.includes('/')) {
        const [num, denom] = part.split('/').map(Number);
        value += denom ? num / denom : 0;
      } else {
        value += parseFloat(part) || 0;
      }
    }
    const scaled = value * factor;
    const fmt = scaled % 1 !== 0 ? scaled.toFixed(2).replace(/\.?0+$/, '') : Math.round(scaled).toString();
    return `${fmt} ${rest}`;
  };

  const scaledIngredients = Array.isArray(meal.ingredientsStructured) && meal.ingredientsStructured.length > 0
    ? meal.ingredientsStructured.map(item =>
        formatIngredientLine(item, { useFractions: true, includeSection: true, scaleFactor })
      )
    : meal.ingredients.map(ing => scaleIngredientLegacy(ing, scaleFactor));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div
        ref={sheetRef}
        className="modal-content detail-modal modal-slide-up"
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
          className="detail-swipe-handle"
          aria-hidden="true"
          onPointerDown={(e) => dragControls.start(e)}
        />
        <div className="modal-header">
          <h2>{meal.name}</h2>
          <div className="modal-header-actions">
            <button className="btn-icon" onClick={onShare} title="Share" aria-label="Share recipe"><Share2 size={18} strokeWidth={1.75} /></button>
            {onExport && <button className="btn-icon" onClick={onExport} title="Export options" aria-label="Export recipe"><FileDown size={18} strokeWidth={1.75} /></button>}
            <button className="btn-icon" onClick={onClose} aria-label="Close"><X size={18} strokeWidth={1.75} /></button>
          </div>
        </div>

        {/* ── Recipe image with re-import photo button ── */}
        <div className="detail-image-wrap">
          {localImageUrl ? (
            <img
              src={localImageUrl}
              alt={meal.name}
              className="detail-image"
              style={{ cursor: 'zoom-in' }}
              onClick={() => setLightboxOpen(true)}
              onError={e => { e.target.style.display = 'none'; }}
            />
          ) : (
            <div className="detail-image-placeholder"><UtensilsCrossed size={32} strokeWidth={1.75} /></div>
          )}
          {localImageUrl && (
            <PhotoGallery
              images={[{ src: localImageUrl, title: meal.name }]}
              open={lightboxOpen}
              onClose={() => setLightboxOpen(false)}
            />
          )}
          {/* Re-import photo button — shown when there's a source URL to scrape */}
          {sourceUrl && (
            <button
              className={`detail-reimport-photo-btn${photoState === 'done' ? ' photo-found' : photoState === 'none' ? ' photo-none' : ''}`}
              onClick={handleReimportPhoto}
              disabled={photoState === 'loading'}
              title={localImageUrl ? 'Find a better photo' : 'Find a photo for this recipe'}
              aria-label="Re-import photo"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              {photoState === 'loading' ? (
                <Loader2 size={16} strokeWidth={1.75} style={{ animation: 'spin 0.8s linear infinite' }} />
              ) : photoState === 'done' ? (
                <><CheckCircle2 size={16} strokeWidth={1.75} /> Photo updated</>
              ) : photoState === 'none' ? (
                <><XCircle size={16} strokeWidth={1.75} /> No photo found</>
              ) : localImageUrl ? (
                <Camera size={16} strokeWidth={1.75} />
              ) : (
                <><Camera size={16} strokeWidth={1.75} /> Find Photo</>
              )}
            </button>
          )}
        </div>

        {/* Favorites, Rating, Category, Cook Count */}
        <div className="detail-header-bar">
          {onToggleFavorite && (
            <button
              className={`heart-btn-detail ${meal.isFavorite ? 'favorited' : ''}`}
              onClick={() => onToggleFavorite(meal)}
              title={meal.isFavorite ? 'Unfavorite' : 'Favorite'}
            >
              <Heart
                size={20}
                strokeWidth={1.75}
                fill={meal.isFavorite ? 'currentColor' : 'none'}
                style={{ color: meal.isFavorite ? '#e53935' : 'inherit' }}
              />
            </button>
          )}
          {onRate && (
            <div className="star-rating">
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  className={`star-btn ${star <= (meal.rating || 0) ? 'filled' : ''}`}
                  onClick={() => onRate(meal, star)}
                  title={`Rate ${star} stars`}
                >
                  <Star
                    size={18}
                    strokeWidth={1.75}
                    fill={star <= (meal.rating || 0) ? 'currentColor' : 'none'}
                  />
                </button>
              ))}
            </div>
          )}
          {onToggleRotation && (
            <button
              className={`rotation-toggle-btn ${meal.inRotation ? 'in-rotation' : ''}`}
              onClick={() => onToggleRotation(meal)}
              title={meal.inRotation ? 'Remove from The Rotation' : 'Add to The Rotation'}
            >
              <RefreshCw size={16} strokeWidth={1.75} /> {meal.inRotation ? 'In Rotation' : 'Add to Rotation'}
            </button>
          )}
          <div className="detail-meta">
            {meal.category && (
              <span className="detail-category-chip">{meal.category}</span>
            )}
            {meal.cookCount ? (
              <span className="detail-cook-count" title="Times cooked">
                <Flame size={14} strokeWidth={1.75} /> {meal.cookCount}
              </span>
            ) : null}
          </div>
        </div>

        {/* Description + Yield — shown when LLM extracted a summary */}
        {(meal.description || meal.recipeYield) && (
          <div className="detail-description-bar" style={{ padding: '0 16px 8px', fontSize: 14, color: 'var(--color-text-secondary, #666)' }}>
            {meal.description && <span>{meal.description}</span>}
            {meal.description && meal.recipeYield && <span> · </span>}
            {meal.recipeYield && <span style={{ fontWeight: 500 }}>{meal.recipeYield}</span>}
          </div>
        )}

        {/* Recipe Scale Selector */}
        <div className="servings-scaler">
          <label>Scale:</label>
          <div className="scale-selector">
            {scaleOptions.map(opt => (
              <button
                key={opt.value}
                className={`btn-scale${scaleFactor === opt.value ? ' active' : ''}`}
                onClick={() => setScaleFactor(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="detail-section">
          <h3>{isDrink ? '🍸 Ingredients' : '📝 Ingredients'}</h3>
          <ul className="ingredient-list">
            {scaledIngredients.map((ing, i) => (
              <li key={i}>{ing}</li>
            ))}
          </ul>
        </div>

        <div className="detail-section">
          <h3>{isDrink ? '🫗 Instructions' : '👨‍🍳 Directions'}</h3>
          <ol className="direction-list">
            {meal.directions.map((dir, i) => (
              <li key={i}>{dir}</li>
            ))}
          </ol>
        </div>

        {/* Notes: support both structured [{title, text}] and legacy flat string */}
        {(Array.isArray(meal.notes) ? meal.notes.length > 0 : !!meal.notes) && (
          <div className="detail-section">
            <h3>📌 Notes</h3>
            {Array.isArray(meal.notes) ? meal.notes.map((note, i) => (
              <div key={i} className="detail-note-entry">
                {note.title && <strong className="detail-note-title">{note.title}</strong>}
                <p className="detail-notes">{note.text}</p>
              </div>
            )) : (
              <p className="detail-notes">{meal.notes}</p>
            )}
          </div>
        )}

        {/* Nutrition panel — only shown when LLM extracted nutrition data */}
        {meal.nutrition && Object.keys(meal.nutrition).length > 0 && (
          <div className="detail-section">
            <h3>🥗 Nutrition</h3>
            <div className="detail-nutrition-grid">
              {Object.entries(meal.nutrition).map(([key, val]) => (
                val ? (
                  <div key={key} className="detail-nutrition-item">
                    <span className="detail-nutrition-label">{NUTRITION_LABELS[key] || key}</span>
                    <span className="detail-nutrition-value">{formatNutritionValue(val)}</span>
                  </div>
                ) : null
              ))}
            </div>
          </div>
        )}

        {meal.link && (() => {
          let domain = '';
          try { domain = new URL(meal.link).hostname.replace(/^www\./, ''); } catch {}
          return (
            <div className="detail-section detail-source-section">
              <h3>🔗 Source</h3>
              <div className="detail-source-row">
                {domain && <span className="detail-source-domain">{domain}</span>}
                <a href={meal.link} target="_blank" rel="noopener noreferrer" className="detail-source-link">
                  View Original
                </a>
                <CopyLinkButton url={meal.link} />
                <button
                  className="detail-source-reimport"
                  onClick={() => {
                    if (window.__spicehubTriggerImport) {
                      window.__spicehubTriggerImport(meal.link);
                      onClose();
                    } else {
                      navigator.clipboard.writeText(meal.link).catch(() => {});
                      alert('Link copied — open Import to re-import this recipe.');
                    }
                  }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <RefreshCw size={16} strokeWidth={1.75} /> Re-import
                </button>
              </div>
            </div>
          );
        })()}

        {/* Start Cooking / Start Mixing button */}
        {onStartCook && meal.directions && meal.directions.length > 0 && (
          <div className="detail-section" style={{ paddingBottom: 20 }}>
            <button
              className="cook-mode-launch-btn"
              onClick={() => { onClose(); onStartCook(meal, scaleFactor); }}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <ChefHat size={18} strokeWidth={1.75} /> Start Cooking
            </button>
          </div>
        )}
        {onStartMix && meal.directions && meal.directions.length > 0 && (
          <div className="detail-section" style={{ paddingBottom: 20 }}>
            <button
              className="cook-mode-launch-btn mix-mode-launch-btn"
              onClick={() => { onClose(); onStartMix(meal, scaleFactor); }}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <Martini size={18} strokeWidth={1.75} /> Start Mixing
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
