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
        onClick={onReExpand}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onReExpand(); }}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          background: 'var(--bg-muted, #f5f5f5)',
          borderRadius: 10, padding: '8px 14px',
          cursor: 'pointer', fontSize: '0.9rem',
          color: 'var(--text-muted, #666)',
          border: '1px solid var(--border-color, #e0e0e0)',
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {url || pasteText?.slice(0, 60) || 'Edit input'}
        </span>
        <span style={{ fontSize: '1.1rem', opacity: 0.6 }}>&#9998;</span>
      </div>
    );
  }

  // ── Tab button helper ────────────────────────────────────────────────────
  const TabBtn = ({ value, label }) => (
    <button
      onClick={() => setTab(value)}
      style={{
        flex: 1,
        padding: '8px 0',
        border: 'none',
        borderBottom: tab === value ? '2px solid var(--accent, #e67e22)' : '2px solid transparent',
        background: 'none',
        fontWeight: tab === value ? 600 : 400,
        fontSize: '0.9rem',
        cursor: 'pointer',
        color: tab === value ? 'var(--accent, #e67e22)' : 'var(--text-muted, #888)',
        transition: 'all 0.15s ease',
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Segmented tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color, #eee)' }}>
        <TabBtn value="url" label="URL" />
        <TabBtn value="paste" label="Paste Text" />
        <TabBtn value="photo" label="Photo" />
      </div>

      {/* Meal / Drink toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted, #888)' }}>Type:</span>
        <button
          onClick={toggleType}
          style={{
            padding: '4px 14px',
            borderRadius: 20,
            border: '1px solid var(--border-color, #ccc)',
            background: itemType === 'drink' ? 'var(--accent-drink, #9b59b6)' : 'var(--accent, #e67e22)',
            color: '#fff',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background 0.2s',
          }}
        >
          {itemType === 'drink' ? 'Drink' : 'Meal'}
        </button>
      </div>

      {/* URL tab */}
      {tab === 'url' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleUrlKeyDown}
              placeholder="Paste recipe URL..."
              autoFocus
              style={{
                flex: 1, padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid var(--border-color, #ccc)',
                fontSize: '1rem',
                outline: 'none',
              }}
            />
            <button
              onClick={handleUrlSubmit}
              disabled={!url.trim()}
              style={{
                padding: '10px 20px',
                borderRadius: 10,
                border: 'none',
                background: url.trim() ? 'var(--accent, #e67e22)' : 'var(--bg-muted, #ddd)',
                color: url.trim() ? '#fff' : '#999',
                fontWeight: 600,
                fontSize: '0.95rem',
                cursor: url.trim() ? 'pointer' : 'default',
                transition: 'background 0.2s',
              }}
            >
              Import
            </button>
          </div>
          {socialDetected && (
            <div style={{
              fontSize: '0.8rem', color: 'var(--accent, #e67e22)',
              padding: '2px 0',
            }}>
              Detected: {socialDetected}
            </div>
          )}
        </div>
      )}

      {/* Paste Text tab */}
      {tab === 'paste' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste recipe text, ingredients, or instructions..."
            rows={6}
            style={{
              width: '100%', padding: '10px 14px',
              borderRadius: 10,
              border: '1px solid var(--border-color, #ccc)',
              fontSize: '0.95rem',
              resize: 'vertical',
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          <button
            onClick={handlePasteSubmit}
            disabled={!pasteText.trim()}
            style={{
              padding: '10px 20px',
              borderRadius: 10,
              border: 'none',
              background: pasteText.trim() ? 'var(--accent, #e67e22)' : 'var(--bg-muted, #ddd)',
              color: pasteText.trim() ? '#fff' : '#999',
              fontWeight: 600,
              fontSize: '0.95rem',
              cursor: pasteText.trim() ? 'pointer' : 'default',
              alignSelf: 'flex-end',
            }}
          >
            Import Text
          </button>
        </div>
      )}

      {/* Photo tab */}
      {tab === 'photo' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted, #888)', textAlign: 'center' }}>
            Upload a photo of a recipe (cookbook page, index card, screenshot)
          </p>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() => fileRef.current?.click()}
              style={{
                padding: '10px 24px',
                borderRadius: 10,
                border: '1px solid var(--border-color, #ccc)',
                background: 'var(--card-bg, #fff)',
                fontSize: '0.95rem',
                cursor: 'pointer',
              }}
            >
              Choose File
            </button>
            <button
              onClick={() => cameraRef.current?.click()}
              style={{
                padding: '10px 24px',
                borderRadius: 10,
                border: '1px solid var(--border-color, #ccc)',
                background: 'var(--card-bg, #fff)',
                fontSize: '0.95rem',
                cursor: 'pointer',
              }}
            >
              Take Photo
            </button>
          </div>
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
