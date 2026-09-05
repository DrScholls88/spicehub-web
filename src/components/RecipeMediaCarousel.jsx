// src/components/RecipeMediaCarousel.jsx
//
// ── RecipeMediaCarousel ──────────────────────────────────────────────────────
// The single hero-media surface shared by the full recipe card (MealDetail)
// and the library quick-peek popup (MealLibrary). It replaces two divergent
// implementations: MealDetail had a swipeable photo carousel and a PhotoSwipe
// lightbox but no way to add or remove a photo and no inline video; the
// quick-peek had one static <img> and nothing else, so a multi-photo import
// looked single-photo until you opened the full card.
//
// What it does:
//   • Slide 1 is the VIDEO slide whenever getMealVideoSource() resolves one —
//     a tappable poster that plays the YouTube/Instagram embed *inside the
//     photo area*, with a pop-out control that hands the clip to the existing
//     FloatingVideoPlayer (PiP) so it survives closing the card.
//   • Every other slide is a photo; tapping one opens PhotoSwipe (pinch-zoom,
//     swipe between shots) at that exact photo.
//   • Add photo / Remove photo, whenever the host passes onUpdateMedia.
//
// The media model (which photos exist, in what order, and what a delete or an
// upload should persist) lives in ../lib/recipeMedia.js — pure and unit-
// tested. This file is the interaction layer only.
//
// MOUNTING NOTE: pass `key={item.id}` at the call site. Slide position and
// inline-playback state are deliberately per-recipe, and remounting is how
// they reset — cheaper and less fragile than an effect that watches the id.

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  ChevronLeft, ChevronRight, Play, Pause, PictureInPicture2, UtensilsCrossed,
  ImagePlus, Trash2, Images, Loader2, Check,
} from 'lucide-react';
import PhotoGallery from './PhotoGallery';
import { getMealVideoSource } from '../lib/videoSource';
import { buildMediaModel, mediaPatchForDelete, mediaPatchForUpload } from '../lib/recipeMedia';
import { compressBlob } from '../imageCompressor';
import { hapticLight, hapticSuccess, hapticError } from '../haptics';

import './RecipeMediaCarousel.css';

// Uploaded photos are stored as data URLs inside the Dexie record, so they
// count against the same origin quota as everything else. 1400px @ 0.82 WebP
// puts a typical phone shot around 90-160 KB — big enough that PhotoSwipe's
// pinch-zoom has something to zoom into, small enough that half a dozen of
// them on one recipe is a few hundred KB rather than tens of megabytes.
const UPLOAD_MAX_EDGE = 1400;
const UPLOAD_QUALITY = 0.82;
const MAX_UPLOAD_BATCH = 12;
const CONFIRM_WINDOW_MS = 3500;

export default function RecipeMediaCarousel({
  item,
  variant = 'detail',          // 'detail' | 'peek'
  onPopOutVideo = null,        // (item) => void — hand off to FloatingVideoPlayer
  onUpdateMedia = null,        // async (patch) => void — enables add/remove
  onToast = null,
  allowVideo = true,
  className = '',
}) {
  const videoSource = useMemo(
    () => (allowVideo ? getMealVideoSource(item) : null),
    [allowVideo, item],
  );

  const { photos, slides, videoIndex } = useMemo(
    () => buildMediaModel(item, videoSource),
    [item, videoSource],
  );

  const hasVideo = videoIndex === 0;
  const slideCount = slides.length;
  const multiSlide = slideCount > 1;
  const useDots = multiSlide && slideCount <= 8;
  const canEdit = typeof onUpdateMedia === 'function';

  // ── Horizontal scroll-snap tracking ───────────────────────────────────────
  const scrollRef = useRef(null);
  const rafRef = useRef(null);
  const [rawSlide, setRawSlide] = useState(0);

  // Derived, not stored: deleting the last photo shrinks slideCount, and the
  // browser clamps scrollLeft on its own. Clamping here as well means there
  // is no window where the component renders against an index that no longer
  // exists, and no effect chasing the state back into range.
  const activeSlide = Math.min(rawSlide, Math.max(0, slideCount - 1));

  const handleScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = scrollRef.current;
      if (!el || !el.clientWidth) return;
      const idx = Math.round(el.scrollLeft / el.clientWidth);
      setRawSlide((prev) => (prev !== idx ? idx : prev));
    });
  }, []);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const scrollToSlide = useCallback((idx) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: idx * el.clientWidth, behavior: 'smooth' });
    setRawSlide(idx);
  }, []);

  const goPrev = useCallback(() => {
    scrollToSlide(Math.max(0, activeSlide - 1));
  }, [scrollToSlide, activeSlide]);

  const goNext = useCallback(() => {
    scrollToSlide(Math.min(slideCount - 1, activeSlide + 1));
  }, [scrollToSlide, activeSlide, slideCount]);

  // ── Inline video playback ─────────────────────────────────────────────────
  // `videoPlaying` is only honoured while the video slide is the active one:
  // an embed left running behind a photo is audio with no visible transport
  // control, and the user would have to swipe back to find the pause button.
  // Deriving it (rather than clearing the flag from an effect) also means
  // swiping back to slide 1 resumes rather than dead-ending on a poster.
  const [videoPlaying, setVideoPlaying] = useState(false);
  const videoInline = videoPlaying && hasVideo && activeSlide === videoIndex;

  const startInlineVideo = useCallback(() => {
    hapticLight();
    setVideoPlaying(true);
  }, []);

  const stopInlineVideo = useCallback(() => {
    hapticLight();
    setVideoPlaying(false);
  }, []);

  const popOutVideo = useCallback(() => {
    if (!onPopOutVideo) return;
    hapticLight();
    setVideoPlaying(false);
    onPopOutVideo(item);
  }, [onPopOutVideo, item]);

  // ── PhotoSwipe lightbox ───────────────────────────────────────────────────
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const galleryImages = useMemo(
    () => photos.map((p) => ({ src: p.src, title: p.title })),
    [photos],
  );

  const openLightboxAt = useCallback((photoIndex) => {
    if (photoIndex < 0 || photoIndex >= photos.length) return;
    setLightboxIndex(photoIndex);
    setLightboxOpen(true);
  }, [photos.length]);

  const closeLightbox = useCallback(() => setLightboxOpen(false), []);

  const activePhoto = useMemo(() => {
    const slide = slides[activeSlide];
    return slide && slide.type === 'photo' ? slide : null;
  }, [slides, activeSlide]);

  // ── Add photo ─────────────────────────────────────────────────────────────
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const pickPhotos = useCallback(() => {
    hapticLight();
    fileInputRef.current?.click();
  }, []);

  const handleFiles = useCallback(async (event) => {
    const input = event.target;
    const files = Array.from(input.files || []).filter((f) => f && f.type.startsWith('image/'));
    // Cleared straight away so re-picking the same file still fires a change.
    input.value = '';
    if (!files.length || !canEdit) return;

    if (files.length > MAX_UPLOAD_BATCH) {
      onToast?.(`Adding the first ${MAX_UPLOAD_BATCH} photos.`, 'info');
    }

    setUploading(true);
    try {
      const added = [];
      for (const file of files.slice(0, MAX_UPLOAD_BATCH)) {
        // compressBlob resizes on a canvas — no network request, so this
        // works offline and stays inside the app's CSP (img-src allows
        // blob:/data:, connect-src does not).
        const dataUrl = await compressBlob(file, {
          maxWidth: UPLOAD_MAX_EDGE,
          maxHeight: UPLOAD_MAX_EDGE,
          quality: UPLOAD_QUALITY,
          format: 'image/webp',
        });
        if (dataUrl) added.push(dataUrl);
      }

      const result = mediaPatchForUpload(item, added, photos);
      if (!result) {
        hapticError();
        onToast?.(added.length ? 'Those photos are already on this recipe.' : "Couldn't read that photo.", 'error');
        return;
      }

      await onUpdateMedia(result.patch);
      hapticSuccess();
      onToast?.(
        result.fresh.length === 1 ? 'Photo added.' : `${result.fresh.length} photos added.`,
        'success',
      );

      // Land on the first newly added shot.
      const landing = (hasVideo ? 1 : 0) + photos.length;
      requestAnimationFrame(() => scrollToSlide(landing));
    } catch (err) {
      hapticError();
      onToast?.('Photo upload failed: ' + (err?.message || 'unknown error'), 'error');
    } finally {
      setUploading(false);
    }
  }, [canEdit, item, photos, onUpdateMedia, onToast, hasVideo, scrollToSlide]);

  // ── Remove photo (two-tap confirm, no blocking dialog) ────────────────────
  // Keyed by src rather than a boolean: swiping to another photo therefore
  // cancels a pending confirm automatically, so a stray second tap can never
  // land on a photo the user didn't mean to delete.
  const [confirmSrc, setConfirmSrc] = useState(null);
  const confirmTimerRef = useRef(null);
  const confirmDelete = !!activePhoto && confirmSrc === activePhoto.src;

  useEffect(() => () => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!activePhoto || !canEdit) return;

    if (!confirmDelete) {
      hapticLight();
      setConfirmSrc(activePhoto.src);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => setConfirmSrc(null), CONFIRM_WINDOW_MS);
      return;
    }

    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmSrc(null);

    const patch = mediaPatchForDelete(item, activePhoto, photos);
    if (!patch) return;

    try {
      await onUpdateMedia(patch);
      hapticSuccess();
      onToast?.('Photo removed.', 'success');
    } catch (err) {
      hapticError();
      onToast?.('Could not remove photo: ' + (err?.message || 'unknown error'), 'error');
    }
  }, [activePhoto, canEdit, confirmDelete, item, photos, onUpdateMedia, onToast]);

  // ── Render ────────────────────────────────────────────────────────────────
  const videoPoster = photos[0]?.src || null;
  const isEmpty = slideCount === 0;

  const wrapClass = [
    'rmc-wrap',
    `rmc-wrap--${variant}`,
    hasVideo ? 'rmc-wrap--video' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={wrapClass}>
      {isEmpty ? (
        <div className="rmc-placeholder">
          <UtensilsCrossed size={variant === 'peek' ? 34 : 40} strokeWidth={1.5} aria-hidden="true" />
        </div>
      ) : (
        <div
          className="rmc-track"
          ref={scrollRef}
          onScroll={handleScroll}
          aria-roledescription="carousel"
          aria-label={`${slideCount} media item${slideCount === 1 ? '' : 's'} for ${item?.name || 'this recipe'}`}
        >
          {slides.map((slide, i) => {
            if (slide.type === 'video') {
              return (
                <div className="rmc-slide rmc-slide--video" key={slide.key}>
                  {videoInline ? (
                    <iframe
                      className="rmc-video-frame"
                      src={videoSource.embedUrl}
                      title={`${item?.name || 'Recipe'} — ${videoSource.label} video`}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                      loading="lazy"
                      referrerPolicy="strict-origin-when-cross-origin"
                    />
                  ) : (
                    <button
                      type="button"
                      className="rmc-video-poster"
                      onClick={startInlineVideo}
                      aria-label={`Play the ${videoSource.label} video here`}
                    >
                      {videoPoster ? (
                        <img
                          className="rmc-video-poster-img"
                          src={videoPoster}
                          alt=""
                          aria-hidden="true"
                          onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                        />
                      ) : (
                        <span className="rmc-video-poster-fill" aria-hidden="true" />
                      )}
                      <span className="rmc-video-scrim" aria-hidden="true" />
                      <span className="rmc-video-play" aria-hidden="true">
                        <Play size={variant === 'peek' ? 20 : 26} fill="currentColor" strokeWidth={0} />
                      </span>
                      <span className="rmc-video-label">{videoSource.label} video</span>
                    </button>
                  )}

                  <div className="rmc-video-controls">
                    {videoInline && (
                      <button
                        type="button"
                        className="rmc-chip-btn"
                        onClick={stopInlineVideo}
                        aria-label="Stop the video"
                        title="Stop"
                      >
                        <Pause size={14} strokeWidth={2.25} aria-hidden="true" />
                      </button>
                    )}
                    {onPopOutVideo && (
                      <button
                        type="button"
                        className="rmc-chip-btn"
                        onClick={popOutVideo}
                        aria-label="Pop the video out into the floating player"
                        title="Pop out"
                      >
                        <PictureInPicture2 size={14} strokeWidth={2.25} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              );
            }

            return (
              <button
                type="button"
                className="rmc-slide rmc-slide--photo"
                key={slide.key}
                onClick={() => openLightboxAt(slide.photoIndex)}
                aria-label={
                  photos.length === 1
                    ? `View ${item?.name || 'recipe'} photo full screen`
                    : `View photo ${slide.photoIndex + 1} of ${photos.length} full screen`
                }
                tabIndex={i === activeSlide ? 0 : -1}
              >
                <img
                  className="rmc-photo"
                  src={slide.src}
                  alt={
                    slide.photoIndex === 0
                      ? (item?.name || 'Recipe photo')
                      : `${item?.name || 'Recipe'} — photo ${slide.photoIndex + 1} of ${photos.length}`
                  }
                  loading={i === 0 ? 'eager' : 'lazy'}
                  decoding="async"
                  onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                />
              </button>
            );
          })}
        </div>
      )}

      {/* PhotoSwipe lightbox — pinch-zoom and swipe across every photo. It
          portals itself to <body>; mounted only when there is something to
          show. */}
      {galleryImages.length > 0 && (
        <PhotoGallery
          images={galleryImages}
          index={lightboxIndex}
          open={lightboxOpen}
          onClose={closeLightbox}
        />
      )}

      {/* Arrows — a pointer affordance; touch users swipe. Hidden at the ends
          so there is never a control that does nothing. */}
      {multiSlide && activeSlide > 0 && (
        <button
          type="button"
          className="rmc-arrow rmc-arrow--left"
          onClick={goPrev}
          aria-label="Previous"
        >
          <ChevronLeft size={20} strokeWidth={2.5} aria-hidden="true" />
        </button>
      )}
      {multiSlide && activeSlide < slideCount - 1 && (
        <button
          type="button"
          className="rmc-arrow rmc-arrow--right"
          onClick={goNext}
          aria-label="Next"
        >
          <ChevronRight size={20} strokeWidth={2.5} aria-hidden="true" />
        </button>
      )}

      {/* Counter pill for galleries too long for dots. Tapping opens the
          lightbox on the current photo; on the video slide it does nothing,
          which is why it is disabled there rather than silently inert. */}
      {multiSlide && !useDots && (
        <button
          type="button"
          className="rmc-count"
          onClick={() => activePhoto && openLightboxAt(activePhoto.photoIndex)}
          disabled={!activePhoto}
          aria-label={`Item ${activeSlide + 1} of ${slideCount} — swipe to browse`}
          title="Swipe to browse"
        >
          <Images size={13} strokeWidth={2} aria-hidden="true" /> {activeSlide + 1}/{slideCount}
        </button>
      )}

      {/* Dot pagination — Instagram's own carousel indicator, which is where
          most of these photos came from. The video slide's dot is a short bar
          even when inactive, so "there's a clip on slide one" is legible
          before you swipe to it. */}
      {useDots && (
        <div className="rmc-dots" role="tablist" aria-label={`${slideCount} media items`}>
          {slides.map((slide, i) => (
            <button
              key={`dot-${slide.key}`}
              type="button"
              role="tab"
              aria-selected={i === activeSlide}
              aria-label={slide.type === 'video' ? 'Video' : `Photo ${slide.photoIndex + 1}`}
              className="rmc-dot"
              onClick={() => scrollToSlide(i)}
            >
              <span
                className={[
                  'rmc-dot-inner',
                  i === activeSlide ? 'is-active' : '',
                  slide.type === 'video' ? 'is-video' : '',
                ].filter(Boolean).join(' ')}
              />
            </button>
          ))}
        </div>
      )}

      {/* Add / Remove photo. Rendered only when the host passed a persistence
          handler, so read-only surfaces (a friend's shared recipe) still get
          the carousel without edit affordances. */}
      {canEdit && (
        <div className="rmc-edit-row">
          <button
            type="button"
            className="rmc-chip-btn rmc-chip-btn--label"
            onClick={pickPhotos}
            disabled={uploading}
            aria-label="Add a photo to this recipe"
            title="Add photo"
          >
            {uploading
              ? <Loader2 size={14} strokeWidth={2.25} className="rmc-spin" aria-hidden="true" />
              : <ImagePlus size={14} strokeWidth={2.25} aria-hidden="true" />}
            <span>{uploading ? 'Adding…' : 'Add'}</span>
          </button>

          {activePhoto && (
            <button
              type="button"
              className={`rmc-chip-btn rmc-chip-btn--label${confirmDelete ? ' rmc-chip-btn--danger' : ''}`}
              onClick={handleDelete}
              aria-label={confirmDelete ? 'Confirm removing this photo' : 'Remove this photo'}
              title={confirmDelete ? 'Tap again to remove' : 'Remove photo'}
            >
              {confirmDelete
                ? <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                : <Trash2 size={14} strokeWidth={2.25} aria-hidden="true" />}
              <span>{confirmDelete ? 'Sure?' : 'Remove'}</span>
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="rmc-file-input"
            onChange={handleFiles}
            tabIndex={-1}
            aria-hidden="true"
          />
        </div>
      )}
    </div>
  );
}
