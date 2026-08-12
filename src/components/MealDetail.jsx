import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { X, Share2, Copy, Check, Heart, Star, RefreshCw, Flame, UtensilsCrossed, ChefHat, Martini, FileDown, Play, Images, Pencil, UserPlus, MoreVertical, Tag, Clock, Globe, Leaf } from 'lucide-react';
import PhotoGallery from './PhotoGallery';
import { NUTRITION_LABELS } from '../recipeSchema';
import { formatNutritionValue, formatIngredientLine } from '../utils/displayFormatter';
import { getMealVideoSource } from '../lib/videoSource';
import { buildPantryMatchIndex } from '../lib/pantryMatch.js';
import { getTotalMinutes, formatMinutes } from '../lib/recipeTime.js';
import { getUserTags } from '../db';
import { getStrengthTier } from '../lib/abvCalculator.js';

const STRENGTH_LABELS = {
  virgin: 'Zero-proof',
  light: 'Light',
  medium: 'Medium',
  strong: 'Strong',
  'very strong': 'Very strong',
  unknown: '',
};

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

export default function MealDetail({ meal, onClose, onShare, onExport, onToggleFavorite, onRate, onStartCook, onStartMix, onToggleRotation, isDrink = false, onMoveToBar, onPlayVideo, onEdit, onSendToFriend, fridgeInventory = [] }) {
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

  // ── Ingredient check-off (session-local, tap-to-strike-through) ──
  // Resets whenever a different meal is opened, since this component instance
  // is reused across meals (App.jsx renders it with a fixed key="meal-detail").
  const [checkedIngredients, setCheckedIngredients] = useState(() => new Set());
  useEffect(() => {
    setCheckedIngredients(new Set());
  }, [meal.id, meal.name]);
  const toggleIngredientChecked = useCallback((i) => {
    setCheckedIngredients(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }, []);

  // ── Pantry cross-reference — reuses the same buildPantryMatchIndex logic
  // MealLibrary already uses for its tile badges, scoped to just this meal so
  // each ingredient line can show whether it's already in the pantry. ──
  const missingIngredientSet = useMemo(() => {
    if (isDrink) return new Set();
    const index = buildPantryMatchIndex(fridgeInventory, [meal]);
    const match = index.get(meal.id || meal.name);
    return new Set((match?.missing || []).map(n => n.toLowerCase().trim()));
  }, [fridgeInventory, meal, isDrink]);

  // 1.7: glass/garnish/method/abv are extracted and persisted on import
  // (recipeSchema.js thinFromStructured) but MealDetail — the only detail
  // view drinks get — never rendered them, so even a correct extraction
  // looked broken to the user (I-6, bar-library-parity-plan-2026-08-07.md).
  const drinkStrengthTier = useMemo(
    () => (isDrink ? getStrengthTier(typeof meal.abv === 'number' ? meal.abv : null) : 'unknown'),
    [isDrink, meal.abv],
  );

  // ── Labels row ──────────────────────────────────────────────────────────────
  // Every facet the Meal Library filters on — total time, cuisine, dietary
  // tags, and the user's own custom labels — was filterable there but invisible
  // here, so a recipe's tags effectively vanished the moment you opened it.
  // This block re-surfaces all four in one metadata row.
  //
  // Custom labels are stored on the meal as plain name strings (meal.tags);
  // their colours live in the userTags table, so we look the palette up once
  // and fall back to a neutral chip for a label whose tag was since deleted.
  const [tagPalette, setTagPalette] = useState(() => new Map());
  useEffect(() => {
    let cancelled = false;
    getUserTags()
      .then(list => {
        if (cancelled) return;
        setTagPalette(new Map((list || []).map(t => [t.name, t.color])));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const customTags = useMemo(
    () => (Array.isArray(meal.tags) ? meal.tags.filter(t => typeof t === 'string' && t.trim()) : []),
    [meal.tags]
  );

  const dietaryTags = useMemo(() => {
    const raw = Array.isArray(meal.dietaryTags) ? meal.dietaryTags : [];
    const seen = new Set();
    const out = [];
    for (const entry of raw) {
      const name = String(
        entry && typeof entry === 'object' ? (entry.name || entry.label || '') : (entry || '')
      ).trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out;
  }, [meal.dietaryTags]);

  const totalTimeLabel = useMemo(() => formatMinutes(getTotalMinutes(meal)), [meal]);
  const cuisineLabel = useMemo(() => String(meal.cuisine || '').trim(), [meal.cuisine]);

  const hasLabels = !!(totalTimeLabel || cuisineLabel || dietaryTags.length || customTags.length);

  // ── Header diet: Heart + ⋮ overflow + Close only. Everything else that
  // used to live in the header (Edit/Share/Send to Friend/Export) moves into
  // this menu; Re-import's standalone floating-over-the-image copy is gone
  // too — the overflow item below and the Source section's own button are
  // the only two Re-import entry points left. ──
  const [overflowOpen, setOverflowOpen] = useState(false);

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
  // 2026-08-11: this used to be an either/or (scan pages OR carousel, never
  // both) and never looked at _igCarouselImages at all, so a dual-source
  // blog-link-follower import (blog hero + IG cover, or a re-import that
  // folded a "runner-up" photo into _carouselImages — see recipeParser.js
  // and CoverPicker.jsx) could gather photos the gallery would just never
  // show. Now a full union of every source the pipeline can produce:
  //   _scanPages         — multi-page photo/PDF Vision scans (lib/photoImportEngine.js)
  //   _carouselImages     — Instagram/Reddit carousel + dual-source extras,
  //                         persisted as {url, dataUrl, kind}
  //   _igCarouselImages   — same carousel's *raw* remote URLs, kept as a
  //                         fallback in case persistence failed for an entry;
  //                         skipped here whenever _carouselImages already has
  //                         that same raw url (same photo, don't double it up)
  // The chosen cover (localImageUrl) always leads; everything else is deduped
  // by src so nothing appears twice regardless of which array it came from.
  const galleryImages = useMemo(() => {
    const list = [];
    const seen = new Set();
    const push = (src) => {
      if (!src || seen.has(src)) return;
      seen.add(src);
      list.push({ src, title: meal.name });
    };
    push(localImageUrl);

    if (Array.isArray(meal._scanPages)) {
      for (const src of meal._scanPages) push(src);
    }

    const carouselRawUrls = new Set();
    if (Array.isArray(meal._carouselImages)) {
      for (const c of meal._carouselImages) {
        if (c?.url) carouselRawUrls.add(c.url);
        push(c?.dataUrl || c?.url);
      }
    }

    if (Array.isArray(meal._igCarouselImages)) {
      for (const src of meal._igCarouselImages) {
        if (carouselRawUrls.has(src)) continue; // same photo, already added above
        push(src);
      }
    }

    return list;
  }, [localImageUrl, meal._scanPages, meal._carouselImages, meal._igCarouselImages, meal.name]);

  const hasGallery = galleryImages.length > 1;
  // Beyond ~8, individual dots get too small to hit reliably — fall back to
  // the compact count pill instead of cramming the strip.
  const useDots = hasGallery && galleryImages.length <= 8;

  const openLightboxAt = useCallback((idx) => {
    setLightboxIndex(idx);
    setLightboxOpen(true);
  }, []);

  // ── Swipeable hero carousel — the "multiphoto viewer" itself, not just an
  // entry point into the lightbox. Scroll-snap does the heavy lifting (no
  // extra JS drag library needed); this just tracks which slide is centered
  // so the dot strip below can reflect it, and lets a dot tap jump-scroll.
  const heroScrollRef = useRef(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const heroRafRef = useRef(null);

  const handleHeroScroll = useCallback(() => {
    if (heroRafRef.current) return;
    heroRafRef.current = requestAnimationFrame(() => {
      heroRafRef.current = null;
      const el = heroScrollRef.current;
      if (!el || !el.clientWidth) return;
      const idx = Math.round(el.scrollLeft / el.clientWidth);
      setActiveSlide(prev => (prev !== idx ? idx : prev));
    });
  }, []);

  useEffect(() => () => { if (heroRafRef.current) cancelAnimationFrame(heroRafRef.current); }, []);

  const scrollToSlide = useCallback((idx) => {
    const el = heroScrollRef.current;
    if (!el) return;
    el.scrollTo({ left: idx * el.clientWidth, behavior: 'smooth' });
    setActiveSlide(idx);
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
            {onToggleFavorite && (
              <button
                className={`btn-icon heart-btn-detail ${meal.isFavorite ? 'favorited' : ''}`}
                onClick={() => onToggleFavorite(meal)}
                title={meal.isFavorite ? 'Unfavorite' : 'Favorite'}
                aria-label={meal.isFavorite ? 'Unfavorite' : 'Favorite'}
              >
                <Heart size={18} strokeWidth={1.75} fill={meal.isFavorite ? 'currentColor' : 'none'} style={{ color: meal.isFavorite ? '#e53935' : 'inherit' }} />
              </button>
            )}
            {(onEdit || onShare || onSendToFriend || onExport || sourceUrl) && (
              <div style={{ position: 'relative' }}>
                <button
                  className="btn-icon"
                  onClick={() => setOverflowOpen(v => !v)}
                  title="More options"
                  aria-label="More options"
                  aria-expanded={overflowOpen}
                >
                  <MoreVertical size={18} strokeWidth={1.75} />
                </button>
                <AnimatePresence>
                  {overflowOpen && (
                    <>
                      <div className="detail-overflow-scrim" onClick={() => setOverflowOpen(false)} />
                      <motion.div
                        className="detail-overflow-menu"
                        initial={{ opacity: 0, scale: 0.95, y: -6 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -6 }}
                        transition={{ duration: 0.14 }}
                      >
                        {onEdit && <button className="detail-overflow-item" onClick={() => { setOverflowOpen(false); onEdit(); }}><Pencil size={15} strokeWidth={1.75} /> Edit</button>}
                        <button className="detail-overflow-item" onClick={() => { setOverflowOpen(false); onShare(); }}><Share2 size={15} strokeWidth={1.75} /> Share</button>
                        {onSendToFriend && <button className="detail-overflow-item" onClick={() => { setOverflowOpen(false); onSendToFriend(); }}><UserPlus size={15} strokeWidth={1.75} /> Send to Friend</button>}
                        {onExport && <button className="detail-overflow-item" onClick={() => { setOverflowOpen(false); onExport(); }}><FileDown size={15} strokeWidth={1.75} /> Export</button>}
                        {sourceUrl && <button className="detail-overflow-item" onClick={() => { setOverflowOpen(false); handleReimport(); }}><RefreshCw size={15} strokeWidth={1.75} /> Re-import</button>}
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            )}
            <button className="btn-icon" onClick={onClose} aria-label="Close"><X size={18} strokeWidth={1.75} /></button>
          </div>
        </div>

        {/* ── Cookbook stamp for shared recipes ── */}
        {meal._sharedFrom && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', margin: '0 12px 6px',
            borderRadius: 10,
            background: 'rgba(var(--primary-rgb, 255,107,53), 0.08)',
            border: '1px solid rgba(var(--primary-rgb, 255,107,53), 0.18)',
          }}>
            <span style={{ fontSize: 14 }} aria-hidden="true">📖</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)' }}>
              From @{meal._sharedFrom}
            </span>
            {meal._sharedAt && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                {new Date(meal._sharedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            )}
          </div>
        )}

        {/* ── Hero media: 16:9 banner, dark gradient + integrated play button
            when a video source exists, instead of a small corner badge.
            Re-import's standalone floating copy is gone — see the ⋮ overflow
            menu above and the Source section below. ── */}
        <div className={`detail-image-wrap${videoSource ? ' detail-image-wrap-video' : ''}`}>
          {hasGallery ? (
            // Multiphoto viewer: the hero itself swipes (scroll-snap, no
            // extra drag library) instead of hiding every photo behind a
            // tap into the lightbox. Tapping a slide still opens the full
            // PhotoGallery/PhotoSwipe lightbox at that index for pinch-zoom.
            <div className="detail-hero-carousel" ref={heroScrollRef} onScroll={handleHeroScroll}>
              {galleryImages.map((img, i) => (
                <img
                  key={img.src.slice(0, 80) + i}
                  src={img.src}
                  alt={i === 0 ? meal.name : `${meal.name} — photo ${i + 1} of ${galleryImages.length}`}
                  className="detail-hero-slide"
                  onClick={() => openLightboxAt(i)}
                  onError={e => { e.target.style.display = 'none'; }}
                />
              ))}
            </div>
          ) : localImageUrl ? (
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

          {/* Hero gradient + integrated play control — same onPlayVideo/
              FloatingVideoPlayer wiring as before, just presented as part of
              the hero banner instead of a small corner badge. */}
          {videoSource && (
            <div className="detail-hero-gradient" onClick={() => onPlayVideo(meal)}>
              <button
                className="detail-play-btn"
                aria-label={`Play ${videoSource.label} video in floating player`}
                title={`Play video (${videoSource.label})`}
                onClick={(e) => { e.stopPropagation(); onPlayVideo(meal); }}
              >
                <Play size={18} fill="#fff" color="#fff" aria-hidden="true" />
              </button>
              <span className="detail-hero-video-label">{videoSource.label} video</span>
            </div>
          )}

          {/* Dot pagination — echoes Instagram's own carousel-post indicator,
              a deliberate on-brand callback since these recipes usually came
              FROM Instagram. Falls back to the compact count pill once the
              strip would get too cramped to tap reliably (>8 photos). */}
          {useDots && (
            <div className="detail-hero-dots" role="tablist" aria-label={`${galleryImages.length} photos`}>
              {galleryImages.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === activeSlide}
                  aria-label={`Photo ${i + 1} of ${galleryImages.length}`}
                  className="detail-hero-dot"
                  onClick={() => scrollToSlide(i)}
                >
                  <span className={`detail-hero-dot-inner${i === activeSlide ? ' is-active' : ''}`} />
                </button>
              ))}
            </div>
          )}
          {hasGallery && !useDots && (
            <button
              className="detail-photo-count"
              onClick={() => openLightboxAt(activeSlide)}
              aria-label={`View all ${galleryImages.length} photos — swipe to browse`}
              title="Swipe to view all photos"
            >
              <Images size={13} strokeWidth={2} aria-hidden="true" /> {activeSlide + 1}/{galleryImages.length}
            </button>
          )}
        </div>

        {/* Rating, Category, Cook Count — Heart moved to the top header,
            Add to Rotation moved to the sticky bottom bar (see below). */}
        <div className="detail-header-bar">
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

        {/* ── Labels: time · cuisine · dietary tags · the user's custom labels.
            All four are Meal Library filter facets that previously had no
            representation on the recipe itself. Custom labels carry their own
            colour from the userTags table; everything else stays neutral so
            the user's own labels are the ones that read loudest. ── */}
        {hasLabels && (
          <div className="detail-labels-row">
            {totalTimeLabel && (
              <span className="detail-label-chip" title="Total time">
                <Clock size={12} strokeWidth={2.25} aria-hidden="true" /> {totalTimeLabel}
              </span>
            )}
            {cuisineLabel && (
              <span className="detail-label-chip" title="Cuisine">
                <Globe size={12} strokeWidth={2.25} aria-hidden="true" /> {cuisineLabel}
              </span>
            )}
            {dietaryTags.map(name => (
              <span key={`diet-${name}`} className="detail-label-chip detail-label-chip--diet" title="Dietary tag">
                <Leaf size={12} strokeWidth={2.25} aria-hidden="true" /> {name}
              </span>
            ))}
            {customTags.map(name => {
              const color = tagPalette.get(name);
              return (
                <span
                  key={`tag-${name}`}
                  className="detail-label-chip detail-label-chip--custom"
                  title="Custom label"
                  style={color ? { borderColor: color, color, background: `color-mix(in srgb, ${color} 12%, transparent)` } : undefined}
                >
                  <Tag size={12} strokeWidth={2.25} aria-hidden="true" /> {name}
                </span>
              );
            })}
            {onEdit && (
              <button
                type="button"
                className="detail-label-edit"
                onClick={onEdit}
                title="Edit labels"
                aria-label="Edit labels"
              >
                <Pencil size={12} strokeWidth={2.25} aria-hidden="true" /> Edit
              </button>
            )}
          </div>
        )}

        {/* No labels yet — one quiet prompt instead of a silently empty row,
            so "this recipe has no labels" is a state you can act on. Meals
            only: AddEditMeal's Labels picker is gated to meal mode, so
            offering this on a drink would open a form with nothing to set. */}
        {!hasLabels && onEdit && !isDrink && (
          <div className="detail-labels-row">
            <button
              type="button"
              className="detail-label-empty"
              onClick={onEdit}
            >
              <Tag size={12} strokeWidth={2.25} aria-hidden="true" /> Add labels
            </button>
          </div>
        )}

        {/* Drink spec strip — Glass · Method · Garnish, plus a strength chip.
            1.7: the smallest change with the largest "the import finally
            works" payoff — these fields already exist on the recipe, they
            just never rendered anywhere. */}
        {isDrink && (meal.glass || meal.method || meal.garnish || typeof meal.abv === 'number') && (
          <div className="detail-drink-spec-row">
            {[meal.glass, meal.method, meal.garnish].filter(Boolean).length > 0 && (
              <span className="detail-drink-spec-text">
                {[meal.glass, meal.method, meal.garnish].filter(Boolean).join(' · ')}
              </span>
            )}
            {typeof meal.abv === 'number' && drinkStrengthTier !== 'unknown' && (
              <span className={`detail-strength-chip detail-strength-chip--${drinkStrengthTier.replace(' ', '-')}`}>
                <Flame size={12} strokeWidth={2.25} aria-hidden="true" />
                {STRENGTH_LABELS[drinkStrengthTier] || drinkStrengthTier} · {meal.abv}% ABV
              </span>
            )}
          </div>
        )}

        {/* Description + Yield — shown when LLM extracted a summary */}
        {(meal.description || meal.recipeYield) && (
          <div className="detail-description-bar" style={{ padding: '0 16px 8px', fontSize: 14, color: 'var(--text-light)' }}>
            {meal.description && <span>{meal.description}</span>}
            {meal.description && meal.recipeYield && <span> · </span>}
            {meal.recipeYield && <span style={{ fontWeight: 500 }}>{meal.recipeYield}</span>}
          </div>
        )}

        {/* Scale selector moved to the sticky bottom bar (see end of file). */}

        <div className="detail-section">
          <h3>{isDrink ? '🍸 Ingredients' : '📝 Ingredients'}</h3>
          <ul className="ingredient-list">
            {scaledIngredients.map((ing, i) => {
              const structName = meal.ingredientsStructured?.[i]?.name || meal.ingredientsStructured?.[i]?.ingredient || '';
              const isMissing = structName && missingIngredientSet.has(structName.toLowerCase().trim());
              const isChecked = checkedIngredients.has(i);
              return (
                <li
                  key={i}
                  className={`ingredient-item${isChecked ? ' checked' : ''}`}
                  onClick={() => toggleIngredientChecked(i)}
                >
                  <span className="ingredient-text">{ing}</span>
                  {isMissing && !isChecked && <span className="ingredient-missing-chip">Missing</span>}
                </li>
              );
            })}
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

        {/* ── Source links: dual (blog + reel) when blog link follower provided both ── */}
        {(meal.link || meal._sources?.blogUrl) && (() => {
          const blogUrl = meal._sources?.blogUrl || null;
          const igUrl = meal._sources?.instagramUrl || meal._sources?.videoUrl || null;
          const primaryUrl = blogUrl || meal.link;
          const hasDualSource = !!(blogUrl && igUrl && igUrl !== primaryUrl);

          let primaryDomain = '';
          try { primaryDomain = new URL(primaryUrl).hostname.replace(/^www\./, ''); } catch {}

          // For re-import, always use the IG URL if available (import pipeline entry point)
          const reimportUrl = igUrl || meal.sourceUrl || meal.link;
          // Secondary reel link: show IG/YT URLs for dual-source recipes
          const reelUrl = hasDualSource ? igUrl : null;
          const isReel = reelUrl && /\/(reel|tv)\//i.test(reelUrl);

          // P2-10: confidence badge for blog extraction quality
          const exSrc = meal._extractionSource || '';
          const blogConfidence = exSrc === 'blog_link_follower' ? 'high'
            : exSrc === 'blog_link_follower+ai' ? 'medium' : null;

          return (
            <div className="detail-section detail-source-section">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ margin: 0 }}>🔗 Source</h3>
                {blogConfidence && (
                  <span className={`detail-source-badge detail-source-badge-${blogConfidence}`}>
                    {blogConfidence === 'high' ? 'Structured Recipe' : 'Blog + AI Merge'}
                  </span>
                )}
              </div>
              {/* Primary link */}
              <div className="detail-source-row">
                {primaryDomain && <span className="detail-source-domain">{primaryDomain}</span>}
                <a href={primaryUrl} target="_blank" rel="noopener noreferrer" className="detail-source-link">
                  {hasDualSource ? `Full recipe on ${primaryDomain}` : 'View Original'}
                </a>
                <CopyLinkButton url={primaryUrl} />
                {/* P2-11: dual-source → "Re-extract" from blog; single → normal "Re-import" */}
                {hasDualSource ? (
                  <button
                    className="detail-source-reimport"
                    onClick={() => {
                      if (window.__spicehubTriggerImport) {
                        window.__spicehubTriggerImport(primaryUrl);
                        onClose();
                      } else {
                        navigator.clipboard.writeText(primaryUrl).catch(() => {});
                        alert('Link copied — open Import to re-extract from this blog.');
                      }
                    }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    title="Re-extract recipe directly from the blog"
                  >
                    <RefreshCw size={16} strokeWidth={1.75} /> Re-extract
                  </button>
                ) : (
                  <button
                    className="detail-source-reimport"
                    onClick={() => {
                      if (window.__spicehubTriggerImport) {
                        window.__spicehubTriggerImport(reimportUrl);
                        onClose();
                      } else {
                        navigator.clipboard.writeText(reimportUrl).catch(() => {});
                        alert('Link copied — open Import to re-import this recipe.');
                      }
                    }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <RefreshCw size={16} strokeWidth={1.75} /> Re-import
                  </button>
                )}
              </div>
              {/* Secondary: Original Reel / Post (dual-source only) */}
              {reelUrl && (() => {
                let reelDomain = '';
                try { reelDomain = new URL(reelUrl).hostname.replace(/^www\./, ''); } catch {}
                return (
                  <div className="detail-source-row" style={{ marginTop: 6 }}>
                    {reelDomain && <span className="detail-source-domain">{reelDomain}</span>}
                    <a href={reelUrl} target="_blank" rel="noopener noreferrer" className="detail-source-link">
                      {isReel ? 'Original Reel' : 'Original Post'}
                    </a>
                    <CopyLinkButton url={reelUrl} />
                    {/* P2-11: re-import from Instagram (full pipeline with caption) */}
                    <button
                      className="detail-source-reimport"
                      onClick={() => {
                        if (window.__spicehubTriggerImport) {
                          window.__spicehubTriggerImport(reelUrl);
                          onClose();
                        } else {
                          navigator.clipboard.writeText(reelUrl).catch(() => {});
                          alert('Link copied — open Import to re-import from Instagram.');
                        }
                      }}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <RefreshCw size={16} strokeWidth={1.75} /> Re-import
                    </button>
                    {videoSource && onPlayVideo && (
                      <button
                        className="detail-source-reimport detail-source-pip-btn"
                        onClick={() => onPlayVideo(meal)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        title="Play in floating player"
                      >
                        <Play size={14} fill="currentColor" color="currentColor" /> PiP
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })()}

        {/* Start Cooking / Start Mixing moved to the sticky bottom bar. */}

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

        {/* ── Sticky bottom action bar: scale, Add to Rotation, Start Cooking/
            Mixing — the highest-priority actions, kept reachable without
            scrolling back up, instead of competing for space above the fold. ── */}
        {(scaleOptions.length > 0 || onToggleRotation || (onStartCook && meal.directions?.length > 0) || (onStartMix && meal.directions?.length > 0)) && (
          <div className="detail-sticky-bar">
            <div className="detail-sticky-scale">
              <span className="detail-sticky-scale-label">Scale</span>
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
            <div className="detail-sticky-actions">
              {onToggleRotation && (
                <button
                  className={`rotation-toggle-btn ${meal.inRotation ? 'in-rotation' : ''}`}
                  onClick={() => onToggleRotation(meal)}
                  title={meal.inRotation ? 'Remove from The Rotation' : 'Add to The Rotation'}
                >
                  <RefreshCw size={15} strokeWidth={1.75} /> {meal.inRotation ? 'In Rotation' : 'Add to Rotation'}
                </button>
              )}
              {onStartCook && meal.directions && meal.directions.length > 0 && (
                <button
                  className="cook-mode-launch-btn"
                  onClick={() => { onClose(); onStartCook(meal, scaleFactor); }}
                >
                  <ChefHat size={17} strokeWidth={1.75} /> Start Cooking
                </button>
              )}
              {onStartMix && meal.directions && meal.directions.length > 0 && (
                <button
                  className="cook-mode-launch-btn mix-mode-launch-btn"
                  onClick={() => { onClose(); onStartMix(meal, scaleFactor); }}
                >
                  <Martini size={17} strokeWidth={1.75} /> Start Mixing
                </button>
              )}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
