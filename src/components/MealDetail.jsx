import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { X, Share2, Copy, Check, Heart, Star, RefreshCw, Flame, UtensilsCrossed, ChefHat, Martini, FileDown, Play, Images, Pencil, UserPlus, MoreVertical, Tag, Clock, Globe, Leaf, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Utensils, Salad } from 'lucide-react';
import PhotoGallery from './PhotoGallery';
import { NUTRITION_LABELS } from '../recipeSchema';
import { formatNutritionValue, formatIngredientLine } from '../utils/displayFormatter';
import { getMealVideoSource } from '../lib/videoSource';
import { buildPantryMatchIndex } from '../lib/pantryMatch.js';
import { getTotalMinutes, formatMinutes } from '../lib/recipeTime.js';
import { getUserTags } from '../db';
import { getStrengthTier } from '../lib/abvCalculator.js';

// Extracted from App.css 2026-08-24 (see the header in that file for the
// move rules). MUST stay the first stylesheet imported here: these rules
// used to live in App.css, which loads ahead of every component sheet, and
// importing it first is what preserves that order for equal-specificity ties.
import '../styles/screens/MealDetail.css';

const STRENGTH_LABELS = {
  virgin: 'Zero-proof',
  light: 'Light',
  medium: 'Medium',
  strong: 'Strong',
  'very strong': 'Very strong',
  unknown: '',
};

/* Quick-glance ease badge — total cook time → difficulty proxy.
   Thresholds are lenient (most social-media recipes are ≤ 45min). */
function easeBadge(totalMin) {
  if (!totalMin || totalMin <= 0) return null;
  if (totalMin <= 20) return { label: 'Quick', level: 'easy', cls: 'detail-qi-ease--easy' };
  if (totalMin <= 45) return { label: 'Moderate', level: 'moderate', cls: 'detail-qi-ease--moderate' };
  return { label: 'Involved', level: 'involved', cls: 'detail-qi-ease--involved' };
}

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

  // ── Pantry cross-reference ──
  const missingIngredientSet = useMemo(() => {
    if (isDrink) return new Set();
    const index = buildPantryMatchIndex(fridgeInventory, [meal]);
    const match = index.get(meal.id || meal.name);
    return new Set((match?.missing || []).map(n => n.toLowerCase().trim()));
  }, [fridgeInventory, meal, isDrink]);

  // Drink ABV strength tier
  const drinkStrengthTier = useMemo(
    () => (isDrink ? getStrengthTier(typeof meal.abv === 'number' ? meal.abv : null) : 'unknown'),
    [isDrink, meal.abv],
  );

  // ── Labels row ──
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

  // ── Quick Info computed values ──
  const totalMin = useMemo(() => getTotalMinutes(meal), [meal]);
  const prepTimeLabel = useMemo(() => {
    const raw = meal.prepTime || meal.prep_time;
    if (!raw) return null;
    if (typeof raw === 'number') return formatMinutes(raw);
    const m = String(raw).match(/(\d+)/);
    return m ? formatMinutes(parseInt(m[1], 10)) : String(raw);
  }, [meal]);
  const cookTimeLabel = useMemo(() => {
    const raw = meal.cookTime || meal.cook_time;
    if (!raw) return null;
    if (typeof raw === 'number') return formatMinutes(raw);
    const m = String(raw).match(/(\d+)/);
    return m ? formatMinutes(parseInt(m[1], 10)) : String(raw);
  }, [meal]);
  const ease = useMemo(() => easeBadge(totalMin), [totalMin]);
  const hasQuickInfo = !!(prepTimeLabel || cookTimeLabel || ease || meal.recipeYield);

  // ── Sauces / Add-ons (collapsible) ──
  const [saucesExpanded, setSaucesExpanded] = useState(false);
  const hasSauces = useMemo(
    () => Array.isArray(meal.sauces) && meal.sauces.length > 0 && meal.sauces.some(s => s && (s.name || s.ingredients?.length)),
    [meal.sauces]
  );

  // ── Side dishes ──
  const hasSides = useMemo(
    () => Array.isArray(meal.sideDishes) && meal.sideDishes.length > 0 && meal.sideDishes.some(s => typeof s === 'string' && s.trim()),
    [meal.sideDishes]
  );

  // ── Overflow menu ──
  const [overflowOpen, setOverflowOpen] = useState(false);

  // ── PhotoSwipe lightbox ──
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const localImageUrl = meal.imageUrl || null;
  const sourceUrl = meal.link || meal.sourceUrl || null;

  // ── Re-import ──
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

  // ── Photo gallery ──
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
        if (carouselRawUrls.has(src)) continue;
        push(src);
      }
    }

    return list;
  }, [localImageUrl, meal._scanPages, meal._carouselImages, meal._igCarouselImages, meal.name]);

  const hasGallery = galleryImages.length > 1;
  const useDots = hasGallery && galleryImages.length <= 8;

  const openLightboxAt = useCallback((idx) => {
    setLightboxIndex(idx);
    setLightboxOpen(true);
  }, []);

  // ── Swipeable hero carousel ──
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

  // Carousel arrow navigation
  const goPrev = useCallback(() => {
    setActiveSlide(prev => {
      const next = Math.max(0, prev - 1);
      scrollToSlide(next);
      return next;
    });
  }, [scrollToSlide]);

  const goNext = useCallback(() => {
    setActiveSlide(prev => {
      const next = Math.min(galleryImages.length - 1, prev + 1);
      scrollToSlide(next);
      return next;
    });
  }, [scrollToSlide, galleryImages.length]);

  // ── PiP: floating video player ──
  const videoSource = useMemo(() => (onPlayVideo ? getMealVideoSource(meal) : null), [onPlayVideo, meal]);

  // Scale + format ingredients
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
        {/* ── Drag handle ── */}
        <div
          className="detail-swipe-handle"
          aria-hidden="true"
          onPointerDown={(e) => dragControls.start(e)}
        />

        <div className="detail-scroll-body">
        {/* ══════════════ HERO CAROUSEL ══════════════ */}
        <div className={`detail-image-wrap${videoSource ? ' detail-image-wrap-video' : ''}`}>
          {hasGallery ? (
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

          {/* Carousel arrows — only for multi-photo galleries */}
          {hasGallery && activeSlide > 0 && (
            <button className="detail-hero-arrow detail-hero-arrow--left" onClick={goPrev} aria-label="Previous photo">
              <ChevronLeft size={20} strokeWidth={2.5} />
            </button>
          )}
          {hasGallery && activeSlide < galleryImages.length - 1 && (
            <button className="detail-hero-arrow detail-hero-arrow--right" onClick={goNext} aria-label="Next photo">
              <ChevronRight size={20} strokeWidth={2.5} />
            </button>
          )}

          {/* Hero gradient + play control */}
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

          {/* Dot pagination */}
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

        {/* ══════════════ TITLE ROW — tighter, name + heart + overflow + close ══════════════ */}
        <div className="detail-title-row">
          <h2 className="detail-title-name">{meal.name}</h2>
          <div className="detail-title-actions">
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

        {/* Rating, Category, Cook Count */}
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

        {/* ── Cookbook stamp for shared recipes ── */}
        {meal._sharedFrom && (
          <div className="detail-shared-stamp">
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

        {/* Labels row */}
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

        {/* Drink spec strip */}
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

        {/* Description */}
        {meal.description && (
          <div className="detail-description-bar" style={{ padding: '0 16px 8px', fontSize: 14, color: 'var(--text-light)' }}>
            <span>{meal.description}</span>
          </div>
        )}

        {/* ══════════════ QUICK INFO STRIP ══════════════ */}
        {hasQuickInfo && (
          <div className="detail-quick-info">
            {prepTimeLabel && (
              <div className="detail-qi-cell">
                <span className="detail-qi-label">Prep</span>
                <span className="detail-qi-value">{prepTimeLabel}</span>
              </div>
            )}
            {cookTimeLabel && (
              <div className="detail-qi-cell">
                <span className="detail-qi-label">Cook</span>
                <span className="detail-qi-value">{cookTimeLabel}</span>
              </div>
            )}
            {ease && (
              <div className="detail-qi-cell">
                <span className="detail-qi-label">Ease</span>
                <span className={`detail-qi-value detail-qi-ease ${ease.cls}`}>{ease.label}</span>
              </div>
            )}
            {meal.recipeYield && (
              <div className="detail-qi-cell">
                <span className="detail-qi-label">Yield</span>
                <span className="detail-qi-value">{meal.recipeYield}</span>
              </div>
            )}
          </div>
        )}

        {/* ══════════════ TWO-COLUMN RECIPE GRID ══════════════
            Ingredients and Steps side-by-side on wider screens (> 520px),
            stacked on phones. Maximizes what's visible above the fold. */}
        <div className="detail-recipe-grid">
          {/* ── Ingredients column ── */}
          <div className="detail-recipe-col detail-recipe-col--ingredients">
            <h3>{isDrink ? '🍸 Ingredients' : '📝 Ingredients'}</h3>
            <ul className="ingredient-list ingredient-list--dense">
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
                    <span className={`ingredient-check${isChecked ? ' ingredient-check--done' : ''}`} aria-hidden="true" />
                    <span className="ingredient-text">{ing}</span>
                    {isMissing && !isChecked && <span className="ingredient-missing-chip">Missing</span>}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* ── Directions column ── */}
          <div className="detail-recipe-col detail-recipe-col--steps">
            <h3>{isDrink ? '🫗 Instructions' : '👨‍🍳 Directions'}</h3>
            <ol className="direction-list direction-list--dense">
              {meal.directions.map((dir, i) => (
                <li key={i}>{dir}</li>
              ))}
            </ol>
          </div>
        </div>

        {/* ══════════════ SAUCE / ADD-ON SUB-RECIPES (collapsible) ══════════════ */}
        {hasSauces && (
          <div className="detail-section detail-addon-section">
            <button
              type="button"
              className="detail-addon-toggle"
              onClick={() => setSaucesExpanded(v => !v)}
              aria-expanded={saucesExpanded}
            >
              <Utensils size={15} strokeWidth={2} aria-hidden="true" />
              <span className="detail-addon-toggle-label">
                Sauces &amp; Add-ons ({meal.sauces.length})
              </span>
              {saucesExpanded
                ? <ChevronUp size={16} strokeWidth={2} />
                : <ChevronDown size={16} strokeWidth={2} />}
            </button>
            <AnimatePresence initial={false}>
              {saucesExpanded && (
                <motion.div
                  className="detail-addon-body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
                  style={{ overflow: 'hidden' }}
                >
                  {meal.sauces.map((sauce, si) => (
                    <div key={si} className="detail-addon-card">
                      {sauce.name && <h4 className="detail-addon-name">{sauce.name}</h4>}
                      {Array.isArray(sauce.ingredients) && sauce.ingredients.length > 0 && (
                        <ul className="detail-addon-list">
                          {sauce.ingredients.map((ing, ii) => (
                            <li key={ii}>{ing}</li>
                          ))}
                        </ul>
                      )}
                      {Array.isArray(sauce.directions) && sauce.directions.length > 0 && (
                        <ol className="detail-addon-steps">
                          {sauce.directions.map((step, di) => (
                            <li key={di}>{step}</li>
                          ))}
                        </ol>
                      )}
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ══════════════ SIDE DISHES ══════════════ */}
        {hasSides && (
          <div className="detail-section detail-sides-section">
            <h3><Salad size={15} strokeWidth={2} style={{ verticalAlign: '-2px' }} /> Side Dishes</h3>
            <div className="detail-sides-chips">
              {meal.sideDishes.filter(s => typeof s === 'string' && s.trim()).map((side, i) => (
                <span key={i} className="detail-sides-chip">{side.trim()}</span>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
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

        {/* Nutrition panel */}
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

        {/* ── Source links ── */}
        {(meal.link || meal._sources?.blogUrl) && (() => {
          const blogUrl = meal._sources?.blogUrl || null;
          const igUrl = meal._sources?.instagramUrl || meal._sources?.videoUrl || null;
          const primaryUrl = blogUrl || meal.link;
          const hasDualSource = !!(blogUrl && igUrl && igUrl !== primaryUrl);

          let primaryDomain = '';
          try { primaryDomain = new URL(primaryUrl).hostname.replace(/^www\./, ''); } catch {}

          const reimportUrl = igUrl || meal.sourceUrl || meal.link;
          const reelUrl = hasDualSource ? igUrl : null;
          const isReel = reelUrl && /\/(reel|tv)\//i.test(reelUrl);

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
              <div className="detail-source-row">
                {primaryDomain && <span className="detail-source-domain">{primaryDomain}</span>}
                <a href={primaryUrl} target="_blank" rel="noopener noreferrer" className="detail-source-link">
                  {hasDualSource ? `Full recipe on ${primaryDomain}` : 'View Original'}
                </a>
                <CopyLinkButton url={primaryUrl} />
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

        {/* Move to Bar recovery path */}
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

        {/* ── Sticky bottom action bar ── */}
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
        </div>
      </motion.div>
    </div>
  );
}
