import { useState, useRef, useEffect, useCallback } from 'react';
import { isSocialMediaUrl, getSocialPlatform, detectImportType } from '../recipeParser.js';

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
  onImport,
  onPasteImport,
  onPhotoImport,
  onReExpand,
  initialUrl = '',
  initialType = 'meal',
  title = '',
}) {
  const [tab, setTab] = useState('url'); // 'url' | 'paste' | 'photo'
  const [url, setUrl] = useState(initialUrl);
  const [pasteText, setPasteText] = useState('');
  const [itemType, setItemType] = useState(initialType);
  const [socialDetected, setSocialDetected] = useState(null);
  const fileRef = useRef(null);
  const cameraRef = useRef(null);

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

  const handlePasteSubmit = useCallback(() => {
    if (pasteText.trim()) {
      onPasteImport(pasteText.trim(), itemType);
    }
  }, [pasteText, itemType, onPasteImport]);

  const handlePhotoChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onPhotoImport(reader.result, itemType);
    };
    reader.readAsDataURL(file);
  }, [itemType, onPhotoImport]);

  const toggleType = useCallback(() => {
    setItemType((prev) => (prev === 'meal' ? 'drink' : 'meal'));
  }, []);

  // ── Collapsed status bar ─────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div
        className="import-input-collapsed"
        onClick={onReExpand}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onReExpand(); }}
      >
        <span className="import-input-collapsed-dot" />
        <span className="import-input-collapsed-url">
          {url || pasteText?.slice(0, 60) || 'Edit input'}
        </span>
        <span className="import-input-collapsed-edit">&#9998;</span>
      </div>
    );
  }

  return (
    <div className="import-input">
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
          <input
            className="import-input-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleUrlKeyDown}
            placeholder="Paste recipe URL..."
            autoFocus
          />
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
          <button
            className="import-input-paste-submit"
            onClick={handlePasteSubmit}
            disabled={!pasteText.trim()}
          >
            Import Text
          </button>
        </div>
      )}

      {/* Photo tab */}
      {tab === 'photo' && (
        <div className="import-input-photo-section">
          <button
            className="import-input-photo-btn"
            onClick={() => fileRef.current?.click()}
          >
            Choose File or Take Photo
          </button>
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
  );
}
