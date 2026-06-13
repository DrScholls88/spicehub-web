import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, ArrowRight, Camera, FolderOpen } from 'lucide-react';
import { isSocialMediaUrl, getSocialPlatform, detectImportType } from '../recipeParser.js';

// Spec §1: input area compresses to compact bar over 250ms, spring-like easing
const COLLAPSE_TRANSITION = { duration: 0.25, ease: [0.32, 0.72, 0, 1] };

/**
 * ImportInput — the input form for the Collapse & Reveal import flow.
 *
 * When collapsed=false: full input area with tabs (URL | Paste Text | Photo),
 * type toggle, and import buttons.
 *
 * When collapsed=true: compact bar showing the current URL + edit icon.
 * Tap to re-expand via onReExpand.
 *
 * Props:
 *   collapsed        — boolean, whether to show collapsed status bar
 *   activeTab        — controlled active tab ('url' | 'paste' | 'photo')
 *   setActiveTab     — setter for active tab
 *   url              — controlled url value
 *   setUrl           — setter for url value
 *   pasteText        — controlled pasteText value
 *   setPasteText     — setter for pasteText value
 *   itemType         — controlled itemType value ('meal' | 'drink')
 *   setItemType      — setter for itemType value
 *   onImport(url, type)        — URL import callback
 *   onPasteImport(text, type)  — paste text import callback
 *   onPhotoImport(dataUrl, type) — photo import callback
 *   onReExpand()               — tap collapsed bar to expand
 *   initialUrl                 — pre-filled URL
 *   initialType                — 'meal' | 'drink'
 *   title                      — modal title for context
 */
export default function ImportInput({
  collapsed = false,
  status = 'idle',
  activeTab,
  setActiveTab,
  url,
  setUrl,
  pasteText,
  setPasteText,
  itemType,
  setItemType,
  onImport,
  onPasteImport,
  onPhotoImport,
  onReExpand,
  initialUrl = '',
  initialType = 'meal',
  title = '',
}) {
  const tab = activeTab;
  const setTab = setActiveTab;

  const fileRef = useRef(null);
  const cameraRef = useRef(null);

  // Local state for social platform chip detection
  const [socialDetected, setSocialDetected] = useState(null);

  // Detect social platform when URL changes
  useEffect(() => {
    if (url && isSocialMediaUrl(url)) {
      setSocialDetected(getSocialPlatform(url));
    } else {
      setSocialDetected(null);
    }
  }, [url]);

  // Auto-detect type from URL
  useEffect(() => {
    if (url) {
      const detected = detectImportType(url);
      if (detected && detected !== itemType) {
        setItemType(detected);
      }
    }
  }, [url, itemType, setItemType]);

  const handleUrlSubmit = useCallback(() => {
    if (url.trim()) {
      onImport(url.trim(), itemType);
    }
  }, [url, itemType, onImport]);

  const handleUrlKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleUrlSubmit();
    }
  }, [handleUrlSubmit]);

  const handlePhotoChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onPhotoImport(reader.result, itemType);
    };
    reader.readAsDataURL(file);
  }, [itemType, onPhotoImport]);

  // ── Collapsed bar ⇄ full form, cross-animated (AnimatePresence must stay
  //    mounted across the switch, so both branches live in one ternary) ─────
  return (
    <motion.div layout style={{ width: '100%' }}>
      <AnimatePresence mode="wait" initial={false}>
        {collapsed ? (
          <motion.div
            key="collapsed"
            className="import-input-collapsed"
            onClick={onReExpand}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') onReExpand(); }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={COLLAPSE_TRANSITION}
          >
            <span className={`import-input-collapsed-dot status-${status}`} />
            <span className="import-input-collapsed-url">
              {url || pasteText?.slice(0, 60) || 'Edit input'}
            </span>
            <span className="import-input-collapsed-edit" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Pencil size={16} />
            </span>
          </motion.div>
        ) : (
          <motion.div
            key="expanded"
            className="import-input"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={COLLAPSE_TRANSITION}
          >
            {/* Segmented tabs */}
            <div className="import-input-tabs">
              <button className={tab === 'url' ? 'active' : ''} onClick={() => setTab('url')}>URL</button>
              <button className={tab === 'paste' ? 'active' : ''} onClick={() => setTab('paste')}>Paste Text</button>
              <button className={tab === 'photo' ? 'active' : ''} onClick={() => setTab('photo')}>Photo</button>
            </div>

            {/* Meal / Drink toggle */}
            <div className="import-input-type-toggle">
              <button
                className={itemType === 'meal' ? 'active' : ''}
                onClick={() => setItemType('meal')}
              >
                Meal
              </button>
              <button
                className={itemType === 'drink' ? 'active' : ''}
                onClick={() => setItemType('drink')}
              >
                Drink
              </button>
            </div>

            {/* URL tab */}
            {tab === 'url' && (
              <div>
                <div className="import-input-url-row">
                  <input
                    className="import-input-url"
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={handleUrlKeyDown}
                    placeholder="Paste recipe URL..."
                    autoFocus
                  />
                  <button
                    type="button"
                    className="import-input-url-submit"
                    onClick={handleUrlSubmit}
                    disabled={!url.trim()}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    aria-label="Submit URL"
                  >
                    <ArrowRight size={20} />
                  </button>
                </div>
                {socialDetected && (
                  <div className="import-input-social-card" onClick={handleUrlSubmit}>
                    <div className="import-input-social-icon" />
                    <div className="import-input-social-meta">
                      <strong>{socialDetected}</strong>
                      <small>Recipe detected — tap to import</small>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Paste Text tab */}
            {tab === 'paste' && (
              <div>
                <textarea
                  className="import-input-paste"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="Paste recipe text, ingredients, or instructions..."
                  rows={6}
                />
              </div>
            )}

            {/* Photo tab */}
            {tab === 'photo' && (
              <div className="import-input-photo-section">
                <div className="import-input-photo-btn-row">
                  <button
                    className="import-input-photo-btn"
                    onClick={() => cameraRef.current?.click()}
                  >
                    <Camera size={22} strokeWidth={2} />
                    <span>Take Photo</span>
                  </button>
                  <button
                    className="import-input-photo-btn"
                    onClick={() => fileRef.current?.click()}
                  >
                    <FolderOpen size={22} strokeWidth={2} />
                    <span>Choose File</span>
                  </button>
                </div>
                <p className="import-input-photo-hint">
                  Upload a photo of a recipe (cookbook page, index card, screenshot)
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  style={{ display: 'none' }}
                />
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoChange}
                  style={{ display: 'none' }}
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
