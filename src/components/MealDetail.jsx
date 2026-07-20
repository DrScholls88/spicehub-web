import { useState, useRef, useCallback, useMemo } from 'react';
import { motion, useDragControls } from 'framer-motion';
import { X, Share2, Copy, Check, Heart, Star, RefreshCw, Flame, UtensilsCrossed, ChefHat, Martini, FileDown, Play, Images, Pencil } from 'lucide-react';
import PhotoGallery from './PhotoGallery';
import { NUTRITION_LABELS } from '../recipeSchema';
import { formatNutritionValue, formatIngredientLine } from '../utils/displayFormatter';
import { getMealVideoSource } from '../lib/videoSource';

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

export default function MealDetail({ meal, onClose, onShare, onExport, onToggleFavorite, onRate, onStartCook, onStartMix, onToggleRotation, isDrink = false, onMoveToBar, onPlayVideo, onEdit }) {
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
    { value: 2.0, label: '2×' },
    { value: 3.0, label: '3×' },
    { value: 4.0, label: '4×' },
  ];
  const [scaleFactor, setScaleFactor] = useState(1.0);

  // ── PhotoSwipe lightbox ────────────────────────────────────────────────────────
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const localImageUrl = meal.imageUrl || null;
  const sourceUrl = meal.link || meal.sourceUrl || null;

  // ── Re-import — runs the meal back through the Import Engine ─────────────────
  // Was a photo-only "find a better photo" fetch; now a full re-import so the
  // whole recipe (not just the image) gets refreshed, same as the Source
  // section's Re-import action below.
  const handleReimport = useCallback(() => {
    if (!sourceUrl) return;
    if (window.__spicehubTriggerImport) {
      window.__spicehubTriggerImport(sourceUrl);
      onClose();
    } else {
      navigator.clipboard.writeText(sourceUrl).catch(() => {});
      alert('Link copied — open Import to re-import this recipe.');
    }
  }, [sourceUrl, onClose]);

  // ── Photo gallery — swipeable when the import captured more than one photo.
  // Multi-page photo/PDF Vision scans persist every page as meal._scanPages
  // (see lib/photoImportEngine.js); Instagram/Reddit carousels persist extras
  // as meal._carouselImages (see CoverPicker.jsx). Either way, the chosen
  // cover (localImageUrl) leads, followed by whichever extra photos exist,
  // deduped by src so the cover never appears twice.
  const galleryImages = useMemo(() => {
    const list = [];
    const seen = new Set();
    const push = (src) => {
      if (!src || seen.has(src)) return;
      seen.add(src);
      list.push({ src, title: meal.name });
    };
    push(localImageUrl);
    const extras = Array.isArray(meal._scanPages) && meal._scanPages.length > 1
      ? meal._scanPages
      : Array.isArray(meal._carouselImages)
        ? meal._carouselImages.map(c => c?.dataUrl || c?.url)
        : [];
    for (const src of extras) push(src);
    return list;
  }, [localImageUrl, meal._scanPages, meal._carouselImages, meal.name]);

  const hasGallery = galleryImages.length > 1;

  const openLightboxAt = useCallback((idx) => {
    setLightboxIndex(idx);
    setLightboxOpen(true);
  }, []);

  // ── PiP: floating video player — same source resolver MealLibrary tiles use.
  const videoSource = useMemo(() => (onPlayVideo ? getMealVideoSource(meal) : null), [onPlayVideo, meal]);

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
            {onEdit && <button className="btn-icon" onClick={onEdit} title="Edit recipe" aria-label="Edit recipe"><Pencil size={18} strokeWidth={1.75} /></button>}
            <button className="btn-icon" onClick={onShare} title="Share" aria-label="Share recipe"><Share2 size={18} strokeWidth={1.75} /></button>
            {onExport && <button className="btn-icon" onClick={onExport} title="Export options" aria-label="Export recipe"><FileDown size={18} strokeWidth={1.75} /></button>}
            <button className="btn-icon" onClick={onClose} aria-label="Close"><X size={18} strokeWidth={1.75} /></button>
          </div>
        </div>

        {/* ── Recipe image with PiP, gallery swipe, and re-import controls ── */}
        <div className="detail-image-wrap">
          {localImageUrl ? (
            <img
              src={localImageUrl}
              alt={meal.name}
              className="detail-image"
              style={{ cursor: 'zoom-in' }}
              onClick={() => openLightboxAt(0)}
              onError={e => { e.target.style.display = 'none'; }}
            />
          ) : (
            <div className="detail-image-placeholder"><UtensilsCrossed size={32} strokeWidth={1.75} /></div>
          )}
          {galleryImages.length > 0 && (
            <PhotoGallery
              images={galleryImages}
              index={lightboxIndex}
              open={lightboxOpen}
              onClose={() => setLightboxOpen(false)}
            />
          )}

          {/* PiP: play video badge — parity with the MealLibrary tile control */}
          {videoSource && (
            <button
              className={`detail-play-btn detail-play-btn-${videoSource.platform}`}
              aria-label={`Play ${videoSource.label} video in floating player`}
              title={`Play video (${videoSource.label})`}
              onClick={() => onPlayVideo(meal)}
            >
              <Play size={16} fill="#fff" color="#fff" aria-hidden="true" />
            </button>
          )}

          {/* Swipe-to-view badge — only when the import captured multiple photos
              (multi-page photo/PDF Vision scans, Instagram/Reddit carousels) */}
          {hasGallery && (
            <button
              className="detail-photo-count"
              onClick={() => openLightboxAt(0)}
              aria-label={`View all ${galleryImages.length} photos — swipe to browse`}
              title="Swipe to view all photos"
            >
              <Images size={13} strokeWidth={2} aria-hidden="true" /> 1/{galleryImages.length}
            </button>
          )}

          {/* Re-import — runs the whole recipe back through the Import Engine */}
          {sourceUrl && (
            <button
              className="detail-reimport-photo-btn"
              onClick={handleReimport}
              title="Re-run this recipe through the Import Engine"
              aria-label="Re-import"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <RefreshCw size={16} strokeWidth={1.75} /> Re-Import
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

        {/* Recovery path for a drink recipe mis-imported into the Meal Library —
            a rare correction, not a primary action, so it's a small sub-option
            rather than a full-width launch button. */}
        {onMoveToBar && (
          <div className="detail-section detail-moveto-bar-row" style={{ paddingBottom: 20, textAlign: 'center' }}>
            <button
              className="detail-moveto-bar-link"
              onClick={() => { onClose(); onMoveToBar(meal); }}
              title="This looks like it belongs in the Bar? Move it over."
            >
              <Martini size={14} strokeWidth={1.75} /> Move to Bar
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
