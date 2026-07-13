import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, X as XIcon, Sparkles } from 'lucide-react';
import { isSocialMediaUrl, getSocialPlatform, detectImportType } from '../recipeParser.js';
import { hapticLight } from '../haptics';
import PhotoScanSession from './PhotoScanSession';

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
 *   scanPages / setScanPages   — multi-page scan session state (lifted to
 *                                ImportSheet so review-time re-crop can reuse
 *                                the original pages)
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
  scanPages = [],
  setScanPages,
  onReExpand,
  initialUrl = '',
  initialType = 'meal',
  title = '',
}) {
  const tab = activeTab;
  const setTab = setActiveTab;

  // Local state for social platform chip detection
  const [socialDetected, setSocialDetected] = useState(null);
  // Smart ingestion: drag-over ring + auto-detected type disclosure
  const [dragOver, setDragOver] = useState(false);
  const [showTypeOverride, setShowTypeOverride] = useState(false);
  // Files dropped/pasted outside the Photo tab, handed to PhotoScanSession
  const [incomingFiles, setIncomingFiles] = useState(null);

  const looksLikeUrl = useCallback((s) => /^\s*https?:\/\/\S+/i.test(s || ''), []);

  // Route dropped/pasted image or PDF files into the scan session. The
  // session (via ImportSheet state) collects pages; extraction is one tap on
  // the footer CTA — so "drop, then add the back of the card" just works.
  const ingestMediaFiles = useCallback((files) => {
    const media = Array.from(files || []).filter(
      (f) => f.type?.startsWith('image/') || f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''),
    );
    if (!media.length) return false;
    setTab('photo');
    setIncomingFiles(media);
    return true;
  }, [setTab]);

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
    const files = [];
    for (const it of items) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length && ingestMediaFiles(files)) {
      e.preventDefault();
      return;
    }
    const text = e.clipboardData?.getData('text') || '';
    // If a multi-line / non-URL blob lands in the URL field, reroute to paste.
    if (tab === 'url' && text && !looksLikeUrl(text) && /\n|.{60,}/.test(text)) {
      e.preventDefault();
      setTab('paste');
      setPasteText(text);
    }
  }, [ingestMediaFiles, tab, looksLikeUrl, setTab, setPasteText]);

  // Unified drop zone — accept image/PDF files or dragged text/links.
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    if (ingestMediaFiles(e.dataTransfer?.files)) return;
    const text = e.dataTransfer?.getData('text') || '';
    if (text) ingestText(text);
  }, [ingestMediaFiles, ingestText]);

  // Detect social platform when URL changes
  useEffect(() => {
    if (url && isSocialMediaUrl(url)) {
      setSocialDetected(getSocialPlatform(url));
    } else {
      setSocialDetected(null);
    }
  }, [url]);

  // Tracks whether the user has manually picked Meal/Drink since the URL last
  // changed. Without this, the auto-detect effect below (which used to depend
  // on itemType itself) re-ran on every manual toggle tap and silently
  // reverted it right back — detectImportType() defaults to 'meal' for any
  // URL with no drink keywords, which is true for virtually every Instagram
  // link, so a Drink tap on an IG paste would flip back to Meal on the very
  // next render. (2026-07-13 critique: "auto-locks in a Meals import that I
  // can't seem to manually change.")
  const userTypedTypeRef = useRef(false);

  // A genuinely new URL deserves a fresh auto-detect guess.
  useEffect(() => {
    userTypedTypeRef.current = false;
  }, [url]);

  // Auto-detect type from URL — only when the user hasn't manually overridden
  // it, and only re-run when the URL itself changes (NOT itemType — that was
  // the bug: including itemType here made a manual toggle re-trigger this
  // same effect, which then reasserted the URL-based guess over the user's tap).
  useEffect(() => {
    if (url && !userTypedTypeRef.current) {
      const detected = detectImportType(url);
      if (detected && detected !== itemType) {
        setItemType(detected);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

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
              {url
                || pasteText?.slice(0, 60)
                || (scanPages.length ? `Photo scan · ${scanPages.length} page${scanPages.length === 1 ? '' : 's'}` : 'Edit input')}
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
                    // Status-only chip — the sole import action lives in the sticky
                    // footer's "Auto-Parse & Import" button, so this never doubles
                    // as a second tap target (previously it duplicated that button).
                    <div className="import-input-social-card" aria-live="polite">
                      <div className="import-input-social-icon">
                        <Sparkles size={18} strokeWidth={2} color="#fff" />
                      </div>
                      <div className="import-input-social-meta">
                        <strong>{socialDetected} link detected</strong>
                        <small>Ready — tap Auto-Parse &amp; Import below</small>
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

              {/* Photo tab — multi-page scanner session */}
              {tab === 'photo' && (
                <div className="import-input-photo-section">
                  <PhotoScanSession
                    pages={scanPages}
                    setPages={setScanPages}
                    incomingFiles={incomingFiles}
                    onIncomingHandled={() => setIncomingFiles(null)}
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
                      onClick={() => { hapticLight(); userTypedTypeRef.current = true; setItemType('meal'); }}
                      style={{ transition: TYPE_TOGGLE_TRANSITION }}
                    >
                      🍽️ Meal
                    </button>
                    <button
                      className={itemType === 'drink' ? 'active' : ''}
                      onClick={() => { hapticLight(); userTypedTypeRef.current = true; setItemType('drink'); }}
                      style={{ transition: TYPE_TOGGLE_TRANSITION }}
                    >
                      🍸 Drink
                    </button>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
