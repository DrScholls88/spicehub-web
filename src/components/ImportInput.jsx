import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, Zap, Camera, FolderOpen, X as XIcon } from 'lucide-react';
import { isSocialMediaUrl, getSocialPlatform, detectImportType } from '../recipeParser.js';
import { hapticLight } from '../haptics';

// Spec §1: input area compresses to compact bar over 250ms, spring-like easing
const COLLAPSE_TRANSITION = { duration: 0.25, ease: [0.32, 0.72, 0, 1] };

// Shared --sh-spring cubic-bezier for inline CSS transitions, so hover/press/focus
// interactions on this component's interactive elements match the rest of the app.
const SH_SPRING = 'cubic-bezier(0.32, 0.72, 0, 1)';
const TAB_BUTTON_TRANSITION = `background ${SH_SPRING} 0.15s, color ${SH_SPRING} 0.15s, box-shadow ${SH_SPRING} 0.15s, transform ${SH_SPRING} 0.1s`;
const TYPE_TOGGLE_TRANSITION = `background ${SH_SPRING} 0.15s, color ${SH_SPRING} 0.15s, border-color ${SH_SPRING} 0.15s, transform ${SH_SPRING} 0.1s`;

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
  // Smart ingestion: drag-over ring + auto-detected type disclosure
  const [dragOver, setDragOver] = useState(false);
  const [showTypeOverride, setShowTypeOverride] = useState(false);

  const looksLikeUrl = useCallback((s) => /^\s*https?:\/\/\S+/i.test(s || ''), []);

  // Read an image File → dataURL → vision pipeline
  const ingestImageFile = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onPhotoImport(reader.result, itemType);
    reader.readAsDataURL(file);
  }, [itemType, onPhotoImport]);

  // Route an arbitrary string to the right mode: URL vs raw text
  const ingestText = useCallback((raw) => {
    const text = (raw || '').trim();
    if (!text) return;
    if (looksLikeUrl(text)) {
      setTab('url');
      setUrl(text);
    } else {
      setTab('paste');
      setPasteText(text);
    }
  }, [looksLikeUrl, setTab, setUrl, setPasteText]);

  // Smart paste anywhere in the ingestion zone — sniff clipboard payload type.
  const handleSmartPaste = useCallback((e) => {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        e.preventDefault();
        ingestImageFile(it.getAsFile());
        return;
      }
    }
    const text = e.clipboardData?.getData('text') || '';
    // If a multi-line / non-URL blob lands in the URL field, reroute to paste.
    if (tab === 'url' && text && !looksLikeUrl(text) && /\n|.{60,}/.test(text)) {
      e.preventDefault();
      setTab('paste');
      setPasteText(text);
    }
  }, [ingestImageFile, tab, looksLikeUrl, setTab, setPasteText]);

  // Unified drop zone — accept image files or dragged text/links.
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = Array.from(e.dataTransfer?.files || []).find(f => f.type.startsWith('image/'));
    if (file) { ingestImageFile(file); return; }
    const text = e.dataTransfer?.getData('text') || '';
    if (text) ingestText(text);
  }, [ingestImageFile, ingestText]);

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
            style={{ minHeight: '44px', boxSizing: 'border-box' }}
          >
            <span className={`import-input-collapsed-dot status-${status}`} />
            <span className="import-input-collapsed-url">
              {url || pasteText?.slice(0, 60) || 'Edit input'}
            </span>
            <span
              className="import-input-collapsed-edit"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '32px',
                minHeight: '32px',
                transition: `background ${SH_SPRING} 0.12s`,
              }}
            >
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
            {/* Unified ingestion zone — accepts paste of link/text or dropped image */}
            <div
              className={`import-input-zone${dragOver ? ' dragover' : ''}`}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
              onPaste={handleSmartPaste}
            >
              {/* Segmented tabs */}
              <div className="import-input-tabs">
                <button className={tab === 'url' ? 'active' : ''} onClick={() => setTab('url')} style={{ transition: TAB_BUTTON_TRANSITION }}>Link</button>
                <button className={tab === 'paste' ? 'active' : ''} onClick={() => setTab('paste')} style={{ transition: TAB_BUTTON_TRANSITION }}>Text</button>
                <button className={tab === 'photo' ? 'active' : ''} onClick={() => setTab('photo')} style={{ transition: TAB_BUTTON_TRANSITION }}>Photo</button>
              </div>

              {/* URL tab */}
              {tab === 'url' && (
                <div>
                  <div className="import-input-url-row">
                    <input
                      className="import-input-url"
                      type="url"
                      inputMode="url"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={handleUrlKeyDown}
                      placeholder="Paste a link, or drop text or an image…"
                      autoFocus
                    />
                    <AnimatePresence>
                      {url.trim().length > 0 && (
                        <motion.button
                          key="url-clear"
                          type="button"
                          className="import-input-url-clear"
                          onClick={() => setUrl('')}
                          aria-label="Clear URL"
                          initial={{ opacity: 0, scale: 0.7 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.7 }}
                          transition={{ duration: 0.15, ease: [0.32, 0.72, 0, 1] }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            width: '40px',
                            height: '40px',
                            borderRadius: '50%',
                            border: 'none',
                            background: 'var(--surface-2, var(--border))',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          <XIcon size={16} strokeWidth={2} />
                        </motion.button>
                      )}
                    </AnimatePresence>
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
                    placeholder="e.g. 2 cups flour, 1 tsp salt… or paste a full recipe with ingredients and directions"
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
                      style={{ transition: `background ${SH_SPRING} 0.12s, transform 0.12s ${SH_SPRING}` }}
                    >
                      <Camera size={22} strokeWidth={2} />
                      <span>Take Photo</span>
                    </button>
                    <button
                      className="import-input-photo-btn"
                      onClick={() => fileRef.current?.click()}
                      style={{ transition: `background ${SH_SPRING} 0.12s, transform 0.12s ${SH_SPRING}` }}
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
            </div>

            {/* Auto-detected type — compact chip, override on demand (no forced upfront choice) */}
            {tab !== 'photo' && (
              <div className="import-input-type-row">
                {!showTypeOverride ? (
                  <button
                    type="button"
                    className="import-input-type-chip"
                    onClick={() => { hapticLight(); setShowTypeOverride(true); }}
                  >
                    <span className="import-input-type-chip-emoji" aria-hidden="true">{itemType === 'drink' ? '🍸' : '🍽️'}</span>
                    Saving as <strong>{itemType === 'drink' ? 'Drink' : 'Meal'}</strong>
                    <span className="import-input-type-chip-change">Change</span>
                  </button>
                ) : (
                  <div className="import-input-type-toggle">
                    <button
                      className={itemType === 'meal' ? 'active' : ''}
                      onClick={() => { hapticLight(); setItemType('meal'); }}
                      style={{ transition: TYPE_TOGGLE_TRANSITION }}
                    >
                      🍽️ Meal
                    </button>
                    <button
                      className={itemType === 'drink' ? 'active' : ''}
                      onClick={() => { hapticLight(); setItemType('drink'); }}
                      style={{ transition: TYPE_TOGGLE_TRANSITION }}
                    >
                      🍸 Drink
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Single clear primary CTA (URL / Text modes) */}
            {tab !== 'photo' && (
              <button
                type="button"
                className="import-input-primary-cta"
                disabled={tab === 'url' ? !url.trim() : !pasteText.trim()}
                onClick={() => {
                  hapticLight();
                  if (tab === 'url') handleUrlSubmit();
                  else onPasteImport(pasteText, itemType);
                }}
              >
                <Zap size={18} strokeWidth={2.5} aria-hidden="true" />
                Auto-Parse Recipe
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
