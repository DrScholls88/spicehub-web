/**
 * InstagramZipImport
 * ──────────────────
 * I-1: Accept an Instagram data-export ZIP, parse saved_posts.json locally
 * (zero network), extract all post URLs, and queue them through the existing
 * batchQueue engine with a resumable progress UI.
 *
 * Supports both old & new Instagram export formats:
 *   - your_instagram_activity/saves/saved_posts.json  (2023+ format)
 *   - saved_posts.json  (older flat format)
 *   - saved_media.json  (some older exports)
 *
 * Each saved post URL lives at:
 *   item.string_map_data["Saved on"].href  (most common)
 *   item.string_map_data["Link"].href       (alternate key)
 *   item.media_list_data[n].uri             (media-only exports)
 */

import { useState, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import { addBatchQueueItems } from '../db';
import './InstagramZipImport.css';

// ── Candidate file paths inside the ZIP ────────────────────────────────────
const SAVED_PATHS = [
  'your_instagram_activity/saves/saved_posts.json',
  'saved_posts.json',
  'saved_media.json',
  // Italian/Spanish Instagram exports use a different path
  'your_instagram_activity/saves/posts_guardados.json',
];

// ── Extract Instagram post URLs from parsed JSON ─────────────────────────
function extractUrlsFromJson(json) {
  const urls = [];

  // Flatten top-level keys — Instagram wraps the array under a named key
  const possibleArrays = [
    json?.saved_saved_media,       // 2024+ format
    json?.saved_media,             // 2022-2023 format
    json,                          // sometimes the root IS the array
  ].filter(v => Array.isArray(v));

  const items = possibleArrays[0] || [];

  for (const item of items) {
    // Primary: string_map_data["Saved on"].href
    const smd = item?.string_map_data;
    if (smd) {
      for (const key of ['Saved on', 'Link', 'URL', 'Post']) {
        const href = smd[key]?.href;
        if (href && /^https?:\/\//.test(href)) {
          urls.push(href);
          break;
        }
      }
      continue;
    }

    // Fallback: media_list_data[].uri  (media-only entries)
    const mediaList = item?.media_list_data || [];
    for (const m of mediaList) {
      if (m?.uri && /^https?:\/\//.test(m.uri)) {
        urls.push(m.uri);
        break;
      }
    }

    // Last resort: item itself is a string URL
    if (typeof item === 'string' && /^https?:\/\//.test(item)) {
      urls.push(item);
    }
  }

  return [...new Set(urls)]; // deduplicate
}

// ── Phase constants ─────────────────────────────────────────────────────────
const PHASE = {
  IDLE:      'idle',
  PARSING:   'parsing',
  PREVIEW:   'preview',
  QUEUING:   'queuing',
  DONE:      'done',
  ERROR:     'error',
};

export default function InstagramZipImport({ onDone, onToast }) {
  const [phase, setPhase]     = useState(PHASE.IDLE);
  const [urls, setUrls]       = useState([]);
  const [queued, setQueued]   = useState(0);
  const [errorMsg, setError]  = useState('');
  const [isDragOver, setDrag] = useState(false);
  const fileRef               = useRef(null);

  // ── Parse a ZIP File object ─────────────────────────────────────────────
  const parseZip = useCallback(async (file) => {
    setPhase(PHASE.PARSING);
    setError('');
    try {
      const zip = await JSZip.loadAsync(file);
      let jsonText = null;

      // Try known paths first
      for (const path of SAVED_PATHS) {
        const entry = zip.file(path);
        if (entry) { jsonText = await entry.async('text'); break; }
      }

      // Fallback: search all files for a name containing "saved"
      if (!jsonText) {
        const allFiles = Object.keys(zip.files);
        const candidate = allFiles.find(
          f => /saved/i.test(f) && f.endsWith('.json') && !zip.files[f].dir
        );
        if (candidate) jsonText = await zip.files[candidate].async('text');
      }

      if (!jsonText) {
        throw new Error(
          'No saved posts file found.\n' +
          'Make sure you selected the Instagram data export ZIP that contains your saved posts.'
        );
      }

      const json    = JSON.parse(jsonText);
      const found   = extractUrlsFromJson(json);

      if (found.length === 0) {
        throw new Error(
          'No Instagram post URLs found in the saved posts file.\n' +
          'This might be an older export format. Please contact support with your export version.'
        );
      }

      setUrls(found);
      setPhase(PHASE.PREVIEW);
    } catch (err) {
      setError(err.message || 'Failed to parse ZIP file.');
      setPhase(PHASE.ERROR);
    }
  }, []);

  // ── Drag & Drop handlers ────────────────────────────────────────────────
  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) parseZip(file);
  }, [parseZip]);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    setDrag(true);
  }, []);

  const onDragLeave = useCallback(() => setDrag(false), []);

  const onFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) parseZip(file);
  }, [parseZip]);

  // ── Queue URLs into batchQueue ──────────────────────────────────────────
  const queueAll = useCallback(async () => {
    setPhase(PHASE.QUEUING);
    const CHUNK = 25; // queue in chunks so batchEngine can start early
    let total = 0;
    for (let i = 0; i < urls.length; i += CHUNK) {
      const chunk = urls.slice(i, i + CHUNK);
      await addBatchQueueItems(chunk);
      total += chunk.length;
      setQueued(total);
    }
    window.dispatchEvent(new CustomEvent('spicehub:batch-queue-updated'));
    setPhase(PHASE.DONE);
    onToast?.(`${urls.length} saved posts queued for import 📥`);
  }, [urls, onToast]);

  const reset = useCallback(() => {
    setPhase(PHASE.IDLE);
    setUrls([]);
    setQueued(0);
    setError('');
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="igzip-root">
      {/* ── IDLE: drop zone ── */}
      {phase === PHASE.IDLE && (
        <div
          className={`igzip-dropzone${isDragOver ? ' igzip-drag-over' : ''}`}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Drop your Instagram export ZIP here"
          onKeyDown={e => e.key === 'Enter' && fileRef.current?.click()}
        >
          <div className="igzip-drop-icon" aria-hidden="true">📦</div>
          <p className="igzip-drop-title">Drop your Instagram export here</p>
          <p className="igzip-drop-sub">
            Or tap to choose the ZIP file · Processed entirely on-device
          </p>
          <div className="igzip-how">
            <span className="igzip-how-label">How to export:</span>
            <span>Instagram → ⚙ More → Your activity → Download your information</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            style={{ display: 'none' }}
            onChange={onFileChange}
          />
        </div>
      )}

      {/* ── PARSING: spinner ── */}
      {phase === PHASE.PARSING && (
        <div className="igzip-state-center">
          <div className="igzip-spinner" aria-label="Parsing ZIP…" />
          <p className="igzip-state-label">Reading your export…</p>
        </div>
      )}

      {/* ── PREVIEW: show URL count, confirm ── */}
      {phase === PHASE.PREVIEW && (
        <div className="igzip-preview">
          <div className="igzip-preview-header">
            <span className="igzip-preview-icon" aria-hidden="true">✅</span>
            <div>
              <p className="igzip-preview-count">
                <strong>{urls.length.toLocaleString()}</strong> saved posts found
              </p>
              <p className="igzip-preview-sub">
                They'll be queued and imported in the background — no need to wait.
              </p>
            </div>
          </div>

          {/* Sample list — show up to 5 */}
          <ul className="igzip-url-sample">
            {urls.slice(0, 5).map((u, i) => (
              <li key={i} className="igzip-url-item">
                <span className="igzip-url-dot" aria-hidden="true">·</span>
                <span className="igzip-url-text">{u}</span>
              </li>
            ))}
            {urls.length > 5 && (
              <li className="igzip-url-more">+ {urls.length - 5} more</li>
            )}
          </ul>

          <div className="igzip-preview-actions">
            <button className="igzip-btn-secondary" onClick={reset}>
              Choose different file
            </button>
            <button className="igzip-btn-primary" onClick={queueAll}>
              Queue all {urls.length} posts →
            </button>
          </div>
        </div>
      )}

      {/* ── QUEUING: progress ── */}
      {phase === PHASE.QUEUING && (
        <div className="igzip-state-center">
          <div className="igzip-progress-track">
            <div
              className="igzip-progress-fill"
              style={{ width: `${urls.length ? (queued / urls.length) * 100 : 0}%` }}
            />
          </div>
          <p className="igzip-state-label">
            Queuing {queued} / {urls.length}…
          </p>
        </div>
      )}

      {/* ── DONE ── */}
      {phase === PHASE.DONE && (
        <div className="igzip-state-center igzip-done">
          <span className="igzip-done-icon" aria-hidden="true">🎉</span>
          <p className="igzip-state-label">
            {urls.length.toLocaleString()} posts queued!
          </p>
          <p className="igzip-done-sub">
            SpiceHub will import them in the background.
            Check the batch queue for progress.
          </p>
          <div className="igzip-done-actions">
            <button className="igzip-btn-secondary" onClick={reset}>
              Import another file
            </button>
            <button className="igzip-btn-primary" onClick={onDone}>
              View queue →
            </button>
          </div>
        </div>
      )}

      {/* ── ERROR ── */}
      {phase === PHASE.ERROR && (
        <div className="igzip-state-center igzip-error">
          <span className="igzip-error-icon" aria-hidden="true">⚠️</span>
          <p className="igzip-state-label">Couldn't read that file</p>
          <p className="igzip-error-msg">{errorMsg}</p>
          <button className="igzip-btn-primary" onClick={reset}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
